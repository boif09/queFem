import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FINAL_REVIEW_PATH = path.join(root, 'data-policy', 'diba-final-review-decisions.json');
const operations = new Set(['REVIEW_SAME_FEED_COMPONENT', 'REVIEW_SESSION_COMPONENT']);
const dispositions = new Set(['CONSOLIDATE_TO_ONE_PLAN', 'DEFER']);
export const stableKey = ({ sourceKey, sourceRecordId }) => `${sourceKey}:${String(sourceRecordId)}`;
function identity(value, label) { if (!value || !String(value.sourceKey || '').startsWith('diba-') || !String(value.sourceRecordId || '').trim()) throw new Error(`${label} requires a DIBA stable source identity.`); return { sourceKey: String(value.sourceKey), sourceRecordId: String(value.sourceRecordId) }; }
export function componentKey(members) { return members.map(stableKey).sort().join('|'); }
export function validateFinalReviewDecisions(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.decisions) || payload.decisions.length !== 5) throw new Error('Final DIBA review decisions require version 1 and exactly five decisions.');
  const seenComponents = new Set(); const seenSources = new Set();
  const decisions = payload.decisions.map((item, index) => { const sourceMembers = (item.sourceMembers || []).map((value, memberIndex) => identity(value, `decisions[${index}].sourceMembers[${memberIndex}]`)); const key = componentKey(sourceMembers); if (!operations.has(item.operation) || !dispositions.has(item.disposition) || sourceMembers.length < 2 || new Set(sourceMembers.map(stableKey)).size !== sourceMembers.length || seenComponents.has(key)) throw new Error(`Final DIBA decision ${index} is malformed or duplicates a component.`); seenComponents.add(key); for (const source of sourceMembers) { const sourceKey = stableKey(source); if (seenSources.has(sourceKey)) throw new Error(`Final DIBA source ${sourceKey} appears in more than one reviewed component.`); seenSources.add(sourceKey); } const canonicalSourceIdentity = item.canonicalSourceIdentity == null ? null : identity(item.canonicalSourceIdentity, `decisions[${index}].canonicalSourceIdentity`); if (item.disposition === 'DEFER' && canonicalSourceIdentity) throw new Error(`DEFER component ${key} must not specify a canonical survivor.`); if (item.disposition === 'CONSOLIDATE_TO_ONE_PLAN' && (!canonicalSourceIdentity || !sourceMembers.some((source) => stableKey(source) === stableKey(canonicalSourceIdentity)))) throw new Error(`CONSOLIDATE component ${key} requires a canonical member identity.`); if (!String(item.rationale || '').trim() || item.reviewedAt !== '2026-09-03' || item.reviewer !== 'human-review') throw new Error(`Final DIBA decision ${key} lacks approved review metadata.`); return { operation: item.operation, sourceMembers, disposition: item.disposition, canonicalSourceIdentity, rationale: String(item.rationale), reviewedAt: item.reviewedAt, reviewer: item.reviewer }; });
  const summary = { defer: decisions.filter(({ disposition }) => disposition === 'DEFER').length, consolidate: decisions.filter(({ disposition }) => disposition === 'CONSOLIDATE_TO_ONE_PLAN').length, sourceMembers: seenSources.size };
  if (summary.defer !== 3 || summary.consolidate !== 2 || summary.sourceMembers !== 12) throw new Error('Final DIBA decisions must be exactly three DEFER, two consolidation and twelve stable members.'); return { version: 1, decisions, summary };
}
export function loadFinalReviewDecisions(filePath = FINAL_REVIEW_PATH) { return validateFinalReviewDecisions(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
export function deferredFinalReviewKeys(filePath = FINAL_REVIEW_PATH) { return new Set(loadFinalReviewDecisions(filePath).decisions.filter(({ disposition }) => disposition === 'DEFER').flatMap(({ sourceMembers }) => sourceMembers.map(stableKey))); }
