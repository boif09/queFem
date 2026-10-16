import fs from 'node:fs';
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

// Gencat only publishes comarca and municipality as de-accented URL slugs ("barcelones"), which cannot be turned back
// into Catalan on their own. This restores the official spelling (accents, apostrophes, hyphens) from the ICGC names
// the project already ships for the embeddable widget. A name that has no unambiguous official match is returned
// untouched, so the worst case is today's behaviour. Display convention: the first letter is capitalised ("El Masnou",
// where the ICGC writes "el Masnou").
const INDEX_URL = new URL('../embed/officialPlaceNames.json', import.meta.url);

// Names Gencat spells differently from the ICGC, not just without accents. Keys are matched after
// normalizeForFingerprint(); every target must exist in the official index (checked when the restorer is built).
// Comarca is not part of any plan fingerprint, so a comarca alias is safe.
export const COMARCA_ALIASES = { Aran: "Val d'Aran" };
// Deliberately empty: plan fingerprints are built from normalizeForFingerprint(municipality), and restoring accents,
// apostrophes, hyphens and case never changes that key. An alias that changes the words ("Bigues i Riells" to
// "Bigues i Riells del Fai") would, so a plan stored before and one imported after could stop deduplicating. Those
// few renamed municipalities keep the name Gencat gives them.
export const MUNICIPALITY_ALIASES = {};

function capitalise(value) {
  return value.charAt(0).toLocaleUpperCase('ca') + value.slice(1);
}

function buildIndex(officialNames, aliases, label) {
  const byKey = new Map();
  for (const name of officialNames) {
    const key = normalizeForFingerprint(name);
    const known = byKey.get(key);
    // Two different official names with the same key would make a match a guess: neither is ever used.
    if (known !== undefined && known !== name) byKey.set(key, null);
    else if (known === undefined) byKey.set(key, name);
  }
  const official = new Set(officialNames);
  for (const [alias, target] of Object.entries(aliases)) {
    if (!official.has(target)) throw new Error(`Place name alias "${alias}" points to an unknown official ${label}: ${target}`);
    byKey.set(normalizeForFingerprint(alias), target);
  }
  return byKey;
}

export class PlaceNameRestorer {
  constructor(index = JSON.parse(fs.readFileSync(INDEX_URL, 'utf8')), { comarcaAliases = COMARCA_ALIASES, municipalityAliases = MUNICIPALITY_ALIASES } = {}) {
    this.comarques = buildIndex([...new Set(index.municipalities.map((entry) => entry.comarca))], comarcaAliases, 'comarca');
    this.municipalities = buildIndex(index.municipalities.map((entry) => entry.name), municipalityAliases, 'municipality');
  }

  static restore(value, byKey) {
    if (typeof value !== 'string' || !value.trim()) return value;
    const official = byKey.get(normalizeForFingerprint(value));
    return official ? capitalise(official) : value;
  }

  restoreComarca(value) { return PlaceNameRestorer.restore(value, this.comarques); }

  restoreMunicipality(value) { return PlaceNameRestorer.restore(value, this.municipalities); }
}

let shared;
export function defaultPlaceNameRestorer() {
  shared ??= new PlaceNameRestorer();
  return shared;
}
