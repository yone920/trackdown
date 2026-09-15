import type pg from "pg";
import type { PlaceKind } from "./fusion/schema.js";

// Places, and what has been seen in them (migration 0012).
//
// The whole point of this module is that nobody fills anything in. There is no "add your
// gym" screen and no equipment checklist; there is one sentence — "my gym is New
// Millennium" — and after that every workout that saves quietly records what it used. Over
// a few weeks that becomes a list of what is actually on the floor of the room the user
// trains in, which is the difference between a coach that prescribes a hip thrust machine
// and one that knows there isn't one.
//
// Two rules hold the whole thing together:
//
//   * **No place is the normal state.** Every function here returns null, or does nothing,
//     when the user has never named where they train. Nothing upstream has to check first
//     and nothing fails because of it.
//   * **A label is a label, once.** Uniqueness is on (place_id, lower(label)), and the
//     accrual is an upsert — the second time a machine is used it bumps `last_seen` and
//     `times_seen` rather than writing a second row. That is what makes it safe to call on
//     every save, including a confirm that is replayed.

type Queryable = pg.Pool | pg.PoolClient;

export interface PlaceRow {
	id: string;
	name: string;
	kind: PlaceKind;
}

export interface PlaceEquipmentRow {
	label: string;
	exercise_id: string | null;
	times_seen: number;
	last_seen: string;
}

/** How the label came to be known: out of a log, off a photo, or simply said. */
export type EquipmentSource = "fused" | "photo" | "stated";

/**
 * The place the user is training in now, or null. One join, because the id lives on the
 * profile and the name lives on the place.
 */
export async function currentPlace(db: Queryable, userId: string): Promise<PlaceRow | null> {
	const { rows } = await db.query<PlaceRow>(
		`SELECT p.id, p.name, p.kind FROM profiles pr
		   JOIN places p ON p.id = pr.current_place_id
		  WHERE pr.id = $1`,
		[userId]
	);
	return rows[0] ?? null;
}

/**
 * Name a place, or find the one already named. Case-insensitive on the name, so saying "my
 * gym is New Millennium" twice — or "new millennium" the second time — is one gym and keeps
 * the spelling it was first given.
 */
export async function upsertPlace(
	db: Queryable,
	userId: string,
	name: string,
	kind: PlaceKind = "gym"
): Promise<PlaceRow | null> {
	const trimmed = name.trim();
	if (trimmed === "") return null;
	const { rows } = await db.query<PlaceRow>(
		`INSERT INTO places (user_id, name, kind) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, lower(name)) DO UPDATE SET kind = EXCLUDED.kind
		 RETURNING id, name, kind`,
		[userId, trimmed, kind]
	);
	return rows[0] ?? null;
}

/** Where they train now. The profile's own column, so `GET /api/profile` reads it for free. */
export async function setCurrentPlace(db: Queryable, userId: string, placeId: string): Promise<void> {
	await db.query(
		`UPDATE profiles SET current_place_id = $2,
		        stated_at = stated_at || $3::jsonb
		  WHERE id = $1`,
		[userId, placeId, JSON.stringify({ current_place_id: new Date().toISOString() })]
	);
}

/**
 * One label seen in one place. Idempotent per label: the first call writes the row, every
 * later one moves `last_seen` and adds to `times_seen`. `exercise_id` is filled in the
 * moment it is known and never cleared by a later sighting that did not resolve — a machine
 * we once recognised does not become anonymous because the next log spelled it differently.
 */
export async function recordPlaceEquipment(
	db: Queryable,
	placeId: string,
	label: string,
	{ exerciseId = null, source = "fused" }: { exerciseId?: string | null; source?: EquipmentSource } = {}
): Promise<void> {
	const trimmed = label.trim();
	if (trimmed === "") return;
	await db.query(
		`INSERT INTO place_equipment (place_id, label, exercise_id, source)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (place_id, lower(label)) DO UPDATE SET
		   last_seen = NOW(),
		   times_seen = place_equipment.times_seen + 1,
		   exercise_id = COALESCE(place_equipment.exercise_id, EXCLUDED.exercise_id)`,
		[placeId, trimmed, exerciseId, source]
	);
}

/** What has been seen there, most used first. */
export async function placeEquipment(
	db: Queryable,
	placeId: string,
	limit = 40
): Promise<PlaceEquipmentRow[]> {
	const { rows } = await db.query<PlaceEquipmentRow>(
		`SELECT label, exercise_id, times_seen, last_seen FROM place_equipment
		  WHERE place_id = $1 ORDER BY times_seen DESC, last_seen DESC LIMIT $2`,
		[placeId, limit]
	);
	return rows;
}

export interface PlaceSummary extends PlaceRow {
	/** How many distinct machines and movements have been seen there. */
	equipment_count: number;
}

/** The place and its tally — "New Millennium · 14 machines seen" on the Goals screen. */
export async function currentPlaceSummary(db: Queryable, userId: string): Promise<PlaceSummary | null> {
	const place = await currentPlace(db, userId);
	if (!place) return null;
	const { rows } = await db.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM place_equipment WHERE place_id = $1`,
		[place.id]
	);
	return { ...place, equipment_count: Number(rows[0]?.count ?? 0) };
}

/**
 * The labels one saved activity teaches us about the room it happened in: the machine they
 * named, and the movement **when we managed to identify it**. Both, because they are
 * different facts — "cable stack" says what is bolted to the floor and "Lat Pulldown" says
 * what can be done there.
 *
 * An exercise that resolved to nothing in the catalogue is deliberately not recorded: it is
 * the user's paraphrase of a movement they could not name, and a list of those is not a list
 * of equipment. The machine beside it is, and that is the half worth keeping.
 */
export function equipmentLabelsFor(activity: {
	equipment?: string | null;
	exercise?: string | null;
	exercise_id?: string | null;
}): { label: string; exerciseId: string | null }[] {
	const identified = activity.exercise_id ? activity.exercise : null;
	const out: { label: string; exerciseId: string | null }[] = [];
	const seen = new Set<string>();
	for (const label of [activity.equipment, identified]) {
		const trimmed = label?.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ label: trimmed, exerciseId: activity.exercise_id ?? null });
	}
	return out;
}
