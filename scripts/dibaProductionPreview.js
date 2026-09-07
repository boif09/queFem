import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { prepareProductionPreview } from '../backend/src/diba/dibaProductionAuthorization.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function main(config=loadConfig(), preparePreview=prepareProductionPreview){const report=await preparePreview({config,overridePath:path.join(root,'data-policy','diba-link-overrides.json'),decisionPath:path.join(root,'data-policy','diba-final-review-decisions.json')});console.log(JSON.stringify(report,null,2));return report;}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
