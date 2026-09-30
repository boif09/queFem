function mapWidget(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicKey: row.public_key,
    name: row.name,
    clientName: row.client_name,
    status: row.status,
    allowedOrigins: JSON.parse(row.allowed_origins_json),
    config: JSON.parse(row.config_json),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EmbedWidgetRepository {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  findByKey(publicKey) {
    return mapWidget(this.db.prepare('SELECT * FROM embed_widgets WHERE public_key = ?').get(publicKey));
  }

  findAll() {
    return this.db.prepare('SELECT * FROM embed_widgets ORDER BY id').all().map(mapWidget);
  }

  create({ publicKey, name, clientName = null, allowedOrigins, config, notes = null }) {
    const timestamp = this.now().toISOString();
    this.db.prepare(`INSERT INTO embed_widgets
      (public_key, name, client_name, status, allowed_origins_json, config_json, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(
      publicKey, name, clientName, JSON.stringify(allowedOrigins), JSON.stringify(config), notes, timestamp, timestamp,
    );
    return this.findByKey(publicKey);
  }

  update(publicKey, changes) {
    const columns = {
      name: 'name', clientName: 'client_name', status: 'status', notes: 'notes', publicKey: 'public_key',
      allowedOrigins: 'allowed_origins_json', config: 'config_json',
    };
    const assignments = [];
    const values = [];
    for (const [field, column] of Object.entries(columns)) {
      if (changes[field] === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(['allowedOrigins', 'config'].includes(field) ? JSON.stringify(changes[field]) : changes[field]);
    }
    if (!assignments.length) return this.findByKey(publicKey);
    assignments.push('updated_at = ?');
    values.push(this.now().toISOString());
    const result = this.db.prepare(`UPDATE embed_widgets SET ${assignments.join(', ')} WHERE public_key = ?`)
      .run(...values, publicKey);
    if (result.changes === 0) return null;
    return this.findByKey(changes.publicKey || publicKey);
  }

  // counters: [{ widgetId, usageDate, origin, impressions, rejected }]
  addUsage(counters) {
    if (!counters.length) return;
    const upsert = this.db.prepare(`INSERT INTO embed_widget_usage_daily
      (widget_id, usage_date, origin, impressions, rejected) VALUES (@widgetId, @usageDate, @origin, @impressions, @rejected)
      ON CONFLICT(widget_id, usage_date, origin) DO UPDATE SET
        impressions = impressions + excluded.impressions,
        rejected = rejected + excluded.rejected`);
    this.db.transaction((rows) => { for (const row of rows) upsert.run(row); })(counters);
  }

  usageSince(widgetId, sinceDate) {
    return this.db.prepare(`SELECT usage_date AS usageDate, origin, impressions, rejected
      FROM embed_widget_usage_daily WHERE widget_id = ? AND usage_date >= ?
      ORDER BY usage_date, origin`).all(widgetId, sinceDate);
  }

  categorySlugs() {
    return new Set(this.db.prepare('SELECT slug FROM categories').pluck().all());
  }
}
