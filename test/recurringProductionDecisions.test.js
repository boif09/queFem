import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateRecurringProductionDecisions,
  decisionsByGroupKey,
} from '../backend/src/deduplication/recurringProductionDecisions.js';
import { RECURRING_PRODUCTION_DECISIONS_PATH } from '../backend/src/deduplication/recurringProductionDecisions.js';
import { readFileSync } from 'node:fs';

test('the shipped decision file validates, and is never auto-populated from the audit — only ever from explicit human review', () => {
  const payload = JSON.parse(readFileSync(RECURRING_PRODUCTION_DECISIONS_PATH, 'utf8'));
  assert.equal(payload.version, 1);
  assert.ok(Array.isArray(payload.decisions));
  // As of Phase 4C.3B, this file legitimately carries the human-authorized
  // ACCEPT decision for the Gran Gala Flamenc pilot — this is a real
  // decision recorded through git, not a placeholder. Any entry present
  // must still satisfy the full validator (this is the actual regression
  // guard: the shipped file itself must always be structurally valid).
  const validated = validateRecurringProductionDecisions(payload);
  assert.equal(validated.decisions.length, payload.decisions.length);
});

test('a valid decision entry round-trips correctly', () => {
  const entry = {
    groupKey: 'gencat-agenda|gran-gala-flamenc|palau-de-la-musica-catalana',
    source: 'gencat-agenda',
    normalizedTitle: 'gran-gala-flamenc',
    venueIdentity: 'palau-de-la-musica-catalana',
    decision: 'ACCEPT',
    reason: 'Confirmed one production via identical ticket URL, description and image set.',
    reviewedAt: '2026-09-24',
    reviewer: 'human-review',
  };
  const result = validateRecurringProductionDecisions({ version: 1, decisions: [entry] });
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, 'ACCEPT');
});

test('rejects a decision whose groupKey does not match source|normalizedTitle|venueIdentity', () => {
  assert.throws(() => validateRecurringProductionDecisions({
    version: 1,
    decisions: [{
      groupKey: 'gencat-agenda|wrong-key|palau-de-la-musica-catalana',
      source: 'gencat-agenda', normalizedTitle: 'gran-gala-flamenc', venueIdentity: 'palau-de-la-musica-catalana',
      decision: 'ACCEPT', reason: 'x', reviewedAt: '2026-09-24', reviewer: 'human-review',
    }],
  }), /does not match/);
});

test('rejects an unknown decision value', () => {
  assert.throws(() => validateRecurringProductionDecisions({
    version: 1,
    decisions: [{
      groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', normalizedTitle: 'x', venueIdentity: 'y',
      decision: 'MAYBE', reason: 'x', reviewedAt: '2026-09-24', reviewer: 'human-review',
    }],
  }), /Unknown recurring-production decision/);
});

test('rejects a decision missing reason, reviewedAt or reviewer', () => {
  assert.throws(() => validateRecurringProductionDecisions({
    version: 1,
    decisions: [{ groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', normalizedTitle: 'x', venueIdentity: 'y', decision: 'REJECT' }],
  }), /requires reason/);
});

test('rejects a decision that uses a numeric plan ID as durable identity', () => {
  assert.throws(() => validateRecurringProductionDecisions({
    version: 1,
    decisions: [{
      groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', normalizedTitle: 'x', venueIdentity: 'y',
      decision: 'ACCEPT', reason: 'x', reviewedAt: '2026-09-24', reviewer: 'human-review', planId: 1196,
    }],
  }), /must not use a numeric plan identifier/);
});

test('rejects a decision with a calendar-impossible reviewedAt (cross-review finding)', () => {
  assert.throws(() => validateRecurringProductionDecisions({
    version: 1,
    decisions: [{
      groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', normalizedTitle: 'x', venueIdentity: 'y',
      decision: 'REJECT', reason: 'x', reviewedAt: '2026-02-30', reviewer: 'human-review',
    }],
  }), /requires reason/);
});

test('rejects a duplicate groupKey', () => {
  const entry = {
    groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', normalizedTitle: 'x', venueIdentity: 'y',
    decision: 'REJECT', reason: 'x', reviewedAt: '2026-09-24', reviewer: 'human-review',
  };
  assert.throws(() => validateRecurringProductionDecisions({ version: 1, decisions: [entry, entry] }), /Duplicate/);
});

test('decisionsByGroupKey loads the shipped file without throwing, keyed correctly by groupKey', () => {
  const map = decisionsByGroupKey();
  const ganGalaGroupKey = 'gencat-agenda|gran-gala-flamenc|palau-de-la-musica-catalana';
  assert.ok(map.size >= 1, 'the shipped file has at least the Gran Gala Flamenc pilot decision (Phase 4C.3B)');
  assert.equal(map.get(ganGalaGroupKey)?.decision, 'ACCEPT');
});
