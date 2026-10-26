-- Category catalogue review (2026-10-26).
-- Seven categories from the original specification describe places, not dated events (muntanya, platges, bicicleta,
-- miradors, monuments, pobles, parcs-jardins). No source can tag them, so they never had a plan and showed up as empty
-- filters (two of them even on the home page). They are removed, but only while they still have no plan: a category that
-- somehow gained links is kept instead of orphaning them.
-- Three categories cover real, recurring demand that "Cultura" absorbed: exposicions, cinema and experiencies.
DELETE FROM categories
WHERE slug IN ('muntanya', 'platges', 'bicicleta', 'miradors', 'monuments', 'pobles', 'parcs-jardins')
  AND NOT EXISTS (SELECT 1 FROM plan_categories WHERE plan_categories.category_id = categories.id);

INSERT INTO categories (slug, name_ca, name_es, group_name, icon) VALUES
  ('exposicions', 'Exposicions', 'Exposiciones', 'cultura', 'frame'),
  ('cinema', 'Cinema', 'Cine', 'cultura', 'film'),
  ('experiencies', 'Experiències', 'Experiencias', 'cultura', 'sparkles')
ON CONFLICT(slug) DO NOTHING;
