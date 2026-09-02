import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { buildConfirmedHumanReviewPack, loadConfirmedHumanReviewState, renderConfirmedHumanReviewMarkdown } from '../backend/src/diba/dibaHumanReviewConfirmed.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(projectRoot, 'data', 'reports');
const overridePath = path.join(projectRoot, 'data-policy', 'diba-link-overrides.json');

export async function main({ databasePath = loadConfig().databasePath } = {}) {
  const auditReport = await runDibaQualityAudit({ databasePath });
  const overrides = await loadDibaPolicyOverrides(overridePath);
  const db = openDatabase(databasePath, { readonly: true });
  let policy; let state;
  try { policy = planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }); state = loadConfirmedHumanReviewState(db); } finally { db.close(); }
  const pack = buildConfirmedHumanReviewPack({ auditReport, policy, state });
  const output = { generatedAt: new Date().toISOString(), databasePath: path.resolve(databasePath), readOnly: true, ...pack };
  const markdown = renderConfirmedHumanReviewMarkdown(output);
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, 'diba-human-review-confirmed.json'); const markdownPath = path.join(reportDirectory, 'diba-human-review-confirmed.md');
  await writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8'); await writeFile(markdownPath, markdown, 'utf8');
  console.log(`DIBA confirmed human-review pack written read-only: ${markdownPath}`); console.log(`DIBA confirmed human-review JSON: ${jsonPath}`);
  return { jsonPath, markdownPath, pack: output };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA confirmed human-review pack failed: ${error.message}`); process.exitCode = 1; });
