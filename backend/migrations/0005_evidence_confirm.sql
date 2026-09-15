-- WP2 — evidence storage + the fusion endpoints (docs/build-plan.md §WP2).
--
-- Two additions on top of 0004_v2.sql, both additive:
--   1. evidence.confirmed_at — photos are uploaded and stored by POST /api/log/analyze
--      *before* the user confirms anything, so the table always holds rows that own
--      nothing yet. `confirmed_at` is what separates "still waiting for a confirm" from
--      "kept on purpose": weight, constraint and coach-context evidence has no owner
--      column to point at, so absence of an owner id cannot be the sweep's test.
--   2. log_confirmations — the idempotency ledger for POST /api/log/confirm. The phone
--      may retry a confirm it never saw the answer to; the second attempt must return the
--      first attempt's rows rather than log the workout twice.

ALTER TABLE evidence ADD COLUMN confirmed_at TIMESTAMPTZ;

-- The sweep's query: unconfirmed rows older than 24 h, oldest first.
CREATE INDEX evidence_unconfirmed_idx ON evidence (created_at) WHERE confirmed_at IS NULL;

CREATE TABLE log_confirmations (
	user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
	-- The uuid the client minted for this log, before it had a network connection.
	client_id UUID NOT NULL,
	-- The exact response the first attempt returned, replayed verbatim to a retry.
	result JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (user_id, client_id)
);
