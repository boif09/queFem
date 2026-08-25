import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function ranked(map, limit = Infinity) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'ca'))
    .slice(0, limit);
}

export function analyzeFeverGeography(normalizationResult, resolver, { exampleLimit = 5 } = {}) {
  const provinces = new Map();
  const comarques = new Map();
  const municipalities = new Map();
  const distinctMunicipalityCodes = new Set();
  const distinctComarcaCodes = new Set();
  const distinctProvinceCodes = new Set();
  const examples = {
    unresolved: [], ambiguous: [], suspicious: [],
    publicableUnresolved: [], publicableAmbiguous: [],
  };
  const resolvedProducts = [];
  const summary = {
    eligibleProducts: normalizationResult.summary.products.eligibleNonGift,
    publishableProducts: normalizationResult.summary.products.withPublishableOccurrence,
    coordinatesReceived: 0,
    resolved: 0,
    unresolved: 0,
    ambiguous: 0,
    suspicious: 0,
    publicableGeography: { resolved: 0, unresolved: 0, ambiguous: 0 },
    emptyCodes: 0,
    emptyNames: 0,
    text2MatchesMunicipality: 0,
    text2DoesNotMatchMunicipality: 0,
    bboxCandidates: { total: 0, average: 0, maximum: 0 },
  };

  for (const product of normalizationResult.normalizedProducts) {
    if (!product.coordinatesValid) continue;
    summary.coordinatesReceived += 1;
    const resolution = resolver.resolve(product.coordinates);
    const publicable = product.publishableOccurrences.length > 0;
    summary.bboxCandidates.total += resolution.diagnostics.bboxCandidates;
    summary.bboxCandidates.maximum = Math.max(
      summary.bboxCandidates.maximum, resolution.diagnostics.bboxCandidates,
    );
    if (resolution.diagnostics.suspicious) {
      summary.suspicious += 1;
      if (examples.suspicious.length < exampleLimit) examples.suspicious.push({
        catalogItemId: product.productId, name: product.name, coordinates: product.coordinates,
      });
    }
    if (resolution.status !== 'match') {
      summary[resolution.status] += 1;
      if (examples[resolution.status].length < exampleLimit) examples[resolution.status].push({
        catalogItemId: product.productId,
        name: product.name,
        coordinates: product.coordinates,
        candidates: resolution.candidates.map(({ municipality }) => municipality),
      });
      if (publicable) {
        summary.publicableGeography[resolution.status] += 1;
        const key = resolution.status === 'unresolved' ? 'publicableUnresolved' : 'publicableAmbiguous';
        if (examples[key].length < exampleLimit) examples[key].push({
          catalogItemId: product.productId,
          name: product.name,
          coordinates: product.coordinates,
          reason: resolution.status === 'unresolved'
            ? 'no ICGC municipality polygon contains the coordinate'
            : 'more than one ICGC municipality polygon contains the coordinate',
          candidates: resolution.candidates.map(({ municipality }) => municipality),
        });
      }
      resolvedProducts.push({ product, geography: resolution });
      continue;
    }

    summary.resolved += 1;
    if (publicable) summary.publicableGeography.resolved += 1;
    increment(provinces, resolution.province.name);
    increment(comarques, resolution.comarca.name);
    increment(municipalities, resolution.municipality.name);
    distinctProvinceCodes.add(resolution.province.code);
    distinctComarcaCodes.add(resolution.comarca.code);
    distinctMunicipalityCodes.add(resolution.municipality.code);
    for (const area of [resolution.municipality, resolution.comarca, resolution.province]) {
      if (!area.code) summary.emptyCodes += 1;
      if (!area.name) summary.emptyNames += 1;
    }
    if (normalizeForFingerprint(product.text2) === normalizeForFingerprint(resolution.municipality.name)) {
      summary.text2MatchesMunicipality += 1;
    } else {
      summary.text2DoesNotMatchMunicipality += 1;
    }
    resolvedProducts.push({ product, geography: resolution });
  }

  summary.bboxCandidates.average = summary.coordinatesReceived
    ? summary.bboxCandidates.total / summary.coordinatesReceived : 0;
  summary.distinctMunicipalities = distinctMunicipalityCodes.size;
  summary.distinctComarques = distinctComarcaCodes.size;
  summary.distinctProvinces = distinctProvinceCodes.size;
  summary.byProvince = ranked(provinces);
  summary.topComarques = ranked(comarques, 15);
  summary.topMunicipalities = ranked(municipalities, 15);
  summary.examples = examples;
  return { summary, resolvedProducts };
}
