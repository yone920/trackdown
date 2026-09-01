-- ---------------------------------------------------------------------------
-- 0017 — the dossier's cache.
--
-- The You screen used to be rows: "Days a week — 4", "Diet style — keto", each
-- with the date it was said. Every one of them was true and none of them read
-- as a person. It is two generated paragraphs now — what I know about you, and
-- what I do not — which makes it the third generated reading in this codebase
-- and the first one that is not about a day.
--
--   profile_readings   one row per user per kind of profile-scoped reading.
--
--     known / missing   the two paragraphs, stored apart because the screen
--                       draws them apart and a split on "\n\n" is a parser
--                       waiting to be wrong.
--     inputs_hash       sha256 of the sheet the model was given, prompt
--                       fingerprint included (services/readings/dossier.ts).
--                       A profile edit, a new goal or a month of training
--                       changes the sheet and therefore the hash; opening the
--                       screen twice does not.
--
-- Why not `day_readings`, which already has (user, date, kind) and a hash: a
-- dossier is not about a day. Keying it by date would regenerate it at every
-- local midnight — a model call a day, for ever, to say the same thing about a
-- profile nobody touched. Keying it by user is the honest shape.
--
-- PRIMARY KEY (user_id, kind) rather than (user_id): the day readings needed a
-- second kind eight days after the first one did, and a second profile-scoped
-- reading should cost no migration.
-- ---------------------------------------------------------------------------

CREATE TABLE profile_readings (
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	kind TEXT NOT NULL DEFAULT 'dossier' CHECK (kind IN ('dossier')),
	known TEXT NOT NULL,
	missing TEXT NOT NULL,
	inputs_hash TEXT NOT NULL,
	model TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (user_id, kind)
);
