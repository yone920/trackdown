import { describe, expect, it } from "vitest";
import { attachHealthWorkouts, blockTitle, buildBlocks, healthWorkoutAsActivity } from "./blocks.js";
import { deltaVsLast, withDeltas } from "./deltas.js";
import { eatingPattern, expectedItems, slotForMinutes } from "./narrative.js";
import type { DayActivity, DayMeal, HealthWorkout } from "./types.js";
import { computeStatus, summaryLine } from "../day.js";
import { boundsOf, datesEndingOn, localDateOf, localDay, localMinutesOf } from "../localTime.js";
import { emptyDayFacts } from "../goals/measures.js";
import { goalInvolvesCalories, judgeDay, verdictWords, type GoalRow } from "../goals/verdict.js";

// The pure half of the day model: everything that can be true without a database. The SQL
// half is exercised end to end in app.test.ts, against real rows in real Postgres.

const DAY = "2026-08-29";

/** 2026-08-29 at HH:MM in a zone `tz` minutes ahead of UTC. */
function at(clock: string, tz = 0): string {
	const [h, m] = clock.split(":").map(Number);
	return new Date(Date.parse(`${DAY}T00:00:00Z`) + ((h as number) * 60 + (m as number) - tz) * 60_000).toISOString();
}

function activity(partial: Partial<DayActivity> & { logged_at: string }): DayActivity {
	return {
		id: partial.id ?? `a-${partial.logged_at}`,
		description: partial.description ?? "an exercise",
		exercise: partial.exercise ?? null,
		exercise_id: partial.exercise_id ?? null,
		category: partial.category ?? "strength",
		muscle_groups: partial.muscle_groups ?? [],
		sets: partial.sets ?? null,
		reps: partial.reps ?? null,
		load_lb: partial.load_lb ?? null,
		duration_min: partial.duration_min ?? null,
		distance_mi: partial.distance_mi ?? null,
		kcal: partial.kcal ?? 0,
		source: partial.source ?? "manual",
		confidence: partial.confidence ?? null,
		logged_at: partial.logged_at,
		...(partial.external_id === undefined ? {} : { external_id: partial.external_id }),
	};
}

function meal(clock: string, kcal: number, extra: Partial<DayMeal> = {}): DayMeal {
	return {
		id: `m-${clock}`,
		logged_at: at(clock),
		description: extra.description ?? "food",
		slot: extra.slot ?? slotForMinutes(localMinutesOf(at(clock), 0)),
		stated_slot: null,
		kcal,
		protein_g: extra.protein_g ?? null,
		carbs_g: null,
		fat_g: null,
		fiber_g: null,
	};
}

describe("blocks — 90-minute clustering", () => {
	it("groups a gym hour into one block and an evening walk into another", () => {
		const blocks = buildBlocks([
			activity({ logged_at: at("18:10"), exercise: "Bench Press", muscle_groups: ["chest"], sets: 3, kcal: 90 }),
			activity({ logged_at: at("18:35"), exercise: "Lat Pulldown", muscle_groups: ["back"], sets: 3, kcal: 80 }),
			activity({ logged_at: at("19:05"), exercise: "Dumbbell Row", muscle_groups: ["back"], sets: 4, kcal: 70 }),
			activity({ logged_at: at("21:20"), exercise: "Walk", category: "cardio", kcal: 120, duration_min: 30 }),
		]);

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({ exercise_count: 3, kcal: 240, category: "strength" });
		// Back has 7 sets to chest's 3, so it leads the title.
		expect(blocks[0]?.title).toBe("Back & Chest");
		expect(blocks[0]?.muscle_groups.sort()).toEqual(["back", "chest"]);
		expect(blocks[1]).toMatchObject({ exercise_count: 1, title: "Walk", kcal: 120 });
	});

	it("measures the gap from the end of the last activity, not its start", () => {
		// A 60-minute bike at 6:00 ends at 7:00; a lift at 8:20 is 80 minutes later, so the
		// same block. Measuring from 6:00 would call it 140 minutes and split them.
		const blocks = buildBlocks([
			activity({ logged_at: at("06:00"), exercise: "Stationary Bike", category: "cardio", duration_min: 60 }),
			activity({ logged_at: at("08:20"), exercise: "Squat", muscle_groups: ["legs"], sets: 5 }),
		]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.exercise_count).toBe(2);
	});

	it("splits on a gap of more than 90 minutes", () => {
		const blocks = buildBlocks([
			activity({ logged_at: at("07:00"), exercise: "Squat" }),
			activity({ logged_at: at("08:31"), exercise: "Squat" }),
		]);
		expect(blocks).toHaveLength(2);
	});

	it("names a block from what it was, and falls back rather than inventing", () => {
		expect(blockTitle([activity({ logged_at: at("07:00"), exercise: "Morning Walk", category: "cardio" })])).toBe("Walk");
		expect(
			blockTitle([
				activity({ logged_at: at("07:00"), exercise: "Treadmill Run", category: "cardio" }),
				activity({ logged_at: at("07:20"), exercise: "Trail run", category: "cardio" }),
			])
		).toBe("Run");
		expect(blockTitle([activity({ logged_at: at("07:00"), exercise: "Bench Press", muscle_groups: [] })])).toBe("Gym");
		expect(
			blockTitle([
				activity({ logged_at: at("07:00"), category: "cardio", exercise: "Rowing Machine" }),
				activity({ logged_at: at("07:20"), category: "cardio", exercise: "Stationary Bike" }),
			])
		).toBe("Cardio");
	});

	it("leaves Health rows out of the clustering — they go through the overlap rules", () => {
		const blocks = buildBlocks([
			activity({ logged_at: at("18:10"), exercise: "Bench Press", muscle_groups: ["chest"] }),
			activity({ logged_at: at("18:20"), exercise: "Walk", source: "health", category: "cardio", kcal: 300 }),
		]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.exercise_count).toBe(1);
	});
});

describe("Health overlap rules", () => {
	const gym = () =>
		buildBlocks([
			activity({ logged_at: at("18:10"), exercise: "Bench Press", muscle_groups: ["chest"], kcal: 100 }),
			activity({ logged_at: at("18:50"), exercise: "Lat Pulldown", muscle_groups: ["back"], kcal: 100 }),
		]);

	const workout = (partial: Partial<HealthWorkout> = {}): HealthWorkout => ({
		external_id: partial.external_id ?? "hk-1",
		name: partial.name ?? "Traditional Strength Training",
		start_at: partial.start_at ?? at("18:05"),
		end_at: partial.end_at ?? at("19:00"),
		kcal: partial.kcal ?? 430,
		duration_min: partial.duration_min ?? 55,
		distance_mi: partial.distance_mi ?? null,
		...(partial.activity_id === undefined ? {} : { activity_id: partial.activity_id }),
	});

	it("attaches an overlapping workout to the block and never adds its calories on top", () => {
		const { blocks, standalone } = attachHealthWorkouts(gym(), [workout()]);
		expect(standalone).toEqual([]);
		expect(blocks[0]?.health?.external_id).toBe("hk-1");
		// The user's own 200 stands: they know what they did, and the watch is an estimate too.
		expect(blocks[0]?.kcal).toBe(200);
		expect(blocks[0]?.kcal_from_health).toBe(false);
		// The measured span is longer than the logged one, so the block takes it.
		expect(blocks[0]?.minutes).toBe(55);
	});

	it("fills in the calories when the user gave none", () => {
		const noKcal = buildBlocks([
			activity({ logged_at: at("18:10"), exercise: "Bench Press", muscle_groups: ["chest"], kcal: 0 }),
		]);
		const { blocks } = attachHealthWorkouts(noKcal, [workout()]);
		expect(blocks[0]).toMatchObject({ kcal: 430, kcal_from_health: true });
	});

	it("counts a workout that overlaps nothing as its own activity", () => {
		const { blocks, standalone } = attachHealthWorkouts(gym(), [
			workout({ external_id: "hk-walk", name: "Walking", start_at: at("07:00"), end_at: at("07:40"), kcal: 180, duration_min: 40 }),
		]);
		expect(blocks[0]?.health).toBeNull();
		expect(standalone).toHaveLength(1);
		const item = healthWorkoutAsActivity(standalone[0] as HealthWorkout);
		expect(item).toMatchObject({ source: "health", kcal: 180, duration_min: 40, description: "Walking", id: null });
	});

	it("still attaches when the watch started before the first log and stopped after the last", () => {
		const { standalone, blocks } = attachHealthWorkouts(gym(), [
			workout({ start_at: at("17:58"), end_at: at("19:10") }),
		]);
		expect(standalone).toEqual([]);
		expect(blocks[0]?.health).not.toBeNull();
	});

	it("does not attach a workout that finished a quarter of an hour before the block began", () => {
		const { standalone } = attachHealthWorkouts(gym(), [
			workout({ start_at: at("16:00"), end_at: at("17:30"), duration_min: 90 }),
		]);
		expect(standalone).toHaveLength(1);
	});

	it("keeps the longest of two workouts over the same block and counts neither twice", () => {
		const { blocks, standalone } = attachHealthWorkouts(gym(), [
			workout({ external_id: "short", duration_min: 20, kcal: 100 }),
			workout({ external_id: "long", duration_min: 55, kcal: 430 }),
		]);
		expect(blocks[0]?.health?.external_id).toBe("long");
		// The other one is dropped, not moved to standalone: it is the same minutes again.
		expect(standalone).toEqual([]);
	});
});

describe("delta_vs_last", () => {
	const bench = (partial: Partial<DayActivity>) =>
		activity({ logged_at: at("18:00"), exercise: "Bench Press", sets: 3, reps: 8, load_lb: 135, ...partial });

	it("says 'same' when nothing moved", () => {
		expect(deltaVsLast(bench({}), bench({ logged_at: at("18:00") }))).toMatchObject({ text: "same", direction: "same" });
	});

	it("reports the load first, then sets, then reps", () => {
		expect(deltaVsLast(bench({ load_lb: 140 }), bench({})).text).toBe("+5 lb");
		expect(deltaVsLast(bench({ load_lb: 125 }), bench({})).text).toBe("-10 lb");
		expect(deltaVsLast(bench({ sets: 4 }), bench({})).text).toBe("+1 set");
		expect(deltaVsLast(bench({ sets: 5 }), bench({})).text).toBe("+2 sets");
		expect(deltaVsLast(bench({ reps: 10 }), bench({})).text).toBe("+2 reps");
		expect(deltaVsLast(bench({ load_lb: 137.5 }), bench({})).text).toBe("+2.5 lb");
	});

	it("compares cardio on duration and distance", () => {
		const run = (partial: Partial<DayActivity>) =>
			activity({ logged_at: at("07:00"), exercise: "Treadmill Run", category: "cardio", duration_min: 30, distance_mi: 3, ...partial });
		expect(deltaVsLast(run({ duration_min: 35 }), run({})).text).toBe("+5 min");
		expect(deltaVsLast(run({ distance_mi: 3.5 }), run({})).text).toBe("+0.5 mi");
	});

	it("calls the first ever occurrence what it is", () => {
		expect(deltaVsLast(bench({}), null)).toMatchObject({ text: "first time", direction: "new", previous: null });
	});

	it("compares against earlier today before reaching back into history", () => {
		const history = [bench({ logged_at: "2026-08-22T18:00:00.000Z", load_lb: 115 })];
		const today = [bench({ logged_at: at("18:00"), load_lb: 135 }), bench({ logged_at: at("19:40"), load_lb: 145 })];
		const [first, second] = withDeltas(today, history);
		expect(first?.delta_vs_last?.text).toBe("+20 lb");
		expect(second?.delta_vs_last?.text).toBe("+10 lb");
	});

	it("has nothing to compare an unnamed activity with", () => {
		const [only] = withDeltas([activity({ logged_at: at("12:00"), exercise: null })], []);
		expect(only?.delta_vs_last).toBeNull();
	});
});

describe("status thresholds", () => {
	const base = { allowance: 2000, safeFloor: 1500, live: false, localMinutes: 1439, judged: true };

	it("is on_track inside the allowance and over only past the tolerance", () => {
		expect(computeStatus({ ...base, eaten: 1900 })).toBe("on_track");
		expect(computeStatus({ ...base, eaten: 2080 })).toBe("on_track");
		expect(computeStatus({ ...base, eaten: 2101 })).toBe("over");
	});

	it("is under a quarter below the allowance, or under the safe floor", () => {
		expect(computeStatus({ ...base, eaten: 1600 })).toBe("on_track");
		expect(computeStatus({ ...base, eaten: 1400 })).toBe("under");
		expect(computeStatus({ ...base, eaten: 1490, allowance: 1800 })).toBe("under");
	});

	it("does not call a day under-fed while it is still running", () => {
		const live = { ...base, live: true };
		expect(computeStatus({ ...live, eaten: 400, localMinutes: 13 * 60 })).toBe("on_track");
		expect(computeStatus({ ...live, eaten: 400, localMinutes: 21 * 60 })).toBe("under");
		// Over is over at any hour: those calories are not coming back out.
		expect(computeStatus({ ...live, eaten: 2400, localMinutes: 13 * 60 })).toBe("over");
	});

	it("has no status without an allowance or without a goal about calories", () => {
		expect(computeStatus({ ...base, eaten: 1900, allowance: null })).toBe("none");
		expect(computeStatus({ ...base, eaten: 1900, judged: false })).toBe("none");
	});
});

describe("the verdict, per goal kind", () => {
	const goal = (partial: Partial<GoalRow>): GoalRow => ({
		id: "g1",
		kind: "lose_fat",
		title: "Down to 170 lb",
		metrics: [],
		priority: 1,
		status: "active",
		active_from: "2026-08-01",
		active_to: null,
		...partial,
	});

	const facts = (overrides: Partial<ReturnType<typeof emptyDayFacts>> = {}) => ({
		...emptyDayFacts(DAY, 2800),
		...overrides,
	});

	const input = {
		facts: facts(),
		status: "on_track" as const,
		logged: true,
		proteinTarget: 160,
		trainedToday: true,
		trainedYesterday: false,
		sessionsLast7: 3,
		trainingDaysTarget: 4,
	};

	it("judges nothing without a goal, and never blames an unlogged day", () => {
		expect(judgeDay({ ...input, goal: null }).verdict).toBe("none");
		expect(judgeDay({ ...input, goal: goal({}), logged: false }).verdict).toBe("unlogged");
	});

	it("judges fat loss on the calorie status", () => {
		expect(judgeDay({ ...input, goal: goal({}) }).verdict).toBe("served");
		expect(judgeDay({ ...input, goal: goal({}), status: "over" }).verdict).toBe("missed");
		// A deficit day served the goal; the under-eating caution is a health signal, and
		// the status line already carries it.
		expect(judgeDay({ ...input, goal: goal({}), status: "under" }).verdict).toBe("served");
		expect(judgeDay({ ...input, goal: goal({}), status: "none" }).verdict).toBe("none");
	});

	it("judges muscle and strength on protein plus training, with a rest-day rule", () => {
		const muscle = goal({ kind: "gain_muscle" });
		const fed = facts({ meals: [{ date: DAY, kcal: 2600, protein_g: 170, carbs_g: 200, fat_g: 70, fiber_g: 30 }] });

		expect(judgeDay({ ...input, goal: muscle, facts: fed }).verdict).toBe("served");
		// Trained, but 60 g of protein is not a muscle day.
		const underFed = facts({ meals: [{ date: DAY, kcal: 1800, protein_g: 60, carbs_g: 200, fat_g: 70, fiber_g: 20 }] });
		expect(judgeDay({ ...input, goal: muscle, facts: underFed }).verdict).toBe("missed");
		// Ate well, did not train — but trained yesterday, so it is a rest day.
		expect(
			judgeDay({ ...input, goal: muscle, facts: fed, trainedToday: false, trainedYesterday: true }).verdict
		).toBe("served");
		// Ate well, has not trained all week: not a rest day, just a gap.
		expect(
			judgeDay({
				...input,
				goal: muscle,
				facts: fed,
				trainedToday: false,
				trainedYesterday: false,
				sessionsLast7: 0,
			}).verdict
		).toBe("missed");
		expect(judgeDay({ ...input, goal: goal({ kind: "build_strength" }), facts: fed }).verdict).toBe("served");
	});

	it("judges endurance on the week's cardio pace", () => {
		const endurance = goal({
			kind: "improve_endurance",
			metrics: [{ measure: "weekly_cardio_min", target: 150, direction: "at_least" }],
		});
		const cardio = (minutes: number) =>
			facts({
				activities: [
					{
						date: DAY,
						exercise: "Treadmill Run",
						category: "cardio",
						muscle_groups: [],
						sets: null,
						reps: null,
						load_lb: null,
						duration_min: minutes,
						distance_mi: null,
						kcal: 300,
					},
				],
			});
		expect(judgeDay({ ...input, goal: endurance, facts: cardio(140) }).verdict).toBe("served");
		expect(judgeDay({ ...input, goal: endurance, facts: cardio(60) }).verdict).toBe("missed");
		expect(judgeDay({ ...input, goal: endurance, facts: cardio(60) }).why).toContain("of 150 cardio minutes");
	});

	it("judges a custom goal on its own first metric, and says none when it cannot", () => {
		const custom = goal({
			kind: "custom",
			metrics: [{ measure: "protein_g", target: 150, direction: "at_least" }],
		});
		const fed = facts({ meals: [{ date: DAY, kcal: 2000, protein_g: 160, carbs_g: 0, fat_g: 0, fiber_g: 0 }] });
		expect(judgeDay({ ...input, goal: custom, facts: fed }).verdict).toBe("served");
		expect(judgeDay({ ...input, goal: goal({ kind: "custom", metrics: [] }) }).verdict).toBe("none");
	});

	it("knows which goals the calorie status can speak for", () => {
		expect(goalInvolvesCalories(goal({}))).toBe(true);
		expect(goalInvolvesCalories(goal({ kind: "maintain" }))).toBe(true);
		expect(goalInvolvesCalories(goal({ kind: "gain_muscle" }))).toBe(false);
		expect(
			goalInvolvesCalories(goal({ kind: "gain_muscle", metrics: [{ measure: "body_weight", direction: "increase" }] }))
		).toBe(true);
		expect(goalInvolvesCalories(null)).toBe(false);
	});

	it("puts the numbers in the words the Day screen shows", () => {
		expect(verdictWords("served", "on_track", null)).toBe("Served your goal");
		expect(verdictWords("missed", "over", 340)).toBe("Over by 340");
		expect(verdictWords("unlogged", "none", null)).toBe("Not logged");
		expect(verdictWords("none", "none", null)).toBe("Logged");
	});
});

describe("the eating-pattern line", () => {
	it("says nothing about a day with no meals", () => {
		expect(eatingPattern([], 0)).toBeNull();
	});

	it("names a back-loaded day", () => {
		const line = eatingPattern([meal("08:00", 300), meal("19:00", 1400)], 0) as string;
		expect(line).toContain("Back-loaded");
		expect(line).toContain("82%");
	});

	it("names a front-loaded day", () => {
		expect(eatingPattern([meal("07:30", 900), meal("12:30", 600), meal("15:00", 300)], 0)).toContain("Front-loaded");
	});

	it("calls out the long gap on an otherwise even day", () => {
		const line = eatingPattern([meal("07:00", 600), meal("14:00", 500), meal("17:00", 600)], 0) as string;
		expect(line).toContain("7-hour gap after 7:00 am");
	});

	it("describes a single meal as one", () => {
		expect(eatingPattern([meal("13:00", 900)], 0)).toBe("One meal, at 1:00 pm — all 900 kcal of the day.");
	});
});

describe("what the day still expects", () => {
	it("asks for the next meal slot and a weigh-in", () => {
		const items = expectedItems({ tzOffsetMin: 0, meals: [meal("08:00", 400)], weights: [], now: at("12:00") });
		expect(items.map((item) => item.kind)).toEqual(["meal", "weigh_in"]);
		expect(items[0]).toMatchObject({ slot: "lunch", label: "Lunch" });
	});

	it("does not expect a meal that has already been logged, or a slot that has closed", () => {
		const items = expectedItems({
			tzOffsetMin: 0,
			meals: [meal("08:00", 400), meal("12:30", 700)],
			weights: [{ id: "w", logged_at: at("07:00"), weight_lb: 182, source: "manual" }],
			now: at("13:00"),
		});
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ slot: "dinner" });
	});

	it("expects nothing of a day that is over", () => {
		expect(expectedItems({ tzOffsetMin: 0, meals: [], weights: [], now: null })).toEqual([]);
	});
});

describe("local days", () => {
	it("puts a log at 23:30 in Los Angeles on that local day, not the next UTC one", () => {
		// 23:30 on the 29th at UTC−7 is 06:30 UTC on the 30th.
		const instant = "2026-08-30T06:30:00.000Z";
		expect(localDateOf(instant, -420)).toBe("2026-08-29");
		expect(localMinutesOf(instant, -420)).toBe(23 * 60 + 30);

		const { startUtc, endUtc } = boundsOf("2026-08-29", -420);
		expect(startUtc.toISOString()).toBe("2026-08-29T07:00:00.000Z");
		expect(Date.parse(instant)).toBeLessThan(endUtc.getTime());
		expect(Date.parse(instant)).toBeGreaterThanOrEqual(startUtc.getTime());
	});

	it("puts a log at 00:30 in Auckland on the day that just started there", () => {
		// 00:30 on the 30th at UTC+12 is 12:30 UTC on the 29th.
		expect(localDateOf("2026-08-29T12:30:00.000Z", 720)).toBe("2026-08-30");
		expect(localDay(new Date("2026-08-29T12:30:00.000Z"), 720).date).toBe("2026-08-30");
	});

	it("lists the week ending on a date", () => {
		expect(datesEndingOn("2026-08-29", 7)).toEqual([
			"2026-08-23",
			"2026-08-24",
			"2026-08-25",
			"2026-08-26",
			"2026-08-27",
			"2026-08-28",
			"2026-08-29",
		]);
	});
});

describe("the Days-list summary line", () => {
	it("says what the day was in one line", () => {
		const blocks = buildBlocks([
			activity({ logged_at: at("18:10"), exercise: "Bench Press", muscle_groups: ["chest"], sets: 3, kcal: 120 }),
		]);
		expect(
			summaryLine({
				blocks,
				meals: [meal("08:00", 400), meal("13:00", 700)],
				eaten: 1100,
				earned: 120,
				weight: { day: 182.4, avg_7d: 183, trend_per_week: -0.6 },
			})
		).toBe("Chest · 1,100 kcal in 2 meals · 120 earned · 182.4 lb");
	});

	it("says so when there is nothing to say", () => {
		expect(summaryLine({ blocks: [], meals: [], eaten: 0, earned: 0, weight: { day: null, avg_7d: null, trend_per_week: null } })).toBe(
			"Nothing logged"
		);
	});
});
