# Despliegue de Tens pla?

Este documento describe la infraestructura actual de producción. La sincronización de datos y el despliegue de código son procesos separados.

La marca pública es Tens pla? y el dominio público principal activo es `https://tenspla.cat`. `https://www.tenspla.cat` y el dominio legacy `https://quefem.jusboif.es` redirigen 301 al dominio principal; el dominio legacy conserva path y query. Las rutas, servicios y nombres internos legacy `quefem` no se modifican.

## Servidor

```text
Proveedor: Hetzner
Ubicación: Falkenstein, Alemania (eu-central)
Directorio del proyecto: /var/www/queFem
URL pública: https://tenspla.cat
```

Hetzner aloja el frontend, backend, SQLite, infraestructura web y logs técnicos. Existe un acuerdo de encargo del tratamiento conforme al artículo 28 del RGPD. El correo de `contacte@tenspla.cat` está alojado por OVHcloud.

## Backend

El backend utiliza Node.js y Express, escucha en `127.0.0.1:3014` y está gestionado por PM2 con el nombre `quefem-api`. `HOST` tiene el valor seguro `127.0.0.1` por defecto; no debe cambiarse a `0.0.0.0` en producción porque Nginx conecta mediante loopback.

No existe un archivo `ecosystem.config.*` versionado. La definición y el entorno efectivos de PM2 son estado externo al repositorio y deben comprobarse antes de operar o desplegar.

Node.js está instalado mediante NVM. La ruta actual es:

```text
/root/.nvm/versions/node/v24.18.0/
```

Para consultar el proceso y sus logs:

```bash
pm2 status
pm2 logs quefem-api
```

## Frontend

El frontend React/Vite se compila en `/var/www/queFem/frontend/dist` y Nginx lo sirve directamente. Nginx utiliza fallback a `index.html` para React Router y hace proxy de `/api/` a `http://127.0.0.1:3014`.

La aplicación se publica mediante HTTPS en `https://tenspla.cat`.

## Imágenes Ticketmaster pendientes de activación

La implementación está preparada pero no activada en producción. Requiere configurar:

```text
TICKETMASTER_IMAGES_ENABLED=true
TICKETMASTER_IMAGE_CACHE_PATH=./data/cache/ticketmaster-images
TICKETMASTER_IMAGE_CACHE_TTL_HOURS=6
TICKETMASTER_IMAGE_CACHE_MAX_MB=512
TICKETMASTER_IMAGE_METADATA_REFRESH_HOURS=24
TICKETMASTER_IMAGE_REQUEST_TIMEOUT_MS=15000
TICKETMASTER_IMAGE_MAX_BYTES=10485760
MEDIA_REMOTE_FETCH_CONCURRENCY=4
MEDIA_REMOTE_FETCH_QUEUE_DEPTH=24
MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS=6000
```

`TICKETMASTER_IMAGES_ENABLED` es el único feature flag de esta función y su valor seguro por
defecto es `false`. Con `false`, el sync termina sin realizar peticiones remotas, la API no
selecciona ni sirve imágenes Ticketmaster y el frontend conserva sus patterns; el resto de la
aplicación no cambia. Con `true`, quedan habilitados el sync de metadata, la selección en la API
y el proxy/cache same-origin.

El navegador solicita `/api/media/ticketmaster/:imageId`; el backend valida SQLite, descarga
solo desde `s1.ticketm.net` y mantiene una caché temporal fuera de `frontend/dist`. No se necesita
una location Nginx nueva porque `/api/` ya se proxifica al backend.

La ruta relativa se resuelve desde la raíz del proyecto: en `/var/www/queFem` corresponde a
`/var/www/queFem/data/cache/ticketmaster-images`. Node crea el directorio recursivamente cuando
se usa por primera vez; `/var/www/queFem/data` debe ser escribible por el mismo usuario de PM2.
El cron debe ejecutarse con ese mismo usuario o el directorio debe prepararse previamente con
propietario y permisos compatibles; la aplicación no intenta elevar privilegios.
La limpieza se aplica al llenar la caché y al terminar el sync: elimina primero huérfanos y
expirados y, si aún supera 512 MB, las entradas más antiguas. El proxy aplica timeout de 15
segundos y un máximo de 10 MiB por imagen. Ticketmaster, Fever y Gencat comparten además un
límite aplicativo de cuatro descargas remotas simultáneas por proceso (`MEDIA_REMOTE_FETCH_CONCURRENCY`,
entero entre 1 y 16). Una cache miss que llega con el límite ocupado espera en una cola FIFO
acotada (`MEDIA_REMOTE_FETCH_QUEUE_DEPTH`, por defecto 24, entre 0 y 64) hasta un tiempo máximo
(`MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS`, por defecto 6000 ms, entre 0 y 20000); solo si la cola está
llena o se agota la espera responde HTTP 503 `MEDIA_CAPACITY` (con cabecera `Retry-After`), en vez
de fallar de inmediato solo por haber más de cuatro peticiones simultáneas.
Los hits de caché y los consumidores concurrentes de un mismo ID no ocupan plazas de concurrencia
ni de cola.

El comando utiliza un lock atómico dentro de la caché. Una segunda ejecución sale correctamente
sin sincronizar; un lock cuyo PID ya no existe se recupera automáticamente.

Cron definitivo propuesto, todavía no aplicado, cada dos horas después del import Ticketmaster:

```cron
52 */2 * * * cd /var/www/queFem && npm run ticketmaster:images:sync >> /var/log/quefem-ticketmaster-images.log 2>&1
```

## SEO V1, sitemap público y Search Console

### P2.1 entrega determinista de fichas (pendiente de despliegue)

P2.1 añade una entrega HTML determinista y limitada para `/`, `/plans` y `/plans/:id`. Express reutiliza la misma consulta de visibilidad que API y sitemap, lee el `frontend/dist/index.html` ya compilado e inyecta sólo el `head`; no renderiza React ni hace peticiones externas. Una ficha inexistente, inválida o no pública devuelve HTML `noindex` con HTTP 404. Las queries de `/` o `/plans` reciben `noindex,follow` y no incluyen canonical. React sigue siendo responsable de la interfaz y la navegación cliente.

Al desplegar este código, las siguientes locations deben situarse antes del fallback SPA. Conservan path y query y no alteran `/api`, media ni assets estáticos:

```nginx
location = / {
    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /plans {
    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /plans/ {
    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

P2.2 amplía la misma entrega determinista a las dos landings editoriales `/avui` y
`/cap-de-setmana`. Sus URLs sin query son indexables y las variantes con query reciben
`noindex,follow` sin canonical. El cambio de código no modifica Nginx. Cuando se autorice
el despliegue, se requieren exactamente estas dos locations adicionales antes del fallback SPA:

```nginx
location = /avui {
    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /cap-de-setmana {
    proxy_pass http://127.0.0.1:3014;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Primero hay que compilar el frontend, confirmar que existe `frontend/dist/index.html`, inspeccionar la configuración efectiva de Nginx, ejecutar `nginx -t` y recargar Nginx sólo bajo autorización de producción separada.

El dominio canónico de toda la metadata es `https://tenspla.cat`. Home, `/plans` sin parámetros, `/fonts` y las fichas públicas de eventos activos son indexables. Las búsquedas, filtros, páginas legales, privacidad, almacenamiento, contacto y rutas no encontradas utilizan `noindex,follow`. La metadata por ruta, Open Graph, Twitter/X y Event JSON-LD se generan localmente, sin analytics, cookies ni scripts externos.

`frontend/public/robots.txt` anuncia `https://tenspla.cat/sitemap.xml`. El sitemap se genera dinámicamente desde SQLite en `/api/sitemap.xml`, reutilizando las mismas condiciones de visibilidad pública de la API. No incluye `lastmod`, porque `plans.updated_at` también puede cambiar por procesos técnicos y no representa de forma fiable un cambio visible de contenido.

La URL anunciada por robots ya está publicada mediante una regla Nginx externa al repositorio. El bloque esperado dentro del `server` canónico de `tenspla.cat`, antes del fallback de la SPA, es:

```nginx
location = /sitemap.xml {
    proxy_pass http://127.0.0.1:3014/api/sitemap.xml;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Este repositorio no aplica el cambio de Nginx. La publicación del sitemap, la validación pública asociada y la verificación de la propiedad de dominio `tenspla.cat` en Google Search Console están confirmadas externamente. Antes de modificar esta configuración hay que comprobar el bloque efectivo en el servidor. El seguimiento posterior consiste en revisar cobertura, indexación y errores concretos; no queda pendiente el alta inicial de Search Console.

La SPA continúa sirviendo `index.html` mediante fallback para rutas desconocidas. Aunque React muestra una vista noindex, el estado HTTP puede seguir siendo 200: **SPA soft-404 HTTP status remains a possible SEO limitation**.

## Despliegue de código

Desde `/var/www/queFem`, `deploy.sh` comprueba el repositorio, descarga los cambios, instala dependencias, ejecuta los tests, aplica migraciones, compila el frontend, reinicia `quefem-api` y comprueba la API y la web pública.

El despliegue no ejecuta `npm run import:gencat`: descargar datos no debe formar parte de un cambio de código, frontend o CSS.

## Sincronización de Gencat

La configuración preparada para imágenes Gencat es:

```dotenv
GENCAT_IMAGES_ENABLED=true
GENCAT_IMAGE_CACHE_PATH=./data/cache/gencat-images
GENCAT_IMAGE_CACHE_TTL_HOURS=6
GENCAT_IMAGE_CACHE_MAX_MB=512
GENCAT_IMAGE_METADATA_RETRY_HOURS=24
GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET=100
GENCAT_IMAGE_REQUEST_TIMEOUT_MS=15000
GENCAT_IMAGE_MAX_BYTES=10485760
```

El import normal resuelve siempre el pie de imágenes nuevas o cuya ruta haya cambiado. Para las
imágenes históricas sin resolver aplica un presupuesto de 100 por ejecución; las restantes se
persisten normalmente y continúan en imports posteriores. Antes de consumir ese presupuesto, las
candidatas históricas se ordenan mediante una consulta local por relevancia pública: actividad
actual, próximas fechas más cercanas, contenido permanente y, al final, histórico. Las imágenes
nuevas y las rutas cambiadas no entran en ese orden ni en el presupuesto. Con presupuesto 100, la
selección reserva proporcionalmente 80 plazas para actividad actual o próxima, 10 para contenido
permanente y 10 para histórico; los huecos no usados se redistribuyen de forma proporcional entre
los grupos pendientes. Para otros presupuestos, el redondeo usa los restos mayores, con desempate
por relevancia. No hay cola persistente y los grupos inferiores siguen siendo alcanzables en cada
ejecución con backlog suficiente. Los estados desconocidos ya intentados respetan además el plazo
durable de reintento. Con 10 segundos de timeout de metadata, 100 fallos consecutivos pueden ocupar
unos 16 minutos y 40 segundos; no es necesario aumentar concurrencia.
La entrega binaria se hace por `/api/media/gencat/:imageId`; el navegador no recibe la URL DAM.
La activación efectiva requiere el despliegue y migración normales, que no forman parte de este
cambio local.

La sincronización no está gestionada por Node ni por PM2. Utiliza el `crontab` del usuario `root`:

```cron
PATH=/root/.nvm/versions/node/v24.18.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 */2 * * * cd /var/www/queFem && npm run import:gencat >> /var/log/quefem-import.log 2>&1
```

Se ejecuta cada dos horas, en el minuto 17, usa Node/npm instalado mediante NVM y guarda stdout y stderr en `/var/log/quefem-import.log`. El comando adquiere el lock atómico `<DATABASE_PATH>.gencat-import.lock` antes de abrir SQLite o contactar la fuente. Una invocación cron o manual concurrente termina correctamente con estado `skipped`; un lock cuyo proceso ya no existe se recupera mediante la misma identidad PID/inicio usada por los imports Fever.

## Página privada de revisión de DIBA

La cola `diba-review-queue.json` se revisa en una página privada (`npm run review:serve`, código en `backend/src/review/`). No tiene login porque **no es accesible desde internet**: escucha solo en `127.0.0.1:3015` del servidor (el host no es configurable), no es un proceso de PM2, no pasa por Nginx y se cierra sola tras 3 horas sin peticiones autenticadas. Se abre por un túnel SSH desde el equipo del propietario:

```bat
scripts\open-review-page.cmd root@servidor
```

(o definir una vez `TENSPLA_SSH_TARGET` y ejecutarlo sin argumentos; también sirve un `.bat` propio con la misma línea `ssh -tt -L 3015:127.0.0.1:3015 …`). Es un único `ssh` de OpenSSH, sin PowerShell: una versión anterior en PowerShell (`-ExecutionPolicy Bypass`, tarea en segundo plano que abre el navegador) la neutralizó el antivirus como falso positivo, así que no debe volver a escribirse así. El servidor genera un secreto por sesión, que solo existe en memoria, e imprime en la ventana el enlace `http://localhost:3015/?t=<secreto>`: hay que abrirlo (Ctrl+clic en Windows Terminal); al cerrar la ventana se detiene la página. Sin el secreto en la URL, `GET /` y `GET /api/items` devuelven 403, de modo que otro proceso del servidor que alcance el puerto local tampoco puede leer ni escribir. Además se comprueban el `Host` (contra DNS rebinding), el `Origin` y `Sec-Fetch-Site` de cada escritura, que sea `application/json`, y el HTML lleva una CSP estricta. Nunca hay que añadir un `location` de Nginx ni un proceso permanente para esta página.

Cada caso muestra los dos registros o planes lado a lado (título, fechas, hora de inicio, lugar, fuentes) con lo que coincide y lo que difiere:

- **Importar (fusionar)** ejecuta la misma fusión de `scripts/merge-duplicate-plans.js` (un plan pasa a ser alias 301 del otro), solo si cumple sus precondiciones: mismo título, fechas y municipio y el plan absorbido solo con procedencia DIBA y sin occurrences. En casos dentro de DIBA, dos sesiones del mismo día con hora distinta se pueden fusionar en una sola ficha: los planes de DIBA solo guardan fechas (la hora no se muestra), así que no se pierde información visible; la página muestra la hora de inicio de cada registro para que el revisor decida. Toma el lock de importación de DIBA (si hay una en curso responde 409), hace una transacción y guarda el SQL de rollback en `diba_review_decisions`. No tiene botón de deshacer.
- **Mantener separado** guarda una decisión `KEEP_SEPARATE` por registro en la tabla `diba_review_decisions` (migración 018). La importación la lee junto a `data-policy/diba-link-overrides.json` (el archivo de Git manda si ambos existen) y el caso deja de aparecer en la siguiente cola. «Deshacer» la borra y el caso vuelve.
- Una decisión revisada cuyo destino ya no existe (el evento público caducó y se purgó) no es una tarea: la importación la ignora y el registro se importa con normalidad. Solo se anota en el resumen de la ejecución (`staleDecisions`), nunca en la cola ni en la página, y no hace falta editar `data-policy/`. Es normal que aparezcan más con el tiempo, a medida que caducan los eventos enlazados.

La página lee la cola tal como la dejó la última importación; las decisiones tomadas se ocultan al instante y la cola se reescribe en la siguiente importación.

## Imágenes de Gencat que el origen ya no sirve

Gencat puede dejar registrada en su ficha una imagen cuyo archivo desaparece de `agenda.cultura.gencat.cat` (404). Cuando la ruta `/api/media/gencat/:id` recibe un 404 o un 410 del origen anota la dirección en `plan_source_images` (`unavailable_at`, `unavailable_status`) para todas las filas que la usan. Mientras la marca tenga menos de 7 días (`DEAD_IMAGE_RETRY_DAYS` en `imageAvailability.js`) la API no ofrece esa imagen —el plan muestra la foto genérica de la librería— y la ruta responde 404 sin consultar al origen; pasado ese plazo se ofrece de nuevo y, si el origen la sirve, la marca se borra. Solo cuenta un 404/410: los timeouts, errores 5xx, redirecciones y errores de capacidad no se anotan nunca. Si Gencat cambia la dirección de imagen de un plan, la marca se borra. Solo se aplica a Gencat.

Para marcarlas todas de una vez (por ejemplo tras desplegar) hay un script del operador:

```bash
node scripts/sweep-gencat-images.js                 # simulación: cuenta y lista las muertas
node scripts/sweep-gencat-images.js --apply         # las anota y limpia las que han vuelto
node scripts/sweep-gencat-images.js --concurrency=2 --delay-ms=300   # más suave
```

Pide cada dirección distinta una sola vez, de 4 en 4 y con una pausa entre peticiones (unos 100 segundos para ~1.500 direcciones), y los resultados dudosos (timeout, 5xx, otra respuesta) se informan pero no se tocan. Con `--apply` escribe un log en `data/consolidation-logs/`. Es idempotente y conviene repetirlo de vez en cuando (el primer barrido en producción fue el 2026-10-19 y marcó 12 direcciones).

## Nombres oficiales de comarca y municipio

Gencat publica comarca y municipio como slugs sin acentos. El normalizador de Gencat (`location.normalizer.js`) restaura la ortografía oficial del ICGC con `placeNameRestorer.js` (nombres de `backend/src/embed/officialPlaceNames.json`); lo que no tiene coincidencia única se deja como estaba. La provincia no se toca. La localidad (texto libre de Gencat y ciudad de Ticketmaster; ya llega con acentos pero con minúsculas, «Cornellà de llobregat») recibe el mismo tratamiento que el municipio: solo se corrige si coincide exactamente con un municipio oficial; un barrio («Poble sec») o un lugar fuera de Catalunya se quedan como están.

El importador de Gencat no refresca filas ya guardadas, así que las existentes se corrigen una vez con un script del operador (hacer antes un backup). Esa corrección se aplicó en producción el 2026-10-16 (1.406 planes); los planes nuevos de Gencat ya entran corregidos, así que no debería hacer falta repetirla, aunque es idempotente:

```bash
node scripts/restore-place-accents.js                                  # simulación: cuenta y lista las correcciones
node scripts/restore-place-accents.js --apply --expected-changes=<n> --expected-hash=<h>   # aplica; ambos valores los imprime la simulación
node scripts/restore-place-accents.js --fields=locality                # limita la corrección a una columna (hay que repetirlo con --apply)
```

Solo actualiza `plans.comarca`, `plans.municipality` y `plans.locality` (con `--fields`, solo las indicadas; no `updated_at`, fingerprints ni procedencias), en una transacción, y escribe un SQL de rollback y un log en `data/consolidation-logs/`. Si la cifra o la huella del conjunto de cambios no coincide con la real (aunque el número sea el mismo), aborta sin escribir. El SQL de rollback es condicional: solo revierte un nombre si sigue siendo el que puso la corrección. Es idempotente: una segunda ejecución no encuentra nada. Las URLs y filtros antiguos (`?comarca=Barcelones`) siguen funcionando, porque las comparaciones ignoran acentos y mayúsculas.

Los municipios que DIBA y Fever guardan con el artículo en minúscula («l'Hospitalet de Llobregat», «els Hostalets de Pierola», 16 planes el 2026-10-20) no se corrigen a propósito: Fever los reescribiría en la siguiente importación. Por eso la corrección de la localidad se aplica con `--fields=locality`.

## Sincronización recurrente de DIBA

El repositorio prepara `npm run diba:import:scheduled` para los tres feeds DIBA. Usa el mismo importador y lock que el comando manual real, rechaza argumentos, fija `allowMassRemoval=false`, escribe un resumen JSON en stdout, informa fallos por stderr y devuelve código distinto de cero si falla cualquier dataset. La ambigüedad nueva o una autorización que quede obsoleta antes de escribir revierte el dataset afectado.

El cron DIBA está instalado en producción (confirmado el 2026-10-14), diario a las 05:45, después del backup de las 05:10 y fuera del minuto 17 usado por Gencat:

```cron
45 5 * * * cd /var/www/queFem && /root/.nvm/versions/node/v24.18.0/bin/npm run diba:import:scheduled >> /var/log/quefem-diba.log 2>&1
```

El job programado nunca debe usar `npm run diba:import -- --allow-mass-removal`. Una retirada superior al 50 % requiere revisión y una ejecución manual explícita. Hasta ahora, cualquier duplicado dudoso sin revisar bloqueaba el feed completo (`UNRESOLVED_DIBA_AMBIGUITY`): desde al menos el 2026-09-30 `diba-tourisme` y `diba-escenari` no se actualizaban. El importador real (manual y programado) usa ahora la política `review-queue`; con `ambiguityPolicy: 'block'`, el valor por defecto de `DibaImporter`, se conserva el comportamiento antiguo. Con `review-queue`:

- Un posible duplicado de un plan público existente, un posible duplicado dentro del mismo feed y una decisión humana cuyo destino ya no existe **no bloquean**: el registro se importa como plan separado (o sin enlazar) y se anota en la cola de revisión. No se fusiona nada de forma silenciosa.
- Siguen bloqueando, por feed, la retirada de más del 50 %, un feed vacío o truncado, la salud del parser, los conflictos con una decisión humana vigente y la revalidación transaccional.
- La cola es `diba-review-queue.json` junto a la SQLite (`/var/www/queFem/data/`). Se reescribe de forma atómica en cada importación real (nunca en dry-run), conserva `firstSeenAt`, retira los casos ya resueltos y no borra el backlog de un feed que falló. No es una fuente de verdad del catálogo: si no se puede escribir, la importación continúa y el error sale por stderr.
- Cada elemento indica `kind` (`POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN`, o `POSSIBLE_DUPLICATE_WITHIN_FEED`), los registros DIBA con título, fechas, lugar y URL, los planes candidatos y la acción por defecto aplicada.

Un duplicado de la cola que una persona confirma como el mismo evento se resuelve con `node scripts/merge-duplicate-plans.js` (simulación por defecto; `--apply` para ejecutar; `--alias-plan-id=<id>` para uno solo). Lee `data-policy/duplicate-plan-merges.json`, exige mismo título, fechas y municipio, que el plan DIBA solo tenga procedencia `diba-*` y ninguna occurrence, y que el destino tenga procedencia Gencat activa. Mueve la procedencia al plan de Gencat, deja el plan DIBA como alias 301 (`plan_aliases`), usa una transacción por pareja y escribe un log y un SQL de rollback en `data/consolidation-logs/`. Hacer antes un backup.

La política se desplegó el 2026-10-14 y una pasada manual publicó de golpe lo acumulado durante el bloqueo (94 planes nuevos de Turisme y 386 de Escenari), incluidos como planes separados los posibles duplicados pendientes (19 frente a planes de Gencat). Una repetición no crea nada. Comprobar después `/var/log/quefem-diba.log`, el conteo de planes públicos y `diba-review-queue.json`.

Para comprobar o editar la configuración y consultar los últimos logs:

```bash
crontab -l
crontab -e
tail -100 /var/log/quefem-import.log
```

## Logging de Nginx y retención

La configuración externa confirmada escribe `access_log` en `/var/log/nginx/quefem-access.log` y `error_log` en `/var/log/nginx/quefem-error.log`. Logrotate fue ejecutado y verificado satisfactoriamente; se ejecuta diariamente con `rotate 14` y compresión, por lo que ambos logs se conservan aproximadamente 14 días. No hay una configuración logrotate versionada en este repositorio.

- Access logs: seguridad y diagnóstico técnico.
- Error logs: diagnóstico técnico.

El repositorio no gestiona `/etc/nginx` y estos cambios no se aplican mediante `deploy.sh`. La configuración aplicada define dentro del contexto `http` de Nginx un formato que usa `$uri` —path sin query string— y omite `Referer`:

```nginx
log_format quefem_privacy
    '$remote_addr - [$time_local] '
    '"$request_method $uri $server_protocol" '
    '$status $body_bytes_sent '
    '"$http_user_agent"';

access_log /var/log/nginx/quefem-access.log quefem_privacy;
error_log /var/log/nginx/quefem-error.log;
```

El formato conserva IP, fecha/hora, método HTTP, path sin parámetros, protocolo, status, bytes y User-Agent. No conserva query string ni cabecera `Referer`. La IP se mantiene porque se utiliza para seguridad y diagnóstico; el acceso a los logs debe limitarse al personal operativo autorizado.

Tras cualquier cambio manual futuro en esta configuración, validar y recargar sin interrumpir el servicio:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

No modificar la política actual de logrotate: rotación diaria, 14 rotaciones y compresión.

## Backups de producción

El sistema externo de backup de Tens Pla? está configurado, automatizado y probado. Crea una copia consistente de SQLite, ejecuta comprobaciones sobre el resultado y replica los backups mediante `rclone` a un remote de Google Drive cuyo destino funcional es `TensPla/backups`.

La automatización, la configuración de `rclone` y sus credenciales viven fuera del repositorio. No deben copiarse aquí ni mostrarse en salidas. Antes de una operación destructiva o de recuperación hay que verificar en el servidor la última ejecución correcta, la presencia de la copia externa y la restaurabilidad del backup aplicable. El estado confirmado no permite inferir desde Git comandos, horarios, rutas locales, retención o identificadores privados que no estén documentados.

Estado observado en el servidor el 2026-10-19 (sin credenciales ni rutas de configuración secretas):

- Una copia diaria a las 05:10 UTC (07:10 en España), de unos 10 segundos: `sqlite3 .backup` (consistente con WAL), `PRAGMA integrity_check` antes de comprimir, `gzip` (~15 MB) y subida con `rclone copyto --checksum`.
- Retención: **14 días en el servidor y 7 días en Google Drive**. La de Drive se redujo de 30 a 7 días el 2026-10-19 a petición del propietario (para no llenar la cuenta); `rclone delete` mueve lo borrado a la papelera de Drive. Solo se borran los `quefem_*.sqlite.gz`: los snapshots manuales previos a operaciones (`/var/backups/tenspla` y `/var/backups/quefem`) no tienen limpieza automática.
- Verificado ese día: 15 ejecuciones consecutivas correctas en los logs conservados, 0 diferencias de checksum entre las copias locales y las de Drive, y una restauración de prueba completa (descarga desde Drive, `integrity_check` correcto, datos coherentes con producción).
- La copia diaria cubre la base de datos. **Desde el 2026-10-20 el mismo script guarda además un paquete de configuración cifrado** (ver más abajo). Siguen sin copia la configuración de `rclone` (se vuelve a autorizar con `rclone config`) y `data/consolidation-logs/` (SQL de rollback); las cachés y la cola de revisión de DIBA se regeneran.
- **Avisos (desde el 2026-10-20):** el script avisa a healthchecks.io (comprobación «Tens pla - backup diario», cron `10 5 * * *` en UTC, 2 h de margen) al empezar, al terminar bien y al fallar, con el paso en el que falló (sin credenciales ni salida de `rclone`). healthchecks.io avisa por correo si llega un fallo o si pasan unas 2 h de las 05:10 UTC sin noticias (cron parado, servidor caído, proceso muerto). Telegram se puede añadir desde su web (Integrations), sin cambiar el script. La URL de aviso está en `/root/.tenspla-healthcheck-url` (modo 600, solo root, fuera de Git); si el fichero no existe o healthchecks no responde, el backup funciona igual.
- Comprobaciones añadidas al script: aborta con aviso si la base de datos no existe o está vacía (SQLite crearía una vacía y el backup saldría «correcto») y trata como sospechosa una copia que pese menos del 50 % de la anterior (se sube igualmente, se avisa y **no se borra ninguna copia antigua**). Las variables `TENSPLA_BACKUP_DB`, `TENSPLA_BACKUP_DIR`, `TENSPLA_BACKUP_REMOTE` y `TENSPLA_HEALTHCHECK_URL_FILE` existen solo para probar el script en una carpeta temporal.
- El script sigue siendo externo al repositorio (`/usr/local/sbin/tenspla-backup.sh`); las versiones anteriores están en `/root/tenspla-backup.sh.bak-20261020` y `/root/tenspla-backup.sh.bak-20261020-v2`.

### Paquete de configuración cifrado

Un fichero `tenspla-config_FECHA.tgz.cms` en `TensPla/config` de Google Drive (fuera de la regla de 7 días), con el `.env`, el crontab, la configuración de Nginx (`tenspla`, `quefem`, `umami`) y de logrotate de Tens pla, el propio script de backup, la URL de healthchecks, la definición de PM2 de `quefem-api` (sin variables de entorno), un `MANIFEST.txt` con huellas y un `LEEME-RESTAURAR.txt`. Se cifra con el **certificado público** del propietario (`/root/.tenspla-backup-cert.pem`, RSA 4096, CN `tenspla-backup`): el servidor puede cifrar pero no descifrar. La clave privada `tenspla-backup-private.pem` y su contraseña **solo las tiene el propietario** (gestor de contraseñas más una copia aparte) y no están en el servidor, en el repositorio ni en Drive. Si se pierden, los paquetes son irrecuperables.

- Solo se sube una versión nueva si el contenido cambió (huella de un tar determinista en `/var/backups/tenspla-config/last.sha256`); se conservan las últimas 10 en Drive y 3 en `/var/backups/tenspla-config`. La huella solo se guarda tras una subida correcta, así que un fallo se reintenta en la siguiente ejecución.
- La carpeta de trabajo con el `.env` en claro se borra siempre, también si el script falla. Un fallo en este paso avisa a healthchecks.io con el paso exacto, después de haber guardado ya la copia de la base de datos.
- Para restaurarlo: descargar el fichero desde Drive y, en PowerShell (en el PC del propietario `openssl` no está en el PATH, pero viene con Git):

```powershell
& "C:\Program Files\Git\mingw64\bin\openssl.exe" cms -decrypt -binary -inform DER -in tenspla-config_FECHA.tgz.cms -inkey tenspla-backup-private.pem -out tenspla-config.tgz
```

```powershell
tar -xzf tenspla-config.tgz
```

  Pide la contraseña de la clave privada. Para generar de nuevo la pareja de claves en PowerShell: `& "C:\Program Files\Git\mingw64\bin\openssl.exe" req -x509 -newkey rsa:4096 -keyout tenspla-backup-private.pem -out tenspla-backup-cert.pem -days 36500 -subj "/CN=tenspla-backup"` (en Git Bash hace falta anteponer `MSYS_NO_PATHCONV=1`) y sustituir el certificado en el servidor; los paquetes antiguos solo se descifran con la clave antigua.
- Las decisiones tomadas en la página de revisión de DIBA y los aliases de las fusiones se guardan en SQLite y quedan sin copia hasta la siguiente ejecución diaria.

## Avisos de los crons y salud (healthchecks.io)

Desde el 2026-10-20, además del backup, healthchecks.io (aviso por correo) vigila las importaciones y la salud general. Todo vive fuera del repositorio y va incluido en el paquete cifrado de configuración.

- `/usr/local/sbin/tenspla-job <nombre> <comando>`: envoltorio de los crons de **Gencat** (`17 */2 * * *`, grace 30 min), **Fever** (`5 1,7,13,19 * * *`, 30 min) y **DIBA** (`45 5 * * *`, 1 h), todos en UTC. Ejecuta el comando igual que antes (misma salida y código de salida), avisa al empezar y al terminar y, si falla, envía las últimas líneas de la salida con las claves tapadas. Si falta la URL o healthchecks no responde, el trabajo se ejecuta igual. Un «skipped» por bloqueo sale con código 0 y cuenta como correcto.
- `/usr/local/sbin/tenspla-health.sh` (`27 * * * *`, grace 20 min, log en `/var/log/tenspla-health.log`): solo lee. Comprueba web y API (pública y local), `quefem-api` en PM2 sin reinicios en bucle, certificado (más de 14 días), disco (menos del 85%), importaciones al día (Gencat y Ticketmaster 5 h, Fever 9 h, DIBA 27 h) y sin última importación fallida, caída de planes activos (más del 20% en 20 h o más) y copia de seguridad de las últimas 26 h. Los umbrales se cambian con variables `TENSPLA_HEALTH_*`.
- `/usr/local/sbin/tenspla-alive.sh` (`*/5 * * * *`, grace 5 min): comprueba que la web y la API (pública y local) responden y avisa solo si todo va bien; si el servidor o la web caen, el aviso deja de llegar y healthchecks.io alerta en unos 10 min (el chequeo horario tardaría ~80). Solo escribe en `/var/log/tenspla-health.log` cuando hay fallo. No ve problemas de DNS o de red vistos desde internet; para eso haría falta un monitor externo (p. ej. UptimeRobot), descartado por ahora.
- Las URLs de ping están en `/root/.tenspla-healthchecks` (líneas `gencat=`, `diba=`, `fever=`, `health=`, `alive=`; permisos 600). El estado de la comprobación horaria está en `/var/lib/tenspla-health/`.
- Ticketmaster no tiene check propio: lo cubre el de salud. Copia del crontab anterior: `/root/crontab.bak-20261020`.

## Cabeceras de seguridad de Nginx

La configuración externa aplicada incluye HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` y `server_tokens off`. Observado en el servidor el 2026-09-30: también se envía una cabecera `Content-Security-Policy` **obligatoria** (no `Report-Only`) con `frame-ancestors 'none'`. El propietario confirmó el mismo día que es el estado deseado y debe mantenerse; el comentario de la configuración de Nginx ya lo refleja.

El widget incrustable tiene una excepción aplicada el 2026-09-30: `location ^~ /embed/` hacia el
backend, sin `X-Frame-Options` ni la CSP del sitio, porque Express envía `frame-ancestors` por
widget. El bloque exacto y sus comprobaciones están en [`EMBED_WIDGET.md`](EMBED_WIDGET.md).

Estas cabeceras no están gestionadas por Git ni por `deploy.sh`; verificar siempre la configuración efectiva del servidor y ejecutar `nginx -t` antes de recargar.

## Revisión legal previa a cambios de producto

Antes de introducir monetización o cualquier actividad económica debe revisarse el aviso legal. Antes de añadir analítica, publicidad, cookies, seguimiento, cuentas, login, formularios o nuevos usos de almacenamiento local debe revisarse la documentación de privacidad y almacenamiento e implementar, cuando corresponda, el consentimiento antes del despliegue.

## Purga de planes inactivos

La política interna conserva durante 7 días los planes que han quedado `inactive` y sin ninguna procedencia. El plazo se mide exclusivamente desde `plans.inactive_at`; no se utiliza `updated_at`.

Comprobar primero sin escrituras:

```bash
npm run purge:inactive -- --dry-run
```

Después de revisar el resultado y disponer de un backup consistente, la ejecución es:

```bash
npm run purge:inactive
```

La operación valida el schema, exige `status='inactive'`, `inactive_at` con al menos 7 días y ausencia total de `plan_sources`. Elimina `plan_categories` dentro de la misma transacción y después el plan; no elimina categorías compartidas, fuentes ni `import_runs`.

En producción se ejecuta una vez al día mediante cron (confirmado el 2026-10-14), tras el backup de las 05:10 del día anterior y antes del siguiente:

```cron
45 3 * * * cd /var/www/queFem && npm run purge:inactive >> /var/log/quefem-purge.log 2>&1
```

Revisar `/var/log/quefem-purge.log` para ver cuántos planes elimina cada ejecución.
