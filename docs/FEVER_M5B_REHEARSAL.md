# Fever M5B: rendimiento y rehearsal operativo

Fecha del rehearsal: 2026-08-26. Todo se ejecutó exclusivamente contra `.tmp/m5b-fever-rehearsal.sqlite`, creado desde la SQLite configurada mediante `better-sqlite3` backup en modo read-only. No se ejecutó ninguna migración, importación ni escritura sobre la SQLite real.

## Dataset y seguridad

El import actual de Impact produjo 601 registros Catalunya, 565 elegibles y 550 publicables: 547 `resolved`, 3 `unresolved`, 0 `ambiguous`, 0 afiliados inválidos. Persistió 550 planes/sources Fever y 68.765 occurrences activas. La integridad fue `ok` antes y después.

El clon inició con 2.030 planes, 2 fuentes enabled y 0 occurrences; Gencat tenía 1.959 planes/2.056 sources y Ticketmaster 71/71. Tras el import y la migración M5B: 2.580 planes, 3 sources (2 enabled con Fever apagado) y 68.765 occurrences. El fichero pasó de 17.416.192 B a 43.331.584 B tras `VACUUM` del clon (+25.915.392 B). El pico WAL observado durante el import fue 25.267.992 B.

El comando de import temporal conserva las protecciones M4B: compara ruta real, `realpath` e identidad física; el origen se abre readonly y se clona mediante SQLite backup. No se usa `cp` de SQLite.

La comprobación SHA-256 antes/después de la SQLite real y sus sidecars fue idéntica: `quefem.sqlite` (17.338.368 B), `quefem.sqlite-wal` (4.120.032 B) y `quefem.sqlite-shm` (32.768 B). El clon temporal y sus sidecars se eliminaron al cerrar el rehearsal.

## Benchmark reproducible

`backend/src/jobs/benchmarkFeverM5b.js` rechaza la `DATABASE_PATH` configurada y acepta solo una ruta temporal. Cada caso usa una warm-up y cinco muestras con paginación real (`limit=20`); las cifras son ms de repositorio, incluyendo count, query, attachments y modelado de respuesta, no latencia HTTP. La fecha fija del rehearsal es 2026-08-26; la mediana es el valor de comparación y p95 es aproximado por el tamaño muestral.

| Caso (resultados) | Baseline mediana | Después mediana | Después p95 |
| --- | ---: | ---: | ---: |
| listado general (2.464) | 330,8 | 187,4 | 351,1 |
| today (1.326) | 1.870,8 | 200,8 | 209,8 |
| tomorrow (1.366) | 2.160,2 | 219,5 | 222,7 |
| weekend (618) | 313,7 | 172,7 | 211,3 |
| upcoming (1.320) | 338,6 | 192,7 | 219,6 |
| municipality Barcelona (1.047) | 292,5 | 111,4 | 118,0 |
| comarca Barcelonès (1.035) | 331,9 | 102,6 | 136,5 |
| category musica (752) | 41,1 | 47,7 | 58,0 |
| detail recurrente | 2,8 | 1,6 | 3,1 |
| detail legacy | 1,0 | 1,1 | 1,6 |

La variante de índice `(status, local_date, plan_source_id, local_time)` se descartó: el planificador la elegía para subqueries correlacionadas y el listado general excedió 30 s. El candidato útil `(plan_source_id, status, local_date, local_time)` redujo general a 230,0 ms y upcoming a 200,8 ms, a cambio de 2.400.256 B en el clon. Se conservó como migración `010_add_active_occurrence_lookup_index.sql`.

La mejora final añade dos simplificaciones semánticamente equivalentes:

- `nextOccurrence` se obtiene una sola vez por fila, en vez de ejecutar separadamente las subqueries de fecha y hora.
- En filtros de día exacto, las occurrences activas habilitadas se resuelven una vez con `IN (SELECT ...)`, usando `idx_plan_occurrences_date_source`; se preserva el fallback legacy únicamente si no existe historial de occurrences habilitado.

## EXPLAIN QUERY PLAN

General, upcoming y weekend comienzan con `SEARCH p USING INDEX idx_plans_status_quality`. Las subqueries de visibilidad usan `idx_plan_sources_plan` y la PK de `sources`. Las occurrences activas correlacionadas usan el nuevo índice covering `idx_plan_occurrences_source_status_date_time`; el historial sin filtro de estado conserva `idx_plan_occurrences_source_date`.

Today/Tomorrow añaden una única `LIST SUBQUERY` que hace `SEARCH occurrence_o USING INDEX idx_plan_occurrences_date_source (local_date=?)`, seguida de PK lookups de `plan_sources` y `sources` y Bloom filter. No hay scan de `plan_occurrences` en los casos auditados. Sigue habiendo subqueries correlacionadas necesarias para visibilidad, retención y el contrato M2; no se introdujeron cache, tabla materializada ni jobs.

## Contrato M2 y regresiones

La suite cubre y conserva: fallback legacy solo sin history; history inactive sin resucitar intervalo legacy; fuente disabled excluida de listados, orden, occurrences, retención, coherencia temporal y detail shared; combinaciones multi-source; sesiones date-only; JSON-LD y sitemap. El filtro exact-day usa la misma regla enabled-only. Las purgas y reconciliación internas conservan la semántica M2 de todas las sources.

## Rehearsal de publicación, reversible

Después del import, con `sources.fever.enabled=0`, el sample Fever no era visible en detail, date, municipio, comarca, provincia, categoría ni sitemap; Fever no aparecía en `/api/sources`. Por tanto tampoco existe CTA público ni occurrence Fever que altere un plan visible. Los datos siguen disponibles internamente.

Solo en el clon se cambió `enabled=1`: Fever fue visible en list/detail, día de occurrence, municipality/comarca/province, categoría y sitemap; la source quedó expuesta. Al devolver `enabled=0`, todas esas comprobaciones volvieron a `false`, con integridad `ok`. Los tres casos marítimos permanecen `unresolved`, como exige M4B.

`FEVER_IMAGES_ENABLED` es un gate distinto de `sources.fever.enabled`. La prueba controlada cubre: flag false devuelve 404; flag true hace un fetch permitido al host Fever persistido, devuelve MISS y después HIT; un image id inexistente devuelve 404/fallback. No se descargaron imágenes reales masivamente ni se habilitó el flag de entorno.

## Datos de catálogo del rehearsal

- Precio: FREE 0, FIXED 261, FROM 167, UNKNOWN 122.
- Categorías: 407 mapped, 143 unmapped. El principal `SubCategory` unmapped es vacío (91); los siguientes son combinaciones de Beauty & Wellness/Other Experiences (5 y 5).
- La prueba de lifecycle, reaparición, shared plan, affiliate inválida y guards de retirada permanece cubierta por `feverPersistence.test.js`. Los guards abortan si Catalunya estable o el conjunto desired caen más de 50%; `--allow-mass-removal` sigue siendo un override explícito y no se utilizó.

## Runbook para una futura primera importación real

M5B no ejecuta este runbook ni habilita un comando de escritura real: el único importador Fever disponible deliberadamente rechaza la SQLite configurada. Antes de autorizar M5C/operación, un operador debe completar y revisar el procedimiento real en el servidor.

Pre-flight:

1. Registrar commit/version, estado efectivo de PM2, disk space (`df -h`), configuración efectiva y la última copia externa, sin imprimir secretos.
2. Antes de migration 009, comprobar si la source `fever` existe; no asumirlo. Tras aplicar migration 009, confirmar que existe con `enabled=0`, y confirmar `FEVER_IMAGES_ENABLED=false`.
3. Crear y verificar un backup SQLite consistente mediante el procedimiento de producción; nunca copiar el main DB con WAL activo. Verificar `integrity_check`, hash/tamaño de DB/WAL/SHM y restaurabilidad en ruta temporal.
4. Confirmar espacio para al menos el tamaño actual de DB + crecimiento Fever (~26 MB en el rehearsal) + WAL pico (~25 MB) + margen operativo; la caché de imágenes es independiente y permanece apagada.

Import autorizado futuro:

1. Ejecutar la migración versionada solo tras el backup y registrar salida/log.
2. Ejecutar el importador de producción que sea aprobado para M5C, sin activar Fever ni imágenes; registrar counts, guard de feed, tamaño y WAL.
3. Ejecutar `integrity_check`; abortar ante cualquier error, anomaly de feed, caída de guard, crecimiento inesperado, degradación severa o visibilidad pública inesperada.
4. Con Fever aún disabled, validar counts internos, API/sitemap/source smoke de Gencat y Ticketmaster, y confirmar cero exposición Fever.

Rollback autorizado futuro:

1. Si la app mantiene el fichero abierto, detenerla de forma controlada.
2. Restaurar el backup SQLite consistente como conjunto correcto de main/WAL/SHM según el método de backup; no mezclar sidecars de épocas distintas.
3. Arrancar de nuevo, ejecutar `integrity_check`, comprobar hash/tamaño esperado y smoke test API. Conservar logs y no reintentar import hasta diagnosticar la causa.

## Gates pendientes y recomendación

Fever queda **publication-ready / operationally rehearsed, pero disabled**. La recomendación es **GO FOR PRODUCTION PREPARATION**, no GO para publicar: falta aprobación explícita del importador operativo, pre-flight real de VPS/backups/espacio y la decisión de activación. `FEVER_IMAGES_ENABLED=true` requiere además confirmación documental de derechos/condiciones; no depende de publicar planes.

Para M5C se recomienda una sincronización cada 6 h inicialmente: el feed tiene ~550 productos, las sesiones cambian pero no justifican 2 h sin observación de frescura, y Ticketmaster ya mantiene su ciclo propio. Revisar duración, guards y cambios reales durante una ventana de observación antes de pasar a 4 h; diario sería demasiado lento para sesiones/affiliate.
