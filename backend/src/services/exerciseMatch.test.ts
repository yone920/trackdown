import { describe, expect, it } from "vitest";
import { loadExerciseCatalog } from "../db/exercises.js";
import { buildExerciseIndex, isQualifierSafeMatch, qualifiersIn, tokenize } from "./exerciseMatch.js";

// The field report, pinned: "assisted chin up with 55 pounds" was saved as a plain Chin-Up
// at 55 lb — a qualifier dropped, and with it the meaning of the number.

const CATALOG = await loadExerciseCatalog();

/** The catalogue as it was the day the report came in: no assisted family in it. */
const WITHOUT_ASSISTED = CATALOG.filter((entry) => !entry.name.startsWith("Assisted "));

/** The exercise phrase the reader pulls out of the reported sentence. */
const REPORTED = "assisted chin up";

describe("tokenising a spoken name", () => {
	it("flattens punctuation, case and asides", () => {
		expect(tokenize("Assisted Chin-Up")).toEqual(["assisted", "chin", "up"]);
		expect(tokenize("Farmer's Carry")).toEqual(["farmers", "carry"]);
		expect(tokenize("Machine Shoulder (Military) Press")).toEqual(["machine", "shoulder", "press"]);
	});
});

describe("reading the qualifiers out of a phrase", () => {
	it("finds single words and the two-word ones", () => {
		expect(qualifiersIn("assisted chin up")).toEqual(["assisted"]);
		expect(qualifiersIn("close-grip bench press")).toEqual(["close grip"]);
		expect(qualifiersIn("single arm dumbbell row")).toEqual(["single arm"]);
		expect(qualifiersIn("smith machine squat")).toEqual(["smith machine"]);
		expect(qualifiersIn("bench press")).toEqual([]);
	});

	it("prefers the longer qualifier where two overlap", () => {
		expect(qualifiersIn("machine assisted pull up")).toEqual(["machine assisted"]);
	});
});

describe("the qualifier guard", () => {
	const chinUp = { name: "Chin-Up", aliases: ["chinup", "chin up"] };

	it("refuses the movement the report was saved as", () => {
		const verdict = isQualifierSafeMatch(REPORTED, chinUp);
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain("assisted");
	});

	it("accepts a phrase the entry accounts for word by word", () => {
		expect(isQualifierSafeMatch("chin up", chinUp).ok).toBe(true);
		expect(isQualifierSafeMatch("Chinup", chinUp).ok).toBe(true);
	});

	it("counts every alias as one of the entry's own words, not just its name", () => {
		// "dips" is nowhere in "Chest Dip" — it is still one of the things it is called.
		expect(isQualifierSafeMatch("dips", { name: "Chest Dip", aliases: ["dips", "dip"] }).ok).toBe(true);
	});

	it("ignores the words that join a phrase together", () => {
		expect(isQualifierSafeMatch("a chin up", chinUp).ok).toBe(true);
	});

	it("refuses a word the entry answers to under no name at all", () => {
		const entry = { name: "Leg Curl", aliases: ["hamstring curl", "lying leg curl", "seated leg curl"] };
		const verdict = isQualifierSafeMatch("standing leg curl", entry);
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain("standing");
	});

	it("refuses a two-word qualifier assembled out of two different aliases", () => {
		// Constructed to isolate the second rule from the first: "single" comes from one
		// alias and "arm" from another, so every word IS accounted for — and the phrase
		// still names a movement this entry is not.
		const entry = { name: "Cable Row", aliases: ["single leg cable row", "arm row"] };
		const verdict = isQualifierSafeMatch("single arm cable row", entry);
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain("single arm");
	});
});

describe("the catalogue index", () => {
	const index = buildExerciseIndex(CATALOG);

	it("resolves the reported phrase to the assisted movement, not the plain one", () => {
		const match = index.find(REPORTED);
		expect(match?.name).toBe("Assisted Chin-Up");
		expect(match?.load_direction).toBe("assistance");
	});

	it("keeps the user's words when the assisted movement is not in the catalogue", () => {
		// The catalogue as it was when the report came in. The old matcher's answer here
		// was "Chin-Up"; the right answer is nothing at all, so the phrase is stored as it
		// was said with no exercise_id (services/entries.ts).
		expect(buildExerciseIndex(WITHOUT_ASSISTED).find(REPORTED)).toBeNull();
	});

	it("resolves the rest of the assisted family, by name, alias and plural", () => {
		expect(index.find("assisted pull up")?.name).toBe("Assisted Pull-Up");
		expect(index.find("banded pull up")?.name).toBe("Assisted Pull-Up");
		expect(index.find("machine assisted chin up")?.name).toBe("Assisted Chin-Up");
		expect(index.find("Assisted Dips")?.name).toBe("Assisted Dip");
	});

	it("still normalises spelling, which is the job it was doing right", () => {
		expect(index.find("db bench")?.name).toBe("Dumbbell Bench Press");
		expect(index.find("Dumbbell bench press")?.name).toBe("Dumbbell Bench Press");
		expect(index.find("rdl")?.name).toBe("Romanian Deadlift");
		expect(index.find("dips")?.name).toBe("Chest Dip");
		expect(index.find("squats")?.name).toBe("Back Squat");
		expect(index.find("seated leg curl")?.name).toBe("Leg Curl");
		expect(index.find("wide grip pull up")?.name).toBe("Pull-Up");
	});

	it("refuses a variation it does not have rather than offering a neighbour", () => {
		for (const phrase of ["deficit deadlift", "paused bench press", "smith machine bench press", "single leg leg press"]) {
			expect(index.find(phrase)).toBeNull();
		}
	});

	it("finds every name and alias in the catalogue as itself", () => {
		// The guard can only ever refuse, so this is the test that says it refuses nothing
		// the catalogue is deliberately offering.
		for (const entry of CATALOG) {
			for (const phrase of [entry.name, ...entry.aliases]) {
				expect({ phrase, found: index.find(phrase)?.name }).toEqual({ phrase, found: expect.any(String) });
			}
		}
	});
});

// ── the finisher's stretches ─────────────────────────────────────────────────────────
// Field report 2026-09-01: the coach's finisher — "Chest Stretch", "Tricep Stretch", "Hip
// Flexor Stretch" — opened in name-only mode every time, because the catalogue had one row
// called "Stretching" and nothing else. It has nineteen now, named the way the coach writes
// them, each aliased to a photo-backed free-exercise-db entry so the media import picks it
// up (scripts/import-exercise-media.ts).

describe("the stretches a finisher is made of", () => {
	const index = buildExerciseIndex(CATALOG);

	it("resolves the names the coach actually writes", () => {
		const expected: Record<string, string> = {
			"Chest Stretch": "Chest Stretch",
			"Doorway Chest Stretch": "Chest Stretch",
			"Tricep Stretch": "Triceps Stretch",
			"Triceps Stretch": "Triceps Stretch",
			"Hip Flexor Stretch": "Hip Flexor Stretch",
			"Kneeling Hip Flexor Stretch": "Hip Flexor Stretch",
			"Couch Stretch": "Hip Flexor Stretch",
			"Quad Stretch": "Quad Stretch",
			"Hamstring Stretch": "Hamstring Stretch",
			"Seated Hamstring Stretch": "Hamstring Stretch",
			"Shoulder Stretch": "Shoulder Stretch",
			"Calf Stretch": "Calf Stretch",
			"Lat Stretch": "Lat Stretch",
			"Glute Stretch": "Glute Stretch",
			"Figure Four Stretch": "Glute Stretch",
			"Child's Pose": "Child's Pose",
			"Lower Back Stretch": "Child's Pose",
			"Cat-Cow": "Cat-Cow",
			"Cat Cow Stretch": "Cat-Cow",
			"Neck Stretch": "Neck Stretch",
			"Groin Stretch": "Groin Stretch",
			"Upper Back Stretch": "Upper Back Stretch",
			"Biceps Stretch": "Biceps Stretch",
			"Forearm Stretch": "Forearm Stretch",
			"Side Stretch": "Side Stretch",
			"IT Band Stretch": "IT Band Stretch",
			"World's Greatest Stretch": "World's Greatest Stretch",
		};
		for (const [phrase, name] of Object.entries(expected)) {
			expect({ phrase, found: index.find(phrase)?.name ?? null }).toEqual({ phrase, found: name });
		}
	});

	it("did not quietly take a name the rest of the catalogue was using", () => {
		// "Stretching" is still the generic category row a logged "cool down stretch" lands
		// on, and the strength rows are untouched.
		expect(index.find("stretching")?.name).toBe("Stretching");
		expect(index.find("stretch")?.name).toBe("Stretching");
		expect(index.find("hip mobility")?.name).toBe("Hip Mobility Drill");
		expect(index.find("bench press")?.name).toBe("Bench Press");
		expect(index.find("assisted chin up")?.name).toBe("Assisted Chin-Up");
	});

	it("keeps the guard: a stretch is not offered as an answer to a movement", () => {
		// The stretches widen the vocabulary, and a wider vocabulary is exactly how a
		// too-generous alias list starts matching things it should refuse.
		for (const phrase of ["chest press", "hip thrust", "calf raise", "lat pulldown stretch"]) {
			expect({ phrase, found: index.find(phrase)?.category ?? null }).not.toEqual({
				phrase,
				found: "mobility",
			});
		}
	});
});

// ── the band pack ────────────────────────────────────────────────────────────────────
// User request, asked twice: the catalogue was nearly bare for rubber bands — two entries,
// one of them a stretch. free-exercise-db has twenty movements under `equipment: "bands"`,
// and 2026-09-02 added the eighteen we did not have.
//
// What is worth testing about a data change is exactly what a data change can break: that
// every new row is REACHABLE (an alias claimed by an older row makes the new one dead), and
// that no older row lost a key to a new one. Both are properties of the whole catalogue, so
// both are checked over the whole catalogue rather than over a list of examples.

describe("the band pack", () => {
	const BANDS = CATALOG.filter((entry) => entry.equipment.includes("band"));
	const index = buildExerciseIndex(CATALOG);

	it("seeds twenty band movements", () => {
		expect(BANDS).toHaveLength(20);
		expect(CATALOG.length).toBeGreaterThanOrEqual(166);
		// Every one of them is a real, loadable catalogue row with muscles on it — the
		// coverage ledger reads these, and a band exercise with no muscles is a session
		// that trains nothing (services/coach/features.ts §LEDGER_MUSCLES).
		for (const entry of BANDS) {
			expect(entry.primary_muscles.length, entry.name).toBeGreaterThan(0);
			expect(["strength", "mobility"], entry.name).toContain(entry.category);
		}
	});

	it("answers to the way a person says each one", () => {
		// free-exercise-db has no band curl and no band row, so the pack has neither and
		// those phrases still resolve to nothing. Logging one is not broken — it saves as
		// free text — but it feeds no muscle to the ledger, which is noted in the changelog
		// rather than papered over with a catalogue row nobody can illustrate.
		expect(index.find("band curl")).toBeNull();
		expect(index.find("band row")).toBeNull();
		expect(index.find("banded lateral raise")?.name).toBe("Band Lateral Raise");
		expect(index.find("band lateral raise")?.name).toBe("Band Lateral Raise");
		expect(index.find("band pull apart")?.name).toBe("Band Pull-Apart");
		expect(index.find("banded good morning")?.name).toBe("Band Good Morning");
		expect(index.find("band skull crusher")?.name).toBe("Band Skull Crusher");
		expect(index.find("monster walk")?.name).toBe("Monster Walk");
		expect(index.find("band kickback")?.name).toBe("Band Hip Extension");
		expect(index.find("banded squat")?.name).toBe("Band Squat");
		expect(index.find("band external rotation")?.name).toBe("Band External Rotation");
	});

	// The qualifier guard, on the new rows: "banded" changes the movement, so it may only
	// resolve to a row that carries it. This is the assisted-chin-up rule, still holding.
	it("never lets a banded phrase fall through to the unbanded movement", () => {
		expect(index.find("banded squat")?.name).not.toBe("Back Squat");
		expect(index.find("banded lateral raise")?.name).not.toBe("Lateral Raise");
		expect(index.find("banded good morning")?.name).not.toBe("Good Morning");
		expect(index.find("banded calf raise")?.name).not.toBe("Standing Calf Raise");
		// And the plain phrases still find the plain movements.
		expect(index.find("squat")?.name).toBe("Back Squat");
		expect(index.find("lateral raise")?.name).toBe("Lateral Raise");
		expect(index.find("good morning")?.name).toBe("Good Morning");
	});

	it("gives every band row every one of its own names, and takes none from anybody else", () => {
		for (const entry of BANDS) {
			for (const phrase of [entry.name, ...entry.aliases]) {
				expect(index.find(phrase)?.name, `${entry.name} → "${phrase}"`).toBe(entry.name);
			}
		}
		// Nothing that was reachable before is answered by a band row now.
		for (const entry of CATALOG.filter((e) => !e.equipment.includes("band"))) {
			for (const phrase of [entry.name, ...entry.aliases]) {
				const hit = index.find(phrase);
				if (hit) expect(hit.name, `${entry.name} → "${phrase}"`).toBe(entry.name);
			}
		}
	});
});
