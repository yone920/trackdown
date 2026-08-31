import type { FusionContext } from "./context.js";
import type { SegmentKind } from "./schema.js";

// The fusion prompt (docs/concept-v2.md §Logging — "evidence in, one record out").
// Provider-neutral: this string and the zod schema next to it are the whole contract;
// the adapter behind LlmPort decides how to ask for structured output.
//
// The grouping rules are lifted from v1's parse-log prompt (src/services/parseLog.ts),
// because they were right and they are why one photographed plate does not become five
// meals. What is new is the routing: the same panel logs a workout, states a goal, adds a
// constraint and gives the coach context, so the first decision the model makes is which
// of those it is looking at — and, since the mixed-input fix, *how many* of those there
// are. The user says everything at once and the app sorts it out (concept-v2 §One input
// mechanism), so this call segments as well as routes: one list, in the order they said it.

const ROUTING = `You are TrackDown's log reader. The user just logged something with any mix of photos, a
voice transcript, and typed text. Fuse the evidence into a LIST of structured results, in the
order the user said them. Most of the time that list has exactly one entry.

FIRST decide what kind each thing is, then fill in that kind and nothing else:

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
  "unclear" is about the WHOLE log: return it alone or not at all.

A log that states a current fact on the way to a goal ("I'm 191 now, want to get to 170")
is the goal — the second step captures the 191 as a stated fact, so it is NOT a second
"weight" part here.`;

const PARTS = `PARTS — "result" is the FIRST thing they said; "more_kinds" names the rest.
One sentence often holds several things: "ate two eggs and toast, then ran 5k, and weighed in
at 181" is a meal, an activity and a weigh-in. Fill in "result" with the first of them, in
full, and list the KINDS of the others in "more_kinds". Each one will be read out of this same
message by its own call, so "more_kinds" carries nothing but the kind.

- Strongly bias toward an EMPTY "more_kinds". Most logs are a single kind, and a single kind
  is one part no matter how many exercises or foods are in it — the grouping rules below say
  how those become items inside it.
- At most one part per kind: a repeat is ignored.
- Keep the user's order. "more_kinds" runs from the second thing they said to the last.
- Name a kind only if the user actually said something of that kind. Do not invent a meal
  from a calorie count or a statement from a passing adjective. When it is all one thing,
  "more_kinds" is [].
- A weight the user says they are NOW, while setting a goal ("I am 212 lbs, my goal is 200"),
  is part of the goal and NOT a "weight" part. The goal's own step records it. Only a
  weigh-in they are logging in its own right — "weighed in at 181 this morning" — is one.
- "statement" covers all three of constraint, preference and coach_context; its own step
  decides which. Use the word "statement" here.`;

const EVIDENCE_RULES = `EVIDENCE
- A photo names the thing: which machine, which plate, what the display reads, what is on the
  plate. Read numbers off displays and weight stacks exactly as shown.
- Sets and reps NEVER come from a photo. They come from what the user said or typed. If
  nobody said them, leave them null — do not infer "3 sets of 10" because it is common.
- Words beat pixels when they disagree: the user knows what they did.
- List in "photo_fields" the names of the fields you read off a photo ("load_lb",
  "distance_mi"). Everything else is taken to have come from the words. Leave it empty when
  there was no photo.
- A photo belongs to the part it is about: a machine to the exercise, a plate to the meal, a
  scale to the weigh-in. Read "result" off the photos that are about "result" and leave the
  others to the parts they belong to — each of those is asked which photos it used.
- confidence: "high" when the evidence states it outright; "medium" when you assumed a
  portion, an intensity or a unit; "low" when it is a guess.`;

const GROUPING = `GROUPING — inside one result, strongly bias toward ONE record.
- All food and drink in a single log is ONE meal. Sum calories and macros across everything;
  the description briefly lists what was had ("eggs, sourdough toast, coffee"). Break the
  plate out into "items" only when the evidence actually shows the parts. Return a second
  meal result only if the user clearly names separate eating occasions at different times.
- Each distinct exercise is its own item under "activities": "bench, then rows, then a
  10 minute bike" is three items in ONE activities result, not three results. Same exercise
  across several sets in one breath is ONE item with the set count.
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
- Do not work out how long it will take. If the user named a date of their own, put it in
  that metric's "by" as YYYY-MM-DD — resolve "December", "in six weeks" and "by my birthday"
  against today's date below, and use null if you cannot. Never put words in "by". The app
  projects the timeline from their logs at safe rates and says whether their date fits.
- active_to: only for a goal with a stated window ("upper body for two months"); null for an
  open-ended one.
- A goal about training the whole body ("a complete body workout through the week") is
  weekly_sets with scope null — that is total sets across every muscle group. Only name a
  scope when the user named one muscle.

"facts" — things the user stated about THEMSELVES in the same breath, not about the goal.
Every one they did not state stays null. Do not infer, do not carry a number over from the
goal itself:
- current_weight_lb: what they weigh NOW ("I am 212 lbs, my goal is 200" → 212, not 200).
  Pounds; convert kg.
- training_days: sessions per week they say they train ("I work out 4 days a week" → 4).
- environment: "gym" or "home", when they say where they train. Nothing else.
- age_years: their age in years ("I'm 45" → 45). Read through typos.`;

/**
 * `title` is what the router read the goal as. It is null when the goal was one part of a
 * mixed input, because there the router named only the kind — the spec's own title is then
 * the model's to write.
 */
export function buildGoalDetailSystemPrompt(context: FusionContext, title: string | null): string {
	const said = title
		? `The goal, as the user just stated it: ${title}`
		: "Find the goal in what the user just said and give it a short title of its own.";
	return `${GOAL_DETAIL}

${said}

The same message may also have logged a meal, a workout or a weigh-in. Those are being saved
separately — read only what bears on THIS goal and on the user themselves.

It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

${describeGoals(context)}`;
}

const PART_INTRO: Record<SegmentKind, string> = {
	activities: `Pull out the PHYSICAL ACTIVITY they described — exercises, a walk, a run, a machine
display — and nothing else. One item per distinct exercise; several sets of the same exercise
in one breath are ONE item with the set count.`,
	meal: `Pull out what they ATE OR DRANK and nothing else. All of it is ONE meal: sum the calories
and macros, and let "description" briefly list what was had ("eggs, sourdough toast, coffee").
Break it into "items" only when the evidence actually shows the parts.`,
	weight: `Pull out the BODY-WEIGHT READING they gave and nothing else. Body weight only — a dumbbell
is not a body weight, and a weight they want to reach is a goal, not a reading.`,
	goal: "",
	statement: `Pull out the STATEMENT they made about how they train or eat — not something they did —
and say in "scope" which of three it is:
- "constraint": a hard limit the coach must respect — an injury, an exercise to avoid, a
  medical restriction ("bad left knee", "no overhead pressing").
- "preference": a soft steer — diet style, equipment, when they like to train ("switching to
  keto", "mornings only").
- "coach_context": a passing state that should shape today's advice but is not a rule ("only
  30 minutes today", "slept badly", "knee is sore"). Leave every plan field null for one of
  these: a passing state changes no plan.

"text" is what they said, cleaned up to one line and kept in their own terms.`,
};

const PART_PHOTOS = `- "photo_indexes" are the positions of the photos this part was read from, counting from 0 in
  the order they were sent. Claim a photo only if it is about THIS part; leave it empty when
  the photos belong to something else the user said.`;

/**
 * The focused call that fills in one segment of a mixed input. The router named this part's
 * kind and nothing more, so the call is given the whole original message and told which
 * kind to pull out of it — and it sees only that kind's schema, which is why the whole
 * eight-branch union never has to compile at once.
 */
export function buildPartDetailSystemPrompt(context: FusionContext, kind: SegmentKind): string {
	if (kind === "goal") return buildGoalDetailSystemPrompt(context, null);
	const claims = kind === "activities" || kind === "meal" || kind === "weight";
	return `The user logged several things at once — a meal, a workout, a weigh-in, a goal, something
about how they train. ${PART_INTRO[kind]}

Read ONLY that part and ignore the rest: the other parts are being read by their own calls,
and anything you repeat here would be saved twice.

${claims ? `${EVIDENCE_RULES}\n${PART_PHOTOS}\n\n${FIELDS}` : PLAN_FIELDS}

CONTEXT
It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

${claims ? describeVocabulary(context) : ""}`;
}

const PLAN_FIELDS = `Extract the plan fields it sets, and ONLY those — every field they did not actually state
stays null. Do not restate the statement itself in a field; it is recorded as text.

- diet_style: "keto", "lower carb", "high protein" — their own words, lower case.
- protein_g / carbs_max_g: daily grams, when they named a number.
- training_days: days per week, as a count.
- environment: "gym", "home", "outdoor", "mixed".
- equipment: what they have to work with.
- eatback: how much of the calories they burn they want back — none / half / all.

Units are pounds and miles.`;

/** The second, focused call on the constraint / preference path. */
export function buildPlanFieldsSystemPrompt(
	context: FusionContext,
	scope: "constraint" | "preference",
	text: string
): string {
	return `The user just stated a ${scope} about how they train or eat. ${PLAN_FIELDS}

What they said: ${text}

It is ${context.localTime} on ${context.localDate} in the user's timezone.`;
}

export function buildFusionSystemPrompt(context: FusionContext): string {
	const hint =
		context.kindHint === null
			? ""
			: `\n\nThe app thinks this is a "${context.kindHint}". That is a hint from which button the user pressed, not an instruction — if the evidence says otherwise, follow the evidence.`;

	return `${ROUTING}

${PARTS}

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
