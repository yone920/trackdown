-- WP4 — goals and profile by talking (docs/build-plan.md §WP4).
--
-- 0004 gave `goals` everything a spec needs plus `reached_candidate_at`, which WP4's
-- detection now writes. Two things were missing.
--
-- 1. `stalled_since` — the other half of the same job. concept-v2 §Goals: "a stalled
--    outcome goal (no movement for 3 weeks) becomes the coach's nudge with an offer to
--    adjust". Like `reached_candidate_at` this is a *candidate*, not a state change: a
--    goal is never auto-closed, so the status stays 'active' and the coach (WP5) is the
--    one that asks. A DATE, not a timestamp, because it names the day the measure last
--    moved and is compared against local calendar dates.
--
-- 2. A dropped goal needs to stop judging days *after* it was dropped and go on judging
--    the ones it was live for (concept-v2 §Goals: "every closed day is judged against the
--    goal active that day"). WP3 could not do that — nothing recorded *when* a goal was
--    dropped, so services/day.ts filtered `status <> 'dropped'` and a dropped goal
--    vanished from its own history. WP4's PATCH sets `active_to` on every closing status,
--    and the day model now judges by the date window alone. The backfill below gives the
--    goals dropped before this migration an end date, so they do not judge forever.

ALTER TABLE goals
	ADD COLUMN stalled_since DATE;

-- Rows dropped/reached/expired under the old code have no end date. `stated_at` is when
-- the goal was last spoken about, which is the closest thing to "when it stopped" that
-- this schema recorded; `active_from` is the floor, since a goal cannot end before it began.
UPDATE goals
   SET active_to = GREATEST(active_from, stated_at::date)
 WHERE status <> 'active' AND active_to IS NULL;

-- GET /api/goals reads the history list by user and end date; the active list is already
-- served by goals_user_status_idx.
CREATE INDEX goals_user_history_idx ON goals (user_id, active_to DESC NULLS LAST);
