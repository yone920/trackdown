-- Personalized recommendations: goal pace tier (replaces raw deficit kcal),
-- exclusion flags for populations that should not get deficit recommendations,
-- and disclaimer acknowledgement timestamp.
--
-- Source basis: NHLBI 1998 Clinical Guidelines on Obesity; AHA/ACC/TOS 2013
-- Guideline; Academy of Nutrition and Dietetics Adult Weight Management
-- Evidence-Based Guideline; ISSN 2017 Diets & Body Composition Position Stand.

ALTER TABLE profiles
  ADD COLUMN goal_pace                  TEXT DEFAULT 'standard'
    CHECK (goal_pace IN ('gentle', 'standard', 'aggressive')),
  ADD COLUMN pregnant_or_lactating      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN health_concern             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN disclaimer_acknowledged_at TIMESTAMPTZ;
