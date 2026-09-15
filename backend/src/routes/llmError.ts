import type { Response } from "express";
import { LLM_MESSAGE, toLlmError, translateAndLog, type LlmErrorCode } from "../services/llmErrors.js";

// How a model failure leaves the building.
//
// One function, used by every route that can hit a provider, so the response shape is
// decided once: **a code and a human line, and nothing else.** No status from the provider,
// no `request_id`, no vendor JSON, no model name — those are logged here and go no further
// (services/llmErrors.ts explains why the set of codes is closed).
//
// The body keeps the app's existing convention — `{ error, code }`, the shape the fusion
// route already used for a busy provider — so an older build that only knows how to print
// `error` still gets a sentence, and a current one maps on `code`.

export function sendLlmError(res: Response, error: unknown, where: string): void {
	// Already translated at the adapter boundary in the normal case; anything that arrives
	// raw (a coach adapter's own throw, a bug in a service) is classified here rather than
	// escaping as prose.
	const translated = res.headersSent ? toLlmError(error, where) : translateAndLog(error, where);
	if (res.headersSent) return;
	res.status(translated.status).json({ error: translated.userMessage, code: translated.code });
}

/** The same body, when a caller has already decided the code. */
export function llmErrorBody(code: LlmErrorCode): { error: string; code: LlmErrorCode } {
	return { error: LLM_MESSAGE[code], code };
}
