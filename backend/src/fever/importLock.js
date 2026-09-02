import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TRANSIENT_DIRECTORY_ERROR_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function linuxProcessStartTicks(pid) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const closingParenthesis = stat.lastIndexOf(')');
    if (closingParenthesis < 0) return null;
    const fieldsAfterCommand = stat.slice(closingParenthesis + 1).trim().split(/\s+/);
    return fieldsAfterCommand[19] || null;
  } catch {
    return null;
  }
}

function startedRecently(owner, now, graceMs) {
  const startedAt = Date.parse(owner?.startedAt || '');
  return Number.isFinite(startedAt) && now - startedAt < graceMs;
}

export class FeverImportLock {
  constructor(databasePath, {
    malformedLockGraceMs = 5000,
    legacyOwnerGraceMs = 7200000,
    processExistsImpl = processExists,
    processIdentity = linuxProcessStartTicks,
    now = () => Date.now(),
    fileSystem = fs.promises,
    beforeOwnerRename = null,
    cleanupRetryAttempts = 4,
    cleanupRetryDelayMs = 20,
  } = {}) {
    this.directory = `${path.resolve(databasePath)}.fever-import.lock`;
    this.ownerFile = path.join(this.directory, 'owner.json');
    this.token = randomUUID();
    this.malformedLockGraceMs = malformedLockGraceMs;
    this.legacyOwnerGraceMs = legacyOwnerGraceMs;
    this.processExists = processExistsImpl;
    this.processIdentity = processIdentity;
    this.now = now;
    this.fileSystem = fileSystem;
    this.beforeOwnerRename = beforeOwnerRename;
    this.cleanupRetryAttempts = cleanupRetryAttempts;
    this.cleanupRetryDelayMs = cleanupRetryDelayMs;
  }

  async retryTransientDirectoryOperation(operation) {
    for (let attempt = 0; attempt < this.cleanupRetryAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!TRANSIENT_DIRECTORY_ERROR_CODES.has(error.code) || attempt === this.cleanupRetryAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.cleanupRetryDelayMs * (attempt + 1)));
      }
    }
  }

  ownerIsActive(owner) {
    const pid = Number(owner?.pid);
    if (!this.processExists(pid)) return false;
    if (owner?.processStart) {
      const currentStart = this.processIdentity(pid);
      return currentStart !== null && String(currentStart) === String(owner.processStart);
    }
    return startedRecently(owner, this.now(), this.legacyOwnerGraceMs);
  }

  async publishOwner() {
    const temporaryOwnerFile = path.join(this.directory, `owner.${this.token}.tmp`);
    const metadata = JSON.stringify({
      pid: process.pid,
      processStart: this.processIdentity(process.pid),
      token: this.token,
      startedAt: new Date(this.now()).toISOString(),
    });
    let handle;
    try {
      handle = await this.fileSystem.open(temporaryOwnerFile, 'wx', 0o600);
      await handle.writeFile(metadata, 'utf8');
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await this.beforeOwnerRename?.({ temporaryOwnerFile, ownerFile: this.ownerFile });
    await this.fileSystem.rename(temporaryOwnerFile, this.ownerFile);
  }

  async cleanupUnpublishedLock(temporaryOwnerFile) {
    try {
      await this.retryTransientDirectoryOperation(() => this.fileSystem.rm(temporaryOwnerFile, { force: true }));
      // rmdir only succeeds when this still is the empty directory we acquired.
      await this.retryTransientDirectoryOperation(() => this.fileSystem.rmdir(this.directory));
    } catch (error) {
      if (!['ENOENT', ...TRANSIENT_DIRECTORY_ERROR_CODES].includes(error.code)) throw error;
    }
  }

  async acquire() {
    await this.fileSystem.mkdir(path.dirname(this.directory), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.fileSystem.mkdir(this.directory);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try {
          owner = JSON.parse(await this.fileSystem.readFile(this.ownerFile, 'utf8'));
        } catch {
          owner = null;
        }
        if (owner && this.ownerIsActive(owner)) return false;
        if (!owner) {
          let mtimeMs;
          try { ({ mtimeMs } = await this.fileSystem.stat(this.directory)); }
          catch (statError) {
            if (statError.code === 'ENOENT') continue;
            throw statError;
          }
          if (this.now() - mtimeMs < this.malformedLockGraceMs) return false;
        }
        const staleDirectory = `${this.directory}.stale-${randomUUID()}`;
        try {
          await this.fileSystem.rename(this.directory, staleDirectory);
          await this.retryTransientDirectoryOperation(() => this.fileSystem.rm(staleDirectory, {
            recursive: true, force: true, maxRetries: this.cleanupRetryAttempts - 1, retryDelay: this.cleanupRetryDelayMs,
          }));
        } catch (renameError) {
          if (renameError.code !== 'ENOENT') throw renameError;
        }
        continue;
      }

      const temporaryOwnerFile = path.join(this.directory, `owner.${this.token}.tmp`);
      try {
        await this.publishOwner();
        return true;
      } catch {
        await this.cleanupUnpublishedLock(temporaryOwnerFile);
        return false;
      }
    }
    return false;
  }

  async release() {
    try {
      const owner = JSON.parse(await this.fileSystem.readFile(this.ownerFile, 'utf8'));
      if (owner.token === this.token) {
        await this.retryTransientDirectoryOperation(() => this.fileSystem.rm(this.directory, {
          recursive: true, force: true, maxRetries: this.cleanupRetryAttempts - 1, retryDelay: this.cleanupRetryDelayMs,
        }));
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
}
