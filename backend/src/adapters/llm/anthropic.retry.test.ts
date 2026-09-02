import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Retry policy, without the network. A provider that is BUSY is retried once and only once;
// anything that is our own fault is thrown at once (field report 2026-09-02: an
// `overloaded_error` reached the phone as raw SDK JSON, and the request simply failed).

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = { parse: (...args: unknown[]) => parse(...args) };
	},
}));

const { createAnthropicLlm } = await import("./anthropic.js");

const busy = (status: number) =>
	Object.assign(new Error(`${status} {"type":"error","error":{"type":"overloaded_error"}}`), {
		status,
		request_id: "req_test",
	});

const ok = { parsed_output: { text: "fine" }, stop_reason: "end_turn" };
const schema = z.object({ text: z.string() });

function llm() {
	return createAnthropicLlm({ apiKey: "test", model: "claude-test" });
}

const ask = () =>
	llm().parseStructured({
		schema,
		schemaName: "thing",
		messages: [{ role: "user", content: "hello" }],
	});

beforeEach(() => {
	parse.mockReset();
	vi.useFakeTimers();
});

describe("a provider that is merely busy", () => {
	it("is asked again, once, and the second answer is used", async () => {
		parse.mockRejectedValueOnce(busy(529)).mockResolvedValueOnce(ok);

		const pending = ask();
		await vi.advanceTimersByTimeAsync(2_000);
		await expect(pending).resolves.toEqual({ text: "fine" });
		expect(parse).toHaveBeenCalledTimes(2);
	});

	it("waits before asking again, rather than hammering a struggling provider", async () => {
		parse.mockRejectedValueOnce(busy(529)).mockResolvedValueOnce(ok);
		const pending = ask();

		// Nothing yet: the backoff is real.
		await vi.advanceTimersByTimeAsync(100);
		expect(parse).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(2_000);
		await pending;
		expect(parse).toHaveBeenCalledTimes(2);
	});

	it("retries a 429 the same way — rate limited and overloaded are both 'busy'", async () => {
		parse.mockRejectedValueOnce(busy(429)).mockResolvedValueOnce(ok);
		const pending = ask();
		await vi.advanceTimersByTimeAsync(2_000);
		await expect(pending).resolves.toEqual({ text: "fine" });
	});

	it("gives up after ONE retry, so a real outage still fails fast", async () => {
		parse.mockRejectedValue(busy(529));
		const pending = ask();
		const settled = pending.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(5_000);

		await expect(settled).resolves.toBeInstanceOf(Error);
		// Two calls in total, never three: one retry means one retry.
		expect(parse).toHaveBeenCalledTimes(2);
	});
});

describe("a failure that is our own fault", () => {
	it("is thrown at once, because asking twice only delays the news", async () => {
		const bad = Object.assign(new Error("invalid_request_error"), { status: 400 });
		parse.mockRejectedValue(bad);

		await expect(ask()).rejects.toThrow(/invalid_request_error/);
		expect(parse).toHaveBeenCalledTimes(1);
	});

	it("does not retry an answer that came back unusable — that is a different layer's job", async () => {
		parse.mockResolvedValue({ parsed_output: null, stop_reason: "max_tokens" });
		await expect(ask()).rejects.toThrow(/no structured output/);
		expect(parse).toHaveBeenCalledTimes(1);
	});
});
