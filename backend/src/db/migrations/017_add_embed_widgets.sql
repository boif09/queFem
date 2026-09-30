-- Embeddable agenda widget (B2B). See docs/EMBED_WIDGET.md.
--
-- allows_syndication is a separate grant from allows_commercial_use: it authorises showing a
-- source's plans inside third-party websites. Only Gencat and DIBA are approved; Fever and
-- Ticketmaster stay excluded even where they are enabled for tenspla.cat itself.
ALTER TABLE sources ADD COLUMN allows_syndication INTEGER NOT NULL DEFAULT 0
  CHECK (allows_syndication IN (0, 1));

UPDATE sources SET allows_syndication = 1
WHERE key IN ('gencat-agenda', 'diba-tourisme', 'diba-escenari', 'diba-museus');

CREATE TABLE IF NOT EXISTS embed_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL UNIQUE CHECK (public_key GLOB 'wgt_*' AND length(public_key) BETWEEN 20 AND 44),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    client_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    allowed_origins_json TEXT NOT NULL CHECK (json_valid(allowed_origins_json)),
    config_json TEXT NOT NULL CHECK (json_valid(config_json)),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Aggregated per widget, civil day (Europe/Madrid) and embedding origin. No per-visitor data.
CREATE TABLE IF NOT EXISTS embed_widget_usage_daily (
    widget_id INTEGER NOT NULL,
    usage_date TEXT NOT NULL,
    origin TEXT NOT NULL,
    impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected >= 0),
    PRIMARY KEY (widget_id, usage_date, origin),
    FOREIGN KEY (widget_id) REFERENCES embed_widgets(id) ON DELETE CASCADE
);
