import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  extractFallbackDamPath,
  GencatImageMetadataResolver,
  GencatRequestScheduler,
  parseGencatImageMetadata,
} from '../backend/src/gencat/imageMetadataResolver.js';
import { validateGencatImageUrl } from '../backend/src/ticketmaster/imageProxy.js';

const FIXTURE_DIR = new URL('./fixtures/gencat/', import.meta.url);
const TARGET = '/content/dam/agenda/ca/activitats/2026/cartell.jpg';
const fixture = (name) => fs.readFileSync(new URL(name, FIXTURE_DIR), 'utf8');
const htmlResponse = (body, init = {}) => new Response(body, {
  status: init.status || 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers },
});
const resolver = (fetchImpl, options = {}) => new GencatImageMetadataResolver({
  fetchImpl, intervalMs: 0, ...options,
});

test('resolves one exact image with normalized non-empty plain-text attribution', () => {
  assert.deepEqual(parseGencatImageMetadata(fixture('single-credit.html'), TARGET), {
    imagePath: TARGET, attribution: 'Font: Entitat & autora', attributionKnown: true,
  });
});

test('treats one existing whitespace-only footer as known empty', () => {
  assert.deepEqual(parseGencatImageMetadata(fixture('single-empty.html'), TARGET), {
    imagePath: TARGET, attribution: null, attributionKnown: true,
  });
});

test('correlates multiple images by exact fallback path, not array position', () => {
  const html = fixture('multiple.html');
  assert.equal(parseGencatImageMetadata(html, '/content/dam/agenda/ca/activitats/2026/segona.jpg').attribution, 'Font: Segona');
  assert.deepEqual(parseGencatImageMetadata(html, '/content/dam/agenda/ca/activitats/2026/tercera.jpg'), {
    imagePath: '/content/dam/agenda/ca/activitats/2026/tercera.jpg', attribution: null, attributionKnown: true,
  });
});

test('requires an exact Socrata path match', () => {
  assert.equal(parseGencatImageMetadata(fixture('multiple.html'), `${TARGET}?variant=1`).attributionKnown, false);
  assert.equal(parseGencatImageMetadata(fixture('multiple.html'), '/content/dam/agenda/ca/activitats/2026/absent.jpg').attributionKnown, false);
});

test('fails closed for duplicate target slides', () => {
  const duplicate = fixture('single-credit.html').replace('</div>\n  </div>', `</div></div><div class="carousel-item"><img onerror="this.src='${TARGET}'"><div class="image-footertext"><p class="slider-footer">Other</p></div></div>`);
  assert.equal(parseGencatImageMetadata(duplicate, TARGET).attributionKnown, false);
});

test('fails closed for missing or duplicate footer', () => {
  const source = fixture('single-credit.html');
  assert.equal(parseGencatImageMetadata(source.replace('slider-footer', 'other-footer'), TARGET).attributionKnown, false);
  assert.equal(parseGencatImageMetadata(source.replace('</div>\n    </div>', '<p class="slider-footer">Second</p></div></div>'), TARGET).attributionKnown, false);
});

test('fails closed for malformed carousel structure', () => {
  assert.equal(parseGencatImageMetadata('<html><body><img onerror="this.src=\'/content/dam/agenda/x.jpg\'">', '/content/dam/agenda/x.jpg').attributionKnown, false);
});

test('isolates and bounds fallback attribute extraction', () => {
  assert.equal(extractFallbackDamPath(`this.onerror=null; this.src='${TARGET}';`), TARGET);
  assert.equal(extractFallbackDamPath(`this.src='${TARGET}';this.src='/content/dam/agenda/other.jpg'`), null);
  assert.equal(extractFallbackDamPath(`this.src='https://evil.example/x.jpg'`), null);
  assert.equal(extractFallbackDamPath(`this.src='${'/content/dam/agenda/' + 'a'.repeat(5000)}'`), null);
});

test('uses only text content and decodes entities without preserving markup', () => {
  const html = fixture('single-credit.html').replace('Font:  Entitat &amp; autora', '<strong>Font:</strong> Entitat &amp; &lt;autora&gt;');
  assert.equal(parseGencatImageMetadata(html, TARGET).attribution, 'Font: Entitat & <autora>');
});

test('fails closed for an unreasonably large footer', () => {
  const html = fixture('single-credit.html').replace('Font:  Entitat &amp; autora', 'x'.repeat(2001));
  assert.equal(parseGencatImageMetadata(html, TARGET).attributionKnown, false);
});

test('rejects an invalid codi without making a request', async () => {
  let requests = 0;
  const result = await resolver(async () => { requests += 1; return htmlResponse(''); }).resolve({ codi: '20/26', imagePath: TARGET });
  assert.equal(result.attributionKnown, false);
  assert.equal(requests, 0);
  const tooLong = await resolver(async () => { requests += 1; return htmlResponse(''); })
    .resolve({ codi: '1'.repeat(33), imagePath: TARGET });
  assert.equal(tooLong.attributionKnown, false);
  assert.equal(requests, 0);
});

test('accepts at most one expected same-host canonical redirect', async () => {
  const urls = [];
  const result = await resolver(async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return htmlResponse('', { status: 301, headers: { location: '/ca/activitat.html/2026091400006/nit-dels-bertrana' } });
    return htmlResponse(fixture('single-credit.html'));
  }).resolve({ codi: '2026091400006', imagePath: TARGET });
  assert.equal(result.attributionKnown, true);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /^https:\/\/agenda\.cultura\.gencat\.cat\/ca\/activitat\.html\/2026091400006\//);
});

test('rejects cross-host, noncanonical, and repeated redirects', async () => {
  for (const location of ['https://evil.example/page', '/ca/other/2026091400006']) {
    const result = await resolver(async () => htmlResponse('', { status: 302, headers: { location } }))
      .resolve({ codi: '2026091400006', imagePath: TARGET });
    assert.equal(result.attributionKnown, false);
  }
  let calls = 0;
  const repeated = await resolver(async () => {
    calls += 1;
    return htmlResponse('', { status: 301, headers: { location: '/ca/activitat.html/2026091400006/slug' } });
  }).resolve({ codi: '2026091400006', imagePath: TARGET });
  assert.equal(repeated.attributionKnown, false);
  assert.equal(calls, 2);
});

test('rejects wrong content type and HTTP errors', async () => {
  const wrongType = await resolver(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))
    .resolve({ codi: '2026091400006', imagePath: TARGET });
  const error = await resolver(async () => htmlResponse('', { status: 503 }))
    .resolve({ codi: '2026091400006', imagePath: TARGET });
  assert.equal(wrongType.attributionKnown, false);
  assert.equal(error.attributionKnown, false);
});

test('fails closed on timeout or fetch failure', async () => {
  const timedOut = await resolver((input, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }), { timeoutMs: 5 }).resolve({ codi: '2026091400006', imagePath: TARGET });
  const failed = await resolver(async () => { throw new Error('offline'); })
    .resolve({ codi: '2026091400006', imagePath: TARGET });
  assert.equal(timedOut.attributionKnown, false);
  assert.equal(failed.attributionKnown, false);
});

test('rejects oversized HTML from declared and streamed lengths', async () => {
  const declared = await resolver(async () => htmlResponse('short', { headers: { 'content-length': '100' } }), { maximumBytes: 10 })
    .resolve({ codi: '2026091400006', imagePath: TARGET });
  const streamed = await resolver(async () => htmlResponse('x'.repeat(20)), { maximumBytes: 10 })
    .resolve({ codi: '2026091400006', imagePath: TARGET });
  assert.equal(declared.attributionKnown, false);
  assert.equal(streamed.attributionKnown, false);
});

test('bounds concurrent page requests', async () => {
  const releases = [];
  let active = 0;
  let maximumActive = 0;
  const metadataResolver = resolver(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return htmlResponse(fixture('single-credit.html'));
  }, { concurrency: 2 });
  const pending = ['2026091400001', '2026091400002', '2026091400003']
    .map((codi) => metadataResolver.resolve({ codi, imagePath: TARGET }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximumActive, 2);
  assert.equal(releases.length, 2);
  releases.splice(0).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.pop()();
  assert.ok((await Promise.all(pending)).every(({ attributionKnown }) => attributionKnown));
});

test('media delivery accepts only the exact HTTPS Gencat DAM origin', () => {
  const valid = 'https://agenda.cultura.gencat.cat/content/dam/agenda/ca/image.jpg';
  assert.equal(validateGencatImageUrl(valid).toString(), valid);
  for (const candidate of [
    'http://agenda.cultura.gencat.cat/content/dam/agenda/ca/image.jpg',
    'https://evil.example/content/dam/agenda/ca/image.jpg',
    'https://agenda.cultura.gencat.cat.evil.example/content/dam/agenda/ca/image.jpg',
    'https://agenda.cultura.gencat.cat/other/image.jpg',
    'https://agenda.cultura.gencat.cat/content/dam/agenda/image.jpg?download=1',
  ]) assert.throws(() => validateGencatImageUrl(candidate), { code: 'MEDIA_NOT_AVAILABLE' });
});

test('reserves conservatively spaced request starts even when operations finish immediately', async () => {
  let clock = 1_000;
  const waits = [];
  const starts = [];
  const scheduler = new GencatRequestScheduler({
    concurrency: 2,
    intervalMs: 500,
    now: () => clock,
    sleep: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
  });
  await Promise.all([1, 2, 3].map(() => scheduler.run(async () => { starts.push(clock); })));
  assert.deepEqual(starts, [1_000, 1_500, 2_000]);
  assert.deepEqual(waits, [500, 500]);
});
