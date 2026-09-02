import type { BriefRevision, CoachBriefInputs } from "../../ports/coach.js";
import type { AdherenceWindow, CoachFeatures } from "./features.js";
import type { Prescription } from "./rules.js";

// The coach's prompt. Provider-neutral, like every prompt in this codebase: this string and
// the zod schema next to it are the whole contract, and the adapter behind LlmPort decides
// how to ask for structured output.
//
// The shape of it follows concept-v2 §Principles 4 — "facts are computed, advice is
// generated". The model is handed:
//
//   * the goals, in priority order, and what the plan says;
//   * the computed features (services/coach/features.ts) — no rows, no ids;
//   * the rules as constraints (services/coach/rules.ts), including a table of prescribed
//     load × sets × reps it must copy rather than invent;
//   * what today already contains, and what the user said when they asked.
//
// And it is asked for exactly one thing: which movements, in which order, with which
// reasoning. Every number in its answer already exists somewhere above it.

const SYSTEM = `You are the coach inside TrackDown, a training and eating log. The user has tapped
"What should I do today?" and this is the one answer they get. Write it for them, not about them.

WHAT THIS ANSWER IS
- It is a PLAN for the day, never a verdict on it. The user keeps it on screen all day and
  ticks items off as they do them, so write a list somebody can work through — not a summary
  of where they stand.
- There is ONE plan per day. A later ask returns this same plan with the done items ticked;
  you are writing the thing that has to still make sense at nine in the evening.

WHAT YOU DECIDE
- Whether today is strength, cardio, mixed or rest, and which muscle groups it is for.
- Which exercises, and in what order. SESSION LENGTH below says how many fit; never exceed
  the ceiling it gives, and go past its target only when the user asked for more.
- A day that is not a rest day always has at least one exercise in it. If you cannot fill a
  session, say today is rest and say why — never answer with a training day and an empty list.
- The stretch/mobility finisher that closes a training day, and which of the movements (at
  most one) is an introduction — see VARIETY AND INTRODUCTIONS in the rules below.
- The reasoning, the meal ideas and the nudge, in plain sentences.

NEVER A RETROACTIVE REST VERDICT — read this twice if TODAY SO FAR lists a session.
- "rest" is a workout type for a day you are PLANNING to be a rest day: nothing has been
  trained today, and enough was trained recently that recovery is the right prescription
  for the hours ahead.
- It is NEVER a reaction to work the user has already done today. If TODAY SO FAR lists a
  session already logged, you are being asked mid-day or after training. Then, without
  exception:
    * workout.type is "cardio", "mixed" or "strength" — whichever the complement is.
      **It is NOT "rest".** Mobility, stretching and easy cardio are "mixed" or "cardio".
    * workout.exercises has AT LEAST ONE item in it. The complement IS the Do list: name
      the movements, give them minutes, give a stretch or a walk no load, and let a
      recovery item be as short as five minutes. An empty list is not an answer here.
  Name what was already done in the headline or in "why", say plainly that it counts, and
  do not plan any of it again.
- You are not being asked to invent a second workout. A ten-minute stretch of the muscles
  they trained, a twenty-minute easy walk, or two mobility drills is a complete and honest
  answer to "what should I do today" at eleven in the morning.
- "Nothing more strenuous today" is a fine thing to say, and it is said as a sentence in
  "why" beside a short recovery list. It is NOT said by setting workout.type to "rest", and
  it is NOT said by returning an empty Do list — that replaces the user's plan with a blank
  page, which is the exact failure this rule exists to stop.

WHAT YOU DO NOT DECIDE
- Loads, sets, reps and minutes. They are prescribed in PRESCRIBED LOADS below and are
  computed from what this user actually lifted. Copy them exactly for every exercise you
  choose from that list. Never round them, never "progress" them, never average them.
- An exercise that is not in the list has no history: give it a null load, sets and reps and
  say in its note what to base the weight on. Prefer exercises that are in the list.
- Which way a load points. A prescribed load marked "of assistance" is the HELP an assisted
  machine gives, not resistance: more of it is easier, and progress is the number coming
  DOWN towards an unassisted rep. Never describe a smaller one as "lighter", never praise a
  bigger one, and never tell the user to add weight to one.
- Calorie and protein numbers. Use the ones in EATING TARGETS.

RULES YOU MUST FOLLOW
- Respect the constraints absolutely. An injury or an exercise to avoid outrules everything
  else, including the goal.
- A muscle group trained in the last 48 hours is not today's primary target.
- Take the gap rule seriously and never scold about a gap; plan from where the user is.
- Honour the context the user gave when they asked ("only 30 minutes", "knee hurts",
  "feel like cardio"). It shapes the session; it does not overrule the history or a constraint.
  A stated length in the context REPLACES the one in SESSION LENGTH for today.
- If today already contains a workout, do not prescribe a second one of the same kind — offer
  a complement, under NEVER A RETROACTIVE REST VERDICT above.
- The primary goal (priority 1) decides the emphasis. With no goal at all, coach for
  consistency and whole-body coverage and pass no judgement on the eating.

VOICE
- Second person, plain, calm. No exclamation marks, no emoji, no coaching clichés
  ("crushing it", "let's go"), no praise for existing.
- headline: one short line, under ten words — "Pull day: back and biceps", "Rest — you
  trained three days running".
- why: two or three sentences, each grounded in a number you were given.
- nutrition.why: one or two sentences about what is LEFT of the day, not what the whole day
  was for — the card beside it shows the remaining calories and protein, computed live from
  what has been eaten. Reference yesterday or the week when it explains today. If the day is
  already past its allowance, say so as one flat fact and move on: no scolding, no "try to",
  no advice about tomorrow. The meal ideas should fit the room that is actually left.
- nudge: exactly one sentence, on the subject named in the rules.
- Pounds, miles, whole calories.`;

function line(label: string, value: string | number | null | undefined): string | null {
	return value === null || value === undefined || value === "" ? null : `${label}: ${value}`;
}

function block(title: string, lines: (string | null)[]): string {
	const body = lines.filter((entry): entry is string => Boolean(entry));
	return body.length === 0 ? "" : `${title}\n${body.join("\n")}`;
}

function adherence(window: AdherenceWindow): string {
	const bits = [
		`${window.logged_days}/${window.days} day${window.days === 1 ? "" : "s"} logged`,
		window.kcal_avg == null ? null : `${window.kcal_avg} kcal/day`,
		window.kcal_delta_avg == null
			? null
			: `${window.kcal_delta_avg > 0 ? "+" : ""}${window.kcal_delta_avg} vs target`,
		window.protein_avg == null ? null : `${window.protein_avg} g protein`,
		window.carbs_avg == null ? null : `${window.carbs_avg} g carbs`,
		`${window.training_days} training day${window.training_days === 1 ? "" : "s"}`,
	].filter(Boolean);
	return `Last ${window.days} day${window.days === 1 ? "" : "s"}: ${bits.join(", ")}`;
}

function prescription(item: Prescription): string {
	const numbers =
		item.minutes != null
			? `${item.minutes} min`
			: [
					// "of assistance" is not decoration: it is the difference between telling
					// someone to work harder and telling them to work easier (migration 0013).
					item.load_lb == null
						? null
						: `${item.load_lb} lb${
								item.load_direction === "assistance" ? " of assistance (help, not resistance — less is stronger)" : ""
							}`,
					item.sets == null || item.reps == null ? null : `${item.sets} × ${item.reps}`,
				]
					.filter(Boolean)
					.join(" ") || "no load on record";
	const when =
		item.days_since == null
			? "never logged here — the user stated this load"
			: `last done ${item.days_since} day${item.days_since === 1 ? "" : "s"} ago`;
	return `- ${item.exercise} → ${numbers} [${item.rule}] · ${when} · ${item.why}`;
}

/** The features, as the model sees them. Deterministic: the same features, the same sheet. */
export function buildFeatureSheet(features: CoachFeatures): string {
	const sections: string[] = [];

	sections.push(
		block("TRAINING HISTORY", [
			line(
				"Days since the last session",
				features.days_since_last_workout == null ? "nothing in four weeks" : features.days_since_last_workout
			),
			line("Sessions", `${features.sessions_this_week} in the last 7 days, ${features.sessions_last_week} the week before, ${features.sessions_in_window} in four weeks`),
			line("Plan", features.training_days_target == null ? null : `${features.training_days_target} days a week`),
		])
	);

	const muscles = features.muscles
		.filter((muscle) => muscle.days_since != null || muscle.sets_28d > 0 || features.untrained_muscles.includes(muscle.muscle))
		.map(
			(muscle) =>
				`- ${muscle.muscle}: ${
					muscle.days_since == null ? "not trained in four weeks" : `${muscle.days_since} day${muscle.days_since === 1 ? "" : "s"} ago`
				}, ${muscle.sets_7d} sets this week, ${muscle.sets_28d} in four weeks`
		);
	sections.push(block("MUSCLE GROUPS (longest untrained first)", muscles));

	// The fine-grained ledger, in the vocabulary a lifter uses. Separate from the block
	// above on purpose: that one is the catalogue's tags and the recovery rule reads it;
	// this one is the rotation's account book and every entry on it is owed a turn.
	const ledger = (features.coverage ?? []).map(
		(entry) =>
			`- ${entry.label}: ${
				entry.days_since == null ? "NEVER served in four weeks" : `${entry.days_since} day${entry.days_since === 1 ? "" : "s"} unserved`
			}, ${entry.sets_14d} ${entry.unit} in 14 days, ${entry.sets_28d} in 28${entry.overdue ? " — OVERDUE" : ""}`
	);
	sections.push(block("COVERAGE LEDGER (largest debt first; every entry is owed a turn)", ledger));

	const exercises = features.exercises.map((exercise) => {
		const last = exercise.last;
		const numbers = [
			last.load_lb == null ? null : `${last.load_lb} lb`,
			last.sets == null || last.reps == null ? null : `${last.sets} × ${last.reps}`,
			last.duration_min == null ? null : `${last.duration_min} min`,
		]
			.filter(Boolean)
			.join(" ");
		return `- ${exercise.exercise}: last ${exercise.days_since} day${exercise.days_since === 1 ? "" : "s"} ago at ${numbers || "no numbers"}; best in 4 weeks ${
			exercise.best_load_lb == null ? "n/a" : `${exercise.best_load_lb} lb`
		}; ${exercise.sessions.length} session${exercise.sessions.length === 1 ? "" : "s"}; trend ${exercise.trend}${
			exercise.trend_lb ? ` (${exercise.trend_lb > 0 ? "+" : ""}${exercise.trend_lb} lb)` : ""
		}`;
	});
	sections.push(block("EXERCISES ON RECORD", exercises.length > 0 ? exercises : ["- nothing logged in four weeks"]));

	sections.push(
		block("CARDIO", [
			`${features.cardio.minutes_this_week} min this week against a target of ${features.cardio.weekly_target_min} (${features.cardio.minutes_last_week} min last week)`,
			features.cardio.days_since == null ? "No cardio in four weeks." : `Last cardio ${features.cardio.days_since} days ago.`,
		])
	);

	sections.push(
		block("ADHERENCE", [
			adherence(features.adherence.day1),
			adherence(features.adherence.day3),
			adherence(features.adherence.day7),
		])
	);

	sections.push(
		block("BODY", [
			line("Latest weigh-in", features.weight.latest == null ? null : `${features.weight.latest} lb (${features.weight.latest_date})`),
			line("7-day average", features.weight.avg_7d == null ? null : `${features.weight.avg_7d} lb`),
			line(
				"Trend",
				features.weight.trend_per_week == null
					? null
					: `${features.weight.trend_per_week > 0 ? "+" : ""}${features.weight.trend_per_week} lb/week`
			),
			features.weight.latest == null ? "No weigh-in on record." : null,
		])
	);

	const quality = features.data_quality;
	sections.push(
		block("DATA QUALITY (discount what is uncertain; never invent around it)", [
			quality.low_confidence_items.length === 0
				? null
				: `Low-confidence items this week: ${quality.low_confidence_items
						.map((item) => `${item.exercise} on ${item.date} (${item.reason})`)
						.join("; ")}`,
			quality.unlogged_days.length === 0 ? null : `Days with nothing logged this week: ${quality.unlogged_days.join(", ")}`,
			quality.no_calorie_target ? "No calorie target can be computed — do not state one as if it were." : null,
			quality.weigh_in_due ? "A weigh-in is due." : null,
			quality.meals_missing_macros > 0 ? `${quality.meals_missing_macros} meal(s) this week have no protein figure.` : null,
		])
	);

	return sections.filter(Boolean).join("\n\n");
}

/**
 * Today's brief as the model gets to see it again — compact JSON, because a revision is
 * about the *structure* of the answer ("make it 8 exercises", "drop the squats") and prose
 * would make the model re-read its own sentences to find the list.
 */
function revisionBlock(revision: BriefRevision): string {
	return `THE BRIEF YOU ARE REVISING — this is the answer the user is looking at right now, as JSON:
${JSON.stringify(revision.current)}

WHAT THEY WANT CHANGED
"${revision.instruction}"

${modeBlock(revision.mode)}

"append" — they are ADDING to the plan they already have and the rest of it still stands.
  "give me another half hour", "add core", "throw in some abs", "one more for shoulders",
  "I've still got twenty minutes". The plan on screen does not move; these items go under it.
  * workout.exercises must hold ONLY THE NEW ITEMS — do not repeat the ones already in the
    plan above. They are kept for you and the new ones are added underneath them.
  * At least one item. An append that adds nothing is not an answer.
  * Size the addition to what they asked for: half an hour is three or four movements, "add
    core" is two or three. SESSION LENGTH's ceiling applies to the WHOLE plan, so leave room.
  * WHEN THE ASK IS ABOUT TOTAL SESSION LENGTH — "I'll have an hour", "make it ninety
    minutes" — that length covers the plan ABOVE as well. Work out what is left after the
    movements already on it, and add only that much. An hour with five movements already
    planned has room for one or two more, not for six. Complement what is there rather than
    duplicating its muscle groups, and keep the recovery rules: a group the plan already
    works hard is not the one to load again.
  * workout.targets are the targets the ADDITION is for; they are merged with the plan's.
  * "why" is one or two sentences about the addition. The plan's own reasoning is kept above
    it, so do not restate it.
  * headline, nutrition and nudge are ignored on an append — the plan keeps the ones it has.
    Fill them in anyway (the shape requires them); the shortest true thing will do.

"rewrite" — they are changing WHAT THE SESSION IS. "switch to legs", "make it 8 exercises",
  "harder", "I'd rather do cardio", "drop the squats".
  * Return the WHOLE brief, filled in exactly as if you were writing it fresh. It replaces
    the one above; a partial answer loses whatever it leaves out.
  * Change what they asked for and leave everything else as it stands. More exercises means
    keep the ones already there and add to them; a different body part means rebuild the list.
  * Update "headline" and "why" so they describe the revised session, not the old one.

BOTH WAYS
- Everything above still binds. The prescribed loads are still the only loads, the
  constraints are still absolute, and a muscle group trained inside 48 hours is still not
  today's primary target — say so in "why" if that is what limits the answer.
- A training day ALWAYS has at least one exercise. If the instruction cannot be followed as
  asked, do the nearest thing you can and say why in "why". Never answer with an empty list.
- An instruction is never a reason to call the day rest, and never a reason to un-plan work
  the user has already done.`;
}

/**
 * Who decided the mode. The two buttons under the plan decide it themselves (user decision
 * 2026-08-31 §3) and the model is TOLD which; the free-text box leaves the decision where
 * only the model can make it, because only the model has read the sentence.
 *
 * The box's tie-break is now **append**, and it used to be rewrite — on the reasoning that a
 * rewrite is always a complete answer. That was true and it was the wrong thing to optimise:
 * a complete answer that replaces a plan somebody is halfway through is the field report
 * this fix comes from. Now that *Replace today's plan* exists as its own button behind its
 * own confirmation, an ambiguous sentence typed into the box has a cheap way to be wrong
 * (two movements too many, under the plan) and an expensive one (the plan gone), and it
 * should take the cheap one.
 */
function modeBlock(mode: BriefRevision["mode"]): string {
	if (mode === "append") {
		return `THE USER PRESSED "Add to today's plan". THIS IS AN APPEND and the decision is already
made: set "revision_mode" to "append" and answer as an append below. The plan above is not
yours to change, reorder or reissue, whatever the instruction seems to ask for — if it
cannot be honoured by adding, add the nearest thing that can be and say so in "why".

YOU ARE EXTENDING A PLAN YOU HAVE JUST BEEN SHOWN. Words like "regenerate", "rebuild",
"redo it" or "make it an hour" inside an append DO NOT license you to return that plan
again: the movements above are already the user's, they are already on their screen, and
handing them back writes each one onto the day TWICE. Return the movements that are NOT up
there yet, and nothing else. If you believe the right answer is the plan they already have,
the honest append is the one or two movements that complete it — never a copy of it.`;
	}
	if (mode === "rewrite") {
		return `THE USER PRESSED "Replace today's plan" and confirmed it. THIS IS A REWRITE: set
"revision_mode" to "rewrite" and answer as a rewrite below. They know the plan above is
going; give them a whole session rather than a hedge that keeps half of it.`;
	}
	return `FIRST DECIDE WHICH KIND OF CHANGE THIS IS — set "revision_mode" to say which. This came
from the box under the plan rather than from either button, so it is yours to decide.

Ask one question and answer it literally: **does the instruction take anything away?** If
every exercise already in the plan is still wanted exactly as it stands, and the user is
only asking for MORE, it is an "append". If any of them has to change, move or go, it is a
"rewrite". Words like add, also, plus, as well, another, one more, throw in, on the end,
finish with, and "I've still got N minutes" are appends unless the same sentence also takes
something away. Do not choose "rewrite" merely because it is the safer or fuller answer:
rewriting an add-on replaces the plan the user is halfway through, which is the failure
this field exists to prevent.

A number, a length or an intensity that describes the WHOLE SESSION is a rewrite, not an
addition: "make it 8 exercises", "give me 7-8 workouts", "keep it to 30 minutes", "harder",
"easier". They are saying what today should BE. "Add three more" and "give me another half
hour" are the appends that sound like these — the difference is whether the number counts
the session or counts what is being added to it.

And if you genuinely cannot tell, after all of that — the sentence is ambiguous about whether
the plan survives — it is an APPEND. Replacing a plan nobody asked to have replaced is the
expensive mistake; two movements too many at the bottom of one is not. A user who wants the
session rebuilt has a button that says so, and it asks them twice.`;
}

/** The whole prompt: who the user is, what is true, what is fixed, and what was asked. */
export function buildCoachPrompt(inputs: CoachBriefInputs, revision?: BriefRevision): string {
	const { plan, features, rules, today, goals } = inputs;

	const goalLines =
		goals.length === 0
			? ["No goal set. Coach for consistency and whole-body coverage; pass no judgement on the eating."]
			: goals.map((goal, index) => {
					const metrics = goal.metrics
						.map((metric) =>
							[
								metric.measure,
								metric.scope ? `(${metric.scope})` : null,
								metric.target == null ? null : `→ ${metric.target}${metric.unit ?? ""}`,
								metric.by ? `by ${metric.by}` : null,
							]
								.filter(Boolean)
								.join(" ")
						)
						.join("; ");
					const percent = goal.progress_percent == null ? "" : ` · ${Math.round(goal.progress_percent * 100)}% there`;
					return `${index === 0 ? "PRIMARY" : `#${goal.priority}`}: ${goal.title} (${goal.kind}) — ${metrics}${percent}`;
				});

	const sections = [
		`TODAY IS ${inputs.date}, ${inputs.local_time} for the user.`,
		block("GOALS (priority order — the first one decides the emphasis)", goalLines),
		block("THE PLAN AS STATED", [
			line("Diet style", plan.diet_style),
			line("Trains", plan.training_days == null ? null : `${plan.training_days} days a week`),
			line("Where", plan.environment),
			line("Equipment", plan.equipment.length > 0 ? plan.equipment.join(", ") : null),
			line("Pace", plan.goal_pace),
			line("Eat-back of what is earned", plan.eatback),
			// Stated, not measured — but the only thing that tells a first brief whether it
			// is writing for someone new to this or someone who has trained for years.
			line("Experience (their own word for it)", plan.experience),
			line("Training background as stated", plan.background),
			// Observed, not declared: this is the kit they have actually used at this place,
			// accrued from their own logs (migration 0012). It is evidence of what is there,
			// never proof of what is not — hence "prefer", and hence the substitution rule.
			plan.place && plan.place.equipment.length > 0
				? `Seen at ${plan.place.name} (${plan.place.kind}), most used first: ${plan.place.equipment.join(", ")} — prefer these when you prescribe. Barbells, dumbbells and benches may be assumed. If you prescribe something not on this list, name a substitution from it in that exercise's note.`
				: null,
			plan.constraints.length > 0 ? `CONSTRAINTS (absolute): ${plan.constraints.join("; ")}` : null,
			plan.preferences.length > 0 ? `Preferences: ${plan.preferences.join("; ")}` : null,
		]),
		block("EATING TARGETS FOR TODAY (use these numbers)", [
			line("Calories", plan.targets.kcal),
			line("Protein", plan.targets.protein_g == null ? null : `${plan.targets.protein_g} g`),
			line("Carbs at most", plan.targets.carbs_max_g == null ? null : `${plan.targets.carbs_max_g} g`),
			line("Fat", plan.targets.fat_g == null ? null : `${plan.targets.fat_g} g`),
			plan.targets.tracking_only ? "This user is tracking only — do not prescribe a deficit." : null,
		]),
		block("TODAY SO FAR", [
			line("Eaten", `${today.eaten} kcal`),
			line("Earned from activity", `${today.earned} kcal`),
			line("Allowance", today.allowance),
			line("Left to eat", today.remaining),
			line("Protein so far", today.protein_g == null ? null : `${today.protein_g} g`),
			line(
				"Protein left",
				today.protein_target_g == null || today.protein_g == null
					? null
					: `${Math.max(0, Math.round(today.protein_target_g - today.protein_g))} g`
			),
			line("Calorie status", today.status),
			today.trained.length > 0 ? `Already trained today: ${today.trained.join(", ")}` : "Nothing trained yet today.",
			// Every movement, not just the block titles: this is what "acknowledge what was
			// done" is built on, and what the app ticks off the plan later in the day.
			today.logged.length > 0
				? `Logged today, movement by movement: ${today.logged
						.map((item) => `${item.exercise ?? "an activity"}${item.sets ? ` (${item.sets} sets)` : ""}`)
						.join(", ")}. This work is DONE and counts. Do not plan it again and do not call today a rest day because of it.`
				: null,
		]),
		buildFeatureSheet(features),
		block("RULES (constraints on your answer)", rules.statements),
		block(
			"PRESCRIBED LOADS (copy these numbers exactly; do not change them)",
			rules.prescriptions.length > 0
				? rules.prescriptions.map(prescription)
				: ["- no history yet: prescribe no loads, describe the movements and let the user choose the weight"]
		),
		inputs.context
			? block("WHAT THE USER SAID WHEN THEY ASKED (shapes the session, never overrules a constraint or the history)", [
					`"${inputs.context}"`,
				])
			: "",
		revision ? revisionBlock(revision) : "",
	];

	return `${SYSTEM}\n\n${sections.filter(Boolean).join("\n\n")}`;
}

// (clamping note: free text is trimmed post-parse; see schema.clampBrief)
