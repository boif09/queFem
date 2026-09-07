import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { applyProductionReconciliation } from '../backend/src/diba/dibaProductionAuthorization.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function authorizationArgument(argv) { const index = argv.indexOf('--authorization'); return index >= 0 ? argv[index + 1] : null; }
export async function main(config = loadConfig(), argv = process.argv.slice(2)) {
  const authorization = authorizationArgument(argv); if (!authorization) throw new Error('DIBA production apply requires --authorization <authorization>.');
  const backupPath = path.join(root, 'data', 'backups', `quefem_before_diba_production_reconcile_${stamp()}.sqlite`);
  const report = await applyProductionReconciliation({ config, authorization, backupPath, overridePath: path.join(root, 'data-policy', 'diba-link-overrides.json'), decisionPath: path.join(root, 'data-policy', 'diba-final-review-decisions.json') });
  const reports = path.join(root, 'data', 'reports'); await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, 'diba-production-apply.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(reports, 'diba-production-apply.md'), `# DIBA production reconciliation apply\n\n- Authorization consumed: \`${report.authorizationConsumed}\`\n- Backup: \`${report.backup.path}\`\n- Public activation ready: **false**\n`);
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
