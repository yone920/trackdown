import Anthropic from 'npm:@anthropic-ai/sdk@0.74.0';
import { z } from 'npm:zod@4.0.14';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.74.0/helpers/zod';

const ResponseSchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(['meal', 'movement', 'weight']),
      description: z.string(),
      kcal: z.number().int().min(0).optional(),
      protein_g: z.number().min(0).optional(),
      carbs_g: z.number().min(0).optional(),
      fat_g: z.number().min(0).optional(),
      fiber_g: z.number().min(0).optional(),
      weight_lb: z.number().positive().optional(),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
});

const SYSTEM_PROMPT = `You convert short user descriptions into structured health log entries.

The user describes something they ate, drank, did physically, or weighed. Identify each entry and emit one item per entry.

GROUPING RULES — strongly bias toward ONE item per log.
- All food and drink described in a single log is ONE meal item. Sum calories and macros across everything; the description should briefly list what was had (e.g. "eggs, toast, coffee" or "smoked sausage, potato and cheese omelet with coffee").
- Split into multiple meal items ONLY when the user clearly indicates separate eating occasions at different times ("had eggs for breakfast, then a sandwich at noon" → two meal items).
- Movement is always its own item separate from any meal in the same log ("protein shake after my 30 min walk" → one meal + one movement).
- Weight is always its own item separate from any meal/movement in the same log.
When in doubt about meals, COMBINE into one item.

For each item:
- type: "meal" for anything consumed; "movement" for physical activity; "weight" for a body-weight measurement.
- description: a clean short phrase capturing what it was (no leading articles, sentence case). For a composed dish, name the whole dish.
- kcal: integer calorie estimate. For meals, calories consumed. For movement, calories burned. Omit for weight items.
- protein_g, carbs_g, fat_g, fiber_g: macronutrient estimates in grams (numeric, one decimal ok). Required for meal items. Omit for movement and weight.
- weight_lb: body weight in pounds (numeric). Required for weight items, omit otherwise. If the user gives kilograms, convert to pounds (kg × 2.20462) and round to one decimal.
- confidence: "high" if specific and reliable; "medium" if you made reasonable assumptions about portion, intensity, or unit; "low" if vague.

Examples:
- "two eggs, sourdough toast, coffee" → ONE meal item "eggs, sourdough toast, coffee" ~265 kcal / 16p / 23c / 11.5f / 2fb.
- "smoked sausage, potato and cheese omelet with coffee" → ONE meal item "smoked sausage, potato and cheese omelet with coffee" ~525 / 28p / 18c / 38f / 2fb.
- "chicken burrito with rice, beans, and a soda" → ONE meal item ~950 / 38p / 130c / 28f / 8fb.
- "ran 5k in 28 minutes" → one movement item, ~350 kcal, high confidence.
- "protein shake after my 30 min walk" → one meal (~150 kcal, ~25p) + one movement (~120 kcal).
- "had eggs for breakfast, then a chicken sandwich for lunch" → TWO meal items (separate eating occasions).
- "weighed in at 182 this morning" → one weight item, weight_lb 182, high confidence.
- "down to 79.5 kg" → one weight item, weight_lb 175.3, high confidence.
- "lunch" → one meal item, kcal 0, confidence "low", no macros.

If the input is completely unparseable, return one item with the raw input as description, type "meal", kcal 0, confidence "low". Always return at least one item.`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonHeaders = { ...corsHeaders, 'content-type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    const text = body?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.parse({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text.trim() }],
      output_config: { format: zodOutputFormat(ResponseSchema, 'log_items') },
    });

    return new Response(JSON.stringify(response.parsed_output ?? { items: [] }), {
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error('parse-log error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
