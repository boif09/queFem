import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReviewComponents } from '../scripts/dibaFinalHumanReview.js';

function component(sourceKey, ids, decision) { return { decision, cluster: { sourceKey, planIds: ids.map((_, index) => index + 1), records: ids.map((sourceRecordId) => ({ sourceRecordId })) } }; }

test('final human-review inventory uses stable membership and does not double-count only overlapping classes', () => {
  const same = component('diba-escenari', ['a', 'b'], 'NEEDS_HUMAN_REVIEW'); const session = component('diba-museus', ['c', 'd'], 'KEEP_SEPARATE_SESSION'); const overlap = component('diba-escenari', ['a', 'b'], 'KEEP_SEPARATE_SESSION');
  const result = mergeReviewComponents([same], [session, overlap]);
  assert.equal(result.length, 2); assert.deepEqual(result.find(({ signature }) => signature === 'diba-escenari:a|diba-escenari:b').classes.sort(), ['same-feed', 'session-DEFER']); assert.deepEqual(result.find(({ signature }) => signature === 'diba-museus:c|diba-museus:d').classes, ['session-DEFER']);
});

test('final human-review component identities never depend on numeric plan IDs', () => {
  const one = component('diba-escenari', ['source-a', 'source-b'], 'NEEDS_HUMAN_REVIEW'); const two = { ...one, cluster: { ...one.cluster, planIds: [999, 1000] } };
  assert.equal(mergeReviewComponents([one], [])[0].signature, mergeReviewComponents([two], [])[0].signature);
});
