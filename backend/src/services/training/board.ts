import type pg from "pg";
import type { LoadDirection } from "../../db/exercises.js";
import { catalogFactsFor, EMPTY_CATALOG_FACTS, type CatalogFacts } from "../coach/catalog.js";
import {
	computeFeatures,
	isCardio,
	WEEK_DAYS,
	type CardioFeature,
	type CoachFeatures,
	type CoverageEntry,
	type ExerciseFeature,
	type ExerciseSession,
} from "../coach/features.js";
import {
	cardioNextMinutes,
	prescribeLoads,
	gapRule,
	SESSIONS_AT_TARGET_BEFORE_STEP,
	stepFor,
	targetScheme,
	type Prescription,
} from "../coach/rules.js";
import { lookupExercises } from "../entries.js";
import { loadFacts } from "../goals/store.js";
import { daysBefore, withinWindow, type ActivityCategory, type DayFacts, type FactActivity } from "../goals/measures.js";
import { addDays, localDay, type IsoDate } from "../localTime.js";

// The training board — `GET /api/training/board` (user decision 2026-08-31: the Progress
// tab makes training first class, "one row per regularly-logged exercise … and the next
// step from the SAME progression engine the coach uses").
//
// The word "same" is the whole design of this module. Nothing here decides what the next
// load is: `computeFeatures` builds the history and `prescribeLoads` reads it, exactly as
// `buildRules` does for the brief, and this file only turns the resulting `Prescription`
// into a line short enough for a row. If the board and the coach ever disagree about what
// comes next, it is a bug in one function rather than a difference of opinion between two.
//
// Pure below `loadBoard`: features + prescriptions in, board out, so the whole thing is
// tested on fixtures with no database.
//
// **Lifts and cardio are two sections, not one list** (field report 2026-08-31: an Incline
// Treadmill Walk sat in the Lifts section reading "20 min next", between two barbell rows).
// The activity's own category decides which one it lands in, and the reason is not only that
// a treadmill is not a lift: the two progress by different arithmetic. A lift steps by a
// plate when two sessions hit the scheme; cardio steps by the *week's* minutes against the
// plan's target and does not care what happened on Tuesday. One list cannot say both, and
// the row that tried said "20 min next" — which is not a step at all, it is last time.
//
// Mobility lands in neither. A stretch has no load to progress and no weekly target to
// chase; what it has is a place on the coverage ledger, which already says how long it has
// been since the last one.

/** Bars go back this far — "sessions/week (last 4–8 wks)". Eight weeks, in whole weeks. */
export const BOARD_WEEKS = 8;
const BOARD_DAYS = BOARD_WEEKS * 7;
/** Points on a row's sparkline. A row is 40 px tall; ninety dots in it is a smear. */
const MAX_SERIES_POINTS = 12;
/** With one session there is no cadence to measure; a week is the honest guess. */
const DEFAULT_CADENCE_DAYS = 7;
const MIN_CADENCE_DAYS = 2;
const MAX_CADENCE_DAYS = 14;

export interface BoardPoint {
	date: IsoDate;
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
}

export interface BoardNextStep {
	rule: Prescription["rule"];
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	/** One line for the row: "Hold 55 lb until 3 × 10 twice", "50 lb of assistance next". */
	text: string;
	/** When, when it can be said honestly: "~1–2 wks". Null means "next session". */
	eta: string | null;
	/** The coach's own sentence, for anyone who wants the long reason. */
	why: string;
}

export interface BoardLift {
	exercise: string;
	/** The catalogue row, so the name opens the same sheet Today's rows open. */
	exercise_id: string | null;
	category: ActivityCategory | null;
	muscle_groups: string[];
	/** What the number MEANS. On "assistance" it is the help the machine gives. */
	load_direction: LoadDirection;
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	/** "60 lb", "50 lb of assistance", "30 min" — the working figure, said correctly. */
	load_text: string;
	last_date: IsoDate;
	days_since: number;
	sessions: number;
	best_load_lb: number | null;
	trend: ExerciseFeature["trend"];
	trend_lb: number | null;
	/** "+10 lb in 4 weeks", "5 lb less help", "First session" — null when there is nothing. */
	delta_text: string | null;
	/** Whether that movement was progress. Never `direction`: see services/day/deltas.ts. */
	sentiment: "good" | "watch" | "neutral";
	series: BoardPoint[];
	next: BoardNextStep;
}

/** One point on a cardio row's sparkline: what that day's session was made of. */
export interface BoardCardioPoint {
	date: IsoDate;
	duration_min: number | null;
	distance_mi: number | null;
	pace_min_mi: number | null;
}

/**
 * The next step for one cardio activity. Minutes, never a load — the field report's row
 * said "20 min next" beside two lifts and that number was simply the last session repeated.
 */
export interface BoardCardioNext {
	rule: "cardio";
	/** Null when the week is already at its target: there is nothing to step toward. */
	minutes: number | null;
	/** "22 min next", "Hold 20 min". */
	text: string;
	eta: string | null;
	why: string;
}

/**
 * One row per cardio activity the log knows about. Deliberately not a `BoardLift` with the
 * pounds left blank: nothing here has a load, a set or a rep, so nothing here can print
 * "lb" by accident.
 */
export interface BoardCardioRow {
	exercise: string;
	exercise_id: string | null;
	category: ActivityCategory | null;
	last_date: IsoDate;
	days_since: number;
	sessions: number;
	/** The last session's own figures. Distance and pace are null when nobody measured. */
	duration_min: number | null;
	distance_mi: number | null;
	pace_min_mi: number | null;
	/** The fastest pace in the window, for the row to be measured against. */
	best_pace_min_mi: number | null;
	/** "20 min · 1.2 mi · 16.7 min/mi" — minutes, distance, pace. Never "lb". */
	summary_text: string;
	/** Minutes, or pace when the sessions carried a distance: "+5 min in four weeks". */
	delta_text: string | null;
	/** Pace only. See `cardioSentiment`: a shorter walk is not a step backwards. */
	sentiment: "good" | "watch" | "neutral";
	series: BoardCardioPoint[];
	next: BoardCardioNext;
}

export interface BoardFrequency {
	weeks: { start: IsoDate; sessions: number }[];
	sessions_this_week: number;
	average_per_week: number;
	training_days_target: number | null;
	/** Sets per muscle group — the bars under the frequency columns. */
	muscles: { muscle: string; sets_7d: number; sets_28d: number }[];
	/**
	 * The coverage ledger, largest debt first (user decision 2026-08-31: "surface the ledger
	 * in GET /api/training/board — the coverage section can show 'overdue' muscles").
	 *
	 * It is `coverageLedger`'s own output and not a second reading of the same rows, for the
	 * reason the board's next step is `prescribeLoads` and not a copy of it: the tab that
	 * says the calves are three weeks overdue and the brief that puts calves in today's
	 * session must be quoting one number.
	 */
	coverage: CoverageEntry[];
}

export interface BoardCardio {
	weeks: { start: IsoDate; minutes: number }[];
	minutes_this_week: number;
	weekly_target_min: number;
	short_by_min: number;
	/** The most recent paced session, and the fastest in the window. Null with no distance. */
	last: { date: IsoDate; pace_min_mi: number; distance_mi: number } | null;
	best: { date: IsoDate; pace_min_mi: number; distance_mi: number } | null;
	/**
	 * The new array (field report 2026-08-31): one row per cardio activity, the sibling of
	 * `lifts`.
	 *
	 * It hangs here rather than at the top level because `board.cardio` was already an
	 * object with the weekly bars in it, and turning that key into an array would have been
	 * a red screen on every phone still running the previous build — the one shape rule this
	 * repo has (docs/agent-brief.md: "keep response shapes stable for screens already
	 * built"). `lifts` narrowing to strength is safe in the same way round: an older app
	 * draws one row fewer, which is the fix.
	 */
	activities: BoardCardioRow[];
	/**
	 * True when a goal named the weekly minutes, rather than the WHO's 150 standing in. It
	 * is the difference between a section with nothing in it and a section a user asked for
	 * and has not fed yet — the first is hidden, the second says so quietly.
	 */
	target_stated: boolean;
}

export interface BoardBody {
	latest: number | null;
	latest_date: IsoDate | null;
	avg_7d: number | null;
	trend_per_week: number | null;
	/** One point per weigh-in day, oldest first. */
	series: { date: IsoDate; value: number }[];
}

export interface TrainingBoard {
	date: IsoDate;
	lifts: BoardLift[];
	frequency: BoardFrequency;
	cardio: BoardCardio;
	body: BoardBody;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function number(value: number): string {
	const rounded = round(value);
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "55 lb" on a barbell; "55 lb of assistance" on a machine that is helping. */
export function sayLoad(load: number | null, direction: LoadDirection): string {
	if (load == null) return "—";
	return direction === "assistance" ? `${number(load)} lb of assistance` : `${number(load)} lb`;
}

/** The working figure for a row: a load if it has one, else minutes, else nothing to say. */
function loadText(feature: ExerciseFeature, direction: LoadDirection): string {
	if (feature.last.load_lb != null) return sayLoad(feature.last.load_lb, direction);
	if (feature.last.duration_min != null) return `${Math.round(feature.last.duration_min)} min`;
	if (feature.last.sets != null && feature.last.reps != null) return `${feature.last.sets} × ${feature.last.reps}`;
	return "—";
}

/** "3 × 10" when both halves are known; one of them alone otherwise; null with neither. */
function scheme(sets: number | null, reps: number | null): string | null {
	if (sets != null && reps != null) return `${sets} × ${reps}`;
	if (reps != null) return `${reps} reps`;
	if (sets != null) return `${sets} sets`;
	return null;
}

/**
 * What has happened to the load over the window, in the words that fit the machine. An
 * assisted row that has come down 5 lb has got five pounds *stronger*, and saying "−5 lb"
 * there is technically true and useless.
 */
export function deltaText(feature: ExerciseFeature, direction: LoadDirection): string | null {
	if (feature.sessions.length < 2) return "First session";
	if (feature.trend_lb == null || feature.trend_lb === 0) return "Same as four weeks ago";
	const magnitude = number(Math.abs(feature.trend_lb));
	if (direction === "assistance") {
		return feature.trend_lb < 0 ? `${magnitude} lb less help` : `${magnitude} lb more help`;
	}
	return feature.trend_lb > 0 ? `+${magnitude} lb in four weeks` : `−${magnitude} lb in four weeks`;
}

/** Green for progress, amber for a step back, quiet for neither (services/day/deltas.ts). */
export function sentimentOf(feature: ExerciseFeature, direction: LoadDirection): "good" | "watch" | "neutral" {
	if (feature.trend_lb == null || feature.trend_lb === 0) return "neutral";
	const better = direction === "assistance" ? feature.trend_lb < 0 : feature.trend_lb > 0;
	return better ? "good" : "watch";
}

// ---------------------------------------------------------------------------
// Cardio words
// ---------------------------------------------------------------------------

/** Which section a logged exercise belongs in. The activity's own category decides. */
export function sectionOf(feature: ExerciseFeature): "lifts" | "cardio" | "none" {
	if (feature.category === "cardio") return "cardio";
	// Stretching progresses by neither a plate nor a weekly minute; the ledger has it.
	if (feature.category === "mobility") return "none";
	// Nothing said. The same honest guess `isCardio` makes about an uncategorised row —
	// minutes with no sets is cardio-shaped — with a load ruling it out, because a number
	// in pounds is a lift's number whatever else the row is missing.
	if (feature.category == null) return looksLikeCardio(feature) ? "cardio" : "lifts";
	return "lifts";
}

function looksLikeCardio(feature: ExerciseFeature): boolean {
	return (
		feature.sessions.every((session) => session.sets == null && session.load_lb == null) &&
		feature.sessions.some((session) => (session.duration_min ?? 0) > 0)
	);
}

/** Minutes per mile, when both halves of the fraction are there. */
export function paceMinMi(durationMin: number | null, distanceMi: number | null): number | null {
	if (durationMin == null || durationMin <= 0) return null;
	if (distanceMi == null || distanceMi <= 0) return null;
	return round(durationMin / distanceMi, 2);
}

/** "20 min · 1.2 mi · 16.7 min/mi" — as much of it as the session actually measured. */
export function cardioSummary(point: BoardCardioPoint): string {
	const parts = [
		point.duration_min == null ? null : `${Math.round(point.duration_min)} min`,
		point.distance_mi == null ? null : `${number(point.distance_mi)} mi`,
		point.pace_min_mi == null ? null : `${number(point.pace_min_mi)} min/mi`,
	].filter((part): part is string => part != null);
	return parts.length === 0 ? "—" : parts.join(" · ");
}

/**
 * What has changed over the window — pace first, because it is the one cardio figure that
 * means the same thing on every session. Minutes are reported and not judged: see below.
 */
export function cardioDelta(series: readonly BoardCardioPoint[]): { text: string | null; sentiment: "good" | "watch" | "neutral" } {
	if (series.length < 2) return { text: series.length === 1 ? "First session" : null, sentiment: "neutral" };
	const first = series[0] as BoardCardioPoint;
	const last = series[series.length - 1] as BoardCardioPoint;

	if (first.pace_min_mi != null && last.pace_min_mi != null) {
		const moved = round(last.pace_min_mi - first.pace_min_mi);
		if (moved === 0) return { text: "Same pace as four weeks ago", sentiment: "neutral" };
		// Fewer minutes per mile is faster, so the sign is the other way round from a load.
		return moved < 0
			? { text: `${number(Math.abs(moved))} min/mi faster`, sentiment: "good" }
			: { text: `${number(moved)} min/mi slower`, sentiment: "watch" };
	}

	if (first.duration_min != null && last.duration_min != null) {
		const moved = round(last.duration_min - first.duration_min);
		if (moved === 0) return { text: "Same as four weeks ago", sentiment: "neutral" };
		// Neutral on purpose. A shorter walk on a Tuesday is not a step backwards: cardio
		// volume is a WEEKLY quantity, the weekly bars above already say whether the week is
		// short, and colouring one session amber for being twenty minutes instead of thirty
		// would be judging the user for a fact the plan does not measure that way.
		return { text: `${moved > 0 ? "+" : "−"}${number(Math.abs(moved))} min in four weeks`, sentiment: "neutral" };
	}

	return { text: null, sentiment: "neutral" };
}

/**
 * The next step for one cardio activity: the week's shortfall against the plan's target,
 * capped at +10 % on this activity's own last session, in the words of a row.
 *
 * The number is `cardioNextMinutes` — the same function the brief's cardio line is made of
 * — so the tab and the coach cannot disagree about how fast cardio is allowed to grow. What
 * this does not do is ask `prescribeLoads`, whose cardio branch reports the last duration
 * and says so in its own `why` ("cardio volume follows the week, not the session"). That is
 * a description of what happened; a board row has to say what to do next.
 */
export function cardioNextFor(feature: ExerciseFeature, cardio: CardioFeature): BoardCardioNext {
	const last = feature.last.duration_min;
	const said = last == null ? null : `${Math.round(last)} min`;
	const week = `${cardio.minutes_this_week} of ${cardio.weekly_target_min} min this week`;

	const minutes = cardioNextMinutes(cardio.short_by_min, last);
	if (minutes == null) {
		return {
			rule: "cardio",
			minutes: null,
			text: said ? `Hold ${said}` : "Minutes follow the week, not the session",
			eta: null,
			why: `${week} — the week is already there, so there is nothing to add.`,
		};
	}

	return {
		rule: "cardio",
		minutes,
		text: `${minutes} min next`,
		eta: null,
		why: said
			? `${week}, ${cardio.short_by_min} short. One safe step on the last ${said} is ${minutes} min (+10 %, capped by the shortfall).`
			: `${week}, ${cardio.short_by_min} short. Nothing timed yet, so ${minutes} min is where this starts.`,
	};
}

/** Typical days between this exercise's sessions — how the "in ~N weeks" is arrived at. */
export function cadenceDays(sessions: readonly ExerciseSession[]): number {
	const gaps: number[] = [];
	for (let i = 0; i < sessions.length - 1; i += 1) {
		const newer = sessions[i]?.date;
		const older = sessions[i + 1]?.date;
		if (newer && older) gaps.push(daysBefore(older, newer));
	}
	if (gaps.length === 0) return DEFAULT_CADENCE_DAYS;
	const sorted = [...gaps].sort((a, b) => a - b);
	const middle = sorted[Math.floor(sorted.length / 2)] as number;
	return Math.min(MAX_CADENCE_DAYS, Math.max(MIN_CADENCE_DAYS, middle));
}

/** "~1 wk" / "~1–2 wks", from sessions still to go at this exercise's own cadence. */
export function etaFor(sessionsNeeded: number, cadence: number): string | null {
	if (sessionsNeeded <= 0) return null;
	const weeks = (sessionsNeeded * cadence) / 7;
	const low = Math.max(1, Math.floor(weeks));
	const high = Math.max(low, Math.ceil(weeks));
	return low === high ? `~${low} wk${low === 1 ? "" : "s"}` : `~${low}–${high} wks`;
}

/**
 * The coach's prescription, said in a row's worth of words.
 *
 * Every number in here came out of `prescribeLoads`. What this adds is the one thing a
 * board wants and a brief does not: **when**. A hold is only a hold until the sessions are
 * in, and "hold until 3 × 10 twice · ~1–2 wks" is the difference between a screen that
 * describes a plateau and one that describes a plan.
 */
export function nextStepFor(
	prescription: Prescription,
	feature: ExerciseFeature | null,
	catalog: CatalogFacts
): BoardNextStep {
	const direction = prescription.load_direction;
	const said = sayLoad(prescription.load_lb, direction);
	const shape = scheme(prescription.sets, prescription.reps);
	const base = {
		rule: prescription.rule,
		load_lb: prescription.load_lb,
		sets: prescription.sets,
		reps: prescription.reps,
		why: prescription.why,
	};

	if (prescription.rule === "cardio") {
		return {
			...base,
			text: prescription.minutes == null ? "Minutes follow the week, not the session" : `${prescription.minutes} min next`,
			eta: null,
		};
	}

	if (prescription.rule === "new") {
		return { ...base, text: `Repeat ${said} to set a baseline`, eta: null };
	}

	if (prescription.rule === "step_up") {
		return {
			...base,
			text: direction === "assistance" ? `${said} next — one step less help` : `Up to ${said} next`,
			eta: null,
		};
	}

	if (prescription.rule === "step_down") {
		return {
			...base,
			text: direction === "assistance" ? `${said} next — one step more help` : `Back to ${said} to rebuild`,
			eta: null,
		};
	}

	if (prescription.rule === "restart") {
		return { ...base, text: `Coming back: ${said}${shape ? `, ${shape}` : ""}`, eta: null };
	}

	if (prescription.rule === "ease_back") {
		return { ...base, text: `Ease back in: ${said}${shape ? `, ${shape}` : ""}`, eta: null };
	}

	if (prescription.rule === "reference") {
		return { ...base, text: `Stated, not logged: start at ${said}`, eta: null };
	}

	// A hold. Two of them, and they are different promises: waiting for the sessions to
	// add up, and waiting because the load moved inside the last week.
	if (!feature) return { ...base, text: `Hold ${said}`, eta: null };

	const target = targetScheme(feature.sessions);
	const targetShape = scheme(target.sets, target.reps);
	const hits = sessionsAtTarget(feature, target);
	const needed = Math.max(0, SESSIONS_AT_TARGET_BEFORE_STEP - hits);
	const cadence = cadenceDays(feature.sessions);
	const step = stepFor(feature.exercise, prescription.load_lb, catalog.equipment);
	const after =
		prescription.load_lb == null
			? null
			: direction === "assistance"
				? Math.max(0, prescription.load_lb - step)
				: prescription.load_lb + step;

	// What the hold is *for*: the load it is on the way to, and roughly when.
	if (needed > 0 && after != null) {
		return {
			...base,
			text: targetShape ? `Hold ${said} until ${targetShape} twice` : `Hold ${said} until two clean sessions`,
			eta: etaFor(needed, cadence),
		};
	}

	return { ...base, text: `Hold ${said} — one step a week at most`, eta: etaFor(1, cadence) };
}

/**
 * How many consecutive sessions at the current load hit the scheme. The same count
 * `prescribeLoads` makes; kept here rather than exported from rules.ts because rules.ts
 * uses it to decide and the board uses it to say how far off the decision is.
 */
function sessionsAtTarget(feature: ExerciseFeature, target: { sets: number | null; reps: number | null }): number {
	const current = feature.last.load_lb;
	let hits = 0;
	for (const session of feature.sessions) {
		if (session.load_lb !== current) break;
		if (session.confidence === "low") break;
		if (target.reps != null && (session.reps == null || session.reps < target.reps)) break;
		if (target.sets != null && (session.sets == null || session.sets < target.sets)) break;
		hits += 1;
	}
	return hits;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function thinned<T>(points: T[]): T[] {
	if (points.length <= MAX_SERIES_POINTS) return points;
	// Newest kept: a sparkline is about where the load is going, not where it started.
	return points.slice(points.length - MAX_SERIES_POINTS);
}

function weekStarts(end: IsoDate, weeks: number): IsoDate[] {
	// Weeks end on `end`, so the last bucket is the trailing seven days including today —
	// the same "this week" every other feature in the app means.
	const starts: IsoDate[] = [];
	for (let back = weeks - 1; back >= 0; back -= 1) starts.push(addDays(end, -(back * 7 + 6)));
	return starts;
}

function inLastWeeks(date: IsoDate, end: IsoDate, weeks: number): boolean {
	return withinWindow(date, end, weeks * 7);
}

function bucketOf(date: IsoDate, end: IsoDate): number {
	return Math.floor(daysBefore(date, end) / 7);
}

export interface BuildBoardInput {
	features: CoachFeatures;
	/** Everything in the wider window; the weekly bars read this, the lifts read `features`. */
	facts: DayFacts;
	catalog?: CatalogFacts;
	/** Catalogue ids by lower-cased exercise name, so a row can open its sheet. */
	exerciseIds?: Record<string, string | null>;
	trainingDaysTarget?: number | null;
	/** True when a goal named the weekly cardio minutes rather than the WHO default. */
	cardioTargetStated?: boolean;
}

/** Features + prescriptions in, board out. No SQL, no clock, no provider. */
export function buildBoard({
	features,
	facts,
	catalog = EMPTY_CATALOG_FACTS,
	exerciseIds = {},
	trainingDaysTarget = null,
	cardioTargetStated = false,
}: BuildBoardInput): TrainingBoard {
	const gap = gapRule(features.days_since_last_workout);
	// The coach's own call, with the coach's own inputs. Reference loads are deliberately
	// not passed: the board is what the user has actually done, and a stated load has never
	// been done. It belongs to the brief, which is allowed to plan from a claim.
	const prescriptions = prescribeLoads(features, {
		equipment: catalog.equipment,
		loadDirection: catalog.loadDirection,
		gap,
	});
	const byExercise = new Map<string, Prescription>(
		prescriptions.map((item) => [item.exercise.trim().toLowerCase(), item])
	);

	const lifts: BoardLift[] = features.exercises.filter((feature) => sectionOf(feature) === "lifts").map((feature) => {
		const key = feature.exercise.trim().toLowerCase();
		const direction = catalog.loadDirection[key] ?? "resistance";
		const prescription = byExercise.get(key);
		return {
			exercise: feature.exercise,
			exercise_id: exerciseIds[key] ?? null,
			category: feature.category,
			muscle_groups: feature.muscle_groups,
			load_direction: direction,
			load_lb: feature.last.load_lb,
			sets: feature.last.sets,
			reps: feature.last.reps,
			load_text: loadText(feature, direction),
			last_date: feature.last.date,
			days_since: feature.days_since,
			sessions: feature.sessions.length,
			best_load_lb: feature.best_load_lb,
			trend: feature.trend,
			trend_lb: feature.trend_lb,
			delta_text: deltaText(feature, direction),
			sentiment: sentimentOf(feature, direction),
			// Oldest first: a chart is read left to right.
			series: thinned(
				[...feature.sessions]
					.reverse()
					.map((session) => ({
						date: session.date,
						load_lb: session.load_lb,
						sets: session.sets,
						reps: session.reps,
					}))
			),
			next: prescription
				? nextStepFor(prescription, feature, catalog)
				: { rule: "hold", load_lb: feature.last.load_lb, sets: feature.last.sets, reps: feature.last.reps, text: `Hold ${loadText(feature, direction)}`, eta: null, why: "" },
		};
	});

	const distances = distanceIndex(facts);
	const cardio: BoardCardioRow[] = features.exercises
		.filter((feature) => sectionOf(feature) === "cardio")
		.map((feature) => cardioRowOf(feature, features.cardio, distances, exerciseIds));

	return {
		date: facts.date,
		lifts,
		frequency: frequencyOf(facts, features, trainingDaysTarget),
		cardio: cardioOf(facts, features, cardio, cardioTargetStated),
		body: bodyOf(facts, features),
	};
}

/** Miles per exercise per day, summed — the one figure `ExerciseFeature` does not carry. */
function distanceIndex(facts: DayFacts): Map<string, number> {
	const index = new Map<string, number>();
	for (const activity of facts.activities) {
		const name = activity.exercise?.trim().toLowerCase();
		if (!name || activity.distance_mi == null) continue;
		const key = `${name}|${activity.date}`;
		index.set(key, (index.get(key) ?? 0) + activity.distance_mi);
	}
	return index;
}

function cardioRowOf(
	feature: ExerciseFeature,
	cardio: CardioFeature,
	distances: Map<string, number>,
	exerciseIds: Record<string, string | null>
): BoardCardioRow {
	const key = feature.exercise.trim().toLowerCase();
	// Oldest first: a chart is read left to right.
	const points: BoardCardioPoint[] = [...feature.sessions].reverse().map((session) => {
		const distance = distances.get(`${key}|${session.date}`) ?? null;
		return {
			date: session.date,
			duration_min: session.duration_min == null ? null : round(session.duration_min),
			distance_mi: distance == null ? null : round(distance, 2),
			pace_min_mi: paceMinMi(session.duration_min, distance),
		};
	});
	// The delta reads the whole window and the sparkline reads the tail of it: "in four
	// weeks" has to be four weeks even when only the last twelve dots are drawn.
	const delta = cardioDelta(points);
	const last = points[points.length - 1] as BoardCardioPoint;
	const paces = points.map((point) => point.pace_min_mi).filter((pace): pace is number => pace != null);

	return {
		exercise: feature.exercise,
		exercise_id: exerciseIds[key] ?? null,
		category: feature.category,
		last_date: feature.last.date,
		days_since: feature.days_since,
		sessions: feature.sessions.length,
		duration_min: last.duration_min,
		distance_mi: last.distance_mi,
		pace_min_mi: last.pace_min_mi,
		best_pace_min_mi: paces.length === 0 ? null : Math.min(...paces),
		summary_text: cardioSummary(last),
		delta_text: delta.text,
		sentiment: delta.sentiment,
		series: thinned(points),
		next: cardioNextFor(feature, cardio),
	};
}

function frequencyOf(
	facts: DayFacts,
	features: CoachFeatures,
	trainingDaysTarget: number | null
): BoardFrequency {
	const end = facts.date;
	const dates = [
		...new Set(
			facts.activities.filter((activity) => inLastWeeks(activity.date, end, BOARD_WEEKS)).map((a) => a.date)
		),
	];
	const starts = weekStarts(end, BOARD_WEEKS);
	const weeks = starts.map((start, index) => ({
		start,
		sessions: dates.filter((date) => bucketOf(date, end) === BOARD_WEEKS - 1 - index).length,
	}));
	const total = weeks.reduce((sum, week) => sum + week.sessions, 0);

	return {
		weeks,
		sessions_this_week: features.sessions_this_week,
		average_per_week: round(total / BOARD_WEEKS),
		training_days_target: trainingDaysTarget,
		// Only groups that have actually been trained: a bar chart of eleven zeroes is a
		// judgement about the user, and the coverage section already names the absences.
		muscles: features.muscles
			.filter((muscle) => muscle.sets_28d > 0)
			.map((muscle) => ({ muscle: muscle.muscle, sets_7d: muscle.sets_7d, sets_28d: muscle.sets_28d }))
			.sort((a, b) => b.sets_28d - a.sets_28d || a.muscle.localeCompare(b.muscle)),
		// Straight through from the features, in the order the ledger sorted itself into.
		coverage: features.coverage,
	};
}

function cardioOf(
	facts: DayFacts,
	features: CoachFeatures,
	activities: BoardCardioRow[],
	targetStated: boolean
): BoardCardio {
	const end = facts.date;
	const window = facts.activities.filter(
		(activity) => inLastWeeks(activity.date, end, BOARD_WEEKS) && isCardio(activity)
	);
	const starts = weekStarts(end, BOARD_WEEKS);
	const weeks = starts.map((start, index) => ({
		start,
		minutes: Math.round(
			window
				.filter((activity) => bucketOf(activity.date, end) === BOARD_WEEKS - 1 - index)
				.reduce((total, activity) => total + (activity.duration_min ?? 0), 0)
		),
	}));

	const paced = window
		.filter((activity) => paceOf(activity) != null)
		.map((activity) => ({
			date: activity.date,
			pace_min_mi: paceOf(activity) as number,
			distance_mi: activity.distance_mi as number,
		}));

	const last = [...paced].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
	const best = paced.length === 0 ? null : paced.reduce((fastest, item) => (item.pace_min_mi < fastest.pace_min_mi ? item : fastest));

	return {
		weeks,
		minutes_this_week: features.cardio.minutes_this_week,
		weekly_target_min: features.cardio.weekly_target_min,
		short_by_min: features.cardio.short_by_min,
		last,
		best,
		activities,
		target_stated: targetStated,
	};
}

/** Minutes per mile for one activity, when it has both halves of the fraction. */
function paceOf(activity: FactActivity): number | null {
	return paceMinMi(activity.duration_min, activity.distance_mi);
}

function bodyOf(facts: DayFacts, features: CoachFeatures): BoardBody {
	const byDay = new Map<IsoDate, number[]>();
	for (const weight of facts.weights) {
		if (!inLastWeeks(weight.date, facts.date, BOARD_WEEKS)) continue;
		byDay.set(weight.date, [...(byDay.get(weight.date) ?? []), weight.weight_lb]);
	}
	const series = [...byDay.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([date, values]) => ({ date, value: round(values.reduce((a, b) => a + b, 0) / values.length) }));

	return {
		latest: features.weight.latest,
		latest_date: features.weight.latest_date,
		avg_7d: features.weight.avg_7d,
		trend_per_week: features.weight.trend_per_week,
		series,
	};
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type Queryable = pg.Pool | pg.PoolClient;

export interface LoadBoardOptions {
	tzOffsetMin: number;
	now?: Date;
}

/**
 * The board for one user. One facts window covers everything: the lifts read the trailing
 * four weeks through `computeFeatures` (which filters to its own window), and the weekly
 * bars read the whole eight.
 */
export async function loadBoard(db: Queryable, userId: string, { tzOffsetMin, now = new Date() }: LoadBoardOptions): Promise<TrainingBoard> {
	const date = localDay(now, tzOffsetMin).date;
	const facts = await loadFacts(db, userId, { date, from: addDays(date, -(BOARD_DAYS - 1)), tzOffsetMin });

	const { rows } = await db.query<{ training_days: number | null }>(
		`SELECT training_days FROM profiles WHERE id = $1`,
		[userId]
	);
	const trainingDaysTarget = rows[0]?.training_days ?? null;

	// The cardio bars are drawn against the plan's intent, so the goal's own weekly minutes
	// win over the WHO default when a goal names them (services/coach/features.ts).
	const goals = await db.query<{ metrics: { measure?: string; target?: number | null }[] | null }>(
		`SELECT metrics FROM goals WHERE user_id = $1 AND status = 'active' ORDER BY priority`,
		[userId]
	);
	const cardioTargetMin =
		goals.rows
			.flatMap((row) => (Array.isArray(row.metrics) ? row.metrics : []))
			.find((metric) => metric?.measure === "weekly_cardio_min" && metric.target != null)?.target ?? null;

	// The eating half of the feature set is not read by anything on this board, so it is not
	// loaded: a training screen should not cost a TDEE computation.
	const features = computeFeatures({ facts, trainingDaysTarget, cardioTargetMin });

	const names = features.exercises.map((exercise) => exercise.exercise);
	const catalog = await catalogFactsFor(db, names);
	const matches = await lookupExercises(db, names);
	const exerciseIds = Object.fromEntries(
		names.map((name) => [name.trim().toLowerCase(), matches.get(name.trim().toLowerCase())?.id ?? null])
	);

	return buildBoard({
		features,
		facts,
		catalog,
		exerciseIds,
		trainingDaysTarget,
		cardioTargetStated: cardioTargetMin != null,
	});
}

/** Re-exported so a caller can say what "this week" means without importing features.ts. */
export { WEEK_DAYS };
