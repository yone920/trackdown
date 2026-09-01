import { Readable } from "node:stream";
import type { ExerciseMediaStore } from "../../ports/exerciseMedia.js";

// In-memory ExerciseMediaStore. The importer's tests assert the exact bytes that were
// written, and the route test streams them back out again — all without touching a disk
// or a network, so a failed run leaves nothing behind.

export interface FakeExerciseMediaStore extends ExerciseMediaStore {
	/** "<exercise id>/<n>", or "<exercise id>/<n>@<width>" → the bytes that were put. */
	readonly frames: Map<string, Buffer>;
}

export function createFakeExerciseMediaStore(): FakeExerciseMediaStore {
	const frames = new Map<string, Buffer>();
	// A resized variant is a key beside the original, exactly as it is a file beside it on
	// disk (adapters/storage/exerciseMedia.ts).
	const key = (exerciseId: string, index: number, width?: number): string =>
		width === undefined ? `${exerciseId}/${index}` : `${exerciseId}/${index}@${width}`;

	return {
		describe: "fake:memory",
		frames,

		async put(exerciseId: string, index: number, data: Buffer, width?: number): Promise<number> {
			frames.set(key(exerciseId, index, width), Buffer.from(data));
			return data.byteLength;
		},

		async has(exerciseId: string, index: number, width?: number): Promise<boolean> {
			return frames.has(key(exerciseId, index, width));
		},

		async get(exerciseId: string, index: number, width?: number): Promise<Readable> {
			const found = frames.get(key(exerciseId, index, width));
			if (!found) throw new Error(`No frame ${index} for exercise ${exerciseId}`);
			return Readable.from(found);
		},

		async usage(): Promise<{ files: number; bytes: number }> {
			let bytes = 0;
			for (const data of frames.values()) bytes += data.byteLength;
			return { files: frames.size, bytes };
		},
	};
}
