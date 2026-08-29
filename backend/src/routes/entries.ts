import { Router, type Response } from "express";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
	EntryPatch,
	NewEntry,
	RangeQuery,
	deleteEntry,
	getEntry,
	insertEntries,
	isKind,
	listEntries,
	updateEntry,
} from "../services/entries.js";
import { z } from "zod";

// /api/entries/:kind — kind is "meals" or "movement" (calorie_expenditure).

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

	router.delete("/api/entries/:kind/:id", async (req: AuthenticatedRequest, res) => {
		const kind = req.params.kind as string;
		if (!isKind(kind)) return;
		const deleted = await deleteEntry(pool, req.userId!, kind, req.params.id as string);
		res.status(deleted ? 204 : 404).end();
	});

	return router;
}
