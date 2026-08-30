import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { ProfilePatch, updateProfile } from "../services/entries.js";
import { profileView } from "../services/profile.js";

// The plan (docs/build-plan.md §WP4; docs/design-system.md §Goals — the account rows under
// the goals list). GET returns the row *and* the numbers it works out to, so the app stops
// deriving its own TDEE; PATCH merges, dating every field it touches.

const ProfileQuery = z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) });

export function profileRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/profile", async (req: AuthenticatedRequest, res) => {
		const parsed = ProfileQuery.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		res.json(await profileView(pool, req.userId!, { tzOffsetMin: parsed.data.tz }));
	});

	router.patch("/api/profile", async (req: AuthenticatedRequest, res) => {
		const parsed = ProfilePatch.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		await updateProfile(pool, req.userId!, parsed.data);
		// The derived targets move with the plan, so the answer is the same shape GET
		// returns — one round trip for the screen that just edited a row.
		res.json(await profileView(pool, req.userId!));
	});

	return router;
}
