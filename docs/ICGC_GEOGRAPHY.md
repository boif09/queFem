# Resolución administrativa de Catalunya con ICGC (M4A)

M4A resuelve municipio, comarca y provincia mediante point-in-polygon sobre un snapshot local oficial. Es estrictamente batch y read-only: no abre SQLite, no persiste Fever y no usa `Text2`, direcciones, geocoding remoto ni nearest-city como fuente administrativa. El servidor HTTP residente no importa el snapshot, el resolver ni Turf.

## Fuente, licencia y modificaciones

- Proveedor y atribución: **Institut Cartogràfic i Geològic de Catalunya (ICGC)**.
- Producto: [Divisions administratives](https://www.icgc.cat/ca/Geoinformacio-i-mapes/Dades-i-productes/Geoinformacio-cartografica/Divisions-administratives).
- Servicio: [WMS/WFS Divisions administratives](https://www.icgc.cat/ca/Geoinformacio-i-mapes/Geoinformacio-en-linia-Geoserveis/WMS-i-WFS-Limits-administratius/WMS-i-WFS-Divisions-administratives).
- Fecha de los datos: **20/01/2026**; actualización del servicio indicada por ICGC: mayo de 2026.
- Licencia: [Creative Commons Reconocimiento 4.0 Internacional (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
- Atribución para cualquier uso público futuro: `Institut Cartogràfic i Geològic de Catalunya (ICGC)`.

La metadata enumera las modificaciones hechas al original: transformación oficial WFS a EPSG:4326, selección de los seis campos administrativos, orden por `CODIMUNI`, bboxes y redondeo a seis decimales. No se simplifican ni eliminan vértices. La licencia del dataset no se mezcla con la licencia del código y M4A no añade frontend.

## Elección reproducible de capa

El 25/08/2026 se solicitaron al mismo WFS oficial las capas `municipis_5000`, `municipis_50000` y `municipis_100000` en GeoJSON, `srsName=EPSG:4326`, conservando geometría oficial sin simplificación. Con el mismo conjunto de 570 productos Fever elegibles y el mismo algoritmo bbox + `@turf/boolean-point-in-polygon`, las tres capas dieron 567 matches, 3 unresolved offshore, 0 ambiguous y 0 diferencias de código municipal.

Como análisis de sensibilidad separado, se repitió cada resolución desplazando longitud y latitud ±0,00025°: 28 productos, principalmente marítimos o costeros, cambiaron al menos un resultado. Esto no demuestra una precisión cartográfica concreta; solo localiza casos sensibles a fronteras. Se conserva 1:5.000 por ser la capa oficial de mayor detalle evaluada.

| Capa | Features | GeoJSON descargado | Vértices | Media/municipio |
| --- | ---: | ---: | ---: | ---: |
| `municipis_5000` | 947 | 40.335.740 B | 1.591.330 | 1.680 |
| `municipis_50000` | 947 | 12.696.911 B | 485.834 | 513 |
| `municipis_100000` | 947 | 9.891.231 B | 373.569 | 394 |

## CRS, validación y seguridad de descarga

- CRS fuente publicado: `EPSG:25831`; CRS solicitado y almacenado: `EPSG:4326` compatible con GeoJSON.
- Orden interno: `[longitude, latitude]`; API del resolver: `{ latitude, longitude }`.
- Se rechazan CRS declarados incompatibles, valores fuera del rango mundial WGS84, bbox global fuera de la envolvente defensiva de Catalunya, extensión territorial absurda y anillos abiertos, cortos o degenerados tras redondeo. Polygon, MultiPolygon y holes se validan íntegramente.
- Solo se permiten URLs HTTPS sin credenciales y hostname exacto `geoserveis.icgc.cat`, también después de cada redirect.
- El cuerpo se cuenta mientras se transmite y se cancela al superar 80 MiB, aunque falte o mienta `Content-Length`.

## Snapshot, manifiesto atómico y cambios administrativos

El punto de lectura autoritativo es `data/geography/icgc-current.json`. El manifiesto referencia dos artefactos inmutables nombrados por hash —snapshot y metadata— e incluye el SHA-256 de ambos. El resolver verifica manifiesto, hashes cruzados, feature count, geometría y códigos antes de usar datos. Publicar una actualización consiste en escribir y verificar ambos artefactos y renombrar el manifiesto al final; una interrupción intermedia deja visible la versión anterior completa, nunca una pareja mezclada.

El snapshot instalado contiene **947 municipios**, ocupa **33.313.145 bytes** y tiene SHA-256 `5a5dceebcdc7ad9abef88006d50c944d885f2cc155bf5391b02cc2be1637c282`. `data/geography/` es la excepción explícita a la regla general de no versionar datos generados: estos tres artefactos oficiales son parte reproducible de M4A.

```bash
npm run geography:icgc:update
```

El updater compara el conjunto de `CODIMUNI` con el manifiesto instalado. Cualquier alta, baja o sustitución de código se rechaza por defecto incluso si el número total no cambia. Solo una revisión administrativa consciente puede publicarla con `npm run geography:icgc:update -- --allow-administrative-change`; la opción no relaja ninguna validación de integridad.

## Contrato y dry-run Fever

`CataloniaAdministrativeResolver.resolve()` devuelve `match`, `unresolved` o `ambiguous`; nunca elige arbitrariamente ni aplica fallback. Los códigos son strings, los nombres oficiales conservan acentos y cada resultado incluye procedencia y diagnósticos. Un borde compartido puede ser `ambiguous`; `(0,0)` es `unresolved` y sospechoso.

```bash
npm run fever:geography:dry-run
```

El dry-run descarga Impact y resuelve localmente en memoria. Además de cobertura general, informa por separado ocurrencias publicables resueltas, no resueltas y ambiguas, con ejemplos limitados y motivo. No importa el subsistema DB. La carga medida del snapshot completo ronda 0,96–0,99 s y 248 MB de heap; 570 resoluciones rondaron 96 ms. Por ese coste, M4A permanece fuera del proceso HTTP.

M4B deberá decidir el tratamiento operativo de unresolved/ambiguous, almacenamiento y atribución pública antes de exponer datos derivados.
