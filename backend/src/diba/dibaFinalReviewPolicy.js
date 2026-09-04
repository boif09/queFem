import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { assertC2RehearsalPath, sha256File } from './dibaPolicyExecutor.js';
import { runDibaQualityAudit } from './dibaQualityAudit.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from './dibaPolicyPlanner.js';
import { componentKey, loadFinalReviewDecisions, stableKey } from './dibaFinalReviewDecisions.js';
import { loadDibaPolicyOverrides } from './dibaPolicyOverrides.js';
import * as f2Primary from './dibaFinalF2PrimaryLocal.js';

const isDiba = (key) => String(key).startsWith('diba-');

function clusterIdentity(cluster) {
  return componentKey(cluster.records.map((record) => ({ sourceKey: record.sourceKey || cluster.sourceKey, sourceRecordId: record.sourceRecordId })));
}
function sourceRows(db, planId) {
  return db.prepare(`SELECT s.key AS sourceKey, s.enabled, ps.source_record_id AS sourceRecordId
    FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? ORDER BY s.key, ps.source_record_id`).all(planId)
    .map((row) => ({ ...row, sourceRecordId: String(row.sourceRecordId) }));
}
function planSnapshot(db, planId) {
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
  if (!plan) throw new Error(`Final review plan ${planId} is missing.`);
  return { plan, categories: db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id').all(planId).map(({ category_id: id }) => id) };
}
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function dibaStates(db) {
  const states = db.prepare("SELECT key, enabled, allows_images AS allowsImages FROM sources WHERE key IN ('diba-tourisme','diba-escenari','diba-museus') ORDER BY key").all();
  if (states.length !== 3 || states.some(({ enabled, allowsImages }) => Number(enabled) !== 0 || Number(allowsImages) !== 0)) throw new Error('Final DIBA review requires every DIBA source to remain disabled with images disabled.');
  return states;
}
export function rawComponents(policy) {
  const map = new Map();
  for (const item of policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW' || decision === 'KEEP_SEPARATE_SESSION')) {
    const key = clusterIdentity(item.cluster); const current = map.get(key) || { key, classes: new Set(), planIds: new Set(), records: item.cluster.records.map((record) => ({ sourceKey: record.sourceKey || item.cluster.sourceKey, sourceRecordId: String(record.sourceRecordId) })) };
    current.classes.add(item.decision); for (const id of item.cluster.planIds || []) current.planIds.add(id); map.set(key, current);
  }
  return [...map.values()].map((item) => ({ ...item, classes: [...item.classes].sort(), planIds: [...item.planIds].sort((a, b) => a - b) }));
}

export async function prepareFinalReviewPlan({ databasePath, overridePath, decisionPath } = {}) {
  const overrides = await loadDibaPolicyOverrides(overridePath);
  if (overrides.decisions.length !== 34) throw new Error(`Final DIBA review requires exactly 34 existing cross-source overrides; found ${overrides.decisions.length}.`);
  const decisions = loadFinalReviewDecisions(decisionPath);
  const auditReport = await runDibaQualityAudit({ databasePath });
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const states = dibaStates(db); const index = loadPolicyIdentityIndex(db); const policy = planDibaPolicy({ auditReport, overrides, identityIndex: index }); const raw = rawComponents(policy);
    const rawByKey = new Map(raw.map((item) => [item.key, item])); const decisionKeys = new Set(decisions.decisions.map(({ sourceMembers }) => componentKey(sourceMembers)));
    if (raw.some(({ key }) => !decisionKeys.has(key))) throw new Error(`Final DIBA has an unreviewed raw component: ${raw.filter(({ key }) => !decisionKeys.has(key)).map(({ key }) => key).join(',')}.`);
    const reviewed = decisions.decisions.map((decision) => {
      const key = componentKey(decision.sourceMembers); let rawComponent = rawByKey.get(key);
      const expectedClass = decision.operation === 'REVIEW_SAME_FEED_COMPONENT' ? 'NEEDS_HUMAN_REVIEW' : 'KEEP_SEPARATE_SESSION';
      const entries = decision.sourceMembers.map((source) => { const found = index.byIdentity.get(stableKey(source)) || []; if (found.length !== 1) throw new Error(`Final DIBA source ${stableKey(source)} must resolve exactly once.`); return { source, ...found[0] }; });
      const planIds = [...new Set(entries.map(({ planId }) => planId))];
      // A completed reviewed consolidation is intentionally absent from the
      // raw multi-plan diagnostic on repeat runs. Every other missing raw
      // component fails closed rather than being subtracted by JSON alone.
      if (!rawComponent && decision.disposition === 'CONSOLIDATE_TO_ONE_PLAN' && planIds.length === 1) rawComponent = { key, classes: [expectedClass], planIds, records: decision.sourceMembers, resolvedByExistingConsolidation: true };
      if (!rawComponent || !rawComponent.classes.includes(expectedClass)) throw new Error(`Final DIBA decision ${key} does not match the current complete raw component topology.`);
      if (decision.disposition === 'DEFER') {
        const covered = new Set(decision.sourceMembers.map(stableKey));
        const affectedPlans = planIds.map((planId) => {
          const provenance = sourceRows(db, planId);
          // All current provenance must be DIBA and belong to this one reviewed component.
          if (provenance.some(({ sourceKey, sourceRecordId }) => !isDiba(sourceKey) || !covered.has(`${sourceKey}:${sourceRecordId}`))) throw new Error(`Final DIBA DEFER refuses shared/public plan ${planId} for ${key}.`);
          return { planId, provenance, status: db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status };
        });
        return { ...decision, key, raw: rawComponent, entries, planIds, affectedPlans };
      }
      const canonical = entries.find(({ source }) => stableKey(source) === stableKey(decision.canonicalSourceIdentity));
      const moved = entries.filter((entry) => entry !== canonical);
      if (!canonical || moved.some(({ planId }) => planId === canonical.planId ? false : sourceRows(db, planId).some(({ sourceKey }) => !isDiba(sourceKey)))) throw new Error(`Final DIBA consolidation is unsafe for ${key}.`);
      return { ...decision, key, raw: rawComponent, entries, planIds, canonical, moved };
    });
    const rawCounts = { sameFeed: raw.filter(({ classes }) => classes.includes('NEEDS_HUMAN_REVIEW')).length, sessionDefer: raw.filter(({ classes }) => classes.includes('KEEP_SEPARATE_SESSION')).length };
    return { readOnly: true, decisions, overrides, auditReport, policy, states, rawComponents: raw, rawCounts, reviewed, humanReviewActivationGateReady: true, unresolvedFinalHumanComponents: 0, geography: { mutations: 0, noops: 19 } };
  } finally { db.close(); }
}

async function executeFinalReviewTransaction({ databasePath, prepared }) {
  const db = openDatabase(databasePath); let result;
  try {
    result = db.transaction(() => {
      dibaStates(db); const relink = db.prepare('UPDATE plan_sources SET plan_id=? WHERE source_id=(SELECT id FROM sources WHERE key=?) AND source_record_id=? AND plan_id=?');
      const inactive = db.prepare("UPDATE plans SET status='inactive', inactive_at=?, updated_at=? WHERE id=? AND status<>'inactive'");
      const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?'); const now = new Date().toISOString(); const relinks = []; const orphans = []; const deferredInactivePlans = [];
      for (const decision of prepared.reviewed.filter(({ disposition }) => disposition === 'CONSOLIDATE_TO_ONE_PLAN')) {
        const canonical = decision.canonical; const before = planSnapshot(db, canonical.planId);
        for (const moved of decision.moved) {
          if (moved.planId === canonical.planId) continue;
          const changed = relink.run(canonical.planId, moved.source.sourceKey, moved.source.sourceRecordId, moved.planId).changes;
          if (changed !== 1) throw new Error(`Final DIBA consolidation relink failed for ${stableKey(moved.source)}.`);
          relinks.push({ source: moved.source, canonicalSourceIdentity: decision.canonicalSourceIdentity, beforePlanId: moved.planId, afterPlanId: canonical.planId });
          if (sourceCount.get(moved.planId).count === 0) { inactive.run(now, now, moved.planId); orphans.push({ planId: moved.planId, source: moved.source }); }
        }
        const after = planSnapshot(db, canonical.planId); if (!equal(before, after)) throw new Error(`Final DIBA consolidation changed canonical fields for ${stableKey(canonical.source)}.`);
      }
      for (const decision of prepared.reviewed.filter(({ disposition }) => disposition === 'DEFER')) for (const affected of decision.affectedPlans) {
        const provenance = sourceRows(db, affected.planId); const covered = new Set(decision.sourceMembers.map(stableKey));
        if (provenance.some(({ sourceKey, sourceRecordId }) => !isDiba(sourceKey) || !covered.has(`${sourceKey}:${sourceRecordId}`))) throw new Error(`Final DIBA DEFER refuses shared/public plan ${affected.planId}.`);
        if (inactive.run(now, now, affected.planId).changes) deferredInactivePlans.push({ planId: affected.planId, sources: provenance.map(({ sourceKey, sourceRecordId }) => ({ sourceKey, sourceRecordId })) });
      }
      const duplicate = db.prepare('SELECT 1 FROM plan_sources GROUP BY source_id,source_record_id HAVING COUNT(*)>1 LIMIT 1').get(); if (duplicate) throw new Error('Final DIBA rehearsal found duplicate stable provenance.');
      const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`Final DIBA integrity_check failed: ${integrity}`);
      return { relinks, consolidationOrphans: orphans, deferredInactivePlans, integrity, sourceStates: dibaStates(db) };
    })();
  } finally { db.close(); }
  return { ...result, prepared, databasePath: path.resolve(databasePath), databaseShaAfter: sha256File(databasePath) };
}

export async function applyFinalReviewRehearsal({ databasePath, realDatabasePath, overridePath, decisionPath }) {
  const rehearsalPath = assertC2RehearsalPath(databasePath, realDatabasePath); const realBefore = sha256File(realDatabasePath); const prepared = await prepareFinalReviewPlan({ databasePath: rehearsalPath, overridePath, decisionPath }); const result = await executeFinalReviewTransaction({ databasePath: rehearsalPath, prepared });
  const realAfter = sha256File(realDatabasePath); if (realBefore !== realAfter) throw new Error('Final DIBA rehearsal changed the real database.');
  return { ...result, rehearsalPath, realShaBefore: realBefore, realShaAfter: realAfter, rehearsalShaAfter: result.databaseShaAfter };
}

export async function applyFinalReviewPrimaryLocal({ config, overridePath, decisionPath, backupPath }) {
  const primary = f2Primary.canonicalF2PrimaryLocalPath(config); const pre = f2Primary.preflightF2PrimaryLocal({ config }); const backup = await f2Primary.createVerifiedF2Backup({ primary, backupPath, config, token: pre.token });
  const prepared = await prepareFinalReviewPlan({ databasePath: primary, overridePath, decisionPath });
  // This boundary is synchronous by design: no await or caller-controlled work
  // can intervene between its fresh SHA/path/token check and writable open.
  f2Primary.assertF2WritableBoundary({ config, primary, token: pre.token, prepared });
  const apply = await executeFinalReviewTransaction({ databasePath: primary, prepared });
  return { pre, backup, apply, postSha256: sha256File(primary) };
}
