import { z } from "zod";
import { config } from "../config/index.js";
import { createAnthropicLlm } from "../adapters/llm/anthropic.js";
import { buildFusionSystemParts } from "../services/fusion/prompt.js";
import type { FusionContext } from "../services/fusion/context.js";
import { loadExerciseCatalog } from "../db/exercises.js";

// Measures what prompt caching actually does, against the real API — because the costliest
// caching failure is silent, and "should cache" is not evidence (docs/CHANGELOG-v2.md).
//
//   npm run measure-cache
//
// Sends the SAME fusion router prompt twice, a second apart, and prints the usage block for
// each. The first pays the ~1.25x write; the second should read it back at ~0.1x.

const Answer = z.object({ ok: z.boolean() });

function contextWithRealCatalogue(catalog: FusionContext["catalog"]): FusionContext {
	return {
		localDate: "2026-09-02",
		localTime: "10:00",
		tzOffsetMin: -240,
		todayActivities: [],
		todayMeals: [],
		todayWeights: [],
		recentExercises: ["Bench Press", "Lat Pulldown"],
		catalog,
		goals: [],
		kindHint: null,
		clarify: null,
	} as unknown as FusionContext;
}

async function main(): Promise<void> {
	const key = config.anthropic.apiKey;
	if (!key) throw new Error("No ANTHROPIC_API_KEY — cannot measure against the real API.");
	const model = config.llm.fusionModel;
	const llm = createAnthropicLlm({ apiKey: key, model, workspaceId: config.anthropic.workspaceId });

	const seed = await loadExerciseCatalog();
	const catalog = seed.map((e) => ({
		name: e.name,
		aliases: e.aliases,
		category: e.category,
		primary_muscles: e.primary_muscles,
	}));
	const { prefix, rest } = buildFusionSystemParts(contextWithRealCatalogue(catalog));

	console.log(`model: ${model}`);
	console.log(`prefix: ${prefix.length} chars (~${Math.round(prefix.length / 3.6)} tok)`);
	console.log(`rest:   ${rest.length} chars (~${Math.round(rest.length / 3.6)} tok)`);
	console.log("");

	for (const attempt of [1, 2, 3]) {
		await llm.parseStructured({
			systemPrefix: prefix,
			system: rest,
			schema: Answer,
			schemaName: "ok",
			maxTokens: 64,
			label: `measure #${attempt}`,
			messages: [{ role: "user", content: "Reply with ok: true." }],
		});
		if (attempt < 3) await new Promise((r) => setTimeout(r, 1200));
	}
}

await main();
