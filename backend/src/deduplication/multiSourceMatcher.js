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
}
