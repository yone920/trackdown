import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInput } from "openai/resources/responses/responses";
import type { LlmMessage, LlmPort } from "../../ports/llm.js";

// OpenAI behind the same LlmPort. This adapter exists mostly to keep the port honest: if a
// second provider drops in without changing a service, the abstraction is real. `responses.parse`
// + `zodTextFormat` is OpenAI's structured-output path, the mirror of Claude's `messages.parse`.

export interface OpenAiLlmOptions {
	apiKey: string;
	model: string;
	baseUrl?: string | undefined;
}

function toInputItem(message: LlmMessage): ResponseInput[number] {
	if (typeof message.content === "string") {
		return { role: message.role, content: message.content };
	}
	if (message.role === "assistant") {
		// Assistant turns are context we wrote ourselves and never carry images; the
		// Responses API wants plain text back for them.
		const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
		return { role: "assistant", content: text };
	}
	return {
		role: "user",
		content: message.content.map((part) =>
			part.type === "text"
				? { type: "input_text" as const, text: part.text }
				: {
						type: "input_image" as const,
						detail: "auto" as const,
						image_url: `data:${part.mediaType};base64,${part.base64}`,
					}
		),
	};
}

export function createOpenAiLlm({ apiKey, model, baseUrl }: OpenAiLlmOptions): LlmPort {
	const client = new OpenAI({ apiKey, ...(baseUrl === undefined ? {} : { baseURL: baseUrl }) });

	return {
		model,
		async parseStructured({ system, messages, schema, schemaName, maxTokens = 1024 }) {
			const response = await client.responses.parse({
				model,
				...(system === undefined ? {} : { instructions: system }),
				input: messages.map(toInputItem),
				max_output_tokens: maxTokens,
				text: { format: zodTextFormat(schema, schemaName) },
			});
			if (response.output_parsed == null) {
				throw new Error(`${model} returned no structured output (status: ${response.status ?? "unknown"}).`);
			}
			return response.output_parsed;
		},
	};
}
