import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { GoalMetricSchema, GoalSpecSchema } from "../services/fusion/schema.js";
import {
	GOAL_STATUSES,
	InvalidGoalError,
	createGoal,
	getGoal,
	goalProgress,
	listGoals,
	reorderGoals,
	updateGoal,
} from "../services/goals/store.js";
import { localDay } from "../services/localTime.js";

// Goals (docs/build-plan.md §WP4; docs/design-system.md §Goals, §Progress).
//
//   GET   /api/goals              active goals in priority order + history with outcomes
//   POST  /api/goals              a spec → validated, projected, saved active
//   PATCH /api/goals/:id          edit, reprioritise, or end (reached | dropped | expired)
//   POST  /api/goals/reorder      the user's order, as 1…n
//   GET   /api/goals/:id/progress per-metric current / target / % and the trend series
//
// The proposal is computed on the server for every path (services/goals/proposal.ts), so
// the date on the confirm card, the date in the row and the date the Goals screen shows
// are the same date. What the routes add on top is the user's decision about it:
// `confirm_date` keeps their own date even when the safe rate says otherwise, `no_date`
// saves a goal with no finish line at all.

/** Minutes to add to UTC for local time — day boundaries are the user's midnight. */
const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);

const GoalsQuery = z.object({ tz: tzOffset });

// The same schemas the confirm card speaks, with the facts the app cannot know made
// optional: a goal typed into the Goals screen has no reason to send `unit: null` for
// every metric. Derived from GoalMetricSchema / GoalSpecSchema rather than written out
// again, so the two paths cannot drift apart.
const MetricInput = GoalMetricSchema.partial({ scope: true, target: true, unit: true, rate: true, by: true });
const SpecInput = GoalSpecSchema.extend({ metrics: z.array(MetricInput).max(6) }).partial({
	active_from: true,
	active_to: true,
});

const CreateBody = z.object({
	spec: SpecInput,
	/** Keep the date the user named, even when the projection calls it unrealistic. */
	confirm_date: z.boolean().optional(),
	/** Save it open-ended: "no date" is a legitimate answer to the proposal. */
	no_date: z.boolean().optional(),
	tz_offset_min: z.number().int().min(-840).max(840).optional(),
});

const PatchBody = z
	.object({
		title: z.string().trim().min(1).max(200),
		metrics: z.array(MetricInput).max(6),
		priority: z.number().int().min(1).max(99),
		status: z.enum(GOAL_STATUSES),
		active_to: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
			.nullable(),
		tz_offset_min: z.number().int().min(-840).max(840).optional(),
	})
	.partial()
	.refine((patch) => Object.keys(patch).some((key) => key !== "tz_offset_min"), { message: "Empty patch." });

const ReorderBody = z.object({
	/** Active goal ids, most important first. */
	ids: z.array(z.uuid()).min(1).max(20),
});

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

export function goalsRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/goals", async (req: AuthenticatedRequest, res) => {
		const parsed = GoalsQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		res.json(await listGoals(pool, req.userId!, { tzOffsetMin: parsed.data.tz }));
	});

	router.post("/api/goals", async (req: AuthenticatedRequest, res) => {
		const parsed = CreateBody.safeParse(req.body);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const { spec, confirm_date, no_date, tz_offset_min } = parsed.data;
		try {
			const created = await createGoal(pool, req.userId!, {
				spec,
				...(confirm_date === undefined ? {} : { confirmDate: confirm_date }),
				...(no_date === undefined ? {} : { noDate: no_date }),
				...(tz_offset_min === undefined ? {} : { tzOffsetMin: tz_offset_min }),
			});
			res.status(201).json(created);
		} catch (error) {
			if (error instanceof InvalidGoalError) return badRequest(res, error.message);
			throw error;
		}
	});

	router.post("/api/goals/reorder", async (req: AuthenticatedRequest, res) => {
		const parsed = ReorderBody.safeParse(req.body);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		try {
			res.json({ active: await reorderGoals(pool, req.userId!, parsed.data.ids) });
		} catch (error) {
			if (error instanceof InvalidGoalError) return badRequest(res, error.message);
			throw error;
		}
	});

	router.patch("/api/goals/:id", async (req: AuthenticatedRequest, res) => {
		const parsed = PatchBody.safeParse(req.body);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const { tz_offset_min, ...patch } = parsed.data;
		try {
			const goal = await updateGoal(pool, req.userId!, req.params.id as string, patch, {
				...(tz_offset_min === undefined ? {} : { tzOffsetMin: tz_offset_min }),
			});
			// Someone else's goal is a 404, not a 403: the id is not ours to confirm.
			if (!goal) {
				res.status(404).json({ error: "No such goal." });
				return;
			}
			res.json(goal);
		} catch (error) {
			if (error instanceof InvalidGoalError) return badRequest(res, error.message);
			throw error;
		}
	});

	router.get("/api/goals/:id/progress", async (req: AuthenticatedRequest, res) => {
		const parsed = GoalsQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const tzOffsetMin = parsed.data.tz;
		const goal = await getGoal(pool, req.userId!, req.params.id as string);
		if (!goal) {
			res.status(404).json({ error: "No such goal." });
			return;
		}
		const progress = await goalProgress(pool, req.userId!, goal, { tzOffsetMin });
		res.json({ goal, ...progress, today: localDay(new Date(), tzOffsetMin).date });
	});

	return router;
}
