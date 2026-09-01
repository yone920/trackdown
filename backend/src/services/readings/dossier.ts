import { createHash } from "node:crypto";
import type pg from "pg";
import type { LlmPort } from "../../ports/llm.js";
import { computeFeatures } from "../coach/features.js";
import { loadFacts } from "../goals/store.js";
import { listGoals } from "../goals/store.js";
import { addDays, localDay, type IsoDate } from "../localTime.js";
import { currentPlaceSummary } from "../places.js";
import { loadTargets } from "../profile.js";
import { buildDossierPrompt, buildDossierSheet, type DossierInputs } from "./prompt.js";
import { DOSSIER_SCHEMA_NAME, DossierSchema } from "./schema.js";

// "What I know about you" — the two paragraphs at the top of the You screen.
//
// The third generated reading in this codebase and the first that is not about a day. It
// follows the same pattern as services/readings/readings.ts and for the same reasons: the
// model is handed a *computed* sheet rather than rows, the answer is cached against a hash
// of that sheet, and a provider outage returns the last good one rather than an error.
//
// What is different is the cache key. A day reading is keyed by the day; this is keyed by
// the user, because a dossier keyed by date would regenerate at every local midnight to say
// the same thing about a profile nobody had touched (migration 0017). It regenerates when
// the *sheet* changes — a stated fact, a goal, or four weeks of training that have moved —
// which is exactly the set of things that would make the paragraphs wrong.

type Queryable = pg.Pool | pg.PoolClient;

/** Two short paragraphs. Room for the schema's max plus the JSON around it. */
const MAX_TOKENS = 500;

/** The window the observed half of the dossier reads. The same 28 days the coach reads. */
const WINDOW_DAYS = 28;

export interface DossierReading {
	known: string;
	missing: string;
	inputs_hash: string;
	model: string | null;
	created_at: string;
}

interface DossierRow {
	known: string;
	missing: string;
	inputs_hash: string;
	model: string | null;
	created_at: string;
}

/**
 * The cache key: a sha256 of the rendered sheet, prompt fingerprint included (the sheet is
 * built by `buildDossierPrompt`, which starts with the instructions).
 *
 * Hashing the rendered string rather than a hand-picked list of fields is the whole point.
 * A field added to the sheet is covered the day it is added, with nothing to remember — and
 * the sheet is deterministic, so the same profile and the same four weeks always produce the
 * same key.
 */
export function dossierInputsHash(inputs: DossierInputs): string {
	return createHash("sha256").update(buildDossierPrompt(inputs)).digest("hex").slice(0, 32);
}

interface PlanRow {
	training_days: number | null;
	session_minutes: number | null;
	cardio_minutes_target: number | null;
	diet_style: string | null;
	environment: string | null;
	equipment: string[] | null;
	eatback: string | null;
	experience: string | null;
	background: string | null;
	reference_loads: { exercise: string; load_lb: number; reps: number | null }[] | null;
	constraints: string[] | null;
	preferences: string[] | null;
	stated_at: Record<string, string> | null;
}

/**
 * Everything the dossier is written from, in one pass. Nothing here is computed twice: the
 * plan is the profile row, the targets are `loadTargets`, the goals are the goals store the
 * Progress tab reads, and the observed half is `computeFeatures` — the same object the coach
 * and the training board are built on.
 */
export async function loadDossierInputs(
	db: Queryable,
	userId: string,
	{ tzOffsetMin, now = new Date() }: { tzOffsetMin: number; now?: Date }
): Promise<DossierInputs> {
	const date = localDay(now, tzOffsetMin).date;

	const plan =
		(
			await db.query<PlanRow>(
				`SELECT training_days, session_minutes, cardio_minutes_target, diet_style, environment,
				        equipment, eatback, experience, background, reference_loads, constraints,
				        preferences, stated_at
				   FROM profiles WHERE id = $1`,
				[userId]
			)
		).rows[0] ?? null;

	const facts = await loadFacts(db, userId, { date, from: addDays(date, -(WINDOW_DAYS - 1)), tzOffsetMin });
	const targets = await loadTargets(db, userId, date, tzOffsetMin);
	const goalsView = await listGoals(db, userId, { tzOffsetMin, now });
	const place = await currentPlaceSummary(db, userId);

	// A goal that names weekly cardio minutes beats the profile column, which beats the
	// guideline — resolved here the same way the board and the brief resolve it.
	const cardioTargetMin =
		goalsView.active
			.flatMap((goal) => goal.metrics)
			.find((metric) => metric.measure === "weekly_cardio_min" && metric.target != null)?.target ?? null;

	const features = computeFeatures({
		facts,
		trainingDaysTarget: plan?.training_days ?? null,
		cardioTargetMin,
		cardioTargetStatedMin: plan?.cardio_minutes_target ?? null,
		targets: { kcal: targets.target, protein_g: targets.macros?.protein_g ?? null, carbs_max_g: null },
	});

	return {
		date,
		plan: {
			training_days: plan?.training_days ?? null,
			session_minutes: plan?.session_minutes ?? null,
			cardio_minutes_target: plan?.cardio_minutes_target ?? null,
			diet_style: plan?.diet_style ?? null,
			environment: plan?.environment ?? null,
			equipment: Array.isArray(plan?.equipment) ? plan.equipment : [],
			eatback: plan?.eatback ?? null,
			experience: plan?.experience ?? null,
			background: plan?.background ?? null,
			reference_loads: Array.isArray(plan?.reference_loads) ? plan.reference_loads : [],
			constraints: Array.isArray(plan?.constraints) ? plan.constraints : [],
			preferences: Array.isArray(plan?.preferences) ? plan.preferences : [],
			place: place ? { name: place.name, kind: place.kind, equipment_count: place.equipment_count } : null,
			stated_at: (plan?.stated_at ?? {}) as Record<string, string>,
		},
		targets: {
			tdee: targets.tdee,
			eat_target: targets.target,
			protein_g: targets.macros?.protein_g ?? null,
			carbs_g: targets.macros?.carbs_g ?? null,
			source: targets.source,
			eatback: (plan?.eatback as string) ?? "half",
			weight_lb: targets.weight_lb,
		},
		goals: goalsView.active.map((goal) => ({
			title: goal.title,
			kind: goal.kind,
			active_from: goal.active_from as IsoDate,
			active_to: (goal.active_to ?? null) as IsoDate | null,
			percent: goal.progress?.percent ?? null,
			metrics: goal.metrics.map((metric) => ({ measure: metric.measure, target: metric.target ?? null })),
		})),
		goal_history: goalsView.history.length,
		features,
	};
}

export interface ProfileReadings {
	/** The dossier, from cache unless the sheet has moved since it was written. */
	dossier(db: Queryable, userId: string, inputs: DossierInputs): Promise<DossierReading | null>;
	/** Whatever is stored, without generating anything. */
	cached(db: Queryable, userId: string): Promise<DossierReading | null>;
}

export function createProfileReadings(llm: LlmPort): ProfileReadings {
	async function cached(db: Queryable, userId: string): Promise<DossierReading | null> {
		const { rows } = await db.query<DossierRow>(
			`SELECT known, missing, inputs_hash, model, created_at
			   FROM profile_readings WHERE user_id = $1 AND kind = 'dossier'`,
			[userId]
		);
		return rows[0] ?? null;
	}

	return {
		cached,

		async dossier(db, userId, inputs) {
			const hash = dossierInputsHash(inputs);
			const existing = await cached(db, userId);
			if (existing && existing.inputs_hash === hash) return existing;

			try {
				const answer = await llm.parseStructured({
					system: buildDossierPrompt(inputs),
					schema: DossierSchema,
					schemaName: DOSSIER_SCHEMA_NAME,
					maxTokens: MAX_TOKENS,
					messages: [{ role: "user", content: "Write the two paragraphs for the person above." }],
				});
				const { rows } = await db.query<DossierRow>(
					`INSERT INTO profile_readings (user_id, kind, known, missing, inputs_hash, model)
					 VALUES ($1, 'dossier', $2, $3, $4, $5)
					 ON CONFLICT (user_id, kind) DO UPDATE
					   SET known = EXCLUDED.known, missing = EXCLUDED.missing,
					       inputs_hash = EXCLUDED.inputs_hash, model = EXCLUDED.model, updated_at = NOW()
					 RETURNING known, missing, inputs_hash, model, created_at`,
					[userId, answer.known, answer.missing, hash, llm.model]
				);
				return rows[0] ?? null;
			} catch (error) {
				console.warn(`⚠️  Dossier unavailable for ${userId}:`, describe(error));
				// A stale dossier beats a blank screen; a blank screen beats a 500. The You
				// page draws its constraints and its account either way.
				return existing;
			}
		},
	};
}

/** Re-exported so a caller can render the sheet without importing the prompt module. */
export { buildDossierSheet };

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
