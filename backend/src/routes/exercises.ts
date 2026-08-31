import { Router } from "express";
import { pipeline } from "node:stream/promises";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { ExerciseMediaStore } from "../ports/exerciseMedia.js";

// The exercise sheet (app/exercise/[id].tsx).
//
//   GET /api/exercises/:id            the catalogue row, its steps and its media urls
//   GET /api/exercises/:id/media/:n   one frame, as a jpeg
//
// The catalogue is shared — every account sees the same rows — so unlike evidence there is
// nothing here to own. It still sits behind /api and therefore behind requireUser: these
// are pictures we host, and hosting them for the open internet is a bandwidth decision
// nobody made. The frames are immutable once imported (a new import writes the same
// bytes), so they carry a year's cache.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Immutable: a frame is only ever rewritten with the same picture. */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

interface CatalogRow {
	id: string;
	name: string;
	aliases: string[];
	category: string;
	primary_muscles: string[];
	secondary_muscles: string[];
	equipment: string[];
	instructions: string[] | null;
	media_count: number;
	source_slug: string | null;
	level: string | null;
}

export function exercisesRouter(pool: pg.Pool, media: ExerciseMediaStore): Router {
	const router = Router();

	async function load(id: string): Promise<CatalogRow | null> {
		if (!UUID.test(id)) return null;
		const { rows } = await pool.query<CatalogRow>(
			`SELECT id, name, aliases, category, primary_muscles, secondary_muscles, equipment,
			        instructions, media_count, source_slug, level
			   FROM exercise_catalog WHERE id = $1`,
			[id]
		);
		return rows[0] ?? null;
	}

	router.get("/api/exercises/:id", async (req: AuthenticatedRequest, res) => {
		const row = await load(req.params.id as string);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		res.json({
			id: row.id,
			name: row.name,
			aliases: row.aliases,
			category: row.category,
			primary_muscles: row.primary_muscles,
			secondary_muscles: row.secondary_muscles,
			equipment: row.equipment,
			// null (never imported) and "matched, but the dataset had no steps" are the same
			// thing to a screen: nothing to number.
			instructions: row.instructions ?? [],
			level: row.level,
			// Relative, so the app can put its own API base in front of it and the response
			// does not have to know how it is reached (LAN, tunnel, dev).
			media: Array.from({ length: row.media_count }, (_unused, index) => ({
				index,
				url: `/api/exercises/${row.id}/media/${index}`,
			})),
			source: row.source_slug ? { dataset: "free-exercise-db", slug: row.source_slug } : null,
		});
	});

	router.get("/api/exercises/:id/media/:n", async (req: AuthenticatedRequest, res) => {
		const row = await load(req.params.id as string);
		const index = Number(req.params.n);
		// A frame the row does not claim is a 404 whether or not a file happens to exist:
		// media_count is the contract the sheet was rendered from.
		if (!row || !Number.isInteger(index) || index < 0 || index >= row.media_count) {
			res.status(404).json({ error: "Not found." });
			return;
		}

		let stream;
		try {
			stream = await media.get(row.id, index);
		} catch (error) {
			// The row outlived its bytes — a volume restored without the media directory.
			console.error(`⚠️  Exercise ${row.id} frame ${index} is missing:`, error);
			res.status(404).json({ error: "Not found." });
			return;
		}

		res.setHeader("Content-Type", "image/jpeg");
		res.setHeader("Cache-Control", CACHE_CONTROL);
		res.setHeader("ETag", `"${row.id}-${index}"`);
		await pipeline(stream, res);
	});

	return router;
}
