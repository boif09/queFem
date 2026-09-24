import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectRecurringProductionCandidates,
  classifyGroup,
  buildCandidateGroups,
  isGenericVenue,
  normalizeDescriptionForComparison,
  extractImageFilenameSet,
  normalizeTicketUrlForComparison,
} from '../backend/src/deduplication/recurringProductionDetector.js';

const VENUE = 'Palau de la Música Catalana';
const TICKET = 'https://www.grangalaflamenco.com/reservar/';
const DESCRIPTION = 'Gran Gala Flamenc ofereix als seus espectadors un viatge integral al món del flamenc, on trobareu tot el que pugueu imaginar sobre aquest art.';
const IMAGES = '/content/dam/agenda/ca/activitats/2026/04/02/088/annexos/a.jpg,/content/dam/agenda/ca/activitats/2026/04/02/088/annexos/b.jpg';

function occurrence({
  planId, title = 'Gran Gala Flamenc', venueName = VENUE, source = 'gencat-agenda',
  startDate, ticketUrl = TICKET, description = DESCRIPTION, imageUrls = IMAGES,
  latitude = 41.3875556, longitude = 2.1752406,
} = {}) {
  return {
    planId, source, originalTitle: title, venueName, municipality: 'Barcelona',
    latitude, longitude, startDate, ticketUrl, description, imageUrls,
  };
}

function dates(n, { startYear = 2026, startMonth = 9, startDay = 25, stepDays = 7 } = {}) {
  const base = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base.getTime() + i * stepDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

test('Gran Gala Flamenc-like: n=16, same title/venue/ticket/description/images -> SAFE_AUTOMATIC', () => {
  const records = dates(16).map((startDate, i) => occurrence({ planId: 1000 + i, startDate }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'SAFE_AUTOMATIC');
  assert.equal(result.occurrenceCount, 16);
  assert.equal(result.signals.ticket.agree, true);
  assert.equal(result.signals.description.agree, true);
  assert.equal(result.signals.image.agree, true);
});

test('Barcelona Guitar Trio-like: n=8, all signals agree, span under ceiling -> SAFE_AUTOMATIC', () => {
  const records = dates(8, { stepDays: 12 }).map((startDate, i) => occurrence({
    planId: 2000 + i, title: 'Barcelona Guitar Trio & Dance', startDate,
    ticketUrl: 'https://tickets.example/guitar-trio', description: 'A recital by the Barcelona Guitar Trio & Dance ensemble, touring Catalonia this season with a program of classical guitar works.',
    imageUrls: '/img/guitar-1.jpg,/img/guitar-2.jpg',
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'SAFE_AUTOMATIC');
});

test('El llac dels cignes-like: same title/venue, different image sets only -> NOT SAFE_AUTOMATIC (one signal disagrees)', () => {
  const records = dates(4).map((startDate, i) => occurrence({
    planId: 3000 + i, title: 'El llac dels cignes', startDate,
    imageUrls: i === 0 ? '/img/swan-a.jpg,/img/swan-b.jpg' : '/img/other-company-1.jpg,/img/other-company-2.jpg',
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.notEqual(result.classification, 'SAFE_AUTOMATIC');
  assert.equal(result.classification, 'REVIEW_REQUIRED');
  assert.equal(result.signals.image.agree, false);
  assert.equal(result.signals.ticket.agree, true);
  assert.equal(result.signals.description.agree, true);
});

test('Orquestra Simfònica del Vallès-like: ticket, description AND images all disagree -> DO_NOT_GROUP', () => {
  const records = [
    occurrence({ planId: 4001, title: 'Orquestra Simfònica del Vallès', startDate: '2026-09-25', ticketUrl: 'https://a.example/one', description: 'Programa A: obertura, simfonia núm. 1.', imageUrls: '/img/prog-a.jpg' }),
    occurrence({ planId: 4002, title: 'Orquestra Simfònica del Vallès', startDate: '2026-11-28', ticketUrl: 'https://b.example/two', description: 'Programa B: concert per a violí, simfonia núm. 5.', imageUrls: '/img/prog-b.jpg' }),
  ];
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'DO_NOT_GROUP');
});

test('generic multi-location venue -> DO_NOT_GROUP or REVIEW_REQUIRED, never SAFE', () => {
  for (const venueName of ['Diferents espais', 'Diferents espais i municipis', 'Diferents poblacions', 'Diferents espais de Girona']) {
    const records = dates(5).map((startDate, i) => occurrence({ planId: 5000 + i, title: 'Un museu fora del museu', venueName, startDate }));
    const [result] = detectRecurringProductionCandidates(records);
    assert.notEqual(result.classification, 'SAFE_AUTOMATIC', `venue "${venueName}" must never be SAFE`);
    assert.ok(['DO_NOT_GROUP', 'REVIEW_REQUIRED'].includes(result.classification));
  }
});

test('generic-venue punctuation variants that normalize to the same identity still count as generic (cross-review finding)', () => {
  // "Diferents, espais" and "Diferents espais" both normalize to
  // "diferents-espais" via normalizeForFingerprint and land in the SAME
  // candidate group. An earlier version checked isGenericVenue() against
  // whichever record happened to be first in the group, using a raw-string
  // regex that missed the punctuated variant — meaning group/report order
  // could silently determine whether a generic-venue group was correctly
  // rejected. The check must be immune to which record is first.
  const variants = ['Diferents, espais', 'Diferents espais', 'Diferents  espais'];
  for (const firstVenue of variants) {
    const records = dates(5).map((startDate, i) => occurrence({
      planId: 5100 + i, title: 'Un museu fora del museu',
      venueName: i === 0 ? firstVenue : 'Diferents espais',
      startDate,
    }));
    const [result] = detectRecurringProductionCandidates(records);
    assert.notEqual(result.classification, 'SAFE_AUTOMATIC', `first-record venue "${firstVenue}" must not let a generic-venue group through`);
  }
});

test('isGenericVenue is immune to punctuation/whitespace differences that normalize identically', () => {
  assert.equal(isGenericVenue('Diferents, espais'), true);
  assert.equal(isGenericVenue('Diferents  espais'), true);
  assert.equal(isGenericVenue('Diferents-espais'), true);
});

test('an unparseable startDate is excluded from candidate grouping rather than silently bypassing the span guardrail (cross-review finding)', () => {
  // NaN date math (`new Date('not-a-date').getTime()` -> NaN) makes every
  // "> 300" comparison false, which could have silently satisfied the span
  // ceiling for records TensPla should never have been able to date at all.
  const records = [
    occurrence({ planId: 5200, startDate: '2026-09-25' }),
    occurrence({ planId: 5201, startDate: 'not-a-real-date' }),
    occurrence({ planId: 5202, startDate: '2026-10-02' }),
  ];
  const groups = buildCandidateGroups(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 2, 'the record with an invalid startDate must be excluded entirely');
  assert.ok(groups[0].records.every((r) => r.planId !== 5201));
});

test('a calendar-impossible date (e.g. Feb 30) is excluded, not silently rolled over by JS Date parsing (cross-review finding)', () => {
  const records = [
    occurrence({ planId: 5300, startDate: '2026-09-25' }),
    occurrence({ planId: 5301, startDate: '2026-02-30' }), // JS Date would silently roll this to March 2nd
    occurrence({ planId: 5302, startDate: '2026-04-31' }), // April only has 30 days
    occurrence({ planId: 5303, startDate: '2026-10-02' }),
  ];
  const groups = buildCandidateGroups(records);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].records.map((r) => r.planId).sort(), [5300, 5303]);
});

test('all strong signals missing: same title + venue + 3 dates -> NOT SAFE_AUTOMATIC', () => {
  const records = dates(3).map((startDate, i) => occurrence({
    planId: 6000 + i, startDate, ticketUrl: null, description: null, imageUrls: null,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.notEqual(result.classification, 'SAFE_AUTOMATIC');
  assert.equal(result.signals.ticket.usable, false);
  assert.equal(result.signals.description.usable, false);
  assert.equal(result.signals.image.usable, false);
});

test('only ticket URLs missing, description + image strongly agree -> may be SAFE (two-signal rule)', () => {
  const records = dates(4).map((startDate, i) => occurrence({
    planId: 7000 + i, startDate, ticketUrl: null,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'SAFE_AUTOMATIC');
  assert.equal(result.signals.ticket.usable, false);
  assert.equal(result.signals.description.agree, true);
  assert.equal(result.signals.image.agree, true);
});

test('n=2 with all signals matching -> REVIEW_REQUIRED, never SAFE', () => {
  const records = dates(2).map((startDate, i) => occurrence({ planId: 8000 + i, startDate }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'REVIEW_REQUIRED');
});

test('span > 300 days -> REVIEW_REQUIRED even with n>=3 and full agreement', () => {
  const records = dates(3, { stepDays: 160 }).map((startDate, i) => occurrence({ planId: 9000 + i, startDate }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.ok(result.spanDays > 300);
  assert.equal(result.classification, 'REVIEW_REQUIRED');
});

test('span exactly at the 300-day ceiling with full agreement -> SAFE_AUTOMATIC (boundary is inclusive)', () => {
  const records = [
    occurrence({ planId: 9100, startDate: '2026-01-01' }),
    occurrence({ planId: 9101, startDate: '2026-06-01' }),
    occurrence({ planId: 9102, startDate: '2026-10-28' }), // exactly 300 days after 2026-01-01
  ];
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.spanDays, 300);
  assert.equal(result.classification, 'SAFE_AUTOMATIC');
});

test('Gran Gala Flamenc vs Gran Gala Flamenco: different venue -> separate candidate groups, never merged', () => {
  const flamenc = dates(16).map((startDate, i) => occurrence({ planId: 1000 + i, title: 'Gran Gala Flamenc', venueName: 'Palau de la Música Catalana', startDate }));
  const flamenco = dates(9, { startMonth: 10, startDay: 27, stepDays: 8 }).map((startDate, i) => occurrence({
    planId: 2000 + i, title: 'Gran Gala Flamenco', venueName: 'Teatre Poliorama',
    startDate, ticketUrl: 'https://barcelonayflamenco.shop.secutix.com/x', latitude: 41.3841507, longitude: 2.1706934,
    description: 'L’espectacle flamenc més vist a la història de Barcelona.',
  }));
  const results = detectRecurringProductionCandidates([...flamenc, ...flamenco]);
  assert.equal(results.length, 2, 'must produce two separate groups, never one merged group');
  const titles = results.map((r) => r.groupKey.split('|')[1]).sort();
  assert.notEqual(titles[0], titles[1]);
  for (const r of results) assert.equal(r.classification, 'SAFE_AUTOMATIC');
});

test('exactly one disagreeing signal is REVIEW_REQUIRED, not DO_NOT_GROUP', () => {
  const records = dates(5).map((startDate, i) => occurrence({
    planId: 10000 + i, startDate, description: i === 0 ? 'A different description entirely, not matching the rest at all in its opening words.' : DESCRIPTION,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'REVIEW_REQUIRED');
  assert.equal(result.signals.description.agree, false);
});

test('two disagreeing signals is DO_NOT_GROUP', () => {
  const records = dates(5).map((startDate, i) => occurrence({
    planId: 11000 + i, startDate,
    description: i === 0 ? 'A different description entirely, not matching the rest at all.' : DESCRIPTION,
    ticketUrl: i === 0 ? 'https://different-vendor.example/x' : TICKET,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'DO_NOT_GROUP');
});

test('records from different sources are never grouped together, even with identical content', () => {
  const gencat = occurrence({ planId: 12001, source: 'gencat-agenda', startDate: '2026-09-25' });
  const diba = occurrence({ planId: 12002, source: 'diba-tourisme', startDate: '2026-10-02' });
  const groups = buildCandidateGroups([gencat, diba, occurrence({ planId: 12003, source: 'gencat-agenda', startDate: '2026-10-09' })]);
  assert.equal(groups.length, 1, 'only the two same-source gencat records should form a group');
  assert.ok(groups[0].records.every((r) => r.source === 'gencat-agenda'));
});

test('coordinate conflict between records sharing a venue name -> DO_NOT_GROUP', () => {
  const records = dates(4).map((startDate, i) => occurrence({
    planId: 13000 + i, startDate,
    latitude: i === 0 ? 42.5 : 41.3875556,
    longitude: i === 0 ? 3.5 : 2.1752406,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'DO_NOT_GROUP');
});

test('coordinate conflict is detected pairwise, not only against the first record (cross-review finding)', () => {
  // Each of points 2 and 3 is within COORDINATE_TOLERANCE_DEGREES (0.002) of
  // point 1, but 0.0038 apart from EACH OTHER — a first-point-only
  // comparison would miss this and wrongly allow SAFE_AUTOMATIC.
  const records = dates(3).map((startDate, i) => occurrence({
    planId: 13100 + i, startDate,
    latitude: [41.0000, 41.0019, 40.9981][i],
    longitude: 2.0000,
  }));
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.classification, 'DO_NOT_GROUP');
});

test('a single record, or records with only one distinct date, never form a candidate group', () => {
  assert.equal(buildCandidateGroups([occurrence({ planId: 1, startDate: '2026-09-25' })]).length, 0);
  assert.equal(buildCandidateGroups([
    occurrence({ planId: 1, startDate: '2026-09-25' }),
    occurrence({ planId: 2, startDate: '2026-09-25' }),
  ]).length, 0, 'same-date duplicates are a different problem, not recurring-production fragmentation');
});

test('isGenericVenue recognizes the confirmed generic patterns and nothing else', () => {
  assert.equal(isGenericVenue('Diferents espais'), true);
  assert.equal(isGenericVenue('Diferents espais i municipis'), true);
  assert.equal(isGenericVenue('Diferents poblacions'), true);
  assert.equal(isGenericVenue('Diferents espais del Bisbat de Girona'), true);
  assert.equal(isGenericVenue('Palau de la Música Catalana'), false);
  assert.equal(isGenericVenue('Teatre Poliorama'), false);
});

test('normalizeDescriptionForComparison strips HTML and collapses whitespace deterministically', () => {
  assert.equal(
    normalizeDescriptionForComparison('<p>Hola  <b>món</b>.</p>\n\nText.'),
    'hola món . text.',
  );
  assert.equal(normalizeDescriptionForComparison(''), null);
  assert.equal(normalizeDescriptionForComparison(null), null);
});

test('extractImageFilenameSet ignores folder-path differences and treats empty as null', () => {
  const a = extractImageFilenameSet('/a/2026/04/02/088/annexos/photo.jpg,/a/2026/04/02/088/annexos/other.jpg');
  const b = extractImageFilenameSet('/a/2026/04/02/103/annexos/photo.jpg,/a/2026/04/02/103/annexos/other.jpg');
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.equal(extractImageFilenameSet(''), null);
  assert.equal(extractImageFilenameSet(null), null);
  assert.equal(extractImageFilenameSet([]), null);
});

test('normalizeTicketUrlForComparison only trims superficial differences, never collapses different vendors', () => {
  assert.equal(normalizeTicketUrlForComparison('https://example.com/x/'), normalizeTicketUrlForComparison('https://example.com/x'));
  assert.notEqual(
    normalizeTicketUrlForComparison('https://grangalaflamenco.com/reservar/'),
    normalizeTicketUrlForComparison('https://barcelonayflamenco.shop.secutix.com/x'),
  );
  assert.equal(normalizeTicketUrlForComparison(''), null);
  assert.equal(normalizeTicketUrlForComparison(null), null);
});

test('duplicate source records for the SAME plan/date do not inflate the occurrence count (found during production dry-run)', () => {
  // Confirmed real DIBA pattern: one plan can have two source_record_ids for
  // the very same date (already correctly consolidated to one plan_id by
  // DIBA's own same-date matcher). A naive raw-record count would see 4
  // "occurrences" for what is really only 2 distinct plans/dates, wrongly
  // clearing the n>=3 SAFE_AUTOMATIC threshold.
  const records = [
    occurrence({ planId: 15000, startDate: '2026-09-25' }),
    occurrence({ planId: 15000, startDate: '2026-09-25' }), // duplicate source record, same plan+date
    occurrence({ planId: 15001, startDate: '2026-10-02' }),
    occurrence({ planId: 15001, startDate: '2026-10-02' }), // duplicate source record, same plan+date
  ];
  const [result] = detectRecurringProductionCandidates(records);
  assert.equal(result.occurrenceCount, 2, 'occurrenceCount must reflect distinct plans, not raw source-record rows');
  assert.equal(result.sourceRecordCount, 4);
  assert.equal(result.classification, 'REVIEW_REQUIRED', 'only 2 real distinct plans -> the n=2 rule, never SAFE_AUTOMATIC');
});

test('classifyGroup output is deterministic for the same input', () => {
  const records = dates(4).map((startDate, i) => occurrence({ planId: 14000 + i, startDate }));
  const group = buildCandidateGroups(records)[0];
  const first = classifyGroup(group);
  const second = classifyGroup(group);
  assert.deepEqual(first, second);
});
