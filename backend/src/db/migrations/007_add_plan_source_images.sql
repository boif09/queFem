CREATE TABLE IF NOT EXISTS plan_source_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_source_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('card', 'detail')),
    url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    ratio TEXT NOT NULL,
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    is_fallback INTEGER NOT NULL CHECK (is_fallback IN (0, 1)),
    attribution TEXT,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(plan_source_id) REFERENCES plan_sources(id) ON DELETE CASCADE,
    UNIQUE(plan_source_id, role)
);

CREATE INDEX IF NOT EXISTS idx_plan_source_images_source_role
ON plan_source_images(plan_source_id, role);
