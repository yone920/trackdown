import type { z } from "zod";

// The one LLM interface the rest of the backend sees. Services own the prompt and the zod
// schema (provider-neutral); an adapter owns the SDK call and returns parsed output. Swapping
// providers is `LLM_PROVIDER=openai` and nothing else.
//
// Messages carry text *and* images because that is what WP2's fusion pipeline sends: a photo
// of a machine plus "three sets of ten, forty kilos" is one call, not two. Only text is used
// today; the shape is here so WP2 adds photos without touching this file.

/** What the app can produce: expo-image-manipulator downscales to JPEG or PNG. */
export type ImageMediaType = "image/jpeg" | "image/png";

export type LlmContent =
	| { type: "text"; text: string }
	/** Raw base64 — no data: prefix, no line breaks. Each adapter wraps it as its API wants. */
	| { type: "image"; mediaType: ImageMediaType; base64: string };

export interface LlmMessage {
	role: "user" | "assistant";
	/** A bare string is shorthand for one text part. */
	content: string | LlmContent[];
}

export interface LlmParseRequest<Output> {
	/** System prompt. Kept out of `messages` because both providers pass it separately. */
	system?: string;
	/**
	 * The leading part of the system prompt that is IDENTICAL from request to request —
	 * instructions and reference data, with nothing about this user, this day or this clock
	 * in it. Rendered ahead of `system`; the two concatenated are the whole prompt.
	 *
	 * Provider-neutral on purpose: "this prefix is stable" is a fact about the prompt, not
	 * about a vendor. A provider that can exploit it (Anthropic caches it) does; one that
	 * cannot simply concatenates, and the request is byte-identical to what it was before.
	 *
	 * The contract a caller must keep: **nothing volatile may appear in here.** A date, a
	 * name or a count in the prefix does not fail — it silently makes every request a cache
	 * miss, which is the expensive kind of wrong (services/fusion/prompt.ts keeps the split).
	 */
	systemPrefix?: string;
	messages: LlmMessage[];
	schema: z.ZodType<Output>;
	/**
	 * Model-visible name for the schema (snake_case). OpenAI's structured outputs require
	 * one; Anthropic derives its own, so the adapter there ignores it.
	 */
	schemaName: string;
	/** @default 1024 */
	maxTokens?: number;
	/** Names this call shape in the cache log ("fusion.route", "coach.brief"). */
	label?: string;
}

export interface LlmPort {
	/** Which model this instance calls — for logs and error messages. */
	readonly model: string;
	/**
	 * One call, structured output. Throws if the model returned nothing parseable, so a
	 * caller never has to handle a half-empty result.
	 */
	parseStructured<Output>(request: LlmParseRequest<Output>): Promise<Output>;
}
