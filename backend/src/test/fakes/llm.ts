import type { LlmParseRequest, LlmPort } from "../../ports/llm.js";

// The fake every integration test uses instead of a real provider. It still validates
// through the caller's own schema: a fake that returns a shape no real model could produce
// hides bugs rather than finding them.

export interface FakeLlm extends LlmPort {
	/** Handed to the next `parseStructured` call, after the request's schema validates it. */
	nextOutput: unknown;
	/**
	 * Answers for a sequence of calls, consumed oldest first, falling back to
	 * `nextOutput` when empty. Needed by anything that makes more than one call for one
	 * user action — the fusion analyzer's goal path asks twice.
	 */
	readonly outputs: unknown[];
	/** Every request the code under test made, oldest first. */
	readonly requests: LlmParseRequest<unknown>[];
}

export function createFakeLlm(model = "fake-model"): FakeLlm {
	const requests: LlmParseRequest<unknown>[] = [];
	const outputs: unknown[] = [];
	const fake: FakeLlm = {
		model,
		nextOutput: undefined,
		outputs,
		requests,
		async parseStructured(request) {
			requests.push(request as LlmParseRequest<unknown>);
			return request.schema.parse(outputs.length > 0 ? outputs.shift() : fake.nextOutput);
		},
	};
	return fake;
}
