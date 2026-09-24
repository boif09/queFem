const ALLOWED_HOSTS = new Set(['s1.ticketm.net']);
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);
export const DEFAULT_MEDIA_REMOTE_FETCH_CONCURRENCY = 4;
export const MAXIMUM_MEDIA_REMOTE_FETCH_CONCURRENCY = 16;

// A normal discovery page can easily show more distinct plan images than the
// concurrency budget above (e.g. 25 "Gran Gala Flamenc" occurrences, each
// with its own Gencat image, observed together on one search results page).
// Confirmed in production: an uncached image beyond the concurrency budget
// used to fail immediately with a 503, even though the only real constraint
// was "wait a fraction of a second for one of 4 slots" — the host itself was
// never even contacted for the rejected requests. These two settings turn
// that into a bounded wait instead of an immediate failure.
//
// Depth of 24: concurrency (4) + queue depth is the total number of
// in-flight-or-waiting fetches this process will accept before genuinely
// shedding load. 24 covers the confirmed real worst case with margin: the
// motivating "Gran Gala Flamenc" page has exactly 25 distinct cold images,
// so 4 + 24 = 28 absorbs that whole page even if every image were requested
// at once, plus headroom for concurrent traffic from other users — an
// earlier, tighter value of 16 (4 + 16 = 20) would still have genuinely
// overflowed 5 of those 25 images even after this fix (cross-review
// finding). Observed real fetch time for an uncached image is ~0.7-0.8s: a
// full 24-deep queue drains in about (24 / 4) batches * ~0.8s ≈ 4.8s under
// normal conditions, which is why the wait timeout below is 6s. Memory cost
// of a queued entry is a closure and a timer, not a fetch buffer — a
// fetch's memory is only allocated once it starts executing — so this is a
// latency/fairness bound, not a resource-safety one.
export const DEFAULT_MEDIA_REMOTE_FETCH_QUEUE_DEPTH = 24;
export const MAXIMUM_MEDIA_REMOTE_FETCH_QUEUE_DEPTH = 64;

// 6s: comfortably above the ~4.8s normal full-queue drain time above, so a
// request queued behind a completely full queue under ordinary conditions
// still succeeds well before this fires. If the remote host is genuinely
// slow or down, active fetches will themselves eventually hit their own
// per-request timeout (default 15s) and free their slot — but a queued
// caller should not be made to wait that long on the chance of a slot
// opening up; failing with MEDIA_CAPACITY after a bounded wait is the
// correct signal that the system is under real, sustained load.
export const DEFAULT_MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS = 6000;
export const MAXIMUM_MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS = 20000;

// Callers can retry a genuine capacity rejection quickly: a normal-condition
// queue drains in low single-digit seconds (see above).
const MEDIA_CAPACITY_RETRY_AFTER_SECONDS = 3;

export class TicketmasterMediaError extends Error {
  constructor(status, code, message, { retryAfterSeconds = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function mediaCapacityError() {
  return new TicketmasterMediaError(
    503,
    'MEDIA_CAPACITY',
    'La imatge no està disponible temporalment.',
    { retryAfterSeconds: MEDIA_CAPACITY_RETRY_AFTER_SECONDS },
  );
}

// Bounded FIFO wait queue for remote media fetches, shared across all image
// sources (Ticketmaster, Fever, Gencat — see app.js). A cache hit never
// reaches this class at all: callers check their cache before calling run(),
// so cached images never consume a concurrency slot or a queue slot.
//
// - Below the concurrency cap: runs immediately, exactly as before.
// - At the cap, with queue room: waits in FIFO order for a slot to free.
// - At the cap, with the queue full, or after waiting past the configured
//   timeout: rejects with MEDIA_CAPACITY — now a genuine overload signal
//   rather than "more than `maximum` requests happened to start at once".
export class MediaRemoteFetchLimiter {
  constructor(
    maximum = DEFAULT_MEDIA_REMOTE_FETCH_CONCURRENCY,
    {
      maxQueueDepth = DEFAULT_MEDIA_REMOTE_FETCH_QUEUE_DEPTH,
      maxQueueWaitMs = DEFAULT_MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS,
      logger = null,
    } = {},
  ) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_MEDIA_REMOTE_FETCH_CONCURRENCY) {
      throw new TypeError('El límit de concurrència remota de media no és vàlid.');
    }
    if (!Number.isSafeInteger(maxQueueDepth) || maxQueueDepth < 0 || maxQueueDepth > MAXIMUM_MEDIA_REMOTE_FETCH_QUEUE_DEPTH) {
      throw new TypeError('La profunditat de la cua de media no és vàlida.');
    }
    if (!Number.isSafeInteger(maxQueueWaitMs) || maxQueueWaitMs < 0 || maxQueueWaitMs > MAXIMUM_MEDIA_REMOTE_FETCH_QUEUE_WAIT_MS) {
      throw new TypeError('El temps màxim d’espera de la cua de media no és vàlid.');
    }
    this.maximum = maximum;
    this.maxQueueDepth = maxQueueDepth;
    this.maxQueueWaitMs = maxQueueWaitMs;
    this.logger = logger;
    this.active = 0;
    this.queue = [];
  }

  run(operation) {
    if (this.active < this.maximum) {
      return this.execute(operation);
    }
    if (this.queue.length >= this.maxQueueDepth) {
      this.logger?.warn?.(`Media queue overflow: ${this.queue.length} already queued, ${this.active} active.`);
      return Promise.reject(mediaCapacityError());
    }
    return new Promise((resolve, reject) => {
      const entry = { operation, resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        this.removeFromQueue(entry);
        this.logger?.warn?.(`Media queue wait timeout after ${this.maxQueueWaitMs}ms (${this.queue.length} still queued, ${this.active} active).`);
        reject(mediaCapacityError());
      }, this.maxQueueWaitMs);
      this.queue.push(entry);
    });
  }

  removeFromQueue(entry) {
    const index = this.queue.indexOf(entry);
    if (index !== -1) this.queue.splice(index, 1);
  }

  execute(operation) {
    this.active += 1;
    return Promise.resolve().then(operation).finally(() => {
      this.active -= 1;
      this.advanceQueue();
    });
  }

  advanceQueue() {
    if (this.active >= this.maximum) return;
    const entry = this.queue.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    this.execute(entry.operation).then(entry.resolve, entry.reject);
  }
}

export function validateTicketmasterImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) {
      throw new Error();
    }
    return url;
  } catch {
    throw new TicketmasterMediaError(404, 'MEDIA_NOT_AVAILABLE', 'La imatge no està disponible.');
  }
}

export function validateFeverImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'applications-media.feverup.com' || url.username || url.password) throw new Error();
    return url;
  } catch { throw new TicketmasterMediaError(404, 'MEDIA_NOT_AVAILABLE', 'La imatge no està disponible.'); }
}

export function validateGencatImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'agenda.cultura.gencat.cat'
      || url.port || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith('/content/dam/agenda/')
      || /%2e/i.test(url.pathname)) throw new Error();
    return url;
  } catch {
    throw new TicketmasterMediaError(404, 'MEDIA_NOT_AVAILABLE', 'La imatge no està disponible.');
  }
}

async function responseBuffer(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new TicketmasterMediaError(502, 'MEDIA_TOO_LARGE', 'La imatge remota supera el límit permès.');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maximumBytes) throw new TicketmasterMediaError(502, 'MEDIA_TOO_LARGE', 'La imatge remota supera el límit permès.');
    return data;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new TicketmasterMediaError(502, 'MEDIA_TOO_LARGE', 'La imatge remota supera el límit permès.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export class TicketmasterImageProxy {
  constructor({
    cache, fetchImpl = globalThis.fetch, timeoutMs = 15_000,
    maximumBytes = 10 * 1024 * 1024, validImageIds, validateUrl = validateTicketmasterImageUrl,
    limiter = new MediaRemoteFetchLimiter(),
  }) {
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.validImageIds = validImageIds;
    this.validateUrl = validateUrl;
    this.limiter = limiter;
    this.inFlight = new Map();
  }

  async get(image) {
    const sourceUrl = this.validateUrl(image.url);
    const cached = await this.cache.read(image);
    if (cached) return cached;
    if (!this.inFlight.has(image.id)) {
      this.inFlight.set(image.id, this.limiter.run(() => this.fetchAndCache(image, sourceUrl))
        .finally(() => this.inFlight.delete(image.id)));
    }
    return this.inFlight.get(image.id);
  }

  async fetchAndCache(image, sourceUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(sourceUrl, {
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status !== 200) throw new TicketmasterMediaError(502, 'MEDIA_ORIGIN_ERROR', 'No s’ha pogut obtenir la imatge remota.');
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new TicketmasterMediaError(502, 'MEDIA_INVALID_TYPE', 'La resposta remota no és una imatge admesa.');
      }
      const data = await responseBuffer(response, this.maximumBytes);
      const result = await this.cache.write(image, { data, contentType });
      if (this.validImageIds) await this.cache.cleanup(this.validImageIds());
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new TicketmasterMediaError(504, 'MEDIA_TIMEOUT', 'La imatge remota no ha respost a temps.');
      }
      if (error instanceof TicketmasterMediaError) throw error;
      throw new TicketmasterMediaError(502, 'MEDIA_ORIGIN_ERROR', 'No s’ha pogut obtenir la imatge remota.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
