import { createHash } from "node:crypto";
import { FIBER_BAND, PROTEIN_PER_LB, type EatingWeek, type MacroAverage } from "../eating/features.js";
import { formatClock, localMinutesOf } from "../localTime.js";
import type { DayView } from "../day.js";
import type { IsoDate } from "../localTime.js";
import type { CoachFeatures } from "../coach/features.js";

// The reading prompts. Provider-neutral, like every prompt in this codebase: the string and
// the zod schema next to it are the whole contract and the adapter behind LlmPort decides
// how to ask for structured output.
//
// The model is handed the *computed* day — totals, blocks, deltas, the verdict, the slots
// nothing has been logged into — and never the raw rows. That is docs/concept-v2.md
// §Principles ("facts are computed, advice is generated") applied to the smallest possible
// generation: two sentences. It also keeps the call cheap and its answer stable, because
// the same day always produces the same sheet.

const VOICE = `VOICE
- Second person, plain, calm. No exclamation marks, no emoji, no coaching clichés
  ("crushing it", "let's go"), no praise for existing.
- Never scold. A gap or a meal nobody ate is information, not a failing.
- NOTHING IS OWED. The user logs what happened; the app never keeps a list of what they
  were supposed to do. Never write that a meal is "due" or "expected", that anything is
  "missing", or that the user "still needs to" or "should" log something. An empty slot is
  not a debt and the day is not waiting for anything.
  - Not this: "Dinner is due." / "You still need to log dinner." / "Lunch is missing."
  - This: "A ~650 kcal, 45 g-protein dinner would close today's targets." / "You are
    620 kcal and 45 g of protein short of the day's numbers."
  Arithmetic about what would close the gap is a fact and is welcome. An instruction to go
  and eat is not.
- Use the numbers you are given and no others. Do not invent a food, an exercise or a
  target that is not on the sheet. If a number is missing, say what you do know instead.
- Pounds and miles. Round calories to whole numbers.`;

const RIGHT_NOW = `You are writing the "Right now" line on TrackDown's Today screen: the one thing the user
should read before deciding what to do next.

- Exactly one or two sentences. The first says where the day stands; the second, if there is
  one, says what is left of the day's numbers — as arithmetic, not as an instruction. Never
  more.
- Then pick ONE next action from: log_meal, weigh_in, workout, coach (ask for a plan — the
  right answer when the day is on track and the next move is a workout choice). The chip is
  a shortcut to a screen, not a reminder: pick the one that fits where the day stands. The
  OPEN SLOTS list says which screens are still worth a tap.
- actions: up to two more chips the user might reasonably tap instead. Never repeat the
  next action's kind.
- The chip's label is a place, not an order: "Log a meal", not "You need to eat".

${VOICE}`;

const IN_SHORT = `You are writing the "In short" paragraph for a day that has closed. It is read days later,
when the user has forgotten the day itself.

- Two or three sentences, past tense. What was trained, how the eating went against the
  goal, and the one thing worth remembering (a load that went up, a gap, a weigh-in).
- Judge only against the goal that was active that day, which is on the sheet. If there was
  no goal, describe the day without a verdict.
- No advice and no next action: the day is over. This is a record, not a nudge.

${VOICE}`;

const DOSSIER = `You are writing "What I know about you" — the two paragraphs at the top of TrackDown's You
screen. They replaced a grid of rows ("Days a week — 4", "Diet style — keto"), every one of
which was true and none of which read as a person.

- EXACTLY TWO PARAGRAPHS, two or three sentences each. No headings, no bullet points, no
  dashes standing in for bullets, no lists of any kind. Prose the user could have said out
  loud about themselves.
- The FIRST paragraph is what is known: the facts they have stated, blended with the
  patterns their log actually shows. Blended, not two halves — "you train four days a week
  and it shows up as three or four most weeks" is one sentence about one person, and it is
  worth more than either half of it alone. Prefer the specific: a lift that moved, the place
  they train, a weekly rhythm, a constraint they gave you.
- The SECOND paragraph is what is missing, and every sentence in it is an INVITATION WITH
  THE BENEFIT ATTACHED. Say what telling you would buy them. Never say that they have failed
  to tell you something.
  - Not this: "You haven't told me how long your sessions are." / "Your profile is missing a
    cardio target." / "I still need your height."
  - This: "Tell me how long a session usually runs and I can size each plan to fit it." /
    "Name a weekly cardio number and I can measure the week against yours instead of a
    guideline."
- If there is genuinely nothing worth asking for, say what the next few weeks of logging
  would let you see instead. The second paragraph is never empty and never an apology.
- INVENT NOTHING. Every fact and every number must be on the sheet below. Do not name a
  weight, a load, a target or a count that is not written there, and do not guess at a reason
  for something the sheet does not explain. Where the sheet says nothing, that is a candidate
  for the second paragraph, not a gap to fill in.
- A guideline is not something they said. The sheet marks which numbers were stated and which
  are standing in; never hand a default back to the user as their own.

${VOICE}`;


const EATING_DIRECTION = `You are writing "The direction" on TrackDown's Eat page: a short paragraph telling the user
which way to steer their NUTRIENTS over the coming days, from a week of their own numbers.

- Two or three sentences. Nutrients only — protein, carbohydrate, fat, fibre, calories — and
  the direction to move each one.
- **NEVER PRESCRIBE A DISH, A MEAL OR A FOOD.** Not "have salmon and quinoa", not "try Greek
  yoghurt", not a breakfast idea, not an example plate. The user was explicit about this:
  "it doesn't have to be a dish… general direction of nutrients." Naming foods is the one
  thing this paragraph is not for. Say "another 30 g of protein a day, spread across the
  meals you already eat" — never what to cook.
- Lead with whatever is furthest from where it should be. If everything is in range, say so
  plainly in one sentence and stop; a paragraph that manufactures a concern to justify its
  own existence is worse than a short one.
- The numbers are averages over CLOSED days that had food logged — **today is not in them**,
  because a day still being lived cannot be judged and has its own live layer elsewhere on
  the page. Never write about today in the past tense, and never say what today "came in
  at". The sheet says how many closed days there were; an average over two of them is a thin
  week and the paragraph should hedge accordingly rather than treating it as a trend.
- A guideline is not something they said. The sheet marks which targets were stated, which
  were derived from body weight and which are standing guidelines; never hand a default back
  to the user as their own aim.
- Respect what they have told you about how they eat — the diet style and preferences on the
  sheet are constraints, not suggestions to reconsider. If their carb aim is on file, steer
  within it rather than arguing with it.
- Say nothing about training. Another page has that.

${VOICE}`;

/**
 * What these prompts currently say, in eight characters.
 *
 * A reading is cached until the day's inputs hash changes, and the day is not the only
 * input — the instructions are. Changing the wording and leaving the hash alone means every
 * reading already written keeps the old wording until the user happens to log something,
 * which is how a day that had been told never to say "left to log" went on saying it.
 * Hashing the prompts themselves means no future edit can forget to bump a version number.
 *
 * All four prompts share ONE fingerprint, which is deliberately blunt: editing the dossier's
 * wording rewrites every cached *day* reading once as well, on the next read of each. One
 * model call per active day is the price of never having to remember which hash covers which
 * prompt, and the alternative — a fingerprint each — is three things to get wrong instead of
 * one.
 */
export const PROMPT_FINGERPRINT = createHash("sha256")
	.update(`${RIGHT_NOW} ${IN_SHORT} ${DOSSIER} ${EATING_DIRECTION}`)
	.digest("hex")
	.slice(0, 8);

function line(label: string, value: string | number | null | undefined): string | null {
	return value === null || value === undefined || value === "" ? null : `${label}: ${value}`;
}

function kcal(value: number | null): string | null {
	return value == null ? null : `${Math.round(value).toLocaleString("en-US")} kcal`;
}

/**
 * The day, as the model sees it. Deterministic: the same DayView always renders the same
 * sheet, which is what makes the inputs hash a fair cache key.
 */
export function buildDaySheet(view: DayView): string {
	const at = (instant: string) => formatClock(localMinutesOf(instant, view.tz_offset_min));
	const sections: string[] = [];

	sections.push(
		[
			`DAY ${view.day_number} — ${view.date}${view.is_today ? " (today, still running)" : " (closed)"}`,
			line("Goal", view.goal ? `${view.goal.title} (${view.goal.kind})` : "none set — no judgement, just the facts"),
			line("Verdict", view.goal ? `${view.verdict} — ${view.verdict_why}` : null),
		]
			.filter(Boolean)
			.join("\n")
	);

	sections.push(
		[
			"CALORIES",
			line("Eaten", kcal(view.eaten)),
			line("Earned from activity", kcal(view.earned)),
			line("Target", kcal(view.target)),
			line("Allowance (target + eat-back)", kcal(view.allowance)),
			line("Left", kcal(view.remaining)),
			line("Status", view.status),
		]
			.filter(Boolean)
			.join("\n")
	);

	const macros = Object.entries(view.macros)
		.map(([name, macro]) =>
			macro.eaten == null
				? null
				: `${name.replace("_g", "")}: ${Math.round(macro.eaten)} g${macro.target ? ` of ${Math.round(macro.target)} g (${macro.note})` : ""}`
		)
		.filter(Boolean);
	if (macros.length > 0) sections.push(["MACROS", ...macros].join("\n"));

	if (view.blocks.length > 0 || view.items.activities.length > 0) {
		const lines: string[] = ["TRAINING"];
		for (const block of view.blocks) {
			lines.push(
				`${block.title} — ${at(block.start)} to ${at(block.end)}, ${block.exercise_count} exercise${block.exercise_count === 1 ? "" : "s"}, ${Math.round(block.kcal)} kcal${block.health ? " (Health measured the same minutes)" : ""}`
			);
			for (const activity of view.items.activities.filter((item) => item.block_id === block.id)) {
				const bits = [
					activity.exercise ?? activity.description,
					activity.sets && activity.reps ? `${activity.sets}×${activity.reps}` : null,
					activity.load_lb ? `${activity.load_lb} lb` : null,
					activity.duration_min ? `${activity.duration_min} min` : null,
					activity.distance_mi ? `${activity.distance_mi} mi` : null,
					activity.delta_vs_last ? `vs last time: ${activity.delta_vs_last.text}` : null,
				].filter(Boolean);
				lines.push(`  · ${bits.join(", ")}`);
			}
		}
		for (const activity of view.items.activities.filter((item) => item.block_id === null)) {
			lines.push(`${activity.description} — ${at(activity.logged_at)}, ${Math.round(activity.kcal)} kcal (from Health)`);
		}
		if (view.muscle_summary.length > 0) {
			lines.push(`Muscle groups: ${view.muscle_summary.map((m) => `${m.muscle} (${m.sets} sets)`).join(", ")}`);
		}
		sections.push(lines.join("\n"));
	} else {
		sections.push("TRAINING\nNothing logged.");
	}

	const meals = view.items.meals.map(
		(meal) => `${at(meal.logged_at)} ${meal.slot}: ${meal.description} — ${Math.round(meal.kcal)} kcal${meal.protein_g ? `, ${Math.round(meal.protein_g)} g protein` : ""}`
	);
	sections.push(["EATING", ...(meals.length > 0 ? meals : ["Nothing logged."]), view.eating_pattern ?? ""].filter(Boolean).join("\n"));

	sections.push(
		[
			"BODY",
			line("Weight today", view.weight.day == null ? null : `${view.weight.day} lb`),
			line("7-day average", view.weight.avg_7d == null ? null : `${view.weight.avg_7d} lb`),
			line(
				"Trend",
				view.weight.trend_per_week == null
					? null
					: `${view.weight.trend_per_week > 0 ? "+" : ""}${view.weight.trend_per_week} lb/week`
			),
		]
			.filter(Boolean)
			.join("\n")
	);

	// Which screens are still worth a chip. Deliberately not called "expected": the day is
	// not waiting for these and the reading must not say it is (see VOICE above).
	if (view.is_today && view.expected.length > 0) {
		sections.push(
			[
				"OPEN SLOTS (nothing logged here yet — a fact about the log, not something the user owes)",
				...view.expected.map((item) => `${item.label} (${item.kind})`),
			].join("\n")
		);
	}

	return sections.join("\n\n");
}

export function buildRightNowPrompt(view: DayView, localTime: string): string {
	return `${RIGHT_NOW}

It is ${localTime} on ${view.date} in the user's timezone.

${buildDaySheet(view)}`;
}

export function buildInShortPrompt(view: DayView): string {
	return `${IN_SHORT}

${buildDaySheet(view)}`;
}

// ---------------------------------------------------------------------------
// The dossier
// ---------------------------------------------------------------------------

/**
 * Everything the dossier is written from. Assembled by services/readings/dossier.ts out of
 * things that already exist — the profile row, the derived targets, the goals and
 * `computeFeatures` — because a second reading of the same rows is a second answer waiting
 * to disagree with the first.
 */
export interface DossierInputs {
	date: IsoDate;
	plan: {
		training_days: number | null;
		session_minutes: number | null;
		cardio_minutes_target: number | null;
		diet_style: string | null;
		environment: string | null;
		equipment: string[];
		eatback: string | null;
		experience: string | null;
		background: string | null;
		reference_loads: { exercise: string; load_lb: number; reps: number | null }[];
		constraints: string[];
		preferences: string[];
		place: { name: string; kind: string; equipment_count: number } | null;
		/** Which plan fields a human actually said, and when (profiles.stated_at). */
		stated_at: Record<string, string>;
	};
	targets: {
		tdee: number | null;
		eat_target: number | null;
		protein_g: number | null;
		carbs_g: number | null;
		/** derived / stated / default / none — provenance, not arithmetic (services/tdee.ts). */
		source: string;
		eatback: string;
		weight_lb: number | null;
	};
	goals: {
		title: string;
		kind: string;
		active_from: IsoDate;
		active_to: IsoDate | null;
		percent: number | null;
		metrics: { measure: string; target: number | null; unit?: string | null }[];
	}[];
	/** How many goals have been reached, dropped or expired. A fact about persistence. */
	goal_history: number;
	features: CoachFeatures;
}

/** "Said 2026-08-14" for a field a human stated, nothing for one nobody has. */
function said(stated: Record<string, string>, field: string): string {
	const at = stated[field];
	return at ? ` [stated ${at.slice(0, 10)}]` : "";
}

/**
 * The dossier's sheet. Deterministic: the same inputs always render the same string, which
 * is what makes hashing it a fair cache key (services/readings/dossier.ts).
 *
 * Every number on it is labelled with where it came from. That is the one thing this sheet
 * does that the day sheet does not have to: a day's calories are measured, but a plan is
 * half things the user said and half things the app assumed, and a paragraph that hands a
 * default back as a statement is the `daily_calorie_target` bug in prose.
 */
export function buildDossierSheet(inputs: DossierInputs): string {
	const { plan, targets, features } = inputs;
	const sections: string[] = [];

	sections.push(`WHAT THEY HAVE SAID ABOUT HOW THEY TRAIN (a bracket means a human stated it; anything absent, nobody has said)
${[
		line(`Days a week${said(plan.stated_at, "training_days")}`, plan.training_days),
		line(`Session length${said(plan.stated_at, "session_minutes")}`, plan.session_minutes == null ? null : `${plan.session_minutes} min`),
		line(
			`Weekly cardio aim${said(plan.stated_at, "cardio_minutes_target")}`,
			plan.cardio_minutes_target == null ? null : `${plan.cardio_minutes_target} min`
		),
		line(`Where${said(plan.stated_at, "environment")}`, plan.environment),
		line("Their gym", plan.place ? `${plan.place.name} (${plan.place.kind}), ${plan.place.equipment_count} machines seen there` : null),
		line(`Equipment${said(plan.stated_at, "equipment")}`, plan.equipment.length > 0 ? plan.equipment.join(", ") : null),
		line(`Experience${said(plan.stated_at, "experience")}`, plan.experience),
		line(`Background${said(plan.stated_at, "background")}`, plan.background),
		line(
			"Loads they say they lift",
			plan.reference_loads.length > 0
				? plan.reference_loads.map((load) => `${load.exercise} ${load.load_lb} lb${load.reps ? ` × ${load.reps}` : ""}`).join("; ")
				: null
		),
		line("Constraints", plan.constraints.length > 0 ? plan.constraints.join("; ") : null),
		line("Preferences", plan.preferences.length > 0 ? plan.preferences.join("; ") : null),
	]
		.filter(Boolean)
		.join("\n") || "Nothing stated yet."}`);

	sections.push(
		[
			"WHAT THEY HAVE SAID ABOUT EATING",
			line(`Diet style${said(plan.stated_at, "diet_style")}`, plan.diet_style),
			line("Eat back what they earn", targets.eatback),
			line(
				"Daily calorie target",
				targets.eat_target == null
					? null
					: `${Math.round(targets.eat_target)} kcal (${
							targets.source === "stated"
								? "a number they gave"
								: targets.source === "derived"
									? "worked out from their stats, not stated"
									: "a column default nobody chose — do NOT present it as theirs"
						})`
			),
			line("Maintenance (TDEE)", targets.tdee == null ? null : `${Math.round(targets.tdee)} kcal, computed`),
			line("Protein target", targets.protein_g == null ? null : `${Math.round(targets.protein_g)} g`),
		]
			.filter(Boolean)
			.join("\n")
	);

	sections.push(
		inputs.goals.length === 0
			? `GOALS\nNone active.${inputs.goal_history > 0 ? ` ${inputs.goal_history} finished before this.` : ""}`
			: [
					"GOALS (in the user's own priority order)",
					...inputs.goals.map(
						(goal) =>
							`${goal.title} (${goal.kind}) — since ${goal.active_from}${goal.active_to ? `, by ${goal.active_to}` : ", no finish date"}${
								goal.percent == null ? "" : `, ${Math.round(goal.percent * 100)}% of the way`
							}`
					),
					inputs.goal_history > 0 ? `${inputs.goal_history} finished before these.` : "",
				]
					.filter(Boolean)
					.join("\n")
	);

	const topExercises = features.exercises.slice(0, 8).map((exercise) => {
		const load = exercise.last.load_lb == null ? null : `${exercise.last.load_lb} lb`;
		const moved =
			exercise.trend_lb == null || exercise.trend_lb === 0
				? null
				: `${exercise.trend_lb > 0 ? "+" : "−"}${Math.abs(exercise.trend_lb)} lb over the window`;
		return `  · ${exercise.exercise} — ${exercise.sessions.length} session${exercise.sessions.length === 1 ? "" : "s"}${
			load ? `, last at ${load}` : ""
		}${moved ? `, ${moved}` : ""}, ${exercise.days_since === 0 ? "today" : `${exercise.days_since} days ago`}`;
	});

	sections.push(
		[
			"WHAT THE LOG SHOWS — the last 28 days, measured, not stated",
			line("Sessions this week", features.sessions_this_week),
			line("Sessions last week", features.sessions_last_week),
			line("Sessions in four weeks", features.sessions_in_window),
			line("Days since the last one", features.days_since_last_workout),
			topExercises.length > 0 ? `Exercises, most recent first:\n${topExercises.join("\n")}` : "No exercises logged in four weeks.",
			line(
				"Overdue a turn",
				features.coverage.filter((entry) => entry.overdue).length === 0
					? null
					: features.coverage
							.filter((entry) => entry.overdue)
							.slice(0, 6)
							.map((entry) => `${entry.label} (${entry.days_since == null ? "never in four weeks" : `${entry.days_since} days`})`)
							.join(", ")
			),
			line(
				"Cardio this week",
				`${features.cardio.equiv_minutes_this_week} of ${features.cardio.weekly_target_min} equivalent min${
					features.cardio.equiv_text ? ` (${features.cardio.equiv_text})` : ""
				} — the target is ${
					features.cardio.target_source === "default"
						? "the standard guideline, NOT something they said"
						: features.cardio.target_source === "goal"
							? "from their own goal"
							: "a number they gave"
				}`
			),
			line("Weight now", features.weight.latest == null ? null : `${features.weight.latest} lb`),
			line("7-day average", features.weight.avg_7d == null ? null : `${features.weight.avg_7d} lb`),
			line(
				"Weight trend",
				features.weight.trend_per_week == null ? null : `${features.weight.trend_per_week > 0 ? "+" : ""}${features.weight.trend_per_week} lb/week`
			),
			line("Days logged in the last week", `${features.adherence.day7.logged_days} of 7`),
			line("Average calories eaten", features.adherence.day7.kcal_avg == null ? null : `${features.adherence.day7.kcal_avg} kcal/day`),
			line("Average protein", features.adherence.day7.protein_avg == null ? null : `${features.adherence.day7.protein_avg} g/day`),
		]
			.filter(Boolean)
			.join("\n")
	);

	return sections.join("\n\n");
}

export function buildDossierPrompt(inputs: DossierInputs): string {
	return `${DOSSIER}

Today is ${inputs.date} in the user's timezone.

${buildDossierSheet(inputs)}`;
}

/**
 * The Eat page's written layer, handed the computed week rather than the meals. The model
 * never sees a row: it is given averages, targets and where each target came from, which is
 * the whole of `EatingWeek` plus what the user has said about how they eat.
 */
export function buildEatingDirectionPrompt(sheet: EatingDirectionSheet): string {
	const macro = (label: string, macro: MacroAverage): string | null => {
		if (macro.avg_per_day === null) return null;
		const aim =
			macro.target === null
				? "no target set"
				: `${macro.direction === "at_most" ? "aim at most" : "aim at least"} ${macro.target} g (${macro.source})`;
		return `${label}: ${macro.avg_per_day} g/day average · ${aim}`;
	};
	const facts = [
		`Closed days with food logged in the last 7 (today is NOT counted): ${sheet.week.days_logged}`,
		sheet.week.avg_kcal === null ? null : `Calories: ${sheet.week.avg_kcal}/day average`,
		macro("Protein", sheet.week.protein),
		macro("Carbohydrate", sheet.week.carbs),
		macro("Fat", sheet.week.fat),
		macro("Fibre", sheet.week.fiber),
		sheet.week.outliers.length > 0 ? `Stood out most recently: ${sheet.week.outliers.join("; ")}` : null,
		line("Goal", sheet.goal),
		line("Body weight", sheet.weight_lb === null ? null : `${sheet.weight_lb} lb`),
		line("Diet style", sheet.diet_style),
		sheet.preferences.length > 0 ? `They have said: ${sheet.preferences.join("; ")}` : null,
		sheet.constraints.length > 0 ? `Constraints: ${sheet.constraints.join("; ")}` : null,
	]
		.filter((entry): entry is string => Boolean(entry))
		.join("\n");

	return `${EATING_DIRECTION}

THE WEEK, AS COMPUTED
${facts}

GUARDRAILS — the science this steers by, not numbers to quote back:
- Protein around ${PROTEIN_PER_LB.low}–${PROTEIN_PER_LB.high} g per pound of body weight protects muscle in a deficit.
- Fibre ${FIBER_BAND.low}–${FIBER_BAND.high} g a day is the guideline band.
- Carbohydrate is sized to training: more on days with hard sessions, less on quiet ones.`;
}

/** Everything the direction paragraph is written from. */
export interface EatingDirectionSheet {
	week: EatingWeek;
	goal: string | null;
	weight_lb: number | null;
	diet_style: string | null;
	preferences: string[];
	constraints: string[];
}
