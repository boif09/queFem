const API_ORIGIN = 'https://api.impact.com';
const API_HOST = 'api.impact.com';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeNextPageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value, API_ORIGIN);
  } catch {
    throw new Error('Impact ha retornat una URL de paginació invàlida.');
  }
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.username || url.password) {
    throw new Error('Impact ha retornat una URL de paginació no permesa.');
  }
  return url;
}

function pageItems(payload) {
  const items = payload?.Items ?? payload?.items;
  if (!Array.isArray(items)) throw new Error('Impact ha retornat una pàgina sense una llista Items vàlida.');
  return items;
}

function nextPageUri(payload) {
  return payload?.['@nextpageuri'] ?? payload?.['@nextPageUri'] ?? null;
}

export class ImpactCatalogClient {
  constructor({
    accountSid, authToken, fetchImpl = globalThis.fetch, timeoutMs = 30_000,
    maximumPages = 100, maximumItems = 20_000, maximumResponseBytes = 10 * 1024 * 1024,
    retries = 3, backoffMs = 300,
  }) {
    if (!accountSid || !authToken) throw new Error('Falten les credencials Impact requerides.');
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    this.accountSid = accountSid;
    this.authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maximumPages = maximumPages;
    this.maximumItems = maximumItems;
    this.maximumResponseBytes = maximumResponseBytes;
    this.retries = retries;
    this.backoffMs = backoffMs;
  }

  initialUrl() {
    const url = new URL(`/Mediapartners/${encodeURIComponent(this.accountSid)}/Catalogs/ItemSearch`, API_ORIGIN);
    url.searchParams.set('Query', "Text1='Spain'");
    url.searchParams.set('PageSize', '200');
    return url;
  }

  async requestPage(url) {
    let lastError;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json', Authorization: this.authorization },
          redirect: 'manual', signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Impact ha rebutjat l'autenticació (HTTP ${response.status}).`);
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          const error = new Error(`Impact ha respost HTTP ${response.status}.`);
          error.retryable = retryable;
          throw error;
        }
        const declaredLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > this.maximumResponseBytes) {
          throw new Error('Impact ha retornat una resposta massa gran.');
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > this.maximumResponseBytes) throw new Error('Impact ha retornat una resposta massa gran.');
        try {
          return JSON.parse(text);
        } catch {
          throw new Error('Impact ha retornat JSON invàlid.');
        }
      } catch (error) {
        const transient = error.name === 'AbortError' || error.retryable === true
          || error instanceof TypeError;
        if (!transient || attempt === this.retries) {
          if (error.name === 'AbortError') throw new Error('Impact no ha respost dins del temps límit.');
          if (error instanceof TypeError) throw new Error('No s’ha pogut connectar amb Impact.');
          throw error;
        }
        lastError = error;
        await wait(this.backoffMs * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async discoverSpain() {
    const items = [];
    const seen = new Set();
    let url = this.initialUrl();
    let pages = 0;
    while (url) {
      const pageKey = url.toString();
      if (seen.has(pageKey)) throw new Error('Impact ha retornat un cicle de paginació.');
      if (pages >= this.maximumPages) throw new Error('Impact ha superat el límit defensiu de pàgines.');
      seen.add(pageKey);
      const payload = await this.requestPage(url);
      const currentItems = pageItems(payload);
      if (items.length + currentItems.length > this.maximumItems) {
        throw new Error('Impact ha superat el límit defensiu d’items.');
      }
      items.push(...currentItems);
      pages += 1;
      url = safeNextPageUrl(nextPageUri(payload));
    }
    return { pages, items };
  }
}
