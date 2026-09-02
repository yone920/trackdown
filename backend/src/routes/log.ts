import { randomUUID } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { saveConfirmed } from "../services/fusion/confirm.js";
import type { FusionResult } from "../services/fusion/schema.js";
import type { LogParser, ParsedItem } from "../services/parseLog.js";

// Free-text logging — v1's endpoints, still the ones the shipped app calls:
//   POST /api/parse-log { text }  → { items }             parse only
//   POST /api/log       { text }  → { items: [{…, id}] }  parse + save, one transaction
//
// Since WP2 the *saving* half is the fusion pipeline: each parsed item becomes a
// FusionResult and goes through services/fusion/confirm.ts, so there is one place that
// knows how a meal, an activity or a weight is written, and the typed line is kept as
// evidence like any other log. Request and response shapes are untouched — WP6 replaces
// these screens with /api/log/analyze and /api/log/confirm.
//
// Why the parser stays: a typed log is routinely several things at once ("protein shake
// after my 30 min walk, 181 on the scale"), and the fusion schema is a discriminated
// union — one log, one kind. Sending this text through /api/log/analyze would throw two
// of those three items away. The parser's job is the multi-item split; confirm's job is
// the write.

const LogBody = z.object({ text: z.string().trim().min(1).max(2000) });

export type LoggedItem = ParsedItem & { id?: string };

/** One parsed item as the fusion pipeline sees it. */
function toFusionResult(item: ParsedItem): FusionResult | null {
	switch (item.type) {
		case "movement":
			return {
				kind: "activities",
				items: [
					{
						exercise: null,
						equipment: null,
						description: item.description,
						category: null,
						muscle_groups: null,
						sets: null,
						reps: null,
						load_lb: null,
						duration_min: null,
						distance_mi: null,
						kcal: item.kcal ?? 0,
						confidence: item.confidence,
						// Typed, not read off a photo.
						sources: null,
						// A typed line the v1 parser split has no catalogue guess behind it.
						refine: null,
					},
				],
			};
		case "meal":
			return {
				kind: "meal",
				description: item.description,
				meal_type: null,
				kcal: item.kcal ?? 0,
				protein_g: item.protein_g ?? null,
				carbs_g: item.carbs_g ?? null,
				fat_g: item.fat_g ?? null,
				fiber_g: item.fiber_g ?? null,
				items: [],
				confidence: item.confidence,
				sources: null,
				// The v1 parser reads a typed line, never macros off a label: the
				// arithmetic gate has nothing to have said about it.
				consistency: null,
			};
		case "weight":
			// v1 allowed a weight item with no number; there is nothing to save in that.
			return item.weight_lb
				? { kind: "weight", weight_lb: item.weight_lb, confidence: item.confidence, sources: null, check: null }
				: null;
	}
}

export function logRouter(pool: pg.Pool, parser: LogParser): Router {
	const router = Router();

	router.post("/api/parse-log", async (req: AuthenticatedRequest, res) => {
		const parsed = LogBody.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Say something first." });
			return;
		}
		const items = await parser.parse(parsed.data.text);
		res.json({ items });
	});

	router.post("/api/log", async (req: AuthenticatedRequest, res) => {
		const parsed = LogBody.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Say something first." });
			return;
		}
		const text = parsed.data.text;
		const items = await parser.parse(text);
		if (items.length === 0) {
			res.status(422).json({ error: "Could not understand that." });
			return;
		}

		const client = await pool.connect();
		const enriched: LoggedItem[] = [];
		try {
			await client.query("BEGIN");
			const userId = req.userId!;
			let keptText = false;
			// Sequential on purpose: one transaction client cannot run queries concurrently.
			for (const item of items) {
				const result = toFusionResult(item);
				if (!result) {
					enriched.push({ ...item });
					continue;
				}
				const saved = await saveConfirmed(client, userId, {
					client_id: randomUUID(),
					results: [result],
					evidence_ids: [],
					evidence_parts: [],
					corrections: [],
					// The typed line is the provenance for the whole log, so it is kept
					// once and hung off the first thing it produced.
					...(keptText ? {} : { text }),
					text_kind: "text",
					source: "manual",
				});
				keptText = true;
				const row = saved.activities[0] ?? saved.meal ?? saved.weight;
				enriched.push({ ...item, ...(row?.id ? { id: row.id as string } : {}) });
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		res.status(201).json({ items: enriched });
	});

	return router;
}
