import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExpectedSameFeedTransition } from '../scripts/dibaHumanReviewedPossibleRehearsal.js';

function component(members, planIds, decision) { return { decision, cluster: { sourceKey: 'diba-escenari', planIds, classification: planIds.length === 1 ? 'ALREADY_CONSOLIDATED' : 'NEEDS_HUMAN_REVIEW', records: members.map((sourceRecordId) => ({ sourceKey: 'diba-escenari', sourceRecordId })) } }; }
function state({ sameFeed, session = [] }) { return { policy: { sameFeed: [...sameFeed, ...session] }, audit: { sameFeed: { clusters: sameFeed.map(({ cluster }) => cluster) } } }; }
const bubble = [{ sourceKey: 'diba-escenari', sourceRecordId: 'bubble-1145' }, { sourceKey: 'diba-escenari', sourceRecordId: 'bubble-1800' }];
const other = component(['other-a', 'other-b'], [20, 21], 'NEEDS_HUMAN_REVIEW'); const session = component(['session-a', 'session-b'], [30, 31], 'KEEP_SEPARATE_SESSION');

test('E3.1 permits only the reviewed BubbleBike 2->1 same-feed transition and preserves session blockers', () => {
  const beforeBubble = component(['bubble-1145', 'bubble-1800'], [10, 11], 'NEEDS_HUMAN_REVIEW'); const afterBubble = component(['bubble-1145', 'bubble-1800'], [99], 'ALREADY_CONSOLIDATED');
  const result = validateExpectedSameFeedTransition({ preState: state({ sameFeed: [beforeBubble, other], session: [session] }), postState: state({ sameFeed: [other, afterBubble], session: [session] }), bubbleSources: bubble });
  assert.equal(result.removed.length, 1); assert.equal(result.added.length, 0); assert.equal(result.postSessionDefer.length, 1);
});

test('E3.1 rejects unrelated same-feed loss, new blockers, and session-DEFER changes', () => {
  const beforeBubble = component(['bubble-1145', 'bubble-1800'], [10, 11], 'NEEDS_HUMAN_REVIEW'); const afterBubble = component(['bubble-1145', 'bubble-1800'], [99], 'ALREADY_CONSOLIDATED'); const pre = state({ sameFeed: [beforeBubble, other], session: [session] });
  assert.throws(() => validateExpectedSameFeedTransition({ preState: pre, postState: state({ sameFeed: [afterBubble], session: [session] }), bubbleSources: bubble }), /exactly the approved BubbleBike/);
  assert.throws(() => validateExpectedSameFeedTransition({ preState: pre, postState: state({ sameFeed: [other, component(['new-a', 'new-b'], [40, 41], 'NEEDS_HUMAN_REVIEW'), afterBubble], session: [session] }), bubbleSources: bubble }), /exactly the approved BubbleBike/);
  assert.throws(() => validateExpectedSameFeedTransition({ preState: pre, postState: state({ sameFeed: [other, afterBubble], session: [] }), bubbleSources: bubble }), /session-DEFER/);
});
