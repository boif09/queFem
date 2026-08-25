import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ImpactCatalogClient } from '../backend/src/fever/impactClient.js';
import {
  analyzeFeverDiscovery, isGiftCard, isValidAffiliateUrl, parseManufacturer, parsePattern,
} from '../backend/src/fever/discoveryPolicy.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/fever-items.json', import.meta.url), 'utf8'));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('Impact client sends the expected discovery query and follows only @nextpageuri', async () => {
  const calls = [];
  const client = new ImpactCatalogClient({
    accountSid: 'test-account', authToken: 'test-token', backoffMs: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      if (calls.length === 1) return jsonResponse({ Items: fixture.slice(0, 2), '@nextpageuri': '/next?AfterId=2' });
      return jsonResponse({ Items: fixture.slice(2) });
    },
  });
  const result = await client.discoverSpain();
  assert.equal(result.pages, 2);
  assert.equal(result.items.length, fixture.length);
  const first = new URL(calls[0].url);
  assert.equal(first.origin, 'https://api.impact.com');
  assert.equal(first.pathname, '/Mediapartners/test-account/Catalogs/ItemSearch');
  assert.equal(first.searchParams.get('Query'), "Text1='Spain'");
  assert.equal(first.searchParams.get('PageSize'), '200');
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[1].url, 'https://api.impact.com/next?AfterId=2');
});

test('Impact client rejects unsafe pagination, cycles and defensive limit overruns', async () => {
  const unsafe = new ImpactCatalogClient({ accountSid: 'a', authToken: 'b', fetchImpl: async () => jsonResponse({ Items: [], '@nextpageuri': 'https://evil.test/next' }) });
  await assert.rejects(unsafe.discoverSpain(), /no permesa/);

  const cycle = new ImpactCatalogClient({
    accountSid: 'a', authToken: 'b',
    fetchImpl: async () => jsonResponse({ Items: [], '@nextpageuri': 'https://api.impact.com/Mediapartners/a/Catalogs/ItemSearch?Query=Text1%3D%27Spain%27&PageSize=200' }),
  });
  await assert.rejects(cycle.discoverSpain(), /cicle/);

  const limited = new ImpactCatalogClient({ accountSid: 'a', authToken: 'b', maximumItems: 1, fetchImpl: async () => jsonResponse({ Items: [{}, {}] }) });
  await assert.rejects(limited.discoverSpain(), /items/);
});

test('Impact client retries 429 and transient 5xx but not authentication failures', async () => {
  let attempts = 0;
  const retrying = new ImpactCatalogClient({
    accountSid: 'a', authToken: 'b', backoffMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? jsonResponse({}, attempts === 1 ? 429 : 503) : jsonResponse({ Items: [] });
    },
  });
  await retrying.discoverSpain();
  assert.equal(attempts, 3);

  attempts = 0;
  const unauthorized = new ImpactCatalogClient({
    accountSid: 'a', authToken: 'b', backoffMs: 0,
    fetchImpl: async () => { attempts += 1; return jsonResponse({}, 401); },
  });
  await assert.rejects(unauthorized.discoverSpain(), /HTTP 401/);
  assert.equal(attempts, 1);
});

test('Impact client errors never expose credentials', async () => {
  const accountSid = 'secret-account';
  const authToken = 'secret-token';
  const client = new ImpactCatalogClient({
    accountSid, authToken, backoffMs: 0,
    fetchImpl: async () => { throw new TypeError(`network unavailable for ${accountSid}:${authToken}`); },
  });
  const error = await client.discoverSpain().catch((caught) => caught);
  assert.equal(error.message.includes(accountSid), false);
  assert.equal(error.message.includes(authToken), false);
});

test('Fever policy recognizes gifts, coordinates, affiliate URLs and sessions conservatively', () => {
  assert.equal(isGiftCard({ Name: 'Tarjeta regalo' }), true);
  assert.equal(isGiftCard({ SubCategory: 'Gift Cards' }), true);
  assert.equal(isGiftCard({ Name: 'Concert' }), false);
  assert.deepEqual(parsePattern('(41.4779657; 2.0462265)'), { latitude: 41.4779657, longitude: 2.0462265 });
  assert.equal(parsePattern('(999; 2)'), null);
  assert.equal(isValidAffiliateUrl('https://fever.pxf.io/path'), true);
  assert.equal(isValidAffiliateUrl('http://fever.pxf.io/path'), false);
  assert.deepEqual(parseManufacturer('2026-08-26T18:00:00+02:00, invalid'), {
    count: 2, dates: ['2026-08-26'], invalid: 1,
  });
});

test('Fever discovery analysis applies catalog, campaign, Catalunya and horizon policy without using Text2', () => {
  const items = fixture.map((item) => ({ ...item, Text2: 'Barcelona' }));
  const summary = analyzeFeverDiscovery({ pages: 2, items }, {
    lookaheadDays: 365, now: new Date('2026-08-25T10:00:00.000Z'),
  });
  assert.equal(summary.spainItems, 5);
  assert.equal(summary.matchingCatalogCampaign, 4);
  assert.equal(summary.cataloniaItems, 3);
  assert.equal(summary.expired, 1);
  assert.equal(summary.activeFuture, 2);
  assert.equal(summary.giftCards, 1);
  assert.equal(summary.activeNonGiftCandidates, 1);
  assert.equal(summary.candidatesWithFutureSessionInHorizon, 1);
  assert.equal(summary.withImage, 1);
  assert.equal(summary.validCoordinates, 2);
  assert.deepEqual(summary.tiers, { tier1: 1, tier2: 0, tier3: 1, tier4: 1, other: 0 });
  assert.equal(summary.validAffiliateUrls, 2);
  assert.equal(summary.invalidSessions, 1);
  assert.equal(summary.firstObservedSession, '2024-01-01');
  assert.equal(summary.lastObservedSession, '2026-09-01');
});
