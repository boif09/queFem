import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { buildPossibleHumanReviewPack, loadPossibleHumanReviewState, renderPossibleHumanReviewMarkdown } from '../backend/src/diba/dibaHumanReviewPossible.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(projectRoot, 'data', 'reports');
const overridePath = path.join(projectRoot, 'data-policy', 'diba-link-overrides.json');

export async function main({ databasePath = loadConfig().databasePath } = {}) {
  const auditReport = await runDibaQualityAudit({ databasePath }); const overrides = await loadDibaPolicyOverrides(overridePath);
  const db = openDatabase(databasePath, { readonly: true }); let policy; let state;
  try { policy = planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }); state = loadPossibleHumanReviewState(db); } finally { db.close(); }
  const pack = buildPossibleHumanReviewPack({ auditReport, policy, state, overrides });
  const output = { generatedAt: new Date().toISOString(), databasePath: path.resolve(databasePath), readOnly: true, ...pack };
  const markdown = renderPossibleHumanReviewMarkdown(output); await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, 'diba-human-review-possible.json'); const markdownPath = path.join(reportDirectory, 'diba-human-review-possible.md');
  await writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); await writeFile(markdownPath, markdown, 'utf8');
  console.log(`DIBA possible human-review pack written read-only: ${markdownPath}`); console.log(`DIBA possible human-review JSON: ${jsonPath}`);
  return { jsonPath, markdownPath, pack: output };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA possible human-review pack failed: ${error.message}`); process.exitCode = 1; });
