-- ---------------------------------------------------------------------------
-- 0019 — the eating direction, cached like every other reading.
--
-- The Eat page has three layers and only the middle one is arithmetic: the
-- day's numbers, then the rolling seven-day averages against their targets,
-- then a short paragraph saying what to steer toward. That paragraph is the
-- one generated thing on the page (concept-v2 §Principles 4: facts are
-- computed, advice is generated).
--
-- It follows the READINGS rule, not the coach rule, and the difference is the
-- whole reason it lives in `day_readings` rather than in `coach_briefs`:
--
--   * a reading is cached per day against an INPUTS HASH and refreshes itself
--     when the facts under it move — log a meal and it is stale, open the page
--     twice and it is free;
--   * a brief is one per day, generated only when explicitly asked for, and
--     never regenerated behind the user's back.
--
-- Opening the Eat page must never cost a model call when the cache is warm,
-- and must never nag. That is the reading contract, so this is a reading.
--
-- The table already keys on (user_id, date, kind); this only widens the CHECK.
-- ---------------------------------------------------------------------------

ALTER TABLE day_readings DROP CONSTRAINT IF EXISTS day_readings_kind_check;
ALTER TABLE day_readings
	ADD CONSTRAINT day_readings_kind_check
	CHECK (kind IN ('right_now', 'in_short', 'eating_direction'));
