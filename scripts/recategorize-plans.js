// One-off, operator-run recategorisation of the plans already stored after the 2026-10-26 category review
// (migration 021: Exposicions, Cinema and Experiències added, Cultura narrowed). Gencat, DIBA and Ticketmaster only ever
// ADD categories on import and never remove one, so a plan stored as "Cultura" would stay Cultura forever even though the
// new rules call it an exhibition. This recomputes the categories of every plan from the raw payload its sources stored,
// with the same classifiers the importers use, and corrects only the managed categories below. Every other category
// (música, espectacles, família...) is left exactly as it is.
//
// A plan's desired categories are the union over all its sources. A plan with a source this script cannot classify is
// skipped, never guessed. Fever recomputes its own categories on every import, so it converges by itself; it is included
// so the whole catalogue is consistent right away.
//
// Default is a read-only dry-run. Nothing is written unless --apply is passed together with --expected-changes=<n> and
// --expected-hash=<h>, the count and fingerprint of the exact change set the dry-run printed. Only plan_categories rows
// change; plans, plan_sources and updated_at are untouched. A rollback SQL and a JSON log are written before the change.
// Take a backup first and run it only after the deploy that contains migration 021.
//
//   node scripts/recategorize-plans.js                                   # dry-run
//   node scripts/recategorize-plans.js --apply --expected-changes=900 --expected-hash=0123456789ab
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { normalizeCategories } from '../backend/src/normalizers/category.normalizer.js';
import { normalizeTicketmasterCategories } from '../backend/src/normalizers/ticketmasterCategory.normalizer.js';
import { feverCategorySlugs } from '../backend/src/fever/publicationPolicy.js';
import { categorySlugs as dibaCategorySlugs } from '../backend/src/diba/dibaImporter.js';

// The only categories this script adds or removes: the ones whose rules changed.
export const MANAGED_CATEGORIES = Object.freeze(['cultura', 'exposicions', 'cinema', 'experiencies']);

function flattenStrings(value) {
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

// Classifiers keyed by source. A function returns the category slugs of one stored payload.
const CLASSIFIERS = [
  [(key) => key === 'gencat-agenda', (payload) => normalizeCategories(payload)],
  [(key) => key.startsWith('diba-'), (payload) => dibaCategorySlugs(payload.dataset, {
    title: payload.titol, categories: [...flattenStrings(payload.categoria), ...flattenStrings(payload.tags)],
  })],
  [(key) => key.startsWith('ticketmaster'), (payload) => normalizeTicketmasterCategories(payload)],
  [(key) => key === 'fever', (payload) => feverCategorySlugs(payload.SubCategory)],
];

export function classifyPayload(sourceKey, payload) {
  const entry = CLASSIFIERS.find(([matches]) => matches(sourceKey));
  return entry ? entry[1](payload) : null;
}

// Pure read: every plan whose managed categories differ from what its sources' payloads say today.
export function computeCategoryChanges(db) {
  const known = new Set(db.prepare('SELECT slug FROM categories').all().map(({ slug }) => slug));
  const missing = MANAGED_CATEGORIES.filter((slug) => !known.has(slug));
  if (missing.length) throw new Error(`Categories missing from the database (${missing.join(', ')}): deploy migration 021 first.`);

  const sourcesByPlan = new Map();
  for (const row of db.prepare(`
    SELECT ps.plan_id AS planId, s.key AS sourceKey, ps.source_payload_json AS payload
    FROM plan_sources ps JOIN sources s ON s.id = ps.source_id ORDER BY ps.plan_id, ps.id`).all()) {
    if (!sourcesByPlan.has(row.planId)) sourcesByPlan.set(row.planId, []);
    sourcesByPlan.get(row.planId).push(row);
  }
  const currentByPlan = new Map();
  for (const row of db.prepare('SELECT pc.plan_id AS planId, c.slug FROM plan_categories pc JOIN categories c ON c.id = pc.category_id').all()) {
    if (!currentByPlan.has(row.planId)) currentByPlan.set(row.planId, new Set());
    currentByPlan.get(row.planId).add(row.slug);
  }

  const changes = [];
  let skipped = 0;
  for (const [planId, sources] of sourcesByPlan) {
    const desired = new Set();
    let classifiable = true;
    for (const { sourceKey, payload } of sources) {
      let parsed;
      try { parsed = JSON.parse(payload); } catch { classifiable = false; break; }
      const slugs = parsed && typeof parsed === 'object' ? classifyPayload(sourceKey, parsed) : null;
      if (!slugs) { classifiable = false; break; }
      slugs.forEach((slug) => desired.add(slug));
    }
    if (!classifiable) { skipped += 1; continue; }
    const current = currentByPlan.get(planId) ?? new Set();
    const add = MANAGED_CATEGORIES.filter((slug) => desired.has(slug) && !current.has(slug));
    const remove = MANAGED_CATEGORIES.filter((slug) => !desired.has(slug) && current.has(slug));
    if (add.length || remove.length) {
      changes.push({ id: planId, before: MANAGED_CATEGORIES.filter((slug) => current.has(slug)), add, remove });
    }
  }
  changes.sort((a, b) => a.id - b.id);
  return { scanned: sourcesByPlan.size, skipped, changes };
}

// Fingerprint of the exact change set, so a same-size but different set is detected.
export function changeSetHash(changes) {
  return createHash('sha256').update(JSON.stringify(changes.map(({ id, add, remove }) => [id, add, remove]))).digest('hex').slice(0, 12);
}

const categoryIdSql = (slug) => `(SELECT id FROM categories WHERE slug = '${slug}')`;

// Reverses each link added or removed. Both statements are idempotent.
export function rollbackSql(changes) {
  return changes.flatMap(({ id, add, remove }) => [
    ...add.map((slug) => `DELETE FROM plan_categories WHERE plan_id = ${id} AND category_id = ${categoryIdSql(slug)};`),
    ...remove.map((slug) => `INSERT OR IGNORE INTO plan_categories (plan_id, category_id) VALUES (${id}, ${categoryIdSql(slug)});`),
  ]);
}

// One transaction. Re-computes inside it, so data that changed since the dry-run aborts with zero writes.
export function applyCategoryChanges(db, { expectedChanges, expectedHash, beforeWrite } = {}) {
  return db.transaction(() => {
    const fresh = computeCategoryChanges(db);
    if (fresh.changes.length !== expectedChanges) {
      throw new Error(`Expected ${expectedChanges} changes but found ${fresh.changes.length}; run the dry-run again. No writes performed.`);
    }
    if (changeSetHash(fresh.changes) !== expectedHash) {
      throw new Error(`The set of changes differs from the dry-run (hash ${changeSetHash(fresh.changes)}, expected ${expectedHash}); run the dry-run again. No writes performed.`);
    }
    beforeWrite?.(fresh);
    const link = db.prepare('INSERT OR IGNORE INTO plan_categories (plan_id, category_id) SELECT ?, id FROM categories WHERE slug = ?');
    const unlink = db.prepare('DELETE FROM plan_categories WHERE plan_id = ? AND category_id = (SELECT id FROM categories WHERE slug = ?)');
    for (const { id, add, remove } of fresh.changes) {
      for (const slug of add) link.run(id, slug);
      for (const slug of remove) unlink.run(id, slug);
    }
    const remaining = computeCategoryChanges(db).changes.length;
    if (remaining !== 0) throw new Error(`Invariant failed: ${remaining} plans still differ after the update.`);
    return fresh;
  })();
}

function summarise(changes) {
  const counts = new Map();
  for (const { before, add, remove } of changes) {
    const key = `${before.join('+') || '(none)'} -> ${[...before.filter((slug) => !remove.includes(slug)), ...add].sort().join('+') || '(none)'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('--apply and --dry-run cannot both be passed.');
  const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
  let expected = NaN;
  let expectedHash = '';
  if (apply) {
    const rawExpected = get('expected-changes') ?? '';
    expected = /^\d+$/.test(rawExpected) ? Number.parseInt(rawExpected, 10) : NaN;
    expectedHash = get('expected-hash') ?? '';
    if (!Number.isInteger(expected) || !/^[0-9a-f]{12}$/.test(expectedHash)) throw new Error('--apply requires --expected-changes=<n> and --expected-hash=<h>, both printed by the dry-run.');
  }
  const config = loadConfig();
  const db = openDatabase(config.databasePath, apply ? { readonly: false, configureJournal: true } : { readonly: true });
  try {
    const result = computeCategoryChanges(db);
    const added = result.changes.reduce((sum, { add }) => sum + add.length, 0);
    const removed = result.changes.reduce((sum, { remove }) => sum + remove.length, 0);
    console.log(`${result.scanned} plans scanned (${result.skipped} skipped: a source could not be classified); ${result.changes.length} would change (${added} links added, ${removed} removed).`);
    const table = summarise(result.changes);
    console.log(`${table.length} distinct changes (managed categories only: ${MANAGED_CATEGORIES.join(', ')}):`);
    for (const [line, count] of table) console.log(`  ${String(count).padStart(5)}  ${line}`);
    const hash = changeSetHash(result.changes);
    if (!apply) { console.log(`\nDry-run only. To apply: --apply --expected-changes=${result.changes.length} --expected-hash=${hash}`); return; }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = get('out-dir') || path.resolve(config.projectRoot, 'data/consolidation-logs');
    mkdirSync(outDir, { recursive: true });
    const applied = applyCategoryChanges(db, {
      expectedChanges: expected,
      expectedHash,
      beforeWrite: (fresh) => {
        writeFileSync(path.join(outDir, `recategorize-${timestamp}.rollback.sql`), `-- Restores plan_categories as they were before recategorize-plans.js (${timestamp}).\nBEGIN TRANSACTION;\n${rollbackSql(fresh.changes).join('\n')}\nCOMMIT;\n`);
        writeFileSync(path.join(outDir, `recategorize-${timestamp}.log.json`), JSON.stringify({ timestamp, dbPath: config.databasePath, changes: fresh.changes }, null, 2));
      },
    });
    console.log(`\nApplied ${applied.changes.length} plan updates.\nRollback SQL and log: ${outDir}\\recategorize-${timestamp}.*`);
  } finally { db.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Recategorize failed: ${error.message}`); process.exitCode = 1; }
}
