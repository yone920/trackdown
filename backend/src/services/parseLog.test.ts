import { describe, expect, it } from "vitest";
import { ParseResponseSchema, SYSTEM_PROMPT } from "./parseLog.js";

describe("parse-log schema", () => {
	it("accepts the shapes the prompt asks for", () => {
		const result = ParseResponseSchema.safeParse({
			items: [
				{ type: "meal", description: "eggs, toast, coffee", kcal: 265, protein_g: 16, carbs_g: 23, fat_g: 11.5, fiber_g: 2, confidence: "high" },
				{ type: "movement", description: "5k run", kcal: 350, confidence: "high" },
				{ type: "weight", description: "weigh-in", weight_lb: 175.3, confidence: "high" },
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects negative calories and unknown types", () => {
		expect(ParseResponseSchema.safeParse({ items: [{ type: "meal", description: "x", kcal: -5, confidence: "low" }] }).success).toBe(false);
		expect(ParseResponseSchema.safeParse({ items: [{ type: "sleep", description: "x", confidence: "low" }] }).success).toBe(false);
	});

	it("keeps the prompt's grouping rule", () => {
		expect(SYSTEM_PROMPT).toContain("strongly bias toward ONE item per log");
	});
});
