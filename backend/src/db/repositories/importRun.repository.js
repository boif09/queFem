export class ImportRunRepository {
  constructor(db) {
    this.createStatement = db.prepare(`
      INSERT INTO import_runs (source_id, started_at, status)
      VALUES (?, ?, 'running')
    `);
    this.finishStatement = db.prepare(`
      UPDATE import_runs
      SET finished_at = @finished_at,
          status = @status,
          fetched = @fetched,
          inserted = @inserted,
          updated = @updated,
          skipped = @skipped,
          invalid = @invalid,
          invalid_details = @invalid_details,
          errors = @errors,
          error_message = @error_message
      WHERE id = @id
    `);
  }

  start(sourceId) {
    return Number(this.createStatement.run(sourceId, new Date().toISOString()).lastInsertRowid);
  }

  finish(id, summary, status, errorMessage = null, invalidDetails = []) {
    this.finishStatement.run({
      id,
      finished_at: new Date().toISOString(),
      status,
      ...summary,
      invalid_details: invalidDetails.length > 0 ? JSON.stringify(invalidDetails) : null,
      error_message: errorMessage,
    });
  }
}
