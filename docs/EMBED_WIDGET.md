# Widget d'agenda incrustable (B2B)

Estado: **F1 desplegada en producción el 2026-09-30** (commit `8456c8a`, migración `017`, `location
/embed/` de Nginx aplicada). Verificada con un widget temporal desde un origen autorizado y otro no
autorizado; ese widget quedó revocado. No hay widgets de clientes creados todavía.

## Qué es

Una agenda de Tens pla? que un tercero (consell comarcal, oficina de turismo, alojamiento) inserta en
su web con dos líneas:

```html
<div data-tenspla-widget="wgt_XXXXXXXXXXXXXXXXXXXXXXXX"></div>
<script src="https://tenspla.cat/embed/v1/loader.js" async></script>
```

`loader.js` crea un iframe hacia `https://tenspla.cat/embed/v1/w/:key`, que Express genera en el
servidor. El iframe aísla estilos y garantiza que la marca «Agenda de Tens pla?» y la atribución no se
pueden ocultar desde la web anfitriona. La altura se ajusta por `postMessage`
(`{type: 'tenspla:resize', height}`); el cargador solo acepta mensajes del origen de su propio script
y del `contentWindow` de su iframe. Atributos opcionales del contenedor: `data-lang` (`ca`/`es`),
`data-theme` (`light`/`dark`/`auto`) y `data-title` (título accesible del iframe).

## Fuentes y datos que se redistribuyen

Solo se muestran planes con al menos una procedencia habilitada con `sources.allows_syndication = 1`.
Este permiso es independiente de `allows_commercial_use` y está concedido únicamente a Gencat
(`gencat-agenda`) y a las tres fuentes DIBA. Fever y Ticketmaster quedan excluidos por decisión de
producto del 2026-09-30, aunque estén habilitados en tenspla.cat. Las imágenes Gencat se
redistribuyen con la autorización escrita de la Generalitat que conserva el titular
([`DATA_SOURCES.md`](DATA_SOURCES.md)).

Las occurrences también se filtran: en un plan compartido, las sesiones de Fever o Ticketmaster no
deciden si el plan aparece ni qué fecha muestra; solo cuentan las de procedencias redistribuibles (y,
si no hay ninguna, las fechas del plan).

El widget solo expone hechos: título, fecha, municipio (nombre oficial ICGC), recinto, categorías,
marca de gratuidad y una imagen de una fuente redistribuible o de la librería genérica propia. Nunca
muestra descripciones, precios, `ticket_url` ni enlaces de afiliación, aunque el plan compartido tenga
una procedencia Fever. El pie de imagen Gencat no aparece, igual que en las tarjetas de tenspla.cat.
El pie del widget atribuye las fuentes de los planes mostrados (`sources.attribution_text`) y el ICGC.

Los nombres oficiales de municipio y comarca vienen de `backend/src/embed/officialPlaceNames.json`,
un índice ligero derivado del snapshot ICGC con `npm run geography:icgc:names`. Un test falla si el
índice no corresponde al snapshot publicado; hay que regenerarlo después de cada
`npm run geography:icgc:update`.

## Configuración de un widget

Se guarda en `embed_widgets.config_json` y la valida `backend/src/embed/widgetConfig.js`. La web
anfitriona no puede cambiarla; solo puede elegir idioma y tema.

| Campo | Valores | Por defecto |
| --- | --- | --- |
| `territory` | `{ "comarca": "Bages" }` o `{ "municipality": "Pals" }` | obligatorio |
| `territory.fallbackToComarca` | solo con municipio: amplía a la comarca si hay pocos planes | `true` |
| `territory.fallbackMinimum` | umbral de la ampliación (1–24) | `3` |
| `categories` | slugs de `categories`, semántica OR | todas |
| `freeOnly` | solo planes marcados como gratuitos | `false` |
| `sections` | `["upcoming"]`, `["permanent"]` o ambos (pestañas) | `["upcoming"]` |
| `windowDays` | días que cubre «Propers dies» (1–90) | `30` |
| `limit` | planes por sección (1–24) | `8` |
| `layout` | `list`, `grid`, `compact` | `list` |
| `theme` | `light`, `dark`, `auto` | `light` |
| `accent` | color `#rrggbb` | `#0055ff` |
| `language` | `ca`, `es` | `ca` |
| `title` | `{ "ca": "...", "es": "..." }`, máximo 80 caracteres | «Plans · {territori}» |

Los nombres de territorio se normalizan contra el ICGC (`"baix emporda"` → `Baix Empordà`); con un
municipio, la comarca se deduce automáticamente. La visibilidad, las occurrences y el orden son los
mismos que `/api/plans` (`sort=date`). No existe un «intervalo de refresco»: los datos cambian con las
importaciones y el widget muestra la última actualización en el pie.

## Claves, dominios y uso

La clave (`wgt_` + 24 caracteres aleatorios) es pública por naturaleza. La lista de orígenes permitidos
de cada widget (`https` obligatorio salvo `localhost`, sin rutas ni comodines, máximo 10) impide
**incrustarlo** en otras webs y permite **detectar** intentos de reutilización. No es un control de
acceso a los datos: un servidor puede descargar el HTML sin `Referer` y republicarlo, igual que ya
puede consultar `/api/plans`, que es pública. Lo que se vende es la agenda mantenida, con marca y
soporte, no el acceso a la información. Si algún día hiciera falta confidencialidad, requeriría
autenticación o una integración servidor a servidor.

- El servidor responde con `Content-Security-Policy: frame-ancestors <orígenes>`, así que el navegador
  se niega a mostrar el widget en cualquier otra web.
- Si la petición llega como iframe (`Sec-Fetch-Dest: iframe`) con un `Referer` de otro origen, se
  responde 403 y se cuenta como `rejected` para detectar reutilizaciones. Sin `Referer` (políticas
  estrictas del anfitrión) se sirve y se cuenta como `unknown`; `frame-ancestors` sigue protegiendo.
- Las páginas «no disponible» (clave inexistente, revocada, suspendida o dominio ajeno) no contienen
  planes y se pueden incrustar en cualquier sitio, para mostrar un aviso breve en lugar de un hueco.

La página del widget se envía con `Cache-Control: no-cache`: el navegador revalida cada carga, así que
suspender, revocar, rotar una clave o quitar un dominio tiene efecto inmediato. El servidor reutiliza
la vista calculada durante 5 minutos, por lo que revalidar es barato.

`embed_widget_usage_daily` agrega por widget, día civil (`Europe/Madrid`) y origen: `impressions`
(cargas del iframe) y `rejected`. Con más de 5.000 combinaciones pendientes en memoria, los orígenes
nuevos se agrupan en `other`. No guarda IPs ni datos
del visitante. Los contadores se acumulan en memoria y se vuelcan a SQLite cada 60 s y al detener el
servidor; es la única escritura que hace el proceso de la API.

Los enlaces del widget abren tenspla.cat en una pestaña nueva con
`utm_source=tenspla-widget&utm_medium=embed&utm_campaign=<clave>`, visibles en los pageviews de Umami.

## Administración

No hay panel. Todo se gestiona con `npm run embed:widgets`:

```bash
npm run embed:widgets -- create --name "Consell Comarcal del Bages" --client "CC Bages" --origins "https://www.ccbages.cat,https://ccbages.cat" --config bages.json
npm run embed:widgets -- list
npm run embed:widgets -- show <clau>
npm run embed:widgets -- update <clau> --config bages.json
npm run embed:widgets -- update <clau> --origins "https://www.nou-domini.cat"
npm run embed:widgets -- suspend <clau>
npm run embed:widgets -- activate <clau>
npm run embed:widgets -- rotate <clau>
npm run embed:widgets -- revoke <clau>
npm run embed:widgets -- usage <clau> --days 30
npm run embed:widgets -- snippet <clau>
```

`create` y `rotate` imprimen el código que hay que enviar al cliente. `rotate` invalida la clave
anterior al momento. `revoke` es definitivo. En producción, estas órdenes escriben en la SQLite real
y requieren la misma autorización que cualquier otra operación sobre la base.

## Desarrollo local

`npm run dev:backend` sirve `/embed/*` en el puerto 3000 y Vite lo redirige desde el 5173, donde también
se sirven las imágenes genéricas de `frontend/public/media`. Para probar el aislamiento real, la web
anfitriona debe estar en otro origen (por ejemplo `http://localhost:5500`) incluido en la lista del
widget.

## Nginx en producción

El bloque `server` de `tenspla.cat` envía `X-Frame-Options: DENY` y una `Content-Security-Policy`
obligatoria con `frame-ancestors 'none'` y `style-src 'self'`. Si `/embed/` las heredara, el navegador
bloquearía el widget. En Nginx, un `add_header` dentro de una `location` anula todos los del
`server`; por eso la `location` del widget declara las suyas y repite solo HSTS y Permissions-Policy.
Aplicada el 2026-09-30 en `/etc/nginx/sites-available/tenspla`, antes del fallback de React Router
(copia previa en `/root/nginx-backups/tenspla.20260930T100641Z.before-embed`):

```nginx
location ^~ /embed/ {
    limit_req zone=tenspla_plans burst=20 nodelay;

    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
}
```

Si cambian las cabeceras de seguridad del `server`, hay que actualizar también las repetidas aquí.
Comprobación: `curl -sI https://tenspla.cat/embed/v1/loader.js` no debe devolver `X-Frame-Options`
ni la CSP del sitio, y `https://tenspla.cat/` debe seguir devolviéndolas.

## Pendiente (F2 y siguientes)

- Informe `report-to` de CSP para registrar intentos bloqueados que no envían `Referer`.
- Cuotas por plan comercial, informe mensual para el cliente y alertas de `rejected`.
- Filtro por radio en km para alojamientos.
- Que tenspla.cat respete `?lang=es` al abrir un plan desde un widget en castellano; hoy el idioma
  del destino depende de la preferencia guardada por el visitante.
- Configurador visual y facturación, solo si los pilotos lo justifican.
- Antes de cobrar: revisar el aviso legal ([`DEPLOYMENT.md`](DEPLOYMENT.md), revisión legal previa).
