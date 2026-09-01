import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pg from "pg";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { setServerTiming, timePhase } from "../middleware/timing.js";
import type { ExerciseMediaStore } from "../ports/exerciseMedia.js";
import { parseExerciseMediaWidth, resizeToWidth } from "../services/images.js";

// The exercise sheet (app/exercise/[id].tsx).
//
//   GET /api/exercises/:id                 the catalogue row, its steps and its media urls
//   GET /api/exercises/:id/media/:n[?w=]   one frame, as a jpeg, optionally narrower
//
// The catalogue is shared — every account sees the same rows — so unlike evidence there is
// nothing here to own. It still sits behind /api and therefore behind requireUser: these
// are pictures we host, and hosting them for the open internet is a bandwidth decision
// nobody made. The frames are immutable once imported (a new import writes the same
// bytes), so they carry a year's cache.
//
// **`?w=`** (field report 2026-09-01: the sheet was slow on one bar of cellular, and the
// photographs it waited on were the dataset's originals). 320, 640 or 1280 — a closed list,
// because every distinct width is a file on disk for ever. The resize happens once, on the
// first request that asks for it, and the result is cached beside the original in the media
// store; every request after that is a plain read of a smaller file. Anything else in `w`
// is a 400 rather than a quiet full-size answer: a client asking for 640 and silently
// getting four megabytes is the bug this parameter exists to fix.
//
// Everything about the variant is best-effort except the picture. A store that cannot be
// written to, or bytes sharp cannot decode, fall back to streaming the original — a frame
// is a picture of a movement and never worth a 500.

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

	async function load(req: AuthenticatedRequest, id: string): Promise<CatalogRow | null> {
		if (!UUID.test(id)) return null;
		const { rows } = await timePhase(req, "db", () =>
			pool.query<CatalogRow>(
				`SELECT id, name, aliases, category, primary_muscles, secondary_muscles, equipment,
				        instructions, media_count, source_slug, level
				   FROM exercise_catalog WHERE id = $1`,
				[id]
			)
		);
		return rows[0] ?? null;
	}

	router.get("/api/exercises/:id", async (req: AuthenticatedRequest, res) => {
		const row = await load(req, req.params.id as string);
		if (!row) {
			res.status(404).json({ error: "Not found." });
			return;
		}
		// These two routes are what the phone waits on when a name is tapped, so they say
		// where the time went: `auth` is the session lookup every /api request pays,
		// `db` is the catalogue row, `open` is the file handle.
		setServerTiming(req, res);
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

	/** The bytes of a stored frame, for the resize. Frames are tens of kilobytes. */
	async function readFrame(stream: Readable): Promise<Buffer> {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks);
	}

	/**
	 * The frame at `width`, from the store if it has been made before and otherwise made
	 * now and filed beside the original. Idempotent: two requests racing for the same width
	 * both resize and both write the same bytes to the same path, which is a wasted CPU
	 * second and never a corrupt file.
	 *
	 * Returns null when the original cannot be resized — corrupt bytes, or a sharp that
	 * will not decode them — and the caller serves the original instead.
	 */
	async function variant(exerciseId: string, index: number, width: number): Promise<Buffer | null> {
		try {
			if (await media.has(exerciseId, index, width)) {
				return await readFrame(await media.get(exerciseId, index, width));
			}
		} catch {
			// A variant that cannot be read is a variant that will be made again below.
		}
		let resized: Buffer;
		try {
			resized = await resizeToWidth(await readFrame(await media.get(exerciseId, index)), width);
		} catch (error) {
			console.error(`⚠️  Exercise ${exerciseId} frame ${index} would not resize to ${width}:`, error);
			return null;
		}
		// Caching it is the optimisation, not the answer: a read-only volume costs the next
		// reader a resize and costs this one nothing.
		try {
			await media.put(exerciseId, index, resized, width);
		} catch (error) {
			console.error(`⚠️  Exercise ${exerciseId} frame ${index}@${width} could not be cached:`, error);
		}
		return resized;
	}

	router.get("/api/exercises/:id/media/:n", async (req: AuthenticatedRequest, res) => {
		// Parsed before the row is loaded: a width we do not serve is the caller's mistake
		// and does not deserve a query.
		const width = parseExerciseMediaWidth(req.query.w);
		if (width === null) {
			res.status(400).json({ error: "Unsupported width. Use w=320, w=640 or w=1280." });
			return;
		}

		const row = await load(req, req.params.id as string);
		const index = Number(req.params.n);
		// A frame the row does not claim is a 404 whether or not a file happens to exist:
		// media_count is the contract the sheet was rendered from.
		if (!row || !Number.isInteger(index) || index < 0 || index >= row.media_count) {
			res.status(404).json({ error: "Not found." });
			return;
		}

		let stream: Readable;
		let served: number | undefined = width;
		try {
			const bytes = width === undefined ? null : await timePhase(req, "resize", () => variant(row.id, index, width));
			if (bytes) {
				stream = Readable.from(bytes);
			} else {
				// Either no width was asked for, or the resize could not be done. Both are
				// answered with the picture.
				served = undefined;
				stream = await timePhase(req, "open", () => media.get(row.id, index));
			}
		} catch (error) {
			// The row outlived its bytes — a volume restored without the media directory.
			console.error(`⚠️  Exercise ${row.id} frame ${index} is missing:`, error);
			res.status(404).json({ error: "Not found." });
			return;
		}

		res.setHeader("Content-Type", "image/jpeg");
		res.setHeader("Cache-Control", CACHE_CONTROL);
		// The width is part of the identity: two sizes of one frame are two documents, and
		// an ETag that did not say which would let a cache answer a 640 with a full-size.
		res.setHeader("ETag", served === undefined ? `"${row.id}-${index}"` : `"${row.id}-${index}-w${served}"`);
		// Before the pipe: after it the headers are gone, and time-to-first-byte is the
		// half of this the server is actually responsible for.
		setServerTiming(req, res);
		await pipeline(stream, res);
	});

	return router;
}
