import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { EXERCISE_MEDIA_WIDTHS, type ExerciseMediaStore } from "../../ports/exerciseMedia.js";

// ExerciseMediaStore on a directory: `<root>/<exercise id>/<n>.jpg`, with resized variants
// beside them as `<n>@<width>.jpg`. In production the root is `exercise-media` inside the
// evidence volume, so the illustrations ride along with the photo backup and survive a
// rebuild — which is also why the importer can skip its work on a restart.
//
// Unlike an evidence key, this path is derived from values the caller supplies, so every
// part of it is validated: a uuid, a small integer, and a width from a closed list.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Two frames per exercise today; the cap is here so a bad `n` cannot walk the disk. */
export const MAX_MEDIA_INDEX = 9;

/**
 * Inside the evidence volume, so one backup covers the user's photos and the
 * illustrations both. Named here rather than in config/ because it is a fact about this
 * adapter's layout, not something a deploy sets.
 */
export function exerciseMediaRoot(evidenceDir: string): string {
	return path.join(evidenceDir, "exercise-media");
}

export interface LocalExerciseMediaStoreOptions {
	/** Directory the frames live in; created on first write. */
	root: string;
}

export function createLocalExerciseMediaStore({ root }: LocalExerciseMediaStoreOptions): ExerciseMediaStore {
	const absoluteRoot = path.resolve(root);

	function resolveFrame(exerciseId: string, index: number, width?: number): string {
		if (!UUID.test(exerciseId)) throw new Error(`Not an exercise id: "${exerciseId}"`);
		if (!Number.isInteger(index) || index < 0 || index > MAX_MEDIA_INDEX) {
			throw new Error(`Not a media index: ${String(index)}`);
		}
		if (width !== undefined && !(EXERCISE_MEDIA_WIDTHS as readonly number[]).includes(width)) {
			throw new Error(`Not a media width: ${String(width)}`);
		}
		const name = width === undefined ? `${index}.jpg` : `${index}@${width}.jpg`;
		const full = path.resolve(absoluteRoot, exerciseId.toLowerCase(), name);
		// Belt and braces, as in the evidence store: the two patterns above already forbid
		// a "..", but a store that can be talked into writing outside its root is the kind
		// of bug worth checking twice.
		if (!full.startsWith(absoluteRoot + path.sep)) throw new Error(`Not an exercise media path`);
		return full;
	}

	/** The provenance note, beside the frames it describes. Never a `.jpg`, so `usage`
	 * and `clearVariants` both step over it. */
	function resolveSource(exerciseId: string): string {
		if (!UUID.test(exerciseId)) throw new Error(`Not an exercise id: "${exerciseId}"`);
		const full = path.resolve(absoluteRoot, exerciseId.toLowerCase(), "source.txt");
		if (!full.startsWith(absoluteRoot + path.sep)) throw new Error(`Not an exercise media path`);
		return full;
	}

	return {
		describe: `local:${absoluteRoot}`,

		async put(exerciseId: string, index: number, data: Buffer, width?: number): Promise<number> {
			const file = resolveFrame(exerciseId, index, width);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, data);
			return data.byteLength;
		},

		async has(exerciseId: string, index: number, width?: number): Promise<boolean> {
			try {
				const info = await stat(resolveFrame(exerciseId, index, width));
				// A zero-byte file is a half-finished download, not a picture.
				return info.size > 0;
			} catch {
				return false;
			}
		},

		async get(exerciseId: string, index: number, width?: number): Promise<Readable> {
			const file = resolveFrame(exerciseId, index, width);
			// stat first, so a missing frame is an error here rather than an 'error' event
			// after the response headers have already gone out.
			await stat(file);
			return createReadStream(file);
		},

		async clearVariants(exerciseId: string, index: number): Promise<number> {
			// The original is `<n>.jpg`; every variant of it is `<n>@<width>.jpg`. Only the
			// variants go — the original is the truth and this is called right after it was
			// rewritten.
			const directory = path.dirname(resolveFrame(exerciseId, index));
			let entries: string[];
			try {
				entries = await readdir(directory);
			} catch {
				return 0;
			}
			let dropped = 0;
			for (const entry of entries) {
				if (!entry.startsWith(`${index}@`) || !entry.endsWith(".jpg")) continue;
				try {
					await rm(path.join(directory, entry));
					dropped += 1;
				} catch {
					// A variant that is already gone is the state we wanted.
				}
			}
			return dropped;
		},

		async sourceOf(exerciseId: string): Promise<string | null> {
			try {
				const slug = await readFile(resolveSource(exerciseId), "utf8");
				return slug.trim() || null;
			} catch {
				// No file, no directory, no readable disk: all of them are "we do not know",
				// and the importer answers that by downloading the frames again.
				return null;
			}
		},

		async setSource(exerciseId: string, slug: string): Promise<void> {
			const file = resolveSource(exerciseId);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, `${slug}\n`);
		},

		async usage(): Promise<{ files: number; bytes: number }> {
			let files = 0;
			let bytes = 0;
			let entries: string[];
			try {
				entries = await readdir(absoluteRoot);
			} catch {
				return { files, bytes };
			}
			for (const entry of entries) {
				let frames: string[];
				try {
					frames = await readdir(path.join(absoluteRoot, entry));
				} catch {
					continue;
				}
				for (const frame of frames) {
					// The provenance note is bookkeeping, not a picture: it is not a frame and
					// its handful of bytes are not "illustrations on disk".
					if (!frame.endsWith(".jpg")) continue;
					try {
						const info = await stat(path.join(absoluteRoot, entry, frame));
						if (!info.isFile()) continue;
						files += 1;
						bytes += info.size;
					} catch {
						// A frame that vanished between the listing and the stat is not an error
						// worth failing a report over.
					}
				}
			}
			return { files, bytes };
		},
	};
}
