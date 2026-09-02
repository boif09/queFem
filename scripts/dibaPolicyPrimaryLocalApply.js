import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { preflightC3PrimaryLocal } from '../backend/src/diba/dibaPolicyPrimaryLocal.js';
import { applyDibaPolicyPrimaryLocal } from '../backend/src/diba/dibaPolicyExecutor.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseArguments(argv) {
  const values = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (key === '--allow-primary-local') values.allowPrimaryLocal = true; else if (['--database','--expected-sha','--confirm','--backup'].includes(key) && argv[i + 1]) values[{ '--database': 'databasePath', '--expected-sha': 'expectedSha', '--confirm': 'confirmation', '--backup': 'backupPath' }[key]] = argv[++i]; else throw new Error(`Unknown or incomplete C3 argument: ${key}`); }
  return values;
}
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
export async function main(config = loadConfig(), argv = process.argv.slice(2)) {
  const args = parseArguments(argv); const overrides = await loadDibaPolicyOverrides(path.join(root, 'data-policy', 'diba-link-overrides.json'));
  const preview = await preflightC3PrimaryLocal({ args, config, overrides }); const backupPath = args.backupPath || path.join(root, 'data', 'backups', `quefem_before_diba_m1_4c3_${timestamp()}.sqlite`);
  console.log(`REAL LOCAL DATABASE MUTATION AUTHORIZED\nDatabase: ${preview.primary}\nCurrent SHA: ${preview.sha256}\nBackup: ${path.resolve(backupPath)}\nPlanned: ${preview.expected.relinks} relinks; ${preview.expected.geography} geography rules; ${preview.expected.orphans} orphan candidates\nDIBA activation: NO\nRemaining human-review blockers: YES`);
  const result = await applyDibaPolicyPrimaryLocal({ args, config, overrides, backupPath });
  const report = { generatedAt: new Date().toISOString(), pre: { sha256: result.pre.sha256, integrity: result.pre.state.integrity, counts: result.pre.expected, sourceStates: result.pre.state.sources }, backup: result.backup, apply: result.apply, post: { sha256: result.postSha256, integrity: result.post.integrity, sourceStates: result.post.sources } };
  const dir = path.join(root, 'data', 'reports'); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'diba-c3-real-local-apply.json'), `${JSON.stringify(report, null, 2)}\n`); await writeFile(path.join(dir, 'diba-c3-real-local-apply.md'), `# DIBA M1.4C3 real local apply\n\n**REAL LOCAL DATABASE MUTATED — PRODUCTION NOT MUTATED — DIBA NOT ACTIVATED**\n\n- Pre SHA: \`${report.pre.sha256}\`\n- Backup: \`${report.backup.path}\`\n- Backup SHA: \`${report.backup.sha256}\`\n- Relinks: ${report.apply.finalRelinks.length}\n- Geography mutations: ${report.apply.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length}\n- Orphans inactivated: ${report.apply.inactivatedOrphans.length}\n- Post SHA: \`${report.post.sha256}\`\n- Integrity: ${report.post.integrity}\n`);
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA C3 real local apply failed: ${error.message}`); process.exitCode = 1; });
