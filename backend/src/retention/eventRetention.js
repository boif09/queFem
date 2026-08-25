import { effectiveOccurrenceEndDate } from '../occurrences/occurrenceSql.js';

const CATALONIA_TIME_ZONE = 'Europe/Madrid';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: CATALONIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function expiredPlanWhere(alias = '') {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Àlies SQL no vàlid.');
  }
  const prefix = alias ? `${alias}.` : '';
  const planReference = alias || 'plans';
  const effectiveEndDate = effectiveOccurrenceEndDate(planReference);
  return `
    ${prefix}permanent = 0
    AND ${effectiveEndDate} IS NOT NULL
    AND ${effectiveEndDate} < ?
  `;
}

export function retainedPlanWhere(alias = '') {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Àlies SQL no vàlid.');
  }
  const prefix = alias ? `${alias}.` : '';
  const planReference = alias || 'plans';
  const effectiveEndDate = effectiveOccurrenceEndDate(planReference);
  return `(
    ${prefix}permanent = 1
    OR ${effectiveEndDate} IS NULL
    OR ${effectiveEndDate} >= ?
  )`;
}

function datePartsInCatalonia(date) {
  return Object.fromEntries(
    DATE_FORMATTER.formatToParts(date)
      .filter(({ type }) => ['year', 'month', 'day'].includes(type))
      .map(({ type, value }) => [type, Number(value)]),
  );
}

export function retentionCutoff(retentionDays, now = new Date()) {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new TypeError('EVENT_RETENTION_DAYS ha de ser un enter no negatiu.');
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
  return db.prepare(`SELECT COUNT(*) AS count FROM plans WHERE ${expiredPlanWhere()}`)
    .get(cutoff).count;
}

export function purgeExpiredPlans(db, { retentionDays, now = new Date() }) {
  const cutoff = retentionCutoff(retentionDays, now);
  const stalePlanWhere = expiredPlanWhere();
  const expiredPlanIds = db.prepare(`SELECT id FROM plans WHERE ${stalePlanWhere} ORDER BY id`)
    .all(cutoff).map(({ id }) => id);
  const countLinks = (table) => db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE plan_id IN (SELECT id FROM plans WHERE ${stalePlanWhere})
  `).get(cutoff).count;

  const summary = {
    cutoff,
    plans: countExpiredPlans(db, cutoff),
    planSources: countLinks('plan_sources'),
    planCategories: countLinks('plan_categories'),
  };
  if (summary.plans === 0) return summary;

  db.transaction(() => {
    const deleteCategories = db.prepare('DELETE FROM plan_categories WHERE plan_id = ?');
    const deleteSources = db.prepare('DELETE FROM plan_sources WHERE plan_id = ?');
    const deletePlan = db.prepare('DELETE FROM plans WHERE id = ?');
    for (const planId of expiredPlanIds) {
      deleteCategories.run(planId);
      deleteSources.run(planId);
      deletePlan.run(planId);
    }
  })();

  return summary;
}
