# Tens Pla? — Estado del proyecto

Última revisión documental: 2026-08-25.

Esta es la fuente principal para responder «¿Dónde está Tens Pla? ahora mismo y qué toca hacer?». La arquitectura está en [`ARCHITECTURE.md`](ARCHITECTURE.md), las fuentes en [`DATA_SOURCES.md`](DATA_SOURCES.md) y la operación en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Current production state

- **Tens Pla?** está publicada y funcionando en `https://tenspla.cat`; `www.tenspla.cat` y el host legacy redirigen al dominio principal.
- Nginx sirve el frontend React/Vite y hace proxy a la API Express de solo lectura; PM2 gestiona `quefem-api` y SQLite es la persistencia.
- Gencat se sincroniza cada dos horas mediante cron externo. Búsqueda, filtros, fichas bilingües, planes permanentes, deduplicación multi-source y purgas están implementados.
- El SEO público está desplegado: metadata por ruta, canonical, Open Graph/Twitter, Event JSON-LD conservador, `robots.txt` y sitemap público. Google Search Console ya está verificado.
- Hay backups automáticos y probados de SQLite, con comprobaciones y copia externa mediante `rclone` al destino de Google Drive `TensPla/backups`.
- La rotación de logs de Nginx está configurada y verificada.
- Ticketmaster está implementado y validado localmente. Su importación, cron e imágenes no están activados en producción según el último estado confirmado; la configuración efectiva debe verificarse en el servidor antes de operar.

La infraestructura de producción es parcialmente externa a Git. «Confirmado» describe el estado conocido a fecha de esta revisión, no sustituye la comprobación previa a una operación.

## Recently completed

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
- Fever M4B validado únicamente en SQLite temporal: persistencia Fever standalone por `CatalogItemId`, geography source-specific, occurrences, idempotencia, reconciliación y guards de feed completo/conteo. No está activado ni publicado y la SQLite real no ha sido migrada.

## AUTONOMOUS WORK

- No hay trabajo autónomo actualmente definido.

## PRODUCT DECISIONS

- Decidir si se quiere automatizar la purga de planes inactivos y aprobar su política operativa antes de preparar cualquier activación.

## OPERATOR / PRODUCTION

- Preparar y probar una CSP en modo `Content-Security-Policy-Report-Only`, revisar los reportes y decidir posteriormente si se activa como obligatoria. Requiere autorización e intervención sobre Nginx.
- Verificar la configuración efectiva de Nginx, PM2 y cron antes de cualquier operación que dependa de ella.
- Verificar las últimas ejecuciones y la restaurabilidad de los backups, la copia externa mediante `rclone` y las rotaciones de logs cuando una intervención operativa lo requiera.
- Revisar periódicamente cobertura, indexación y errores concretos en Google Search Console.
- Si el propietario aprueba automatizar la purga de inactivos, validar primero el dry-run, backup y monitorización en producción y después configurar el cron autorizado.

## BLOCKED

- **Activación de Ticketmaster en producción:** depende de aprobación final legal/contractual y de una decisión explícita de activación. Solo después procede verificar configuración, preparar backup, ejecutar dry-run y decidir importación, imágenes y cron.

## LATER / TECHNICAL DEBT

- La búsqueda `q` usa normalización/`instr` en SQLite y puede hacer escaneos; no hay FTS ni paginación por cursor.
- La SPA puede mostrar Not Found con respuesta HTTP 200 por el fallback de Nginx.
- Nginx, PM2, cron, backups, `rclone` y logrotate no están versionados; existe riesgo de divergencia entre documentación y servidor.
- No hay `ecosystem.config.*` versionado.
- El repositorio documenta el estado y los requisitos del backup, pero no contiene la configuración externa ni un runbook reproducible completo de backup/restauración.
- Parte de `SPECIFICATION.md` y `docs/design/stitch/` es histórica o futura y no representa por sí sola el estado implementado.
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
| Ticketmaster en producción | Último estado confirmado: desactivado | Requiere verificación en servidor y aprobación previa |
| CSP | No aplicada según el último estado confirmado | Requiere prueba Report-Only y autorización |

El roadmap operativo separa AUTONOMOUS WORK, PRODUCT DECISIONS, OPERATOR / PRODUCTION, BLOCKED y LATER / TECHNICAL DEBT. No existe una definición fiable de prioridades `P1`, `P2`, etc.; no deben usarse para decidir trabajo actual.

## No iniciar sin una petición explícita

- Nuevas fuentes como Fever, Viator, Civitatis o Tiqets, ni scraping.
- Mapas avanzados/proximidad, favoritos, cuentas, analítica, publicidad, IA o monetización.
- Cambios en producción, deploy, SSH, PM2, Nginx, cron, importaciones reales, commits o push.
