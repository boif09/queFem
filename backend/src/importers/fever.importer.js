import { createHash } from 'node:crypto';
import { FeverPersistenceRepository } from '../db/repositories/feverPersistence.repository.js';
import { analyzeFeverNormalization } from '../fever/normalizationAnalysis.js';
import { FEVER_CAMPAIGN_ID, FEVER_CATALOG_ID } from '../fever/itemNormalizer.js';
import { SourceRegistry } from '../legal/sourceRegistry.js';
import { feverCategorySlugs, normalizeFeverPrice, validFeverImageUrl } from '../fever/publicationPolicy.js';

const RAW_FIELDS = [
  'CatalogItemId', 'Name', 'Description', 'Url', 'ImageUrl', 'CurrentPrice', 'Currency', 'Labels',
  'Material', 'ShippingLabel', 'Pattern', 'Text1', 'Text2', 'ParentName', 'Category', 'SubCategory',
  'LaunchDate', 'ExpirationDate',
  'Manufacturer',
];

function manufacturerDigest(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function sourcePayload(raw, product) {
  const payload = Object.fromEntries(RAW_FIELDS.map((field) => [field, raw?.[field] ?? null]));
  payload.Colors = Array.isArray(raw?.Colors) ? raw.Colors.slice(0, 1) : raw?.Colors ?? null;
  payload.ManufacturerSummary = {
    sha256: manufacturerDigest(raw?.Manufacturer),
    ...product.sessionStatistics,
  };
  return payload;
}

function planFor(product, geography, price) {
  const dates = product.publishableOccurrences.map(({ localDate }) => localDate).sort();
  const resolved = geography.status === 'match';
  return {
    kind: 'event', fingerprint: `fever|${product.productId}`, original_language: null,
    original_title: product.name, original_description: product.description,
    title_ca: null, title_es: null, subtitle_ca: null, subtitle_es: null,
    description_ca: null, description_es: null,
    start_date: dates[0], end_date: dates.at(-1), schedule_text: null, permanent: 0,
    price_text: price.type === 'fixed' ? `${price.amount} €` : null,
    is_free: price.type === 'free' ? 1 : null,
    province: resolved ? geography.province.name : null,
    comarca: resolved ? geography.comarca.name : null,
    municipality: resolved ? geography.municipality.name : null,
    locality: null, address: product.address, postal_code: null, venue_name: product.venue,
    latitude: product.coordinates.latitude, longitude: product.coordinates.longitude,
    website_url: null, ticket_url: null, image_url: null, image_reuse_allowed: 0,
    family_friendly: null, indoor: null, outdoor: null, recommended_months: null,
    featured: 0, quality_score: 55, status: 'active',
  };
}

function geographyFor(product, resolution, resolver, snapshotChecksum) {
  const resolved = resolution.status === 'match';
  return {
    resolution_status: resolved ? 'resolved' : resolution.status,
    latitude: product.coordinates.latitude,
    longitude: product.coordinates.longitude,
    municipality_code: resolved ? resolution.municipality.code : null,
    municipality_name: resolved ? resolution.municipality.name : null,
    comarca_code: resolved ? resolution.comarca.code : null,
    comarca_name: resolved ? resolution.comarca.name : null,
    province_code: resolved ? resolution.province.code : null,
    province_name: resolved ? resolution.province.name : null,
    provider: resolver.metadata.provider,
    dataset: resolver.metadata.dataset,
    dataset_date: resolver.metadata.datasetDate,
    layer: resolver.metadata.layer,
    snapshot_checksum: snapshotChecksum,
  };
}

export class FeverImporter {
  constructor({
    db, resolver, snapshotChecksum, lookaheadDays = 365, now = () => new Date(),
    minimumBaselineRatio = 0.5, analyzeImpl = analyzeFeverNormalization,
  }) {
    this.db = db;
    this.resolver = resolver;
    this.snapshotChecksum = snapshotChecksum;
    this.lookaheadDays = lookaheadDays;
    this.now = now;
    this.minimumBaselineRatio = minimumBaselineRatio;
    this.analyzeImpl = analyzeImpl;
    this.sources = new SourceRegistry(db);
    this.persistence = new FeverPersistenceRepository(db);
  }

  prepare(download) {
    if (!download || !Number.isInteger(download.pages) || download.pages < 1 || !Array.isArray(download.items)) {
      throw new Error('Impact feed is not a complete discovery result');
    }
    const cataloniaRaw = download.items.filter((item) => String(item?.CatalogId) === FEVER_CATALOG_ID
      && String(item?.CampaignId) === FEVER_CAMPAIGN_ID && item?.ParentName === 'Catalonia');
    const ids = new Set();
    for (const item of cataloniaRaw) {
      const id = String(item?.CatalogItemId ?? '').trim();
      if (!id) throw new Error('Fever item has no CatalogItemId');
      if (ids.has(id)) throw new Error(`Duplicate Fever CatalogItemId: ${id}`);
      ids.add(id);
    }
    const normalizationStarted = performance.now();
    const normalization = this.analyzeImpl(download, { lookaheadDays: this.lookaheadDays, now: this.now() });
    const normalizationMs = performance.now() - normalizationStarted;
    const rawById = new Map(cataloniaRaw.map((item) => [String(item.CatalogItemId), item]));
    const candidates = [];
    let ambiguous = 0;
    let unresolved = 0;
    let resolved = 0;
    let invalidAffiliate = 0;
    let manufacturerRawBytes = 0;
    let sourcePayloadBytes = 0;
    let geographyMs = 0;
    for (const product of normalization.normalizedProducts) {
      if (!product.publishableOccurrences.length) continue;
      if (!product.coordinatesValid) continue;
      if (!product.affiliateUrlValid) { invalidAffiliate += 1; continue; }
      const geographyStarted = performance.now();
      const resolution = this.resolver.resolve(product.coordinates);
      geographyMs += performance.now() - geographyStarted;
      if (resolution.status === 'ambiguous') { ambiguous += 1; continue; }
      if (resolution.status === 'unresolved') unresolved += 1;
      else resolved += 1;
      const raw = rawById.get(product.productId);
      const geography = geographyFor(product, resolution, this.resolver, this.snapshotChecksum);
      const payload = sourcePayload(raw, product);
      const price = normalizeFeverPrice(raw?.CurrentPrice, raw?.Currency, raw?.Labels);
      manufacturerRawBytes += Buffer.byteLength(JSON.stringify(raw?.Manufacturer ?? null));
      sourcePayloadBytes += Buffer.byteLength(JSON.stringify(payload));
      candidates.push({
        sourceRecordId: product.productId,
        sourceUrl: product.affiliateUrl,
        sourcePayload: payload,
        occurrences: product.publishableOccurrences,
        geography,
        plan: planFor(product, resolution, price),
        categorySlugs: feverCategorySlugs(product.subCategory),
        imageUrl: validFeverImageUrl(product.imageUrl),
      });
    }
    return {
      normalization, candidates, performance: { normalizationMs, geographyMs },
      counts: {
        catalonia: cataloniaRaw.length, resolved, unresolved, ambiguous, invalidAffiliate,
        manufacturerRawBytes, sourcePayloadBytes,
      },
    };
  }

  previousBaseline(sourceId) {
    const row = this.db.prepare(`SELECT summary_json FROM import_runs
      WHERE source_id=? AND status='completed' AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1`).get(sourceId);
    if (!row) return null;
    let value;
    try { value = JSON.parse(row.summary_json).catalonia; }
    catch { throw new Error('Previous completed Fever baseline has invalid summary_json'); }
    if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
      throw new Error('Previous completed Fever baseline has invalid catalonia count');
    }
    return value;
  }

  async run(download, { allowMassRemoval = false, failAfterProduct = null, beforeTransaction = null } = {}) {
    const source = this.sources.find('fever');
    if (!source) throw new Error('Fever source is not registered');
    const prepared = this.prepare(download);
    const startedAt = this.now().toISOString();
    const runId = Number(this.db.prepare(`INSERT INTO import_runs
      (source_id,started_at,status) VALUES (?,?,'running')`).run(source.id, startedAt).lastInsertRowid);
    let summary = {
      catalonia: prepared.counts.catalonia,
      eligible: prepared.normalization.summary.products.eligibleNonGift,
      publishable: prepared.normalization.summary.products.withPublishableOccurrence,
      ...prepared.counts,
      performance: prepared.performance,
      inserted: 0, updated: 0, unchanged: 0, reactivated: 0,
      sharedPreserved: 0, sourcesRemoved: 0, plansInactivated: 0,
      allowMassRemovalUsed: allowMassRemoval,
      writes: { plans: 0, sources: 0, geography: 0, occurrences: 0 },
      occurrences: { inserted: 0, updated: 0, unchanged: 0, reactivated: 0, inactivated: 0 },
      categories: {
        mapped: prepared.candidates.filter(({ categorySlugs }) => categorySlugs.length > 0).length,
        unmapped: prepared.candidates.filter(({ categorySlugs }) => categorySlugs.length === 0).length,
      },
      imagesMetadata: prepared.candidates.filter(({ imageUrl }) => Boolean(imageUrl)).length,
    };
    try {
      const finish = this.db.prepare(`UPDATE import_runs SET finished_at=?,status=?,fetched=?,inserted=?,
        updated=?,skipped=?,invalid=?,errors=?,error_message=?,summary_json=? WHERE id=?`);
      const baseline = this.previousBaseline(source.id);
      const existingIds = this.persistence.sourceRecordIds(source.id);
      const desiredIds = new Set(prepared.candidates.map(({ sourceRecordId }) => sourceRecordId));
      const plannedRemovalCount = [...existingIds].filter((id) => !desiredIds.has(id)).length;
      const plannedRemovalRatio = existingIds.size ? plannedRemovalCount / existingIds.size : 0;
      summary = {
        ...summary,
        removalGuard: {
          existingCount: existingIds.size, desiredCount: desiredIds.size,
          plannedRemovalCount, plannedRemovalRatio,
        },
      };
      if (baseline !== null && prepared.counts.catalonia < baseline * this.minimumBaselineRatio && !allowMassRemoval) {
        throw new Error(`Fever count guard rejected Catalunya drop ${baseline} -> ${prepared.counts.catalonia}`);
      }
      if (existingIds.size > 0 && plannedRemovalRatio > (1 - this.minimumBaselineRatio)
        && !allowMassRemoval) {
        throw new Error(`Fever desired-set guard rejected removal ${plannedRemovalCount}/${existingIds.size}`);
      }
      beforeTransaction?.({ db: this.db, source, prepared, summary, desiredIds, existingIds });
      const transactionStarted = performance.now();
      this.db.transaction(() => {
        for (const [index, candidate] of prepared.candidates.entries()) {
          const result = this.persistence.persistProduct(source.id, candidate, startedAt);
          summary[result.outcome] += 1;
          if (result.sharedPreserved) summary.sharedPreserved += 1;
          summary.occurrences.inserted += result.occurrenceStats.inserted;
          summary.occurrences.updated += result.occurrenceStats.updated;
          summary.occurrences.unchanged += result.occurrenceStats.unchanged;
          summary.occurrences.reactivated += result.occurrenceStats.reactivated;
          summary.occurrences.inactivated += result.occurrenceStats.retired;
          for (const [key, count] of Object.entries(result.writes)) summary.writes[key] += count;
          if (failAfterProduct !== null && index === failAfterProduct) throw new Error('Simulated Fever transaction failure');
        }
        const retired = this.persistence.retireAbsent(source.id, desiredIds, startedAt);
        summary.sourcesRemoved = retired.sourcesRemoved;
        summary.plansInactivated = retired.plansInactivated;
        summary.sharedPreserved += retired.sharedPlansPreserved;
        summary.writes.sources += retired.sourcesRemoved;
        summary.writes.plans += retired.plansInactivated;
        finish.run(this.now().toISOString(), 'completed', download.items.length, summary.inserted,
          summary.updated + summary.reactivated, summary.ambiguous + summary.invalidAffiliate,
          0, 0, null, JSON.stringify(summary), runId);
      })();
      summary.performance.transactionMs = performance.now() - transactionStarted;
      summary.importRun = { id: runId, status: 'completed' };
      return summary;
    } catch (error) {
      try {
        this.db.prepare(`UPDATE import_runs SET finished_at=?,status=?,fetched=?,inserted=?,
          updated=?,skipped=?,invalid=?,errors=?,error_message=?,summary_json=? WHERE id=?`
        ).run(this.now().toISOString(), 'failed', download.items.length, 0, 0, 0, 0, 1,
          String(error.message).slice(0, 500), JSON.stringify(summary), runId);
      } catch (recordError) {
        throw new AggregateError([error, recordError], 'Fever import failed and failed-run recording also failed');
      }
      throw error;
    }
  }
}
