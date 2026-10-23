-- The do.diba.cat/datasets/... pages seeded in 011 do not open in a browser (do.diba.cat only serves the API) and the
-- Diputació portal dadesobertes.diba.cat refused connections on 2026-10-23. /fonts and the Google Play listing now
-- link each feed to its official entry in the national open data catalogue (datos.gob.es, publisher Diputación
-- Provincial de Barcelona), which loads. The import endpoints are unchanged.
UPDATE sources SET dataset_url = 'https://datos.gob.es/ca/catalogo/l02000008-turismo-agenda-de-actividades'
WHERE key = 'diba-tourisme';
UPDATE sources SET dataset_url = 'https://datos.gob.es/ca/catalogo/l02000008-teatros-y-auditorios-agenda-de-actividades'
WHERE key = 'diba-escenari';
UPDATE sources SET dataset_url = 'https://datos.gob.es/ca/catalogo/l02000008-museos-agenda-de-actividades'
WHERE key = 'diba-museus';
