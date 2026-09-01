import { readFile } from 'node:fs/promises';

export const REVIEWED_DECISIONS = new Set(['LINK_TO_EXISTING', 'KEEP_SEPARATE', 'DEFER']);

function identity(value, label) {
  if (!value || typeof value !== 'object' || !String(value.sourceKey || '').trim() || !String(value.sourceRecordId || '').trim()) throw new Error(`${label} must contain sourceKey and sourceRecordId.`);
  return { sourceKey: String(value.sourceKey), sourceRecordId: String(value.sourceRecordId) };
}
export function identityKey(value) { return `${value.sourceKey}:${value.sourceRecordId}`; }

export function validateDibaPolicyOverrides(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.decisions)) throw new Error('DIBA policy overrides must have version 1 and a decisions array.');
  const seen = new Set();
  const decisions = payload.decisions.map((item, index) => {
    const source = identity(item.source, `decisions[${index}].source`); const decision = String(item.decision || '');
    if (!REVIEWED_DECISIONS.has(decision)) throw new Error(`Unknown reviewed decision ${decision || '(missing)'}.`);
    const key = identityKey(source); if (seen.has(key)) throw new Error(`Duplicate override source identity ${key}.`); seen.add(key);
    const target = item.target === undefined ? null : identity(item.target, `decisions[${index}].target`);
    if (decision === 'LINK_TO_EXISTING' && !target) throw new Error(`LINK_TO_EXISTING requires a stable target for ${key}.`);
    if (decision !== 'LINK_TO_EXISTING' && target) throw new Error(`${decision} must not include a target for ${key}.`);
    if (!String(item.reason || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.reviewedAt || '')) || !String(item.reviewer || '').trim()) throw new Error(`Override ${key} requires reason, reviewedAt and reviewer.`);
    if ('targetPlanId' in item || 'planId' in item) throw new Error(`Override ${key} must not use a numeric plan identifier as durable identity.`);
    return { source, decision, target, reason: String(item.reason), reviewedAt: String(item.reviewedAt), reviewer: String(item.reviewer), expectedPlanId: Number.isInteger(item.expectedPlanId) ? item.expectedPlanId : null };
  });
  return { version: 1, decisions };
}

export async function loadDibaPolicyOverrides(filePath) {
  let payload;
  try { payload = JSON.parse(await readFile(filePath, 'utf8')); } catch (error) { throw new Error(`Cannot load DIBA policy overrides: ${error.message}`); }
  return validateDibaPolicyOverrides(payload);
}
