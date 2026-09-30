import { retentionCutoff } from '../retention/eventRetention.js';

const MAX_PENDING_KEYS = 5000;

// Aggregates widget loads in memory and writes them in one short transaction per interval, so
// embed traffic never adds one SQLite write per request.
export class EmbedUsageRecorder {
  constructor({ repository, now = () => new Date(), flushIntervalMs = 60_000, logger = console }) {
    this.repository = repository;
    this.now = now;
    this.logger = logger;
    this.pending = new Map();
    this.timer = flushIntervalMs > 0 ? setInterval(() => this.flush(), flushIntervalMs) : null;
    this.timer?.unref?.();
  }

  record(widgetId, origin, { rejected = false } = {}) {
    const usageDate = retentionCutoff(0, this.now());
    let bucketOrigin = origin;
    let key = `${widgetId}\u001f${usageDate}\u001f${origin}`;
    // Bounded memory: under a flood of distinct origins, new ones fold into one overflow bucket per
    // widget and day. Only existing widgets reach this point, so overflow buckets stay bounded too.
    if (!this.pending.has(key) && this.pending.size >= MAX_PENDING_KEYS) {
      bucketOrigin = 'other';
      key = `${widgetId}\u001f${usageDate}\u001f${bucketOrigin}`;
    }
    let counter = this.pending.get(key);
    if (!counter) {
      counter = { widgetId, usageDate, origin: bucketOrigin, impressions: 0, rejected: 0 };
      this.pending.set(key, counter);
    }
    if (rejected) counter.rejected += 1;
    else counter.impressions += 1;
  }

  flush() {
    if (!this.pending.size) return;
    const counters = [...this.pending.values()];
    this.pending.clear();
    try {
      this.repository.addUsage(counters);
    } catch (error) {
      this.logger.warn?.(`No s’ha pogut desar l’ús dels widgets: ${error.message}`);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }
}
