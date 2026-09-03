import assert from 'node:assert/strict';
import test from 'node:test';
import { componentKey, loadFinalReviewDecisions, stableKey, validateFinalReviewDecisions } from '../backend/src/diba/dibaFinalReviewDecisions.js';

const approved = loadFinalReviewDecisions();
function clone() { return JSON.parse(JSON.stringify({ version: approved.version, decisions: approved.decisions })); }

test('F1 persists exactly five complete stable final-review components', () => {
  assert.equal(approved.decisions.length, 5); assert.deepEqual(approved.summary, { defer: 3, consolidate: 2, sourceMembers: 12 });
  assert.equal(new Set(approved.decisions.flatMap(({ sourceMembers }) => sourceMembers.map(stableKey))).size, 12);
  assert.ok(approved.decisions.every(({ sourceMembers }) => componentKey(sourceMembers).includes(':')));
});

test('F1 decision validation fails closed for missing or extra component members', () => {
  const missing = clone(); missing.decisions[0].sourceMembers.pop(); assert.throws(() => validateFinalReviewDecisions(missing), /malformed|exactly/);
  const extra = clone(); extra.decisions[0].sourceMembers.push({ sourceKey: 'diba-escenari', sourceRecordId: 'unexpected' }); assert.throws(() => validateFinalReviewDecisions(extra), /twelve stable members/);
});

test('F1 DEFER cannot name a survivor and consolidation requires a member survivor', () => {
  const defer = clone(); defer.decisions.find(({ disposition }) => disposition === 'DEFER').canonicalSourceIdentity = { sourceKey: 'diba-escenari', sourceRecordId: 'x' }; assert.throws(() => validateFinalReviewDecisions(defer), /DEFER/);
  const consolidate = clone(); const item = consolidate.decisions.find(({ disposition }) => disposition === 'CONSOLIDATE_TO_ONE_PLAN'); item.canonicalSourceIdentity = { sourceKey: 'diba-tourisme', sourceRecordId: 'not-a-member' }; assert.throws(() => validateFinalReviewDecisions(consolidate), /requires a canonical member/);
});

test('F1 persists the approved Tallers and deterministic Memòria canonical stable identities', () => {
  const tallers = approved.decisions.find(({ sourceMembers }) => sourceMembers.some(({ sourceRecordId }) => sourceRecordId === 'agendaturisme456532369'));
  const memoria = approved.decisions.find(({ sourceMembers }) => sourceMembers.some(({ sourceRecordId }) => sourceRecordId === 'actesmuseus3364940'));
  assert.equal(stableKey(tallers.canonicalSourceIdentity), 'diba-tourisme:agendaturisme456532369');
  assert.equal(stableKey(memoria.canonicalSourceIdentity), 'diba-museus:actesmuseus3364940');
});
