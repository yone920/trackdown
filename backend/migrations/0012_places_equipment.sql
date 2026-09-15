-- ---------------------------------------------------------------------------
-- 0012 — the machine is not the movement, and the gym remembers itself.
--
-- Two things one field report asked for at once.
--
-- 1. `activities.equipment` — what the movement was done ON, as its own fact.
--    "Chest-Supported Row" is the movement; "chest-supported row machine",
--    "cable stack", "dumbbells" is the kit. They were being squashed into one
--    string, which made the exercise name unmatchable against the catalogue and
--    lost the only detail the user was actually sure about. Nullable: most logs
--    do not name a machine, and an absent one is not an empty one.
--
--    The movement stays the key for everything comparative — `delta_vs_last`
--    keys on `exercise`, never on this — because "heavier than last time" is a
--    claim about the lift, not about which machine was free that day.
--
-- 2. Places, and what has been seen in them. Passive: nothing here is a form
--    the user fills in. Saying "my gym is New Millennium" names the place; every
--    workout saved afterwards quietly records the exercise and the kit it used
--    against it, so the coach can prescribe from what is actually on the floor
--    instead of from a catalogue.
--
--      places            one row per gym / home setup / hotel gym they name.
--      place_equipment   one row per distinct label seen there, with when it was
--                        first and last seen and how often. `exercise_id` points
--                        at the catalogue row when the label was recognised as a
--                        movement; it is NULL for a machine we only know by name.
--      profiles.current_place_id  where they are training now. NULL is normal
--                        and everything below degrades to a silent no-op.
--
-- The uniqueness is on (place_id, lower(label)) so "Cable Stack" and "cable
-- stack" are one machine, and the accrual is an upsert: seeing it again bumps
-- `last_seen` and `times_seen` rather than writing a second row.
-- ---------------------------------------------------------------------------

ALTER TABLE activities ADD COLUMN equipment TEXT;

CREATE TABLE places (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'gym' CHECK (kind IN ('gym', 'home', 'travel', 'other')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One place per name per user: "my gym is New Millennium", said twice, is one gym.
CREATE UNIQUE INDEX places_user_name_key ON places (user_id, lower(name));

CREATE TABLE place_equipment (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
	-- What it was called — a machine ("cable stack") or a movement ("Lat Pulldown").
	label TEXT NOT NULL,
	exercise_id UUID REFERENCES exercise_catalog(id) ON DELETE SET NULL,
	first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	times_seen INTEGER NOT NULL DEFAULT 1,
	-- How we came to know: read out of a log, off a photo, or simply stated.
	source TEXT NOT NULL DEFAULT 'fused' CHECK (source IN ('fused', 'photo', 'stated'))
);

CREATE UNIQUE INDEX place_equipment_label_key ON place_equipment (place_id, lower(label));
CREATE INDEX place_equipment_seen_idx ON place_equipment (place_id, times_seen DESC, last_seen DESC);

ALTER TABLE profiles ADD COLUMN current_place_id UUID REFERENCES places(id) ON DELETE SET NULL;
