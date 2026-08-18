import { gunzipSync } from 'node:zlib';

const FEED_URL = 'https://app.ticketmaster.com/discovery-feed/v2/events.json';
const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DiscoveryFeedClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) {
    if (!apiKey) throw new Error('Falta TICKETMASTER_API_KEY.');
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async downloadSpain() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const url = new URL(FEED_URL);
        url.searchParams.set('countryCode', 'ES');
        url.searchParams.set('apikey', this.apiKey);
        const response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Ticketmaster Discovery Feed ha respost HTTP ${response.status}.`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_COMPRESSED_BYTES) throw new Error('Ticketmaster Discovery Feed supera el límit de mida comprimida.');
        const isGzip = response.headers.get('content-type')?.includes('gzip')
          || (bytes[0] === 0x1f && bytes[1] === 0x8b);
        const decoded = isGzip ? gunzipSync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }) : bytes;
        const text = decoded.toString('utf8');
        if (!text.trim()) throw new Error('Ticketmaster Discovery Feed ha retornat una resposta buida.');
        try {
          return JSON.parse(text);
        } catch {
          throw new Error('Ticketmaster Discovery Feed ha retornat JSON invàlid.');
        }
      } catch (error) {
        lastError = error;
        if (attempt < 3) await wait(300 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
