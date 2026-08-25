# Tens Pla?

Tens Pla? es una aplicación web bilingüe para descubrir actividades y eventos en Catalunya. Ingiere fuentes aprobadas, normaliza y reconcilia sus registros en SQLite y los publica mediante una API Express y un frontend React.

El producto público se llama **Tens Pla?**. El repositorio conserva nombres legacy como `queFem`, `quefem` y «Què Fem?» por compatibilidad técnica; no indican una segunda aplicación.

## Requisitos

- Node.js 20 o superior
- npm

## Desarrollo local

```bash
npm ci
cp .env.example .env
npm run db:init
npm run import:gencat
```

En PowerShell, el equivalente del segundo comando es `Copy-Item .env.example .env`. Revisa las variables antes de importar; no compartas el contenido de `.env`. La base por defecto es `data/quefem.sqlite`.

Arranca backend y frontend en dos terminales:

```bash
npm run dev:backend
npm run dev:frontend
```

El backend escucha por defecto en `127.0.0.1:3000`. Vite usa `http://localhost:5173` y redirige `/api` al backend local. `HOST`, `PORT`, `DATABASE_PATH` y el resto de opciones no secretas están descritas en [`.env.example`](.env.example).

Ticketmaster requiere credenciales y permanece bloqueado para producción. Su pipeline puede inspeccionarse sin escrituras con:

```bash
npm run import:ticketmaster -- --dry-run
```

El discovery de Fever/Impact se puede auditar sin abrir ni modificar SQLite mediante:

```bash
npm run fever:discovery:dry-run
```

No ejecutes la variante con escritura ni jobs de producción sin autorización. Consulta [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) para las reglas completas.

## Comandos

| Comando | Uso |
| --- | --- |
| `npm run db:init` | Aplicar migraciones SQLite |
| `npm run db:purge` | Purgar planes caducados según la política vigente |
| `npm run purge:inactive -- --dry-run` | Inspeccionar la purga de huérfanos inactivos |
| `npm run import:gencat` | Sincronizar Agenda Cultural de Catalunya |
| `npm run import:ticketmaster -- --dry-run` | Validar Ticketmaster sin escribir |
| `npm run fever:discovery:dry-run` | Auditar el catálogo Fever/Impact sin abrir SQLite |
| `npm run ticketmaster:images:sync` | Sincronizar metadata/caché de imágenes si el feature flag lo permite |
| `npm run ticketmaster:remove -- EVENT_ID --dry-run` | Inspeccionar una retirada por ID |
| `npm run test:backend` | Tests backend |
| `npm run test:frontend` | Tests frontend |
| `npm test` | Ambas suites |
| `npm run build:frontend` | Build Vite de producción |
| `npm run preview:frontend` | Previsualizar el build |

No hay scripts de lint ni typecheck definidos actualmente.

## Documentación

Empieza por [`AGENTS.md`](AGENTS.md) si vas a modificar el repositorio y por [`docs/README.md`](docs/README.md) para localizar la fuente de verdad concreta. Estado actual: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Despliegue: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Licencia y datos

Las condiciones de cada fuente no son equivalentes a una licencia general del código o de sus imágenes. Consulta [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) y [`docs/IMAGE_CREDITS.md`](docs/IMAGE_CREDITS.md) antes de reutilizar contenido.
