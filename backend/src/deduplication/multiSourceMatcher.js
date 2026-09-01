import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

function near(a, b) {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) return false;
  return Math.abs(a.latitude - b.latitude) <= 0.002 && Math.abs(a.longitude - b.longitude) <= 0.002;
}

export class MultiSourceMatcher {
  constructor(db) {
    this.findCandidates = db.prepare(`
      SELECT DISTINCT p.* FROM plans p
      JOIN plan_sources ps ON ps.plan_id = p.id JOIN sources s ON s.id = ps.source_id
      WHERE p.start_date = ? AND lower(p.municipality) = lower(?) AND s.key = 'gencat-agenda'
    `);
    // Interval-aware matching is intentionally opt-in. Ticketmaster sessions
    // retain their exact-date contract above, while DIBA publishes genuine
    // multi-day intervals (not synthetic daily sessions).
    this.findDibaCandidates = db.prepare(`
      SELECT DISTINCT p.* FROM plans p
      WHERE lower(p.municipality) = lower(?)
        AND COALESCE(p.end_date, p.start_date) >= ?
        AND p.start_date <= ?
    `);
    this.findPlanUrls = db.prepare('SELECT source_url FROM plan_sources WHERE plan_id=? AND source_url IS NOT NULL');
    this.findPlanSources = db.prepare(`SELECT s.key, s.enabled, ps.source_url
      FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? ORDER BY s.key`);
  }

  match(plan) {
    if (!plan.start_date || !plan.municipality) return { confirmed: null, possible: [] };
    const candidates = this.findCandidates.all(plan.start_date, plan.municipality);
    const title = normalizeForFingerprint(plan.original_title, { removeArticles: true });
    const possible = [];
    for (const candidate of candidates) {
      const sameTitle = normalizeForFingerprint(candidate.original_title, { removeArticles: true }) === title;
      if (!sameTitle) continue;
      const venue = normalizeForFingerprint(candidate.venue_name) && normalizeForFingerprint(candidate.venue_name) === normalizeForFingerprint(plan.venue_name);
      const address = normalizeForFingerprint(candidate.address) && normalizeForFingerprint(candidate.address) === normalizeForFingerprint(plan.address);
      if (venue || address || near(candidate, plan)) return { confirmed: candidate, possible };
      possible.push(candidate);
    }
    return { confirmed: null, possible };
  }

  matchDiba(plan, { sourceUrl = null } = {}) {
    if (!plan.start_date || !plan.municipality) return { confirmed: null, possible: [] };
    return this.matchDibaCandidates(plan, this.dibaCandidates(plan), { sourceUrl });
  }

  dibaCandidates(plan) {
    if (!plan.start_date || !plan.municipality) return [];
    return this.findDibaCandidates.all(plan.municipality, plan.start_date, plan.end_date || plan.start_date).map((planRow) => {
      const sources = this.findPlanSources.all(planRow.id);
      return { ...planRow, sourceUrls: sources.map(({ source_url: url }) => url).filter(Boolean), enabledSourceKeys: sources.filter(({ enabled }) => enabled === 1).map(({ key }) => key) };
    });
  }

  matchDibaCandidates(plan, candidates, { sourceUrl = null } = {}) {
    const title = normalizeForFingerprint(plan.original_title, { removeArticles: true });
    const possible = [];
    const possibleDetails = [];
    for (const candidate of candidates) {
      if (normalizeForFingerprint(candidate.original_title, { removeArticles: true }) !== title) continue;
      const venue = normalizeForFingerprint(candidate.venue_name)
        && normalizeForFingerprint(candidate.venue_name) === normalizeForFingerprint(plan.venue_name);
      const address = normalizeForFingerprint(candidate.address)
        && normalizeForFingerprint(candidate.address) === normalizeForFingerprint(plan.address);
      const urls = candidate.sourceUrls || this.findPlanUrls.all(candidate.id).map(({ source_url: url }) => url);
      const url = Boolean(sourceUrl && urls.includes(sourceUrl));
      const coordinatesNear = near(candidate, plan);
      const supportingEvidence = [
        venue && 'matching venue', address && 'matching address', url && 'matching URL', coordinatesNear && 'nearby coordinates',
      ].filter(Boolean);
      const evidence = {
        titleExact: true, municipalityMatch: true, dateOverlap: true,
        venueMatch: Boolean(venue), addressMatch: Boolean(address), urlMatch: url, coordinatesNear,
        reason: supportingEvidence.length
          ? `same title, municipality and overlapping interval; ${supportingEvidence.join(', ')}`
          : 'same title, municipality and overlapping interval, but no matching venue, address, URL or nearby coordinates',
      };
      if (venue || address || url || coordinatesNear) return { confirmed: candidate, confirmedEvidence: evidence, possible, possibleDetails };
      possible.push(candidate);
      possibleDetails.push({ candidate, evidence });
    }
    return { confirmed: null, possible, possibleDetails };
  }
}
