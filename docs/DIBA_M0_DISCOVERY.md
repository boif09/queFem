# DIBA M0 — Discovery, qualitat i solapament

Data d'execució: 2026-08-31T10:40:43.975Z. Finestra reproduïble: 2026-08-31 a 2027-08-31, inclusiva. Aquest és un estudi read-only: no crea fonts, no escriu SQLite i no descarrega imatges.

## Decisió

**RECOMMEND SELECTIVE INTEGRATION**. La valoració només mesura el valor marginal contra la SQLite local; El solapamiento se calcula exclusivamente contra esta SQLite local de solo lectura; su completitud respecto a producción es desconocida.

| Dataset | Actual/futur | Distint DIBA | Alt Gencat | Probable | Aparentment nou | Municipis | Descripció | Coordenades | Imatge | Prioritat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| actesturisme_ca | 223 | 223 | 1 | 0 | 222 | 81 | 100% | 100% | 0% | HIGH PRIORITY |
| escenari | 427 | 427 | 139 | 2 | 286 | 47 | 100% | 89.5% | 98.6% | HIGH PRIORITY |
| actesmuseus | 68 | 68 | 0 | 1 | 67 | 11 | 92.6% | 100% | 66.2% | HIGH PRIORITY |
| actesbiblioteques_ca | 880 | 880 | 1 | 0 | 879 | 100 | 0% | 93.4% | 94.3% | MEDIUM PRIORITY |
| agendageneral_ca | 136 | 136 | 0 | 0 | 136 | 0 | 60.3% | 61% | 47.8% | EXCLUDE |
| exposicions | 12 | 12 | 0 | 0 | 12 | 8 | 100% | 83.3% | 0% | MEDIUM PRIORITY |

## API i datasets

L'API oficial HTTPS és `https://do.diba.cat/api/`. Cada dataset s'ha paginat explícitament amb `pag-ini/pag-fi` fins al recompte `entitats`; una discrepància, pàgina buida prematura o ID repetit aborta l'anàlisi. La resposta porta la metadata del dataset, `elements` i el recompte.

Els sis datasets principals declaren tipus `acte`; la seva clau primària observada és `acte_id`. Camps comuns observats: `titol`, `data_inici`, `data_fi`, `descripcio`, `imatge`, `acte_url`, `url_general`, `url_inscripcions`, `grup_adreca`, `rel_municipis`, `tags`, `categoria`, `preu`, `public`, `id_secundari` i `_lastChange`; no tots apareixen en tots els datasets. La relació `rel_municipis.ine` és el candidat preferit de geografia futura, amb comarca/província anidades quan existeixen. Les coordenades de `grup_adreca.localitzacio` s'han de tractar com a seu d'acte només quan el dataset ho confirma; la relació municipal també inclou un centre municipal que no s'ha d'emprar com a ubicació de l'activitat.

Inventari event-like addicional (no inclòs en el càlcul principal):

- `actesparcs` — Parcs naturals: agenda d'activitats; 8491 registres; modificat 2024-12-16 08:54:34; stale or requires freshness review.
- `actesdiba_ca` — Agenda electes; 11211 registres; modificat 2025-10-13 23:42:14; institutional/political/not suitable.
- `actesturisme_es` — Turismo: Agenda de actividades destacadas; 451 registres; modificat 2026-08-31 10:47:05; potentially useful later.
- `actesturisme_en` — Tourism: Highlights of what’s on; 604 registres; modificat 2026-08-31 09:07:05; potentially useful later.
- `actesturisme_fr` — Tourisme: Programme des principales activités; 481 registres; modificat 2026-08-31 00:07:06; potentially useful later.
- `actesturisme_de` — Tourismus: Agenda der empfohlenen Aktivitäten; 451 registres; modificat 2026-08-31 11:57:05; potentially useful later.
- `actesturisme_ru` — Туризм: Календарь основных мероприятий; 630 registres; modificat 2026-08-31 09:27:06; potentially useful later.

Parcs Naturals apareix com a agenda però el catàleg indica modificació 2024-12-16 08:54:34; es manté fora del càlcul principal fins a verificar-ne l'actualitat.

## Qualitat, idioma, llicència i imatges

Els datasets primaris analitzats declaren català (actesturisme_ca, escenari, actesmuseus, actesbiblioteques_ca, agendageneral_ca, exposicions). El turisme publica variants de llengua com datasets separats (per exemple `actesturisme_es`), no com traduccions d'un únic registre observades en aquesta M0. Les metadades de tots els datasets analitzats indiquen CC BY 4.0, però això **no autoritza automàticament reutilitzar fotografies de tercers**: només s'ha mesurat la presència i el domini de `imatge`; no s'han descarregat, persistit ni publicat imatges DIBA. La Generic Image Library continua sent el fallback.

Dates sense iniciar o invàlides es compten per separat; les activitats iniciades abans d'avui amb final futur s'inclouen, i les que comencen més enllà de l'horitzó no. Les mostres de qualitat són al JSON generat, sense telèfons ni correus.

## Duplicació interna i solapament local

DIBA candidats bruts: 1746. Clústers DIBA distints: 1739. Clústers interns d'alta confiança: 7; probables: 0; ambigus no fusionats: 0.

Exemples interns:

- high: actesturisme_ca/agendaturisme444386448 (Museucontes) ↔ actesmuseus/actesmuseus3356068 (Museucontes)
- high: actesturisme_ca/agendaturisme444985488 (Visites guiades a l'Ermita de Sales) ↔ actesmuseus/actesmuseus3355625 (Visites guiades a l'Ermita de Sales)
- high: actesturisme_ca/agendaturisme454396010 (Les vagues generals al Baix Llobregat) ↔ actesmuseus/actesmuseus3363082 (Les vagues generals al Baix Llobregat)
- high: actesturisme_ca/agendaturisme457837487 (ASDIVI. Anys canviant mirades.) ↔ actesmuseus/actesmuseus3365207 (ASDIVI. Anys canviant mirades)
- high: actesturisme_ca/agendaturisme458050955 (Jornada de portes obertes al Museu del Turisme) ↔ actesmuseus/actesmuseus3365288 (Jornada de portes obertes al Museu del Turisme)
- high: actesturisme_ca/agendaturisme458211996 (Exposició temporal Representant la Llum) ↔ actesmuseus/actesmuseus3365302 (Exposició temporal Representant la Llum)
- high: actesturisme_ca/agendaturisme458212994 (Visita guiada al Museu Municipal) ↔ actesmuseus/actesmuseus3365311 (Visita guiada al Museu municipal)

Baseline local: 2029 plans actius; fonts: fever=0, gencat-agenda=1959, ticketmaster-discovery-feed=71. La completitud de producció és desconeguda.

Solapament contra la SQLite local: alt 141, probable 3, possible 14; els possibles **no** es resten de l'estimació conservadora de novetat.

## Mostra d'aportació aparentment nova

- actesbiblioteques_ca/agendabiblioteques454009821: EXPOSICIÓ: La capsa de les bèsties — Aiguafreda (2026-09-10 fins a 2026-09-30)
- actesmuseus/actesmuseus3358146: Tresors de l'Arca. Dos segles fent de la punta un art. — Arenys de Mar (2026-03-29 fins a 2026-12-27)
- actesturisme_ca/agendaturisme447228138: Brunch  Wine — Alella (2026-01-12 fins a 2026-12-23)
- escenari/escenari7280194213658601366742: El retrat de Dorian Gray — Badalona (2026-11-06 fins a 2026-11-06)
- exposicions/exposicio451622573: Els primers passos cap a la democràcia a Badalona — Badalona (2026-05-21 fins a 2026-09-26)
- actesbiblioteques_ca/agendabiblioteques458328329: XERRADA: La grafologia, art i ciència — Aiguafreda (2026-09-18 fins a 2026-09-18)
- actesmuseus/actesmuseus3364752: Un nou futur, una nova esperança. Els primers passos cap a la Democràcia (1976-1978) — Badalona (2026-05-22 fins a 2026-09-27)
- actesturisme_ca/agendaturisme447230026: Ioga entre vinyes — Alella (2026-01-12 fins a 2026-12-21)
- escenari/escenari136675060113667531366758: David y José. No somos Estopa — Badalona (2026-11-07 fins a 2026-11-07)
- exposicions/exposicio394897477: Cossos que parlen (dades bàsiques) Versió 2026 — El Masnou (2026-07-10 fins a 2026-09-27)
- actesbiblioteques_ca/agendabiblioteques458328648: ESPECTACLE FAMILIAR: 'Narcisa i Clementina: quan les paraules canten' — Aiguafreda (2026-09-30 fins a 2026-09-30)
- actesmuseus/actesmuseus3364756: Visita guiada a les cases romanes dels Dofins i de l'Heura — Badalona (2026-09-06 fins a 2026-09-06)
- actesturisme_ca/agendaturisme447228193: Microteatre entre vinyes — Alella (2026-01-12 fins a 2026-12-21)
- escenari/escenari26179194213665051366504: Bò — Badalona (2026-11-13 fins a 2026-11-13)
- exposicions/exposicio455373126: Cossos que parlen al Masnou — El Masnou (2026-07-10 fins a 2026-09-27)
- actesbiblioteques_ca/agendabiblioteques455959523: Club de lectura. L'estrangera, de Claudia Durastanti — Alella (2026-09-03 fins a 2026-09-03)
- actesmuseus/actesmuseus3364761: Visita guiada a la fàbrica de l'Anís del Mono — Badalona (2026-09-20 fins a 2026-09-20)
- actesturisme_ca/agendaturisme447228172: Visita i sopar amb maridatge de temporada — Alella (2026-01-12 fins a 2026-12-21)
- escenari/escenari14440193012907591366492: Mac, Mec, Mic — Badalona (2026-11-14 fins a 2026-11-14)
- exposicions/exposicio456672762: Els primers passos cap a la democràcia a Manresa — Manresa (2026-09-17 fins a 2026-11-29)
- actesbiblioteques_ca/agendabiblioteques452103492: 2n Cicle de contes breus. 'Animals inexpressius' de Xavier Mas Craviotto — Alella (2026-09-16 fins a 2026-09-16)
- actesmuseus/actesmuseus3364765: Visita guiada a la fàbrica de l'Anís del Mono — Badalona (2026-09-20 fins a 2026-09-20)
- actesturisme_ca/agendaturisme447227960: Visita i tast amb pernil i formatges — Alella (2026-01-12 fins a 2026-12-22)
- escenari/escenari14440193012907591366493: Mac, Mec, Mic — Badalona (2026-11-14 fins a 2026-11-14)
- exposicions/exposicio441020345: Expo Atzar (dades bàsiques) — Ripollet (2026-09-12 fins a 2026-11-08)

## Arquitectura futura recomanada

Si s'aprova M1, usar una única font lògica `diba` amb `dataset` guardat a la procedència/payload i reconciliació independent per dataset. Això permet atribució comuna, activació global simple i evita crear fonts públiques redundants; els errors, snapshots i desaparicions s'han de registrar per dataset. La ingestió ha d'usar snapshot complet inicial i, posteriorment, avaluar `_lastChange` sense substituir la conciliació completa. Cal fer matching abans de crear plans per adjuntar DIBA a plans Gencat/Ticketmaster/Fever genuïnament coincidents, i conservar els clústers interns per a revisió, mai fusionar-los destructivament.

Proposta de M1: importer estrictament de llista blanca, només per als datasets amb prioritat HIGH/MEDIUM; normalitzador CA que no usa imatges; geografia per `rel_municipis.ine` validada amb ICGC; dry-run de reconciliació multi-font i revisió legal separada d'imatges abans de qualsevol display.
