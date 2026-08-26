# Fever M5C: runbook de primera importación production-safe

M5C prepara el comando manual `npm run fever:import`; no despliega, no importa datos reales, no activa Fever, imágenes ni cron. El comando exige `--confirm-production-import`, usa únicamente `DATABASE_PATH`, no ejecuta migrations ni backup y no admite otra ruta de DB ni `--allow-mass-removal`.

## Gates del comando

Antes de escribir, exige credenciales Impact presentes sin imprimirlas, `FEVER_IMAGES_ENABLED=false`, las migrations exactas `009_add_fever_source_geography.sql` y `010_add_active_occurrence_lookup_index.sql`, `PRAGMA integrity_check=ok` y la source `fever` existente con `enabled=0`. Repite source e integridad dentro del importador, tras preparar el feed y los guards de conjunto deseado, inmediatamente antes de su transacción. Tras el commit vuelve a verificar source disabled e integridad. Un fallo de los gates posteriores a la escritura es crítico.

`npm run fever:import -- --preflight` solo abre la DB configurada readonly y verifica esos gates; no descarga feed ni persiste. La ausencia de `FEVER_IMAGES_ENABLED` equivale a `false`.

## Pre-flight futuro, read-only

```bash
cd /var/www/queFem
git status --short
git branch --show-current
git rev-parse HEAD
node --version
pm2 status
df -h
crontab -l
node --input-type=module -e "import 'dotenv/config'; import { loadConfig } from './backend/src/config.js'; console.log(loadConfig().databasePath)"
```

Con la ruta resultante en `$DB`:

```bash
sqlite3 -readonly "$DB" 'PRAGMA integrity_check;'
sqlite3 -readonly "$DB" 'SELECT filename, applied_at FROM schema_migrations ORDER BY filename;'
sqlite3 -readonly "$DB" "SELECT key, enabled FROM sources WHERE key='fever';"
du -h "$DB" "$DB-wal" "$DB-shm" 2>/dev/null
grep -E '^FEVER_IMAGES_ENABLED=' .env || true
```

Abortar si hay menos de 1 GiB libre. M5B observó aproximadamente +26 MB DB y ~25 MB WAL; el margen cubre staging de backup, WAL y logs.

## Backup, código y ventana de migrations

Antes de actualizar código o tocar SQLite, identificar el sistema de backup externo real, ejecutarlo manualmente y comprobar exit success, archivo nuevo, copia remota si procede e integridad/restaurabilidad. El script, formato y ruta no están versionados: no inventarlos ni continuar sin backup verificado.

No usar `deploy.sh` ciegamente para esta primera operación porque ejecuta `db:init`. Tras backup, actualizar código, instalar dependencias, tests y build mientras sea seguro. En una primera ventana controlada y sin import Gencat concurrente:

```bash
pm2 stop quefem-api
npm run db:init
sqlite3 -readonly "$DB" 'PRAGMA integrity_check;'
sqlite3 -readonly "$DB" "SELECT filename FROM schema_migrations WHERE filename IN ('009_add_fever_source_geography.sql','010_add_active_occurrence_lookup_index.sql') ORDER BY filename;"
sqlite3 -readonly "$DB" "SELECT key, enabled FROM sources WHERE key='fever';"
pm2 start quefem-api
```

Tras la migration 009 deben existir las dos migrations exactas y `fever | 0`; 010 añade el índice occurrence-aware. Antes de aplicar 009 la source puede no existir y eso no es un error del pre-flight histórico. Si falla cualquier comprobación, mantener el servicio parado, no importar y restaurar el backup si la DB ha cambiado.

Con el backend ya arrancado, realizar el smoke público **antes de importar**: home, API/listados general, today, upcoming, sitemap, territorios y fichas Gencat y Ticketmaster ya existentes. Si falla, detener, no iniciar importación y aplicar rollback si corresponde.

## Segunda ventana: primera importación manual

Mantener durante toda la operación `sources.fever.enabled=0` y `FEVER_IMAGES_ENABLED=false`. Solo después del smoke pre-import correcto, detener de nuevo el backend para evitar writers concurrentes:

```bash
pm2 stop quefem-api
npm run fever:import -- --confirm-production-import
```

Mientras PM2 sigue detenido, ejecutar la validación interna; no arrancar aún el servicio:

```bash
sqlite3 -readonly "$DB" 'PRAGMA integrity_check;'
sqlite3 -readonly "$DB" "SELECT key, enabled FROM sources WHERE key='fever';"
sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever';"
sqlite3 -readonly "$DB" "SELECT o.status, COUNT(*) FROM plan_occurrences o JOIN plan_sources ps ON ps.id=o.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever' GROUP BY o.status;"
sqlite3 -readonly "$DB" "SELECT g.resolution_status, COUNT(*) FROM plan_source_geography g JOIN plan_sources ps ON ps.id=g.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever' GROUP BY g.resolution_status;"
sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM plan_source_images psi JOIN plan_sources ps ON ps.id=psi.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever';"
sqlite3 -readonly "$DB" "SELECT id,status,started_at,finished_at,summary_json FROM import_runs WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id DESC LIMIT 5;"
```

Exigir integridad `ok`, source `fever | 0`, count Fever positivo, ocurrencias y geografía coherentes, imágenes Fever en cero y ninguna importación `failed` o `running`. Solo entonces:

```bash
pm2 start quefem-api
```

Repetir el smoke público (home, listados general/today/tomorrow/weekend/upcoming, territorios, sitemap y fichas Gencat y Ticketmaster). Ninguna ficha Fever-only debe aparecer por API. No crear cron Fever ni habilitar Fever temporalmente para probar. Las imágenes Fever siguen bloqueadas hasta confirmación documental de derechos.

## Fallos y rollback

| Situación | Acción |
| --- | --- |
| Impact o guard falla antes de writes | Stop; normalmente no restore. |
| Migration/source/images/pre-integrity gate falla | Stop e investigar; no import. |
| Transacción revierte e integridad queda `ok` | Stop e investigar; normalmente no restore. |
| Source o integridad falla tras escritura | Mantener backend parado y preferir restore completo. |
| Visibilidad Fever inesperada o estado incierto | Mantener backend parado; preferir rollback completo. |

Rollback completo: parar PM2, confirmar ausencia de writer, restaurar el backup consistente pre-M5C con el procedimiento real verificado, no mezclar WAL/SHM de épocas distintas, restaurar ownership/permisos, ejecutar `integrity_check`, arrancar PM2 y repetir smoke tests. No se define un comando de restore porque el formato del backup es externo al repositorio.
