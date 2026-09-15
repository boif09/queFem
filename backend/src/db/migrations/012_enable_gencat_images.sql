ALTER TABLE plan_source_images
ADD COLUMN attribution_known INTEGER NOT NULL DEFAULT 0 CHECK (attribution_known IN (0, 1));

-- Before this column existed, only the Ticketmaster and Fever integrations
-- persisted reviewed image selections. Preserve their established behaviour,
-- while every Gencat (and otherwise ambiguous) legacy row remains fail-closed.
UPDATE plan_source_images
SET attribution_known = 1
WHERE plan_source_id IN (
  SELECT ps.id
  FROM plan_sources ps
  JOIN sources s ON s.id = ps.source_id
  WHERE s.key IN ('ticketmaster-discovery-feed', 'fever')
);

UPDATE sources
SET allows_images = 1,
    review_notes = 'Imatges de l''Agenda Cultural reutilitzables. Cal reproduir el Peu d''imatge quan no sigui buit; un peu existent i buit no requereix crèdit. Resolució des de la pàgina pública amb validació fail-closed.',
    reviewed_at = '2026-09-15'
WHERE key = 'gencat-agenda';
