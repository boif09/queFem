import { withSocialAttribution } from './socialAttribution.js';

function currentUmami() {
  if (typeof window === 'undefined') return null;
  return window.umami;
}

export function trackEvent(name, properties) {
  try {
    const track = currentUmami()?.track;
    if (typeof track !== 'function') return;
    Promise.resolve(track(name, properties)).catch(() => {});
  } catch {
    // Analytics must never affect the primary user action.
  }
}

export function trackAffiliateClick({ source, planId, sourceRecordId, placement, language }) {
  const properties = {
    source,
    plan_id: planId,
    placement,
    language,
  };
  if (sourceRecordId) properties.source_record_id = String(sourceRecordId);
  trackEvent('affiliate_click', withSocialAttribution(properties));
}

export function trackCollectionView({ collection, language }) {
  trackEvent('collection_view', withSocialAttribution({ collection, language }));
}

export function trackPlanView({ planId, hasAffiliate, language }) {
  trackEvent('plan_view', withSocialAttribution({
    plan_id: planId,
    has_affiliate: hasAffiliate,
    language,
  }));
}
