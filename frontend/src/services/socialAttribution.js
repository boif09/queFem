const STORAGE_KEY = 'tenspla.socialAttribution.v1';
const OPTIONAL_VALUE = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;

let memoryAttribution = null;

function normalizeOptional(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPTIONAL_VALUE.test(normalized) ? normalized : undefined;
}

function validateAttribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = typeof value.social_source === 'string' ? value.social_source.trim().toLowerCase() : '';
  const medium = typeof value.social_medium === 'string' ? value.social_medium.trim().toLowerCase() : '';
  if (!['instagram', 'tiktok'].includes(source) || medium !== 'social') return null;

  const attribution = { social_source: source, social_medium: 'social' };
  const campaign = normalizeOptional(value.social_campaign);
  const content = normalizeOptional(value.social_content);
  if (campaign) attribution.social_campaign = campaign;
  if (content) attribution.social_content = content;
  return attribution;
}

function clone(attribution) {
  return attribution ? { ...attribution } : null;
}

function readStoredAttribution() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateAttribution(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function getSocialAttribution() {
  if (typeof window === 'undefined') return clone(memoryAttribution);
  const stored = readStoredAttribution();
  return clone(stored || memoryAttribution);
}

export function captureSocialAttributionFromLocation(search = window.location.search) {
  try {
    if (getSocialAttribution() || memoryAttribution) return;
    const params = new URLSearchParams(search);
    const source = params.get('utm_source')?.trim().toLowerCase();
    const medium = params.get('utm_medium')?.trim().toLowerCase();
    if (!['instagram', 'tiktok'].includes(source) || medium !== 'social') return;

    const attribution = { social_source: source, social_medium: 'social' };
    const campaign = normalizeOptional(params.get('utm_campaign'));
    const content = normalizeOptional(params.get('utm_content'));
    if (campaign) attribution.social_campaign = campaign;
    if (content) attribution.social_content = content;

    memoryAttribution = attribution;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      // The in-memory value keeps attribution available for this page lifetime.
    }
  } catch {
    // Attribution must never affect application startup.
  }
}

export function withSocialAttribution(properties) {
  try {
    const attribution = getSocialAttribution();
    return attribution ? { ...properties, ...attribution } : { ...properties };
  } catch {
    return { ...properties };
  }
}

export function resetSocialAttributionForTests() {
  memoryAttribution = null;
}
