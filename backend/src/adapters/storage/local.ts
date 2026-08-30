import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { EvidenceStore, PutOptions, StoredObject } from "../../ports/storage.js";

// EvidenceStore on a directory — the `trackdown_uploads` Docker volume in production,
// ./uploads in dev. Keys are `YYYY/MM/<uuid>.<ext>`: the date prefix keeps any one
// directory small enough to list, and the uuid is what makes the key unguessable.
//
// The bytes are *not* the access control — GET /api/evidence/:id checks ownership against
// the evidence row and only then asks the store for the stream.

const MIME_BY_EXTENSION: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

/**
 * A key this store could have minted. Rejects anything with a path segment that could
 * climb out of the root — a key arrives from the database, but the database is not a
 * reason to hand `../../etc/passwd` to the filesystem.
 */
const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

export interface LocalEvidenceStoreOptions {
	/** Directory the files live in; created on first write. */
	root: string;
}

export function createLocalEvidenceStore({ root }: LocalEvidenceStoreOptions): EvidenceStore {
	const absoluteRoot = path.resolve(root);

	function resolveKey(key: string): string {
		if (!KEY_PATTERN.test(key)) throw new Error(`Not an evidence key: "${key}"`);
		const full = path.resolve(absoluteRoot, key);
		// Belt and braces: the pattern already forbids "..", but a store that can be
		// talked into writing outside its root is the kind of bug worth two checks.
		if (!full.startsWith(absoluteRoot + path.sep)) throw new Error(`Not an evidence key: "${key}"`);
		return full;
	}

	return {
		describe: `local:${absoluteRoot}`,

		async put(data: Buffer, { mime, extension }: PutOptions): Promise<StoredObject> {
			const now = new Date();
			const month = String(now.getUTCMonth() + 1).padStart(2, "0");
			const key = `${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension.toLowerCase()}`;
			const file = resolveKey(key);
			await mkdir(path.dirname(file), { recursive: true });
			await writeFile(file, data);
			return { key, bytes: data.byteLength, mime };
		},

		async get(key: string): Promise<Readable> {
			const file = resolveKey(key);
			// stat first so a missing file is an error here rather than an 'error' event
			// after the response headers have already gone out.
			await stat(file);
			return createReadStream(file);
		},

		async delete(key: string): Promise<boolean> {
			const file = resolveKey(key);
			try {
				await stat(file);
			} catch {
				return false;
			}
			await rm(file, { force: true });
			return true;
		},

		async stat(key: string): Promise<StoredObject | null> {
			const file = resolveKey(key);
			try {
				const info = await stat(file);
				const extension = path.extname(file).slice(1).toLowerCase();
				return {
					key,
					bytes: info.size,
					mime: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
				};
			} catch {
				return null;
			}
		},
	};
}
