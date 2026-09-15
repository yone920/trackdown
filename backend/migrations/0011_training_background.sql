-- ---------------------------------------------------------------------------
-- 0011 — training background: what the user brings with them on day one.
--
-- Cold start used to assume a beginner. With nothing logged, `prescribeLoads`
-- had no history to prescribe from, the prompt was told "no history yet:
-- prescribe no loads", and someone who has been lifting for three years got a
-- first-session brief. But they can simply say so — and one sentence typed into
-- the Log sheet ("I've been lifting three years, I bench 165 for 3×5") holds
-- everything the coach needs to start from where they actually are.
--
--   experience       beginner | intermediate | advanced. NULL = never stated.
--   background       their own words, kept whole ("three years of 5/3/1, took
--                    six months off after a shoulder injury").
--   reference_loads  jsonb array of { exercise, load_lb, reps? } — what they
--                    say they lift now, for exercises this log has never seen.
--                    services/coach/rules.ts prescribes from these when there
--                    is no history, under the same progression rules.
--
-- Every one of them is a *stated* fact, so it is dated in `profiles.stated_at`
-- like every other field on the plan (concept-v2 §Goals and profile). A stated
-- fact is never the same thing as a logged one: the moment the exercise has
-- real sessions behind it, the log wins and the reference is ignored.
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
	ADD COLUMN experience TEXT,
	ADD COLUMN background TEXT,
	ADD COLUMN reference_loads JSONB NOT NULL DEFAULT '[]'::jsonb;
