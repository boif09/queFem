import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORY_POOL_BY_PLAN_CATEGORY,
  DEFAULT_FALLBACK_ASSET_ROOT,
  loadFallbackImageLibrary,
  stableHash,
} from '../backend/src/images/fallbackImageLibrary.js';

const library = loadFallbackImageLibrary({
  assetExists: () => true,
  assetRoot: DEFAULT_FALLBACK_ASSET_ROOT,
});

function plan(overrides = {}) {
  return {
    fingerprint: 'generic-image-plan',
    title: 'Activitat cultural',
    categories: [{ slug: 'cultura' }],
    ...overrides,
  };
}

test('generic image manifest is complete, auditable and never event-specific', () => {
  assert.equal(library.items.length, 100);
  assert.equal(new Set(library.items.map(({ id }) => id)).size, 100);
  assert.equal(new Set(library.items.map(({ local_filename: filename }) => filename)).size, 100);
  assert.deepEqual(Object.keys(CATEGORY_POOL_BY_PLAN_CATEGORY).sort(), [
    'bicicleta', 'cultura', 'espectacles', 'familia', 'festes', 'fires-mercats',
    'gastronomia', 'miradors', 'monuments', 'muntanya', 'museus', 'natura',
    'parcs-jardins', 'patrimoni', 'platges', 'pobles', 'senderisme', 'musica',
  ].sort());
  for (const item of library.items) {
    assert.equal(item.generic_only, true);
    assert.equal(item.event_specific, false);
    assert.equal(item.jsonld_event_image_eligible, false);
    assert.ok(item.pexels_photo_id);
    assert.match(item.source_page, /^https:\/\/www\.pexels\.com\//);
    assert.ok(item.photographer && item.license && item.license_url && item.selected_at);
  }
});

test('generic resolver is deterministic, distributed and uses the explicit category map', () => {
  const first = library.resolve(plan({ fingerprint: 'same-event' }), { role: 'card', language: 'ca' });
  const second = library.resolve(plan({ fingerprint: 'same-event' }), { role: 'card', language: 'ca' });
  assert.deepEqual(first, second);
  assert.equal(first.category, 'cultura');
  assert.match(first.url, /^\/media\/fallbacks\/card\/cultura\//);
  assert.doesNotMatch(first.url, /pexels\.com|images\.pexels\.com/);
  assert.match(first.alt, /^Imatge orientativa:/);
  assert.equal(library.resolve(plan({ fingerprint: 'same-event' }), { role: 'detail', language: 'es' }).alt.startsWith('Imagen orientativa:'), true);

  const selected = new Set(Array.from({ length: 30 }, (_, index) => library.resolve(plan({ fingerprint: `different-${index}` })).id));
  assert.ok(selected.size > 1);
  assert.equal(library.resolve(plan({ categories: [{ slug: 'senderisme' }] })).category, 'natura');
  assert.equal(library.resolve(plan({ categories: [{ slug: 'monuments' }] })).category, 'patrimoni');
  assert.equal(library.resolve(plan({ categories: [], title: 'Tast de vins locals' })).category, 'gastronomia');
  assert.equal(library.resolve(plan({ categories: [], title: 'Sense senyal conegut' })).category, 'cultura');
  assert.equal(stableHash('same-event'), stableHash('same-event'));
});

test('missing local generic binary returns no image so the graphical fallback remains safe', () => {
  const withoutAssets = loadFallbackImageLibrary({
    assetExists: () => false,
    assetRoot: DEFAULT_FALLBACK_ASSET_ROOT,
  });
  assert.equal(withoutAssets.resolve(plan()), null);
});
