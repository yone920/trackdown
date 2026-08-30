import type pg from "pg";
import type { EvidenceStore } from "../ports/storage.js";
import { downscaleImage, type ProcessedImage } from "./images.js";

// The `evidence` table: the photo, transcript or note a saved record was fused from
// (docs/concept-v2.md §Principles — "evidence in, one record out").
//
// Photos are stored the moment POST /api/log/analyze receives them, before the user has
// confirmed anything, because the model has to see them and a preview the user abandons
// must not leave the phone holding bytes nobody kept. That means the table always has
// rows owning nothing yet: `confirmed_at` marks the ones a confirm kept, and
// {@link sweepUnlinkedEvidence} removes the rest a day later.

type Queryable = pg.Pool | pg.PoolClient;

export const EVIDENCE_KINDS = ["photo", "transcript", "text"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRow {
	id: string;
	user_id: string;
	activity_id: string | null;
	meal_id: string | null;
	plan_id: string | null;
	kind: EvidenceKind;
	storage_key: string | null;
	mime: string | null;
	width: number | null;
	height: number | null;
	text: string | null;
	created_at: string;
	confirmed_at: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres errors on a malformed uuid literal, so ids are shape-checked before the query. */
export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export interface StoredPhoto {
	row: EvidenceRow;
	/** The downscaled bytes — the same ones the model is shown and the volume keeps. */
	image: ProcessedImage;
}

/**
 * Downscale, store the bytes, and record the row. Not in a transaction on purpose: the
 * photo is written before the user confirms, and its row has to survive the request that
 * uploaded it so /api/log/confirm can link it afterwards.
 */
export async function storePhotoEvidence(
	db: Queryable,
	store: EvidenceStore,
	userId: string,
	original: Buffer
): Promise<StoredPhoto> {
	const image = await downscaleImage(original);
	const stored = await store.put(image.data, { mime: image.mime, extension: image.extension });
	try {
		const { rows } = await db.query<EvidenceRow>(
			`INSERT INTO evidence (user_id, kind, storage_key, mime, width, height)
			 VALUES ($1, 'photo', $2, $3, $4, $5) RETURNING *`,
			[userId, stored.key, image.mime, image.width, image.height]
		);
		return { row: rows[0]!, image };
	} catch (error) {
		// No row means nothing will ever reference these bytes, and the sweep only looks
		// at rows. Drop the file rather than leak it into the volume forever.
		await store.delete(stored.key).catch(() => undefined);
		throw error;
	}
}

/** A transcript ("what the phone heard") or the typed note, kept verbatim as provenance. */
export async function insertTextEvidence(
	db: Queryable,
	userId: string,
	kind: "transcript" | "text",
	text: string
): Promise<EvidenceRow> {
	const { rows } = await db.query<EvidenceRow>(
		`INSERT INTO evidence (user_id, kind, text) VALUES ($1, $2, $3) RETURNING *`,
		[userId, kind, text]
	);
	return rows[0]!;
}

export async function getOwnedEvidence(db: Queryable, userId: string, id: string): Promise<EvidenceRow | null> {
	if (!isUuid(id)) return null;
	const { rows } = await db.query<EvidenceRow>(`SELECT * FROM evidence WHERE id = $1 AND user_id = $2`, [
		id,
		userId,
	]);
	return rows[0] ?? null;
}

/** Which record the evidence belongs to. At most one is set — the table CHECKs it. */
export interface EvidenceOwner {
	activity_id?: string | null;
	meal_id?: string | null;
	plan_id?: string | null;
}

/**
 * Point the given evidence at what it turned into and mark it kept. Rows belonging to
 * another user are silently skipped rather than reported: a client guessing ids learns
 * nothing from the response either way.
 *
 * A weight log, a constraint and a coach context have no owner column to point at; their
 * evidence is still confirmed, which is what keeps the sweep off it.
 */
export async function linkEvidence(
	db: Queryable,
	userId: string,
	ids: readonly string[],
	owner: EvidenceOwner = {}
): Promise<EvidenceRow[]> {
	const valid = [...new Set(ids.filter(isUuid))];
	if (valid.length === 0) return [];
	const { rows } = await db.query<EvidenceRow>(
		`UPDATE evidence
		    SET activity_id = COALESCE($3, activity_id),
		        meal_id     = COALESCE($4, meal_id),
		        plan_id     = COALESCE($5, plan_id),
		        confirmed_at = NOW()
		  WHERE user_id = $1 AND id = ANY($2::uuid[])
		  RETURNING *`,
		[userId, valid, owner.activity_id ?? null, owner.meal_id ?? null, owner.plan_id ?? null]
	);
	return rows;
}

export interface SweepReport {
	/** Evidence rows removed. */
	rows: number;
	/** Files removed from the store — fewer than `rows` when the evidence was text. */
	files: number;
}

/**
 * Delete evidence no confirm ever kept. Runs once at boot (src/server.ts): a preview the
 * user backed out of, or a phone that lost signal between analyze and confirm, leaves a
 * stored photo owning nothing, and without this the uploads volume only grows.
 *
 * A day of grace, so a log started before bed and confirmed after breakfast still finds
 * its photos.
 */
export async function sweepUnlinkedEvidence(
	db: Queryable,
	store: EvidenceStore,
	{ olderThanHours = 24 }: { olderThanHours?: number } = {}
): Promise<SweepReport> {
	const { rows } = await db.query<{ storage_key: string | null }>(
		`DELETE FROM evidence
		  WHERE confirmed_at IS NULL
		    AND activity_id IS NULL AND meal_id IS NULL AND plan_id IS NULL
		    AND created_at < NOW() - make_interval(hours => $1)
		  RETURNING storage_key`,
		[olderThanHours]
	);

	let files = 0;
	for (const row of rows) {
		if (!row.storage_key) continue;
		// One bad key must not abandon the rest of the sweep; the row is gone either way.
		try {
			if (await store.delete(row.storage_key)) files += 1;
		} catch (error) {
			console.warn(`⚠️  Could not delete evidence file ${row.storage_key}:`, error);
		}
	}
	return { rows: rows.length, files };
}
