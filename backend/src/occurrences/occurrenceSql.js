function planAlias(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Ã€lies SQL no vÃ lid.');
  return alias;
}

function enabledSourceJoin(enabledOnly) {
  return enabledOnly ? 'JOIN sources occurrence_s ON occurrence_s.id = occurrence_ps.source_id' : '';
}

function enabledSourceCondition(enabledOnly) {
  return enabledOnly ? 'AND occurrence_s.enabled = 1' : '';
}

export function activeOccurrenceExists(alias = 'p', dateCondition = '', { enabledOnly = false } = {}) {
  const safeAlias = planAlias(alias);
  return `EXISTS (
    SELECT 1
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    ${enabledSourceJoin(enabledOnly)}
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
      AND occurrence_o.status = 'active'
      ${enabledSourceCondition(enabledOnly)}
      ${dateCondition}
  )`;
}

export function anyOccurrenceExists(alias = 'p', { enabledOnly = false } = {}) {
  const safeAlias = planAlias(alias);
  return `EXISTS (
    SELECT 1
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    ${enabledSourceJoin(enabledOnly)}
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
      ${enabledSourceCondition(enabledOnly)}
  )`;
}

export function activeOccurrenceDate(alias = 'p', dateCondition = '', { enabledOnly = false } = {}) {
  const safeAlias = planAlias(alias);
  return `(
    SELECT MIN(occurrence_o.local_date)
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    ${enabledSourceJoin(enabledOnly)}
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
      AND occurrence_o.status = 'active'
      ${enabledSourceCondition(enabledOnly)}
      ${dateCondition}
  )`;
}

export function activeOccurrencePlanIds(dateCondition = '', { enabledOnly = false } = {}) {
  return `p.id IN (
    SELECT occurrence_ps.plan_id
    FROM plan_occurrences occurrence_o
    JOIN plan_sources occurrence_ps ON occurrence_ps.id = occurrence_o.plan_source_id
    ${enabledSourceJoin(enabledOnly)}
    WHERE occurrence_o.status = 'active'
      ${enabledSourceCondition(enabledOnly)}
      ${dateCondition}
  )`;
}

export function effectiveOccurrenceEndDate(alias = 'p', { enabledOnly = false } = {}) {
  const safeAlias = planAlias(alias);
  return `CASE
    WHEN ${activeOccurrenceExists(safeAlias, '', { enabledOnly })} THEN (
      SELECT MAX(occurrence_o.local_date)
      FROM plan_sources occurrence_ps
      JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
      ${enabledSourceJoin(enabledOnly)}
      WHERE occurrence_ps.plan_id = ${safeAlias}.id
        AND occurrence_o.status = 'active'
        ${enabledSourceCondition(enabledOnly)}
    )
    WHEN ${anyOccurrenceExists(safeAlias, { enabledOnly })} THEN (
      SELECT MAX(occurrence_o.local_date)
      FROM plan_sources occurrence_ps
      JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
      ${enabledSourceJoin(enabledOnly)}
      WHERE occurrence_ps.plan_id = ${safeAlias}.id
        ${enabledSourceCondition(enabledOnly)}
    )
    ELSE COALESCE(${safeAlias}.end_date, ${safeAlias}.start_date)
  END`;
}
