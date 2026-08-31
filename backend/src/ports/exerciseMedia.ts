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

export interface ExerciseMediaStore {
	/** For logs and the /health-adjacent "what is this wired to" question. */
	readonly describe: string;
	/** Writes one frame. Returns the bytes written. */
	put(exerciseId: string, index: number, data: Buffer): Promise<number>;
	/** True when that frame is already on disk — what makes the importer skip a download. */
	has(exerciseId: string, index: number): Promise<boolean>;
	/** The bytes, for the route to stream. Throws when the frame is not there. */
	get(exerciseId: string, index: number): Promise<Readable>;
	/** Files and total bytes held, for the importer's report. */
	usage(): Promise<{ files: number; bytes: number }>;
}
