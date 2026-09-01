import { computeFeatures } from "../../services/coach/features.js";
import type { DossierInputs } from "../../services/readings/prompt.js";
import { activity, daysAgo, facts, meal, TODAY, weight } from "./facts.js";

// One person, in as much detail as the dossier is ever given. Lives here rather than inside
// readings.test.ts for the reason `dayView.ts` does: the contract test asks the REAL model
// with the REAL prompt, and pinning the wording against a hand-written sheet would pin
// nothing about what the app actually sends.
//
// The shape of the person matters. They have stated some things and not others, so the
// second paragraph has something honest to ask for; their calorie target is `derived` rather
// than stated; their cardio target is the guideline standing in; and their bench has moved
// ten pounds in four weeks, so the first paragraph has one specific thing to notice.

const bench = (date: string, load: number) =>
	activity(date, {
		exercise: "Bench Press",
		category: "strength",
		muscle_groups: ["chest", "triceps"],
		sets: 3,
		reps: 8,
		load_lb: load,
		confidence: "high",
	});

const pulldown = (date: string, load: number) =>
	activity(date, {
		exercise: "Lat Pulldown",
		category: "strength",
		muscle_groups: ["back", "lats", "biceps"],
		sets: 3,
		reps: 10,
		load_lb: load,
		confidence: "high",
	});

const walk = (date: string, minutes: number) =>
	activity(date, { exercise: "Brisk Walk", category: "cardio", duration_min: minutes, kcal: 90 });

export function dossierInputsFixture(overrides: Partial<DossierInputs> = {}): DossierInputs {
	const day = facts({
		activities: [
			bench(daysAgo(1), 145),
			pulldown(daysAgo(1), 110),
			walk(daysAgo(2), 25),
			bench(daysAgo(5), 140),
			pulldown(daysAgo(5), 110),
			bench(daysAgo(12), 140),
			bench(daysAgo(19), 135),
			walk(daysAgo(20), 30),
		],
		meals: [
			meal(daysAgo(1), { kcal: 2180, protein_g: 150, carbs_g: 190 }),
			meal(daysAgo(2), { kcal: 2050, protein_g: 138, carbs_g: 175 }),
			meal(daysAgo(3), { kcal: 2300, protein_g: 145, carbs_g: 210 }),
		],
		weights: [weight(daysAgo(1), 210.4), weight(daysAgo(8), 212.0)],
	});

	return {
		date: TODAY,
		plan: {
			training_days: 4,
			// Never stated: the invitation the second paragraph should reach for first.
			session_minutes: null,
			cardio_minutes_target: null,
			diet_style: "higher protein",
			environment: "gym",
			equipment: ["barbell", "cable stack", "dumbbells"],
			eatback: "half",
			experience: "intermediate",
			background: null,
			reference_loads: [],
			constraints: ["bad left knee — no deep lunges"],
			preferences: [],
			place: { name: "New Millennium", kind: "gym", equipment_count: 14 },
			stated_at: {
				training_days: "2026-08-14T09:12:00.000Z",
				diet_style: "2026-08-14T09:12:00.000Z",
				environment: "2026-08-14T09:12:00.000Z",
				equipment: "2026-08-18T18:40:00.000Z",
				experience: "2026-08-14T09:12:00.000Z",
			},
		},
		targets: {
			tdee: 2680,
			eat_target: 2180,
			protein_g: 168,
			carbs_g: 200,
			// Worked out from their stats — not a number they gave, and not a bare default.
			source: "derived",
			eatback: "half",
			weight_lb: 210.4,
		},
		goals: [
			{
				title: "Down to 195 lb",
				kind: "lose_fat",
				active_from: "2026-08-14",
				active_to: "2026-12-01",
				percent: 0.11,
				metrics: [{ measure: "body_weight", target: 195 }],
			},
		],
		goal_history: 1,
		features: computeFeatures({
			facts: day,
			trainingDaysTarget: 4,
			targets: { kcal: 2180, protein_g: 168, carbs_max_g: null },
		}),
		...overrides,
	};
}
