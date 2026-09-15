import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { loadDossierInputs, type ProfileReadings } from "../services/readings/dossier.js";

// The You screen's own endpoint (user decision 2026-08-31 — the dossier).
//
//   GET /api/you?tz=   { date, dossier: { known, missing, model, created_at } | null }
//
// It is NOT part of `GET /api/profile`, and that is the whole reason it exists as a route
// of its own. The profile is invalidated after every confirmed log (lib/queries.ts
// §invalidateAfterLog), so folding a generated paragraph into it would mean a model call
// every time somebody photographed a plate. This is read by one screen, which is opened
// rarely, and answers from cache unless the sheet it was written from has actually moved.
//
// `dossier` is nullable rather than an error: the page draws its constraints, its health
// row and its account with or without the paragraphs, and a provider outage is not a reason
// for the account screen to fail to open.

const YouQuery = z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) });

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

export function youRouter(pool: pg.Pool, readings: ProfileReadings): Router {
	const router = Router();

	router.get("/api/you", async (req: AuthenticatedRequest, res) => {
		const parsed = YouQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);

		const userId = req.userId as string;
		const inputs = await loadDossierInputs(pool, userId, { tzOffsetMin: parsed.data.tz });
		const dossier = await readings.dossier(pool, userId, inputs);

		res.json({
			date: inputs.date,
			dossier: dossier
				? { known: dossier.known, missing: dossier.missing, model: dossier.model, created_at: dossier.created_at }
				: null,
		});
	});

	return router;
}
