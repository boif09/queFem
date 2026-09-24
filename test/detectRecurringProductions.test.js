import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { loadCandidateRecords, runDetection } from '../backend/src/jobs/detectRecurringProductions.js';

const NOW = '2026-09-24T10:00:00.000Z';

function insertPlan(db, { fingerprint, title, venue, startDate, ticketUrl = null, description = null, lat = 41.3875556, lon = 2.1752406 }) {
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, original_description,
      start_date, permanent, venue_name, municipality, latitude, longitude,
      ticket_url, quality_score, status, created_at, updated_at
    ) VALUES (
      'event', @fingerprint, 'ca', @title, @description,
      @startDate, 0, @venue, 'Barcelona', @lat, @lon,
      @ticketUrl, 70, 'active', @createdAt, @updatedAt
    )
  `).run({ fingerprint, title, description, startDate, venue, lat, lon, ticketUrl, createdAt: NOW, updatedAt: NOW }).lastInsertRowid);
}

function insertGencatSource(db, planId, recordId, payload) {
  const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(planId, source.id, recordId, JSON.stringify(payload), NOW, NOW);
}

test('loadCandidateRecords reads Gencat plans and extracts the image filename list from the raw payload', () => {
  withTestDatabase((db) => {
    const ticketUrl = 'https://www.grangalaflamenco.com/reservar/';
    const description = 'Gran Gala Flamenc ofereix als seus espectadors un viatge.';
    for (let i = 0; i < 3; i += 1) {
      const planId = insertPlan(db, {
        fingerprint: `gran-gala-flamenc|barcelona|2026-0${9 + i}-25`,
        title: 'Gran Gala Flamenc', venue: 'Palau de la Música Catalana',
        startDate: `2026-${String(9 + i).padStart(2, '0')}-25`, ticketUrl, description,
      });
      insertGencatSource(db, planId, `2026040208${i}@hash${i}`, {
        codi: `2026040208${i}`, denominaci: 'Gran Gala Flamenc',
        imatges: `/content/dam/agenda/2026/04/02/08${i}/annexos/photo1.jpg,/content/dam/agenda/2026/04/02/08${i}/annexos/photo2.jpg`,
      });
    }

    const records = loadCandidateRecords(db, { sources: ['gencat-agenda'] });
    assert.equal(records.length, 3);
    assert.equal(records[0].source, 'gencat-agenda');
    assert.equal(records[0].ticketUrl, ticketUrl);
    assert.equal(records[0].description, description);
    assert.ok(records[0].imageUrls.includes('photo1.jpg'));

    const results = runDetection(db, { sources: ['gencat-agenda'] });
    assert.equal(results.length, 1);
    assert.equal(results[0].classification, 'SAFE_AUTOMATIC');
    assert.equal(results[0].occurrenceCount, 3);
  });
});

test('loadCandidateRecords ignores inactive plans and plans with no start_date', () => {
  withTestDatabase((db) => {
    const activeId = insertPlan(db, { fingerprint: 'a|barcelona|2026-09-25', title: 'A', venue: 'V', startDate: '2026-09-25' });
    insertGencatSource(db, activeId, 'rec-active', { codi: 'rec-active' });

    db.prepare(`
      INSERT INTO plans (kind, fingerprint, original_title, start_date, permanent, venue_name, quality_score, status, created_at, updated_at)
      VALUES ('event', 'b|barcelona|2026-09-26', 'B', '2026-09-26', 0, 'V', 70, 'inactive', ?, ?)
    `).run(NOW, NOW);
    const inactiveId = db.prepare("SELECT id FROM plans WHERE fingerprint = 'b|barcelona|2026-09-26'").get().id;
    insertGencatSource(db, inactiveId, 'rec-inactive', { codi: 'rec-inactive' });

    const records = loadCandidateRecords(db, { sources: ['gencat-agenda'] });
    assert.equal(records.length, 1);
    assert.equal(records[0].planId, activeId);
  });
});

test('runDetection works against a genuinely readonly connection (structurally cannot write)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-test-'));
  const dbPath = path.join(directory, 'test.sqlite');
  try {
    const writable = openDatabase(dbPath);
    migrate(writable);
    const ticketUrl = 'https://example.test/tickets';
    for (let i = 0; i < 3; i += 1) {
      const planId = insertPlan(writable, {
        fingerprint: `show|barcelona|2026-1${i}-01`,
        title: 'Show', venue: 'Venue', startDate: `2026-1${i}-01`, ticketUrl,
        description: 'A description shared across all occurrences of this show.',
      });
      insertGencatSource(writable, planId, `rec-${i}`, { codi: `rec-${i}`, imatges: '/x/photo.jpg' });
    }
    writable.close();

    // A readonly better-sqlite3 handle physically cannot execute a write
    // statement — if loadCandidateRecords/runDetection ever issued one, this
    // would throw SQLITE_READONLY. It doesn't, because they only ever call
    // .prepare(...).all().
    const readonly = openDatabase(dbPath, { readonly: true });
    try {
      const results = runDetection(readonly, { sources: ['gencat-agenda'] });
      assert.equal(results.length, 1);
      assert.equal(results[0].classification, 'SAFE_AUTOMATIC');
    } finally {
      readonly.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
