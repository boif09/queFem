import { planAliasProtectedWhere } from '../db/planAliasGuard.js';

const OUTSIDE_CATALONIA_PATTERNS = [
  /^fora (?:de |d |del |de l )?(?:catalunya|cataluna|espanya|espana|estat espanyol|estado espanol)$/,
  /^fuera (?:de |del )?(?:catalunya|cataluna|espanya|espana|estat espanyol|estado espanol)$/,
  /^outside (?:of )?(?:catalonia|catalunya|spain)$/,
];

function normalizeAdministrativeValue(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ca')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isOutsideCatalonia(location) {
  const administrativeValues = [
    location?.province,
    location?.comarca,
    location?.municipality,
    location?.locality,
  ];
  return administrativeValues.some((value) => {
    const normalized = normalizeAdministrativeValue(value);
    return OUTSIDE_CATALONIA_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

export function outsideCataloniaWhere(alias = '') {
  if (alias && !/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Àlies SQL no vàlid.');
  }
  const prefix = alias ? `${alias}.` : '';
  return `is_outside_catalonia(
    ${prefix}province, ${prefix}comarca, ${prefix}municipality, ${prefix}locality
  ) = 1`;
}

export function countOutsideCataloniaPlans(db) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM plans WHERE ${outsideCataloniaWhere()}
  `).get().count;
}

export function purgeOutsideCataloniaPlans(db) {
  // A plan referenced by plan_aliases (alias or canonical side) is never
  // hard-deleted by any purge path — see db/planAliasGuard.js. `summary.plans`
  // reports what was ACTUALLY deleted (guarded); `protectedByAlias` makes the
  // raw geography-match count still visible for observability, so a caller
  // logging "Purged N plans" is never misleading about a protected plan
  // that was left in place (cross-review finding).
  const outsideWhere = `${outsideCataloniaWhere()} AND ${planAliasProtectedWhere()}`;
  const countLinks = (table) => db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE plan_id IN (SELECT id FROM plans WHERE ${outsideWhere})
  `).get().count;
  const rawMatchCount = countOutsideCataloniaPlans(db);
  const eligiblePlans = db.prepare(`SELECT COUNT(*) AS count FROM plans WHERE ${outsideWhere}`).get().count;
  const summary = {
    plans: eligiblePlans,
    protectedByAlias: rawMatchCount - eligiblePlans,
    planSources: countLinks('plan_sources'),
    planCategories: countLinks('plan_categories'),
  };
  if (eligiblePlans === 0) return summary;

  db.transaction(() => {
    db.prepare(`
      DELETE FROM plan_categories
      WHERE plan_id IN (SELECT id FROM plans WHERE ${outsideWhere})
    `).run();
    db.prepare(`
      DELETE FROM plan_sources
      WHERE plan_id IN (SELECT id FROM plans WHERE ${outsideWhere})
    `).run();
    db.prepare(`DELETE FROM plans WHERE ${outsideWhere}`).run();
  })();

  return summary;
}
