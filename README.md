# Tens pla?

Tens pla? és una aplicació web per descobrir esdeveniments a Catalunya. Les milestones 1, 2, 3 i 4A estan implementades en local: Agenda Cultural de Catalunya i Ticketmaster Discovery Feed → normalització i controls de qualitat → SQLite → API REST → interfície web React. Ticketmaster encara no està habilitat en producció.

El backend utilitza Node.js i Express; el frontend, React i Vite. La interfície és bilingüe, amb català per defecte i castellà complet. Inclou cercador, filtres, resultats, detall del pla i informació sobre les fonts de dades.

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

La importació consulta només activitats permanents o activitats que encara no hagin finalitzat. El valor per defecte és `EVENT_RETENTION_DAYS=0`: un esdeveniment finalitzat abans d'avui s'exclou, un que acaba avui continua vigent i els plans permanents no s'eliminen per antiguitat. Abans de cada importació també es purguen de SQLite els esdeveniments caducats, els registres administrativament marcats com a fora de Catalunya i les dates clarament absurdes o incoherents.

Per executar manualment la purga i compactar físicament la base de dades:

```bash
npm run db:purge
```

La purga elimina primer les relacions de `plan_sources` i `plan_categories`, conserva els `import_runs` i no elimina mai plans marcats com a permanents per antiguitat. La comprovació territorial utilitza els camps administratius de Gencat i no exigeix coordenades.

Els esdeveniments no permanents amb dates incoherents no es corregeixen ni s'exposen: es consideren invàlids si `end_date < start_date`, si alguna data supera en més de 10 anys l'any actual o si la durada supera 10 anys. Els plans permanents n'estan exempts. Cada importació inclou el recompte `Invalid` dins de `Skipped`, registra els primers avisos al log i conserva a `import_runs.invalid_details` els detalls necessaris per investigar-los.

La integració local de Ticketmaster utilitza Discovery Feed 2.0 i es pot validar sense escriure amb `npm run import:ticketmaster -- --dry-run`. La importació local amb escriptura s'executa amb `npm run import:ticketmaster`. Requereix `TICKETMASTER_API_KEY` i aplica un horitzó configurable amb `TICKETMASTER_LOOKAHEAD_DAYS=90`. La Milestone 4A ha estat validada amb una importació local real, una segona execució idempotent i comprovacions manuals de l'API i el frontend. No hi ha cron de producció: malgrat que les pàgines legals i de privacitat ja estan implementades, l'activació pública continua bloquejada fins a l'aprovació final dels termes aplicables.

La retirada operativa d'una procedència concreta es comprova primer amb `npm run ticketmaster:remove -- EVENT_ID --dry-run` i s'executa, després del backup, sense `--dry-run`. Un pla compartit conserva les altres fonts; un pla exclusiu queda `inactive`. El procediment complet és a [`docs/TICKETMASTER_REMOVAL.md`](docs/TICKETMASTER_REMOVAL.md).

Per a una sol·licitud expressa aprovada, `npm run ticketmaster:remove -- EVENT_ID --purge --dry-run` mostra si el pla quedaria compartit o s'eliminaria físicament; l'execució equivalent sense `--dry-run` elimina immediatament el pla només quan no queda cap altra font.

Els plans `inactive` sense cap procedència es conserven durant 7 dies des d'`inactive_at` i després es poden purgar físicament. La comprovació segura és `npm run purge:inactive -- --dry-run`; l'execució real és `npm run purge:inactive`. Aquesta és una política interna de minimització, no un termini legal. Les retirades expresses continuen tenint prioritat operativa i un objectiu inferior a 24 hores.

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
- La font conté almenys una data de finalització aparentment anòmala: `Espai Vapor` figura amb `data_fi=2924-06-30`. L'importador no inventa una data alternativa: rebutja el registre per incoherència temporal i en conserva el detall auditable a l'execució d'importació.

## Estructura actual

```text
backend/src/
  api/                rutes i validació de l'API REST
  db/                 SQLite, migracions i repositoris
  deduplication/      fingerprint inicial i matching conservador entre fonts
  importers/          BaseImporter i importers de Gencat/Ticketmaster
  jobs/               comandaments d'importació i purga
  legal/              registre i bloqueig de fonts no aprovades
  normalizers/        plans, categories, localització i text
  app.js              configuració d'Express
  server.js           arrencada del backend
data/                 base SQLite local (ignorada per git)
frontend/             aplicació React/Vite i proves de la interfície
test/                 proves del backend, importer i base de dades
deploy.sh             desplegament de codi a producció
```

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

`GET /api/plans` admet `q`, `date`, `dateFrom`, `dateTo`, `province`, `comarca`, `municipality`, `category`, `free`, `family`, `indoor`, `outdoor`, `kind`, `page`, `limit`, `sort` i `lang`. `q` cerca parcialment, sense distingir majúscules ni accents, als títols i al recinte. `lang` pot ser `ca` (per defecte) o `es`; si una traducció no existeix, es retorna el text original. `sort` admet `date`, `quality` i `title`. La distància queda ajornada fins que el contracte incorpori coordenades de cerca.

Quan hi ha un municipi, aquest filtre més precís preval sobre la comarca per admetre fonts que no la publiquen; la comparació municipal ignora diferències d'accents i puntuació. En cerques amb una data exacta, els esdeveniments que comencen aquell dia es mostren abans que els esdeveniments en curs i els plans permanents.

Els plans amb `quality_score < 35` no s'exposen. Tots els paràmetres són validats i `limit` no pot superar 100.

Per executar totes les proves:

```bash
npm test
```

## Interfície web (Milestone 3)

La interfície és bilingüe, amb català per defecte i castellà seleccionable. La preferència es conserva a `localStorage`. No incorpora imatges externes: les targetes utilitzen composicions gràfiques pròpies basades en la categoria.

La interfície utilitza el sistema visual **Pop Editorial / Mediterranean Pop**. Montserrat Variable s'empaqueta localment en WOFF2 mitjançant Fontsource, amb llicència OFL i sense Google Fonts en runtime. Les fitxes amb coordenades no contacten OpenStreetMap fins que el visitant prem el botó per carregar el mapa; l'enllaç de Google Maps continua sent una navegació externa voluntària.

Tens pla? no utilitza cookies, analítica, publicitat, comptes ni seguiment. L'única preferència local continua sent la clau legacy `quefem.language`, amb valor `ca` o `es`. Les pàgines legals identifiquen Xavier Delgado Garcia com a responsable i `contacte@tenspla.cat` com a canal públic. Qualsevol monetització, analítica, publicitat, sistema de comptes, formulari o nou mecanisme d'emmagatzematge o seguiment exigeix revisar la documentació legal i, si escau, implementar consentiment abans de desplegar-lo.

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
/legal
/privacitat
/privacidad
/emmagatzematge
/almacenamiento
/contacte
/contacto
```

La Milestone 3 no inclou login, favorits, mapes avançats, monetització, IA, fonts noves ni scraping.

## Producció i desplegament

L'aplicació està publicada a `https://tenspla.cat`. El backend està gestionat per PM2, el frontend compilat el serveix Nginx i `deploy.sh` desplega els canvis de codi. La sincronització de Gencat s'executa cada dues hores mitjançant el cron extern del servidor; no forma part del desplegament.

La marca pública és **Tens pla?**, el domini públic principal és `https://tenspla.cat` i el correu públic és `contacte@tenspla.cat`. `https://quefem.jusboif.es` es conserva com a domini legacy i redirigeix al nou domini mantenint path i query. Els identificadors interns legacy (`quefem`, `queFem`, `quefem-api`, `quefem.sqlite`) es mantenen sense canvis.

La infraestructura, el cron real i les ordres d'operació estan documentats a [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## SEO tècnic

SEO V1 utilitza `https://tenspla.cat` com a origen canònic, metadata centralitzada per ruta, Open Graph i Twitter/X amb una imatge de marca local, favicon local, Event JSON-LD i `robots.txt` sense bloquejar recursos. `/plans` amb qualsevol paràmetre de cerca o filtre i les pàgines de transparència utilitzen `noindex,follow`. El sitemap d'esdeveniments és dinàmic a `/api/sitemap.xml`; la publicació de `/sitemap.xml` requereix el proxy Nginx documentat a [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). No s'ha afegit analítica, tracking, cookies ni scripts SEO externs.
