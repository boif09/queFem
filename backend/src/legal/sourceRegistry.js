import { validateSourceForImport } from './licenseValidator.js';

export class SourceRegistry {
  constructor(db) {
    this.db = db;
    this.findByKeyStatement = db.prepare('SELECT * FROM sources WHERE key = ?');
    this.findByIdStatement = db.prepare('SELECT * FROM sources WHERE id = ?');
  }

  find(identifier) {
    return typeof identifier === 'number'
      ? this.findByIdStatement.get(identifier)
      : this.findByKeyStatement.get(identifier);
  }

  requireApproved(identifier) {
    return validateSourceForImport(this.find(identifier));
  }
}
