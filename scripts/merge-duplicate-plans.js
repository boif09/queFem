// Merges the DIBA-only plans listed in data-policy/duplicate-plan-merges.json into the public plan that describes
// the same event (see backend/src/deduplication/duplicatePlanMerge.js). Default is a read-only dry-run; nothing is
// written unless --apply is passed. Each pair is its own transaction and the run stops at the first failure,
// leaving earlier pairs applied. Writes a log and a rollback SQL file for what was applied.
//
//   node scripts/merge-duplicate-plans.js                 # dry-run of every decision
//   node scripts/merge-duplicate-plans.js --apply          # apply them
//   node scripts/merge-duplicate-plans.js --alias-plan-id=6751 [--apply]   # only one pair
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { applyMerge, computeMergePlan, loadDuplicateMergeDecisions, rollbackStatements } from '../backend/src/deduplication/duplicatePlanMerge.js';

function parseArguments(args) {
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('--apply and --dry-run cannot both be passed.');
  const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
  const only = get('alias-plan-id');
  return { apply, only: only === null ? null : Number.parseInt(only, 10), outDir: get('out-dir') };
}

function describe(plan) {
  const status = plan.ok ? 'OK ' : 'FAIL';
  const alias = plan.aliasPlan;
  const canonical = plan.canonicalPlan;
  console.log(`${status} plan ${plan.aliasPlanId} → ${plan.canonicalPlanId} · "${plan.decision.title}" · ${alias?.start_date ?? '?'} · ${plan.sourceRows.map((row) => `${row.source_key}:${row.source_record_id}`).join(', ') || 'no provenance'}`);
  if (canonical) console.log(`     canonical keeps: ${canonical.venue_name ?? '—'} (${canonical.municipality ?? '—'}); alias venue: ${alias?.venue_name ?? '—'}${plan.newCategoryIds.length ? `; adds categories ${plan.newCategoryIds.join(',')}` : ''}`);
  for (const problem of plan.problems) console.log(`     problem: ${problem}`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const all = loadDuplicateMergeDecisions().decisions;
  const decisions = options.only === null ? all : all.filter((decision) => decision.aliasPlanId === options.only);
  if (!decisions.length) throw new Error('No matching decisions.');
  const db = openDatabase(config.databasePath, options.apply ? { readonly: false, configureJournal: true } : { readonly: true });
  try {
    const plans = decisions.map((decision) => computeMergePlan(db, decision));
    plans.forEach(describe);
    const failed = plans.filter((plan) => !plan.ok);
    console.log(`\n${plans.length - failed.length}/${plans.length} merges pass every precondition.`);
    if (!options.apply) { if (failed.length) process.exitCode = 1; return; }
    if (failed.length) { console.error('ABORT: precondition problems found. No writes performed.'); process.exitCode = 1; return; }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = options.outDir || path.resolve(config.projectRoot, 'data/consolidation-logs');
    mkdirSync(outDir, { recursive: true });
    const rollbackPath = path.join(outDir, `merge-duplicate-plans-${timestamp}.rollback.sql`);
    const logPath = path.join(outDir, `merge-duplicate-plans-${timestamp}.log.json`);
    const applied = [];
    const rollback = [`-- Rollback for duplicate-plan merges run at ${timestamp}`, `-- DB: ${config.databasePath}`, 'BEGIN TRANSACTION;'];
    const flush = () => {
      writeFileSync(rollbackPath, `${[...rollback, 'COMMIT;'].join('\n')}\n`);
      writeFileSync(logPath, JSON.stringify({ timestamp, dbPath: config.databasePath, applied }, null, 2));
    };
    try {
      for (const plan of plans) {
        const done = applyMerge(db, plan);
        applied.push({ aliasPlanId: done.aliasPlanId, canonicalPlanId: done.canonicalPlanId, planSourceIds: done.sourceRows.map((row) => row.plan_source_id), newCategoryIds: done.newCategoryIds });
        rollback.push(...rollbackStatements(done));
        flush();
        console.log(`APPLIED ${done.aliasPlanId} → ${done.canonicalPlanId}`);
      }
    } finally { if (applied.length) flush(); }
    console.log(`\nApplied ${applied.length}/${plans.length}.\nLog: ${logPath}\nRollback SQL: ${rollbackPath}`);
  } finally { db.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Duplicate merge failed: ${error.message}`); process.exitCode = 1; }
}
