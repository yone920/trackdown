import { Readable } from "node:stream";
import type { ExerciseMediaStore } from "../../ports/exerciseMedia.js";

// In-memory ExerciseMediaStore. The importer's tests assert the exact bytes that were
// written, and the route test streams them back out again — all without touching a disk
// or a network, so a failed run leaves nothing behind.

export interface FakeExerciseMediaStore extends ExerciseMediaStore {
	/** "<exercise id>/<n>" → the bytes that were put. */
	readonly frames: Map<string, Buffer>;
}

export function createFakeExerciseMediaStore(): FakeExerciseMediaStore {
	const frames = new Map<string, Buffer>();
	const key = (exerciseId: string, index: number): string => `${exerciseId}/${index}`;

	return {
		describe: "fake:memory",
		frames,

		async put(exerciseId: string, index: number, data: Buffer): Promise<number> {
			frames.set(key(exerciseId, index), Buffer.from(data));
			return data.byteLength;
		},

		async has(exerciseId: string, index: number): Promise<boolean> {
			return frames.has(key(exerciseId, index));
		},

		async get(exerciseId: string, index: number): Promise<Readable> {
			const found = frames.get(key(exerciseId, index));
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
