import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { ExerciseMediaStore } from "../../ports/exerciseMedia.js";

// ExerciseMediaStore on a directory: `<root>/<exercise id>/<n>.jpg`. In production the
// root is `exercise-media` inside the evidence volume, so the illustrations ride along
// with the photo backup and survive a rebuild — which is also why the importer can skip
// its work on a restart.
//
// Unlike an evidence key, this path is derived from values the caller supplies, so both
// halves are validated: a uuid and a small integer, nothing else.

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

	function resolveFrame(exerciseId: string, index: number): string {
		if (!UUID.test(exerciseId)) throw new Error(`Not an exercise id: "${exerciseId}"`);
		if (!Number.isInteger(index) || index < 0 || index > MAX_MEDIA_INDEX) {
			throw new Error(`Not a media index: ${String(index)}`);
		}
		const full = path.resolve(absoluteRoot, exerciseId.toLowerCase(), `${index}.jpg`);
		// Belt and braces, as in the evidence store: the two patterns above already forbid
		// a "..", but a store that can be talked into writing outside its root is the kind
		// of bug worth checking twice.
		if (!full.startsWith(absoluteRoot + path.sep)) throw new Error(`Not an exercise media path`);
		return full;
	}

	return {
		describe: `local:${absoluteRoot}`,

		async put(exerciseId: string, index: number, data: Buffer): Promise<number> {
			const file = resolveFrame(exerciseId, index);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, data);
			return data.byteLength;
		},

		async has(exerciseId: string, index: number): Promise<boolean> {
			try {
				const info = await stat(resolveFrame(exerciseId, index));
				// A zero-byte file is a half-finished download, not a picture.
				return info.size > 0;
			} catch {
				return false;
			}
		},

		async get(exerciseId: string, index: number): Promise<Readable> {
			const file = resolveFrame(exerciseId, index);
			// stat first, so a missing frame is an error here rather than an 'error' event
			// after the response headers have already gone out.
			await stat(file);
			return createReadStream(file);
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
