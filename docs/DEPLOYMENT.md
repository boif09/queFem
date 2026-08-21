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
segundos y un máximo de 10 MiB por imagen.

El comando utiliza un lock atómico dentro de la caché. Una segunda ejecución sale correctamente
sin sincronizar; un lock cuyo PID ya no existe se recupera automáticamente.

Cron definitivo propuesto, todavía no aplicado, cada dos horas después del import Ticketmaster:

```cron
52 */2 * * * cd /var/www/queFem && npm run ticketmaster:images:sync >> /var/log/quefem-ticketmaster-images.log 2>&1
```

## SEO V1, sitemap público y Search Console

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

La sincronización no está gestionada por Node ni por PM2. Utiliza el `crontab` del usuario `root`:

```cron
PATH=/root/.nvm/versions/node/v24.18.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 */2 * * * cd /var/www/queFem && npm run import:gencat >> /var/log/quefem-import.log 2>&1
```

Se ejecuta cada dos horas, en el minuto 17, usa Node/npm instalado mediante NVM y guarda stdout y stderr en `/var/log/quefem-import.log`.

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

## Cabeceras de seguridad de Nginx

La configuración externa aplicada incluye HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` y `server_tokens off`. La CSP todavía no está aplicada: debe probarse primero como `Content-Security-Policy-Report-Only` y validarse manualmente antes de hacerla obligatoria.

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

En el futuro puede ejecutarse una vez al día mediante cron:

```cron
# Horario pendiente de aprobación
cd /var/www/queFem && npm run purge:inactive >> /var/log/quefem-import.log 2>&1
```

Este ejemplo no está activo. No añadirlo al crontab hasta aprobar el horario, verificar el dry-run de producción y confirmar que el backup y la monitorización externos vigentes cubren esta operación.
