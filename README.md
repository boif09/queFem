# Què Fem?

Milestones 1, 2 i 3 de Què Fem?: Agenda Cultural de Catalunya → normalització → SQLite → API REST → interfície web React.

## Requisits

- Node.js 20 o superior
- npm

## Posada en marxa

```bash
npm install
cp .env.example .env
npm run db:init
npm run import:gencat
```

La base de dades es crea per defecte a `data/quefem.sqlite`. `DATABASE_PATH` permet canviar-ne la ubicació i `GENCAT_PAGE_SIZE` la mida de cada pàgina oficial descarregada.

La importació consulta només activitats permanents o activitats que no hagin superat el període de retenció. Per defecte es conserven els esdeveniments fins a 90 dies després de la seva finalització, segons `EVENT_RETENTION_DAYS=90`; amb el valor `0`, qualsevol esdeveniment finalitzat abans d'avui s'exclou. Abans de cada importació també es purguen de SQLite els plans que ja han superat aquest límit i els registres administrativament marcats com a fora de Catalunya.

Per executar manualment la purga i compactar físicament la base de dades:

```bash
npm run db:purge
```

La purga elimina primer les relacions de `plan_sources` i `plan_categories`, conserva els `import_runs` i no elimina mai plans marcats com a permanents per antiguitat. La comprovació territorial utilitza els camps administratius de Gencat i no exigeix coordenades.

Els esdeveniments no permanents amb dates incoherents no es corregeixen ni s'exposen: es consideren invàlids si `end_date < start_date`, si alguna data supera en més de 10 anys l'any actual o si la durada supera 10 anys. Els plans permanents n'estan exempts. Cada importació inclou el recompte `Invalid` dins de `Skipped`, registra els primers avisos al log i conserva a `import_runs.invalid_details` els detalls necessaris per investigar-los.

El comandament d'importació mostra sempre:

```text
Fetched: ...
Inserted: ...
Updated: ...
Skipped: ...
Invalid: ...
Errors: ...
```

Una segona execució idèntica comptabilitza com a `skipped` els registres que no han canviat. Un registre nou que coincideix amb el fingerprint inicial (`títol + municipi + data`) s'enllaça al pla existent i es comptabilitza com a `updated`.

## Font i condicions de reutilització

- Dataset oficial: [Agenda cultural de Catalunya (per localitzacions)](https://analisi.transparenciacatalunya.cat/Cultura-oci/Agenda-cultural-de-Catalunya-per-localitzacions-/rhpv-yr4f), identificador `rhpv-yr4f`.
- Publicador i atribució: `Generalitat de Catalunya. Departament de Cultura`.
- Llicència: [Llicència oberta d’ús d'informació - Catalunya](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies).
- Revisió de les condicions: 17/08/2026.

La font està habilitada només perquè les metadades i la llicència oficials permeten la reutilització i transformació. L'atribució i la data d'actualització són obligatòries. Les imatges no s'importen a `plans.image_url`: la llicència general adverteix que no regeix automàticament els drets dels continguts individuals. Els camps `imatges`, `destacada_imatge` i `imgapp`, així com possibles etiquetes `<img>` del text HTML, s'exclouen també del payload auditable abans de desar-lo.

## Discrepàncies documentades

- `codi` identifica una activitat, però el dataset per localitzacions pot publicar diverses files amb el mateix codi i fins i tot variants diferents per a la mateixa localització. La font no ofereix cap identificador únic de fila. Per prioritzar que no es perdi cap variant, `plan_sources.source_record_id` combina el codi oficial amb una empremta canònica del payload complet; el `codi` sense modificar també es conserva al payload. Una variant modificada en una sincronització futura crea una nova procedència i l'anterior queda disponible per a auditoria mitjançant `last_seen_at`.
- El dataset no publica una data de modificació per fila. `source_created_at` conserva `data_creacio` quan existeix i `source_updated_at` conserva `rowsUpdatedAt`, la data global oficial del dataset consultada a cada execució.
- Municipi, comarca i província arriben com etiquetes jeràrquiques (`agenda:ubicacions/...`), no com noms de presentació. La milestone los converteix de manera determinista des del slug; els accents que no formen part del slug no es poden reconstruir amb garantia. L'etiqueta oficial completa queda a `source_payload_json` per poder millorar el catàleg geogràfic sense perdre dades.
- El model intern no té columnes per a tots els camps oficials (documents, vídeos, contactes, enllaços múltiples, etc.). Cada fila es desa canònicament a `plan_sources.source_payload_json`, excepte els camps de les imatges sense permís de reutilització.
- Els registres anteriors al canvi d'esquema de març de 2025 tenen camps buits, tal com indiquen les metadades oficials. L'importador no inventa valors per omplir-los.
- La descàrrega aplica un filtre SoQL sobre els camps oficials `data_fi`, `data_inici` i `permanent`. La mateixa regla es torna a comprovar després de normalitzar cada registre per evitar conservar una fila caducada si la font retorna dades incoherents amb el filtre.
- La font conté almenys una data de finalització aparentment anòmala: `Espai Vapor` figura amb `data_fi=2924-06-30`. No es corregeix ni s'elimina automàticament perquè no hi ha una dada oficial alternativa; la retenció prioritza no perdre activitats que la font encara considera vigents.

## Estructura de la milestone

```text
backend/src/
  api/                rutes i validació de l'API REST
  db/                 SQLite, migracions i repositoris
  deduplication/      fingerprint inicial
  importers/          BaseImporter i GencatAgendaImporter
  jobs/               comandament d'importació
  legal/              registre i bloqueig de fonts no aprovades
  normalizers/        plans, categories, localització i text
  app.js              configuració d'Express
  server.js           arrencada del backend
data/                 base SQLite local (ignorada per git)
test/                 proves de la milestone
```

No s'inclouen encara frontend, cron, purga d'esdeveniments ni fonts addicionals.

## API REST (Milestone 2)

En desenvolupament:

```bash
npm run dev
```

En execució normal:

```bash
npm start
```

L'API escolta per defecte a `http://localhost:3000`; es pot canviar amb `PORT`.

Endpoints disponibles:

```text
GET /api/plans
GET /api/plans/:id
GET /api/comarques
GET /api/municipalities?comarca=...
GET /api/categories
GET /api/sources
```

`GET /api/plans` admet `date`, `dateFrom`, `dateTo`, `province`, `comarca`, `municipality`, `category`, `free`, `family`, `indoor`, `outdoor`, `kind`, `page`, `limit`, `sort` i `lang`. `lang` pot ser `ca` (per defecte) o `es`; si una traducció no existeix, es retorna el text original. `sort` admet `date`, `quality` i `title`. La distància queda ajornada fins que el contracte incorpori coordenades de cerca.

Els plans amb `quality_score < 35` no s'exposen. Tots els paràmetres són validats i `limit` no pot superar 100.

Per executar totes les proves:

```bash
npm test
```

## Interfície web (Milestone 3)

La interfície és bilingüe, amb català per defecte i castellà seleccionable. La preferència es conserva a `localStorage`. No incorpora imatges externes: les targetes utilitzen composicions gràfiques pròpies basades en la categoria.

Per treballar en local, obre dos terminals des de l'arrel del projecte:

```bash
# Terminal 1: API a http://localhost:3000
npm run dev:backend

# Terminal 2: web a http://localhost:5173
npm run dev:frontend
```

Vite redirigeix `/api` al backend local. Si l'API es troba en una altra adreça, copia `frontend/.env.example` a `frontend/.env` i configura `VITE_API_URL`.

Altres comandes útils:

```bash
npm test
npm run build:frontend
npm run preview:frontend
```

Rutes web disponibles:

```text
/
/plans
/plans/:id
/fonts
```

La Milestone 3 no inclou login, favorits, mapes avançats, monetització, IA, fonts noves ni scraping.
