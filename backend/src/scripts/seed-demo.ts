import { createAuth } from "../auth.js";
import { config } from "../config/index.js";
import { createContainer } from "../container.js";
import { describeTarget, pool } from "../db/client.js";
import type { LlmPort } from "../ports/llm.js";
import { computeDay } from "../services/day.js";
import { closeDueDays } from "../services/dayClose.js";
import { insertEntries, insertWeights } from "../services/entries.js";
import { addDays, localDay } from "../services/localTime.js";
import { setUserPassword } from "../services/password.js";
import { createDayReadings } from "../services/readings/readings.js";
import { RIGHT_NOW_SCHEMA_NAME } from "../services/readings/schema.js";

// npm run seed-demo -- <email> [--tz <minutes>] [--password <password>]
//
// Four days of realistic history for one account: a fat-loss goal, a profile the calorie
// model can work from, three closed days and today half-lived. It exists because the app is
// unreadable empty — Days, Progress and the closed-day reading all need history before they
// can be looked at, and typing four days of logs by hand before a demo is not a plan.
//
// Everything is written through the same services the API uses (insertEntries normalises
// exercise names against the catalogue, closeDueDays writes the summaries), so what the
// demo shows is what the app does, not a fixture that resembles it.
//
// Safe to re-run: the user, the profile and the goal converge, and a day that has already
// closed is left alone. It does add another day's logs each time, which is what you want
// when re-seeding a demo and not what you want on a real account — so it refuses to touch
// one that already has a lot of history unless --force is given.

const DEFAULT_PASSWORD = "demo-pass-123";
/** Above this many logged days, the account looks real and the script stops. */
const REAL_ACCOUNT_DAYS = 10;

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith("--"));
const flag = (name: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};

if (!email) {
	console.error("Usage: npm run seed-demo -- <email> [--tz <minutes>] [--password <password>] [--force]");
	process.exit(2);
}

const password = flag("password") ?? DEFAULT_PASSWORD;
// Minutes to add to UTC for the demo user's local time. Defaults to this machine's, which
// is what someone running the script before a demo means.
const tzOffsetMin = Number(flag("tz") ?? -new Date().getTimezoneOffset());
const force = args.includes("--force");

if (!Number.isInteger(tzOffsetMin) || Math.abs(tzOffsetMin) > 840) {
	console.error(`❌ --tz ${flag("tz")} is not a timezone offset in minutes (e.g. 120 for Berlin in summer).`);
	process.exit(2);
}

const auth = createAuth({
	pool,
	secret: config.auth.secret,
	baseUrl: config.auth.baseUrl,
	trustedOrigins: config.allowedOrigins,
});

/**
 * The readings need a model. With a key, the real one writes the demo's "In short"
 * paragraphs; without, this stands in — a canned answer in the caller's own schema, so the
 * seeded day has a reading either way and the demo does not depend on the network.
 */
function cannedLlm(): LlmPort {
	return {
		model: "seed-demo-canned",
		async parseStructured({ schema, schemaName }) {
			const answer =
				schemaName === RIGHT_NOW_SCHEMA_NAME
					? {
							text: "You are on track for the day with dinner still to come.",
							next_action: { label: "Log dinner", kind: "log_meal", hint: "Dinner is the only slot left" },
							actions: [{ label: "Ask the coach", kind: "coach" }],
						}
					: {
							text: "You trained and ate inside your allowance. The bench went up a step and the weigh-in came in lower than last week.",
						};
			// Parsed through the caller's own schema, exactly as a real adapter would: a
			// stand-in that could return a shape the schema rejects is not a stand-in.
			return schema.parse(answer);
		},
	};
}

function hasCoachKey(): boolean {
	return config.llm.coachProvider === "anthropic" ? Boolean(config.anthropic.apiKey) : Boolean(config.openai.apiKey);
}

const today = localDay(new Date(), tzOffsetMin).date;
const day = (offset: number) => addDays(today, offset);

/** The instant at `clock` local time on a seeded day. */
function at(date: string, clock: string): string {
	const [h, m] = clock.split(":").map(Number);
	return new Date(
		Date.parse(`${date}T00:00:00Z`) - tzOffsetMin * 60_000 + ((h as number) * 60 + (m as number)) * 60_000
	).toISOString();
}

interface MealSeed {
	clock: string;
	description: string;
	kcal: number;
	protein_g: number;
	carbs_g: number;
	fat_g: number;
	fiber_g: number;
}

interface LiftSeed {
	clock: string;
	exercise: string;
	sets: number;
	reps: number;
	load_lb: number;
	kcal: number;
}

/** Four days: three closed, then today, still being lived. */
const DAYS: {
	offset: number;
	weight_lb: number;
	meals: MealSeed[];
	lifts: LiftSeed[];
	/** A Health workout: `overlaps` means it covers the gym block rather than standing alone. */
	health?: { name: string; clock: string; minutes: number; kcal: number; distance_mi?: number; overlaps: boolean };
}[] = [
	{
		offset: -3,
		weight_lb: 195.4,
		meals: [
			{ clock: "07:40", description: "eggs, sourdough toast, coffee", kcal: 520, protein_g: 34, carbs_g: 42, fat_g: 22, fiber_g: 4 },
			{ clock: "12:50", description: "chicken, rice and broccoli", kcal: 690, protein_g: 58, carbs_g: 72, fat_g: 16, fiber_g: 7 },
			{ clock: "19:10", description: "salmon, potatoes, salad", kcal: 760, protein_g: 52, carbs_g: 58, fat_g: 34, fiber_g: 8 },
		],
		// The first gym visit: every lift is a "first time", which is what a real first week
		// looks like and what the deltas on the following days are measured against.
		lifts: [
			{ clock: "18:05", exercise: "Bench Press", sets: 3, reps: 8, load_lb: 130, kcal: 110 },
			{ clock: "18:25", exercise: "Lat Pulldown", sets: 3, reps: 10, load_lb: 110, kcal: 95 },
			{ clock: "18:45", exercise: "Dumbbell Row", sets: 3, reps: 12, load_lb: 45, kcal: 85 },
			{ clock: "19:00", exercise: "Overhead Press", sets: 3, reps: 8, load_lb: 65, kcal: 70 },
		],
	},
	{
		offset: -2,
		weight_lb: 194.8,
		meals: [
			{ clock: "07:30", description: "greek yoghurt, berries, granola", kcal: 430, protein_g: 30, carbs_g: 48, fat_g: 12, fiber_g: 6 },
			{ clock: "13:10", description: "turkey sandwich and an apple", kcal: 640, protein_g: 42, carbs_g: 68, fat_g: 20, fiber_g: 9 },
			{ clock: "19:30", description: "stir fry with tofu and noodles", kcal: 820, protein_g: 38, carbs_g: 96, fat_g: 28, fiber_g: 10 },
			{ clock: "21:15", description: "two squares of dark chocolate", kcal: 110, protein_g: 2, carbs_g: 10, fat_g: 8, fiber_g: 2 },
		],
		// A rest day from the gym — the walk is the only activity, and it comes from Health.
		lifts: [],
		health: { name: "Walking", clock: "07:55", minutes: 42, kcal: 190, distance_mi: 2.2, overlaps: false },
	},
	{
		offset: -1,
		weight_lb: 194.2,
		meals: [
			{ clock: "07:45", description: "oats, banana, peanut butter", kcal: 560, protein_g: 24, carbs_g: 74, fat_g: 18, fiber_g: 9 },
			{ clock: "12:40", description: "burrito bowl", kcal: 780, protein_g: 46, carbs_g: 88, fat_g: 24, fiber_g: 12 },
			{ clock: "19:20", description: "steak, sweet potato, greens", kcal: 830, protein_g: 62, carbs_g: 54, fat_g: 38, fiber_g: 9 },
		],
		// Second visit: the bench and the row go up a step, the pulldown holds, the press
		// gains a set — one of each delta the Day screen has to render.
		lifts: [
			{ clock: "18:10", exercise: "Bench Press", sets: 3, reps: 8, load_lb: 135, kcal: 120 },
			{ clock: "18:30", exercise: "Lat Pulldown", sets: 3, reps: 10, load_lb: 110, kcal: 95 },
			{ clock: "18:50", exercise: "Dumbbell Row", sets: 3, reps: 12, load_lb: 50, kcal: 90 },
			{ clock: "19:05", exercise: "Overhead Press", sets: 4, reps: 8, load_lb: 65, kcal: 80 },
		],
		health: { name: "Traditional Strength Training", clock: "18:05", minutes: 65, kcal: 520, overlaps: true },
	},
	{
		offset: 0,
		weight_lb: 193.6,
		// Today is deliberately half-lived: breakfast and lunch in, dinner still expected,
		// so the Today screen has something to say and a next action to offer.
		meals: [
			{ clock: "07:35", description: "eggs, avocado toast, coffee", kcal: 540, protein_g: 33, carbs_g: 40, fat_g: 26, fiber_g: 7 },
			{ clock: "12:45", description: "poke bowl", kcal: 700, protein_g: 50, carbs_g: 78, fat_g: 18, fiber_g: 8 },
		],
		lifts: [],
		health: { name: "Walking", clock: "08:20", minutes: 35, kcal: 160, distance_mi: 1.8, overlaps: false },
	},
];

async function ensureUser(): Promise<string> {
	const context = await auth.$context;
	const existing = await context.internalAdapter.findUserByEmail((email as string).trim().toLowerCase());
	if (!existing) {
		await auth.api.signUpEmail({
			body: { name: (email as string).split("@")[0] ?? "Demo", email: email as string, password },
		});
		console.log(`👤 Created ${email}`);
	}
	// Either way the password is the documented one, so the demo can always sign in.
	const { userId, account } = await setUserPassword(auth, email as string, password);
	console.log(existing ? `👤 ${email} already existed; password ${account}.` : `🔑 Password set.`);
	return userId;
}

async function seedProfileAndGoal(userId: string): Promise<void> {
	const birthYear = new Date().getUTCFullYear() - 38;
	await pool.query(
		`INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
		[userId]
	);
	await pool.query(
		`UPDATE profiles SET
			display_name = COALESCE(display_name, 'Demo'),
			sex = 'male', birth_year = $2, height_cm = 180, activity_level = 'moderate',
			goal_pace = 'standard', goal_weight_lb = 170, units = 'imperial',
			diet_style = 'higher protein', protein_g = 175, carbs_max_g = 250,
			training_days = 4, environment = 'gym', eatback = 'half',
			stated_at = stated_at || jsonb_build_object('diet_style', NOW()::text, 'training_days', NOW()::text)
		 WHERE id = $1`,
		[userId, birthYear]
	);

	const { rows } = await pool.query<{ id: string }>(
		`SELECT id FROM goals WHERE user_id = $1 AND status = 'active' AND kind = 'lose_fat'`,
		[userId]
	);
	if (rows.length > 0) {
		console.log("🎯 Goal already active; left as it is.");
		return;
	}
	await pool.query(
		`INSERT INTO goals (user_id, kind, title, metrics, priority, status, active_from, active_to, stated_at)
		 VALUES ($1, 'lose_fat', 'Down to 170 lb', $2::jsonb, 1, 'active', $3::date, $4::date, NOW())`,
		[
			userId,
			JSON.stringify([
				{
					measure: "body_weight",
					scope: null,
					target: 170,
					unit: "lb",
					direction: "decrease",
					rate: "about 1 lb a week",
					by: day(150),
				},
			]),
			day(-30),
			day(150),
		]
	);
	console.log("🎯 Goal: down to 170 lb, about 1 lb a week.");
}

async function seedDays(userId: string): Promise<void> {
	for (const seed of DAYS) {
		const date = day(seed.offset);

		await insertWeights(pool, userId, [{ weight_lb: seed.weight_lb, logged_at: at(date, "07:05") }]);
		await insertEntries(
			pool,
			userId,
			"meals",
			seed.meals.map((meal) => ({
				description: meal.description,
				kcal: meal.kcal,
				protein_g: meal.protein_g,
				carbs_g: meal.carbs_g,
				fat_g: meal.fat_g,
				fiber_g: meal.fiber_g,
				logged_at: at(date, meal.clock),
			}))
		);
		if (seed.lifts.length > 0) {
			await insertEntries(
				pool,
				userId,
				"movement",
				seed.lifts.map((lift) => ({
					// The description is the line the day view shows; the fields are what the
					// coach reads. Both, because a log is a sentence and a record.
					description: `${lift.sets} × ${lift.reps} ${lift.exercise.toLowerCase()} at ${lift.load_lb} lb`,
					kcal: lift.kcal,
					exercise: lift.exercise,
					sets: lift.sets,
					reps: lift.reps,
					load_lb: lift.load_lb,
					source: "manual" as const,
					confidence: "high" as const,
					logged_at: at(date, lift.clock),
				}))
			);
		}

		if (seed.health) {
			const start = at(date, seed.health.clock);
			const end = new Date(Date.parse(start) + seed.health.minutes * 60_000).toISOString();
			await pool.query(
				`INSERT INTO health_samples (user_id, kind, external_id, start_at, end_at, value, unit, raw)
				 VALUES ($1, 'workout', $2, $3, $4, $5, 'kcal', $6::jsonb)
				 ON CONFLICT (user_id, external_id) DO NOTHING`,
				[
					userId,
					`demo-${date}-workout`,
					start,
					end,
					seed.health.kcal,
					JSON.stringify({
						name: seed.health.name,
						duration_min: seed.health.minutes,
						...(seed.health.distance_mi ? { distance_mi: seed.health.distance_mi } : {}),
					}),
				]
			);
			// The day's baseline burn and step count, which the day view shows and never
			// adds to `earned`.
			await pool.query(
				`INSERT INTO health_samples (user_id, kind, external_id, start_at, end_at, value, unit, raw) VALUES
				   ($1, 'active_energy', $2, $3, $4, $5, 'kcal', '{}'::jsonb),
				   ($1, 'steps', $6, $3, $4, $7, 'count', '{}'::jsonb)
				 ON CONFLICT (user_id, external_id) DO NOTHING`,
				[userId, `demo-${date}-energy`, at(date, "00:05"), at(date, "23:55"), 620 + seed.offset * 10, `demo-${date}-steps`, 8200 + seed.offset * 200]
			);
		}

		console.log(
			`📅 ${date}: ${seed.meals.length} meals, ${seed.lifts.length} lifts${seed.health ? `, ${seed.health.name} from Health` : ""}`
		);
	}
}

async function main(): Promise<void> {
	console.log(`🌱 Seeding the demo account into ${describeTarget(config.databaseUrl)} (tz offset ${tzOffsetMin} min)`);
	const userId = await ensureUser();

	const { rows } = await pool.query<{ days: string }>(
		`SELECT COUNT(DISTINCT date)::text AS days FROM daily_summaries WHERE user_id = $1`,
		[userId]
	);
	if (Number(rows[0]?.days ?? 0) > REAL_ACCOUNT_DAYS && !force) {
		console.error(
			`❌ ${email} already has ${rows[0]?.days} closed days — this looks like a real account, and seeding would add fake logs to it. Re-run with --force if you meant it.`
		);
		process.exitCode = 1;
		return;
	}

	await seedProfileAndGoal(userId);
	await seedDays(userId);

	const readings = createDayReadings(hasCoachKey() ? createContainer(config).coachLlm : cannedLlm());
	if (!hasCoachKey()) console.log("🤖 No coach API key — the readings use the built-in canned text.");

	const report = await closeDueDays(pool, readings, { userId, tzOffsetMin });
	console.log(`🔒 Closed ${report.closed.length} day(s): ${report.closed.join(", ") || "none"}`);

	// And leave today's reading warm, so the demo's first screen is not a spinner.
	const view = await computeDay(pool, { userId, date: today, tzOffsetMin });
	await readings.rightNow(pool, userId, view);

	console.log(
		`\n✅ ${email} is ready. Sign in with the password "${password}".\n   Today: ${view.eaten} kcal eaten, ${view.earned} earned, allowance ${view.allowance ?? "—"}, day ${view.day_number}.`
	);
}

main()
	.catch((error) => {
		console.error("❌ Seeding the demo failed:", error);
		process.exitCode = 1;
	})
	.finally(() => pool.end());
