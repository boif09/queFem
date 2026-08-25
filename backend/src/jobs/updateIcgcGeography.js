import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateIcgcSnapshot } from '../geography/icgcSnapshot.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_ICGC_MANIFEST_PATH = path.join(projectRoot, 'data/geography/icgc-current.json');

export async function runIcgcGeographyUpdate(options = {}) {
  const result = await updateIcgcSnapshot({
    manifestPath: DEFAULT_ICGC_MANIFEST_PATH,
    ...options,
  });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2);
  const allowed = new Set(['--allow-administrative-change']);
  const unknown = argumentsList.filter((argument) => !allowed.has(argument));
  if (unknown.length) {
    console.error(`ICGC geography update failed: unknown argument ${unknown[0]}`);
    process.exitCode = 1;
  } else {
    try {
      const result = await runIcgcGeographyUpdate({
        allowAdministrativeChange: argumentsList.includes('--allow-administrative-change'),
      });
      console.log('ICGC geography snapshot updated');
      console.log(`Layer / features: ${result.metadata.layer} / ${result.metadata.featureCount}`);
      console.log(`Dataset / retrieval date: ${result.metadata.datasetDate} / ${result.metadata.retrievalDate}`);
      console.log(`Snapshot bytes / SHA-256: ${result.snapshotBytes} / ${result.metadata.snapshotSha256}`);
      console.log(`Administrative codes previous / current / added / removed: ${result.changes.previousCount ?? '-'} / ${result.changes.nextCount} / ${result.changes.added.length} / ${result.changes.removed.length}`);
      if (result.changes.added.length) console.log(`Added codes: ${result.changes.added.join(', ')}`);
      if (result.changes.removed.length) console.log(`Removed codes: ${result.changes.removed.join(', ')}`);
    } catch (error) {
      console.error(`ICGC geography update failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
