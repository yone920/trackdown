import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadExerciseCatalog, seedExercises } from "./exercises.js";
import { runMigrations } from "./migrations.js";
import { startTestDatabase, type TestDatabase } from "../test/db.js";

// 0004_v2.sql has to apply to two databases: an empty one (a new deployment) and the one
// on the Docker host, which has 0001–0003 and a year of real rows in it. Only the second
// can go wrong, so the test starts a database at the *old* schema, puts data in it, and
// migrates that forward.

const LAST_V1_MIGRATION = "0003_account_issuer.sql";

let db: TestDatabase;

beforeAll(async () => {
	db = await startTestDatabase({ upTo: LAST_V1_MIGRATION });
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

async function tableExists(client: pg.Pool | pg.Client, name: string): Promise<boolean> {
	const { rows } = await client.query<{ exists: boolean }>(
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists`,
		[name]
	);
	return rows[0]!.exists;
}

/** Runs the migrations that are still pending on `url`, the way the db:migrate CLI does. */
async function migrateToHead(url: string): Promise<string[]> {
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		const report = await runMigrations(client, { log: () => undefined });
		await seedExercises(client);
		return report.applied;
	} finally {
		await client.end();
	}
}

describe("upgrading a database that is already carrying v1 data", () => {
	const userId = "user-with-history";
	let movementId: string;

	beforeAll(async () => {
		// The v1 schema, and nothing newer.
		expect(await tableExists(db.pool, "calorie_expenditure")).toBe(true);
		expect(await tableExists(db.pool, "activities")).toBe(false);
		expect(await tableExists(db.pool, "exercise_catalog")).toBe(false);

		await db.pool.query(
			`INSERT INTO "user" ("id", "name", "email", "emailVerified") VALUES ($1, 'Old User', 'old@example.com', true)`,
			[userId]
		);
		await db.pool.query(`INSERT INTO profiles (id, display_name, daily_calorie_target) VALUES ($1, 'Old User', 2100)`, [userId]);
		const { rows } = await db.pool.query<{ id: string }>(
			`INSERT INTO calorie_expenditure (user_id, description, kcal, duration_minutes, logged_at)
			 VALUES ($1, '45 min on the treadmill', 420, 45, '2026-08-01T18:00:00Z') RETURNING id`,
			[userId]
		);
		movementId = rows[0]!.id;
		await db.pool.query(
			`INSERT INTO daily_summaries (user_id, date, kcal_consumed, kcal_burned) VALUES ($1, DATE '2026-08-01', 2000, 420)`,
			[userId]
		);
	}, 120_000);

	it("applies only the pending migration", async () => {
		const applied = await migrateToHead(db.url);
		expect(applied).toEqual([
			"0004_v2.sql",
			"0005_evidence_confirm.sql",
			"0006_day_readings.sql",
			"0007_goal_progress.sql",
			"0008_coach.sql",
			"0009_day_log.sql",
			"0010_exercise_media.sql",
			"0011_training_background.sql",
			"0012_places_equipment.sql",
		]);
		const { rows } = await db.pool.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name`);
		expect(rows.map((r) => r.name)).toEqual([
			"0001_better_auth.sql",
			"0002_app_tables.sql",
			LAST_V1_MIGRATION,
			"0004_v2.sql",
			"0005_evidence_confirm.sql",
			"0006_day_readings.sql",
			"0007_goal_progress.sql",
			"0008_coach.sql",
			"0009_day_log.sql",
			"0010_exercise_media.sql",
			"0011_training_background.sql",
			"0012_places_equipment.sql",
		]);
	});

	it("carries the movement row over to activities without touching what it said", async () => {
		expect(await tableExists(db.pool, "calorie_expenditure")).toBe(false);
		const { rows } = await db.pool.query(`SELECT * FROM activities WHERE id = $1`, [movementId]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			user_id: userId,
			description: "45 min on the treadmill",
			kcal: 420,
			// duration_minutes was renamed, not duplicated — the value came with it.
			duration_min: 45,
			// Every v2 column is nullable or defaulted, so the old row is still valid.
			exercise: null,
			exercise_id: null,
			category: null,
			muscle_groups: null,
			sets: null,
			reps: null,
			load_lb: null,
			distance_mi: null,
			source: "manual",
			confidence: null,
			external_id: null,
			block_id: null,
		});
	});

	it("gives the existing profile the plan defaults", async () => {
		const { rows } = await db.pool.query(`SELECT * FROM profiles WHERE id = $1`, [userId]);
		expect(rows[0]).toMatchObject({
			display_name: "Old User",
			daily_calorie_target: 2100,
			eatback: "half",
			equipment: [],
			constraints: [],
			preferences: [],
			stated_at: {},
			diet_style: null,
			protein_g: null,
			carbs_max_g: null,
			training_days: null,
			environment: null,
		});
	});

	it("leaves the existing daily summary intact with empty v2 columns", async () => {
		const { rows } = await db.pool.query(`SELECT * FROM daily_summaries WHERE user_id = $1`, [userId]);
		expect(rows[0]).toMatchObject({
			kcal_consumed: 2000,
			kcal_burned: 420,
			eaten: null,
			earned: null,
			allowance: null,
			status: null,
			verdict: null,
			blocks: null,
			muscle_groups: null,
			in_short: null,
			closed_at: null,
		});
	});

	it("enforces the new checks on new rows", async () => {
		await expect(
			db.pool.query(`INSERT INTO activities (user_id, description, kcal, source) VALUES ($1, 'x', 1, 'guessed')`, [userId])
		).rejects.toThrow(/activities_source_check/);
		await expect(
			db.pool.query(`INSERT INTO goals (user_id, kind, title) VALUES ($1, 'become_taller', 'Grow')`, [userId])
		).rejects.toThrow(/goals_kind_check/);
		// Evidence belongs to at most one record.
		await expect(
			db.pool.query(
				`INSERT INTO evidence (user_id, activity_id, meal_id, kind) VALUES ($1, $2, gen_random_uuid(), 'photo')`,
				[userId, movementId]
			)
		).rejects.toThrow(/evidence_one_owner|violates foreign key/);
	});

	it("keeps Health imports unique per user, not globally", async () => {
		await db.pool.query(
			`INSERT INTO "user" ("id", "name", "email", "emailVerified") VALUES ('other-user', 'Other', 'other@example.com', true)`
		);
		const insert = (owner: string) =>
			db.pool.query(
				`INSERT INTO health_samples (user_id, kind, external_id, start_at, value, unit)
				 VALUES ($1, 'steps', 'sample-1', NOW(), 8000, 'count')`,
				[owner]
			);
		await insert(userId);
		await insert("other-user"); // same external id, different user: fine
		await expect(insert(userId)).rejects.toThrow(/health_samples_user_id_external_id_key/);
	});
});

describe("the exercise catalogue", () => {
	it("seeds every exercise from the JSON and converges when run again", async () => {
		const catalog = await loadExerciseCatalog();
		expect(catalog.length).toBeGreaterThanOrEqual(120);

		const { rows: countRows } = await db.pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM exercise_catalog`);
		expect(Number(countRows[0]!.count)).toBe(catalog.length);

		const again = await seedExercises(db.pool);
		expect(again).toEqual({ inserted: 0, updated: catalog.length, total: catalog.length });
		const { rows: after } = await db.pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM exercise_catalog`);
		expect(Number(after[0]!.count)).toBe(catalog.length);
	});

	it("is searchable by name and by alias, which is what the fusion prompt needs", async () => {
		const { rows } = await db.pool.query<{ name: string }>(
			`SELECT name FROM exercise_catalog WHERE lower(name) = ANY($1::text[]) OR aliases && $1::text[] ORDER BY name`,
			[["db bench", "back squat"]]
		);
		expect(rows.map((r) => r.name)).toEqual(["Back Squat", "Dumbbell Bench Press"]);
	});
});

describe("a database that has never been migrated", () => {
	// A second database on the same server: a fresh deployment, without paying for another
	// Postgres to start.
	const freshUrl = () => db.url.replace(/\/trackdown$/, "/fresh");

	it("gets the whole schema and a seeded catalogue in one run", async () => {
		await db.pool.query(`CREATE DATABASE fresh`);
		const applied = await migrateToHead(freshUrl());
		expect(applied).toEqual([
			"0001_better_auth.sql",
			"0002_app_tables.sql",
			LAST_V1_MIGRATION,
			"0004_v2.sql",
			"0005_evidence_confirm.sql",
			"0006_day_readings.sql",
			"0007_goal_progress.sql",
			"0008_coach.sql",
			"0009_day_log.sql",
			"0010_exercise_media.sql",
			"0011_training_background.sql",
			"0012_places_equipment.sql",
		]);

		const client = new pg.Client({ connectionString: freshUrl() });
		await client.connect();
		try {
			for (const table of [
				"user",
				"profiles",
				"meals",
				"meal_items",
				"activities",
				"weight_logs",
				"daily_summaries",
				"exercise_catalog",
				"goals",
				"evidence",
				"health_samples",
				"coach_briefs",
				"day_readings",
				"log_confirmations",
				"coach_contexts",
			]) {
				expect({ table, exists: await tableExists(client, table) }).toEqual({ table, exists: true });
			}
			expect(await tableExists(client, "calorie_expenditure")).toBe(false);

			const catalog = await loadExerciseCatalog();
			const { rows } = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM exercise_catalog`);
			expect(Number(rows[0]!.count)).toBe(catalog.length);
		} finally {
			await client.end();
		}
	}, 120_000);
});

describe("runMigrations", () => {
	it("refuses an upTo that names no migration", async () => {
		const client = await db.pool.connect();
		try {
			await expect(runMigrations(client, { log: () => undefined, upTo: "0009_nope.sql" })).rejects.toThrow(/No migration named/);
		} finally {
			client.release();
		}
	});
});
