ALTER TABLE plans ADD COLUMN inactive_at TEXT;

CREATE INDEX IF NOT EXISTS idx_plans_inactive_retention
ON plans(status, inactive_at);
