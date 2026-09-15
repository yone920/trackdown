import { Router } from "express";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { ProfilePatch, updateProfile } from "../services/entries.js";
import { profileView } from "../services/profile.js";

// The plan (docs/build-plan.md §WP4; docs/design-system.md §Goals — the account rows under
// the goals list). GET returns the row; PATCH merges, dating every field it touches.

export function profileRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/profile", async (req: AuthenticatedRequest, res) => {
		res.json(await profileView(pool, req.userId!));
	});

	router.patch("/api/profile", async (req: AuthenticatedRequest, res) => {
		const parsed = ProfilePatch.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		await updateProfile(pool, req.userId!, parsed.data);
		// One round trip for the screen that just edited a row.
		res.json(await profileView(pool, req.userId!));
	});

	return router;
}
