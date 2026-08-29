import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { insertEntries, insertWeights } from "../services/entries.js";
import type { LogParser, ParsedItem } from "../services/parseLog.js";

// Free-text logging. The app used to call the `parse-log` edge function and then insert
// the returned items itself with three separate PostgREST calls. Now:
//   POST /api/parse-log { text }  → { items }               parse only (what the edge function did)
//   POST /api/log       { text }  → { items: [{…, id}] }    parse + save, in one transaction
// so a phone that loses signal mid-log never ends up with half of a log saved.

const LogBody = z.object({ text: z.string().trim().min(1).max(2000) });

export type LoggedItem = ParsedItem & { id?: string };

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
		const items = await parser.parse(parsed.data.text);
		if (items.length === 0) {
			res.status(422).json({ error: "Could not understand that." });
			return;
		}

		const meals = items.filter((i) => i.type === "meal");
		const movement = items.filter((i) => i.type === "movement");
		const weights = items.filter((i) => i.type === "weight" && i.weight_lb);

		const client = await pool.connect();
		let ids: { meal: string[]; movement: string[]; weight: string[] };
		try {
			await client.query("BEGIN");
			const userId = req.userId!;
			// Sequential on purpose: one transaction client cannot run queries concurrently.
			const mealRows = await insertEntries(
				client,
				userId,
				"meals",
				meals.map((i) => ({
					description: i.description,
					kcal: i.kcal ?? 0,
					protein_g: i.protein_g ?? null,
					carbs_g: i.carbs_g ?? null,
					fat_g: i.fat_g ?? null,
					fiber_g: i.fiber_g ?? null,
				}))
			);
			const movementRows = await insertEntries(
				client,
				userId,
				"movement",
				movement.map((i) => ({ description: i.description, kcal: i.kcal ?? 0 }))
			);
			const weightRows = await insertWeights(
				client,
				userId,
				weights.map((i) => ({ weight_lb: i.weight_lb! }))
			);
			await client.query("COMMIT");
			ids = {
				meal: mealRows.map((r) => r.id as string),
				movement: movementRows.map((r) => r.id as string),
				weight: weightRows.map((r) => r.id as string),
			};
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		const counters = { meal: 0, movement: 0, weight: 0 };
		const enriched: LoggedItem[] = items.map((item) => {
			if (item.type === "weight" && !item.weight_lb) return { ...item };
			const idx = counters[item.type]++;
			return { ...item, id: ids[item.type][idx] };
		});
		res.status(201).json({ items: enriched });
	});

	return router;
}
