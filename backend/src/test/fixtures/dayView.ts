import type { DayView } from "../../services/day.js";

// One computed day, complete enough that the sheet the model is given is a real sheet:
// a gym block with a delta on it and a weigh-in.
//
// It lives here rather than in readings.test.ts because the contract test needs the same
// day: pinning the *prompt's* wording against a hand-written sheet would pin nothing.

/** A day with one gym block and a weigh-in — enough for the sheet to be real. */
export function dayViewFixture(overrides: Partial<DayView> = {}): DayView {
	const base: DayView = {
		date: "2026-08-29",
		tz_offset_min: 0,
		is_today: true,
		closed_at: null,
		day_number: 12,
		items: {
			activities: [
				{
					id: "a1",
					logged_at: "2026-08-29T17:10:00.000Z",
					description: "3 × 8 bench at 135 lb",
					exercise: "Bench Press",
					exercise_id: null,
					media_count: 0,
					equipment: null,
					category: "strength",
					muscle_groups: ["chest"],
					sets: 3,
					reps: 8,
					load_lb: 135,
					duration_min: null,
					distance_mi: null,
					kcal: 120,
					source: "manual",
					confidence: "high",
					block_id: "block-a1",
					delta_vs_last: {
						text: "+5 lb",
						direction: "up",
						sentiment: "good",
						field: "load_lb",
						load_lb: 5,
						sets: 0,
						reps: 0,
						previous: { logged_at: "2026-08-22T17:00:00.000Z", load_lb: 130, sets: 3, reps: 8 },
					},
					evidence: [],
				},
			],
			weights: [{ id: "w1", logged_at: "2026-08-29T06:40:00.000Z", weight_lb: 182.4, source: "manual" }],
		},
		blocks: [
			{
				id: "block-a1",
				title: "Chest",
				start: "2026-08-29T17:10:00.000Z",
				end: "2026-08-29T17:55:00.000Z",
				minutes: 45,
				kcal: 120,
				kcal_from_health: false,
				kcal_estimated: false,
				exercise_count: 1,
				activity_ids: ["a1"],
				muscle_groups: ["chest"],
				category: "strength",
				health: null,
			},
		],
		earned: 120,
		weight: { day: 182.4, avg_7d: 183.1, trend_per_week: -0.7 },
		muscle_groups: ["chest"],
		muscle_summary: [{ muscle: "chest", sets: 3, exercises: ["Bench Press"] }],
		health: { active_energy: null, steps: null },
		arc: [],
		verdict: "served",
		verdict_words: "Served your goal",
		verdict_why: "Trained chest and logged a weigh-in.",
		goal: {
			id: "g1",
			kind: "custom",
			title: "Down to 170 lb",
			metrics: [],
			priority: 1,
			status: "active",
			active_from: "2026-08-01",
			active_to: null,
		},
		summary_line: "Chest · 120 earned · 182.4 lb",
		facts: { date: "2026-08-29", activities: [], weights: [], healthSamples: [] },
	};
	return { ...base, ...overrides };
}
