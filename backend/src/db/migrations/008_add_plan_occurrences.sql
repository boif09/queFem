CREATE TABLE plan_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_source_id INTEGER NOT NULL,
    occurrence_key TEXT NOT NULL CHECK (trim(occurrence_key) <> ''),
    starts_at TEXT CHECK (starts_at IS NULL OR trim(starts_at) <> ''),
    ends_at TEXT,
    local_date TEXT NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    local_time TEXT,
    timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(plan_source_id) REFERENCES plan_sources(id) ON DELETE CASCADE,
    UNIQUE(plan_source_id, occurrence_key)
);

CREATE INDEX idx_plan_occurrences_source_date
ON plan_occurrences(plan_source_id, local_date);

CREATE INDEX idx_plan_occurrences_date_source
ON plan_occurrences(local_date, plan_source_id);
