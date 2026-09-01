# DIBA M1.4B — política de calidad previa a activación

Estado: política aprobable para una implementación posterior M1.4C. Este documento no cambia importación, matching, esquema ni SQLite. Las fuentes DIBA continúan `enabled=0`.

## Objetivo y límites

La prioridad es no publicar dos tarjetas para un mismo hecho real sin confundir funciones, sesiones o fechas distintas. Las decisiones son deterministas, explicables y reversibles a nivel de procedencia. Una coincidencia posible nunca se fusiona automáticamente. Las referencias son el informe M1.4A.1 local y los contratos ya implementados de identidad (`source key + acte_id`), `plan_sources`, `plans` y ocurrencias.

## A. Matriz de conflictos dentro del mismo feed

| Decisión | Evidencia obligatoria | Resultado M1.4C |
| --- | --- | --- |
| `SAFE_CONSOLIDATE` | Mismo dataset; título y municipio normalizados iguales; intervalo idéntico; componente clique; URL efectiva DIBA idéntica y específica de evento; misma sede; horario bruto presente e idéntico; y al menos una corroboración de ubicación (dirección o coordenadas cercanas). | Un plan canónico DIBA con varios `plan_sources`; no se crea ocurrencia nueva. |
| `KEEP_SEPARATE_SESSION` | Mismo día pero hora distinta, o misma hora con duración distinta, o cualquier horario/sesión contradictorio. | Planes/procedencias separados; solo pueden publicarse simultáneamente si la representación pública actual distingue inequívocamente la sesión. En caso contrario, `DEFER`. |
| `KEEP_SEPARATE_DATE` | Inicio/fin no idénticos, aunque el título, el recinto o el programa coincidan. | Planes/procedencias separados. |
| `NEEDS_HUMAN_REVIEW` | Horario ausente o incompleto; URL de programa/no específica; evidencia no-clique; o falta de la combinación anterior. | Sin consolidación automática; decisión explícita versionada si procede. |

Un `acte_id` distinto no impide `SAFE_CONSOLIDATE`: la identidad estable de cada procedencia se conserva. A la inversa, recinto, dirección, coordenadas o URL de programa por sí solos nunca bastan. `HIGH_CONFIDENCE_DUPLICATE_CANDIDATE` del informe significa prioridad de revisión, no autorización de merge.

Reglas de sesión:

- Horarios idénticos y duración idéntica: pueden ser duplicados solo si satisfacen toda la fila `SAFE_CONSOLIDATE`.
- Horarios distintos: `KEEP_SEPARATE_SESSION`.
- Misma hora y distinta duración: `KEEP_SEPARATE_SESSION`.
- Horario ausente en uno o ambos: `NEEDS_HUMAN_REVIEW`; no se presupone una única sesión.
- `diba-museus-1` y `diba-museus-2` quedan siempre en revisión mientras su evidencia de sesión sea contradictoria.
- No se publican simultáneamente sesiones distintas si su distinción vive solo en `schedule_text` y la ficha/tarjeta pública actual no expone información estructurada suficiente. La decisión de activación en ese caso es `DEFER`: no se fusionan, no se inventan ocurrencias ni se fabrica una hora estructurada.

## B. Matriz DIBA ↔ plan con fuente habilitada

| Decisión | Evidencia y ámbito | Efecto futuro |
| --- | --- | --- |
| `AUTO_LINK_TO_EXISTING_PUBLIC_PLAN` | Solo componente completo 1:1, o componente que se vuelve 1:1 tras `SAFE_CONSOLIDATE` interno. Título, municipio e intervalo idénticos; y **(sede + coordenadas cercanas)** o identidad externa específica equivalente. | El plan público existente conserva su `plan_id`; se añade/traslada la procedencia DIBA. |
| `POSSIBLE_DUPLICATE_HUMAN_REVIEW` | Igualdad de título/municipio/intervalo sin prueba fuerte, o componente no 1:1, o solo sede, o solo coordenadas. | No enlace automático; override explícito si se aprueba. |
| `KEEP_SEPARATE` | Fechas/sesiones incompatibles, títulos/municipios distintos, o revisión que determina hechos distintos. | Se conserva la procedencia en su plan propio. |
| `IGNORE_FOR_CURRENT_VISIBILITY_ONLY` | Plan candidato con procedencia habilitada pero estado inactivo. | Se conserva como diagnóstico; no cuenta como riesgo de dos tarjetas activas ni autoriza enlace. |

La sede por sí sola no es suficiente aunque título, municipio y fecha sean exactos: es evidencia correlacionada de lugar. La combinación sede+coordenadas sí es suficientemente conservadora para un componente 1:1; una URL específica idéntica también puede serlo si no es una URL de programa, colección o recinto.

Los pares `POSSIBLE` nunca pasan a enlace automático por fuzzy matching, geocoding, texto de descripción o una URL secundaria del payload. Todo componente `POSSIBLE` en el que tanto el lado DIBA activado como el lado de fuente habilitada puedan ser publicables debe tener antes de activación una decisión versionada `LINK_TO_EXISTING`, `KEEP_SEPARATE` o `DEFER`; no puede pasar silenciosamente por el gate.

## C. Política de componentes de conflicto

La unidad de decisión es el componente bipartito, no una arista aislada.

| Topología | Política |
| --- | --- |
| 1 DIBA ↔ 1 público | Auto-enlazable únicamente si cumple `AUTO_LINK_TO_EXISTING_PUBLIC_PLAN`. |
| Varios DIBA ↔ 1 público | Revisión por defecto. Puede enlazarse el componente entero solo si **todos** los DIBA se consolidan antes de forma `SAFE_CONSOLIDATE` y cada uno tiene evidencia fuerte contra el mismo público. |
| 1 DIBA ↔ varios públicos | `POSSIBLE_DUPLICATE_HUMAN_REVIEW`; nunca elegir arbitrariamente un destino. |
| Componente mayor/no-clique/sesiones distintas | Revisión humana de componente completo. |

Esto evita que dos funciones reales se conviertan en una tarjeta por decisiones de pares independientes.

## D. Sesiones, intervalos y el modelo actual

El modelo actual representa un plan publicable con intervalo; `plan_occurrences` existe para sesiones explícitas y con fecha/hora estructurada, pero la importación DIBA actual conserva solo `schedule_text` y no fabrica ocurrencias. Por tanto:

1. Misma producción en fechas distintas: registros separados.
2. Misma fecha con horas distintas: registros separados hasta disponer de sesiones estructuradas verificadas.
3. Misma fecha/hora duplicada DIBA: un plan con múltiples `plan_sources` solo bajo `SAFE_CONSOLIDATE`.
4. Evento de largo intervalo: un solo intervalo real; no se inventan días ni sesiones.
5. Plan público agregado frente a sesiones DIBA: revisión humana, salvo que el componente ya se reduzca de forma segura a la misma representación de plan.

No hay bloqueo de esquema para una activación conservadora: el bloqueo es semántico, pues el horario DIBA es texto libre y el modelo mezcla planes de evento y actuaciones fechadas. M1.4C no debe rediseñarlo; debe mantener separados los casos de fecha/hora no inequívocamente duplicados. Un modelo explícito de concepto de evento frente a actuación sería trabajo posterior, no requisito de activación.

## E. Política municipal y geográfica

| Bucket de auditoría | Política M1.4C |
| --- | --- |
| `EXACT_MUNICIPALITY_NAME_CANDIDATE` | Mapear mediante coincidencia exacta case-insensitive contra el snapshot ICGC local, con un único resultado. No geocoding. |
| `NORMALIZED_MUNICIPALITY_NAME_CANDIDATE` | Mapear solo con la normalización determinista existente (acentos/artículos), resultado único y auditado. |
| `POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION` | Solo alias explícitos versionados: Fogars de Monclús→`08081`; La Poble de Lillet→`08166`; El Pont de Vilomara→`08182`. No fuzzy matching genérico. |
| `LOCALITY_OR_SUBMUNICIPAL` | Alias explícito a municipio padre, conservando el literal DIBA en `locality` cuando exista. Para esta snapshot, Sant Pau d'Ordal→Subirats (`08273`) es el único alias inicial. |
| `COMARCA_OR_REGION` | Municipio nulo; asignar únicamente comarca ICGC inequívoca. Puede publicarse y aparecer en filtro de comarca, no en búsquedas de municipio. |
| `MULTI_AREA_OR_SUPRAMUNICIPAL` | No fabricar municipio ni comarca. Publicación solo si supera los filtros generales ya existentes. |
| `MISSING_NAME` / `UNKNOWN_REVIEW_REQUIRED` | Sin municipio inferido. Conservar payload y permitir solo la visibilidad que admita el modelo actual; no habilitar un alias sin revisión. |

Las coordenadas son evidencia auxiliar, nunca mecanismo de resolución administrativa. Los alias se evaluarán antes de la normalización genérica y tendrán comentario de procedencia/revisión.

## F. Propiedad canónica por campo

Cuando DIBA se enlaza a un plan con fuente habilitada, la fuente pública existente es canónica. DIBA sigue en `plan_sources` con payload, URL y fechas de importación completos.

| Campo | Regla |
| --- | --- |
| Título, descripción, fecha, sede, dirección, coordenadas | No sobrescribir valor canónico no nulo. DIBA puede rellenar solo nulos cuando la política del enlace lo permita y el valor es estructurado/validado. |
| Municipio/comarca/provincia/locality | Relleno solo por resolución ICGC/alias permitido; nunca degradar geografía existente. |
| Categorías, ranking, destacado | No modificar por un enlace DIBA. |
| URL informativa | No sobrescribir una URL canónica no nula; DIBA conserva `source_url` propio. |
| Imagen | Nunca DIBA; conservar la imagen oficial/local existente. |
| Estado | No reactivar ni inactivar un plan público por solo añadir/retirar DIBA. |
| Comercio/afiliación | Nunca DIBA; conservar Ticketmaster/Fever y sus reglas. |

El relleno de nulos es seguro únicamente para campos descriptivos o geográficos validados; no para categorías, estado, imagen, comercio ni ranking.

## G. Reconciliación e idempotencia tras un enlace

- La clave estable `source_id + source_record_id` conserva siempre el mismo plan canónico aprobado.
- Una repetición actualiza `last_seen_at` y payload de esa misma procedencia; no recrea el antiguo plan DIBA huérfano.
- Varios source records DIBA consolidados siguen siendo varias filas `plan_sources` hacia un solo plan.
- Al trasladar una procedencia desde un plan solo-DIBA a uno público, el origen queda inactivo y auditable; no se borra físicamente como parte del enlace.
- Al retirar DIBA, un plan compartido conserva estado si otra procedencia permanece; si no queda procedencia se aplica el ciclo de vida ordinario, no una regla especial DIBA.
- Toda decisión automática y manual debe ser comprobable en una repetición equivalente antes de activar fuentes.

## H. Revisión manual y overrides

M1.4C debe usar un fichero JSON versionado, validado y de mínimo poder, por ejemplo `data-policy/diba-link-overrides.json` (nombre final a decidir en implementación). Toda identidad durable es una identidad de procedencia (`sourceKey + sourceRecordId`), nunca un `plan_id` local. Un `plan_id` puede anotarse como diagnóstico o aserción, pero no es destino aplicable ni portable. Cada consolidación same-feed usa asimismo una identidad DIBA de procedencia como ancla canónica.

```json
{
  "version": 1,
  "decisions": [{
    "source": {
      "sourceKey": "diba-escenari",
      "sourceRecordId": "…"
    },
    "decision": "LINK_TO_EXISTING",
    "target": {
      "sourceKey": "gencat-agenda",
      "sourceRecordId": "…"
    },
    "reason": "Reviewed identical performance",
    "reviewedAt": "YYYY-MM-DD"
  }]
}
```

En ejecución, M1.4C resolverá la identidad destino a su `plan_id` local solo en ese momento. Fallará cerrado si falta alguna identidad, la resolución es ambigua, el destino ya no mantiene la topología esperada o la decisión contradice otro override. No habrá fallback fuzzy ni elección de un plan parecido. Se validará además que una clave DIBA no recibe dos decisiones. No se editará SQLite manualmente. Las decisiones `KEEP_SEPARATE` y `DEFER` también se versionan para que el resultado sea repetible.

## I. Puerta de activación

Bloqueadores:

- Todos los componentes internos multplan deben estar dispositionados como `SAFE_CONSOLIDATE`, `KEEP_SEPARATE_*`, `NEEDS_HUMAN_REVIEW` resuelto por override, o `DEFER`.
- Todos los componentes confirmados activos deben estar resueltos por la política de componente.
- Todos los componentes posibles activos deben tener decisión versionada `LINK_TO_EXISTING`, `KEEP_SEPARATE` o `DEFER`; `POSSIBLE` nunca autoriza `LINK_TO_EXISTING` automático.
- Los componentes de sesiones distintas deben ser distinguibles inequívocamente por la representación pública actual o estar `DEFER`.
- Todos los overrides de identidad estable deben validar sin destino ausente, ambiguo o contradictorio.
- Alias municipal no único, geocoding implícito o sustitución de imagen DIBA.
- Repetición no idempotente, retirada que degrade plan compartido, o fuentes con imágenes habilitadas.
- Fallo de importación local desactivada, validaciones de enlace o smoke tests de activación.

Diagnósticos aceptables tras decisión explícita:

- Pares posibles conservados separados/revisados.
- Planes inactivos con fuente habilitada, retenidos solo como diagnóstico.
- Comarca, ámbito supramunicipal, municipio vacío o desconocido tratados según la tabla geográfica.

Antes de activar: todas las decisiones deben estar versionadas; importación desactivada y repetida deben ser idempotentes; el informe posterior no debe mostrar riesgo activo sin resolución; la política geográfica debe pasar; DIBA debe seguir con imágenes deshabilitadas; y una prueba de publicación debe demostrar que no hay tarjeta duplicada ni degradación de una tarjeta pública existente. La activación requiere aprobación explícita separada.

## Aplicación analítica a la snapshot 2026-09-01

Estas cifras son estimaciones de política; no se ha modificado ningún dato.

- Same-feed: 24 de 28 clústeres multplan parecen `SAFE_CONSOLIDATE`: todos son de Escenari, clique, fecha idéntica, URL efectiva específica, sede idéntica y horario idéntico. Cuatro quedan en revisión: Escenari-6 (evidencia de ubicación insuficiente), Museus-1 y Museus-2 (horarios contradictorios), y Turisme-1 (horario ausente/URL insuficiente).
- DIBA↔público confirmado: hay 26 relaciones y 25 componentes. Catorce componentes 1:1 tienen sede+coordenadas y parecen auto-enlazables. El componente 2→1 contra el plan público 1116 suma una decimoquinta decisión auto-enlazable **solo** tras consolidar primero su clúster Escenari interno seguro. Diez componentes quedan en revisión: ocho con sola sede y dos con solo coordenadas.
- Los 23 pares posibles (22 componentes) no reciben enlace automático. Si siguen siendo conflictos de publicación activos, los 22 componentes requieren disposición explícita `LINK_TO_EXISTING` revisado, `KEEP_SEPARATE` o `DEFER` antes de activación; veinte pares son históricos exactos y tres son registros nuevos.
- Municipios: 15 de 28 pueden resolverse determinísticamente bajo esta política: cinco exactos, cuatro registros por los tres aliases explícitos de typo/abreviación y seis Sant Pau d'Ordal→Subirats. Cuatro pueden enriquecerse solo a comarca, sin municipio. Los nueve restantes no reciben municipio automático.

## M1.4C — alcance propuesto

Debe implementar:

1. Un evaluador puro de esta política, por componente, con razones y decisión determinista.
2. Validación y carga segura del fichero de overrides versionado mediante identidades de procedencia, con resolución local a `plan_id` solo en runtime.
3. Aplicación transaccional de enlaces aprobados y consolidaciones many-source-to-one, preservando identidad y auditabilidad.
4. Alias municipales explícitos y resolución de comarca sin coordenadas como mecanismo administrativo.
5. Reconciliación de repetición/retirada conforme a la sección G.
6. Dry-run de política que explique decisiones y no escriba SQLite.
7. Tests de topología, sesiones, overrides, campos canónicos, idempotencia y retirada de procedencia compartida.

No debe implementar:

1. Cambio de umbrales del matcher productivo ni fuzzy matching automático.
2. Autoenlace de pares posibles, 1→N o componentes complejos.
3. Fabricación de ocurrencias desde `schedule_text`, rediseño de esquema o agregación de eventos/sesiones.
4. Geocoding web, municipio por coordenadas o municipio ficticio para comarca/ámbito amplio.
5. Imágenes DIBA, cambios de categorías, ranking, comercio, API o frontend.
6. Activación de fuentes, importación real, despliegue o edición manual de SQLite.

## Arquitectura y pruebas propuestas para M1.4C

Implementación mínima candidata:

- `backend/src/diba/dibaQualityPolicy.js`: evaluador puro de matrices y componentes.
- `backend/src/diba/dibaPolicyOverrides.js`: esquema, carga y validación de overrides.
- `backend/src/diba/dibaMunicipalityAliases.js`: aliases explícitos y metadatos de revisión.
- `backend/src/diba/dibaImporter.js` y repositorio de planes: integración transaccional **solo en M1.4C**, sin tocar el matcher.
- `scripts/dibaPolicyDryRun.js`: explicación reproducible de decisiones.
- `test/dibaQualityPolicy.test.js` y extensiones focales de `test/dibaM1.test.js`.

Las pruebas deberán cubrir cada fila de las matrices, horarios idénticos/distintos/ausentes y su visibilidad pública, componentes 1:1, N:1, 1:N y mayores, destino de override ausente/ambiguo/contradictorio, no sobrescritura canónica, aliases permitidos/no permitidos, repetición, retirada y ausencia de escrituras en dry-run.
