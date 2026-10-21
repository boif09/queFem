# Analítica de afiliación y social

Tens Pla? carga Umami autoalojado desde `stats.tenspla.cat` (Umami 3.3.1 en Docker con PostgreSQL, en el mismo servidor; comprobado el 2026-10-21). Sus pageviews automáticos conservan la URL inicial con UTM. No existe un evento `social_landing`: duplicaría esa información.

Privacidad de Umami (desde 2026-10-21):

- El script lleva `data-do-not-track="true"`: si el navegador tiene activado «No rastrear», Umami no envía nada.
- `frontend/public/umami-before-send.js` (cargado antes de Umami y conectado con `data-before-send`) quita de la URL y del referrer los identificadores de clic que añaden redes y plataformas de anuncios (`fbclid`, `gclid`, `ttclid`, `msclkid`, `twclid`, `li_fat_id`, `igshid`…). Los `utm_*` se conservan.
- Umami no guarda la IP; la usa en el momento, con el navegador y una sal mensual, para el identificador de sesión. Guarda país, región y ciudad aproximados.
- Conservación: 24 meses, aplicada con `scripts/umami-retention.sh` (ver [`DEPLOYMENT.md`](DEPLOYMENT.md)).

La atribución social es de primer contacto y vive **solo en memoria**: dura mientras se navega por la SPA y se pierde al recargar la página. No escribe nada en el dispositivo (ni cookies, ni `localStorage`, ni `sessionStorage`), así que no necesita consentimiento de almacenamiento; al arrancar se borra la copia en `sessionStorage` que dejaban versiones anteriores. Solo se acepta `utm_source=instagram` o `utm_source=tiktok` junto con `utm_medium=social`, y un enlace social posterior no puede sobrescribir el primer contacto. No se guardan URL, referrer, otros parámetros ni identificadores de usuario.

Los campos social opcionales son `social_campaign` y `social_content`; se normalizan a minúsculas y solo admiten identificadores compactos de hasta 80 caracteres (`a-z`, `0-9`, `.`, `_`, `-`). La convención es `utm_campaign={yyyy}w{ww}-{pillar}` y `utm_content={content_id}.{surface}`. Nunca se etiquetan enlaces internos.

Ejemplo de Story de Instagram:

`https://tenspla.cat/cap-de-setmana?utm_source=instagram&utm_medium=social&utm_campaign=2026w39-capsetmana&utm_content=20260925-capsetmana5.story`

Ejemplo de enlace de bio (con una campaña actualizada semanalmente):

`https://tenspla.cat/cap-de-setmana?utm_source=instagram&utm_medium=social&utm_campaign=2026w39-capsetmana&utm_content=20260925-capsetmana5.bio`

## Eventos personalizados

| Evento | Cuándo | Propiedades |
| --- | --- | --- |
| `collection_view` | Una vez por cada navegación a `avui`, `cap-de-setmana` o `plans`; los cambios de filtro, paginación o query dentro de la misma colección no lo repiten, pero volver tras visitar otra página sí | `collection`, `language` (`ca` o `es`) y los campos social disponibles |
| `plan_view` | Una vez por cada navegación correcta a un plan; un refetch por cambio de idioma del mismo plan no lo repite | `plan_id`, `has_affiliate`, `language` y los campos social disponibles |
| `affiliate_click` | Clic en el CTA de Fever | `source=fever`, `plan_id`, `source_record_id` (el `CatalogItemId` de Fever), `placement=detail_cta`, `language` y los campos social disponibles |
| `favorite_add` / `favorite_remove` | Clic en el corazón de un plan (desde 2026-10-21) | `plan_id`, `placement` (`card` o `detail`), `language` y los campos social disponibles |
| `plan_share` | Se abre la hoja de compartir del sistema o se copia el enlace de un plan (desde 2026-10-21); cancelar la hoja no cuenta | `plan_id`, `method` (`native` o `copy`), `language` y los campos social disponibles |

El CTA `affiliate_click` no bloquea, retrasa ni modifica la navegación al enlace de Impact. Esta fase mide hasta el clic saliente afiliado, no una venta ni una comisión: la atribución de ingresos de Impact/Fever no está implementada.

## Comprobación manual en producción

1. Abrir un enlace social de ejemplo en una pestaña nueva y visitar una colección y un detalle Fever.
2. Pulsar una vez «Veure entrades a Fever» / «Ver entradas en Fever» y confirmar que Fever se abre normalmente.
3. En Umami, comprobar `collection_view`, `plan_view` y `affiliate_click` con los campos social y las propiedades propias esperadas.
4. Comparar el recuento de clics salientes con Impact cuando sea necesario, sin inferir ventas o comisiones.
