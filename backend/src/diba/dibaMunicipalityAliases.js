import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

const aliases = [
  { literal: 'Fogars de Monclús', municipality: 'Fogars de Montclús', ine: '08081', ruleId: 'diba-municipality-alias-fogars-de-monclus-v1' },
  { literal: 'La Poble de Lillet', municipality: 'la Pobla de Lillet', ine: '08166', ruleId: 'diba-municipality-alias-poble-de-lillet-v1' },
  { literal: 'El Pont de Vilomara', municipality: 'el Pont de Vilomara i Rocafort', ine: '08182', ruleId: 'diba-municipality-alias-pont-de-vilomara-v1' },
];
const localities = [
  { literal: "Sant Pau d'Ordal", municipality: 'Subirats', ine: '08273', ruleId: 'diba-locality-parent-sant-pau-d-ordal-v1' },
];

function normalized(value) { return normalizeForFingerprint(value, { removeArticles: true }); }
function literalMatch(left, right) { return normalized(left) === normalized(right); }

export function resolveDibaMunicipalityPolicy(record) {
  const rawLiteral = String(record.rawMunicipalityName || '').trim() || null;
  const audit = record.analysis || {};
  const base = { rawLiteral, deterministic: false, activationBlocker: false, municipality: null, comarca: null, ine: null, ruleId: null };
  if (!rawLiteral) return { ...base, resolutionType: 'UNRESOLVED_MISSING', activationBlocker: false };
  if (audit.bucket === 'EXACT_MUNICIPALITY_NAME_CANDIDATE' || audit.bucket === 'NORMALIZED_MUNICIPALITY_NAME_CANDIDATE') {
    return { ...base, resolutionType: audit.bucket === 'EXACT_MUNICIPALITY_NAME_CANDIDATE' ? 'EXACT_MUNICIPALITY' : 'NORMALIZED_MUNICIPALITY', municipality: audit.candidateMunicipality, ine: audit.candidateIne, deterministic: true, ruleId: audit.bucket.toLowerCase() };
  }
  const alias = aliases.find(({ literal }) => literalMatch(literal, rawLiteral));
  if (alias) return { ...base, resolutionType: 'EXPLICIT_MUNICIPALITY_ALIAS', municipality: alias.municipality, ine: alias.ine, deterministic: true, ruleId: alias.ruleId };
  const locality = localities.find(({ literal }) => literalMatch(literal, rawLiteral));
  if (locality) return { ...base, resolutionType: 'EXPLICIT_LOCALITY_PARENT', municipality: locality.municipality, ine: locality.ine, deterministic: true, ruleId: locality.ruleId };
  if (audit.bucket === 'COMARCA_OR_REGION') return { ...base, resolutionType: 'COMARCA_ONLY', comarca: rawLiteral, deterministic: true, ruleId: 'icgc-comarca-exact-v1' };
  if (audit.bucket === 'MULTI_AREA_OR_SUPRAMUNICIPAL') return { ...base, resolutionType: 'UNRESOLVED_SUPRAMUNICIPAL' };
  return { ...base, resolutionType: 'UNRESOLVED_REVIEW' };
}

export const DIBA_MUNICIPALITY_POLICY_ALIASES = Object.freeze({ aliases, localities });
