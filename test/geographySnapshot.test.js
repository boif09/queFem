import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CataloniaAdministrativeResolver } from '../backend/src/geography/cataloniaAdministrativeResolver.js';
import { readAndVerifyIcgcSnapshot } from '../backend/src/geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from '../backend/src/jobs/updateIcgcGeography.js';

test('the vendored ICGC snapshot passes integrity and administrative sanity checks', async () => {
  const { snapshot, metadata, manifest } = await readAndVerifyIcgcSnapshot(DEFAULT_ICGC_MANIFEST_PATH);
  assert.equal(snapshot.features.length, 947);
  assert.equal(metadata.featureCount, 947);
  assert.equal(metadata.snapshotSha256, manifest.snapshotSha256);
  assert.equal(new Set(snapshot.features.map(({ properties }) => properties.CODIMUNI)).size, 947);
  assert.ok(snapshot.bbox[0] >= -1 && snapshot.bbox[1] >= 39);
  assert.ok(snapshot.bbox[2] <= 5 && snapshot.bbox[3] <= 44);
  assert.ok(snapshot.bbox[2] - snapshot.bbox[0] >= 1.5);
  assert.ok(snapshot.bbox[3] - snapshot.bbox[1] >= 1.5);
});

test('the real snapshot resolves representative municipalities', async () => {
  const resolver = await CataloniaAdministrativeResolver.fromManifest(DEFAULT_ICGC_MANIFEST_PATH);
  const cases = [
    [41.3874, 2.1686, '080193', 'Barcelona'],
    [41.472, 2.086, '082055', 'Sant Cugat del Vallès'],
    [41.425, 1.785, '082401', "Sant Sadurní d'Anoia"],
  ];
  for (const [latitude, longitude, code, name] of cases) {
    const result = resolver.resolve({ latitude, longitude });
    assert.equal(result.status, 'match');
    assert.deepEqual(result.municipality, { code, name });
  }
});

test('the resident HTTP entry points do not import M4A or Turf', async () => {
  for (const file of ['backend/src/server.js', 'backend/src/app.js']) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /geography|icgc|@turf/i, file);
  }
});
