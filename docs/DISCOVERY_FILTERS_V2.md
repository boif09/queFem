# Discovery & Filters V2

Implementado el 2026-08-21. La búsqueda de planes combina en una misma consulta texto, fechas, territorio, categorías y gratuidad; el estado se conserva en parámetros de URL y los cambios se aplican de inmediato con debounce para el texto.

## Comportamiento

- Fechas rápidas: hoy, mañana, viernes-domingo del fin de semana actual/siguiente y próximos siete días; también admite fecha o rango personalizado. Los eventos de varios días se seleccionan por solapamiento y los permanentes se conservan detrás de los eventos fechados en la ordenación temporal.
- Territorio: provincia, comarca y municipio son opcionales e independientes. Provincia restringe comarca y municipio; comarca restringe municipio; una incompatibilidad limpia solo los niveles inferiores. El municipio es único, buscable sin distinguir mayúsculas ni acentos, muestra `municipio · comarca · provincia` y admite los alias de búsqueda simples Gerona/Girona y Lérida/Lleida sin duplicar valores canónicos.
- Categorías: multiselección serializada como slugs separados por comas; el backend aplica semántica OR. El formato anterior con un único slug sigue siendo válido.
- Estado: los filtros activos son eliminables individualmente y existe limpieza global tanto junto a los chips como en el estado vacío.

## API geográfica

- `GET /api/provinces`
- `GET /api/comarques?province=...`
- `GET /api/municipalities?province=...&comarca=...`

Las comarcas y los municipios incluyen su contexto territorial. Los catálogos se derivan de planes visibles para no ofrecer selecciones sin resultados y no implican un wizard obligatorio.

## Filtros no publicados

La base local auditada contenía 2.029 planes activos: `family_friendly` solo estaba informado positivamente en 286 (14,1 %) y no distinguía falsos de desconocidos; `indoor` y `outdoor` eran desconocidos en el 100 %. Por ello no se exponen filtros familiar ni interior/exterior: su cobertura actual produciría resultados engañosos. Podrán reevaluarse si la normalización futura aporta valores fiables y una semántica explícita para positivo, negativo y desconocido.
