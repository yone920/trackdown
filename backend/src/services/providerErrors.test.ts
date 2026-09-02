import { describe, expect, it } from "vitest";
import { isOverloadError, OVERLOADED_CODE, OVERLOADED_MESSAGE } from "./providerErrors.js";

// A provider that is busy is weather, not a fault (field report 2026-09-02: a log came back
// showing `529 {"type":"error",...,"request_id":...}` under the input box).

describe("isOverloadError", () => {
	it("knows the two statuses that mean busy", () => {
		expect(isOverloadError(Object.assign(new Error("boom"), { status: 529 }))).toBe(true);
		expect(isOverloadError(Object.assign(new Error("boom"), { status: 429 }))).toBe(true);
	});

	it("reads the status out of the message when the SDK puts it there", () => {
		// Which is exactly the shape the user saw on screen.
		expect(
			isOverloadError(
				new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
			),
		).toBe(true);
		expect(isOverloadError(new Error('{"type":"rate_limit_error"}'))).toBe(true);
	});

	it("is false for the failures that are OUR fault, which must not be retried", () => {
		// A 400 is a bug and a 401 is a configuration problem. Asking either twice is just
		// waiting longer to find out.
		expect(isOverloadError(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
		expect(isOverloadError(Object.assign(new Error("unauthorized"), { status: 401 }))).toBe(false);
		expect(isOverloadError(new Error("returned no structured output"))).toBe(false);
		expect(isOverloadError(null)).toBe(false);
		expect(isOverloadError(undefined)).toBe(false);
	});
});

describe("what the user is told", () => {
	it("is one human line, with no status, request id or JSON in it", () => {
		expect(OVERLOADED_MESSAGE).toBe("The reader is busy right now — try again in a few seconds.");
		expect(OVERLOADED_MESSAGE).not.toMatch(/529|429|request_id|\{|\}/);
	});

	it("carries a code, so the app maps on that rather than on prose", () => {
		expect(OVERLOADED_CODE).toBe("provider_overloaded");
	});
});
