import { FeverImportLock } from '../fever/importLock.js';

export class GencatImportLock extends FeverImportLock {
  constructor(databasePath, options = {}) {
    const { lockName: _ignored, ...lockOptions } = options;
    super(databasePath, { ...lockOptions, lockName: 'gencat-import' });
  }
}
