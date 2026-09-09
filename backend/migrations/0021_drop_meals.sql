-- Drop the meal-tracking and calorie-budget subsystem. Product pivot: TrackDown is now
-- workout + weight tracking only. Destructive — any existing meals/meal_items rows are
-- permanently lost. No data-migration path: the product decision is that this data no
-- longer belongs in the app at all.

-- --- fusion evidence: meal_id was one of three possible owners ---------------------------
ALTER TABLE evidence DROP CONSTRAINT evidence_one_owner;
DROP INDEX evidence_meal_idx;
ALTER TABLE evidence DROP COLUMN meal_id;
ALTER TABLE evidence
	ADD CONSTRAINT evidence_one_owner CHECK (
		(activity_id IS NOT NULL)::int + (plan_id IS NOT NULL)::int <= 1
	);

-- --- corrections: meal_id was one of three possible owners ------------------------------
ALTER TABLE record_corrections DROP CONSTRAINT record_corrections_one_owner;
DROP INDEX record_corrections_meal_idx;
ALTER TABLE record_corrections DROP COLUMN meal_id;
ALTER TABLE record_corrections
	ADD CONSTRAINT record_corrections_one_owner CHECK (
		(activity_id IS NOT NULL)::int + (weight_id IS NOT NULL)::int = 1
	);

-- --- day_readings: eating_direction was one of three cached reading kinds ----------------
DELETE FROM day_readings WHERE kind = 'eating_direction';
ALTER TABLE day_readings DROP CONSTRAINT day_readings_kind_check;
ALTER TABLE day_readings
	ADD CONSTRAINT day_readings_kind_check CHECK (kind IN ('right_now', 'in_short'));

-- --- the meal tables themselves -----------------------------------------------------------
DROP TABLE meal_items;
DROP TABLE meals;

-- --- daily_summaries: the whole calorie-budget/eating side --------------------------------
ALTER TABLE daily_summaries
	DROP COLUMN kcal_consumed,
	DROP COLUMN kcal_burned,
	DROP COLUMN protein_g,
	DROP COLUMN carbs_g,
	DROP COLUMN fat_g,
	DROP COLUMN fiber_g,
	DROP COLUMN eaten,
	DROP COLUMN allowance,
	DROP COLUMN status,
	DROP COLUMN meal_count,
	DROP COLUMN tdee;

-- --- profiles: the meal-goal plan fields --------------------------------------------------
-- Note: goal_pace is NOT dropped — it paces every goal's projected timeline (body-weight,
-- exercise_load, etc.), not just the calorie deficit. Shared infrastructure, kept as-is.
ALTER TABLE profiles
	DROP COLUMN diet_style,
	DROP COLUMN protein_g,
	DROP COLUMN carbs_max_g,
	DROP COLUMN eatback,
	DROP COLUMN daily_calorie_target,
	DROP COLUMN deficit_kcal;

-- --- coach_briefs: the nutrition card -----------------------------------------------------
ALTER TABLE coach_briefs DROP COLUMN nutrition;

-- --- goals: lose_fat/maintain are no longer goal kinds the app produces or judges -------
-- Existing rows of those kinds become custom goals rather than being deleted — the user's
-- goal history is not meal data, and a custom goal still carries its own metrics/timeline.
UPDATE goals SET kind = 'custom' WHERE kind IN ('lose_fat', 'maintain');
ALTER TABLE goals DROP CONSTRAINT goals_kind_check;
ALTER TABLE goals
	ADD CONSTRAINT goals_kind_check CHECK (kind IN ('gain_muscle', 'build_strength', 'improve_endurance', 'custom'));
