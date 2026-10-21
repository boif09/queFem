// First-contact social attribution kept only in memory: it lasts while the visitor navigates the SPA and is
// lost on a full reload. Nothing is written to the device, so it needs no storage consent.
const LEGACY_STORAGE_KEY = 'tenspla.socialAttribution.v1';
const OPTIONAL_VALUE = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;

let memoryAttribution = null;

function normalizeOptional(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPTIONAL_VALUE.test(normalized) ? normalized : undefined;
}

function clone(attribution) {
  return attribution ? { ...attribution } : null;
}

export function getSocialAttribution() {
  return clone(memoryAttribution);
}

export function captureSocialAttributionFromLocation(search = window.location.search) {
  try {
    // Earlier versions kept attribution in sessionStorage; drop any copy left in an open tab.
    window.sessionStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable or blocked.
  }
  try {
    if (memoryAttribution) return;
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
