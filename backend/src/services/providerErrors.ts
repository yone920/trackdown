// When the model provider is simply busy.
//
// Field report 2026-09-02: a log came back with
// `529 {"type":"error","error":{"type":"overloaded_error",...,"request_id":...}}` printed
// under the input box. Three things were right about that — the typed text survived, the
// failure was not silent, and the user could try again — and one was wrong: it was the
// SDK's own JSON, which is developer talk on a screen belonging to somebody in a gym.
//
// A 529 or a 429 is weather, not a fault. It is retried once at the transport layer and,
// if it persists, said in one human line.

/** Provider is overloaded (529) or rate limiting us (429). Both mean: busy, try shortly. */
export function isOverloadError(error: unknown): boolean {
	const status = (error as { status?: unknown } | null)?.status;
	if (status === 429 || status === 529) return true;
	// The SDK puts the status in the message when it does not put it on the object.
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return /\b(429|529)\b/.test(message) || /overloaded_error|rate_limit_error/.test(message);
}

/**
 * The one line the user sees. No status code, no request id, no JSON — those go to the
 * server log, where somebody who wants them can find them.
 */
export const OVERLOADED_MESSAGE = "The reader is busy right now — try again in a few seconds.";

/** The machine-readable half, so the app maps on a code rather than on prose. */
export const OVERLOADED_CODE = "provider_overloaded";
