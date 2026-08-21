# Arquitectura actual

Este documento describe la implementación existente. El estado de activación y los bloqueos viven en [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Vista general

```text
fuentes oficiales → importadores → normalización y filtros
                  → deduplicación/reconciliación → SQLite
                  → API Express de solo lectura → frontend React/Vite
```

Todo vive en un único paquete npm. El backend usa Node.js, Express 5 y `better-sqlite3`; el frontend usa React 19, React Router, i18next y Vite. La UI utiliza catalán por defecto y ofrece castellano.

## Backend y API

`backend/src/server.js` carga la configuración, aplica migraciones y arranca Express. `HOST` vale `127.0.0.1` por defecto y `PORT`, `3000`. `backend/src/app.js` compone estas rutas GET:

- `/api/plans` y `/api/plans/:id`
- `/api/categories`, `/api/sources` y `/api/comarques`
- `/api/municipalities?comarca=...`
- `/api/media/ticketmaster/:imageId`
- `/api/sitemap.xml`

La API no ofrece escritura. La consulta de planes limita `page` a 200, `limit` a 100, `q` a 100 caracteres y los filtros textuales a 120 caracteres.

## SQLite

La conexión está en `backend/src/db/`, con claves foráneas, WAL, `busy_timeout` y migraciones incrementales. Las tablas principales son `plans`, `sources`, `plan_sources`, `categories`, `plan_categories`, `import_runs` y `plan_source_images`. Los repositorios encapsulan consultas y escrituras transaccionales. No se debe editar manualmente una base real ni alterar una migración ya aplicada.

## Ingestión y normalización

Los comandos de `backend/src/jobs/` invocan importadores y servicios; no existe un scheduler Node interno. Las programaciones de producción son cron externos documentados en [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Gencat

`GencatImporter` descarga el dataset oficial `rhpv-yr4f`, normaliza cada localización, filtra Catalunya, fechas caducadas o incoherentes y conserva procedencia auditable sin campos de imagen no autorizados. La identidad remota combina el código oficial con una huella del payload porque la fuente no proporciona un ID único de fila.

### Ticketmaster

El importer usa Discovery Feed 2.0 y una política centralizada: solo acepta los identificadores observados `trium` y `mfx-es` cuando `brandName` es Ticketmaster y `officialSeller` es `true`. Aplica horizonte temporal, territorio, exclusiones conservadoras, agrupación de sesiones y reconciliación multi-source. Su activación pública está bloqueada; ver [`DATA_SOURCES.md`](DATA_SOURCES.md).

## Deduplicación y reconciliación

La deduplicación inicial usa una huella normalizada de título, municipio y fecha. Para Ticketmaster frente a Gencat, el matcher busca candidatos en la misma fecha y municipio. Solo confirma coincidencias con título exacto normalizado y señales de lugar compatibles; las coincidencias insuficientes se reportan como posibles y no se fusionan automáticamente. Un plan puede mantener varias procedencias, de modo que retirar una no elimina las demás.

## Retención, retirada e imágenes

Los planes caducados se purgan según `EVENT_RETENTION_DAYS`; los permanentes se conservan. Una procedencia desaparecida puede dejar el plan `inactive`; los huérfanos inactivos tienen una purga separada, con dry-run, tras el plazo configurado. La retirada expresa está en [`TICKETMASTER_REMOVAL.md`](TICKETMASTER_REMOVAL.md).

Las imágenes de categorías son assets locales. Gencat no aporta imágenes reutilizadas. Las imágenes Ticketmaster se vinculan a su procedencia, se sirven same-origin y usan una caché local limitada. Con `TICKETMASTER_IMAGES_ENABLED=false` no hay sincronización remota ni selección en API, y el frontend mantiene patrones gráficos.

## Frontend

`frontend/src/` contiene páginas, componentes, hooks, cliente API, i18n, SEO y estilos. Las rutas públicas incluyen home, resultados, detalle, fuentes y páginas legales/contacto CA/ES. El cliente usa `/api` same-origin salvo `VITE_API_URL`. El minimapa carga OpenStreetMap solo tras una acción voluntaria.

El frontend guarda únicamente la preferencia de idioma en `localStorage` (`quefem.language`); no integra analítica ni seguimiento según la implementación actual.

## Tests, build y producción

Los tests backend usan `node:test` y bases temporales; los frontend, Vitest, Testing Library y jsdom. Vite genera `frontend/dist`. Los comandos canónicos están en [`../README.md`](../README.md).

En producción Nginx sirve `frontend/dist` y redirige `/api` al backend local. PM2 gestiona `quefem-api`; SQLite y cachés viven bajo `/var/www/queFem/data`. `deploy.sh` ejecuta pull fast-forward, `npm ci`, tests, migraciones, build y reinicio. PM2, Nginx y cron se administran fuera del repositorio; no hay `ecosystem.config.*` versionado.
