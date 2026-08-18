# Despliegue de Què Fem?

Este documento describe la infraestructura actual de producción. La sincronización de datos y el despliegue de código son procesos separados.

## Servidor

```text
Proveedor: Hetzner
Directorio del proyecto: /var/www/queFem
URL pública: https://quefem.jusboif.es
```

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

La aplicación se publica mediante HTTPS en `https://quefem.jusboif.es`.

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
