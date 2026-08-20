function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter >= 0
    ? Math.min(10_000, retryAfter * 1000)
    : 500 * attempt;
}

export class TicketmasterImageClient {
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
    if (!apiKey) throw new Error('Falta TICKETMASTER_API_KEY.');
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async getEventImages(eventId) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const url = new URL(`https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(eventId)}/images.json`);
        url.searchParams.set('apikey', this.apiKey);
        const response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 404) throw new Error(`Ticketmaster event ${eventId} no existeix.`);
        if (response.status === 429) {
          lastError = new Error(`Ticketmaster ha limitat temporalment l'event ${eventId}.`);
          if (attempt < 3) await wait(retryDelay(response, attempt));
          continue;
        }
        if (!response.ok) throw new Error(`Ticketmaster images ha respost HTTP ${response.status} per l'event ${eventId}.`);
        const payload = await response.json();
        const images = Array.isArray(payload) ? payload : payload?.images;
        if (!Array.isArray(images)) throw new Error(`Resposta d'imatges invàlida per l'event ${eventId}.`);
        return images;
      } catch (error) {
        lastError = error;
        if (attempt < 3 && error.name === 'AbortError') await wait(500 * attempt);
        else if (error.name !== 'AbortError' || attempt === 3) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
