const ALLOWED_HOSTS = new Set(['s1.ticketm.net']);
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);

export class TicketmasterMediaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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
    maximumBytes = 10 * 1024 * 1024, validImageIds,
  }) {
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.validImageIds = validImageIds;
    this.inFlight = new Map();
  }

  async get(image) {
    const sourceUrl = validateTicketmasterImageUrl(image.url);
    const cached = await this.cache.read(image);
    if (cached) return cached;
    if (!this.inFlight.has(image.id)) {
      this.inFlight.set(image.id, this.fetchAndCache(image, sourceUrl)
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
