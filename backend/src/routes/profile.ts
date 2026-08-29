import { Router } from "express";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { ProfilePatch, getProfile, updateProfile } from "../services/entries.js";

export function profileRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/profile", async (req: AuthenticatedRequest, res) => {
		res.json(await getProfile(pool, req.userId!));
	});

	router.patch("/api/profile", async (req: AuthenticatedRequest, res) => {
		const parsed = ProfilePatch.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		res.json(await updateProfile(pool, req.userId!, parsed.data));
	});

	return router;
}
