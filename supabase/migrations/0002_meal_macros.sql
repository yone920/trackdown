-- Add macro estimates to meal entries.
-- The AI parser fills these in from the user's text; null is allowed for
-- existing rows and for cases where the model has no useful estimate.

ALTER TABLE meals
  ADD COLUMN protein_g NUMERIC(6,1),
  ADD COLUMN carbs_g   NUMERIC(6,1),
  ADD COLUMN fat_g     NUMERIC(6,1),
  ADD COLUMN fiber_g   NUMERIC(6,1);
