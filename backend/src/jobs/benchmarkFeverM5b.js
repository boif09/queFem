import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { PlanQueryRepository } from '../db/repositories/planQuery.repository.js';
import { feverCategorySlugs, normalizeFeverPrice } from '../fever/publicationPolicy.js';
import { assertTemporaryDatabasePath } from './importFeverTemp.js';

const NOW = new Date('2026-08-26T10:00:00.000Z');
const SAMPLES = 5;
const WARMUP = 1;
const CANDIDATE_INDEXES = {
  sourceStatusDateTime: 'CREATE INDEX idx_m5b_occ_source_status_date_time ON plan_occurrences(plan_source_id, status, local_date, local_time)',
  statusDateSourceTime: 'CREATE INDEX idx_m5b_occ_status_date_source_time ON plan_occurrences(status, local_date, plan_source_id, local_time)',
};

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function statistics(values) {
  return {
    minMs: Number(Math.min(...values).toFixed(1)),
    medianMs: Number(percentile(values, 0.5).toFixed(1)),
    p95Ms: Number(percentile(values, 0.95).toFixed(1)),
  };
}

function listFilters(overrides = {}) {
  return {
    page: 1, limit: 20, sort: 'date', lang: 'ca', ...overrides,
  };
}

const EXPLAIN_FILTERS = {
  general: listFilters(),
  today: listFilters({ date: '2026-08-26' }),
  weekend: listFilters({ editorial: 'home-weekend', permanent: 0, dateFrom: '2026-08-29', dateTo: '2026-08-30' }),
  upcoming: listFilters({ editorial: 'home-upcoming', permanent: 0, dateFrom: '2026-08-26' }),
};

function firstValue(db, sql, fallback) {
  return db.prepare(sql).get()?.value || fallback;
}

function benchmark(label, operation) {
  for (let index = 0; index < WARMUP; index += 1) operation();
  const durations = [];
  let result;
  for (let index = 0; index < SAMPLES; index += 1) {
    const started = performance.now();
    result = operation();
    durations.push(performance.now() - started);
  }
  return {
    label,
    results: Array.isArray(result?.plans) ? result.total : result ? 1 : 0,
    samples: SAMPLES,
    ...statistics(durations),
  };
}

export function setFeverEnabledTemporary(databasePath, enabled, config = loadConfig()) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath));
  try {
    return db.prepare("UPDATE sources SET enabled=? WHERE key='fever'").run(Number(enabled)).changes;
  } finally {
    db.close();
  }
}

export function manageCandidateIndex(databasePath, candidate, action, config = loadConfig()) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const sql = CANDIDATE_INDEXES[candidate];
  if (!sql) throw new Error(`Unknown candidate index: ${candidate}`);
  const name = /CREATE INDEX (\w+)/.exec(sql)[1];
  const db = openDatabase(path.resolve(databasePath));
  try {
    const before = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
    if (action === 'create') db.exec(sql);
    else if (action === 'drop') db.exec(`DROP INDEX IF EXISTS ${name}`);
    else throw new Error('Candidate index action must be create or drop');
    db.pragma('wal_checkpoint(TRUNCATE)');
    const after = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
    return { candidate, action, bytesBefore: before, bytesAfter: after, deltaBytes: after - before };
  } finally {
    db.close();
  }
}

export function migrateTemporary(databasePath, config = loadConfig()) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath));
  try {
    migrate(db);
    return { integrityCheck: db.pragma('integrity_check', { simple: true }) };
  } finally {
    db.close();
  }
}

export function vacuumTemporary(databasePath, config = loadConfig()) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath));
  try {
    const before = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
    db.exec('VACUUM');
    const after = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
    return { bytesBefore: before, bytesAfter: after, deltaBytes: after - before };
  } finally {
    db.close();
  }
}

export function explainFeverM5b(databasePath, label, config = loadConfig()) {
  const filters = EXPLAIN_FILTERS[label];
  if (!filters) throw new Error(`Unknown explain case: ${label}`);
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath), { readonly: true });
  try {
    const repository = new PlanQueryRepository(db, { eventRetentionDays: config.eventRetentionDays, now: () => NOW });
    const where = repository.buildWhere(filters);
    return db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM plans p WHERE ${where.sql}`)
      .all(...where.parameters).map(({ id, parent, detail }) => ({ id, parent, detail }));
  } finally {
    db.close();
  }
}

export function reportFeverM5b(databasePath, config = loadConfig()) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath), { readonly: true });
  try {
    const repository = new PlanQueryRepository(db, {
      eventRetentionDays: config.eventRetentionDays, now: () => NOW, feverImagesEnabled: false,
    });
    const feverRows = db.prepare(`SELECT ps.source_payload_json FROM plan_sources ps
      JOIN sources s ON s.id=ps.source_id WHERE s.key='fever'`).all();
    const priceTypes = { free: 0, fixed: 0, from: 0, unknown: 0 };
    const unmapped = new Map();
    for (const { source_payload_json: rawPayload } of feverRows) {
      const payload = JSON.parse(rawPayload);
      priceTypes[normalizeFeverPrice(payload.CurrentPrice, payload.Currency, payload.Labels).type] += 1;
      if (!feverCategorySlugs(payload.SubCategory).length) {
        const label = payload.SubCategory || '(empty)';
        unmapped.set(label, (unmapped.get(label) || 0) + 1);
      }
    }
    const sourceCounts = db.prepare(`SELECT s.key, COUNT(DISTINCT ps.id) sources, COUNT(DISTINCT ps.plan_id) plans
      FROM sources s LEFT JOIN plan_sources ps ON ps.source_id=s.id GROUP BY s.key ORDER BY s.key`).all();
    const feverPlan = db.prepare(`SELECT p.id, p.province, p.comarca, p.municipality, c.slug category, o.local_date occurrenceDate
      FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
      JOIN plan_occurrences o ON o.plan_source_id=ps.id
      LEFT JOIN plan_categories pc ON pc.plan_id=p.id LEFT JOIN categories c ON c.id=pc.category_id
      WHERE s.key='fever' AND o.status='active' AND o.local_date>=?
      ORDER BY o.local_date, p.id LIMIT 1`).get('2026-08-26');
    const feverPlanIds = new Set(db.prepare(`SELECT DISTINCT ps.plan_id id FROM plan_sources ps
      JOIN sources s ON s.id=ps.source_id WHERE s.key='fever'`).all().map(({ id }) => id));
    const listHasFever = (filters) => {
      const first = repository.findMany(listFilters({ ...filters, limit: 200 }));
      if (first.plans.some(({ id }) => feverPlanIds.has(id))) return true;
      for (let page = 2; page <= Math.ceil(first.total / 200); page += 1) {
        if (repository.findMany(listFilters({ ...filters, page, limit: 200 })).plans.some(({ id }) => feverPlanIds.has(id))) return true;
      }
      return false;
    };
    return {
      integrityCheck: db.pragma('integrity_check', { simple: true }),
      databaseBytes: db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true }),
      tables: db.prepare(`SELECT
        (SELECT COUNT(*) FROM plans) plans,
        (SELECT COUNT(*) FROM sources) sources,
        (SELECT COUNT(*) FROM sources WHERE enabled=1) enabledSources,
        (SELECT COUNT(*) FROM plan_occurrences) occurrences`).get(),
      fever: {
        enabled: db.prepare("SELECT enabled FROM sources WHERE key='fever'").get().enabled,
        ...db.prepare(`SELECT COUNT(DISTINCT p.id) plans, COUNT(DISTINCT ps.id) sources,
          COUNT(DISTINCT CASE WHEN o.status='active' THEN o.id END) activeOccurrences,
          COUNT(DISTINCT CASE WHEN o.status='inactive' THEN o.id END) inactiveOccurrences
          FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
          LEFT JOIN plan_occurrences o ON o.plan_source_id=ps.id WHERE s.key='fever'`).get(),
        priceTypes,
        mapped: feverRows.length - [...unmapped.values()].reduce((sum, value) => sum + value, 0),
        unmapped: [...unmapped.values()].reduce((sum, value) => sum + value, 0),
        topUnmappedSubcategories: [...unmapped.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10),
      },
      sourceCounts,
      occurrenceIndexes: db.pragma('index_list(plan_occurrences)').map(({ name }) => name),
      visibility: {
        feverPlanId: feverPlan.id,
        detailVisible: Boolean(repository.findById(feverPlan.id, 'ca')),
        feverInOccurrenceDay: listHasFever({ date: feverPlan.occurrenceDate }),
        feverInMunicipality: listHasFever({ municipality: feverPlan.municipality }),
        feverInComarca: listHasFever({ comarca: feverPlan.comarca }),
        feverInProvince: listHasFever({ province: feverPlan.province }),
        feverInCategory: feverPlan.category ? listHasFever({ categories: [feverPlan.category] }) : null,
        feverInSitemap: repository.findSitemapPlanIds().includes(feverPlan.id),
        feverSourceExposed: repository.findSources().some(({ key }) => key === 'fever'),
      },
    };
  } finally {
    db.close();
  }
}

export function benchmarkFeverM5b(databasePath, config = loadConfig(), onlyLabel = null) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  const db = openDatabase(path.resolve(databasePath), { readonly: true });
  try {
    const repository = new PlanQueryRepository(db, {
      eventRetentionDays: config.eventRetentionDays,
      feverImagesEnabled: false,
      now: () => NOW,
    });
    const municipality = firstValue(db, `SELECT p.municipality value FROM plans p
      JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
      WHERE s.key='fever' AND p.municipality IS NOT NULL GROUP BY p.municipality
      ORDER BY COUNT(*) DESC LIMIT 1`, 'Barcelona');
    const comarca = firstValue(db, `SELECT p.comarca value FROM plans p
      JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
      WHERE s.key='fever' AND p.comarca IS NOT NULL GROUP BY p.comarca
      ORDER BY COUNT(*) DESC LIMIT 1`, 'Barcelonès');
    const category = firstValue(db, `SELECT c.slug value FROM categories c
      JOIN plan_categories pc ON pc.category_id=c.id JOIN plan_sources ps ON ps.plan_id=pc.plan_id
      JOIN sources s ON s.id=ps.source_id WHERE s.key='fever'
      GROUP BY c.slug ORDER BY COUNT(*) DESC LIMIT 1`, 'cultura');
    const recurrentId = firstValue(db, `SELECT p.id value FROM plans p
      JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
      JOIN plan_occurrences o ON o.plan_source_id=ps.id
      WHERE s.key='fever' AND o.status='active' GROUP BY p.id
      ORDER BY COUNT(*) DESC, p.id LIMIT 1`, null);
    const legacyId = firstValue(db, `SELECT p.id value FROM plans p
      WHERE NOT EXISTS (SELECT 1 FROM plan_occurrences o
        JOIN plan_sources ps ON ps.id=o.plan_source_id WHERE ps.plan_id=p.id)
      ORDER BY p.id LIMIT 1`, null);
    const cases = [
      ['general', () => repository.findMany(listFilters())],
      ['today', () => repository.findMany(listFilters({ date: '2026-08-26' }))],
      ['tomorrow', () => repository.findMany(listFilters({ date: '2026-08-27' }))],
      ['weekend', () => repository.findMany(listFilters({ editorial: 'home-weekend', permanent: 0, dateFrom: '2026-08-29', dateTo: '2026-08-30' }))],
      ['upcoming', () => repository.findMany(listFilters({ editorial: 'home-upcoming', permanent: 0, dateFrom: '2026-08-26' }))],
      [`municipality:${municipality}`, () => repository.findMany(listFilters({ municipality }))],
      [`comarca:${comarca}`, () => repository.findMany(listFilters({ comarca }))],
      [`category:${category}`, () => repository.findMany(listFilters({ categories: [category] }))],
    ];
    if (recurrentId) cases.push(['detail-recurrent', () => repository.findById(recurrentId, 'ca')]);
    if (legacyId) cases.push(['detail-legacy', () => repository.findById(legacyId, 'ca')]);
    return {
      now: NOW.toISOString(),
      selectors: { municipality, comarca, category, recurrentId, legacyId },
      benchmarks: cases.filter(([label]) => !onlyLabel || label === onlyLabel).map(([label, operation]) => benchmark(label, operation)),
    };
  } finally {
    db.close();
  }
}

function parseArguments(argv) {
  const databaseIndex = argv.indexOf('--database');
  if (databaseIndex < 0 || !argv[databaseIndex + 1]) {
    throw new Error('Usage: node backend/src/jobs/benchmarkFeverM5b.js --database <temporary.sqlite> [--case label] [--explain label] [--report] [--set-fever-enabled 0|1] [--candidate-index name --action create|drop] [--migrate] [--vacuum]');
  }
  const enabledIndex = argv.indexOf('--set-fever-enabled');
  const caseIndex = argv.indexOf('--case');
  const explainIndex = argv.indexOf('--explain');
  const candidateIndex = argv.indexOf('--candidate-index');
  const actionIndex = argv.indexOf('--action');
  const migrateRequested = argv.includes('--migrate');
  const reportRequested = argv.includes('--report');
  const vacuumRequested = argv.includes('--vacuum');
  const candidateLength = candidateIndex < 0 && actionIndex < 0 ? 0 : 4;
  const knownLength = 2 + (enabledIndex < 0 ? 0 : 2) + (caseIndex < 0 ? 0 : 2) + (explainIndex < 0 ? 0 : 2) + candidateLength + Number(migrateRequested) + Number(reportRequested) + Number(vacuumRequested);
  if (argv.length !== knownLength || (caseIndex >= 0 && !argv[caseIndex + 1]) || (explainIndex >= 0 && !EXPLAIN_FILTERS[argv[explainIndex + 1]])) throw new Error('Unknown benchmark argument');
  if (enabledIndex >= 0 && !['0', '1'].includes(argv[enabledIndex + 1])) {
    throw new Error('--set-fever-enabled requires 0 or 1');
  }
  if (candidateLength && (!CANDIDATE_INDEXES[argv[candidateIndex + 1]] || !['create', 'drop'].includes(argv[actionIndex + 1]))) {
    throw new Error('Unknown candidate index or action');
  }
  if ([caseIndex >= 0, explainIndex >= 0, reportRequested].filter(Boolean).length > 1) throw new Error('Choose one read action');
  if ([enabledIndex >= 0, Boolean(candidateLength), migrateRequested, vacuumRequested].filter(Boolean).length > 1) throw new Error('Only one write action is allowed');
  return {
    databasePath: argv[databaseIndex + 1], enabled: enabledIndex < 0 ? null : Number(argv[enabledIndex + 1]),
    onlyLabel: caseIndex < 0 ? null : argv[caseIndex + 1],
    explainLabel: explainIndex < 0 ? null : argv[explainIndex + 1], reportRequested, candidate: candidateLength ? argv[candidateIndex + 1] : null, action: candidateLength ? argv[actionIndex + 1] : null, migrateRequested, vacuumRequested,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { databasePath, enabled, onlyLabel, explainLabel, reportRequested, candidate, action, migrateRequested, vacuumRequested } = parseArguments(process.argv.slice(2));
    let result;
    if (enabled !== null) result = { feverEnabled: Boolean(enabled), changes: setFeverEnabledTemporary(databasePath, enabled) };
    else if (candidate) result = manageCandidateIndex(databasePath, candidate, action);
    else if (migrateRequested) result = migrateTemporary(databasePath);
    else if (vacuumRequested) result = vacuumTemporary(databasePath);
    else if (explainLabel) result = explainFeverM5b(databasePath, explainLabel);
    else if (reportRequested) result = reportFeverM5b(databasePath);
    else result = benchmarkFeverM5b(databasePath, loadConfig(), onlyLabel);
    console.log(JSON.stringify(result, null, 2));
  }
  catch (error) { console.error(`Fever M5B benchmark failed: ${error.message}`); process.exitCode = 1; }
}
