# Imágenes genéricas de planes

La **Tens Pla? Generic Image Library V1** evita fichas visualmente vacías sin presentar una
fotografía de archivo como si fuera la del evento. Es una librería permanente: sirve para fuentes
sin imagen, imágenes retiradas o rotas y futuras fuentes cuya reutilización no esté aprobada.

## Prioridad y política de procedencia

La API resuelve una sola `image` de visualización para tarjeta y detalle, en este orden:

1. Imagen oficial reutilizable servida por el mecanismo controlado de la procedencia (Fever o
   Ticketmaster cuando su flag esté activado).
2. Fotografía genérica local de Tens Pla?, si el binario WebP seleccionado está disponible.
3. El patrón gráfico local de categoría que ya usa la interfaz.

`plans.image_url` y los datos originales de la fuente no se sobrescriben. La respuesta conserva
el campo compatible y añade, cuando procede, `image.kind` (`official` o `generic`) y `image.source`.
Una procedencia compartida con una imagen oficial aprobada siempre gana a la genérica.

Gencat no usa imágenes de eventos mientras no exista una autorización explícita sobre los derechos
de terceros, aunque su payload incluya una URL. Por tanto sus planes usan la librería genérica si
el asset local existe. Fever y Ticketmaster mantienen sus proxies/cachés same-origin existentes;
solo se usan antes de la librería cuando están habilitados y tienen una imagen controlada.

## Selección determinista y categorías

El resolver carga el manifiesto una vez al iniciar el backend, valida sus 105 entradas y aplica
FNV-1a sobre `plan.fingerprint`. Dentro del pool resuelto el índice es `hash % tamaño_del_pool`; no hay azar,
escrituras SQLite ni lecturas de ficheros por plan.

| Categoría editorial Tens Pla? | Pool genérico |
| --- | --- |
| festes | festes |
| musica | musica |
| fires-mercats | fires-mercats |
| gastronomia | gastronomia |
| familia | familia |
| espectacles | espectacles |
| cultura | cultura |
| museus | museus |
| patrimoni, monuments, pobles | patrimoni |
| natura, senderisme, muntanya, platges, bicicleta, miradors, parcs-jardins | natura |

Si no hay categoría editorial, las palabras clave curadas del paquete son una señal secundaria; a
continuación se considera `family_friendly` y `outdoor`. El último recurso es `cultura`. Esta
elección no modifica la categoría editorial del plan.

### Refinamiento visual de cultura

Sin cambiar la categoría editorial `cultura`, el resolver aplica reglas explícitas y deterministas
al título y las descripciones. `taller`, `workshop`, `ceràmica`/`cerámica`, `terrissa`,
`artesania`/`artesanía` y `manualitats`/`manualidades` seleccionan el subtipo
`craft-workshop`. Las señales de exposición, museo, visita guiada o patrimonio, y cualquier caso
sin señal, usan únicamente el pool neutral de cultura. No se mezclan pools de otras categorías.

## Assets y procedencia

El archivo versionado en la raíz `tenspla_pexels_fallback_library_v1.zip` es la fuente de verdad
de selección y procedencia: contiene el manifiesto completo, 105 IDs de Pexels, página exacta,
fotógrafo, licencia, fecha de selección, alt CA/ES y las banderas de uso. No contiene binarios y
el servidor no hace ninguna petición a Pexels.

Los binarios preparados viven bajo `frontend/public/media/fallbacks/`:

- `<categoría>/<id>.webp`: master/detail WebP de hasta 1600 px.
- `card/<categoría>/<id>.webp`: variante WebP de hasta 800 px para tarjetas.

La adquisición se hace una sola vez desde el endpoint oficial Pexels `GET /v1/photos/:id`, nunca
desde la web pública ni desde el runtime de Tens Pla?. Exporta `PEXELS_API_KEY` o defínela solo en
tu `.env` local (nunca en `.env.example`), y ejecuta:

```bash
npm run fallback-images:fetch
```

If one or more curated IDs are unavailable or return invalid item-specific data, the fetch
continues sequentially, then reports every affected internal ID, Pexels Photo ID, category and
reason before exiting non-zero. It never substitutes a curated photo and never starts preparation.
Authentication, rate-limit, network and manifest failures still stop the acquisition immediately.

El script consulta exactamente los 105 IDs curados, secuencialmente con una pausa de 400 ms,
valida ID/página/host de origen y usa `src.original`. Guarda los originales y un registro de la
respuesta API sin credenciales en `data/fallback-image-originals/`, ignorado por Git. Es
reiniciable: un original válido no se descarga de nuevo; los parciales usan `.part` y no cuentan
como completados. También puede elegirse otro directorio con `-- --output /ruta/a/originales`.

Con `cwebp` instalado, transforma y valida los 100 originales con:

```bash
npm run fallback-images:prepare -- --input /ruta/a/originales
npm run fallback-images:validate
```

El atajo `npm run fallback-images:build` ejecuta las tres etapas en orden. No debe usarse en CI ni
en producción porque requiere explícitamente la clave local y acceso a la API.

La preparación exige los 105 originales antes de escribir, genera ambos tamaños y valida las 210
salidas. No descarga nada ni se ejecuta en producción. Para sustituir un binario, conserva el
mismo ID y origen del manifiesto; para ampliar la librería, actualiza primero el manifiesto curado,
su validador y sus tests, sin convertir una foto en específica de un evento.

El backend memoriza la disponibilidad de los WebP al arrancar, por lo que después de preparar o
reemplazar assets hay que reiniciarlo en la siguiente operación autorizada; no se requiere ninguna
acción de base de datos.

## UX, accesibilidad y SEO

Las tarjetas no llevan etiqueta visible. En el detalle, una imagen genérica muestra
«Imatge orientativa · Foto de {fotógrafo} a Pexels» / «Imagen orientativa · Foto de {fotógrafo}
en Pexels» con enlace voluntario a la página curada. Su `alt` procede del manifiesto en el idioma
de la interfaz e indica que es orientativa. Si el WebP falta o falla, `PlanVisual` vuelve al patrón
gráfico, sin una imagen rota.

Las imágenes genéricas nunca se incluyen en `Event.image` de JSON-LD: el manifiesto marca las 100
como `jsonld_event_image_eligible=false`. Las imágenes oficiales solo pueden aparecer allí si su
objeto de imagen declara explícitamente que es elegible. Open Graph sigue utilizando la imagen
social general existente; V1 no hace pasar una foto genérica por la imagen del evento.

Si en el futuro se autorizan las imágenes oficiales de Gencat, la política por procedencia puede
habilitarlas antes del paso genérico sin eliminar esta librería ni alterar los datos almacenados.
