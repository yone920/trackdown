import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { computeDay } from "../services/day.js";
import { eatingDays, summarise, type EatingTargets } from "../services/eating/features.js";
import { activeGoals } from "../services/goals/store.js";
import { getProfile } from "../services/entries.js";
import { isIsoDate, localDay, type IsoDate } from "../services/localTime.js";
import type { DayReadings } from "../services/readings/readings.js";

// The Eat page, in one request (user decision 2026-09-01).
//
//   GET /api/eating?tz=   today's numbers, the computed week, the written direction
//
// Three layers and only the middle one is arithmetic — but the FIRST one is the day's own
// arithmetic and it is the same arithmetic Today shows, because it comes from the same
// `computeDay`. Two calorie figures that disagree on two screens is the bug this whole page
// was reorganised around; there is one source and this route reads it.
//
// The direction paragraph is a READING: cached against the week's inputs hash, so opening
// this page when nothing has changed costs nothing and generates nothing. That is the
// contract the page is built on, and it is why the paragraph lives in `day_readings`
// rather than anywhere near the coach.

const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);
const EatingQuery = z.object({
	tz: tzOffset,
	date: z.string().optional(),
	/**
	 * The safe door. A plain GET writes the direction paragraph when the cache is cold, and
	 * a reading is one-per-day state like any other — so anything auditing this account
	 * without changing it (a support session, an agent verifying a deploy) asks with
	 * `generate=false` and gets whatever is stored, or null.
	 *
	 * The same pair the coach has, for the same reason: without it there is no way to look
	 * at this page without writing to it.
	 */
	generate: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value !== "false"),
});

function badRequest(res: Response, message: string): void {
	res.status(400).json({ error: message });
}

export function eatingRouter(pool: pg.Pool, readings: DayReadings): Router {
	const router = Router();

	router.get("/api/eating", async (req: AuthenticatedRequest, res) => {
		const parsed = EatingQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.");
		const { tz } = parsed.data;
		const userId = req.userId!;

		const date: IsoDate =
			parsed.data.date && isIsoDate(parsed.data.date)
				? (parsed.data.date as IsoDate)
				: (localDay(new Date(), tz).date as IsoDate);

		const [view, profile, goals] = await Promise.all([
			computeDay(pool, { userId, date, tzOffsetMin: tz }),
			getProfile(pool, userId),
			activeGoals(pool, userId),
		]);

		const goal = goals[0] ?? null;
		// **Only what the user actually SAID counts as stated.** The day view's macro targets
		// are derived — the server works them out from the profile and the TDEE — and handing
		// one of those back as "your aim" is the thing the whole `source` field exists to
		// prevent (readings/prompt.ts: "never hand a default back to the user as their own").
		// So the week is measured against the profile's own columns; where there is nothing,
		// features.ts derives protein from body weight and stands the fibre guideline in, and
		// each says which it did.
		//
		// Layer 1 is untouched by this: today's numbers come off `view.macros` exactly as
		// Today's own row does, because two screens must never disagree about one day.
		const targets: EatingTargets = {
			protein_g: (profile?.protein_g as number | null) ?? null,
			carbs_max_g: (profile?.carbs_max_g as number | null) ?? null,
			// Nobody states a fat or fibre aim today; both columns would be here if they did.
			fat_g: null,
			fiber_g: null,
			weight_lb: view.weight.avg_7d ?? view.weight.day ?? null,
			losing: goal?.kind === "lose_fat",
		};

		const week = summarise(await eatingDays(pool, userId, date, tz), targets);

		const direction = parsed.data.generate
			? await readings.eatingDirection(pool, userId, date, {
					week,
					goal: goal?.title ?? null,
					weight_lb: targets.weight_lb,
					diet_style: (profile?.diet_style as string | null) ?? null,
					preferences: asList(profile?.preferences),
					constraints: asList(profile?.constraints),
				})
			: await readings.cached(pool, userId, date, "eating_direction");

		res.json({
			date,
			/** Today's own numbers — the same arithmetic Today's compact Eat row shows. */
			today: {
				eaten: view.eaten,
				target: view.target,
				allowance: view.allowance,
				remaining: view.allowance == null ? null : Math.round(view.allowance - view.eaten),
				status: view.status,
				macros: view.macros,
				meals: view.items.meals,
				eating_pattern: view.eating_pattern,
			},
			week,
			direction,
		});
	});

	return router;
}

/** A jsonb text[] column, as a list, however the driver handed it back. */
function asList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}
