import { parse } from 'parse5';

export const GENCAT_AGENDA_ORIGIN = 'https://agenda.cultura.gencat.cat';
export const DEFAULT_GENCAT_HTML_MAXIMUM_BYTES = 2 * 1024 * 1024;
export const DEFAULT_GENCAT_METADATA_CONCURRENCY = 2;
export const DEFAULT_GENCAT_REQUEST_INTERVAL_MS = 500;

const HTML_CONTENT_TYPE = 'text/html';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_ONERROR_LENGTH = 4096;
const MAX_DAM_PATH_LENGTH = 2048;
const MAX_ATTRIBUTION_LENGTH = 2000;
const DAM_PATH_PREFIX = '/content/dam/agenda/';

function unknown(imagePath) {
  return { imagePath, attribution: null, attributionKnown: false };
}

function attribute(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}

function hasClass(node, className) {
  return (attribute(node, 'class') || '').split(/\s+/).includes(className);
}

function descendants(node, predicate, matches = []) {
  for (const child of node.childNodes || []) {
    if (predicate(child)) matches.push(child);
    descendants(child, predicate, matches);
  }
  return matches;
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

export function extractFallbackDamPath(onerror) {
  if (typeof onerror !== 'string' || onerror.length === 0 || onerror.length > MAX_ONERROR_LENGTH) return null;
  const matches = [...onerror.matchAll(/\bthis\.src\s*=\s*(['"])(\/content\/dam\/agenda\/[^'"\r\n]+)\1/g)];
  return matches.length === 1 && matches[0][2].length <= MAX_DAM_PATH_LENGTH ? matches[0][2] : null;
}

export function parseGencatImageMetadata(html, imagePath) {
  if (typeof html !== 'string' || typeof imagePath !== 'string' || !imagePath.startsWith(DAM_PATH_PREFIX)) {
    return unknown(imagePath);
  }
  try {
    const document = parse(html);
    const htmlElements = descendants(document, (node) => node.tagName === 'html');
    const bodyElements = descendants(document, (node) => node.tagName === 'body');
    if (htmlElements.length !== 1 || bodyElements.length !== 1) return unknown(imagePath);

    const slides = descendants(bodyElements[0], (node) => node.tagName === 'div' && hasClass(node, 'carousel-item'));
    if (slides.length === 0) return unknown(imagePath);
    const matchingSlides = slides.filter((slide) => descendants(slide, (node) => (
      node.tagName === 'img' && extractFallbackDamPath(attribute(node, 'onerror')) === imagePath
    )).length === 1);
    if (matchingSlides.length !== 1) return unknown(imagePath);

    const footers = descendants(matchingSlides[0], (node) => {
      if (!hasClass(node, 'slider-footer')) return false;
      const parent = node.parentNode;
      return Boolean(parent && hasClass(parent, 'image-footertext'));
    });
    if (footers.length !== 1) return unknown(imagePath);
    const attribution = textContent(footers[0]).replace(/\s+/g, ' ').trim();
    if (attribution.length > MAX_ATTRIBUTION_LENGTH) return unknown(imagePath);
    return { imagePath, attribution: attribution || null, attributionKnown: true };
  } catch {
    return unknown(imagePath);
  }
}

async function responseText(response, maximumBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error('HTML_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) {
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maximumBytes) throw new Error('HTML_TOO_LARGE');
    return data.toString('utf8');
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('HTML_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export class GencatRequestScheduler {
  constructor({ concurrency, intervalMs, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.concurrency = concurrency;
    this.intervalMs = intervalMs;
    this.now = now;
    this.sleep = sleep;
    this.active = 0;
    this.queue = [];
    this.nextStart = 0;
  }

  run(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift();
      this.active += 1;
      Promise.resolve().then(async () => {
        const currentTime = this.now();
        const reservedStart = Math.max(this.nextStart, currentTime);
        this.nextStart = reservedStart + this.intervalMs;
        const delay = reservedStart - currentTime;
        if (delay > 0) await this.sleep(delay);
        return entry.operation();
      }).then(entry.resolve, entry.reject).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }
}

function validatedCanonicalRedirect(location, requestUrl, codi) {
  try {
    const target = new URL(location, requestUrl);
    const expectedPrefix = `/ca/activitat.html/${codi}/`;
    const slug = target.pathname.startsWith(expectedPrefix) ? target.pathname.slice(expectedPrefix.length) : '';
    if (target.origin !== GENCAT_AGENDA_ORIGIN || target.username || target.password
      || target.search || target.hash || !slug || slug.includes('/')) return null;
    return target;
  } catch {
    return null;
  }
}

export class GencatImageMetadataResolver {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
    maximumBytes = DEFAULT_GENCAT_HTML_MAXIMUM_BYTES,
    concurrency = DEFAULT_GENCAT_METADATA_CONCURRENCY,
    intervalMs = DEFAULT_GENCAT_REQUEST_INTERVAL_MS,
    scheduler,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('Concurrència Gencat invàlida.');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.scheduler = scheduler || new GencatRequestScheduler({ concurrency, intervalMs });
  }

  async resolve({ codi, imagePath }) {
    const result = unknown(imagePath);
    if (!/^\d{1,32}$/.test(String(codi || '')) || typeof imagePath !== 'string' || !imagePath.startsWith(DAM_PATH_PREFIX)) {
      return result;
    }
    return this.scheduler.run(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        let requestUrl = new URL(`/ca/activitat.html/${codi}`, GENCAT_AGENDA_ORIGIN);
        let response = await this.fetchImpl(requestUrl, {
          headers: { Accept: 'text/html' }, redirect: 'manual', signal: controller.signal,
        });
        if (REDIRECT_STATUSES.has(response.status)) {
          const target = validatedCanonicalRedirect(response.headers.get('location'), requestUrl, String(codi));
          if (!target) return result;
          requestUrl = target;
          response = await this.fetchImpl(requestUrl, {
            headers: { Accept: 'text/html' }, redirect: 'manual', signal: controller.signal,
          });
        }
        if (response.status !== 200 || REDIRECT_STATUSES.has(response.status)) return result;
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (contentType !== HTML_CONTENT_TYPE) return result;
        return parseGencatImageMetadata(await responseText(response, this.maximumBytes), imagePath);
      } catch {
        return result;
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

export function gencatImageUrl(imagePath) {
  if (typeof imagePath !== 'string' || imagePath.length > MAX_DAM_PATH_LENGTH || !imagePath.startsWith(DAM_PATH_PREFIX)
    || /[\u0000-\u001f?#]/.test(imagePath) || imagePath.includes('..')) return null;
  try {
    const url = new URL(imagePath, GENCAT_AGENDA_ORIGIN);
    return url.origin === GENCAT_AGENDA_ORIGIN && url.pathname.startsWith(DAM_PATH_PREFIX) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function selectGencatImagePath(value) {
  if (typeof value !== 'string') return null;
  for (const candidate of value.split(',').map((item) => item.trim())) {
    if (gencatImageUrl(candidate)) return candidate;
  }
  return null;
}
