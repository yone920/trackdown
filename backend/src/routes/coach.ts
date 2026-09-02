import { Router, type Request, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { setServerTiming, timePhase } from "../middleware/timing.js";
import type { CoachPort } from "../ports/coach.js";
import { briefStatus, CoachUnavailableError, coachDate, nextBrief, standingBrief } from "../services/coach/coach.js";
import { closeDueDays } from "../services/dayClose.js";
import type { DayReadings } from "../services/readings/readings.js";

// The coach (docs/build-plan.md §WP5).
//
//   GET  /api/coach/status?tz=          does today have a plan, and how far through is it —
//                                       an exists-check; it can never generate anything
//   GET  /api/coach/next?tz=&context=   today's brief. `generate=false` reads the standing
//                                       one and answers `brief: null` when there is none
//   POST /api/coach/next/regenerate     the same, always generated; with `revision` it is
//                                       today's brief changed to the user's instruction,
//                                       appended to or replaced according to `mode`
//
// **Opening a screen never generates a brief** (user decision 2026-08-31 §2). It used to:
// a plain GET with no brief for the day made one, so merely opening the Coach page wrote
// the day's standing answer, and Today's button had no way to ask whether there was a plan
// without creating one. `generate=false` and `/status` are the two read-only doors, and
// neither is handed the `CoachPort` on the path that serves it.
//
// **Nothing else in this codebase produces a brief.** There is no job, no scheduler and no
// notification: concept-v2 §Principles 5 makes "the coach is a button" a product decision,
// and a background generator would quietly turn it back into a schedule. If you are adding
// one, that is the line you are crossing.
//
// The day close runs first, like every other day-shaped route: a brief asked at 00:05 must
// be about today, and yesterday's record has to exist before it can be advised against.

/** Minutes to add to UTC for local time. ±14 h covers every real zone. */
const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);

/** What the user can say when asking. Two sentences of context, not an essay. */
const contextText = z.string().trim().max(500);

/**
 * A query-string boolean. `z.coerce.boolean()` is no use here — every non-empty string is
 * true under it, "false" included — so the two words are spelled out.
 */
const boolParam = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");

const NextQuery = z.object({
	tz: tzOffset,
	context: contextText.optional(),
	/**
	 * Whether this ask may cost a model call. **Defaults to true**, which is the old
	 * behaviour and is deliberate: an app built before this field existed still asks the
	 * question it always asked, and gets the answer it always got. The app sends
	 * `generate=false` on the page load and nothing else does.
	 */
	generate: boolParam.default(true),
});

const StatusQuery = z.object({ tz: tzOffset });

const RegenerateBody = z.object({
	tz_offset_min: z.number().int().min(-840).max(840).default(0),
	context: contextText.nullable().optional(),
	/**
	 * A change to the brief the user is looking at — "make it 8 exercises", "switch to
	 * legs", "harder". Different from `context`: context is a fact about today that the
	 * next brief should account for; a revision is an instruction about the answer itself,
	 * and the model is handed the current brief to change.
	 */
	revision: contextText.nullable().optional(),
	/**
	 * Which of the plan's two explicit buttons this came from (user decision 2026-08-31 §3).
	 * `"append"` is *Add to today's plan*, `"rewrite"` is *Replace today's plan* behind its
	 * confirmation tap; absent is the free-text box, where the model reads the sentence and
	 * decides. A mode the user chose is not the model's to overrule.
	 */
	mode: z.enum(["append", "rewrite"]).nullable().optional(),
});

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

export function coachRouter(pool: pg.Pool, coach: CoachPort, readings: DayReadings): Router {
	const router = Router();

	async function respond(
		req: Request,
		res: Response,
		userId: string,
		{
			tzOffsetMin,
			context,
			regenerate,
			revision = null,
			revisionMode = null,
		}: {
			tzOffsetMin: number;
			context: string | null;
			regenerate: boolean;
			revision?: string | null;
			revisionMode?: "append" | "rewrite" | null;
		}
	): Promise<void> {
		const now = new Date();
		await timePhase(req, "close", () => closeDueDays(pool, readings, { userId, tzOffsetMin, now }));

		const date = coachDate(now, tzOffsetMin);
		try {
			// Timed, because until now there was NO WAY to say how long a brief takes: the
			// coach route emitted nothing, and when a generation outran the phone's patience
			// (field report 2026-09-02) the logs could not say whether it had been slow or
			// merely unlucky. This changes no behaviour — it writes a response header —
			// and it is the difference between diagnosing the next one and guessing at it.
			const { brief, inputs, stale, note } = await timePhase(req, regenerate ? "generate" : "brief", () =>
				nextBrief(pool, coach, userId, {
					date,
					tzOffsetMin,
					now,
					context,
					regenerate,
					revision,
					revisionMode,
				})
			);
			setServerTiming(req, res);
			res.json({
				brief,
				stale,
				// Set only when `stale` is a fallback rather than a cache hit: the one line
				// the Coach screen prints above the brief it kept.
				note,
				// The app renders the gap and the nudge's button from these; they are computed,
				// so it never has to parse them back out of the model's sentences.
				gap: inputs.rules.gap,
				nudge_action: brief.nudge_action,
				goals: inputs.goals.map((goal) => ({
					id: goal.id,
					title: goal.title,
					priority: goal.priority,
					reached_candidate_at: goal.reached_candidate_at,
					stalled_since: goal.stalled_since,
				})),
			});
		} catch (error) {
			if (error instanceof CoachUnavailableError) {
				// No brief at all and no way to make one: say so rather than 500. The Coach
				// screen shows the retry, and every other screen is unaffected.
				res.status(503).json({ error: `The coach is unavailable right now: ${(error.message.split("\n")[0] ?? error.message).slice(0, 160)}` });
				return;
			}
			throw error;
		}
	}

	/**
	 * Does today have a plan, and how far through is it — the Today button's whole question
	 * (user decision 2026-08-31 §1).
	 *
	 * `coach` is in scope and is not used, and that is the point: the button asking whether
	 * there is a plan must not be the thing that creates one. There is no day close here
	 * either — a close writes yesterday's reading, and drawing a button is not a reason to
	 * write anything. Both are read in full by the Coach screen when the user actually opens it.
	 */
	router.get("/api/coach/status", async (req: AuthenticatedRequest, res) => {
		const parsed = StatusQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const now = new Date();
		const tzOffsetMin = parsed.data.tz;
		res.json(
			await briefStatus(pool, req.userId as string, { date: coachDate(now, tzOffsetMin), tzOffsetMin, now })
		);
	});

	router.get("/api/coach/next", async (req: AuthenticatedRequest, res) => {
		const parsed = NextQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const userId = req.userId as string;
		const tzOffsetMin = parsed.data.tz;

		// The page load. It reads the standing brief and answers `brief: null` when there is
		// none, so the screen can draw its own "What should I do today?" button rather than
		// having the answer written for it by the act of looking (user decision §2).
		if (!parsed.data.generate) {
			const now = new Date();
			await timePhase(req, "close", () => closeDueDays(pool, readings, { userId, tzOffsetMin, now }));
			const date = coachDate(now, tzOffsetMin);
			// Named apart from "generate" on purpose: this path cannot write a brief, and a
			// cache hit that looked like a generation in the timings would be the same
			// confusion the header exists to end.
			const { brief, inputs, stale } = await timePhase(req, "brief", () =>
				standingBrief(pool, userId, {
					date,
					tzOffsetMin,
					now,
					context: parsed.data.context ?? null,
				})
			);
			setServerTiming(req, res);
			res.json({
				brief,
				stale,
				note: null,
				gap: inputs.rules.gap,
				nudge_action: brief?.nudge_action ?? null,
				goals: inputs.goals.map((goal) => ({
					id: goal.id,
					title: goal.title,
					priority: goal.priority,
					reached_candidate_at: goal.reached_candidate_at,
					stalled_since: goal.stalled_since,
				})),
			});
			return;
		}

		await respond(req, res, userId, {
			tzOffsetMin,
			context: parsed.data.context ?? null,
			regenerate: false,
		});
	});

	router.post("/api/coach/next/regenerate", async (req: AuthenticatedRequest, res) => {
		const parsed = RegenerateBody.safeParse(req.body ?? {});
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		await respond(req, res, req.userId as string, {
			tzOffsetMin: parsed.data.tz_offset_min,
			context: parsed.data.context ?? null,
			regenerate: true,
			revision: parsed.data.revision ?? null,
			revisionMode: parsed.data.mode ?? null,
		});
	});

	return router;
}
