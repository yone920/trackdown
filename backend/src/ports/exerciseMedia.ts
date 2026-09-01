import type { Readable } from "node:stream";

// Where the exercise illustrations live.
//
// Its own port rather than a second use of `EvidenceStore`: an evidence key is a minted,
// unguessable `YYYY/MM/<uuid>.jpg` belonging to one user, and these are the opposite —
// a fixed, shared, addressable `<exercise id>/<n>.jpg` that every account sees the same.
// Squeezing them through the same key space would have meant loosening the pattern that
// keeps a database value from being handed to the filesystem as `../../etc/passwd`.
//
// The default implementation is a directory inside the evidence volume
// (adapters/storage/exerciseMedia.ts), so one backup covers both.

/**
 * The widths a frame may be stored and asked for at. Part of the port rather than of the
 * route, because it is what bounds the filenames a store will ever be asked to write: a
 * caller-chosen number would be a file on disk for ever, per number.
 */
export const EXERCISE_MEDIA_WIDTHS = [320, 640, 1280] as const;

export type ExerciseMediaWidth = (typeof EXERCISE_MEDIA_WIDTHS)[number];

export interface ExerciseMediaStore {
	/** For logs and the /health-adjacent "what is this wired to" question. */
	readonly describe: string;
	/** Writes one frame. Returns the bytes written. */
	put(exerciseId: string, index: number, data: Buffer, width?: number): Promise<number>;
	/** True when that frame is already on disk — what makes the importer skip a download. */
	has(exerciseId: string, index: number, width?: number): Promise<boolean>;
	/** The bytes, for the route to stream. Throws when the frame is not there. */
	get(exerciseId: string, index: number, width?: number): Promise<Readable>;
	/**
	 * Throws away every resized variant of one frame, leaving the original. Called when a
	 * frame's bytes are *replaced* — the variants are derived from the old picture and would
	 * otherwise be served for ever beside the new one. Returns how many were dropped.
	 */
	clearVariants(exerciseId: string, index: number): Promise<number>;
	/**
	 * Which dataset entry the frames on disk were downloaded from, recorded *beside them*
	 * rather than only in `exercise_catalog.source_slug`.
	 *
	 * It is here because the column and the bytes can disagree, and did (2026-09-01): the
	 * importer skips a frame that already exists and writes the column afterwards, so
	 * re-pointing Bench Press at a clearer photograph moved the column while the old
	 * picture stayed on the volume — invisibly, and for ever, because the next run then
	 * compared the new column against the new match and saw nothing to do. What is on the
	 * disk is the only thing that can answer "is this the right picture".
	 *
	 * `null` for a store that has never recorded one; the importer re-downloads that row
	 * once, which is how a volume from before this existed corrects itself.
	 */
	sourceOf(exerciseId: string): Promise<string | null>;
	/** Records it. Called after the frames are written, never before. */
	setSource(exerciseId: string, slug: string): Promise<void>;
	/** Files and total bytes held, for the importer's report. */
	usage(): Promise<{ files: number; bytes: number }>;
}

// `width` is the resized *variant* of a frame, stored beside the original and derived from
// it on the first request that asks (routes/exercises.ts §?w=). It is not a second kind of
// object: the original is the truth, a variant is a cache, and deleting every variant would
// cost the next reader one resize and nothing else. Omitting it means the original, which
// is what the importer writes and what a client that asks for no width gets.
