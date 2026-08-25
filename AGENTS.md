# Guía operativa del repositorio

## Identidad

El nombre público es **Tens Pla?**; la interfaz y el wordmark también pueden mostrar «Tens pla?». La aplicación permite descubrir actividades y eventos de fuentes oficiales en Catalunya mediante búsqueda, filtros y fichas bilingües en catalán y castellano.

`queFem`, `quefem` y «Què Fem?» son nombres técnicos o históricos que siguen presentes en rutas, scripts, SQLite, procesos y código. No se deben renombrar como efecto colateral de un cambio de marca.

## Mapa rápido

- `frontend/`: aplicación React/Vite, rutas, componentes, i18n, estilos y assets públicos.
- `backend/src/api/`: API HTTP de solo lectura y validación de consultas.
- `backend/src/db/`: conexión SQLite, migraciones y repositorios.
- `backend/src/importers/` y `backend/src/normalizers/`: ingestión y normalización por fuente.
- `backend/src/jobs/`: importaciones, purgas, retirada y sincronización de imágenes.
- `backend/src/services/`: deduplicación, reconciliación e imágenes Ticketmaster.
- `data/`: SQLite y cachés locales; no tratar como código ni versionar datos generados. La única excepción versionada es `data/geography/`, que contiene el snapshot oficial ICGC, su metadata y el manifiesto atómico necesarios para M4A.
- `test/` y `frontend/src/**/*.test.*`: tests backend y frontend.
- `deploy.sh`: despliegue manual; no ejecutarlo sin autorización explícita.
- `docs/`: documentación detallada. Empezar por [`docs/README.md`](docs/README.md).

## Fuentes de verdad

- Estado, bloqueos y siguiente trabajo: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).
- Arquitectura implementada: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Desarrollo local y comandos: [`README.md`](README.md).
- Fuentes, licencias y reglas de ingestión: [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).
- Decisiones confirmadas: [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Infraestructura y operación: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Alcance de producto original: [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md). Es una especificación de referencia, no un inventario del estado actual.

Cuando documentación y código difieran, comprobar la implementación y corregir el documento de estado correspondiente; no asumir que una descripción histórica sigue vigente.

## Reglas de trabajo

- Leer primero este archivo y la documentación relevante para la tarea; inspeccionar después el código existente antes de proponer una solución.
- Reutilizar patrones existentes y mantener los cambios pequeños y focalizados. No inventar requisitos ni implementar milestones futuras sin petición explícita.
- No cambiar silenciosamente decisiones de producto, compatibilidad, fuentes de datos, atribución, deduplicación o reglas de negocio.
- El catalán es el idioma principal y predeterminado; el castellano debe seguir completamente soportado.
- Preferir APIs y datos abiertos oficiales. No hacer scraping, añadir fuentes o reutilizar imágenes sin aprobación y validación previa de licencia o términos.
- Preservar procedencia, atribución y fecha de actualización de los datos importados.
- Revisar `git diff` antes de terminar. Si el cambio vuelve obsoleta la documentación, actualizar su única fuente de verdad.
- No introducir secretos, API keys, credenciales ni contenido de `.env` en Git o en salidas compartidas.

## Seguridad operacional

Salvo autorización explícita en una tarea: no desplegar, no conectarse a producción, no modificar Nginx/PM2/cron, no ejecutar importaciones o acciones destructivas sobre bases reales, no crear commits y no hacer `git push`. No modificar `.env` con secretos ni usar comandos destructivos de Git.

## Validación

Usar solo las comprobaciones que correspondan al cambio:

```bash
npm run test:backend
npm run test:frontend
npm run build:frontend
npm test
git diff --check
```

Si falla un test, determinar si lo causa el cambio antes de finalizar. El repositorio no define actualmente scripts de lint ni typecheck; no inventarlos.
