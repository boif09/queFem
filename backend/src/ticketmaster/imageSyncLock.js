import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export class TicketmasterImageSyncLock {
  constructor(cacheDirectory) {
    this.directory = path.join(path.resolve(cacheDirectory), '.metadata-sync.lock');
    this.ownerFile = path.join(this.directory, 'owner.json');
    this.token = randomUUID();
  }

  async acquire() {
    await fs.promises.mkdir(path.dirname(this.directory), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.promises.mkdir(this.directory);
        await fs.promises.writeFile(this.ownerFile, JSON.stringify({
          pid: process.pid, token: this.token, startedAt: new Date().toISOString(),
        }), { flag: 'wx' });
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try {
          owner = JSON.parse(await fs.promises.readFile(this.ownerFile, 'utf8'));
        } catch {
          owner = null;
        }
        if (!owner || processExists(Number(owner.pid))) return false;
        const staleDirectory = `${this.directory}.stale-${randomUUID()}`;
        try {
          await fs.promises.rename(this.directory, staleDirectory);
          await fs.promises.rm(staleDirectory, { recursive: true, force: true });
        } catch (renameError) {
          if (renameError.code !== 'ENOENT') throw renameError;
        }
      }
    }
    return false;
  }

  async release() {
    try {
      const owner = JSON.parse(await fs.promises.readFile(this.ownerFile, 'utf8'));
      if (owner.token === this.token) await fs.promises.rm(this.directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
}
