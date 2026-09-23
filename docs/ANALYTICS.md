# Analítica de afiliación y social

Tens Pla? carga Umami autoalojado desde `stats.tenspla.cat`. Sus pageviews automáticos conservan la URL inicial con UTM. No existe un evento `social_landing`: duplicaría esa información.

La atribución social es de primer contacto por sesión de pestaña. Solo se acepta `utm_source=instagram` o `utm_source=tiktok` junto con `utm_medium=social`. Se guarda en `sessionStorage`, no usa cookies ni `localStorage`, desaparece cuando acaba la sesión de la pestaña y un enlace social posterior no puede sobrescribir el primer contacto. No se guardan URL, referrer, otros parámetros ni identificadores de usuario.

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

El CTA `affiliate_click` no bloquea, retrasa ni modifica la navegación al enlace de Impact. Esta fase mide hasta el clic saliente afiliado, no una venta ni una comisión: la atribución de ingresos de Impact/Fever no está implementada.

## Comprobación manual en producción

1. Abrir un enlace social de ejemplo en una pestaña nueva y visitar una colección y un detalle Fever.
2. Pulsar una vez «Veure entrades a Fever» / «Ver entradas en Fever» y confirmar que Fever se abre normalmente.
3. En Umami, comprobar `collection_view`, `plan_view` y `affiliate_click` con los campos social y las propiedades propias esperadas.
4. Comparar el recuento de clics salientes con Impact cuando sea necesario, sin inferir ventas o comisiones.
