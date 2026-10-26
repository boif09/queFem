# Tens Pla? — Estado del proyecto

Última revisión documental: 2026-10-14.

Esta es la fuente principal para responder «¿Dónde está Tens Pla? ahora mismo y qué toca hacer?». La arquitectura está en [`ARCHITECTURE.md`](ARCHITECTURE.md), las fuentes en [`DATA_SOURCES.md`](DATA_SOURCES.md) y la operación en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Current production state

- **Tens Pla?** está publicada y funcionando en `https://tenspla.cat`; `www.tenspla.cat` y el host legacy redirigen al dominio principal.
- Nginx sirve el frontend React/Vite y hace proxy a la API Express de solo lectura; PM2 gestiona `quefem-api` y SQLite es la persistencia.
- Gencat se sincroniza cada dos horas mediante cron externo y el enriquecimiento histórico gradual está
  activo. Búsqueda, filtros, fichas bilingües, planes permanentes, deduplicación multi-source y purgas están
  implementados.
- La infraestructura y la migración del resolvedor fail-closed de imágenes Gencat ya están desplegadas,
  los canarios reales de producción terminaron correctamente y el ajuste final de elegibilidad en tarjeta
  está desplegado. La reimportación normal enriquece como máximo 100 históricos por ejecución, prioriza sin
  presupuesto imágenes nuevas o cambiadas, reintenta metadata desconocida tras 24 h y mantiene el lock
  durable contra solapamientos. Toda imagen Gencat con atribución conocida es elegible en tarjeta y detalle;
  la tarjeta omite el `Peu d'imatge` y el detalle conserva el texto exacto completo cuando existe. Las
  atribuciones desconocidas permanecen cerradas con fallback.
- Las producciones recurrentes de Gencat están consolidadas: 10 grupos con decisión humana `ACCEPT`
  (`data-policy/recurring-production-decisions.json`) se fusionaron en un plan canónico cada uno, con 47
  aliases en `plan_aliases` que redirigen con HTTP 301 y el mapeo `recurring_production_applied_groups`
  que hace que las importaciones normales de Gencat se adjunten al canónico en vez de recrear planes. El
  importador mantiene las occurrences de esos grupos (incluidas las de varios recintos y los cambios de
  fecha). La reconciliación de occurrences obsoletas corre en **modo shadow** tras cada importación
  (`[recurring-shadow]` en el log): detecta y registra, pero no retira nada. No queda ningún grupo
  `SAFE_AUTOMATIC` pendiente; los `REVIEW_REQUIRED` y los de DIBA no se han consolidado.
- El SEO público está desplegado: metadata por ruta, canonical, Open Graph/Twitter, Event JSON-LD conservador, `robots.txt` y sitemap público. Google Search Console ya está verificado.
- Hay backups automáticos y probados de SQLite, con comprobaciones y copia externa mediante `rclone` al destino de Google Drive `TensPla/backups`.
- La rotación de logs de Nginx está configurada y verificada.
- Gencat, Ticketmaster, Fever y las tres fuentes DIBA están activos en producción. `diba-tourisme`, `diba-escenari` y `diba-museus` tienen `enabled=1` y `allows_images=0`; su importación inicial, revisión humana, reconciliación y activación M1 están completadas. Fever tiene source habilitada, imágenes same-origin activadas y cron propio (`fever:import:scheduled`, a las 01:05, 07:05, 13:05 y 19:05) cuyas ejecuciones terminan `completed`.
- Los crons de producción confirmados el 2026-10-14 son: Gencat `:17` cada 2 h, Ticketmaster `:37` cada 2 h y sus imágenes `:52`, Fever cada 6 h, DIBA diario 05:45, `purge:inactive` diario 03:45 y backup 05:10. La purga automática de planes inactivos ya está activa. Desde el 2026-10-21 hay además la conservación de Umami (`umami-retention.sh --apply`, día 1 de cada mes a las 04:20).
- **La importación programada de DIBA falla desde al menos el 2026-09-30** (guard fail-closed sobre duplicados dudosos) en `diba-tourisme` y `diba-escenari`; `diba-museus` importa con normalidad. Corregido el 2026-10-14 con la política de cola de revisión. Ver «DIBA REVIEW QUEUE».

La infraestructura de producción es parcialmente externa a Git. «Confirmado» describe el estado conocido a fecha de esta revisión, no sustituye la comprobación previa a una operación.

## Recently completed

- Textos legales y privacidad de Umami (2026-10-21, **desplegado ese día**, commit `602c557`, con la
  conservación de 24 meses programada y los `fbclid` guardados borrados; ver [`DEPLOYMENT.md`](DEPLOYMENT.md)): el aviso legal ya no dice que el
  proyecto no esté monetizado y explica los enlaces de afiliado de Fever/Impact; la política de privacidad
  describe Umami (comprobado en el servidor: 3.3.1, sin IP, país/región/ciudad, sin plazo de conservación),
  los enlaces de afiliado, la app de Android, la conservación de 24 meses y la oposición mediante «No
  rastrear»; la página de almacenamiento ya no dice que no haya analítica. Cambios de código: la atribución
  social vive solo en memoria (sin `sessionStorage`), Umami respeta «No rastrear» y ya no recibe `fbclid`,
  `gclid` y similares (`frontend/public/umami-before-send.js`). `scripts/umami-retention.sh` aplica los 24
  meses y vacía los identificadores de clic ya guardados; falta ejecutarlo y programarlo en producción
  ([`DEPLOYMENT.md`](DEPLOYMENT.md)). Sigue abierto el NIF y domicilio del aviso legal (LSSI art. 10).

- Favoritos y compartir (2026-10-21, **desplegado ese día**, commit `3f91fad`, sin cambios en Nginx;
  comprobado en producción: corazones, página `/preferits` y `/favoritos` en 200 y botón «Comparteix»): paso 2 del plan de app móvil. Corazón en
  cada tarjeta y en la ficha, página `/preferits` (alias `/favoritos`) con enlace en la cabecera (oculto en
  móvil) y en la barra inferior móvil, que pasa de 3 a 4 botones. Los favoritos se guardan solo en el
  dispositivo (`localStorage`, `quefem.favorites`, máximo 200), sin cuentas ni cambios en el backend; la
  página refresca cada plan desde la API y separa los que ya no están publicados. Botón «Comparteix» en
  la ficha (hoja nativa, copia del enlace o enlace para copiar a mano). Eventos Umami `favorite_add`,
  `favorite_remove` y `plan_share` ([`ANALYTICS.md`](ANALYTICS.md)); la página de almacenamiento explica
  la nueva clave en los tres idiomas.

- Web instalable como PWA (2026-10-21, **desplegada ese día**, commit `ed40509`, con la CSP de Nginx
  ampliada a `worker-src 'self'; manifest-src 'self'`): primer paso hacia la app Android (ver
  [`DECISIONS.md`](DECISIONS.md)). Manifiesto (`frontend/public/manifest.webmanifest`), iconos PNG en
  `frontend/public/icons/` (192, 512, 512 maskable y `apple-touch-icon` de 180, generados desde
  `favicon.svg`), `viewport-fit=cover` con márgenes de área segura en cabecera, laterales y barra inferior,
  y un service worker (`frontend/public/sw.js`) que solo se registra en el build de producción. El service
  worker muestra `offline.html` cuando falla una navegación y guarda los assets con hash de Vite y los
  iconos; **no guarda respuestas de `/api/`, imágenes de planes ni HTML**, y no toca `/embed/` ni
  `/sitemap.xml`. La página de almacenamiento explica la nueva caché en los tres idiomas. Requisitos de
  Nginx y cómo desactivarlo en [`DEPLOYMENT.md`](DEPLOYMENT.md#pwa-y-service-worker).

- Imágenes de Gencat muertas (2026-10-19): el plan 1074 salía sin foto porque Gencat registra una imagen que su servidor ya no sirve (404), y la web mostraba el dibujo de la categoría. La ruta `/api/media/gencat/:id` anota ahora un 404/410 definitivo del origen (migración 019: `plan_source_images.unavailable_at` y `unavailable_status`, para todas las filas con esa dirección); mientras la marca es reciente la API no ofrece esa imagen —el plan usa una foto genérica de la librería— y no se vuelve a pedir al origen, y a los 7 días se ofrece otra vez por si Gencat la repone. Timeouts, 5xx y redirecciones nunca se anotan; una dirección de imagen nueva borra la marca. `scripts/sweep-gencat-images.js` comprueba de golpe las direcciones de planes activos (simulación por defecto; `--apply` anota las muertas y limpia las recuperadas). **Desplegado el 2026-10-19 (commit `3b0dfd8`, migración 019) y barrido ejecutado en producción ese mismo día:** 1.460 direcciones comprobadas, 12 muertas (0,8 %) anotadas (24 filas, porque la tarjeta y el detalle comparten dirección), 0 dudosas, unos 100 s; afecta a 12 planes activos (11 con fecha futura). Nueve de ellos muestran ahora una foto genérica de la librería (entre ellos el plan 1074) y tres siguen con una foto oficial porque tienen otro registro de Gencat con una imagen que sí funciona. Una segunda simulación no encuentra nada nuevo. Ver [`DEPLOYMENT.md`](DEPLOYMENT.md).

- Página `/fonts` sin entradas repetidas (2026-10-16): las tres fuentes de Diputació de Barcelona (`diba-tourisme`, `diba-escenari`, `diba-museus`) son fuentes registradas distintas con el mismo nombre, y la página pintaba una tarjeta por fuente. Ahora agrupa las fuentes con el mismo nombre, organismo, licencia y atribución en una sola tarjeta que lista cada dataset con su enlace al original (y la fecha de revisión más reciente); las fuentes únicas se ven como antes. Solo cambia el frontend (`FontsPage.jsx`); la API sigue devolviendo una fila por fuente.

- Nombres oficiales de comarca y municipio (2026-10-16): el normalizador de Gencat restaura ahora la ortografía oficial del ICGC («Barcelones» → «Barcelonès», «Alcarras» → «Alcarràs», «Palau Solita» → «Palau-solità», «Pla D'Urgell» → «Pla d'Urgell») con `backend/src/location/placeNameRestorer.js`, sobre los nombres que ya usa el widget. Se muestra con inicial mayúscula («El Masnou») y solo hay un alias explícito (comarca Aran → Val d'Aran). No hay alias de municipio a propósito: cambiar las palabras de un municipio alteraría la huella de deduplicación de los planes, así que los pocos municipios que el ICGC renombró («Bigues i Riells», «Castell Platja d'Aro») conservan el nombre de Gencat. Un nombre sin coincidencia única se deja tal cual. Como el importador de Gencat no actualiza filas existentes, `scripts/restore-place-accents.js` corrige las ya guardadas . **Desplegado y aplicado en producción el 2026-10-16** (commit `bd2cf7e`, con backup previo): 1.406 planes corregidos (1.188 comarcas, 377 municipios, 121 correcciones distintas), una segunda simulación da 0 cambios, el desplegable queda en 41 comarcas con su ortografía oficial y las URLs antiguas (`?comarca=Barcelones`) devuelven lo mismo que las nuevas. Único efecto colateral conocido: `?comarca=Aran` ya no devuelve el plan que pasó a «Val d'Aran». Ver [`DEPLOYMENT.md`](DEPLOYMENT.md).

- Filtro de comarcas sin duplicados (2026-09-30): Gencat solo aporta un slug sin acentos
  («barcelones») y otras fuentes la forma correcta («Barcelonès»), de modo que el desplegable mostraba
  ambas. `findComarques` agrupa ahora por `normalize_location(comarca)` y `findMunicipalities` compara con
  la misma normalización, coherente con el filtro principal. La causa (la normalización de Gencat no
  restaura acentos) no se ha tocado; las filas siguen guardándose tal cual.

- Consolidación de producciones recurrentes de Gencat, fases 4C.3–4C.8 (2026-09-28/29): infraestructura
  de aliases 301 y script `scripts/consolidate-recurring-group.js` (dry-run por defecto, SQL de rollback y
  log JSON), consolidación en producción de 10 grupos (47 aliases; integridad y FK correctas), manejo de
  occurrences de varios recintos (Memòria 9→3, Espais 6→3), mantenimiento de occurrences y adjunción al
  canónico en la importación normal (4C.6B), y reconciliación shadow de occurrences obsoletas (4C.6D;
  `npm run recurring:reconcile:gencat` es solo `--dry-run`). Ver
  [`RECURRING_PRODUCTION_CONSOLIDATION_DESIGN.md`](RECURRING_PRODUCTION_CONSOLIDATION_DESIGN.md).

- Calidad de datos y diseño (2026-09-22/24): normalización segura de gratuito/de pago con backfill
  puntual de Gencat, cola en lugar de rechazo para ráfagas de descargas de imágenes remotas, rediseño
  editorial de home, descubrimiento y fichas, filtros en las landings temporales y atribución de sesión
  social en los eventos de embudo.

- Widget B2B, F2 desplegada en producción el 2026-09-30 (el ejemplo de Pals de `/widget` usa un
  radio de 15 km): territorio por radio en km para
  alojamientos (`territory.near`), informe mensual por cliente (`embed:widgets -- report`) y
  `?lang=ca|es` en tenspla.cat para que las fichas abiertas desde un widget respeten su idioma.

- Interfaz en inglés (F1, 2026-10-20, publicada: confirmado en producción el 2026-10-21; llegó con el
  despliegue del commit `c12e10b`): UI, textos legales (con nota de
  traducción informativa), página `/widget`, widget incrustable e informe mensual en inglés; selector
  CA/ES/EN y `?lang=en`. Los planes no se traducen (decisión en [`DECISIONS.md`](DECISIONS.md)); se
  avisa en el pie y en los resultados. SEO, rutas y metadatos del servidor siguen en catalán.

- Página pública `/widget` (CA/ES) publicada el 2026-09-30: explica el widget, muestra dos
  ejemplos reales (Bages y Pals) y remite a `contacte@tenspla.cat`; enlazada desde el pie y el
  sitemap. La CSP del sitio admite `frame-src 'self'`. Ver [`EMBED_WIDGET.md`](EMBED_WIDGET.md).

- Widget d'agenda incrustable B2B, F1 desplegada en producción el 2026-09-30 con la `location /embed/`
  de Nginx aplicada y verificada desde un origen autorizado y otro no autorizado: migración `017`
  (`sources.allows_syndication` solo para Gencat y DIBA, `embed_widgets`, `embed_widget_usage_daily`),
  rutas `/embed/v1/loader.js` y `/embed/v1/w/:key`, CSP por widget con `frame-ancestors`, contadores
  de uso agregados, nombres oficiales ICGC, CLI `embed:widgets` y tests. Validación previa (F0):
  cobertura suficiente a escala comarcal y de ciudad mediana, no de municipio pequeño; maqueta para
  pilotos Bages / Baix Empordà. Ver [`EMBED_WIDGET.md`](EMBED_WIDGET.md).

- Landings editoriales `/avui` y `/cap-de-setmana` publicadas (responden 200 en producción): reutilizan visibilidad, occurrences y ranking de `/api/plans`, calculan el calendario con `Europe/Madrid`, reciben HTML SEO inicial determinista y se incorporan al sitemap. Las locations Nginx documentadas en [`DEPLOYMENT.md`](DEPLOYMENT.md) deben comprobarse en el servidor si se toca esa configuración.

- DIBA M0 y M1/M1.1/M1.2/M1.3 completados localmente: integración selectiva de `actesturisme_ca`, `escenari` y `actesmuseus`, con procedencias operativas separadas `diba-tourisme`, `diba-escenari` y `diba-museus`. La primera importación local real terminó correctamente con fuentes desactivadas: 710 procedencias elegibles, 613 planes solo-DIBA, 74 planes públicos con procedencia DIBA añadida, 6 matches Turismo→Museos, 21 ambiguos, 28 municipios de Turismo sin resolver y cero retiradas. M1.3 hace fiel el overlay de repeat dry-run y protege la salud semántica del subconjunto accionable. No hay cron ni activación pública. Bibliotecas, agenda general, exposiciones, parques y agregaciones genéricas continúan excluidos.
- DIBA M1.4A/A.1 completado como auditoría local de solo lectura: el informe separa clústeres internos del mismo feed, ambigüedades históricas y riesgos actuales frente a planes públicos habilitados, incluyendo pares posibles del matcher, cardinalidad por componentes, estado de actividad y evidencia de horarios/URLs alineada al contrato de producción. No altera SQLite ni las reglas de importación. El estado local auditado mantiene riesgo de activación pública y requiere la política explícita de M1.4B; las fuentes DIBA permanecen `enabled=0`.
- DIBA M1.4B completado como diseño de política offline y versionado: define consolidación misma fuente, enlaces DIBA↔público por componente, sesiones, aliases municipales, propiedad canónica, reconciliación, overrides y gates de activación para M1.4C. No implementa ningún comportamiento productivo ni cambia la activación.
- DIBA M1.4C1.1 completado localmente como endurecimiento final del plan de mutaciones read-only: los overrides de enlace requieren revisión completa por componente y destino público candidato, la evidencia de sesión exige horario real (nunca solo duración) y el dry-run produce destinos finales por fases, no una lista ejecutable. La snapshot mantiene bloqueadores de activación y DIBA continúa desactivada; M1.4C2 requerirá aprobación separada para cualquier mutación.
- DIBA M1.4C2 completado como ensayo temporal: el ejecutor rechaza la SQLite real, exige una ruta explícita de copia y aplica el plan por fases en una única transacción, protegiendo los campos públicos y recalculando huérfanos. El ensayo completo pasó con relinks e idempotencia estructural; cualquier autorización separada para modificar la base local real sigue pendiente. DIBA permanece desactivada y sin imágenes.
- DIBA M1.4C3/D1-D4/E1-E4 y FINAL F1/F2 cerraron la reconciliación y revisión humana. Las decisiones CONFIRMED/POSSIBLE y las cinco decisiones finales permanecen versionadas; los planes `DEFER` siguen intencionalmente inactivos. La activación M1 posterior ya está completada en producción con las tres fuentes habilitadas y sus imágenes deshabilitadas.
- DIBA M2 prepara localmente la importación diaria fail-closed: analiza toda la topología cross-source y same-feed antes de mutar, respeta las decisiones humanas estables, impide que identidades desconocidas reactiven `DEFER`, revalida bajo `BEGIN IMMEDIATE` y comparte un lock entre imports reales manuales y programados. `diba:import:scheduled` no admite flags ni bypass de retirada masiva. Está desplegado y su cron diario (05:45) está instalado; hoy las importaciones de `diba-tourisme` y `diba-escenari` son rechazadas por el guard hasta revisar el backlog (ver «DIBA REVIEW QUEUE»).

- Generic Image Library V1 preparada: manifiesto curado y auditable de 100 fotografías Pexels,
  resolver determinista local por categoría/fingerprint, prioridad de imágenes oficiales controladas,
  adquisición manual puntual por API oficial y pipeline offline para WebP. Los binarios no acompañan
  el manifiesto y requieren adquisición
  manual antes de que la librería pueda mostrar fotografías en producción.

- Puesta en producción y consolidación del dominio y branding público **Tens Pla?**, incluido el logo y los recursos gráficos actuales.
- Integración Ticketmaster completa en local: importación real, idempotencia, reconciliación, retirada y entrega same-origin opcional de imágenes.
- SEO V1 desplegado y validado públicamente; sitemap publicado y propiedad de Google Search Console verificada.
- Sistema de backup de SQLite configurado, probado y automatizado, incluida copia externa con `rclone`.
- Logrotate ejecutado y verificado con rotación diaria, 14 rotaciones y compresión.
- Hardening del backend: escucha local segura por defecto y límites de paginación/consultas.
- Discovery & Filters V2: fechas rápidas y rango, filtros territoriales independientes, municipio buscable con contexto, categorías OR múltiples, aplicación inmediata, URL compartible, chips eliminables y estado vacío accionable. Véase [`DISCOVERY_FILTERS_V2.md`](DISCOVERY_FILTERS_V2.md).
- Home & Discovery V2 completado el 2026-08-21: home focalizada en accesos rápidos por fecha, bloques separados de planes temporales y permanentes con relevancia temporal editorial aplicada en backend antes de paginar, categorías contextualizadas y persistencia local explícita de la ubicación territorial seleccionada, con cobertura CA/ES y tests frontend/backend. Revisión independiente satisfactoria, sin bloqueos.
- Soporte genérico de ocurrencias discretas vinculado a procedencias: un plan con cualquier historial de occurrences es occurrence-aware y solo sus occurrences activas participan en visibilidad, filtros y orden; el fallback legacy se reserva a planes sin ninguna occurrence histórica. Admite sesiones date-only sin inventar hora. No incluye importación, composición temporal multi-source avanzada ni UI específica de sesiones.
- Fever M3 preparado sin persistencia: normalización de productos elegibles y parser determinista de sesiones `Manufacturer`, con semántica `Europe/Madrid`, horizonte inclusivo y dry-run real enteramente en memoria. No activa Fever ni escribe productos u occurrences en SQLite.
- Fever M4A preparado sin persistencia: resolución administrativa local por point-in-polygon sobre cartografía oficial ICGC 1:5.000, con códigos/nombres de municipio, comarca y provincia, updater explícito y dry-run read-only. No crea fuentes ni planes Fever y no modifica SQLite.
- Fever M4B/M5A/M5B prepararon persistencia por `CatalogItemId`, geography source-specific, occurrences, idempotencia, guards, categorías, precio, CTA e imágenes; su validación local antecedió la primera importación real.
- M5C aportó el entrypoint manual protegido para la primera importación. Fever está ahora live, con source e imágenes habilitadas, y la primera importación terminó con integridad correcta.
- Automatización recurrente de Fever en producción: `fever:import:scheduled` (preflight de migrations/source/integridad, lock compartido con el modo manual, guards sin bypass, imágenes Fever soportadas) corre por cron cada 6 horas.

## NEXT DIBA STEP

### DIBA REVIEW QUEUE

M1 y M2 están en producción (`allows_images=0`, cron diario 05:45). Desde al menos el 2026-09-30 el guard bloqueaba por completo `diba-tourisme` y `diba-escenari` mientras hubiera duplicados dudosos sin revisar (5 + 38 casos el 2026-10-14). Decisión del propietario: un duplicado visible es preferible a una importación parada.

**Desplegado el 2026-10-14 (commit `863248d`):** la importación real de DIBA usa ahora la política `review-queue` (`ambiguityPolicy` en `DibaImporter`; el valor por defecto del importador sigue siendo `block`). Los posibles duplicados con un plan público y dentro del mismo feed, y las decisiones humanas cuyo destino ya no existe, dejan de bloquear: el registro se importa como plan separado y se anota en `data/diba-review-queue.json` (junto a SQLite, escritura atómica, sin tocar la base). Se siguen bloqueando los fallos graves: retirada masiva, feed vacío o truncado, salud del parser y conflictos con una decisión humana vigente. Primera pasada manual en producción (2026-10-14, con backup previo): 480 planes nuevos (94 tourisme, 386 escenari), integridad y FK correctas, planes activos 2917 → 3397 y cola inicial de 43 casos (22 dentro del feed, 19 posibles duplicados de planes de Gencat, 2 decisiones obsoletas); un ensayo previo sobre una copia mostró que las repeticiones no crean nada y que la cola baja a unos 34 casos. Detalles en [`DEPLOYMENT.md`](DEPLOYMENT.md).

**Página privada de revisión (2026-10-14, `review:serve`):** permite fusionar («importar») o «mantener separado» cada caso de la cola con un clic. Solo es accesible por túnel SSH (`scripts/open-review-page.cmd`), con las decisiones nuevas guardadas en la tabla `diba_review_decisions`. Ver [`DEPLOYMENT.md`](DEPLOYMENT.md).

**Primera revisión de la cola (2026-10-14):** se compararon los 19 posibles duplicados DIBA/Gencat (mismo título y fechas en todos) y se fusionaron 17 con `scripts/merge-duplicate-plans.js` (dry-run por defecto; decisiones versionadas en `data-policy/duplicate-plan-merges.json`, revisor `project-owner`). Cada plan DIBA nuevo pasó a ser alias 301 del plan de Gencat, que conserva sus campos y gana la procedencia DIBA; no se tocó ningún otro plan y existe SQL de rollback en `data/consolidation-logs/`. Quedan sin fusionar dos casos dudosos por lugar distinto: «Una carretada de contes» (planes 6767 y 6307) y «Conhort» (6650 y 3568).

Pendiente: verificar que el cron diario (05:45) sigue en `completed` y revisar la cola (solo casos dudosos reales; las decisiones antiguas con destino caducado ya no se encolan). Resolver un caso con «enlazar» sobre un plan DIBA ya importado exigirá una consolidación de planes (hoy lo bloquea `REVIEWED_SOURCE_LINK_CHANGED`); eso debe resolverlo la futura página privada de revisión.

## AUTONOMOUS WORK

- No hay trabajo autónomo actualmente definido.

## PRODUCT DECISIONS

- Seguimiento del modo shadow de recurrentes (`[recurring-shadow]`). Antes de la mejora de 2026-10-16 daba `verdict=SAFE groups=10 stale=9 blocked=0`. Análisis del 2026-10-16: las 9 sesiones «stale» (5 grupos: Gran Gala Flamenc 2, Barcelona Guitar Trio & Dance 3, Salvador Pagès, Memòria/Torre Bellesguard, Matí musical, Carilló) son todas **sesiones ya celebradas** (1–12 de octubre). Siguen en el dataset de Gencat con los mismos datos; salen de nuestra descarga porque el importador solo pide eventos con `data_fi` >= hoy (retención 0). No son cancelaciones. El producto ya las ignora: visibilidad, orden y `nextOccurrences` solo cuentan occurrences con `local_date >= hoy` (p. ej. Gran Gala muestra como siguiente el 2026-10-18). Su único efecto visible sería el inicio del rango del plan canónico (`start_date` sigue en la primera sesión pasada). Como ese contador crecería a medida que pasen sesiones, el shadow distingue ahora (2026-10-16, solo log, sin escrituras) `stale` = sesión con fecha de hoy o futura que desaparece del feed (posible cancelación, la señal real) de `expired` = sesión ya celebrada que sale del feed (esperada, solo se cuenta). El tope de pérdida del 50 % por grupo se calcula solo con sesiones futuras, así que el paso del tiempo no lo dispara. La línea del log es `verdict=SAFE groups=10 stale=0 blocked=0 expired=9` y `expired` irá subiendo sin ser un problema. Retirar de verdad las occurrences pasadas (fase 4C.6E restringida) tendría un efecto visible casi nulo y no se hace; nunca se retirará automáticamente una sesión futura. Hoy ninguna ruta escribe esa retirada.

## OPERATOR / PRODUCTION

- App Android (paso 3 del plan móvil): el proyecto TWA (`mobile/android/`), los textos e imágenes de la ficha
  y la guía de formularios (`mobile/store-listing/`) están preparados. Hecho el 2026-10-21: cuenta de Play
  Console verificada, app `cat.tenspla.app` creada, clave de subida creada por el propietario (fuera del
  repositorio), versión 1 (1.0.0) subida a la **prueba interna** y `/.well-known/assetlinks.json` publicado con
  las huellas de Firma de aplicaciones de Play y de la clave de subida. También el 2026-10-21: ficha en catalán y
  todos los formularios completados (PEGI 3; seguridad de los datos con ubicación aproximada, interacciones e
  historial de búsqueda de Umami) y prueba cerrada «Alpha» (España, lista «tenspla testers») creada y enviada a
  revisión. El 2026-10-23 Google la **rechazó por la política de afirmaciones engañosas**: la descripción citaba
  datos de la Generalitat y la Diputació sin enlaces a las fuentes ni renuncia. Se añadió un aviso de que no es un
  servicio oficial y los enlaces oficiales (portal de transparencia de la Generalitat, Agenda Cultural y la ficha
  de la Diputació en datos.gob.es; los enlaces `do.diba.cat/datasets/…` no abren en un navegador) y se **reenvió a
  revisión ese mismo día**; ese segundo envío figura como **«Publicada»** (comprobado el 2026-10-26): la prueba
  cerrada ya está activa. Los enlaces de la Diputació en `/fonts` (campo `dataset_url` de `sources`) pasan a
  las fichas de datos.gob.es con la migración `020` (2026-10-23). Faltan, del propietario: esperar la aprobación, enviar el enlace de
  participación y reunir 12 testers (mejor 14–15) durante 14 días seguidos, pedir el acceso a producción,
  opcionalmente añadir la ficha en castellano e inglés, y consultar con un gestor el NIF y el domicilio del aviso
  legal (LSSI art. 10). Respuestas dadas y pasos en
  [`../mobile/store-listing/play-console-guide.md`](../mobile/store-listing/play-console-guide.md).

- Revisar el log de la importación de Gencat (`/var/log/quefem-import.log`): confirmar que `[recurring-shadow]` informa los 10 grupos consolidados con `blocked=0` y `stale=0`: cualquier `stale` > 0 es una sesión futura que ha desaparecido del feed y merece mirarse; `expired` es normal.
- Widget B2B: crear los widgets de los pilotos con `embed:widgets` cuando haya acuerdo. Antes de cobrar, revisar el aviso legal.
- Verificar la configuración efectiva de Nginx, PM2 y cron antes de cualquier operación que dependa de ella.
- Verificar las últimas ejecuciones y la restaurabilidad de los backups, la copia externa mediante `rclone` y las rotaciones de logs cuando una intervención operativa lo requiera.
- Revisar periódicamente cobertura, indexación y errores concretos en Google Search Console.
- Confirmar que `/var/log/quefem-diba.log` muestra `completed` cada día y revisar la cola con `scripts/open-review-page.cmd` (sin necesidad de abrir Nginx ni PM2).

## BLOCKED

- No hay bloqueos técnicos activos documentados; las intervenciones de producción siguen requiriendo verificación operativa previa.

## LATER / TECHNICAL DEBT

- La búsqueda `q` usa normalización/`instr` en SQLite y puede hacer escaneos; no hay FTS ni paginación por cursor.
- La SPA puede mostrar Not Found con respuesta HTTP 200 por el fallback de Nginx.
- El log de errores de PM2 muestra avisos `Media queue wait timeout after 6000ms (N still queued, 4 active)` (visto el 2026-10-16: 5 en las últimas 2000 líneas, API estable, sin impacto visible). Es la cola acotada de descargas remotas de imágenes (4 simultáneas, espera máxima de 6 s): una ráfaga de imágenes aún sin caché con el origen lento deja a las sobrantes con la imagen de reserva. Sin prioridad. No se ha medido su frecuencia ni qué origen lo provoca, y el mensaje no lleva marca de tiempo ni origen. Revisar si aparecen tarjetas con imagen genérica en eventos que deberían tener foto, si el número de avisos crece de forma sostenida o al sumar fuentes con muchas imágenes; el primer paso sería añadir marca de tiempo y origen al mensaje y contarlos por hora.
- Nginx, PM2, cron, backups, `rclone` y logrotate no están versionados; existe riesgo de divergencia entre documentación y servidor.
- No hay `ecosystem.config.*` versionado.
- El repositorio documenta el estado y los requisitos del backup, pero no contiene la configuración externa ni un runbook reproducible completo de backup/restauración.
- Parte de `SPECIFICATION.md` y `docs/design/stitch/` es histórica o futura y no representa por sí sola el estado implementado.
- Localidad (`plans.locality`): ya llega con acentos, el defecto era la capitalización («Cornellà de llobregat»). Los normalizadores de Gencat y Ticketmaster la restauran ahora como un municipio (solo si coincide exactamente con uno oficial; los barrios no se tocan) y `scripts/restore-place-accents.js --fields=locality` corrige las ya guardadas. Desplegado (commit `c12e10b`) y aplicado en producción el 2026-10-20 con backup previo (`/var/backups/tenspla/quefem_pre_locality_2026-10-20_14-33-26.sqlite`): 18 planes corregidos en 5 correcciones, una segunda simulación da 0 cambios, integridad y claves foráneas correctas, web y API en 200. Los 16 municipios de DIBA/Fever con artículo en minúscula quedan sin corregir a propósito (Fever los reescribiría).
- Grupos recurrentes `REVIEW_REQUIRED` y los de DIBA permanecen sin consolidar por decisión explícita.
- Nuevas fuentes o funciones de producto solo pueden evaluarse tras una petición, licencia y alcance explícitos; no constituyen trabajo pendiente autorizado.

## External production configuration

| Área | Estado documental | Comprobación antes de operar |
| --- | --- | --- |
| Dominio, HTTPS, Nginx y PM2 | Confirmado externamente | Verificar configuración efectiva en el servidor |
| Cron de Gencat | Confirmado externamente | Revisar crontab y último resultado |
| Sitemap público y Search Console | Confirmado externamente | Revisar disponibilidad/cobertura si la tarea depende de ello |
| Backup SQLite y automatización | Confirmado externamente y probado | Revisar última ejecución y restaurabilidad |
| Copia `rclone` a `TensPla/backups` | Confirmado externamente | Revisar último envío sin exponer credenciales ni IDs |
| Logrotate | Confirmado externamente y verificado | Revisar configuración efectiva y rotaciones si se va a modificar |
| Ticketmaster en producción | Activo según el estado confirmado | Verificar cron y configuración efectiva antes de operar |
| DIBA en producción | Tres fuentes activas, imágenes deshabilitadas, M2 desplegado y cron diario 05:45 instalado; `diba-tourisme` y `diba-escenari` fallaban fail-closed hasta el 2026-10-14; ahora importan con la política `review-queue` | Revisar `/var/log/quefem-diba.log` y `data/diba-review-queue.json` |
| Cron de Fever | Instalado (01:05, 07:05, 13:05, 19:05); ejecuciones `completed` | Revisar `/var/log/quefem-fever.log` |
| Purga de inactivos | `purge:inactive` diario 03:45, instalado | Revisar `/var/log/quefem-purge.log` |
| Gencat recurrentes | 10 grupos consolidados, shadow activo tras cada import | Revisar `[recurring-shadow]` en `/var/log/quefem-import.log` |
| CSP | Obligatoria; confirmada por el propietario el 2026-09-30 | Mantener; `/embed/` usa su propia CSP |
| Widget B2B (`/embed/`) | Desplegado el 2026-09-30; solo los dos widgets de demostración de `/widget` | Revisar `embed:widgets -- list` antes de operar |

El roadmap operativo separa AUTONOMOUS WORK, PRODUCT DECISIONS, OPERATOR / PRODUCTION, BLOCKED y LATER / TECHNICAL DEBT. No existe una definición fiable de prioridades `P1`, `P2`, etc.; no deben usarse para decidir trabajo actual.

## No iniciar sin una petición explícita

- Nuevas fuentes como Fever, Viator, Civitatis o Tiqets, ni scraping.
- Mapas avanzados/proximidad, favoritos, cuentas, analítica, publicidad, IA o monetización. Favoritos,
  notificaciones y «planes cerca» están aprobados como dirección para la app móvil (2026-10-21), pero cada
  uno sigue necesitando su propia petición.
- Cambios en producción, deploy, SSH, PM2, Nginx, cron, importaciones reales, commits o push.
