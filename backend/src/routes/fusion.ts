import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import type { EvidenceStore } from "../ports/storage.js";
import { storePhotoEvidence } from "../services/evidence.js";
import { isAcceptedUploadMime, ACCEPTED_UPLOAD_MIMES } from "../services/images.js";
import type { FusionAnalyzer, FusionPhoto } from "../services/fusion/analyze.js";
import { buildFusionContext } from "../services/fusion/context.js";
import { ConfirmBody, NothingToSaveError, confirmLog } from "../services/fusion/confirm.js";

// The multimodal log (docs/build-plan.md §WP2):
//   POST /api/log/analyze   multipart: photos + text → a preview, nothing saved
//   POST /api/log/confirm   the preview the user approved → rows, in one transaction
//
// Analyze stores the photos immediately and returns their evidence ids, because the model
// has to be shown the bytes and the confirm that follows has to be able to point at them.
// A preview the user abandons therefore leaves stored photos owning nothing; the boot
// sweep in services/evidence.ts removes those after a day.

/** Four photos is a machine, its display, the weight stack and the plate. */
export const MAX_PHOTOS = 4;
/** 8 MB is a full-size iPhone HEIC; the phone downscales first, this is the safety net. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const PHOTO_FIELD = /^photos?(\[\])?$/;

const upload = multer({
	// Memory, not disk: the bytes go to sharp and then to the EvidenceStore, and a
	// temp file in between is one more thing to clean up after a crash.
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 12 },
});

const AnalyzeFields = z.object({
	text: z.string().trim().max(2000).optional(),
	kind_hint: z
		.enum(["activities", "meal", "weight", "goal", "constraint", "preference", "coach_context"])
		.optional(),
	/** The phone's clock. Day boundaries are the user's local midnight, not the server's. */
	client_time: z.string().datetime({ offset: true }).optional(),
	/** Minutes to add to UTC for local time: -new Date().getTimezoneOffset() on the phone. */
	tz_offset_min: z.coerce.number().int().min(-840).max(840).optional(),
});

/** Turns multer's own errors into the status the client should act on. */
function uploadPhotos(req: Request, res: Response, next: NextFunction): void {
	upload.any()(req, res, (error: unknown) => {
		if (!error) return next();
		if (error instanceof multer.MulterError) {
			if (error.code === "LIMIT_FILE_SIZE") {
				res.status(413).json({ error: `Each photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.` });
				return;
			}
			if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
				res.status(400).json({ error: `At most ${MAX_PHOTOS} photos per log.` });
				return;
			}
			res.status(400).json({ error: error.message });
			return;
		}
		next(error);
	});
}

export function fusionRouter(pool: pg.Pool, analyzer: FusionAnalyzer, store: EvidenceStore): Router {
	const router = Router();

	router.post("/api/log/analyze", uploadPhotos, async (req: AuthenticatedRequest, res) => {
		const parsed = AnalyzeFields.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		const fields = parsed.data;
		const files = (req.files as Express.Multer.File[] | undefined) ?? [];

		const photos = files.filter((file) => PHOTO_FIELD.test(file.fieldname));
		if (photos.length !== files.length) {
			res.status(400).json({ error: `Photos must be sent as the "photos" field.` });
			return;
		}
		if (photos.length === 0 && !fields.text) {
			res.status(400).json({ error: "Send a photo or say something first." });
			return;
		}
		const wrongType = photos.find((file) => !isAcceptedUploadMime(file.mimetype));
		if (wrongType) {
			res.status(415).json({
				error: `${wrongType.mimetype} is not an image we can read. Send one of: ${ACCEPTED_UPLOAD_MIMES.join(", ")}.`,
			});
			return;
		}

		const userId = req.userId!;

		// Store first, then analyse: the evidence ids travel back with the preview so the
		// confirm can link them, and a model that fails leaves the photos to the sweep
		// rather than losing them.
		const stored = [];
		for (const photo of photos) stored.push(await storePhotoEvidence(pool, store, userId, photo.buffer));

		const context = await buildFusionContext(pool, userId, {
			...(fields.client_time ? { clientTime: new Date(fields.client_time) } : {}),
			...(fields.tz_offset_min === undefined ? {} : { tzOffsetMin: fields.tz_offset_min }),
			kindHint: fields.kind_hint ?? null,
		});

		const llmPhotos: FusionPhoto[] = stored.map((s) => ({
			mediaType: "image/jpeg",
			base64: s.image.data.toString("base64"),
		}));

		const result = await analyzer.analyze({
			...(fields.text ? { text: fields.text } : {}),
			photos: llmPhotos,
			context,
		});

		res.json({
			result,
			evidence: stored.map((s) => ({
				id: s.row.id,
				kind: s.row.kind,
				mime: s.row.mime,
				width: s.row.width,
				height: s.row.height,
				url: `/api/evidence/${s.row.id}`,
			})),
			context: { local_date: context.localDate, tz_offset_min: context.tzOffsetMin },
		});
	});

	router.post("/api/log/confirm", async (req: AuthenticatedRequest, res) => {
		const parsed = ConfirmBody.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({ error: "Invalid request.", issues: parsed.error.issues });
			return;
		}
		try {
			const { saved, replayed } = await confirmLog(pool, req.userId!, parsed.data);
			res.status(201).json({ ...saved, replayed });
		} catch (error) {
			if (error instanceof NothingToSaveError) {
				res.status(422).json({ error: error.message });
				return;
			}
			throw error;
		}
	});

	return router;
}
