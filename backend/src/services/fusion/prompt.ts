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
  This includes PASSIVE RECOVERY they have already done — sauna, steam room, hot tub, ice
  bath, cold plunge, massage, foam rolling, stretching. It happened to their body, for a
  length of time, and the always-log rule applies to it exactly as it does to a set of
  squats: category "other" (or "mobility" for foam rolling and stretching), the duration
  from their words, muscle_groups empty, kcal 0 or a small honest estimate, and the details
  they gave — a temperature, a bath, which sauna — kept in the description.
- "meal" — anything eaten or drunk.
- "weight" — a body-weight reading (a scale photo, "182 this morning").
- "goal" — a target or a standing intention. Return the title only; you will be asked for the
  numbers in a second step.
- "statement" — something about how they train or eat rather than something they did, with a
  "scope" saying which:
    * "constraint": a hard limit the coach must respect — an injury, an exercise to avoid, a
      medical restriction ("bad left knee", "no overhead pressing").
    * "preference": a soft steer, or a standing fact about how they train — diet style,
      equipment, when they like to train, WHERE they train and what it is called, and their
      training background ("switching to keto", "mornings only", "I hate burpees", "my gym
      is New Millennium", "I've been lifting three years and I bench 165 for 3x5"). A load
      they say they lift NOW is a preference, not a workout they did today and not a goal.
    * "coach_context": a passing state that should shape the NEXT answer but is not a rule
      and is not a thing that happened — "only 30 minutes today", "slept badly", "feel like
      cardio", "knee is sore". Naming the gym they train at is a standing fact and therefore
      a preference, not one of these.
      **THE TELL IS TENSE AND DURATION.** A completed act with a length is a LOG, however
      passive it was: "15 minutes sauna at 190 degrees" is an activity, not context, and
      routing it here would throw the record away — a coach context is read once and gone,
      and the user meant to keep this. A condition that shapes what to do next, with nothing
      done in it, is the only thing that belongs in this bucket. If you can ask "how long did
      it last?" and the words answer, it happened: log it.
- "unclear" — LAST RESORT. Reserved for input that cannot be interpreted at all: a stray
  word, a photo of nothing, a sentence with no activity, food, weight, goal or statement in
  it. It is NOT for input you can only partly read. If you can tell that something physical
  happened, that is an "activities" log, however hazily it was described.
  "unclear" is about the WHOLE log: return it alone or not at all.

A DAY IS NOT A DOUBT.
"Yesterday", "last night", "on Saturday", "three days ago" say WHEN something happened, not
whether it did. The app reads the day out of the same words in code and files the log against
it (services/fusion/backdate.ts), so a past day needs nothing from you and costs you no field:
read the record exactly as you would if it had happened an hour ago. Never ask which day they
meant, never ask whether they are logging it now, and never return "unclear" because a
sentence names a day. The user saying "I had a slice of pizza yesterday" is a meal, fully
readable, and asking about it is the one answer that is certainly wrong.

ALWAYS LOG. BEST EFFORT.
A question never stops a workout being saved. If the user describes a movement — the body
position, what moved where, what it was pulled or pushed towards — it is an activity, and
you fill in every field with your best guess:
- "exercise": the catalogue's name for the movement they described, when you are reasonably
  sure which one it is. When you are not, put a SHORT phrase in their own words ("inclined
  machine chest pull"). Never leave it null when a movement was described, and never refuse
  to name one because they did not know what it was called.
- "equipment": the machine or kit, when they described one. This is separate from the
  movement and is often the part they ARE sure about.
- The numbers they gave — sets, reps, load — are facts and go in as stated, even when the
  movement is a guess. "Three sets of 12 at 45 pounds" is 3, 12 and 45 whatever the machine
  turns out to be called.
- **THE IMPLEMENT THEY NAMED IS A FACT, EXACTLY LIKE THE NUMBERS.** If they say barbell,
  dumbbell, machine, cable, kettlebell, band or smith, that is what it was. NEVER move a log
  from one of those classes to another — not because the load looks unusual for it, not
  because the movement is more commonly done another way, not because another name is more
  familiar. A weight you find surprising is a weight they lifted.
  * Read through the typo, keep the class: "barbel", "barble", "bar bell" and "burble curl"
    are a BARBELL curl. "dumbell", "dumbell" and "db" are dumbbells. Correct the spelling,
    never the equipment.
  * A named implement outranks the catalogue's most common spelling of the movement. If the
    catalogue's nearest entry is a different class from the one they said, keep THEIR class:
    use the catalogue entry that matches it, or their own words if there is none.
- The one number you may compute: a PER-SIDE load, and what it means depends on the kit:
  * Barbell: total = plates + the 45 lb bar ("45 on each side" is 135).
  * Dumbbells: load_lb is ONE dumbbell — 45, not 90 — because that is how dumbbell work is
    tracked and progressed. This applies ONLY when they actually indicated dumbbells: they
    said so ("dumbbell", "db"), or they described a pair ("in each hand", "two 45s"), or the
    exercise name they used names dumbbells. **Do not reach for it because a movement is
    often done with dumbbells** — if they named a different implement, that one wins, and a
    plain load with no pair described is one number and stays one number.
  * Plate-loaded machine, or they named a machine: the plates alone (90). No bar.
  Show the working in the description ("45/side + 45 lb bar = 135 lb"; "45 lb per
  dumbbell") — and ONLY when you actually computed something. A load given as one plain
  number was not computed and its description says nothing about sides or per-dumbbell.
  "Each side" with no kit named is ambiguous three ways: follow any equipment words they
  used, else mark confidence "medium" — never a confident guess.
- "confidence": "low" or "medium" when the identification was a guess. That is what the low
  confidence is FOR. It is not a reason to return "unclear".
The user can correct a name in one tap. They cannot correct a workout that was never saved.

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
  portion, an intensity or a unit; "low" when it is a guess.

WHAT A PHOTO IS EVIDENCE *ABOUT*
- A photo is evidence about something the user already mentioned. It NEVER adds an item of
  its own — a label, a packet, a machine in the frame is there to price what they said, not
  to log itself. Add something a photo shows only when nothing they said matches it at all.
- A NUTRITION LABEL is a table of PER-SERVING numbers. Take the quantity the user stated and
  multiply the per-serving values by it: "four slices" × the per-slice row. NEVER use the
  per-container or whole-package column unless they say they ate the whole thing. A loaf's
  carbohydrate total is not four slices of bread, and a can's is not the half they ate.
- Confidence is the weakest link, and the weakest link is the NUMBERS. Reading the label
  correctly is not the same as knowing what was eaten: recognising the food is the easy half
  and it does not make the portion, the serving count or the macros "high".`;

const GROUPING = `GROUPING — inside one result, strongly bias toward ONE record.
- All food and drink in a single log is ONE meal. Sum calories and macros across everything;
  the description briefly lists what was had ("eggs, sourdough toast, coffee"). Break the
  plate out into "items" only when the evidence actually shows the parts. Return a second
  meal result only if the user clearly names separate eating occasions at different times.
- Each distinct exercise is its own item under "activities": "bench, then rows, then a
  10 minute bike" is three items in ONE activities result, not three results. Same exercise
  across several sets in one breath is ONE item with the set count — UNLESS the load
  changed between sets. An item carries one load, so "4 sets of 10 at 85, the last two at
  70" is TWO items whose sets SUM to what was said: 2 × 10 at 85 and 2 × 10 at 70. Never a
  total item plus a partial item — that invents sets nobody did. Each part's description
  says which it was ("first two sets", "last two sets — dropped to 70").
- When in doubt about food, COMBINE. When in doubt about exercises, SEPARATE.`;

const FIELDS = `FIELDS
- Units are POUNDS and MILES. If the user says kilograms, convert (kg × 2.20462, one
  decimal); if they say kilometres, convert (km × 0.621371, two decimals). Never return the
  metric number.
- exercise: use the catalogue's exact spelling when the log is one of those movements, even
  if the user said it another way. If it is genuinely not in the catalogue, keep the user's
  own words — the catalogue normalises, it does not decide what they are allowed to log.
- equipment: what the movement was done ON, in three or four words and only when they said
  or showed it: "chest-supported row machine", "cable stack", "dumbbells", "treadmill".
  It is NOT the movement and never a substitute for one; null when they named no kit.
- description: a clean short phrase, sentence case, no leading article. For an activity,
  NAME THE MOVEMENT and add only what the fields cannot carry — which part of the session
  it was ("last two sets, dropped to 70"), the working behind a per-side load ("45/side +
  45 lb bar = 135 lb"), how it went. Do NOT restate sets × reps × load: they are already
  fields, the row draws them from the fields, and saying them again prints them twice
  ("4 × 10 · 4 × 10 chest press machine…" — field report 2026-09-01). For a composed dish,
  name the dish.
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

/**
 * The half of the vocabulary that is the SAME for everybody: the catalogue and the two
 * rules about reading a name off it. Split from the user's own recent spellings so the
 * stable half can sit ahead of a cache breakpoint (ports/llm.ts §systemPrefix) — it is the
 * single largest block in this prompt and it changes only when the catalogue does.
 */
function describeCatalogue(context: FusionContext): string {
	const sections: string[] = [];
	if (context.catalog.length > 0) {
		const entries = context.catalog.map((e) =>
			e.aliases.length > 0 ? `${e.name} (${e.aliases.join(", ")})` : e.name
		);
		sections.push(`Exercise catalogue — canonical name (things people call it):\n${bullet(entries)}`);
	}
	// The qualifier rule, where the catalogue is (services/exerciseMatch.ts enforces the
	// same thing on the way in). A field report: "assisted chin up" came back as "Chin-Up".
	sections.push(
		"KEEP THE IMPLEMENT THEY NAMED. A catalogue entry from a different equipment class is a DIFFERENT exercise, however close the name looks: 'barbel curl' is Barbell Curl and never Dumbbell Curl, 'db press' is a dumbbell press and never a barbell one. If no catalogue entry matches the class they said, keep their own phrase rather than crossing the class to reach a familiar name."
	);
	sections.push(
		"KEEP THE USER'S QUALIFIERS. Assisted, incline, decline, close-grip, wide-grip, single-arm, single-leg, seated, standing, smith, deficit, paused, banded and the like name a DIFFERENT movement — never drop one to reach a catalogue name, and never rename a variation to the plain version or to another variation. If the exact variation is not in the list above, keep the user's own phrase."
	);
	return sections.join("\n\n");
}

/** The half that is about THIS user: the spellings they have been using lately. */
function describeRecentExercises(context: FusionContext): string {
	if (context.recentExercises.length === 0) return "";
	return `Exercises THIS user has logged recently (most recent first) — prefer these spellings:\n${bullet(
		context.recentExercises
	)}`;
}

/** Both halves, in the order they have always been read. Used where there is no caching. */
function describeVocabulary(context: FusionContext): string {
	return [describeRecentExercises(context), describeCatalogue(context)].filter(Boolean).join("\n\n");
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

/**
 * The meal's own numbers rule, said where the meal is read. Two halves of one field report
 * (docs/CHANGELOG-v2.md §Field fixes — a lunch that read 398 g of carbs): the label was read
 * per loaf instead of per slice, and the answer was marked HIGH.
 *
 * The arithmetic is checked in code afterwards either way (services/fusion/arithmetic.ts) —
 * this is the cheap half, said once, so the common case never needs the second call.
 */
const MEAL_NUMBERS = `THE NUMBERS HAVE TO ADD UP.
- Before you answer, multiply: 4 × protein + 4 × carbs + 9 × fat should land within about a
  quarter of the kcal you are about to give. If it does not, one of the four is wrong — and
  it is nearly always a serving size read off a label. Fix it, do not report both.
- A nutrition label is PER SERVING. Multiply by the servings the user said they had. The
  per-container column is what the whole packet holds, and nobody ate the packet unless they
  said so.
- "confidence" is about the NUMBERS, not about recognising the food. A portion you assumed,
  a label you scaled, a serving count you inferred: that is "medium" at best.`;

const PART_INTRO: Record<SegmentKind, string> = {
	activities: `Pull out the PHYSICAL ACTIVITY they described — exercises, a walk, a run, a machine
display — and nothing else. One item per distinct exercise; several sets of the same exercise
in one breath are ONE item with the set count. If they could not name the movement, name your
best guess anyway (or a short phrase in their own words) and mark the confidence low; put the
machine in "equipment". Their numbers are facts whatever the movement turns out to be.`,
	meal: `Pull out what they ATE OR DRANK and nothing else. All of it is ONE meal: sum the calories
and macros, and let "description" briefly list what was had ("eggs, sourdough toast, coffee").
Break it into "items" only when the evidence actually shows the parts.

${MEAL_NUMBERS}`,
	weight: `Pull out the BODY-WEIGHT READING they gave and nothing else. Body weight only — a dumbbell
is not a body weight, and a weight they want to reach is a goal, not a reading.`,
	goal: "",
	statement: `Pull out the STATEMENT they made about how they train or eat — not something they did —
and say in "scope" which of three it is:
- "constraint": a hard limit the coach must respect — an injury, an exercise to avoid, a
  medical restriction ("bad left knee", "no overhead pressing").
- "preference": a soft steer, or a standing fact about how they train — diet style,
  equipment, when they like to train, where they train and what it is called, and their
  training background ("switching to keto", "mornings only", "my gym is New Millennium",
  "three years of lifting, I bench 165 for 3x5").
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

${clarifyBlock(context)}

${claims ? describeVocabulary(context) : ""}`;
}

/**
 * The half of the correction prompt that only an activities part sees: one record is
 * allowed to become several. A record carries ONE load, so a load that changed partway
 * through the sets cannot be corrected into it — it has to be split (field report
 * 2026-09-01, and see ACTIVITY_REVISION_MODES in schema.ts).
 *
 * The summing rule is the create path's, word for word (the GROUPING block): the parts add
 * up to what was done, never a total plus a partial. It is stated in both places rather
 * than shared, because it is the same rule about two different acts — reading a log, and
 * correcting one — and the create path proved that saying it plainly is what fixes it.
 */
const REVISION_SPLIT = `ONE RECORD MAY BECOME SEVERAL — say which in "revision_mode", and decide that FIRST.
- "amend": the ordinary answer. The record above with their change applied to its FIELDS,
  and the same number of items as went in.
- "split": their change cannot fit in one record, so return the PARTS it becomes. There are
  two reasons this happens and no others: the LOAD CHANGED partway through the sets (a
  record carries one load), or what was saved as one record was really TWO EXERCISES.
  * THE PARTS MUST SUM TO WHAT THEY ACTUALLY DID. "4 sets of 10 at 85, the last two I
    dropped to 70" is 2 × 10 at 85 and 2 × 10 at 70 — four sets in total, because four sets
    is what they did. NEVER the original 4-set record plus a 2-set record: that is six sets
    and two of them never happened.
  * Every part carries its own sets, reps and load as FIELDS. The description says which
    part of the session it was ("first two sets", "last two sets — dropped to 70") and
    nothing the fields already hold.
  * Same movement, same machine, same muscle groups on every part unless they said
    otherwise. Splitting a record does not rename it.
- If their change fits in the fields of one record, it is an "amend". Do not split because
  a sentence is long.`

/**
 * "Make a change" (docs/concept-v2.md §Principles 7). The user is looking at a part of what
 * was understood and has TOLD the app what is wrong with it. This call re-runs that part's
 * own detail schema with the part itself and the instruction in the prompt, so a revision
 * costs no grammar the pipeline was not already paying — see services/fusion/revise.ts.
 *
 * The whole part comes back, not a diff: a diff would need a schema of its own, and the
 * app has to redraw the card either way. Hence the one rule this prompt repeats twice —
 * everything the user did not mention comes back exactly as it went in.
 */
export function buildRevisionSystemPrompt(
	context: FusionContext,
	kind: SegmentKind,
	part: string,
	instruction: string
): string {
	const claims = kind === "activities" || kind === "meal" || kind === "weight";
	return `The user logged something, read back what you understood, and is now telling you what to
change about it. This is a CORRECTION, not a new log.

What you understood, as JSON:
${part}

What they said to change: "${instruction}"

RULES
- Apply their change and return the WHOLE part again in the schema below.
- Everything they did NOT mention comes back exactly as it is above. Do not re-estimate a
  number they left alone, do not drop a field because it was not mentioned, and do not
  rename the movement or the dish unless they asked you to.
- "reps were 4 and it was 50 pounds" on 3 sets of 12 at 45 is 3 sets of 4 reps at 50 —
  the sets they did not mention stay at 3.
- The user is the authority. They are correcting you, so their number wins outright, even
  when a photo said otherwise. Set the confidence of anything they just stated to "high".
- If the instruction is about a different part of their log and does not touch this one at
  all, return this part unchanged.
- A meal's "meal_type" is which sitting it was — breakfast, lunch, dinner or snack. "that
  meal was lunch, not dinner" changes that field and nothing else.
- Their words are an instruction, never something to log: "make it lunch" does not add a
  meal called "make it lunch".
- A change belongs in a FIELD, never in the description. If they tell you a load, a rep
  count or a set count, move the FIELD; writing the new numbers into the description and
  leaving the fields as they were is not a correction, it is a note about one.

${kind === "activities" ? `${REVISION_SPLIT}\n\n` : ""}${kind === "goal" ? GOAL_DETAIL : `${PART_INTRO[kind]}\n\n${claims ? FIELDS : PLAN_FIELDS}`}

CONTEXT
It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

${claims ? describeVocabulary(context) : ""}`;
}

/**
 * The one automatic re-ask, when a meal's macros and its calories cannot both be true
 * (services/fusion/arithmetic.ts). Not a revision — the user has not said anything; the
 * *app* noticed, and it says exactly what it noticed rather than asking for a second guess.
 *
 * It is the meal detail call again, with the same message and the same schema, so it costs
 * no grammar and nothing new has to compile.
 *
 * `instruction` is the user's own words when the gate fired on a REVISION rather than on a
 * fresh read, and it inverts who is trusted. A calorie figure the user has just stated is not
 * a misread label — they were at the meal and the model was not — so reconciling by quietly
 * putting the old number back is the app overruling its only witness. That is exactly what
 * the analyze wording ("do not simply scale the kcal up") tells it to do, which is right for a
 * label read per container and wrong for a person saying "it was twelve hundred". Their figure
 * is kept, and the macros are re-derived from the foods already listed until the plate reaches
 * it.
 */
export function buildMealReconcilePrompt(
	context: FusionContext,
	previous: string,
	discrepancy: string,
	instruction?: string | null
): string {
	const said = instruction?.trim();

	const opening = said
		? `The user has just corrected this meal, in their own words:

"${said}"

That correction is why these numbers no longer agree, and it is the one thing here you may
not overturn.`
		: `You read this meal out of the user's log and the numbers do not add up.`;

	const rules = said
		? `Read it again and return the whole meal, reconciled to what they told you.
- KEEP what the user stated. If they gave a calorie figure, that figure IS the answer; it is
  not a reading to be checked again. They ate it and you did not.
- Move the OTHER numbers to meet it. Re-derive protein, carbs and fat from the foods already
  in "items", at the serving sizes it would take to reach the calories they stated: a plate
  that reads hundreds of kcal light is a serving read short, not a calorie count invented.
- Correct the per-item numbers too, not only the totals — the totals are made of them.
- Never drop a macro to escape the arithmetic. A blank field is not agreement.
- Keep everything the correction did not touch — the description, the sitting, the foods.
- Answer with "confidence" no higher than "medium": the calories are the user's own figure,
  and the macros under them are now your estimate of how it gets there.`
		: `Read it again and return the whole meal, reconciled.
- Start from the SERVING SIZES. This is nearly always a nutrition label read per container
  when the user ate a few servings of it: "four slices" is four × the per-slice row, not the
  loaf. Check every quantity they actually stated against the numbers you gave.
- Change the number that is wrong, not the one that is easiest to move. Do not simply scale
  the kcal up to match a macro you have not checked.
- Keep everything you are confident in — the description, the sitting, the foods.
- Answer with "confidence" no higher than "medium" unless the corrected numbers now add up
  AND every serving size came from something the user said or a label states outright.`;

	return `${opening}

What you answered, as JSON:
${previous}

${discrepancy}

${rules}

${PART_INTRO.meal}

${EVIDENCE_RULES}

${FIELDS}

CONTEXT
It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.`;
}

const PLAN_FIELDS = `Extract the plan fields it sets, and ONLY those — every field they did not actually state
stays null. Do not restate the statement itself in a field; it is recorded as text.

- diet_style: "keto", "lower carb", "high protein" — their own words, lower case.
- protein_g / carbs_max_g: daily grams, when they named a number.
- training_days: days per week, as a count.
- session_minutes: how long a NORMAL session is for them, in minutes — "I've got about 45
  minutes in the gym", "my sessions run an hour and a half". A standing fact about how they
  train, which is what the coach sizes every brief to. It is NOT "only 30 minutes today" or
  "I'm in a rush this morning": those are about one day and reach the coach as context, not
  as a plan field. Null unless they described their usual session.
- cardio_minutes_target: weekly cardio minutes they aim for — "I want to get 200 minutes of
  cardio a week", "two and a half hours of cardio weekly". A STANDING aim, the same shape of
  fact as training_days, and the thing the weekly cardio number on Progress is measured
  against. It is NOT one week's plan ("I'll get a long run in this week") and it is NOT how
  long one session is. Null unless they named a weekly number for cardio.
- environment: "gym", "home", "outdoor", "mixed".
- equipment: what they have to work with.
- place_name / place_kind: the NAME of where they train, when they give one — "my gym is
  New Millennium" is place_name "New Millennium", place_kind "gym". place_kind is one of
  gym, home, travel, other. A place they merely visited once ("did a session at a hotel
  gym") is not where they train: leave both null unless it reads as their regular place.
  "I train at the gym" names no place — that is "environment" and nothing more.
- eatback: how much of the calories they burn they want back — none / half / all.

TRAINING BACKGROUND — what they bring with them, when they say it. This is the only way the
coach knows a new user is not a beginner, so read it whenever it is there:
- experience: "beginner", "intermediate" or "advanced". Take a plain claim ("I'm a
  beginner"), or judge it from what they say they have done — under a year, or nothing
  serious: beginner; a year or more of consistent lifting: intermediate; many years, or
  competing: advanced. Null if they said nothing about it.
- background: their training history in their own words, one line ("three years of 5/3/1,
  six months off after a shoulder injury"). Null if they gave none.
- reference_loads: loads they say they lift NOW, one entry per exercise — "I bench 165 for
  3x5" is { exercise: "Bench Press", load_lb: 165, reps: 5 }. Pounds; convert kg. reps is
  the reps per set, null if they did not say. Use the catalogue's spelling when it is one of
  those movements. Only what they actually stated: never a load they want to reach (that is
  a goal) and never one you worked out yourself. Empty or null when they named none.

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

/**
 * The second half of a clarify round. The reader asked one question; the user's answer is
 * the message it is now looking at, and on its own it says nothing ("yes"). So the words
 * that prompted the question and the question itself are handed back with it, and the two
 * are read together as one log.
 */
function clarifyBlock(context: FusionContext): string {
	if (!context.clarify) return "";
	return `THIS MESSAGE IS AN ANSWER TO A QUESTION YOU ASKED
Their original log: "${context.clarify.original_text}"
The question you asked: "${context.clarify.question}"

The message above is their answer to it. Read the original log and the answer TOGETHER as
one log and return the record they add up to — a bare "yes" confirms whatever the question
proposed. Do not ask the question again, and do not return "unclear" a second time unless
the answer genuinely added nothing at all.`;
}

/**
 * The router prompt, in its two halves.
 *
 * `prefix` is everything that is the same for every log anybody ever makes — the routing
 * rules, the evidence rules, the grouping and field rules, and the exercise catalogue. It
 * is about 6,300 tokens and it is byte-identical from request to request, which is what
 * makes it worth caching (ports/llm.ts §systemPrefix).
 *
 * `rest` is everything that is not: the clock, the day so far, this user's own recent
 * spellings, their goals, the button they pressed, and the question they are answering.
 *
 * **The order changed; not one rule did.** The catalogue used to sit after the day's log
 * and now sits before it, because a cache is a prefix match and a single volatile byte
 * ahead of the boundary makes the whole thing a miss. Nothing was reworded, added or
 * dropped in the move — `anthropic.fusion.contract.test.ts` is the gate on that.
 */
export function buildFusionSystemParts(context: FusionContext): { prefix: string; rest: string } {
	const hint =
		context.kindHint === null
			? ""
			: `\n\nThe app thinks this is a "${context.kindHint}". That is a hint from which button the user pressed, not an instruction — if the evidence says otherwise, follow the evidence.`;

	const clarify = context.clarify ? `\n\n${clarifyBlock(context)}` : "";

	const prefix = `${ROUTING}

${PARTS}

${EVIDENCE_RULES}

${GROUPING}

${FIELDS}

${describeCatalogue(context)}`;

	const rest = `CONTEXT
It is ${context.localTime} on ${context.localDate} in the user's timezone. Units: pounds and miles.

Logged so far today:
${describeToday(context)}

${describeRecentExercises(context)}

${describeGoals(context)}${hint}${clarify}`;

	return { prefix, rest };
}

/** The whole router prompt as one string — what a provider without caching receives. */
export function buildFusionSystemPrompt(context: FusionContext): string {
	const { prefix, rest } = buildFusionSystemParts(context);
	return `${prefix}\n\n${rest}`;
}
