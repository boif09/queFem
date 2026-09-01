import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(projectRoot, 'data', 'reports');
const overridePath = path.join(projectRoot, 'data-policy', 'diba-link-overrides.json');

function markdownTable(rows, columns) {
  const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${columns.map(({ label }) => label).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${columns.map(({ value }) => escape(value(row))).join(' | ')} |`)].join('\n');
}
export function renderDibaPolicyDryRunMarkdown(result) {
  return `# DIBA M1.4C1.1 policy dry-run

**READ-ONLY POLICY DRY-RUN — NO DATABASE MUTATION PERFORMED**

## Activation

**PUBLIC ACTIVATION READY: ${result.activation.publicActivationReady ? 'YES' : 'NO'}**

${markdownTable(Object.entries(result.activation.blockerCounts).map(([reason, count]) => ({ reason, count })), [{ label: 'Blocker', value: ({ reason }) => reason }, { label: 'Count', value: ({ count }) => count }])}

## Same-feed decisions

${markdownTable(result.sameFeed, [{ label: 'Cluster', value: ({ clusterId }) => clusterId }, { label: 'Decision', value: ({ decision }) => decision }, { label: 'Reason', value: ({ reasons }) => reasons.join('; ') }, { label: 'Session public', value: ({ publicSessionDistinguishable }) => publicSessionDistinguishable }, { label: 'Activation disposition', value: ({ activationDisposition }) => activationDisposition || '' }])}

## Cross-source decisions

${markdownTable(result.crossSource.confirmed, [{ label: 'Component', value: ({ componentId }) => componentId }, { label: 'Decision', value: ({ decision }) => decision }, { label: 'Reason', value: ({ reasons }) => reasons.join('; ') }])}

Possible components: ${result.summary.possible.totalComponents}; reviewed link: ${result.summary.possible.reviewedLink}; reviewed keep separate: ${result.summary.possible.reviewedKeepSeparate}; reviewed defer: ${result.summary.possible.reviewedDefer}; unresolved active: ${result.summary.possible.unresolved}.

## Geography

${markdownTable(result.geography, [{ label: 'Source', value: ({ source }) => `${source.sourceKey}:${source.sourceRecordId}` }, { label: 'Type', value: ({ resolutionType }) => resolutionType }, { label: 'Municipality / comarca', value: ({ municipality, comarca }) => municipality || comarca || '' }, { label: 'INE', value: ({ ine }) => ine || '' }, { label: 'Rule', value: ({ ruleId }) => ruleId || '' }])}

## Policy reasoning versus final C2 destinations

Policy-level safe-consolidation edges: ${result.summary.policyLevelConsolidationEdges}.

Policy-level public-link edges: ${result.summary.policyLevelPublicLinkEdges}.

Final unique provenance relinks: ${result.summary.finalUniqueSourceRelinks}.

## Phased future M1.4C2 mutation plan

This is a conceptual, **non-executable** plan. A future C2 transaction must resolve and validate every stable identity, derive all final destinations, relink provenance, apply explicit non-degrading geography only to final target contexts, recompute source-less DIBA staging plans inside that transaction, validate final invariants, and only then commit.

${markdownTable(result.mutationPlan.phases.finalSourceMappings, [{ label: 'Source', value: ({ source }) => `${source.sourceKey}:${source.sourceRecordId}` }, { label: 'Final target anchor', value: ({ finalTargetAnchor }) => `${finalTargetAnchor.sourceKey}:${finalTargetAnchor.sourceRecordId}` }, { label: 'Policy', value: ({ diagnostic }) => diagnostic.policy }])}

## Flattened display of future operations

${markdownTable(Object.entries(result.summary.plannedOperations).map(([type, count]) => ({ type, count })), [{ label: 'Operation', value: ({ type }) => type }, { label: 'Count', value: ({ count }) => count }])}

The flattened display is explanatory only and MUST NOT be executed in array order. \`mutationPlan.phases\` is the C2 contract. Every durable identity is \`source key + source_record_id\`; numeric plan IDs are diagnostic context only.
`;
}
export async function main({ databasePath = loadConfig().databasePath } = {}) {
  const auditReport = await runDibaQualityAudit({ databasePath });
  const overrides = await loadDibaPolicyOverrides(overridePath);
  const db = openDatabase(databasePath, { readonly: true });
  let result;
  try { result = planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }); } finally { db.close(); }
  const output = { generatedAt: new Date().toISOString(), databasePath: path.resolve(databasePath), readOnly: true, overridePath, ...result };
  const markdown = renderDibaPolicyDryRunMarkdown(output);
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, 'diba-policy-dry-run.json'); const markdownPath = path.join(reportDirectory, 'diba-policy-dry-run.md');
  await writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); await writeFile(markdownPath, markdown, 'utf8');
  console.log(`DIBA policy dry-run written read-only: ${markdownPath}`); console.log(`DIBA policy dry-run JSON: ${jsonPath}`);
  return { jsonPath, markdownPath, result: output };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA policy dry-run failed: ${error.message}`); process.exitCode = 1; });
