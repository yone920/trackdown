-- ---------------------------------------------------------------------------
-- 0014 — how long a session is.
--
-- The brief was sized by nothing at all: four to six exercises whether the
-- user had ninety minutes or twenty-five. "Only 30 today" typed into the ask
-- shaped it for that day and was forgotten by the next one, because there was
-- nowhere to keep it.
--
--   session_minutes  how long a normal session is for this user, in minutes.
--                    NULL = never stated, and the code reads
--                    DEFAULT_SESSION_MINUTES (60) instead.
--
-- Nullable rather than `DEFAULT 60` on purpose, and the reason is the lesson
-- of `daily_calorie_target` (fix-safearea-target-label): a column default that
-- looks like a stated value gets reported back to the user as something they
-- said. NULL is the honest "nobody has told me", the 60 lives in TypeScript
-- next to the rules that use it, and `profiles.stated_at` carries the date the
-- moment a human does say a number — set by talking, like every other plan
-- field (concept-v2 §Principles 7: NO FORMS).
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
	ADD COLUMN IF NOT EXISTS session_minutes INTEGER;

ALTER TABLE profiles
	DROP CONSTRAINT IF EXISTS profiles_session_minutes_check;

ALTER TABLE profiles
	ADD CONSTRAINT profiles_session_minutes_check
	CHECK (session_minutes IS NULL OR (session_minutes >= 10 AND session_minutes <= 240));
