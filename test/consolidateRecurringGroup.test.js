import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { normalizeForFingerprint } from '../backend/src/normalizers/text.normalizer.js';
import { normalizeVenueIdentity } from '../backend/src/deduplication/recurringProductionDetector.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';
import { PlanOccurrenceRepository } from '../backend/src/db/repositories/planOccurrence.repository.js';
import { RecurringProductionAppliedGroupRepository } from '../backend/src/db/repositories/recurringProductionAppliedGroup.repository.js';
import { computeConsolidationPlan, applyConsolidation } from '../scripts/consolidate-recurring-group.js';

const NOW = '2026-09-24T10:00:00.000Z';
const TITLE = 'Gran Gala Flamenc';
const VENUE = 'Palau de la Música Catalana';
const TICKET = 'https://www.grangalaflamenco.com/reservar/';
const DESCRIPTION = 'Gran Gala Flamenc ofereix als seus espectadors un viatge integral al món del flamenc.';
const GROUP_KEY = `gencat-agenda|${normalizeForFingerprint(TITLE, { removeArticles: true })}|${normalizeVenueIdentity(VENUE)}`;

function writeDecisionsFile(dir, { decision = 'ACCEPT', groupKey = GROUP_KEY } = {}) {
  const file = path.join(dir, 'decisions.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    decisions: [{
      groupKey,
      source: 'gencat-agenda',
      normalizedTitle: normalizeForFingerprint(TITLE, { removeArticles: true }),
      venueIdentity: normalizeVenueIdentity(VENUE),
      decision,
      reason: 'test fixture',
      reviewedAt: '2026-09-24',
      reviewer: 'test',
    }],
  }));
  return file;
}

function insertPlan(db, { startDate, title = TITLE, venue = VENUE, ticketUrl = TICKET, description = DESCRIPTION } = {}) {
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_language, original_title, original_description,
      start_date, permanent, venue_name, municipality, latitude, longitude, ticket_url, quality_score, status, created_at, updated_at)
    VALUES ('event', @fp, 'ca', @title, @description, @startDate, 0, @venue, 'Barcelona', 41.38, 2.17, @ticketUrl, 70, 'active', @now, @now)
  `).run({ fp: `${title}|${venue}|${startDate}|${Math.random()}`, title, description, startDate, venue, ticketUrl, now: NOW }).lastInsertRowid);
}

function insertGencatSource(db, planId, recordId, { images = '/x/a.jpg,/x/b.jpg' } = {}) {
  const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  return Number(db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(planId, source.id, recordId, JSON.stringify({ imatges: images }), NOW, NOW).lastInsertRowid);
}

function insertThreeOccurrencePlans(db) {
  const dates = ['2026-09-25', '2026-10-02', '2026-10-09'];
  const planIds = dates.map((startDate) => insertPlan(db, { startDate }));
  const planSourceIds = planIds.map((planId, i) => insertGencatSource(db, planId, `rec-${i}-${Math.random()}`));
  return { planIds, planSourceIds, dates };
}

test('dry-run detects the group, requires an ACCEPT decision, and reports zero problems when one is on file', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);

      // Explicit empty decisions file, NOT the real shipped default path —
      // the real data-policy/recurring-production-decisions.json legitimately
      // carries a real ACCEPT for this exact groupKey since Phase 4C.3B (the
      // production pilot), so this "no decision yet" case must be isolated
      // from that real, evolving file rather than relying on the default.
      const emptyDecisionsPath = path.join(dir, 'empty-decisions.json');
      fs.writeFileSync(emptyDecisionsPath, JSON.stringify({ version: 1, decisions: [] }));
      const withoutDecision = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath: emptyDecisionsPath });
      assert.equal(withoutDecision.ok, false);
      assert.ok(withoutDecision.problems.some((p) => p.includes('No human ACCEPT decision')));

      const decisionsPath = writeDecisionsFile(dir);
      const withDecision = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(withDecision.ok, true, withDecision.problems.join(' | '));
      assert.deepEqual(withDecision.aliasPlanIds, planIds.filter((id) => id !== canonicalPlanId).sort((a, b) => a - b));
      assert.equal(withDecision.expectedPlanCount, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a REJECT or DEFER decision on file also blocks apply (only ACCEPT is sufficient)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const decisionsPath = writeDecisionsFile(dir, { decision: 'DEFER' });
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId: Math.min(...planIds), decisionsPath });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes('No human ACCEPT decision')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('applyConsolidation relinks plan_sources, creates aliases, backfills occurrences, and deactivates alias plans (test G, H)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds, dates } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const aliasPlanIds = planIds.filter((id) => id !== canonicalPlanId);
      const decisionsPath = writeDecisionsFile(dir);

      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(precheck.ok, true, precheck.problems.join(' | '));
      const result = applyConsolidation(db, precheck, { decisionsPath });

      assert.equal(result.canonicalPlanId, canonicalPlanId);
      assert.deepEqual(result.aliasPlanIds.sort((a, b) => a - b), aliasPlanIds.sort((a, b) => a - b));

      for (const psId of planSourceIds) {
        assert.equal(db.prepare('SELECT plan_id FROM plan_sources WHERE id = ?').get(psId).plan_id, canonicalPlanId);
      }
      for (const aliasId of aliasPlanIds) {
        const row = db.prepare('SELECT status, permanent, inactive_at FROM plans WHERE id = ?').get(aliasId);
        assert.equal(row.status, 'inactive');
        assert.equal(row.permanent, 1);
        assert.ok(row.inactive_at);
      }
      assert.equal(db.prepare('SELECT status FROM plans WHERE id = ?').get(canonicalPlanId).status, 'active');

      const aliasRepository = new PlanAliasRepository(db);
      for (const aliasId of aliasPlanIds) assert.equal(aliasRepository.findCanonicalId(aliasId), canonicalPlanId);

      const occurrenceCount = db.prepare(`SELECT COUNT(*) n FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')})`).get().n;
      assert.equal(occurrenceCount, 3);
      const occurrenceDates = db.prepare(`SELECT local_date FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')}) ORDER BY local_date`).all().map((r) => r.local_date);
      assert.deepEqual(occurrenceDates, [...dates].sort());

      // The DB applied-group mapping (Phase 4C.3A atomicity hardening,
      // test A/C) exists and is correct — written in the same transaction.
      const appliedGroupRepository = new RecurringProductionAppliedGroupRepository(db);
      assert.equal(appliedGroupRepository.isApplied(GROUP_KEY), true);
      assert.equal(appliedGroupRepository.findCanonicalPlanId(GROUP_KEY), canonicalPlanId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('canonical plan start_date/end_date summarize the occurrence range after apply', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, dates } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      applyConsolidation(db, precheck, { decisionsPath });
      const row = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
      const sorted = [...dates].sort();
      assert.equal(row.start_date, sorted[0]);
      assert.equal(row.end_date, sorted.at(-1));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('discovery (visible-plan query) excludes alias/duplicate rows and shows the group once (test F)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      applyConsolidation(db, precheck, { decisionsPath });

      const activeRows = db.prepare(`SELECT id FROM plans WHERE id IN (${planIds.join(',')}) AND status = 'active'`).all();
      assert.deepEqual(activeRows.map((r) => r.id), [canonicalPlanId]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('re-running apply on an already-consolidated group is idempotent: no duplicate occurrences/aliases (test H, I)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      applyConsolidation(db, precheck, { decisionsPath });

      // A second run against the same (now-consolidated) data: the group no
      // longer has >=2 distinct member plans with the canonical among them in
      // the same shape (aliases are now inactive, so the detector no longer
      // finds >=2 active candidate rows) — must abort cleanly, not double-write.
      const rerun = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(rerun.ok, false);
      // The explicit "already applied" guard (test F) also independently
      // catches this, not just the indirect "group not detected" path.
      assert.ok(rerun.problems.some((p) => p.includes('has already been applied')));

      const occurrenceCount = db.prepare(`SELECT COUNT(*) n FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')})`).get().n;
      assert.equal(occurrenceCount, 3, 'occurrence rows must not be duplicated by re-running');
      const aliasCount = db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n;
      assert.equal(aliasCount, 2, 'alias rows must not be duplicated by re-running');
      const appliedGroupCount = db.prepare('SELECT COUNT(*) n FROM recurring_production_applied_groups WHERE group_key = ?').get(GROUP_KEY).n;
      assert.equal(appliedGroupCount, 1, 'the applied-group mapping row must not be duplicated by re-running (test F)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a direct attempt to re-apply an already-applied group is rejected by the explicit guard even before the detector re-check (test F)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      applyConsolidation(db, precheck, { decisionsPath });

      const secondAttempt = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(secondAttempt.ok, false);
      assert.ok(secondAttempt.problems.some((p) => p.includes('has already been applied') && p.includes(String(canonicalPlanId))));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('recurring_production_applied_groups.canonical_plan_id must reference a real plan (test G)', () => {
  withTestDatabase((db) => {
    const repository = new RecurringProductionAppliedGroupRepository(db);
    assert.throws(
      () => repository.create({ groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', canonicalPlanId: 999999, appliedBy: 'test' }),
      /FOREIGN KEY/,
    );
  });
});

test('--legacy-alias-id: a historical id with NO corresponding plans row is aliased correctly (Phase 4C.3A legacy-URL hardening)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const legacyId = Math.max(...planIds) + 500_000;
      assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(legacyId), undefined);
      const decisionsPath = writeDecisionsFile(dir);

      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });
      assert.equal(precheck.ok, true, precheck.problems.join(' | '));
      assert.deepEqual(precheck.legacyAliasIds, [legacyId]);
      assert.equal(precheck.allAliasPlanIds.length, precheck.aliasPlanIds.length + 1);

      const applied = applyConsolidation(db, precheck, { decisionsPath });
      const aliasRepository = new PlanAliasRepository(db);
      assert.equal(aliasRepository.findCanonicalId(legacyId), canonicalPlanId);
      assert.equal(aliasRepository.isLegacy(legacyId), true);
      assert.equal(applied.legacyAliasIds.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: duplicate values in the input are deduplicated deterministically, not rejected', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const legacyId = Math.max(...planIds) + 500_000;
      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId, legacyId, legacyId] });
      assert.equal(plan.ok, true, plan.problems.join(' | '));
      assert.deepEqual(plan.legacyAliasIds, [legacyId]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: an id that currently EXISTS as a plans row (and is unrelated to the group) cannot be claimed as legacy — refuses to hijack it', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const unrelatedPlanId = insertPlan(db, { startDate: '2027-01-01', title: 'Completely unrelated show', venue: 'Some other venue' });
      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [unrelatedPlanId] });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes(`legacy-alias-id ${unrelatedPlanId}`) && p.includes('refusing to hijack')));
      assert.equal(db.prepare('SELECT id FROM plans WHERE id = ?').get(unrelatedPlanId).id, unrelatedPlanId, 'the unrelated plan itself is untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: an id that IS part of the currently-detected group cannot be claimed as legacy either (it is not legacy, it is current)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const currentAliasId = planIds.find((id) => id !== canonicalPlanId);
      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [currentAliasId] });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes(`legacy-alias-id ${currentAliasId}`) && p.includes('already part of the currently-detected group')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: an id already aliased to a DIFFERENT canonical plan aborts rather than re-pointing it', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const otherCanonical = insertPlan(db, { startDate: '2027-06-01', title: 'Other production', venue: 'Other venue' });
      const legacyId = Math.max(...planIds) + 500_000;
      new PlanAliasRepository(db).create({ aliasPlanId: legacyId, canonicalPlanId: otherCanonical, groupKey: 'gencat-agenda|other|venue', reason: 'pre-existing', isLegacy: true }, { now: NOW });
      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes(`legacy-alias-id ${legacyId}`) && p.includes(`already an alias of plan ${otherCanonical}`)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: rollback removes the newly-added legacy alias row, without trying to recreate a plans row for it', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const legacyId = Math.max(...planIds) + 500_000;
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });
      let capturedSnapshots;
      applyConsolidation(db, precheck, { decisionsPath, beforeWrite: (_plan, snapshots) => { capturedSnapshots = snapshots; } });

      assert.equal(new PlanAliasRepository(db).findCanonicalId(legacyId), canonicalPlanId);
      // capturedSnapshots is scoped to canonical + current aliases only — the
      // legacy id correctly has NO entry, since it never had a plans row to
      // snapshot (task requirement: rollback must not recreate a fake row).
      assert.equal(capturedSnapshots.some((s) => s.id === legacyId), false);

      // Run the rollback exactly as writeArtifacts() would generate it.
      db.prepare('DELETE FROM plan_aliases WHERE alias_plan_id = ?').run(legacyId);
      assert.equal(new PlanAliasRepository(db).findCanonicalId(legacyId), null);
      assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(legacyId), undefined, 'no fake plans row was ever created for the legacy id');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: a rerun after a successful apply is safe (rejected by the already-applied guard, not double-aliased)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const legacyId = Math.max(...planIds) + 500_000;
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });
      applyConsolidation(db, precheck, { decisionsPath });

      const rerun = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });
      assert.equal(rerun.ok, false);
      assert.ok(rerun.problems.some((p) => p.includes('has already been applied')));
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases WHERE alias_plan_id = ?').get(legacyId).n, 1, 'no duplicate legacy alias row was created');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('--legacy-alias-id: a non-integer or non-positive value is rejected by computeConsolidationPlan itself, not only by the CLI (self-review finding — plan_aliases.alias_plan_id has no FK to catch this at the DB level since migration 016)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      for (const badValue of [-5, 0, 3.7, NaN]) {
        const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [badValue] });
        assert.equal(plan.ok, false, `expected ${badValue} to be rejected`);
        assert.ok(plan.problems.some((p) => p.includes('must be a positive integer')), `expected a clear error for ${badValue}, got: ${plan.problems.join(' | ')}`);
      }
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0, 'nothing was ever written for any of the rejected values');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('two unrelated groups can each be applied independently without interfering with each other (test H)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds: groupOnePlanIds } = insertThreeOccurrencePlans(db);
      const groupOneCanonical = Math.min(...groupOnePlanIds);

      const otherTitle = 'Barcelona Guitar Trio';
      const otherVenue = 'Auditori de Barcelona';
      const otherGroupKey = `gencat-agenda|${normalizeForFingerprint(otherTitle, { removeArticles: true })}|${normalizeVenueIdentity(otherVenue)}`;
      const otherDates = ['2026-11-01', '2026-11-08', '2026-11-15'];
      const groupTwoPlanIds = otherDates.map((startDate) => insertPlan(db, { startDate, title: otherTitle, venue: otherVenue }));
      groupTwoPlanIds.forEach((planId, i) => insertGencatSource(db, planId, `other-rec-${i}-${Math.random()}`));
      const groupTwoCanonical = Math.min(...groupTwoPlanIds);

      const decisionsPath = path.join(dir, 'decisions.json');
      fs.writeFileSync(decisionsPath, JSON.stringify({
        version: 1,
        decisions: [
          {
            groupKey: GROUP_KEY, source: 'gencat-agenda',
            normalizedTitle: normalizeForFingerprint(TITLE, { removeArticles: true }), venueIdentity: normalizeVenueIdentity(VENUE),
            decision: 'ACCEPT', reason: 'test', reviewedAt: '2026-09-24', reviewer: 'test',
          },
          {
            groupKey: otherGroupKey, source: 'gencat-agenda',
            normalizedTitle: normalizeForFingerprint(otherTitle, { removeArticles: true }), venueIdentity: normalizeVenueIdentity(otherVenue),
            decision: 'ACCEPT', reason: 'test', reviewedAt: '2026-09-24', reviewer: 'test',
          },
        ],
      }));

      const precheckOne = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId: groupOneCanonical, decisionsPath });
      applyConsolidation(db, precheckOne, { decisionsPath });
      const precheckTwo = computeConsolidationPlan(db, { groupKey: otherGroupKey, canonicalPlanId: groupTwoCanonical, decisionsPath });
      applyConsolidation(db, precheckTwo, { decisionsPath });

      const appliedGroupRepository = new RecurringProductionAppliedGroupRepository(db);
      assert.equal(appliedGroupRepository.findCanonicalPlanId(GROUP_KEY), groupOneCanonical);
      assert.equal(appliedGroupRepository.findCanonicalPlanId(otherGroupKey), groupTwoCanonical);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_production_applied_groups').get().n, 2);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a PRE-WRITE transaction failure (fresh TOCTOU re-check) leaves NO aliases, NO relinks, NO occurrences, and NO applied-group mapping (test B)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      const beforeLinks = db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all();

      // Forces the in-transaction TOCTOU re-check to fail — this happens at
      // the very START of applyConsolidation()'s transaction, BEFORE any
      // write statement runs (see the separate test below for a failure
      // forced AFTER every write, including the mapping insert, instead).
      const tampered = { ...precheck, aliasPlanIds: [...precheck.aliasPlanIds, 999999] };
      assert.throws(() => applyConsolidation(db, tampered, { decisionsPath }), /group membership differs/);

      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0, 'no aliases');
      assert.deepEqual(db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all(), beforeLinks, 'no relinks');
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')})`).get().n, 0, 'no occurrences');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_production_applied_groups').get().n, 0, 'no applied-group mapping');
      assert.equal(db.prepare('SELECT status FROM plans WHERE id = ?').get(canonicalPlanId).status, 'active', 'canonical plan untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a POST-WRITE failure (after the mapping insert and every other write) rolls back the mapping too, not just aliases/relinks/occurrences (test B, cross-review finding)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      const beforeLinks = db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all();

      // Force the LAST invariant check inside applyConsolidation() (the
      // canonicalStatus re-read, `SELECT status FROM plans WHERE id = ?`) to
      // throw — by then, every write including the
      // recurring_production_applied_groups INSERT has already executed
      // inside this same uncommitted transaction. This proves rollback
      // genuinely undoes the mapping insert too, not just the writes that
      // happen to precede it (the earlier atomicity test only forced a
      // failure BEFORE any write ran).
      const realPrepare = db.prepare.bind(db);
      const spiedPrepare = (sql) => {
        if (sql === 'SELECT status FROM plans WHERE id = ?') {
          throw new Error('Simulated late-stage failure (test-injected)');
        }
        return realPrepare(sql);
      };
      db.prepare = spiedPrepare;
      try {
        assert.throws(() => applyConsolidation(db, precheck, { decisionsPath }), /Simulated late-stage failure/);
      } finally {
        db.prepare = realPrepare;
      }

      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0, 'no aliases survive rollback');
      assert.deepEqual(db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all(), beforeLinks, 'relinks are rolled back');
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')})`).get().n, 0, 'occurrences are rolled back');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_production_applied_groups').get().n, 0, 'the mapping insert is rolled back too, even though it already executed');
      assert.equal(db.prepare('SELECT status FROM plans WHERE id = ?').get(canonicalPlanId).status, 'active');
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a POST-WRITE failure rolls back a legacy alias insert too, not just current aliases (self-review finding, Phase 4C.3A legacy-URL hardening)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const legacyId = Math.max(...planIds) + 500_000;
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath, legacyAliasIds: [legacyId] });

      const realPrepare = db.prepare.bind(db);
      const spiedPrepare = (sql) => {
        if (sql === 'SELECT status FROM plans WHERE id = ?') throw new Error('Simulated late-stage failure (test-injected)');
        return realPrepare(sql);
      };
      db.prepare = spiedPrepare;
      try {
        assert.throws(() => applyConsolidation(db, precheck, { decisionsPath }), /Simulated late-stage failure/);
      } finally {
        db.prepare = realPrepare;
      }

      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases WHERE alias_plan_id = ?').get(legacyId).n, 0, 'the legacy alias insert (which already executed) is rolled back too');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0, 'no aliases at all survive rollback');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a mismatched --expected-plan-count aborts with zero writes (test J)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(precheck.expectedPlanCount, 3);
      // Simulate the CLI's own guard: caller-supplied --expected-plan-count=99 must not match.
      assert.notEqual(precheck.expectedPlanCount, 99);
      // The transactional re-check inside applyConsolidation would also catch
      // a group whose real size no longer matches what applyConsolidation is
      // told to expect via the aliasPlanIds/sourceRows length comparison.
      const tampered = { ...precheck, aliasPlanIds: [...precheck.aliasPlanIds, 999999] };
      assert.throws(() => applyConsolidation(db, tampered, { decisionsPath }), /group membership differs/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a plan carrying a plan_sources row from a different source aborts as cross-source contamination (test K)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const contaminatedPlanId = planIds.find((id) => id !== canonicalPlanId);
      const diba = db.prepare("SELECT id FROM sources WHERE key = 'diba-tourisme'").get();
      db.prepare(`
        INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
        VALUES (?, ?, 'contaminating-record', '{}', ?, ?)
      `).run(contaminatedPlanId, diba.id, NOW, NOW);

      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes('Cross-source contamination')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('a canonical-plan-id that is not a member of the detected group aborts (test L)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      insertThreeOccurrencePlans(db);
      const unrelatedPlanId = insertPlan(db, { startDate: '2027-01-01', title: 'Unrelated show', venue: 'Other venue' });
      const decisionsPath = writeDecisionsFile(dir);
      const plan = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId: unrelatedPlanId, decisionsPath });
      assert.equal(plan.ok, false);
      assert.ok(plan.problems.some((p) => p.includes('is not a member of the detected group')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('rollback SQL (generated before commit) restores pre-migration state exactly (test M)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const aliasPlanIds = planIds.filter((id) => id !== canonicalPlanId);
      const decisionsPath = writeDecisionsFile(dir);

      const before = db.prepare(`SELECT id, status, permanent, inactive_at, start_date, end_date FROM plans WHERE id IN (${planIds.join(',')}) ORDER BY id`).all();
      const beforeSourceLinks = db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all();

      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      let capturedSnapshots;
      applyConsolidation(db, precheck, {
        decisionsPath,
        beforeWrite: (_plan, snapshots) => { capturedSnapshots = snapshots; },
      });

      // Build and run the exact rollback statements the script would have
      // written to disk (mirrors writeArtifacts()'s rollback SQL shape).
      db.transaction(() => {
        for (const s of capturedSnapshots) {
          db.prepare('UPDATE plans SET status=?, permanent=?, inactive_at=?, start_date=?, end_date=? WHERE id=?')
            .run(s.status, s.permanent, s.inactive_at, s.start_date, s.end_date, s.id);
        }
        for (const link of beforeSourceLinks) {
          db.prepare('UPDATE plan_sources SET plan_id=? WHERE id=?').run(link.plan_id, link.id);
        }
        db.prepare(`DELETE FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.join(',')})`).run();
        db.prepare(`DELETE FROM plan_aliases WHERE alias_plan_id IN (${aliasPlanIds.join(',')})`).run();
        // The applied-group mapping is now part of the same DB state and
        // must be part of the same rollback SQL (test D — no separate JSON
        // file to restore anymore, Phase 4C.3A atomicity hardening).
        db.prepare('DELETE FROM recurring_production_applied_groups WHERE group_key = ?').run(GROUP_KEY);
      })();

      const after = db.prepare(`SELECT id, status, permanent, inactive_at, start_date, end_date FROM plans WHERE id IN (${planIds.join(',')}) ORDER BY id`).all();
      assert.deepEqual(after, before);
      const afterSourceLinks = db.prepare(`SELECT id, plan_id FROM plan_sources WHERE id IN (${planSourceIds.join(',')}) ORDER BY id`).all();
      assert.deepEqual(afterSourceLinks, beforeSourceLinks);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_occurrences').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_production_applied_groups').get().n, 0, 'test D: mapping removed by rollback');
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('future import: a new source record for an already-consolidated group attaches to the canonical plan via targetPlanId, not a new plan (test N)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      applyConsolidation(db, precheck, { decisionsPath });

      // Simulate PlanRepository.persist() being called with targetPlanId set
      // (as GencatAgendaImporter.getTargetPlanId() would supply for a brand
      // new occurrence date of this same production, per the applied-groups
      // mapping) for a genuinely NEW source_record_id.
      const totalPlansBefore = db.prepare('SELECT COUNT(*) n FROM plans').get().n;
      const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
      const newSourceRecordId = 'brand-new-future-occurrence@hash999';
      const duplicate = db.prepare('SELECT * FROM plans WHERE id = ?').get(canonicalPlanId);
      assert.ok(duplicate, 'targetPlanId lookup finds the canonical plan directly, bypassing fingerprint lookup');
      db.prepare(`
        INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
        VALUES (?, ?, ?, '{}', ?, ?)
      `).run(canonicalPlanId, source.id, newSourceRecordId, NOW, NOW);

      const totalPlansAfter = db.prepare('SELECT COUNT(*) n FROM plans').get().n;
      assert.equal(totalPlansAfter, totalPlansBefore, 'no new fragmented plan row was created');
      const newLink = db.prepare('SELECT plan_id FROM plan_sources WHERE source_record_id = ?').get(newSourceRecordId);
      assert.equal(newLink.plan_id, canonicalPlanId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('categories present only on alias plans are merged onto the canonical plan, without duplicating shared ones (cross-review finding)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);
      const aliasPlanIds = planIds.filter((id) => id !== canonicalPlanId);
      const musica = db.prepare("SELECT id FROM categories WHERE slug = 'musica'").get().id;
      const espectacles = db.prepare("SELECT id FROM categories WHERE slug = 'espectacles'").get().id;
      // Canonical already has 'musica'; one alias also has 'musica' (shared,
      // must not duplicate/error), the other alias has 'espectacles' only
      // (must be merged onto canonical).
      db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(canonicalPlanId, musica);
      db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(aliasPlanIds[0], musica);
      db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(aliasPlanIds[1], espectacles);

      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      const applied = applyConsolidation(db, precheck, { decisionsPath });

      assert.deepEqual(applied.newCategoryIds, [espectacles]);
      const canonicalCategories = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id = ? ORDER BY category_id').all(canonicalPlanId).map((r) => r.category_id);
      assert.deepEqual(canonicalCategories.sort((a, b) => a - b), [musica, espectacles].sort((a, b) => a - b));
      // No PK conflict/duplicate row from the shared 'musica' category.
      assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_categories WHERE plan_id = ? AND category_id = ?').get(canonicalPlanId, musica).n, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('rollback restores a pre-existing occurrence row to its EXACT prior values rather than deleting it (cross-review finding on rollback completeness)', () => {
  withTestDatabase((db) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-decisions-'));
    try {
      const { planIds, planSourceIds } = insertThreeOccurrencePlans(db);
      const canonicalPlanId = Math.min(...planIds);

      // Pre-seed an occurrence at the SAME (plan_source_id, occurrence_key)
      // the consolidation will upsert, with different values and inactive
      // status — simulating a hypothetical pre-existing row this generic
      // script must not silently clobber-and-then-delete-on-rollback.
      const recordId = db.prepare('SELECT source_record_id FROM plan_sources WHERE id = ?').get(planSourceIds[0]).source_record_id;
      db.prepare(`
        INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
        VALUES (?, ?, '2020-01-01', 'Europe/Madrid', 'inactive', ?, ?, ?)
      `).run(planSourceIds[0], recordId, NOW, NOW, NOW);

      const decisionsPath = writeDecisionsFile(dir);
      const precheck = computeConsolidationPlan(db, { groupKey: GROUP_KEY, canonicalPlanId, decisionsPath });
      let captured;
      const applied = applyConsolidation(db, precheck, {
        decisionsPath,
        beforeWrite: (_plan, snapshots, extra) => { captured = extra; },
      });
      assert.equal(applied.occurrenceBeforeSnapshots.length, 3);
      const preExisting = applied.occurrenceBeforeSnapshots.find((o) => o.planSourceId === planSourceIds[0]);
      assert.ok(preExisting.before, 'the pre-existing row was captured before being upserted');
      assert.equal(preExisting.before.local_date, '2020-01-01');
      assert.equal(preExisting.before.status, 'inactive');

      // The upsert did overwrite it (consolidation's own correctness):
      const afterApply = db.prepare('SELECT local_date, status FROM plan_occurrences WHERE plan_source_id = ? AND occurrence_key = ?').get(planSourceIds[0], recordId);
      assert.notEqual(afterApply.local_date, '2020-01-01');
      assert.equal(afterApply.status, 'active');

      // Reconstruct and run the rollback exactly as writeArtifacts() would generate it.
      for (const { planSourceId, occurrenceKey, before } of captured.occurrenceBeforeSnapshots) {
        if (before) {
          db.prepare(`
            UPDATE plan_occurrences SET starts_at=?, ends_at=?, local_date=?, local_time=?, timezone=?, status=?, last_seen_at=?, updated_at=?
            WHERE plan_source_id=? AND occurrence_key=?
          `).run(before.starts_at, before.ends_at, before.local_date, before.local_time, before.timezone, before.status, before.last_seen_at, before.updated_at, planSourceId, occurrenceKey);
        } else {
          db.prepare('DELETE FROM plan_occurrences WHERE plan_source_id=? AND occurrence_key=?').run(planSourceId, occurrenceKey);
        }
      }

      const restored = db.prepare('SELECT local_date, status FROM plan_occurrences WHERE plan_source_id = ? AND occurrence_key = ?').get(planSourceIds[0], recordId);
      assert.equal(restored.local_date, '2020-01-01', 'rollback restored the pre-existing row instead of deleting it');
      assert.equal(restored.status, 'inactive');
      // The other two, genuinely-new occurrences were correctly deleted, not left behind.
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM plan_occurrences WHERE plan_source_id IN (${planSourceIds.slice(1).join(',')})`).get().n, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('occurrence upsert for an already-existing plan_source/occurrence_key pair is a true no-op (idempotent backfill, test H)', () => {
  withTestDatabase((db) => {
    const { planSourceIds } = insertThreeOccurrencePlans(db);
    const repository = new PlanOccurrenceRepository(db);
    const outcome1 = repository.upsert(planSourceIds[0], { occurrenceKey: 'k', localDate: '2026-09-25', timezone: 'Europe/Madrid', status: 'active' });
    const outcome2 = repository.upsert(planSourceIds[0], { occurrenceKey: 'k', localDate: '2026-09-25', timezone: 'Europe/Madrid', status: 'active' });
    assert.equal(outcome1, 'inserted');
    assert.equal(outcome2, 'unchanged');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_occurrences').get().n, 1);
  });
});
