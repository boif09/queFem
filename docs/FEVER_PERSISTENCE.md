# Fever M4B: persistencia temporal

M4B demuestra la persistencia Fever exclusivamente en SQLite temporal. No activa producción, cron, frontend, imágenes ni deduplicación entre fuentes.

## Modelo

La source lógica de laboratorio es `fever`, permanece `enabled=0` para no aparecer en ninguna consulta pública, y `plan_sources.source_record_id` contiene `CatalogItemId`. Toda consulta pública exige que el plan conserve al menos una source habilitada. La futura activación es un cambio explícito de feature flag (`sources.enabled=1`) en un milestone autorizado; no requiere reimportar. Cada producto nuevo crea un plan independiente con fingerprint técnico `fever|CatalogItemId`; nunca pasa por el matcher Gencat/Ticketmaster. La affiliate URL `https://fever.pxf.io/...` se conserva literalmente en `plan_sources.source_url`.

`plan_source_geography` es 1:1 con `plan_sources` y conserva coordenadas Fever, estado `resolved|unresolved|ambiguous`, códigos/nombres ICGC, proveedor, dataset, fecha, capa, checksum y `location_basis=event_coordinates`. `ON DELETE CASCADE` elimina geography al retirar la source. En M4B solo se persisten `resolved` y `unresolved`; un ambiguous se omite o retira. Unresolved conserva coordenadas, `Material` y `ShippingLabel`, pero deja municipio, comarca y provincia canónicos a NULL. No se usa `Text2`, meeting point, nearest ni geocoding.

Los planes Fever-only se actualizan con Name, Description limpia, Material, ShippingLabel, Pattern, nombres ICGC y el intervalo resumen de sus occurrences publicables. No se asignan categorías editoriales ni imágenes. Un plan compartido excepcional conserva su composición canónica y se reporta; M4B no implementa composer.

## Occurrences y reconciliación

Solo se desean sesiones entre hoy y `FEVER_LOOKAHEAD_DAYS`, ambos inclusive. `PlanOccurrenceRepository.reconcile()` inserta, actualiza, reactiva y marca inactive las sesiones que salen del conjunto mientras el producto siga importable. Un producto sin sesiones publicables, ausente, Gift Card, inválido o ambiguous retira su source; un plan sin otras sources queda inactive. Si reaparece, se recupera el plan huérfano mediante su fingerprint Fever exacto.

Las ausencias solo se reconcilian después de descargar, normalizar y resolver el feed completo. Errores Impact/paginación ocurren antes de abrir la SQLite destino. El comando puede haber creado o migrado el clon temporal antes de un fallo de preparación, pero no habrá escrito productos Fever. Cualquier error de escritura revierte la transacción completa. Un baseline completado corrupto aborta explícitamente. Hay dos guards previos a escrituras de producto: el volumen Catalunya respecto del último run completado y el conjunto deseado respecto de los `CatalogItemId` Fever ya persistidos; ambos rechazan una caída superior al 50%. `--allow-mass-removal` es el override manual explícito para ambos.

Una segunda importación funcionalmente idéntica no actualiza `plans`, `plan_source_geography` ni `plan_occurrences`. Solo se permite avanzar `plan_sources.last_seen_at`; una occurrence sin cambios no recibe heartbeat. Los contadores `inserted`, `updated` y `unchanged` integran cambios canónicos, source, geography y occurrences, mientras `writes` expone las escrituras físicas por tabla.

## Payload y trazabilidad

El payload guarda los campos de producto requeridos, `Colors[0]`, Manufacturer completo y un resumen con conteos y SHA-256. Aunque las sesiones también están estructuradas en `plan_occurrences`, el rehearsal midió aproximadamente 1,27 MB de Manufacturer raw para 555 productos: se conserva porque el coste es pequeño frente a la trazabilidad que aporta.

## Barrera temporal

```bash
npm run fever:import:temp -- --database <ruta-temporal.sqlite> --clone-real
npm run fever:import:temp -- --database <misma-ruta-temporal.sqlite>
```

La ruta temporal es obligatoria y se compara con `DATABASE_PATH` tanto por identidad de ruta resuelta como por identidad física (`dev`/`ino`) cuando ambos ficheros existen; esto cubre rutas relativas, enlaces simbólicos y hard links. La comprobación ocurre antes de abrir en modo writable, hacer backup o migrar. `--clone-real` usa la API SQLite backup desde una conexión read-only y rechaza sobrescribir un destino. Migraciones y escrituras se aplican solo al clon. No usar este comando como job de producción.

Deuda posterior: revisión legal/operativa final, política de meeting points, dedupe/compositor multi-source, categorías, precios, atribución pública, UI y activación explícita.
