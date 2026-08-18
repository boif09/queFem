import assert from 'node:assert/strict';
import test from 'node:test';
import { horizonBounds, classifyDateHorizon } from '../backend/src/ticketmaster/dateHorizon.js';
import { parseDiscoveryFeed } from '../backend/src/ticketmaster/feedParser.js';
import { detectRecurringInventory } from '../backend/src/ticketmaster/recurringInventory.js';
import { TicketmasterDiscoveryFeedImporter } from '../backend/src/importers/ticketmasterDiscoveryFeed.importer.js';
import { DiscoveryFeedClient } from '../backend/src/ticketmaster/discoveryFeedClient.js';
import { gzipSync } from 'node:zlib';
import { isAcceptedTicketmasterSource, ticketmasterSourceBucket } from '../backend/src/ticketmaster/sourcePolicy.js';
import { classifyProductVariants } from '../backend/src/ticketmaster/productVariants.js';
import { isExcludedProviderTestRecord } from '../backend/src/ticketmaster/providerTestPolicy.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-18T10:00:00.000Z');
const bounds = horizonBounds(NOW, 90);

function event(overrides = {}) {
  return {
    eventId: 'tm-1', eventName: 'Concert de prova', source: 'trium',
    brandName: 'Ticketmaster', officialSeller: true,
    eventStartLocalDate: '2026-08-18', eventEndLocalDate: '2026-08-18',
    eventStartLocalTime: '20:00', primaryEventUrl: 'https://ticketmaster.es/event/tm-1',
    segmentName: 'Music', eventImageUrl: 'https://example.test/restricted.jpg',
    venue: {
      venueId: 'venue-1', venueName: 'Sala Catalunya', countryCode: 'ES',
      state: 'Barcelona', city: 'Barcelona', postalCode: '08001',
      address: 'Carrer de prova 1', latitude: 41.38, longitude: 2.17,
    }, ...overrides,
  };
}

test('applies the inclusive local-date horizon using the effective end date', () => {
  const cases = [
    [event(), true],
    [event({ eventStartLocalDate: '2026-08-10', eventEndLocalDate: '2026-08-18' }), true],
    [event({ eventStartLocalDate: '2026-08-15', eventEndLocalDate: '2026-08-20' }), true],
    [event({ eventStartLocalDate: '2026-08-10', eventEndLocalDate: '2026-08-17' }), false],
    [event({ eventStartLocalDate: '2026-11-16', eventEndLocalDate: '2026-11-16' }), true],
    [event({ eventStartLocalDate: '2026-11-17', eventEndLocalDate: '2026-11-17' }), false],
  ];
  for (const [record, accepted] of cases) assert.equal(classifyDateHorizon(record, bounds).accepted, accepted);
});

test('rejects an empty or malformed feed as incomplete', () => {
  assert.throws(() => parseDiscoveryFeed([]), /buit/);
  assert.throws(() => parseDiscoveryFeed({ unexpected: [] }), /llista completa/);
});

test('decompresses the gzip transport used by Discovery Feed', async () => {
  const payload = [event()];
  const client = new DiscoveryFeedClient({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(gzipSync(JSON.stringify(payload)), {
      status: 200, headers: { 'content-type': 'application/gzip' },
    }),
  });
  assert.deepEqual(await client.downloadSpain(), payload);
});

test('centralizes the conservative ES source allowlist and validates all metadata', () => {
  assert.equal(isAcceptedTicketmasterSource(event()), true);
  assert.equal(isAcceptedTicketmasterSource(event({ source: 'mfx-es' })), true);
  assert.equal(isAcceptedTicketmasterSource(event({ source: 'universe', brandName: 'Universe' })), false);
  assert.equal(isAcceptedTicketmasterSource(event({ source: 'mfx-external' })), false);
  assert.equal(isAcceptedTicketmasterSource(event({ brandName: 'Other' })), false);
  assert.equal(isAcceptedTicketmasterSource(event({ officialSeller: false })), false);
  assert.equal(ticketmasterSourceBucket(event({ source: 'mfx-external' })), 'mfx-external');
});

function variantItem(record) {
  return {
    record,
    dates: { startDate: record.eventStartLocalDate, endDate: record.eventEndLocalDate },
    location: {
      venueName: record.venue.venueName, municipality: record.venue.city,
    },
  };
}

test('classifies a VIP package only when its exact main event matches every signal', () => {
  const main = variantItem(event({ eventId: 'main', eventName: 'Artista en concierto' }));
  const vip = variantItem(event({ eventId: 'vip', eventName: 'Artista en concierto | Paquetes VIP' }));
  assert.deepEqual(classifyProductVariants([main, vip]).get('vip'), {
    type: 'PACKAGE_VARIANT', mainEventId: 'main',
    reason: 'unambiguous VIP package suffix with matching main event, date, time, municipality and venue',
  });
  const differentTime = variantItem(event({ eventId: 'vip-time', eventName: 'Artista en concierto | Paquetes VIP', eventStartLocalTime: '19:00' }));
  assert.equal(classifyProductVariants([main, differentTime]).size, 0);
  const legitimate = variantItem(event({ eventId: 'legit', eventName: 'VIP Music Festival' }));
  assert.equal(classifyProductVariants([main, legitimate]).size, 0);
});

test('classifies an upgrade only with a recognizable main event on the same date and venue', () => {
  const main = variantItem(event({ eventId: 'synthony', eventName: 'SYNTHONY' }));
  const upgrade = variantItem(event({ eventId: 'upgrade', eventName: 'Upgrade MEET&GREET Synthony', eventStartLocalTime: '18:00' }));
  assert.equal(classifyProductVariants([main, upgrade]).get('upgrade').mainEventId, 'synthony');
  const unrelated = variantItem(event({ eventId: 'unrelated', eventName: 'Upgrade Your Life: Live', eventStartLocalTime: '18:00' }));
  assert.equal(classifyProductVariants([main, unrelated]).size, 0);
});

test('excludes only the manually reviewed provider test event ID', () => {
  assert.equal(isExcludedProviderTestRecord(event({ eventId: 'Z698xZ2qZ1kqe-F3f', eventName: 'Anything' })), true);
  assert.equal(isExcludedProviderTestRecord(event({ eventId: 'other', eventName: 'Test New Creation 2026' })), false);
});

test('detects extreme recurring inventory and keeps normal daily programming', () => {
  const location = { venueName: 'Big Fun Museum', municipality: 'Barcelona' };
  const items = Array.from({ length: 30 }, (_, day) => Array.from({ length: 4 }, (_, session) => {
    const date = new Date('2026-09-01T12:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + day);
    return {
      record: event({ eventId: `big-${day}-${session}`, eventName: 'Big Fun Museum', venue: { ...event().venue, venueId: 'big' } }),
      location, dates: { startDate: date.toISOString().slice(0, 10) },
    };
  })).flat();
  const result = detectRecurringInventory(items);
  assert.equal(result.skippedIds.size, 120);
  assert.equal(result.details[0].activeDays, 30);
  const daily = items.filter((_, index) => index % 4 === 0);
  assert.equal(detectRecurringInventory(daily).skippedIds.size, 0);
});

test('dry-run groups sessions, ignores non-ticketmaster sources, and writes nothing', async () => {
  await withTestDatabase(async (db) => {
    const records = [event(), event({ eventId: 'tm-2', eventStartLocalTime: '18:00' }), event({ eventId: 'fg-1', source: 'universe', brandName: 'Universe' })];
    const importer = new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { return records; } }, now: () => NOW,
    });
    const summary = await importer.run({ dryRun: true });
    assert.equal(summary.feedRecords, 3);
    assert.equal(summary.ticketmasterSource, 2);
    assert.equal(summary.acceptedTrium, 2);
    assert.equal(summary.excludedUniverse, 1);
    assert.equal(summary.newPlans, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM import_runs r JOIN sources s ON s.id=r.source_id WHERE s.key='ticketmaster-discovery-feed'").get().count, 0);
  });
});

test('persists grouped IDs idempotently and never stores Ticketmaster images', async () => {
  await withTestDatabase(async (db) => {
    const records = [event(), event({ eventId: 'tm-2', eventStartLocalTime: '18:00' })];
    const options = { db, client: { async downloadSpain() { return records; } }, now: () => NOW };
    await new TicketmasterDiscoveryFeedImporter(options).run();
    const second = await new TicketmasterDiscoveryFeedImporter(options).run();
    assert.equal(second.newPlans, 0);
    assert.equal(second.updates, 0);
    assert.equal(second.unchanged, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 2);
    const plan = db.prepare('SELECT schedule_text, image_url FROM plans').get();
    assert.equal(plan.schedule_text, '18:00, 20:00');
    assert.equal(plan.image_url, null);
    for (const row of db.prepare('SELECT source_payload_json FROM plan_sources').all()) {
      assert.equal(JSON.parse(row.source_payload_json).eventImageUrl, undefined);
    }
  });
});

test('reconciliation only removes Ticketmaster provenance after a complete valid feed', async () => {
  await withTestDatabase(async (db) => {
    const initial = new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { return [event(), event({ eventId: 'keep', eventName: 'Teatre', segmentName: 'Arts & Theatre' })]; } }, now: () => NOW,
    });
    await initial.run();
    await assert.rejects(new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { throw new Error('network failure'); } }, now: () => NOW,
    }).run(), /network failure/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 2);
    await assert.rejects(new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { return []; } }, now: () => NOW,
    }).run(), /buit/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 2);
    const complete = new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { return [event({ eventId: 'keep', eventName: 'Teatre', segmentName: 'Arts & Theatre' })]; } }, now: () => NOW,
    });
    const summary = await complete.run();
    assert.equal(summary.reconciliationRemovals, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 1);
    assert.deepEqual(db.prepare("SELECT status, inactive_at FROM plans WHERE original_title='Concert de prova'").get(), {
      status: 'inactive', inactive_at: NOW.toISOString(),
    });

    await initial.run();
    assert.deepEqual(db.prepare("SELECT status, inactive_at FROM plans WHERE original_title='Concert de prova'").get(), {
      status: 'active', inactive_at: null,
    });
  });
});

test('reconciliation preserves a Gencat plan and removes only its Ticketmaster provenance', async () => {
  await withTestDatabase(async (db) => {
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const ticketmaster = db.prepare("SELECT id FROM sources WHERE key='ticketmaster-discovery-feed'").get();
    const now = NOW.toISOString();
    const planId = Number(db.prepare(`INSERT INTO plans (
      kind, fingerprint, original_title, title_ca, start_date, end_date, permanent,
      image_reuse_allowed, featured, quality_score, status, created_at, updated_at
    ) VALUES ('event','shared-test','Pla Gencat','Pla Gencat','2026-08-18','2026-08-18',0,0,0,70,'active',?,?)`).run(now, now).lastInsertRowid);
    const insertSource = db.prepare(`INSERT INTO plan_sources (
      plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
    ) VALUES (?, ?, ?, '{}', ?, ?)`);
    insertSource.run(planId, gencat.id, 'gencat-1', now, now);
    insertSource.run(planId, ticketmaster.id, 'missing-tm', now, now);
    db.prepare("UPDATE plans SET status='inactive', inactive_at=? WHERE id=?").run('2026-08-01T00:00:00.000Z', planId);
    const importer = new TicketmasterDiscoveryFeedImporter({
      db, client: { async downloadSpain() { return [event({ eventId: 'other', eventName: 'Altre pla' })]; } }, now: () => NOW,
    });
    const summary = await importer.run();
    assert.equal(summary.reconciliationRemovals, 1);
    assert.deepEqual(db.prepare('SELECT status, inactive_at FROM plans WHERE id=?').get(planId), {
      status: 'active', inactive_at: null,
    });
    assert.deepEqual(db.prepare('SELECT source_id FROM plan_sources WHERE plan_id=?').all(planId), [{ source_id: gencat.id }]);
  });
});
