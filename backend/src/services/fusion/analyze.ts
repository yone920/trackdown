import { CATEGORIES } from "../../db/exercises.js";
import type { ImageMediaType, LlmContent, LlmPort } from "../../ports/llm.js";
import { checkMeal, discrepancyLine } from "./arithmetic.js";
import type { FusionContext } from "./context.js";
import { suggestRefinement } from "./refine.js";
import {
	buildFusionSystemParts,
	buildGoalDetailSystemPrompt,
	buildMealReconcilePrompt,
	buildPartDetailSystemPrompt,
	buildPlanFieldsSystemPrompt,
	buildRevisionSystemPrompt,
} from "./prompt.js";
import { carryForward, compactPart, segmentKindFor } from "./revise.js";
import {
	ACTIVITIES_DETAIL_SCHEMA_NAME,
	ACTIVITIES_REVISION_SCHEMA_NAME,
	ActivitiesDetailOutputSchema,
	ActivitiesRevisionOutputSchema,
	FUSION_ROUTE_SCHEMA_NAME,
	FusionRouteOutputSchema,
	GOAL_DETAIL_SCHEMA_NAME,
	GoalDetailOutputSchema,
	MEAL_DETAIL_SCHEMA_NAME,
	MealDetailOutputSchema,
	PLAN_FIELDS_SCHEMA_NAME,
	PlanFieldsOutputSchema,
	STATEMENT_DETAIL_SCHEMA_NAME,
	StatementDetailOutputSchema,
	WEIGHT_DETAIL_SCHEMA_NAME,
	WeightDetailOutputSchema,
	toFusionResult,
	type FusionDetail,
	type FusionResult,
	type FusionRoute,
	type SegmentKind,
} from "./schema.js";

// One log → one call, still, for the one thing people usually log.
//
// What changed (Field fixes, mixed input): a log is no longer assumed to be one kind.
// "ate two eggs, ran 5k, weighed in at 181" is a meal, an activity and a weigh-in, and the
// old pipeline kept whichever the model picked and silently dropped the rest. The routing
// call now also *segments*: it answers with the first thing said, in full, plus
// `more_kinds` — the bare list of what else is in there. Each of those is filled in by a
// focused call carrying only its own kind's schema, and all of them run in parallel.
//
// Why a bare list of kinds and not a list of routed records, or even {kind, text}: the
// grammar ceiling. See the measurements in schema.ts — the routing union has about 170
// bytes of headroom and a list of enum values is what fits in it. A follow-up call is given
// the whole original message anyway, so quoting the segment's words at it would tell it
// nothing it could not read for itself.
//
// Why not a segmenter call in front of everything, as the design first read: it would put
// a second round trip on the hot path — logging a workout or a meal — to answer a question
// that is already the routing decision. Folding it into routing keeps the call counts
// exactly where they were: one for a single activities / meal / weight / coach context,
// two for a goal or a constraint. A mixed input costs one more call per extra part, but
// still only two round trips, because the detail calls are a single Promise.all.

/** A photo already downscaled and stored; the model sees the same bytes we kept. */
export interface FusionPhoto {
	mediaType: ImageMediaType;
	base64: string;
}

export interface AnalyzeInput {
	/** The transcript or the typed note. May be empty when the log is photos only. */
	text?: string | null;
	photos?: FusionPhoto[];
	context: FusionContext;
}

export interface FusionAnalysis {
	/** One per thing the user said, in the order they said it. Never empty. */
	results: FusionResult[];
	/**
	 * Which part each photo belongs to: `photoParts[i]` indexes `results`. Same length as
	 * the photos that went in, so the confirm can link the plate to the meal and the
	 * machine to the exercise.
	 */
	photoParts: number[];
}

export interface ReviseInput {
	/** The parts the user is looking at — a pending preview, or a saved row read back. */
	results: FusionResult[];
	/** What they said to change, in their own words. */
	instruction: string;
	context: FusionContext;
}

export interface FusionAnalyzer {
	analyze(input: AnalyzeInput): Promise<FusionAnalysis>;
	/**
	 * "Make a change" (docs/concept-v2.md §Principles 7). Each part is re-read by its own
	 * detail call with the part and the instruction in the prompt; a part the instruction
	 * does not touch comes back as it went in. Same order, same length, so the review
	 * screen redraws in place.
	 */
	revise(input: ReviseInput): Promise<FusionResult[]>;
}

/** Room for ~20 activity items. */
const MAX_TOKENS = 2048;
/** A goal spec is a title, up to six metrics and a timeline; plan fields are smaller. */
const DETAIL_MAX_TOKENS = 1024;

export function buildFusionMessageContent(text: string | null | undefined, photos: FusionPhoto[]): LlmContent[] {
	const content: LlmContent[] = photos.map((photo) => ({
		type: "image",
		mediaType: photo.mediaType,
		base64: photo.base64,
	}));
	const said = text?.trim();
	content.push({
		type: "text",
		text: said
			? `The user said or typed: ${said}`
			: "The user sent the photo(s) with no words. Read what they show.",
	});
	return content;
}

/**
 * Which part each photo belongs to. Each follow-up call says which photos it read from;
 * the first claim wins and everything unclaimed stays with the first part, because a photo
 * filed against nothing is a photo nobody can see again — and with one part there is only
 * one answer anyway.
 */
export function photoPartsFrom(claims: readonly (readonly number[])[], photoCount: number): number[] {
	const parts = new Array<number>(photoCount).fill(0);
	const taken = new Set<number>();
	claims.forEach((claimed, index) => {
		for (const photo of claimed) {
			if (!Number.isInteger(photo) || photo < 0 || photo >= photoCount || taken.has(photo)) continue;
			parts[photo] = index + 1;
			taken.add(photo);
		}
	});
	return parts;
}

/**
 * `unclear` is the model's "I cannot tell what happened" — an answer about the whole log,
 * not a part of it. Nothing else is worth asking about beside it, so its segments go. The
 * rest are deduplicated: one part per kind is the rule the prompt states, and a repeated
 * kind would ask the same question twice and save the answer twice.
 */
export function usableSegments(result: FusionRoute, kinds: readonly SegmentKind[]): SegmentKind[] {
	if (result.kind === "unclear") return [];
	return [...new Set(kinds)].slice(0, 5);
}

/**
 * "I am 212 lbs, my goal is 200" states one weight, and the goal path already writes it as
 * a weigh-in from `facts.current_weight_lb`. The prompt says so and the model still
 * sometimes lists a `weight` part beside the goal, which would put 212 on the scale twice
 * in one Save. The weigh-in the goal carries is the one that is kept: it is what the
 * timeline is projected from, and it is on the card the user is already looking at.
 */
export function dropWeightStatedWithGoal<Part extends { result: FusionResult }>(parts: Part[]): Part[] {
	let stated: number | null = null;
	for (const part of parts) {
		if (part.result.kind === "goal") stated = part.result.facts?.current_weight_lb ?? null;
	}
	if (stated === null) return parts;
	const weight = stated;
	return parts.filter(
		(part) => part.result.kind !== "weight" || Math.abs(part.result.weight_lb - weight) > 0.5
	);
}

/**
 * The best-effort half of "always log". A movement the user could only describe comes back
 * named in their own words with a low confidence, which is right — but it then resolves to
 * nothing in the catalogue, so the day sees a workout with no muscle groups in it and the
 * coverage chart pretends it did not happen.
 *
 * So when those words point at exactly one catalogue entry (services/fusion/refine.ts), two
 * things happen and neither of them is silent: the item borrows that entry's category and
 * muscle groups, and it carries a chip offering the name itself. The borrowed fields are on
 * the confirm card before anything is written, which is the whole difference between a guess
 * and a fabrication — the user is looking at it and can take it off.
 */
export function withRefinements(result: FusionResult, context: FusionContext): FusionResult {
	if (result.kind !== "activities") return result;
	return {
		...result,
		items: result.items.map((item) => {
			const refine = suggestRefinement(item, context.catalog);
			if (!refine) return item;
			const entry = context.catalog.find((candidate) => candidate.name === refine.exercise);
			const category = CATEGORIES.find((known) => known === entry?.category) ?? null;
			return {
				...item,
				refine,
				// Only where the model left a blank: a stated muscle group is the user's.
				category: item.category ?? category,
				muscle_groups: item.muscle_groups ?? (entry && entry.primary_muscles.length > 0 ? entry.primary_muscles : null),
			};
		}),
	};
}

export function createFusionAnalyzer(llm: LlmPort): FusionAnalyzer {
	/**
	 * The arithmetic gate (services/fusion/arithmetic.ts), applied to every meal this
	 * analyzer produces — at analyze and at revise, on the routed part and on a segment.
	 *
	 * A meal whose macros and calories cannot both be true gets exactly ONE automatic re-ask:
	 * the same meal detail call, the same message, with the discrepancy spelled out in the
	 * system prompt. If the second answer adds up it is kept and the card says the numbers
	 * were adjusted. If it does not — or the re-ask fails, or it comes back with the macros
	 * quietly removed so there is nothing left to check — the reading is presented anyway and
	 * the confidence is **forced to low**, whatever the model claimed.
	 *
	 * Presented anyway, always: the user said what they ate, and refusing to log it because
	 * we cannot price it is the failure "always log" exists to prevent. What we can honestly
	 * do is stop calling it high confidence.
	 */
	async function gateMeal(
		result: FusionResult,
		context: FusionContext,
		messages: { role: "user"; content: LlmContent[] }[]
	): Promise<FusionResult> {
		if (result.kind !== "meal") return result;
		const first = checkMeal(result);
		if (!first.checked || first.ok) return result;

		let reread: FusionResult = result;
		try {
			// The photo claim is the first read's answer and stays it: which photos a part
			// was read from is not what this call is being asked to reconsider.
			const { photo_fields, photo_indexes: _claimed, ...meal } = await llm.parseStructured({
				system: buildMealReconcilePrompt(context, compactPart(result), discrepancyLine(first)),
				schema: MealDetailOutputSchema,
				schemaName: MEAL_DETAIL_SCHEMA_NAME,
				maxTokens: DETAIL_MAX_TOKENS,
				messages,
			});
			reread = toFusionResult({ kind: "meal", ...meal }, { photoFields: photo_fields });
		} catch {
			// A failed re-ask is not a failed log. The first reading stands, flagged below.
			reread = result;
		}

		const second = checkMeal(reread);
		const settled = second.checked && second.ok;
		if (reread.kind !== "meal") return reread;
		return {
			...reread,
			// The whole point of the gate: a claim of "high" about numbers that do not add up
			// is the one thing the user cannot check for themselves at a glance.
			confidence: settled ? reread.confidence : "low",
			consistency: {
				outcome: settled ? "adjusted" : "flagged",
				stated_kcal: second.stated_kcal ?? reread.kcal,
				implied_kcal: second.implied_kcal,
			},
		};
	}

	/** The follow-up a routed record needs, if it needs one. */
	async function detailFor(
		route: FusionRoute,
		context: FusionContext,
		messages: { role: "user"; content: LlmContent[] }[]
	): Promise<FusionDetail> {
		if (route.kind === "goal") {
			const goal = await llm.parseStructured({
				system: buildGoalDetailSystemPrompt(context, route.title),
				schema: GoalDetailOutputSchema,
				schemaName: GOAL_DETAIL_SCHEMA_NAME,
				maxTokens: DETAIL_MAX_TOKENS,
				messages,
			});
			return { goal };
		}
		// coach_context is a passing state, not a plan change: nothing to extract.
		if (route.kind === "statement" && route.scope !== "coach_context") {
			const { fields } = await llm.parseStructured({
				system: buildPlanFieldsSystemPrompt(context, route.scope, route.text),
				schema: PlanFieldsOutputSchema,
				schemaName: PLAN_FIELDS_SCHEMA_NAME,
				maxTokens: DETAIL_MAX_TOKENS,
				messages,
			});
			return { fields };
		}
		return {};
	}

	/**
	 * One segment kind → the public result it stands for, from its own focused call.
	 *
	 * `system` is a parameter rather than built here because a revision is this same call
	 * with a different thing to say in front of it (services/fusion/revise.ts): one shape,
	 * one schema, two questions asked of it.
	 */
	async function fillSegment(
		kind: SegmentKind,
		context: FusionContext,
		messages: { role: "user"; content: LlmContent[] }[],
		system: string = buildPartDetailSystemPrompt(context, kind)
	): Promise<{ result: FusionResult; photos: number[] }> {
		const ask = <Output>(schema: Parameters<typeof llm.parseStructured<Output>>[0]["schema"], schemaName: string) =>
			llm.parseStructured({ system, schema, schemaName, maxTokens: DETAIL_MAX_TOKENS, messages });

		switch (kind) {
			case "activities": {
				const { items, photo_fields, photo_indexes } = await ask(
					ActivitiesDetailOutputSchema,
					ACTIVITIES_DETAIL_SCHEMA_NAME
				);
				return {
					result: toFusionResult({ kind: "activities", items }, { photoFields: photo_fields }),
					photos: photo_indexes,
				};
			}
			case "meal": {
				const { photo_fields, photo_indexes, ...meal } = await ask(MealDetailOutputSchema, MEAL_DETAIL_SCHEMA_NAME);
				return {
					// Every meal goes through the arithmetic gate, wherever it was read.
					result: await gateMeal(
						toFusionResult({ kind: "meal", ...meal }, { photoFields: photo_fields }),
						context,
						messages
					),
					photos: photo_indexes,
				};
			}
			case "weight": {
				const { photo_fields, photo_indexes, ...weight } = await ask(
					WeightDetailOutputSchema,
					WEIGHT_DETAIL_SCHEMA_NAME
				);
				return {
					result: toFusionResult({ kind: "weight", ...weight }, { photoFields: photo_fields }),
					photos: photo_indexes,
				};
			}
			case "goal": {
				const goal = await ask(GoalDetailOutputSchema, GOAL_DETAIL_SCHEMA_NAME);
				// The title comes back on the spec; the router had no words to hand over, so
				// the fallback is a placeholder rather than the router's phrase. The public
				// schema wants a non-empty title and the user can edit it on the card.
				const title = goal.spec.title.trim() || "A new goal";
				return { result: toFusionResult({ kind: "goal", title }, { goal }), photos: [] };
			}
			case "statement": {
				const { scope, text: said, fields } = await ask(
					StatementDetailOutputSchema,
					STATEMENT_DETAIL_SCHEMA_NAME
				);
				return { result: toFusionResult({ kind: "statement", scope, text: said }, { fields }), photos: [] };
			}
		}
	}

	/**
	 * The revision call for an activities part. Same message, same prompt as any other
	 * revision — one extra field, `revision_mode`, decided before the items it governs.
	 *
	 * The mode is honoured in one direction only. A "split" that came back with no more
	 * items than went in is simply an amend, and an "amend" that came back with MORE items
	 * is a model contradicting itself — the extra items are dropped rather than saved,
	 * because on this path the part may be a row that ALREADY EXISTS and inventing a second
	 * one is the failure this whole change is against. Only a deliberate split adds records.
	 */
	async function reviseActivities(
		previous: Extract<FusionResult, { kind: "activities" }>,
		context: FusionContext,
		messages: { role: "user"; content: LlmContent[] }[],
		system: string
	): Promise<FusionResult> {
		const { revision_mode, items, photo_fields } = await llm.parseStructured({
			system,
			schema: ActivitiesRevisionOutputSchema,
			schemaName: ACTIVITIES_REVISION_SCHEMA_NAME,
			maxTokens: DETAIL_MAX_TOKENS,
			messages,
		});
		const splitting = revision_mode === "split" && items.length > previous.items.length;
		const kept = splitting ? items : items.slice(0, previous.items.length);
		return toFusionResult(
			{ kind: "activities", items: kept.length > 0 ? kept : items.slice(0, 1) },
			{ photoFields: photo_fields }
		);
	}

	return {
		async analyze({ text, photos = [], context }) {
			const messages = [{ role: "user" as const, content: buildFusionMessageContent(text, photos) }];

			// Split so the rules and the catalogue — the same ~6,300 tokens on every log
			// anybody makes — are cached, and only the day's own facts are re-read
			// (ports/llm.ts §systemPrefix).
			const routing = buildFusionSystemParts(context);
			const answer = await llm.parseStructured({
				systemPrefix: routing.prefix,
				system: routing.rest,
				schema: FusionRouteOutputSchema,
				schemaName: FUSION_ROUTE_SCHEMA_NAME,
				maxTokens: MAX_TOKENS,
				label: "fusion.route",
				messages,
			});
			const segments = usableSegments(answer.result, answer.more_kinds);

			// All at once: a sentence with three things in it should cost one round trip
			// more than a plain log, not three.
			const parts = dropWeightStatedWithGoal(
				await Promise.all([
					detailFor(answer.result, context, messages).then(async (detail) => ({
						// The routed part's meal fields came off the ROUTING call, which never
						// reaches fillSegment — so the gate runs here too, and its re-ask is
						// the meal detail call the routing path otherwise never makes.
						result: await gateMeal(
							toFusionResult(answer.result, { ...detail, photoFields: answer.photo_fields }),
							context,
							messages
						),
						photos: [] as number[],
					})),
					...segments.map((kind) => fillSegment(kind, context, messages)),
				])
			);

			return {
				results: parts.map((part) => withRefinements(part.result, context)),
				// The first part never claims: it is where an unclaimed photo lands anyway.
				photoParts: photoPartsFrom(parts.slice(1).map((part) => part.photos), photos.length),
			};
		},

		async revise({ results, instruction, context }) {
			const said = instruction.trim();
			const messages = [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: `Change to make: ${said}` }],
				},
			];

			// All at once, like the segments: telling three cards one thing should cost one
			// round trip, not three.
			return Promise.all(
				results.map(async (previous) => {
					const kind = segmentKindFor(previous);
					// A question has nothing in it to revise; it goes back as it came.
					if (!kind) return previous;
					const system = buildRevisionSystemPrompt(context, kind, compactPart(previous), said);
					// An activities part is revised through its own schema, because it is the one
					// kind a correction can RESTRUCTURE: a load that changed partway through the
					// sets is two records or it is nothing (schema.ts §ACTIVITY_REVISION_MODES).
					const result =
						previous.kind === "activities"
							? await reviseActivities(previous, context, messages, system)
							: (await fillSegment(kind, context, messages, system)).result;
					return withRefinements(carryForward(previous, result), context);
				})
			);
		},
	};
}
