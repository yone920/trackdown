import { formatClock, localMinutesOf } from "../localTime.js";
import type { DayView } from "../day.js";

// The reading prompts. Provider-neutral, like every prompt in this codebase: the string and
// the zod schema next to it are the whole contract and the adapter behind LlmPort decides
// how to ask for structured output.
//
// The model is handed the *computed* day — totals, blocks, deltas, the verdict, what is
// still expected — and never the raw rows. That is docs/concept-v2.md §Principles ("facts
// are computed, advice is generated") applied to the smallest possible generation: two
// sentences. It also keeps the call cheap and its answer stable, because the same day
// always produces the same sheet.

const VOICE = `VOICE
- Second person, plain, calm. No exclamation marks, no emoji, no coaching clichés
  ("crushing it", "let's go"), no praise for existing.
- Never scold. A gap or a missed meal is information, not a failing.
- Use the numbers you are given and no others. Do not invent a food, an exercise or a
  target that is not on the sheet. If a number is missing, say what you do know instead.
- Pounds and miles. Round calories to whole numbers.`;

const RIGHT_NOW = `You are writing the "Right now" line on TrackDown's Today screen: the one thing the user
should read before deciding what to do next.

- Exactly one or two sentences. The first says where the day stands; the second, if there is
  one, says what is short or what is next. Never more.
- Then pick ONE next action from: log_meal (something to eat is due or missing), weigh_in
  (no weight logged today), workout (nothing trained and the goal wants it), coach (ask for a
  plan — the right answer when the day is on track and the next move is a workout choice).
  The "expected" list on the sheet is what the day is actually waiting for; prefer it.
- actions: up to two more chips the user might reasonably tap instead. Never repeat the
  next action's kind.

${VOICE}`;

const IN_SHORT = `You are writing the "In short" paragraph for a day that has closed. It is read days later,
when the user has forgotten the day itself.

- Two or three sentences, past tense. What was trained, how the eating went against the
  goal, and the one thing worth remembering (a load that went up, a gap, a weigh-in).
- Judge only against the goal that was active that day, which is on the sheet. If there was
  no goal, describe the day without a verdict.
- No advice and no next action: the day is over. This is a record, not a nudge.

${VOICE}`;

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

	if (view.is_today && view.expected.length > 0) {
		sections.push(
			["EXPECTED BUT NOT LOGGED", ...view.expected.map((item) => `${item.label} (${item.kind})`)].join("\n")
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
