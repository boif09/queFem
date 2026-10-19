-- An image address that the origin definitively no longer serves (HTTP 404/410), found when the same-origin media
-- route tried to fetch it or by scripts/sweep-gencat-images.js. While unavailable_at is recent the API does not offer
-- the image (the plan falls back to the generic photo library) and the media route does not hit the origin again;
-- after DEAD_IMAGE_RETRY_DAYS it is offered once more, so an image the provider restores comes back by itself.
-- Only a definitive 404/410 is recorded: timeouts, 5xx and capacity errors never are. A changed image URL resets it.
ALTER TABLE plan_source_images ADD COLUMN unavailable_at TEXT;
ALTER TABLE plan_source_images ADD COLUMN unavailable_status INTEGER
  CHECK (unavailable_status IS NULL OR unavailable_status IN (404, 410));

CREATE INDEX IF NOT EXISTS idx_plan_source_images_unavailable
ON plan_source_images(unavailable_at) WHERE unavailable_at IS NOT NULL;
