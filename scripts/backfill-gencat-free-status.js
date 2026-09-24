// One-off maintenance script: corrects stale canonical plans.is_free values
// for single-source Gencat plans whose stored value predates the
// inferFreeStatus() fix (Phase 4B.2/4B.3B) and cannot self-heal through a
// normal scheduled import (Gencat's importer never sets refreshCanonical, so
// an unchanged upstream payload never triggers canonical re-derivation).
//
// DIBA is intentionally out of scope: DIBA's importer sets
// candidate.refreshCanonical = source.enabled === 1 && Boolean(existingSource),
// so every enabled, previously-seen DIBA record is re-derived on every
// scheduled re-import regardless of payload change — confirmed empirically in
// production (Phase 4B.3B) to already self-heal without any backfill.
//
// Default is a read-only dry-run. Nothing is written unless --apply is passed.
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { normalizePlan } from '../backend/src/normalizers/plan.normalizer.js';

// Independent false-positive keyword sweep, deliberately separate from
// inferFreeStatus()'s own CONDITIONAL_RE — a second, independently-written
// check, not a re-run of the same regex. Mirrors the sweep used in the
// Phase 4B.3B dry-run's SAFE_AUTOMATIC classification. Only applied when the
// recomputed value is FREE (1): a price or eligibility word next to a PAID
// (0) result is expected, not risky.
const RISK_PATTERNS = [
  [/\bmenors?\b|\binfants?\b|\binfantils?\b/i, 'minors/children'],
  // A raw HTML currency entity (e.g. "5 &euro;") would not be recognised as
  // a price by inferFreeStatus()'s own currency regex (stripHtml() does not
  // decode &euro;, and "eur" does not appear immediately after the amount
  // once "&" is in between) — confirmed zero current occurrences in
  // production Gencat data, but kept as a defensive, no-deploy-needed extra
  // gate specific to this script (cross-review finding).
  [/&euro;|&#8364;|&#x20ac;/i, 'HTML-entity currency amount not recognised by the price regex'],
  [/\bmembres?\b|\bsoci(?:a|es|s)?\b|\bcarnet\b/i, 'members/socis/carnet'],
  [/\bresidents?\b/i, 'residents'],
  [/\bestudiants?\b/i, 'students'],
  [/\bjubila(?:t|da|ts|des)?\b|\bpensionist/i, 'pensioners/retirees'],
  [/\batura(?:t|da|ts|des)?\b/i, 'unemployed'],
  [/\binvitaci[oó]|\bacreditaci[oó]/i, 'invitation/accreditation'],
  [/\binscripci[oó]|\breserva\b/i, 'registration/reservation'],
  [/\bdescompte|\bgratu[iï]tats?\b/i, 'discounts/gratuities'],
  [/\binclos|\binclòs/i, 'included-in-ticket'],
  [/\bopcional\b/i, 'optional paid workshop/activity'],
  [/\bde\s+pagament\b/i, 'mixed free/paid ("de pagament")'],
  [/\bexcepte\b/i, 'exception carve-out ("excepte")'],
  [/\babonant\b/i, 'conditional on separate paid admission ("abonant")'],
  [/\bpresentant\b|\btiquet\b|\bbitllet\b/i, 'presenting a prerequisite item'],
  [/\btargeta\b/i, 'card (membership/loyalty)'],
  [/\bdisfress/i, 'costume condition'],
  [/\baudiogui/i, 'optional paid add-on (audioguide)'],
  [/\d+(?:[.,]\d+)?\s*(?:€|eur\.?)/i, 'non-zero price elsewhere in text (needs manual amount check)'],
];

function scanRisks(text) {
  if (!text) return [];
  const hits = [];
  for (const [re, label] of RISK_PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

const CANDIDATE_QUERY = `
  SELECT
    p.id AS plan_id, p.original_title AS title, p.status AS status,
    p.is_free AS current_is_free, p.price_text AS current_price_text,
    ps.id AS plan_source_id, ps.source_record_id, ps.source_payload_json
  FROM plans p
  JOIN plan_sources ps ON ps.plan_id = p.id
  JOIN sources s ON s.id = ps.source_id
  WHERE s.key = 'gencat-agenda'
    AND p.id IN (SELECT plan_id FROM plan_sources GROUP BY plan_id HAVING COUNT(*) = 1)
`;

// Pure: computes the eligible candidate set and skip tallies from an open DB
// handle. Never writes. Used identically by --dry-run and as the fresh
// pre-transaction re-check in --apply.
export function computeCandidates(db) {
  const rows = db.prepare(CANDIDATE_QUERY).all();

  const candidates = [];
  const skipped = {
    parseError: 0,
    ambiguous: 0,
    riskSweep: 0,
    unchanged: 0,
  };

  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.source_payload_json);
    } catch (error) {
      skipped.parseError += 1;
      continue;
    }

    let normalized;
    try {
      normalized = normalizePlan(payload);
    } catch (error) {
      skipped.parseError += 1;
      continue;
    }
    if (!normalized) {
      skipped.parseError += 1;
      continue;
    }

    const newIsFree = normalized.plan.is_free;
    if (newIsFree !== 0 && newIsFree !== 1) {
      skipped.ambiguous += 1;
      continue;
    }

    if (newIsFree === row.current_is_free) {
      skipped.unchanged += 1;
      continue;
    }

    const rawFlag = payload.gratuita ?? null;
    const rawText = payload.entrades ?? null;
    const risks = newIsFree === 1 ? scanRisks(rawText) : [];
    if (risks.length > 0) {
      skipped.riskSweep += 1;
      continue;
    }

    candidates.push({
      plan_id: row.plan_id,
      title: row.title,
      status: row.status,
      current_is_free: row.current_is_free,
      new_is_free: newIsFree,
      current_price_text: row.current_price_text,
      plan_source_id: row.plan_source_id,
      source_record_id: row.source_record_id,
      raw_gratuita: rawFlag,
      raw_entrades: rawText,
      reason: `Single-source Gencat plan; recomputed unambiguously ${newIsFree === 1 ? 'FREE' : 'PAID'} from current raw payload; no residual risk keywords.`,
    });
  }

  return { candidates, skipped, totalGencatSingleSourceRows: rows.length };
}

function summarize(result) {
  const { candidates, skipped, totalGencatSingleSourceRows } = result;
  const transitions = { '0->1': 0, '1->0': 0, 'NULL->1': 0, 'NULL->0': 0 };
  for (const c of candidates) {
    const key = `${c.current_is_free === null ? 'NULL' : c.current_is_free}->${c.new_is_free}`;
    if (key in transitions) transitions[key] += 1;
  }
  return { transitions, candidateCount: candidates.length, skipped, totalGencatSingleSourceRows };
}

function printReport(result, { dryRun }) {
  const { candidates } = result;
  const { transitions, candidateCount, skipped, totalGencatSingleSourceRows } = summarize(result);

  console.log(dryRun ? 'Gencat free-status backfill — DRY RUN (no writes)' : 'Gencat free-status backfill — APPLY');
  console.log(`Single-source Gencat plan_sources rows scanned: ${totalGencatSingleSourceRows}`);
  console.log(`Candidate count: ${candidateCount}`);
  console.log(`  0 -> 1:    ${transitions['0->1']}`);
  console.log(`  1 -> 0:    ${transitions['1->0']}`);
  console.log(`  NULL -> 1: ${transitions['NULL->1']}`);
  console.log(`  NULL -> 0: ${transitions['NULL->0']}`);
  console.log(`Skipped (ambiguous/null result): ${skipped.ambiguous}`);
  console.log(`Skipped (independent risk sweep): ${skipped.riskSweep}`);
  console.log(`Skipped (payload parse error): ${skipped.parseError}`);
  console.log(`Skipped (already matches, no change): ${skipped.unchanged}`);
  console.log('');
  for (const c of candidates) {
    console.log(`${c.plan_id} | ${c.title}`);
    console.log(`  current_is_free=${c.current_is_free} -> new_is_free=${c.new_is_free}`);
    console.log(`  raw gratuita=${JSON.stringify(c.raw_gratuita)}`);
    console.log(`  raw entrades=${JSON.stringify(c.raw_entrades)}`);
    console.log(`  reason: ${c.reason}`);
  }
}

function writeArtifacts(candidates, { outDir, timestamp, headCommit, dbPath }) {
  mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, `gencat-free-status-backfill-${timestamp}.log.json`);
  const rollbackPath = path.join(outDir, `gencat-free-status-backfill-${timestamp}.rollback.sql`);

  writeFileSync(logPath, JSON.stringify({
    timestamp,
    headCommit,
    dbPath,
    candidateCount: candidates.length,
    candidates: candidates.map((c) => ({
      plan_id: c.plan_id,
      title: c.title,
      old_is_free: c.current_is_free,
      new_is_free: c.new_is_free,
      source_record_id: c.source_record_id,
      raw_gratuita: c.raw_gratuita,
      raw_entrades: c.raw_entrades,
      reason: c.reason,
    })),
  }, null, 2));

  const rollbackLines = [
    `-- Rollback for Gencat free-status backfill run at ${timestamp}`,
    `-- HEAD: ${headCommit}`,
    `-- DB: ${dbPath}`,
    '-- Restores plans.is_free to its pre-backfill value for every row this run changed.',
    'BEGIN TRANSACTION;',
    ...candidates.map((c) => `UPDATE plans SET is_free = ${c.current_is_free === null ? 'NULL' : c.current_is_free} WHERE id = ${c.plan_id};`),
    'COMMIT;',
  ];
  writeFileSync(rollbackPath, rollbackLines.join('\n') + '\n');

  return { logPath, rollbackPath };
}

// Writes only if the candidate set recomputed FRESH, from inside this same
// transaction, still matches `precheckCandidates` (the outer pre-transaction
// dry-run's list). Recomputing inside the transaction — rather than trusting
// the list computed before it started — closes a TOCTOU window: without
// this, a scheduled import could commit a payload change for one of these
// plans between the outer pre-check and this write, and the script would
// silently write a decision based on stale data. Recomputing here means the
// write is always based on data from the same atomic snapshot it commits
// against (cross-review finding).
export function applyBackfill(db, precheckCandidates, { beforeWrite } = {}) {
  const update = db.prepare('UPDATE plans SET is_free = ? WHERE id = ?');
  const verifySingleGencatSource = db.prepare(`
    SELECT COUNT(*) AS cnt, MAX(s.key) AS only_key
    FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
    WHERE ps.plan_id = ?
  `);
  const readPlan = db.prepare('SELECT id, is_free, price_text, original_title, status, permanent, start_date, end_date, website_url, image_url, updated_at FROM plans WHERE id = ?');

  const run = db.transaction(() => {
    const fresh = computeCandidates(db);
    const freshIds = new Set(fresh.candidates.map((c) => c.plan_id));
    const precheckIds = new Set(precheckCandidates.map((c) => c.plan_id));
    const sameSet = freshIds.size === precheckIds.size && [...freshIds].every((id) => precheckIds.has(id));
    if (!sameSet) {
      throw new Error(`Invariant failed: fresh in-transaction candidate set (${fresh.candidates.length}) differs from the pre-check set (${precheckCandidates.length}) — data changed mid-run, aborting with no writes`);
    }
    const candidates = fresh.candidates;

    // Rollback/log artifacts are generated from this same freshly-confirmed
    // candidate list, still before any row is written — satisfies "generated
    // before committing" using data that's actually about to be committed,
    // not the (possibly now-stale) outer pre-check list.
    if (beforeWrite) beforeWrite(candidates);

    const beforeSnapshots = new Map(candidates.map((c) => [c.plan_id, readPlan.get(c.plan_id)]));

    let changed = 0;
    for (const c of candidates) {
      const result = update.run(c.new_is_free, c.plan_id);
      changed += result.changes;
    }

    if (changed !== candidates.length) {
      throw new Error(`Invariant failed: ${changed} rows changed, expected ${candidates.length}`);
    }

    for (const c of candidates) {
      const sourceCheck = verifySingleGencatSource.get(c.plan_id);
      if (sourceCheck.cnt !== 1 || sourceCheck.only_key !== 'gencat-agenda') {
        throw new Error(`Invariant failed: plan ${c.plan_id} is no longer single-source gencat-agenda (count=${sourceCheck.cnt}, key=${sourceCheck.only_key})`);
      }

      const after = readPlan.get(c.plan_id);
      const before = beforeSnapshots.get(c.plan_id);
      if (after.is_free !== 0 && after.is_free !== 1) {
        throw new Error(`Invariant failed: plan ${c.plan_id} new is_free is not 0/1 (${after.is_free})`);
      }
      if (after.is_free !== c.new_is_free) {
        throw new Error(`Invariant failed: plan ${c.plan_id} is_free mismatch after write`);
      }
      const unrelatedFields = ['price_text', 'original_title', 'status', 'permanent', 'start_date', 'end_date', 'website_url', 'image_url', 'updated_at'];
      for (const field of unrelatedFields) {
        if (before[field] !== after[field]) {
          throw new Error(`Invariant failed: unrelated column "${field}" changed on plan ${c.plan_id}`);
        }
      }
    }

    return { changed, candidates };
  });

  return run();
}

function parseArguments(args) {
  const apply = args.includes('--apply');
  const dryRunFlagPresent = args.includes('--dry-run');
  if (apply && dryRunFlagPresent) {
    throw new Error('--apply and --dry-run cannot both be passed.');
  }
  if (args.some((a) => a !== '--apply' && a !== '--dry-run' && !a.startsWith('--expected-count=') && !a.startsWith('--out-dir='))) {
    throw new Error('Ús: node scripts/backfill-gencat-free-status.js [--dry-run|--apply --expected-count=N] [--out-dir=path]');
  }
  const expectedCountArg = args.find((a) => a.startsWith('--expected-count='));
  if (apply && !expectedCountArg) {
    throw new Error('--apply requires --expected-count=N (the candidate count from a preceding --dry-run), so the run aborts if production data changed materially in between.');
  }
  const outDirArg = args.find((a) => a.startsWith('--out-dir='));
  return {
    dryRun: !apply,
    expectedCount: expectedCountArg ? Number.parseInt(expectedCountArg.split('=')[1], 10) : null,
    outDir: outDirArg ? outDirArg.split('=')[1] : path.resolve(loadConfig().projectRoot, 'data/backfill-logs'),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = loadConfig();

  if (options.dryRun) {
    const db = openDatabase(config.databasePath, { readonly: true });
    try {
      const result = computeCandidates(db);
      printReport(result, { dryRun: true });
    } finally {
      db.close();
    }
    return;
  }

  // --apply: an outer pre-check dry-run first, for fast-fail reporting and
  // the --expected-count comparison. The write itself does NOT trust this
  // list — applyBackfill() recomputes fresh again from inside its own
  // transaction and only proceeds if that still matches this one, closing
  // the TOCTOU window between this read and the eventual write.
  const db = openDatabase(config.databasePath, { readonly: false, configureJournal: true });
  try {
    const precheck = computeCandidates(db);
    printReport(precheck, { dryRun: false });

    if (precheck.candidates.length !== options.expectedCount) {
      console.error(`ABORT: fresh candidate count (${precheck.candidates.length}) differs from --expected-count (${options.expectedCount}). No writes performed.`);
      process.exitCode = 1;
      return;
    }

    if (precheck.candidates.length === 0) {
      console.log('No candidates. Nothing to apply.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const headCommit = process.env.BACKFILL_HEAD_COMMIT || 'unknown';
    let artifactPaths = null;

    const { changed } = applyBackfill(db, precheck.candidates, {
      beforeWrite: (freshCandidates) => {
        artifactPaths = writeArtifacts(freshCandidates, {
          outDir: options.outDir,
          timestamp,
          headCommit,
          dbPath: config.databasePath,
        });
      },
    });

    console.log(`Log written: ${artifactPaths.logPath}`);
    console.log(`Rollback SQL written: ${artifactPaths.rollbackPath}`);
    console.log(`Applied: ${changed} rows updated.`);
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  }
}
