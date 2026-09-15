import type { LlmPort } from "../../ports/llm.js";
import { translateAndLog } from "../../services/llmErrors.js";

// The line every model call leaves through.
//
// One decorator around whatever `createLlm` built, applied in `container.ts`, so there is
// exactly ONE place where a provider's own failure becomes an application failure. Not in
// each adapter: two adapters means two chances to forget, and the SDKs throw different
// shapes for the same trouble — which is the fault the first fix had, when 529 was
// humanised by name and the 400 that came after it was not (services/llmErrors.ts).
//
// After this wrapper, nothing above it has ever seen an `APIError`. Services, the coach
// adapter, routes and tests all deal in `LlmError` — a code, a human line, and the
// provider's account of it filed under `detail` where only the log reads it.
//
// It deliberately does NOT retry. The transport adapter beneath owns the one retry for a
// busy provider (adapters/llm/anthropic.ts) and the coach adapter above owns the one for a
// malformed answer; a third layer that also tried again would multiply both.

export function withErrorPolicy(port: LlmPort, provider: string): LlmPort {
	return {
		model: port.model,
		async parseStructured(request) {
			try {
				return await port.parseStructured(request);
			} catch (error) {
				// `label` is the call shape ("fusion.route", "coach.brief"); the schema name
				// stands in for a call that did not name itself. The model is named in the
				// log line and nowhere else — it is a fact about our configuration, not
				// something a user needs, and it is exactly the kind of detail that used to
				// end up on a phone.
				const where = `${provider}.${request.label ?? request.schemaName} (${port.model})`;
				throw translateAndLog(error, where);
			}
		},
	};
}
