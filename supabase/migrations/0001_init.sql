-- TrackDown initial schema
-- Tables: profiles, meals, meal_items, calorie_expenditure, weight_logs, daily_summaries
-- All tables have RLS enabled; users can only read/write their own rows.

-- ============================================================================
-- profiles: 1:1 with auth.users, populated automatically on signup
-- ============================================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  daily_calorie_target INT DEFAULT 2100,
  goal_weight_lb NUMERIC(5,1),
  units TEXT DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- meals: each food entry the user logs
-- ============================================================================
CREATE TABLE meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  kcal INT NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX meals_user_logged_at_idx ON meals (user_id, logged_at DESC);

-- ============================================================================
-- meal_items: structured breakdown of foods within a meal (AI-populated)
-- ============================================================================
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

-- ============================================================================
-- calorie_expenditure: workouts and other movement
-- ============================================================================
CREATE TABLE calorie_expenditure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  kcal INT NOT NULL,
  duration_minutes INT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX expenditure_user_logged_at_idx ON calorie_expenditure (user_id, logged_at DESC);

-- ============================================================================
-- weight_logs: scale readings over time
-- ============================================================================
CREATE TABLE weight_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_lb NUMERIC(5,1) NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX weight_user_logged_at_idx ON weight_logs (user_id, logged_at DESC);

-- ============================================================================
-- daily_summaries: pre-aggregated totals per day, per user (for trend queries)
-- ============================================================================
CREATE TABLE daily_summaries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- ============================================================================
-- Row Level Security: every user sees only their own rows
-- ============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE calorie_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile" ON profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "own meals" ON meals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own meal_items" ON meal_items
  FOR ALL USING (auth.uid() = (SELECT user_id FROM meals WHERE id = meal_id))
  WITH CHECK (auth.uid() = (SELECT user_id FROM meals WHERE id = meal_id));

CREATE POLICY "own expenditure" ON calorie_expenditure
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own weight" ON weight_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own summaries" ON daily_summaries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
