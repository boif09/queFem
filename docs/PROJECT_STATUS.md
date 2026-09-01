# Tens Pla? — Estado del proyecto

Última revisión documental: 2026-09-01.

Esta es la fuente principal para responder «¿Dónde está Tens Pla? ahora mismo y qué toca hacer?». La arquitectura está en [`ARCHITECTURE.md`](ARCHITECTURE.md), las fuentes en [`DATA_SOURCES.md`](DATA_SOURCES.md) y la operación en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Current production state

- **Tens Pla?** está publicada y funcionando en `https://tenspla.cat`; `www.tenspla.cat` y el host legacy redirigen al dominio principal.
- Nginx sirve el frontend React/Vite y hace proxy a la API Express de solo lectura; PM2 gestiona `quefem-api` y SQLite es la persistencia.
- Gencat se sincroniza cada dos horas mediante cron externo. Búsqueda, filtros, fichas bilingües, planes permanentes, deduplicación multi-source y purgas están implementados.
- El SEO público está desplegado: metadata por ruta, canonical, Open Graph/Twitter, Event JSON-LD conservador, `robots.txt` y sitemap público. Google Search Console ya está verificado.
- Hay backups automáticos y probados de SQLite, con comprobaciones y copia externa mediante `rclone` al destino de Google Drive `TensPla/backups`.
- La rotación de logs de Nginx está configurada y verificada.
- Gencat, Ticketmaster y Fever están activos en producción. Fever tiene source habilitada, imágenes same-origin activadas y una primera importación real completada; la configuración efectiva de cron debe verificarse en el servidor antes de operar.

La infraestructura de producción es parcialmente externa a Git. «Confirmado» describe el estado conocido a fecha de esta revisión, no sustituye la comprobación previa a una operación.

## Recently completed

- DIBA M0 y M1/M1.1/M1.2/M1.3 completados localmente: integración selectiva de `actesturisme_ca`, `escenari` y `actesmuseus`, con procedencias operativas separadas `diba-tourisme`, `diba-escenari` y `diba-museus`. La primera importación local real terminó correctamente con fuentes desactivadas: 710 procedencias elegibles, 613 planes solo-DIBA, 74 planes públicos con procedencia DIBA añadida, 6 matches Turismo→Museos, 21 ambiguos, 28 municipios de Turismo sin resolver y cero retiradas. M1.3 hace fiel el overlay de repeat dry-run y protege la salud semántica del subconjunto accionable. No hay cron ni activación pública. Bibliotecas, agenda general, exposiciones, parques y agregaciones genéricas continúan excluidos.
- DIBA M1.4A/A.1 completado como auditoría local de solo lectura: el informe separa clústeres internos del mismo feed, ambigüedades históricas y riesgos actuales frente a planes públicos habilitados, incluyendo pares posibles del matcher, cardinalidad por componentes, estado de actividad y evidencia de horarios/URLs alineada al contrato de producción. No altera SQLite ni las reglas de importación. El estado local auditado mantiene riesgo de activación pública y requiere la política explícita de M1.4B; las fuentes DIBA permanecen `enabled=0`.
- DIBA M1.4B completado como diseño de política offline y versionado: define consolidación misma fuente, enlaces DIBA↔público por componente, sesiones, aliases municipales, propiedad canónica, reconciliación, overrides y gates de activación para M1.4C. No implementa ningún comportamiento productivo ni cambia la activación.

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
- La automatización recurrente Fever prepara `fever:import:scheduled`: preflight de migrations/source/integridad, lock compartido con el modo manual, guards sin bypass e imágenes Fever soportadas. El cron queda pendiente de validación manual del segundo import y de instalación explícita por el operador.

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

- No hay bloqueos técnicos activos documentados; las intervenciones de producción siguen requiriendo verificación operativa previa.

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
| Ticketmaster en producción | Activo según el estado confirmado | Verificar cron y configuración efectiva antes de operar |
| CSP | No aplicada según el último estado confirmado | Requiere prueba Report-Only y autorización |

El roadmap operativo separa AUTONOMOUS WORK, PRODUCT DECISIONS, OPERATOR / PRODUCTION, BLOCKED y LATER / TECHNICAL DEBT. No existe una definición fiable de prioridades `P1`, `P2`, etc.; no deben usarse para decidir trabajo actual.

## No iniciar sin una petición explícita

- Nuevas fuentes como Fever, Viator, Civitatis o Tiqets, ni scraping.
- Mapas avanzados/proximidad, favoritos, cuentas, analítica, publicidad, IA o monetización.
- Cambios en producción, deploy, SSH, PM2, Nginx, cron, importaciones reales, commits o push.
