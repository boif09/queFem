const CATALONIA_TIME_ZONE = 'Europe/Madrid';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CATALONIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const STALE_PLAN_WHERE = `
  permanent = 0
  AND COALESCE(end_date, start_date) IS NOT NULL
  AND COALESCE(end_date, start_date) < ?
`;

function datePartsInCatalonia(date) {
  return Object.fromEntries(
    DATE_FORMATTER.formatToParts(date)
      .filter(({ type }) => ['year', 'month', 'day'].includes(type))
      .map(({ type, value }) => [type, Number(value)]),
  );
}

export function retentionCutoff(retentionDays, now = new Date()) {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new TypeError('EVENT_RETENTION_DAYS ha de ser un enter positiu.');
  }
  const { year, month, day } = datePartsInCatalonia(now);
  const cutoff = new Date(Date.UTC(year, month - 1, day));
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString().slice(0, 10);
}

export function isPlanRetained(plan, cutoff) {
  if (plan.permanent === 1 || plan.permanent === true) return true;
  const effectiveEndDate = plan.end_date || plan.start_date;
  return !effectiveEndDate || effectiveEndDate >= cutoff;
}

export function countExpiredPlans(db, cutoff) {
  return db.prepare(`SELECT COUNT(*) AS count FROM plans WHERE ${STALE_PLAN_WHERE}`)
    .get(cutoff).count;
}

export function purgeExpiredPlans(db, { retentionDays, now = new Date() }) {
  const cutoff = retentionCutoff(retentionDays, now);
  const countLinks = (table) => db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE plan_id IN (SELECT id FROM plans WHERE ${STALE_PLAN_WHERE})
  `).get(cutoff).count;

  const summary = {
    cutoff,
    plans: countExpiredPlans(db, cutoff),
    planSources: countLinks('plan_sources'),
    planCategories: countLinks('plan_categories'),
  };
  if (summary.plans === 0) return summary;

  db.transaction(() => {
    db.prepare(`
      DELETE FROM plan_categories
      WHERE plan_id IN (SELECT id FROM plans WHERE ${STALE_PLAN_WHERE})
    `).run(cutoff);
    db.prepare(`
      DELETE FROM plan_sources
      WHERE plan_id IN (SELECT id FROM plans WHERE ${STALE_PLAN_WHERE})
    `).run(cutoff);
    db.prepare(`DELETE FROM plans WHERE ${STALE_PLAN_WHERE}`).run(cutoff);
  })();

  return summary;
}
