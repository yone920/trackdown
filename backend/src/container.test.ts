import { describe, expect, it } from "vitest";
import { z } from "zod";
import { config, type Config } from "./config/index.js";
import { createContainer } from "./container.js";

// The composition root is where a wrong provider name or a missing key turns into either a
// refused boot or a clear failure at the call site. Both are behaviour worth pinning down.

function configWith(llm: Partial<Config["llm"]>, keys: { anthropic?: string; openai?: string } = {}): Config {
	return {
		...config,
		llm: { ...config.llm, ...llm },
		anthropic: { ...config.anthropic, apiKey: keys.anthropic ?? "" },
		openai: { ...config.openai, apiKey: keys.openai ?? "" },
	};
}

const anyRequest = { schema: z.object({}), schemaName: "anything", messages: [{ role: "user" as const, content: "hi" }] };

describe("container", () => {
	it("builds each port from its own provider and model", () => {
		const container = createContainer(
			configWith(
				{ provider: "anthropic", fusionModel: "claude-test", coachProvider: "openai", coachModel: "gpt-test" },
				{ anthropic: "sk-ant-test", openai: "sk-oai-test" }
			)
		);
		expect(container.llm.model).toBe("claude-test");
		expect(container.coachLlm.model).toBe("gpt-test");
		expect(container.email).toBeDefined();
	});

	it("still boots without an API key, and names the missing one at the call", async () => {
		const container = createContainer(
			configWith({ provider: "anthropic", fusionModel: "claude-test", coachProvider: "openai", coachModel: "gpt-test" })
		);
		await expect(container.llm.parseStructured(anyRequest)).rejects.toThrow(/ANTHROPIC_API_KEY/);
		await expect(container.coachLlm.parseStructured(anyRequest)).rejects.toThrow(/OPENAI_API_KEY/);
	});

	it("refuses a provider it has no adapter for", () => {
		const bogus = configWith({ provider: "gemini" as Config["llm"]["provider"] });
		expect(() => createContainer(bogus)).toThrow(/No LLM adapter for provider "gemini"/);
	});
});
