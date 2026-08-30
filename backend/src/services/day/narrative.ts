import { formatClock, instantAt, localMinutesOf, type IsoDate } from "../localTime.js";
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

/** When the app expects a meal, for the dashed placeholder on the arc. */
const SLOT_EXPECTED_AT: Record<Exclude<MealSlot, "snack">, number> = {
	breakfast: 8 * 60,
	lunch: 12 * 60 + 30,
	dinner: 19 * 60,
};

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

export type ArcKind = "meal" | "activity" | "weight" | "block" | "now" | "expected";

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
	date: IsoDate;
	tzOffsetMin: number;
	meals: DayMeal[];
	activities: DayActivity[];
	weights: DayWeight[];
	blocks: Block[];
	expected: ExpectedItem[];
	/** The live day's NOW marker; omitted for a closed day, which is not happening any more. */
	now?: string | null;
}

/** Everything that happened, in one ordered list the arc and the "day arc" section draw. */
export function buildArc({
	date,
	tzOffsetMin,
	meals,
	activities,
	weights,
	blocks,
	expected,
	now,
}: ArcInput): ArcEvent[] {
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
	for (const item of expected) {
		events.push({ kind: "expected", label: item.label, at: item.at_minutes, instant: instantAt(date, tzOffsetMin, item.at_minutes) });
	}
	if (now) events.push({ kind: "now", label: "Now", at: at(now), instant: now });

	return events.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// What the day is still expecting
// ---------------------------------------------------------------------------

export interface ExpectedItem {
	kind: "meal" | "weigh_in";
	slot?: MealSlot;
	label: string;
	/** Where the dashed dot sits on the arc, in local minutes. */
	at_minutes: number;
}

export interface ExpectedInput {
	tzOffsetMin: number;
	meals: DayMeal[];
	weights: DayWeight[];
	/** The user's local clock. A closed day expects nothing — pass null. */
	now: string | null;
}

/**
 * The dashed dots: the next meal the clock says is due, and a weigh-in if the day has had
 * none. Only ever one meal — a list of everything not yet eaten reads as a scolding, and
 * the Today screen has room for one placeholder row.
 */
export function expectedItems({ tzOffsetMin, meals, weights, now }: ExpectedInput): ExpectedItem[] {
	if (!now) return [];
	const minutes = localMinutesOf(now, tzOffsetMin);
	const logged = new Set(meals.map((meal) => meal.slot));
	const items: ExpectedItem[] = [];

	// The next slot that has not closed yet and has nothing in it. A missed breakfast at
	// 3 pm is not "expected" any more; lunch is.
	const next = SLOT_WINDOWS.find((window) => minutes < window.to && !logged.has(window.slot));
	if (next) {
		items.push({
			kind: "meal",
			slot: next.slot,
			label: next.label,
			at_minutes: Math.max(SLOT_EXPECTED_AT[next.slot as Exclude<MealSlot, "snack">], minutes),
		});
	}

	if (weights.length === 0) {
		// Weigh-ins are a morning thing; once the morning is gone the dot sits at now, so
		// it stays visible rather than falling off the left of the arc.
		items.push({ kind: "weigh_in", label: "Weigh-in", at_minutes: Math.max(7 * 60, Math.min(minutes, 22 * 60)) });
	}

	return items;
}
