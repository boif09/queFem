-- Three operational feeds are deliberately separate: each one has an independent
-- snapshot, import run and reconciliation boundary.  They share the same public
-- publisher/attribution and remain disabled until the production activation gate.
INSERT INTO sources (
  key, name, publisher, dataset_name, dataset_id, dataset_url,
  license_name, license_url, attribution_text,
  requires_attribution, requires_update_date, allows_data_reuse,
  allows_transformation, allows_commercial_use, allows_images,
  review_notes, reviewed_at, enabled
) VALUES
  ('diba-tourisme', 'Diputació de Barcelona', 'Diputació de Barcelona',
   'Turisme: agenda d''activitats', 'actesturisme_ca', 'https://do.diba.cat/datasets/actesturisme_ca',
   'Creative Commons Attribution 4.0 International', 'https://creativecommons.org/licenses/by/4.0/deed.ca',
   'Diputació de Barcelona — Dades obertes', 1, 1, 1, 1, 1, 0,
   'M1 DIBA. Dades textuals amb atribució; les imatges del dataset no estan aprovades per a publicació. Font desactivada fins a revisió i activació explícita.', '2026-08-31', 0),
  ('diba-escenari', 'Diputació de Barcelona', 'Diputació de Barcelona',
   'Teatres i auditoris: agenda d''activitats', 'escenari', 'https://do.diba.cat/datasets/escenari',
   'Creative Commons Attribution 4.0 International', 'https://creativecommons.org/licenses/by/4.0/deed.ca',
   'Diputació de Barcelona — Dades obertes', 1, 1, 1, 1, 1, 0,
   'M1 DIBA. Dades textuals amb atribució; les imatges del dataset no estan aprovades per a publicació. Font desactivada fins a revisió i activació explícita.', '2026-08-31', 0),
  ('diba-museus', 'Diputació de Barcelona', 'Diputació de Barcelona',
   'Museus: agenda d''activitats', 'actesmuseus', 'https://do.diba.cat/datasets/actesmuseus',
   'Creative Commons Attribution 4.0 International', 'https://creativecommons.org/licenses/by/4.0/deed.ca',
   'Diputació de Barcelona — Dades obertes', 1, 1, 1, 1, 1, 0,
   'M1 DIBA. Dades textuals amb atribució; les imatges del dataset no estan aprovades per a publicació. Font desactivada fins a revisió i activació explícita.', '2026-08-31', 0)
ON CONFLICT(key) DO UPDATE SET
  name=excluded.name, publisher=excluded.publisher, dataset_name=excluded.dataset_name,
  dataset_id=excluded.dataset_id, dataset_url=excluded.dataset_url, license_name=excluded.license_name,
  license_url=excluded.license_url, attribution_text=excluded.attribution_text,
  requires_attribution=excluded.requires_attribution, requires_update_date=excluded.requires_update_date,
  allows_data_reuse=excluded.allows_data_reuse, allows_transformation=excluded.allows_transformation,
  allows_commercial_use=excluded.allows_commercial_use, allows_images=excluded.allows_images,
  review_notes=excluded.review_notes, reviewed_at=excluded.reviewed_at, enabled=0;
