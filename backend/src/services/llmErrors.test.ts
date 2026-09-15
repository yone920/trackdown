import { describe, expect, it } from "vitest";
import {
	classifyProviderError,
	describeProviderError,
	isOverloadError,
	LLM_MESSAGE,
	LLM_STATUS,
	LlmError,
	toLlmError,
} from "./llmErrors.js";

// The policy, held to its one promise: **every** provider failure becomes one of three
// codes and one of three sentences, and nothing the provider said comes with it.
//
// The fixtures are the SDK's real shapes, taken from the two field reports — the 529 that
// was printed under the input box on 2026-09-02 and the credit-balance 400 that was
// printed the day after, once the 529 had been humanised by name. The second one is why
// this file tests the DEFAULT as hard as it tests the known cases: the next failure will be
// a status nobody here has thought of.

/** How the Anthropic SDK throws: the status on the object, the JSON in the message. */
function apiError(status: number, body: unknown, requestId = "req_011CeewngNS13kwW7m9XwGy5"): Error {
	return Object.assign(new Error(`${status} ${JSON.stringify(body)}`), { status, request_id: requestId });
}

const CREDIT_400 = apiError(400, {
	type: "error",
	error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." },
});

const OVERLOADED_529 = apiError(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });

describe("classifying what a provider threw", () => {
	it("calls a 429 and a 529 busy — the same request will probably work in a moment", () => {
		expect(classifyProviderError(OVERLOADED_529)).toBe("provider_overloaded");
		expect(classifyProviderError(apiError(429, { type: "error", error: { type: "rate_limit_error" } }))).toBe(
			"provider_overloaded"
		);
		// The status is not always on the object; the SDK sometimes only puts it in the text.
		expect(classifyProviderError(new Error('529 {"type":"error","error":{"type":"overloaded_error"}}'))).toBe(
			"provider_overloaded"
		);
	});

	// The failure this work package exists for. A 400 normally means "your request was
	// wrong"; this one means "your card is". It is not the user's input, and it is not
	// going to fix itself in five seconds.
	it("calls an exhausted credit balance unavailable, not a bad request", () => {
		expect(classifyProviderError(CREDIT_400)).toBe("reader_unavailable");
	});

	it("calls auth, permission and payment failures unavailable", () => {
		expect(classifyProviderError(apiError(401, { error: { type: "authentication_error" } }))).toBe("reader_unavailable");
		expect(classifyProviderError(apiError(403, { error: { type: "permission_error" } }))).toBe("reader_unavailable");
		expect(classifyProviderError(apiError(402, { error: { type: "billing_error" } }))).toBe("reader_unavailable");
		// OpenAI files the same trouble under a different status and a different word.
		expect(classifyProviderError(apiError(429, { error: { type: "insufficient_quota" } }))).toBe(
			"provider_overloaded"
		);
		expect(classifyProviderError(new Error("insufficient_quota: You exceeded your current quota"))).toBe(
			"reader_unavailable"
		);
	});

	it("calls a missing key unavailable — the same trouble, found earlier", () => {
		expect(classifyProviderError(new Error("ANTHROPIC_API_KEY is not set — AI features are unavailable."))).toBe(
			"reader_unavailable"
		);
	});

	it("calls a network that never reached the provider unavailable", () => {
		expect(classifyProviderError(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }))).toBe(
			"reader_unavailable"
		);
		expect(classifyProviderError(new Error("getaddrinfo ENOTFOUND api.anthropic.com"))).toBe("reader_unavailable");
	});

	it("calls an answer we could not use a failure", () => {
		expect(classifyProviderError(new Error("claude-haiku-4-5 returned no structured output (stop reason: max_tokens)."))).toBe(
			"reader_failed"
		);
		expect(classifyProviderError(apiError(500, { error: { type: "api_error" } }))).toBe("reader_failed");
		expect(classifyProviderError(apiError(400, { error: { type: "invalid_request_error", message: "max_tokens: must be > 0" } }))).toBe(
			"reader_failed"
		);
	});

	// The whole point of a total function: the failure nobody has seen yet still lands
	// somewhere, and lands somewhere safe.
	it("has a default, and the default blames nobody", () => {
		expect(classifyProviderError(new Error("something nobody has seen before"))).toBe("reader_failed");
		expect(classifyProviderError("a string")).toBe("reader_failed");
		expect(classifyProviderError(null)).toBe("reader_failed");
		expect(classifyProviderError({ weird: true })).toBe("reader_failed");
		expect(classifyProviderError(undefined)).toBe("reader_failed");
	});
});

describe("what the user is told", () => {
	it("is one human sentence per code, with no machine in it", () => {
		for (const [code, message] of Object.entries(LLM_MESSAGE)) {
			expect(message, code).not.toMatch(/\d{3}|request_id|req_|\{|\}|"|http|anthropic|openai|claude|gpt/i);
			expect(message.length, code).toBeLessThan(120);
		}
	});

	it("says the three different things a person can act on differently", () => {
		expect(LLM_MESSAGE.provider_overloaded).toBe("The reader is busy right now — try again in a few seconds.");
		expect(LLM_MESSAGE.reader_unavailable).toBe("The reader is down right now. Your words are kept — try again in a bit.");
		expect(LLM_MESSAGE.reader_failed).toBe("That didn't get read. Nothing was lost — try again.");
	});

	it("answers 503 for come-back-later and 502 for an unusable answer", () => {
		expect(LLM_STATUS.provider_overloaded).toBe(503);
		expect(LLM_STATUS.reader_unavailable).toBe(503);
		expect(LLM_STATUS.reader_failed).toBe(502);
	});
});

describe("the translated error", () => {
	it("keeps the provider's account for the log and out of the user's line", () => {
		const translated = toLlmError(CREDIT_400, "fusion.analyze");
		expect(translated).toBeInstanceOf(LlmError);
		expect(translated.code).toBe("reader_unavailable");
		expect(translated.status).toBe(503);
		expect(translated.userMessage).toBe(LLM_MESSAGE.reader_unavailable);
		// The detail — for the log — has the whole truth in it.
		expect(translated.detail).toContain("fusion.analyze");
		expect(translated.detail).toContain("status=400");
		expect(translated.detail).toContain("request_id=req_011CeewngNS13kwW7m9XwGy5");
		expect(translated.detail).toContain("credit balance is too low");
		// And the user's half has none of it.
		expect(translated.userMessage).not.toMatch(/400|req_|credit/);
	});

	it("does not re-classify something already through the policy", () => {
		const once = toLlmError(OVERLOADED_529, "coach.brief");
		expect(toLlmError(once, "somewhere.else")).toBe(once);
	});

	it("describes a failure for the log with the status, the type and the id", () => {
		const line = describeProviderError(CREDIT_400);
		expect(line).toContain("status=400");
		expect(line).toContain("type=invalid_request_error");
		expect(line).toContain("request_id=req_011CeewngNS13kwW7m9XwGy5");
		// One line: a log entry that wraps is a log entry nobody greps.
		expect(line).not.toContain("\n");
	});
});

describe("the retry question", () => {
	it("is asked of the code, not of the prose, once a failure has been translated", () => {
		expect(isOverloadError(toLlmError(OVERLOADED_529, "x"))).toBe(true);
		expect(isOverloadError(toLlmError(CREDIT_400, "x"))).toBe(false);
		// A busy provider is worth another go; an empty account is not.
		expect(isOverloadError(OVERLOADED_529)).toBe(true);
		expect(isOverloadError(CREDIT_400)).toBe(false);
	});
});
