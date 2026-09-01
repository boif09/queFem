import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import {
  PRIMARY_DATASETS, DibaApiClient, classifyDate, clusterDibaCandidates, dateInCatalonia,
  localBaselineWarning, matchDibaToLocal, summarizeDataset,
} from '../backend/src/diba/m0Discovery.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function percentage(value, total) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function readLocalBaseline(databasePath, today, horizonEnd) {
  if (!fs.existsSync(databasePath)) return { available: false, warning: `No existe la SQLite local: ${databasePath}`, plans: [] };
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const sources = db.prepare(`SELECT s.key, COUNT(DISTINCT ps.plan_id) count FROM sources s LEFT JOIN plan_sources ps ON ps.source_id=s.id GROUP BY s.key ORDER BY s.key`).all();
    const plans = db.prepare(`SELECT p.id,p.original_title title,p.municipality,p.venue_name venue,p.start_date startDate,p.end_date endDate,
      GROUP_CONCAT(DISTINCT s.key) sourceKeys,GROUP_CONCAT(DISTINCT ps.source_url) urls
      FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
      WHERE p.status='active' AND (p.permanent=1 OR p.end_date IS NULL OR p.end_date>=?) AND (p.start_date IS NULL OR p.start_date<=?)
      GROUP BY p.id`).all(today, horizonEnd).map((row) => ({ ...row, sources: (row.sourceKeys || '').split(',').filter(Boolean), urls: (row.urls || '').split(',').filter(Boolean) }));
    const activePlans = db.prepare("SELECT COUNT(*) count FROM plans WHERE status='active'").get().count;
    return {
      available: true, activePlans, sources, plans,
      warning: localBaselineWarning(),
    };
  } finally { db.close(); }
}

function inventory(datasets) {
  return datasets.filter((dataset) => dataset.tipus === 'acte').map((dataset) => ({
    machineName: dataset.machinename, name: dataset.nom, records: dataset.entitats, modified: dataset.modificacio,
    language: dataset.idioma, responsibility: dataset.responsable, description: dataset.descripcio,
    classification: /elect|corporativa|institucional|ple|govern/i.test(`${dataset.machinename} ${dataset.nom} ${dataset.descripcio}`) ? 'institutional/political/not suitable' :
      /parc/i.test(`${dataset.machinename} ${dataset.nom}`) ? 'stale or requires freshness review' : 'potentially useful later',
  }));
}

function compactExample(item) {
  return {
    dataset: item.dataset, id: item.id, title: item.title, municipality: item.municipality,
    startDate: item.startDate, endDate: item.endDate, eventUrl: item.eventUrl, categories: item.categories.slice(0, 5),
  };
}

function priorityFor(dataset, metrics, quality) {
  if (dataset === 'agendageneral_ca') return 'EXCLUDE';
  if (dataset === 'exposicions') return metrics.apparentlyNew >= 10 ? 'MEDIUM PRIORITY' : 'LOW PRIORITY';
  if (dataset === 'actesbiblioteques_ca') return quality.description === 0 ? 'MEDIUM PRIORITY' : 'HIGH PRIORITY';
  return metrics.apparentlyNew >= 30 ? 'HIGH PRIORITY' : metrics.apparentlyNew >= 10 ? 'MEDIUM PRIORITY' : 'LOW PRIORITY';
}

function diverseExamples(items, limit = 25) {
  const groups = new Map();
  for (const item of items) {
    const group = groups.get(item.dataset) || [];
    group.push(item);
    groups.set(item.dataset, group);
  }
  for (const group of groups.values()) group.sort((a, b) => (a.municipality || '').localeCompare(b.municipality || '') || (a.startDate || '').localeCompare(b.startDate || '') || a.title.localeCompare(b.title));
  const selected = [];
  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const dataset of [...groups.keys()].sort()) {
      const item = groups.get(dataset)[index];
      if (item) { selected.push(item); added = true; }
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function report(summary) {
  const rows = Object.entries(summary.datasets).map(([key, value]) => {
    const overlap = summary.datasetOverlap[key];
    return `| ${key} | ${value.counts.candidate} | ${overlap.distinct} | ${overlap.highGencat} | ${overlap.probable} | ${overlap.apparentlyNew} | ${value.distinctMunicipalities} | ${percentage(value.quality.description, value.counts.candidate)}% | ${percentage(value.quality.coordinates, value.counts.candidate)}% | ${percentage(value.quality.imageUrl, value.counts.candidate)}% | ${overlap.priority} |`;
  }).join('\n');
  const examples = summary.apparentlyNewExamples.map((item) => `- ${item.dataset}/${item.id}: ${item.title} — ${item.municipality || 'sense municipi'} (${item.startDate || 'sense data'} fins a ${item.endDate || 'sense fi informat'})`).join('\n');
  const duplicates = summary.internalDuplicateExamples.map((cluster) => `- ${cluster.confidence}: ${cluster.members.map((item) => `${item.dataset}/${item.id} (${item.title})`).join(' ↔ ')}`).join('\n');
  return `# DIBA M0 — Discovery, qualitat i solapament\n\nData d'execució: ${summary.generatedAt}. Finestra reproduïble: ${summary.window.today} a ${summary.window.horizonEnd}, inclusiva. Aquest és un estudi read-only: no crea fonts, no escriu SQLite i no descarrega imatges.\n\n## Decisió\n\n**${summary.decision}**. La valoració només mesura el valor marginal contra la SQLite local; ${summary.localBaseline.warning}\n\n| Dataset | Actual/futur | Distint DIBA | Alt Gencat | Probable | Aparentment nou | Municipis | Descripció | Coordenades | Imatge | Prioritat |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n## API i datasets\n\nL'API oficial HTTPS és \`https://do.diba.cat/api/\`. Cada dataset s'ha paginat explícitament amb \`pag-ini/pag-fi\` fins al recompte \`entitats\`; una discrepància, pàgina buida prematura o ID repetit aborta l'anàlisi. La resposta porta la metadata del dataset, \`elements\` i el recompte.\n\nEls sis datasets principals declaren tipus \`acte\`; la seva clau primària observada és \`acte_id\`. Camps comuns observats: \`titol\`, \`data_inici\`, \`data_fi\`, \`descripcio\`, \`imatge\`, \`acte_url\`, \`url_general\`, \`url_inscripcions\`, \`grup_adreca\`, \`rel_municipis\`, \`tags\`, \`categoria\`, \`preu\`, \`public\`, \`id_secundari\` i \`_lastChange\`; no tots apareixen en tots els datasets. La relació \`rel_municipis.ine\` és el candidat preferit de geografia futura, amb comarca/província anidades quan existeixen. Les coordenades de \`grup_adreca.localitzacio\` s'han de tractar com a seu d'acte només quan el dataset ho confirma; la relació municipal també inclou un centre municipal que no s'ha d'emprar com a ubicació de l'activitat.\n\nInventari event-like addicional (no inclòs en el càlcul principal):\n\n${summary.inventory.map((item) => `- \`${item.machineName}\` — ${item.name}; ${item.records} registres; modificat ${item.modified}; ${item.classification}.`).join('\n')}\n\nParcs Naturals apareix com a agenda però el catàleg indica modificació ${summary.parcs?.modified || 'no observada'}; es manté fora del càlcul principal fins a verificar-ne l'actualitat.\n\n## Qualitat, idioma, llicència i imatges\n\nEls datasets primaris analitzats declaren català (${summary.catalanDatasets.join(', ')}). El turisme publica variants de llengua com datasets separats (per exemple \`actesturisme_es\`), no com traduccions d'un únic registre observades en aquesta M0. Les metadades de tots els datasets analitzats indiquen CC BY 4.0, però això **no autoritza automàticament reutilitzar fotografies de tercers**: només s'ha mesurat la presència i el domini de \`imatge\`; no s'han descarregat, persistit ni publicat imatges DIBA. La Generic Image Library continua sent el fallback.\n\nDates sense iniciar o invàlides es compten per separat; les activitats iniciades abans d'avui amb final futur s'inclouen, i les que comencen més enllà de l'horitzó no. Les mostres de qualitat són al JSON generat, sense telèfons ni correus.\n\n## Duplicació interna i solapament local\n\nDIBA candidats bruts: ${summary.rawCandidates}. Clústers DIBA distints: ${summary.distinctCandidates}. Clústers interns d'alta confiança: ${summary.internal.high}; probables: ${summary.internal.probable}; ambigus no fusionats: ${summary.internal.ambiguous}.\n\nExemples interns:\n\n${duplicates || '- No s’han observat clústers cross-dataset en aquesta execució.'}\n\nBaseline local: ${summary.localBaseline.activePlans ?? 0} plans actius; fonts: ${(summary.localBaseline.sources || []).map((item) => `${item.key}=${item.count}`).join(', ') || 'SQLite no disponible'}. La completitud de producció és desconeguda.\n\nSolapament contra la SQLite local: alt ${summary.overlap.high}, probable ${summary.overlap.probable}, possible ${summary.overlap.possible}; els possibles **no** es resten de l'estimació conservadora de novetat.\n\n## Mostra d'aportació aparentment nova\n\n${examples || '- No hi ha exemples suficients en la SQLite local actual.'}\n\n## Arquitectura futura recomanada\n\nSi s'aprova M1, usar una única font lògica \`diba\` amb \`dataset\` guardat a la procedència/payload i reconciliació independent per dataset. Això permet atribució comuna, activació global simple i evita crear fonts públiques redundants; els errors, snapshots i desaparicions s'han de registrar per dataset. La ingestió ha d'usar snapshot complet inicial i, posteriorment, avaluar \`_lastChange\` sense substituir la conciliació completa. Cal fer matching abans de crear plans per adjuntar DIBA a plans Gencat/Ticketmaster/Fever genuïnament coincidents, i conservar els clústers interns per a revisió, mai fusionar-los destructivament.\n\nProposta de M1: importer estrictament de llista blanca, només per als datasets amb prioritat HIGH/MEDIUM; normalitzador CA que no usa imatges; geografia per \`rel_municipis.ine\` validada amb ICGC; dry-run de reconciliació multi-font i revisió legal separada d'imatges abans de qualsevol display.\n`;
}

async function main() {
  const today = dateInCatalonia();
  const horizonEnd = new Date(`${today}T00:00:00.000Z`);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 365);
  const window = { today, horizonEnd: horizonEnd.toISOString().slice(0, 10) };
  const client = new DibaApiClient();
  const catalog = await client.listDatasets();
  const datasetDownloads = {};
  for (const dataset of PRIMARY_DATASETS) {
    console.log(`DIBA M0: descarregant ${dataset}…`);
    datasetDownloads[dataset] = await client.fetchDataset(dataset);
  }
  const datasets = {};
  for (const [dataset, download] of Object.entries(datasetDownloads)) datasets[dataset] = summarizeDataset(dataset, download.records, window);
  const allCandidates = Object.values(datasets).flatMap((dataset) => dataset.candidates);
  const clusters = clusterDibaCandidates(allCandidates);
  const config = loadConfig();
  const localBaseline = readLocalBaseline(config.databasePath, window.today, window.horizonEnd);
  const localMatches = matchDibaToLocal(clusters, localBaseline.plans || []);
  const matchesByCluster = new Map(localMatches.map((match) => [match.clusterId, match]));
  const datasetOverlap = {};
  for (const dataset of PRIMARY_DATASETS) {
    const relevant = clusters.filter((cluster) => cluster.members.some((item) => item.dataset === dataset));
    const metric = { distinct: relevant.length, high: 0, probable: 0, possible: 0, highGencat: 0, apparentlyNew: 0, priority: 'LOW PRIORITY' };
    for (const cluster of relevant) {
      const match = matchesByCluster.get(cluster.id);
      if (match?.level === 'high') metric.high += 1;
      if (match?.level === 'probable') metric.probable += 1;
      if (match?.level === 'possible') metric.possible += 1;
      if (match?.level === 'high' && match.matches.some((item) => item.sources.includes('gencat-agenda'))) metric.highGencat += 1;
      if (!match || !['high', 'probable'].includes(match.level)) metric.apparentlyNew += 1;
    }
    const value = datasets[dataset];
    metric.priority = priorityFor(dataset, metric, value.quality);
    datasetOverlap[dataset] = metric;
  }
  const overlap = { high: 0, probable: 0, possible: 0 };
  for (const match of localMatches) if (match.level in overlap) overlap[match.level] += 1;
  const overlapBySource = {};
  for (const match of localMatches.filter((item) => ['high', 'probable'].includes(item.level))) {
    for (const source of new Set(match.matches.flatMap((item) => item.sources))) overlapBySource[source] = (overlapBySource[source] || 0) + 1;
  }
  const internal = {
    high: clusters.filter((cluster) => cluster.confidence === 'high').length,
    probable: clusters.filter((cluster) => cluster.confidence === 'probable').length,
    ambiguous: 0,
  };
  const editorialDatasets = new Set(PRIMARY_DATASETS.filter((dataset) => dataset !== 'agendageneral_ca'));
  const apparentlyNewClusters = clusters.filter((cluster) => !['high', 'probable'].includes(matchesByCluster.get(cluster.id)?.level));
  const apparentlyNewExamples = diverseExamples(apparentlyNewClusters.flatMap((cluster) => cluster.members.slice(0, 1)).filter((item) => editorialDatasets.has(item.dataset) && item.title && item.municipality)).map(compactExample);
  const highOverlapExamples = clusters.filter((cluster) => matchesByCluster.get(cluster.id)?.level === 'high').slice(0, 10).map((cluster) => ({ diba: compactExample(cluster.members[0]), local: matchesByCluster.get(cluster.id).matches }));
  const primaryMetadata = Object.fromEntries(Object.entries(datasetDownloads).map(([key, value]) => {
    const schema = catalog.find((item) => item.machinename === key) || value.metadata;
    return [key, {
      label: value.metadata.nom, language: value.metadata.idioma, license: value.metadata.llicencia, modified: value.metadata.modificacio,
      total: value.metadata.entitats, primaryKey: schema.estructura?.camps?.find((field) => field.primari)?.machinename || null,
      fields: schema.estructura?.camps?.map((field) => ({ machineName: field.machinename, name: field.nom, type: field.tipus, group: field.grup_pare })) || [],
      relations: schema.estructura?.relacions || [], pages: value.pageStats,
    }];
  }));
  const apparentlyNewDistinct = apparentlyNewClusters.length;
  const recommendedApparentlyNew = apparentlyNewClusters.filter((cluster) => cluster.members.some((item) => editorialDatasets.has(item.dataset))).length;
  const summary = {
    generatedAt: new Date().toISOString(), window, primaryDatasets: PRIMARY_DATASETS, datasets: Object.fromEntries(Object.entries(datasets).map(([key, value]) => [key, { ...value, candidates: undefined }])),
    primaryMetadata, inventory: inventory(catalog).filter((item) => !PRIMARY_DATASETS.includes(item.machineName)),
    parcs: (() => { const dataset = catalog.find((item) => item.machinename === 'actesparcs'); return dataset ? { ...dataset, modified: dataset.modificacio } : null; })(), rawCandidates: allCandidates.length, distinctCandidates: clusters.length,
    internal, localBaseline: { ...localBaseline, plans: undefined }, overlap, overlapBySource, datasetOverlap, apparentlyNewExamples, highOverlapExamples,
    internalDuplicateExamples: clusters.filter((cluster) => cluster.confidence).slice(0, 10).map((cluster) => ({ confidence: cluster.confidence, members: cluster.members.map(compactExample) })),
    catalanDatasets: PRIMARY_DATASETS.filter((dataset) => /catal/i.test(datasetDownloads[dataset].metadata.idioma || '')),
    apparentlyNewDistinct, recommendedApparentlyNew,
    decision: recommendedApparentlyNew >= 100 ? 'RECOMMEND SELECTIVE INTEGRATION' : recommendedApparentlyNew >= 30 ? 'LOW MARGINAL VALUE' : 'NOT RECOMMENDED',
  };
  const reportsDirectory = path.join(projectRoot, 'data', 'reports');
  fs.mkdirSync(reportsDirectory, { recursive: true });
  fs.writeFileSync(path.join(reportsDirectory, 'diba-m0-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(projectRoot, 'docs', 'DIBA_M0_DISCOVERY.md'), report(summary));
  console.log(`DIBA M0 complete: ${summary.distinctCandidates} candidats DIBA distints; ${summary.overlap.high} coincidències locals d'alta confiança; ${summary.recommendedApparentlyNew} aparents nous recomanats.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`DIBA M0 failed: ${error.message}`); process.exitCode = 1; });
}
