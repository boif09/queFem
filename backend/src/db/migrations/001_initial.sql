CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    publisher TEXT,
    dataset_name TEXT,
    dataset_id TEXT,
    dataset_url TEXT,
    license_name TEXT,
    license_url TEXT,
    attribution_text TEXT,
    requires_attribution INTEGER NOT NULL DEFAULT 1 CHECK (requires_attribution IN (0, 1)),
    requires_update_date INTEGER NOT NULL DEFAULT 0 CHECK (requires_update_date IN (0, 1)),
    allows_data_reuse INTEGER NOT NULL DEFAULT 0 CHECK (allows_data_reuse IN (0, 1)),
    allows_transformation INTEGER NOT NULL DEFAULT 0 CHECK (allows_transformation IN (0, 1)),
    allows_commercial_use INTEGER NOT NULL DEFAULT 0 CHECK (allows_commercial_use IN (0, 1)),
    allows_images INTEGER NOT NULL DEFAULT 0 CHECK (allows_images IN (0, 1)),
    review_notes TEXT,
    reviewed_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('event', 'place', 'route', 'beach', 'nature', 'activity')),
    fingerprint TEXT UNIQUE NOT NULL,
    original_language TEXT,
    original_title TEXT,
    original_description TEXT,
    title_ca TEXT,
    title_es TEXT,
    subtitle_ca TEXT,
    subtitle_es TEXT,
    description_ca TEXT,
    description_es TEXT,
    start_date TEXT,
    end_date TEXT,
    schedule_text TEXT,
    permanent INTEGER NOT NULL DEFAULT 0 CHECK (permanent IN (0, 1)),
    price_text TEXT,
    is_free INTEGER CHECK (is_free IS NULL OR is_free IN (0, 1)),
    province TEXT,
    comarca TEXT,
    municipality TEXT,
    locality TEXT,
    address TEXT,
    postal_code TEXT,
    venue_name TEXT,
    latitude REAL,
    longitude REAL,
    website_url TEXT,
    ticket_url TEXT,
    image_url TEXT,
    image_reuse_allowed INTEGER NOT NULL DEFAULT 0 CHECK (image_reuse_allowed IN (0, 1)),
    family_friendly INTEGER CHECK (family_friendly IS NULL OR family_friendly IN (0, 1)),
    indoor INTEGER CHECK (indoor IS NULL OR indoor IN (0, 1)),
    outdoor INTEGER CHECK (outdoor IS NULL OR outdoor IN (0, 1)),
    recommended_months TEXT,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 100),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    source_record_id TEXT NOT NULL,
    source_url TEXT,
    source_created_at TEXT,
    source_updated_at TEXT,
    source_payload_json TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    FOREIGN KEY(plan_id) REFERENCES plans(id),
    FOREIGN KEY(source_id) REFERENCES sources(id),
    UNIQUE(source_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name_ca TEXT NOT NULL,
    name_es TEXT NOT NULL,
    group_name TEXT,
    icon TEXT
);

CREATE TABLE IF NOT EXISTS plan_categories (
    plan_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    PRIMARY KEY(plan_id, category_id),
    FOREIGN KEY(plan_id) REFERENCES plans(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,
    fetched INTEGER NOT NULL DEFAULT 0,
    inserted INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    FOREIGN KEY(source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_plans_start_date ON plans(start_date);
CREATE INDEX IF NOT EXISTS idx_plans_end_date ON plans(end_date);
CREATE INDEX IF NOT EXISTS idx_plans_permanent ON plans(permanent);
CREATE INDEX IF NOT EXISTS idx_plans_province ON plans(province);
CREATE INDEX IF NOT EXISTS idx_plans_comarca ON plans(comarca);
CREATE INDEX IF NOT EXISTS idx_plans_municipality ON plans(municipality);
CREATE INDEX IF NOT EXISTS idx_plans_kind ON plans(kind);
CREATE INDEX IF NOT EXISTS idx_plans_quality_score ON plans(quality_score);
CREATE INDEX IF NOT EXISTS idx_plans_coordinates ON plans(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_plan_sources_record ON plan_sources(source_record_id);
CREATE INDEX IF NOT EXISTS idx_plan_sources_plan ON plan_sources(plan_id);
CREATE INDEX IF NOT EXISTS idx_import_runs_source_started ON import_runs(source_id, started_at);
