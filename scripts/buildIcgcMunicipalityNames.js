// Derives the lightweight official-names index used by the embed widget from the verified ICGC
// snapshot (33 MB of polygons would be too heavy to parse inside the API process).
// Usage: npm run geography:icgc:names
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndVerifyIcgcSnapshot } from '../backend/src/geography/icgcSnapshot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ICGC_NAMES_PATH = path.join(root, 'backend/src/embed/officialPlaceNames.json');

export async function buildIcgcMunicipalityNames(manifestPath = path.join(root, 'data/geography/icgc-current.json')) {
  const { snapshot, metadata, manifest } = await readAndVerifyIcgcSnapshot(manifestPath);
  const municipalities = snapshot.features.map(({ properties: p }) => ({
    code: p.CODIMUNI,
    name: p.NOMMUNI,
    comarcaCode: p.CODICOMAR,
    comarca: p.NOMCOMAR,
    provinceCode: p.CODIPROV,
    province: p.NOMPROV,
  })).sort((a, b) => a.code.localeCompare(b.code));
  return {
    provider: metadata.provider,
    datasetDate: metadata.datasetDate,
    license: metadata.license,
    snapshotSha256: manifest.snapshotSha256,
    municipalities,
  };
}

async function main() {
  const index = await buildIcgcMunicipalityNames();
  await writeFile(ICGC_NAMES_PATH, `${JSON.stringify(index, null, 1)}\n`, 'utf8');
  console.log(`ICGC names index: ${index.municipalities.length} municipalities (${index.datasetDate}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`No s’ha pogut generar l’índex de noms ICGC: ${error.message}`);
    process.exitCode = 1;
  });
}
