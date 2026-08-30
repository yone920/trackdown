import type pg from "pg";
import { boundsOf, type IsoDate } from "./localTime.js";

// "The log, as recorded" (docs/design-system.md §DayLog; concept-v2 §The two day views:
// "the raw entries live behind 'See the log as recorded' with export").
//
// The Day screen is a *reading* — a verdict, a paragraph, muscle groups. This is the
// other half: what you actually said, in the order you said it, beside what the app made
// of it. It is the audit trail for "confirm, don't trust" (concept-v2 §Principles 3), so
// it is built **record-first**: one entry per thing that was saved, with the evidence it
// was saved from hanging off it. Building it evidence-first would hide every row that has
// no evidence — a Health import, a seeded day, anything logged before WP2 — and a log
// that quietly omits entries is worse than no log.
//
// Evidence with no owner at all is still listed, as a `statement`: a constraint, a
// preference or a line of coach context produced no row to point at, and the user did say
// it today.

type Queryable = pg.Pool | pg.PoolClient;

export type DayLogKind = "activity" | "meal" | "weight" | "goal" | "statement";

/** Which of the four icons the row draws (docs/design-system.md §DayLog). */
export type DayLogIcon = "camera" | "mic" | "keyboard" | "heart";

export interface DayLogEvidence {
	id: string;
	kind: "photo" | "transcript" | "text";
	text: string | null;
	mime: string | null;
	width: number | null;
	height: number | null;
}

export type DayLogRecord =
	| {
			kind: "activity";
			description: string;
			exercise: string | null;
			category: string | null;
			muscle_groups: string[];
			sets: number | null;
			reps: number | null;
			load_lb: number | null;
			duration_min: number | null;
			distance_mi: number | null;
			kcal: number;
	  }
	| {
			kind: "meal";
			description: string;
			meal_type: string | null;
			kcal: number;
			protein_g: number | null;
			carbs_g: number | null;
			fat_g: number | null;
			fiber_g: number | null;
	  }
	| { kind: "weight"; weight_lb: number }
	| { kind: "goal"; title: string; goal_kind: string; metrics: unknown[] }
	| { kind: "statement"; text: string };

export interface DayLogEntry {
	/** The saved row's id — what a correction PATCHes. A statement carries its evidence id. */
	id: string;
	kind: DayLogKind;
	/** When it happened (a goal: when it was stated). */
	logged_at: string;
	/** The words behind it, verbatim, or null when it was a photo or an import. */
	raw_text: string | null;
	icon: DayLogIcon;
	evidence: DayLogEvidence[];
	/** manual | fused | health, where the row records one. */
	source: string | null;
	confidence: string | null;
	/** One line: what the app understood the raw thing to be. */
	understood: string;
	/** False when there is no endpoint that can correct it — a statement. */
	editable: boolean;
	record: DayLogRecord;
}

export interface DayLogView {
	date: IsoDate;
	tz_offset_min: number;
	entries: DayLogEntry[];
}

interface EvidenceRow {
	id: string;
	kind: DayLogEvidence["kind"];
	text: string | null;
	mime: string | null;
	width: number | null;
	height: number | null;
	created_at: string;
	activity_id: string | null;
	meal_id: string | null;
	weight_id: string | null;
	plan_id: string | null;
}

function toEvidence(row: EvidenceRow): DayLogEvidence {
	return { id: row.id, kind: row.kind, text: row.text, mime: row.mime, width: row.width, height: row.height };
}

/** The first thing the user actually said, if any: the transcript, else the typed note. */
function rawTextOf(evidence: DayLogEvidence[]): string | null {
	const spoken = evidence.find((item) => item.kind === "transcript" && item.text);
	if (spoken?.text) return spoken.text;
	return evidence.find((item) => item.kind === "text" && item.text)?.text ?? null;
}

/**
 * The icon column. A Health row is a heart whatever evidence it has (it has none); after
 * that the strongest thing in the evidence wins — a photo, then a transcript, then the
 * keyboard, which is also what a row with no evidence at all looks like.
 */
function iconOf(evidence: DayLogEvidence[], source: string | null): DayLogIcon {
	if (source === "health") return "heart";
	if (evidence.some((item) => item.kind === "photo")) return "camera";
	if (evidence.some((item) => item.kind === "transcript")) return "mic";
	return "keyboard";
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function activityUnderstood(record: Extract<DayLogRecord, { kind: "activity" }>): string {
	const parts: string[] = [record.exercise ?? record.description];
	if (record.sets != null && record.reps != null) parts.push(`${record.sets} × ${record.reps}`);
	else if (record.sets != null) parts.push(`${record.sets} sets`);
	if (record.load_lb != null) parts.push(`${round1(record.load_lb)} lb`);
	if (record.duration_min != null) parts.push(`${record.duration_min} min`);
	if (record.distance_mi != null) parts.push(`${round1(record.distance_mi)} mi`);
	if (record.kcal > 0) parts.push(`${Math.round(record.kcal)} kcal`);
	return parts.join(" · ");
}

function mealUnderstood(record: Extract<DayLogRecord, { kind: "meal" }>): string {
	const parts: string[] = [record.description, `${Math.round(record.kcal)} kcal`];
	if (record.protein_g != null) parts.push(`${Math.round(record.protein_g)} g protein`);
	return parts.join(" · ");
}

interface ActivityRow {
	id: string;
	logged_at: string;
	description: string;
	exercise: string | null;
	category: string | null;
	muscle_groups: string[] | null;
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	kcal: number | null;
	source: string | null;
	confidence: string | null;
}

interface MealRow {
	id: string;
	logged_at: string;
	description: string;
	meal_type: string | null;
	kcal: number;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
}

interface WeightRow {
	id: string;
	logged_at: string;
	weight_lb: number;
}

interface GoalRow {
	id: string;
	title: string;
	kind: string;
	metrics: unknown[] | null;
	stated_at: string;
}

export interface DayLogOptions {
	userId: string;
	date: IsoDate;
	tzOffsetMin: number;
}

/** Everything logged on one local day, in the order it was logged. */
export async function dayLog(db: Queryable, { userId, date, tzOffsetMin }: DayLogOptions): Promise<DayLogView> {
	const { startUtc, endUtc } = boundsOf(date, tzOffsetMin);
	const window = [userId, startUtc.toISOString(), endUtc.toISOString()];

	const activities = await db.query<ActivityRow>(
		`SELECT id, logged_at, description, exercise, category, muscle_groups, sets, reps, load_lb,
		        duration_min, distance_mi, kcal, source, confidence
		   FROM activities WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3`,
		window
	);
	const meals = await db.query<MealRow>(
		`SELECT id, logged_at, description, meal_type, kcal, protein_g, carbs_g, fat_g, fiber_g
		   FROM meals WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3`,
		window
	);
	const weights = await db.query<WeightRow>(
		`SELECT id, logged_at, weight_lb FROM weight_logs
		  WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3`,
		window
	);
	// A goal is dated by when it was said, not by a logged_at it does not have.
	const goals = await db.query<GoalRow>(
		`SELECT id, title, kind, metrics, stated_at FROM goals
		  WHERE user_id = $1 AND stated_at >= $2 AND stated_at < $3`,
		window
	);

	// Evidence by owner rather than by created_at: a log confirmed after midnight, or
	// backdated by the phone, belongs to the record's day and not to the upload's.
	const ownerIds = [
		activities.rows.map((row) => row.id),
		meals.rows.map((row) => row.id),
		weights.rows.map((row) => row.id),
		goals.rows.map((row) => row.id),
	];
	const evidence = await db.query<EvidenceRow>(
		`SELECT id, kind, text, mime, width, height, created_at, activity_id, meal_id, weight_id, plan_id
		   FROM evidence
		  WHERE user_id = $1
		    AND (
		         activity_id = ANY($4::uuid[])
		      OR meal_id     = ANY($5::uuid[])
		      OR weight_id   = ANY($6::uuid[])
		      OR plan_id     = ANY($7::uuid[])
		      OR (activity_id IS NULL AND meal_id IS NULL AND weight_id IS NULL AND plan_id IS NULL
		          AND confirmed_at IS NOT NULL AND created_at >= $2 AND created_at < $3)
		    )
		  ORDER BY created_at`,
		[...window, ...ownerIds]
	);

	const byOwner = new Map<string, DayLogEvidence[]>();
	const orphans: EvidenceRow[] = [];
	for (const row of evidence.rows) {
		const owner = row.activity_id ?? row.meal_id ?? row.weight_id ?? row.plan_id;
		if (!owner) {
			orphans.push(row);
			continue;
		}
		const list = byOwner.get(owner) ?? [];
		list.push(toEvidence(row));
		byOwner.set(owner, list);
	}

	const entries: DayLogEntry[] = [];

	for (const row of activities.rows) {
		const record: DayLogRecord = {
			kind: "activity",
			description: row.description,
			exercise: row.exercise,
			category: row.category,
			muscle_groups: row.muscle_groups ?? [],
			sets: row.sets,
			reps: row.reps,
			load_lb: row.load_lb,
			duration_min: row.duration_min,
			distance_mi: row.distance_mi,
			kcal: row.kcal ?? 0,
		};
		const own = byOwner.get(row.id) ?? [];
		entries.push({
			id: row.id,
			kind: "activity",
			logged_at: row.logged_at,
			raw_text: rawTextOf(own),
			icon: iconOf(own, row.source),
			evidence: own,
			source: row.source,
			confidence: row.confidence,
			understood: activityUnderstood(record),
			editable: true,
			record,
		});
	}

	for (const row of meals.rows) {
		const record: DayLogRecord = {
			kind: "meal",
			description: row.description,
			meal_type: row.meal_type,
			kcal: row.kcal,
			protein_g: row.protein_g,
			carbs_g: row.carbs_g,
			fat_g: row.fat_g,
			fiber_g: row.fiber_g,
		};
		const own = byOwner.get(row.id) ?? [];
		entries.push({
			id: row.id,
			kind: "meal",
			logged_at: row.logged_at,
			raw_text: rawTextOf(own),
			icon: iconOf(own, null),
			evidence: own,
			source: null,
			confidence: null,
			understood: mealUnderstood(record),
			editable: true,
			record,
		});
	}

	for (const row of weights.rows) {
		const own = byOwner.get(row.id) ?? [];
		entries.push({
			id: row.id,
			kind: "weight",
			logged_at: row.logged_at,
			raw_text: rawTextOf(own),
			icon: iconOf(own, null),
			evidence: own,
			source: null,
			confidence: null,
			understood: `Weighed ${round1(row.weight_lb)} lb`,
			editable: true,
			record: { kind: "weight", weight_lb: row.weight_lb },
		});
	}

	for (const row of goals.rows) {
		const own = byOwner.get(row.id) ?? [];
		entries.push({
			id: row.id,
			kind: "goal",
			logged_at: row.stated_at,
			raw_text: rawTextOf(own),
			icon: iconOf(own, null),
			evidence: own,
			source: null,
			confidence: null,
			understood: `Goal · ${row.title}`,
			editable: true,
			record: { kind: "goal", title: row.title, goal_kind: row.kind, metrics: row.metrics ?? [] },
		});
	}

	for (const row of orphans) {
		const own = [toEvidence(row)];
		const text = row.text ?? "";
		entries.push({
			id: row.id,
			kind: "statement",
			logged_at: row.created_at,
			raw_text: rawTextOf(own),
			icon: iconOf(own, null),
			evidence: own,
			source: null,
			confidence: null,
			understood: "Saved to your plan",
			// Nothing to PATCH: a constraint lives in an array on the profile and a coach
			// context is gone tomorrow. The Goals screen edits the plan.
			editable: false,
			record: { kind: "statement", text },
		});
	}

	entries.sort((a, b) => a.logged_at.localeCompare(b.logged_at));
	return { date, tz_offset_min: tzOffsetMin, entries };
}
