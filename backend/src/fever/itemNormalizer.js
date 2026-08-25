import { cleanFeverDescription } from './descriptionCleaner.js';
import { isGiftCard, isValidAffiliateUrl, parsePattern } from './discoveryPolicy.js';
import { parseFeverManufacturer } from './manufacturerParser.js';

export const FEVER_CATALOG_ID = '15532';
export const FEVER_CAMPAIGN_ID = '16345';

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLabels(value) {
  if (Array.isArray(value)) return value.map((label) => String(label).trim()).filter(Boolean);
  const single = optionalText(value);
  return single ? [single] : [];
}

export function feverTier(value) {
  const category = optionalText(value)?.toLowerCase() || '';
  if (/^tier\s*1\b/.test(category)) return 'tier1';
  if (/^tier\s*2\b/.test(category)) return 'tier2';
  if (/^tier\s*3\b/.test(category)) return 'tier3';
  if (/^tier\s*4\b/.test(category)) return 'tier4';
  return 'other';
}

export function isCataloniaFeverItem(item) {
  return String(item?.CatalogId) === FEVER_CATALOG_ID
    && String(item?.CampaignId) === FEVER_CAMPAIGN_ID
    && optionalText(item?.ParentName) === 'Catalonia';
}

export function isEligibleFeverProduct(item) {
  return isCataloniaFeverItem(item) && !isGiftCard(item);
}

export function normalizeFeverItem(item) {
  const sessions = parseFeverManufacturer(item?.Manufacturer);
  const affiliateUrlValid = isValidAffiliateUrl(item?.Url);
  const coordinates = parsePattern(item?.Pattern);
  return {
    productId: optionalText(String(item?.CatalogItemId ?? '')),
    name: optionalText(item?.Name),
    description: cleanFeverDescription(item?.Description),
    affiliateUrl: affiliateUrlValid ? optionalText(item?.Url) : null,
    affiliateUrlValid,
    imageUrl: optionalText(item?.ImageUrl),
    currentPrice: item?.CurrentPrice ?? null,
    currency: optionalText(item?.Currency),
    labels: normalizeLabels(item?.Labels),
    venue: optionalText(item?.Material),
    address: optionalText(item?.ShippingLabel),
    coordinates,
    coordinatesValid: coordinates !== null,
    country: optionalText(item?.Text1),
    text2: optionalText(item?.Text2),
    parentName: optionalText(item?.ParentName),
    tier: feverTier(item?.Category),
    tierLabel: optionalText(item?.Category),
    subCategory: optionalText(item?.SubCategory),
    launchDate: optionalText(item?.LaunchDate),
    expirationDate: optionalText(item?.ExpirationDate),
    occurrences: sessions.occurrences,
    sessionStatistics: sessions.statistics,
    sessionAnomalies: sessions.anomalies,
  };
}
