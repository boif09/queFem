import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_FALLBACK_ORIGINALS_PATH = path.resolve('data/fallback-image-originals');
const API_ORIGIN = 'https://api.pexels.com';
const IMAGE_ORIGIN = 'images.pexels.com';
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;

function failure(message) {
  return new Error(`No s’han pogut adquirir les imatges Pexels: ${message}`);
}

function requireApiKey(apiKey) {
  if (!apiKey?.trim()) throw failure('cal PEXELS_API_KEY a l’entorn.');
  return apiKey.trim();
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw failure(`${label} invàlida.`);
  }
}

function assertPexelsPage(url, id) {
  const parsed = parseUrl(url, 'URL de pàgina Pexels');
  if (parsed.protocol !== 'https:' || !['www.pexels.com', 'pexels.com'].includes(parsed.hostname) || !parsed.pathname.includes(String(id))) {
    throw failure(`la pàgina retornada no correspon a la foto ${id}.`);
  }
}

function assertImageUrl(url, id) {
  const parsed = parseUrl(url, 'URL d’original Pexels');
  if (parsed.protocol !== 'https:' || parsed.hostname !== IMAGE_ORIGIN || !parsed.pathname.includes(String(id))) {
    throw failure(`l’original retornat no correspon a la foto ${id}.`);
  }
  return parsed.href;
}

function extensionFor(contentType, data) {
  const mime = String(contentType || '').split(';', 1)[0].toLowerCase();
  const isJpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9;
  const isPng = data.length >= 20 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && data.subarray(-8).equals(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
  const isWebp = data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP' && data.readUInt32LE(4) + 8 === data.length;
  if (!mime.startsWith('image/')) throw failure('la descàrrega no és una resposta d’imatge.');
  if (isJpeg) return '.jpg';
  if (isPng) return '.png';
  if (isWebp) return '.webp';
  throw failure('la descàrrega d’imatge és invàlida o incompleta.');
}

function existingExtension(entryName, directory) {
  return ['.jpg', '.jpeg', '.png', '.webp'].map((extension) => path.join(directory, `${entryName}${extension}`));
}

async function validExistingOriginal(item, directory) {
  const candidates = [];
  for (const filename of existingExtension(item.id, directory)) {
    try {
      const data = await fs.readFile(filename);
      extensionFor({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(filename)], data);
      candidates.push(filename);
    } catch {
      // An interrupted or invalid file is deliberately not treated as a completed original.
    }
  }
  if (candidates.length > 1) throw failure(`hi ha més d’un original vàlid per ${item.id}.`);
  return candidates[0] || null;
}

function delayFrom(response, fallbackMs) {
  const retryAfter = Number.parseFloat(response.headers.get('retry-after') || '');
  return Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 60_000) : fallbackMs;
}

export function validateFetchManifest(items) {
  if (!Array.isArray(items) || items.length !== 100) throw failure('el manifest ha de contenir exactament 100 imatges.');
  const ids = new Set(items.map(({ id }) => id));
  const photoIds = new Set(items.map(({ pexels_photo_id: id }) => id));
  if (ids.size !== 100 || photoIds.size !== 100 || [...photoIds].some((id) => !Number.isInteger(id))) {
    throw failure('el manifest conté IDs interns o Pexels Photo IDs duplicats/invàlids.');
  }
  return items;
}

export class PexelsFallbackAcquirer {
  constructor({
    apiKey,
    outputDirectory = DEFAULT_FALLBACK_ORIGINALS_PATH,
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    retryAttempts = 3,
    delayMs = 400,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.apiKey = requireApiKey(apiKey);
    if (typeof fetchImpl !== 'function') throw failure('fetch no està disponible.');
    this.outputDirectory = outputDirectory;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retryAttempts = retryAttempts;
    this.delayMs = delayMs;
    this.sleep = sleep;
  }

  async request(url, { kind }) {
    for (let attempt = 0; attempt < this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(url, {
          headers: kind === 'metadata'
            ? { Authorization: this.apiKey, Accept: 'application/json' }
            : { Accept: 'image/*' },
          signal: controller.signal,
        });
      } catch (error) {
        if (attempt + 1 < this.retryAttempts) {
          await this.sleep(this.delayMs);
          continue;
        }
        throw failure(`error de xarxa o timeout durant ${kind === 'metadata' ? 'la consulta de metadata' : 'la descàrrega'} (${error.name || 'Error'}).`);
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 429 && attempt + 1 < this.retryAttempts) {
        await this.sleep(delayFrom(response, this.delayMs * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        if (response.status === 404) throw failure('Pexels no ha trobat una de les fotos seleccionades.');
        if (response.status === 401 || response.status === 403) throw failure('Pexels ha rebutjat l’autenticació.');
        if (response.status === 429) throw failure('Pexels ha aplicat el límit de peticions; torna-ho a provar més tard.');
        throw failure(`Pexels ha respost amb HTTP ${response.status}.`);
      }
      return response;
    }
    throw failure('no s’ha pogut completar la petició.');
  }

  async acquireOne(item) {
    await fs.mkdir(this.outputDirectory, { recursive: true });
    const existing = await validExistingOriginal(item, this.outputDirectory);
    if (existing) return { status: 'skipped', item, filename: existing };
    await Promise.all(existingExtension(item.id, this.outputDirectory).map((filename) => fs.rm(`${filename}.part`, { force: true })));

    const metadataResponse = await this.request(`${API_ORIGIN}/v1/photos/${item.pexels_photo_id}`, { kind: 'metadata' });
    const metadata = await metadataResponse.json().catch(() => { throw failure('la metadata de Pexels no és JSON vàlid.'); });
    if (!metadata || metadata.id !== item.pexels_photo_id || typeof metadata.photographer !== 'string' || typeof metadata.photographer_url !== 'string') {
      throw failure(`la resposta de metadata no correspon a la foto ${item.pexels_photo_id}.`);
    }
    assertPexelsPage(metadata.url, item.pexels_photo_id);
    const sourceUrl = assertImageUrl(metadata.src?.original, item.pexels_photo_id);
    const downloadResponse = await this.request(sourceUrl, { kind: 'image' });
    const declaredSize = Number.parseInt(downloadResponse.headers.get('content-length') || '', 10);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ORIGINAL_BYTES) throw failure('l’original supera el límit de mida local.');
    const data = Buffer.from(await downloadResponse.arrayBuffer());
    if (data.length > MAX_ORIGINAL_BYTES || (Number.isFinite(declaredSize) && data.length !== declaredSize)) {
      throw failure('la descàrrega és parcial o supera el límit de mida local.');
    }
    const extension = extensionFor(downloadResponse.headers.get('content-type'), data);
    const filename = path.join(this.outputDirectory, `${item.id}${extension}`);
    const temporary = `${filename}.part`;
    try {
      await fs.writeFile(temporary, data, { flag: 'wx' });
      await fs.rename(temporary, filename);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return {
      status: 'downloaded', item, filename,
      provenance: {
        id: metadata.id, page_url: metadata.url, photographer: metadata.photographer,
        photographer_url: metadata.photographer_url, source_url: sourceUrl,
      },
    };
  }

  async acquireAll(items) {
    validateFetchManifest(items);
    await fs.mkdir(this.outputDirectory, { recursive: true });
    const provenance = {};
    let downloaded = 0;
    let skipped = 0;
    for (const item of items) {
      const result = await this.acquireOne(item);
      if (result.status === 'downloaded') {
        downloaded += 1;
        provenance[item.id] = result.provenance;
      } else skipped += 1;
      if (this.delayMs > 0 && item !== items.at(-1)) await this.sleep(this.delayMs);
    }
    if (downloaded > 0) {
      const provenancePath = path.join(this.outputDirectory, 'pexels-api-provenance.json');
      let existing = {};
      try { existing = JSON.parse(await fs.readFile(provenancePath, 'utf8')); } catch { /* first acquisition */ }
      const temporary = `${provenancePath}.part`;
      await fs.writeFile(temporary, `${JSON.stringify({ schema_version: 1, photos: { ...existing.photos, ...provenance } }, null, 2)}\n`);
      await fs.rename(temporary, provenancePath);
    }
    return { total: items.length, downloaded, skipped, outputDirectory: this.outputDirectory };
  }
}
