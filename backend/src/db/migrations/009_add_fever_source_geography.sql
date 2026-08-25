CREATE TABLE plan_source_geography (
    plan_source_id INTEGER PRIMARY KEY,
    resolution_status TEXT NOT NULL CHECK (resolution_status IN ('resolved', 'unresolved', 'ambiguous')),
    latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    municipality_code TEXT,
    municipality_name TEXT,
    comarca_code TEXT,
    comarca_name TEXT,
    province_code TEXT,
    province_name TEXT,
    provider TEXT NOT NULL,
    dataset TEXT NOT NULL,
    dataset_date TEXT NOT NULL,
    layer TEXT NOT NULL,
    snapshot_checksum TEXT NOT NULL,
    location_basis TEXT NOT NULL CHECK (location_basis IN ('event_coordinates')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(plan_source_id) REFERENCES plan_sources(id) ON DELETE CASCADE,
    CHECK (
      (resolution_status = 'resolved'
       AND municipality_code IS NOT NULL AND trim(municipality_code) <> ''
       AND municipality_name IS NOT NULL AND trim(municipality_name) <> ''
       AND comarca_code IS NOT NULL AND trim(comarca_code) <> ''
       AND comarca_name IS NOT NULL AND trim(comarca_name) <> ''
       AND province_code IS NOT NULL AND trim(province_code) <> ''
       AND province_name IS NOT NULL AND trim(province_name) <> '')
      OR
      (resolution_status <> 'resolved'
       AND municipality_code IS NULL AND municipality_name IS NULL
       AND comarca_code IS NULL AND comarca_name IS NULL
       AND province_code IS NULL AND province_name IS NULL)
    )
);

ALTER TABLE import_runs ADD COLUMN summary_json TEXT;

INSERT INTO sources (
  key, name, publisher, dataset_name, dataset_id, dataset_url,
  license_name, license_url, attribution_text,
  requires_attribution, requires_update_date, allows_data_reuse,
  allows_transformation, allows_commercial_use, allows_images,
  review_notes, reviewed_at, enabled
) VALUES (
  'fever', 'Fever', 'Fever Labs, Inc.', 'Fever Impact product catalog',
  'impact-catalog-15532', 'https://api.impact.com/',
  'Impact/Fever partner terms', 'https://impact.com/terms-of-use/', 'Fever',
  1, 0, 1, 1, 1, 0,
  'Development-only M4B integration through the Impact partner catalog. Production publication, image reuse and frontend exposure remain blocked pending final review.',
  '2026-08-25', 0
)
ON CONFLICT(key) DO UPDATE SET
  name = excluded.name,
  publisher = excluded.publisher,
  dataset_name = excluded.dataset_name,
  dataset_id = excluded.dataset_id,
  dataset_url = excluded.dataset_url,
  license_name = excluded.license_name,
  license_url = excluded.license_url,
  attribution_text = excluded.attribution_text,
  review_notes = excluded.review_notes,
  reviewed_at = excluded.reviewed_at,
  enabled = 0;
