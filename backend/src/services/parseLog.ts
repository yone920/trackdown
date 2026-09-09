import { z } from "zod";
import type { LlmPort } from "../ports/llm.js";

// The Supabase edge function `parse-log` (supabase/functions/parse-log/index.ts), moved
// into the backend. Prompt and output schema are unchanged; only the runtime differs
// (Node instead of Deno, session-authenticated instead of anon-key).
//
// Provider-neutral: the prompt and the schema live here, the SDK call lives in an adapter
// behind LlmPort. Swapping Claude for GPT is `LLM_PROVIDER=openai`, not an edit to this file.

export const ParsedItemSchema = z.object({
	type: z.enum(["movement", "weight"]),
	description: z.string(),
	kcal: z.number().int().min(0).optional(),
	weight_lb: z.number().positive().optional(),
	confidence: z.enum(["low", "medium", "high"]),
});

export const ParseResponseSchema = z.object({
	items: z.array(ParsedItemSchema),
});

export type ParsedItem = z.infer<typeof ParsedItemSchema>;

export const SYSTEM_PROMPT = `You convert short user descriptions into structured health log entries.

The user describes something they did physically or weighed. Identify each entry and emit one item per entry.

GROUPING RULES — strongly bias toward ONE item per log.
- Movement described in a single log is ONE movement item, unless the user clearly indicates separate, distinct activities ("ran 5k then lifted for 45 minutes" → two movement items).
- Weight is always its own item separate from any movement in the same log.

For each item:
- type: "movement" for physical activity; "weight" for a body-weight measurement.
- description: a clean short phrase capturing what it was (no leading articles, sentence case).
- kcal: integer calorie estimate of calories burned. Omit for weight items.
- weight_lb: body weight in pounds (numeric). Required for weight items, omit otherwise. If the user gives kilograms, convert to pounds (kg × 2.20462) and round to one decimal.
- confidence: "high" if specific and reliable; "medium" if you made reasonable assumptions about intensity, duration, or unit; "low" if vague.

Examples:
- "ran 5k in 28 minutes" → one movement item "ran 5k", ~350 kcal, high confidence.
- "45 minute upper body lift at the gym" → one movement item "upper body lift", ~250 kcal, medium confidence.
- "ran 5k then lifted for 45 minutes" → TWO movement items (distinct activities).
- "walked the dog" → one movement item "walked the dog", ~80 kcal, low confidence.
- "weighed in at 182 this morning" → one weight item, weight_lb 182, high confidence.
- "down to 79.5 kg" → one weight item, weight_lb 175.3, high confidence.

If the input is completely unparseable, return one item with the raw input as description, type "movement", kcal 0, confidence "low". Always return at least one item.`;

/** What routes depend on: anything that turns free text into log items. */
export interface LogParser {
	parse(text: string): Promise<ParsedItem[]>;
}

export function createLogParser(llm: LlmPort): LogParser {
	return {
		async parse(text) {
			const { items } = await llm.parseStructured({
				system: SYSTEM_PROMPT,
				schema: ParseResponseSchema,
				schemaName: "log_entries",
				maxTokens: 1024,
				messages: [{ role: "user", content: text.trim() }],
			});
			return items;
		},
	};
}
