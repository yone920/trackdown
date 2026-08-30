import { describe, expect, it } from "vitest";
import { z } from "zod";
import { config } from "../../config/index.js";
import { RED_SQUARE_PNG_BASE64 } from "../../test/fixtures/images.js";
import { createOpenAiLlm } from "./openai.js";

// The same contract as anthropic.contract.test.ts, against the other provider — that is the
// point of having two adapters: if both pass this file, LlmPort is a real abstraction and
// LLM_PROVIDER is a real switch. Skipped without OPENAI_API_KEY.

const apiKey = config.openai.apiKey;
// Built lazily: an SDK client with an empty key throws at construction, which
// would fail the file instead of skipping it.
const llm = () =>
	createOpenAiLlm({
	apiKey,
	model: config.llm.defaultModels.openai.fusion,
	baseUrl: config.openai.baseUrl,
});

describe.skipIf(!apiKey)("openai LlmPort (contract)", () => {
	it("returns output parsed into the caller's schema", async () => {
		const result = await llm().parseStructured({
			system: "You extract structured data. Answer only from the message.",
			schema: z.object({ city: z.string(), country: z.string() }),
			schemaName: "place",
			maxTokens: 256,
			messages: [{ role: "user", content: "The Eiffel Tower stands in Paris." }],
		});
		expect(result.city.toLowerCase()).toContain("paris");
		expect(result.country.toLowerCase()).toContain("franc");
	}, 60_000);

	it("sends image parts alongside text", async () => {
		const result = await llm().parseStructured({
			schema: z.object({ colour: z.string() }),
			schemaName: "image_colour",
			maxTokens: 256,
			messages: [
				{
					role: "user",
					content: [
						{ type: "image", mediaType: "image/png", base64: RED_SQUARE_PNG_BASE64 },
						{ type: "text", text: "What single colour fills this image? One word." },
					],
				},
			],
		});
		expect(result.colour.toLowerCase()).toContain("red");
	}, 60_000);
});
