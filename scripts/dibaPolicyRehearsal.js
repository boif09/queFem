import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { applyDibaPolicyRehearsal, cloneDibaRehearsal, sha256File, verifyDibaRepeatPreservation } from '../backend/src/diba/dibaPolicyExecutor.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function parse(argv) {
  if (argv.length !== 2 || argv[0] !== '--database' || argv[1].startsWith('--')) throw new Error('Usage: npm run diba:policy:rehearsal -- --database <new-temporary.sqlite>');
  return path.resolve(argv[1]);
}
function report(output) {
  return `# DIBA M1.4C2 rehearsal\n\n**REHEARSAL DATABASE ONLY — ORIGINAL DATABASE NOT MUTATED**\n\n- Rehearsal: \`${output.first.rehearsalDatabasePath}\`\n- Original hashes: ${Object.values(output.originalHashes).map((hash) => `\`${hash}\``).join(' / ')}\n- First final relinks: ${output.first.finalRelinks.length}\n- First geography: ${output.first.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length} mutations, ${output.first.geography.filter(({ outcome }) => outcome !== 'MUTATED_APPROVED_GEOGRAPHY').length} NOOP\n- First inactivated orphans: ${output.first.inactivatedOrphans.length}\n- Repeat proof: ${output.repeat.method}; ${output.repeat.verified.length} relinked identities retained final plan IDs; old staging plans recreated: no\n- Second apply final relinks: ${output.second.finalRelinks.length}\n- Second apply new orphan inactivations: ${output.second.inactivatedOrphans.length}\n- Integrity: ${output.second.invariantResults.integrity}\n- Activation ready: ${output.second.activation.publicActivationReady ? 'YES' : 'NO'}\n`;
}
export async function main(config = loadConfig(), argv = process.argv.slice(2)) {
  const target = parse(argv); const originalBefore = sha256File(config.databasePath);
  const copy = await cloneDibaRehearsal(config.databasePath, target); const overrides = await loadDibaPolicyOverrides(path.join(root, 'data-policy', 'diba-link-overrides.json'));
  const first = await applyDibaPolicyRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overrides }); const originalAfterFirst = sha256File(config.databasePath);
  const repeat = verifyDibaRepeatPreservation({ databasePath: target, relinks: first.finalRelinks }); const originalAfterRepeat = sha256File(config.databasePath);
  const second = await applyDibaPolicyRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overrides }); const originalAfterSecond = sha256File(config.databasePath);
  if (new Set([originalBefore, originalAfterFirst, originalAfterRepeat, originalAfterSecond]).size !== 1) throw new Error('Original database changed during C2 rehearsal.');
  if (second.finalRelinks.length || second.inactivatedOrphans.length || second.geography.some(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY')) throw new Error('Second C2 apply was not structurally idempotent.');
  const output = { generatedAt: new Date().toISOString(), copy, originalHashes: { beforeCopy: originalBefore, afterFirstApply: originalAfterFirst, afterRepeatImportCheck: originalAfterRepeat, afterSecondApply: originalAfterSecond }, first, repeat, second };
  const reports = path.join(root, 'data', 'reports'); await mkdir(reports, { recursive: true });
  await writeFile(path.join(reports, 'diba-c2-rehearsal.json'), `${JSON.stringify(output, null, 2)}\n`); await writeFile(path.join(reports, 'diba-c2-rehearsal.md'), report(output));
  console.log(`DIBA C2 full rehearsal passed on: ${target}`); return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA C2 full rehearsal failed: ${error.message}`); process.exitCode = 1; });
