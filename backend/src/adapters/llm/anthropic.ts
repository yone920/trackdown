import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LlmMessage, LlmPort } from "../../ports/llm.js";

// Claude behind LlmPort. `messages.parse` + `zodOutputFormat` is the SDK's structured-output
// path: the schema goes out as the output format and comes back already parsed.

export interface AnthropicLlmOptions {
	apiKey: string;
	model: string;
	/**
	 * Identity-linked API keys must name the workspace on every request
	 * (`anthropic-workspace-id`); legacy keys leave this unset.
	 */
	workspaceId?: string | undefined;
}

function toMessageParam(message: LlmMessage): MessageParam {
	if (typeof message.content === "string") {
		return { role: message.role, content: message.content };
	}
	return {
		role: message.role,
		content: message.content.map((part) =>
			part.type === "text"
				? { type: "text" as const, text: part.text }
				: {
						type: "image" as const,
						source: { type: "base64" as const, media_type: part.mediaType, data: part.base64 },
					}
		),
	};
}

export function createAnthropicLlm({ apiKey, model, workspaceId }: AnthropicLlmOptions): LlmPort {
	const client = new Anthropic({
		apiKey,
		defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
	});

	return {
		model,
		async parseStructured({ system, messages, schema, maxTokens = 1024 }) {
			const response = await client.messages.parse({
				model,
				max_tokens: maxTokens,
				...(system === undefined ? {} : { system }),
				messages: messages.map(toMessageParam),
				output_config: { format: zodOutputFormat(schema) },
			});
			if (response.parsed_output == null) {
				throw new Error(
					`${model} returned no structured output (stop reason: ${response.stop_reason ?? "unknown"}).`
				);
			}
			return response.parsed_output;
		},
	};
}
