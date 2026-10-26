import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeCategories } from '../backend/src/normalizers/category.normalizer.js';
import { normalizeTicketmasterCategories } from '../backend/src/normalizers/ticketmasterCategory.normalizer.js';
import { feverCategorySlugs } from '../backend/src/fever/publicationPolicy.js';
import { categorySlugs as dibaCategorySlugs } from '../backend/src/diba/dibaImporter.js';
import {
  MANAGED_CATEGORIES, applyCategoryChanges, changeSetHash, classifyPayload, computeCategoryChanges, rollbackSql,
} from '../scripts/recategorize-plans.js';
import { withTestDatabase } from './helpers.js';

const REMOVED = ['muntanya', 'platges', 'bicicleta', 'miradors', 'monuments', 'pobles', 'parcs-jardins'];
const gencat = (...tags) => normalizeCategories({ tags_categor_es: tags.map((tag) => `agenda:${tag}`).join(',') });

test('the catalogue drops the seven place categories that no source can tag and gains exposicions, cinema and experiencies', () => {
  withTestDatabase((db) => {
    const slugs = db.prepare('SELECT slug FROM categories').pluck().all();
    for (const slug of REMOVED) assert.ok(!slugs.includes(slug), `${slug} is gone`);
    for (const slug of ['exposicions', 'cinema', 'experiencies']) assert.ok(slugs.includes(slug), `${slug} exists`);
    assert.equal(slugs.length, 14);
    assert.deepEqual(db.prepare("SELECT name_ca, name_es, group_name FROM categories WHERE slug = 'experiencies'").get(), { name_ca: 'Experiències', name_es: 'Experiencias', group_name: 'cultura' });
  });
});

test('the migration keeps a removed category that gained plans instead of orphaning its links', () => {
  withTestDatabase((db) => {
    // Simulate the state before migration 021 for one category that is in use.
    db.prepare("INSERT INTO categories (slug, name_ca, name_es, group_name, icon) VALUES ('platges', 'Platges', 'Playas', 'natura', 'umbrella-beach')").run();
    db.prepare(`INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent, province, quality_score, status, created_at, updated_at)
      VALUES ('event', 'fp-platja', 'ca', 'Platja', '2026-12-01', '2026-12-01', 0, 'Barcelona', 50, 'active', 'x', 'x')`).run();
    db.prepare("INSERT INTO plan_categories (plan_id, category_id) SELECT 1, id FROM categories WHERE slug = 'platges'").run();
    const migration = readFileSync(new URL('../backend/src/db/migrations/021_refresh_categories.sql', import.meta.url), 'utf8');
    db.exec(migration);
    assert.ok(db.prepare("SELECT 1 FROM categories WHERE slug = 'platges'").get(), 'a category with plans is not deleted');
    assert.equal(db.prepare("SELECT COUNT(*) FROM categories WHERE slug IN ('muntanya', 'bicicleta')").pluck().get(), 0);
  });
});

test('Gencat: exhibitions and films leave Cultura, and arts-visuals only counts as Cultura on its own', () => {
  assert.deepEqual(gencat('categories/exposicions'), ['exposicions']);
  assert.deepEqual(gencat('ambits/arts-visuals', 'categories/exposicions'), ['exposicions'], 'the broad arts-visuals tag does not add Cultura to an exhibition');
  assert.deepEqual(gencat('ambits/arts-visuals'), ['cultura']);
  assert.deepEqual(gencat('ambits/cinema'), ['cinema']);
  assert.deepEqual(gencat('categories/exposicions', 'ambits/divulgacio'), ['exposicions', 'cultura'], 'a real Cultura signal still counts');
  assert.deepEqual(gencat('categories/conferencies'), ['cultura']);
  assert.deepEqual(gencat('ambits/musica'), ['musica'], 'unrelated categories are untouched');
});

test('Ticketmaster: films are Cinema and only a generic cultural segment is Cultura', () => {
  assert.deepEqual(normalizeTicketmasterCategories({ classificationSegment: 'Film' }), ['cinema']);
  assert.deepEqual(normalizeTicketmasterCategories({ classificationSegment: 'Cultural' }), ['cultura']);
  assert.deepEqual(normalizeTicketmasterCategories({ classificationSegment: 'Music' }), ['musica']);
});

test('Fever: exhibitions, cinema and activity labels map to the new categories and "Other Experiences" alone does not', () => {
  assert.deepEqual(feverCategorySlugs('Exhibitions'), ['exposicions']);
  assert.deepEqual(feverCategorySlugs('Immersive Experiences & Exhibits, Other Experiences'), ['exposicions']);
  assert.deepEqual(feverCategorySlugs('Cinema'), ['cinema']);
  assert.deepEqual(feverCategorySlugs('Culture'), ['cultura']);
  assert.deepEqual(feverCategorySlugs('DIY Workshops, Other Experiences'), ['experiencies']);
  assert.deepEqual(feverCategorySlugs('Activities, Games'), ['experiencies']);
  assert.deepEqual(feverCategorySlugs('Beauty & Wellness, Other Experiences'), ['experiencies']);
  assert.deepEqual(feverCategorySlugs('Other Experiences'), [], 'too broad to be a signal');
});

test('DIBA: exhibitions and films get their own category, museums and stages keep theirs', () => {
  const item = (title, ...categories) => ({ title, categories });
  assert.deepEqual(dibaCategorySlugs('actesturisme_ca', item('Exposició de fotografia', 'Cultura')), ['exposicions']);
  assert.deepEqual(dibaCategorySlugs('actesturisme_ca', item('Cinema a la fresca')), ['cinema']);
  assert.deepEqual(dibaCategorySlugs('actesturisme_ca', item('Exposició al museu')), ['museus'], 'museum keeps priority');
  assert.deepEqual(dibaCategorySlugs('actesturisme_ca', item('Visita guiada urbana')), ['cultura']);
  assert.deepEqual(dibaCategorySlugs('escenari', item('Cinema d\'estiu')), ['cinema']);
  assert.deepEqual(dibaCategorySlugs('escenari', item('Concert de jazz')), ['musica']);
  assert.deepEqual(dibaCategorySlugs('escenari', item('Obra de teatre')), ['espectacles']);
  assert.deepEqual(dibaCategorySlugs('actesmuseus', item('Exposició')), ['museus']);
});

// ---- recategorisation script
const STAMP = '2026-01-01T00:00:00.000Z';
let counter = 0;
function addPlan(db, { sources, categories = [] }) {
  const id = Number(db.prepare(`INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent,
    province, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', 'Test', '2026-12-01', '2026-12-01', 0, 'Barcelona', 70, 'active', ?, ?)`).run(`fp|${counter += 1}`, STAMP, STAMP).lastInsertRowid);
  for (const { key, payload } of sources) {
    const sourceId = db.prepare('SELECT id FROM sources WHERE key = ?').get(key).id;
    db.prepare(`INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, sourceId, `rec-${counter}-${key}`, typeof payload === 'string' ? payload : JSON.stringify(payload), STAMP, STAMP);
  }
  for (const slug of categories) db.prepare('INSERT INTO plan_categories (plan_id, category_id) SELECT ?, id FROM categories WHERE slug = ?').run(id, slug);
  return id;
}
const categoriesOf = (db, id) => db.prepare('SELECT c.slug FROM plan_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.plan_id = ? ORDER BY c.slug').pluck().all(id);

function seed(db) {
  return {
    exhibition: addPlan(db, { categories: ['cultura'], sources: [{ key: 'gencat-agenda', payload: { tags_categor_es: 'agenda:categories/exposicions', tags_mbits: 'agenda:ambits/arts-visuals' } }] }),
    film: addPlan(db, { categories: ['cultura', 'musica'], sources: [{ key: 'gencat-agenda', payload: { tags_mbits: 'agenda:ambits/cinema,agenda:ambits/musica' } }] }),
    plainCulture: addPlan(db, { categories: ['cultura'], sources: [{ key: 'gencat-agenda', payload: { tags_mbits: 'agenda:ambits/divulgacio' } }] }),
    workshop: addPlan(db, { categories: ['gastronomia'], sources: [{ key: 'fever', payload: { SubCategory: 'Food & Drink, DIY Workshops' } }] }),
    merged: addPlan(db, { categories: ['cultura'], sources: [
      { key: 'gencat-agenda', payload: { tags_categor_es: 'agenda:categories/exposicions' } },
      { key: 'diba-tourisme', payload: { dataset: 'actesturisme_ca', titol: 'Visita guiada', categoria: ['Visita'] } },
    ] }),
    unreadable: addPlan(db, { categories: ['cultura'], sources: [{ key: 'gencat-agenda', payload: 'not json' }] }),
    unknownSource: addPlan(db, { categories: ['cultura'], sources: [{ key: 'gencat-agenda', payload: { tags_mbits: 'agenda:ambits/cinema' } }, { key: 'ticketmaster-discovery-feed', payload: 'not json' }] }),
    unchanged: addPlan(db, { categories: ['musica'], sources: [{ key: 'gencat-agenda', payload: { tags_mbits: 'agenda:ambits/musica' } }] }),
  };
}

test('the recategorisation dry-run lists only managed-category changes and writes nothing', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const before = db.prepare('SELECT plan_id, category_id FROM plan_categories ORDER BY 1, 2').all();
    const { scanned, skipped, changes } = computeCategoryChanges(db);
    assert.equal(scanned, 8);
    assert.equal(skipped, 2, 'unreadable payloads are skipped, never guessed');
    const byId = new Map(changes.map((change) => [change.id, change]));
    assert.deepEqual([...byId.keys()].sort((a, b) => a - b), [ids.exhibition, ids.film, ids.workshop, ids.merged].sort((a, b) => a - b));
    assert.deepEqual([byId.get(ids.exhibition).add, byId.get(ids.exhibition).remove], [['exposicions'], ['cultura']]);
    assert.deepEqual([byId.get(ids.film).add, byId.get(ids.film).remove], [['cinema'], ['cultura']]);
    assert.deepEqual([byId.get(ids.workshop).add, byId.get(ids.workshop).remove], [['experiencies'], []]);
    assert.deepEqual([byId.get(ids.merged).add, byId.get(ids.merged).remove], [['exposicions'], []], 'the union of both sources keeps Cultura from the DIBA visit');
    assert.deepEqual(db.prepare('SELECT plan_id, category_id FROM plan_categories ORDER BY 1, 2').all(), before);
  });
});

test('apply touches only managed categories, is idempotent and leaves other links alone', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const { changes } = computeCategoryChanges(db);
    applyCategoryChanges(db, { expectedChanges: changes.length, expectedHash: changeSetHash(changes) });
    assert.deepEqual(categoriesOf(db, ids.exhibition), ['exposicions']);
    assert.deepEqual(categoriesOf(db, ids.film), ['cinema', 'musica'], 'the musica link survives');
    assert.deepEqual(categoriesOf(db, ids.workshop), ['experiencies', 'gastronomia']);
    assert.deepEqual(categoriesOf(db, ids.merged), ['cultura', 'exposicions']);
    assert.deepEqual(categoriesOf(db, ids.unreadable), ['cultura'], 'skipped plans are untouched');
    assert.deepEqual(categoriesOf(db, ids.unchanged), ['musica']);
    assert.equal(computeCategoryChanges(db).changes.length, 0, 'a second run finds nothing');
  });
});

test('apply aborts without writing when the count or the change set no longer matches', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const { changes } = computeCategoryChanges(db);
    assert.throws(() => applyCategoryChanges(db, { expectedChanges: 99, expectedHash: changeSetHash(changes) }), /Expected 99 changes/);
    assert.throws(() => applyCategoryChanges(db, { expectedChanges: changes.length, expectedHash: '0'.repeat(12) }), /set of changes differs/);
    assert.deepEqual(categoriesOf(db, ids.exhibition), ['cultura'], 'nothing was written');
  });
});

test('a failure after the first write rolls the whole run back', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    db.exec(`CREATE TRIGGER fail_on_delete BEFORE DELETE ON plan_categories WHEN OLD.plan_id = ${ids.merged + 99} BEGIN SELECT 1; END;
      CREATE TRIGGER fail_on_insert BEFORE INSERT ON plan_categories WHEN NEW.plan_id = ${ids.workshop} BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    const { changes } = computeCategoryChanges(db);
    assert.throws(() => applyCategoryChanges(db, { expectedChanges: changes.length, expectedHash: changeSetHash(changes) }), /boom/);
    assert.deepEqual(categoriesOf(db, ids.exhibition), ['cultura'], 'earlier writes are undone');
  });
});

test('the generated rollback SQL restores the previous links exactly', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const snapshot = db.prepare('SELECT plan_id, category_id FROM plan_categories ORDER BY 1, 2').all();
    const applied = applyCategoryChanges(db, { ...(() => { const { changes } = computeCategoryChanges(db); return { expectedChanges: changes.length, expectedHash: changeSetHash(changes) }; })() });
    assert.notDeepEqual(db.prepare('SELECT plan_id, category_id FROM plan_categories ORDER BY 1, 2').all(), snapshot);
    db.exec(`BEGIN; ${rollbackSql(applied.changes).join('\n')}\nCOMMIT;`);
    assert.deepEqual(db.prepare('SELECT plan_id, category_id FROM plan_categories ORDER BY 1, 2').all(), snapshot);
    assert.deepEqual(categoriesOf(db, ids.exhibition), ['cultura']);
  });
});

test('the script refuses to run before migration 021 and classifies each source with its own rules', () => {
  withTestDatabase((db) => {
    db.exec("DELETE FROM categories WHERE slug = 'cinema'");
    assert.throws(() => computeCategoryChanges(db), /deploy migration 021 first/);
  });
  assert.deepEqual(MANAGED_CATEGORIES, ['cultura', 'exposicions', 'cinema', 'experiencies']);
  assert.deepEqual(classifyPayload('fever', { SubCategory: 'Cinema' }), ['cinema']);
  assert.deepEqual(classifyPayload('diba-escenari', { dataset: 'escenari', titol: 'Concert', categoria: ['escenari'], tags: ['escenari'] }), ['musica']);
  assert.equal(classifyPayload('unknown-source', {}), null);
});
