import { FeverImportLock } from '../fever/importLock.js';

export class DibaImportLock extends FeverImportLock {
  constructor(databasePath, options = {}) {
    const { lockName: _ignored, ...lockOptions } = options;
    super(databasePath, { ...lockOptions, lockName: 'diba-import' });
  }
}
