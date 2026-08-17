ALTER TABLE import_runs ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN invalid_details TEXT;
