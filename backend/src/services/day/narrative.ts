import { formatClock, localMinutesOf } from "../localTime.js";
import type { Block, DayActivity, DayMeal, DayWeight, MealSlot } from "./types.js";

// The parts of the day that are *sentences* but not opinions: which slot a meal belongs
// to, the eating-pattern line, the day arc, and what the day is still expecting.
//
// All computed, none generated. docs/concept-v2.md §Principles: "facts are computed,
// advice is generated" — the pattern line is a fact about when the calories landed, and
// paying a model to notice that 60 % of them came after 6 pm would be slower, dearer and
// less reliable than counting them. The *reading* (services/readings/) is the generated
// half, and it is given these facts rather than the raw rows.

/** Slot windows in local minutes; a meal outside all of them is a snack. */
const SLOT_WINDOWS: { slot: MealSlot; from: number; to: number; label: string }[] = [
	{ slot: "breakfast", from: 4 * 60, to: 10 * 60 + 30, label: "Breakfast" },
	{ slot: "lunch", from: 11 * 60, to: 15 * 60, label: "Lunch" },
	{ slot: "dinner", from: 17 * 60, to: 21 * 60 + 30, label: "Dinner" },
];

export function slotForMinutes(minutes: number): MealSlot {
	return SLOT_WINDOWS.find((w) => minutes >= w.from && minutes < w.to)?.slot ?? "snack";
}

export function slotLabel(slot: MealSlot): string {
	return SLOT_WINDOWS.find((w) => w.slot === slot)?.label ?? "Snack";
}

// ---------------------------------------------------------------------------
// The eating-pattern line
// ---------------------------------------------------------------------------

function percent(part: number, whole: number): number {
	return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

/**
 * One line about *when* the day's calories landed — the thing a list of meals does not
 * say. Ordered rules, first match wins, so the same day always produces the same line.
 */
export function eatingPattern(meals: DayMeal[], tzOffsetMin: number): string | null {
	if (meals.length === 0) return null;

	const timed = meals
		.map((meal) => ({ meal, minutes: localMinutesOf(meal.logged_at, tzOffsetMin) }))
		.sort((a, b) => a.minutes - b.minutes);
	const total = timed.reduce((sum, { meal }) => sum + meal.kcal, 0);
	const first = timed[0] as (typeof timed)[number];
	const last = timed[timed.length - 1] as (typeof timed)[number];

	if (timed.length === 1) {
		return `One meal, at ${formatClock(first.minutes)}${total > 0 ? ` — all ${total.toLocaleString("en-US")} kcal of the day` : ""}.`;
	}

	const evening = timed.filter((t) => t.minutes >= 17 * 60).reduce((sum, { meal }) => sum + meal.kcal, 0);
	const morning = timed.filter((t) => t.minutes < 12 * 60).reduce((sum, { meal }) => sum + meal.kcal, 0);
	const window = `${formatClock(first.minutes)} to ${formatClock(last.minutes)}`;

	if (percent(evening, total) >= 50) {
		return `Back-loaded — ${percent(evening, total)}% of the day's calories came after 5 pm, across ${timed.length} meals from ${window}.`;
	}
	if (percent(morning, total) >= 45) {
		return `Front-loaded — ${percent(morning, total)}% of the day's calories were in before noon, across ${timed.length} meals from ${window}.`;
	}

	// The longest gap is the other thing worth saying: it is what a skipped lunch looks
	// like from the outside.
	let longestGap = 0;
	let gapAfter = first;
	for (let i = 1; i < timed.length; i += 1) {
		const gap = (timed[i] as (typeof timed)[number]).minutes - (timed[i - 1] as (typeof timed)[number]).minutes;
		if (gap > longestGap) {
			longestGap = gap;
			gapAfter = timed[i - 1] as (typeof timed)[number];
		}
	}
	if (longestGap >= 6 * 60) {
		const hours = Math.round(longestGap / 60);
		return `${timed.length} meals from ${window}, with a ${hours}-hour gap after ${formatClock(gapAfter.minutes)}.`;
	}
	return `${timed.length} meals, evenly spread from ${window}.`;
}

// ---------------------------------------------------------------------------
// The day arc
// ---------------------------------------------------------------------------

export type ArcKind = "meal" | "activity" | "weight" | "block" | "now";

export interface ArcEvent {
	kind: ArcKind;
	label: string;
	/** Minutes past the user's local midnight — what the 6a→11p line is drawn on. */
	at: number;
	/** Set for a block: the span the accent bar covers. */
	until?: number;
	/** The instant, for anything that wants a real timestamp. */
	instant: string;
	/** Right-hand numeral on the row, when there is one. */
	kcal?: number;
}

export interface ArcInput {
	tzOffsetMin: number;
	meals: DayMeal[];
	activities: DayActivity[];
	weights: DayWeight[];
	blocks: Block[];
	/** The live day's NOW marker; omitted for a closed day, which is not happening any more. */
	now?: string | null;
}

/**
 * Everything that happened, in one ordered list the arc draws.
 *
 * *Everything that happened* — the arc used to also carry an `expected` event per unlogged
 * slot, which the app drew as a dashed ghost dot. It carries none now: a day with one meal
 * in it has one dot on its line (user decision 2026-08-31).
 */
export function buildArc({ tzOffsetMin, meals, activities, weights, blocks, now }: ArcInput): ArcEvent[] {
	const events: ArcEvent[] = [];
	const at = (instant: string) => localMinutesOf(instant, tzOffsetMin);

	for (const meal of meals) {
		events.push({ kind: "meal", label: meal.description, at: at(meal.logged_at), instant: meal.logged_at, kcal: meal.kcal });
	}
	for (const block of blocks) {
		events.push({
			kind: "block",
			label: block.title,
			at: at(block.start),
			until: at(block.end),
			instant: block.start,
			kcal: block.kcal,
		});
	}
	// Activities outside a block are the Health ones; the blocks cover the rest.
	for (const activity of activities.filter((a) => a.source === "health")) {
		events.push({
			kind: "activity",
			label: activity.description,
			at: at(activity.logged_at),
			instant: activity.logged_at,
			kcal: activity.kcal,
		});
	}
	for (const weight of weights) {
		events.push({
			kind: "weight",
			label: `${weight.weight_lb} lb`,
			at: at(weight.logged_at),
			instant: weight.logged_at,
		});
	}
	if (now) events.push({ kind: "now", label: "Now", at: at(now), instant: now });

	return events.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// What the day has not had — a fact for the reading, never a row on a screen
// ---------------------------------------------------------------------------

/**
 * A slot the day has nothing in yet.
 *
 * Nothing renders this. It exists because the Right-now reading is written from the
 * computed day and this is how it knows which meal would close the remaining targets — the
 * difference between "a ~650 kcal, 45 g-protein dinner would close today's targets" and a
 * sentence about dinner in general. Everything the *user* sees is what they logged, so
 * `at_minutes` (where the dashed dot used to sit) is gone with the dot.
 */
export interface ExpectedItem {
	kind: "meal" | "weigh_in";
	slot?: MealSlot;
	label: string;
}

export interface ExpectedInput {
	tzOffsetMin: number;
	meals: DayMeal[];
	weights: DayWeight[];
	/** The user's local clock. A closed day expects nothing — pass null. */
	now: string | null;
}

/**
 * The open slots: the next meal window that is still open and empty, and a weigh-in if the
 * day has had none. Only ever one meal — a list of everything not yet eaten reads as a
 * scolding even to a model.
 */
export function expectedItems({ tzOffsetMin, meals, weights, now }: ExpectedInput): ExpectedItem[] {
	if (!now) return [];
	const minutes = localMinutesOf(now, tzOffsetMin);
	const logged = new Set(meals.map((meal) => meal.slot));
	const items: ExpectedItem[] = [];

	// The next slot that has not closed yet and has nothing in it. A breakfast nobody ate
	// is not an open slot at 3 pm; lunch is.
	const next = SLOT_WINDOWS.find((window) => minutes < window.to && !logged.has(window.slot));
	if (next) items.push({ kind: "meal", slot: next.slot, label: next.label });
	if (weights.length === 0) items.push({ kind: "weigh_in", label: "Weigh-in" });

	return items;
}
