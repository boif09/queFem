INSERT INTO categories (slug, name_ca, name_es, group_name, icon) VALUES
  ('festes', 'Festes', 'Fiestas', 'cultura', 'party-popper'),
  ('musica', 'Música', 'Música', 'cultura', 'music'),
  ('espectacles', 'Espectacles', 'Espectáculos', 'cultura', 'theater'),
  ('fires-mercats', 'Fires i mercats', 'Ferias y mercados', 'cultura', 'store'),
  ('gastronomia', 'Gastronomia', 'Gastronomía', 'cultura', 'utensils'),
  ('cultura', 'Cultura', 'Cultura', 'cultura', 'book-open'),
  ('familia', 'Família', 'Familia', 'caracteristica', 'family'),
  ('natura', 'Natura', 'Naturaleza', 'natura', 'tree'),
  ('senderisme', 'Senderisme', 'Senderismo', 'natura', 'walking'),
  ('muntanya', 'Muntanya', 'Montaña', 'natura', 'mountain'),
  ('platges', 'Platges', 'Playas', 'natura', 'umbrella-beach'),
  ('bicicleta', 'Bicicleta', 'Bicicleta', 'natura', 'bike'),
  ('miradors', 'Miradors', 'Miradores', 'natura', 'binoculars'),
  ('patrimoni', 'Patrimoni', 'Patrimonio', 'patrimoni', 'landmark'),
  ('museus', 'Museus', 'Museos', 'patrimoni', 'museum'),
  ('monuments', 'Monuments', 'Monumentos', 'patrimoni', 'monument'),
  ('pobles', 'Pobles', 'Pueblos', 'patrimoni', 'houses'),
  ('parcs-jardins', 'Parcs i jardins', 'Parques y jardines', 'patrimoni', 'trees')
ON CONFLICT(slug) DO UPDATE SET
  name_ca = excluded.name_ca,
  name_es = excluded.name_es,
  group_name = excluded.group_name,
  icon = excluded.icon;

INSERT INTO sources (
  key, name, publisher, dataset_name, dataset_id, dataset_url,
  license_name, license_url, attribution_text,
  requires_attribution, requires_update_date, allows_data_reuse,
  allows_transformation, allows_commercial_use, allows_images,
  review_notes, reviewed_at, enabled
) VALUES (
  'gencat-agenda',
  'Agenda Cultural de Catalunya',
  'Generalitat de Catalunya. Departament de Cultura',
  'Agenda cultural de Catalunya (per localitzacions)',
  'rhpv-yr4f',
  'https://analisi.transparenciacatalunya.cat/Cultura-oci/Agenda-cultural-de-Catalunya-per-localitzacions-/rhpv-yr4f',
  'Llicència oberta d’ús d’informació - Catalunya',
  'https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies',
  'Generalitat de Catalunya. Departament de Cultura',
  1, 1, 1, 1, 1, 0,
  'Reutilització i transformació permeses amb atribució i data d’actualització. La llicència general no regeix automàticament els drets de cada imatge; per prudència no se’n reutilitza cap.',
  '2026-08-17',
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
