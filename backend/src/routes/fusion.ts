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
import { diffResults } from "../services/corrections.js";
import { isOverloadError, OVERLOADED_CODE, OVERLOADED_MESSAGE } from "../services/providerErrors.js";
import { ConfirmBody, NothingToSaveError, confirmLog } from "../services/fusion/confirm.js";
import { FusionResultSchema, MAX_PARTS, type FusionResult } from "../services/fusion/schema.js";
import { proposalForSpec } from "../services/goals/store.js";
import { toProposedTimeline } from "../services/goals/proposal.js";

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
	/**
	 * The clarify round (docs/CHANGELOG-v2.md §Field fixes). When the last analyze came back
	 * `unclear`, the app keeps the words it asked about and the question it asked, and sends
	 * them with the answer — because "yes" on its own is not a log. Both or neither.
	 */
	clarify_original: z.string().trim().max(2000).optional(),
	clarify_question: z.string().trim().max(300).optional(),
	/**
	 * "Make a change" (docs/concept-v2.md §Principles 7 — NO FORMS). The parts the user is
	 * looking at, plus what they said to change about them, as a JSON string because this
	 * route is multipart. Sent instead of a fresh log: nothing is routed and nothing is
	 * stored, each part is re-read by its own detail call and the review screen redraws.
	 */
	revise: z.string().max(20_000).optional(),
});

/**
 * The body of `revise`. Two shapes, because the same instruction corrects two things: a
 * pending preview (`results`) and one row already in the log, read back through the same
 * public union (`record`). One part or several; the answer keeps their order.
 */
const ReviseBody = z
	.object({
		results: z.array(FusionResultSchema).min(1).max(MAX_PARTS).optional(),
		/** One saved row as a result — the DayLog's "make a change". */
		record: FusionResultSchema.optional(),
		instruction: z.string().trim().min(1).max(500),
	})
	.refine((body) => (body.results?.length ?? 0) > 0 || body.record !== undefined, {
		message: "Send the parts to change.",
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

		// A revision is a correction to something already read, so it carries the parts
		// rather than the words, and it never brings photos: the evidence it belongs to was
		// stored on the round that produced those parts.
		let revise: { results: FusionResult[]; instruction: string } | null = null;
		if (fields.revise !== undefined) {
			let raw: unknown;
			try {
				raw = JSON.parse(fields.revise);
			} catch {
				res.status(400).json({ error: "Invalid request.", issues: [{ path: ["revise"], message: "Not JSON." }] });
				return;
			}
			const body = ReviseBody.safeParse(raw);
			if (!body.success) {
				res.status(400).json({ error: "Invalid request.", issues: body.error.issues });
				return;
			}
			if (photos.length > 0) {
				res.status(400).json({ error: "Say the change in words; the photos are already attached." });
				return;
			}
			revise = {
				results: body.data.results ?? [body.data.record!],
				instruction: body.data.instruction,
			};
		}

		if (photos.length === 0 && !fields.text && !revise) {
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

		// Both halves or neither: a question with no words to apply it to would make the
		// reader answer about a message it cannot see.
		const clarify =
			fields.clarify_original && fields.clarify_question
				? { original_text: fields.clarify_original, question: fields.clarify_question }
				: null;

		const context = await buildFusionContext(pool, userId, {
			...(fields.client_time ? { clientTime: new Date(fields.client_time) } : {}),
			...(fields.tz_offset_min === undefined ? {} : { tzOffsetMin: fields.tz_offset_min }),
			kindHint: fields.kind_hint ?? null,
			clarify,
		});

		const llmPhotos: FusionPhoto[] = stored.map((s) => ({
			mediaType: "image/jpeg",
			base64: s.image.data.toString("base64"),
		}));

		// A provider that is merely busy is weather, not a fault, and it must not reach the
		// phone as the SDK's own JSON (field report 2026-09-02: a 529 with its request id
		// was printed under the input box). It is already retried once at the transport
		// layer; if it is still busy, it is one human line and a status the app can map.
		let results: FusionResult[];
		let photoParts: number[];
		try {
			const answer = revise
				? { results: await analyzer.revise({ ...revise, context }), photoParts: [] as number[] }
				: await analyzer.analyze({
						...(fields.text ? { text: fields.text } : {}),
						photos: llmPhotos,
						context,
					});
			results = answer.results;
			photoParts = answer.photoParts;
		} catch (error) {
			if (!isOverloadError(error)) throw error;
			console.warn("⚠️  Reader busy, asking the user to try again:", describe(error));
			res.status(503).json({ error: OVERLOADED_MESSAGE, code: OVERLOADED_CODE });
			return;
		}

		// What the told change actually moved, field by field (migration 0015). Computed
		// here because here is where both sides are — the parts as they went in and the
		// parts as they came back. Nothing is written: a pending preview has no rows to
		// write against yet, so the diff travels back with the review and comes home on the
		// confirm, which writes it against the ids the parts turned into. A correction to a
		// row that is ALREADY saved is written by that row's own PATCH instead.
		const corrections = revise ? diffResults(revise.results, results, revise.instruction) : [];

		// The timeline is arithmetic, not language: whatever the model guessed is replaced
		// by the projection from the user's own facts at the safe rates in concept-v2
		// §Goals, so the confirm card shows the date the goal will actually be saved with
		// (services/goals/proposal.ts).
		// A weight stated with the goal ("I'm 212, I want 200") is the projection's starting
		// point on the preview as well as on the save, so the date on the confirm card is
		// the date the goal is created with. The weigh-in itself is written by the confirm
		// — analyze still saves nothing.
		let proposal = null;
		for (const result of results) {
			if (result.kind !== "goal") continue;
			const projected = await proposalForSpec(pool, userId, result.spec, {
				tzOffsetMin: context.tzOffsetMin,
				statedWeightLb: result.facts?.current_weight_lb ?? null,
			});
			result.proposed_timeline = toProposedTimeline(projected);
			proposal ??= projected;
		}

		res.json({
			results,
			/** Empty for a fresh log; one entry per record a revision moved. */
			corrections,
			// One release of app compatibility: a client written before mixed input reads
			// `result` and would otherwise see nothing. Only when there is one part —
			// a sentence with three things in it has no single result to name.
			...(results.length === 1 ? { result: results[0] } : {}),
			...(proposal ? { proposal } : {}),
			evidence: stored.map((s, index) => ({
				id: s.row.id,
				kind: s.row.kind,
				mime: s.row.mime,
				width: s.row.width,
				height: s.row.height,
				url: `/api/evidence/${s.row.id}`,
				/** Which of `results` this photo was read for — the confirm links it there. */
				part: photoParts[index] ?? 0,
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

/** The status and request id for the log; never for the user. */
function describe(error: unknown): string {
	const status = (error as { status?: unknown } | null)?.status ?? "?";
	const requestId = (error as { request_id?: unknown } | null)?.request_id;
	return requestId ? `${status} (${String(requestId)})` : String(status);
}
