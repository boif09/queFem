# Despliegue de Tens pla?

Este documento describe la infraestructura actual de producción. La sincronización de datos y el despliegue de código son procesos separados.

La marca pública es Tens pla? y el dominio público principal activo es `https://tenspla.cat`. `https://www.tenspla.cat` redirige al dominio principal. `https://quefem.jusboif.es` permanece temporalmente como dominio legacy pendiente de redirección. Las rutas, servicios y nombres internos legacy `quefem` no se modifican.

## Servidor

```text
Proveedor: Hetzner
Ubicación: Falkenstein, Alemania (eu-central)
Directorio del proyecto: /var/www/queFem
URL pública: https://tenspla.cat
```

Hetzner aloja el frontend, backend, SQLite, infraestructura web y logs técnicos. Existe un acuerdo de encargo del tratamiento conforme al artículo 28 del RGPD. El correo de `contacte@tenspla.cat` está alojado por OVHcloud.

## Backend

El backend utiliza Node.js y Express, escucha en el puerto `3014` y está gestionado por PM2 con el nombre `quefem-api`.

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

La configuración real actual escribe `access_log` en `/var/log/nginx/quefem-access.log` y `error_log` en `/var/log/nginx/quefem-error.log`. Logrotate se ejecuta diariamente con `rotate 14` y compresión, por lo que ambos logs se conservan aproximadamente 14 días.

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

Este ejemplo no está activo. No añadir al crontab hasta aprobar el horario, verificar el dry-run de producción y completar el procedimiento de backup y monitorización.
