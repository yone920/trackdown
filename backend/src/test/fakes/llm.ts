import type { LlmParseRequest, LlmPort } from "../../ports/llm.js";

// The fake every integration test uses instead of a real provider. It still validates
// through the caller's own schema: a fake that returns a shape no real model could produce
// hides bugs rather than finding them.

export interface FakeLlm extends LlmPort {
	/** Handed to the next `parseStructured` call, after the request's schema validates it. */
	nextOutput: unknown;
	/** Every request the code under test made, oldest first. */
	readonly requests: LlmParseRequest<unknown>[];
}

export function createFakeLlm(model = "fake-model"): FakeLlm {
	const requests: LlmParseRequest<unknown>[] = [];
	const fake: FakeLlm = {
		model,
		nextOutput: undefined,
		requests,
		async parseStructured(request) {
			requests.push(request as LlmParseRequest<unknown>);
			return request.schema.parse(fake.nextOutput);
		},
	};
	return fake;
}
