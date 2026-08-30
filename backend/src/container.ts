import { createSmtpEmailer } from "./adapters/email/smtp.js";
import { createAnthropicLlm } from "./adapters/llm/anthropic.js";
import { createOpenAiLlm } from "./adapters/llm/openai.js";
import { createUnavailableLlm } from "./adapters/llm/unavailable.js";
import type { Config, LlmProvider } from "./config/index.js";
import type { EmailPort } from "./ports/email.js";
import type { LlmPort } from "./ports/llm.js";

// The composition root: the only place that knows which adapter implements which port.
// Everything else — routes, services, tests — takes a port. Same shape as My Read Coach.

export interface Container {
	/** Free-text log parsing today; photo fusion in WP2. */
	llm: LlmPort;
	/** The coach (WP5). Same port, usually a bigger model. */
	coachLlm: LlmPort;
	email: EmailPort;
}

export function createContainer(config: Config): Container {
	return {
		llm: createLlm(config, config.llm.provider, config.llm.fusionModel),
		coachLlm: createLlm(config, config.llm.coachProvider, config.llm.coachModel),
		email: createSmtpEmailer(config.smtp),
	};
}

function createLlm(config: Config, provider: LlmProvider, model: string): LlmPort {
	switch (provider) {
		case "anthropic":
			if (!config.anthropic.apiKey) {
				return createUnavailableLlm(model, "ANTHROPIC_API_KEY is not set — AI features are unavailable.");
			}
			return createAnthropicLlm({
				apiKey: config.anthropic.apiKey,
				model,
				workspaceId: config.anthropic.workspaceId,
			});

		case "openai":
			if (!config.openai.apiKey) {
				return createUnavailableLlm(model, "OPENAI_API_KEY is not set — AI features are unavailable.");
			}
			return createOpenAiLlm({
				apiKey: config.openai.apiKey,
				model,
				baseUrl: config.openai.baseUrl,
			});

		default:
			// config/index.ts rejects unknown names at boot, so this is unreachable — it is
			// here so adding a provider to LlmProvider without an adapter fails to compile.
			throw new Error(`No LLM adapter for provider "${String(provider)}".`);
	}
}
