# Què Fem? - Project Status

Last updated: 2026-08-18

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

### Producción

- aplicación desplegada y funcionando en `https://quefem.jusboif.es`
- backend Node.js/Express gestionado por PM2 como `quefem-api`, puerto 3014
- SQLite
- frontend estático servido por Nginx
- sincronización de Gencat cada dos horas mediante cron externo
- despliegue de código mediante `./deploy.sh`

## Fuente activa

- Agenda Cultural de Catalunya

## Próximas fuentes evaluadas

- Ticketmaster: previsiblemente será la siguiente integración.
- Fever: solo se integrará si se obtiene acceso autorizado a una API, feed o acuerdo de partner.

## Decisiones vigentes

- Catalán como idioma principal y castellano completamente soportado en la interfaz.
- Solo se publican planes de Catalunya.
- `EVENT_RETENTION_DAYS=0`: no se conservan eventos finalizados antes de hoy.
- Los planes permanentes no se eliminan por antigüedad.
- No se hace scraping ni se incorporan fuentes sin aprobación legal previa.
- No se reutilizan imágenes externas sin derechos claros.
- Siempre se conserva la atribución y procedencia de los datos.

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
