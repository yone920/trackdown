import { z } from "zod";

// The day readings: the two generated sentences in the app (docs/design-system.md §Shared
// components — "Reading card"). Everything else about a day is computed; this is the one
// place a model is asked for words, and it is given the computed facts rather than rows.
//
//   * `right_now` — the live day, ≤ 2 sentences: what is done, what is short, and the one
//     best next action, with chips. Regenerated when the day's inputs hash changes.
//   * `in_short` — the closed day, written once at close and never revised. A closed day is
//     a reading, not a replay (docs/concept-v2.md §The two day views).
//
// SIZE IS PART OF THE CONTRACT. Anthropic compiles a structured-output schema into a
// decoding grammar and refuses one much past ~4.5 KB of JSON schema — the finding that
// reshaped WP2's fusion union (see services/fusion/schema.ts). These two are deliberately
// tiny (well under 1 KB each) and readings.test.ts asserts it, so a future field is a
// measured decision rather than a production 400.

/** What the single next action asks the user to do. Each maps to a screen in the app. */
export const ACTION_KINDS = ["log_meal", "weigh_in", "coach", "workout"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

const ActionSchema = z.object({
	/** Chip text: "Log dinner", "Weigh in". Two or three words. */
	label: z.string().trim().min(1).max(40),
	kind: z.enum(ACTION_KINDS),
});

export const RIGHT_NOW_SCHEMA_NAME = "right_now_reading";

export const RightNowSchema = z.object({
	/** At most two sentences. Second person, present tense, no exclamation marks. */
	text: z.string().trim().min(1).max(400),
	next_action: ActionSchema.extend({
		/** One clause of why, shown under the button. Null when the label says it all. */
		hint: z.string().trim().max(120).nullable(),
	}),
	/** The chips beside it — never repeating `next_action`. May be empty. */
	actions: z.array(ActionSchema).max(3),
});
export type RightNow = z.infer<typeof RightNowSchema>;

export const IN_SHORT_SCHEMA_NAME = "in_short_reading";

export const InShortSchema = z.object({
	/** Two or three sentences about the day that closed. Past tense. */
	text: z.string().trim().min(1).max(600),
});
export type InShort = z.infer<typeof InShortSchema>;

export type ReadingKind = "right_now" | "in_short";

export interface Reading {
	kind: ReadingKind;
	text: string;
	next_action: (RightNow["next_action"] & Record<string, unknown>) | null;
	actions: RightNow["actions"];
	inputs_hash: string;
	model: string | null;
	created_at: string;
}
