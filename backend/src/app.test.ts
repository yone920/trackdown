import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth, type Auth } from "./auth.js";
import { setUserPassword } from "./services/password.js";
import { createLogParser, type ParsedItem } from "./services/parseLog.js";
import { startTestDatabase, type TestDatabase } from "./test/db.js";
import { createFakeLlm } from "./test/fakes/llm.js";

// End-to-end through Express + Better Auth + a real Postgres: the sign-up/sign-in flow the
// app uses, then the CRUD the screens depend on, then free-text logging over a fake LlmPort.

let db: TestDatabase;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const PASSWORD = "correct-horse-battery";

// The fake LlmPort, not a fake parser: the real services/parseLog runs, so the prompt,
// the schema and the route are all exercised — only the provider call is replaced.
const llm = createFakeLlm();
const parser = createLogParser(llm);

function nextParse(items: ParsedItem[]): void {
	llm.nextOutput = { items };
}

beforeAll(async () => {
	db = await startTestDatabase();
	auth = createAuth({
		pool: db.pool,
		secret: "test-secret-test-secret-test-secret",
		baseUrl: "http://localhost:8000",
		trustedOrigins: [],
	});
	app = createApp({
		pool: db.pool,
		auth,
		parser,
		allowedOrigins: [],
		version: "test",
		commit: "test",
		rateLimiting: false,
	});
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

/** Creates the account and returns its bearer token — sign-up auto-signs in. */
async function signUp(email: string, password: string = PASSWORD): Promise<string> {
	const res = await request(app)
		.post("/api/auth/sign-up/email")
		.send({ name: email.split("@")[0], email, password });
	expect(res.status).toBe(200);
	const token = res.headers["set-auth-token"];
	expect(token).toBeTruthy();
	return token as string;
}

async function signIn(email: string, password: string = PASSWORD) {
	return request(app).post("/api/auth/sign-in/email").send({ email, password });
}

describe("health", () => {
	it("reports the database as reachable", async () => {
		const res = await request(app).get("/health");
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ status: "ok", db: "ok", version: "test" });
	});
});

describe("auth", () => {
	it("rejects data requests without a session", async () => {
		const res = await request(app).get("/api/profile");
		expect(res.status).toBe(401);
	});

	it("signs up with an email and password, creating the user and their profile", async () => {
		const token = await signUp("ada@example.com");
		const session = await request(app).get("/api/auth/get-session").set("Authorization", `Bearer ${token}`);
		expect(session.status).toBe(200);
		expect(session.body.user.email).toBe("ada@example.com");

		const profile = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
		expect(profile.status).toBe(200);
		expect(profile.body).toMatchObject({ id: session.body.user.id, units: "imperial", goal_pace: "standard" });
	});

	it("signs in again with the same password", async () => {
		await signUp("bea@example.com");
		const res = await signIn("bea@example.com");
		expect(res.status).toBe(200);
		expect(res.headers["set-auth-token"]).toBeTruthy();

		const session = await request(app)
			.get("/api/auth/get-session")
			.set("Authorization", `Bearer ${res.headers["set-auth-token"]}`);
		expect(session.body.user.email).toBe("bea@example.com");
	});

	it("rejects a wrong password, and an unknown email, without saying which", async () => {
		await signUp("bob@example.com");
		const wrong = await signIn("bob@example.com", "not-the-password");
		expect(wrong.status).toBe(401);
		expect(wrong.headers["set-auth-token"]).toBeFalsy();

		const unknown = await signIn("nobody@example.com");
		expect(unknown.status).toBe(401);
	});

	it("refuses a password under 8 characters", async () => {
		const res = await request(app)
			.post("/api/auth/sign-up/email")
			.send({ name: "shorty", email: "shorty@example.com", password: "short" });
		expect(res.status).toBe(400);
		expect(String(res.body.message)).toMatch(/password/i);
	});

	it("refuses a second sign-up with an email that already exists", async () => {
		await signUp("twice@example.com");
		const again = await request(app)
			.post("/api/auth/sign-up/email")
			.send({ name: "twice", email: "twice@example.com", password: "another-password" });
		expect(again.status).toBe(422);
		expect(String(again.body.message)).toMatch(/already exists/i);
	});

	it("signs out and the token stops working", async () => {
		const token = await signUp("carol@example.com");
		const out = await request(app).post("/api/auth/sign-out").set("Authorization", `Bearer ${token}`).send({});
		expect(out.status).toBe(200);
		const after = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
		expect(after.status).toBe(401);
	});

	it("no longer serves the v1 email-OTP endpoints", async () => {
		const send = await request(app)
			.post("/api/auth/email-otp/send-verification-otp")
			.send({ email: "ada@example.com", type: "sign-in" });
		expect(send.status).toBe(404);
		const verify = await request(app)
			.post("/api/auth/sign-in/email-otp")
			.send({ email: "ada@example.com", otp: "000000" });
		expect(verify.status).toBe(404);
	});
});

describe("reset-password script", () => {
	it("replaces the password of an existing account", async () => {
		await signUp("reset@example.com");
		const result = await setUserPassword(auth, "reset@example.com", "brand-new-password");
		expect(result.account).toBe("updated");

		expect((await signIn("reset@example.com")).status).toBe(401);
		expect((await signIn("reset@example.com", "brand-new-password")).status).toBe(200);
	});

	it("gives a password to an account that never had one (a v1 email-OTP user)", async () => {
		// What v1 left behind: a user row and a profile, but no credential account.
		await db.pool.query(
			`INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
			 VALUES ($1, $2, $3, true, NOW())`,
			["otp-era-user", "otp", "otp-era@example.com"]
		);
		await db.pool.query(`INSERT INTO profiles (id) VALUES ($1)`, ["otp-era-user"]);

		const result = await setUserPassword(auth, "otp-era@example.com", "a-first-password");
		expect(result).toMatchObject({ userId: "otp-era-user", account: "created" });

		const res = await signIn("otp-era@example.com", "a-first-password");
		expect(res.status).toBe(200);
		expect(res.headers["set-auth-token"]).toBeTruthy();
	});

	it("refuses an unknown email and a too-short password", async () => {
		await expect(setUserPassword(auth, "ghost@example.com", "long-enough")).rejects.toThrow(/No account/);
		await expect(setUserPassword(auth, "reset@example.com", "short")).rejects.toThrow(/at least 8/);
	});
});

describe("entries", () => {
	let token: string;
	let otherToken: string;
	beforeAll(async () => {
		token = await signUp("dana@example.com");
		otherToken = await signUp("eve@example.com");
	});

	it("creates, lists, reads, updates and deletes a meal — scoped to the owner", async () => {
		const created = await request(app)
			.post("/api/entries/meals")
			.set("Authorization", `Bearer ${token}`)
			.send({ description: "eggs, toast, coffee", kcal: 265, protein_g: 16, carbs_g: 23, fat_g: 11.5, fiber_g: 2 });
		expect(created.status).toBe(201);
		const [meal] = created.body;
		expect(meal).toMatchObject({ description: "eggs, toast, coffee", kcal: 265, protein_g: 16, fat_g: 11.5 });
		expect(typeof meal.logged_at).toBe("string");

		const list = await request(app).get("/api/entries/meals").set("Authorization", `Bearer ${token}`);
		expect(list.body.map((r: { id: string }) => r.id)).toContain(meal.id);

		const otherList = await request(app).get("/api/entries/meals").set("Authorization", `Bearer ${otherToken}`);
		expect(otherList.body).toEqual([]);
		const otherRead = await request(app).get(`/api/entries/meals/${meal.id}`).set("Authorization", `Bearer ${otherToken}`);
		expect(otherRead.status).toBe(404);

		const patched = await request(app)
			.patch(`/api/entries/meals/${meal.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ kcal: 300, fiber_g: null });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ kcal: 300, fiber_g: null, protein_g: 16 });

		const otherDelete = await request(app).delete(`/api/entries/meals/${meal.id}`).set("Authorization", `Bearer ${otherToken}`);
		expect(otherDelete.status).toBe(404);
		const deleted = await request(app).delete(`/api/entries/meals/${meal.id}`).set("Authorization", `Bearer ${token}`);
		expect(deleted.status).toBe(204);
		const gone = await request(app).get(`/api/entries/meals/${meal.id}`).set("Authorization", `Bearer ${token}`);
		expect(gone.status).toBe(404);
	});

	it("filters by a logged_at range and orders", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		await request(app).post("/api/entries/movement").set(auth).send([
			{ description: "walk", kcal: 100, logged_at: "2026-08-01T10:00:00.000Z" },
			{ description: "run", kcal: 300, logged_at: "2026-08-02T10:00:00.000Z" },
			{ description: "swim", kcal: 200, logged_at: "2026-08-03T10:00:00.000Z" },
		]);
		const res = await request(app)
			.get("/api/entries/movement")
			.query({ from: "2026-08-02T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z", order: "asc" })
			.set(auth);
		expect(res.status).toBe(200);
		expect(res.body.map((r: { description: string }) => r.description)).toEqual(["run"]);

		const all = await request(app).get("/api/entries/movement").query({ order: "asc", limit: 2 }).set(auth);
		expect(all.body.map((r: { description: string }) => r.description)).toEqual(["walk", "run"]);
	});

	it("rejects unknown kinds and invalid bodies", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		expect((await request(app).get("/api/entries/snacks").set(auth)).status).toBe(404);
		expect((await request(app).post("/api/entries/meals").set(auth).send({ kcal: -1 })).status).toBe(400);
		expect((await request(app).patch("/api/entries/meals/00000000-0000-0000-0000-000000000000").set(auth).send({})).status).toBe(400);
	});

	it("logs and lists weights, and updates the profile", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		const w = await request(app).post("/api/weight").set(auth).send({ weight_lb: 182.4 });
		expect(w.status).toBe(201);
		expect(w.body[0]).toMatchObject({ weight_lb: 182.4 });
		const list = await request(app).get("/api/weight").query({ order: "asc" }).set(auth);
		expect(list.body).toHaveLength(1);

		const profile = await request(app).patch("/api/profile").set(auth).send({ sex: "male", birth_year: 1990, height_cm: 180, activity_level: "moderate", goal_weight_lb: 170 });
		expect(profile.status).toBe(200);
		expect(profile.body).toMatchObject({ sex: "male", birth_year: 1990, height_cm: 180, goal_weight_lb: 170 });
		expect((await request(app).patch("/api/profile").set(auth).send({ sex: "other" })).status).toBe(400);
	});

	// v2: "movement" is now an alias over `activities`, and the route takes the exercise
	// fields WP2's fusion endpoint will fill in.
	it("saves the v2 activity fields and normalises the exercise against the catalogue", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		const created = await request(app)
			.post("/api/entries/movement")
			.set(auth)
			.send({
				description: "3 x 10 on the db bench",
				kcal: 180,
				exercise: "db bench",
				sets: 3,
				reps: 10,
				load_lb: 45,
				source: "fused",
				confidence: "medium",
				logged_at: "2026-08-10T18:00:00.000Z",
			});
		expect(created.status).toBe(201);
		const [activity] = created.body;
		expect(activity).toMatchObject({
			description: "3 x 10 on the db bench",
			kcal: 180,
			// The catalogue's spelling, not the user's, so weeks of logs group together.
			exercise: "Dumbbell Bench Press",
			category: "strength",
			muscle_groups: ["chest"],
			sets: 3,
			reps: 10,
			load_lb: 45,
			source: "fused",
			confidence: "medium",
		});
		expect(activity.exercise_id).toMatch(/^[0-9a-f-]{36}$/);

		const patched = await request(app)
			.patch(`/api/entries/movement/${activity.id}`)
			.set(auth)
			.send({ load_lb: 50, exercise: "incline db press" });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ load_lb: 50, exercise: "Incline Dumbbell Press", category: "strength" });
		expect(patched.body.exercise_id).not.toBe(activity.exercise_id);
	});

	it("still saves an exercise the catalogue has never heard of", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		const created = await request(app)
			.post("/api/entries/movement")
			.set(auth)
			.send({ description: "wall sits", exercise: "wall sit", kcal: 30, logged_at: "2026-08-10T19:00:00.000Z" });
		expect(created.status).toBe(201);
		expect(created.body[0]).toMatchObject({
			exercise: "wall sit",
			exercise_id: null,
			category: null,
			muscle_groups: null,
			source: "manual",
		});

		const bad = await request(app).post("/api/entries/movement").set(auth).send({ description: "x", source: "guessed" });
		expect(bad.status).toBe(400);
	});
});

describe("free-text log", () => {
	it("parses and saves meals, movement and weight in one call, returning ids in input order", async () => {
		const token = await signUp("frank@example.com");
		const auth = { Authorization: `Bearer ${token}` };
		nextParse([
			{ type: "movement", description: "30 min walk", kcal: 120, confidence: "medium" },
			{ type: "meal", description: "protein shake", kcal: 150, protein_g: 25, carbs_g: 5, fat_g: 3, fiber_g: 1, confidence: "high" },
			{ type: "weight", description: "weigh-in", weight_lb: 181, confidence: "high" },
		]);
		const res = await request(app).post("/api/log").set(auth).send({ text: "protein shake after my 30 min walk, 181 on the scale" });
		expect(res.status).toBe(201);
		expect(res.body.items).toHaveLength(3);
		expect(res.body.items.map((i: { type: string }) => i.type)).toEqual(["movement", "meal", "weight"]);
		for (const item of res.body.items) expect(item.id).toMatch(/^[0-9a-f-]{36}$/);

		const meals = await request(app).get("/api/entries/meals").set(auth);
		expect(meals.body[0]).toMatchObject({ description: "protein shake", kcal: 150, protein_g: 25 });
		const weights = await request(app).get("/api/weight").set(auth);
		expect(weights.body[0]).toMatchObject({ weight_lb: 181 });

		const parseOnly = await request(app).post("/api/parse-log").set(auth).send({ text: "anything" });
		expect(parseOnly.status).toBe(200);
		expect(parseOnly.body.items).toHaveLength(3);
		expect((await request(app).post("/api/log").set(auth).send({ text: "   " })).status).toBe(400);
	});
});
