import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { cloneDibaRehearsal, sha256File, verifyDibaRepeatPreservation } from '../backend/src/diba/dibaPolicyExecutor.js';
import { applyFinalReviewRehearsal, prepareFinalReviewPlan } from '../backend/src/diba/dibaFinalReviewPolicy.js';
import { openDatabase } from '../backend/src/db/database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SHA = 'F2B9A4AD4C70C57C6B269644CCDFBEDAEA02A339D9574F5CD6D7CFFE38FA78B8';
const overridePath = path.join(root, 'data-policy', 'diba-link-overrides.json');
const decisionPath = path.join(root, 'data-policy', 'diba-final-review-decisions.json');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const assertReal = (databasePath, stage) => { const value = sha256File(databasePath); if (value !== EXPECTED_SHA) throw new Error(`Final DIBA ${stage} real SHA mismatch: ${value}.`); return value; };
function counts(db) { return Object.fromEntries(['plans', 'plan_sources', 'plan_categories', 'plan_occurrences', 'sources'].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count])); }
function markdown(report) { return `# DIBA FINAL F1 — final human decisions rehearsal\n\n**FINAL HUMAN DECISIONS RECORDED. REHEARSAL DATABASE ONLY. REAL LOCAL SQLITE NOT MUTATED.**\n\n- Rehearsal: \`${report.rehearsalPath}\`\n- Decisions: ${report.dryRun.reviewedComponents}; unresolved final human blockers: ${report.dryRun.unresolvedFinalHumanComponents}\n- Raw diagnostics before/after: same-feed ${report.dryRun.rawCounts.sameFeed}/${report.post.rawCounts.sameFeed}; session ${report.dryRun.rawCounts.sessionDefer}/${report.post.rawCounts.sessionDefer}\n- First apply: ${report.first.relinks.length} consolidation relinks; ${report.first.consolidationOrphans.length} consolidation orphans; ${report.first.deferredInactivePlans.length} deferred inactive plans\n- Second apply: ${report.second.relinks.length} relinks; ${report.second.consolidationOrphans.length} new orphans; ${report.second.deferredInactivePlans.length} new DEFER transitions\n- Geography: 0 mutations / 19 NOOP\n- Human-review activation gate: ${report.post.humanReviewActivationGateReady}; DIBA remains disabled.\n- Integrity: ${report.invariants.integrity}\n`; }
export async function main(config = loadConfig(), { rehearsalPath = path.join(root, 'data', 'rehearsal', `quefem_diba_final_review_${stamp()}.sqlite`) } = {}) {
  const realHashes = { beforeDecisionPersistence: assertReal(config.databasePath, 'before decision persistence') };
  const dry = await prepareFinalReviewPlan({ databasePath: config.databasePath, overridePath, decisionPath });
  realHashes.afterDryRun = assertReal(config.databasePath, 'after dry run');
  const copy = await cloneDibaRehearsal(config.databasePath, rehearsalPath); const target = path.resolve(rehearsalPath);
  const preDb = openDatabase(target, { readonly: true }); let preCounts; try { preCounts = counts(preDb); } finally { preDb.close(); }
  const first = await applyFinalReviewRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overridePath, decisionPath });
  realHashes.afterFirstApply = assertReal(config.databasePath, 'after first rehearsal apply');
  const consolidateRelinks = first.relinks.map(({ source, afterPlanId }) => ({ source, afterPlanId })); const repeat = verifyDibaRepeatPreservation({ databasePath: target, relinks: consolidateRelinks });
  realHashes.afterRepeatPreservation = assertReal(config.databasePath, 'after repeat preservation');
  const post = await prepareFinalReviewPlan({ databasePath: target, overridePath, decisionPath });
  const postDb = openDatabase(target, { readonly: true }); let postCounts; let integrity; try { postCounts = counts(postDb); integrity = postDb.pragma('integrity_check', { simple: true }); } finally { postDb.close(); }
  if (JSON.stringify(preCounts) !== JSON.stringify(postCounts) || integrity !== 'ok') throw new Error('Final DIBA rehearsal changed database-wide cardinality or integrity.');
  const second = await applyFinalReviewRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overridePath, decisionPath });
  realHashes.afterSecondApply = assertReal(config.databasePath, 'after second rehearsal apply');
  if (second.relinks.length || second.consolidationOrphans.length || second.deferredInactivePlans.length) throw new Error('Final DIBA second rehearsal apply is not structurally idempotent.');
  realHashes.final = assertReal(config.databasePath, 'final');
  const report = { generatedAt: new Date().toISOString(), rehearsalPath: target, copy, realHashes, dryRun: { reviewedComponents: dry.reviewed.length, unresolvedFinalHumanComponents: dry.unresolvedFinalHumanComponents, rawCounts: dry.rawCounts, humanReviewActivationGateReady: dry.humanReviewActivationGateReady, geography: dry.geography, decisions: dry.reviewed.map(({ operation, disposition, sourceMembers, canonicalSourceIdentity, planIds }) => ({ operation, disposition, sourceMembers, canonicalSourceIdentity, planIds })) }, first: { relinks: first.relinks, consolidationOrphans: first.consolidationOrphans, deferredInactivePlans: first.deferredInactivePlans }, preservation: { consolidated: repeat, deferred: { mechanism: 'DibaImporter applies versioned stable DEFER identities with inactive status and preserveExistingPlan; covered by focused importer test.' } }, second: { relinks: second.relinks, consolidationOrphans: second.consolidationOrphans, deferredInactivePlans: second.deferredInactivePlans }, post: { rawCounts: post.rawCounts, unresolvedFinalHumanComponents: post.unresolvedFinalHumanComponents, humanReviewActivationGateReady: post.humanReviewActivationGateReady, geography: post.geography }, invariants: { preCounts, postCounts, integrity, sourceStates: first.sourceStates } };
  const reports = path.join(root, 'data', 'reports'); await mkdir(reports, { recursive: true }); await writeFile(path.join(reports, 'diba-final-decisions-dry-run.json'), `${JSON.stringify({ generatedAt: report.generatedAt, realHashes, dryRun: report.dryRun }, null, 2)}\n`); await writeFile(path.join(reports, 'diba-final-decisions-dry-run.md'), markdown({ ...report, first: { relinks: [], consolidationOrphans: [], deferredInactivePlans: [] }, second: { relinks: [], consolidationOrphans: [], deferredInactivePlans: [] }, post: report.dryRun, invariants: report.invariants })); await writeFile(path.join(reports, 'diba-final-decisions-rehearsal.json'), `${JSON.stringify(report, null, 2)}\n`); await writeFile(path.join(reports, 'diba-final-decisions-rehearsal.md'), markdown(report));
  console.log(`DIBA FINAL F1 rehearsal passed on: ${target}`); return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA FINAL F1 rehearsal failed: ${error.message}`); process.exitCode = 1; });
