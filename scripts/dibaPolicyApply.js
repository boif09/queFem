import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { applyDibaPolicyRehearsal, cloneDibaRehearsal } from '../backend/src/diba/dibaPolicyExecutor.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overridePath = path.join(projectRoot, 'data-policy', 'diba-link-overrides.json');
function parseArguments(argv) {
  const allowed = new Set(['--database', '--clone-real']);
  for (const argument of argv) if (argument.startsWith('--') && !allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
  const index = argv.indexOf('--database');
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Usage: npm run diba:policy:apply -- --database <temporary.sqlite> [--clone-real]');
  return { databasePath: argv[index + 1], cloneReal: argv.includes('--clone-real') };
}
function markdown(result) {
  return `# DIBA M1.4C2 rehearsal\n\n**REHEARSAL DATABASE ONLY — ORIGINAL DATABASE NOT MUTATED**\n\n- Rehearsal: \`${result.rehearsalDatabasePath}\`\n- Original SHA before/after: \`${result.originalSha256Before}\` / \`${result.originalSha256After}\`\n- Rehearsal SHA before/after: \`${result.rehearsalSha256Before}\` / \`${result.rehearsalSha256After}\`\n- Final provenance relinks: ${result.finalRelinks.length}\n- Geography mutations: ${result.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length}\n- Geography NOOP: ${result.geography.filter(({ outcome }) => outcome !== 'MUTATED_APPROVED_GEOGRAPHY').length}\n- Recomputed orphan candidates: ${result.candidateOrphanPlanIds.length}\n- Inactivated source-less DIBA staging plans: ${result.inactivatedOrphans.length}\n- Integrity: ${result.invariantResults.integrity}\n- Public activation ready: ${result.activation.publicActivationReady ? 'YES' : 'NO'}\n\n## Final relinks\n\n${result.finalRelinks.map(({ source, finalTargetAnchor, beforePlanId, afterPlanId }) => `- ${source.sourceKey}:${source.sourceRecordId} -> ${finalTargetAnchor.sourceKey}:${finalTargetAnchor.sourceRecordId} (diagnostic ${beforePlanId} -> ${afterPlanId})`).join('\n') || 'None'}\n\n## Geography\n\n${result.geography.map(({ source, outcome, geography }) => `- ${source.sourceKey}:${source.sourceRecordId}: ${geography.ruleId} — ${outcome}`).join('\n') || 'None'}\n`;
}
export async function main(config = loadConfig(), argv = process.argv.slice(2)) {
  const args = parseArguments(argv); const target = path.resolve(args.databasePath);
  const copy = args.cloneReal ? await cloneDibaRehearsal(config.databasePath, target) : null;
  const overrides = await loadDibaPolicyOverrides(overridePath);
  const result = await applyDibaPolicyRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overrides });
  const output = { generatedAt: new Date().toISOString(), readOnlyOriginal: true, copy, ...result };
  const directory = path.join(projectRoot, 'data', 'reports'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'diba-c2-rehearsal.json'), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(path.join(directory, 'diba-c2-rehearsal.md'), markdown(output));
  console.log(`DIBA C2 rehearsal committed only to: ${target}`); console.log('Original database was not mutated.');
  return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA C2 rehearsal failed: ${error.message}`); process.exitCode = 1; });
