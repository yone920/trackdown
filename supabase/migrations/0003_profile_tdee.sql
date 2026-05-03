-- Add TDEE inputs to profiles so the app can compute a personalized
-- daily intake target instead of using a fixed 2,100 cap.

ALTER TABLE profiles
  ADD COLUMN sex            TEXT CHECK (sex IN ('male', 'female')),
  ADD COLUMN birth_year     INT  CHECK (birth_year BETWEEN 1900 AND 2100),
  ADD COLUMN height_cm      NUMERIC(5,1),
  ADD COLUMN activity_level TEXT CHECK (activity_level IN ('sedentary','light','moderate','active','very_active')),
  ADD COLUMN deficit_kcal   INT  DEFAULT 500;
