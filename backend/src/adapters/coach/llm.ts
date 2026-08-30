import type { Brief, CoachBriefInputs, CoachPort } from "../../ports/coach.js";
import type { LlmPort } from "../../ports/llm.js";
import { buildCoachPrompt } from "../../services/coach/prompt.js";
import { COACH_BRIEF_SCHEMA_NAME, CoachBriefSchema } from "../../services/coach/schema.js";

// The default CoachPort: one structured call on whichever model LlmPort was built with
// (COACH_LLM_PROVIDER / LLM_MODEL_COACH — Sonnet by default, per docs/build-plan.md).
//
// It is an adapter and not a service because it is the *composition* — the port, the
// prompt and the schema wired together. Swapping the whole coach (a rules-only version, a
// hosted one) is a different implementation of CoachPort and touches nothing else. No SDK
// is imported here: the provider still arrives as an LlmPort from container.ts.

/**
 * A brief is a page of prose plus a list of exercises. 1,200 tokens is roughly three times
 * the longest answer the schema allows, which is the room a model needs to not be cut off
 * mid-object — and a truncated structured output is an exception, not a short brief.
 */
const MAX_TOKENS = 1200;

export function createLlmCoach(llm: LlmPort): CoachPort {
	return {
		model: llm.model,
		async brief(inputs: CoachBriefInputs): Promise<Brief> {
			return llm.parseStructured({
				system: buildCoachPrompt(inputs),
				schema: CoachBriefSchema,
				schemaName: COACH_BRIEF_SCHEMA_NAME,
				maxTokens: MAX_TOKENS,
				messages: [
					{
						role: "user",
						content: "What should I do today? Answer from the facts above, and copy the prescribed numbers exactly.",
					},
				],
			});
		},
	};
}
