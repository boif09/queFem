import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { EmbedWidgetRepository } from '../backend/src/db/repositories/embedWidget.repository.js';
import {
  generateWidgetKey, isValidWidgetKey, normalizeOrigin, normalizeWidgetConfig, WidgetConfigError,
} from '../backend/src/embed/widgetConfig.js';
import { OfficialPlaceNames } from '../backend/src/embed/placeNames.js';
import { runEmbedWidgetCommand } from '../backend/src/jobs/embedWidgets.js';
import { EmbedUsageRecorder } from '../backend/src/embed/usageRecorder.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-09-15T08:00:00.000Z');
const PLACES = OfficialPlaceNames.load();
const ORIGIN = 'https://www.consell-exemple.cat';
const KEY = 'wgt_TestKey0123456789abcd';

function insertPlan(db, values, sourceKeys = ['gencat-agenda']) {
  const stamp = '2026-09-01T10:00:00.000Z';
  const planId = Number(db.prepare(`INSERT INTO plans (
      kind, fingerprint, original_language, original_title, title_ca, title_es, description_ca,
      start_date, end_date, permanent, is_free, province, comarca, municipality, venue_name,
      quality_score, status, ticket_url, latitude, longitude, created_at, updated_at
    ) VALUES (
      'event', @fingerprint, 'ca', @title, @title, NULL, 'Descripció que no es redistribueix',
      @start_date, @end_date, @permanent, @is_free, 'Barcelona', @comarca, @municipality, @venue_name,
      70, 'active', @ticket_url, @latitude, @longitude, @stamp, @stamp
    )`).run({
    fingerprint: `fp-${values.title}`,
    latitude: null,
    longitude: null,
    start_date: '2026-09-20',
    end_date: '2026-09-20',
    permanent: 0,
    is_free: null,
    comarca: 'Bages',
    municipality: 'Manresa',
    venue_name: null,
    ticket_url: null,
    stamp,
    ...values,
  }).lastInsertRowid);
  for (const key of sourceKeys) {
    db.prepare(`INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_url, source_payload_json, imported_at, last_seen_at)
      SELECT ?, id, ?, 'https://affiliate.example/track', '{}', ?, ? FROM sources WHERE key = ?`)
      .run(planId, `${key}-${planId}`, stamp, stamp, key);
  }
  return planId;
}

function seedWidget(db, overrides = {}) {
  const config = normalizeWidgetConfig({ territory: { comarca: 'Bages' }, ...overrides.config }, {
    placeNames: PLACES, categorySlugs: new Set(db.prepare('SELECT slug FROM categories').pluck().all()),
  });
  return new EmbedWidgetRepository(db, { now: () => NOW }).create({
    publicKey: overrides.publicKey || KEY, name: 'Pilot', allowedOrigins: [ORIGIN], config,
  });
}

function appFor(db) {
  return createApp({ db, fallbackImageLibrary: null, seoTemplate: '<html><head></head><body></body></html>', now: () => NOW, embedUsageFlushIntervalMs: 0, logger: { warn() {}, error() {} } });
}

function framed(agent, url, referer = `${ORIGIN}/agenda`) {
  return agent.get(url).set('Sec-Fetch-Dest', 'iframe').set('Referer', referer);
}

function enableAllSources(db) {
  db.prepare('UPDATE sources SET enabled = 1').run();
}

test('migration grants syndication only to Gencat and DIBA', () => withTestDatabase((db) => {
  const rows = Object.fromEntries(db.prepare('SELECT key, allows_syndication FROM sources').all()
    .map(({ key, allows_syndication: value }) => [key, value]));
  assert.deepEqual(rows, {
    'gencat-agenda': 1,
    'ticketmaster-discovery-feed': 0,
    fever: 0,
    'diba-tourisme': 1,
    'diba-escenari': 1,
    'diba-museus': 1,
  });
}));

test('ICGC names index matches the published snapshot', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/geography/icgc-current.json', import.meta.url), 'utf8'));
  const index = JSON.parse(fs.readFileSync(new URL('../backend/src/embed/officialPlaceNames.json', import.meta.url), 'utf8'));
  assert.equal(index.snapshotSha256, manifest.snapshotSha256, 'run npm run geography:icgc:names');
  assert.equal(index.municipalities.length, 947);
  assert.equal(PLACES.officialMunicipalityName('Sant Feliu de Guixols'), 'Sant Feliu de Guíxols');
});

test('widget config is normalised against ICGC names and rejects unknown fields', () => {
  const categorySlugs = new Set(['festes', 'musica']);
  const comarca = normalizeWidgetConfig({ territory: { comarca: 'baix emporda' }, categories: ['festes'] }, { placeNames: PLACES, categorySlugs });
  assert.equal(comarca.territory.comarca, 'Baix Empordà');
  assert.deepEqual(comarca.sections, ['upcoming']);
  assert.equal(comarca.limit, 8);

  const municipality = normalizeWidgetConfig({ territory: { municipality: 'Palamos' } }, { placeNames: PLACES, categorySlugs });
  assert.deepEqual(municipality.territory, {
    municipality: 'Palamós', comarca: 'Baix Empordà', fallbackToComarca: true, fallbackMinimum: 3,
  });

  const invalid = [
    { territory: { comarca: 'Atlàntida' } },
    { territory: { comarca: 'Bages' }, extra: true },
    { territory: { comarca: 'Bages' }, accent: 'red' },
    { territory: { comarca: 'Bages' }, categories: ['inexistent'] },
    { territory: { comarca: 'Bages' }, limit: 0 },
    { territory: { municipality: 'Manresa', comarca: 'Bages' } },
    { territory: {} },
  ];
  for (const raw of invalid) {
    assert.throws(() => normalizeWidgetConfig(raw, { placeNames: PLACES, categorySlugs }), WidgetConfigError, JSON.stringify(raw));
  }
});

test('allowed origins must be bare https origins', () => {
  assert.equal(normalizeOrigin('https://WWW.Exemple.cat/'), 'https://www.exemple.cat');
  assert.equal(normalizeOrigin('http://localhost:8080'), 'http://localhost:8080');
  for (const value of ['http://exemple.cat', 'https://exemple.cat/agenda', 'https://exemple.cat?x=1', 'https://*.exemple.cat', 'nope']) {
    assert.throws(() => normalizeOrigin(value), WidgetConfigError, value);
  }
});

test('generated keys are well formed and unique', () => {
  const keys = new Set(Array.from({ length: 200 }, () => generateWidgetKey()));
  assert.equal(keys.size, 200);
  for (const key of keys) assert.ok(isValidWidgetKey(key), key);
  assert.equal(isValidWidgetKey('wgt_../../etc'), false);
});

test('widget renders only syndicated sources, escapes content and pins frame ancestors', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  insertPlan(db, { title: 'Festa major <script>alert(1)</script>', venue_name: 'Plaça Major' });
  insertPlan(db, { title: 'Només Fever' }, ['fever']);
  insertPlan(db, { title: 'Només Ticketmaster' }, ['ticketmaster-discovery-feed']);
  insertPlan(db, { title: 'Compartit Fever', ticket_url: 'https://affiliate.example/ticket' }, ['gencat-agenda', 'fever']);
  insertPlan(db, { title: 'Pla DIBA', municipality: 'Sallent' }, ['diba-tourisme']);
  insertPlan(db, { title: 'Fora de comarca', comarca: 'Osona', municipality: 'Vic' });
  seedWidget(db);

  const response = await framed(request(appFor(db)), `/embed/v1/w/${KEY}`);
  assert.equal(response.status, 200);
  const html = response.text;
  assert.match(html, /Plans · Bages/);
  assert.match(html, /Festa major &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Compartit Fever/);
  assert.match(html, /Pla DIBA/);
  assert.doesNotMatch(html, /Només Fever|Només Ticketmaster|Fora de comarca/);
  assert.doesNotMatch(html, /affiliate\.example|Descripció que no es redistribueix/);
  assert.match(html, /Generalitat de Catalunya\. Departament de Cultura/);
  assert.match(html, /Diputació de Barcelona — Dades obertes/);
  assert.match(html, /ICGC/);
  assert.match(html, /href="\/plans\/\d+\?lang=ca&amp;utm_source=tenspla-widget&amp;utm_medium=embed&amp;utm_campaign=wgt_TestKey0123456789abcd"/);
  assert.match(html, /href="\/plans\?comarca=Bages&amp;lang=ca&amp;utm_source=tenspla-widget/);

  const csp = response.headers['content-security-policy'];
  assert.match(csp, new RegExp(`frame-ancestors ${ORIGIN}(;|$)`));
  assert.equal(response.headers['x-frame-options'], undefined);
  assert.equal(response.headers['cache-control'], 'no-cache');
  const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(csp.includes(`style-src ${hash(style)}`));
  assert.ok(csp.includes(`script-src ${hash(script)}`));
  assert.doesNotMatch(html, /\sstyle="/);
}));

function insertOccurrence(db, planId, sourceKey, localDate) {
  const stamp = '2026-09-01T10:00:00.000Z';
  db.prepare(`INSERT INTO plan_occurrences
    (plan_source_id, occurrence_key, local_date, local_time, timezone, status, last_seen_at, created_at, updated_at)
    SELECT ps.id, ?, ?, '20:00', 'Europe/Madrid', 'active', ?, ?, ?
    FROM plan_sources ps JOIN sources s ON s.id = ps.source_id WHERE ps.plan_id = ? AND s.key = ?`)
    .run(`${sourceKey}-${localDate}`, localDate, stamp, stamp, stamp, planId, sourceKey);
}

test('Fever or Ticketmaster sessions never decide visibility or dates of a shared plan', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  // Gencat dates outside the 30-day window; only the Fever session falls inside it.
  const hidden = insertPlan(db, { title: 'Només sessió Fever', start_date: '2026-11-20', end_date: '2026-11-20' }, ['gencat-agenda', 'fever']);
  insertOccurrence(db, hidden, 'fever', '2026-09-18');
  // Both sources have sessions; the widget must show the Gencat one (25), not the earlier Fever one (18).
  const shared = insertPlan(db, { title: 'Sessions compartides', start_date: '2026-09-18', end_date: '2026-09-25' }, ['gencat-agenda', 'ticketmaster-discovery-feed']);
  insertOccurrence(db, shared, 'ticketmaster-discovery-feed', '2026-09-18');
  insertOccurrence(db, shared, 'gencat-agenda', '2026-09-25');
  seedWidget(db);

  const html = (await framed(request(appFor(db)), `/embed/v1/w/${KEY}`)).text;
  assert.doesNotMatch(html, /Només sessió Fever/);
  const card = html.slice(html.indexOf('<li>'), html.indexOf('Sessions compartides'));
  assert.match(card, /<span class="dn">25<\/span>/);
  assert.doesNotMatch(card, /<span class="dn">18<\/span>/);

  // tenspla.cat itself keeps using every enabled source.
  const api = await request(appFor(db)).get('/api/plans?dateFrom=2026-09-15&dateTo=2026-10-14');
  assert.ok(api.body.data.some(({ title }) => title === 'Només sessió Fever'));
}));

test('usage recorder folds an origin flood into one bucket without recursion', () => {
  const saved = [];
  const recorder = new EmbedUsageRecorder({ repository: { addUsage: (rows) => saved.push(...rows) }, now: () => NOW, flushIntervalMs: 0 });
  for (let index = 0; index < 5100; index += 1) recorder.record(1, `https://o${index}.example`);
  recorder.record(1, 'https://o0.example');
  recorder.flush();
  assert.equal(saved.length, 5001);
  assert.equal(saved.find(({ origin }) => origin === 'other').impressions, 100);
  assert.equal(saved.find(({ origin }) => origin === 'https://o0.example').impressions, 2);
});

test('widget supports Spanish and permanent sections', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  insertPlan(db, { title: 'Concert' });
  insertPlan(db, { title: 'Museu de la Tècnica', permanent: 1, start_date: null, end_date: null });
  seedWidget(db, { config: { sections: ['upcoming', 'permanent'] } });

  const html = (await framed(request(appFor(db)), `/embed/v1/w/${KEY}?lang=es`)).text;
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Planes · Bages/);
  assert.match(html, /Próximos días/);
  assert.match(html, /Para visitar/);
  assert.match(html, /\?lang=es&amp;utm_source=/);
  assert.match(html, /Museu de la Tècnica/);
}));

test('a municipality widget widens to its comarca when it has too few plans', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  insertPlan(db, { title: 'Pla de Súria', municipality: 'Súria' });
  insertPlan(db, { title: 'Pla de Manresa', municipality: 'Manresa' });
  insertPlan(db, { title: 'Pla de Vic', comarca: 'Osona', municipality: 'Vic' });
  seedWidget(db, { config: { territory: { municipality: 'Suria' } } });

  const html = (await framed(request(appFor(db)), `/embed/v1/w/${KEY}`)).text;
  assert.match(html, /Plans · Súria/);
  assert.ok(html.indexOf('Pla de Súria') < html.indexOf('Pla de Manresa'));
  assert.doesNotMatch(html, /Pla de Vic/);
}));

test('usage is counted per origin and foreign origins are rejected', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  const widget = seedWidget(db);
  const app = appFor(db);
  const agent = request(app);

  assert.equal((await framed(agent, `/embed/v1/w/${KEY}`)).status, 200);
  assert.equal((await framed(agent, `/embed/v1/w/${KEY}`)).status, 200);
  const foreign = await framed(agent, `/embed/v1/w/${KEY}`, 'https://copia.example/pagina');
  assert.equal(foreign.status, 403);
  assert.match(foreign.headers['content-security-policy'], /frame-ancestors \*$/);
  assert.doesNotMatch(foreign.text, /class="list"/);
  assert.equal((await agent.get(`/embed/v1/w/${KEY}`)).status, 200, 'direct visits render but are not counted');

  app.locals.embedUsageRecorder.flush();
  const usage = new EmbedWidgetRepository(db).usageSince(widget.id, '2026-09-01');
  assert.deepEqual(usage, [
    { usageDate: '2026-09-15', origin: 'https://copia.example', impressions: 0, rejected: 1 },
    { usageDate: '2026-09-15', origin: ORIGIN, impressions: 2, rejected: 0 },
  ]);
}));

test('unknown, revoked and suspended widgets never render plans', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  insertPlan(db, { title: 'Concert secret' });
  seedWidget(db);
  const agent = request(appFor(db));
  const repository = new EmbedWidgetRepository(db);

  const unknown = await framed(agent, '/embed/v1/w/wgt_Unknown0123456789abcd');
  assert.equal(unknown.status, 404);
  assert.match(unknown.headers['content-security-policy'], /frame-ancestors \*$/);
  assert.equal((await framed(agent, '/embed/v1/w/not-a-key')).status, 404);
  assert.equal((await framed(agent, `/embed/v1/w/${KEY}?limit=100`)).status, 400);

  repository.update(KEY, { status: 'suspended' });
  const suspended = await framed(agent, `/embed/v1/w/${KEY}`);
  assert.equal(suspended.status, 403);
  assert.doesNotMatch(suspended.text, /Concert secret/);

  repository.update(KEY, { status: 'revoked' });
  assert.equal((await framed(agent, `/embed/v1/w/${KEY}`)).status, 404);
}));

test('loader script is served cross-origin as JavaScript', () => withTestDatabase(async (db) => {
  const response = await request(appFor(db)).get('/embed/v1/loader.js');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/javascript/);
  assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.match(response.text, /data-tenspla-widget/);
}));

test('CLI creates, rotates, suspends and reports widgets', () => withTestDatabase((db) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-embed-'));
  const configFile = path.join(directory, 'bages.json');
  fs.writeFileSync(configFile, JSON.stringify({ territory: { comarca: 'Bages' }, layout: 'grid' }));
  const keys = ['wgt_FirstKey0123456789abcd', 'wgt_SecondKey012345678abcd'];
  const options = { placeNames: PLACES, now: () => NOW, randomKey: () => keys.shift() };
  try {
    const created = runEmbedWidgetCommand(db, {
      command: 'create', options: { name: 'Consell', origins: 'https://www.a.cat,https://a.cat/', config: configFile },
    }, options);
    assert.match(created, /wgt_FirstKey0123456789abcd/);
    assert.match(created, /embed\/v1\/loader\.js/);
    assert.match(created, /https:\/\/www\.a\.cat, https:\/\/a\.cat/);

    const rotated = runEmbedWidgetCommand(db, { command: 'rotate', key: 'wgt_FirstKey0123456789abcd', options: {} }, options);
    assert.match(rotated, /wgt_SecondKey012345678abcd/);
    assert.throws(() => runEmbedWidgetCommand(db, { command: 'show', key: 'wgt_FirstKey0123456789abcd', options: {} }, options));

    assert.match(runEmbedWidgetCommand(db, { command: 'suspend', key: 'wgt_SecondKey012345678abcd', options: {} }, options), /\[suspended\]/);
    assert.match(runEmbedWidgetCommand(db, { command: 'usage', key: 'wgt_SecondKey012345678abcd', options: {} }, options), /sense ús/);
    assert.throws(() => runEmbedWidgetCommand(db, {
      command: 'create', options: { name: 'X', origins: 'http://a.cat', config: configFile },
    }, options), WidgetConfigError);

    const demo = { name: 'Demo', origins: 'https://tenspla.cat', config: configFile, key: 'wgt_TensPlaDemoBages2026' };
    assert.match(runEmbedWidgetCommand(db, { command: 'create', options: demo }, options), /wgt_TensPlaDemoBages2026/);
    assert.throws(() => runEmbedWidgetCommand(db, { command: 'create', options: demo }, options), /Ja existeix/);
    assert.throws(() => runEmbedWidgetCommand(db, {
      command: 'create', options: { ...demo, key: 'wgt_../x' },
    }, options), WidgetConfigError);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}));

test('radius widgets show only nearby plans with their distance', () => withTestDatabase(async (db) => {
  enableAllSources(db);
  // Point: Pals (41.9711, 3.1486). Palafrugell is ~6 km away, Girona ~28 km, Barcelona ~110 km.
  insertPlan(db, { title: 'Festa a Palafrugell', comarca: 'Baix Empordà', municipality: 'Palafrugell', latitude: 41.9174, longitude: 3.1631 });
  insertPlan(db, { title: 'Concert a Girona', comarca: 'Gironès', municipality: 'Girona', latitude: 41.9794, longitude: 2.8214 });
  insertPlan(db, { title: 'Teatre a Barcelona', comarca: 'Barcelonès', municipality: 'Barcelona', latitude: 41.3874, longitude: 2.1686 });
  insertPlan(db, { title: 'Sense coordenades', comarca: 'Baix Empordà', municipality: 'Pals' });
  seedWidget(db, { config: { territory: { near: { latitude: 41.9711, longitude: 3.1486, radiusKm: 15 }, municipality: 'pals' } } });

  const html = (await framed(request(appFor(db)), `/embed/v1/w/${KEY}`)).text;
  assert.match(html, /Plans · Pals i voltants/);
  assert.match(html, /Festa a Palafrugell/);
  assert.match(html, /a 6,1 km|a 6,2 km/);
  assert.doesNotMatch(html, /Concert a Girona|Teatre a Barcelona|Sense coordenades/);
  assert.match(html, /href="\/plans\?comarca=Baix\+Empord%C3%A0&amp;lang=ca/);
}));

test('radius config is validated', () => {
  const categorySlugs = new Set();
  const normalized = normalizeWidgetConfig({
    territory: { near: { latitude: 41.97113, longitude: 3.148612, radiusKm: 12.25 }, municipality: 'Pals' },
  }, { placeNames: PLACES, categorySlugs });
  assert.deepEqual(normalized.territory, {
    near: { latitude: 41.97113, longitude: 3.148612, radiusKm: 12.3 }, municipality: 'Pals', comarca: 'Baix Empordà',
  });
  const invalid = [
    { near: { latitude: 41.9, longitude: 3.1, radiusKm: 10 } },
    { near: { latitude: 48.8, longitude: 2.3, radiusKm: 10 }, municipality: 'Pals' },
    { near: { latitude: 41.9, longitude: 3.1, radiusKm: 80 }, municipality: 'Pals' },
    { near: { latitude: '41.9', longitude: 3.1, radiusKm: 10 }, municipality: 'Pals' },
    { near: { latitude: 41.9, longitude: 3.1, radiusKm: 10, zoom: 3 }, municipality: 'Pals' },
    { near: { latitude: 41.9, longitude: 3.1, radiusKm: 10 }, municipality: 'Pals', comarca: 'Baix Empordà' },
  ];
  for (const territory of invalid) {
    assert.throws(() => normalizeWidgetConfig({ territory }, { placeNames: PLACES, categorySlugs }), WidgetConfigError, JSON.stringify(territory));
  }
});

test('monthly usage report summarises loads per domain for the client', () => withTestDatabase((db) => {
  const widget = seedWidget(db);
  const repository = new EmbedWidgetRepository(db);
  repository.addUsage([
    { widgetId: widget.id, usageDate: '2026-08-31', origin: ORIGIN, impressions: 999, rejected: 0 },
    { widgetId: widget.id, usageDate: '2026-09-02', origin: ORIGIN, impressions: 1200, rejected: 0 },
    { widgetId: widget.id, usageDate: '2026-09-03', origin: ORIGIN, impressions: 30, rejected: 0 },
    { widgetId: widget.id, usageDate: '2026-09-03', origin: 'unknown', impressions: 10, rejected: 0 },
    { widgetId: widget.id, usageDate: '2026-09-04', origin: 'https://copia.example', impressions: 0, rejected: 4 },
  ]);
  const run = (options) => runEmbedWidgetCommand(db, { command: 'report', key: KEY, options }, {
    placeNames: PLACES, now: () => new Date('2026-10-02T09:00:00Z'),
  });

  const report = run({});
  assert.match(report, /Període: setembre del? 2026/);
  assert.match(report, /Territori: Bages/);
  assert.match(report, /Càrregues de l’agenda: 1\.240/);
  assert.match(report, /Mitjana diària: 41/);
  assert.match(report, / {2}www\.consell-exemple\.cat: 1\.230\n {2}web sense identificar: 10/);
  assert.match(report, /Dies amb més càrregues: 02\/09 \(1\.200\), 03\/09 \(40\)/);
  assert.match(report, /Intents bloquejats des d’altres webs: 4/);
  assert.doesNotMatch(report, /999/);

  const spanish = run({ month: '2026-08', lang: 'es' });
  assert.match(spanish, /Periodo: agosto de 2026/);
  assert.match(spanish, /Cargas de la agenda: 999/);
  assert.match(run({ month: '2026-07' }), /No s’ha registrat cap càrrega/);
  assert.throws(() => run({ month: '2026-13' }), /AAAA-MM/);
}));
