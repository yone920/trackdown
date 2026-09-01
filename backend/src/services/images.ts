import sharp from "sharp";

import { EXERCISE_MEDIA_WIDTHS, type ExerciseMediaWidth } from "../ports/exerciseMedia.js";

// Server-side downscale, the safety net behind the phone's own resize. The app already
// ships ~1280 px JPEGs; this exists for the client that does not (a web upload, a future
// share-sheet, a bug), so nothing an 8 MB original costs us reaches the disk, the model,
// or the backup.
//
// sharp is a local library, not a provider — no key, no vendor, nothing to swap — so it
// is imported directly here rather than hidden behind a port. The provider SDKs that do
// need a port are the ones eslint restricts to adapters/.

/** Longest edge, in pixels. Well above what the model needs to read a machine display. */
export const MAX_EDGE_PX = 1600;
/** Visually lossless enough for a weight stack; a third of the bytes of q95. */
export const JPEG_QUALITY = 82;

/** What the phone or a browser may upload. HEIC arrives from iOS share sheets. */
export const ACCEPTED_UPLOAD_MIMES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/heic",
	"image/heif",
] as const;

export function isAcceptedUploadMime(mime: string): boolean {
	return (ACCEPTED_UPLOAD_MIMES as readonly string[]).includes(mime.toLowerCase());
}

export interface ProcessedImage {
	data: Buffer;
	mime: "image/jpeg";
	extension: "jpg";
	width: number;
	height: number;
}

/**
 * Downscale to {@link MAX_EDGE_PX} on the longest edge and re-encode as JPEG. Always
 * re-encodes, even for an image already small enough: that is what strips the EXIF (and
 * with it the GPS coordinates of the user's gym) and normalises the mime, so every stored
 * photo is the same kind of thing.
 *
 * Throws when the bytes are not a decodable image — a caller turns that into a 400.
 */
export async function downscaleImage(input: Buffer): Promise<ProcessedImage> {
	const { data, info } = await sharp(input, { failOn: "error" })
		// Apply the EXIF orientation before dropping the EXIF, or half the phone's
		// photos reach the model sideways.
		.rotate()
		.resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
		.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
		.toBuffer({ resolveWithObject: true });

	return { data, mime: "image/jpeg", extension: "jpg", width: info.width, height: info.height };
}

/**
 * Narrows a `?w=` query value. `undefined` is "no width asked for" — serve the original;
 * `null` is "a width was asked for and it is not one of ours" — a 400, because silently
 * serving 4 MB when 640 was requested is the bug this parameter exists to fix.
 */
export function parseExerciseMediaWidth(value: unknown): ExerciseMediaWidth | null | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value === "") return null;
	const width = Number(value);
	return (EXERCISE_MEDIA_WIDTHS as readonly number[]).includes(width)
		? (width as ExerciseMediaWidth)
		: null;
}

/**
 * One frame, narrower. `withoutEnlargement` so asking for 1280 of a 600 px original hands
 * back the original's pixels rather than a blurred upscale: the point is fewer bytes on a
 * phone, and a frame already smaller than the ask is already the answer.
 *
 * Throws when the bytes are not a decodable image — the route falls back to the original
 * rather than turning a picture into a 500.
 */
export async function resizeToWidth(input: Buffer, width: number): Promise<Buffer> {
	return sharp(input, { failOn: "error" })
		.resize({ width, withoutEnlargement: true })
		.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
		.toBuffer();
}
