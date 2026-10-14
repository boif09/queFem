import fs from 'node:fs';
import path from 'node:path';

// The DIBA review queue is a small JSON report next to the SQLite file. The import never waits on it: it lists
// possible duplicates that were imported as separate plans (and stale human decisions that were ignored) so a
// person — or a future private page — can resolve them later without blocking the daily import.
export const REVIEW_QUEUE_FILE = 'diba-review-queue.json';

export function reviewQueuePath(databasePath) {
  return path.join(path.dirname(path.resolve(databasePath)), REVIEW_QUEUE_FILE);
}

function readQueue(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && parsed.version === 1 && Array.isArray(parsed.items) ? parsed : { version: 1, items: [] };
  } catch {
    return { version: 1, items: [] };
  }
}

// Replaces the items of every feed that produced a queue in this run, keeps the items of feeds that did not
// (a failed fetch must not erase their backlog) and preserves firstSeenAt for items that are still pending.
export function updateReviewQueue(filePath, datasetResults, now = new Date()) {
  const previous = readQueue(filePath);
  const refreshed = datasetResults.filter((result) => Array.isArray(result?.reviewQueue) && !result.failed);
  const refreshedKeys = new Set(refreshed.map((result) => result.sourceKey));
  const firstSeen = new Map(previous.items.map((item) => [item.id, item.firstSeenAt]));
  const timestamp = now.toISOString();
  const items = [
    ...previous.items.filter((item) => !refreshedKeys.has(item.sourceKey)),
    ...refreshed.flatMap((result) => result.reviewQueue.map((item) => ({
      ...item, firstSeenAt: firstSeen.get(item.id) || timestamp, lastSeenAt: timestamp,
    }))),
  ].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey) || left.id.localeCompare(right.id));
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1;
  const queue = { version: 1, updatedAt: timestamp, total: items.length, counts, items };
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(queue, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return queue;
}
