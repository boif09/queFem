import { PlanRepository } from '../db/repositories/plan.repository.js';
import { ImportRunRepository } from '../db/repositories/importRun.repository.js';
import { TicketmasterReconciliationRepository } from '../db/repositories/ticketmasterReconciliation.repository.js';
import { MultiSourceMatcher } from '../deduplication/multiSourceMatcher.js';
import { SourceRegistry } from '../legal/sourceRegistry.js';
import { validateSourceForImport } from '../legal/licenseValidator.js';
import { ticketmasterLocation } from '../location/ticketmasterCataloniaScope.js';
import { normalizeTicketmasterGroup } from '../normalizers/ticketmasterPlan.normalizer.js';
import { classifyDateHorizon, horizonBounds } from '../ticketmaster/dateHorizon.js';
import { parseDiscoveryFeed, withoutRestrictedImages } from '../ticketmaster/feedParser.js';
import { detectRecurringInventory } from '../ticketmaster/recurringInventory.js';
import { classifyProductVariants } from '../ticketmaster/productVariants.js';
import { isExcludedProviderTestRecord } from '../ticketmaster/providerTestPolicy.js';
import { groupDailySessions } from '../ticketmaster/sessionGrouper.js';
import { isAcceptedTicketmasterSource, ticketmasterSourceBucket } from '../ticketmaster/sourcePolicy.js';

function emptySummary() {
  return {
    feedRecords: 0, ticketmasterSource: 0, acceptedTrium: 0, acceptedMfxEs: 0,
    excludedUniverse: 0, excludedMfxExternal: 0, excludedOtherSource: 0,
    withinHorizon: 0, cataloniaCandidates: 0,
    outsideCataloniaSkipped: 0, outOfHorizonSkipped: 0, recurringInventorySkipped: 0,
    productVariantsSkipped: 0, providerTestRecordsSkipped: 0, invalidSkipped: 0, newPlans: 0, updates: 0,
    unchanged: 0, confirmedMerges: 0, possibleMerges: 0, reconciliationRemovals: 0,
    recurringDetails: [], variantDetails: [], possibleMergeDetails: [], reconciliationDetails: [],
  };
}

export class TicketmasterDiscoveryFeedImporter {
  constructor({ db, client, lookaheadDays = 90, now = () => new Date(), logger = console }) {
    this.db = db; this.client = client; this.lookaheadDays = lookaheadDays; this.now = now; this.logger = logger;
    this.sources = new SourceRegistry(db); this.plans = new PlanRepository(db);
    this.runs = new ImportRunRepository(db); this.matcher = new MultiSourceMatcher(db);
    this.reconciliation = new TicketmasterReconciliationRepository(db);
  }

  async run({ dryRun = false } = {}) {
    const registeredSource = this.sources.find('ticketmaster-discovery-feed');
    const source = registeredSource
      ? validateSourceForImport(registeredSource)
      : validateSourceForImport({
        id: -1, key: 'ticketmaster-discovery-feed', enabled: 1, allows_data_reuse: 1,
        license_name: 'Ticketmaster API / Discovery Feed Terms of Use',
        license_url: 'https://developer.ticketmaster.com/support/terms-of-use/',
        reviewed_at: '2026-08-18', requires_attribution: 1, attribution_text: 'Ticketmaster',
        dataset_url: 'https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/',
      });
    if (!dryRun && !registeredSource) throw new Error('Cal aplicar les migracions abans d’importar Ticketmaster.');
    const summary = emptySummary();
    const payload = await this.client.downloadSpain();
    const records = parseDiscoveryFeed(payload);
    summary.feedRecords = records.length;
    const runNow = this.now();
    const bounds = horizonBounds(runNow, this.lookaheadDays);
    const relevantFeedIds = new Set();
    const candidates = [];
    for (const record of records) {
      const sourceBucket = ticketmasterSourceBucket(record);
      if (!isAcceptedTicketmasterSource(record)) {
        if (sourceBucket === 'universe') summary.excludedUniverse += 1;
        else if (sourceBucket === 'mfx-external') summary.excludedMfxExternal += 1;
        else summary.excludedOtherSource += 1;
        continue;
      }
      summary.ticketmasterSource += 1;
      if (sourceBucket === 'trium') summary.acceptedTrium += 1;
      if (sourceBucket === 'mfx-es') summary.acceptedMfxEs += 1;
      if (record.eventId) relevantFeedIds.add(String(record.eventId));
      const dates = classifyDateHorizon(record, bounds);
      if (dates.invalid || !record.eventId || !record.eventName) {
        summary.invalidSkipped += 1; continue;
      }
      if (!dates.accepted) { summary.outOfHorizonSkipped += 1; continue; }
      summary.withinHorizon += 1;
      const location = ticketmasterLocation(record);
      if (!location.confirmed) { summary.outsideCataloniaSkipped += 1; continue; }
      summary.cataloniaCandidates += 1;
      candidates.push({ record, dates, location });
    }
    const recurring = detectRecurringInventory(candidates);
    summary.recurringDetails = recurring.details;
    summary.recurringInventorySkipped = recurring.skippedIds.size;
    const nonRecurring = candidates.filter((item) => !recurring.skippedIds.has(String(item.record.eventId)));
    const variants = classifyProductVariants(nonRecurring);
    const accepted = [];
    for (const item of nonRecurring) {
      if (isExcludedProviderTestRecord(item.record)) {
        summary.providerTestRecordsSkipped += 1;
        continue;
      }
      const variant = variants.get(String(item.record.eventId));
      if (variant) {
        summary.productVariantsSkipped += 1;
        summary.variantDetails.push({ eventId: item.record.eventId, title: item.record.eventName, confirmed: true, ...variant });
        continue;
      }
      accepted.push(item);
    }
    const groups = groupDailySessions(accepted);
    const runId = dryRun ? null : this.runs.start(source.id);
    try {
      for (const group of groups) {
        const normalized = normalizeTicketmasterGroup(group);
        if (!normalized) { summary.invalidSkipped += group.records.length; continue; }
        const match = this.matcher.match(normalized.plan);
        if (match.possible.length) {
          summary.possibleMerges += 1;
          summary.possibleMergeDetails.push({ title: normalized.plan.original_title, candidateIds: match.possible.map(({ id }) => id) });
        }
        if (match.confirmed) summary.confirmedMerges += 1;
        const existing = group.records.some((record) => this.db.prepare(
          'SELECT 1 FROM plan_sources WHERE source_id = ? AND source_record_id = ?',
        ).get(source.id, String(record.eventId)));
        if (dryRun) {
          if (existing) summary.updates += 1;
          else if (!match.confirmed) summary.newPlans += 1;
        } else {
          const persisted = this.plans.persistGroup({
            ...normalized, sourceId: source.id, targetPlanId: match.confirmed?.id,
            preserveExistingPlan: Boolean(match.confirmed),
          }, group.records.map((record) => ({
            sourceRecordId: String(record.eventId), sourceUrl: record.primaryEventUrl || source.dataset_url,
            sourceCreatedAt: null, sourceUpdatedAt: null, sourcePayload: withoutRestrictedImages(record),
          })));
          if (persisted.outcome === 'inserted') summary.newPlans += 1;
          else if (persisted.outcome === 'updated') summary.updates += 1;
          else summary.unchanged += 1;
        }
      }
      const removed = this.reconciliation.reconcile(source.id, relevantFeedIds, bounds.today, bounds.horizonEnd, {
        dryRun,
        removedAt: runNow.toISOString(),
      });
      summary.reconciliationRemovals = removed.length;
      summary.reconciliationDetails = removed.map(({ source_record_id, plan_id }) => ({ sourceRecordId: source_record_id, planId: plan_id }));
      if (!dryRun) this.runs.finish(runId, {
        fetched: summary.feedRecords, inserted: summary.newPlans, updated: summary.updates + summary.confirmedMerges,
        skipped: summary.outsideCataloniaSkipped + summary.outOfHorizonSkipped + summary.recurringInventorySkipped + summary.productVariantsSkipped + summary.providerTestRecordsSkipped + summary.invalidSkipped + summary.unchanged,
        invalid: summary.invalidSkipped, errors: 0,
      }, 'completed');
      return summary;
    } catch (error) {
      if (!dryRun) this.runs.finish(runId, { fetched: summary.feedRecords, inserted: 0, updated: 0, skipped: 0, invalid: 0, errors: 1 }, 'failed', error.message);
      throw error;
    }
  }
}
