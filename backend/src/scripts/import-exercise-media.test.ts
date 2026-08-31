import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importExerciseMedia } from "./import-exercise-media.js";
import { datasetNameKeys, matchCatalog, normalizeExerciseName, parseDataset } from "../services/exerciseMedia.js";
import { startTestDatabase, type TestDatabase } from "../test/db.js";
import { createFakeExerciseMediaStore } from "../test/fakes/exerciseMedia.js";
import { DATASET_FIXTURE, fakeFrame } from "../test/fixtures/exerciseDataset.js";

// The exercise-media importer, against the real catalogue in a real Postgres and a fake
// dataset. Nothing here touches the network: `fetchDataset` and `fetchImage` are injected,
// and the fake asserts exactly which images were asked for.

let db: TestDatabase;

beforeAll(async () => {
	db = await startTestDatabase();
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

beforeEach(async () => {
	// Each test starts from a catalogue that has never been imported.
	await db.pool.query(
		`UPDATE exercise_catalog SET instructions = NULL, media_count = 0, source_slug = NULL, level = NULL`
	);
});

function harness(options: { failing?: Set<string> } = {}) {
	const media = createFakeExerciseMediaStore();
	const asked: string[] = [];
	return {
		media,
		asked,
		run: (extra: { force?: boolean } = {}) =>
			importExerciseMedia({
				db: db.pool,
				media,
				fetchDataset: async () => DATASET_FIXTURE,
				fetchImage: async (imagePath: string) => {
					asked.push(imagePath);
					if (options.failing?.has(imagePath)) throw new Error("404");
					return fakeFrame(imagePath);
				},
				log: () => undefined,
				...extra,
			}),
	};
}

async function row(name: string) {
	const { rows } = await db.pool.query<{
		id: string;
		instructions: string[] | null;
		media_count: number;
		source_slug: string | null;
		level: string | null;
	}>(`SELECT id, instructions, media_count, source_slug, level FROM exercise_catalog WHERE name = $1`, [name]);
	return rows[0]!;
}

describe("name matching", () => {
	it("normalises case, punctuation, apostrophes and parenthesised asides", () => {
		expect(normalizeExerciseName("Farmer's Walk")).toBe("farmers walk");
		expect(normalizeExerciseName("Machine Shoulder (Military) Press")).toBe("machine shoulder press");
		expect(normalizeExerciseName("Clean & Press")).toBe("clean and press");
		expect(normalizeExerciseName("T-Bar   Row")).toBe("t bar row");
	});

	it("offers the qualifier-less and singular forms as derived keys, exact first", () => {
		expect(datasetNameKeys("Triceps Pushdown - Rope Attachment")).toEqual({
			exact: "triceps pushdown rope attachment",
			derived: ["triceps pushdown"],
		});
		expect(datasetNameKeys("Concentration Curls")).toEqual({
			exact: "concentration curls",
			derived: ["concentration curl"],
		});
		// "ss" is not a plural: "Bench Press" must not become "Bench Pres".
		expect(datasetNameKeys("Bench Press").derived).toEqual([]);
	});

	it("prefers an exact name over a derived one", () => {
		const catalog = [{ id: "1", name: "Front Squat", aliases: ["front barbell squat"] }];
		const dataset = parseDataset([
			{ id: "Front_Barbell_Squat", name: "Front Barbell Squat", images: ["a/0.jpg", "a/1.jpg"] },
			{ id: "Front_Squat_Clean_Grip", name: "Front Squat (Clean Grip)", images: ["b/0.jpg", "b/1.jpg"] },
		]);
		expect(matchCatalog(catalog, dataset).matches.get("1")?.id).toBe("Front_Squat_Clean_Grip");
	});

	it("ignores entries with fewer than two frames — one picture is not a movement", () => {
		const catalog = [{ id: "1", name: "Plank", aliases: [] }];
		const dataset = parseDataset([{ id: "Plank", name: "Plank", images: ["Plank/0.jpg"] }]);
		expect(matchCatalog(catalog, dataset).unmatched).toEqual(["Plank"]);
	});
});

describe("importing", () => {
	it("matches by alias and by singular, reports the misses, and writes the columns", async () => {
		const { run, asked, media } = harness();
		const report = await run();

		// Two of our 126 are in this four-entry fixture; the other two match nothing.
		expect(report.matched).toBe(2);
		expect(report.total).toBeGreaterThan(100);
		expect(report.matchRate).toBeCloseTo(2 / report.total, 6);
		expect(report.downloaded).toBe(4);
		expect(report.failed).toBe(0);
		expect(report.unmatched).toContain("Pull-Up");

		// "Barbell Bench Press - Medium Grip" → the alias "barbell bench press".
		const bench = await row("Bench Press");
		expect(bench.source_slug).toBe("Barbell_Bench_Press_-_Medium_Grip");
		expect(bench.media_count).toBe(2);
		expect(bench.level).toBe("beginner");
		expect(bench.instructions?.[0]).toContain("flat bench");

		// "Concentration Curls" → the singular of our own name.
		const curl = await row("Concentration Curl");
		expect(curl.source_slug).toBe("Concentration_Curls");
		expect(curl.media_count).toBe(2);

		// Only matched images are fetched — never the whole dataset.
		expect(asked.sort()).toEqual([
			"Barbell_Bench_Press_-_Medium_Grip/0.jpg",
			"Barbell_Bench_Press_-_Medium_Grip/1.jpg",
			"Concentration_Curls/0.jpg",
			"Concentration_Curls/1.jpg",
		]);
		expect(media.frames.get(`${bench.id}/0`)).toEqual(fakeFrame("Barbell_Bench_Press_-_Medium_Grip/0.jpg"));
		expect(media.frames.size).toBe(4);

		// Every downloaded byte is counted. The workers run concurrently, so a counter
		// updated across an `await` silently loses most of this.
		expect(report.bytesDownloaded).toBe((await media.usage()).bytes);
	});

	it("does not match a dataset name that collides with an alias for a different movement", async () => {
		const { run } = harness();
		const report = await run();
		// free-exercise-db's "Air Bike" is a floor crunch; ours is the fan bike.
		expect(report.unmatched).toContain("Assault Bike");
		expect((await row("Assault Bike")).media_count).toBe(0);
	});

	it("leaves an unmatched row's columns alone", async () => {
		const { run } = harness();
		await run();
		const walking = await row("Walking");
		expect(walking).toMatchObject({ instructions: null, media_count: 0, source_slug: null, level: null });
	});

	it("does nothing at all on a second run — this runs at every container start", async () => {
		const { run, asked } = harness();
		await run();
		asked.length = 0;

		const second = await run();
		expect(second.skipped).toBe(true);
		expect(asked).toEqual([]);
		// The first run's answer is still on the row.
		expect((await row("Bench Press")).media_count).toBe(2);
	});

	it("--force re-runs the match but still downloads nothing already on disk", async () => {
		const { run, asked } = harness();
		await run();
		asked.length = 0;

		const forced = await run({ force: true });
		expect(forced.skipped).toBe(false);
		expect(forced.matched).toBe(2);
		expect(forced.downloaded).toBe(0);
		expect(forced.alreadyPresent).toBe(4);
		expect(asked).toEqual([]);
	});

	it("counts only the frames it actually has when one download fails", async () => {
		const { run } = harness({ failing: new Set(["Concentration_Curls/1.jpg"]) });
		const report = await run();

		expect(report.failed).toBe(1);
		expect(report.downloaded).toBe(3);
		// media_count is what the route serves, so it must never promise a missing frame.
		expect((await row("Concentration Curl")).media_count).toBe(1);
		expect((await row("Bench Press")).media_count).toBe(2);
	});
});
