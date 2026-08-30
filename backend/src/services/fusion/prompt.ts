import type { FusionContext } from "./context.js";

// The fusion prompt (docs/concept-v2.md §Logging — "evidence in, one record out").
// Provider-neutral: this string and the zod schema next to it are the whole contract;
// the adapter behind LlmPort decides how to ask for structured output.
//
// The grouping rules are lifted from v1's parse-log prompt (src/services/parseLog.ts),
// because they were right and they are why one photographed plate does not become five
// meals. What is new is the routing: the same panel logs a workout, states a goal, adds a
// constraint and gives the coach context, so the first decision the model makes is which
// of those it is looking at.

const ROUTING = `You are TrackDown's log reader. The user just logged something with any mix of photos, a
voice transcript, and typed text. All of it describes ONE thing. Fuse the evidence into one
structured result.

FIRST decide what kind of thing it is, then fill in that kind and nothing else:

- "activities" — physical activity they did: exercises, a walk, a run, a machine display.
- "meal" — anything eaten or drunk.
- "weight" — a body-weight reading (a scale photo, "182 this morning").
- "goal" — a target or a standing intention. Return the title only; you will be asked for the
  numbers in a second step.
- "statement" — something about how they train or eat rather than something they did, with a
  "scope" saying which:
    * "constraint": a hard limit the coach must respect — an injury, an exercise to avoid, a
      medical restriction ("bad left knee", "no overhead pressing").
    * "preference": a soft steer — diet style, equipment, when they like to train ("switching
      to keto", "mornings only", "I hate burpees").
    * "coach_context": a passing state that should shape today's advice but is not a rule —
      "only 30 minutes today", "slept badly", "feel like cardio".
- "unclear" — you cannot tell what happened and a guess would be a lie. Ask the one question
  that would settle it. Prefer any of the kinds above over this: a vague meal is a meal.

A log that states a current fact on the way to a goal ("I'm 191 now, want to get to 170")
is the goal — the weight it mentions belongs in the goal's starting point, not a second
result.`;

const EVIDENCE_RULES = `EVIDENCE
- A photo names the thing: which machine, which plate, what the display reads, what is on the
  plate. Read numbers off displays and weight stacks exactly as shown.
- Sets and reps NEVER come from a photo. They come from what the user said or typed. If
  nobody said them, leave them null — do not infer "3 sets of 10" because it is common.
- Words beat pixels when they disagree: the user knows what they did.
- List in "photo_fields" the names of the fields you read off a photo ("load_lb",
  "distance_mi"). Everything else is taken to have come from the words. Leave it empty when
  there was no photo.
- confidence: "high" when the evidence states it outright; "medium" when you assumed a
  portion, an intensity or a unit; "low" when it is a guess.`;

const GROUPING = `GROUPING — strongly bias toward ONE record per log.
- All food and drink in a single log is ONE meal. Sum calories and macros across everything;
  the description briefly lists what was had ("eggs, sourdough toast, coffee"). Break the
  plate out into "items" only when the evidence actually shows the parts. Split into a
  second log only if the user clearly names separate eating occasions at different times —
  and this schema holds one meal, so in that case take the one they are logging now.
- Each distinct exercise is its own item under "activities": "bench, then rows, then a
  10 minute bike" is three items, not three logs. Same exercise across several sets in one
  breath is ONE item with the set count.
- When in doubt about food, COMBINE. When in doubt about exercises, SEPARATE.`;

const FIELDS = `FIELDS
- Units are POUNDS and MILES. If the user says kilograms, convert (kg × 2.20462, one
  decimal); if they say kilometres, convert (km × 0.621371, two decimals). Never return the
  metric number.
- exercise: use the catalogue's exact spelling when the log is one of those movements, even
  if the user said it another way. If it is genuinely not in the catalogue, keep the user's
  own words — the catalogue normalises, it does not decide what they are allowed to log.
- description: a clean short phrase, sentence case, no leading article. For an activity,
  include the numbers ("3 × 10 dumbbell bench at 45 lb"). For a composed dish, name the dish.
- kcal: integer. For a meal, calories eaten. For an activity, calories burned — a MET-style
  estimate from duration and effort, or the machine's own figure when a photo shows one.
- Macros are grams. Estimate them for every meal.
- weight_lb: body weight only. A dumbbell is not a body weight.
- statement "text": what they said, cleaned up to one line and kept in their own terms.`;

function bullet(lines: string[]): string {
	return lines.map((line) => `- ${line}`).join("\n");
}

function number(value: number | null | undefined, suffix = ""): string {
	return value === null || value === undefined ? "" : `${value}${suffix}`;
}

function describeToday(context: FusionContext): string {
	const lines: string[] = [];
	for (const a of context.todayActivities) {
		const parts = [
			a.exercise ?? a.description,
			a.sets && a.reps ? `${a.sets}×${a.reps}` : "",
			number(a.load_lb, " lb"),
			number(a.duration_min, " min"),
			number(a.kcal, " kcal"),
		].filter(Boolean);
		lines.push(`${a.logged_at.slice(11, 16)} activity — ${parts.join(", ")}`);
	}
	for (const m of context.todayMeals) {
		const parts = [m.description, number(m.kcal, " kcal"), number(m.protein_g, " g protein")].filter(Boolean);
		lines.push(`${m.logged_at.slice(11, 16)} meal — ${parts.join(", ")}`);
	}
	for (const w of context.todayWeights) lines.push(`weight — ${w} lb`);
	return lines.length > 0 ? bullet(lines) : "- nothing logged yet today";
}

function describeVocabulary(context: FusionContext): string {
	const sections: string[] = [];
	if (context.recentExercises.length > 0) {
		sections.push(
			`Exercises THIS user has logged recently (most recent first) — prefer these spellings:\n${bullet(
				context.recentExercises
			)}`
		);
	}
	if (context.catalog.length > 0) {
		const entries = context.catalog.map((e) =>
			e.aliases.length > 0 ? `${e.name} (${e.aliases.join(", ")})` : e.name
		);
		sections.push(`Exercise catalogue — canonical name (things people call it):\n${bullet(entries)}`);
	}
	return sections.join("\n\n");
}

function describeGoals(context: FusionContext): string {
	if (context.goals.length === 0) {
		return "The user has no active goals. A goal statement is therefore a new goal.";
	}
	const lines = context.goals.map((g) => `${g.title} (${g.kind}, priority ${g.priority})`);
	return `Active goals — if the user is restating one of these, it is the same goal with new numbers, not a new one:\n${bullet(
		lines
	)}`;
}

/** The second, focused call: the router said "goal", now turn it into a measurable spec. */
const GOAL_DETAIL = `Turn what the user said into a measurable goal spec (docs/concept-v2.md §Goals).

- metrics[].measure must be one of the measures the app can actually compute — the schema
  lists them. A goal it cannot measure is not a goal: pick the closest measure that IS
  computable, or leave metrics empty rather than inventing one.
- direction: "decrease"/"increase" for an outcome with a finish line, "maintain"/"at_least"/
  "at_most" for a standing intention.
- Units are pounds and miles. Convert anything the user said in kg or km.
- proposed_timeline: project from safe rates (fat loss 0.5–1 %/week, one plate step every
  1–2 weeks, cardio +10 %/week). If the user named their own date, keep THEIR date in "by"
  and set realistic:false with a one-line note saying what the safe date would be. If they
  named no date, propose one and set realistic:true.
- active_to: only for a goal with a stated window ("upper body for two months"); null for an
  open-ended one.`;

export function buildGoalDetailSystemPrompt(context: FusionContext, title: string): string {
	return `${GOAL_DETAIL}

The goal, as the user just stated it: ${title}

It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

${describeGoals(context)}`;
}

/** The second, focused call on the constraint / preference path. */
export function buildPlanFieldsSystemPrompt(
	context: FusionContext,
	scope: "constraint" | "preference",
	text: string
): string {
	return `The user just stated a ${scope} about how they train or eat. Extract the plan fields it
sets, and ONLY those — every field they did not actually state stays null. Do not restate the
${scope} itself in a field; it is already recorded as text.

- diet_style: "keto", "lower carb", "high protein" — their own words, lower case.
- protein_g / carbs_max_g: daily grams, when they named a number.
- training_days: days per week, as a count.
- environment: "gym", "home", "outdoor", "mixed".
- equipment: what they have to work with.
- eatback: how much of the calories they burn they want back — none / half / all.

Units are pounds and miles.

What they said: ${text}

It is ${context.localTime} on ${context.localDate} in the user's timezone.`;
}

export function buildFusionSystemPrompt(context: FusionContext): string {
	const hint =
		context.kindHint === null
			? ""
			: `\n\nThe app thinks this is a "${context.kindHint}". That is a hint from which button the user pressed, not an instruction — if the evidence says otherwise, follow the evidence.`;

	return `${ROUTING}

${EVIDENCE_RULES}

${GROUPING}

${FIELDS}

CONTEXT
It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

Logged so far today:
${describeToday(context)}

${describeVocabulary(context)}

${describeGoals(context)}${hint}`;
}
