-- WP3 — the day model's one new table (docs/build-plan.md §WP3).
--
-- `daily_summaries` already has `in_short`, written when a day closes. What it has no room
-- for is the *live* day's reading: "Right now" is regenerated whenever the day changes and
-- exists for a day that has not closed yet, so writing it into daily_summaries would mean
-- creating a summary row for an open day and then rewriting it all afternoon — a row whose
-- presence is supposed to mean "this day is finished".
--
-- So the readings cache is its own small table, keyed by (user, date, kind), holding the
-- inputs hash it was generated from. A day whose hash still matches is served from here;
-- anything else is regenerated. `in_short` is written here too *and* copied into
-- daily_summaries at close, so the closed-day record stays self-contained for the coach.

CREATE TABLE day_readings (
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	-- The user's local calendar date, like every DATE in this schema.
	date DATE NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('right_now', 'in_short')),
	-- Hash of the day's material facts (services/readings/readings.ts). The cache key: the
	-- clock moving is not a reason to pay for two more sentences, a logged meal is.
	inputs_hash TEXT NOT NULL,
	text TEXT NOT NULL,
	-- { label, kind, hint } — the single next action. Null for in_short: a closed day has none.
	next_action JSONB,
	actions JSONB NOT NULL DEFAULT '[]'::jsonb,
	model TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (user_id, date, kind)
);

CREATE INDEX day_readings_user_date_idx ON day_readings (user_id, date DESC);

-- ---------------------------------------------------------------------------
-- Two columns on the closed-day record, for the Days list.
--
-- That screen is a paged list of one-line summaries ("Chest & Triceps · 1,980 kcal in 3
-- meals · 182 lb"). The line is composed from facts the close already knows, and the
-- alternative — re-deriving a sentence out of the `blocks` jsonb in SQL, or recomputing
-- every listed day from its rows — is slower and less honest than writing it down once,
-- with the rest of the record, at the moment it was true.
-- ---------------------------------------------------------------------------

ALTER TABLE daily_summaries
	ADD COLUMN summary_line TEXT,
	-- Meals eaten that day. `kcal_consumed` says how much, nothing said how often.
	ADD COLUMN meal_count INT,
	-- Maintenance calories as they were on that day, at that body weight. The week's
	-- deficit is Σ(TDEE + earned − eaten) (docs/concept-v2.md §Calories) and there is no
	-- way back to it later: recomputing a TDEE for June from today's weight would quietly
	-- rewrite June.
	ADD COLUMN tdee INT;
