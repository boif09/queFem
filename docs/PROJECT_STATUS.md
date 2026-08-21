# Tens Pla? — Estado del proyecto

Última revisión documental: 2026-08-21.

Este es el inventario de estado. La arquitectura está en [`ARCHITECTURE.md`](ARCHITECTURE.md), las fuentes en [`DATA_SOURCES.md`](DATA_SOURCES.md) y la operación en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Completado

### Milestone 1 — Datos Gencat

- Importer de la Agenda Cultural de Catalunya, normalización, registro de licencia/procedencia y persistencia SQLite.
- Filtros de Catalunya, caducidad y fechas incoherentes; soporte real de planes permanentes.
- Importaciones idempotentes, payload auditable, purga de caducados y métricas en `import_runs`.

### Milestone 2 — Backend

- API Express de solo lectura para listado/detalle, categorías, fuentes, comarcas y municipios.
- Filtros, búsqueda textual y paginación sin cambiar el contrato de respuesta.
- Hardening local: `HOST=127.0.0.1` por defecto y máximo de 200 páginas; tests de validación.
- Sitemap dinámico y proxy/cache same-origin para imágenes Ticketmaster.

### Milestone 3 — Frontend

- React/Vite bilingüe: catalán predeterminado y castellano completo.
- Home, búsqueda, filtros, resultados, detalle, atribución, fuentes, estados y páginas legales/contacto.
- MiniMap voluntario para coordenadas, con enlace a Google Maps y carga de OpenStreetMap tras consentimiento.
- Branding público **Tens Pla?**, sistema Pop Editorial, Montserrat local, logo y favicon actuales.
- SEO V1 preparado: metadata por ruta, Open Graph/Twitter inicial, canonical, robots, Event JSON-LD conservador y sitemap API.

### Milestone 4A — Ticketmaster local

- Discovery Feed 2.0 ES implementado con allowlist conjunta de fuente, marca y vendedor oficial.
- Pipeline completo con horizonte, Catalunya, exclusiones, sesiones, normalización, idempotencia y reconciliación conservadora.
- Dry-run sin escrituras, importación real e idempotencia validados localmente.
- API y frontend comprobados manualmente con planes Ticketmaster y Gencat integrados.
- Retirada por event ID, `--purge` controlado y purga posterior de huérfanos inactivos documentadas y probadas.

### Imágenes Ticketmaster preparadas

- Metadata vinculada a `plan_sources`, variantes card/detail y entrega exclusivamente same-origin.
- Caché temporal configurable con allowlist, TTL, límite de disco, timeout/tamaño y lock recuperable contra ejecuciones simultáneas.
- Feature flag único `TICKETMASTER_IMAGES_ENABLED`, seguro y desactivado por defecto.
- Fallback del frontend a patrones cuando no hay imagen autorizada/disponible.

## Producción actual

- Aplicación pública en `https://tenspla.cat`; `www` y `https://quefem.jusboif.es` redirigen al dominio principal.
- Nginx sirve el build estático y hace proxy a Express; PM2 gestiona `quefem-api` en el puerto 3014; SQLite es la persistencia.
- Gencat se sincroniza cada dos horas mediante cron externo. El despliegue de código usa `deploy.sh` y es independiente de la sincronización.
- Las páginas legales CA/ES están publicadas. No hay analítica, seguimiento ni cookies según la implementación actual; el idioma se guarda en localStorage.
- Ticketmaster, su cron y sus imágenes permanecen desactivados en producción.

La configuración real de Nginx, PM2 y cron vive fuera del repositorio y debe verificarse en el servidor antes de cualquier operación.

## En desarrollo o bloqueado

- **Ticketmaster en producción:** bloqueado hasta aprobación final de términos/licencia y decisión explícita de activación. No existe cron activo de importación.
- **Imágenes Ticketmaster:** técnicamente preparadas, pero flag y cron siguen sin activar en producción.
- **SEO público:** tras desplegar la versión preparada faltan proxy Nginx de `/sitemap.xml`, validación pública y Google Search Console.
- **CSP:** política restrictiva investigada, pero pendiente de prueba Report-Only y activación en Nginx; Nginx no se configura desde este repositorio.

## Problemas conocidos y deuda técnica

- La búsqueda `q` usa normalización/`instr` en SQLite y puede hacer escaneos; sus entradas están acotadas, pero no hay FTS ni paginación por cursor.
- La SPA puede responder el HTML de fallback en rutas inexistentes; el estado visual es Not Found, pero el status HTTP depende de Nginx.
- Nginx, PM2 y crons no están versionados aquí; existe riesgo de divergencia entre documentación y servidor. No hay `ecosystem.config.*` en el repositorio.
- El procedimiento exacto y verificado de backups de producción no está documentado completamente en el repositorio.
- Parte de `SPECIFICATION.md` y `docs/design/stitch/` es histórica o futura; está marcada como referencia, no como estado implementado.

## Siguiente trabajo previsto

1. Completar la aprobación legal/contractual de Ticketmaster.
2. Solo con aprobación explícita: preparar backup y dry-run de producción, activar importación y después evaluar imágenes/cron.
3. Completar la publicación SEO pendiente (sitemap público y Search Console).
4. Probar CSP en modo Report-Only antes de hacerla obligatoria.

No existe en el repositorio una definición de prioridades `P1`, `P2`, etc.; no deben interpretarse ni asignarse hasta documentar su escala.

## No iniciar sin una petición explícita

- Nuevas fuentes como Fever, Viator, Civitatis o Tiqets.
- Scraping, mapas avanzados/proximidad, favoritos, cuentas, analítica, publicidad, IA o monetización.
- Cambios en producción, deploy, SSH, PM2, Nginx, cron, importaciones reales, commits o push.
