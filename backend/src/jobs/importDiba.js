import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { runDibaImport } from './dibaImportRunner.js';

export function parseArguments(argv) {
  const unknown = argv.filter((argument) => !['--dry-run', '--allow-mass-removal'].includes(argument));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  return { dryRun: argv.includes('--dry-run'), allowMassRemoval: argv.includes('--allow-mass-removal') };
}

async function main() {
  try { await runDibaImport(loadConfig(), parseArguments(process.argv.slice(2))); }
  catch (error) {
    console.error(`DIBA import failed: ${error.message}`);
    if (error.results) console.error(JSON.stringify(error.results));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
