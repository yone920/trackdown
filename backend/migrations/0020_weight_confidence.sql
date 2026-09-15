-- ---------------------------------------------------------------------------
-- 0020 — a weigh-in the app was not sure about.
--
-- The field report (docs/CHANGELOG-v2.md): a 110 lb reading from somebody who
-- weighs about 212 was logged in full faith. The 7-day average fell to 161, the
-- week header printed "-102.0 lb", and the goal card announced "Reached · The
-- measure says you are there."
--
-- The reading is still theirs to keep — the always-log law does not bend for a
-- number we find surprising, and 110 might be true (a scale in kilograms, a
-- different person, months away from the app). What must not happen is the app
-- believing it *silently*, and then congratulating somebody on it.
--
-- So an implausible reading is challenged on the review card, saved only on an
-- explicit confirm, and marked here even then.
--
--   confidence   'low' when the app asked and the user said yes anyway.
--                NULL for every reading nobody had reason to doubt, which is
--                almost all of them and is NOT the same as "high": it means
--                nothing was ever asked.
--
-- Everything that could CONGRATULATE the user reads this column: the sustained
-- signal a goal needs before it says "Reached", and the week's own delta.
-- ---------------------------------------------------------------------------

ALTER TABLE weight_logs
	ADD COLUMN confidence TEXT CHECK (confidence IN ('low', 'medium', 'high'));
