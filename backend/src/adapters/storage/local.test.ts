import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
