# DIBA M1 — importación selectiva de Diputació de Barcelona

## Alcance y atribución

M1 integra exclusivamente los datasets oficiales HTTPS `actesturisme_ca`, `escenari` y `actesmuseus` de Dades obertes de la Diputació de Barcelona. Cada procedencia se atribuye como **Diputació de Barcelona — Dades obertes**.

Quedan fuera de M1 `actesbiblioteques_ca` (volumen y encaje editorial insuficiente), `agendageneral_ca`, `exposicions`, `actesparcs`, agregaciones genéricas y cualquier otro dataset DIBA.

## Arquitectura e identidad

Hay tres fuentes operativas desactivadas por defecto: `diba-tourisme`, `diba-escenari` y `diba-museus`. Comparten editor y atribución, pero tienen una fila `sources`, `import_runs` y reconciliación separados. Es más seguro que una fuente única: una respuesta vacía o fallida de museos nunca puede retirar turismo ni Escenari. No se usa borrado por prefijos.

La identidad persistente es `source key + acte_id`; el fingerprint de un plan nuevo es `diba|dataset|acte_id`. Un mismo `acte_id` en dos datasets no colisiona.

## API, fechas y ocurrencias

El cliente oficial pagina explícitamente, comprueba total estable, rechaza páginas truncadas y `acte_id` duplicados, y aplica timeout/reintentos limitados. El procesamiento es secuencial.

Solo se acepta un intervalo real que solape `hoy..hoy+365`: `end_date >= today && start_date <= horizon_end`. Se preservan inicio, fin y texto de horario. Fechas inválidas, fin ausente y rangos invertidos se descartan. No se generan ocurrencias: horarios de apertura y rangos DIBA no son sesiones verificadas ni días artificiales.

## Geografía, contenido y categorías

`rel_municipis.ine` se resuelve directamente por código: el índice ICGC relaciona su prefijo INE oficial único de cinco dígitos con el `CODIMUNI` de seis dígitos. No hay geocoding, coincidencia por nombre ni ciudad más cercana. Una relación no presente o no unívoca en ICGC queda sin municipio y se cuenta en el resumen. Las coordenadas válidas de `grup_adreca.localitzacio` se conservan como coordenadas de la dirección del evento; un plan compartido solo rellena campos vacíos y no degrada una localización existente.

El contenido se conserva en catalán y la descripción pasa por el limpiador HTML existente. Las categorías son deterministas y solo usan la taxonomía actual: Museus→`museus`, Escenari→`musica` para conciertos/música o `espectacles`, y Turisme aplica solo señales claras de gastronomía, senderismo/natura, ferias, fiestas o patrimonio; el resto es `cultura`. El resumen incluye el recuento por categoría.

## Imágenes, URLs y deduplicación

Las URLs de imagen DIBA quedan solo dentro del payload de procedencia para auditoría. No se descargan, no se crean `plan_source_images`, no se copian a `plans.image_url` y no entran en JSON-LD. Un plan solo-DIBA recibe la librería genérica existente; un plan compartido conserva su imagen oficial aprobada.

Las URLs DIBA son informativas (`website_url` para un plan nuevo), no afiliación ni `ticket_url`. Los enlaces Fever/Ticketmaster existentes no se sobreescriben.

El matcher compartido añade una ruta DIBA consciente de intervalos. Confirma solo título normalizado, municipio y solapamiento temporal junto con sede, dirección, coordenadas cercanas o URL común. Coincidencias sin ese apoyo quedan ambiguas y no se fusionan. La misma regla permite adjuntar duplicados de turismo/museos sin perder la segunda procedencia.

## Reconciliación y operación

Cada feed valida una snapshot no vacía y al menos un candidato válido antes de escribir. La salud del parser se calcula solo sobre la snapshot actual: proporciones de `acte_id` válido, semántica de fecha válida y semántica requerida del subconjunto accionable. Este subconjunto incluye los intervalos que solapan el horizonte y también cualquier `acte_id` con fechas dañadas que corresponda a una procedencia actualmente reconciliable. Por tanto, un título ausente o inválido en actividad actual/futura o una fecha ilegible de un registro reconciliable reduce la proporción accionable aunque el feed contenga miles de registros históricos sanos; no se compara el volumen elegible con una ejecución anterior. El conjunto deseado, el denominador del guard y la reconciliación usan exactamente los `plan_sources` del feed dentro del horizonte actual. Retirar exactamente el 50 % está permitido; más del 50 % se rechaza salvo con el override explícito por ejecución `--allow-mass-removal`, que queda registrado en el resumen y no evita las protecciones de adquisición, paginación, identidad, fechas ni parser. Cada feed se guarda transaccionalmente, hace `integrity_check` posterior y deja su `import_run` como completado o fallido; los otros datasets permanecen independientes.

Los `import_runs` se crean antes de adquirir el feed (excepto en dry-run). El resumen registra `catalogCommitted`: un fallo previo a commit conserva contadores comprometidos a cero; un fallo posterior mantiene los contadores reales y deja claro que el catálogo sí cambió.

El dry-run usa una superposición virtual en memoria, nunca SQLite, que replica los límites de transacción reales: todos los registros de Turismo se comparan contra SQLite y los feeds DIBA ya simulados; solo al terminar Turismo se publica su commit virtual. Escenari y Museos siguen el mismo patrón. Un registro no ve otros registros pendientes del mismo feed. En una repetición, cada `source_record` ya existente simula el plan y la procedencia efectivos que dejaría `PlanRepository`: no crea una identidad virtual adicional y cada identidad estable mantiene una sola representación visible, cuyo estado más reciente sustituye tanto SQLite como cualquier overlay anterior para los feeds posteriores. El canónico de un plan público se mantiene inerte cuando DIBA sigue desactivada y el overlay conserva la procedencia DIBA añadida a un plan inicialmente existente.

Por ello distingue `rawRecords`, `eligibleSourceRecords`, `updatesOfExistingSameSourceRecord`, `linksToPreExistingPlans`, `linksToEarlierDibaPlans` y `uniqueNewPublicPlans`. En una primera importación, `eligible = linksToPreExistingPlans + linksToEarlierDibaPlans + uniqueNewPublicPlans`; en ejecuciones posteriores se añade `updatesOfExistingSameSourceRecord`. Los ambiguos son diagnósticos ortogonales y no entran en la disposición primaria.

`sameFeedPotentialDuplicateClusters` identifica pares del mismo dataset que cumplirían la evidencia de match si uno ya fuese un plan. Son siempre `NEEDS REVIEW`: no alteran identidad, persistencia, reconciliación ni la disposición primaria.

Mientras una fuente DIBA permanezca desactivada, un match con un plan respaldado por una fuente habilitada es estrictamente de procedencia: no cambia campos canónicos, categorías, estado, ranking, imagen ni comercio. Al retirar esa procedencia se conserva el estado de un plan compartido; si no queda ninguna procedencia, el plan se inactiva para evitar huérfanos activos. Al habilitarla tras aprobación y ejecutar otra importación, la normalización ya puede enriquecer esos campos según las reglas ordinarias.

El dry-run incluye detalle de cada match ambiguo (ambos lados y evidencia faltante) y de cada municipio sin resolver (INE, nombre bruto, coordenadas y motivo); no los persiste en SQLite ni infiere municipios por coordenadas.

```powershell
# No escribe SQLite; consulta DIBA en vivo y requiere una base local existente.
npm run diba:import -- --dry-run

# Tras revisar el dry-run y aplicar migraciones, importación local explícita.
npm run db:init
npm run diba:import

# Solo tras revisar expresamente una retirada de más del 50 %.
npm run diba:import -- --allow-mass-removal
```

Las fuentes siguen `enabled=0`. La activación futura exige revisión, dry-run local, importación local auditada, backup y dry-run de producción, seguidos de aprobación explícita. M1 no instala cron, no despliega ni activa fuentes públicas.

## Auditoría preactivación M1.4A

La comprobación local `npm run diba:quality:audit` abre la base SQLite con la opción de solo lectura, no consulta la API de DIBA y no usa el importador ni el dry-run. Genera `data/reports/diba-quality-audit.md` y `data/reports/diba-quality-audit.json`, con clústeres de posibles duplicados dentro de cada feed, reconciliación de ambigüedades de la primera importación, riesgo frente a planes de fuentes actualmente habilitadas y una clasificación analítica de municipios de Turismo sin INE mediante el snapshot local ICGC.

M1.4A.1 separa los pares que el matcher actual confirmaría de los pares posibles que el matcher conserva como ambiguos; ambos son inventario de revisión, no instrucciones de fusión. Las cardinalidades distinguen pares, planes y componentes de conflicto bipartitos. La evidencia URL equivalente al matcher usa solo el `source_url` DIBA persistido; las URLs secundarias del payload son diagnósticas. Los clústeres muestran topología y evidencia de horario, y un candidato con procedencia habilitada pero plan inactivo se mantiene como diagnóstico sin declararlo una tarjeta pública garantizada.

El informe no persiste decisiones, no fusiona planes y no resuelve municipios automáticamente. Su resultado es una entrada para diseñar y aprobar una política posterior; no habilita las fuentes DIBA.

## Limitaciones conocidas

No se modelan recurrencias o sesiones mientras DIBA no publique fechas de sesión fiables. No se reutilizan imágenes DIBA y las relaciones municipales no resueltas quedan en procedencia, sin asignación territorial especulativa.
