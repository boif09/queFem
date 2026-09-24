// Read-only CLI report: runs the recurring-production detector
// (backend/src/deduplication/recurringProductionDetector.js) against the
// current database and prints candidate groups with their classification.
// Never writes anything — no UPDATE/INSERT/DELETE, no relinking, no
// occurrence backfill. Safe to run against production at any time.
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { detectRecurringProductionCandidates } from '../deduplication/recurringProductionDetector.js';
import { decisionsByGroupKey } from '../deduplication/recurringProductionDecisions.js';

// Per-source adapter: the only source-specific detail is where the raw
// upstream payload keeps its image reference(s) — Gencat serves a
// comma-separated string, DIBA an array. Everything else this job reads
// comes from the already-normalized plans columns, which are source-agnostic.
const SOURCE_IMAGE_FIELD = {
  'gencat-agenda': 'imatges',
  'diba-tourisme': 'imatge',
  'diba-escenari': 'imatge',
  'diba-museus': 'imatge',
};

const DEFAULT_SOURCES = ['gencat-agenda'];
const SUPPORTED_SOURCES = Object.keys(SOURCE_IMAGE_FIELD);

export function loadCandidateRecords(db, { sources = DEFAULT_SOURCES } = {}) {
  const placeholders = sources.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      p.id AS planId, p.original_title AS originalTitle, p.venue_name AS venueName,
      p.municipality, p.latitude, p.longitude, p.start_date AS startDate,
      p.ticket_url AS ticketUrl, p.original_description AS description,
      ps.source_payload_json AS sourcePayloadJson, s.key AS source
    FROM plans p
    JOIN plan_sources ps ON ps.plan_id = p.id
    JOIN sources s ON s.id = ps.source_id
    WHERE s.key IN (${placeholders}) AND p.status = 'active' AND p.start_date IS NOT NULL
    ORDER BY p.id, ps.id
  `).all(...sources);

  return rows.map((row) => {
    let imageUrls = null;
    try {
      const payload = JSON.parse(row.sourcePayloadJson);
      const field = SOURCE_IMAGE_FIELD[row.source];
      imageUrls = field ? payload[field] : null;
    } catch {
      imageUrls = null;
    }
    return {
      planId: row.planId,
      source: row.source,
      originalTitle: row.originalTitle,
      venueName: row.venueName,
      municipality: row.municipality,
      latitude: row.latitude,
      longitude: row.longitude,
      startDate: row.startDate,
      ticketUrl: row.ticketUrl,
      description: row.description,
      imageUrls,
    };
  });
}

function signalSummary(signal) {
  if (!signal.usable) return `not usable (${signal.presentCount} present)`;
  return signal.agree ? `agree (${signal.presentCount} present)` : `DISAGREE (${signal.presentCount} present)`;
}

function printReport(results, { decisions, json }) {
  if (json) {
    console.log(JSON.stringify(results.map((r) => ({
      ...r,
      humanDecision: decisions.get(r.groupKey)?.decision || null,
    })), null, 2));
    return;
  }

  const byClass = { SAFE_AUTOMATIC: [], REVIEW_REQUIRED: [], DO_NOT_GROUP: [] };
  for (const r of results) byClass[r.classification].push(r);

  console.log('Recurring-production candidate detection — READ ONLY, no writes performed.');
  console.log(`Total candidate groups: ${results.length}`);
  console.log(`  SAFE_AUTOMATIC:   ${byClass.SAFE_AUTOMATIC.length}`);
  console.log(`  REVIEW_REQUIRED:  ${byClass.REVIEW_REQUIRED.length}`);
  console.log(`  DO_NOT_GROUP:     ${byClass.DO_NOT_GROUP.length}`);
  console.log();

  for (const classification of ['SAFE_AUTOMATIC', 'REVIEW_REQUIRED', 'DO_NOT_GROUP']) {
    const groups = byClass[classification];
    if (!groups.length) continue;
    console.log(`=== ${classification} (${groups.length}) ===`);
    for (const g of groups) {
      const humanDecision = decisions.get(g.groupKey);
      console.log(`- ${g.venueName} | source=${g.source} | plans=${g.occurrenceCount} (${g.distinctDateCount} distinct dates, ${g.sourceRecordCount} source records) | span=${g.spanDays}d`);
      console.log(`  groupKey: ${g.groupKey}`);
      console.log(`  plan IDs: ${g.planIds.join(', ')}`);
      console.log(`  ticket: ${signalSummary(g.signals.ticket)} | description: ${signalSummary(g.signals.description)} | image: ${signalSummary(g.signals.image)}`);
      for (const reason of g.reasons) console.log(`  reason: ${reason}`);
      if (humanDecision) console.log(`  human decision on file: ${humanDecision.decision} (${humanDecision.reviewedAt}, ${humanDecision.reviewer}) — ${humanDecision.reason}`);
      console.log();
    }
  }
}

function parseArguments(args) {
  const json = args.includes('--json');
  const sourcesArg = args.find((a) => a.startsWith('--sources='));
  const sources = sourcesArg ? sourcesArg.split('=')[1].split(',') : DEFAULT_SOURCES;
  for (const source of sources) {
    if (!SUPPORTED_SOURCES.includes(source)) {
      throw new Error(`Unsupported source "${source}". Supported: ${SUPPORTED_SOURCES.join(', ')}`);
    }
  }
  return { json, sources };
}

export function runDetection(db, options) {
  const records = loadCandidateRecords(db, options);
  return detectRecurringProductionCandidates(records);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const db = openDatabase(config.databasePath, { readonly: true });
  try {
    const results = runDetection(db, options);
    const decisions = decisionsByGroupKey();
    printReport(results, { decisions, json: options.json });
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Recurring-production detection failed: ${error.message}`);
    process.exitCode = 1;
  }
}
