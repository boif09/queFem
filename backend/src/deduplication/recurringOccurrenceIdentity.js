// Shared, deterministic "real session" identity for recurring-production
// occurrences (Phase 4C.6 / 4C.6B). Used by BOTH the one-off consolidation
// script (scripts/consolidate-recurring-group.js) and the normal Gencat
// importer's ongoing occurrence maintenance (recurringOccurrenceMaintenance.js)
// so the two can never drift apart on what counts as "the same real session".
//
// Gencat's own record-identity scheme (see getExternalId() in
// importers/gencatAgenda.importer.js) mints source_record_id as
// `${codi}@${16-hex-char payload hash}` specifically so a changed payload
// creates a new row instead of overwriting an existing one. That deliberate
// choice has a side effect this module exists to handle: ONE real tour
// session that visits several venues is published by Gencat as several rows
// sharing the same `codi` (only venue-specific fields differ — confirmed
// against production for both "Memoria en temps de guerra..." and "Espais de
// poder...": identical data_inici/data_fi/horari/entrades/linkbotoentrades/
// imatges across every venue variant, verified directly against the raw
// Gencat open-data records). The bare codi (everything before the "@") is
// therefore the stable "real session" identity — not the full hash-suffixed
// source_record_id, and not the plan's date alone (two genuinely different
// sessions could still land on the same date under a different codi, and
// must NOT be collapsed together).
// Every other source's source_record_id is treated as already being a 1:1
// session id, which is also true for every Gencat group consolidated before
// Phase 4C.6 (each of their source_record_ids already had a distinct codi per
// date) — so this is a no-op for all of them.
export function sessionIdentifier(sourceKey, sourceRecordId) {
  if (sourceKey === 'gencat-agenda') {
    const match = /^(.+)@[0-9a-f]{16}$/.exec(sourceRecordId);
    if (match) return match[1];
  }
  return sourceRecordId;
}

// Pure grouping/representative-selection logic for BATCH use (the
// consolidation script, which sees every member plan's own per-row date at
// once). Takes plan_sources rows shaped like
// { plan_source_id, source_key, source_record_id, plan_start_date } and
// returns one occurrence per REAL session: rows that share
// (source, sessionIdentifier, date) collapse into a single occurrence
// attached to their lowest-plan_source_id representative, while every row is
// still relinked to the canonical plan elsewhere (this function only decides
// occurrence identity, never provenance).
//
// Not used for INCREMENTAL maintenance (a single new import record at a
// time) — see recurringOccurrenceMaintenance.js, which uses
// sessionIdentifier() directly instead, because after consolidation every
// sibling plan_sources row shares one `plans.start_date` value (the
// canonical's own), so per-row dates can no longer be read back off the
// `plans` table the way this batch function does.
export function groupSourceRowsIntoOccurrences(sourceRows) {
  const occurrenceGroups = new Map();
  for (const row of sourceRows) {
    const sessionId = sessionIdentifier(row.source_key, row.source_record_id);
    const occurrenceGroupKey = `${row.source_key}|${sessionId}|${row.plan_start_date}`;
    if (!occurrenceGroups.has(occurrenceGroupKey)) occurrenceGroups.set(occurrenceGroupKey, []);
    occurrenceGroups.get(occurrenceGroupKey).push({ ...row, sessionId });
  }
  return [...occurrenceGroups.values()].map((rows) => {
    const representative = rows.reduce((a, b) => (a.plan_source_id < b.plan_source_id ? a : b));
    return {
      planSourceId: representative.plan_source_id,
      occurrenceKey: representative.sessionId,
      localDate: representative.plan_start_date,
    };
  });
}
