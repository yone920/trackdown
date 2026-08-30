-- TrackDown v2 schema (docs/build-plan.md §WP1, docs/concept-v2.md §Data model changes).
--
-- Everything here is additive or a rename: every new column is nullable or defaulted, so
-- rows written against 0002 stay valid and the v1 app keeps working. The one structural
-- change is `calorie_expenditure` → `activities`; `/api/entries/movement` is an alias over
-- the new name (src/services/entries.ts), so the shipped app does not notice.
--
-- Naming: `_lb`, `_mi`, `_min` — pounds and miles in the UI (docs/agent-brief.md §Units),
-- minutes for durations. Day boundaries are the user's local midnight, so every DATE
-- column holds a *local* date and every TIMESTAMPTZ an absolute instant.

-- ---------------------------------------------------------------------------
-- exercise_catalog — the vocabulary the fusion prompt and the coach share.
-- Seeded from backend/data/exercises.json by src/db/exercises.ts (upsert by name),
-- which `npm run db:migrate` runs after the migrations.
-- ---------------------------------------------------------------------------

CREATE TABLE exercise_catalog (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL UNIQUE,
	aliases TEXT[] NOT NULL DEFAULT '{}',
	category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('cardio', 'strength', 'mobility', 'other')),
	primary_muscles TEXT[] NOT NULL DEFAULT '{}',
	secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
	equipment TEXT[] NOT NULL DEFAULT '{}',
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Lookups are case-insensitive by name or by alias ("db bench" → "Dumbbell Bench Press").
CREATE UNIQUE INDEX exercise_catalog_name_lower_idx ON exercise_catalog (lower(name));
CREATE INDEX exercise_catalog_aliases_idx ON exercise_catalog USING GIN (aliases);

-- ---------------------------------------------------------------------------
-- goals — the measurable spec from concept-v2 §Goals. Optional: no row means the
-- app runs on the built-in standing intention and shows no judgement colours.
-- `metrics` is a JSON array of { measure, scope?, target?, unit?, direction, rate?, by? };
-- `measure` must name an id from src/services/goals/measures.ts, which is the catalog
-- of things the app can actually compute. Kept as jsonb rather than a child table
-- because nothing queries inside it — the measure calculators read logs, not goals.
-- ---------------------------------------------------------------------------

CREATE TABLE goals (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('lose_fat', 'gain_muscle', 'build_strength', 'improve_endurance', 'maintain', 'custom')),
	title TEXT NOT NULL,
	metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
	priority INT NOT NULL DEFAULT 1,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reached', 'expired', 'dropped')),
	active_from DATE NOT NULL DEFAULT CURRENT_DATE,
	active_to DATE,
	-- When the user last said this out loud, so the coach knows how old the goal is.
	stated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	-- Set by the reached-detection job (WP4); the coach turns it into "mark it done?".
	-- A goal is never auto-closed, so status stays 'active' until the user confirms.
	reached_candidate_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX goals_user_status_idx ON goals (user_id, status, priority, active_from DESC);

-- ---------------------------------------------------------------------------
-- activities — was calorie_expenditure. One row per exercise, not per workout:
-- there are no sessions, and blocks (90-minute clusters) are computed at read time.
-- ---------------------------------------------------------------------------

ALTER TABLE calorie_expenditure RENAME TO activities;
ALTER INDEX expenditure_user_logged_at_idx RENAME TO activities_user_logged_at_idx;
-- `duration_minutes` is the same fact as the plan's `duration_min`; renamed rather than
-- duplicated. Nothing in the app or the API reads it today (checked with grep).
ALTER TABLE activities RENAME COLUMN duration_minutes TO duration_min;
-- Health-sourced rows arrive without a calorie figure; 0 rather than NULL keeps every
-- existing SUM(kcal) honest.
ALTER TABLE activities ALTER COLUMN kcal SET DEFAULT 0;

ALTER TABLE activities
	ADD COLUMN exercise TEXT,
	ADD COLUMN exercise_id UUID REFERENCES exercise_catalog(id) ON DELETE SET NULL,
	ADD COLUMN category TEXT CHECK (category IN ('cardio', 'strength', 'mobility', 'other')),
	ADD COLUMN muscle_groups TEXT[],
	ADD COLUMN sets INT CHECK (sets >= 0),
	ADD COLUMN reps INT CHECK (reps >= 0),
	ADD COLUMN load_lb NUMERIC(6,1) CHECK (load_lb >= 0),
	ADD COLUMN distance_mi NUMERIC(7,2) CHECK (distance_mi >= 0),
	ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fused', 'health')),
	ADD COLUMN confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
	-- HealthKit / Health Connect sample id: what makes /api/health/sync idempotent.
	ADD COLUMN external_id TEXT,
	-- Set when a Health workout is attached to a computed block (concept-v2 §Health).
	ADD COLUMN block_id UUID;

CREATE UNIQUE INDEX activities_external_id_key ON activities (user_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX activities_block_idx ON activities (block_id) WHERE block_id IS NOT NULL;
-- "last load × sets × reps for this exercise" — the coach's most frequent question.
CREATE INDEX activities_user_exercise_idx ON activities (user_id, exercise, logged_at DESC) WHERE exercise IS NOT NULL;
CREATE INDEX activities_muscle_groups_idx ON activities USING GIN (muscle_groups);

-- ---------------------------------------------------------------------------
-- evidence — the photo / transcript / note a record was fused from. Provenance,
-- and the photo gallery on a day. Exactly one of activity_id / meal_id / plan_id
-- is set (plan_id points at the goal a spoken plan update produced), or none while
-- a preview is still unconfirmed.
-- ---------------------------------------------------------------------------

CREATE TABLE evidence (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
	meal_id UUID REFERENCES meals(id) ON DELETE CASCADE,
	plan_id UUID REFERENCES goals(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('photo', 'transcript', 'text')),
	-- Opaque key in the EvidenceStore (WP2): a filename in the uploads volume today,
	-- an S3 key later. NULL for transcript/text rows, which carry `text` instead.
	storage_key TEXT,
	mime TEXT,
	width INT,
	height INT,
	text TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT evidence_one_owner CHECK (
		(activity_id IS NOT NULL)::int + (meal_id IS NOT NULL)::int + (plan_id IS NOT NULL)::int <= 1
	)
);
CREATE INDEX evidence_user_created_idx ON evidence (user_id, created_at DESC);
CREATE INDEX evidence_activity_idx ON evidence (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX evidence_meal_idx ON evidence (meal_id) WHERE meal_id IS NOT NULL;
CREATE UNIQUE INDEX evidence_storage_key_idx ON evidence (storage_key) WHERE storage_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- health_samples — the raw Apple Health / Health Connect import. Kept verbatim so a
-- merge rule can be changed and re-applied without re-syncing the phone.
-- Uniqueness is (user_id, external_id), not external_id alone: two phones can mint the
-- same sample uuid and one user's import must never collide with another's.
-- ---------------------------------------------------------------------------

CREATE TABLE health_samples (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	-- 'workout' | 'steps' | 'active_energy' | 'body_mass' | 'resting_hr' | 'vo2_max' | …
	-- Free text on purpose: platforms keep adding sample types, and an unknown kind
	-- should land in the table rather than fail the sync.
	kind TEXT NOT NULL,
	external_id TEXT NOT NULL,
	start_at TIMESTAMPTZ NOT NULL,
	end_at TIMESTAMPTZ,
	value NUMERIC(12,3),
	unit TEXT,
	raw JSONB,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (user_id, external_id)
);
CREATE INDEX health_samples_user_kind_start_idx ON health_samples (user_id, kind, start_at DESC);

-- ---------------------------------------------------------------------------
-- profiles — the plan, set by talking (concept-v2 §Goals and profile). concept-v2
-- called this a `plans` table; it is a strict 1:1 with the user, so the columns live
-- on `profiles` and there is one row to read instead of two.
-- ---------------------------------------------------------------------------

ALTER TABLE profiles
	-- 'lower_carb' | 'high_protein' | 'keto' | free text — whatever the user said.
	ADD COLUMN diet_style TEXT,
	ADD COLUMN protein_g INT CHECK (protein_g >= 0),
	ADD COLUMN carbs_max_g INT CHECK (carbs_max_g >= 0),
	-- Training days per week, as a count; the specific weekdays are a preference.
	ADD COLUMN training_days INT CHECK (training_days BETWEEN 0 AND 7),
	-- 'gym' | 'home' | 'outdoor' | 'mixed' — free text, extracted from speech.
	ADD COLUMN environment TEXT,
	ADD COLUMN equipment TEXT[] NOT NULL DEFAULT '{}',
	-- Injuries and exercises to avoid; hard limits the coach must respect.
	ADD COLUMN constraints TEXT[] NOT NULL DEFAULT '{}',
	-- Soft steers: "no burpees", "morning workouts".
	ADD COLUMN preferences TEXT[] NOT NULL DEFAULT '{}',
	-- How much of `earned` the eating ring lets the user spend (concept-v2 §Calories).
	-- Default half: machine and app burn estimates run high.
	ADD COLUMN eatback TEXT NOT NULL DEFAULT 'half' CHECK (eatback IN ('none', 'half', 'all')),
	-- { "<column>": "<iso timestamp>" } — when each field was last stated, so the
	-- Profile screen can date every row and the coach can discount a stale plan.
	ADD COLUMN stated_at JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- daily_summaries — the closed day. Written once when the day closes (first request
-- after the user's local midnight); the v1 totals columns stay as they are.
-- ---------------------------------------------------------------------------

ALTER TABLE daily_summaries
	-- eaten/earned/allowance are the calorie model of concept-v2 §Calories, frozen at
	-- close: allowance = target + eatback × earned, and status compares eaten to it.
	ADD COLUMN eaten INT,
	ADD COLUMN earned INT,
	ADD COLUMN allowance INT,
	ADD COLUMN status TEXT CHECK (status IN ('on_track', 'over', 'under')),
	-- Judged against the goal active *that* day; 'none' when there was no goal.
	ADD COLUMN verdict TEXT CHECK (verdict IN ('served', 'missed', 'unlogged', 'none')),
	-- The 90-minute clusters as presented: [{ id, title, start, end, kcal, exercises[] }].
	ADD COLUMN blocks JSONB,
	ADD COLUMN muscle_groups TEXT[],
	-- The day's reading, ≤ 2 sentences, written once at close (WP3).
	ADD COLUMN in_short TEXT,
	ADD COLUMN closed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- coach_briefs — the on-demand brief, cached for the day so asking twice is
-- consistent and free. Cache key is (user_id, date, inputs_hash); a new context
-- line changes the hash and therefore generates a new row.
-- ---------------------------------------------------------------------------

CREATE TABLE coach_briefs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	date DATE NOT NULL,
	asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	-- What the user typed or said when asking ("only 30 minutes", "knee hurts").
	context TEXT,
	workout JSONB,
	nutrition JSONB,
	nudge TEXT,
	rationale TEXT,
	model TEXT,
	inputs_hash TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX coach_briefs_user_date_idx ON coach_briefs (user_id, date DESC);
CREATE UNIQUE INDEX coach_briefs_cache_key_idx ON coach_briefs (user_id, date, inputs_hash) WHERE inputs_hash IS NOT NULL;
