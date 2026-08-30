import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { CoachPort } from "../ports/coach.js";
import { CoachUnavailableError, coachDate, nextBrief } from "../services/coach/coach.js";
import { closeDueDays } from "../services/dayClose.js";
import type { DayReadings } from "../services/readings/readings.js";

// The coach (docs/build-plan.md §WP5).
//
//   GET  /api/coach/next?tz=&context=   today's brief — cached, or generated on this ask
//   POST /api/coach/next/regenerate     the same, always generated
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

const NextQuery = z.object({ tz: tzOffset, context: contextText.optional() });
const RegenerateBody = z.object({
	tz_offset_min: z.number().int().min(-840).max(840).default(0),
	context: contextText.nullable().optional(),
});

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

export function coachRouter(pool: pg.Pool, coach: CoachPort, readings: DayReadings): Router {
	const router = Router();

	async function respond(
		res: Response,
		userId: string,
		{ tzOffsetMin, context, regenerate }: { tzOffsetMin: number; context: string | null; regenerate: boolean }
	): Promise<void> {
		const now = new Date();
		await closeDueDays(pool, readings, { userId, tzOffsetMin, now });

		const date = coachDate(now, tzOffsetMin);
		try {
			const { brief, inputs, stale } = await nextBrief(pool, coach, userId, {
				date,
				tzOffsetMin,
				now,
				context,
				regenerate,
			});
			res.json({
				brief,
				stale,
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
				res.status(503).json({ error: `The coach is unavailable right now: ${error.message}` });
				return;
			}
			throw error;
		}
	}

	router.get("/api/coach/next", async (req: AuthenticatedRequest, res) => {
		const parsed = NextQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		await respond(res, req.userId as string, {
			tzOffsetMin: parsed.data.tz,
			context: parsed.data.context ?? null,
			regenerate: false,
		});
	});

	router.post("/api/coach/next/regenerate", async (req: AuthenticatedRequest, res) => {
		const parsed = RegenerateBody.safeParse(req.body ?? {});
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		await respond(res, req.userId as string, {
			tzOffsetMin: parsed.data.tz_offset_min,
			context: parsed.data.context ?? null,
			regenerate: true,
		});
	});

	return router;
}
