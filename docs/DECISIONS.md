# Decisiones confirmadas

Registro ligero de decisiones demostrables en documentación, configuración o código.

## Producto e identidad

- El nombre público es **Tens Pla?**; identificadores legacy `queFem`, `quefem` y «Què Fem?» se conservan cuando cambiarlos afectaría compatibilidad técnica.
- Catalunya es el ámbito territorial. El catalán es idioma principal y predeterminado; el castellano debe tener soporte completo.
- El inglés es un idioma solo de interfaz (UI, textos legales con nota de traducción informativa y widget), pensado como ayuda a visitantes extranjeros. Los planes no se traducen: se muestran en su idioma original (casi siempre catalán). La API sigue aceptando solo `ca`/`es`; con la UI en inglés el frontend pide `lang=es`, que cae al texto original. Traducir planes queda como investigación futura si hay demanda. Excepción de presentación (2026-10-30): en el texto libre del precio se quita el «Preu:»/«Preus:» inicial en todos los idiomas, y los precios sin más texto («de 6 a 20 €», «des de 29 €») se muestran como «6–20 €» o con la traducción de «desde» de la interfaz (`frontend/src/utils/priceText.js`); el resto del texto del precio sigue en su idioma original.

- App móvil (2026-10-21): primero Android y más adelante, si Android funciona, iPhone. Orden de pasos: la web
  como PWA instalable → app Android como TWA (la web real dentro de Chrome, de modo que analítica, afiliación
  y SEO siguen igual) → iPhone con Capacitor. No se reescribe en React Native. La cuenta de Google Play será
  personal, a nombre del propietario. El propietario quiere favoritos, notificaciones y «planes cerca» con
  localización, uno por uno; esto levanta el aplazamiento de `SPECIFICATION.md` §50 solo para estas tres
  funciones, y cada una sigue necesitando su propia petición.
- App Android (2026-10-21): paquete `cat.tenspla.app` (no se puede cambiar una vez publicada), mínimo Android
  7.0 (API 24, lo exige la librería TWA de Google) y compilada para Android 16 (API 36). Cuenta de Play Console
  personal: nombre de desarrollador «Tens pla?» y correo público `contacte@tenspla.cat`. Firma de aplicaciones
  de Play activada; la clave de subida la guarda el propietario fuera del repositorio. Ver
  [`../mobile/android/README.md`](../mobile/android/README.md).

## Datos y contenido

- Se priorizan fuentes oficiales y datos abiertos. Una fuente nueva requiere revisar licencia/términos; no se hace scraping sin aprobación explícita.
- La procedencia, atribución y actualización se conservan por registro. El plan canónico puede tener varias fuentes.
- No se presupone que las imágenes sean reutilizables. Excepción confirmada el 2026-09-15: las
  imágenes de Agenda Cultural Gencat pueden reutilizarse; se reproduce literalmente el
  `Peu d'imatge` no vacío y un pie existente vacío no exige crédito. La resolución pública es
  `PUBLIC_BUT_FRAGILE` y falla cerrada. Ticketmaster mantiene su política y activación separadas.
- Widget incrustable B2B (2026-09-30): solo redistribuye a webs de terceros procedencias con
  `allows_syndication = 1`, concedido únicamente a Gencat y DIBA; Fever y Ticketmaster quedan
  excluidos aunque estén activos en tenspla.cat. Solo se exponen hechos (título, fecha, lugar,
  categorías, gratuidad e imagen redistribuible), nunca descripciones, precios ni enlaces de
  afiliación. El widget siempre muestra la marca y el enlace de Tens pla?, y el acceso se limita por
  clave y lista de dominios. Ver [`EMBED_WIDGET.md`](EMBED_WIDGET.md).
- La deduplicación multi-source es conservadora: una coincidencia dudosa se revisa, no se fusiona silenciosamente.
- Página de revisión de DIBA (2026-10-14): es privada por construcción, no por contraseña. Escucha solo en el
  loopback del servidor, sin Nginx ni PM2, y se abre por túnel SSH con un secreto por sesión; no se añade
  autenticación propia. Las decisiones tomadas en ella viven en SQLite (`diba_review_decisions`), no en Git,
  para que los despliegues no choquen con ellas.
- Importación DIBA (2026-10-14): una coincidencia dudosa nunca debe parar la importación diaria. Los
  posibles duplicados se publican como planes separados y se anotan en una cola de revisión
  (`diba-review-queue.json`); solo siguen bloqueando los fallos graves (retirada masiva, feed
  truncado, salud del parser, conflictos con una decisión humana). Un duplicado visible es preferible a un
  feed parado.
- Los planes permanentes se conservan. Retirada y purga ofrecen dry-run y límites transaccionales.

## Arquitectura, privacidad y operación

- SQLite es la persistencia canónica actual y la API pública es de solo lectura. Única excepción: el
  widget incrustable vuelca contadores diarios agregados por widget y origen, sin datos del visitante.
- El backend escucha en `127.0.0.1` por defecto; Nginx es la capa pública en producción.
- La `Content-Security-Policy` del sitio es obligatoria, no `Report-Only` (confirmado el 2026-09-30).
  Solo `/embed/` tiene una CSP propia por widget. `frame-src` admite `'self'` (demos de `/widget`) y
  OpenStreetMap.
- El frontend usa recursos locales/same-origin cuando es posible. Montserrat se empaqueta localmente.
- El minimapa de OpenStreetMap de la ficha se muestra directamente, con carga diferida (`loading="lazy"`) y sin referrer (2026-10-30; antes se cargaba solo tras pulsar «Veure mapa», y el propietario lo cambió por petición de testers). La política de privacidad lo declara como servicio externo. La implementación no incorpora analítica ni seguimiento; la preferencia de idioma se guarda localmente.
- Sincronización de datos y despliegue son procesos separados. Gencat usa cron externo. El estado actual de Ticketmaster y sus imágenes es temporal y operativo: cualquier activación en producción requiere aprobación específica, pero no se define aquí como una prohibición arquitectónica permanente.
- La configuración de producción que vive fuera de Git se documenta separando lo versionado, lo confirmado externamente y lo que debe verificarse en servidor antes de operar.
- Deploy, SSH, PM2, Nginx, cron, importaciones reales, commits y push requieren autorización explícita.

Detalles: [`DATA_SOURCES.md`](DATA_SOURCES.md), [`DEPLOYMENT.md`](DEPLOYMENT.md) y [`TICKETMASTER_REMOVAL.md`](TICKETMASTER_REMOVAL.md).
