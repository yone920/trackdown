import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { loadBoard } from "../services/training/board.js";
import { loadExerciseHistory } from "../services/training/history.js";

// The training board (user decision 2026-08-31 — the Progress tab, training first class).
//
//   GET /api/training/board?tz=              one row per regularly-logged exercise, with the
//                                            coach's own next step on it, plus frequency,
//                                            cardio and body.
//   GET /api/training/exercise?name=&tz=     one exercise, all of it: every session ever
//                                            logged, newest first, with the same next step
//                                            the board's row carries (field report
//                                            2026-09-02: "the historic loads, the progress
//                                            of the load … which direction I'm going").
//
// It is a read of what has been logged and a call into the same progression engine the
// brief uses (services/training/board.ts): no model, no cache, nothing written. That is
// why it is not on /api/coach — a board that cost a model call could not be the thing a
// tab draws on open.

const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);
const BoardQuery = z.object({ tz: tzOffset });
const HistoryQuery = z.object({ tz: tzOffset, name: z.string().trim().min(1).max(120) });

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

	/**
	 * One exercise's history. Keyed by NAME rather than by catalogue id, because that is
	 * what a logged row carries — a movement the catalogue has never heard of still has a
	 * history, and it is the one a user is most likely to want to check.
	 */
	router.get("/api/training/exercise", async (req: AuthenticatedRequest, res) => {
		const parsed = HistoryQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const history = await loadExerciseHistory(pool, req.userId as string, {
			exercise: parsed.data.name,
			tzOffsetMin: parsed.data.tz,
		});
		if (!history) {
			res.status(404).json({ error: "Nothing logged for that exercise." });
			return;
		}
		res.json(history);
	});

	return router;
}
