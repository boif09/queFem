function planAlias(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Ã€lies SQL no vÃ lid.');
  return alias;
}

export function activeOccurrenceExists(alias = 'p', dateCondition = '') {
  const safeAlias = planAlias(alias);
  return `EXISTS (
    SELECT 1
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
      AND occurrence_o.status = 'active'
      ${dateCondition}
  )`;
}

export function anyOccurrenceExists(alias = 'p') {
  const safeAlias = planAlias(alias);
  return `EXISTS (
    SELECT 1
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
  )`;
}

export function activeOccurrenceDate(alias = 'p', dateCondition = '') {
  const safeAlias = planAlias(alias);
  return `(
    SELECT MIN(occurrence_o.local_date)
    FROM plan_sources occurrence_ps
    JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
    WHERE occurrence_ps.plan_id = ${safeAlias}.id
      AND occurrence_o.status = 'active'
      ${dateCondition}
  )`;
}

export function effectiveOccurrenceEndDate(alias = 'p') {
  const safeAlias = planAlias(alias);
  return `CASE
    WHEN ${activeOccurrenceExists(safeAlias)} THEN (
      SELECT MAX(occurrence_o.local_date)
      FROM plan_sources occurrence_ps
      JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
      WHERE occurrence_ps.plan_id = ${safeAlias}.id
        AND occurrence_o.status = 'active'
    )
    WHEN ${anyOccurrenceExists(safeAlias)} THEN (
      SELECT MAX(occurrence_o.local_date)
      FROM plan_sources occurrence_ps
      JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
      WHERE occurrence_ps.plan_id = ${safeAlias}.id
    )
    ELSE COALESCE(${safeAlias}.end_date, ${safeAlias}.start_date)
  END`;
}
