-- ---------------------------------------------------------------------------
-- 0013 — which way the weight helps.
--
-- Reported from the phone: "assisted chin up with 55 pounds" was saved as a
-- plain Chin-Up at 55 lb. Two things went wrong and this column is the second
-- of them.
--
-- The first was the matcher, which dropped the qualifier and snapped to the
-- nearest catalogue name (services/exerciseMatch.ts fixes that, and the
-- assisted family is now in data/exercises.json). The second is arithmetic: on
-- an assisted machine the number on the stack is the help the machine gives,
-- so 55 lb is *easier* than bodyweight, not harder — and progress is the
-- number going DOWN, not up. Every rule that reads a load (the coach's
-- prescribeLoads, the day's delta_vs_last) needs to know which of the two it
-- is looking at, and only the catalogue can say.
--
-- Nullable would have meant "unknown", which nothing wants to reason about:
-- the default is 'resistance', which is what every row in the catalogue was
-- until today and what almost every exercise will always be.
--
-- Nothing back-fills `activities`. A row already saved keeps the number and
-- the name it was saved with; correcting one is the user's to do through Make
-- a change. This column describes the movement, not the log.
-- ---------------------------------------------------------------------------

ALTER TABLE exercise_catalog
	ADD COLUMN IF NOT EXISTS load_direction text NOT NULL DEFAULT 'resistance';

ALTER TABLE exercise_catalog
	DROP CONSTRAINT IF EXISTS exercise_catalog_load_direction_check;

ALTER TABLE exercise_catalog
	ADD CONSTRAINT exercise_catalog_load_direction_check
	CHECK (load_direction IN ('resistance', 'assistance'));
