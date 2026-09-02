import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LlmMessage, LlmPort } from "../../ports/llm.js";
import { isOverloadError } from "../../services/providerErrors.js";

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

/** How long to wait before the one retry. Long enough for a spike to pass, short enough
 * that a person holding a phone does not conclude the app has hung. */
const OVERLOAD_BACKOFF_MS = 1_500;

/**
 * One retry, and only for a provider that is BUSY (429/529).
 *
 * **Exactly one, and only here.** Retry policy is single-layer on purpose: the coach
 * adapter above this also retries once, for a different reason — an answer that parsed but
 * was unusable — and if both layers retried the same overload a brief would quietly make
 * four calls to a provider that was already struggling. So this layer owns transport
 * failures and that one owns malformed answers, and neither reaches into the other's job.
 *
 * Anything that is not an overload is thrown at once: a 400 is a bug and a 401 is a
 * configuration problem, and asking either of them twice is just waiting longer to find out.
 */
async function retryOnceIfBusy<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (!isOverloadError(error)) throw error;
		console.warn(`⚠️  Provider busy, retrying once in ${OVERLOAD_BACKOFF_MS}ms:`, describeStatus(error));
		await new Promise((resolve) => setTimeout(resolve, OVERLOAD_BACKOFF_MS));
		return await work();
	}
}

/** The status and request id, for the log — never for the user. */
function describeStatus(error: unknown): string {
	const status = (error as { status?: unknown } | null)?.status ?? "?";
	const requestId = (error as { request_id?: unknown } | null)?.request_id;
	return requestId ? `${status} (${String(requestId)})` : String(status);
}

export function createAnthropicLlm({ apiKey, model, workspaceId }: AnthropicLlmOptions): LlmPort {
	const client = new Anthropic({
		apiKey,
		defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
	});

	return {
		model,
		async parseStructured({ system, messages, schema, maxTokens = 1024 }) {
			const response = await retryOnceIfBusy(() =>
				client.messages.parse({
					model,
					max_tokens: maxTokens,
					...(system === undefined ? {} : { system }),
					messages: messages.map(toMessageParam),
					output_config: { format: zodOutputFormat(schema) },
				})
			);
			if (response.parsed_output == null) {
				throw new Error(
					`${model} returned no structured output (stop reason: ${response.stop_reason ?? "unknown"}).`
				);
			}
			return response.parsed_output;
		},
	};
}
