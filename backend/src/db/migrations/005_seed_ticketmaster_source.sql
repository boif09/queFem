INSERT INTO sources (
  key, name, publisher, dataset_name, dataset_id, dataset_url,
  license_name, license_url, attribution_text,
  requires_attribution, requires_update_date, allows_data_reuse,
  allows_transformation, allows_commercial_use, allows_images,
  review_notes, reviewed_at, enabled
) VALUES (
  'ticketmaster-discovery-feed',
  'Ticketmaster Discovery Feed España',
  'Ticketmaster',
  'Discovery Feed 2.0 - Events Feed Spain',
  'discovery-feed-v2-es',
  'https://developer.ticketmaster.com/products-and-docs/apis/discovery-feed/',
  'Ticketmaster API / Discovery Feed Terms of Use',
  'https://developer.ticketmaster.com/support/terms-of-use/',
  'Ticketmaster',
  1, 0, 1, 0, 0, 0,
  'NO es Open Data ni una licencia de redistribución. allows_data_reuse=1 habilita exclusivamente el uso local dentro de Què Fem? bajo los términos de la API; no concede derechos abiertos. allows_transformation=0 documenta que no existe una licencia abierta de transformación y actualmente no bloquea la normalización técnica. Desarrollo habilitado; producción bloqueada hasta revisión legal final. Imágenes excluidas.',
  '2026-08-18',
  1
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
  requires_attribution = excluded.requires_attribution,
  requires_update_date = excluded.requires_update_date,
  allows_data_reuse = excluded.allows_data_reuse,
  allows_transformation = excluded.allows_transformation,
  allows_commercial_use = excluded.allows_commercial_use,
  allows_images = excluded.allows_images,
  review_notes = excluded.review_notes,
  reviewed_at = excluded.reviewed_at;
