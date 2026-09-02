import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { previewC3PostApplyNoop } from '../backend/src/diba/dibaPolicyPrimaryLocal.js';
import { loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { parseArguments } from './dibaPolicyPrimaryLocalApply.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function main() { const config = loadConfig(); const args = parseArguments(process.argv.slice(2)); const overrides = await loadDibaPolicyOverrides(path.join(root, 'data-policy', 'diba-link-overrides.json')); const result = await previewC3PostApplyNoop({ args, config, overrides }); console.log(`C3 post-apply preview: ${result.expected.relinks} relinks, ${result.expected.orphans} orphans, ${result.geometryOperations} geography NOOP candidates; no writable database connection opened.`); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`C3 post-apply preview failed: ${error.message}`); process.exitCode = 1; });
