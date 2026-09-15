import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LlmPort } from "../../ports/llm.js";
import { LlmError } from "../../services/llmErrors.js";
import { withErrorPolicy } from "./policy.js";

// The line itself: whatever the provider threw, what comes out is an LlmError — and only
// one call goes out, because the retries live in the layers either side of this one.

const SCHEMA = z.object({ ok: z.boolean() });

function portThatThrows(error: unknown): { port: LlmPort; calls: () => number } {
	const parseStructured = vi.fn(async () => {
		throw error;
	});
	return {
		port: { model: "test-model", parseStructured } as unknown as LlmPort,
		calls: () => parseStructured.mock.calls.length,
	};
}

const ask = (port: LlmPort) =>
	port.parseStructured({ messages: [{ role: "user", content: "hi" }], schema: SCHEMA, schemaName: "answer", label: "fusion.analyze" });

describe("the error policy at the adapter boundary", () => {
	it("passes a good answer straight through", async () => {
		const port: LlmPort = {
			model: "test-model",
			parseStructured: async () => ({ ok: true }) as never,
		};
		await expect(ask(withErrorPolicy(port, "anthropic"))).resolves.toEqual({ ok: true });
	});

	it("turns the provider's own error into a code, and keeps its account for the log", async () => {
		const raw = Object.assign(
			new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}'),
			{ status: 400, request_id: "req_abc" }
		);
		const { port } = portThatThrows(raw);
		const wrapped = withErrorPolicy(port, "anthropic");

		const failure = await ask(wrapped).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(LlmError);
		const llmError = failure as LlmError;
		expect(llmError.code).toBe("reader_unavailable");
		expect(llmError.userMessage).toBe("The reader is down right now. Your words are kept — try again in a bit.");
		// The call is named for the log, model included — and none of it is in what a user sees.
		expect(llmError.detail).toContain("anthropic.fusion.analyze");
		expect(llmError.detail).toContain("test-model");
		expect(llmError.userMessage).not.toMatch(/test-model|anthropic|400|req_abc/);
		expect(llmError.cause).toBe(raw);
	});

	it("classifies a busy provider and an unusable answer differently", async () => {
		const busy = withErrorPolicy(portThatThrows(Object.assign(new Error("529 overloaded_error"), { status: 529 })).port, "anthropic");
		await expect(ask(busy)).rejects.toMatchObject({ code: "provider_overloaded", status: 503 });

		const unusable = withErrorPolicy(
			portThatThrows(new Error("test-model returned no structured output (stop reason: max_tokens).")).port,
			"anthropic"
		);
		await expect(ask(unusable)).rejects.toMatchObject({ code: "reader_failed", status: 502 });
	});

	it("names a call that did not name itself by its schema", async () => {
		const { port } = portThatThrows(new Error("boom"));
		const wrapped = withErrorPolicy(port, "openai");
		const failure = (await wrapped
			.parseStructured({ messages: [], schema: SCHEMA, schemaName: "day_reading" })
			.catch((error: unknown) => error)) as LlmError;
		expect(failure.detail).toContain("openai.day_reading");
	});

	// Retry policy is single-layer, and this layer is not the one (adapters/llm/anthropic.ts
	// retries a busy provider once; adapters/coach/llm.ts retries an unusable answer once).
	it("never retries — it translates and gets out of the way", async () => {
		const { port, calls } = portThatThrows(Object.assign(new Error("529"), { status: 529 }));
		await ask(withErrorPolicy(port, "anthropic")).catch(() => undefined);
		expect(calls()).toBe(1);
	});
});
