import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ICGC_PROVIDER = 'Institut Cartogràfic i Geològic de Catalunya (ICGC)';
export const ICGC_DATASET = 'Divisions administratives';
export const ICGC_LAYER = 'divisions_administratives_municipis_5000';
export const ICGC_DATASET_DATE = '2026-01-20';
export const ICGC_SOURCE_CRS = 'EPSG:25831';
export const ICGC_SNAPSHOT_CRS = 'EPSG:4326';
export const ICGC_LICENSE = 'CC BY 4.0';
export const ICGC_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const ICGC_SERVICE_PAGE = 'https://www.icgc.cat/ca/Geoinformacio-i-mapes/Geoinformacio-en-linia-Geoserveis/WMS-i-WFS-Limits-administratius/WMS-i-WFS-Divisions-administratives';
export const ICGC_WFS_URL = `https://geoserveis.icgc.cat/servei/catalunya/divisions-administratives/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=divisions_administratives_wfs%3A${ICGC_LAYER}&outputFormat=GEOJSON&srsName=EPSG%3A4326`;

const REQUIRED_PROPERTIES = ['CODIMUNI', 'NOMMUNI', 'CODICOMAR', 'NOMCOMAR', 'CODIPROV', 'NOMPROV'];
const MAXIMUM_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const COORDINATE_PRECISION = 6;
const CATALONIA_ENVELOPE = [-1, 39, 5, 44];
const MINIMUM_LONGITUDE_SPAN = 1.5;
const MINIMUM_LATITUDE_SPAN = 1.5;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredText(value, field) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`ICGC feature missing ${field}`);
  const result = String(value).trim();
  if (!result) throw new Error(`ICGC feature missing ${field}`);
  return result;
}

function normalizedPosition(value) {
  if (!Array.isArray(value) || value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new Error('ICGC geometry has invalid coordinates');
  }
  const longitude = Number(value[0].toFixed(COORDINATE_PRECISION));
  const latitude = Number(value[1].toFixed(COORDINATE_PRECISION));
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error('ICGC geometry is outside EPSG:4326 ranges');
  }
  return [longitude, latitude];
}

function samePosition(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function ringSignedDoubleArea(ring) {
  const scale = 10 ** COORDINATE_PRECISION;
  const originX = Math.round(ring[0][0] * scale);
  const originY = Math.round(ring[0][1] * scale);
  let area = 0;
  for (let index = 1; index < ring.length - 1; index += 1) {
    const leftX = Math.round(ring[index][0] * scale);
    const leftY = Math.round(ring[index][1] * scale);
    const rightX = Math.round(ring[index + 1][0] * scale);
    const rightY = Math.round(ring[index + 1][1] * scale);
    area += (leftX - originX) * (rightY - originY)
      - (rightX - originX) * (leftY - originY);
  }
  return area;
}

function validateRingArea(ring) {
  if (Math.abs(ringSignedDoubleArea(ring)) === 0) {
    throw new Error('ICGC linear ring has zero area after rounding');
  }
}

function normalizeRing(value) {
  if (!Array.isArray(value) || value.length < 4) throw new Error('ICGC linear ring requires at least four positions');
  const ring = value.map(normalizedPosition);
  if (!samePosition(ring[0], ring.at(-1))) throw new Error('ICGC linear ring is not closed');
  const distinct = new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`));
  if (distinct.size < 3) throw new Error('ICGC linear ring is degenerate after rounding');
  validateRingArea(ring);
  return ring;
}

function normalizePolygon(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ICGC Polygon has no rings');
  return value.map(normalizeRing);
}

function normalizeGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('ICGC feature has an unsupported geometry');
  }
  if (geometry.type === 'Polygon') {
    return { type: geometry.type, coordinates: normalizePolygon(geometry.coordinates) };
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new Error('ICGC MultiPolygon has no polygons');
  }
  return { type: geometry.type, coordinates: geometry.coordinates.map(normalizePolygon) };
}

function validateStoredRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw new Error('ICGC linear ring requires at least four positions');
  for (const position of ring) {
    const normalized = normalizedPosition(position);
    if (!samePosition(normalized, position)) throw new Error('ICGC snapshot coordinates exceed canonical precision');
  }
  if (!samePosition(ring[0], ring.at(-1))) throw new Error('ICGC linear ring is not closed');
  if (new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`)).size < 3) {
    throw new Error('ICGC linear ring is degenerate after rounding');
  }
  validateRingArea(ring);
}

function validateStoredGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new Error('ICGC snapshot feature has an unsupported geometry');
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) throw new Error('ICGC snapshot geometry is empty');
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) throw new Error('ICGC Polygon has no rings');
    for (const ring of polygon) validateStoredRing(ring);
  }
}

function geometryBbox(coordinates) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value) {
    if (typeof value[0] === 'number') {
      bbox[0] = Math.min(bbox[0], value[0]);
      bbox[1] = Math.min(bbox[1], value[1]);
      bbox[2] = Math.max(bbox[2], value[0]);
      bbox[3] = Math.max(bbox[3], value[1]);
      return;
    }
    for (const nested of value) visit(nested);
  }
  visit(coordinates);
  return bbox;
}

function mergeBbox(target, source) {
  target[0] = Math.min(target[0], source[0]);
  target[1] = Math.min(target[1], source[1]);
  target[2] = Math.max(target[2], source[2]);
  target[3] = Math.max(target[3], source[3]);
}

function declaredCrs(payload) {
  return payload?.crs?.properties?.name || payload?.crs?.name || null;
}

function validateDeclaredCrs(payload) {
  const value = declaredCrs(payload);
  if (!value) return;
  if (!/(?:EPSG(?::|::|\/0\/)?|CRS:?)(?:4326|84)$/i.test(String(value).replace(/\s+/g, ''))) {
    throw new Error(`ICGC response declares an incompatible CRS: ${String(value).slice(0, 80)}`);
  }
}

function validateCataloniaBbox(bbox) {
  if (bbox[0] < CATALONIA_ENVELOPE[0] || bbox[1] < CATALONIA_ENVELOPE[1]
    || bbox[2] > CATALONIA_ENVELOPE[2] || bbox[3] > CATALONIA_ENVELOPE[3]) {
    throw new Error('ICGC dataset is outside the plausible Catalonia envelope');
  }
  if (bbox[2] - bbox[0] < MINIMUM_LONGITUDE_SPAN || bbox[3] - bbox[1] < MINIMUM_LATITUDE_SPAN) {
    throw new Error('ICGC dataset global bbox is territorially implausible');
  }
}

export function normalizeIcgcFeatureCollection(payload, {
  minimumFeatures = 900, validateTerritory = true,
} = {}) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('ICGC payload is not a GeoJSON FeatureCollection');
  }
  if (payload.features.length < minimumFeatures) {
    throw new Error(`ICGC FeatureCollection is incomplete: ${payload.features.length} features`);
  }
  validateDeclaredCrs(payload);

  const seenCodes = new Set();
  const comarcaNames = new Map();
  const provinceNames = new Map();
  const globalBbox = [Infinity, Infinity, -Infinity, -Infinity];
  const features = payload.features.map((feature) => {
    if (!feature || feature.type !== 'Feature') throw new Error('ICGC payload contains a non-Feature');
    const properties = Object.fromEntries(REQUIRED_PROPERTIES.map((field) => [
      field, requiredText(feature.properties?.[field], field),
    ]));
    if (seenCodes.has(properties.CODIMUNI)) throw new Error(`Duplicate ICGC municipality code: ${properties.CODIMUNI}`);
    seenCodes.add(properties.CODIMUNI);
    for (const [code, name, names, label] of [
      [properties.CODICOMAR, properties.NOMCOMAR, comarcaNames, 'comarca'],
      [properties.CODIPROV, properties.NOMPROV, provinceNames, 'province'],
    ]) {
      if (names.has(code) && names.get(code) !== name) throw new Error(`Inconsistent ICGC ${label} code: ${code}`);
      names.set(code, name);
    }
    const geometry = normalizeGeometry(feature.geometry);
    const bbox = geometryBbox(geometry.coordinates);
    mergeBbox(globalBbox, bbox);
    return { type: 'Feature', bbox, properties, geometry };
  }).sort((left, right) => left.properties.CODIMUNI.localeCompare(right.properties.CODIMUNI));

  if (validateTerritory) validateCataloniaBbox(globalBbox);
  return { type: 'FeatureCollection', bbox: globalBbox, features };
}

function validateStoredFeatureCollection(snapshot) {
  if (!snapshot || snapshot.type !== 'FeatureCollection' || !Array.isArray(snapshot.features)
    || snapshot.features.length === 0) throw new Error('ICGC snapshot is empty or invalid');
  const codes = new Set();
  const globalBbox = [Infinity, Infinity, -Infinity, -Infinity];
  let previousCode = null;
  for (const feature of snapshot.features) {
    if (!feature || feature.type !== 'Feature') throw new Error('ICGC snapshot contains a non-Feature');
    const code = requiredText(feature.properties?.CODIMUNI, 'CODIMUNI');
    for (const field of REQUIRED_PROPERTIES) requiredText(feature.properties?.[field], field);
    if (codes.has(code)) throw new Error(`Duplicate ICGC municipality code: ${code}`);
    if (previousCode !== null && previousCode.localeCompare(code) > 0) throw new Error('ICGC snapshot is not sorted by CODIMUNI');
    codes.add(code);
    previousCode = code;
    validateStoredGeometry(feature.geometry);
    const bbox = geometryBbox(feature.geometry.coordinates);
    if (!Array.isArray(feature.bbox) || feature.bbox.length !== 4
      || bbox.some((value, index) => value !== feature.bbox[index])) {
      throw new Error('ICGC snapshot feature bbox mismatch');
    }
    mergeBbox(globalBbox, bbox);
  }
  if (!Array.isArray(snapshot.bbox) || snapshot.bbox.length !== 4
    || globalBbox.some((value, index) => value !== snapshot.bbox[index])) {
    throw new Error('ICGC snapshot global bbox mismatch');
  }
  validateCataloniaBbox(globalBbox);
}

export function validateIcgcUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'geoserveis.icgc.cat'
    || url.username !== '' || url.password !== '') {
    throw new Error('ICGC URL must use credential-free HTTPS on geoserveis.icgc.cat');
  }
  return url;
}

async function downloadJson(sourceUrl, {
  fetchImpl = fetch, timeoutMs = 60_000, maximumBytes = MAXIMUM_DOWNLOAD_BYTES, maximumRedirects = 3,
} = {}) {
  let url = validateIcgcUrl(sourceUrl);
  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 300 && response.status < 400) {
      if (redirects === maximumRedirects) throw new Error('ICGC redirect limit exceeded');
      const location = response.headers.get('location');
      if (!location) throw new Error('ICGC redirect without Location');
      url = validateIcgcUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) throw new Error(`ICGC download failed with HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/json/i.test(contentType)) throw new Error('ICGC response is not GeoJSON');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('ICGC response is too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('ICGC response has no body');
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('ICGC response exceeded maximum size');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('ICGC response contains invalid JSON'); }
  }
  throw new Error('ICGC download failed');
}

function metadataFor(snapshotText, featureCount, retrievalDate) {
  return {
    provider: ICGC_PROVIDER,
    dataset: ICGC_DATASET,
    layer: ICGC_LAYER,
    datasetDate: ICGC_DATASET_DATE,
    retrievalDate,
    sourceCrs: ICGC_SOURCE_CRS,
    snapshotCrs: ICGC_SNAPSHOT_CRS,
    coordinateOrder: '[longitude, latitude]',
    coordinatePrecisionDecimals: COORDINATE_PRECISION,
    license: ICGC_LICENSE,
    licenseUrl: ICGC_LICENSE_URL,
    attribution: ICGC_PROVIDER,
    modifications: [
      'Requested official WFS transformation to EPSG:4326',
      'Selected CODIMUNI/NOMMUNI/CODICOMAR/NOMCOMAR/CODIPROV/NOMPROV',
      'Sorted features deterministically by CODIMUNI',
      'Added per-feature and collection bounding boxes',
      'Rounded coordinates to 6 decimal places',
    ],
    sourceUrl: ICGC_WFS_URL,
    servicePage: ICGC_SERVICE_PAGE,
    featureCount,
    snapshotSha256: sha256(snapshotText),
  };
}

function administrativeChanges(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot) return {
    changed: false, previousCount: null, nextCount: nextSnapshot.features.length, added: [], removed: [],
  };
  const previous = new Set(previousSnapshot.features.map(({ properties }) => properties.CODIMUNI));
  const next = new Set(nextSnapshot.features.map(({ properties }) => properties.CODIMUNI));
  const added = [...next].filter((code) => !previous.has(code)).sort();
  const removed = [...previous].filter((code) => !next.has(code)).sort();
  return {
    changed: added.length > 0 || removed.length > 0,
    previousCount: previous.size,
    nextCount: next.size,
    added,
    removed,
  };
}

function safeManifestFilename(value, suffix) {
  if (typeof value !== 'string' || path.basename(value) !== value || !value.endsWith(suffix)) {
    throw new Error('ICGC manifest contains an unsafe filename');
  }
  return value;
}

async function readPublishedVersion(manifestPath) {
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported ICGC manifest version');
  const directory = path.dirname(manifestPath);
  const snapshotFile = safeManifestFilename(manifest.snapshotFile, '.geojson');
  const metadataFile = safeManifestFilename(manifest.metadataFile, '.metadata.json');
  const [snapshotText, metadataText] = await Promise.all([
    readFile(path.join(directory, snapshotFile), 'utf8'),
    readFile(path.join(directory, metadataFile), 'utf8'),
  ]);
  if (sha256(snapshotText) !== manifest.snapshotSha256) throw new Error('ICGC manifest snapshot checksum mismatch');
  if (sha256(metadataText) !== manifest.metadataSha256) throw new Error('ICGC manifest metadata checksum mismatch');
  const metadata = JSON.parse(metadataText);
  if (metadata.snapshotSha256 !== manifest.snapshotSha256) throw new Error('ICGC metadata references a different snapshot');
  const snapshot = JSON.parse(snapshotText);
  validateStoredFeatureCollection(snapshot);
  if (snapshot.features.length !== metadata.featureCount) throw new Error('ICGC snapshot feature count mismatch');
  return {
    manifest, snapshot, metadata, snapshotText, metadataText,
    snapshotBytes: Buffer.byteLength(snapshotText),
  };
}

async function writeImmutable(filename, content, { beforePublish = async () => {} } = {}) {
  try {
    const existing = await readFile(filename, 'utf8');
    if (existing !== content) throw new Error(`Existing immutable ICGC artifact is inconsistent: ${path.basename(filename)}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const temporary = `${filename}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await beforePublish();
    await rename(temporary, filename);
    if (await readFile(filename, 'utf8') !== content) {
      throw new Error(`Published immutable ICGC artifact is inconsistent: ${path.basename(filename)}`);
    }
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

export async function updateIcgcSnapshot({
  sourceUrl = ICGC_WFS_URL,
  manifestPath,
  fetchImpl,
  now = new Date(),
  minimumFeatures = 900,
  allowAdministrativeChange = false,
  onStage = async () => {},
  maximumBytes = MAXIMUM_DOWNLOAD_BYTES,
} = {}) {
  if (!manifestPath) throw new Error('Manifest path is required');
  let previous = null;
  try { previous = await readPublishedVersion(manifestPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const payload = await downloadJson(sourceUrl, { fetchImpl, maximumBytes });
  const snapshot = normalizeIcgcFeatureCollection(payload, { minimumFeatures });
  const changes = administrativeChanges(previous?.snapshot, snapshot);
  if (changes.changed && !allowAdministrativeChange) {
    throw new Error(`ICGC administrative code set changed: +${changes.added.length} -${changes.removed.length}; use --allow-administrative-change after review`);
  }

  const snapshotText = `${JSON.stringify(snapshot)}\n`;
  const metadata = metadataFor(snapshotText, snapshot.features.length, now.toISOString().slice(0, 10));
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  const snapshotHash = metadata.snapshotSha256;
  const metadataHash = sha256(metadataText);
  const snapshotFile = `icgc-municipis-5000.${snapshotHash.slice(0, 16)}.geojson`;
  const metadataFile = `icgc-municipis-5000.${metadataHash.slice(0, 16)}.metadata.json`;
  const manifest = {
    schemaVersion: 1,
    snapshotFile,
    metadataFile,
    snapshotSha256: snapshotHash,
    metadataSha256: metadataHash,
    publishedAt: now.toISOString(),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const directory = path.dirname(manifestPath);
  await mkdir(directory, { recursive: true });
  await writeImmutable(path.join(directory, snapshotFile), snapshotText, {
    beforePublish: () => onStage('beforeSnapshotPublish'),
  });
  await onStage('afterSnapshotWrite');
  await onStage('beforeMetadataWrite');
  await writeImmutable(path.join(directory, metadataFile), metadataText, {
    beforePublish: () => onStage('beforeMetadataPublish'),
  });
  await onStage('afterMetadataWrite');
  const temporaryManifest = `${manifestPath}.${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporaryManifest, manifestText, { encoding: 'utf8', flag: 'wx' });
    await onStage('beforeManifestPublish');
    await rename(temporaryManifest, manifestPath);
  } catch (error) {
    await rm(temporaryManifest, { force: true });
    throw error;
  }
  return { snapshot, metadata, manifest, changes, snapshotBytes: Buffer.byteLength(snapshotText) };
}

export async function readAndVerifyIcgcSnapshot(manifestPath) {
  return readPublishedVersion(manifestPath);
}
