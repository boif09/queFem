import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { assertC2RehearsalPath } from '../backend/src/diba/dibaPolicyExecutor.js';
import { sha256File } from '../backend/src/diba/dibaPolicyExecutor.js';
import { F2_BASELINE_SHA, __testOnlyRunF2AuthorizationFlow, canonicalF2PrimaryLocalPath, preflightF2PrimaryLocal } from '../backend/src/diba/dibaFinalF2PrimaryLocal.js';

function fixture() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-f2-boundary-')); const databasePath = path.join(directory, 'primary.sqlite'); const db = openDatabase(databasePath); migrate(db); db.close(); return { directory, databasePath }; }
function sha(file) { return sha256File(file); }

test('F2 fixes the canonical primary destination and the consumed POST-F2 database cannot reuse the literal baseline', () => {
  const config = loadConfig(); const primary = canonicalF2PrimaryLocalPath(config);
  assert.match(primary.replace(/\\/g, '/'), /data\/quefem\.sqlite$/);
  assert.equal(F2_BASELINE_SHA, 'F2B9A4AD4C70C57C6B269644CCDFBEDAEA02A339D9574F5CD6D7CFFE38FA78B8');
  assert.throws(() => preflightF2PrimaryLocal({ config: { ...config, databasePath: primary } }), /baseline authorization rejects/);
  assert.throws(() => assertC2RehearsalPath(primary, primary), /refuses/);
});

test('F2 primary preflight rejects a distinct configured SQLite path before SHA authorization', () => {
  const config = loadConfig(); const canonical = canonicalF2PrimaryLocalPath(config);
  const distinctPath = path.join(os.tmpdir(), 'quefem-f2-canonical-path-negative.sqlite');
  assert.notEqual(path.resolve(distinctPath), path.resolve(canonical));
  assert.throws(() => preflightF2PrimaryLocal({ config: { ...config, databasePath: distinctPath } }), /cannot redirect the canonical primary database path/);
});

test('F2 final boundary is synchronous and immediately precedes the private writable transaction call', () => {
  const source = fs.readFileSync('backend/src/diba/dibaFinalReviewPolicy.js', 'utf8');
  const start = source.indexOf('f2Primary.assertF2WritableBoundary'); const end = source.indexOf('const apply = await executeFinalReviewTransaction', start);
  assert.ok(start >= 0 && end > start); assert.doesNotMatch(source.slice(start, end), /await\s/);
  assert.match(source.slice(start, end + 80), /prepared \}\);\n  const apply = await executeFinalReviewTransaction/);
});

test('F2 test harness detects deterministic post-prepare SHA drift before writable open or transaction', async () => {
  const item = fixture(); let prepared = false; let opened = 0; let transactions = 0;
  try {
    await assert.rejects(__testOnlyRunF2AuthorizationFlow({ databasePath: item.databasePath, baselineSha: sha(item.databasePath), backup: async () => {}, prepare: async () => { prepared = true; return { scope: 'prepared' }; }, afterPrepare: () => fs.appendFileSync(item.databasePath, Buffer.from([0])), openWritable: () => { opened += 1; transactions += 1; } }), /post-prepare SHA drift/);
    assert.equal(prepared, true); assert.equal(opened, 0); assert.equal(transactions, 0);
  } finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test('F2 test harness backup failure and NODE_ENV variants fail closed before writable open', async () => {
  const item = fixture(); let opened = 0; const original = process.env.NODE_ENV;
  try {
    await assert.rejects(__testOnlyRunF2AuthorizationFlow({ databasePath: item.databasePath, baselineSha: sha(item.databasePath), backup: async () => { throw new Error('backup failure'); }, prepare: async () => ({}), openWritable: () => { opened += 1; } }), /backup failure/);
    for (const value of ['test', 'development']) { process.env.NODE_ENV = value; await assert.rejects(__testOnlyRunF2AuthorizationFlow({ databasePath: item.databasePath, baselineSha: '0'.repeat(64), backup: async () => {}, prepare: async () => ({}), openWritable: () => { opened += 1; } }), /initial baseline mismatch/); }
    assert.equal(opened, 0);
  } finally { process.env.NODE_ENV = original; fs.rmSync(item.directory, { recursive: true, force: true }); }
});
