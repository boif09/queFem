# Fever: importación manual inicial y ejecución recurrente

Fever está publicado en producción con `sources.key='fever'` en `enabled=1` y `FEVER_IMAGES_ENABLED=true`. Este documento diferencia la vía manual histórica de primera carga y la vía recurrente preparada para cron. El repositorio no instala ni modifica el crontab, PM2, Nginx ni ninguna base de datos de producción.

## Dos comandos, dos políticas

| Uso | Comando | Política |
| --- | --- | --- |
| Primera carga manual histórica | `npm run fever:import -- --confirm-production-import` | Requiere Fever e imágenes deshabilitados; conserva la protección de la primera activación. No usar en la producción Fever ya publicada. |
| Importación recurrente | `npm run fever:import:scheduled` | Sin argumentos ni confirmación; exige Fever existente y `enabled=1`. Soporta explícitamente `FEVER_IMAGES_ENABLED=true`. |

El comando recurrente nunca acepta ruta de base de datos, migrations ni mass removal, ni por CLI ni por su entry point programático. Usa exclusivamente `DATABASE_PATH` de la configuración, siempre llama al runner con `migrateDatabase=false` y `allowMassRemoval=false`.

## Gates del modo recurrente

Antes de descargar el catálogo, abre la DB configurada readonly y exige:

- credenciales Impact presentes, sin imprimirlas;
- migrations exactas `009_add_fever_source_geography.sql` y `010_add_active_occurrence_lookup_index.sql`;
- `PRAGMA integrity_check=ok`;
- source `fever` existente y `enabled=1`.

Tras descargar, normalizar, geolocalizar y aplicar los guards del conjunto deseado, vuelve a comprobar source e integridad inmediatamente antes de la transacción. La transacción persiste y reconcilia el catálogo, pero no marca todavía el run como `completed`. Solo tras los checks post-commit —integridad, source, estadísticas y conteos— se marca `completed`. Si uno falla después del commit, el proceso falla y el run queda `failed` con `catalogCommitted=true` en su summary; los datos ya committed no se presentan falsamente como revertidos. Fever no se habilita ni deshabilita automáticamente.

Los guards de baseline Catalunya y de ratio de retirada siguen activos. Una ejecución recurrente no dispone de ningún bypass de `allowMassRemoval`. El importador conserva `import_runs`: un error tras crear un run lo marca `failed`; el commit del catálogo no lo completa y solo los post-checks correctos lo marcan `completed`.

## Concurrencia

Manual y recurrente comparten un lock de directorio atómico junto a la DB configurada: `$DATABASE_PATH.fever-import.lock`. El propietario guarda PID, token, hora y, en Linux, el start-time de `/proc/<pid>/stat`; así un PID reutilizado por otro proceso no conserva el lock antiguo. Una segunda ejecución Fever no escribe:

- el comando scheduled registra un JSON con `status=skipped` y `reason=concurrent-import`, y sale correctamente;
- el comando manual se rechaza para que el operador no confunda una ejecución omitida con una importación manual realizada.

Tras el `mkdir`, el propietario escribe la metadata completa y sincronizada en `owner.<token>.tmp` dentro del directorio, y la publica con un `rename` atómico a `owner.json`; no hay un `owner.json` parcialmente escrito durante una adquisición viva. Al terminar, solo el propietario elimina su lock. Si el propietario murió o su generación Linux no coincide, el siguiente proceso recupera el lock; un directorio sin `owner.json` (por ejemplo, un crash antes de publicar) o una metadata malformada solo se considera stale tras una breve gracia y se recupera finalmente. El token impide que un propietario antiguo borre un lock de reemplazo. Este diseño asume un único host Linux; fuera de Linux conserva el fallback conservador PID+gracia.

## Validación manual de la segunda importación

Antes de añadir cron, realizar una vez el comando scheduled de forma controlada, fuera de las ventanas Gencat, Ticketmaster e imágenes y con backup reciente verificable.

```bash
cd /var/www/queFem
node --input-type=module -e "import 'dotenv/config'; import { loadConfig } from './backend/src/config.js'; console.log(loadConfig().databasePath)"
sqlite3 -readonly "$DB" 'PRAGMA integrity_check;'
sqlite3 -readonly "$DB" "SELECT key, enabled FROM sources WHERE key='fever';"
sqlite3 -readonly "$DB" "SELECT filename FROM schema_migrations WHERE filename IN ('009_add_fever_source_geography.sql','010_add_active_occurrence_lookup_index.sql') ORDER BY filename;"
grep -E '^FEVER_IMAGES_ENABLED=true$' .env
command -v npm
npm run fever:import:scheduled
```

La salida final debe ser un único JSON estructurado sin secretos, con catálogo Catalunya, elegibles/publicables, geografía, outcomes, occurrences, metadatos de imágenes, guard de retiradas, `importRun`, integridad y tiempos. Con un feed efectivamente sin cambios se esperan cero duplicados y mayoritariamente outcomes `unchanged`, aunque los cambios reales upstream se reconcilian normalmente.

Mientras el backend sigue disponible, validar:

```bash
sqlite3 -readonly "$DB" 'PRAGMA integrity_check;'
sqlite3 -readonly "$DB" "SELECT key, enabled FROM sources WHERE key='fever';"
sqlite3 -readonly "$DB" "SELECT id,status,started_at,finished_at,error_message,summary_json FROM import_runs WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id DESC LIMIT 5;"
sqlite3 -readonly "$DB" "SELECT COUNT(*) AS fever_plan_sources FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever';"
sqlite3 -readonly "$DB" "SELECT status,COUNT(*) FROM plan_occurrences o JOIN plan_sources ps ON ps.id=o.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever' GROUP BY status;"
sqlite3 -readonly "$DB" "SELECT resolution_status,COUNT(*) FROM plan_source_geography g JOIN plan_sources ps ON ps.id=g.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever' GROUP BY resolution_status;"
sqlite3 -readonly "$DB" "SELECT COUNT(*) AS fever_images FROM plan_source_images psi JOIN plan_sources ps ON ps.id=psi.plan_source_id JOIN sources s ON s.id=ps.source_id WHERE s.key='fever';"
```

Exigir último run `completed`, integridad `ok`, source `fever | 1`, ausencia de duplicados y conteos coherentes. Repetir las comprobaciones públicas ya validadas: listados por fecha, ficha Fever, proxy de imágenes y CTA afiliada.

Antes de instalar cron, comprobar también que el usuario de cron puede crear/escribir `/var/log/quefem-fever.log` y que la configuración efectiva de logrotate cubre esa ruta. No crear ni editar logrotate desde este repositorio.

## Cron propuesto

Una vez validada esa segunda importación, usar la ruta absoluta que devuelva `command -v npm`. El ejemplo siguiente separa Fever del clúster escritor de horas pares (Gencat :17, Ticketmaster :37 e imágenes :52):

```cron
5 1,7,13,19 * * * cd /var/www/queFem && /ruta/absoluta/a/npm run fever:import:scheduled >> /var/log/quefem-fever.log 2>&1
```

Inspección:

```bash
tail -n 100 /var/log/quefem-fever.log
grep 'fever-import-scheduled' /var/log/quefem-fever.log | tail -n 20
```

Para detener temporalmente la programación sin ocultar Fever públicamente, comentar o retirar únicamente esa línea del crontab y esperar a que no exista el lock. No modificar `sources.enabled`, `FEVER_IMAGES_ENABLED` ni las imágenes para pausar el scheduler.

## Intervención y recuperación

Detener nuevas ejecuciones programadas e investigar si ocurre cualquiera de estas situaciones:

- último `import_run` `failed` o `running`;
- integridad distinta de `ok`;
- source Fever ausente o distinta de `enabled=1`;
- migrations ausentes;
- guard de baseline o retirada rechazado;
- skips de concurrencia repetidos o lock persistente;
- resultados públicos, imágenes o atribución inesperados.

Un fallo antes de crear el run no escribe. Un fallo dentro de la transacción revierte los cambios del catálogo y deja un run `failed`. Ante fallo post-import de integridad o estado incierto, detener el cron, impedir writers concurrentes y seguir el procedimiento externo de restore desde el backup verificado; no mezclar WAL/SHM de épocas distintas. No se define un comando de restore porque el mecanismo de backup es externo al repositorio.
