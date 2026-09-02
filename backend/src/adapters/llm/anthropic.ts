import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageParam, TextBlockParam, Usage } from "@anthropic-ai/sdk/resources/messages";
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

/**
 * The system prompt, as one or two blocks.
 *
 * With a stable prefix it becomes TWO text blocks and the first carries
 * `cache_control: {type: "ephemeral"}` — a breakpoint at the boundary between what never
 * changes (instructions, the exercise catalogue) and what changes every request (the clock,
 * today's log, this user's goals). Caching is a PREFIX match, so the order is the whole
 * mechanism: one volatile byte ahead of the breakpoint and nothing after it is ever read
 * back.
 *
 * Without a prefix it is the plain string it always was — no marker, no write premium.
 * Marking a prompt that is not reused is a pure surcharge: a write costs ~1.25x and a read
 * ~0.1x, so a prefix needs a second request within the TTL merely to break even.
 */
function systemParam(prefix: string | undefined, rest: string | undefined) {
	if (prefix === undefined || prefix === "") return rest === undefined ? {} : { system: rest };
	const blocks: TextBlockParam[] = [
		{ type: "text", text: prefix, cache_control: { type: "ephemeral" } },
		...(rest === undefined || rest === "" ? [] : [{ type: "text" as const, text: rest }]),
	];
	return { system: blocks };
}

/**
 * What the cache actually did, per call. **Measured, never assumed** — the costliest
 * caching failure is silent: requests keep succeeding and the bill is merely higher, with
 * nothing to announce it. `cache_read_input_tokens` stuck at zero across repeated requests
 * means a volatile byte has crept ahead of the breakpoint.
 *
 * `input_tokens` is only the UNCACHED remainder, so the prompt's real size is the sum of
 * all three — a small `input_tokens` on its own means nothing.
 */
function reportCache(model: string, label: string | undefined, usage: Usage | null | undefined): void {
	if (!usage) return;
	const read = usage.cache_read_input_tokens ?? 0;
	const written = usage.cache_creation_input_tokens ?? 0;
	if (read === 0 && written === 0) return;
	console.info(
		`🧠 cache ${label ?? "call"} (${model}): read ${read}, wrote ${written}, uncached ${usage.input_tokens}`
	);
}

export function createAnthropicLlm({ apiKey, model, workspaceId }: AnthropicLlmOptions): LlmPort {
	const client = new Anthropic({
		apiKey,
		defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
	});

	return {
		model,
		async parseStructured({ system, systemPrefix, messages, schema, maxTokens = 1024, label }) {
			const response = await retryOnceIfBusy(() =>
				client.messages.parse({
					model,
					max_tokens: maxTokens,
					...systemParam(systemPrefix, system),
					messages: messages.map(toMessageParam),
					output_config: { format: zodOutputFormat(schema) },
				})
			);
			reportCache(model, label, response.usage);
			if (response.parsed_output == null) {
				throw new Error(
					`${model} returned no structured output (stop reason: ${response.stop_reason ?? "unknown"}).`
				);
			}
			return response.parsed_output;
		},
	};
}
