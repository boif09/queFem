# Analítica de afiliación

Tens Pla? carga Umami autoalojado desde `stats.tenspla.cat`. El CTA de detalle de Fever envía el evento personalizado `affiliate_click` mediante el helper de frontend `trackAffiliateClick`; no bloquea, retrasa ni modifica la navegación al enlace de Impact.

Las propiedades son compactas y deterministas: `source=fever`, `plan_id`, `source_record_id` (el `CatalogItemId` de Fever), `placement=detail_cta` y `language` (`ca` o `es`). No se envían la URL de afiliación, texto del plan, parámetros de consulta ni identificadores de usuario.

## Comprobación manual en producción

1. Abrir el detalle de un plan de Fever en Tens Pla?.
2. Pulsar una vez «Veure entrades a Fever» / «Ver entradas en Fever» y confirmar que Fever se abre normalmente.
3. En Umami, comprobar un `affiliate_click` con `source=fever`, `placement=detail_cta`, el ID del plan y el `source_record_id` esperado.
4. Más adelante, comparar este recuento con los clics que informa Impact.
