-- WP6b — "The log, as recorded" (docs/design-system.md §DayLog).
--
-- The DayLog screen lists a day's entries the way they were logged: the raw sentence or
-- the photo, and beside it what the app understood. That join was possible for an
-- activity, a meal and a goal — evidence.activity_id / meal_id / plan_id — and impossible
-- for a weigh-in: `saveConfirmed` linked a scale photo with **no owner at all**, because
-- weight_logs had no column to point at. The row was kept (confirmed_at), but nothing
-- could say which weight it was evidence *for*.
--
-- One more owner column fixes it. Everything else about the table is unchanged, and the
-- CHECK still says at most one owner: a photo is evidence for one record, and a log that
-- produced two records keeps its evidence on the first (services/fusion/confirm.ts).
--
-- Rows written before this migration keep their NULL: a scale photo from last week has no
-- weight to attach to and shows up in the log as a statement, which is what it looks like
-- from here. Nothing is rewritten by guessing at timestamps.

ALTER TABLE evidence ADD COLUMN weight_id UUID REFERENCES weight_logs(id) ON DELETE CASCADE;

ALTER TABLE evidence DROP CONSTRAINT evidence_one_owner;
ALTER TABLE evidence ADD CONSTRAINT evidence_one_owner CHECK (
	(activity_id IS NOT NULL)::int
	+ (meal_id IS NOT NULL)::int
	+ (plan_id IS NOT NULL)::int
	+ (weight_id IS NOT NULL)::int <= 1
);

CREATE INDEX evidence_weight_idx ON evidence (weight_id) WHERE weight_id IS NOT NULL;
