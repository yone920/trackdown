// What the user is told when the reader fails, and what the log is told instead.
//
// **The policy, in one place.** Field report 2026-09-02, twice in two days: first a 529
// arrived on the phone as `529 {"type":"error","error":{"type":"overloaded_error",…,
// "request_id":…}}` under the input box, and then — after that one status was humanised —
// a 400 arrived as `{"type":"error","error":{"type":"invalid_request_error","message":
// "Your credit balance is too low…"},"request_id":…}`. The second one is the lesson: a fix
// that names ONE status is a fix that waits for the next status. So this is not a list of
// known errors, it is a **closed set of outcomes with a total function into it** — every
// throw from a provider, known or not, becomes one of three codes, and the default is the
// safe one.
//
// The split, and why it is these three:
//
//   · `provider_overloaded` — busy. 429 or 529, already retried once at the transport
//     layer. Weather: the same request will probably work in a moment.
//   · `reader_unavailable` — the service cannot serve us at all right now, through no
//     fault of the user's input: credit exhausted, a bad or missing key, a workspace
//     misconfiguration, the network. Trying again in a second will not help; trying later
//     might. The user's words are kept either way.
//   · `reader_failed` — we asked and got something we could not use: a malformed answer,
//     no structured output, an unexpected 4xx or 5xx. This is the default for anything
//     unrecognised, because "that didn't get read" is true of every failure and blames
//     nobody.
//
// **Nothing provider-shaped crosses this line.** No status code, no `request_id`, no
// vendor prose, no model name, in any response body on any route. Those go to the server
// log at error level, in the structured style `middleware/timing.ts` uses, where somebody
// debugging can find them and nobody in a gym has to read them.

/** The closed set. Every provider failure is exactly one of these. */
export type LlmErrorCode = "provider_overloaded" | "reader_unavailable" | "reader_failed";

/**
 * The human line per code — the server's copy of what the app says.
 *
 * The app renders from its own table (`lib/errors.ts`) so that a phone offline from a new
 * server still speaks English, and these are sent alongside the code so that an older app,
 * or any client that only knows how to print `error`, is still given a sentence rather than
 * a symbol. Both tables say the same thing and a test holds them to it.
 */
export const LLM_MESSAGE: Record<LlmErrorCode, string> = {
	provider_overloaded: "The reader is busy right now — try again in a few seconds.",
	reader_unavailable: "The reader is down right now. Your words are kept — try again in a bit.",
	reader_failed: "That didn't get read. Nothing was lost — try again.",
};

/**
 * The HTTP status per code. `503` for the two "come back later" cases — it is the status
 * that means exactly that, and an older app build keys its retry copy off it. `502` for a
 * reader that answered with something unusable: we did reach it, and the trouble is between
 * us and it.
 */
export const LLM_STATUS: Record<LlmErrorCode, number> = {
	provider_overloaded: 503,
	reader_unavailable: 503,
	reader_failed: 502,
};

/**
 * A failure that has already been through the policy. Carries the code and the human line
 * for the response, and keeps the original throw as `cause` for the log — the two halves
 * are deliberately different objects so that a careless `String(error)` in a route body
 * cannot print the provider's prose.
 */
export class LlmError extends Error {
	readonly code: LlmErrorCode;
	readonly status: number;
	/** What a person is told. Never contains a status, an id, or a model name. */
	readonly userMessage: string;
	/** The provider's own account of it, for the log only. */
	readonly detail: string;

	constructor(code: LlmErrorCode, detail: string, options?: { cause?: unknown }) {
		// The Error's own message is the loggable one: an uncaught LlmError in a stack trace
		// should say what actually happened, and stack traces are not sent anywhere.
		super(`${code}: ${detail}`, options as ErrorOptions);
		this.name = "LlmError";
		this.code = code;
		this.status = LLM_STATUS[code];
		this.userMessage = LLM_MESSAGE[code];
		this.detail = detail;
	}
}

export function isLlmError(error: unknown): error is LlmError {
	return error instanceof LlmError;
}

/** Provider is overloaded (529) or rate limiting us (429). Both mean: busy, try shortly. */
export function isOverloadError(error: unknown): boolean {
	if (isLlmError(error)) return error.code === "provider_overloaded";
	const status = statusOf(error);
	if (status === 429 || status === 529) return true;
	// The SDK puts the status in the message when it does not put it on the object.
	const message = messageOf(error);
	return /\b(429|529)\b/.test(message) || /overloaded_error|rate_limit_error/.test(message);
}

/**
 * Signs that the provider cannot serve this key at all right now. Matched on the message as
 * well as the status because the SDKs are not consistent about which they set, and because
 * the informative half of a billing failure is the sentence, not the 400 it arrives under —
 * "Your credit balance is too low" is a 400 from Anthropic and a 429 `insufficient_quota`
 * from OpenAI, and neither of those statuses means what it usually means.
 */
const UNAVAILABLE_PATTERNS =
	/credit balance|insufficient[_ ]quota|billing|payment|quota exceeded|authentication|invalid[_ ]api[_ ]key|invalid x-api-key|permission[_ ]error|unauthorized|not[_ ]?configured|no api key|_API_KEY\b|api[_ ]key is not set|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Connection error/i;

/** Statuses that always mean "not your input — the door is shut": auth, payment, forbidden. */
const UNAVAILABLE_STATUSES = new Set([401, 402, 403]);

/**
 * The total function: any throw in, exactly one code out.
 *
 * Order matters. Busy is checked first because a 429 can also carry a quota message and
 * "try again in a few seconds" is the better answer when the provider is merely rate
 * limiting; then the door-shut cases; then everything else, which is `reader_failed` — the
 * default, and the one that is safe to be wrong about.
 */
export function classifyProviderError(error: unknown): LlmErrorCode {
	if (isLlmError(error)) return error.code;
	if (isOverloadError(error)) return "provider_overloaded";

	const status = statusOf(error);
	const message = messageOf(error);
	if (status !== undefined && UNAVAILABLE_STATUSES.has(status)) return "reader_unavailable";
	if (UNAVAILABLE_PATTERNS.test(message)) return "reader_unavailable";
	return "reader_failed";
}

/**
 * The provider's account of a failure, flattened onto one line for the log: status, error
 * type, request id and the message, as much of each as there is. This is the ONLY place
 * provider text is allowed to be assembled, and its output goes to `console.error` and
 * never into a response.
 */
export function describeProviderError(error: unknown): string {
	const status = statusOf(error);
	const requestId = fieldOf(error, "request_id") ?? fieldOf(error, "requestID");
	const type = nestedErrorType(error);
	const message = messageOf(error).replace(/\s+/g, " ").trim().slice(0, 400);
	return [
		status === undefined ? null : `status=${status}`,
		type === undefined ? null : `type=${type}`,
		requestId === undefined ? null : `request_id=${requestId}`,
		message === "" ? null : `message=${message}`,
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * Put a throw through the policy. Already-classified errors pass through unchanged — the
 * layer that classified it was closer to the provider and knew more than this one does.
 *
 * `where` names the call for the log ("fusion.route", "coach.brief"), the way `label` names
 * it for the cache report.
 */
export function toLlmError(error: unknown, where: string): LlmError {
	if (isLlmError(error)) return error;
	const code = classifyProviderError(error);
	return new LlmError(code, `${where} · ${describeProviderError(error)}`, { cause: error });
}

/**
 * Classify, log the whole truth, and hand back the sanitised error. One call, so that no
 * site has to remember to do both — a failure that is translated but not logged is a
 * failure nobody can debug, and one that is logged but not translated is what the field
 * reports were about.
 */
export function translateAndLog(error: unknown, where: string): LlmError {
	const translated = toLlmError(error, where);
	console.error(`❌ llm ${where}: code=${translated.code} · ${describeProviderError(error)}`);
	return translated;
}

// ── reading the shapes the SDKs actually throw ───────────────────────────────────────

function statusOf(error: unknown): number | undefined {
	const status = fieldOf(error, "status") ?? fieldOf(error, "statusCode");
	const asNumber = typeof status === "string" ? Number(status) : status;
	return typeof asNumber === "number" && Number.isFinite(asNumber) ? asNumber : undefined;
}

function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	const message = fieldOf(error, "message");
	return typeof message === "string" ? message : "";
}

/** `{"type":"error","error":{"type":"invalid_request_error",…}}`, as the SDKs nest it. */
function nestedErrorType(error: unknown): string | undefined {
	const nested = (error as { error?: { type?: unknown } } | null)?.error;
	const type = nested && typeof nested === "object" ? (nested as { type?: unknown }).type : undefined;
	if (typeof type === "string") return type;
	// Not on the object: read it out of the JSON the SDK put in the message.
	const match = /"type"\s*:\s*"([a-z_]+_error)"/.exec(messageOf(error));
	return match?.[1];
}

function fieldOf(error: unknown, key: string): string | number | undefined {
	if (error === null || typeof error !== "object") return undefined;
	const value = (error as Record<string, unknown>)[key];
	return typeof value === "string" || typeof value === "number" ? value : undefined;
}
