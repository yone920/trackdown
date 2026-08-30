import type { LlmPort } from "../../ports/llm.js";

// The adapter for "no API key". Every other endpoint — sign-in, manual logging, the day
// views — works without one, so a missing key must not stop the server from booting; it
// must fail loudly at the one call that needed it. Configured in container.ts.

export function createUnavailableLlm(model: string, reason: string): LlmPort {
	return {
		model,
		async parseStructured() {
			throw new Error(reason);
		},
	};
}
