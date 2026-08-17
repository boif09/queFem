export class PlanDeduplicator {
  constructor(db) {
    this.findStatement = db.prepare('SELECT * FROM plans WHERE fingerprint = ?');
  }

  findByFingerprint(fingerprint) {
    return this.findStatement.get(fingerprint);
  }
}
