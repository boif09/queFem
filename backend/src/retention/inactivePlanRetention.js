const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function requireValidNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('La data actual no és vàlida.');
}

export function inactiveRetentionCutoff(retentionDays, now = new Date()) {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new TypeError('INACTIVE_PLAN_RETENTION_DAYS ha de ser un enter positiu.');
  }
  requireValidNow(now);
  return new Date(now.getTime() - retentionDays * MILLISECONDS_PER_DAY).toISOString();
}

export function assertInactiveRetentionSchema(db) {
  const planColumns = new Set(db.prepare('PRAGMA table_info(plans)').all().map((column) => column.name));
  for (const column of ['id', 'status', 'inactive_at']) {
    if (!planColumns.has(column)) throw new Error(`Schema incompatible: falta plans.${column}.`);
  }

  const allowedDependencies = new Set(['plan_categories', 'plan_sources']);
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all();
  for (const { name } of tables) {
    for (const foreignKey of db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(name)})`).all()) {
      if (foreignKey.table === 'plans' && !allowedDependencies.has(name)) {
        throw new Error(`Schema incompatible: ${name} té una dependència de plans no gestionada.`);
      }
    }
  }
}

function daysInactive(inactiveAt, now) {
  return Math.floor((now.getTime() - Date.parse(inactiveAt)) / MILLISECONDS_PER_DAY);
}

export function inspectInactivePlans(db, { retentionDays, now = new Date() }) {
  requireValidNow(now);
  const cutoff = inactiveRetentionCutoff(retentionDays, now);
  assertInactiveRetentionSchema(db);
  const rows = db.prepare(`
    SELECT
      p.id,
      COALESCE(p.title_ca, p.title_es, p.original_title, 'sense títol') title,
      p.inactive_at,
      (SELECT COUNT(*) FROM plan_sources ps WHERE ps.plan_id = p.id) source_count
    FROM plans p
    WHERE p.status = 'inactive'
    ORDER BY p.inactive_at, p.id
  `).all();

  const summary = {
    cutoff,
    inactivePlansFound: rows.length,
    eligibleForPurge: 0,
    tooRecent: 0,
    stillHaveSources: 0,
    missingInactiveAt: 0,
    eligible: [],
  };

  for (const row of rows) {
    if (row.source_count > 0) {
      summary.stillHaveSources += 1;
      continue;
    }
    if (row.inactive_at === null) {
      summary.missingInactiveAt += 1;
      continue;
    }
    if (Number.isNaN(Date.parse(row.inactive_at))) {
      throw new Error(`Timestamp inactive_at invàlid al pla ${row.id}.`);
    }
    if (row.inactive_at > cutoff) {
      summary.tooRecent += 1;
      continue;
    }
    summary.eligible.push({
      id: row.id,
      title: row.title,
      inactiveAt: row.inactive_at,
      daysInactive: daysInactive(row.inactive_at, now),
    });
  }
  summary.eligibleForPurge = summary.eligible.length;
  return summary;
}

export function deleteOrphanPlanWithinTransaction(
  db,
  planId,
  { inactiveAtCutoff = null, beforeDeletePlan } = {},
) {
  assertInactiveRetentionSchema(db);
  const plan = db.prepare(`
    SELECT id, status, inactive_at,
      (SELECT COUNT(*) FROM plan_sources WHERE plan_id = plans.id) source_count
    FROM plans
    WHERE id = ?
  `).get(planId);
  if (!plan) throw new Error(`El pla ${planId} no existeix.`);
  if (plan.status !== 'inactive') throw new Error(`El pla ${planId} no està inactive.`);
  if (plan.source_count !== 0) throw new Error(`El pla ${planId} encara té procedències.`);
  if (inactiveAtCutoff !== null && (
    plan.inactive_at === null
    || Number.isNaN(Date.parse(plan.inactive_at))
    || plan.inactive_at > inactiveAtCutoff
  )) {
    throw new Error(`El pla ${planId} no compleix l’antiguitat requerida.`);
  }

  const planCategoriesDeleted = db.prepare('DELETE FROM plan_categories WHERE plan_id = ?')
    .run(planId).changes;
  if (beforeDeletePlan) beforeDeletePlan(plan);
  const deleted = db.prepare(`
    DELETE FROM plans
    WHERE id = ?
      AND status = 'inactive'
      AND NOT EXISTS (SELECT 1 FROM plan_sources WHERE plan_id = plans.id)
  `).run(planId).changes;
  if (deleted !== 1) throw new Error(`No s’ha pogut eliminar de forma segura el pla ${planId}.`);
  return { deleted, planCategoriesDeleted };
}

export function purgeInactivePlans(
  db,
  { retentionDays, now = new Date(), dryRun = false, beforeDeletePlan } = {},
) {
  const summary = inspectInactivePlans(db, { retentionDays, now });
  summary.deleted = 0;
  summary.planCategoriesDeleted = 0;
  if (dryRun || summary.eligible.length === 0) return summary;

  db.transaction(() => {
    for (const candidate of summary.eligible) {
      const result = deleteOrphanPlanWithinTransaction(db, candidate.id, {
        inactiveAtCutoff: summary.cutoff,
        beforeDeletePlan,
      });
      summary.planCategoriesDeleted += result.planCategoriesDeleted;
      summary.deleted += result.deleted;
    }
  })();
  return summary;
}
