-- TrackDown application tables, ported from supabase/migrations/0001–0004.
--
-- Changes from the Supabase version:
--   * user_id / profiles.id are TEXT referencing "user"(id) instead of UUID referencing
--     auth.users(id) — see 0001 for why ids are text.
--   * Row Level Security policies are dropped. The backend is the only database client
--     and scopes every query by the session's user id (src/services/entries.ts).
--   * The `handle_new_user` trigger on auth.users is gone; Better Auth's
--     databaseHooks.user.create.after creates the profiles row instead (src/auth.ts).
-- Everything else (columns, types, checks, indexes, defaults) is identical, so
-- migrate-from-supabase.ts can copy rows column-for-column.

CREATE TABLE profiles (
	id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
	display_name TEXT,
	daily_calorie_target INT DEFAULT 2100,
	goal_weight_lb NUMERIC(5,1),
	units TEXT DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	-- 0003_profile_tdee
	sex TEXT CHECK (sex IN ('male', 'female')),
	birth_year INT CHECK (birth_year BETWEEN 1900 AND 2100),
	height_cm NUMERIC(5,1),
	activity_level TEXT CHECK (activity_level IN ('sedentary','light','moderate','active','very_active')),
	deficit_kcal INT DEFAULT 500,
	-- 0004_recommendations
	goal_pace TEXT DEFAULT 'standard' CHECK (goal_pace IN ('gentle', 'standard', 'aggressive')),
	pregnant_or_lactating BOOLEAN NOT NULL DEFAULT FALSE,
	health_concern BOOLEAN NOT NULL DEFAULT FALSE,
	disclaimer_acknowledged_at TIMESTAMPTZ
);

CREATE TABLE meals (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	description TEXT NOT NULL,
	kcal INT NOT NULL,
	meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
	logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	-- 0002_meal_macros
	protein_g NUMERIC(6,1),
	carbs_g NUMERIC(6,1),
	fat_g NUMERIC(6,1),
	fiber_g NUMERIC(6,1)
);
CREATE INDEX meals_user_logged_at_idx ON meals (user_id, logged_at DESC);

CREATE TABLE meal_items (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kcal INT,
	protein_g NUMERIC(6,1),
	carbs_g NUMERIC(6,1),
	fat_g NUMERIC(6,1),
	fiber_g NUMERIC(6,1),
	serving_amount TEXT
);
CREATE INDEX meal_items_meal_idx ON meal_items (meal_id);

CREATE TABLE calorie_expenditure (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	description TEXT NOT NULL,
	kcal INT NOT NULL,
	duration_minutes INT,
	logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX expenditure_user_logged_at_idx ON calorie_expenditure (user_id, logged_at DESC);

CREATE TABLE weight_logs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	weight_lb NUMERIC(5,1) NOT NULL,
	logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX weight_user_logged_at_idx ON weight_logs (user_id, logged_at DESC);

CREATE TABLE daily_summaries (
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	date DATE NOT NULL,
	kcal_consumed INT NOT NULL DEFAULT 0,
	kcal_burned INT NOT NULL DEFAULT 0,
	protein_g NUMERIC(7,1) NOT NULL DEFAULT 0,
	carbs_g NUMERIC(7,1) NOT NULL DEFAULT 0,
	fat_g NUMERIC(7,1) NOT NULL DEFAULT 0,
	fiber_g NUMERIC(7,1) NOT NULL DEFAULT 0,
	weight_lb NUMERIC(5,1),
	PRIMARY KEY (user_id, date)
);
