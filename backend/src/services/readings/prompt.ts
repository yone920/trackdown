import { createHash } from "node:crypto";
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
- Never scold. A gap is information, not a failing.
- NOTHING IS OWED. The user logs what happened; the app never keeps a list of what they
  were supposed to do. Never write that a workout or a weigh-in is "due" or "expected", that
  anything is "missing", or that the user "still needs to" or "should" log something. An
  empty slot is not a debt and the day is not waiting for anything.
  - Not this: "A workout is due." / "You still need to log today's session." / "A weigh-in
    is missing."
  - This: "Two more sets of hamstrings would close this week's coverage." / "You are
    15 minutes short of this week's cardio target."
  Arithmetic about what would close the gap is a fact and is welcome. An instruction to go
  and do it is not.
- Use the numbers you are given and no others. Do not invent an exercise or a target that is
  not on the sheet. If a number is missing, say what you do know instead.
- Pounds and miles. Round calories to whole numbers.`;

const RIGHT_NOW = `You are writing the "Right now" line on TrackDown's Today screen: the one thing the user
should read before deciding what to do next.

- Exactly one or two sentences. The first says where the day stands; the second, if there is
  one, says what is left of the day's numbers — as arithmetic, not as an instruction. Never
  more.
- Then pick ONE next action from: weigh_in, workout, coach (ask for a plan — the
  right answer when the day is on track and the next move is a workout choice). The chip is
  a shortcut to a screen, not a reminder: pick the one that fits where the day stands. The
  OPEN SLOTS list says which screens are still worth a tap.
- actions: up to two more chips the user might reasonably tap instead. Never repeat the
  next action's kind.
- The chip's label is a place, not an order: "Log a workout", not "You need to train".

${VOICE}`;

const IN_SHORT = `You are writing the "In short" paragraph for a day that has closed. It is read days later,
when the user has forgotten the day itself.

- Two or three sentences, past tense. What was trained against the goal, and the one thing
  worth remembering (a load that went up, a gap, a weigh-in).
- Judge only against the goal that was active that day, which is on the sheet. If there was
  no goal, describe the day without a verdict.
- No advice and no next action: the day is over. This is a record, not a nudge.

${VOICE}`;

const DOSSIER = `You are writing "What I know about you" — the two paragraphs at the top of TrackDown's You
screen. They replaced a grid of rows ("Days a week — 4", "Experience — intermediate"), every
one of which was true and none of which read as a person.

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

/**
 * What these prompts currently say, in eight characters.
 *
 * A reading is cached until the day's inputs hash changes, and the day is not the only
 * input — the instructions are. Changing the wording and leaving the hash alone means every
 * reading already written keeps the old wording until the user happens to log something,
 * which is how a day that had been told never to say "left to log" went on saying it.
 * Hashing the prompts themselves means no future edit can forget to bump a version number.
 *
 * All three prompts share ONE fingerprint, which is deliberately blunt: editing the dossier's
 * wording rewrites every cached *day* reading once as well, on the next read of each. One
 * model call per active day is the price of never having to remember which hash covers which
 * prompt, and the alternative — a fingerprint each — is three things to get wrong instead of
 * one.
 */
export const PROMPT_FINGERPRINT = createHash("sha256")
	.update(`${RIGHT_NOW} ${IN_SHORT} ${DOSSIER}`)
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

	sections.push(["EARNED", line("Earned from activity", kcal(view.earned))].filter(Boolean).join("\n"));

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
		environment: string | null;
		equipment: string[];
		experience: string | null;
		background: string | null;
		reference_loads: { exercise: string; load_lb: number; reps: number | null }[];
		constraints: string[];
		preferences: string[];
		place: { name: string; kind: string; equipment_count: number } | null;
		/** Which plan fields a human actually said, and when (profiles.stated_at). */
		stated_at: Record<string, string>;
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
	const { plan, features } = inputs;
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
