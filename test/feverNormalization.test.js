import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanFeverDescription } from '../backend/src/fever/descriptionCleaner.js';
import { normalizeFeverItem, isEligibleFeverProduct } from '../backend/src/fever/itemNormalizer.js';
import {
  FEVER_TIMEZONE, parseFeverManufacturer, parseFeverSessionToken,
} from '../backend/src/fever/manufacturerParser.js';
import { analyzeFeverNormalization } from '../backend/src/fever/normalizationAnalysis.js';
import { dryRunFeverNormalization } from '../backend/src/jobs/dryRunFeverNormalization.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/fever-normalization-items.json', import.meta.url), 'utf8',
));

test('parses the only observed Manufacturer format as floating Europe/Madrid local time', () => {
  const parsed = parseFeverSessionToken(' 2026-08-28 08:30 ');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.format, 'local-minute');
  assert.deepEqual(parsed.occurrence, {
    occurrenceKey: parsed.occurrence.occurrenceKey,
    startsAt: null,
    endsAt: null,
    localDate: '2026-08-28',
    localTime: '08:30',
    timezone: FEVER_TIMEZONE,
  });
  assert.match(parsed.occurrence.occurrenceKey, /^fever-session:[a-f0-9]{24}$/);
});

test('supports date-only contract without inventing midnight', () => {
  const parsed = parseFeverSessionToken('2026-08-26');
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.occurrence, {
    occurrenceKey: parsed.occurrence.occurrenceKey,
    startsAt: null, endsAt: null, localDate: '2026-08-26', localTime: null,
    timezone: FEVER_TIMEZONE,
  });
});

test('strictly rejects invalid or unknown local values', () => {
  for (const value of ['2026-02-30 10:00', '2026-08-25 24:00', '25/08/2026 10:00', '', 'tomorrow']) {
    assert.equal(parseFeverSessionToken(value).valid, false);
  }
});

test('deduplicates canonical sessions and occurrence keys do not depend on token order', () => {
  const first = parseFeverManufacturer('2026-08-26 12:30, 2026-08-25 10:00, 2026-08-26 12:30');
  const second = parseFeverManufacturer('2026-08-25 10:00,2026-08-26 12:30');
  assert.equal(first.statistics.tokens, 3);
  assert.equal(first.statistics.parsed, 2);
  assert.equal(first.statistics.duplicates, 1);
  const firstKeys = new Map(first.occurrences.map((item) => [item.localDate, item.occurrenceKey]));
  const secondKeys = new Map(second.occurrences.map((item) => [item.localDate, item.occurrenceKey]));
  assert.deepEqual(firstKeys, secondKeys);
});

test('converts only explicit offset or Z instants to Europe/Madrid with DST-aware Intl', () => {
  const beforeSpringJump = parseFeverSessionToken('2026-03-29T00:30:00Z');
  const afterSpringJump = parseFeverSessionToken('2026-03-29T01:30:00Z');
  assert.deepEqual(
    [beforeSpringJump.occurrence.localDate, beforeSpringJump.occurrence.localTime],
    ['2026-03-29', '01:30:00'],
  );
  assert.deepEqual(
    [afterSpringJump.occurrence.localDate, afterSpringJump.occurrence.localTime],
    ['2026-03-29', '03:30:00'],
  );
  const ambiguousLocal = parseFeverSessionToken('2026-10-25 02:30');
  assert.equal(ambiguousLocal.occurrence.startsAt, null);
  assert.equal(ambiguousLocal.occurrence.localTime, '02:30');
});

test('occurrence keys distinguish repeated DST branches and normalize equivalent instants', () => {
  const summerBranch = parseFeverSessionToken('2026-10-25T02:30:00+02:00').occurrence;
  const winterBranch = parseFeverSessionToken('2026-10-25T02:30:00+01:00').occurrence;
  const sameAsSummer = parseFeverSessionToken('2026-10-25T00:30:00Z').occurrence;
  assert.equal(summerBranch.localTime, '02:30:00');
  assert.equal(winterBranch.localTime, '02:30:00');
  assert.notEqual(summerBranch.startsAt, winterBranch.startsAt);
  assert.notEqual(summerBranch.occurrenceKey, winterBranch.occurrenceKey);
  assert.equal(summerBranch.startsAt, sameAsSummer.startsAt);
  assert.equal(summerBranch.occurrenceKey, sameAsSummer.occurrenceKey);
});

test('parses more than 1500 sessions in linear input order', () => {
  const tokens = Array.from({ length: 1600 }, (_, index) => {
    const date = new Date('2026-01-01T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    return `${date.toISOString().slice(0, 10)} 10:00`;
  });
  const parsed = parseFeverManufacturer(tokens.join(', '));
  assert.equal(parsed.statistics.tokens, 1600);
  assert.equal(parsed.statistics.parsed, 1600);
  assert.equal(parsed.statistics.duplicates, 0);
});

test('cleans descriptions to bounded plain text without scripts, styles or tags', () => {
  const cleaned = cleanFeverDescription(`
    <style>.card { color: red; }</style><p>Hola&nbsp;&amp; adÃ©u</p>
    <script>alert('x')</script><noscript>fallback</noscript><ul><li>Primer</li><li>Segon</li></ul>
  `);
  assert.match(cleaned, /Hola & adÃ©u/);
  assert.match(cleaned, /\u2022 Primer/);
  assert.doesNotMatch(cleaned, /style|script|alert|fallback|<|color:\s*red/i);
  assert.equal(cleanFeverDescription('<p>abcdefgh</p>', { maximumLength: 5 }), 'abcde');
});

test('decodes Latin and numeric entities before removing encoded markup', () => {
  assert.equal(cleanFeverDescription('&aacute; &eacute; &iacute; &oacute; &uacute; &ntilde;'), 'á é í ó ú ñ');
  assert.equal(cleanFeverDescription('M&uacute;sica Tom&amp;Jerry &#250; &#xFA;'), 'Música Tom&Jerry ú ú');
  assert.equal(cleanFeverDescription('&lt;b&gt;Hola&lt;/b&gt;'), 'Hola');
  assert.equal(cleanFeverDescription('&amp;lt;b&amp;gt;Hola&amp;lt;/b&amp;gt;'), 'Hola');
});

test('removes encoded active/fallback markup mixed with real HTML and normalizes whitespace', () => {
  const cleaned = cleanFeverDescription(`
    <p>  Visible&nbsp; real </p>
    &lt;script&gt;alert(1)&lt;/script&gt;
    &lt;style&gt;.evil { display:block }&lt;/style&gt;
    &lt;noscript&gt;fallback&lt;/noscript&gt;
    <div>&lt;b&gt;Visible encoded&lt;/b&gt;</div>
  `);
  assert.equal(cleaned, 'Visible real\n\nVisible encoded');
  assert.doesNotMatch(cleaned, /<|>|alert|display|fallback|script|style|noscript/i);
  assert.equal(cleanFeverDescription('  abc   def  ', { maximumLength: 6 }), 'abc de');
});

test('normalizes a Fever item without treating Text2 as municipality or tier as editorial category', () => {
  const normalized = normalizeFeverItem(fixture[0]);
  assert.equal(normalized.productId, 'm3-standard');
  assert.equal(normalized.affiliateUrl, 'https://fever.pxf.io/m3-standard');
  assert.deepEqual(normalized.coordinates, { latitude: 41.3874, longitude: 2.1686 });
  assert.equal(normalized.tier, 'tier4');
  assert.equal(normalized.tierLabel, 'Tier 4 Non-commissionable');
  assert.equal(normalized.text2, 'Barcelona');
  assert.equal(Object.hasOwn(normalized, 'municipality'), false);
  assert.equal(normalized.occurrences.length, 6);
  assert.equal(normalized.sessionStatistics.duplicates, 1);
  assert.equal(normalized.sessionStatistics.invalid, 1);
  assert.equal(isEligibleFeverProduct(fixture[0]), true);
  assert.equal(isEligibleFeverProduct(fixture[2]), false);

  const trackedUrl = 'https://fever.pxf.io/a/path?irclickid=abc&utm_source=impact';
  const tracked = normalizeFeverItem({ ...fixture[0], Url: trackedUrl });
  assert.equal(tracked.affiliateUrl, trackedUrl);
});

test('applies the inclusive 365-day horizon to occurrences rather than ExpirationDate', () => {
  const result = analyzeFeverNormalization({ pages: 2, items: fixture }, {
    lookaheadDays: 365,
    now: new Date('2026-08-25T10:00:00Z'),
  });
  const { summary, normalizedProducts } = result;
  assert.equal(summary.products.cataloniaItems, 3);
  assert.equal(summary.products.giftCardsExcluded, 1);
  assert.equal(summary.products.eligibleNonGift, 2);
  assert.equal(summary.products.withPublishableOccurrence, 2);
  assert.equal(summary.sessions.past, 1);
  assert.equal(summary.sessions.futureWithinHorizon, 4);
  assert.equal(summary.sessions.futureOutsideHorizon, 2);
  assert.equal(summary.sessions.invalid, 1);
  assert.equal(summary.sessions.duplicates, 1);
  const standard = normalizedProducts.find(({ productId }) => productId === 'm3-standard');
  assert.deepEqual(standard.publishableOccurrences.map(({ localDate }) => localDate), [
    '2026-08-25', '2026-08-26', '2027-08-25',
  ]);
  assert.equal(standard.publishableOccurrences.some(({ localDate }) => localDate === '2027-08-26'), false);
  assert.equal(standard.publishableOccurrences.some(({ localDate }) => localDate === '2030-01-31'), false);
  assert.equal(summary.normalization.tiers.tier4, 1);
});

test('classifies non-publishable products solely from parsed Manufacturer sessions', () => {
  const base = {
    CatalogId: '15532', CampaignId: '16345', ParentName: 'Catalonia',
    Url: 'https://fever.pxf.io/test', Pattern: '(41; 2)', Category: 'Tier 1',
  };
  const items = [
    { ...base, CatalogItemId: 'past', Name: 'Past', Manufacturer: '2026-08-24 10:00', ExpirationDate: '2027-01-01' },
    { ...base, CatalogItemId: 'outside', Name: 'Outside', Manufacturer: '2027-08-26 10:00', ExpirationDate: '2027-09-01' },
    { ...base, CatalogItemId: 'mixed', Name: 'Mixed', Manufacturer: '2026-08-24 10:00, 2027-08-26 10:00' },
    { ...base, CatalogItemId: 'empty', Name: 'Empty', Manufacturer: '', ExpirationDate: '2027-01-01' },
    { ...base, CatalogItemId: 'expired-future', Name: 'Expired future', Manufacturer: '2026-08-26 10:00', ExpirationDate: '2026-08-24' },
  ];
  const { summary } = analyzeFeverNormalization({ pages: 1, items }, {
    lookaheadDays: 365, now: new Date('2026-08-25T10:00:00Z'),
  });
  assert.deepEqual(Object.fromEntries(Object.entries(summary.nonPublishable)
    .map(([key, group]) => [key, group.count])), {
    pastOnly: 1, futureOutsideHorizonOnly: 1, mixed: 1, noSessions: 1, other: 0,
  });
  assert.equal(summary.nonPublishable.pastOnly.examples[0].catalogItemId, 'past');
  assert.equal(summary.nonPublishable.mixed.examples[0].firstSession, '2026-08-24');
  assert.equal(summary.nonPublishable.mixed.examples[0].lastSession, '2027-08-26');
  assert.equal(summary.expirationSanity.expiredWithFutureOccurrence.count, 1);
  assert.equal(summary.expirationSanity.futureExpirationWithoutFutureOccurrence.count, 2);
});

test('normalization dry-run leaves a controlled DATABASE_PATH untouched and imports no database layer', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fever-m3-readonly-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'sentinel.sqlite');
  const sentinel = 'not-a-real-sqlite-database';
  await writeFile(databasePath, sentinel, 'utf8');
  const beforeFiles = await readdir(directory);
  const jobSource = await readFile(new URL('../backend/src/jobs/dryRunFeverNormalization.js', import.meta.url), 'utf8');

  await dryRunFeverNormalization({
    impactAccountSid: 'fixture-account', impactAuthToken: 'fixture-token',
    feverLookaheadDays: 365, databasePath,
  }, {
    now: new Date('2026-08-25T10:00:00Z'),
    logger: { log() {} },
    fetchImpl: async () => new Response(JSON.stringify({ Items: fixture }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });

  assert.equal(await readFile(databasePath, 'utf8'), sentinel);
  assert.deepEqual(await readdir(directory), beforeFiles);
  assert.doesNotMatch(jobSource, /(?:from|import\()\s*['"][^'"]*(?:\/db\/|migrat|PlanOccurrenceRepository)/i);
});
