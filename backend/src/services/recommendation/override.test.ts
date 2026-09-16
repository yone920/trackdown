import { describe, expect, it } from "vitest";
import { parseOverride, SPOKEN_MUSCLE_KEYS } from "./override.js";
import { MUSCLES, muscleByKey } from "./registry.js";

describe("parseOverride", () => {
	it("hears nothing in a sentence that names no muscle", () => {
		expect(parseOverride("only 30 minutes today")).toBeNull();
		expect(parseOverride("harder")).toBeNull();
		expect(parseOverride("")).toBeNull();
		expect(parseOverride(null)).toBeNull();
		expect(parseOverride(undefined)).toBeNull();
	});

	it("hears a muscle asked for by name — the real request this exists for", () => {
		// The user typed this into the box on 2026-09-16 and got three exercises appended.
		expect(parseOverride("generate chest workout")).toEqual({ family: null, muscles: ["chest"], avoid: [] });
		expect(parseOverride("give me a new set of workouts for chest")).toEqual({ family: null, muscles: ["chest"], avoid: [] });
		expect(parseOverride("Chest day")).toEqual({ family: null, muscles: ["chest"], avoid: [] });
	});

	it("resolves what people say to registry keys, never a spelling of its own", () => {
		expect(parseOverride("pecs and delts")?.muscles).toEqual(["chest", "shoulders"]);
		expect(parseOverride("some core")?.muscles).toEqual(["abs"]);
		expect(parseOverride("traps")?.muscles).toEqual(["upper_back"]);
		expect(parseOverride("hammies and glutes")?.muscles).toEqual(["hamstrings", "glutes"]);
		for (const key of SPOKEN_MUSCLE_KEYS) expect(muscleByKey(key), key).toBeDefined();
	});

	it("hears a whole family by name", () => {
		expect(parseOverride("switch to legs")).toEqual({ family: "legs", muscles: [], avoid: [] });
		expect(parseOverride("make it a push day")).toEqual({ family: "push", muscles: [], avoid: [] });
		expect(parseOverride("pull session please")).toEqual({ family: "pull", muscles: [], avoid: [] });
	});

	it("does not mistake 'push' or 'pull' in ordinary speech for a family", () => {
		expect(parseOverride("push me harder")).toBeNull();
		expect(parseOverride("pull-ups instead")).toBeNull();
	});

	it("'back' is lats and upper back together, and 'lower back' is not 'back'", () => {
		expect(parseOverride("back day")?.muscles).toEqual(["lats", "upper_back"]);
		expect(parseOverride("lower back")?.muscles).toEqual(["lower_back"]);
		expect(parseOverride("back and lower back")?.muscles).toEqual(["lats", "upper_back", "lower_back"]);
	});

	it("'arms' crosses families, because that is what was asked for", () => {
		expect(parseOverride("arms")?.muscles).toEqual(["biceps", "triceps"]);
	});

	it("hears a muscle asked to be skipped", () => {
		expect(parseOverride("no shoulders")).toEqual({ family: null, muscles: [], avoid: ["shoulders"] });
		expect(parseOverride("chest but skip the triceps")).toEqual({ family: null, muscles: ["chest"], avoid: ["triceps"] });
		expect(parseOverride("legs without my calves")).toEqual({ family: "legs", muscles: [], avoid: ["calves"] });
		expect(parseOverride("leave out lower back")).toEqual({ family: null, muscles: [], avoid: ["lower_back"] });
	});

	it("reads a complaint about a muscle as a request to skip it", () => {
		expect(parseOverride("my shoulder hurts")).toEqual({ family: null, muscles: [], avoid: ["shoulders"] });
		expect(parseOverride("chest, quads are still sore")).toEqual({ family: null, muscles: ["chest"], avoid: ["quads"] });
	});

	it("'no legs' rules out the whole family rather than forcing it", () => {
		const parsed = parseOverride("anything but no legs today");
		expect(parsed?.family).toBeNull();
		expect(parsed?.avoid.sort()).toEqual(
			MUSCLES.filter((muscle) => muscle.family === "legs")
				.map((muscle) => muscle.key)
				.sort()
		);
	});

	it("names each muscle once, in the order it was said", () => {
		expect(parseOverride("chest, chest and more chest, then triceps")?.muscles).toEqual(["chest", "triceps"]);
	});

	it("a muscle both asked for and ruled out is ruled out", () => {
		expect(parseOverride("chest but not chest press... actually no chest")).toEqual({
			family: null,
			muscles: [],
			avoid: ["chest"],
		});
	});

	it("does not hear a muscle inside another word", () => {
		expect(parseOverride("lateral raises")).toBeNull(); // not "lat"
		expect(parseOverride("absolutely")).toBeNull(); // not "abs"
	});
});
