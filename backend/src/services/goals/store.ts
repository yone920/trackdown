import type pg from "pg";
import { buildFacts } from "../day.js";
import { addDays, boundsOf, daysBetween, localDay, type IsoDate } from "../localTime.js";
import { loadTargets } from "../profile.js";
import { detectReached, type GoalDetection } from "./detect.js";
import { computeMeasure, getMeasure, measureLabel, type DayFacts } from "./measures.js";
import {
	proposeTimeline,
	validateMetrics,
	type GoalProposal,
	type ProposalSpec,
} from "./proposal.js";
import type { GoalMetricRow } from "./verdict.js";

// Goals, as the API sees them (docs/build-plan.md §WP4). Everything that touches the
// `goals` table lives here so that the three ways a goal can be created — the Goals screen,
// the confirm of a spoken goal, and the seed script — write exactly the same row.
//
// Two rules from concept-v2 §Goals shape the whole module:
//
//   * **Priority is an order, not a rank the app assigns.** A new goal is appended; the
//     primary one stays primary until the user reorders. Today's headline cards and the
//     coach's focus follow priority 1.
//   * **A goal ends by getting an `active_to`, never by disappearing.** Reached, dropped
//     and expired all set it, because "every closed day is judged against the goal active
//     that day" — the day model reads the date window, so a goal dropped today goes on
//     judging the fortnight it was live for and stops judging tomorrow.

type Queryable = pg.Pool | pg.PoolClient;

/** How far back the goals list will look for a baseline; a year-old goal is read from here. */
const MAX_BASELINE_DAYS = 180;
/** The longest window any measure calculator reads (exercise_load's four weeks). */
const FACTS_WINDOW_DAYS = 28;
/** Points in a progress series. A year of daily dots is not a sparkline, it is a smear. */
const MAX_SERIES_POINTS = 90;

export const GOAL_STATUSES = ["active", "reached", "expired", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalRecord {
	id: string;
	kind: string;
	title: string;
	metrics: GoalMetricRow[];
	priority: number;
	status: GoalStatus;
	active_from: IsoDate;
	active_to: IsoDate | null;
	stated_at: string;
	/** Set by the day close when the smoothed rules say the goal is done (services/goals/detect.ts). */
	reached_candidate_at: string | null;
	/** Set by the day close when nothing has moved for three weeks. */
	stalled_since: IsoDate | null;
	created_at: string;
}

const GOAL_COLUMNS = `id, kind, title, metrics, priority, status, active_from, active_to,
	stated_at, reached_candidate_at, stalled_since, created_at`;

export interface MetricProgress {
	measure: string;
	label: string;
	scope: string | null;
	unit: string | null;
	direction: string | null;
	target: number | null;
	/** Where the user is now, through the measure catalog. */
	current: number | null;
	/** Where they were when the goal started — what the percentage is measured from. */
	baseline: number | null;
	/** 0–1, or null when there is nothing to be a fraction of. */
	percent: number | null;
	/** The trend over the goal's life; empty unless the caller asked for it. */
	series: { date: IsoDate; value: number }[];
}

export interface GoalProgress {
	goal_id: string;
	/** The slowest metric's percentage — a goal is done when all of it is. */
	percent: number | null;
	metrics: MetricProgress[];
	detection: GoalDetection;
}

export interface GoalWithProgress extends GoalRecord {
	progress: GoalProgress;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface FactsRange {
	/** The day the facts end on — "now" for every calculator. */
	date: IsoDate;
	/** The earliest day a caller will ask a measure for. Windows are added on top. */
	from?: IsoDate;
	tzOffsetMin: number;
}

/**
 * The rows every measure calculator reads, for a range of days rather than one. The
 * calculators ignore anything dated after the day they are asked about, so one load
 * answers for every date in the range — which is what makes a trend series one query
 * instead of ninety.
 */
export async function loadFacts(db: Queryable, userId: string, range: FactsRange): Promise<DayFacts> {
	const { date, tzOffsetMin } = range;
	const earliest = range.from ?? date;
	const windowStart = boundsOf(addDays(earliest, -(FACTS_WINDOW_DAYS - 1)), tzOffsetMin).startUtc.toISOString();
	const end = boundsOf(date, tzOffsetMin).endUtc.toISOString();
	const window = [userId, windowStart, end];

	const meals = await db.query(
		`SELECT id, logged_at, description, meal_type, kcal, protein_g, carbs_g, fat_g, fiber_g
		   FROM meals WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
		window
	);
	const activities = await db.query(
		`SELECT id, logged_at, description, exercise, category, muscle_groups, sets, reps, load_lb,
		        duration_min, distance_mi, kcal, source, confidence, external_id
		   FROM activities WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
		window
	);
	const weights = await db.query(
		`SELECT id, logged_at, weight_lb FROM weight_logs
		  WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
		window
	);
	const health = await db.query(
		`SELECT kind, external_id, start_at, end_at, value, unit, raw FROM health_samples
		  WHERE user_id = $1 AND start_at >= $2 AND start_at < $3 ORDER BY start_at`,
		window
	);

	const targets = await loadTargets(db, userId, date, tzOffsetMin);
	return buildFacts({
		date,
		tzOffsetMin,
		tdee: targets.tdee,
		mealRows: meals.rows,
		activityRows: activities.rows,
		weightRows: weights.rows,
		healthRows: health.rows,
	});
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/**
 * How far along one metric is, as a fraction. Measured from where the user *was* when the
 * goal was set: 195 → 170 is 0 % at 195 and 100 % at 170, not the 87 % that "current over
 * target" would put on the ring before they had done anything.
 */
export function percentFor(
	direction: string | null,
	target: number | null,
	current: number | null,
	baseline: number | null
): number | null {
	if (target == null || current == null) return null;
	const down = direction === "decrease" || direction === "at_most";
	const met = down ? current <= target : current >= target;
	if (met) return 1;

	if ((direction === "decrease" || direction === "increase") && baseline != null && baseline !== target) {
		return round(clamp01((current - baseline) / (target - baseline)));
	}
	if (direction === "maintain") {
		// Holding steady: full marks inside 5 %, falling off linearly outside it.
		const drift = Math.abs(current - target) / Math.max(1e-9, Math.abs(target) * 0.05);
		return round(clamp01(1 - drift));
	}
	if (target === 0) return current === 0 ? 1 : 0;
	return round(clamp01(down ? target / current : current / target));
}

interface ProgressOptions {
	/** Build the trend series (one point per sampled day). Off for the list. */
	withSeries?: boolean;
	/** The last day the series covers — today, or the goal's end when it has one. */
	today: IsoDate;
}

export function progressFor(goal: GoalRecord, facts: DayFacts, { withSeries = false, today }: ProgressOptions): GoalProgress {
	const end = goal.active_to && goal.active_to < today ? goal.active_to : today;
	const start = goal.active_from > end ? end : goal.active_from;

	const metrics: MetricProgress[] = goal.metrics.map((metric) => {
		const scope = metric.scope ?? null;
		const measure = getMeasure(metric.measure);
		const at = (date: IsoDate) => computeMeasure(metric.measure, { ...facts, date }, scope ?? undefined);
		const current = at(end);
		const baseline = at(start);
		const series = withSeries ? sampleSeries(start, end, at) : [];
		return {
			measure: metric.measure,
			// Named as it is used: "Weekly sets" of chest, "Weekly sets, whole body" of nothing
			// in particular. The app titles its widget with this.
			label: measureLabel(metric.measure, scope),
			scope,
			unit: metric.unit ?? measure?.unit ?? null,
			direction: metric.direction ?? null,
			target: metric.target ?? null,
			current,
			// A goal set before the user logged anything has no baseline; the percentage
			// then falls back to current-over-target rather than pretending to have one.
			baseline: baseline ?? series.find((point) => point.value != null)?.value ?? null,
			percent: percentFor(metric.direction ?? null, metric.target ?? null, current, baseline),
			series,
		};
	});

	const percents = metrics.map((metric) => metric.percent).filter((value): value is number => value != null);
	return {
		goal_id: goal.id,
		// The slowest metric, not the average: a goal with two numbers in it is as done as
		// its least done half (the same rule detectReached uses).
		percent: percents.length === 0 ? null : Math.min(...percents),
		metrics,
		detection: detectReached({ ...goal, active_from: goal.active_from }, { ...facts, date: end }),
	};
}

/** One point per day, thinned to at most MAX_SERIES_POINTS, always including both ends. */
function sampleSeries(
	start: IsoDate,
	end: IsoDate,
	at: (date: IsoDate) => number | null
): { date: IsoDate; value: number }[] {
	const days = Math.max(0, daysBetween(start, end));
	const step = Math.max(1, Math.ceil((days + 1) / MAX_SERIES_POINTS));
	const points: { date: IsoDate; value: number }[] = [];
	for (let offset = 0; offset <= days; offset += step) {
		const date = addDays(start, offset);
		const value = at(date);
		if (value != null) points.push({ date, value });
	}
	const last = at(end);
	if (last != null && points.at(-1)?.date !== end) points.push({ date: end, value: last });
	return points;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function toRecord(row: GoalRecord): GoalRecord {
	return { ...row, metrics: Array.isArray(row.metrics) ? row.metrics : [] };
}

export async function getGoal(db: Queryable, userId: string, id: string): Promise<GoalRecord | null> {
	const { rows } = await db.query<GoalRecord>(
		`SELECT ${GOAL_COLUMNS} FROM goals WHERE user_id = $1 AND id = $2`,
		[userId, id]
	);
	return rows[0] ? toRecord(rows[0]) : null;
}

export async function activeGoals(db: Queryable, userId: string): Promise<GoalRecord[]> {
	const { rows } = await db.query<GoalRecord>(
		`SELECT ${GOAL_COLUMNS} FROM goals WHERE user_id = $1 AND status = 'active'
		  ORDER BY priority, active_from DESC`,
		[userId]
	);
	return rows.map(toRecord);
}

export interface GoalsView {
	active: GoalWithProgress[];
	/** Everything that has ended, newest first, with the outcome it ended on. */
	history: (GoalRecord & { outcome: GoalStatus })[];
	/** True when the user has no active goal — the app then shows no judgement colours. */
	no_goal: boolean;
}

export async function listGoals(
	db: Queryable,
	userId: string,
	{ tzOffsetMin, now = new Date() }: { tzOffsetMin: number; now?: Date }
): Promise<GoalsView> {
	const today = localDay(now, tzOffsetMin).date;
	const active = await activeGoals(db, userId);
	const { rows: past } = await db.query<GoalRecord>(
		`SELECT ${GOAL_COLUMNS} FROM goals WHERE user_id = $1 AND status <> 'active'
		  ORDER BY COALESCE(active_to, active_from) DESC, created_at DESC`,
		[userId]
	);

	const withProgress: GoalWithProgress[] = [];
	if (active.length > 0) {
		const earliest = active.reduce<IsoDate>(
			(oldest, goal) => (goal.active_from < oldest ? goal.active_from : oldest),
			today
		);
		const from = earliest < addDays(today, -MAX_BASELINE_DAYS) ? addDays(today, -MAX_BASELINE_DAYS) : earliest;
		const facts = await loadFacts(db, userId, { date: today, from, tzOffsetMin });
		for (const goal of active) withProgress.push({ ...goal, progress: progressFor(goal, facts, { today }) });
	}

	return {
		active: withProgress,
		history: past.map((row) => ({ ...toRecord(row), outcome: row.status })),
		no_goal: active.length === 0,
	};
}

export async function goalProgress(
	db: Queryable,
	userId: string,
	goal: GoalRecord,
	{ tzOffsetMin, now = new Date() }: { tzOffsetMin: number; now?: Date }
): Promise<GoalProgress> {
	const today = localDay(now, tzOffsetMin).date;
	const end = goal.active_to && goal.active_to < today ? goal.active_to : today;
	const facts = await loadFacts(db, userId, { date: end, from: goal.active_from, tzOffsetMin });
	return progressFor(goal, facts, { withSeries: true, today });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreateGoalInput {
	spec: ProposalSpec & { title: string; metrics: GoalMetricRow[]; active_from?: string | null };
	/** Keep the user's own date even when it needs a faster-than-safe rate. */
	confirmDate?: boolean;
	/** Save the goal with no end date at all. */
	noDate?: boolean;
	/** A body weight stated alongside the goal — the projection's starting point. */
	statedWeightLb?: number | null;
	tzOffsetMin?: number;
	now?: Date;
}

export interface CreatedGoal {
	goal: GoalRecord;
	proposal: GoalProposal;
}

/**
 * The proposed timeline for a spec that has not been saved yet — what the confirm card
 * shows under "about 20 weeks at a standard pace → Jan 14 · change date · no date". The
 * analyze preview and the save both call this, so the card and the row cannot disagree.
 */
export async function proposalForSpec(
	db: Queryable,
	userId: string,
	spec: ProposalSpec,
	{
		tzOffsetMin = 0,
		now = new Date(),
		statedWeightLb = null,
	}: { tzOffsetMin?: number; now?: Date; statedWeightLb?: number | null } = {}
): Promise<GoalProposal> {
	const today = localDay(now, tzOffsetMin).date;
	const facts = await loadFacts(db, userId, { date: today, tzOffsetMin });
	const targets = await loadTargets(db, userId, today, tzOffsetMin);
	return proposeTimeline({ spec, facts, pace: targets.profile?.goal_pace ?? null, today, statedWeightLb });
}

/** Thrown for a spec the measure catalog cannot accept; routes turn it into a 400. */
export class InvalidGoalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidGoalError";
	}
}

/**
 * Save one goal, with its proposed timeline computed here rather than taken from whatever
 * asked for it. The spoken path (POST /api/log/confirm) and the Goals screen both come
 * through this function, so the timeline on the confirm card is the timeline in the row.
 */
export async function createGoal(db: Queryable, userId: string, input: CreateGoalInput): Promise<CreatedGoal> {
	const { spec } = input;
	const invalid = validateMetrics(spec.metrics);
	if (invalid) throw new InvalidGoalError(invalid);

	const tzOffsetMin = input.tzOffsetMin ?? 0;
	const today = localDay(input.now ?? new Date(), tzOffsetMin).date;
	const activeFrom = typeof spec.active_from === "string" && spec.active_from ? spec.active_from : today;

	const proposal = await proposalForSpec(db, userId, spec, {
		tzOffsetMin,
		...(input.now ? { now: input.now } : {}),
		...(input.statedWeightLb == null ? {} : { statedWeightLb: input.statedWeightLb }),
	});

	// What the goal actually ends on: nothing if the user said "no date", their own date
	// when they confirmed it (unrealistic or not — it is theirs), the safe-rate projection
	// otherwise. concept-v2 §Goals: proposed, not required.
	const activeTo = input.noDate
		? null
		: input.confirmDate
			? (proposal.by ?? proposal.projected_date)
			: // The user's own date stands unless the safe rate says it cannot be met — in
				// which case the projection is what gets saved, and `confirm_date: true` is
				// how the user says "no, I meant December".
				(proposal.unrealistic ? (proposal.projected_date ?? proposal.by) : (proposal.by ?? proposal.projected_date));

	const { rows } = await db.query<GoalRecord>(
		`INSERT INTO goals (user_id, kind, title, metrics, priority, status, active_from, active_to, stated_at)
		 VALUES ($1, $2, $3, $4::jsonb,
		         (SELECT COALESCE(MAX(priority), 0) + 1 FROM goals WHERE user_id = $1 AND status = 'active'),
		         'active', $5::date, $6::date, NOW())
		 RETURNING ${GOAL_COLUMNS}`,
		[userId, spec.kind, spec.title, JSON.stringify(spec.metrics), activeFrom, activeTo]
	);
	return { goal: toRecord(rows[0] as GoalRecord), proposal };
}

export interface GoalPatch {
	title?: string;
	metrics?: GoalMetricRow[];
	priority?: number;
	status?: GoalStatus;
	active_to?: string | null;
}

/**
 * Edit a goal, or end it. A status that ends the goal writes `active_to` at the same time,
 * because that date is what stops it judging tomorrow and lets it go on judging yesterday
 * (services/day.ts reads the window, not the status).
 */
export async function updateGoal(
	db: Queryable,
	userId: string,
	id: string,
	patch: GoalPatch,
	{ tzOffsetMin = 0, now = new Date() }: { tzOffsetMin?: number; now?: Date } = {}
): Promise<GoalRecord | null> {
	if (patch.metrics) {
		const invalid = validateMetrics(patch.metrics);
		if (invalid) throw new InvalidGoalError(invalid);
	}
	const existing = await getGoal(db, userId, id);
	if (!existing) return null;

	const today = localDay(now, tzOffsetMin).date;
	const sets: string[] = [];
	const params: unknown[] = [userId, id];
	const push = (fragment: string, value: unknown): void => {
		params.push(value);
		sets.push(`${fragment} = $${params.length}`);
	};

	if (patch.title !== undefined) push("title", patch.title);
	if (patch.metrics !== undefined) sets.push(`metrics = $${params.push(JSON.stringify(patch.metrics))}::jsonb`);
	if (patch.priority !== undefined) push("priority", patch.priority);

	if (patch.status !== undefined && patch.status !== existing.status) {
		push("status", patch.status);
		if (patch.status === "active") {
			// Reopening: the candidate flags are stale by definition.
			sets.push("reached_candidate_at = NULL", "stalled_since = NULL");
		} else {
			// reached and dropped end today; expired ends on the date it was due to, if it
			// had one — an expiry is a date that passed, not a decision made now.
			const end =
				patch.active_to !== undefined
					? patch.active_to
					: patch.status === "expired"
						? (existing.active_to ?? today)
						: today;
			sets.push(`active_to = $${params.push(end)}::date`);
		}
	} else if (patch.active_to !== undefined) {
		sets.push(`active_to = $${params.push(patch.active_to)}::date`);
	}

	// The user has said something about this goal, so it is no longer an old plan.
	if (sets.length > 0) sets.push("stated_at = NOW()");
	if (sets.length === 0) return existing;

	const { rows } = await db.query<GoalRecord>(
		`UPDATE goals SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING ${GOAL_COLUMNS}`,
		params
	);
	return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * The user's order, applied as 1…n. Anything active they did not name keeps its place at
 * the end — a reorder is a statement about the goals in the list, not about the ones that
 * were not on screen.
 */
export async function reorderGoals(db: Queryable, userId: string, ids: string[]): Promise<GoalRecord[]> {
	const active = await activeGoals(db, userId);
	const known = new Set(active.map((goal) => goal.id));
	const unknown = ids.find((id) => !known.has(id));
	if (unknown) throw new InvalidGoalError(`No active goal with id ${unknown}.`);

	const ordered = [...ids, ...active.filter((goal) => !ids.includes(goal.id)).map((goal) => goal.id)];
	for (const [index, id] of ordered.entries()) {
		await db.query(`UPDATE goals SET priority = $3 WHERE user_id = $1 AND id = $2`, [userId, id, index + 1]);
	}
	return activeGoals(db, userId);
}

// ---------------------------------------------------------------------------
// Detection, run at day close
// ---------------------------------------------------------------------------

export interface DetectionReport {
	goal_id: string;
	reached: boolean;
	stalled: boolean;
}

/**
 * Run the smoothed rules over every active goal and record what they say. Called by the
 * day close (services/dayClose.ts), because that is the moment a day's logs are final.
 *
 * Both columns are *candidates*: nothing here changes a goal's status. `reached_candidate_at`
 * keeps its first value while the goal stays reached, so the coach can say "you hit this a
 * week ago"; `stalled_since` keeps the earliest day the stall started for the same reason.
 */
export async function refreshGoalDetection(
	db: Queryable,
	userId: string,
	{ date, tzOffsetMin }: { date: IsoDate; tzOffsetMin: number }
): Promise<DetectionReport[]> {
	const goals = await activeGoals(db, userId);
	if (goals.length === 0) return [];

	const facts = await loadFacts(db, userId, { date, tzOffsetMin });
	const report: DetectionReport[] = [];

	for (const goal of goals) {
		// A goal cannot be judged on days before it existed.
		if (goal.active_from > date) continue;
		const detection = detectReached(goal, facts);
		const stalledSince =
			detection.stalled_since && goal.stalled_since && goal.stalled_since < detection.stalled_since
				? goal.stalled_since
				: detection.stalled_since;

		await db.query(
			`UPDATE goals
			    SET reached_candidate_at = CASE WHEN $3 THEN COALESCE(reached_candidate_at, NOW()) ELSE NULL END,
			        stalled_since = $4::date
			  WHERE user_id = $1 AND id = $2`,
			[userId, goal.id, detection.reached, stalledSince]
		);
		report.push({ goal_id: goal.id, reached: detection.reached, stalled: detection.stalled });
	}
	return report;
}
