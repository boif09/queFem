// Loads and validates the human-reviewed decision file for recurring-
// production grouping candidates (see recurringProductionDetector.js).
// Mirrors the existing DIBA policy-override pattern
// (backend/src/diba/dibaPolicyOverrides.js) for consistency: a versioned,
// append-only JSON file, one stable identity per decision, required
// reason/reviewedAt/reviewer metadata, no numeric plan ID as durable
// identity.
//
// The detector's output and this file are deliberately kept separate: the
// detector always recomputes its classification fresh from current data, and
// this file only ever records what a human has actually reviewed and
// decided — nothing here is auto-populated from a detector run.
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidIsoDate } from './recurringProductionDetector.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RECURRING_PRODUCTION_DECISIONS_PATH = path.join(root, 'data-policy', 'recurring-production-decisions.json');

export const RECURRING_PRODUCTION_DECISIONS = new Set(['ACCEPT', 'REJECT', 'DEFER']);

function identity(item, label) {
  const groupKey = String(item.groupKey || '').trim();
  const source = String(item.source || '').trim();
  const normalizedTitle = String(item.normalizedTitle || '').trim();
  const venueIdentity = String(item.venueIdentity || '').trim();
  if (!groupKey || !source || !normalizedTitle || !venueIdentity) {
    throw new Error(`${label} must contain groupKey, source, normalizedTitle and venueIdentity.`);
  }
  const expectedGroupKey = `${source}|${normalizedTitle}|${venueIdentity}`;
  if (groupKey !== expectedGroupKey) {
    throw new Error(`${label} groupKey "${groupKey}" does not match source|normalizedTitle|venueIdentity ("${expectedGroupKey}").`);
  }
  return { groupKey, source, normalizedTitle, venueIdentity };
}

export function validateRecurringProductionDecisions(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.decisions)) {
    throw new Error('Recurring-production decisions must have version 1 and a decisions array.');
  }
  const seen = new Set();
  const decisions = payload.decisions.map((item, index) => {
    const groupIdentity = identity(item, `decisions[${index}]`);
    if (seen.has(groupIdentity.groupKey)) throw new Error(`Duplicate recurring-production decision for group ${groupIdentity.groupKey}.`);
    seen.add(groupIdentity.groupKey);
    const decision = String(item.decision || '');
    if (!RECURRING_PRODUCTION_DECISIONS.has(decision)) throw new Error(`Unknown recurring-production decision "${decision || '(missing)'}" for group ${groupIdentity.groupKey}.`);
    if (!String(item.reason || '').trim() || !isValidIsoDate(String(item.reviewedAt || '')) || !String(item.reviewer || '').trim()) {
      throw new Error(`Decision for group ${groupIdentity.groupKey} requires reason, reviewedAt (a real calendar date, YYYY-MM-DD) and reviewer.`);
    }
    if ('planId' in item || 'canonicalPlanId' in item) {
      throw new Error(`Decision for group ${groupIdentity.groupKey} must not use a numeric plan identifier as durable identity.`);
    }
    return {
      ...groupIdentity,
      decision,
      reason: String(item.reason),
      reviewedAt: String(item.reviewedAt),
      reviewer: String(item.reviewer),
    };
  });
  return { version: 1, decisions };
}

export async function loadRecurringProductionDecisions(filePath = RECURRING_PRODUCTION_DECISIONS_PATH) {
  let payload;
  try {
    payload = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot load recurring-production decisions: ${error.message}`);
  }
  return validateRecurringProductionDecisions(payload);
}

export function loadRecurringProductionDecisionsSync(filePath = RECURRING_PRODUCTION_DECISIONS_PATH) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot load recurring-production decisions: ${error.message}`);
  }
  return validateRecurringProductionDecisions(payload);
}

export function decisionsByGroupKey(filePath = RECURRING_PRODUCTION_DECISIONS_PATH) {
  return new Map(loadRecurringProductionDecisionsSync(filePath).decisions.map((entry) => [entry.groupKey, entry]));
}
