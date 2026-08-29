import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadFallbackImageLibrary } from '../backend/src/images/fallbackImageLibrary.js';
import { PexelsFallbackAcquirer, validateFetchManifest } from '../backend/src/images/pexelsFallbackAcquisition.js';

const API_KEY = 'test-key-must-never-appear-in-errors';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0xff, 0xd9]);

function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tenspla-pexels-'));
}

function item(overrides = {}) {
  return { id: 'festes-01', pexels_photo_id: 17791237, source_page: 'https://www.pexels.com/photo/colorful-flags-decorating-building-entrance-17791237/', ...overrides };
}

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

function successfulFetch(requests) {
  return async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith('https://api.pexels.com/')) {
      const id = Number(String(url).split('/').at(-1));
      return response(JSON.stringify({
        id, url: `https://www.pexels.com/photo/selected-photo-${id}/`, photographer: 'Test Photographer',
        photographer_url: 'https://www.pexels.com/@test-photographer',
        src: { original: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg` },
      }), { headers: { 'content-type': 'application/json' } });
    }
    return response(JPEG, { headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length) } });
  };
}

async function withAcquirer(callback, options = {}) {
  const directory = await temporaryDirectory();
  try {
    return await callback(directory, new PexelsFallbackAcquirer({ apiKey: API_KEY, outputDirectory: directory, retryAttempts: 1, delayMs: 0, ...options }));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('requests the exact curated photo ID, downloads atomically and records API provenance', async () => {
  await withAcquirer(async (directory, acquirer) => {
    const requests = [];
    acquirer.fetchImpl = successfulFetch(requests);
    const result = await acquirer.acquireOne(item());
    assert.equal(result.status, 'downloaded');
    assert.match(requests[0].url, /\/v1\/photos\/17791237$/);
    assert.equal(requests[0].options.headers.Authorization, API_KEY);
    assert.equal(await fs.readFile(result.filename).then((data) => data.equals(JPEG)), true);
    assert.equal(result.provenance.photographer, 'Test Photographer');
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.part')), false);
  });
});

test('requires an API key and never includes it in failures', async () => {
  assert.throws(() => new PexelsFallbackAcquirer({ apiKey: '' }), /PEXELS_API_KEY/);
  const acquirer = new PexelsFallbackAcquirer({ apiKey: API_KEY, fetchImpl: async () => { throw new Error(API_KEY); }, retryAttempts: 1 });
  await assert.rejects(acquirer.request('https://api.pexels.com/v1/photos/1', { kind: 'metadata' }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    return true;
  });
});

test('rejects mismatched IDs, missing/auth/rate-limited API responses and never substitutes a photo', async () => {
  await withAcquirer(async (directory, acquirer) => {
    acquirer.fetchImpl = async () => response(JSON.stringify({ id: 1, photographer: 'Other', photographer_url: 'https://www.pexels.com/@other', url: 'https://www.pexels.com/photo/other-1/', src: { original: 'https://images.pexels.com/photos/1/other.jpeg' } }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(acquirer.acquireOne(item()), /no correspon/);
    assert.equal((await fs.readdir(directory)).length, 0);

    for (const status of [404, 401, 429]) {
      acquirer.fetchImpl = async () => response('', { status });
      await assert.rejects(acquirer.acquireOne(item()), status === 404 ? /no ha trobat/ : status === 429 ? /límit/ : /autenticació/);
    }
  });
});

test('rejects non-images and partial downloads without accepting a temporary file', async () => {
  await withAcquirer(async (directory, acquirer) => {
    const requests = [];
    acquirer.fetchImpl = async (url, options) => {
      if (String(url).startsWith('https://api.pexels.com/')) return successfulFetch(requests)(url, options);
      return response(Buffer.from('not an image'), { headers: { 'content-type': 'text/html', 'content-length': '12' } });
    };
    await assert.rejects(acquirer.acquireOne(item()), /no és una resposta d’imatge/);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.part')), false);

    acquirer.fetchImpl = async (url, options) => {
      if (String(url).startsWith('https://api.pexels.com/')) return successfulFetch(requests)(url, options);
      return response(JPEG, { headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length + 1) } });
    };
    await assert.rejects(acquirer.acquireOne(item()), /parcial/);
    assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.part')), false);
  });
});

test('keeps a valid existing original without contacting Pexels again', async () => {
  await withAcquirer(async (directory, acquirer) => {
    await fs.writeFile(path.join(directory, 'festes-01.jpg'), JPEG);
    let calls = 0;
    acquirer.fetchImpl = async () => { calls += 1; throw new Error('must not fetch'); };
    const result = await acquirer.acquireOne(item());
    assert.equal(result.status, 'skipped');
    assert.equal(calls, 0);
  });
});

test('accounts for the exact 100 unique manifest IDs before any fetch', () => {
  const items = loadFallbackImageLibrary({ assetExists: () => true }).items;
  assert.equal(validateFetchManifest(items).length, 100);
  assert.throws(() => validateFetchManifest([...items.slice(0, 99), { ...items[0], id: 'duplicate' }]), /IDs interns|100 imatges/);
  assert.throws(() => validateFetchManifest(items.map((entry, index) => index === 1 ? { ...entry, pexels_photo_id: items[0].pexels_photo_id } : entry)), /Pexels Photo IDs/);
});

test('acquires and records all 100 curated originals without using a search endpoint', async () => {
  await withAcquirer(async (directory, acquirer) => {
    const requests = [];
    acquirer.fetchImpl = successfulFetch(requests);
    const items = loadFallbackImageLibrary({ assetExists: () => true }).items;
    const result = await acquirer.acquireAll(items);
    assert.deepEqual(result, { total: 100, downloaded: 100, skipped: 0, outputDirectory: directory });
    assert.equal(requests.length, 200);
    assert.equal(requests.every(({ url }) => !url.includes('/search') && !url.includes('/curated')), true);
    const provenance = JSON.parse(await fs.readFile(path.join(directory, 'pexels-api-provenance.json'), 'utf8'));
    assert.equal(Object.keys(provenance.photos).length, 100);
  }, { delayMs: 0 });
});
