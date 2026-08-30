import { createHash } from "node:crypto";
import type pg from "pg";
import type { LlmPort } from "../../ports/llm.js";
import type { DayView } from "../day.js";
import { formatClock, localMinutesOf, type IsoDate } from "../localTime.js";
import { buildInShortPrompt, buildRightNowPrompt } from "./prompt.js";
import {
	IN_SHORT_SCHEMA_NAME,
	InShortSchema,
	RIGHT_NOW_SCHEMA_NAME,
	RightNowSchema,
	type Reading,
	type ReadingKind,
} from "./schema.js";

// The generated half of the day, and its cache.
//
// `right_now` is regenerated when the day's *inputs hash* changes — that is, when something
// happened, not when the clock moved. Tapping Today ten times in a row is one generation;
// logging a meal makes the eleventh a new one. `in_short` is written once, when the day
// closes, and never revised: a closed day's reading is a record.
//
// A missing API key, a provider outage or a refusal must not break the day view. Every
// generation is wrapped: the last good reading is returned if there is one, otherwise null,
// and the day is rendered without it. The reading is the one part of a day that is allowed
// to be absent.

type Queryable = pg.Pool | pg.PoolClient;

/** Two sentences. Room for the schema's max plus the JSON around it. */
const MAX_TOKENS = 400;

interface ReadingRow {
	kind: ReadingKind;
	text: string;
	next_action: Reading["next_action"];
	actions: Reading["actions"] | null;
	inputs_hash: string;
	model: string | null;
	created_at: string;
}

function toReading(row: ReadingRow): Reading {
	return {
		kind: row.kind,
		text: row.text,
		next_action: row.next_action,
		actions: row.actions ?? [],
		inputs_hash: row.inputs_hash,
		model: row.model,
		created_at: row.created_at,
	};
}

/**
 * What the reading is *about*. Anything on this list changing means the sentences are stale;
 * anything off it (the clock ticking, a second read of the same day) does not.
 *
 * Deliberately not the whole DayView: `arc` carries a NOW marker that moves every minute,
 * and hashing it would regenerate the reading on every request — the cost the cache exists
 * to avoid.
 */
export function dayInputsHash(view: DayView): string {
	const material = {
		date: view.date,
		goal: view.goal?.id ?? null,
		eaten: view.eaten,
		earned: view.earned,
		target: view.target,
		allowance: view.allowance,
		status: view.status,
		verdict: view.verdict,
		weight: view.weight,
		macros: view.macros,
		meals: view.items.meals.map((meal) => [meal.slot, meal.description, meal.kcal]),
		blocks: view.blocks.map((block) => [block.title, block.exercise_count, block.kcal, block.health?.external_id ?? null]),
		activities: view.items.activities.map((item) => [
			item.exercise ?? item.description,
			item.sets,
			item.reps,
			item.load_lb,
			item.duration_min,
			item.delta_vs_last?.text ?? null,
		]),
		// What the day is waiting for is part of the reading's point ("dinner is still open").
		expected: view.expected.map((item) => [item.kind, item.slot ?? null]),
	};
	return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32);
}

export interface DayReadings {
	/** The live day's reading, from cache unless the day has changed since it was written. */
	rightNow(db: Queryable, userId: string, view: DayView, now?: Date): Promise<Reading | null>;
	/** The closed day's reading. Written once; a second call returns the first one. */
	inShort(db: Queryable, userId: string, view: DayView): Promise<Reading | null>;
	/** Whatever is stored, without generating anything. */
	cached(db: Queryable, userId: string, date: IsoDate, kind: ReadingKind): Promise<Reading | null>;
}

export function createDayReadings(llm: LlmPort): DayReadings {
	async function cached(db: Queryable, userId: string, date: IsoDate, kind: ReadingKind): Promise<Reading | null> {
		const { rows } = await db.query<ReadingRow>(
			`SELECT kind, text, next_action, actions, inputs_hash, model, created_at
			   FROM day_readings WHERE user_id = $1 AND date = $2::date AND kind = $3`,
			[userId, date, kind]
		);
		const row = rows[0];
		return row ? toReading(row) : null;
	}

	async function store(
		db: Queryable,
		userId: string,
		date: IsoDate,
		kind: ReadingKind,
		reading: Omit<Reading, "kind" | "created_at">
	): Promise<Reading> {
		const { rows } = await db.query<ReadingRow>(
			`INSERT INTO day_readings (user_id, date, kind, inputs_hash, text, next_action, actions, model)
			 VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
			 ON CONFLICT (user_id, date, kind) DO UPDATE
			   SET inputs_hash = EXCLUDED.inputs_hash, text = EXCLUDED.text,
			       next_action = EXCLUDED.next_action, actions = EXCLUDED.actions,
			       model = EXCLUDED.model, updated_at = NOW()
			 RETURNING kind, text, next_action, actions, inputs_hash, model, created_at`,
			[
				userId,
				date,
				kind,
				reading.inputs_hash,
				reading.text,
				reading.next_action ? JSON.stringify(reading.next_action) : null,
				JSON.stringify(reading.actions),
				reading.model,
			]
		);
		return toReading(rows[0] as ReadingRow);
	}

	return {
		cached,

		async rightNow(db, userId, view, now = new Date()) {
			const hash = dayInputsHash(view);
			const existing = await cached(db, userId, view.date, "right_now");
			if (existing && existing.inputs_hash === hash) return existing;

			try {
				const localTime = formatClock(localMinutesOf(now.toISOString(), view.tz_offset_min));
				const answer = await llm.parseStructured({
					system: buildRightNowPrompt(view, localTime),
					schema: RightNowSchema,
					schemaName: RIGHT_NOW_SCHEMA_NAME,
					maxTokens: MAX_TOKENS,
					messages: [{ role: "user", content: "Write the Right now reading for the day above." }],
				});
				return await store(db, userId, view.date, "right_now", {
					text: answer.text,
					next_action: answer.next_action,
					actions: answer.actions,
					inputs_hash: hash,
					model: llm.model,
				});
			} catch (error) {
				console.warn(`⚠️  Right-now reading unavailable for ${view.date}:`, describe(error));
				// A stale reading beats a blank card; a blank card beats a 500.
				return existing;
			}
		},

		async inShort(db, userId, view) {
			const existing = await cached(db, userId, view.date, "in_short");
			if (existing) return existing;

			try {
				const answer = await llm.parseStructured({
					system: buildInShortPrompt(view),
					schema: InShortSchema,
					schemaName: IN_SHORT_SCHEMA_NAME,
					maxTokens: MAX_TOKENS,
					messages: [{ role: "user", content: "Write the In short reading for the day above." }],
				});
				return await store(db, userId, view.date, "in_short", {
					text: answer.text,
					next_action: null,
					actions: [],
					inputs_hash: dayInputsHash(view),
					model: llm.model,
				});
			} catch (error) {
				console.warn(`⚠️  In-short reading unavailable for ${view.date}:`, describe(error));
				return null;
			}
		},
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
