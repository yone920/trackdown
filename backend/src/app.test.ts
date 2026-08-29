import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import type { LogParser, ParsedItem } from "./services/parseLog.js";
import { startTestDatabase, type TestDatabase } from "./test/db.js";

// End-to-end through Express + Better Auth + a real Postgres: the sign-in flow the app
// uses, then the CRUD the screens depend on, then free-text logging with a fake parser.

let db: TestDatabase;
let app: ReturnType<typeof createApp>;
const sentCodes = new Map<string, string>();
let nextParse: ParsedItem[] = [];

const fakeParser: LogParser = {
	async parse() {
		return nextParse;
	},
};

beforeAll(async () => {
	db = await startTestDatabase();
	const auth = createAuth({
		pool: db.pool,
		secret: "test-secret-test-secret-test-secret",
		baseUrl: "http://localhost:8000",
		trustedOrigins: [],
		sendOtp: async ({ email, otp }) => {
			sentCodes.set(email, otp);
		},
	});
	app = createApp({
		pool: db.pool,
		auth,
		parser: fakeParser,
		allowedOrigins: [],
		version: "test",
		commit: "test",
		rateLimiting: false,
	});
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

async function signIn(email: string): Promise<string> {
	const send = await request(app)
		.post("/api/auth/email-otp/send-verification-otp")
		.send({ email, type: "sign-in" });
	expect(send.status).toBe(200);
	const otp = sentCodes.get(email);
	expect(otp).toMatch(/^\d{6}$/);

	const verify = await request(app).post("/api/auth/sign-in/email-otp").send({ email, otp });
	expect(verify.status).toBe(200);
	const token = verify.headers["set-auth-token"];
	expect(token).toBeTruthy();
	return token as string;
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

	it("signs in with an emailed 6-digit code, creating the user and their profile", async () => {
		const token = await signIn("ada@example.com");
		const session = await request(app).get("/api/auth/get-session").set("Authorization", `Bearer ${token}`);
		expect(session.status).toBe(200);
		expect(session.body.user.email).toBe("ada@example.com");

		const profile = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
		expect(profile.status).toBe(200);
		expect(profile.body).toMatchObject({ id: session.body.user.id, units: "imperial", goal_pace: "standard" });
	});

	it("rejects a wrong code", async () => {
		await request(app).post("/api/auth/email-otp/send-verification-otp").send({ email: "bob@example.com", type: "sign-in" });
		const res = await request(app).post("/api/auth/sign-in/email-otp").send({ email: "bob@example.com", otp: "000000" });
		expect(res.status).toBeGreaterThanOrEqual(400);
	});

	it("signs out and the token stops working", async () => {
		const token = await signIn("carol@example.com");
		const out = await request(app).post("/api/auth/sign-out").set("Authorization", `Bearer ${token}`).send({});
		expect(out.status).toBe(200);
		const after = await request(app).get("/api/profile").set("Authorization", `Bearer ${token}`);
		expect(after.status).toBe(401);
	});
});

describe("entries", () => {
	let token: string;
	let otherToken: string;
	beforeAll(async () => {
		token = await signIn("dana@example.com");
		otherToken = await signIn("eve@example.com");
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
});

describe("free-text log", () => {
	it("parses and saves meals, movement and weight in one call, returning ids in input order", async () => {
		const token = await signIn("frank@example.com");
		const auth = { Authorization: `Bearer ${token}` };
		nextParse = [
			{ type: "movement", description: "30 min walk", kcal: 120, confidence: "medium" },
			{ type: "meal", description: "protein shake", kcal: 150, protein_g: 25, carbs_g: 5, fat_g: 3, fiber_g: 1, confidence: "high" },
			{ type: "weight", description: "weigh-in", weight_lb: 181, confidence: "high" },
		];
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
