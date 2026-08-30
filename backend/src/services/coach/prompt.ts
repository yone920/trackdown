import type { CoachBriefInputs } from "../../ports/coach.js";
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

WHAT YOU DECIDE
- Whether today is strength, cardio, mixed or rest, and which muscle groups it is for.
- Which 4–6 exercises (fewer for cardio, none for rest), in what order.
- The reasoning, the meal ideas and the nudge, in plain sentences.

WHAT YOU DO NOT DECIDE
- Loads, sets, reps and minutes. They are prescribed in PRESCRIBED LOADS below and are
  computed from what this user actually lifted. Copy them exactly for every exercise you
  choose from that list. Never round them, never "progress" them, never average them.
- An exercise that is not in the list has no history: give it a null load, sets and reps and
  say in its note what to base the weight on. Prefer exercises that are in the list.
- Calorie and protein numbers. Use the ones in EATING TARGETS.

RULES YOU MUST FOLLOW
- Respect the constraints absolutely. An injury or an exercise to avoid outrules everything
  else, including the goal.
- A muscle group trained in the last 48 hours is not today's primary target.
- Take the gap rule seriously and never scold about a gap; plan from where the user is.
- Honour the context the user gave when they asked ("only 30 minutes", "knee hurts",
  "feel like cardio"). It shapes the session; it does not overrule the history or a constraint.
- If today already contains a workout, do not prescribe a second one — suggest recovery,
  mobility, cardio or rest, and say so in the headline.
- The primary goal (priority 1) decides the emphasis. With no goal at all, coach for
  consistency and whole-body coverage and pass no judgement on the eating.

VOICE
- Second person, plain, calm. No exclamation marks, no emoji, no coaching clichés
  ("crushing it", "let's go"), no praise for existing.
- headline: one short line, under ten words — "Pull day: back and biceps", "Rest — you
  trained three days running".
- why: two or three sentences, each grounded in a number you were given.
- nutrition.why: one or two sentences. Reference yesterday or the week when it explains today.
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
					item.load_lb == null ? null : `${item.load_lb} lb`,
					item.sets == null || item.reps == null ? null : `${item.sets} × ${item.reps}`,
				]
					.filter(Boolean)
					.join(" ") || "no load on record";
	return `- ${item.exercise} → ${numbers} [${item.rule}] · last done ${item.days_since} day${item.days_since === 1 ? "" : "s"} ago · ${item.why}`;
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

/** The whole prompt: who the user is, what is true, what is fixed, and what was asked. */
export function buildCoachPrompt(inputs: CoachBriefInputs): string {
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
			line("Left", today.remaining),
			line("Protein so far", today.protein_g == null ? null : `${today.protein_g} g`),
			line("Calorie status", today.status),
			today.trained.length > 0 ? `Already trained today: ${today.trained.join(", ")}` : "Nothing trained yet today.",
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
	];

	return `${SYSTEM}\n\n${sections.filter(Boolean).join("\n\n")}`;
}
