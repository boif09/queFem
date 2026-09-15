import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GencatImportLock } from '../backend/src/gencat/importLock.js';
import { importGencat } from '../backend/src/jobs/importGencat.js';

test('Gencat import lock prevents a concurrent cron or manual invocation cleanly', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-gencat-lock-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const active = new GencatImportLock(databasePath);
  try {
    assert.equal(await active.acquire(), true);
    const messages = [];
    const result = await importGencat(
      { gencatSyncEnabled: true, databasePath },
      { logger: { log: (message) => messages.push(message) } },
    );
    assert.deepEqual(result, {
      event: 'gencat-import', status: 'skipped', reason: 'concurrent-import',
    });
    assert.deepEqual(messages.map(JSON.parse), [result]);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    await active.release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Gencat lock is released for the next invocation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-gencat-lock-release-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const first = new GencatImportLock(databasePath);
  const second = new GencatImportLock(databasePath);
  try {
    assert.equal(await first.acquire(), true);
    assert.equal(await second.acquire(), false);
    await first.release();
    assert.equal(await second.acquire(), true);
  } finally {
    await first.release();
    await second.release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
