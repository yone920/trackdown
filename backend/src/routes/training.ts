import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { loadBoard } from "../services/training/board.js";

// The training board (user decision 2026-08-31 — the Progress tab, training first class).
//
//   GET /api/training/board?tz=   one row per regularly-logged exercise, with the coach's
//                                 own next step on it, plus frequency, cardio and body.
//
// It is a read of what has been logged and a call into the same progression engine the
// brief uses (services/training/board.ts): no model, no cache, nothing written. That is
// why it is not on /api/coach — a board that cost a model call could not be the thing a
// tab draws on open.

const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);
const BoardQuery = z.object({ tz: tzOffset });

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

export function trainingRouter(pool: pg.Pool): Router {
	const router = Router();

	router.get("/api/training/board", async (req: AuthenticatedRequest, res) => {
		const parsed = BoardQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		res.json(await loadBoard(pool, req.userId as string, { tzOffsetMin: parsed.data.tz }));
	});

	return router;
}
