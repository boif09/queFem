import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(projectRoot, 'data', 'reports');

export async function main({ databasePath = loadConfig().databasePath } = {}) {
  const report = await runDibaQualityAudit({ databasePath });
  await mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, 'diba-quality-audit.json');
  const markdownPath = path.join(reportDirectory, 'diba-quality-audit.md');
  const { markdown, ...json } = report;
  await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, markdown, 'utf8');
  console.log(`DIBA quality audit written read-only: ${markdownPath}`);
  console.log(`DIBA quality audit JSON: ${jsonPath}`);
  return { jsonPath, markdownPath, report: json };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`DIBA quality audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
