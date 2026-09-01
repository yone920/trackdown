-- ---------------------------------------------------------------------------
-- 0016 — the cardio target, when somebody says one.
--
-- The weekly cardio number on Progress and in the brief was 150 for everybody
-- who had not written a *goal* about it: the WHO's guideline, standing in as
-- though it were a plan. It is a fine default and it was presented as a fact
-- about the user, which is the same shape of lie `daily_calorie_target` told
-- before fix-safearea-target-label — a number nobody chose, reported back as
-- something they had.
--
--   cardio_minutes_target  weekly cardio minutes this user aims for.
--                          NULL = nobody has said, and the code reads
--                          DEFAULT_WEEKLY_CARDIO_MIN (150) instead, and SAYS
--                          that it is doing so ("standard guideline — tell me
--                          yours").
--
-- Nullable rather than `DEFAULT 150`, for exactly the reason 0014 gives: a
-- column default that looks like a stated value gets reported back to the user
-- as something they said. The 150 lives in TypeScript beside the rules that
-- read it (services/coach/features.ts), and `profiles.stated_at` carries the
-- date the moment a human does say a number — set by talking, like every other
-- plan field (concept-v2 §Principles 7: NO FORMS).
--
-- The upper bound is 2000: sixteen hours of cardio a week is already past
-- anything a person types on purpose, and a bound that refuses a typo is worth
-- more than one that admires an athlete.
--
-- Precedence, for the reader who comes looking: a GOAL that names weekly
-- minutes (`weekly_cardio_min`) wins over this column, because a goal is the
-- more specific and more recent statement of intent; this column wins over the
-- guideline. The three cases are reported as `target_source` on the board so
-- the screen can say which one it is looking at.
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS cardio_minutes_target INTEGER;

ALTER TABLE profiles
	DROP CONSTRAINT IF EXISTS profiles_cardio_minutes_target_check;

ALTER TABLE profiles
	ADD CONSTRAINT profiles_cardio_minutes_target_check
	CHECK (cardio_minutes_target IS NULL OR (cardio_minutes_target >= 0 AND cardio_minutes_target <= 2000));
