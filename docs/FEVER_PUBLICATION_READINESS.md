# Fever M5A: preparación de publicación

M5A prepara la presentación pública de Fever sin activarla: la source `fever` continúa `enabled=0`, `FEVER_IMAGES_ENABLED` vale `false` por defecto y no existe cron ni escritura autorizada sobre la SQLite real.

## Categorías y precio

El mapping versionado usa exclusivamente etiquetas exactas, sin distinguir mayúsculas, de `SubCategory`; nunca usa `Category`/Tier. Solo produce slugs existentes. Las etiquetas desconocidas quedan sin categoría y no descartan el plan. En planes Fever-only se reconcilia el conjunto; en planes shared solo se añaden asociaciones y no se eliminan categorías de otras fuentes. `plan_categories` no guarda procedencia: M5A no resuelve ownership ni composición multi-source, por lo que una categoría Fever antigua puede permanecer en un plan shared.

El precio público es estructurado (`free|fixed|from|unknown`, amount y currency cuando proceden). Solo se acepta EUR numérico no negativo. Si los números de `Labels` contradicen `CurrentPrice`, queda `unknown`; los datos raw permanecen en el payload. CA/ES se traducen en frontend.

## Occurrences, afiliación e imágenes

Los listados exponen `nextOccurrence`; detail expone hasta 10 `nextOccurrences` activas desde hoy y `hasMoreOccurrences`. Toda query pública occurrence-aware solo considera `plan_sources` cuya `source.enabled=1`; las sources disabled no influyen en visibilidad, filtros, orden, occurrences ni fuentes expuestas. La UI occurrence-aware muestra la próxima sesión, nunca el intervalo resumen del plan, y no inventa hora para sesiones date-only.

Las consultas occurrence-aware con el catálogo Fever completo necesitan benchmark y optimización explícita antes de activar producción; M5A no añade índices especulativos, caches ni materializa próximas sessions.

El CTA usa literalmente `plan_sources.source_url` (`fever.pxf.io`) y se acompaña de disclosure CA/ES. La compra y la relación contractual ocurren en Fever; la comisión posible no afecta ranking.

Solo `ImageUrl` primaria HTTPS de `applications-media.feverup.com` puede persistirse. `plan_source_images` conserva roles card/detail sin blobs; como Impact no declara dimensiones, usa `ratio=unknown` y el sentinel interno 1×1, que la API no presenta como dimensiones reales. Con el flag habilitado, `/api/media/fever/:imageId` sirve caché same-origin con timeout, límite de bytes, tipos raster permitidos y sin aceptar URLs del cliente. Sin flag o imagen se usa el fallback local.

## Geografía

Los tres casos marítimos unresolved conservan venue, address, coordenadas offshore y administración NULL. No se usa `Text2`, nearest ni meeting point. La página de fuentes atribuye ICGC, Divisions administratives, CC BY 4.0, snapshot y transformaciones realizadas.
