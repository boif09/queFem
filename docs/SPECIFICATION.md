# Tens pla? — Especificació tècnica inicial

> **Abast del document:** aquesta és la base inicial de producte i arquitectura. Inclou objectius i fases futures, i no acredita per si sola l'estat d'implementació actual. Per al que existeix avui, consulteu [`PROJECT_STATUS.md`](PROJECT_STATUS.md) i [`ARCHITECTURE.md`](ARCHITECTURE.md); davant d'una divergència, cal verificar el codi real.

> **Marca pública actual:** Tens pla?
> **Nom intern legacy:** Què Fem? / `quefem`; es manté per compatibilitat tècnica
> **Objectiu:** aplicació web per descobrir plans, activitats, esdeveniments i llocs per visitar a Catalunya.  
> **Idioma principal:** català  
> **Idioma secundari:** castellà  
> **Infraestructura objectiu:** servidor Hetzner existent amb Nginx, PM2 i Node.js.

---

# 1. Objectiu del producte

L'aplicació ha de permetre respondre fàcilment preguntes com:

- Què podem fer aquest cap de setmana?
- Quines activitats hi ha al Baix Empordà?
- Què puc fer avui a menys de 50 km?
- Quines festes hi ha aquest dissabte?
- Quins museus puc visitar a Girona?
- Quins plans gratuïts hi ha?
- Quines activitats familiars hi ha?
- Què podem fer a l'estiu?
- Quines platges o espais naturals tenim a prop?

L'aplicació combinarà:

1. **Esdeveniments temporals**
2. **Plans permanents**
3. **Rutes**
4. **Espais naturals**
5. **Platges**
6. **Equipaments culturals**
7. Altres fonts que es puguin incorporar legalment en el futur.

---

# 2. Principis del projecte

## 2.1 Catalunya com a àmbit geogràfic

Tots els plans han d'estar geolocalitzats sempre que sigui possible.

Jerarquia:

```text
Catalunya
 └── Província
      └── Comarca
           └── Municipi
                └── Localitat
```

No tots els nivells han de ser obligatoris.

---

## 2.2 Català com a idioma principal

La navegació inicial serà sempre en català.

Exemples:

```text
Tens pla?
Aquest cap de setmana
Avui
Demà
On vols anar?
Comarca
Municipi
Plans gratuïts
A prop teu
Veure al mapa
```

L'usuari podrà canviar a castellà.

La preferència es guardarà al navegador.

Valor per defecte:

```text
ca
```

---

# 3. Internacionalització

Utilitzar una llibreria d'i18n.

Preferència:

```text
react-i18next
```

Estructura:

```text
frontend/
  src/
    locales/
      ca/
        translation.json
      es/
        translation.json
```

Exemple:

```json
{
  "app.name": "Tens pla?",
  "home.mobileTitle": "Què vols fer avui?",
  "home.weekend": "Aquest cap de setmana",
  "filters.location": "On vols anar?",
  "filters.comarca": "Comarca",
  "filters.municipality": "Municipi"
}
```

Castellà:

```json
{
  "home.title": "¿Qué hacemos?",
  "home.weekend": "Este fin de semana",
  "filters.location": "¿Dónde quieres ir?",
  "filters.comarca": "Comarca",
  "filters.municipality": "Municipio"
}
```

---

# 4. Idioma del contingut importat

NO sobreescriure mai el text original de la font.

Guardar sempre que sigui possible:

```text
original_language
original_title
original_description
```

I separadament:

```text
title_ca
title_es

description_ca
description_es
```

Si una font proporciona oficialment català i castellà, utilitzar ambdues versions.

Si només proporciona català:

```text
original_language = ca
title_ca = original_title
description_ca = original_description
```

La traducció automàtica al castellà es podrà afegir posteriorment si les condicions de reutilització de la font ho permeten.

Les traduccions mai substituiran el contingut original.

Si s'utilitza traducció automàtica:

```text
translation_method = machine
```

La interfície podrà indicar:

```text
Traducció automàtica
```

quan sigui necessari.

---

# 5. Arquitectura

```text
                    FONTS EXTERNES
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
 Agenda Cultural       Diputació           Altres fonts
 Generalitat           Barcelona           autoritzades
       │                   │                    │
       └───────────────────┼────────────────────┘
                           │
                           ▼
                      IMPORTERS
                           │
                           ▼
                      NORMALIZER
                           │
                           ▼
                     DEDUPLICATOR
                           │
                           ▼
                        SQLite
                           │
                           ▼
                     Express API
                           │
                           ▼
                       React App
```

---

# 6. Stack tecnològic

## Backend

```text
Node.js
Express
SQLite
better-sqlite3
```

## Frontend

```text
React
Vite
React Router
react-i18next
```

## Processos

```text
PM2
cron o PM2 cron
```

## Producció

```text
Hetzner
Nginx
HTTPS
PM2
```

Evitar dependències innecessàries.

---

# 7. Estructura del projecte

```text
que-fem/
│
├── backend/
│   ├── src/
│   │
│   ├── api/
│   │   ├── plans.routes.js
│   │   ├── locations.routes.js
│   │   ├── categories.routes.js
│   │   └── sources.routes.js
│   │
│   ├── db/
│   │   ├── database.js
│   │   ├── migrations/
│   │   └── repositories/
│   │
│   ├── importers/
│   │   ├── gencatAgenda.importer.js
│   │   └── baseImporter.js
│   │
│   ├── normalizers/
│   │   ├── plan.normalizer.js
│   │   ├── category.normalizer.js
│   │   └── location.normalizer.js
│   │
│   ├── deduplication/
│   │   └── planDeduplicator.js
│   │
│   ├── legal/
│   │   ├── sourceRegistry.js
│   │   └── licenseValidator.js
│   │
│   └── jobs/
│       └── syncAgenda.js
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── locales/
│   │   │   ├── ca/
│   │   │   └── es/
│   │   └── App.jsx
│
├── data/
│   └── quefem.sqlite
│
├── scripts/
│
├── ecosystem.config.js
├── package.json
└── README.md
```

---

# 8. Model de dades principal

## Table: plans

```sql
CREATE TABLE plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    kind TEXT NOT NULL,

    original_language TEXT,

    original_title TEXT,
    original_description TEXT,

    title_ca TEXT,
    title_es TEXT,

    subtitle_ca TEXT,
    subtitle_es TEXT,

    description_ca TEXT,
    description_es TEXT,

    start_date TEXT,
    end_date TEXT,

    schedule_text TEXT,

    permanent INTEGER DEFAULT 0,

    price_text TEXT,
    is_free INTEGER,

    province TEXT,
    comarca TEXT,
    municipality TEXT,
    locality TEXT,

    address TEXT,
    postal_code TEXT,

    venue_name TEXT,

    latitude REAL,
    longitude REAL,

    website_url TEXT,
    ticket_url TEXT,

    image_url TEXT,
    image_reuse_allowed INTEGER DEFAULT 0,

    family_friendly INTEGER,
    indoor INTEGER,
    outdoor INTEGER,

    recommended_months TEXT,

    featured INTEGER DEFAULT 0,

    quality_score INTEGER DEFAULT 0,

    status TEXT DEFAULT 'active',

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

# 9. Tipus de pla

Valors inicials:

```text
event
place
route
beach
nature
activity
```

Exemples:

```text
Festa Major de Terrassa
→ event

Museu Episcopal de Vic
→ place

Ruta de Sant Jeroni
→ route

Platja de Tamariu
→ beach

Parc Natural del Montseny
→ nature
```

---

# 10. Fonts

## Table: sources

Aquesta taula és obligatòria.

```sql
CREATE TABLE sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    key TEXT UNIQUE NOT NULL,

    name TEXT NOT NULL,

    publisher TEXT,

    license_name TEXT,

    license_url TEXT,

    attribution_text TEXT,

    requires_attribution INTEGER DEFAULT 1,

    requires_update_date INTEGER DEFAULT 0,

    allows_data_reuse INTEGER DEFAULT 0,

    allows_transformation INTEGER DEFAULT 0,

    allows_images INTEGER DEFAULT 0,

    reviewed_at TEXT,

    enabled INTEGER DEFAULT 0
);
```

Una font NO podrà ser executada per un importer si:

```text
enabled != 1
```

Això actuarà com a control legal.

---

# 11. Relació entre plans i fonts

## Table: plan_sources

```sql
CREATE TABLE plan_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    plan_id INTEGER NOT NULL,

    source_id INTEGER NOT NULL,

    source_record_id TEXT,

    source_url TEXT,

    source_updated_at TEXT,

    imported_at TEXT,

    last_seen_at TEXT,

    FOREIGN KEY(plan_id) REFERENCES plans(id),
    FOREIGN KEY(source_id) REFERENCES sources(id)
);
```

Un mateix pla pot provenir de diverses fonts.

Exemple:

```text
Festa Major de Terrassa

Generalitat
+
Diputació de Barcelona
```

A la interfície només apareixerà una vegada.

---

# 12. Control legal de fonts

Cap importer nou podrà incorporar-se simplement afegint una URL.

Abans cal registrar:

```text
Font
Propietari
Dataset
Llicència
Condicions d'atribució
Possibilitat de transformació
Ús comercial/no comercial
Condicions de les imatges
Data de revisió
```

Flux obligatori:

```text
NOVA FONT
    ↓
revisió legal / llicència
    ↓
registre a sources
    ↓
enabled = true
    ↓
crear importer
```

Si no queda clar que una font permet reutilització:

```text
enabled = false
```

i NO s'importarà.

---

# 13. Scraping

Per defecte:

```text
SCRAPING = PROHIBIT
```

No implementar scraping de:

```text
Surtdecasa
FemTurisme
Catalunya.com
altres webs privades
```

sense haver verificat prèviament autorització o condicions que permetin explícitament aquesta reutilització.

En cas de dubte:

```text
NO importar
```

---

# 14. Imatges

No assumir que una imatge inclosa dins d'un dataset és reutilitzable.

Cada font haurà de definir:

```text
allows_images
```

Si:

```text
allows_images = false
```

NO guardar ni mostrar la imatge externa.

Utilitzar:

```text
imatge pròpia per categoria
```

o:

```text
placeholder
```

Exemple:

```text
Festes → il·lustració pròpia
Museus → il·lustració pròpia
Natura → il·lustració pròpia
Platges → il·lustració pròpia
```

No fer hotlinking d'imatges si els drets no són clars.

---

# 15. Atribució

Cada pla ha de conservar la font.

A la fitxa de detall mostrar:

```text
Font de la informació
Agenda Cultural de Catalunya

Generalitat de Catalunya
```

Quan sigui necessari:

```text
Darrera actualització de la font:
16/08/2026
```

Si hi ha diverses fonts:

```text
Fonts:
Generalitat de Catalunya
Diputació de Barcelona
```

---

# 16. Informació legal de l'aplicació

Crear pàgina:

```text
/fonts
```

Català:

```text
Fonts i reutilització de dades
```

Castellà:

```text
Fuentes y reutilización de datos
```

Ha de mostrar totes les fonts actives i:

```text
Nom
Organisme
Dataset
Llicència
Atribució
Enllaç a la font
Data de la darrera revisió de les condicions
```

Crear també:

```text
/legal
```

amb:

```text
Avís legal
Privacitat
Fonts de dades
Condicions d'ús
```

---

# 17. Categories

## Table: categories

```sql
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    slug TEXT UNIQUE NOT NULL,

    name_ca TEXT NOT NULL,
    name_es TEXT NOT NULL,

    group_name TEXT,

    icon TEXT
);
```

Categories inicials:

```text
festes
musica
espectacles
fires-mercats
gastronomia
cultura
familia

natura
senderisme
muntanya
platges
bicicleta
miradors

patrimoni
museus
monuments
pobles
parcs-jardins
```

---

# 18. Relació pla-categoria

```sql
CREATE TABLE plan_categories (
    plan_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,

    PRIMARY KEY(plan_id, category_id)
);
```

Un pla pot tenir diverses categories.

---

# 19. Tags o característiques

Separar conceptes com:

```text
gratis
familiar
interior
exterior
accessible
```

de les categories principals.

No considerar:

```text
gratis
```

com una categoria del mateix nivell que:

```text
museu
```

---

# 20. Primera font: Agenda Cultural de Catalunya

Crear:

```text
gencatAgenda.importer.js
```

Responsabilitats:

```text
1. Obtenir les dades
2. Validar resposta
3. Convertir cada element al model intern
4. Normalitzar localització
5. Normalitzar categories
6. Calcular fingerprint
7. Detectar duplicats
8. Crear o actualitzar pla
9. Registrar plan_sources
10. Registrar execució
```

L'importer NO ha de contenir lògica de frontend.

---

# 21. BaseImporter

Crear una abstracció:

```text
BaseImporter
```

que obligui els futurs importers a implementar:

```text
fetch()
normalize()
getSourceId()
getExternalId()
```

Això permetrà crear després:

```text
GencatAgendaImporter
DibaTourismImporter
DibaParksImporter
CulturalEquipmentImporter
BeachImporter
```

---

# 22. Registre d'importacions

## Table: import_runs

```sql
CREATE TABLE import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    source_id INTEGER NOT NULL,

    started_at TEXT NOT NULL,
    finished_at TEXT,

    status TEXT,

    fetched INTEGER DEFAULT 0,
    inserted INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,

    error_message TEXT
);
```

Això permetrà saber si una sincronització ha fallat.

---

# 23. Deduplicació

Crear un fingerprint inicial basat en:

```text
title normalitzat
+
municipality
+
start_date
```

Exemple:

```text
festa-major-terrassa|terrassa|2026-07-03
```

Normalitzar:

```text
minúscules
accents
articles
espais
signes de puntuació
```

La deduplicació avançada es farà posteriorment.

Mai eliminar automàticament informació d'una font simplement perquè sembla duplicada.

Relacionar les dues fonts amb el mateix `plan`.

---

# 24. Quality Score

Cada pla tindrà:

```text
quality_score
```

de:

```text
0 → 100
```

Punts orientatius:

```text
títol
descripció
dates
municipi
comarca
coordenades
adreça
web
preu
horari
categoria
font fiable
```

Penalitzar:

```text
registre gairebé buit
sense localització
sense descripció
tipus ambigu
```

Inicialment no mostrar:

```text
quality_score < 35
```

excepte en mode administració/debug.

---

# 25. API

## Plans

```http
GET /api/plans
```

Filtres:

```text
date
dateFrom
dateTo

province
comarca
municipality

category

free
family
indoor
outdoor

kind

lat
lng
radius

page
limit

sort
```

---

## Detall

```http
GET /api/plans/:id
```

---

## Categories

```http
GET /api/categories
```

---

## Comarques

```http
GET /api/comarques
```

---

## Municipis

```http
GET /api/municipalities
```

Opcional:

```text
?comarca=Vallès Occidental
```

---

## Fonts

```http
GET /api/sources
```

---

# 26. Lògica de dates

Si l'usuari selecciona:

```text
22/08/2026
```

mostrar:

```text
esdeveniments actius el 22/08/2026
+
plans permanents
```

Esdeveniments:

```text
start_date <= selectedDate
AND
end_date >= selectedDate
```

Plans permanents:

```text
permanent = 1
```

Posteriorment aplicar:

```text
recommended_months
```

per millorar l'ordre.

---

# 27. Filtres inicials de la UI

Pantalla principal:

```text
TENS PLA?

Quan?

[ Aquest cap de setmana ▼ ]

On?

[ Tota Catalunya ▼ ]

Comarca
[ Totes ▼ ]

Municipi
[ Tots ▼ ]

Què et ve de gust?

🎉 Festes
🌲 Natura
🏛 Museus
🍷 Gastronomia
🎵 Música
🛍 Fires
🏖 Platges
🏰 Patrimoni
👨‍👩‍👧 Família
🎭 Espectacles

☐ Gratis
☐ Exterior
☐ Interior
```

---

# 28. Accessos ràpids

Mostrar:

```text
Avui
Demà
Aquest cap de setmana
Propers 7 dies
Escollir dates
```

---

# 29. Pantalla de resultats

Exemple:

```text
42 plans per aquest cap de setmana
al Vallès Occidental
```

Separar visualment:

```text
PASSA AQUEST CAP DE SETMANA

PLANS PERMANENTS

NATURA

PER VISITAR
```

No és obligatori que tots els grups apareguin sempre.

---

# 30. Targeta de pla

Mostrar com a màxim:

```text
Imatge / il·lustració
Nom
Data
Municipi
Comarca
Categoria
Gratis / preu si es coneix
```

No mostrar la descripció completa.

---

# 31. Fitxa de detall

Mostrar:

```text
Títol
Imatge si és reutilitzable
Categoria
Data
Horari
Municipi
Comarca
Adreça
Descripció
Preu
Entrades
Web
Mapa
Font
Darrera actualització
```

---

# 32. Cerca per proximitat

Preparar el backend des de V1 encara que la UI es pugui afegir després.

Paràmetres:

```text
latitude
longitude
radiusKm
```

Permetre:

```text
10 km
25 km
50 km
100 km
```

---

# 33. Favorits

No és necessari per al primer milestone.

Preparar la futura possibilitat de guardar:

```text
plans favorits
```

sense modificar el model de les fonts.

---

# 34. Home futura

La home ha de poder evolucionar cap a:

```text
Aquest cap de setmana

A prop teu

Festes i esdeveniments

Plans gratis

Natura

Plans d'estiu

Plans per dies de pluja

Plans familiars
```

---

# 35. Sincronització

Primera font:

```text
Agenda Cultural Generalitat
```

Periodicitat inicial:

```text
cada 2 hores
```

La freqüència ha de ser configurable:

```env
GENCAT_SYNC_CRON=
```

No hardcodejar-la.

---

# 36. Gestió d'esdeveniments antics

No conservar esdeveniments finalitzats abans del dia actual.

Valor per defecte:

```text
0 dies
```

i posteriorment purgar-los.

Configurable:

```env
EVENT_RETENTION_DAYS=0
```

---

# 37. Índexs SQLite

Crear índexs com a mínim per:

```text
start_date
end_date
permanent
province
comarca
municipality
kind
quality_score
latitude
longitude
```

Crear també índex sobre:

```text
plan_sources.source_record_id
```

---

# 38. Seguretat

No exposar:

```text
paths locals
errors interns
stack traces
configuració del servidor
```

Validar tots els query parameters.

Limitar:

```text
limit <= 100
```

per evitar consultes abusives.

---

# 39. Variables d'entorn

Exemple:

```env
NODE_ENV=production

PORT=XXXX

DATABASE_PATH=./data/quefem.sqlite

GENCAT_SYNC_ENABLED=true
GENCAT_SYNC_CRON=

EVENT_RETENTION_DAYS=0

DEFAULT_LANGUAGE=ca
```

No guardar secrets al repositori.

---

# 40. Primera milestone

La primera milestone NO ha de construir tota l'aplicació.

Objectiu:

```text
Agenda Cultural Generalitat
        ↓
Importer
        ↓
Normalizer
        ↓
SQLite
```

Al final d'aquesta milestone s'ha de poder executar:

```bash
npm run import:gencat
```

i obtenir plans reals a SQLite.

Generar també un resum:

```text
Fetched: 62153
Inserted: 59820
Updated: 0
Skipped: 2333
Errors: 0
```

---

# 41. Segona milestone

Crear l'API:

```text
GET /api/plans
GET /api/plans/:id
GET /api/comarques
GET /api/municipalities
GET /api/categories
```

Comprovar filtres utilitzant dades reals.

---

# 42. Tercera milestone

Crear frontend React.

Inicialment:

```text
Home
Filtres
Resultats
Detall
Selector CA / ES
```

No implementar encara:

```text
favorits
login
IA
recomanacions
mapa avançat
```

---

# 43. Quarta milestone

Afegir primera font externa addicional:

```text
Diputació de Barcelona
```

Implementar:

```text
DibaTourismImporter
```

i provar deduplicació real amb Generalitat.

---

# 44. Cinquena milestone

Incorporar plans permanents:

```text
Equipaments culturals
Espais naturals
Platges
DIBA Parcs
```

---

# 45. Regla d'or per noves fonts

Davant qualsevol nova font:

```text
És legal reutilitzar aquestes dades?
```

Si la resposta no és clarament:

```text
SÍ
```

no s'implementa.

No assumir que:

```text
públic a Internet
```

significa:

```text
lliure per reutilitzar
```

---

# 46. Prioritat del desenvolupament

Prioritzar:

```text
dades fiables
>
legalitat
>
qualitat
>
cobertura
>
quantitat
```

És preferible tenir:

```text
20.000 plans fiables
```

que:

```text
200.000 registres de procedència dubtosa
```

---

# 47. Filosofia del producte

Tens pla? no ha de ser una còpia d'una agenda cultural.

Ha de respondre:

> **Què podem fer?**

combinant esdeveniments que passen en una data concreta amb llocs i activitats que es poden fer qualsevol dia.

La data serveix per trobar esdeveniments, però no ha d'amagar els bons plans permanents.

---

# 48. Idioma de desenvolupament

El codi, noms de variables, endpoints i comentaris tècnics poden estar en anglès.

La interfície d'usuari:

```text
Català → principal
Castellà → secundari
```

Mai hardcodejar textos visibles directament dins dels components React.

Tot text visible ha de passar pel sistema i18n.

---

# 49. Criteris de finalització V1

La V1 es considerarà funcional quan sigui possible:

```text
entrar a l'aplicació

seleccionar una data

seleccionar una comarca

seleccionar un municipi

filtrar per categoria

veure esdeveniments

veure plans permanents

obrir una activitat

consultar-ne els detalls

veure la font original

canviar entre català i castellà
```

amb dades obtingudes exclusivament de fonts aprovades per a reutilització.

---

# 50. Restricció crítica

No ampliar l'abast del projecte automàticament.

Abans d'afegir:

```text
IA
login
scraping
recomanacions personalitzades
notificacions
nous proveïdors
```

completar primer el pipeline:

```text
Font oficial
→ Importer
→ Normalització
→ SQLite
→ API
→ Frontend
```

i comprovar-lo amb dades reals.
