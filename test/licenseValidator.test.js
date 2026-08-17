import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceNotApprovedError } from '../backend/src/legal/licenseValidator.js';
import { SourceRegistry } from '../backend/src/legal/sourceRegistry.js';
import { withTestDatabase } from './helpers.js';

test('blocks a disabled source before an importer can run', () => {
  withTestDatabase((db) => {
    db.prepare("UPDATE sources SET enabled = 0 WHERE key = 'gencat-agenda'").run();
    const registry = new SourceRegistry(db);
    assert.throws(() => registry.requireApproved('gencat-agenda'), SourceNotApprovedError);
  });
});
