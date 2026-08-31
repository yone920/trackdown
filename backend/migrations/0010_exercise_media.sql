-- ---------------------------------------------------------------------------
-- 0010 — exercise illustrations.
--
-- Every exercise name in the app is tappable and opens a sheet: two position
-- photos, the numbered steps, the muscles and the equipment. The photos and the
-- steps come from free-exercise-db (github.com/yuhonas/free-exercise-db,
-- Unlicense), imported once by src/scripts/import-exercise-media.ts and then
-- self-hosted — no request from the phone ever leaves this server.
--
-- Only what the dataset adds lives here. `primary_muscles`, `secondary_muscles`
-- and `equipment` are NOT re-imported: 0004 already has curated ones, and
-- db/exercises.ts owns those columns on every `db:seed-exercises` run. A second
-- copy would be overwritten by the next seed, or drift from what the coach and
-- the day model read.
--
--   instructions  the numbered steps, in order. NULL = never imported,
--                 '{}' = matched but the dataset had none.
--   media_count   how many photos are on disk for this exercise (0, or 2).
--                 The route serves /api/exercises/:id/media/:n for n < this.
--   source_slug   the dataset id the match resolved to ("Barbell_Squat") — the
--                 audit trail for "why is that the picture", and what makes a
--                 re-import idempotent.
--   level         the dataset's beginner / intermediate / expert.
--
-- The bytes themselves are not in Postgres: they sit in the evidence volume
-- under exercise-media/<exercise id>/{0,1}.jpg (adapters/storage/exerciseMedia.ts).
-- ---------------------------------------------------------------------------

ALTER TABLE exercise_catalog
	ADD COLUMN instructions TEXT[],
	ADD COLUMN media_count INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN source_slug TEXT,
	ADD COLUMN level TEXT;
