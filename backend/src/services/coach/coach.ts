import { createHash } from "node:crypto";
import type pg from "pg";
import type {
	Brief,
	BriefRevision,
	CoachBriefInputs,
	CoachPlan,
	CoachPort,
	CoachToday,
	RevisedBrief,
} from "../../ports/coach.js";
import { computeDay, type DayView } from "../day.js";
import { lookupExercises } from "../entries.js";
import type { ReferenceLoad } from "../fusion/schema.js";
import { listGoals } from "../goals/store.js";
import { formatClock, localDay, localMinutesOf, type IsoDate } from "../localTime.js";
import { currentPlace, placeEquipment } from "../places.js";
import { loadTargets } from "../profile.js";
import { catalogFactsFor, introductionCandidates } from "./catalog.js";
import { completionOf, planIsComplete, sameMovement, type ExerciseCompletion } from "./completion.js";
import { computeFeatures } from "./features.js";
import {
	assertUsableBrief,
	assertUsableRevision,
	resolveRestAfterTraining,
	UnusableBriefError,
	type RevisionMode,
} from "./schema.js";
import { buildRules, type CoachGoal, type NudgeAction, type TrainingBackground } from "./rules.js";
import { classifyProviderError, type LlmErrorCode } from "../llmErrors.js";

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

/**
 * How much of the observed kit the prompt is told about. One compact line, most-used first:
 * a hundred labels would be a list the model skims, and the tail of that list is the machine
 * someone used once in March.
 */
const MAX_OBSERVED_EQUIPMENT = 20;

/**
 * One line of the Do list, plus the catalogue row its name resolves to. The id is
 * resolved when the brief is *returned*, not when it is stored: the model writes a name,
 * and a name that was not in the catalogue last week may be in it today. The app never
 * matches exercise strings — it opens the sheet by this id, or by nothing.
 */
export type BriefExercise = Brief["workout"]["exercises"][number] & {
	exercise_id: string | null;
	/**
	 * How many illustrations the catalogue holds for this name; 0 when it holds none and
	 * when the name resolved to nothing at all. Resolved with the id, on the same lookup,
	 * so the plan can show which names have a picture behind them before anyone taps
	 * (field report 2026-09-01).
	 */
	media_count: number;
	/**
	 * True when the catalogue says this movement is loaded with plates on a bar. The app
	 * draws the per-side breakdown beside the prescribed total from it (lib/plates.ts) —
	 * a barbell total is the right thing to store and the wrong thing to load by (field
	 * report 2026-09-02). Never inferred from the name: "Bench Press" is a barbell and does
	 * not say so.
	 */
	barbell: boolean;
	/**
	 * The local clock an appended item was added at ("2:05p"), null for the plan's original
	 * lines. It is what the app's "added 2:05p" divider is drawn from — stored on the brief
	 * because it is a fact about the ANSWER (when the coach said it), unlike `completion`,
	 * which is a fact about the log and is computed on every read.
	 */
	added_at: string | null;
	/** Whether this line has been done today. Computed at read time; never stored. */
	completion?: ExerciseCompletion;
};

/**
 * One line of the finisher, resolved the same way the Do list is. It gets an id and a media
 * count for exactly one reason: the field report of 2026-09-01 was that the stretch items
 * did not open at all on a tap. They are movements with names, so they open like every
 * other movement with a name — most of them into the sheet's name-only mode, which is the
 * fallback that mode exists for.
 */
export type BriefFinisherItem = NonNullable<Brief["workout"]["finisher"]>[number] & {
	exercise_id: string | null;
	media_count: number;
};

export type BriefWorkout = Omit<Brief["workout"], "exercises" | "finisher"> & {
	exercises: BriefExercise[];
	finisher: BriefFinisherItem[];
	/** True when every line of a non-empty Do list is done — the "Plan complete" state. */
	complete?: boolean;
};

/** The brief as the API returns it and `coach_briefs` stores it. */
export interface CoachBriefRecord {
	id: string;
	date: IsoDate;
	asked_at: string;
	/** What the user said when asking, plus the day's saved coach-context statements. */
	context: string | null;
	headline: string;
	why: string;
	workout: BriefWorkout;
	nutrition: Brief["nutrition"];
	nudge: string;
	/**
	 * The Eat card's live numbers — allowance − eaten, protein target − eaten (user decision
	 * 2026-08-31: "Eat goes live"). Computed on every read from the day, exactly like
	 * `completion`, and never stored: the model's `nutrition.kcal` is the day's TARGET and
	 * stays what it was, while this is what is left of it right now.
	 */
	nutrition_now?: NutritionNow;
	/** What the app can do about the nudge; null when there is nothing to act on. */
	nudge_action: NudgeAction | null;
	model: string | null;
	inputs_hash: string;
	created_at: string;
	/** True when this answer came from the cache rather than the model. */
	cached: boolean;
}

export interface NutritionNow {
	/** allowance − eaten. Negative once the day is past its allowance. Null with no target. */
	remaining_kcal: number | null;
	eaten_kcal: number;
	allowance_kcal: number | null;
	/** target − eaten, floored at 0: "you still owe 40 g" stops at zero, it does not go under. */
	remaining_protein_g: number | null;
	eaten_protein_g: number | null;
	protein_target_g: number | null;
	/** True once the allowance is spent. The card's quiet factual line, never a scolding. */
	past_target: boolean;
	/** One line, already worded: "412 kcal and 38 g of protein left today." */
	line: string;
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

/**
 * Stored jsonb has no ids in it; `withExerciseIds` fills them in on the way out.
 *
 * `finisher`, `is_new` and `added_at` are all defaulted here rather than required, because a
 * brief written before they existed is still in `coach_briefs` and is still the standing
 * answer for the day it was written.
 */
type StoredWorkout = Omit<Brief["workout"], "exercises" | "finisher"> & {
	exercises: (Brief["workout"]["exercises"][number] & { added_at?: string | null })[];
	finisher?: Brief["workout"]["finisher"];
};

function toWorkout(workout: StoredWorkout | null): BriefWorkout {
	if (!workout) return { type: "rest", targets: [], exercises: [], finisher: [] };
	return {
		...workout,
		finisher: (workout.finisher ?? []).map((item) => ({
			...item,
			exercise_id: null,
			media_count: 0,
		})),
		exercises: workout.exercises.map((exercise) => ({
			...exercise,
			is_new: exercise.is_new ?? false,
			added_at: exercise.added_at ?? null,
			exercise_id: null,
			media_count: 0,
			// Resolved by withExerciseIds on the way out; false until the catalogue says.
			barbell: false,
		})),
	};
}

/**
 * Resolves every name on the plan — the Do list and the finisher both — to its
 * `exercise_catalog` row, by name or alias. The same lookup that gives a logged activity
 * its `exercise_id`, so the sheet the coach links to is the sheet the Day screen links to.
 *
 * The finisher was added to it on 2026-09-01. Most stretches do not resolve to anything —
 * "couch stretch" is not in the catalogue and probably never will be — and that is fine:
 * they open the sheet in name-only mode, where the form video is a search and works for a
 * movement nobody has catalogued. What they must not do is nothing, which is what they did.
 *
 * `media_count` rides along on the same rows: knowing which names have a picture is the
 * difference between an underline that promises something and one that gambles.
 */
export async function withExerciseIds(db: Queryable, brief: CoachBriefRecord): Promise<CoachBriefRecord> {
	const exercises = brief.workout.exercises;
	const finisher = brief.workout.finisher ?? [];
	if (exercises.length === 0 && finisher.length === 0) return brief;
	const matches = await lookupExercises(db, [
		...exercises.map((exercise) => exercise.name),
		...finisher.map((item) => item.name),
	]);
	const resolve = (name: string) => {
		const match = matches.get(name.trim().toLowerCase());
		return { exercise_id: match?.id ?? null, media_count: match?.media_count ?? 0 };
	};
	// Only the Do list carries it: a finisher is stretching and mobility, and it never
	// prescribes a load for a per-side breakdown to be about.
	const resolveLoaded = (name: string) => {
		const match = matches.get(name.trim().toLowerCase());
		return {
			...resolve(name),
			barbell: (match?.equipment ?? []).some((item) => item.trim().toLowerCase() === "barbell"),
		};
	};
	return {
		...brief,
		workout: {
			...brief.workout,
			exercises: exercises.map((exercise) => ({ ...exercise, ...resolveLoaded(exercise.name) })),
			finisher: finisher.map((item) => ({ ...item, ...resolve(item.name) })),
		},
	};
}

function toRecord(row: BriefRow, cached: boolean): CoachBriefRecord {
	return {
		id: row.id,
		date: row.date,
		asked_at: row.asked_at,
		context: row.context,
		headline: row.headline ?? "",
		// `rationale` is 0004's name for the brief's `why`; 0008's note explains the pairing.
		why: row.rationale ?? "",
		workout: toWorkout(row.workout as StoredWorkout | null),
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
	experience: string | null;
	background: string | null;
	reference_loads: ReferenceLoad[] | null;
	/** Migration 0014. NULL means nobody has said, not "sixty" — see the migration's note. */
	session_minutes: number | null;
	/** Migration 0016. NULL means nobody has said, not "150" — same story, same reason. */
	cardio_minutes_target: number | null;
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
		protein_target_g: view.macros.protein_g.target,
		status: view.status,
		trained: view.blocks.map((block) => block.title),
		logged: view.items.activities.map((activity) => ({
			exercise: activity.exercise,
			exercise_id: activity.exercise_id,
			sets: activity.sets,
			category: activity.category,
			// Carried so the completion can say WHICH rows ticked a line off, not just how
			// many sets they came to (user decision 2026-09-01: the plan is the skeleton and
			// the log hangs off it, so every checked line has to reach its records).
			id: activity.id,
			logged_at: activity.logged_at,
			reps: activity.reps,
			load_lb: activity.load_lb,
			duration_min: activity.duration_min,
			kcal: activity.kcal,
		})),
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
			        eatback, goal_pace, experience, background, reference_loads, session_minutes,
			        cardio_minutes_target
			   FROM profiles WHERE id = $1`,
			[userId]
		)
	).rows[0] ?? null;

	// What the user said they bring with them (migration 0011). Stated, never measured —
	// the rules read it only where the log has nothing to say.
	const background: TrainingBackground = {
		experience: plan?.experience ?? null,
		background: plan?.background ?? null,
		reference_loads: Array.isArray(plan?.reference_loads) ? plan.reference_loads : [],
	};

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
		// The standing aim, under the goal and over the guideline (migration 0016). The board
		// resolves it the same way, so the brief and the tab quote one target.
		cardioTargetStatedMin: plan?.cardio_minutes_target ?? null,
		targets: {
			kcal: view.target,
			protein_g: view.macros.protein_g.target,
			carbs_max_g: view.macros.carbs_g.target,
		},
	});

	const catalogFacts = await catalogFactsFor(db, [
		...features.exercises.map((exercise) => exercise.exercise),
		...background.reference_loads.map((load) => load.exercise),
	]);
	// The pool an introduction may be drawn from: catalogue entries this user has never
	// logged, biased towards the muscles the ledger says are owed and towards entries that
	// have photographs — an introduction the user cannot look up is a name, not a movement.
	const candidates = await introductionCandidates(db, userId, {
		muscles: features.coverage.filter((entry) => entry.overdue).map((entry) => entry.key),
	});

	const rules = buildRules({
		features,
		goals,
		equipment: catalogFacts.equipment,
		loadDirection: catalogFacts.loadDirection,
		background,
		sessionMinutes: plan?.session_minutes ?? null,
		introductionCandidates: candidates,
	});

	// Where they train, and what has been seen there (migration 0012). Two small reads and
	// both skipped entirely when no place has ever been named, which is most accounts.
	const place = await currentPlace(db, userId);
	const observed = place ? await placeEquipment(db, place.id, MAX_OBSERVED_EQUIPMENT) : [];

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
		experience: background.experience,
		background: background.background,
		session_minutes: rules.sizing.minutes,
		session_minutes_stated: rules.sizing.stated,
		place:
			place && observed.length > 0
				? { name: place.name, kind: place.kind, equipment: observed.map((row) => row.label) }
				: null,
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
export function briefInputsHash(inputs: CoachBriefInputs, revision: string | null = null): string {
	const material = {
		date: inputs.date,
		// Only when there is one, so an ordinary brief hashes exactly as it always has and
		// yesterday's stored rows do not all read as stale the day this ships.
		...(revision === null ? {} : { revision }),
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
	brief: StorableBrief,
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
	/**
	 * "Make it 8 exercises", "switch to legs". The day's current brief goes to the model
	 * with this instruction and the whole revised brief comes back. Implies a regenerate:
	 * there is nothing to revise into the cache.
	 */
	revision?: string | null;
	/**
	 * Which of the two explicit buttons this came from, when it came from one — *Add to
	 * today's plan* or *Replace today's plan* (user decision 2026-08-31 §3). Null is the
	 * free-text box, where the model decides. Forced here as well as said in the prompt.
	 */
	revisionMode?: RevisionMode | null;
}

export interface NextBriefResult {
	brief: CoachBriefRecord;
	inputs: CoachBriefInputs;
	/** True when the model could not be reached and an earlier brief was served instead. */
	stale: boolean;
	/** One line saying what went wrong, when `stale` is a fallback rather than a cache. */
	note: string | null;
}

/** Thrown when there is no brief to serve at all — the route turns it into a 503. */
/**
 * No brief, and no way to make one. Carries the POLICY CODE alongside the detail: the
 * route answers from the code, and the detail — which is the provider's own account and
 * used to be interpolated into the 503 body — is for the log (services/llmErrors.ts).
 */
export class CoachUnavailableError extends Error {
	readonly code: LlmErrorCode;

	constructor(message: string, code: LlmErrorCode = "reader_failed") {
		super(message);
		this.name = "CoachUnavailableError";
		this.code = code;
	}
}

/**
 * Today's brief: one per day. A plain ask returns the day's existing brief no matter what
 * has been logged since — the user asked once and the answer should hold still; `stale`
 * tells the app when the inputs have moved on so it can offer Regenerate. A new brief is
 * made only on the first ask of the day, an explicit regenerate, or an ask that carries
 * fresh context (a new question deserves a new answer; an identical context repeat hits
 * the exact-inputs cache).
 */
export async function nextBrief(
	db: Queryable,
	coach: CoachPort,
	userId: string,
	options: NextBriefOptions
): Promise<NextBriefResult> {
	const result = await chooseBrief(db, coach, userId, options);
	// Whichever way the brief was arrived at — cache, model, or the previous one after an
	// outage — the Do list leaves here with its catalogue ids on it, each line's completion
	// against today's log beside it, and the Eat card's numbers computed fresh.
	const withIds = await withExerciseIds(db, result.brief);
	return { ...result, brief: withLiveState(withIds, result.inputs) };
}

/**
 * Everything on a brief that is a fact about TODAY rather than about the answer: the tick
 * beside each line, and what is left to eat.
 *
 * It is applied on the way out and stored nowhere, which is the whole point. A brief is a
 * record of what the coach said at 7 am; whether the lat pulldown has since been done is a
 * question only the log can answer, and the log keeps changing all day. Writing the tick
 * onto the brief would create a second copy of a fact that already exists, and the two would
 * disagree the moment a row was corrected or deleted.
 */
export function withLiveState(brief: CoachBriefRecord, inputs: CoachBriefInputs): CoachBriefRecord {
	const exercises = completionOf(brief.workout.exercises, inputs.today.logged);
	return {
		...brief,
		workout: { ...brief.workout, exercises, complete: planIsComplete(exercises) },
		nutrition_now: nutritionNow(inputs, brief.nutrition),
	};
}

/** "412 kcal and 38 g of protein left today", or the flat line when the day is spent. */
export function nutritionNow(inputs: CoachBriefInputs, nutrition: Brief["nutrition"]): NutritionNow {
	const { today } = inputs;
	// The allowance is the day's own arithmetic (target + eat-back of what was earned); the
	// brief's `nutrition.kcal` is the target the coach was given. The card shows what is
	// LEFT, so it reads the day, and falls back to the brief only when the day has no target
	// at all — which is the account that has not said enough to have one.
	const allowance = today.allowance ?? (nutrition.kcal > 0 ? nutrition.kcal : null);
	const remaining = allowance == null ? null : Math.round(allowance - today.eaten);
	const proteinTarget = today.protein_target_g ?? (nutrition.protein_g > 0 ? nutrition.protein_g : null);
	const proteinEaten = today.protein_g;
	const proteinLeft =
		proteinTarget == null || proteinEaten == null ? null : Math.max(0, Math.round(proteinTarget - proteinEaten));

	const pastTarget = remaining != null && remaining <= 0;
	const parts: string[] = [];
	if (remaining != null) parts.push(pastTarget ? `${Math.abs(remaining)} kcal over today's allowance` : `${remaining} kcal left`);
	if (proteinLeft != null && proteinLeft > 0) parts.push(`${proteinLeft} g of protein to go`);
	else if (proteinLeft === 0 && proteinTarget != null) parts.push("protein is there");

	return {
		remaining_kcal: remaining,
		eaten_kcal: today.eaten,
		allowance_kcal: allowance,
		remaining_protein_g: proteinLeft,
		eaten_protein_g: proteinEaten,
		protein_target_g: proteinTarget,
		past_target: pastTarget,
		// Stated, never judged (concept-v2 §Principles 8 — nothing is owed).
		line: parts.length > 0 ? `${parts.join(" · ")}.` : "No calorie target yet, so nothing to count against.",
	};
}

// ---------------------------------------------------------------------------
// Reading the day's plan without making one
// ---------------------------------------------------------------------------
//
// Two functions, and the thing they have in common is the thing that matters: **neither
// takes a `CoachPort`**. Opening the Coach screen and drawing Today's button are reads of
// what the coach already said, and a read that cannot reach the model cannot generate by
// accident — no flag to get wrong, no branch to fall through (user decision 2026-08-31 §2).
//
// The one that used to be able to was `GET /api/coach/next`: with no brief for the day it
// generated one, so simply *opening the page* wrote the day's standing answer. That is now
// `generate=false` on the route, which lands here.

export interface StandingBriefResult {
	/** The day's brief, or null when nobody has asked for one yet. Never generated. */
	brief: CoachBriefRecord | null;
	inputs: CoachBriefInputs;
	/** True when the log has moved since the brief was written. False when there is none. */
	stale: boolean;
}

/**
 * Today's brief if there is one, with its ticks and its live Eat numbers on it — and
 * nothing at all if there is not. The Coach screen's page load.
 */
export async function standingBrief(
	db: Queryable,
	userId: string,
	options: LoadInputsOptions
): Promise<StandingBriefResult> {
	const inputs = await loadCoachInputs(db, userId, options);
	const previous = await latestBrief(db, userId, inputs.date);
	if (!previous) return { brief: null, inputs, stale: false };
	const withIds = await withExerciseIds(db, previous);
	return {
		brief: withLiveState(withIds, inputs),
		inputs,
		stale: previous.inputs_hash !== briefInputsHash(inputs),
	};
}

/** What Today's button needs to know, and not one field more. */
export interface CoachStatus {
	date: IsoDate;
	/** Whether the coach has been asked today. The button's two states hang off this. */
	has_plan: boolean;
	/** The plan's own headline, for a caller that wants it. Null with no plan. */
	headline: string | null;
	/** Lines of the Do list logged today, and how many there are. Both 0 with no plan. */
	done_count: number;
	total_count: number;
	/** True when every line of a non-empty plan is done — the button's "Plan complete ✓". */
	complete: boolean;
}

/**
 * An exists-check, not an answer (user decision 2026-08-31 §1). It reads the day's standing
 * brief and counts it off against the log, and that is the whole of it: no model, no
 * `CoachPort` in the signature to call one with, and no day close either — closing a day
 * writes a reading, and a button on the Today screen is not a reason to write anything.
 *
 * It is deliberately cheaper than `standingBrief`: one brief row, one name lookup and the
 * day view, rather than the features, the goals and the whole rule set. Today draws this on
 * every open; the Coach screen is the one that needs the rest.
 */
export async function briefStatus(
	db: Queryable,
	userId: string,
	{ date, tzOffsetMin, now = new Date() }: { date: IsoDate; tzOffsetMin: number; now?: Date }
): Promise<CoachStatus> {
	const brief = await latestBrief(db, userId, date);
	if (!brief) {
		return { date, has_plan: false, headline: null, done_count: 0, total_count: 0, complete: false };
	}
	const withIds = await withExerciseIds(db, brief);
	const view = await computeDay(db, { userId, date, tzOffsetMin, now });
	// The same matcher the Coach screen's ticks come from, over the same list — so the
	// button and the page can never disagree about how far through the plan you are.
	const exercises = completionOf(withIds.workout.exercises, todayFrom(view).logged);
	return {
		date,
		has_plan: true,
		headline: brief.headline || null,
		done_count: exercises.filter((exercise) => exercise.completion.done).length,
		total_count: exercises.length,
		complete: planIsComplete(exercises),
	};
}

async function chooseBrief(
	db: Queryable,
	coach: CoachPort,
	userId: string,
	options: NextBriefOptions
): Promise<NextBriefResult> {
	const instruction = options.revision?.trim() || null;
	const inputs = await loadCoachInputs(db, userId, options);
	// A revision is about the brief in front of the user, so it is part of what the answer
	// depends on: two different instructions against the same day are two different rows.
	const hash = briefInputsHash(inputs, instruction);

	if (!options.regenerate && !instruction) {
		if (!inputs.context) {
			const previous = await latestBrief(db, userId, inputs.date);
			if (previous) return { brief: previous, inputs, stale: previous.inputs_hash !== hash, note: null };
		} else {
			const cached = await cachedBrief(db, userId, inputs.date, hash);
			if (cached) return { brief: cached, inputs, stale: false, note: null };
		}
	}

	// What is being revised: the day's standing answer, exactly as the app is drawing it.
	// With nothing to revise the instruction is still worth having — it becomes the ask.
	const current = instruction ? await latestBrief(db, userId, inputs.date) : null;

	const revision: BriefRevision | undefined =
		instruction && current
			? { instruction, current: toBrief(current), mode: options.revisionMode ?? null }
			: undefined;

	try {
		const { brief: asked, skipped } = await askUsable(coach, inputs, revision, current);
		const answer = capBrief(asked, inputs, { revised: revision !== undefined });
		const stored = await storeBrief(db, userId, inputs, hash, answer, coach.model);
		// Not a failure, so not an error — but the user asked for more and got fewer items
		// than the model offered, and is owed the reason (field report 2026-09-02).
		return { brief: stored, inputs, stale: false, note: skippedNote(skipped) };
	} catch (error) {
		// A brief the user has already read beats an error page; nothing at all is a 503,
		// because unlike a day reading the brief *is* the answer they asked for.
		const previous = current ?? (await latestBrief(db, userId, inputs.date));
		if (previous) {
			console.warn(`⚠️  Coach could not answer for ${inputs.date}, serving the previous brief:`, describe(error));
			return { brief: previous, inputs, stale: true, note: failureNote(error, instruction) };
		}
		throw new CoachUnavailableError(describe(error), classifyProviderError(error));
	}
}

/**
 * One brief, with the one guarantee no schema can make: a training day has something to do
 * in it. An empty Do list on a `strength` day parses perfectly and is not an answer — it is
 * what the user saw when a regenerate "came back with nothing shown", and once stored it
 * becomes the day's standing answer and every plain ask replays it.
 *
 * So it is asked again, once, and if the second answer is no better the caller falls back
 * to the brief the user already has. This lives here rather than in the adapter because it
 * is a rule about briefs, not about a provider: a rules-only coach or a hosted one must
 * clear the same bar.
 */
async function askUsable(
	coach: CoachPort,
	inputs: CoachBriefInputs,
	revision: BriefRevision | undefined,
	current: CoachBriefRecord | null
): Promise<AppendResult> {
	// Anything logged today makes a rest verdict a verdict on work already done, which is
	// never an answer to "what should I do today" (schema.ts §resolveRestAfterTraining).
	const trainedToday = inputs.today.logged.length > 0;
	const ask = async (): Promise<AppendResult> => {
		if (!revision) {
			return {
				brief: assertUsableBrief(resolveRestAfterTraining(await coach.brief(inputs), { trainedToday })),
				skipped: [],
			};
		}
		const raw = resolveRestAfterTraining(await coach.revise(inputs, revision), { trainedToday });
		// The user's own tap outranks the model's reading of the sentence. *Add to today's
		// plan* promises the plan above it stays, and a promise the model can overrule by
		// answering "rewrite" is not one — so the mode the merge uses is the button's when
		// there was a button, and the model's only when the instruction came from the box.
		const mode: RevisionMode = revision.mode ?? raw.revision_mode;
		const answer = assertUsableRevision(raw, mode);
		return mode === "append" && current
			? appendToBrief(current, answer, inputs.local_time)
			: { brief: assertUsableBrief(stripMode(answer)), skipped: [] };
	};

	try {
		return await ask();
	} catch (error) {
		if (!(error instanceof UnusableBriefError)) throw error;
		console.warn(`⚠️  Brief for ${inputs.date} had nothing to do in it, asking once more:`, error.message);
		return await ask();
	}
}

/**
 * The two limits that are asked for in the prompt and enforced here as well (user decision
 * 2026-08-31 §B6, §B8: "as prompt rules plus a deterministic cap"; "AT MOST one exercise the
 * user has never logged").
 *
 * A cap that lives only in a prompt is a suggestion, and the user with twenty-five minutes
 * is the one who pays when it is ignored. Both are applied on the way to storage, so the
 * stored brief is the one the user gets to keep.
 *
 *   * **One introduction.** The first `is_new` in the list keeps the flag; the rest lose it
 *     and stay in the plan. The flag is a chip on a row, not a movement — dropping the
 *     exercise would be a bigger correction than the mistake.
 *   * **The exercise ceiling.** Trimmed from the END, because the model writes the session
 *     in the order it means it to be done and the last movements are the accessories.
 *
 * The ceiling is applied to a brief the coach wrote on its own and NOT to a revision:
 * "make it 8 exercises" is the user overruling the size, and an app that silently trimmed
 * their answer back to six would be arguing with them. `revised` says which this is.
 */
export function capBrief<T extends StorableBrief>(
	brief: T,
	inputs: CoachBriefInputs,
	{ revised = false }: { revised?: boolean } = {}
): T {
	let seenNew = false;
	const exercises = brief.workout.exercises.map((exercise) => {
		if (!exercise.is_new) return exercise;
		if (seenNew) return { ...exercise, is_new: false };
		seenNew = true;
		return exercise;
	});
	const cap = Math.max(1, inputs.rules.sizing.max_exercises);
	const trimmed = !revised && exercises.length > cap ? exercises.slice(0, cap) : exercises;
	return { ...brief, workout: { ...brief.workout, exercises: trimmed } };
}

/** What gets stored: a brief, with the `added_at` stamps an append leaves behind. */
type StorableBrief = Omit<Brief, "workout"> & {
	workout: Omit<Brief["workout"], "exercises"> & {
		exercises: (Brief["workout"]["exercises"][number] & { added_at?: string | null })[];
	};
};

function stripMode({ revision_mode: _mode, ...brief }: RevisedBrief): Brief {
	return brief;
}

/**
 * What an append actually added, and what it refused to.
 *
 * `skipped` is the movements the model handed back that were already on the plan. They are
 * NAMED rather than dropped in silence: a user who asked for more and got fewer items than
 * the model offered is owed the reason (field report 2026-09-02).
 */
export interface AppendResult {
	brief: StorableBrief;
	/** The repeated movements, by the name the model used for them. */
	skipped: string[];
}

/**
 * Is this movement already on the plan? The log's own matcher, so the qualifiers hold:
 * an **Assisted** Chin-Up is not a Chin-Up, an Incline Bench is not a Bench, and neither
 * is silently swallowed as a duplicate of the other. A plain repeat is a repeat.
 */
function alreadyOnPlan(name: string, planned: readonly { name: string }[]): boolean {
	return planned.some((item) => sameMovement(item.name, name));
}

/**
 * "Give me another half hour", "add core" — the plan stays and the new items go under it
 * (user decision 2026-08-31 §A3).
 *
 * **An append never re-adds what is already there** (field report 2026-09-02). The user
 * said "I'll have a one hour session — regenerate based on that", and the model did what it
 * was asked in the most literal way available: it returned a whole one-hour session, which
 * was the same five movements it had just been shown. The append stored them wholesale and
 * every exercise appeared twice.
 *
 * The prompt now says extend rather than restate — but a prompt is a request, and this is a
 * data rule, so it is enforced here as well. Two movements that are the same movement do
 * not both belong on one day's plan, whatever the model believed it was doing.
 *
 * What is kept and what is taken, and why each way round:
 *
 *   * **The exercises are concatenated**, the existing ones first with whatever `added_at`
 *     they already carried, the new ones stamped with the clock this ask happened at. That
 *     stamp is what the app's "added 2:05p" divider is drawn from, and it is why a second
 *     append later in the afternoon reads as its own group rather than merging into the first.
 *   * **The headline is the plan's**, because the plan has not changed — a new headline is
 *     what makes an append look like a regeneration on screen, which is the bug.
 *   * **`why` is the plan's, then the model's sentence about the addition.** Both are true
 *     and the second explains the divider; clampBrief trims the pair to 600 characters.
 *   * **The nutrition card and the nudge are the plan's.** "Add core" is not a statement
 *     about eating, and the Eat card's numbers are computed live on every read anyway.
 *   * **The type is the plan's**, unless the plan was a rest day and something has now been
 *     added to it — at which point it is whatever the model called the addition.
 */
export function appendToBrief(current: CoachBriefRecord, answer: RevisedBrief, clock: string): AppendResult {
	const skipped: string[] = [];
	const added: (RevisedBrief["workout"]["exercises"][number] & { added_at: string })[] = [];
	for (const exercise of answer.workout.exercises) {
		// Against the plan AND against what this same append has already taken: a model that
		// repeats itself inside one answer is the same bug arriving twice as fast.
		if (alreadyOnPlan(exercise.name, current.workout.exercises) || alreadyOnPlan(exercise.name, added)) {
			skipped.push(exercise.name);
			continue;
		}
		added.push({ ...exercise, added_at: clock });
	}
	const targets = [...new Set([...current.workout.targets, ...answer.workout.targets])].slice(0, 4);
	const why = [current.why, answer.why].filter((part) => part.trim() !== "").join(" ");

	const brief: StorableBrief = {
		headline: current.headline,
		why,
		workout: {
			type: current.workout.type === "rest" && added.length > 0 ? answer.workout.type : current.workout.type,
			targets,
			exercises: [
				...current.workout.exercises.map(
					({ exercise_id: _id, media_count: _media, completion: _done, ...exercise }) => exercise
				),
				...added,
			],
			// The finisher belongs to the whole session, so a longer session gets the newer
			// one — but never an empty one in place of a finisher that was already there.
			finisher:
				answer.workout.finisher.length > 0
					? answer.workout.finisher
					: current.workout.finisher.map(({ exercise_id: _id, media_count: _media, ...item }) => item),
		},
		nutrition: current.nutrition,
		nudge: current.nudge,
	};
	return { brief, skipped };
}

/** "Lat Pulldown and Barbell Curl are already on the plan." Null when nothing was dropped. */
export function skippedNote(skipped: readonly string[]): string | null {
	if (skipped.length === 0) return null;
	const names = [...new Set(skipped)];
	const list =
		names.length === 1
			? names[0]
			: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
	return `${list} ${names.length === 1 ? "is" : "are"} already on the plan, so ${
		names.length === 1 ? "it was" : "they were"
	} not added again.`;
}

/** The stored record, back in the shape the model wrote — what a revision is handed. */
function toBrief(record: CoachBriefRecord): Brief {
	return {
		headline: record.headline,
		why: record.why,
		workout: {
			type: record.workout.type,
			targets: record.workout.targets,
			// The catalogue ids and media counts are ours, not the model's; they mean nothing
			// to it and cost a line of JSON each. `added_at` and `completion` go the same
			// way: when an item arrived and whether it has been done are facts about this
			// app, not about the session the model is being asked to change.
			exercises: record.workout.exercises.map(
				({ exercise_id: _id, media_count: _media, added_at: _added, completion: _done, ...exercise }) => exercise
			),
			finisher: record.workout.finisher.map(({ exercise_id: _id, media_count: _media, ...item }) => item),
		},
		nutrition: record.nutrition,
		nudge: record.nudge,
	};
}

/** One line, for the app to print above the brief it kept. Never a stack trace. */
function failureNote(error: unknown, instruction: string | null): string {
	if (error instanceof UnusableBriefError) {
		return instruction
			? "That change came back with nothing to do, twice — this is still your last brief. Try asking for it a different way."
			: "The new brief came back with nothing to do, twice — this is still your last one.";
	}
	return instruction
		? "The coach could not make that change just now — this is still your last brief."
		: "The coach could not answer just now — this is still your last brief.";
}

/** The local date the user is asking about, from their offset. */
export function coachDate(now: Date, tzOffsetMin: number): IsoDate {
	return localDay(now, tzOffsetMin).date;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
