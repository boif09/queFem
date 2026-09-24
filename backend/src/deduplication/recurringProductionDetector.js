// Detects candidate groups of plans that are likely the same recurring
// production (one show/tour/workshop performed on many distinct dates) but
// were fragmented into separate plans because start_date is part of the
// canonical plans.fingerprint (see plan.normalizer.js) — confirmed via a
// Phase 4C production audit, with "Gran Gala Flamenc" (16 separate plan rows
// for one Palau de la Música Catalana production) as the motivating case.
//
// Pure and read-only: this module never touches the database. It accepts an
// array of already-normalized plan records and returns candidate groups with
// a classification and explicit reasons. Nothing here writes, relinks, or
// merges anything — that is deliberately out of scope until a human-reviewed
// decision file (see data-policy/recurring-production-decisions.json)
// authorizes it.
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

// Confirmed real Gencat venue labels that describe a MULTI-LOCATION program,
// not one physical venue (e.g. a touring festival visiting many towns on the
// same nominal date, or a diocese-wide program spanning many church sites).
// Grouping by title+venue for these would merge genuinely different
// real-world events — confirmed false-positive risk in the Phase 4C audit
// ("Un museu fora del museu": 38 plans across 23 different real venues, all
// carrying variants of a "Diferents espais..." venue label upstream).
//
// Matched against the NORMALIZED (normalizeForFingerprint) form, i.e. the
// hyphen-joined token form, not the raw string — see isGenericVenue().
const GENERIC_VENUE_RE = /^diferents-(espais|poblacions|llocs|municipis)(-|$)/;

// Coordinate tolerance for "same physical venue" — matches the tolerance
// already used by MultiSourceMatcher (backend/src/deduplication/multiSourceMatcher.js)
// for consistency, roughly 200m.
const COORDINATE_TOLERANCE_DEGREES = 0.002;

// A description-normalized-prefix length for comparison. Full descriptions
// can pick up trailing boilerplate/edits between imports; the productions
// confirmed in the Phase 4C audit shared an identical opening for their
// entire length, so a generous prefix avoids false negatives from minor
// trailing edits while still requiring real content agreement, not just a
// shared first sentence.
const DESCRIPTION_COMPARISON_PREFIX_LENGTH = 160;

// Above this span (days from the earliest to the latest occurrence in a
// candidate group), a group is never SAFE_AUTOMATIC regardless of signal
// agreement — confirmed-safe real productions in the Phase 4C audit topped
// out at 252 days; nothing in current production data has been observed
// spanning a full year, so there is no evidence to calibrate a larger
// ceiling against. This is deliberately a guardrail, not a positive signal:
// a long span never makes a group MORE likely to be grouped, only ever caps
// it at REVIEW_REQUIRED.
const MAXIMUM_SAFE_SPAN_DAYS = 300;

const MINIMUM_SAFE_OCCURRENCE_COUNT = 3;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return false;
  // JS silently rolls calendar-impossible dates into the next month (e.g.
  // "2026-02-30" becomes March 2nd) rather than throwing — a round-trip
  // check against the parsed UTC components is required to actually reject
  // these, not just dates that fail to parse at all (cross-review finding).
  const [year, month, day] = value.split('-').map(Number);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeVenueIdentity(venueName) {
  const normalized = normalizeForFingerprint(venueName);
  return normalized || null;
}

// Checked against the NORMALIZED venue identity (the exact same value the
// grouping key itself is built from), never against the raw venueName —
// confirmed cross-review finding: raw-string matching missed punctuation
// variants that normalizeForFingerprint collapses onto the SAME group (e.g.
// "Diferents, espais" and "Diferents espais" both normalize to
// "diferents-espais" and land in one candidate group), so checking the raw
// string of whichever record happened to be first could silently miss a
// generic venue the group was actually built from.
export function isGenericVenue(venueName) {
  return GENERIC_VENUE_RE.test(normalizeVenueIdentity(venueName) || '');
}

// Deterministic, non-semantic normalization only (no fuzzy/AI similarity):
// strips any HTML tags, collapses whitespace, lowercases. Two descriptions
// "agree" if their normalized text matches over a shared prefix — tolerant
// of trailing edits between imports without requiring byte-identical full
// text, and without attempting real similarity scoring.
export function normalizeDescriptionForComparison(description) {
  if (typeof description !== 'string') return null;
  const stripped = description
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return stripped || null;
}

function descriptionPrefix(description) {
  const normalized = normalizeDescriptionForComparison(description);
  if (!normalized) return null;
  return normalized.slice(0, DESCRIPTION_COMPARISON_PREFIX_LENGTH);
}

// Gencat serves each occurrence's images from a per-record CMS folder path
// that embeds the record's own date/sequence (confirmed in the Phase 4C
// audit: .../2026/04/02/088/annexos/<filename> vs .../2026/04/02/089/annexos/<filename>
// for two occurrences of the same production), so comparing full URLs would
// always disagree even for identical underlying images. Comparing the
// filename SET (not full URL, not just one image) is robust to that path
// noise while still requiring the literal same image files, not merely
// similar ones.
export function extractImageFilenameSet(imageUrls) {
  const list = Array.isArray(imageUrls)
    ? imageUrls
    : typeof imageUrls === 'string' && imageUrls.trim()
      ? imageUrls.split(',')
      : [];
  const filenames = list
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean)
    .map((url) => url.split('/').pop().toLowerCase())
    .filter(Boolean);
  return filenames.length ? new Set(filenames) : null;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

// Only collapses whitespace and a trailing slash — deliberately does not
// touch host, path casing, or query string, so genuinely different ticket
// vendors/destinations are never treated as the same URL. Confirmed real
// counterexample (Phase 4C audit): "Gran Gala Flamenc" links directly to
// grangalaflamenco.com while "Gran Gala Flamenco" links to a secutix.com
// marketplace listing — those must never be normalized into agreement.
export function normalizeTicketUrlForComparison(ticketUrl) {
  if (typeof ticketUrl !== 'string') return null;
  const trimmed = ticketUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    let href = url.href;
    if (href.endsWith('/') && url.pathname !== '/') href = href.slice(0, -1);
    return href;
  } catch {
    return trimmed.replace(/\/+$/, '') || null;
  }
}

// A single strong signal's contribution to a group's evidence.
// - usable=false means fewer than 2 records in the group have a non-empty
//   value for this signal — there isn't enough data to say anything, so it
//   counts neither for nor against (missing data is never agreement).
// - usable=true, agree=true means every non-empty value in the group matched.
// - usable=true, agree=false means at least two non-empty values differed —
//   real negative evidence, regardless of how many other records lack the
//   signal entirely.
function evaluateSignal(records, extractValue, compareValues) {
  const values = records.map(extractValue).filter((value) => value !== null && value !== undefined);
  if (values.length < 2) {
    return { usable: false, agree: false, presentCount: values.length };
  }
  const first = values[0];
  const agree = values.every((value) => compareValues(value, first));
  return { usable: true, agree, presentCount: values.length };
}

function evaluateTicketSignal(records) {
  return evaluateSignal(
    records,
    (r) => normalizeTicketUrlForComparison(r.ticketUrl),
    (a, b) => a === b,
  );
}

function evaluateDescriptionSignal(records) {
  return evaluateSignal(
    records,
    (r) => descriptionPrefix(r.description),
    (a, b) => a === b,
  );
}

function evaluateImageSignal(records) {
  return evaluateSignal(
    records,
    (r) => extractImageFilenameSet(r.imageUrls),
    (a, b) => sameSet(a, b),
  );
}

function coordinatesConflict(records) {
  const points = records
    .map((r) => ({ latitude: r.latitude, longitude: r.longitude }))
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (points.length < 2) return false;
  // Must compare every PAIR, not just every point against the first one:
  // two points can each be within tolerance of point 0 while being outside
  // tolerance of each other (e.g. 0.0019 south and 0.0019 north of a shared
  // reference are ~0.0038 apart) — confirmed real bypass in cross-review.
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (
        Math.abs(points[i].latitude - points[j].latitude) > COORDINATE_TOLERANCE_DEGREES
        || Math.abs(points[i].longitude - points[j].longitude) > COORDINATE_TOLERANCE_DEGREES
      ) {
        return true;
      }
    }
  }
  return false;
}

function spanDays(records) {
  const dates = records.map((r) => r.startDate).filter(Boolean).sort();
  if (dates.length < 2) return 0;
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  const days = Math.round((last.getTime() - first.getTime()) / 86_400_000);
  // Defense in depth: buildCandidateGroups() already rejects any record with
  // an unparseable startDate before it can reach here, so this should be
  // unreachable in practice — but an invalid date must never silently
  // satisfy `span <= MAXIMUM_SAFE_SPAN_DAYS` via NaN comparisons always being
  // false (cross-review finding). Failing to Infinity keeps the span check
  // fail-closed even if that earlier guard is ever weakened by a future edit.
  return Number.isFinite(days) ? days : Infinity;
}

// Groups records by (source, normalized title, venue identity). Deliberately
// never groups across sources (Gencat and DIBA are never combined here, even
// if content matches — cross-source reconciliation is MultiSourceMatcher's
// job, not this module's) and never groups across venues, including
// deliberately never collapsing a generic multi-location venue label with
// itself (each generic-venue group is still produced, so it can be reported
// and explicitly classified DO_NOT_GROUP with a reason, rather than being
// silently dropped).
export function buildCandidateGroups(records) {
  const groups = new Map();
  for (const record of records) {
    // An unparseable startDate must be excluded entirely, not merely
    // truthy-checked: `new Date('not-a-date')` is truthy but yields NaN
    // everywhere it's later used for span math, and NaN comparisons (e.g.
    // `NaN > 300`) are always false — silently bypassing the span guardrail
    // (cross-review finding). Only a real ISO date (matching what
    // plans.start_date always contains) is accepted.
    if (!record.source || !record.originalTitle || !record.venueName || !isValidIsoDate(record.startDate)) continue;
    const normalizedTitle = normalizeForFingerprint(record.originalTitle, { removeArticles: true });
    const venueIdentity = normalizeVenueIdentity(record.venueName);
    if (!normalizedTitle || !venueIdentity) continue;
    const key = `${record.source}|${normalizedTitle}|${venueIdentity}`;
    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        source: record.source,
        normalizedTitle,
        venueIdentity,
        venueName: record.venueName,
        records: [],
      });
    }
    groups.get(key).records.push(record);
  }
  // Only genuine recurrence candidates: more than one record AND more than
  // one distinct date (a single production imported twice under two source
  // records for the SAME date is a different, already-handled problem, not
  // this module's concern).
  return [...groups.values()].filter((group) => {
    const distinctDates = new Set(group.records.map((r) => r.startDate));
    return group.records.length >= 2 && distinctDates.size >= 2;
  });
}

// Classifies one candidate group. Pure function of its records — no DB, no
// randomness, fully deterministic (same input always produces the same
// output and the same ordered reasons list).
export function classifyGroup(group) {
  const { records } = group;
  const reasons = [];

  // Tested directly against group.venueIdentity — the exact normalized value
  // the grouping key itself was built from — rather than re-deriving it from
  // group.venueName, so this can never diverge from what grouping actually
  // used regardless of future refactors.
  const generic = GENERIC_VENUE_RE.test(group.venueIdentity);
  const coordConflict = coordinatesConflict(records);
  const ticket = evaluateTicketSignal(records);
  const description = evaluateDescriptionSignal(records);
  const image = evaluateImageSignal(records);
  const span = spanDays(records);
  // occurrenceCount is the number of DISTINCT PLANS this group would
  // consolidate — not the raw plan_sources row count. A single plan can
  // legitimately carry more than one source record for the very same date
  // (confirmed in production DIBA data: two diba-escenari records already
  // correctly pointing at one plan for one date) — that duplication is a
  // separate, already-handled problem, not evidence of additional real-world
  // recurrence, and must not inflate the n>=3 threshold below.
  const distinctPlanIds = [...new Set(records.map((r) => r.planId))];
  const occurrenceCount = distinctPlanIds.length;
  const distinctDateCount = new Set(records.map((r) => r.startDate)).size;
  const sourceRecordCount = records.length;

  const signals = { ticket, description, image };
  const disagreeing = Object.entries(signals).filter(([, s]) => s.usable && !s.agree).map(([name]) => name);
  const agreeing = Object.entries(signals).filter(([, s]) => s.usable && s.agree).map(([name]) => name);

  const result = { groupKey: group.groupKey, source: group.source, venueName: group.venueName, occurrenceCount, distinctDateCount, sourceRecordCount, spanDays: span, signals, planIds: distinctPlanIds };

  if (generic) {
    reasons.push(`Venue "${group.venueName}" matches a known generic/multi-location pattern; title+venue cannot be trusted to mean the same physical venue.`);
    return { ...result, classification: 'DO_NOT_GROUP', reasons };
  }

  if (coordConflict) {
    reasons.push('Records in this group report materially different coordinates for the same venue name — likely different real-world locations sharing a venue label, not the same physical venue.');
    return { ...result, classification: 'DO_NOT_GROUP', reasons };
  }

  if (disagreeing.length >= 2) {
    reasons.push(`${disagreeing.length} strong signals disagree (${disagreeing.join(', ')}) — strong evidence these are different productions/programs, not one recurring production.`);
    return { ...result, classification: 'DO_NOT_GROUP', reasons };
  }

  if (disagreeing.length === 1) {
    reasons.push(`One strong signal disagrees (${disagreeing[0]}) while others do not contradict it — could plausibly be source noise (e.g. a per-date ticket link) rather than a different production; needs a human decision.`);
    return { ...result, classification: 'REVIEW_REQUIRED', reasons };
  }

  if (occurrenceCount === 2) {
    reasons.push('Only two occurrences — insufficient redundancy to be confident even when available signals agree.');
    return { ...result, classification: 'REVIEW_REQUIRED', reasons };
  }

  if (span > MAXIMUM_SAFE_SPAN_DAYS) {
    reasons.push(`Occurrence span is ${span} days, beyond the evidence-based ${MAXIMUM_SAFE_SPAN_DAYS}-day ceiling — no current production data confirms a safe grouping this wide (e.g. an annual re-edition risk), so this is deliberately never auto-grouped.`);
    return { ...result, classification: 'REVIEW_REQUIRED', reasons };
  }

  if (occurrenceCount >= MINIMUM_SAFE_OCCURRENCE_COUNT && agreeing.length >= 2) {
    reasons.push(`${occurrenceCount} occurrences, ${agreeing.length} strong signals positively agree (${agreeing.join(', ')}), no signal disagrees, span ${span} days within the ${MAXIMUM_SAFE_SPAN_DAYS}-day ceiling.`);
    return { ...result, classification: 'SAFE_AUTOMATIC', reasons };
  }

  reasons.push(`Insufficient positive evidence: only ${agreeing.length} strong signal(s) usable and agreeing (need at least 2), with ${occurrenceCount} occurrences.`);
  return { ...result, classification: 'REVIEW_REQUIRED', reasons };
}

export function detectRecurringProductionCandidates(records) {
  return buildCandidateGroups(records).map(classifyGroup);
}
