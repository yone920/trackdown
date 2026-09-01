import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalExerciseMediaStore } from "./exerciseMedia.js";
import { createLocalEvidenceStore } from "./local.js";

// The adapter that owns the uploads volume. Everything else in WP2 runs against the
// in-memory fake, so this is the only place the real filesystem behaviour is checked.

let root: string;
let store: ReturnType<typeof createLocalEvidenceStore>;

beforeAll(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "trackdown-evidence-"));
	store = createLocalEvidenceStore({ root });
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
	return Buffer.concat(chunks);
}

describe("local evidence store", () => {
	it("puts, stats, streams back and deletes", async () => {
		const data = Buffer.from("not really a jpeg, but bytes are bytes");
		const put = await store.put(data, { mime: "image/jpeg", extension: "jpg" });

		// Date-prefixed so no single directory has to hold a year of photos, uuid-named
		// so the key itself is not guessable.
		expect(put.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
		expect(put.bytes).toBe(data.byteLength);

		expect(await store.stat(put.key)).toMatchObject({ bytes: data.byteLength, mime: "image/jpeg" });
		expect(await readAll(await store.get(put.key))).toEqual(data);

		expect(await store.delete(put.key)).toBe(true);
		expect(await store.stat(put.key)).toBeNull();
		// Deleting twice is not an error — the sweep may race a manual cleanup.
		expect(await store.delete(put.key)).toBe(false);
	});

	it("reports an unknown key rather than an empty stream", async () => {
		const missing = "2026/01/00000000-0000-0000-0000-000000000000.jpg";
		expect(await store.stat(missing)).toBeNull();
		await expect(store.get(missing)).rejects.toThrow();
	});

	it("refuses a key that could climb out of the root", async () => {
		for (const key of ["../../etc/passwd", "/etc/passwd", "2026/01/../../../etc/passwd", "nope.jpg"]) {
			await expect(store.get(key)).rejects.toThrow(/Not an evidence key/);
			await expect(store.delete(key)).rejects.toThrow(/Not an evidence key/);
		}
	});

	it("describes itself without leaking anything secret", () => {
		expect(store.describe).toBe(`local:${path.resolve(root)}`);
	});
});

describe("local exercise media store", () => {
	const id = "11111111-2222-4333-8444-555555555555";

	it("keeps a resized variant beside its original, not on top of it", async () => {
		const media = createLocalExerciseMediaStore({ root: path.join(root, "exercise-media") });
		const original = Buffer.from("the full-size frame");
		const small = Buffer.from("640");

		await media.put(id, 0, original);
		expect(await media.has(id, 0)).toBe(true);
		// A variant that has not been made yet is absent, which is what makes the route
		// resize once instead of on every request.
		expect(await media.has(id, 0, 640)).toBe(false);

		await media.put(id, 0, small, 640);
		expect(await media.has(id, 0, 640)).toBe(true);
		expect(await readAll(await media.get(id, 0, 640))).toEqual(small);
		// The original is untouched: a variant is a cache, and the original is the truth.
		expect(await readAll(await media.get(id, 0))).toEqual(original);

		// Writing the same variant again is the same file — two requests racing for one
		// width both resize and both write the same bytes to the same path.
		await media.put(id, 0, small, 640);
		expect(await readAll(await media.get(id, 0, 640))).toEqual(small);
	});

	it("refuses a width that is not one of ours, so no caller can name a file", async () => {
		const media = createLocalExerciseMediaStore({ root: path.join(root, "exercise-media") });
		for (const width of [500, 0, -320, 1281]) {
			await expect(media.get(id, 0, width)).rejects.toThrow(/Not a media width/);
			await expect(media.put(id, 0, Buffer.from("x"), width)).rejects.toThrow(/Not a media width/);
		}
	});
});
