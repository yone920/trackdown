import { describe, expect, it } from "vitest";
import { z } from "zod";
import { config } from "../../config/index.js";
import { RED_SQUARE_PNG_BASE64 } from "../../test/fixtures/images.js";
import { createAnthropicLlm } from "./anthropic.js";

// Contract test: the only thing here that talks to a real provider. It proves the adapter's
// two risky details — that the schema really comes back parsed, and that an image part is
// encoded the way the API expects — which no fake can prove. Skipped without a key, so
// `npm test` stays green on a fresh clone.

const apiKey = config.anthropic.apiKey;
// Built lazily: an SDK client with an empty key throws at construction, which
// would fail the file instead of skipping it.
const llm = () =>
	createAnthropicLlm({
	apiKey,
	model: config.llm.defaultModels.anthropic.fusion,
	workspaceId: config.anthropic.workspaceId,
});

describe.skipIf(!apiKey)("anthropic LlmPort (contract)", () => {
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
