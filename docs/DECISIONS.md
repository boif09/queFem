# Decisiones confirmadas

Registro ligero de decisiones demostrables en documentación, configuración o código.

## Producto e identidad

- El nombre público es **Tens Pla?**; identificadores legacy `queFem`, `quefem` y «Què Fem?» se conservan cuando cambiarlos afectaría compatibilidad técnica.
- Catalunya es el ámbito territorial. El catalán es idioma principal y predeterminado; el castellano debe tener soporte completo.

## Datos y contenido

- Se priorizan fuentes oficiales y datos abiertos. Una fuente nueva requiere revisar licencia/términos; no se hace scraping sin aprobación explícita.
- La procedencia, atribución y actualización se conservan por registro. El plan canónico puede tener varias fuentes.
- No se presupone que las imágenes sean reutilizables. Gencat se importa sin ellas; las Ticketmaster quedan ligadas a su procedencia y desactivadas por defecto.
- La deduplicación multi-source es conservadora: una coincidencia dudosa se revisa, no se fusiona silenciosamente.
- Los planes permanentes se conservan. Retirada y purga ofrecen dry-run y límites transaccionales.

## Arquitectura, privacidad y operación

- SQLite es la persistencia canónica actual y la API pública es de solo lectura.
- El backend escucha en `127.0.0.1` por defecto; Nginx es la capa pública en producción.
- El frontend usa recursos locales/same-origin cuando es posible. Montserrat se empaqueta localmente.
- OpenStreetMap no se carga hasta que el usuario activa el minimapa. La implementación no incorpora analítica ni seguimiento; la preferencia de idioma se guarda localmente.
- Sincronización de datos y despliegue son procesos separados. Gencat usa cron externo; Ticketmaster y sus imágenes no se activan en producción sin aprobación específica.
- Deploy, SSH, PM2, Nginx, cron, importaciones reales, commits y push requieren autorización explícita.

Detalles: [`DATA_SOURCES.md`](DATA_SOURCES.md), [`DEPLOYMENT.md`](DEPLOYMENT.md) y [`TICKETMASTER_REMOVAL.md`](TICKETMASTER_REMOVAL.md).
