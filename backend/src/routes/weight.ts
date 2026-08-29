import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { NewWeight, RangeQuery, deleteWeight, getWeight, insertWeights, listWeights } from "../services/entries.js";

export function weightRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/weight", async (req: AuthenticatedRequest, res) => {
		const parsed = RangeQuery.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		res.json(await listWeights(pool, req.userId!, parsed.data));
	});

	router.get("/api/weight/:id", async (req: AuthenticatedRequest, res) => {
		const row = await getWeight(pool, req.userId!, req.params.id as string);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		res.json(row);
	});

	router.post("/api/weight", async (req: AuthenticatedRequest, res) => {
		const parsed = z.union([NewWeight, z.array(NewWeight).min(1).max(50)]).safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		const weights = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
		res.status(201).json(await insertWeights(pool, req.userId!, weights));
	});

	router.delete("/api/weight/:id", async (req: AuthenticatedRequest, res) => {
		const deleted = await deleteWeight(pool, req.userId!, req.params.id as string);
		res.status(deleted ? 204 : 404).end();
	});

	return router;
}
