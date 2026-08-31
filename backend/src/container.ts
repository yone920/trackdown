import { createLlmCoach } from "./adapters/coach/llm.js";
import { createSmtpEmailer } from "./adapters/email/smtp.js";
import { createAnthropicLlm } from "./adapters/llm/anthropic.js";
import { createOpenAiLlm } from "./adapters/llm/openai.js";
import { createUnavailableLlm } from "./adapters/llm/unavailable.js";
import { createLocalExerciseMediaStore, exerciseMediaRoot } from "./adapters/storage/exerciseMedia.js";
import { createLocalEvidenceStore } from "./adapters/storage/local.js";
import type { Config, EvidenceProvider, LlmProvider } from "./config/index.js";
import type { CoachPort } from "./ports/coach.js";
import type { EmailPort } from "./ports/email.js";
import type { LlmPort } from "./ports/llm.js";
import type { ExerciseMediaStore } from "./ports/exerciseMedia.js";
import type { EvidenceStore } from "./ports/storage.js";

// The composition root: the only place that knows which adapter implements which port.
// Everything else — routes, services, tests — takes a port. Same shape as My Read Coach.

export interface Container {
	/** Free-text log parsing and the photo fusion of /api/log/analyze. */
	llm: LlmPort;
	/** The coach (WP5). Same port, usually a bigger model. */
	coachLlm: LlmPort;
	/**
	 * The brief itself (WP5). Its own port, because "what should I do today" is a decision
	 * the app makes rather than a model call it happens to run — a rules-only coach or a
	 * hosted one is a different adapter and nothing else changes.
	 */
	coach: CoachPort;
	email: EmailPort;
	/** The bytes behind an evidence row (WP2). */
	evidence: EvidenceStore;
	/** The exercise illustrations, imported by scripts/import-exercise-media.ts. */
	exerciseMedia: ExerciseMediaStore;
}

export function createContainer(config: Config): Container {
	const coachLlm = createLlm(config, config.llm.coachProvider, config.llm.coachModel);
	return {
		llm: createLlm(config, config.llm.provider, config.llm.fusionModel),
		coachLlm,
		coach: createLlmCoach(coachLlm),
		email: createSmtpEmailer(config.smtp),
		evidence: createEvidenceStore(config.evidence.provider, config.evidence.dir),
		// Same volume, its own directory: the illustrations are shared and addressable,
		// evidence is private and unguessable (src/ports/exerciseMedia.ts).
		exerciseMedia: createLocalExerciseMediaStore({ root: exerciseMediaRoot(config.evidence.dir) }),
	};
}

function createEvidenceStore(provider: EvidenceProvider, root: string): EvidenceStore {
	switch (provider) {
		case "local":
			return createLocalEvidenceStore({ root });

		default:
			// config/index.ts rejects unknown names at boot; this is here so adding one to
			// EvidenceProvider without an adapter fails to compile.
			throw new Error(`No evidence store adapter for provider "${String(provider)}".`);
	}
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
