import fs from 'node:fs';
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

// Official municipality, comarca and province names derived from the ICGC snapshot by
// `npm run geography:icgc:names`. Kept apart from the M4A resolver so the API never loads polygons.
const INDEX_URL = new URL('./officialPlaceNames.json', import.meta.url);

export class OfficialPlaceNames {
  constructor(index) {
    this.provider = index.provider;
    this.datasetDate = index.datasetDate;
    this.municipalities = new Map();
    this.comarques = new Map();
    this.provinces = new Map();
    for (const entry of index.municipalities) {
      this.municipalities.set(normalizeForFingerprint(entry.name), entry);
      this.provinces.set(normalizeForFingerprint(entry.province), { code: entry.provinceCode, name: entry.province });
      const comarcaKey = normalizeForFingerprint(entry.comarca);
      if (!this.comarques.has(comarcaKey)) {
        this.comarques.set(comarcaKey, {
          code: entry.comarcaCode, name: entry.comarca, province: entry.province,
        });
      }
    }
  }

  static load(url = INDEX_URL) {
    return new OfficialPlaceNames(JSON.parse(fs.readFileSync(url, 'utf8')));
  }

  findMunicipality(name) {
    return this.municipalities.get(normalizeForFingerprint(name ?? '')) || null;
  }

  findComarca(name) {
    return this.comarques.get(normalizeForFingerprint(name ?? '')) || null;
  }

  findProvince(name) {
    return this.provinces.get(normalizeForFingerprint(name ?? '')) || null;
  }

  // Sources such as DIBA publish names without accents ("Palamos"); show the official form.
  officialMunicipalityName(name) {
    return this.findMunicipality(name)?.name || name || null;
  }
}
