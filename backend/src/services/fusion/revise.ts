import type { FusionResult, SegmentKind } from "./schema.js";

// "Make a change" — the second half of the review-and-tell flow (docs/concept-v2.md
// §Principles 7: NO FORMS). The user is looking at what was understood and says what is
// wrong with it in their own words: "reps were 3, not 4", "that meal was lunch not dinner",
// "it was the cable machine". No field is ever typed into.
//
// The shape of the answer is the shape the app already draws, so a revision is not a new
// call with a new grammar: it is the SAME per-kind detail call the analyze pipeline already
// makes, re-run with the previous part and the instruction in its system prompt. That is
// deliberate and it is the only affordable design — the routing union has no room for a
// revision branch (see the grammar-ceiling table on `FusionRouteOutputSchema`), and the
// per-kind detail schemas are already the exact shape of one part.
//
// A revision is applied part by part. A log that read as three things is three calls, each
// told "if this instruction is not about this part, return it unchanged" — which is also
// what makes "that meal was lunch" safe to send at a log that holds a meal and a run.

/** Which focused detail call answers for a result. Null for a part nothing can revise. */
export function segmentKindFor(result: FusionResult): SegmentKind | null {
	switch (result.kind) {
		case "activities":
			return "activities";
		case "meal":
			return "meal";
		case "weight":
			return "weight";
		case "goal":
			return "goal";
		case "constraint":
		case "preference":
		case "coach_context":
			return "statement";
		case "unclear":
			// A question is not a record: there is nothing in it to change.
			return null;
	}
}

/**
 * The part as the model is shown it: compact JSON, with the bookkeeping the user never
 * sees taken out. `sources` is provenance for the card, `refine` is an offer this call
 * knows nothing about, `consistency` is our own arithmetic verdict on the last reading —
 * none of the three is a fact to be revised, and showing the model its own last verdict
 * would only invite it to copy the verdict instead of fixing the numbers.
 */
export function compactPart(result: FusionResult): string {
	const strip = <T extends Record<string, unknown>>(value: T): Record<string, unknown> => {
		const {
			sources: _sources,
			refine: _refine,
			consistency: _consistency,
			...rest
		} = value as Record<string, unknown>;
		return rest;
	};
	if (result.kind === "activities") {
		return JSON.stringify({ kind: "activities", items: result.items.map((item) => strip(item)) });
	}
	return JSON.stringify(strip(result as unknown as Record<string, unknown>));
}

/**
 * What the revision call was not asked for, kept from the part it revised.
 *
 * The detail schemas do not carry `category` or `muscle_groups` — the catalogue derives
 * them on save, and a fresh analyze has none to lose. A revision does: the part on screen
 * may be a saved row that already has its muscle groups, and answering "reps were 4" with
 * a workout that suddenly belongs to no muscle group would quietly delete it from coverage.
 * So they are carried across, but only while the movement is still the same movement.
 */
export function carryForward(previous: FusionResult, next: FusionResult): FusionResult {
	if (previous.kind !== "activities" || next.kind !== "activities") return next;
	if (previous.items.length !== next.items.length) return next;
	const same = (a: string | null, b: string | null) =>
		(a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
	return {
		...next,
		items: next.items.map((item, index) => {
			const before = previous.items[index]!;
			if (!same(before.exercise, item.exercise)) return item;
			return {
				...item,
				category: item.category ?? before.category,
				muscle_groups: item.muscle_groups ?? before.muscle_groups,
			};
		}),
	};
}
