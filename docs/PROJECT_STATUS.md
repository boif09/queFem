# Tens pla? - Project Status

Last updated: 2026-08-19

## Completado

### Milestone 1

- Gencat Agenda importer
- normalización
- SQLite
- source/licence registry
- filtrado de registros fuera de Catalunya
- filtrado de eventos caducados
- validación de fechas anómalas o incoherentes

### Milestone 2

- Express REST API
- filtros
- paginación
- detalle de plan
- atribución de fuentes
- tests

### Milestone 3

- frontend React
- interfaz en catalán y castellano
- catalán por defecto
- buscador
- filtros
- resultados
- detalle
- página de fuentes
- minimapa de ubicación en el detalle para planes con coordenadas, enlazado a Google Maps
- búsqueda textual por títulos y recinto, parcial y sin distinguir mayúsculas o acentos

### Rebranding Pop Editorial

- Marca pública cambiada de Què Fem? a **Tens pla?**.
- Sistema visual **Pop Editorial / Mediterranean Pop** aplicado a home, resultados, detalle, estados y páginas informativas.
- Montserrat Variable autoalojada mediante Fontsource, sin Google Fonts ni iconos remotos.
- Home conectada a datos reales con búsqueda `q`, accesos rápidos, “Passa avui” y categorías reales.
- Cards y heroes sin fotografías basados en patrones gráficos por slug de categoría, con fallback genérico.
- Dominio futuro `tenspla.cat` reservado pero no activo; producción continúa en `https://quefem.jusboif.es`.
- Email e identificadores internos legacy `quefem` permanecen hasta una migración posterior de dominio e infraestructura.

### Milestone 4A — Ticketmaster

- Ticketmaster Discovery Feed 2.0 de España implementado como segunda fuente.
- Pipeline validado mediante dry-run sin escrituras.
- Primera importación real completada y validada en SQLite local.
- Idempotencia comprobada con una segunda ejecución: 0 inserciones, 0 actualizaciones y 71 planes sin cambios.
- API REST y frontend comprobados manualmente en navegador, incluyendo resultados, filtros, detalle y atribución.
- Integración técnicamente cerrada en local.
- Producción, cron y activación automática continúan **bloqueados hasta completar la revisión legal, de términos y privacidad**.

### Páginas legales y preparación de privacidad

- Montserrat Variable se empaqueta como WOFF2 local mediante Fontsource y licencia OFL; el frontend no necesita Google Fonts.
- OpenStreetMap solo se carga después de que el visitante pulse “Veure mapa”/“Ver mapa”.
- La retirada manual por Ticketmaster event ID dispone de dry-run, transacción e idempotencia y reutiliza la lógica de desactivación de reconciliation.
- Las solicitudes expresas disponen además de `--purge`: elimina físicamente un plan exclusivamente Ticketmaster en la misma transacción, pero conserva cualquier plan que mantenga otra fuente.
- El runbook operativo fija `contacte@jusboif.es` como canal y un objetivo inferior a 24 horas.
- La configuración Nginx minimizada está aplicada: registra IP, fecha/hora, método, path sin query, protocolo, estado, bytes y User-Agent; omite query strings y `Referer`. Los logs rotan a diario y se conservan aproximadamente 14 días.
- Los planes sin fuentes pasan a `inactive` con un `inactive_at` explícito. Una purga independiente puede eliminarlos físicamente al cumplir 7 días, previa validación de estado, antigüedad y ausencia de fuentes.
- La purga dispone de dry-run, transacción, rollback e idempotencia. Su futura automatización diaria está documentada, pero no se ha añadido ningún cron.
- Aviso legal, privacidad, almacenamiento local y contacto están implementados en catalán y castellano, con enlaces permanentes desde el footer.
- Xavier Delgado Garcia consta como responsable y `contacte@jusboif.es` como único canal público; no se publican datos privados adicionales.
- La documentación refleja Hetzner en Falkenstein (Alemania, `eu-central`) con acuerdo de encargo del tratamiento, OVHcloud para el correo, ausencia de cookies/analítica/seguimiento y carga voluntaria de servicios externos.
- Ticketmaster no se ha activado en producción.

### Producción

- aplicación desplegada y funcionando en `https://quefem.jusboif.es`
- backend Node.js/Express gestionado por PM2 como `quefem-api`, puerto 3014
- SQLite
- frontend estático servido por Nginx
- sincronización de Gencat cada dos horas mediante cron externo
- despliegue de código mediante `./deploy.sh`

## Fuentes activas en local

- Agenda Cultural de Catalunya
- Ticketmaster Discovery Feed España

## Estado de Ticketmaster en producción

- La única fuente sincronizada automáticamente en producción sigue siendo Agenda Cultural de Catalunya.
- Ticketmaster no tiene cron ni activación en producción.
- Las páginas legales y de privacidad ya están implementadas. Su activación pública requiere todavía la aprobación final de los términos aplicables.

## Próximas fuentes evaluadas

- Fever: solo se integrará si se obtiene acceso autorizado a una API, feed o acuerdo de partner.

## Decisiones vigentes

- Catalán como idioma principal y castellano completamente soportado en la interfaz.
- Solo se publican planes de Catalunya.
- `EVENT_RETENTION_DAYS=0`: no se conservan eventos finalizados antes de hoy.
- `INACTIVE_PLAN_RETENTION_DAYS=7`: política interna para planes inactivos sin fuentes, medida desde `inactive_at`.
- Los planes permanentes no se eliminan por antigüedad.
- No se hace scraping ni se incorporan fuentes sin aprobación legal previa.
- No se reutilizan imágenes externas sin derechos claros.
- Siempre se conserva la atribución y procedencia de los datos.
- Antes de introducir monetización o actividad económica debe revisarse el aviso legal.
- Antes de introducir analítica, publicidad, cookies, seguimiento, cuentas o formularios debe revisarse privacidad y almacenamiento e implementar el consentimiento que corresponda antes del despliegue.

## No implementar todavía

- Viator
- Civitatis
- Tiqets
- planes permanentes
- mapas avanzados y búsqueda por proximidad
- favoritos
- IA
- monetización
- scraping
- nuevas fuentes no aprobadas
