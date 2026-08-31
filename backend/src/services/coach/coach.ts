import { createHash } from "node:crypto";
import type pg from "pg";
import type { Brief, BriefRevision, CoachBriefInputs, CoachPlan, CoachPort, CoachToday } from "../../ports/coach.js";
import type { LoadDirection } from "../../db/exercises.js";
import { computeDay, type DayView } from "../day.js";
import { lookupExercises } from "../entries.js";
import type { ReferenceLoad } from "../fusion/schema.js";
import { listGoals } from "../goals/store.js";
import { formatClock, localDay, localMinutesOf, type IsoDate } from "../localTime.js";
import { currentPlace, placeEquipment } from "../places.js";
import { loadTargets } from "../profile.js";
import { computeFeatures, type CoachFeatures } from "./features.js";
import { assertUsableBrief, UnusableBriefError } from "./schema.js";
import { buildRules, type CoachGoal, type NudgeAction, type TrainingBackground } from "./rules.js";

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
export type BriefExercise = Brief["workout"]["exercises"][number] & { exercise_id: string | null };

export type BriefWorkout = Omit<Brief["workout"], "exercises"> & { exercises: BriefExercise[] };

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

/** Stored jsonb has no ids in it; `withExerciseIds` fills them in on the way out. */
function toWorkout(workout: Brief["workout"] | null): BriefWorkout {
	if (!workout) return { type: "rest", targets: [], exercises: [] };
	return { ...workout, exercises: workout.exercises.map((exercise) => ({ ...exercise, exercise_id: null })) };
}

/**
 * Resolves each Do-list name to its `exercise_catalog` id, by name or alias — the same
 * lookup that gives a logged activity its `exercise_id`, so the sheet the coach links to
 * is the sheet the Day screen links to.
 */
export async function withExerciseIds(db: Queryable, brief: CoachBriefRecord): Promise<CoachBriefRecord> {
	const exercises = brief.workout.exercises;
	if (exercises.length === 0) return brief;
	const matches = await lookupExercises(
		db,
		exercises.map((exercise) => exercise.name)
	);
	return {
		...brief,
		workout: {
			...brief.workout,
			exercises: exercises.map((exercise) => ({
				...exercise,
				exercise_id: matches.get(exercise.name.trim().toLowerCase())?.id ?? null,
			})),
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
		workout: toWorkout(row.workout),
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
			        eatback, goal_pace, experience, background, reference_loads
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
		targets: {
			kcal: view.target,
			protein_g: view.macros.protein_g.target,
			carbs_max_g: view.macros.carbs_g.target,
		},
	});

	const catalogFacts = await catalogFactsFor(db, features, background.reference_loads);
	const rules = buildRules({
		features,
		goals,
		equipment: catalogFacts.equipment,
		loadDirection: catalogFacts.loadDirection,
		background,
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

/**
 * The two catalogue facts the progression reads: the equipment (so a stack steps by
 * percentage) and the load direction (so an assisted machine progresses *downwards* —
 * migration 0013). One query, because they are one row.
 *
 * Stated reference loads are looked up too: an exercise the log has never seen still gets
 * a prescription from what the user says they lift, and "assisted pull-up, 60 lb" is
 * exactly the kind of thing someone states.
 */
async function catalogFactsFor(
	db: Queryable,
	features: CoachFeatures,
	referenceLoads: readonly ReferenceLoad[]
): Promise<{ equipment: Record<string, string[]>; loadDirection: Record<string, LoadDirection> }> {
	const names = [
		...new Set(
			[...features.exercises.map((exercise) => exercise.exercise), ...referenceLoads.map((load) => load.exercise)]
				.map((name) => name.trim().toLowerCase())
				.filter(Boolean)
		),
	];
	if (names.length === 0) return { equipment: {}, loadDirection: {} };
	const { rows } = await db.query<{ name: string; equipment: string[] | null; load_direction: LoadDirection }>(
		`SELECT name, equipment, load_direction FROM exercise_catalog WHERE lower(name) = ANY($1::text[])`,
		[names]
	);
	return {
		equipment: Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.equipment ?? []])),
		loadDirection: Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.load_direction])),
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
	/**
	 * "Make it 8 exercises", "switch to legs". The day's current brief goes to the model
	 * with this instruction and the whole revised brief comes back. Implies a regenerate:
	 * there is nothing to revise into the cache.
	 */
	revision?: string | null;
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
export class CoachUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CoachUnavailableError";
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
	// outage — the Do list leaves here with its catalogue ids on it.
	return { ...result, brief: await withExerciseIds(db, result.brief) };
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

	const revision = instruction && current ? { instruction, current: toBrief(current) } : undefined;

	try {
		const answer = await askUsable(coach, inputs, revision);
		const stored = await storeBrief(db, userId, inputs, hash, answer, coach.model);
		return { brief: stored, inputs, stale: false, note: null };
	} catch (error) {
		// A brief the user has already read beats an error page; nothing at all is a 503,
		// because unlike a day reading the brief *is* the answer they asked for.
		const previous = current ?? (await latestBrief(db, userId, inputs.date));
		if (previous) {
			console.warn(`⚠️  Coach could not answer for ${inputs.date}, serving the previous brief:`, describe(error));
			return { brief: previous, inputs, stale: true, note: failureNote(error, instruction) };
		}
		throw new CoachUnavailableError(describe(error));
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
	revision: BriefRevision | undefined
): Promise<Brief> {
	const answer = await coach.brief(inputs, revision);
	try {
		return assertUsableBrief(answer);
	} catch (error) {
		if (!(error instanceof UnusableBriefError)) throw error;
		console.warn(`⚠️  Brief for ${inputs.date} had nothing to do in it, asking once more:`, error.message);
		return assertUsableBrief(await coach.brief(inputs, revision));
	}
}

/** The stored record, back in the shape the model wrote — what a revision is handed. */
function toBrief(record: CoachBriefRecord): Brief {
	return {
		headline: record.headline,
		why: record.why,
		workout: {
			type: record.workout.type,
			targets: record.workout.targets,
			// The catalogue ids are ours, not the model's; they mean nothing to it and cost
			// a line of JSON each.
			exercises: record.workout.exercises.map(({ exercise_id: _id, ...exercise }) => exercise),
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
