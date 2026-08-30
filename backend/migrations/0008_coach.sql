-- WP5 — the coach (docs/build-plan.md §WP5, docs/concept-v2.md §Coach).
--
-- 0004 already created `coach_briefs` with the cache key the plan asked for
-- ((user_id, date, inputs_hash)). Two things the brief actually needs were not there.
--
-- 1. `headline` and `nudge_action`. The Coach screen opens with a title sentence
--    ("Push day — shoulders and back") above the "why", and the nudge is not only words:
--    when WP4's `reached_candidate_at` or `stalled_since` is set, the app has to be able
--    to *act* on the sentence ("mark it done?" → PATCH the goal). The action is chosen by
--    services/coach/rules.ts, not by the model — a button that does something is not a
--    thing to generate — so it is stored beside the sentence the model wrote for it.
--    `rationale` (0004) holds the brief's `why`; it is the same field under its older name.
--
-- 2. `coach_contexts`. WP2 classified "only 30 minutes today" / "knee hurts" as
--    `kind: coach_context` and then had nowhere to put it — the changelog's open question
--    ("WP5 decides where a day's context lives"). It lives here: one row per statement,
--    dated to the user's local day, read back when the coach is asked that day and never
--    after it. A context that outlives the day is a preference (profiles.preferences),
--    which is a different table on purpose.

ALTER TABLE coach_briefs
	-- The title sentence at the top of the brief.
	ADD COLUMN headline TEXT,
	-- { kind: mark_reached | adjust_goal | weigh_in | close_items, goal_id?, label }
	ADD COLUMN nudge_action JSONB;

CREATE TABLE coach_contexts (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	-- The user's local calendar date, like every other date column in v2.
	date DATE NOT NULL,
	text TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One indexed read per coach ask: "what did they tell me about today?".
CREATE INDEX coach_contexts_user_date_idx ON coach_contexts (user_id, date DESC, created_at);

-- Saying the same thing twice in one day is one context, not two — the confirm endpoint is
-- retried by a phone with no signal, and the fusion ledger only covers a repeated client_id.
CREATE UNIQUE INDEX coach_contexts_unique_idx ON coach_contexts (user_id, date, md5(text));
