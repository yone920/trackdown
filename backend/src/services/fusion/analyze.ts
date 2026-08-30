import type { ImageMediaType, LlmContent, LlmPort } from "../../ports/llm.js";
import type { FusionContext } from "./context.js";
import {
	buildFusionSystemPrompt,
	buildGoalDetailSystemPrompt,
	buildPlanFieldsSystemPrompt,
} from "./prompt.js";
import {
	FUSION_ROUTE_SCHEMA_NAME,
	FusionRouteOutputSchema,
	GOAL_DETAIL_SCHEMA_NAME,
	GoalDetailOutputSchema,
	PLAN_FIELDS_SCHEMA_NAME,
	PlanFieldsOutputSchema,
	toFusionResult,
	type FusionResult,
} from "./schema.js";

// One log → one call. The photos, the transcript and the typed note go up together,
// because a machine photo and "three sets of ten, forty kilos" are one fact between them
// and two calls would have to guess how to join them back up.
//
// The exception is the two plan-shaped kinds. Anthropic refuses to compile a decoding
// grammar for the full eight-branch union (see the note in schema.ts), so the router
// returns a goal as a title and a constraint/preference as its text, and a second focused
// call fills in the spec or the plan fields. That keeps the hot path — logging a workout
// or a meal — at one call, and pays the extra round trip only on the once-a-month
// occasion when someone tells the app about their plan.

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

export interface FusionAnalyzer {
	analyze(input: AnalyzeInput): Promise<FusionResult>;
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

export function createFusionAnalyzer(llm: LlmPort): FusionAnalyzer {
	return {
		async analyze({ text, photos = [], context }) {
			const messages = [{ role: "user" as const, content: buildFusionMessageContent(text, photos) }];

			const { result: route } = await llm.parseStructured({
				system: buildFusionSystemPrompt(context),
				schema: FusionRouteOutputSchema,
				schemaName: FUSION_ROUTE_SCHEMA_NAME,
				maxTokens: MAX_TOKENS,
				messages,
			});
			if (route.kind === "goal") {
				const goal = await llm.parseStructured({
					system: buildGoalDetailSystemPrompt(context, route.title),
					schema: GoalDetailOutputSchema,
					schemaName: GOAL_DETAIL_SCHEMA_NAME,
					maxTokens: DETAIL_MAX_TOKENS,
					messages,
				});
				return toFusionResult(route, { goal });
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
				return toFusionResult(route, { fields });
			}

			return toFusionResult(route);
		},
	};
}
