import { createHash } from "node:crypto";
import type pg from "pg";
import type { Brief, CoachBriefInputs, CoachPlan, CoachPort, CoachToday } from "../../ports/coach.js";
import { computeDay, type DayView } from "../day.js";
import { listGoals } from "../goals/store.js";
import { formatClock, localDay, localMinutesOf, type IsoDate } from "../localTime.js";
import { loadTargets } from "../profile.js";
import { computeFeatures, type CoachFeatures } from "./features.js";
import { buildRules, type CoachGoal, type NudgeAction } from "./rules.js";

// The brief: gathering its inputs, caching it for the day, and storing it
// (docs/concept-v2.md §Coach — "on demand … cached for the rest of the day so repeated
// taps are consistent and free; Regenerate is explicit").
//
// Three things this module is responsible for and nothing else is:
//
//   * **It is never scheduled.** There is no job, no cron and no notification anywhere in
//     this codebase that produces a brief. It is generated when a user asks, and only then
//     (concept-v2 §Principles 5: "the coach is a button, not a schedule").
//   * **The cache key is the day plus everything the answer depends on** — the features,
//     the rules, the plan, the goals and the context. Tapping twice with nothing changed
//     replays the same brief for free; logging a workout, or saying something new when
//     asking, produces a new one. That is `inputs_hash`, and 0004's partial unique index on
//     (user_id, date, inputs_hash) is what makes a row per distinct answer.
//   * **The deterministic parts are merged after the call.** `nudge_action` is chosen by
//     services/coach/rules.ts; the model writes the sentence around it.

type Queryable = pg.Pool | pg.PoolClient;

/** The brief as the API returns it and `coach_briefs` stores it. */
export interface CoachBriefRecord {
	id: string;
	date: IsoDate;
	asked_at: string;
	/** What the user said when asking, plus the day's saved coach-context statements. */
	context: string | null;
	headline: string;
	why: string;
	workout: Brief["workout"];
	nutrition: Brief["nutrition"];
	nudge: string;
	/** What the app can do about the nudge; null when there is nothing to act on. */
	nudge_action: NudgeAction | null;
	model: string | null;
	inputs_hash: string;
	created_at: string;
	/** True when this answer came from the cache rather than the model. */
	cached: boolean;
}

interface BriefRow {
	id: string;
	date: IsoDate;
	asked_at: string;
	context: string | null;
	headline: string | null;
	rationale: string | null;
	workout: Brief["workout"] | null;
	nutrition: Brief["nutrition"] | null;
	nudge: string | null;
	nudge_action: NudgeAction | null;
	model: string | null;
	inputs_hash: string | null;
	created_at: string;
}

const BRIEF_COLUMNS = `id, date, asked_at, context, headline, rationale, workout, nutrition,
	nudge, nudge_action, model, inputs_hash, created_at`;

function toRecord(row: BriefRow, cached: boolean): CoachBriefRecord {
	return {
		id: row.id,
		date: row.date,
		asked_at: row.asked_at,
		context: row.context,
		headline: row.headline ?? "",
		// `rationale` is 0004's name for the brief's `why`; 0008's note explains the pairing.
		why: row.rationale ?? "",
		workout: row.workout ?? { type: "rest", targets: [], exercises: [] },
		nutrition: row.nutrition ?? { kcal: 0, protein_g: 0, carbs_max_g: null, ideas: [], why: "" },
		nudge: row.nudge ?? "",
		nudge_action: row.nudge_action,
		model: row.model,
		inputs_hash: row.inputs_hash ?? "",
		created_at: row.created_at,
		cached,
	};
}

// ---------------------------------------------------------------------------
// Context — what the user said about today
// ---------------------------------------------------------------------------

/**
 * Save a `coach_context` statement from the fusion pipeline against the user's local day.
 * WP2 classified these and had nowhere to put them; this is where they live, and they are
 * read back only by the coach, only on the day they were said (migration 0008).
 */
export async function saveCoachContext(
	db: Queryable,
	userId: string,
	date: IsoDate,
	text: string
): Promise<{ date: IsoDate; text: string }> {
	const trimmed = text.trim();
	await db.query(
		`INSERT INTO coach_contexts (user_id, date, text) VALUES ($1, $2::date, $3)
		 ON CONFLICT DO NOTHING`,
		[userId, date, trimmed]
	);
	return { date, text: trimmed };
}

/** Everything the user has said about this day, oldest first. */
export async function dayContexts(db: Queryable, userId: string, date: IsoDate): Promise<string[]> {
	const { rows } = await db.query<{ text: string }>(
		`SELECT text FROM coach_contexts WHERE user_id = $1 AND date = $2::date ORDER BY created_at`,
		[userId, date]
	);
	return rows.map((row) => row.text);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface PlanRow {
	diet_style: string | null;
	training_days: number | null;
	environment: string | null;
	equipment: string[] | null;
	constraints: string[] | null;
	preferences: string[] | null;
	eatback: string | null;
	goal_pace: string | null;
}

/** The weekly cardio minutes a goal asks for, when one does. */
function cardioTargetFrom(goals: readonly CoachGoal[]): number | null {
	for (const goal of goals) {
		for (const metric of goal.metrics) {
			if (metric.measure === "weekly_cardio_min" && metric.target != null) return metric.target;
		}
	}
	return null;
}

function todayFrom(view: DayView): CoachToday {
	return {
		eaten: view.eaten,
		earned: view.earned,
		target: view.target,
		allowance: view.allowance,
		remaining: view.remaining,
		protein_g: view.macros.protein_g.eaten,
		status: view.status,
		trained: view.blocks.map((block) => block.title),
	};
}

export interface LoadInputsOptions {
	date: IsoDate;
	tzOffsetMin: number;
	now?: Date;
	/** What the user typed or said in this ask. Appended to the day's saved contexts. */
	context?: string | null;
}

/**
 * Everything the prompt needs, in one place: the day so far, the plan, the goals in
 * priority order with WP4's reached/stalled candidates, the computed features and the
 * rules derived from them.
 */
export async function loadCoachInputs(
	db: Queryable,
	userId: string,
	{ date, tzOffsetMin, now = new Date(), context = null }: LoadInputsOptions
): Promise<CoachBriefInputs> {
	const view = await computeDay(db, { userId, date, tzOffsetMin, now });
	const targets = await loadTargets(db, userId, date, tzOffsetMin);

	const plan = (
		await db.query<PlanRow>(
			`SELECT diet_style, training_days, environment, equipment, constraints, preferences,
			        eatback, goal_pace
			   FROM profiles WHERE id = $1`,
			[userId]
		)
	).rows[0] ?? null;

	// Through the goals store, so the coach sees exactly what the Goals screen sees:
	// priority order, per-goal progress, and the reached/stalled candidates WP4 writes at
	// day close (services/goals/detect.ts).
	const goalsView = await listGoals(db, userId, { tzOffsetMin, now });
	const goals: CoachGoal[] = goalsView.active.map((goal) => ({
		id: goal.id,
		kind: goal.kind,
		title: goal.title,
		priority: goal.priority,
		metrics: goal.metrics,
		reached_candidate_at: goal.reached_candidate_at,
		stalled_since: goal.stalled_since,
		reached_why: goal.progress.detection.reached_why,
		progress_percent: goal.progress.percent,
	}));

	const features = computeFeatures({
		facts: view.facts,
		trainingDaysTarget: plan?.training_days ?? null,
		cardioTargetMin: cardioTargetFrom(goals),
		targets: {
			kcal: view.target,
			protein_g: view.macros.protein_g.target,
			carbs_max_g: view.macros.carbs_g.target,
		},
	});

	const rules = buildRules({ features, goals, equipment: await equipmentFor(db, features) });

	const statements = await dayContexts(db, userId, date);
	const said = [...statements, ...(context?.trim() ? [context.trim()] : [])];

	const coachPlan: CoachPlan = {
		goal_pace: plan?.goal_pace ?? null,
		diet_style: plan?.diet_style ?? null,
		training_days: plan?.training_days ?? null,
		environment: plan?.environment ?? null,
		equipment: plan?.equipment ?? [],
		constraints: plan?.constraints ?? [],
		preferences: plan?.preferences ?? [],
		eatback: plan?.eatback ?? "half",
		units: "lb",
		targets: {
			kcal: view.target,
			protein_g: view.macros.protein_g.target,
			carbs_max_g: view.macros.carbs_g.target,
			fat_g: view.macros.fat_g.target,
			tracking_only: targets.trackingOnly,
		},
	};

	return {
		date,
		local_time: formatClock(localMinutesOf(now, tzOffsetMin)),
		goals,
		plan: coachPlan,
		features,
		rules,
		today: todayFrom(view),
		context: said.length > 0 ? said.join(" · ") : null,
	};
}

/** Equipment per exercise, so the progression can step a stack by percentage (rules.ts). */
async function equipmentFor(db: Queryable, features: CoachFeatures): Promise<Record<string, string[]>> {
	const names = features.exercises.map((exercise) => exercise.exercise.trim().toLowerCase());
	if (names.length === 0) return {};
	const { rows } = await db.query<{ name: string; equipment: string[] | null }>(
		`SELECT name, equipment FROM exercise_catalog WHERE lower(name) = ANY($1::text[])`,
		[names]
	);
	return Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.equipment ?? []]));
}

// ---------------------------------------------------------------------------
// The cache key
// ---------------------------------------------------------------------------

/**
 * What the brief is *about*. Anything on this list changing means the advice is stale;
 * anything off it (the clock, a second tap) does not.
 *
 * The whole feature set and the whole rule set are in it deliberately — unlike the day
 * reading, whose hash had to exclude a NOW marker that moves every minute, every number the
 * coach reads is a fact about what was logged. The local *hour* is in it because a brief at
 * 6 am and one at 9 pm are different answers to the same question; the minute is not.
 */
export function briefInputsHash(inputs: CoachBriefInputs): string {
	const material = {
		date: inputs.date,
		hour: inputs.local_time.slice(0, inputs.local_time.indexOf(":")) + inputs.local_time.slice(-2),
		goals: inputs.goals.map((goal) => [goal.id, goal.priority, goal.reached_candidate_at, goal.stalled_since]),
		plan: inputs.plan,
		today: inputs.today,
		features: inputs.features,
		prescriptions: inputs.rules.prescriptions,
		gap: inputs.rules.gap.level,
		nudge: inputs.rules.nudge.action,
		context: inputs.context,
	};
	return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Reading and writing briefs
// ---------------------------------------------------------------------------

export async function cachedBrief(
	db: Queryable,
	userId: string,
	date: IsoDate,
	inputsHash: string
): Promise<CoachBriefRecord | null> {
	const { rows } = await db.query<BriefRow>(
		`SELECT ${BRIEF_COLUMNS} FROM coach_briefs
		  WHERE user_id = $1 AND date = $2::date AND inputs_hash = $3`,
		[userId, date, inputsHash]
	);
	return rows[0] ? toRecord(rows[0], true) : null;
}

/** The most recent brief for a day, whatever it was generated from. The Day screen's card. */
export async function latestBrief(db: Queryable, userId: string, date: IsoDate): Promise<CoachBriefRecord | null> {
	const { rows } = await db.query<BriefRow>(
		`SELECT ${BRIEF_COLUMNS} FROM coach_briefs WHERE user_id = $1 AND date = $2::date
		  ORDER BY asked_at DESC LIMIT 1`,
		[userId, date]
	);
	return rows[0] ? toRecord(rows[0], true) : null;
}

async function storeBrief(
	db: Queryable,
	userId: string,
	inputs: CoachBriefInputs,
	inputsHash: string,
	brief: Brief,
	model: string
): Promise<CoachBriefRecord> {
	const { rows } = await db.query<BriefRow>(
		`INSERT INTO coach_briefs (user_id, date, asked_at, context, headline, rationale, workout,
		                           nutrition, nudge, nudge_action, model, inputs_hash)
		 VALUES ($1, $2::date, NOW(), $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11)
		 ON CONFLICT (user_id, date, inputs_hash) WHERE inputs_hash IS NOT NULL DO UPDATE SET
		   asked_at = NOW(), context = EXCLUDED.context, headline = EXCLUDED.headline,
		   rationale = EXCLUDED.rationale, workout = EXCLUDED.workout,
		   nutrition = EXCLUDED.nutrition, nudge = EXCLUDED.nudge,
		   nudge_action = EXCLUDED.nudge_action, model = EXCLUDED.model
		 RETURNING ${BRIEF_COLUMNS}`,
		[
			userId,
			inputs.date,
			inputs.context,
			brief.headline,
			brief.why,
			JSON.stringify(brief.workout),
			JSON.stringify(brief.nutrition),
			brief.nudge,
			inputs.rules.nudge.action ? JSON.stringify(inputs.rules.nudge.action) : null,
			model,
			inputsHash,
		]
	);
	return toRecord(rows[0] as BriefRow, false);
}

export interface NextBriefOptions extends LoadInputsOptions {
	/** Ask again even if the cache has this exact answer (POST /api/coach/next/regenerate). */
	regenerate?: boolean;
}

export interface NextBriefResult {
	brief: CoachBriefRecord;
	inputs: CoachBriefInputs;
	/** True when the model could not be reached and an earlier brief was served instead. */
	stale: boolean;
}

/** Thrown when there is no brief to serve at all — the route turns it into a 503. */
export class CoachUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CoachUnavailableError";
	}
}

/**
 * Today's brief: the cached one when nothing has changed, a new one when something has,
 * and always a new one for an explicit regenerate.
 */
export async function nextBrief(
	db: Queryable,
	coach: CoachPort,
	userId: string,
	options: NextBriefOptions
): Promise<NextBriefResult> {
	const inputs = await loadCoachInputs(db, userId, options);
	const hash = briefInputsHash(inputs);

	if (!options.regenerate) {
		const cached = await cachedBrief(db, userId, inputs.date, hash);
		if (cached) return { brief: cached, inputs, stale: false };
	}

	try {
		const answer = await coach.brief(inputs);
		const stored = await storeBrief(db, userId, inputs, hash, answer, coach.model);
		return { brief: stored, inputs, stale: false };
	} catch (error) {
		// A brief the user has already read beats an error page; nothing at all is a 503,
		// because unlike a day reading the brief *is* the answer they asked for.
		const previous = await latestBrief(db, userId, inputs.date);
		if (previous) {
			console.warn(`⚠️  Coach unavailable for ${inputs.date}, serving the previous brief:`, describe(error));
			return { brief: previous, inputs, stale: true };
		}
		throw new CoachUnavailableError(describe(error));
	}
}

/** The local date the user is asking about, from their offset. */
export function coachDate(now: Date, tzOffsetMin: number): IsoDate {
	return localDay(now, tzOffsetMin).date;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
