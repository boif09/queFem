# Índice de documentación

Ruta recomendada para una tarea: [`../AGENTS.md`](../AGENTS.md) → documento de esta lista → código relevante.

## Fuentes de verdad activas

- [`PROJECT_STATUS.md`](PROJECT_STATUS.md): estado actual y roadmap operativo NOW/NEXT/LATER/BLOCKED; fuente principal para saber qué hacer a continuación.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): componentes implementados, flujo de datos, API, SQLite, jobs y despliegue a alto nivel.
- [`../README.md`](../README.md): instalación, desarrollo local y comandos reales.
- [`DATA_SOURCES.md`](DATA_SOURCES.md): fuentes implementadas/evaluadas, licencias y políticas específicas.
- [`DECISIONS.md`](DECISIONS.md): decisiones transversales confirmadas que deben preservarse.
- [`DEPLOYMENT.md`](DEPLOYMENT.md): infraestructura y procedimientos de producción. Describe estado externo al repositorio y requiere verificación operativa antes de actuar.

## Referencias especializadas

- [`DISCOVERY_FILTERS_V2.md`](DISCOVERY_FILTERS_V2.md): comportamiento implementado de búsqueda, fechas, territorio, categorías y decisión basada en datos sobre filtros no publicados.
- [`TICKETMASTER_REMOVAL.md`](TICKETMASTER_REMOVAL.md): retirada, dry-run, backup y purga de una procedencia Ticketmaster.
- [`FEVER_NORMALIZATION.md`](FEVER_NORMALIZATION.md): contrato M3 de normalización Fever, parser de `Manufacturer`, zona horaria y dry-run sin persistencia.
- [`ANALYTICS.md`](ANALYTICS.md): eventos Umami propios para clics de afiliación.
- [`DIBA_M0_DISCOVERY.md`](DIBA_M0_DISCOVERY.md): análisis read-only de viabilidad y solapamiento de DIBA.
- [`DIBA_INTEGRATION.md`](DIBA_INTEGRATION.md): contrato M1 de importación selectiva, seguridad y activación futura de DIBA.
- [`ICGC_GEOGRAPHY.md`](ICGC_GEOGRAPHY.md): snapshot oficial ICGC, contrato del resolver territorial y dry-run geográfico Fever M4A.
- [`FEVER_PERSISTENCE.md`](FEVER_PERSISTENCE.md): arquitectura M4B, reconciliación y barrera obligatoria de SQLite temporal.
- [`FEVER_M5B_REHEARSAL.md`](FEVER_M5B_REHEARSAL.md): benchmark occurrence-aware, EXPLAIN, rehearsal temporal y runbook futuro; Fever sigue disabled.
- [`FEVER_M5C_PRODUCTION_RUNBOOK.md`](FEVER_M5C_PRODUCTION_RUNBOOK.md): gates y procedimiento manual futuro para la primera importación Fever disabled.
- [`IMAGE_CREDITS.md`](IMAGE_CREDITS.md): procedencia y licencia de assets visuales.
- [`FALLBACK_IMAGES.md`](FALLBACK_IMAGES.md): librería genérica permanente, prioridad de fuentes,
  manifiesto Pexels, preparación local y reglas de accesibilidad/SEO.
- [`SPECIFICATION.md`](SPECIFICATION.md): especificación técnica inicial y visión de producto. Contiene alcance histórico/futuro; no usarla para inferir que algo ya está implementado.

## Material histórico

- [`design/stitch/DESIGN.md`](design/stitch/DESIGN.md) y el resto de `design/stitch/`: referencia de una propuesta visual anterior. No representa por sí sola el sistema visual vigente; el frontend implementado es la referencia actual.

No existe un significado documentado para prioridades `P1`, `P2`, etc. El roadmap operativo vigente usa NOW/NEXT/LATER/BLOCKED; cualquier P1/P2 que aparezca en material histórico no debe usarse como criterio actual.
