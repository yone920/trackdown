import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth, type Auth } from "./auth.js";
import { sweepUnlinkedEvidence } from "./services/evidence.js";
import { setUserPassword } from "./services/password.js";
import { createLogParser, type ParsedItem } from "./services/parseLog.js";
import { createFusionAnalyzer } from "./services/fusion/analyze.js";
import { createDayReadings } from "./services/readings/readings.js";
import type { FusionResult, FusionRoute } from "./services/fusion/schema.js";
import { startTestDatabase, type TestDatabase } from "./test/db.js";
import { createFakeLlm } from "./test/fakes/llm.js";
import { createFakeEvidenceStore } from "./test/fakes/storage.js";

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
const fusion = createFusionAnalyzer(llm);
const store = createFakeEvidenceStore();
// The readings run on the coach model — a second port in production, so a second fake here:
// sharing one would make a Today request eat the answer queued for the next parse.
const coachLlm = createFakeLlm("fake-coach-model");
const readings = createDayReadings(coachLlm);

function nextParse(items: ParsedItem[]): void {
	llm.nextOutput = { items };
}

/**
 * What the model will "read" out of the evidence on the next call. The shape is the lean
 * routing schema the provider is actually given, not the widened public one — a fake that
 * answered in a shape the real model never produces would hide the mapping.
 */
function nextFusion(result: FusionRoute, goalDetail?: unknown): void {
	if (goalDetail === undefined) {
		llm.nextOutput = { result };
		return;
	}
	// The goal path asks twice: route, then spec.
	llm.outputs.push({ result }, goalDetail);
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
		fusion,
		evidence: store,
		readings,
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

// ── WP2: evidence storage + the fusion endpoints ─────────────────────────────────────
// The whole multimodal path end to end, over the fake LlmPort and the in-memory
// EvidenceStore: a real multipart upload, a real sharp downscale, a real transaction.

/** A generated PNG, so the upload test needs no binary fixture in the repo. */
function png(width: number, height: number): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
		.png()
		.toBuffer();
}

describe("fusion — analyze", () => {
	let token: string;
	let otherToken: string;
	beforeAll(async () => {
		token = await signUp("gina@example.com");
		otherToken = await signUp("hank@example.com");
	});

	it("stores the photo downscaled, fuses it with the words, and returns a preview", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		const original = await png(2400, 1200);
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "db bench",
					description: "3 × 10 dumbbell bench at 45 lb",
					sets: 3,
					reps: 10,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 180,
					confidence: "medium",
					photo_fields: ["exercise", "load_lb"],
				},
			],
		});

		const res = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "three sets of ten")
			.field("tz_offset_min", "120")
			.field("kind_hint", "activities")
			.attach("photos", original, { filename: "machine.png", contentType: "image/png" });

		expect(res.status).toBe(200);
		expect(res.body.result.kind).toBe("activities");
		// photo_fields is widened into the per-field source map the confirm card shows.
		expect(res.body.result.items[0].sources).toMatchObject({
			exercise: "photo",
			load_lb: "photo",
			sets: "text",
			reps: "text",
			duration_min: null,
		});
		expect(res.body.evidence).toHaveLength(1);
		// Downscaled and re-encoded server-side, whatever the phone sent.
		expect(res.body.evidence[0]).toMatchObject({ kind: "photo", mime: "image/jpeg", width: 1600, height: 800 });
		expect(res.body.evidence[0].url).toBe(`/api/evidence/${res.body.evidence[0].id}`);

		const key = [...store.objects.keys()].at(-1)!;
		expect(await sharp(store.objects.get(key)!.data).metadata()).toMatchObject({ format: "jpeg", width: 1600 });

		// The model was shown the image, the catalogue, and today's context.
		const call = llm.requests.at(-1)!;
		const parts = call.messages[0]!.content as { type: string }[];
		expect(parts.filter((p) => p.type === "image")).toHaveLength(1);
		expect(call.system).toContain("Dumbbell Bench Press");
		expect(call.system).toContain('The app thinks this is a "activities"');

		// Preview only: nothing is in the log yet.
		const activities = await request(app).get("/api/entries/movement").set(auth);
		expect(activities.body).toEqual([]);
	});

	it("serves the photo back to its owner and 404s for anyone else", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		nextFusion({ kind: "statement", scope: "coach_context", text: "gym is busy" });
		const res = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "gym is busy")
			.attach("photos", await png(400, 200), { filename: "gym.jpg", contentType: "image/jpeg" });
		const id = res.body.evidence[0].id;

		const file = await request(app).get(`/api/evidence/${id}`).set(auth);
		expect(file.status).toBe(200);
		expect(file.headers["content-type"]).toContain("image/jpeg");
		expect(file.headers["cache-control"]).toContain("private");
		expect(file.body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

		// Someone else's evidence is "not found", not "forbidden": the difference is
		// information about what exists.
		const stranger = await request(app).get(`/api/evidence/${id}`).set({ Authorization: `Bearer ${otherToken}` });
		expect(stranger.status).toBe(404);
		const unknown = await request(app)
			.get("/api/evidence/00000000-0000-0000-0000-000000000000")
			.set(auth);
		expect(unknown.status).toBe(404);
		expect((await request(app).get("/api/evidence/not-a-uuid").set(auth)).status).toBe(404);
	});

	it("refuses too many photos, the wrong kind of file, an oversized one, and an empty log", async () => {
		const auth = { Authorization: `Bearer ${token}` };
		const small = await png(40, 40);

		const tooMany = request(app).post("/api/log/analyze").set(auth).field("text", "x");
		for (let i = 0; i < 5; i++) tooMany.attach("photos", small, { filename: `${i}.png`, contentType: "image/png" });
		expect((await tooMany).status).toBe(400);

		const wrongType = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "x")
			.attach("photos", Buffer.from("hello"), { filename: "note.txt", contentType: "text/plain" });
		expect(wrongType.status).toBe(415);

		const tooBig = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.attach("photos", Buffer.alloc(9 * 1024 * 1024), { filename: "huge.jpg", contentType: "image/jpeg" });
		expect(tooBig.status).toBe(413);

		expect((await request(app).post("/api/log/analyze").set(auth)).status).toBe(400);
	});
});

describe("fusion — confirm", () => {
	let token: string;
	let userId: string;
	let auth: { Authorization: string };

	beforeAll(async () => {
		token = await signUp("iris@example.com");
		auth = { Authorization: `Bearer ${token}` };
		const session = await request(app).get("/api/auth/get-session").set(auth);
		userId = session.body.user.id;
	});

	async function confirm(result: FusionResult, extra: Record<string, unknown> = {}) {
		return request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({ client_id: randomUUID(), result, ...extra });
	}

	it("saves activities, normalising the exercise and linking the evidence", async () => {
		// The realistic path: analyze the photo + words, then confirm what came back with
		// the user's correction to it (they fixed the load).
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "db bench",
					description: "3 × 10 dumbbell bench at 40 lb",
					sets: 3,
					reps: 10,
					load_lb: 40,
					duration_min: null,
					distance_mi: null,
					kcal: 180,
					confidence: "medium",
					photo_fields: ["exercise", "load_lb"],
				},
			],
		});
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "three sets of ten on the db bench")
			.attach("photos", await png(200, 100), { filename: "bench.png", contentType: "image/png" });
		expect(analyzed.status).toBe(200);
		const evidenceId = analyzed.body.evidence[0].id as string;

		const edited: FusionResult = {
			...analyzed.body.result,
			items: [{ ...analyzed.body.result.items[0], load_lb: 45 }],
		};
		const res = await confirm(edited, {
			evidence_ids: [evidenceId],
			text: "three sets of ten on the db bench",
			text_kind: "transcript",
		});

		expect(res.status).toBe(201);
		expect(res.body.activities).toHaveLength(1);
		expect(res.body.activities[0]).toMatchObject({
			// The catalogue's spelling, not the user's.
			exercise: "Dumbbell Bench Press",
			category: "strength",
			muscle_groups: ["chest"],
			sets: 3,
			reps: 10,
			// The user's correction, not the model's reading.
			load_lb: 45,
			// Evidence was attached, so the row is fused, not manual.
			source: "fused",
			confidence: "medium",
		});
		expect(res.body.activities[0].exercise_id).toMatch(/^[0-9a-f-]{36}$/);

		const activityId = res.body.activities[0].id;
		expect(res.body.evidence.map((e: { kind: string }) => e.kind).sort()).toEqual(["photo", "transcript"]);
		for (const e of res.body.evidence) {
			expect(e.activity_id).toBe(activityId);
			expect(e.confirmed_at).toBeTruthy();
		}
	});

	it("saves a meal with its items and its slot", async () => {
		const res = await confirm({
			kind: "meal",
			description: "chicken burrito with a soda",
			meal_type: "lunch",
			kcal: 950,
			protein_g: 38,
			carbs_g: 130,
			fat_g: 28,
			fiber_g: 8,
			items: [
				{ name: "chicken burrito", kcal: 800, protein_g: 38, carbs_g: 110, fat_g: 28, fiber_g: 8, serving_amount: "1" },
				{ name: "soda", kcal: 150, protein_g: 0, carbs_g: 20, fat_g: 0, fiber_g: 0, serving_amount: "12 oz" },
			],
			confidence: "medium",
			sources: null,
		});

		expect(res.status).toBe(201);
		expect(res.body.meal).toMatchObject({ description: "chicken burrito with a soda", kcal: 950, protein_g: 38, meal_type: "lunch" });
		expect(res.body.meal_items.map((i: { name: string }) => i.name)).toEqual(["chicken burrito", "soda"]);

		const stored = await db.pool.query(`SELECT * FROM meal_items WHERE meal_id = $1 ORDER BY kcal DESC`, [
			res.body.meal.id,
		]);
		expect(stored.rows).toHaveLength(2);
		expect(stored.rows[0]).toMatchObject({ name: "chicken burrito", kcal: 800, serving_amount: "1" });
	});

	it("saves a weight", async () => {
		const res = await confirm({ kind: "weight", weight_lb: 181.4, confidence: "high", sources: null });
		expect(res.status).toBe(201);
		expect(res.body.weight).toMatchObject({ weight_lb: 181.4 });
		const list = await request(app).get("/api/weight").set(auth);
		expect(list.body[0]).toMatchObject({ weight_lb: 181.4 });
	});

	it("saves a goal, active and last in priority", async () => {
		const first = await confirm({
			kind: "goal",
			spec: {
				kind: "lose_fat",
				title: "Down to 170 lb",
				metrics: [
					{ measure: "body_weight", scope: null, target: 170, unit: "lb", direction: "decrease", rate: "0.5 %/week", by: "2026-12-01" },
				],
				active_from: null,
				active_to: null,
			},
			proposed_timeline: { by: "2026-12-01", rate: "~1 lb/week", note: "a safe pace", realistic: true },
		});
		expect(first.status).toBe(201);
		expect(first.body.goal).toMatchObject({ kind: "lose_fat", title: "Down to 170 lb", status: "active", priority: 1 });
		// The accepted timeline becomes the goal's end date.
		expect(first.body.goal.active_to).toBe("2026-12-01");
		expect(first.body.goal.metrics[0]).toMatchObject({ measure: "body_weight", target: 170 });

		const second = await confirm({
			kind: "goal",
			spec: {
				kind: "build_strength",
				title: "Bench 185",
				metrics: [
					{ measure: "exercise_load", scope: "Bench Press", target: 185, unit: "lb", direction: "increase", rate: null, by: null },
				],
				active_from: null,
				active_to: null,
			},
			proposed_timeline: null,
		});
		// Appended, never promoted over the goal the user already has.
		expect(second.body.goal).toMatchObject({ priority: 2, status: "active" });
	});

	it("adds a constraint and a preference to the profile, dated, without duplicating", async () => {
		const constraint = await confirm({ kind: "constraint", text: "bad left knee", fields: null });
		expect(constraint.status).toBe(201);
		expect(constraint.body.profile.constraints).toEqual(["bad left knee"]);
		expect(constraint.body.profile.stated_at.constraints).toBeTruthy();

		// Saying it again is the same constraint, not a second one.
		const again = await confirm({ kind: "constraint", text: "bad left knee", fields: null });
		expect(again.body.profile.constraints).toEqual(["bad left knee"]);

		const preference = await confirm({
			kind: "preference",
			text: "switching to keto, four days a week",
			fields: {
				diet_style: "keto",
				protein_g: null,
				carbs_max_g: 50,
				training_days: 4,
				environment: "gym",
				equipment: null,
				eatback: null,
			},
		});
		expect(preference.status).toBe(201);
		expect(preference.body.profile).toMatchObject({
			diet_style: "keto",
			carbs_max_g: 50,
			training_days: 4,
			environment: "gym",
			preferences: ["switching to keto, four days a week"],
			// Untouched by this statement, so left alone.
			protein_g: null,
			eatback: "half",
		});
		expect(preference.body.profile.stated_at.diet_style).toBeTruthy();
		expect(preference.body.profile.constraints).toEqual(["bad left knee"]);
	});

	it("keeps coach context without writing a log row", async () => {
		const before = await request(app).get("/api/entries/movement").set(auth);
		const res = await confirm({ kind: "coach_context", text: "only 30 minutes today" });
		expect(res.status).toBe(201);
		expect(res.body.coach_context).toEqual({ text: "only 30 minutes today" });
		expect(res.body.activities).toEqual([]);
		const after = await request(app).get("/api/entries/movement").set(auth);
		expect(after.body).toHaveLength(before.body.length);
	});

	it("refuses to save an unclear reading and hands back the question", async () => {
		const res = await confirm({ kind: "unclear", question: "How many sets was that?" });
		expect(res.status).toBe(422);
		expect(res.body.error).toBe("How many sets was that?");
	});

	it("is idempotent: the same client_id saves once and replays the first answer", async () => {
		const client_id = randomUUID();
		const body = {
			client_id,
			result: {
				kind: "activities",
				items: [
					{
						exercise: "Lat Pulldown",
						description: "3 × 12 lat pulldown at 90 lb",
						category: null,
						muscle_groups: null,
						sets: 3,
						reps: 12,
						load_lb: 90,
						duration_min: null,
						distance_mi: null,
						kcal: 120,
						confidence: "high",
						sources: null,
					},
				],
			},
		};

		const first = await request(app).post("/api/log/confirm").set(auth).send(body);
		expect(first.status).toBe(201);
		expect(first.body.replayed).toBe(false);

		const retry = await request(app).post("/api/log/confirm").set(auth).send(body);
		expect(retry.status).toBe(201);
		expect(retry.body.replayed).toBe(true);
		expect(retry.body.activities[0].id).toBe(first.body.activities[0].id);

		const rows = await db.pool.query(
			`SELECT count(*)::int AS n FROM activities WHERE user_id = $1 AND exercise = 'Lat Pulldown'`,
			[userId]
		);
		expect(rows.rows[0].n).toBe(1);
	});

	it("rejects a body without a client uuid, and evidence that is not the caller's", async () => {
		const result: FusionResult = { kind: "weight", weight_lb: 180, confidence: "high", sources: null };
		expect((await request(app).post("/api/log/confirm").set(auth).send({ result })).status).toBe(400);
		expect(
			(await request(app).post("/api/log/confirm").set(auth).send({ client_id: "not-a-uuid", result })).status
		).toBe(400);

		// Another user's evidence id is simply not linked — nothing is said about it.
		const strangerToken = await signUp("jill@example.com");
		nextFusion({ kind: "statement", scope: "coach_context", text: "hi" });
		const theirs = await request(app)
			.post("/api/log/analyze")
			.set({ Authorization: `Bearer ${strangerToken}` })
			.field("text", "hi")
			.attach("photos", await png(50, 50), { filename: "a.png", contentType: "image/png" });
		const res = await confirm(result, { evidence_ids: [theirs.body.evidence[0].id] });
		expect(res.status).toBe(201);
		expect(res.body.evidence).toEqual([]);
	});
});

describe("evidence sweep", () => {
	it("deletes what no confirm kept, and only that", async () => {
		const token = await signUp("kate@example.com");
		const session = await request(app).get("/api/auth/get-session").set({ Authorization: `Bearer ${token}` });
		const userId = session.body.user.id as string;

		const abandoned = await store.put(Buffer.from("abandoned"), { mime: "image/jpeg", extension: "jpg" });
		const kept = await store.put(Buffer.from("kept"), { mime: "image/jpeg", extension: "jpg" });
		const fresh = await store.put(Buffer.from("fresh"), { mime: "image/jpeg", extension: "jpg" });
		await db.pool.query(
			`INSERT INTO evidence (user_id, kind, storage_key, mime, created_at) VALUES
			   ($1, 'photo', $2, 'image/jpeg', NOW() - INTERVAL '48 hours'),
			   ($1, 'photo', $3, 'image/jpeg', NOW() - INTERVAL '48 hours'),
			   ($1, 'photo', $4, 'image/jpeg', NOW())`,
			[userId, abandoned.key, kept.key, fresh.key]
		);
		await db.pool.query(`UPDATE evidence SET confirmed_at = NOW() WHERE storage_key = $1`, [kept.key]);

		const report = await sweepUnlinkedEvidence(db.pool, store);
		expect(report).toEqual({ rows: 1, files: 1 });
		expect(store.objects.has(abandoned.key)).toBe(false);
		expect(store.objects.has(kept.key)).toBe(true);
		expect(store.objects.has(fresh.key)).toBe(true);

		const left = await db.pool.query(`SELECT storage_key FROM evidence WHERE user_id = $1`, [userId]);
		expect(left.rows.map((r) => r.storage_key).sort()).toEqual([kept.key, fresh.key].sort());
	});
});
