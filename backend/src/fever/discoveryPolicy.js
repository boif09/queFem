const CATALOG_ID = '15532';
const CAMPAIGN_ID = '16345';
const AFFILIATE_HOST = 'fever.pxf.io';
const DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isoDate(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== match[1] ? null : match[1];
}

function dateInCatalonia(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function isGiftCard(item) {
  const value = `${text(item?.SubCategory)} ${text(item?.Name)}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /gift\s*cards?/.test(value) || /tarjeta\s+(?:de\s+)?regalo/.test(value);
}

export function parsePattern(value) {
  const match = text(value).match(/^\(\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function parseManufacturer(value) {
  const raw = Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(',').map(text).filter(Boolean);
  const dates = [];
  let invalid = 0;
  for (const entry of raw) {
    const matches = [...entry.matchAll(DATE_PATTERN)].map((match) => isoDate(match[1])).filter(Boolean);
    if (matches.length === 0) invalid += 1;
    else dates.push(...matches);
  }
  return { count: raw.length, dates, invalid };
}

export function isValidAffiliateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === AFFILIATE_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

function tier(item) {
  const category = text(item?.Category).toLowerCase();
  if (/^tier\s*1\b/.test(category)) return 'tier1';
  if (/^tier\s*2\b/.test(category)) return 'tier2';
  if (/^tier\s*3\b/.test(category)) return 'tier3';
  if (/^tier\s*4\b/.test(category)) return 'tier4';
  return 'other';
}

function sessionBucket(count) {
  if (count <= 1) return 'one';
  if (count <= 10) return 'twoToTen';
  if (count <= 50) return 'elevenToFifty';
  return 'fiftyOnePlus';
}

export function analyzeFeverDiscovery(download, { lookaheadDays = 365, now = new Date() } = {}) {
  const today = dateInCatalonia(now);
  const horizonEnd = addDays(today, lookaheadDays);
  const catalogItems = download.items.filter((item) => String(item?.CatalogId) === CATALOG_ID
    && String(item?.CampaignId) === CAMPAIGN_ID);
  const catalonia = catalogItems.filter((item) => text(item?.ParentName) === 'Catalonia');
  const summary = {
    pages: download.pages, spainItems: download.items.length, matchingCatalogCampaign: catalogItems.length,
    cataloniaItems: catalonia.length, expired: 0, activeFuture: 0, giftCards: 0,
    activeNonGiftCandidates: 0, candidatesWithFutureSessionInHorizon: 0,
    withImage: 0, withoutImage: 0, validCoordinates: 0, invalidCoordinates: 0,
    tiers: { tier1: 0, tier2: 0, tier3: 0, tier4: 0, other: 0 },
    withSubCategory: 0, withoutSubCategory: 0, validAffiliateUrls: 0, invalidAffiliateUrls: 0,
    sessionDistribution: { one: 0, twoToTen: 0, elevenToFifty: 0, fiftyOnePlus: 0 },
    invalidSessions: 0, firstObservedSession: null, lastObservedSession: null,
  };
  for (const item of catalonia) {
    const expiration = isoDate(item.ExpirationDate);
    const expired = Boolean(expiration && expiration < today);
    summary[expired ? 'expired' : 'activeFuture'] += 1;
    const gift = isGiftCard(item);
    if (gift) summary.giftCards += 1;
    const candidate = !expired && !gift;
    if (candidate) summary.activeNonGiftCandidates += 1;
    summary[text(item.ImageUrl) ? 'withImage' : 'withoutImage'] += 1;
    summary[parsePattern(item.Pattern) ? 'validCoordinates' : 'invalidCoordinates'] += 1;
    summary.tiers[tier(item)] += 1;
    summary[text(item.SubCategory) ? 'withSubCategory' : 'withoutSubCategory'] += 1;
    summary[isValidAffiliateUrl(item.Url) ? 'validAffiliateUrls' : 'invalidAffiliateUrls'] += 1;
    const sessions = parseManufacturer(item.Manufacturer);
    summary.sessionDistribution[sessionBucket(sessions.count)] += 1;
    summary.invalidSessions += sessions.invalid;
    const validDates = sessions.dates.sort();
    if (validDates.length) {
      const first = validDates[0];
      const last = validDates.at(-1);
      if (!summary.firstObservedSession || first < summary.firstObservedSession) summary.firstObservedSession = first;
      if (!summary.lastObservedSession || last > summary.lastObservedSession) summary.lastObservedSession = last;
      if (candidate && validDates.some((date) => date >= today && date <= horizonEnd)) {
        summary.candidatesWithFutureSessionInHorizon += 1;
      }
    }
  }
  return summary;
}
