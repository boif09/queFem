import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeForFingerprint } from '../backend/src/normalizers/text.normalizer.js';
import { normalizeLocation } from '../backend/src/normalizers/location.normalizer.js';
import { MUNICIPALITY_ALIASES, PlaceNameRestorer, defaultPlaceNameRestorer } from '../backend/src/location/placeNameRestorer.js';

const restorer = defaultPlaceNameRestorer();

test('comarca names regain their official accents', () => {
  assert.equal(restorer.restoreComarca('Barcelones'), 'Barcelonès');
  assert.equal(restorer.restoreComarca('Valles Oriental'), 'Vallès Oriental');
  assert.equal(restorer.restoreComarca('Alt Emporda'), 'Alt Empordà');
  assert.equal(restorer.restoreComarca('Alta Ribagorca'), 'Alta Ribagorça');
  assert.equal(restorer.restoreComarca("Pla D'Urgell"), "Pla d'Urgell", 'apostrophe words follow the official case');
});

test('municipality names regain accents, hyphens and official apostrophes, with a leading capital', () => {
  assert.equal(restorer.restoreMunicipality('Alcarras'), 'Alcarràs');
  assert.equal(restorer.restoreMunicipality('Cornella de Llobregat'), 'Cornellà de Llobregat');
  assert.equal(restorer.restoreMunicipality("Esterri D'Aneu"), "Esterri d'Àneu");
  assert.equal(restorer.restoreMunicipality('Palau Solita i Plegamans'), 'Palau-solità i Plegamans');
  assert.equal(restorer.restoreMunicipality('el Masnou'), 'El Masnou', 'the ICGC writes the article in lower case; the UI capitalises it');
  assert.equal(restorer.restoreMunicipality("l'Hospitalet de Llobregat"), "L'Hospitalet de Llobregat");
});

test('Gencat names the ICGC renamed use an explicit alias for comarca only', () => {
  assert.equal(restorer.restoreComarca('Aran'), "Val d'Aran");
  assert.deepEqual(MUNICIPALITY_ALIASES, {}, 'a municipality alias would change the plan fingerprint');
  assert.equal(restorer.restoreMunicipality('Bigues i Riells'), 'Bigues i Riells', 'renamed municipalities keep the name Gencat gives them');
  assert.equal(restorer.restoreMunicipality("Castell Platja D'Aro"), "Castell Platja D'Aro");
});

test('restoring a municipality never changes its fingerprint key, for every official name', () => {
  const strip = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const { municipalities } = JSON.parse(readFileSync(new URL('../backend/src/embed/officialPlaceNames.json', import.meta.url), 'utf8'));
  assert.ok(municipalities.length > 900);
  for (const { name } of municipalities) {
    for (const stored of [strip(name), strip(name).toLowerCase(), name]) {
      assert.equal(normalizeForFingerprint(restorer.restoreMunicipality(stored)), normalizeForFingerprint(stored), stored);
    }
  }
});

test('unknown names, empty values and non-strings are returned untouched', () => {
  assert.equal(restorer.restoreComarca('Atlantida'), 'Atlantida');
  assert.equal(restorer.restoreMunicipality('Poble Inventat'), 'Poble Inventat');
  assert.equal(restorer.restoreComarca(null), null);
  assert.equal(restorer.restoreMunicipality(''), '');
  assert.equal(restorer.restoreMunicipality(undefined), undefined);
});

test('restoring is idempotent and keeps already official names as they are', () => {
  for (const value of ['Barcelones', 'Vallès Oriental', "Val d'Aran", 'Maresme']) {
    const once = restorer.restoreComarca(value);
    assert.equal(restorer.restoreComarca(once), once);
  }
  for (const value of ['Alcarras', 'Sabadell', 'Bossòst', 'el Masnou']) {
    const once = restorer.restoreMunicipality(value);
    assert.equal(restorer.restoreMunicipality(once), once);
  }
  assert.equal(restorer.restoreMunicipality('Sabadell'), 'Sabadell');
});

test('two official names that normalise to the same key are never guessed', () => {
  const ambiguous = new PlaceNameRestorer({
    municipalities: [
      { name: 'Sant Joan', comarca: 'A' },
      { name: 'Sant Joán', comarca: 'B' },
      { name: 'Vic', comarca: 'A' },
    ],
  }, { comarcaAliases: {}, municipalityAliases: {} });
  assert.equal(ambiguous.restoreMunicipality('Sant Joan'), 'Sant Joan', 'ambiguous key: left untouched');
  assert.equal(ambiguous.restoreMunicipality('Vic'), 'Vic');
});

test('an alias that points to a name missing from the official index is rejected', () => {
  assert.throws(() => new PlaceNameRestorer({ municipalities: [{ name: 'Vic', comarca: 'Osona' }] }), /unknown official/, 'the real aliases are not in this tiny index');
  assert.throws(() => new PlaceNameRestorer({ municipalities: [{ name: 'Vic', comarca: 'Osona' }] }, { comarcaAliases: { Osonaa: 'Osoná' }, municipalityAliases: {} }), /unknown official comarca/);
  assert.doesNotThrow(() => new PlaceNameRestorer({ municipalities: [{ name: 'Vic', comarca: 'Osona' }] }, { comarcaAliases: { Osonaa: 'Osona' }, municipalityAliases: {} }));
});

test('the Gencat location normalizer restores comarca, municipality and a locality that is an official municipality, and leaves province alone', () => {
  const location = normalizeLocation({ municipi: 'agenda:ubicacions/barcelona/barcelones/sant-adria-de-besos', localitat: 'Poble sec' });
  assert.equal(location.province, 'Barcelona');
  assert.equal(location.comarca, 'Barcelonès');
  assert.equal(location.municipality, 'Sant Adrià de Besòs');
  assert.equal(location.locality, 'Poble sec', 'a neighbourhood is not an official municipality and keeps its value');
  assert.equal(normalizeLocation({ localitat: 'Cornellà de llobregat' }).locality, 'Cornellà de Llobregat');
  assert.equal(normalizeLocation({ localitat: "L'hospitalet de llobregat" }).locality, "L'Hospitalet de Llobregat");
  assert.equal(normalizeLocation({ localitat: 'Cornella de Llobregat' }).locality, 'Cornellà de Llobregat', 'accents are restored too');
  assert.equal(normalizeLocation({ localitat: 'Paris' }).locality, 'Paris', 'a place outside Catalonia is untouched');
  assert.equal(normalizeLocation({}).locality, null);
  assert.equal(normalizeLocation({ municipi: 'agenda:ubicacions/lleida/aran/bossost' }).comarca, "Val d'Aran");
  const unknown = normalizeLocation({ municipi: 'agenda:ubicacions/barcelona/comarca-inventada/poble-inventat' });
  assert.equal(unknown.comarca, 'Comarca Inventada');
  assert.equal(unknown.municipality, 'Poble Inventat');
});
