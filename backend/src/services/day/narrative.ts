import { localMinutesOf } from "../localTime.js";
import type { Block, DayActivity, DayWeight } from "./types.js";

// The parts of the day that are *sentences* but not opinions: the day arc, and (later) any
// other computed-not-generated facts about the day.
//
// All computed, none generated. docs/concept-v2.md §Principles: "facts are computed,
// advice is generated". The *reading* (services/readings/) is the generated half, and it
// is given these facts rather than the raw rows.

// ---------------------------------------------------------------------------
// The day arc
// ---------------------------------------------------------------------------

export type ArcKind = "activity" | "weight" | "block" | "now";

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
 * slot, which the app drew as a dashed ghost dot. It carries none now: a day with one entry
 * in it has one dot on its line (user decision 2026-08-31).
 */
export function buildArc({ tzOffsetMin, activities, weights, blocks, now }: ArcInput): ArcEvent[] {
	const events: ArcEvent[] = [];
	const at = (instant: string) => localMinutesOf(instant, tzOffsetMin);

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
