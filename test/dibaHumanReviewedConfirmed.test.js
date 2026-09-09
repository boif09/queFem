import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const source = { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1', planId: 1, enabled: 0, identity: { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1' } };
const target = { sourceKey: 'gencat-agenda', sourceRecordId: 'public-1', planId: 10, enabled: 1, identity: { sourceKey: 'gencat-agenda', sourceRecordId: 'public-1' } };
const index = { byIdentity: new Map([['diba-escenari:acte-1', [source]], ['gencat-agenda:public-1', [target]]]), byPlan: new Map([[1, [source]], [10, [target]]]) };
const finding = { sourceKey: source.sourceKey, sourceRecordId: source.sourceRecordId, dibaPlanId: 1, candidatePublicPlanId: 10, candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: true, coordinatesNear: false } };
const auditReport = { sameFeed: { clusters: [] }, currentPublicCandidates: { confirmed: [finding], confirmedSummary: { conflictComponents: [{ componentId: 'confirmed-1', dibaPlanIds: [1], candidatePlanIds: [10] }] }, possible: [], possibleSummary: { conflictComponents: [] } }, unresolvedMunicipalities: { records: [] } };
const reviewed = { version: 1, decisions: [{ source: source.identity, decision: 'LINK_TO_EXISTING', target: target.identity, reason: 'human review', reviewedAt: '2026-09-02', reviewer: 'human-review' }] };
const PRE_ERMITA_REVIEWED_LINKS = [
  ['diba-escenari', 'escenari1313947136481213281111365172', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400040@6f1cbd7f28ae845c'],
  ['diba-escenari', 'escenari76586167531201365181', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400043@434186404d15ffa8'],
  ['diba-escenari', 'escenari1313931136484013581411365170', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400045@0bb3fc1362cdb60f'],
  ['diba-escenari', 'escenari823227136472413577601365263', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400032@5db54008ed67acc2'],
  ['diba-escenari', 'escenari1097189136472410971921365179', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400007@f84e8b9048d4a944'],
  ['diba-escenari', 'escenari385001136481212157901365176', 'LINK_TO_EXISTING', 'gencat-agenda', '20260619016@3fd97e02577aaa79'],
  ['diba-escenari', 'escenari928999136639513666041366629', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072900006@166b0f4d80f42d1f'],
  ['diba-escenari', 'escenari1082511136478210825141365185', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072400015@255f4338b5ca943e'],
  ['diba-escenari', 'escenari222833838465731364578', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400053@af8a76b2d26e04f0'],
  ['diba-escenari', 'escenari77463413965213143661364586', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400052@7699b90a1c22b523'],
  ['diba-tourisme', 'agendaturisme455505989', 'LINK_TO_EXISTING', 'gencat-agenda', '20251024021@2ebddbcd49c02f48'],
  ['diba-escenari', 'escenari136611834552013661211366159', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700010@3d84022daa3ce860'],
  ['diba-escenari', 'escenari120008434552012000881366008', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700005@52c7bcaec1faf704'],
  ['diba-escenari', 'escenari1180435235913653671366035', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072400011@90d5368f687c346e'],
  ['diba-escenari', 'escenari24989534552012188881366153', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700006@c9b588eac5b160ee'],
  ['diba-escenari', 'escenari1256174235913653201366037', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072400012@34e7ac207a45299b'],
  ['diba-escenari', 'escenari121577322713146771364695', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400047@951a6f096da8bf31'],
  ['diba-escenari', 'escenari18482609680322661365178', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400035@63b3d555cc18e095'],
  ['diba-escenari', 'escenari33484834552013661241366161', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700012@565c01aacf969a56'],
  ['diba-escenari', 'escenari7280235913658601366045', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071000001@69e7ce4a7f6c598f'],
  ['diba-escenari', 'escenari5515231934305515261364687', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071300035@5af66be7d8599e31'],
  ['diba-escenari', 'escenari7658221313021661365213', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071500002@3948a2a3d9276b96'],
  ['diba-escenari', 'escenari14440235913660531366145', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072400017@b25d11de4a547f10'],
  ['diba-escenari', 'escenari73152359118051366031', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071300005@8aae2dd8e2d76e16'],
  ['diba-escenari', 'escenari91081668599210738291364655', 'LINK_TO_EXISTING', 'gencat-agenda', '20260619026@bd13944c0e3bdbc6'],
  ['diba-escenari', 'escenari523200136475212600691365238', 'LINK_TO_EXISTING', 'gencat-agenda', '20260619015@012511266e45b3c4'],
  ['diba-escenari', 'escenari136608634552013660891366095', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071000006@802802407d04f913'],
  ['diba-escenari', 'escenari22184235913661071366151', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700004@6b7c1847bc8b3528'],
  ['diba-escenari', 'escenari1218813235912188161366039', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072400016@f231bc945c6b7c10'],
  ['diba-escenari', 'escenari1039157235913660091366015', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072700009@6b56e500178e186b'],
  ['diba-escenari', 'escenari1313843235913641571366033', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071300006@f698b4b5ee83620a'],
  ['diba-escenari', 'escenari1174850235911748531366029', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071000008@4b3eca8b54a5d54e'],
  ['diba-escenari', 'escenari112430068591411746191364560', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400044@f3789cc34f003307'],
  ['diba-escenari', 'escenari112430068591411746191364562', 'LINK_TO_EXISTING', 'gencat-agenda', '2026071400044@f3789cc34f003307'],
  ['diba-escenari', 'escenari107410252594310741071369116', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072000013@83aa71fabe9279a7'],
  ['diba-escenari', 'escenari118768052594311876831369118', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072000014@ce92b99328b87d6e'],
  ['diba-escenari', 'escenari29337136873213106111369112', 'LINK_TO_EXISTING', 'gencat-agenda', '2026072000007@39e7c65495cf3775'],
];

test('a complete human-reviewed CONFIRMED 1:1 component becomes one provenance-only planned link', () => {
  const result = planDibaPolicy({ auditReport, overrides: reviewed, identityIndex: index });
  assert.equal(result.crossSource.confirmed[0].decision, 'LINK_TO_EXISTING'); assert.equal(result.crossSource.confirmed[0].reviewedDecision, 'LINK_TO_EXISTING');
  assert.equal(result.mutationPlan.phases.finalSourceMappings.length, 1); const mapping = result.mutationPlan.phases.finalSourceMappings[0];
  assert.deepEqual(mapping.source, source.identity); assert.deepEqual(mapping.finalTargetAnchor, target.identity);
  assert.equal(mapping.fieldPlan.title, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.start_date, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.venue, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.coordinates, 'KEEP_EXISTING');
  assert.equal(mapping.fieldPlan.categories, 'NEVER_FROM_DIBA'); assert.equal(mapping.fieldPlan.image, 'NEVER_FROM_DIBA'); assert.equal(mapping.fieldPlan['commerce/affiliate'], 'NEVER_FROM_DIBA');
  assert.equal(result.crossSource.possible.length, 0);
});

test('the Ermita de Sales reviewed Museums identity resolves only to the enabled Tourism canonical identity', () => {
  const museums = { sourceKey: 'diba-museus', sourceRecordId: 'actesmuseus3355625', planId: 5291, enabled: 1, identity: { sourceKey: 'diba-museus', sourceRecordId: 'actesmuseus3355625' } };
  const tourism = { sourceKey: 'diba-tourisme', sourceRecordId: 'agendaturisme444985488', planId: 4774, enabled: 1, identity: { sourceKey: 'diba-tourisme', sourceRecordId: 'agendaturisme444985488' } };
  const identityIndex = { byIdentity: new Map([[`${museums.sourceKey}:${museums.sourceRecordId}`, [museums]], [`${tourism.sourceKey}:${tourism.sourceRecordId}`, [tourism]]]), byPlan: new Map([[5291, [museums]], [4774, [tourism]]]) };
  const finding = { sourceKey: museums.sourceKey, sourceRecordId: museums.sourceRecordId, dibaPlanId: museums.planId, candidatePublicPlanId: tourism.planId, candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'overlap', venueMatch: false, coordinatesNear: false } };
  const audit = { sameFeed: { clusters: [] }, currentPublicCandidates: { confirmed: [], confirmedSummary: { conflictComponents: [] }, possible: [finding], possibleSummary: { conflictComponents: [{ componentId: 'ermita-sales', dibaPlanIds: [5291], candidatePlanIds: [4774] }] } }, unresolvedMunicipalities: { records: [] } };
  const overrides = { version: 1, decisions: [{ source: museums.identity, decision: 'LINK_TO_EXISTING', target: tourism.identity, reason: 'human review', reviewedAt: '2026-09-08', reviewer: 'human-review' }] };
  const result = planDibaPolicy({ auditReport: audit, overrides, identityIndex });
  assert.equal(result.crossSource.possible[0].reviewedDecision, 'LINK_TO_EXISTING');
  assert.deepEqual(result.mutationPlan.phases.finalSourceMappings[0].source, museums.identity);
  assert.deepEqual(result.mutationPlan.phases.finalSourceMappings[0].finalTargetAnchor, tourism.identity);
});

test('the complete pre-Ermita reviewed inventory preserves every stable source, target and disposition', async () => {
  const payload = JSON.parse(await fs.readFile('data-policy/diba-link-overrides.json', 'utf8'));
  const prior = payload.decisions.slice(0, PRE_ERMITA_REVIEWED_LINKS.length).map(({ source: itemSource, decision, target: itemTarget }) => [
    itemSource.sourceKey, itemSource.sourceRecordId, decision, itemTarget.sourceKey, itemTarget.sourceRecordId,
  ]);
  assert.deepEqual(prior, PRE_ERMITA_REVIEWED_LINKS);
});

test('the approved override file retains thirty-seven reviewed decisions and adds the Ermita de Sales stable human link without numeric targets', async () => {
  const payload = JSON.parse(await fs.readFile('data-policy/diba-link-overrides.json', 'utf8')); const overrides = validateDibaPolicyOverrides(payload);
  assert.equal(overrides.decisions.length, 38); assert.equal(overrides.decisions.filter(({ reviewedAt }) => reviewedAt === '2026-09-02').length, 11); assert.equal(overrides.decisions.filter(({ reviewedAt }) => reviewedAt === '2026-09-03').length, 23); assert.equal(overrides.decisions.filter(({ reviewedAt }) => reviewedAt === '2026-09-07').length, 3); assert.equal(overrides.decisions.filter(({ reviewedAt }) => reviewedAt === '2026-09-08').length, 1);
  assert.deepEqual(overrides.decisions.filter(({ reviewedAt }) => reviewedAt === '2026-09-07').map(({ source: itemSource, target: itemTarget, decision }) => ({ source: itemSource, target: itemTarget, decision })), [
    ['escenari107410252594310741071369116', '2026072000013@83aa71fabe9279a7'],
    ['escenari118768052594311876831369118', '2026072000014@ce92b99328b87d6e'],
    ['escenari29337136873213106111369112', '2026072000007@39e7c65495cf3775'],
  ].map(([sourceRecordId, targetRecordId]) => ({ source: { sourceKey: 'diba-escenari', sourceRecordId }, target: { sourceKey: 'gencat-agenda', sourceRecordId: targetRecordId }, decision: 'LINK_TO_EXISTING' })));
  assert.deepEqual(overrides.decisions.find(({ source: itemSource }) => itemSource.sourceKey === 'diba-museus' && itemSource.sourceRecordId === 'actesmuseus3355625'), {
    source: { sourceKey: 'diba-museus', sourceRecordId: 'actesmuseus3355625' }, decision: 'LINK_TO_EXISTING',
    target: { sourceKey: 'diba-tourisme', sourceRecordId: 'agendaturisme444985488' },
    reason: 'Human review confirmed the DIBA Museums and Tourism records represent the same recurring activity; Tourism is canonical because it carries the verified Ermita de Sales location while automatic corroboration was insufficient.',
    reviewedAt: '2026-09-08', reviewer: 'human-review', expectedPlanId: null,
  });
  assert.ok(overrides.decisions.every(({ decision, source: itemSource, target: itemTarget, reviewer }) => {
    const isErmitaSales = itemSource.sourceKey === 'diba-museus' && itemSource.sourceRecordId === 'actesmuseus3355625';
    return decision === 'LINK_TO_EXISTING' && itemSource.sourceKey.startsWith('diba-') && reviewer === 'human-review'
      && (itemTarget.sourceKey === 'gencat-agenda' || isErmitaSales && itemTarget.sourceKey === 'diba-tourisme');
  }));
  assert.ok(overrides.decisions.every((item) => !Object.hasOwn(item, 'planId') && !Object.hasOwn(item, 'targetPlanId')));
});
