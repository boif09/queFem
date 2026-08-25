import { isGiftCard } from './discoveryPolicy.js';
import {
  FEVER_CAMPAIGN_ID, FEVER_CATALOG_ID, isCataloniaFeverItem, normalizeFeverItem,
} from './itemNormalizer.js';

const CATALONIA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
});

function todayInCatalonia(now) {
  return CATALONIA_DATE.format(now);
}

function addDays(localDate, days) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDate(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

function distributionBucket(count) {
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  if (count <= 10) return 'twoToTen';
  if (count <= 50) return 'elevenToFifty';
  return 'fiftyOnePlus';
}

function updateMinimum(current, value) {
  return current === null || value < current ? value : current;
}

function updateMaximum(current, value) {
  return current === null || value > current ? value : current;
}

function anomalyCollector(limitPerReason = 3, totalLimit = 30) {
  const examples = [];
  const counts = new Map();
  return {
    add(product, reason, value) {
      const count = counts.get(reason) || 0;
      counts.set(reason, count + 1);
      if (examples.length >= totalLimit || count >= limitPerReason) return;
      examples.push({
        catalogItemId: product.productId,
        name: product.name,
        reason,
        ...(value !== null && value !== undefined && value !== ''
          ? { value: String(value).replace(/\s+/g, ' ').trim().slice(0, 120) }
          : {}),
      });
    },
    result() { return examples; },
  };
}

function productExample(product, occurrences) {
  const dates = occurrences.map(({ localDate }) => localDate).sort();
  return {
    catalogItemId: product.productId,
    name: product.name,
    firstSession: dates[0] || null,
    lastSession: dates.at(-1) || null,
  };
}

function addLimitedExample(group, product, occurrences, limit = 3) {
  if (group.examples.length < limit) group.examples.push(productExample(product, occurrences));
}

export function analyzeFeverNormalization(download, {
  lookaheadDays = 365,
  now = new Date(),
} = {}) {
  const today = todayInCatalonia(now);
  const horizonEnd = addDays(today, lookaheadDays);
  const matchingCatalogCampaign = download.items.filter((item) => String(item?.CatalogId) === FEVER_CATALOG_ID
    && String(item?.CampaignId) === FEVER_CAMPAIGN_ID);
  const cataloniaItems = download.items.filter(isCataloniaFeverItem);
  const giftCards = cataloniaItems.filter(isGiftCard);
  const eligibleItems = cataloniaItems.filter((item) => !isGiftCard(item));
  const anomalies = anomalyCollector();
  const normalizedProducts = [];
  const summary = {
    today,
    horizonEnd,
    lookaheadDays,
    products: {
      pages: download.pages,
      spainItems: download.items.length,
      matchingCatalogCampaign: matchingCatalogCampaign.length,
      cataloniaItems: cataloniaItems.length,
      giftCardsExcluded: giftCards.length,
      eligibleNonGift: eligibleItems.length,
      withParsedOccurrence: 0,
      withPublishableOccurrence: 0,
      withoutValidOccurrence: 0,
    },
    sessions: {
      tokens: 0, parsed: 0, invalid: 0, duplicates: 0,
      dateOnly: 0, withTime: 0, withOffsetOrZ: 0, withTimeWithoutOffset: 0,
      past: 0, future: 0, futureWithinHorizon: 0, futureOutsideHorizon: 0,
      formats: { localMinute: 0, dateOnly: 0, explicitOffset: 0, explicitZ: 0 },
    },
    distribution: { zero: 0, one: 0, twoToTen: 0, elevenToFifty: 0, fiftyOnePlus: 0, maximum: 0 },
    dates: {
      firstObserved: null, lastObserved: null, firstFuture: null,
      lastWithinHorizon: null, lastFuture: null,
    },
    normalization: {
      validCoordinates: 0, invalidCoordinates: 0,
      validAffiliateUrls: 0, invalidAffiliateUrls: 0,
      withImage: 0, withoutImage: 0,
      withCleanDescription: 0, withoutCleanDescription: 0,
      withSubCategory: 0, withoutSubCategory: 0,
      tiers: { tier1: 0, tier2: 0, tier3: 0, tier4: 0, other: 0 },
    },
    nonPublishable: {
      pastOnly: { count: 0, examples: [] },
      futureOutsideHorizonOnly: { count: 0, examples: [] },
      mixed: { count: 0, examples: [] },
      noSessions: { count: 0, examples: [] },
      other: { count: 0, examples: [] },
    },
    expirationSanity: {
      expiredWithFutureOccurrence: { count: 0, examples: [] },
      futureExpirationWithoutFutureOccurrence: { count: 0, examples: [] },
    },
    anomalies: [],
  };

  for (const item of eligibleItems) {
    const product = normalizeFeverItem(item);
    const publishableOccurrences = [];
    normalizedProducts.push({ ...product, publishableOccurrences });
    const sessionStats = product.sessionStatistics;
    summary.sessions.tokens += sessionStats.tokens;
    summary.sessions.parsed += sessionStats.parsed;
    summary.sessions.invalid += sessionStats.invalid;
    summary.sessions.duplicates += sessionStats.duplicates;
    for (const [format, count] of Object.entries(sessionStats.formats)) {
      summary.sessions.formats[format] += count;
    }
    summary.sessions.dateOnly += sessionStats.formats.dateOnly;
    summary.sessions.withOffsetOrZ += sessionStats.formats.explicitOffset + sessionStats.formats.explicitZ;
    summary.sessions.withTimeWithoutOffset += sessionStats.formats.localMinute;
    summary.sessions.withTime += sessionStats.formats.localMinute
      + sessionStats.formats.explicitOffset + sessionStats.formats.explicitZ;

    if (product.occurrences.length) summary.products.withParsedOccurrence += 1;
    else summary.products.withoutValidOccurrence += 1;
    const bucket = distributionBucket(product.occurrences.length);
    summary.distribution[bucket] += 1;
    summary.distribution.maximum = Math.max(summary.distribution.maximum, product.occurrences.length);

    for (const occurrence of product.occurrences) {
      const date = occurrence.localDate;
      summary.dates.firstObserved = updateMinimum(summary.dates.firstObserved, date);
      summary.dates.lastObserved = updateMaximum(summary.dates.lastObserved, date);
      if (date < today) {
        summary.sessions.past += 1;
        continue;
      }
      summary.sessions.future += 1;
      summary.dates.firstFuture = updateMinimum(summary.dates.firstFuture, date);
      summary.dates.lastFuture = updateMaximum(summary.dates.lastFuture, date);
      if (date <= horizonEnd) {
        publishableOccurrences.push(occurrence);
        summary.sessions.futureWithinHorizon += 1;
        summary.dates.lastWithinHorizon = updateMaximum(summary.dates.lastWithinHorizon, date);
      } else {
        summary.sessions.futureOutsideHorizon += 1;
      }
    }
    if (publishableOccurrences.length) summary.products.withPublishableOccurrence += 1;
    else {
      const past = product.occurrences.filter(({ localDate }) => localDate < today);
      const outside = product.occurrences.filter(({ localDate }) => localDate > horizonEnd);
      let group = summary.nonPublishable.other;
      if (!product.occurrences.length) group = summary.nonPublishable.noSessions;
      else if (past.length && outside.length) group = summary.nonPublishable.mixed;
      else if (past.length) group = summary.nonPublishable.pastOnly;
      else if (outside.length) group = summary.nonPublishable.futureOutsideHorizonOnly;
      group.count += 1;
      addLimitedExample(group, product, product.occurrences);
    }

    const expirationDate = isoDate(product.expirationDate);
    const futureOccurrences = product.occurrences.filter(({ localDate }) => localDate >= today);
    if (expirationDate && expirationDate < today && futureOccurrences.length) {
      const group = summary.expirationSanity.expiredWithFutureOccurrence;
      group.count += 1;
      addLimitedExample(group, product, futureOccurrences);
    }
    if (expirationDate && expirationDate >= today && !futureOccurrences.length) {
      const group = summary.expirationSanity.futureExpirationWithoutFutureOccurrence;
      group.count += 1;
      addLimitedExample(group, product, product.occurrences);
    }

    summary.normalization[product.coordinatesValid ? 'validCoordinates' : 'invalidCoordinates'] += 1;
    summary.normalization[product.affiliateUrlValid ? 'validAffiliateUrls' : 'invalidAffiliateUrls'] += 1;
    summary.normalization[product.imageUrl ? 'withImage' : 'withoutImage'] += 1;
    summary.normalization[product.description ? 'withCleanDescription' : 'withoutCleanDescription'] += 1;
    summary.normalization[product.subCategory ? 'withSubCategory' : 'withoutSubCategory'] += 1;
    summary.normalization.tiers[product.tier] += 1;

    for (const anomaly of product.sessionAnomalies) anomalies.add(product, anomaly.reason, anomaly.value);
    if (!sessionStats.tokens && isoDate(product.expirationDate) >= today) {
      anomalies.add(product, 'active product without Manufacturer', null);
    }
    if (!product.occurrences.length) anomalies.add(product, 'product without valid sessions', null);
    if (!product.occurrences.some(({ localDate }) => localDate >= today)) {
      anomalies.add(product, 'product without future sessions', product.expirationDate);
    }
    if (!product.coordinatesValid) anomalies.add(product, 'invalid coordinates', item?.Pattern);
    if (!product.affiliateUrlValid) anomalies.add(product, 'invalid affiliate URL', item?.Url);
  }

  summary.anomalies = anomalies.result();
  return { summary, normalizedProducts };
}
