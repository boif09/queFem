import { anyOccurrenceExists } from '../occurrences/occurrenceSql.js';

const CATALONIA_TIME_ZONE = 'Europe/Madrid';
const MAX_FUTURE_YEARS = 10;
const MAX_EVENT_DURATION_YEARS = 10;
const YEAR_FORMATTER = new Intl.DateTimeFormat('en', {
  timeZone: CATALONIA_TIME_ZONE,
  year: 'numeric',
});

function parseIsoDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return { invalid: true };
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { invalid: true };

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return { invalid: true };
  }
  return { date, year };
}

export function currentYearInCatalonia(now = new Date()) {
  return Number(YEAR_FORMATTER.format(now));
}

export function temporalCoherenceIssue(plan, {
  currentYear = currentYearInCatalonia(),
} = {}) {
  if (plan?.kind !== 'event' || plan.permanent === 1 || plan.permanent === true) return null;

  const start = parseIsoDate(plan.start_date);
  const end = parseIsoDate(plan.end_date);
  if (start?.invalid || end?.invalid) {
    return {
      code: 'INVALID_DATE_FORMAT',
      message: `Format de data invàlid: start_date=${plan.start_date ?? 'null'}, end_date=${plan.end_date ?? 'null'}`,
    };
  }
  if (start && end && end.date < start.date) {
    return {
      code: 'END_BEFORE_START',
      message: `end_date ${plan.end_date} és anterior a start_date ${plan.start_date}`,
    };
  }

  const maximumYear = currentYear + MAX_FUTURE_YEARS;
  const extremeDate = [
    ['start_date', plan.start_date, start],
    ['end_date', plan.end_date, end],
  ].find(([, , parsed]) => parsed && parsed.year > maximumYear);
  if (extremeDate) {
    return {
      code: 'EXTREME_FUTURE_DATE',
      message: `${extremeDate[0]} ${extremeDate[1]} supera l’any màxim conservador ${maximumYear}`,
    };
  }

  if (start && end) {
    const maximumEnd = new Date(start.date);
    maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + MAX_EVENT_DURATION_YEARS);
    if (end.date > maximumEnd) {
      return {
        code: 'EVENT_DURATION_EXCEEDS_10_YEARS',
        message: `L’esdeveniment dura més de ${MAX_EVENT_DURATION_YEARS} anys (${plan.start_date}–${plan.end_date})`,
      };
    }
  }

  return null;
}

export function isTemporallyInvalid(plan, options) {
  return temporalCoherenceIssue(plan, options) !== null;
}

export function temporallyInvalidWhere(alias = '', { enabledOnly = false } = {}) {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Àlies SQL no vàlid.');
  }
  const prefix = alias ? `${alias}.` : '';
  const planReference = alias || 'plans';
  return `NOT (${anyOccurrenceExists(planReference, { enabledOnly })}) AND is_temporally_invalid(
    ${prefix}kind, ${prefix}permanent, ${prefix}start_date, ${prefix}end_date, ?
  ) = 1`;
}

export function countTemporallyInvalidPlans(db, { now = new Date() } = {}) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM plans WHERE ${temporallyInvalidWhere()}
  `).get(currentYearInCatalonia(now)).count;
}

export function purgeTemporallyInvalidPlans(db, { now = new Date() } = {}) {
  const invalidWhere = temporallyInvalidWhere();
  const currentYear = currentYearInCatalonia(now);
  const countLinks = (table) => db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE plan_id IN (SELECT id FROM plans WHERE ${invalidWhere})
  `).get(currentYear).count;
  const summary = {
    plans: countTemporallyInvalidPlans(db, { now }),
    planSources: countLinks('plan_sources'),
    planCategories: countLinks('plan_categories'),
  };
  if (summary.plans === 0) return summary;

  db.transaction(() => {
    db.prepare(`
      DELETE FROM plan_categories
      WHERE plan_id IN (SELECT id FROM plans WHERE ${invalidWhere})
    `).run(currentYear);
    db.prepare(`
      DELETE FROM plan_sources
      WHERE plan_id IN (SELECT id FROM plans WHERE ${invalidWhere})
    `).run(currentYear);
    db.prepare(`DELETE FROM plans WHERE ${invalidWhere}`).run(currentYear);
  })();

  return summary;
}
