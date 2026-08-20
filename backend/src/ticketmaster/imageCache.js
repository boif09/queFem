import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function sourceHash(url) {
  return createHash('sha256').update(url).digest('hex');
}

export class TicketmasterImageCache {
  constructor({ directory, ttlHours = 6, maximumMb = 512, now = () => new Date() }) {
    if (!path.isAbsolute(directory)) throw new TypeError('El directori de cache ha de ser absolut.');
    this.directory = path.resolve(directory);
    this.ttlMs = ttlHours * 60 * 60 * 1000;
    this.maximumBytes = maximumMb * 1024 * 1024;
    this.now = now;
  }

  paths(imageId) {
    const id = Number(imageId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('Identificador de cache invàlid.');
    const binary = path.resolve(this.directory, `${id}.bin`);
    const metadata = path.resolve(this.directory, `${id}.json`);
    const prefix = `${this.directory}${path.sep}`;
    if (!binary.startsWith(prefix) || !metadata.startsWith(prefix)) throw new Error('Ruta de cache fora del directori permès.');
    return { binary, metadata };
  }

  async read(image) {
    const files = this.paths(image.id);
    try {
      const metadata = JSON.parse(await fs.promises.readFile(files.metadata, 'utf8'));
      if (metadata.sourceHash !== sourceHash(image.url)) return null;
      const fetchedAt = Date.parse(metadata.fetchedAt);
      if (!Number.isFinite(fetchedAt) || this.now().getTime() - fetchedAt >= this.ttlMs) return null;
      const data = await fs.promises.readFile(files.binary);
      if (data.length !== metadata.size || typeof metadata.contentType !== 'string') return null;
      return { data, contentType: metadata.contentType, cacheStatus: 'HIT' };
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async write(image, { data, contentType }) {
    const files = this.paths(image.id);
    await fs.promises.mkdir(this.directory, { recursive: true });
    const suffix = randomUUID();
    const temporaryBinary = path.join(this.directory, `${image.id}.${suffix}.tmp`);
    const temporaryMetadata = path.join(this.directory, `${image.id}.${suffix}.json.tmp`);
    const metadata = {
      contentType,
      fetchedAt: this.now().toISOString(),
      size: data.length,
      sourceHash: sourceHash(image.url),
    };
    try {
      await fs.promises.writeFile(temporaryBinary, data, { flag: 'wx' });
      await fs.promises.writeFile(temporaryMetadata, JSON.stringify(metadata), { flag: 'wx' });
      await fs.promises.rm(files.binary, { force: true });
      await fs.promises.rm(files.metadata, { force: true });
      await fs.promises.rename(temporaryBinary, files.binary);
      await fs.promises.rename(temporaryMetadata, files.metadata);
    } finally {
      await fs.promises.rm(temporaryBinary, { force: true });
      await fs.promises.rm(temporaryMetadata, { force: true });
    }
    return { data, contentType, cacheStatus: 'MISS' };
  }

  async invalidate(imageIds) {
    let deleted = 0;
    for (const imageId of new Set(imageIds.map(Number).filter(Number.isSafeInteger))) {
      const files = this.paths(imageId);
      for (const filename of [files.binary, files.metadata]) {
        try {
          await fs.promises.unlink(filename);
          deleted += 1;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
    return deleted;
  }

  invalidateSync(imageIds) {
    let deleted = 0;
    for (const imageId of new Set(imageIds.map(Number).filter(Number.isSafeInteger))) {
      const files = this.paths(imageId);
      for (const filename of [files.binary, files.metadata]) {
        try {
          fs.unlinkSync(filename);
          deleted += 1;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }
    return deleted;
  }

  async cleanup(validImageIds) {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const valid = new Set(validImageIds.map(Number));
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true });
    const ids = new Set(entries.filter((entry) => entry.isFile())
      .map((entry) => /^(\d+)\.(?:bin|json)$/.exec(entry.name))
      .filter(Boolean).map((match) => Number(match[1])));
    let orphaned = 0;
    let expired = 0;
    for (const id of ids) {
      const files = this.paths(id);
      let remove = !valid.has(id);
      if (!remove) {
        try {
          const metadata = JSON.parse(await fs.promises.readFile(files.metadata, 'utf8'));
          const fetchedAt = Date.parse(metadata.fetchedAt);
          remove = !Number.isFinite(fetchedAt) || this.now().getTime() - fetchedAt >= this.ttlMs;
        } catch {
          remove = true;
        }
      }
      if (remove) {
        const wasOrphan = !valid.has(id);
        await this.invalidate([id]);
        if (wasOrphan) orphaned += 1;
        else expired += 1;
      }
    }
    let evicted = 0;
    let bytes = 0;
    const candidates = [];
    const remainingEntries = await fs.promises.readdir(this.directory, { withFileTypes: true });
    for (const entry of remainingEntries) {
      const match = /^(\d+)\.bin$/.exec(entry.isFile() ? entry.name : '');
      if (!match) continue;
      const id = Number(match[1]);
      const files = this.paths(id);
      try {
        const [binaryStat, metadata] = await Promise.all([
          fs.promises.stat(files.binary),
          fs.promises.readFile(files.metadata, 'utf8').then(JSON.parse),
        ]);
        bytes += binaryStat.size;
        candidates.push({ id, size: binaryStat.size, fetchedAt: Date.parse(metadata.fetchedAt) || 0 });
      } catch {
        await this.invalidate([id]);
        expired += 1;
      }
    }
    candidates.sort((left, right) => left.fetchedAt - right.fetchedAt || left.id - right.id);
    for (const candidate of candidates) {
      if (bytes <= this.maximumBytes) break;
      await this.invalidate([candidate.id]);
      bytes -= candidate.size;
      evicted += 1;
    }
    return { orphaned, expired, evicted, bytes };
  }
}
