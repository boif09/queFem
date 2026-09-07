import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main as previewMain } from '../scripts/dibaProductionPreview.js';
import * as policyExecutor from '../backend/src/diba/dibaPolicyExecutor.js';
import * as finalReviewPolicy from '../backend/src/diba/dibaFinalReviewPolicy.js';

test('production preview script reports only through stdout/return and creates no report or database effects', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-diba-preview-script-'));
  const primary = path.join(directory, 'quefem.sqlite'); const original = Buffer.from('hermetic-primary'); fs.writeFileSync(primary, original);
  const reportPaths = [path.resolve('data/reports/diba-production-preview.json'), path.resolve('data/reports/diba-production-preview.md')];
  const before = reportPaths.map((filePath) => fs.existsSync(filePath) ? { filePath, stat: fs.statSync(filePath), bytes: fs.readFileSync(filePath) } : { filePath });
  const messages = []; const originalLog = console.log;
  try {
    console.log = (message) => messages.push(message);
    const expected = { authorization: 'TEST-AUTHORIZATION', productionDatabaseMutation: false };
    const result = await previewMain({ projectRoot: directory, databasePath: primary }, async () => expected);
    assert.equal(result, expected); assert.deepEqual(JSON.parse(messages.join('\n')), expected);
    assert.deepEqual(fs.readFileSync(primary), original);
    for (const item of before) {
      assert.equal(fs.existsSync(item.filePath), Boolean(item.stat));
      if (item.stat) { assert.equal(fs.statSync(item.filePath).mtimeMs, item.stat.mtimeMs); assert.deepEqual(fs.readFileSync(item.filePath), item.bytes); }
    }
  } finally { console.log = originalLog; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('only the authorized production apply remains a supported DIBA primary mutation entrypoint', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['diba:prod:reconcile:apply'], 'node scripts/dibaProductionApply.js');
  assert.deepEqual(Object.keys(packageJson.scripts).filter((name) => name.includes(':primary-local')), []);
  assert.deepEqual(Object.keys(policyExecutor).filter((name) => name.includes('PrimaryLocal')), []);
  assert.deepEqual(Object.keys(finalReviewPolicy).filter((name) => name.includes('PrimaryLocal')), []);
});
