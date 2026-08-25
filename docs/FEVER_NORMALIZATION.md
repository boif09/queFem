# Fever: normalización y sesiones (M3)

Este milestone prepara en memoria los productos Fever y sus sesiones para el contrato genérico de `plan_occurrences`. No abre SQLite, no persiste productos ni occurrences y no activa Fever en producción.

## Universo y fases

El cliente Impact descarga España con `Query=Text1='Spain'`, siguiendo únicamente `@nextpageuri`. Después se seleccionan exactamente `CatalogId=15532`, `CampaignId=16345` y `ParentName=Catalonia`; se excluyen Gift Cards mediante la política M1, pero no Tier 4.

La radiografía del 25-08-2026 observó 606 productos Catalunya y 70.411 sesiones. Todo `Manufacturer` era una cadena separada por comas y todos los tokens tenían el formato `YYYY-MM-DD HH:mm`; no había segundos, offset, `Z`, fechas solas, tokens vacíos, duplicados ni tokens inválidos. El máximo observado fue 1.540 sesiones en un producto. Estas cifras son diagnósticas, no assertions.

## Contrato temporal

El parser acepta de forma estricta:

- `YYYY-MM-DD HH:mm`, el formato real observado;
- `YYYY-MM-DD`, para el contrato date-only de occurrences;
- ISO con `T` y offset explícito o `Z`, para fixtures inequívocos.

Las horas Fever sin offset son horas civiles de `Europe/Madrid`. Se conservan como `local_date`, `local_time` y `timezone`, dejando `starts_at=null`: no se inventa un offset ni se elige arbitrariamente una rama durante el cambio DST. Una fecha sola también deja `local_time` y `starts_at` a `null`. Solo un token con offset o `Z` permite calcular el instante ISO de `starts_at` y su representación local mediante `Intl`.

Cada sesión normalizada tiene:

```text
occurrence_key
starts_at
ends_at
local_date
local_time
timezone
```

`occurrence_key` es `fever-session:` más 24 caracteres hexadecimales de SHA-256. Cuando existe `starts_at`, la identidad usa el instante normalizado en UTC, por lo que dos representaciones equivalentes comparten clave y las dos ramas de una hora DST repetida no colisionan. Sin instante usa `timezone|local_date|local_time`; para date-only sustituye la hora por `date-only`. Es determinista e independiente del orden del feed. Al no existir un ID nativo de sesión, dos funciones distintas con idéntica identidad temporal se consideran la misma sesión; el parser conserva una y reporta el duplicado.

## Normalización y publicación futura

El normalizador prepara nombre, descripción limpia, URL afiliada, imagen, precio, etiquetas, recinto, dirección, coordenadas, Tier, SubCategory, fechas y occurrences. `Text2` se conserva únicamente como dato fuente y nunca se usa como municipio. La descripción usa la dependencia pequeña y mantenida `entities` para decodificar correctamente entidades HTML, incluidas las latinas y numéricas. La decodificación ocurre antes de eliminar HTML, scripts, estilos y residuos CSS, con un máximo de tres pasadas para markup razonablemente recodificado; después se normaliza el whitespace y se aplica un límite defensivo.

Las coordenadas se validan aquí solo por sintaxis `(lat; lon)` y rangos matemáticos inclusivos. `(0;0)` sigue siendo matemáticamente válido en M3, pero deberá tratarse como posible sentinel sospechoso antes de persistir geografía Fever.

Una occurrence sería publicable si su `local_date` está entre hoy y `FEVER_LOOKAHEAD_DAYS` días, ambos inclusive. El dry-run informa por separado sesiones pasadas, futuras, dentro y fuera del horizonte. Los productos sin una occurrence publicable se clasifican exclusivamente desde `Manufacturer` como `past-only`, `future-outside-horizon-only`, `mixed`, `no sessions` u `other`.

`ExpirationDate` no altera esa decisión: solo se contrasta como sanity check para contar fechas de expiración pasadas con sesiones futuras y expiraciones futuras sin ninguna sesión futura. Los ejemplos de cada grupo se limitan y contienen únicamente ID, nombre y primera/última fecha relevante; nunca payloads completos ni credenciales.

## Ejecución segura

```bash
npm run fever:normalize:dry-run
```

El comando solo usa Impact y memoria. No importa repositorios de base de datos ni ejecuta migraciones. M3 no implementa persistencia, reconciliación, deduplicación entre fuentes, categorización, imágenes ni frontend.
