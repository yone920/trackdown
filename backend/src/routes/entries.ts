import { Router, type Response } from "express";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
	EntryPatch,
	NewEntry,
	RangeQuery,
	SplitEntry,
	deleteEntry,
	getEntry,
	insertEntries,
	isKind,
	listEntries,
	splitEntry,
	updateEntry,
} from "../services/entries.js";
import { z } from "zod";

// /api/entries/:kind — kind is "meals" or "movement". Since 0004_v2.sql "movement" is an
// alias over the `activities` table, and POST/PATCH also accept the v2 activity fields
// (exercise, sets, reps, load_lb, …); see services/entries.ts.

function badRequest(res: Response, error: z.ZodError) {
	res.status(400).json({ error: "Invalid request.", issues: error.issues });
}

export function entriesRouter(pool: pg.Pool): Router {
	const router = Router();

	router.param("kind", (req, res, next, kind: string) => {
		if (!isKind(kind)) {
			res.status(404).json({ error: `Unknown entry kind "${kind}".` });
			return;
		}
		next();
	});

	router.get("/api/entries/:kind", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const parsed = RangeQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, parsed.error);
		res.json(await listEntries(pool, req.userId!, kind, parsed.data));
	});

	router.get("/api/entries/:kind/:id", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const row = await getEntry(pool, req.userId!, kind, req.params.id as string);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		res.json(row);
	});

	router.post("/api/entries/:kind", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const parsed = z.union([NewEntry, z.array(NewEntry).min(1).max(50)]).safeParse(req.body);
		if (!parsed.success) return badRequest(res, parsed.error);
		const entries = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
		res.status(201).json(await insertEntries(pool, req.userId!, kind, entries));
	});

	router.patch("/api/entries/:kind/:id", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const parsed = EntryPatch.safeParse(req.body);
		if (!parsed.success) return badRequest(res, parsed.error);
		const row = await updateEntry(pool, req.userId!, kind, req.params.id as string, parsed.data);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		res.json(row);
	});

	/**
	 * One told change that replaces one record with several (migration 0018). Only on
	 * "movement": a load that changed partway through the sets is the whole reason this
	 * exists, and a meal has no equivalent — a plate read wrong is one plate read wrong.
	 *
	 * Separate from PATCH rather than a flag on it, because a PATCH moves the fields of one
	 * row and this one creates rows. Both are the same act to the user — they said what was
	 * wrong and the app fixed it — and that is exactly why the difference belongs in the
	 * URL rather than in a branch inside the patch handler.
	 */
	router.post("/api/entries/:kind/:id/split", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		if (kind !== "movement") {
			res.status(404).json({ error: "Only an exercise record can be split." });
			return;
		}
		const parsed = SplitEntry.safeParse(req.body);
		if (!parsed.success) return badRequest(res, parsed.error);
		const rows = await splitEntry(pool, req.userId!, req.params.id as string, parsed.data);
		if (!rows) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		res.status(201).json({ records: rows });
	});

	router.delete("/api/entries/:kind/:id", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const deleted = await deleteEntry(pool, req.userId!, kind, req.params.id as string);
		res.status(deleted ? 204 : 404).end();
	});

	return router;
}
