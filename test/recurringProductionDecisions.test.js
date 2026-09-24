import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateRecurringProductionDecisions,
  decisionsByGroupKey,
} from '../backend/src/deduplication/recurringProductionDecisions.js';
import { RECURRING_PRODUCTION_DECISIONS_PATH } from '../backend/src/deduplication/recurringProductionDecisions.js';
import { readFileSync } from 'node:fs';

test('the shipped decision file is empty by default — no ACCEPT decisions are pre-populated from the audit', () => {
  const payload = JSON.parse(readFileSync(RECURRING_PRODUCTION_DECISIONS_PATH, 'utf8'));
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.decisions, []);
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

test('decisionsByGroupKey loads the shipped (empty) file without throwing', () => {
  const map = decisionsByGroupKey();
  assert.equal(map.size, 0);
});
