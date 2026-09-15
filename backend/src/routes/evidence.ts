import { Router } from "express";
import { pipeline } from "node:stream/promises";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { EvidenceStore } from "../ports/storage.js";
import { getOwnedEvidence } from "../services/evidence.js";

// GET /api/evidence/:id — the authenticated photo route. The uploads volume is never
// served statically: a key is unguessable but a key is not a permission, and the day view
// links to these from a phone that is already carrying a session token.
//
// Someone else's id is a 404, not a 403: "this exists but is not yours" is information.

/** Photos are immutable once stored — a correction uploads a new one. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

export function evidenceRouter(pool: pg.Pool, store: EvidenceStore): Router {
	const router = Router();

	router.get("/api/evidence/:id", async (req: AuthenticatedRequest, res) => {
		const row = await getOwnedEvidence(pool, req.userId!, req.params.id as string);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		if (!row.storage_key) {
			// A transcript or a typed note: it has text, not a file.
			res.status(404).json({ error: "This evidence has no stored file." });
			return;
		}

		let stream;
		try {
			stream = await store.get(row.storage_key);
		} catch (error) {
			// The row outlived its bytes — a half-finished restore, a hand-edited volume.
			console.error(`⚠️  Evidence ${row.id} has no file at ${row.storage_key}:`, error);
			res.status(404).json({ error: "Not found." });
			return;
		}

		res.setHeader("Content-Type", row.mime ?? "application/octet-stream");
		res.setHeader("Cache-Control", CACHE_CONTROL);
		res.setHeader("ETag", `"${row.id}"`);
		await pipeline(stream, res);
	});

	return router;
}
