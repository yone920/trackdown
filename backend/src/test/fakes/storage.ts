import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { EvidenceStore, PutOptions, StoredObject } from "../../ports/storage.js";

// In-memory EvidenceStore. Integration tests keep the real bytes (they assert the
// downscaled JPEG really comes back through GET /api/evidence/:id) but write nothing to
// disk, so a failed test leaves no files behind.

export interface FakeEvidenceStore extends EvidenceStore {
	/** key → the exact bytes that were put. */
	readonly objects: Map<string, { data: Buffer; mime: string }>;
}

export function createFakeEvidenceStore(): FakeEvidenceStore {
	const objects = new Map<string, { data: Buffer; mime: string }>();

	return {
		describe: "fake:memory",
		objects,

		async put(data: Buffer, { mime, extension }: PutOptions): Promise<StoredObject> {
			const now = new Date();
			const month = String(now.getUTCMonth() + 1).padStart(2, "0");
			const key = `${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension.toLowerCase()}`;
			objects.set(key, { data: Buffer.from(data), mime });
			return { key, bytes: data.byteLength, mime };
		},

		async get(key: string): Promise<Readable> {
			const found = objects.get(key);
			if (!found) throw new Error(`No evidence stored under "${key}"`);
			return Readable.from(found.data);
		},

		async delete(key: string): Promise<boolean> {
			return objects.delete(key);
		},

		async stat(key: string): Promise<StoredObject | null> {
			const found = objects.get(key);
			return found ? { key, bytes: found.data.byteLength, mime: found.mime } : null;
		},
	};
}
