import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CataloniaAdministrativeResolver } from '../backend/src/geography/cataloniaAdministrativeResolver.js';
import {
  normalizeIcgcFeatureCollection, readAndVerifyIcgcSnapshot, updateIcgcSnapshot, validateIcgcUrl,
} from '../backend/src/geography/icgcSnapshot.js';
import { dryRunFeverGeography } from '../backend/src/jobs/dryRunFeverGeography.js';

const rawFixture = JSON.parse(await readFile(
  new URL('./fixtures/icgc-municipalities-small.geojson', import.meta.url), 'utf8',
));
const snapshot = normalizeIcgcFeatureCollection(rawFixture, { minimumFeatures: 1 });
const metadata = {
  provider: 'Institut Cartogràfic i Geològic de Catalunya (ICGC)',
  datasetDate: '2026-01-20',
  layer: 'test-municipalities',
};
const resolver = new CataloniaAdministrativeResolver(snapshot, metadata);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function geoJsonResponse(payload, status = 200, headers = {}) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/geo+json', ...headers },
  });
}

function mapPositions(value, mapper) {
  if (typeof value[0] === 'number') return mapper(value);
  return value.map((nested) => mapPositions(nested, mapper));
}

function administrativePayload(count, replacementCode = null) {
  const features = Array.from({ length: count }, (_, index) => {
    const source = structuredClone(rawFixture.features[index % rawFixture.features.length]);
    source.properties.CODIMUNI = String(index + 1).padStart(6, '0');
    if (replacementCode && index === count - 1) source.properties.CODIMUNI = replacementCode;
    return source;
  });
  return { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, features };
}

async function publish(directory, payload = rawFixture, options = {}) {
  const manifestPath = path.join(directory, 'icgc-current.json');
  const result = await updateIcgcSnapshot({
    manifestPath,
    minimumFeatures: 1,
    now: new Date('2026-08-25T00:00:00Z'),
    fetchImpl: async () => geoJsonResponse(payload),
    ...options,
  });
  return { manifestPath, result };
}

function removeTemporaryDirectory(directory) {
  return rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25,
  });
}

test('resolves Polygon/MultiPolygon and preserves official codes and accented names', () => {
  const result = resolver.resolve({ latitude: 41.5, longitude: 1.5 });
  assert.equal(result.status, 'match');
  assert.deepEqual(result.municipality, { code: '001234', name: "Municipi d'Àccent" });
  assert.deepEqual(result.comarca, { code: '01', name: 'Comarca Àmplia' });
  assert.deepEqual(result.province, { code: '08', name: 'Barcelona' });
  assert.equal(resolver.resolve({ latitude: 41.25, longitude: 3.25 }).municipality.code, '002345');
  assert.equal(resolver.resolve({ latitude: 42.25, longitude: 3.25 }).municipality.code, '002345');
});

test('handles holes, outside points, inverted coordinates, borders and 0,0 without fallback', () => {
  assert.equal(resolver.resolve({ latitude: 41.3, longitude: 1.3 }).status, 'unresolved');
  assert.equal(resolver.resolve({ latitude: 40, longitude: 1.5 }).status, 'unresolved');
  assert.equal(resolver.resolve({ latitude: 1.5, longitude: 41.5 }).status, 'unresolved');
  const border = resolver.resolve({ latitude: 41.5, longitude: 2 });
  assert.equal(border.status, 'ambiguous');
  assert.deepEqual(border.candidates.map(({ municipality }) => municipality.code), ['001234', '003456']);
  const zero = resolver.resolve({ latitude: 0, longitude: 0 });
  assert.equal(zero.status, 'unresolved');
  assert.equal(zero.diagnostics.suspicious, true);
});

test('validates declared CRS, WGS84 ranges and a plausible Catalonia envelope', () => {
  assert.equal(normalizeIcgcFeatureCollection({
    ...structuredClone(rawFixture), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } },
  }, { minimumFeatures: 1 }).features.length, 3);

  const projected = structuredClone(rawFixture);
  projected.features.forEach((feature) => { feature.geometry.coordinates = mapPositions(feature.geometry.coordinates, ([x, y]) => [400000 + x, 4600000 + y]); });
  assert.throws(() => normalizeIcgcFeatureCollection(projected, { minimumFeatures: 1 }), /EPSG:4326 ranges/);

  const swapped = structuredClone(rawFixture);
  swapped.features.forEach((feature) => { feature.geometry.coordinates = mapPositions(feature.geometry.coordinates, ([x, y]) => [y, x]); });
  assert.throws(() => normalizeIcgcFeatureCollection(swapped, { minimumFeatures: 1 }), /Catalonia envelope/);

  const otherRegion = structuredClone(rawFixture);
  otherRegion.features.forEach((feature) => { feature.geometry.coordinates = mapPositions(feature.geometry.coordinates, ([x, y]) => [x + 10, y]); });
  assert.throws(() => normalizeIcgcFeatureCollection(otherRegion, { minimumFeatures: 1 }), /Catalonia envelope/);

  const wrongDeclaration = { ...structuredClone(rawFixture), crs: { type: 'name', properties: { name: 'EPSG:25831' } } };
  assert.throws(() => normalizeIcgcFeatureCollection(wrongDeclaration, { minimumFeatures: 1 }), /incompatible CRS/);
});

test('rejects malformed and post-rounding degenerate rings in Polygon, holes and MultiPolygon', () => {
  const cases = [];
  const open = structuredClone(rawFixture);
  open.features[0].geometry.coordinates[0].at(-1)[0] = 1.1;
  cases.push(open);
  const threePositions = structuredClone(rawFixture);
  threePositions.features[0].geometry.coordinates[0] = [[1, 41], [2, 41], [1, 41]];
  cases.push(threePositions);
  const twoDistinct = structuredClone(rawFixture);
  twoDistinct.features[0].geometry.coordinates[0] = [[1, 41], [2, 41], [1, 41], [1, 41]];
  cases.push(twoDistinct);
  const collapsed = structuredClone(rawFixture);
  collapsed.features[0].geometry.coordinates[0] = [[1, 41], [1.0000001, 41], [1, 41.0000001], [1, 41]];
  cases.push(collapsed);
  const invalidHole = structuredClone(rawFixture);
  invalidHole.features[0].geometry.coordinates[1].pop();
  cases.push(invalidHole);
  const invalidMultiPolygon = structuredClone(rawFixture);
  invalidMultiPolygon.features[1].geometry.coordinates[0][0] = [[3, 41], [3.5, 41], [3, 41]];
  cases.push(invalidMultiPolygon);
  for (const payload of cases) assert.throws(
    () => normalizeIcgcFeatureCollection(payload, { minimumFeatures: 1 }),
    /ring|positions|degenerate/i,
  );
});

test('rejects zero-area rings after rounding regardless of polygon nesting', () => {
  const collinearRing = [[1, 41], [1.5, 41.5], [2, 42], [1, 41]];

  const collinear = structuredClone(rawFixture);
  collinear.features[0].geometry.coordinates[0] = collinearRing;
  assert.throws(
    () => normalizeIcgcFeatureCollection(collinear, { minimumFeatures: 1 }), /zero area after rounding/,
  );

  const clockwise = structuredClone(rawFixture);
  clockwise.features[0].geometry.coordinates[0].reverse();
  assert.doesNotThrow(() => normalizeIcgcFeatureCollection(clockwise, { minimumFeatures: 1 }));
  const counterClockwise = structuredClone(clockwise);
  counterClockwise.features[0].geometry.coordinates[0].reverse();
  assert.doesNotThrow(() => normalizeIcgcFeatureCollection(counterClockwise, { minimumFeatures: 1 }));

  const degenerateHole = structuredClone(rawFixture);
  degenerateHole.features[0].geometry.coordinates[1] = collinearRing;
  assert.throws(
    () => normalizeIcgcFeatureCollection(degenerateHole, { minimumFeatures: 1 }), /zero area after rounding/,
  );

  const degenerateMultiPolygonPart = structuredClone(rawFixture);
  degenerateMultiPolygonPart.features[1].geometry.coordinates[1][0] = collinearRing;
  assert.throws(
    () => normalizeIcgcFeatureCollection(degenerateMultiPolygonPart, { minimumFeatures: 1 }),
    /zero area after rounding/,
  );

  const collapsesOnlyAfterRounding = structuredClone(rawFixture);
  collapsesOnlyAfterRounding.features[0].geometry.coordinates[0] = [
    [1, 41], [1.000001, 41.0000014], [1.000002, 41.0000024], [1, 41],
  ];
  assert.throws(
    () => normalizeIcgcFeatureCollection(collapsesOnlyAfterRounding, { minimumFeatures: 1 }),
    /zero area after rounding/,
  );
});

test('rejects invalid, empty, incomplete and administratively incoherent datasets', () => {
  assert.throws(() => normalizeIcgcFeatureCollection({}, { minimumFeatures: 1 }), /FeatureCollection/);
  assert.throws(() => normalizeIcgcFeatureCollection({ type: 'FeatureCollection', features: [] }, { minimumFeatures: 1 }), /incomplete/);
  const missingCode = structuredClone(rawFixture);
  delete missingCode.features[0].properties.CODIMUNI;
  assert.throws(() => normalizeIcgcFeatureCollection(missingCode, { minimumFeatures: 1 }), /CODIMUNI/);
  const inconsistent = structuredClone(rawFixture);
  inconsistent.features[2].properties.NOMCOMAR = 'Different name';
  assert.throws(() => normalizeIcgcFeatureCollection(inconsistent, { minimumFeatures: 1 }), /Inconsistent ICGC comarca/);
});

test('accepts only credential-free HTTPS on the exact official ICGC host, including redirects', async (t) => {
  assert.equal(validateIcgcUrl('https://geoserveis.icgc.cat/path').hostname, 'geoserveis.icgc.cat');
  for (const value of [
    'http://geoserveis.icgc.cat/path',
    'https://geoserveis.icgc.cat.evil.example/path',
    'https://user@geoserveis.icgc.cat/path',
    'https://:password@geoserveis.icgc.cat/path',
    'https://user:password@geoserveis.icgc.cat/path',
  ]) assert.throws(() => validateIcgcUrl(value), /credential-free HTTPS/);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-redirects-'));
  t.after(() => removeTemporaryDirectory(directory));
  for (const location of [
    'https://user:password@geoserveis.icgc.cat/data',
    'https://evil.example/data',
    'http://geoserveis.icgc.cat/data',
  ]) await assert.rejects(publish(directory, rawFixture, {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location } }),
  }), /credential-free HTTPS/);
});

function oversizedStreamResponse(contentLength) {
  const chunk = new Uint8Array(1024 * 1024);
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunks >= 81) { controller.close(); return; }
      chunks += 1;
      controller.enqueue(chunk);
    },
  });
  const headers = { 'content-type': 'application/geo+json' };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  return new Response(stream, { status: 200, headers });
}

test('enforces the 80 MiB limit on declarations and actual streamed bytes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-size-limit-'));
  t.after(() => removeTemporaryDirectory(directory));
  const manifestPath = path.join(directory, 'icgc-current.json');
  await assert.rejects(updateIcgcSnapshot({ manifestPath, minimumFeatures: 1, fetchImpl: async () => geoJsonResponse(rawFixture, 200, { 'content-length': String(90 * 1024 * 1024) }) }), /too large/);
  await assert.rejects(updateIcgcSnapshot({ manifestPath, minimumFeatures: 1, fetchImpl: async () => oversizedStreamResponse() }), /exceeded maximum size/);
  await assert.rejects(updateIcgcSnapshot({ manifestPath, minimumFeatures: 1, fetchImpl: async () => oversizedStreamResponse(10 * 1024 * 1024) }), /exceeded maximum size/);
});

test('installed code set blocks 947→946 and same-count replacements unless explicitly approved', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-administrative-change-'));
  t.after(() => removeTemporaryDirectory(directory));
  const initial = administrativePayload(947);
  const { manifestPath } = await publish(directory, initial, { minimumFeatures: 900 });
  await publish(directory, structuredClone(initial), { minimumFeatures: 900 });
  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 900, fetchImpl: async () => geoJsonResponse(administrativePayload(946)),
  }), /administrative code set changed/);
  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 900, fetchImpl: async () => geoJsonResponse(administrativePayload(947, '999999')),
  }), /administrative code set changed/);
  const approved = await updateIcgcSnapshot({
    manifestPath, minimumFeatures: 900, allowAdministrativeChange: true,
    fetchImpl: async () => geoJsonResponse(administrativePayload(946)),
  });
  assert.equal(approved.changes.removed.length, 1);
  const corrupt = administrativePayload(945);
  corrupt.features[0].geometry.coordinates[0].pop();
  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 900, allowAdministrativeChange: true,
    fetchImpl: async () => geoJsonResponse(corrupt),
  }), /ring/);
});

test('atomic manifest keeps the previous version usable across publication failures', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-atomic-publication-'));
  t.after(() => removeTemporaryDirectory(directory));
  const { manifestPath } = await publish(directory);
  const previous = await readAndVerifyIcgcSnapshot(manifestPath);
  const changed = structuredClone(rawFixture);
  changed.features[0].properties.NOMMUNI = 'Updated official name';
  for (const stage of [
    'beforeSnapshotPublish', 'afterSnapshotWrite', 'beforeMetadataWrite',
    'beforeMetadataPublish', 'afterMetadataWrite', 'beforeManifestPublish',
  ]) {
    await assert.rejects(updateIcgcSnapshot({
      manifestPath, minimumFeatures: 1, fetchImpl: async () => geoJsonResponse(changed),
      onStage: async (current) => { if (current === stage) throw new Error(`simulated ${stage}`); },
    }), /simulated/);
    const stillCurrent = await readAndVerifyIcgcSnapshot(manifestPath);
    assert.equal(stillCurrent.manifest.snapshotSha256, previous.manifest.snapshotSha256);
  }
});

test('immutable artifacts are promoted only after complete writes and inconsistent finals are rejected', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-immutable-write-'));
  t.after(() => removeTemporaryDirectory(directory));
  const manifestPath = path.join(directory, 'icgc-current.json');

  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 1, fetchImpl: async () => geoJsonResponse(rawFixture),
    onStage: async (stage) => { if (stage === 'beforeSnapshotPublish') throw new Error('snapshot interrupted'); },
  }), /snapshot interrupted/);
  assert.deepEqual(await readdir(directory), []);

  const normalized = normalizeIcgcFeatureCollection(rawFixture, { minimumFeatures: 1 });
  const snapshotText = `${JSON.stringify(normalized)}\n`;
  const snapshotFile = `icgc-municipis-5000.${sha256(snapshotText).slice(0, 16)}.geojson`;
  await writeFile(path.join(directory, snapshotFile), 'partial');
  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 1, fetchImpl: async () => geoJsonResponse(rawFixture),
  }), /immutable ICGC artifact is inconsistent/);
  assert.equal(await readFile(path.join(directory, snapshotFile), 'utf8'), 'partial');
  assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false);
});

test('reader rejects invalid current JSON and missing snapshot or metadata targets', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-invalid-current-'));
  t.after(() => removeTemporaryDirectory(directory));
  const manifestPath = path.join(directory, 'icgc-current.json');
  await writeFile(manifestPath, '{invalid');
  await assert.rejects(readAndVerifyIcgcSnapshot(manifestPath), SyntaxError);

  const missing = {
    schemaVersion: 1,
    snapshotFile: 'missing.geojson',
    metadataFile: 'missing.metadata.json',
    snapshotSha256: '0'.repeat(64),
    metadataSha256: '0'.repeat(64),
  };
  await writeFile(path.join(directory, missing.metadataFile), '{}');
  await writeFile(manifestPath, JSON.stringify(missing));
  await assert.rejects(readAndVerifyIcgcSnapshot(manifestPath), /ENOENT/);

  await rm(path.join(directory, missing.metadataFile));
  await writeFile(path.join(directory, missing.snapshotFile), '{}');
  await assert.rejects(readAndVerifyIcgcSnapshot(manifestPath), /ENOENT/);
});

test('reader rejects new/old pair mismatches and inconsistent checksums', async (t) => {
  const firstDirectory = await mkdtemp(path.join(os.tmpdir(), 'icgc-pair-first-'));
  const secondDirectory = await mkdtemp(path.join(os.tmpdir(), 'icgc-pair-second-'));
  t.after(() => Promise.all([removeTemporaryDirectory(firstDirectory), removeTemporaryDirectory(secondDirectory)]));
  const first = await publish(firstDirectory);
  const changed = structuredClone(rawFixture);
  changed.features[0].properties.NOMMUNI = 'Updated official name';
  const second = await publish(secondDirectory, changed);
  const firstManifest = first.result.manifest;
  const secondManifest = second.result.manifest;
  await copyFile(path.join(secondDirectory, secondManifest.snapshotFile), path.join(firstDirectory, secondManifest.snapshotFile));
  await copyFile(path.join(secondDirectory, secondManifest.metadataFile), path.join(firstDirectory, secondManifest.metadataFile));

  const mismatches = [
    { ...firstManifest, snapshotFile: secondManifest.snapshotFile, snapshotSha256: secondManifest.snapshotSha256 },
    { ...firstManifest, metadataFile: secondManifest.metadataFile, metadataSha256: secondManifest.metadataSha256 },
    { ...firstManifest, snapshotSha256: '0'.repeat(64) },
  ];
  for (const manifest of mismatches) {
    await writeFile(first.manifestPath, JSON.stringify(manifest));
    await assert.rejects(readAndVerifyIcgcSnapshot(first.manifestPath), /checksum|different snapshot/);
  }
});

test('updater output is deterministic and invalid updates preserve the published manifest', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'icgc-update-deterministic-'));
  t.after(() => removeTemporaryDirectory(directory));
  const { manifestPath } = await publish(directory);
  const first = await readAndVerifyIcgcSnapshot(manifestPath);
  await publish(directory, structuredClone(rawFixture));
  const second = await readAndVerifyIcgcSnapshot(manifestPath);
  assert.equal(second.manifest.snapshotSha256, first.manifest.snapshotSha256);
  await assert.rejects(updateIcgcSnapshot({
    manifestPath, minimumFeatures: 1,
    fetchImpl: async () => geoJsonResponse({ type: 'FeatureCollection', features: [] }),
  }));
  assert.equal((await readAndVerifyIcgcSnapshot(manifestPath)).manifest.snapshotSha256, first.manifest.snapshotSha256);
});

test('Fever geography dry-run reports publicable geography and leaves DATABASE_PATH untouched', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fever-geography-readonly-'));
  t.after(() => removeTemporaryDirectory(directory));
  const { manifestPath } = await publish(directory);
  const databasePath = path.join(directory, 'sentinel.sqlite');
  await writeFile(databasePath, 'sentinel');
  const beforeFiles = await readdir(directory);
  const jobSource = await readFile(new URL('../backend/src/jobs/dryRunFeverGeography.js', import.meta.url), 'utf8');
  const items = [
    {
      CatalogItemId: 'resolved', CatalogId: '15532', CampaignId: '16345', ParentName: 'Catalonia',
      Name: 'Resolved', Url: 'https://fever.pxf.io/test', Pattern: '(41.5; 1.5)',
      Manufacturer: '2026-08-26 10:00', Text2: 'Wrong municipality', Category: 'Tier 1',
    },
    {
      CatalogItemId: 'unresolved', CatalogId: '15532', CampaignId: '16345', ParentName: 'Catalonia',
      Name: 'Unresolved', Url: 'https://fever.pxf.io/test', Pattern: '(40; 1.5)',
      Manufacturer: '2026-08-26 10:00', Text2: 'Barcelona', Category: 'Tier 1',
    },
  ];
  const result = await dryRunFeverGeography({
    impactAccountSid: 'test-account', impactAuthToken: 'test-token', feverLookaheadDays: 365, databasePath,
  }, {
    manifestPath, now: new Date('2026-08-25T10:00:00Z'), logger: { log() {} },
    fetchImpl: async () => geoJsonResponse({ Items: items }),
  });
  assert.deepEqual(result.summary.publicableGeography, { resolved: 1, unresolved: 1, ambiguous: 0 });
  assert.equal(result.summary.examples.publicableUnresolved[0].catalogItemId, 'unresolved');
  assert.equal(await readFile(databasePath, 'utf8'), 'sentinel');
  assert.deepEqual(await readdir(directory), beforeFiles);
  assert.doesNotMatch(jobSource, /(?:from|import\()\s*['"][^'"]*(?:\/db\/|migrat|PlanOccurrenceRepository)/i);
});
