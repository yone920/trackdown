import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "../test/db.js";

// The seed script, run for real against a real database — because the morning demo depends
// on it and a script nobody runs in CI is a script that is broken on the morning it matters.
// It is spawned rather than imported: it is a CLI with top-level effects and an argv, and
// what has to work is the command, not a function inside it.

const run = promisify(execFile);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsx = path.join(backendRoot, "node_modules/.bin/tsx");

let db: TestDatabase;

beforeAll(async () => {
	db = await startTestDatabase();
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

function seed(...args: string[]) {
	return run(tsx, ["src/scripts/seed-demo.ts", ...args], {
		cwd: backendRoot,
		env: {
			...process.env,
			DATABASE_URL: db.url,
			NODE_ENV: "development",
			// No key: the script's own canned readings stand in, which is the path a fresh
			// clone takes and the one the demo must survive.
			ANTHROPIC_API_KEY: "",
			OPENAI_API_KEY: "",
		},
	});
}

describe("npm run seed-demo", () => {
	it("creates the account, three closed days with readings, and a half-lived today", async () => {
		const { stdout } = await seed("demo@example.com", "--tz", "120");
		expect(stdout).toContain("Closed 3 day(s)");
		expect(stdout).toContain('password "demo-pass-123"');

		const summaries = await db.pool.query(
			`SELECT date, eaten, earned, allowance, status, verdict, in_short, summary_line, meal_count, tdee, blocks
			   FROM daily_summaries WHERE user_id = (SELECT id FROM "user" WHERE email = 'demo@example.com')
			  ORDER BY date`
		);
		expect(summaries.rows).toHaveLength(3);
		for (const row of summaries.rows) {
			expect(row.verdict).toBe("served");
			expect(row.status).toBe("on_track");
			// Every closed day has its reading — that is what the Days list shows.
			expect(String(row.in_short).length).toBeGreaterThan(20);
			expect(row.eaten).toBeGreaterThan(1500);
			expect(row.tdee).toBeGreaterThan(2000);
			expect(row.summary_line).toContain("kcal in");
		}
		// The gym days have a block of four exercises; the rest day has none.
		expect(summaries.rows.map((row) => (row.blocks as unknown[]).length)).toEqual([1, 0, 1]);

		const gym = (summaries.rows[2]!.blocks as { exercise_count: number }[])[0];
		expect(gym?.exercise_count).toBe(4);

		// Today is open, has its Right now reading, and is still expecting dinner.
		const readings = await db.pool.query<{ kind: string }>(
			`SELECT kind FROM day_readings WHERE user_id = (SELECT id FROM "user" WHERE email = 'demo@example.com') ORDER BY date`
		);
		expect(readings.rows.map((r) => r.kind)).toEqual(["in_short", "in_short", "in_short", "right_now"]);

		const goal = await db.pool.query<{ title: string; metrics: { measure: string }[] }>(
			`SELECT title, metrics FROM goals WHERE user_id = (SELECT id FROM "user" WHERE email = 'demo@example.com')`
		);
		expect(goal.rows[0]?.title).toBe("Down to 170 lb");
		expect(goal.rows[0]?.metrics[0]?.measure).toBe("body_weight");
	}, 120_000);

	it("is safe to run twice — the goal is not duplicated and closed days are left alone", async () => {
		const { stdout } = await seed("demo@example.com", "--tz", "120");
		expect(stdout).toContain("already existed");
		expect(stdout).toContain("Goal already active");
		expect(stdout).toContain("Closed 0 day(s)");

		const goals = await db.pool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM goals WHERE user_id = (SELECT id FROM "user" WHERE email = 'demo@example.com')`
		);
		expect(Number(goals.rows[0]!.count)).toBe(1);
	}, 120_000);

	it("wants an email", async () => {
		await expect(run(tsx, ["src/scripts/seed-demo.ts"], { cwd: backendRoot })).rejects.toThrow(/Usage/);
	}, 60_000);
});
