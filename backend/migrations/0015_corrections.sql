-- ---------------------------------------------------------------------------
-- 0015 — the corrections, kept.
--
-- The field report (docs/CHANGELOG-v2.md §Field fixes): a lunch came back with
-- 398 g of carbohydrate on it, the user said "the carbs look wrong", the app
-- read it again and wrote 89 — and **nothing anywhere remembered that this had
-- happened**. The record showed 89 g of carbs as if it had always said so.
--
-- That is a hole in the one promise this app makes about its own data
-- (concept-v2 §Principles 3, "confirm, don't trust", and §Principles 8, "the
-- app is a record of what happened, it can be corrected"). A correction IS
-- something that happened. The user's own instruction is the most reliable
-- sentence in the system and it was being thrown away the moment it was acted
-- on, so the log could not answer the two questions anyone asks of a number
-- they do not recognise: did I change this, and what did it say before?
--
--   record_corrections   one row per told change, per record it changed.
--
--     instruction   what the user actually said, in their own words.
--     changes       [{ "field": "carbs_g", "from": 398, "to": 89 }] — the
--                   field-level diff the revision produced, computed by
--                   services/corrections.ts from the values before and after.
--                   jsonb because the fields differ by kind and nothing here
--                   is ever queried by field; it is read back whole and
--                   rendered as a line under the record.
--
-- Exactly ONE owner, like `evidence`: a correction is about one saved row. A
-- log that read as three parts and was corrected in one breath writes three
-- rows, one per record it moved, each with the same instruction — because each
-- of those records has to be able to explain itself on its own screen.
--
-- ON DELETE CASCADE throughout: a deleted row's history is not history any
-- more, it is a dangling reference to something the user took back.
-- ---------------------------------------------------------------------------

CREATE TABLE record_corrections (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
	meal_id UUID REFERENCES meals(id) ON DELETE CASCADE,
	weight_id UUID REFERENCES weight_logs(id) ON DELETE CASCADE,
	instruction TEXT NOT NULL,
	changes JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT record_corrections_one_owner CHECK (
		(activity_id IS NOT NULL)::int
		+ (meal_id IS NOT NULL)::int
		+ (weight_id IS NOT NULL)::int = 1
	)
);

-- The DayLog reads them by owner, in the order they were made.
CREATE INDEX record_corrections_activity_idx
	ON record_corrections (activity_id, created_at) WHERE activity_id IS NOT NULL;
CREATE INDEX record_corrections_meal_idx
	ON record_corrections (meal_id, created_at) WHERE meal_id IS NOT NULL;
CREATE INDEX record_corrections_weight_idx
	ON record_corrections (weight_id, created_at) WHERE weight_id IS NOT NULL;
