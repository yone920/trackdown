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
	messages: LlmMessage[];
	schema: z.ZodType<Output>;
	/**
	 * Model-visible name for the schema (snake_case). OpenAI's structured outputs require
	 * one; Anthropic derives its own, so the adapter there ignores it.
	 */
	schemaName: string;
	/** @default 1024 */
	maxTokens?: number;
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
