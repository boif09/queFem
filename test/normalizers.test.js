import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlan } from '../backend/src/normalizers/plan.normalizer.js';

test('normalizes verified Gencat fields and never reuses an image', () => {
  const normalized = normalizePlan({
    codi: '20260817001',
    denominaci: 'El Concert d’estiu',
    descripcio: 'Text original',
    subt_tol: '<p>Per a tota la família</p>',
    data_inici: '2026-08-17T00:00:00.000',
    data_fi: '2026-08-18T00:00:00.000',
    tags_mbits: 'agenda:ambits/musica',
    tags_categor_es: 'agenda:categories/infantil,agenda:categories/concerts',
    entrades: '<p>Activitat gratuïta</p>',
    gratuita: 'Sí',
    permanent: 'No',
    destacada: 'Sí',
    municipi: 'agenda:ubicacions/girona/baix-emporda/palafrugell',
    comarca: 'agenda:ubicacions/girona/baix-emporda',
    espai: 'Plaça Nova',
    latitud: '41.917',
    longitud: '3.164',
    imatges: '/content/dam/agenda/example.jpg',
  });

  assert.equal(normalized.plan.original_title, 'El Concert d’estiu');
  assert.equal(normalized.plan.original_description, 'Text original');
  assert.equal(normalized.plan.title_es, null);
  assert.equal(normalized.plan.start_date, '2026-08-17');
  assert.equal(normalized.plan.province, 'Girona');
  assert.equal(normalized.plan.comarca, 'Baix Emporda');
  assert.equal(normalized.plan.municipality, 'Palafrugell');
  assert.equal(normalized.plan.is_free, 1);
  assert.equal(normalized.plan.image_url, null);
  assert.equal(normalized.plan.image_reuse_allowed, 0);
  assert.deepEqual(normalized.categorySlugs, ['familia', 'musica']);
  assert.equal(normalized.plan.fingerprint, 'concert-estiu|palafrugell|2026-08-17');
});

test('skips records without the two official identity fields', () => {
  assert.equal(normalizePlan({ codi: '1' }), null);
  assert.equal(normalizePlan({ denominaci: 'Sense codi' }), null);
});
