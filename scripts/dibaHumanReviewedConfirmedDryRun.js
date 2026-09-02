import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { identityKey, loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(projectRoot, 'data', 'reports');
const overridePath = path.join(projectRoot, 'data-policy', 'diba-link-overrides.json');
const keepExisting = ['title', 'description', 'start_date', 'end_date', 'venue', 'address', 'coordinates', 'url'];
const neverFromDiba = ['categories', 'image', 'status', 'ranking/featured', 'commerce/affiliate'];

function stable(value) { return { sourceKey: value.sourceKey, sourceRecordId: String(value.sourceRecordId) }; }
function markdown(pack) {
  const rows = pack.overrides.map((item) => `| ${item.source.sourceKey}:${item.source.sourceRecordId} | ${item.target.sourceKey}:${item.target.sourceRecordId} | ${item.sourceDiagnosticPlanId} | ${item.targetDiagnosticPlanId} | ${item.expectedOrphanEffect} | ${item.validation.status} |`).join('\n');
  return `# DIBA M1.4D2 — Human-reviewed CONFIRMED links dry-run\n\n**HUMAN DECISIONS RECORDED — NO SQLITE MUTATION PERFORMED.**\n\nReviewed links planned: ${pack.summary.reviewedProvenanceRelinks}. Expected future source-less staging plans: ${pack.summary.expectedFutureOrphans}. Unexpected provenance relinks: ${pack.summary.unexpectedOperations.length}. Existing non-degrading geography previews: ${pack.summary.knownGeographyNoops}.\n\n| DIBA source | Public target | Source plan (diagnostic) | Target plan (diagnostic) | Expected orphan effect | Validation |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n## Field ownership\n\nAll planned links remain provenance-only. KEEP_EXISTING: ${keepExisting.join(', ')}. NEVER_FROM_DIBA: ${neverFromDiba.join(', ')}.\n\nCaiguda lliure and Gaudí are explicitly included in this check: their public canonical schedule/location and dates respectively remain KEEP_EXISTING.\n\n## Remaining blockers\n\nCONFIRMED unresolved: ${pack.summary.remaining.confirmed}; POSSIBLE: ${pack.summary.remaining.possible} (reviewed implicitly: ${pack.summary.reviewedPossibleComponents}); same-feed human review: ${pack.summary.remaining.sameFeed}; session DEFER: ${pack.summary.remaining.sessionDefer}.\n\n**PUBLIC ACTIVATION READY: ${pack.summary.publicActivationReady ? 'YES' : 'NO'}**\n`;
}

export async function main({ databasePath = loadConfig().databasePath } = {}) {
  const auditReport = await runDibaQualityAudit({ databasePath }); const overrides = await loadDibaPolicyOverrides(overridePath);
  const db = openDatabase(databasePath, { readonly: true }); let index; let policy;
  try { index = loadPolicyIdentityIndex(db); policy = planDibaPolicy({ auditReport, overrides, identityIndex: index }); } finally { db.close(); }
  const components = auditReport.currentPublicCandidates.confirmedSummary.conflictComponents; const mappingsBySource = new Map(policy.mutationPlan.phases.finalSourceMappings.map((item) => [identityKey(item.source), item]));
  const approvedKeys = new Set(overrides.decisions.map(({ source }) => identityKey(source))); const unexpectedOperations = policy.mutationPlan.phases.finalSourceMappings.filter(({ source }) => !approvedKeys.has(identityKey(source)));
  if (unexpectedOperations.length) throw new Error(`Reviewed dry-run proposes ${unexpectedOperations.length} operation(s) outside the approved human decisions.`);
  const records = overrides.decisions.map((decision) => {
    const sourceEntries = index.byIdentity.get(identityKey(decision.source)) || []; const targetEntries = index.byIdentity.get(identityKey(decision.target)) || [];
    if (sourceEntries.length !== 1 || targetEntries.length !== 1) throw new Error(`Stable identity no longer resolves exactly once for ${identityKey(decision.source)}.`);
    const sourceEntry = sourceEntries[0]; const targetEntry = targetEntries[0];
    if (targetEntry.enabled !== 1 || targetEntry.sourceKey.startsWith('diba-')) throw new Error(`Reviewed target is not enabled non-DIBA public provenance: ${identityKey(decision.target)}.`);
    const component = components.find((item) => item.dibaPlanIds.includes(sourceEntry.planId) && item.candidatePlanIds.includes(targetEntry.planId));
    if (!component) throw new Error(`Reviewed target is outside the current CONFIRMED component for ${identityKey(decision.source)}.`);
    const mapping = mappingsBySource.get(identityKey(decision.source));
    if (!mapping || identityKey(mapping.finalTargetAnchor) !== identityKey(decision.target)) throw new Error(`Reviewed decision is not planned exactly for ${identityKey(decision.source)}.`);
    const fieldPlan = mapping.fieldPlan; const protectedFields = keepExisting.every((key) => fieldPlan[key] === 'KEEP_EXISTING') && neverFromDiba.every((key) => fieldPlan[key] === 'NEVER_FROM_DIBA');
    if (!protectedFields) throw new Error(`Reviewed mapping lacks public field protection for ${identityKey(decision.source)}.`);
    return { source: stable(decision.source), target: stable(decision.target), sourceDiagnosticPlanId: sourceEntry.planId, targetDiagnosticPlanId: targetEntry.planId, plannedFinalTarget: stable(mapping.finalTargetAnchor), fieldOwnership: fieldPlan, expectedOrphanEffect: policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.some(({ diagnostic }) => diagnostic.originalDibaStagingPlanId === sourceEntry.planId) ? 'SOURCE_LESS_STAGING_PLAN_EXPECTED' : 'NO_SOURCE_LESS_STAGING_PLAN_EXPECTED', validation: { status: 'PASS', sourceResolvesExactlyOnce: true, targetResolvesExactlyOnce: true, targetEnabledNonDiba: true, targetInConfirmedComponent: true, noNumericPlanIdentity: true, publicFieldOwnershipProtected: true } };
  });
  const missingApproved = records.filter(({ source }) => !mappingsBySource.has(identityKey(source))); if (missingApproved.length) throw new Error(`Reviewed dry-run omitted ${missingApproved.length} approved decision(s).`);
  const expectedOrphans = policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans;
  const reviewedPossibleComponents = policy.crossSource.possible.filter(({ reviewedDecision }) => reviewedDecision).length;
  if (reviewedPossibleComponents) throw new Error(`Human CONFIRMED overrides unexpectedly reviewed ${reviewedPossibleComponents} POSSIBLE component(s).`);
  const summary = { overridesAdded: records.length, reviewedConfirmedLinkComponents: policy.crossSource.confirmed.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length, reviewedProvenanceRelinks: records.length, distinctOriginDibaPlans: new Set(records.map(({ sourceDiagnosticPlanId }) => sourceDiagnosticPlanId)).size, expectedFutureOrphans: expectedOrphans.length, unexpectedOperations, knownGeographyNoops: policy.mutationPlan.phases.explicitGeography.length, reviewedPossibleComponents, remaining: { confirmed: policy.crossSource.confirmed.filter(({ decision }) => decision !== 'LINK_TO_EXISTING' && decision !== 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN' && decision !== 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY').length, possible: policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker).length, sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length, sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length }, publicActivationReady: policy.activation.publicActivationReady };
  const output = { generatedAt: new Date().toISOString(), databasePath: path.resolve(databasePath), readOnly: true, humanDecisionsRecorded: true, noSqliteMutationPerformed: true, summary, overrides: records, expectedOrphanPlans: expectedOrphans, remainingBlockers: policy.activation.blockers };
  await mkdir(reportDirectory, { recursive: true }); const jsonPath = path.join(reportDirectory, 'diba-human-reviewed-confirmed-dry-run.json'); const markdownPath = path.join(reportDirectory, 'diba-human-reviewed-confirmed-dry-run.md');
  await writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); await writeFile(markdownPath, markdown(output), 'utf8');
  console.log(`DIBA human-reviewed confirmed dry-run written read-only: ${markdownPath}`); console.log(`DIBA human-reviewed confirmed JSON: ${jsonPath}`);
  return { jsonPath, markdownPath, output };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA human-reviewed confirmed dry-run failed: ${error.message}`); process.exitCode = 1; });
