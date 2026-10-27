import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../../test/db.js";
import { introductionCandidates, priorLoads } from "./catalog.js";

// Real Postgres: both reads are SQL, and the alias match in particular is the kind of
// thing a fake would get right by accident.

const USER = "catalog-test-user";
const NOW = new Date("2026-10-27T15:00:00Z");

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

let db: TestDatabase;

beforeAll(async () => {
	db = await startTestDatabase();
	await db.pool.query(
		`INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt") VALUES ($1, 'catalog', 'catalog@example.com', true, NOW())`,
		[USER]
	);
}, 120_000);

afterAll(async () => {
	await db.stop();
});

async function log(
	exercise: string,
	at: Date,
	{ load = null, sets = 3, reps = 10 }: { load?: number | null; sets?: number | null; reps?: number | null } = {}
): Promise<void> {
	await db.pool.query(
		`INSERT INTO activities (user_id, description, kcal, exercise, category, sets, reps, load_lb, logged_at)
		 VALUES ($1, $2, 0, $2, 'strength', $3, $4, $5, $6)`,
		[USER, exercise, sets, reps, load, at.toISOString()]
	);
}

describe("priorLoads", () => {
	it("returns the top set of each exercise's newest loaded day, with the days since", async () => {
		// Lat Pulldown: two sessions, the newest day has two rows and the heavier one wins.
		await log("Lat Pulldown", daysAgo(60), { load: 100 });
		await log("Lat Pulldown", daysAgo(34), { load: 110, sets: 3, reps: 10 });
		await log("Lat Pulldown", daysAgo(34), { load: 90, sets: 1, reps: 15 });
		// Spelled differently on different days: grouped as one exercise, newest spelling kept.
		await log("dumbbell row", daysAgo(50), { load: 45 });
		await log("Dumbbell Row", daysAgo(36), { load: 50, sets: 4, reps: 12 });
		// No load, so nothing to come back to.
		await log("Plank", daysAgo(35), { load: null, reps: null });
		// Too old to be this lifter's number any more.
		await log("Back Squat", daysAgo(800), { load: 225 });

		const priors = await priorLoads(db.pool, USER, { now: NOW });
		expect(priors).toEqual([
			{ exercise: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, days_since: 34 },
			{ exercise: "Dumbbell Row", load_lb: 50, sets: 4, reps: 12, days_since: 36 },
		]);
	});

	it("is empty for a user who has never logged a load", async () => {
		expect(await priorLoads(db.pool, "nobody", { now: NOW })).toEqual([]);
	});
});

describe("introductionCandidates — what counts as already logged", () => {
	it("recognises a catalogue alias, not only the catalogue name or id", async () => {
		await db.pool.query(
			`INSERT INTO exercise_catalog (name, aliases, category, primary_muscles)
			 VALUES ('Test Pulldown', ARRAY['test pull down'], 'strength', ARRAY['lats']),
			        ('Test Curl', ARRAY['test curls'], 'strength', ARRAY['biceps'])`
		);
		// Logged under the alias, before the catalogue existed to resolve it: no exercise_id.
		await log("Test Pull Down", daysAgo(40), { load: 100 });

		const candidates = await introductionCandidates(db.pool, USER, { limit: 500 });
		expect(candidates).not.toContain("Test Pulldown");
		expect(candidates).toContain("Test Curl");
	});
});
