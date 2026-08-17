import { ImportRunRepository } from '../db/repositories/importRun.repository.js';
import { PlanRepository } from '../db/repositories/plan.repository.js';
import { SourceRegistry } from '../legal/sourceRegistry.js';

export class BaseImporter {
  constructor({ db, logger = console }) {
    if (new.target === BaseImporter) {
      throw new TypeError('BaseImporter és una classe abstracta.');
    }
    this.db = db;
    this.logger = logger;
    this.sources = new SourceRegistry(db);
    this.plans = new PlanRepository(db);
    this.importRuns = new ImportRunRepository(db);
  }

  fetch() {
    throw new Error('fetch() s’ha d’implementar.');
  }

  normalize() {
    throw new Error('normalize() s’ha d’implementar.');
  }

  getSourceId() {
    throw new Error('getSourceId() s’ha d’implementar.');
  }

  getExternalId() {
    throw new Error('getExternalId() s’ha d’implementar.');
  }

  getSourceUrl(record, source) {
    return source.dataset_url;
  }

  getSourceCreatedAt() {
    return null;
  }

  getSourceUpdatedAt() {
    return null;
  }

  getSourcePayload(record) {
    return record;
  }

  shouldImport() {
    return true;
  }

  getInvalidIssue() {
    return null;
  }

  describeInvalidRecord(record, normalized, issue) {
    return {
      source_record_id: this.getExternalId(record),
      reason: issue.code,
      message: issue.message,
      start_date: normalized.plan.start_date,
      end_date: normalized.plan.end_date,
    };
  }

  async run() {
    const source = this.sources.requireApproved(this.getSourceId());
    const runId = this.importRuns.start(source.id);
    const summary = {
      fetched: 0, inserted: 0, updated: 0, skipped: 0, invalid: 0, errors: 0,
    };
    const invalidDetails = [];
    let reportedErrors = 0;
    let reportedInvalid = 0;

    try {
      for await (const record of this.fetch()) {
        summary.fetched += 1;
        try {
          const normalized = this.normalize(record);
          if (!normalized) {
            summary.skipped += 1;
            continue;
          }
          const invalidIssue = this.getInvalidIssue(record, normalized);
          if (invalidIssue) {
            summary.skipped += 1;
            summary.invalid += 1;
            const detail = this.describeInvalidRecord(record, normalized, invalidIssue);
            if (invalidDetails.length < 100) invalidDetails.push(detail);
            if (reportedInvalid < 20) {
              this.logger.warn(
                `Registre invàlid omès (${detail.source_record_id}): [${invalidIssue.code}] ${invalidIssue.message}`,
              );
              reportedInvalid += 1;
            }
            continue;
          }
          if (!this.shouldImport(record, normalized)) {
            summary.skipped += 1;
            continue;
          }

          const outcome = this.plans.persist({
            ...normalized,
            sourceId: source.id,
            sourceRecordId: this.getExternalId(record),
            sourceUrl: this.getSourceUrl(record, source),
            sourceCreatedAt: this.getSourceCreatedAt(record),
            sourceUpdatedAt: this.getSourceUpdatedAt(record),
            sourcePayload: this.getSourcePayload(record, source),
          });
          summary[outcome] += 1;
        } catch (error) {
          summary.errors += 1;
          if (reportedErrors < 10) {
            this.logger.warn(`Registre omès per error: ${error.message}`);
            reportedErrors += 1;
          }
        }
      }

      this.importRuns.finish(
        runId,
        summary,
        summary.errors > 0 ? 'completed_with_errors' : 'completed',
        null,
        invalidDetails,
      );
      return summary;
    } catch (error) {
      summary.errors += 1;
      this.importRuns.finish(runId, summary, 'failed', error.message, invalidDetails);
      error.importSummary = summary;
      throw error;
    }
  }
}
