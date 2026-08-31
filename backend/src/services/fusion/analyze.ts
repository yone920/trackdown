import type { ImageMediaType, LlmContent, LlmPort } from "../../ports/llm.js";
import type { FusionContext } from "./context.js";
import {
	buildFusionSystemPrompt,
	buildGoalDetailSystemPrompt,
	buildPartDetailSystemPrompt,
	buildPlanFieldsSystemPrompt,
} from "./prompt.js";
import {
	ACTIVITIES_DETAIL_SCHEMA_NAME,
	ActivitiesDetailOutputSchema,
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

export interface FusionAnalyzer {
	analyze(input: AnalyzeInput): Promise<FusionAnalysis>;
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

export function createFusionAnalyzer(llm: LlmPort): FusionAnalyzer {
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

	/** One segment kind → the public result it stands for, from its own focused call. */
	async function fillSegment(
		kind: SegmentKind,
		context: FusionContext,
		messages: { role: "user"; content: LlmContent[] }[]
	): Promise<{ result: FusionResult; photos: number[] }> {
		const system = buildPartDetailSystemPrompt(context, kind);
		const ask = <Output>(schema: Parameters<typeof llm.parseStructured<Output>>[0]["schema"], schemaName: string) =>
			llm.parseStructured({ system, schema, schemaName, maxTokens: DETAIL_MAX_TOKENS, messages });

		switch (kind) {
			case "activities": {
				const { items, photo_indexes } = await ask(ActivitiesDetailOutputSchema, ACTIVITIES_DETAIL_SCHEMA_NAME);
				return { result: toFusionResult({ kind: "activities", items }), photos: photo_indexes };
			}
			case "meal": {
				const { photo_indexes, ...meal } = await ask(MealDetailOutputSchema, MEAL_DETAIL_SCHEMA_NAME);
				return { result: toFusionResult({ kind: "meal", ...meal }), photos: photo_indexes };
			}
			case "weight": {
				const { photo_indexes, ...weight } = await ask(WeightDetailOutputSchema, WEIGHT_DETAIL_SCHEMA_NAME);
				return { result: toFusionResult({ kind: "weight", ...weight }), photos: photo_indexes };
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

	return {
		async analyze({ text, photos = [], context }) {
			const messages = [{ role: "user" as const, content: buildFusionMessageContent(text, photos) }];

			const answer = await llm.parseStructured({
				system: buildFusionSystemPrompt(context),
				schema: FusionRouteOutputSchema,
				schemaName: FUSION_ROUTE_SCHEMA_NAME,
				maxTokens: MAX_TOKENS,
				messages,
			});
			const segments = usableSegments(answer.result, answer.more_kinds);

			// All at once: a sentence with three things in it should cost one round trip
			// more than a plain log, not three.
			const parts = dropWeightStatedWithGoal(
				await Promise.all([
					detailFor(answer.result, context, messages).then((detail) => ({
						result: toFusionResult(answer.result, detail),
						photos: [] as number[],
					})),
					...segments.map((kind) => fillSegment(kind, context, messages)),
				])
			);

			return {
				results: parts.map((part) => part.result),
				// The first part never claims: it is where an unclaimed photo lands anyway.
				photoParts: photoPartsFrom(parts.slice(1).map((part) => part.photos), photos.length),
			};
		},
	};
}
