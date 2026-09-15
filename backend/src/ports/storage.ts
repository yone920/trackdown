import type { Readable } from "node:stream";

// Where an uploaded photo's bytes live. The database row (`evidence`) holds the metadata
// and the opaque `storage_key`; this port holds nothing but the bytes, so moving from the
// Docker volume to S3 is `EVIDENCE_STORAGE=s3` and nothing else.
//
// Keys are opaque to callers: only the store makes them, and only the store interprets
// them. Nothing outside an adapter may treat one as a filesystem path.

export interface StoredObject {
	/** Opaque key — what goes in `evidence.storage_key`. */
	key: string;
	bytes: number;
	mime: string;
}

export interface PutOptions {
	mime: string;
	/**
	 * Extension for the key, without the dot ("jpg"). Cosmetic — it makes a volume
	 * listing readable and lets `stat` report a mime without a sidecar file.
	 */
	extension: string;
}

export interface EvidenceStore {
	/** For logs and error messages ("local:/app/uploads"). Never a credential. */
	readonly describe: string;
	put(data: Buffer, options: PutOptions): Promise<StoredObject>;
	/** Throws if the key is unknown — a missing file is a bug, not an empty stream. */
	get(key: string): Promise<Readable>;
	/** True when something was removed, false when the key was already gone. */
	delete(key: string): Promise<boolean>;
	/** Null when the key is unknown. */
	stat(key: string): Promise<StoredObject | null>;
}
