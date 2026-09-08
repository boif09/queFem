import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { runDibaImport } from './dibaImportRunner.js';

export function parseScheduledArguments(argv) {
  if (argv.length) throw new Error('Usage: npm run diba:import:scheduled');
  return {};
}

export async function importDibaScheduled(config = loadConfig(), options = {}) {
  const allowedOptions = new Set(['runImport', 'fetchImpl', 'now', 'manifestPath', 'logger']);
  const unexpected = Object.keys(options).filter((key) => !allowedOptions.has(key));
  if (unexpected.length) throw new Error(`Unsafe or unsupported scheduled DIBA import option: ${unexpected.join(', ')}`);
  const { runImport = runDibaImport, logger = console, ...importOptions } = options;
  const summary = await runImport(config, { ...importOptions, dryRun: false, allowMassRemoval: false, logger: { log() {} } });
  const report = { event: 'diba-import-scheduled', status: 'completed', database: config.databasePath, ...summary };
  logger.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await importDibaScheduled(loadConfig(), parseScheduledArguments(process.argv.slice(2))); }
  catch (error) {
    console.error(`Scheduled DIBA import failed: ${error.message}`);
    if (error.results) console.error(JSON.stringify({ event: 'diba-import-scheduled', status: 'failed', datasets: error.results }));
    process.exitCode = 1;
  }
}
