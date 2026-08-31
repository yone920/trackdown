import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createAuth, type Auth } from "./auth.js";
import { sweepUnlinkedEvidence } from "./services/evidence.js";
import { setUserPassword } from "./services/password.js";
import { createLogParser, type ParsedItem } from "./services/parseLog.js";
import { createFusionAnalyzer } from "./services/fusion/analyze.js";
import { createDayReadings } from "./services/readings/readings.js";
import { buildCoachPrompt } from "./services/coach/prompt.js";
import type { FusionResult, FusionRoute, SegmentKind } from "./services/fusion/schema.js";
import { addDays, localDay } from "./services/localTime.js";
import { startTestDatabase, type TestDatabase } from "./test/db.js";
import { createFakeLlm } from "./test/fakes/llm.js";
import { createFakeCoach, SAMPLE_BRIEF } from "./test/fakes/coach.js";
import { createFakeExerciseMediaStore } from "./test/fakes/exerciseMedia.js";
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
// The illustrations behind GET /api/exercises/:id/media/:n. Imported for real by
// scripts/import-exercise-media.ts; here the test puts two bytes in and reads them back.
const exerciseMedia = createFakeExerciseMediaStore();
// The readings run on the coach model — a second port in production, so a second fake here:
// sharing one would make a Today request eat the answer queued for the next parse.
const coachLlm = createFakeLlm("fake-coach-model");
const readings = createDayReadings(coachLlm);
// The brief is its own port (src/ports/coach.ts), so it gets its own fake.
const coach = createFakeCoach("fake-coach-model");

function nextParse(items: ParsedItem[]): void {
	llm.nextOutput = { items };
}

/**
 * What the model will "read" out of the evidence on the next call. The shape is the lean
 * routing schema the provider is actually given, not the widened public one — a fake that
 * answered in a shape the real model never produces would hide the mapping.
 */
function nextFusion(result: FusionRoute, goalDetail?: unknown, photoFields: string[] = []): void {
	// `photo_fields` sits beside the result, not inside it — see FusionRouteOutputSchema.
	const answer = { result, more_kinds: [], photo_fields: photoFields };
	if (goalDetail === undefined) {
		llm.nextOutput = answer;
		return;
	}
	// The goal path asks twice: route, then spec.
	llm.outputs.push(answer, goalDetail);
}

/**
 * One input that is several things — a meal and a run and a weigh-in. `result` is the first
 * of them in full, `moreKinds` names the rest, and `details` are their focused answers in
 * the same order.
 */
function nextMixedFusion(result: FusionRoute, moreKinds: SegmentKind[], ...details: unknown[]): void {
	llm.outputs.push({ result, more_kinds: moreKinds, photo_fields: [] }, ...details);
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
		exerciseMedia,
		readings,
		coach,
		allowedOrigins: [],
		version: "test",
		commit: "test",
		rateLimiting: false,
	});
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

async function countRows(table: string, userId: string): Promise<number> {
	const { rows } = await db.pool.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM ${table} WHERE user_id = $1`,
		[userId]
	);
	return Number(rows[0]!.count);
}

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
					equipment: null,
					description: "3 × 10 dumbbell bench at 45 lb",
					sets: 3,
					reps: 10,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 180,
					confidence: "medium",
				},
			],
		}, undefined, ["exercise", "load_lb"]);

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
					equipment: null,
					description: "3 × 10 dumbbell bench at 40 lb",
					sets: 3,
					reps: 10,
					load_lb: 40,
					duration_min: null,
					distance_mi: null,
					kcal: 180,
					confidence: "medium",
				},
			],
		}, undefined, ["exercise", "load_lb"]);
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
			facts: null,
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
			facts: null,
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
				place_name: null,
				place_kind: null,
				experience: null,
				background: null,
				reference_loads: null,
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
		// WP5 gives the statement a home: one row on the user's local day (migration 0008),
		// which the coach reads back when it is asked that day.
		expect(res.body.coach_context).toMatchObject({ text: "only 30 minutes today" });
		expect(res.body.coach_context.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

// The mixed-input rework (docs/CHANGELOG-v2.md §Field fixes). One sentence, several things,
// one Save. The unit tests prove the analyzer splits; these prove the whole pipeline —
// analyze, the stacked preview, one transaction — writes every part of it.
describe("fusion — one input, several things", () => {
	let auth: { Authorization: string };
	let userId: string;

	const eggs: FusionRoute = {
		kind: "meal",
		description: "two eggs and toast",
		meal_type: "breakfast",
		kcal: 320,
		protein_g: 18,
		carbs_g: 30,
		fat_g: 14,
		fiber_g: 3,
		items: [],
		confidence: "medium",
	};
	const run = {
		items: [
			{
				exercise: "Treadmill Run",
				equipment: null,
				description: "5 km run in 28 minutes",
				sets: null,
				reps: null,
				load_lb: null,
				duration_min: 28,
				distance_mi: 3.11,
				kcal: 300,
				confidence: "medium",
			},
		],
		photo_fields: [] as string[],
		photo_indexes: [] as number[],
	};
	const weighIn = { weight_lb: 181, confidence: "high", photo_fields: [], photo_indexes: [] };

	beforeAll(async () => {
		const token = await signUp("mila@example.com");
		auth = { Authorization: `Bearer ${token}` };
		const session = await request(app).get("/api/auth/get-session").set(auth);
		userId = session.body.user.id;
	});

	it("reads a meal, a run and a weigh-in out of one sentence and saves them in one go", async () => {
		nextMixedFusion(eggs, ["activities", "weight"], run, weighIn);

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "ate two eggs and toast, then ran 5k, weighed in at 181");

		expect(analyzed.status).toBe(200);
		expect(analyzed.body.results.map((result: FusionResult) => result.kind)).toEqual([
			"meal",
			"activities",
			"weight",
		]);
		// Several parts, so there is no single `result` to name for an old client.
		expect(analyzed.body.result).toBeUndefined();

		const before = coach.inputs.length;
		const saved = await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				results: analyzed.body.results,
				text: "ate two eggs and toast, then ran 5k, weighed in at 181",
				text_kind: "transcript",
			});

		expect(saved.status).toBe(201);
		// The ids come back in the order the parts were said.
		expect(saved.body.kinds).toEqual(["meal", "activities", "weight"]);
		expect(saved.body.parts.map((part: { kind: string }) => part.kind)).toEqual([
			"meal",
			"activities",
			"weight",
		]);
		expect(saved.body.parts[0].meal_id).toEqual(saved.body.meal.id);
		expect(saved.body.parts[1].activity_ids).toEqual([saved.body.activities[0].id]);
		expect(saved.body.parts[2].weight_id).toEqual(saved.body.weight.id);
		// And the rows are really there, each in its own table.
		expect(saved.body.meal).toMatchObject({ kcal: 320, protein_g: 18 });
		expect(saved.body.activities[0]).toMatchObject({
			exercise: "Treadmill Run",
			category: "cardio",
			distance_mi: 3.11,
		});
		expect(saved.body.weight).toMatchObject({ weight_lb: 181 });
		// A log is not a question for the coach: saving one asks the model nothing.
		expect(coach.inputs).toHaveLength(before);

		// The transcript is kept against each record it became, so the DayLog can show the
		// words under all three rather than only under the meal.
		const evidence = await db.pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM evidence WHERE user_id = $1 AND kind = 'transcript'`,
			[userId]
		);
		expect(evidence.rows[0]!.n).toBe(3);
	});

	it("files each photo against the part it was read for", async () => {
		nextMixedFusion(eggs, ["activities"], { ...run, photo_indexes: [1] });

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(auth)
			.field("text", "had this, then this machine")
			.attach("photos", await png(120, 60), { filename: "plate.png", contentType: "image/png" })
			.attach("photos", await png(120, 60), { filename: "machine.png", contentType: "image/png" });

		expect(analyzed.status).toBe(200);
		// The plate stayed with the meal, the machine went to the run.
		expect(analyzed.body.evidence.map((item: { part: number }) => item.part)).toEqual([0, 1]);

		const ids = analyzed.body.evidence.map((item: { id: string }) => item.id);
		const saved = await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				results: analyzed.body.results,
				evidence_ids: ids,
				evidence_parts: analyzed.body.evidence.map((item: { part: number }) => item.part),
			});

		expect(saved.status).toBe(201);
		const rows = await db.pool.query<{ id: string; meal_id: string | null; activity_id: string | null }>(
			`SELECT id, meal_id, activity_id FROM evidence WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
			[ids]
		);
		expect(rows.rows[0]).toMatchObject({ meal_id: saved.body.meal.id, activity_id: null });
		expect(rows.rows[1]).toMatchObject({ meal_id: null, activity_id: saved.body.activities[0].id });
	});

	it("writes every part or none of them", async () => {
		const goodMeal: FusionResult = {
			kind: "meal",
			description: "a sandwich",
			meal_type: "lunch",
			kcal: 400,
			protein_g: null,
			carbs_g: null,
			fat_g: null,
			fiber_g: null,
			items: [],
			confidence: "medium",
			sources: null,
		};
		const res = await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				// The second part is a question, not a record: nothing in this Save is written.
				results: [goodMeal, { kind: "unclear", question: "How far did you run?" }],
			});

		expect(res.status).toBe(422);
		expect(res.body.error).toBe("How far did you run?");
		const meals = await db.pool.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM meals WHERE user_id = $1 AND description = 'a sandwich'`,
			[userId]
		);
		expect(meals.rows[0]!.n).toBe(0);
	});

	it("still answers a single-kind log the way it always did", async () => {
		nextFusion({ kind: "weight", weight_lb: 179.6, confidence: "high" });
		const analyzed = await request(app).post("/api/log/analyze").set(auth).field("text", "179.6 this morning");

		expect(analyzed.status).toBe(200);
		// `result` is still there for a client written before this existed, and `results`
		// holds the same one thing.
		expect(analyzed.body.result).toMatchObject({ kind: "weight", weight_lb: 179.6 });
		expect(analyzed.body.results).toHaveLength(1);
		// One kind, one call — the segmenting did not add a round trip to the hot path.
		expect(llm.requests.at(-1)?.schemaName).toBe("fusion_result");

		// And the old single-`result` confirm body still saves.
		const saved = await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({ client_id: randomUUID(), result: analyzed.body.result });
		expect(saved.status).toBe(201);
		expect(saved.body).toMatchObject({ kind: "weight", kinds: ["weight"] });
		expect(saved.body.weight).toMatchObject({ weight_lb: 179.6 });
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

// ── WP3: the day, the week and the list of days ──────────────────────────────────────
// The SQL half of the day model, end to end: real rows in real Postgres, the real close
// job, and the readings over the fake coach LlmPort. The arithmetic itself (clustering,
// the overlap rules, thresholds, verdicts, deltas) is unit-tested in
// src/services/day/day.test.ts; what is proved here is that the queries, the local-day
// windows and the close all agree with it.

const READING = {
	text: "You are 1,840 kcal short of your allowance with dinner still open.",
	next_action: { label: "Log dinner", kind: "log_meal", hint: "Dinner is the only slot left" },
	actions: [{ label: "Ask the coach", kind: "coach" }],
};

/** An offset that makes it `hour`:00 in the user's local time right now, whenever the suite runs. */
function tzForLocalHour(hour: number): number {
	const now = new Date();
	const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
	const offset = hour * 60 - utcMinutes;
	// ±14 h is the API's limit; shifting a day does not change the local hour.
	return offset > 840 ? offset - 1440 : offset < -840 ? offset + 1440 : offset;
}

/** The instant at `clock` local time on `date`, for a user at `tz`. */
function localInstant(date: string, clock: string, tz: number): string {
	const [h, m] = clock.split(":").map(Number);
	return new Date(
		Date.parse(`${date}T00:00:00Z`) - tz * 60_000 + ((h as number) * 60 + (m as number)) * 60_000
	).toISOString();
}

describe("day — the live day", () => {
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	const lastWeek = addDays(today, -7);
	let token: string;
	let headers: Record<string, string>;

	beforeAll(async () => {
		token = await signUp("nora@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;

		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "male",
				// Relative, so the age the TDEE is computed from is 38 in any year the suite runs.
				birth_year: new Date().getUTCFullYear() - 38,
				height_cm: 180,
				activity_level: "moderate",
				goal_pace: "standard",
				goal_weight_lb: 170,
			});
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 195, logged_at: localInstant(lastWeek, "07:00", tz) });
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 193.4, logged_at: localInstant(today, "06:40", tz) });

		// Last week's bench, so today's has something to be a delta against.
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: "3 × 8 bench at 130 lb",
				exercise: "Bench Press",
				sets: 3,
				reps: 8,
				load_lb: 130,
				kcal: 110,
				logged_at: localInstant(lastWeek, "18:10", tz),
			});

		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "eggs and toast", kcal: 480, protein_g: 32, carbs_g: 40, fat_g: 20, fiber_g: 4, logged_at: localInstant(today, "07:30", tz) });
		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "chicken and rice", kcal: 700, protein_g: 55, carbs_g: 70, fat_g: 18, fiber_g: 6, logged_at: localInstant(today, "12:30", tz) });

		// One gym block: three lifts inside ninety minutes of each other.
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 8 bench at 135 lb", exercise: "Bench Press", sets: 3, reps: 8, load_lb: 135, kcal: 120, logged_at: localInstant(today, "13:10", tz) });
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 10 lat pulldown at 110 lb", exercise: "Lat Pulldown", sets: 3, reps: 10, load_lb: 110, kcal: 100, logged_at: localInstant(today, "13:35", tz) });
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "4 × 12 dumbbell row at 45 lb", exercise: "Dumbbell Row", sets: 4, reps: 12, load_lb: 45, kcal: 90, logged_at: localInstant(today, "14:05", tz) });
	}, 60_000);

	it("computes the day: one block, the calorie model, macros, weight trend and the delta", async () => {
		const res = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		const day = res.body;

		expect(day).toMatchObject({ date: today, is_today: true, closed_at: null, tz_offset_min: tz });
		expect(day.items.meals).toHaveLength(2);
		expect(day.items.activities).toHaveLength(3);

		// One block, because the three lifts are within ninety minutes of each other.
		expect(day.blocks).toHaveLength(1);
		expect(day.blocks[0]).toMatchObject({ exercise_count: 3, kcal: 310, category: "strength" });
		expect(day.blocks[0].title).toMatch(/back|chest/i);
		for (const activity of day.items.activities) expect(activity.block_id).toBe(day.blocks[0].id);

		// eaten = Σ meals; earned = Σ block calories; allowance = target + half of earned.
		expect(day.eaten).toBe(1180);
		expect(day.earned).toBe(310);
		// 193.4 lb, 180 cm, 38, moderate → Mifflin-St Jeor 1,817 BMR × 1.55, minus the
		// standard pace's 20 %, plus half of what the gym earned.
		expect(day.tdee).toBe(2817);
		expect(day.target).toBe(2254);
		expect(day.eatback).toBe("half");
		expect(day.allowance).toBe(2254 + 155);
		expect(day.remaining).toBe(day.allowance - 1180);
		expect(day.balance).toBe(2817 + 310 - 1180);

		expect(day.macros.protein_g).toMatchObject({ eaten: 87, note: "under" });
		expect(day.macros.protein_g.target).toBeGreaterThan(150);

		expect(day.weight).toMatchObject({ day: 193.4, avg_7d: 193.4 });
		// The 7-day average has moved down from last week's single 195 lb reading.
		expect(day.weight.trend_per_week).toBeLessThan(0);

		const bench = day.items.activities.find((a: { exercise: string }) => a.exercise === "Bench Press");
		expect(bench.delta_vs_last).toMatchObject({ text: "+5 lb", direction: "up", field: "load_lb" });
		expect(bench.delta_vs_last.previous).toMatchObject({ load_lb: 130 });
		const row = day.items.activities.find((a: { exercise: string }) => a.exercise === "Dumbbell Row");
		expect(row.delta_vs_last).toMatchObject({ text: "first time", direction: "new" });

		expect(day.muscle_summary.map((m: { muscle: string }) => m.muscle)).toContain("back");
		expect(day.eating_pattern).toContain("2 meals");
		expect(day.expected.map((e: { kind: string }) => e.kind)).toContain("meal");
		expect(day.arc.some((event: { kind: string }) => event.kind === "now")).toBe(true);
		expect(day.arc.some((event: { kind: string }) => event.kind === "block")).toBe(true);

		// No goal, so no judgement colours anywhere (concept-v2 §Goals).
		expect(day).toMatchObject({ status: "none", verdict: "none", goal: null, goal_involves_calories: false });

		// The 28-day fact window is server-side only.
		expect(day.facts).toBeUndefined();
	});

	it("writes the Right now reading once and reuses it until the day changes", async () => {
		const before = coachLlm.requests.length;
		const first = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(first.body.reading).toMatchObject({ kind: "right_now", text: READING.text, model: "fake-coach-model" });
		expect(first.body.reading.next_action).toMatchObject({ kind: "log_meal", label: "Log dinner" });

		// The clock moved; nothing else did. No second call.
		const again = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(again.body.reading.inputs_hash).toBe(first.body.reading.inputs_hash);
		expect(coachLlm.requests.length).toBe(before);

		coachLlm.nextOutput = { ...READING, text: "Dinner is logged; you are 320 kcal under your allowance." };
		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "salmon and potatoes", kcal: 820, protein_g: 48, logged_at: localInstant(today, "14:40", tz) });

		const after = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(after.body.reading.text).toContain("Dinner is logged");
		expect(after.body.reading.inputs_hash).not.toBe(first.body.reading.inputs_hash);
		expect(coachLlm.requests.length).toBe(before + 1);
		// The prompt is the computed day — totals, blocks and deltas — not the rows.
		const sheet = coachLlm.requests.at(-1)?.system as string;
		expect(sheet).toContain("vs last time: +5 lb");
		expect(sheet).toContain("Allowance (target + eat-back)");
		expect(sheet).not.toContain(first.body.blocks[0].id);
		coachLlm.nextOutput = READING;
	});

	it("refuses a day that has not happened and a date that is not one", async () => {
		expect((await request(app).get(`/api/day/${addDays(today, 1)}?tz=${tz}`).set(headers)).status).toBe(400);
		expect((await request(app).get(`/api/day/yesterday?tz=${tz}`).set(headers)).status).toBe(400);
		expect((await request(app).get(`/api/day/today?tz=999`).set(headers)).status).toBe(400);
		expect((await request(app).get(`/api/day/today?tz=${tz}`)).status).toBe(401);
	});

	// Deleting a row is the one write that has to move *everything* — the endpoint was
	// already covered, what was not is that the computed day agrees with it afterwards.
	it("recomputes the day when a logged row is deleted, and takes its evidence with it", async () => {
		const before = (await request(app).get(`/api/day/today?tz=${tz}`).set(headers)).body;
		expect(before.earned).toBe(310);
		const row = before.items.activities.find((a: { exercise: string }) => a.exercise === "Dumbbell Row");
		const muscle = row.muscle_groups[0] as string;
		const setsBefore = before.muscle_summary.find((m: { muscle: string }) => m.muscle === muscle).sets;

		// A photo hanging off the row, so the cascade is exercised rather than assumed
		// (0004_v2.sql: evidence.activity_id REFERENCES activities(id) ON DELETE CASCADE).
		const evidenceId = randomUUID();
		await db.pool.query(
			`INSERT INTO evidence (id, user_id, activity_id, kind, storage_key)
			 VALUES ($1::uuid, (SELECT user_id FROM activities WHERE id = $2::uuid), $2::uuid, 'photo', $3)`,
			[evidenceId, row.id, `deleted-row-${evidenceId}`]
		);

		expect((await request(app).delete(`/api/entries/movement/${row.id}`).set(headers)).status).toBe(204);

		const after = (await request(app).get(`/api/day/today?tz=${tz}`).set(headers)).body;
		expect(after.earned).toBe(310 - row.kcal);
		expect(after.items.activities).toHaveLength(before.items.activities.length - 1);
		expect(after.blocks[0].exercise_count).toBe(before.blocks[0].exercise_count - 1);
		expect(after.blocks[0].kcal).toBe(after.earned);
		// The allowance is target + half of what is left, so the ring moves with it.
		expect(after.allowance).toBe(after.target + Math.round(after.earned / 2));
		const setsAfter = after.muscle_summary.find((m: { muscle: string }) => m.muscle === muscle)?.sets ?? 0;
		expect(setsAfter).toBe(setsBefore - row.sets);
		// The day changed, so the Right-now reading is not the one that was cached.
		expect(after.reading.inputs_hash).not.toBe(before.reading.inputs_hash);

		expect((await db.pool.query(`SELECT 1 FROM evidence WHERE id = $1`, [evidenceId])).rowCount).toBe(0);
		// A retry of the same delete is a 404, not a second success.
		expect((await request(app).delete(`/api/entries/movement/${row.id}`).set(headers)).status).toBe(404);
	});
});

describe("day — Health overlap over real rows", () => {
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;
	let userId: string;

	beforeAll(async () => {
		const token = await signUp("owen@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		const session = await request(app).get("/api/auth/get-session").set(headers);
		userId = session.body.user.id as string;

		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 8 squat at 185 lb", exercise: "Squat", sets: 3, reps: 8, load_lb: 185, kcal: 150, logged_at: localInstant(today, "12:10", tz) });
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 10 leg press at 200 lb", exercise: "Leg Press", sets: 3, reps: 10, load_lb: 200, kcal: 130, logged_at: localInstant(today, "12:40", tz) });

		await db.pool.query(
			`INSERT INTO health_samples (user_id, kind, external_id, start_at, end_at, value, unit, raw) VALUES
			   ($1, 'workout', 'hk-gym', $2, $3, 520, 'kcal', '{"name":"Traditional Strength Training","duration_min":50}'::jsonb),
			   ($1, 'workout', 'hk-walk', $4, $5, 180, 'kcal', '{"name":"Walking","duration_min":40,"distance_mi":2.1}'::jsonb),
			   ($1, 'active_energy', 'hk-ae', $2, $3, 700, 'kcal', '{}'::jsonb),
			   ($1, 'steps', 'hk-steps', $2, $3, 8400, 'count', '{}'::jsonb)`,
			[
				userId,
				localInstant(today, "12:05", tz),
				localInstant(today, "12:55", tz),
				localInstant(today, "07:00", tz),
				localInstant(today, "07:40", tz),
			]
		);
	}, 60_000);

	it("attaches the gym workout to the block and keeps the walk as its own activity", async () => {
		const day = (await request(app).get(`/api/day/today?tz=${tz}`).set(headers)).body;

		expect(day.blocks).toHaveLength(1);
		expect(day.blocks[0].health).toMatchObject({ external_id: "hk-gym", kcal: 520 });
		// The user's own 280 stands: the watch is measured, but it is an estimate too, and
		// its calories are never added on top.
		expect(day.blocks[0].kcal).toBe(280);
		expect(day.blocks[0].kcal_from_health).toBe(false);

		const walk = day.items.activities.find((a: { source: string }) => a.source === "health");
		expect(walk).toMatchObject({ description: "Walking", kcal: 180, duration_min: 40, distance_mi: 2.1, block_id: null });

		// earned = the block (280) + the standalone walk (180). Daily active energy is the
		// baseline the TDEE already covers and is never added.
		expect(day.earned).toBe(460);
		expect(day.health).toEqual({ active_energy: 700, steps: 8400 });
	});
});

describe("day — a lifting session that reported no calories", () => {
	// The field report (2026-08-31): four exercises, 8:00 to 8:39, no kcal on any of them,
	// and a day that read "0 kcal earned". Lifts print no number, so the block estimates
	// one (services/day/estimate.ts) and every screen and every reader gets the same one.
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	const yesterday = addDays(today, -1);
	let headers: Record<string, string>;
	let userId: string;

	/** 190 lb = 86.18 kg; 4.5 MET × 3.5 × 86.18 / 200 × 9.75 min = 66 kcal an exercise. */
	const EXPECTED_EARNED = 264;

	async function liftingMorning(date: string): Promise<void> {
		const session: [string, string, string][] = [
			["08:00", "Bench Press", "chest"],
			["08:12", "Incline Dumbbell Press", "chest"],
			["08:25", "Cable Fly", "chest"],
			["08:39", "Triceps Pushdown", "triceps"],
		];
		for (const [clock, exercise, muscle] of session) {
			const res = await request(app)
				.post("/api/entries/movement")
				.set(headers)
				.send({
					description: `3 × 10 ${exercise.toLowerCase()}`,
					exercise,
					category: "strength",
					muscle_groups: [muscle],
					sets: 3,
					reps: 10,
					logged_at: localInstant(date, clock, tz),
				});
			expect(res.status).toBe(201);
		}
	}

	beforeAll(async () => {
		const token = await signUp("mira@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		userId = (await request(app).get("/api/auth/get-session").set(headers)).body.user.id as string;

		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "male",
				birth_year: new Date().getUTCFullYear() - 38,
				height_cm: 180,
				activity_level: "moderate",
				goal_pace: "standard",
			});
		await request(app)
			.post("/api/weight")
			.set(headers)
			.send({ weight_lb: 190, logged_at: localInstant(yesterday, "07:00", tz) });
		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({
				description: "the day's food",
				kcal: 1900,
				protein_g: 150,
				carbs_g: 180,
				fat_g: 60,
				fiber_g: 25,
				logged_at: localInstant(yesterday, "12:30", tz),
			});

		await liftingMorning(yesterday);
		await liftingMorning(today);
	}, 60_000);

	it("earns calories for the block instead of reading zero, and says they are an estimate", async () => {
		const day = (await request(app).get(`/api/day/today?tz=${tz}`).set(headers)).body;

		expect(day.items.activities).toHaveLength(4);
		// Every row still carries the zero it was logged with — the estimate is the block's.
		for (const activity of day.items.activities) expect(activity.kcal).toBe(0);

		expect(day.blocks).toHaveLength(1);
		expect(day.blocks[0]).toMatchObject({
			exercise_count: 4,
			minutes: 39,
			category: "strength",
			kcal: EXPECTED_EARNED,
			kcal_estimated: true,
			kcal_from_health: false,
		});
		expect(day.earned).toBe(EXPECTED_EARNED);
		expect(day.summary_line).toContain("264 earned");
		// The allowance and the balance are built from the same number.
		expect(day.allowance).toBe((day.target as number) + Math.round(EXPECTED_EARNED / 2));
		expect(day.balance).toBe((day.tdee as number) + EXPECTED_EARNED - day.eaten);
	});

	it("writes nothing to the activities rows", async () => {
		const { rows } = await db.pool.query<{ kcal: number }>(`SELECT kcal FROM activities WHERE user_id = $1`, [userId]);
		expect(rows).toHaveLength(8);
		for (const row of rows) expect(Number(row.kcal)).toBe(0);
	});

	it("closes the day with the estimate in it, so the week and the Days list agree", async () => {
		const closed = await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz, date: yesterday });
		expect(closed.status).toBe(200);

		const { rows } = await db.pool.query<{
			earned: number;
			kcal_burned: number;
			blocks: { kcal: number; kcal_estimated: boolean }[];
		}>(`SELECT earned, kcal_burned, blocks FROM daily_summaries WHERE user_id = $1 AND date = $2::date`, [
			userId,
			yesterday,
		]);
		expect(rows[0]?.earned).toBe(EXPECTED_EARNED);
		expect(rows[0]?.kcal_burned).toBe(EXPECTED_EARNED);
		expect(rows[0]?.blocks[0]).toMatchObject({ kcal: EXPECTED_EARNED, kcal_estimated: true });

		// The week reads the frozen record for yesterday and recomputes today; both agree.
		const week = (await request(app).get(`/api/week?tz=${tz}`).set(headers)).body;
		const rowFor = (date: string) => week.days.find((day: { date: string }) => day.date === date);
		expect(rowFor(yesterday).earned).toBe(EXPECTED_EARNED);
		expect(rowFor(today).earned).toBe(EXPECTED_EARNED);
		expect(week.weekly_deficit).toBe(
			week.days.reduce((total: number, day: { balance: number | null }) => total + (day.balance ?? 0), 0)
		);
	});

	it("gives the coach the same earned figure it gives the ring", async () => {
		coach.nextBrief = SAMPLE_BRIEF;
		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);

		const inputs = coach.inputs.at(-1);
		expect(inputs?.today.earned).toBe(EXPECTED_EARNED);
		// The features window is built from the same facts, so it sees the session too.
		expect(inputs?.features.sessions_this_week).toBeGreaterThan(0);
		expect(buildCoachPrompt(inputs!)).toContain(`Earned from activity: ${EXPECTED_EARNED} kcal`);
	});
});

describe("day close", () => {
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	const yesterday = addDays(today, -1);
	const twoDaysAgo = addDays(today, -2);
	let headers: Record<string, string>;
	let userId: string;

	beforeAll(async () => {
		const token = await signUp("pia@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		userId = (await request(app).get("/api/auth/get-session").set(headers)).body.user.id as string;

		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "female",
				birth_year: new Date().getUTCFullYear() - 31,
				height_cm: 165,
				activity_level: "light",
				goal_pace: "gentle",
			});
		await db.pool.query(
			`INSERT INTO goals (user_id, kind, title, metrics, priority, status, active_from)
			 VALUES ($1, 'lose_fat', 'Down to 135 lb', '[{"measure":"body_weight","target":135,"direction":"decrease","scope":null,"unit":"lb","rate":null,"by":null}]'::jsonb, 1, 'active', $2::date)`,
			[userId, addDays(today, -30)]
		);

		for (const [date, kcal] of [
			[twoDaysAgo, 1500],
			[yesterday, 1600],
		] as const) {
			await request(app).post("/api/weight").set(headers).send({ weight_lb: 150, logged_at: localInstant(date, "07:00", tz) });
			await request(app)
				.post("/api/entries/meals")
				.set(headers)
				.send({ description: "the day's food", kcal, protein_g: 110, carbs_g: 120, fat_g: 50, fiber_g: 20, logged_at: localInstant(date, "12:30", tz) });
			await request(app)
				.post("/api/entries/movement")
				.set(headers)
				.send({ description: "40 min walk", exercise: "Walk", category: "cardio", duration_min: 40, kcal: 150, logged_at: localInstant(date, "18:00", tz) });
		}
	}, 60_000);

	it("closes every unclosed past day on the first request, and writes its reading once", async () => {
		coachLlm.nextOutput = { ...READING, text: "You ate 1,600 kcal and walked 40 minutes; the day served the goal." };
		const before = coachLlm.requests.length;

		await request(app).get(`/api/day/today?tz=${tz}`).set(headers);

		const { rows } = await db.pool.query(
			`SELECT * FROM daily_summaries WHERE user_id = $1 ORDER BY date`,
			[userId]
		);
		expect(rows.map((r) => r.date)).toEqual([twoDaysAgo, yesterday]);
		const closed = rows[1]!;
		expect(closed).toMatchObject({
			kcal_consumed: 1600,
			kcal_burned: 150,
			eaten: 1600,
			earned: 150,
			verdict: "served",
			weight_lb: 150,
			meal_count: 1,
		});
		expect(closed.status).toBe("on_track");
		expect(Number(closed.protein_g)).toBe(110);
		expect(closed.blocks).toHaveLength(1);
		expect(closed.tdee).toBeGreaterThan(1500);
		expect(closed.summary_line).toContain("kcal in 1 meal");
		expect(closed.closed_at).toBeTruthy();
		expect(closed.in_short).toContain("served the goal");

		// Two closed days, two in_short readings, plus today's right_now.
		expect(coachLlm.requests.length).toBe(before + 3);
	});

	it("is idempotent — a second close changes nothing and costs no generation", async () => {
		const before = coachLlm.requests.length;
		const closedAt = (
			await db.pool.query<{ closed_at: string }>(
				`SELECT closed_at FROM daily_summaries WHERE user_id = $1 AND date = $2::date`,
				[userId, yesterday]
			)
		).rows[0]!.closed_at;

		const res = await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ closed: [], already_closed: 0 });

		const named = await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz, date: yesterday });
		expect(named.body).toEqual({ closed: [], already_closed: 1 });

		const after = await db.pool.query<{ closed_at: string }>(
			`SELECT closed_at FROM daily_summaries WHERE user_id = $1 AND date = $2::date`,
			[userId, yesterday]
		);
		expect(after.rows[0]!.closed_at).toBe(closedAt);
		expect(await countRows("daily_summaries", userId)).toBe(2);
		expect(coachLlm.requests.length).toBe(before);
	});

	it("will not close the day the user is still living", async () => {
		const res = await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz, date: today });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/still running/);
		expect((await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz, date: "not-a-date" })).status).toBe(400);
	});

	it("serves a closed day from its record, with the reading written at close", async () => {
		const res = await request(app).get(`/api/day/${yesterday}?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ date: yesterday, is_today: false, verdict: "served", verdict_words: "Served your goal" });
		expect(res.body.closed_at).toBeTruthy();
		expect(res.body.reading).toMatchObject({ kind: "in_short" });
		expect(res.body.reading.text).toContain("served the goal");
		expect(res.body.goal).toMatchObject({ title: "Down to 135 lb" });
		expect(res.body.expected).toEqual([]);
		expect(res.body.arc.some((event: { kind: string }) => event.kind === "now")).toBe(false);
	});

	it("gives the week its statuses, verdicts and deficit", async () => {
		const res = await request(app).get(`/api/week?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.days).toHaveLength(7);
		expect(res.body.end).toBe(today);
		expect(res.body.days.at(-1)).toMatchObject({ date: today, is_today: true });

		const closed = res.body.days.find((day: { date: string }) => day.date === yesterday);
		expect(closed).toMatchObject({ verdict: "served", status: "on_track", eaten: 1600, earned: 150, closed: true });
		// Σ(TDEE + earned − eaten) over the days with data, positive = a deficit.
		expect(res.body.weekly_deficit).toBeGreaterThan(0);
		expect(res.body.served).toBe(2);
		expect(res.body.judged).toBeGreaterThanOrEqual(2);

		// A day with nothing in it was never closed, and is not judged.
		const empty = res.body.days.find((day: { date: string }) => day.date === addDays(today, -5));
		expect(empty).toMatchObject({ verdict: "unlogged", summary: "Nothing logged" });
	});

	it("lists the days, newest first, paged", async () => {
		const res = await request(app).get(`/api/days?tz=${tz}&limit=1`).set(headers);
		expect(res.status).toBe(200);
		// The open day leads the list; the page of closed days follows it.
		expect(res.body.days.map((d: { date: string }) => d.date)).toEqual([today, yesterday]);
		expect(res.body.days[0]).toMatchObject({ is_today: true, closed: false });
		expect(res.body.days[1]).toMatchObject({
			is_today: false,
			closed: true,
			verdict: "served",
			verdict_words: "Served your goal",
			day_number: 2,
		});
		expect(res.body.days[1].summary).toContain("Walk");
		expect(res.body.next_before).toBe(yesterday);

		const older = await request(app).get(`/api/days?tz=${tz}&limit=1&before=${res.body.next_before}`).set(headers);
		expect(older.body.days.map((d: { date: string }) => d.date)).toEqual([twoDaysAgo]);
		expect(older.body.next_before).toBe(twoDaysAgo);

		expect((await request(app).get(`/api/days?tz=${tz}&before=nope`).set(headers)).status).toBe(400);
	});
});

describe("day — the log as recorded", () => {
	// WP6b: GET /api/day/:date/log. The Day screen is a reading; this is the audit trail
	// behind "See the log as recorded" (docs/design-system.md §DayLog).
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	let auth: { Authorization: string };

	beforeAll(async () => {
		const token = await signUp("rex@example.com");
		auth = { Authorization: `Bearer ${token}` };

		// Spoken: a transcript kept as evidence beside the activity it became.
		await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				result: {
					kind: "activities",
					items: [
						{
							exercise: "Bench Press",
							description: "3 × 8 bench at 135 lb",
							category: "strength",
							muscle_groups: ["chest"],
							sets: 3,
							reps: 8,
							load_lb: 135,
							duration_min: null,
							distance_mi: null,
							kcal: 120,
							confidence: "high",
							sources: null,
						},
					],
				},
				text: "bench press, three sets of eight at one thirty five",
				text_kind: "transcript",
				logged_at: localInstant(today, "13:10", tz),
			});

		// Typed: a weigh-in, whose note points at the weight since migration 0009.
		await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				result: { kind: "weight", weight_lb: 181.4, confidence: "high", sources: null },
				text: "181.4 on the scale",
				logged_at: localInstant(today, "07:00", tz),
			});

		// A statement: nothing to point at, but the user did say it today.
		await request(app)
			.post("/api/log/confirm")
			.set(auth)
			.send({
				client_id: randomUUID(),
				result: { kind: "coach_context", text: "knee hurts today" },
				text: "knee hurts today",
				tz_offset_min: tz,
			});
	}, 60_000);

	it("lists the day's entries in the order they happened, with the raw words", async () => {
		const res = await request(app).get(`/api/day/${today}/log?tz=${tz}`).set(auth);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ date: today, tz_offset_min: tz });

		const kinds = res.body.entries.map((entry: { kind: string }) => entry.kind);
		expect(kinds).toEqual(["weight", "activity", "statement"]);

		const weight = res.body.entries[0];
		expect(weight).toMatchObject({
			kind: "weight",
			raw_text: "181.4 on the scale",
			icon: "keyboard",
			understood: "Weighed 181.4 lb",
			editable: true,
		});
		expect(weight.record).toMatchObject({ kind: "weight", weight_lb: 181.4 });

		const activity = res.body.entries[1];
		expect(activity).toMatchObject({
			kind: "activity",
			raw_text: "bench press, three sets of eight at one thirty five",
			// A transcript, so the row is a microphone rather than a keyboard.
			icon: "mic",
			source: "manual",
			confidence: "high",
			understood: "Bench Press · 3 × 8 · 135 lb · 120 kcal",
			editable: true,
		});
		expect(activity.record).toMatchObject({ kind: "activity", sets: 3, reps: 8, load_lb: 135 });

		// A constraint or a line of context has no row to correct, and says so.
		expect(res.body.entries[2]).toMatchObject({ kind: "statement", editable: false });
		expect(res.body.entries[2].record.text).toBe("knee hurts today");
	});

	it("corrects a weigh-in in place", async () => {
		const before = await request(app).get(`/api/day/${today}/log?tz=${tz}`).set(auth);
		const weight = before.body.entries.find((entry: { kind: string }) => entry.kind === "weight");

		const patched = await request(app).patch(`/api/weight/${weight.id}`).set(auth).send({ weight_lb: 180.2 });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ weight_lb: 180.2 });

		const after = await request(app).get(`/api/day/${today}/log?tz=${tz}`).set(auth);
		const corrected = after.body.entries.find((entry: { kind: string }) => entry.kind === "weight");
		expect(corrected.understood).toBe("Weighed 180.2 lb");
		// The note that was recorded is untouched: the log says what was said, not what
		// the number became.
		expect(corrected.raw_text).toBe("181.4 on the scale");
	});

	it("is empty for a day with nothing in it, and refuses a day that has not happened", async () => {
		const empty = await request(app).get(`/api/day/${addDays(today, -3)}/log?tz=${tz}`).set(auth);
		expect(empty.status).toBe(200);
		expect(empty.body.entries).toEqual([]);

		expect((await request(app).get(`/api/day/${addDays(today, 1)}/log?tz=${tz}`).set(auth)).status).toBe(400);
		expect((await request(app).get(`/api/day/nope/log?tz=${tz}`).set(auth)).status).toBe(400);
	});

	it("shows another user nothing of it", async () => {
		const stranger = await signUp("sam@example.com");
		const res = await request(app)
			.get(`/api/day/${today}/log?tz=${tz}`)
			.set({ Authorization: `Bearer ${stranger}` });
		expect(res.body.entries).toEqual([]);
	});
});

describe("day — timezone edges", () => {
	// Los Angeles, UTC−7: a log at 23:30 local is 06:30 the next morning in UTC. It belongs
	// to the local day it was logged in, and to no other.
	const tz = -420;
	const today = localDay(new Date(), tz).date;
	const yesterday = addDays(today, -1);

	it("puts a log at 23:30 local on that local day, not the UTC one", async () => {
		const token = await signUp("quinn@example.com");
		const headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;

		const lateNight = localInstant(yesterday, "23:30", tz);
		// Sanity: this really is the next calendar day in UTC.
		expect(lateNight.slice(0, 10)).toBe(today);

		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "late bowl of cereal", kcal: 320, logged_at: lateNight });

		const theirDay = await request(app).get(`/api/day/${yesterday}?tz=${tz}`).set(headers);
		expect(theirDay.body.items.meals.map((m: { description: string }) => m.description)).toEqual(["late bowl of cereal"]);
		expect(theirDay.body.eaten).toBe(320);

		const nextDay = await request(app).get(`/api/day/${today}?tz=${tz}`).set(headers);
		expect(nextDay.body.items.meals).toEqual([]);

		// And the close agrees with the day view about which day that was.
		await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz });
		const { rows } = await db.pool.query<{ date: string; eaten: number }>(
			`SELECT date, eaten FROM daily_summaries WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
			["quinn@example.com"]
		);
		expect(rows).toEqual([{ date: yesterday, eaten: 320 }]);
	});
});

// ── WP4: goals, the plan, and what they judge ────────────────────────────────────────
// The SQL half of goals: the routes, the priority order, what a status change does to the
// date window, and the detection the day close runs. The arithmetic behind them is
// unit-tested in src/services/goals/{proposal,detect}.test.ts.

describe("goals — the Goals screen's API", () => {
	const tz = tzForLocalHour(11);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;
	let userId: string;

	beforeAll(async () => {
		const token = await signUp("rafa@example.com");
		headers = { Authorization: `Bearer ${token}` };
		userId = (await request(app).get("/api/auth/get-session").set(headers)).body.user.id as string;
		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "male",
				birth_year: new Date().getUTCFullYear() - 40,
				height_cm: 178,
				activity_level: "moderate",
				goal_pace: "standard",
			});
		// Two weigh-ins a fortnight apart: a baseline to measure progress from and a
		// current number to measure it to.
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 195, logged_at: localInstant(addDays(today, -14), "07:00", tz) });
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 190, logged_at: localInstant(today, "07:00", tz) });
	}, 60_000);

	let weightGoalId: string;

	it("saves a goal with the timeline the safe rate projects", async () => {
		const res = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease" }],
					active_from: addDays(today, -14),
				},
				tz_offset_min: tz,
			});
		expect(res.status).toBe(201);
		weightGoalId = res.body.goal.id as string;
		expect(res.body.goal).toMatchObject({ status: "active", priority: 1, active_from: addDays(today, -14) });
		// 190 → 170 at 0.75 %/week is 15 weeks; the row's end date is the projection.
		expect(res.body.proposal).toMatchObject({ weeks: 15, unrealistic: false });
		expect(res.body.goal.active_to).toBe(res.body.proposal.projected_date);
		expect(res.body.proposal.rate).toContain("lb a week");
	});

	it("refuses a goal about something the app cannot measure", async () => {
		const bad = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({ spec: { kind: "custom", title: "Feel great", metrics: [{ measure: "vibes", direction: "increase" }] } });
		expect(bad.status).toBe(400);

		// And a scoped measure with nothing to scope it to.
		const unscoped = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "build_strength",
					title: "Lift more",
					metrics: [{ measure: "exercise_load", target: 185, direction: "increase" }],
				},
			});
		expect(unscoped.status).toBe(400);
		expect(String(unscoped.body.error)).toContain("exercise");
	});

	let benchGoalId: string;

	it("appends the next goal rather than promoting it, and lists both with their progress", async () => {
		const second = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "build_strength",
					title: "Bench 185",
					metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 185, unit: "lb", direction: "increase" }],
				},
				tz_offset_min: tz,
			});
		expect(second.status).toBe(201);
		benchGoalId = second.body.goal.id as string;
		expect(second.body.goal.priority).toBe(2);
		// Nothing benched yet, so there is no date to project — and no invented one.
		expect(second.body.proposal.projected_date).toBeNull();

		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		expect(list.status).toBe(200);
		expect(list.body.no_goal).toBe(false);
		expect(list.body.active.map((goal: { title: string }) => goal.title)).toEqual(["Down to 170 lb", "Bench 185"]);
		// 195 → 190 of the 25 lb to 170 is a fifth of the way.
		expect(list.body.active[0].progress.percent).toBeCloseTo(0.2, 2);
		expect(list.body.active[0].progress.metrics[0]).toMatchObject({ current: 190, baseline: 195, target: 170 });
		// The candidate flags the coach reads are on every goal, unset until the close runs.
		expect(list.body.active[0]).toMatchObject({ reached_candidate_at: null, stalled_since: null });
	});

	it("takes the user's order", async () => {
		const res = await request(app).post("/api/goals/reorder").set(headers).send({ ids: [benchGoalId, weightGoalId] });
		expect(res.status).toBe(200);
		expect(res.body.active.map((goal: { title: string; priority: number }) => [goal.title, goal.priority])).toEqual([
			["Bench 185", 1],
			["Down to 170 lb", 2],
		]);

		// An id that is not an active goal of theirs is a 400, not a silent no-op.
		expect((await request(app).post("/api/goals/reorder").set(headers).send({ ids: [randomUUID()] })).status).toBe(400);

		// Put it back for the tests below.
		await request(app).post("/api/goals/reorder").set(headers).send({ ids: [weightGoalId, benchGoalId] });
	});

	it("edits the title and the numbers", async () => {
		const res = await request(app)
			.patch(`/api/goals/${benchGoalId}`)
			.set(headers)
			.send({
				title: "Bench 205",
				metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 205, unit: "lb", direction: "increase" }],
			});
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ title: "Bench 205", status: "active" });
		expect(res.body.metrics[0].target).toBe(205);

		// A patch that would break the measure catalog is refused whole.
		const bad = await request(app)
			.patch(`/api/goals/${benchGoalId}`)
			.set(headers)
			.send({ metrics: [{ measure: "exercise_load", target: 205, direction: "increase" }] });
		expect(bad.status).toBe(400);
	});

	it("reports per-metric progress and a trend series over the goal's life", async () => {
		const res = await request(app).get(`/api/goals/${weightGoalId}/progress?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.goal.id).toBe(weightGoalId);
		const metric = res.body.metrics[0];
		expect(metric).toMatchObject({ measure: "body_weight", label: "Body weight", unit: "lb", target: 170, current: 190 });
		expect(metric.percent).toBeCloseTo(0.2, 2);
		// The series runs from the goal's start to today, and only where there is a number.
		expect(metric.series[0]).toEqual({ date: addDays(today, -14), value: 195 });
		expect(metric.series.at(-1)).toEqual({ date: today, value: 190 });
		expect(res.body.detection).toMatchObject({ reached: false, stalled: false });

		expect((await request(app).get(`/api/goals/${randomUUID()}/progress`).set(headers)).status).toBe(404);
	});

	it("ends a goal by dating it, and keeps judging the days it was live for", async () => {
		// A day with a goal on it, before anything is dropped.
		const yesterday = addDays(today, -1);
		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "the day's food", kcal: 1800, protein_g: 120, logged_at: localInstant(yesterday, "13:00", tz) });
		coachLlm.nextOutput = READING;
		const before = await request(app).get(`/api/day/${yesterday}?tz=${tz}`).set(headers);
		expect(before.body.goal.title).toBe("Down to 170 lb");
		expect(before.body.verdict).not.toBe("none");

		const dropped = await request(app)
			.patch(`/api/goals/${weightGoalId}`)
			.set(headers)
			.send({ status: "dropped", tz_offset_min: tz });
		expect(dropped.status).toBe(200);
		expect(dropped.body).toMatchObject({ status: "dropped", active_to: today });

		// WP3 filtered dropped goals out entirely and yesterday lost its judgement with
		// them. The window is what governs now, so yesterday still reads as it did.
		coachLlm.nextOutput = READING;
		const after = await request(app).get(`/api/day/${yesterday}?tz=${tz}`).set(headers);
		expect(after.body.goal.title).toBe("Down to 170 lb");
		expect(after.body.verdict).toBe(before.body.verdict);

		// Move the end date back and yesterday falls outside the goal's life: no goal, no
		// judgement colours — which is exactly what a later day will see.
		await request(app).patch(`/api/goals/${weightGoalId}`).set(headers).send({ active_to: addDays(today, -3) });
		coachLlm.nextOutput = READING;
		const outside = await request(app).get(`/api/day/${yesterday}?tz=${tz}`).set(headers);
		expect(outside.body.goal).toBeNull();
		expect(outside.body.verdict).toBe("none");
		expect(outside.body.status).toBe("none");
	});

	it("keeps the ended goal in history with its outcome", async () => {
		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		expect(list.body.active.map((goal: { title: string }) => goal.title)).toEqual(["Bench 205"]);
		expect(list.body.history[0]).toMatchObject({ title: "Down to 170 lb", outcome: "dropped" });
	});

	it("404s on someone else's goal", async () => {
		const otherToken = await signUp("sami@example.com");
		const other = { Authorization: `Bearer ${otherToken}` };
		expect((await request(app).patch(`/api/goals/${benchGoalId}`).set(other).send({ title: "Mine now" })).status).toBe(404);
		expect((await request(app).get(`/api/goals/${benchGoalId}/progress`).set(other)).status).toBe(404);
		// And their own list is simply empty — the no-goal state, not an error.
		const list = await request(app).get("/api/goals").set(other);
		expect(list.body).toMatchObject({ active: [], history: [], no_goal: true });
	});

	it("leaves the goals table alone when nothing was asked for", async () => {
		expect((await request(app).patch(`/api/goals/${benchGoalId}`).set(headers).send({})).status).toBe(400);
		const { rows } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM goals WHERE user_id = $1`, [userId]);
		expect(rows[0]).toEqual({ n: 2 });
	});
});

describe("goals — reached and stalled at day close", () => {
	const tz = tzForLocalHour(9);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("tess@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({ sex: "female", birth_year: new Date().getUTCFullYear() - 35, height_cm: 170, activity_level: "light" });

		// Ten days of weigh-ins, every one of them at or under the target.
		for (let back = 10; back >= 1; back -= 1) {
			await request(app)
				.post("/api/weight")
				.set(headers)
				.send({ weight_lb: 149 - back * 0.1, logged_at: localInstant(addDays(today, -back), "07:00", tz) });
		}
		await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "lose_fat",
					title: "Down to 150 lb",
					metrics: [{ measure: "body_weight", target: 150, unit: "lb", direction: "decrease" }],
					active_from: addDays(today, -30),
				},
				tz_offset_min: tz,
			});
	}, 60_000);

	it("marks the goal a reached candidate, without closing it", async () => {
		// The close runs on the first day-shaped request after local midnight.
		await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz });

		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		const goal = list.body.active[0];
		expect(goal.reached_candidate_at).not.toBeNull();
		// Never auto-closed: the coach asks, the user answers (concept-v2 §Goals).
		expect(goal.status).toBe("active");
		expect(goal.progress.detection).toMatchObject({ reached: true, stalled: false });
		expect(String(goal.progress.detection.reached_why)).toContain("7 days");
	});

	it("keeps the first candidate date when the goal stays reached", async () => {
		const first = (await request(app).get(`/api/goals?tz=${tz}`).set(headers)).body.active[0].reached_candidate_at;
		await request(app).post("/api/day/close").set(headers).send({ tz_offset_min: tz, date: addDays(today, -1) });
		const again = (await request(app).get(`/api/goals?tz=${tz}`).set(headers)).body.active[0].reached_candidate_at;
		expect(again).toBe(first);
	});

	it("marks the goal reached when the user says so, and it stops judging from that day", async () => {
		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		const id = list.body.active[0].id as string;
		const res = await request(app).patch(`/api/goals/${id}`).set(headers).send({ status: "reached", tz_offset_min: tz });
		expect(res.body).toMatchObject({ status: "reached", active_to: today });

		const after = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		expect(after.body.no_goal).toBe(true);
		expect(after.body.history[0]).toMatchObject({ title: "Down to 150 lb", outcome: "reached" });
	});
});

describe("profile — the plan and what it works out to", () => {
	const tz = tzForLocalHour(14);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("umi@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 200, logged_at: localInstant(today, "07:00", tz) });
	}, 60_000);

	it("derives the targets the app used to compute for itself", async () => {
		// Without sex/height/birth year there is no TDEE, and none is invented: the target
		// falls back to the v1 `daily_calorie_target` the profile row is created with.
		const empty = await request(app).get("/api/profile").set(headers);
		expect(empty.body.targets).toMatchObject({ tdee: null, source: "stated" });
		expect(empty.body.targets.eat_target).toBe(empty.body.daily_calorie_target);

		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "male",
				birth_year: new Date().getUTCFullYear() - 38,
				height_cm: 180,
				activity_level: "moderate",
				goal_pace: "standard",
			});

		const res = await request(app).get(`/api/profile?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.targets).toMatchObject({ source: "computed", tracking_only: false, weight_lb: 200, date: today });
		expect(res.body.targets.tdee).toBeGreaterThan(2500);
		expect(res.body.targets.eat_target).toBeLessThan(res.body.targets.tdee);
		expect(res.body.targets.deficit).toBe(res.body.targets.eat_target - res.body.targets.tdee);
		expect(res.body.targets.protein_g).toBeGreaterThan(100);
		expect(res.body.targets.eatback).toBe("half");
	});

	it("merges the plan and dates every field it touches", async () => {
		const first = await request(app).patch("/api/profile").set(headers).send({ diet_style: "lower carb", training_days: 4 });
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ diet_style: "lower carb", training_days: 4 });
		const dated = first.body.stated_at as Record<string, string>;
		expect(dated.diet_style).toBeTruthy();
		expect(dated.training_days).toBeTruthy();

		// A second patch does not erase the first field's date.
		const second = await request(app).patch("/api/profile").set(headers).send({ environment: "home" });
		expect(second.body.stated_at.diet_style).toBe(dated.diet_style);
		expect(second.body.stated_at.environment).toBeTruthy();
		expect(second.body.diet_style).toBe("lower carb");

		// A stated macro beats the computed one, everywhere it is read.
		const stated = await request(app).patch("/api/profile").set(headers).send({ protein_g: 210 });
		expect(stated.body.targets.protein_g).toBe(210);
	});

	it("lets the ring's eat-back setting through to the day", async () => {
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "an hour on the bike", exercise: "Cycling", category: "cardio", duration_min: 60, kcal: 400, logged_at: localInstant(today, "08:00", tz) });

		const half = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(half.body.eatback).toBe("half");
		expect(half.body.allowance).toBe(half.body.target + 200);

		await request(app).patch("/api/profile").set(headers).send({ eatback: "none" });
		coachLlm.nextOutput = READING;
		const none = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(none.body.allowance).toBe(none.body.target);

		await request(app).patch("/api/profile").set(headers).send({ eatback: "all" });
		coachLlm.nextOutput = READING;
		const all = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(all.body.allowance).toBe(all.body.target + 400);
	});

	it("appends spoken constraints and replaces edited ones", async () => {
		// The spoken path appends and dedupes (WP2's statement kind)…
		await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), result: { kind: "constraint", text: "bad left knee", fields: null } });
		await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), result: { kind: "constraint", text: "bad left knee", fields: null } });
		await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), result: { kind: "constraint", text: "no overhead pressing", fields: null } });
		const spoken = await request(app).get("/api/profile").set(headers);
		expect(spoken.body.constraints).toEqual(["bad left knee", "no overhead pressing"]);

		// …and the Profile screen's edit replaces the list, because deleting a row is
		// something only a tap can mean.
		const edited = await request(app).patch("/api/profile").set(headers).send({ constraints: ["bad left knee"] });
		expect(edited.body.constraints).toEqual(["bad left knee"]);
		expect(edited.body.stated_at.constraints).toBeTruthy();
	});
});

describe("goals — set by talking", () => {
	const tz = 60;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("vero@example.com");
		headers = { Authorization: `Bearer ${token}` };
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 191 });
	}, 60_000);

	// Relative, not a literal December: the fixture has to still be a future date whenever
	// the suite is run.
	const theirDate = addDays(localDay(new Date(), tz).date, 100);

	it("analyzes, proposes from the user's own facts, and confirms into a goal", async () => {
		// The two calls the goal path makes: route, then spec. Neither is asked for a date
		// — the projection is the server's job now (services/goals/proposal.ts).
		nextFusion(
			{ kind: "goal", title: "Down to 170 lb by December" },
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [
						{
							measure: "body_weight",
							scope: null,
							target: 170,
							unit: "lb",
							direction: "decrease",
							rate: null,
							by: theirDate,
						},
					],
					active_to: null,
				},
				facts: { current_weight_lb: null, training_days: null, environment: null, age_years: null },
			}
		);

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", `I want to get down to 170 pounds by ${theirDate}, I'm 191 now`)
			.field("tz_offset_min", String(tz))
			.field("kind_hint", "goal");
		expect(analyzed.status).toBe(200);
		expect(analyzed.body.result.kind).toBe("goal");
		// The preview carries the computed proposal, and the timeline on the card is it.
		expect(analyzed.body.proposal.metrics[0].current).toBe(191);
		expect(analyzed.body.proposal.weeks).toBeGreaterThan(10);
		expect(analyzed.body.result.proposed_timeline.by).toBe(theirDate);
		expect(analyzed.body.result.proposed_timeline.note).toContain(theirDate);

		const confirmed = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({
				client_id: randomUUID(),
				result: analyzed.body.result,
				text: "I want to get down to 170 pounds",
				text_kind: "transcript",
				tz_offset_min: tz,
			});
		expect(confirmed.status).toBe(201);
		expect(confirmed.body.goal).toMatchObject({ kind: "lose_fat", title: "Down to 170 lb", status: "active", priority: 1 });
		// Their date needs about 1.5 lb a week — brisker than their standard pace but
		// inside the safe band, so it stands as the goal's end date.
		expect(confirmed.body.goal.active_to).toBe(theirDate);
		expect(confirmed.body.goal_proposal.unrealistic).toBe(false);
		expect(confirmed.body.goal_proposal.projected_date).not.toBeNull();
		// And the transcript is kept as the evidence for it.
		expect(confirmed.body.evidence).toHaveLength(1);

		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		expect(list.body.active).toHaveLength(1);
		expect(list.body.active[0].progress.metrics[0].current).toBe(191);
	});

	it("takes 'no date' for an answer, and 'that date, I meant it' too", async () => {
		nextFusion(
			{ kind: "goal", title: "Run 20 miles a week" },
			{
				spec: {
					kind: "improve_endurance",
					title: "Run 20 miles a week",
					metrics: [
						{ measure: "distance_mi", scope: null, target: 20, unit: "mi", direction: "increase", rate: null, by: null },
					],
					active_to: null,
				},
				facts: { current_weight_lb: null, training_days: null, environment: null, age_years: null },
			}
		);
		const analyzed = await request(app).post("/api/log/analyze").set(headers).field("text", "I want to run 20 miles a week");
		const openEnded = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), result: analyzed.body.result, no_date: true, tz_offset_min: tz });
		expect(openEnded.status).toBe(201);
		expect(openEnded.body.goal.active_to).toBeNull();

		// A date the safe rate cannot meet is kept when the user insists, and the note
		// still says what it would take.
		const soon = addDays(localDay(new Date(), tz).date, 14);
		const insisted = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "lose_fat",
					title: "Down to 150 lb",
					metrics: [{ measure: "body_weight", target: 150, unit: "lb", direction: "decrease", by: soon }],
				},
				confirm_date: true,
				tz_offset_min: tz,
			});
		expect(insisted.status).toBe(201);
		expect(insisted.body.proposal.unrealistic).toBe(true);
		expect(insisted.body.goal.active_to).toBe(soon);

		// Without confirm_date, the same goal is saved with the safe-rate date instead.
		const proposed = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "lose_fat",
					title: "Down to 150 lb, sensibly",
					metrics: [{ measure: "body_weight", target: 150, unit: "lb", direction: "decrease", by: soon }],
				},
				tz_offset_min: tz,
			});
		expect(proposed.body.goal.active_to).toBe(proposed.body.proposal.projected_date);
		expect(proposed.body.goal.active_to > soon).toBe(true);
	});
});

// The field report, typed into the Log sheet exactly as it arrived:
//
//   "Currently I am 212 lbs, my goal is to go down to 200 lbs. come up with reasonable time
//    to achieve that. I work out 4 days a week. At the same time I want to build body
//    mascle. I am 45 read old. I go to gym to workout. I want a complete body workout
//    through out the week."
//
// Three things went wrong at once: the whole-body sets metric could not be saved at all,
// the 212 was thrown away so the timeline was projected from a three-week-old 181.2 and
// came back "already at 200 — mark it reached?", and the four facts the user had just
// stated had to be typed again into the Profile screen. This walks the whole thing.
describe("goals — the facts stated alongside them", () => {
	const tz = 60;
	let headers: Record<string, string>;

	const SAID =
		"Currently I am 212 lbs, my goal is to go down to 200 lbs. come up with reasonable time to " +
		"achieve that. I work out 4 days a week. At the same time I want to build body mascle. I am " +
		"45 read old. I go to gym to workout. I want a complete body workout through out the week.";

	/** What the two calls answer for this log. */
	function nextWholeBodyGoal(facts: Record<string, unknown>): void {
		nextFusion(
			{ kind: "goal", title: "Down to 200 lb" },
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 200 lb",
					metrics: [
						{ measure: "body_weight", scope: null, target: 200, unit: "lb", direction: "decrease", rate: null, by: null },
						// No muscle named: the whole body's weekly volume.
						{ measure: "weekly_sets", scope: null, target: 18, unit: "sets", direction: "increase", rate: null, by: null },
					],
					active_to: null,
				},
				facts,
			}
		);
	}

	beforeAll(async () => {
		const token = await signUp("wholebody@example.com");
		headers = { Authorization: `Bearer ${token}` };
		// The only weigh-in the app knows about, and it is under the target.
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 181.2 });
	}, 60_000);

	it("saves a whole-body sets goal, the stated weight and the profile facts, and projects from 212", async () => {
		nextWholeBodyGoal({ current_weight_lb: 212, training_days: 4, environment: "gym", age_years: 45 });

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", SAID)
			.field("tz_offset_min", String(tz));
		expect(analyzed.status).toBe(200);
		expect(analyzed.body.result.kind).toBe("goal");
		// 0. Everything in this sentence is about the goal, so it is ONE part: the 212 is a
		// fact the goal carries, not a weigh-in card of its own (see the analyzer's
		// dropWeightStatedWithGoal, and the routing prompt that says so first).
		expect(analyzed.body.results).toHaveLength(1);

		// 1. The unscoped weekly_sets metric survives the preview.
		expect(analyzed.body.result.spec.metrics.map((m: { measure: string }) => m.measure)).toEqual([
			"body_weight",
			"weekly_sets",
		]);
		// 2. The facts ride along, for the card to show and the confirm to save.
		expect(analyzed.body.result.facts).toEqual({
			current_weight_lb: 212,
			training_days: 4,
			environment: "gym",
			age_years: 45,
		});
		// 3. The timeline is projected from the 212 they just said, not the 181.2 on file.
		expect(analyzed.body.proposal.metrics[0].current).toBe(212);
		expect(analyzed.body.proposal.weeks).toBeGreaterThan(1);
		expect(analyzed.body.proposal.projected_date).not.toBe(localDay(new Date(), tz).date);
		expect(String(analyzed.body.result.proposed_timeline.note)).not.toContain("mark it reached");

		const confirmed = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({
				client_id: randomUUID(),
				result: analyzed.body.result,
				text: SAID,
				tz_offset_min: tz,
			});
		// 4. It saves. The blocking "Weekly sets needs a muscle" is gone.
		expect(confirmed.status).toBe(201);
		expect(confirmed.body.goal).toMatchObject({ kind: "lose_fat", title: "Down to 200 lb", status: "active" });
		expect(confirmed.body.goal.metrics[1]).toMatchObject({ measure: "weekly_sets", scope: null, target: 18 });

		// 5. The 212 is a weigh-in, not a note that scrolled past.
		expect(confirmed.body.weight).toMatchObject({ weight_lb: 212 });
		const weights = await request(app).get("/api/weight").set(headers);
		expect(weights.body[0]).toMatchObject({ weight_lb: 212 });

		// 6. The plan facts are on the profile, dated.
		const profile = await request(app).get("/api/profile").set(headers);
		expect(profile.body).toMatchObject({
			training_days: 4,
			environment: "gym",
			birth_year: new Date().getUTCFullYear() - 45,
		});
		expect(profile.body.stated_at.training_days).toBeTruthy();
		expect(profile.body.stated_at.environment).toBeTruthy();
		expect(profile.body.stated_at.birth_year).toBeTruthy();

		// 7. And the goal reads back with a whole-body sets number on it.
		const list = await request(app).get(`/api/goals?tz=${tz}`).set(headers);
		const metrics = list.body.active[0].progress.metrics;
		expect(metrics[1]).toMatchObject({ measure: "weekly_sets", scope: null, label: "Weekly sets, whole body" });
	});

	it("still offers 'already reached' when nothing was stated — worded with the number it used", async () => {
		const token = await signUp("stale@example.com");
		const theirs = { Authorization: `Bearer ${token}` };
		await request(app).post("/api/weight").set(theirs).send({ weight_lb: 181.2 });

		nextWholeBodyGoal({ current_weight_lb: null, training_days: null, environment: null, age_years: null });
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(theirs)
			.field("text", "I want to get down to 200 lbs")
			.field("tz_offset_min", String(tz));

		expect(analyzed.body.result.facts).toBeNull();
		const note = String(analyzed.body.proposal.metrics[0].note);
		expect(analyzed.body.proposal.metrics[0].current).toBe(181.2);
		// The number it went on, and the way out of it.
		expect(note).toContain("181.2");
		expect(note).toContain("already under 200 lb");
		expect(note).toContain("tell me your current weight");
	});
});

// ── WP5: the coach ───────────────────────────────────────────────────────────────────
// The brief end to end over the fake CoachPort: the inputs the route builds from real
// rows, the per-day cache, the explicit regenerate, the context that comes in through the
// same input as everything else, and the nudge WP4's detection makes possible. The
// features and the progression arithmetic are unit-tested in src/services/coach/.

describe("coach — the brief", () => {
	const tz = tzForLocalHour(17);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	async function lift(date: string, clock: string, exercise: string, load: number, sets = 3, reps = 8) {
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: `${sets} × ${reps} ${exercise.toLowerCase()} at ${load} lb`,
				exercise,
				sets,
				reps,
				load_lb: load,
				kcal: 110,
				confidence: "high",
				logged_at: localInstant(date, clock, tz),
			});
	}

	beforeAll(async () => {
		const token = await signUp("wes@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;

		await request(app)
			.patch("/api/profile")
			.set(headers)
			.send({
				sex: "male",
				birth_year: new Date().getUTCFullYear() - 38,
				height_cm: 180,
				activity_level: "moderate",
				goal_pace: "standard",
				goal_weight_lb: 170,
				training_days: 4,
				diet_style: "higher protein",
				environment: "gym",
				constraints: ["bad left knee"],
			});
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 193.4, logged_at: localInstant(today, "06:40", tz) });
		await request(app)
			.post("/api/entries/meals")
			.set(headers)
			.send({ description: "eggs and toast", kcal: 520, protein_g: 34, logged_at: localInstant(today, "07:30", tz) });

		// Two sessions at 135 lb × 3 × 8 after a jump from 130 — the history the
		// progression rules step from, and old enough that the step is not "this week".
		await lift(addDays(today, -14), "18:05", "Bench Press", 130);
		await lift(addDays(today, -9), "18:05", "Bench Press", 135);
		await lift(addDays(today, -3), "18:05", "Bench Press", 135);
		await lift(addDays(today, -3), "18:25", "Lat Pulldown", 110, 3, 10);
	}, 60_000);

	it("builds the brief from computed features, prescribed loads and the plan", async () => {
		const before = coach.inputs.length;
		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(coach.inputs.length).toBe(before + 1);

		const inputs = coach.inputs.at(-1)!;
		expect(inputs.date).toBe(today);
		// The plan the user stated, including the constraint that outranks everything.
		expect(inputs.plan).toMatchObject({ diet_style: "higher protein", training_days: 4, environment: "gym", units: "lb" });
		expect(inputs.plan.constraints).toContain("bad left knee");
		expect(inputs.plan.targets.kcal).toBeGreaterThan(1500);

		// Features off the real rows: three days since the last session, chest recovering.
		expect(inputs.features.days_since_last_workout).toBe(3);
		expect(inputs.features.sessions_this_week).toBe(1);
		const bench = inputs.features.exercises.find((exercise) => exercise.exercise === "Bench Press");
		expect(bench).toMatchObject({ best_load_lb: 135, trend: "up" });
		expect(bench?.last).toMatchObject({ load_lb: 135, sets: 3, reps: 8 });

		// The gap rule and the loads, computed rather than asked for.
		expect(inputs.rules.gap.level).toBe("ease_back");
		const prescribed = inputs.rules.prescriptions.find((item) => item.exercise === "Bench Press");
		expect(prescribed).toMatchObject({ rule: "ease_back", load_lb: 135, sets: 2 });

		// The prompt carries all of it, and tells the model the numbers are not its to pick.
		expect(res.body.brief).toMatchObject({ headline: SAMPLE_BRIEF.headline, model: "fake-coach-model", cached: false });
		expect(res.body.brief.why).toBe(SAMPLE_BRIEF.why);
		expect(res.body.brief.workout.exercises[0]).toMatchObject({ name: "Lat Pulldown", load_lb: 110 });
		expect(res.body.gap.level).toBe("ease_back");
	});

	it("serves the same brief for the rest of the day, free", async () => {
		const first = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		const before = coach.inputs.length;
		const again = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);

		expect(again.body.brief.id).toBe(first.body.brief.id);
		expect(again.body.brief.cached).toBe(true);
		// The whole point of the cache: asking twice costs nothing.
		expect(coach.inputs.length).toBe(before);
		const { rows } = await db.pool.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM coach_briefs WHERE date = $1::date`,
			[today]
		);
		expect(Number(rows[0]!.count)).toBeGreaterThan(0);
	});

	it("keeps the day's brief when something is logged, and flags it stale", async () => {
		const before = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		coach.nextBrief = { ...SAMPLE_BRIEF, headline: "Rest — you trained today" };
		coachLlm.nextOutput = READING;
		await lift(today, "12:10", "Overhead Press", 65);

		// A plain ask returns the same answer — the day's brief holds still — but `stale`
		// tells the app the inputs moved so it can offer Regenerate.
		const after = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(after.body.brief.id).toBe(before.body.brief.id);
		expect(after.body.brief.headline).toBe(before.body.brief.headline);
		expect(after.body.stale).toBe(true);

		// Regenerate picks up the new inputs; today's workout is in them, so the model can
		// refuse to prescribe a second session.
		const regen = await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });
		expect(regen.body.brief.headline).toBe("Rest — you trained today");
		expect(coach.inputs.at(-1)!.today.trained.length).toBeGreaterThan(0);
		coach.nextBrief = SAMPLE_BRIEF;
	});

	it("takes context on the ask, and caches per context", async () => {
		const asked = await request(app)
			.get(`/api/coach/next?tz=${tz}&context=${encodeURIComponent("only 30 minutes and my knee hurts")}`)
			.set(headers);
		expect(asked.status).toBe(200);
		expect(coach.inputs.at(-1)!.context).toContain("only 30 minutes");
		expect(asked.body.brief.context).toContain("only 30 minutes");

		// The same context again is the same answer; a different one is a different answer.
		const before = coach.inputs.length;
		const same = await request(app)
			.get(`/api/coach/next?tz=${tz}&context=${encodeURIComponent("only 30 minutes and my knee hurts")}`)
			.set(headers);
		expect(same.body.brief.id).toBe(asked.body.brief.id);
		expect(same.body.brief.cached).toBe(true);

		const other = await request(app)
			.get(`/api/coach/next?tz=${tz}&context=${encodeURIComponent("feel like cardio")}`)
			.set(headers);
		expect(other.body.brief.id).not.toBe(asked.body.brief.id);
		// The repeat was free; only the new context cost a call.
		expect(coach.inputs.length).toBe(before + 1);
	});

	it("regenerates only when asked to", async () => {
		const first = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		const res = await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });
		expect(res.status).toBe(200);
		expect(res.body.brief.cached).toBe(false);
		expect(Date.parse(res.body.brief.asked_at)).toBeGreaterThanOrEqual(Date.parse(first.body.brief.asked_at));
		// The regenerated brief becomes the day's standing answer for the next plain ask.
		const again = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(again.body.brief.id).toBe(res.body.brief.id);
	});

	it("picks up a coach_context said through the Log sheet", async () => {
		nextFusion({ kind: "statement", scope: "coach_context", text: "travelling, hotel gym only" });
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", "travelling, hotel gym only")
			.field("tz_offset_min", String(tz));
		expect(analyzed.status).toBe(200);

		const confirmed = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), result: analyzed.body.result, tz_offset_min: tz });
		expect(confirmed.status).toBe(201);
		expect(confirmed.body.coach_context).toMatchObject({ date: today, text: "travelling, hotel gym only" });

		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(coach.inputs.at(-1)!.context).toContain("hotel gym only");
		expect(res.body.brief.context).toContain("hotel gym only");
	});

	it("shows the day's brief on the Day view as the coach-ask card", async () => {
		const day = await request(app).get(`/api/day/today?tz=${tz}`).set(headers);
		expect(day.status).toBe(200);
		expect(day.body.coach).toMatchObject({ date: today, headline: expect.any(String) });
		expect(day.body.coach.workout.type).toBe("strength");
	});
});

describe("coach — the nudge", () => {
	const tz = tzForLocalHour(11);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("xan@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		await request(app).post("/api/weight").set(headers).send({ weight_lb: 169.4, logged_at: localInstant(today, "07:00", tz) });
	}, 60_000);

	it("turns WP4's reached candidate into an action the app can take", async () => {
		const created = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease" }],
				},
				tz_offset_min: tz,
			});
		expect(created.status).toBe(201);
		const goalId = created.body.goal.id as string;

		// What the day close would have written (services/goals/detect.ts) — the coach's
		// half of it is turning the candidate into a question with a button.
		await db.pool.query(`UPDATE goals SET reached_candidate_at = NOW() WHERE id = $1`, [goalId]);

		coach.nextBrief = { ...SAMPLE_BRIEF, nudge: "Looks like you reached 170 — mark it done?" };
		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.nudge_action).toEqual({ kind: "mark_reached", goal_id: goalId, label: "Mark it done" });
		expect(res.body.brief.nudge).toContain("mark it done");
		expect(res.body.brief.nudge_action).toEqual(res.body.nudge_action);
		// The model was told what the nudge is about, and told not to close anything itself.
		expect(coach.inputs.at(-1)!.rules.nudge.subject).toContain("only the user closes a goal");
		coach.nextBrief = SAMPLE_BRIEF;
	});

	it("offers to adjust a stalled goal when nothing has been reached", async () => {
		const created = await request(app)
			.post("/api/goals")
			.set(headers)
			.send({
				spec: {
					kind: "build_strength",
					title: "Bench 185",
					metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 185, unit: "lb", direction: "increase" }],
				},
				tz_offset_min: tz,
			});
		const stalledId = created.body.goal.id as string;
		await db.pool.query(`UPDATE goals SET reached_candidate_at = NULL WHERE user_id IS NOT NULL AND id <> $1`, [stalledId]);
		await db.pool.query(`UPDATE goals SET stalled_since = $2::date WHERE id = $1`, [stalledId, addDays(today, -21)]);

		const res = await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });
		expect(res.body.nudge_action).toMatchObject({ kind: "adjust_goal", goal_id: stalledId });
	});
});

describe("coach — a return after two weeks off", () => {
	const tz = tzForLocalHour(9);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("yara@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: "3 × 8 bench at 155 lb",
				exercise: "Bench Press",
				sets: 3,
				reps: 8,
				load_lb: 155,
				kcal: 120,
				logged_at: localInstant(addDays(today, -18), "18:00", tz),
			});
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: "3 × 8 bench at 150 lb",
				exercise: "Bench Press",
				sets: 3,
				reps: 8,
				load_lb: 150,
				kcal: 120,
				logged_at: localInstant(addDays(today, -25), "18:00", tz),
			});
	}, 60_000);

	it("plans a restart rather than resuming the progression", async () => {
		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.gap).toMatchObject({ days: 18, level: "restart" });

		const inputs = coach.inputs.at(-1)!;
		expect(inputs.rules.prescriptions[0]).toMatchObject({ exercise: "Bench Press", rule: "restart", load_lb: 150, sets: 2 });
		// It never scolds about the gap; that is in the rule the model is handed.
		expect(inputs.rules.gap.text).toContain("Do not mention the gap as a failing");
	});

	it("says the coach is unavailable rather than 500ing when the provider is down", async () => {
		const token = await signUp("zed@example.com");
		coach.failNext = new Error("ANTHROPIC_API_KEY is not set");
		const res = await request(app).get(`/api/coach/next?tz=0`).set({ Authorization: `Bearer ${token}` });
		expect(res.status).toBe(503);
		expect(res.body.error).toContain("unavailable");
	});

	it("serves the last brief when the provider fails and there is one", async () => {
		const good = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		coach.failNext = new Error("529 overloaded");
		const res = await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });
		expect(res.status).toBe(200);
		expect(res.body.stale).toBe(true);
		expect(res.body.brief.id).toBe(good.body.brief.id);
	});

	it("refuses an impossible timezone and an unauthenticated ask", async () => {
		expect((await request(app).get(`/api/coach/next?tz=999`).set(headers)).status).toBe(400);
		expect((await request(app).get(`/api/coach/next?tz=${tz}`)).status).toBe(401);
	});
});

// ── Field fix: a brief you can adjust, and never a blank one ──────────────────────────
// The field report: "give me 7-8 workouts" into the Coach screen's box came back with
// nothing shown. Two causes, both here. The model was asked for eight against a schema
// that allowed six, answered with a training day and an empty exercise list — which
// parses — and the route stored it, so every ask for the rest of the day replayed a brief
// with an empty Do list. And the screen threw the brief it was showing away the moment a
// new ask started, so a failure left it with nothing at all.

/** Rows in coach_briefs for one account on one day — the "was it stored?" question. */
async function countBriefs(date: string, email: string): Promise<number> {
	const { rows } = await db.pool.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM coach_briefs
		  WHERE date = $1::date AND user_id = (SELECT id FROM "user" WHERE email = $2)`,
		[date, email]
	);
	return Number(rows[0]!.count);
}

describe("coach — revising the brief, and never storing an empty one", () => {
	const tz = tzForLocalHour(15);
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("rev@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: "3 × 8 bench at 135 lb",
				exercise: "Bench Press",
				sets: 3,
				reps: 8,
				load_lb: 135,
				kcal: 110,
				logged_at: localInstant(addDays(today, -2), "18:00", tz),
			});
	}, 60_000);

	afterEach(() => {
		coach.nextBrief = SAMPLE_BRIEF;
		coach.briefs.length = 0;
	});

	it("hands the model the current brief and the instruction, and stores what comes back", async () => {
		const first = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(first.status).toBe(200);

		const eight = {
			...SAMPLE_BRIEF,
			headline: "Full body: eight movements",
			workout: {
				type: "strength",
				targets: ["full body"],
				exercises: Array.from({ length: 8 }, (_unused, index) => ({
					name: `Exercise ${index + 1}`,
					load_lb: null,
					sets: 3,
					reps: 8,
					minutes: null,
					note: null,
				})),
			},
		};
		coach.nextBrief = eight;

		const revised = await request(app)
			.post("/api/coach/next/regenerate")
			.set(headers)
			.send({ tz_offset_min: tz, revision: "give me 7-8 workouts" });
		expect(revised.status).toBe(200);
		expect(revised.body.stale).toBe(false);
		expect(revised.body.note).toBeNull();
		// Eight, not six: a cap the user can ask past is a cap the model has to answer
		// around, and answering around it is how the Do list came back empty.
		expect(revised.body.brief.workout.exercises).toHaveLength(8);

		// The model was handed the brief being revised, not just the words.
		const revision = coach.revisions.at(-1);
		expect(revision?.instruction).toBe("give me 7-8 workouts");
		expect(revision?.current.headline).toBe(first.body.brief.headline);
		expect(revision?.current.workout.exercises[0]).toMatchObject({ name: "Lat Pulldown", load_lb: 110 });

		// A revised brief is the day's standing answer like any other.
		const again = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(again.body.brief.id).toBe(revised.body.brief.id);
		expect(again.body.brief.headline).toBe("Full body: eight movements");
		expect(again.body.brief.cached).toBe(true);
	});

	it("never stores a training day with an empty Do list — it retries, then keeps the last brief", async () => {
		const good = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		const briefsBefore = await countBriefs(today, "rev@example.com");
		const callsBefore = coach.inputs.length;

		// What the field report produced: a strength day with nothing in it. It parses —
		// the fake validates against the real schema and lets it through, exactly as the
		// provider would.
		const empty = { ...SAMPLE_BRIEF, headline: "Push day", workout: { type: "strength", targets: ["chest"], exercises: [] } };
		coach.briefs.push(empty, empty);

		const res = await request(app)
			.post("/api/coach/next/regenerate")
			.set(headers)
			.send({ tz_offset_min: tz, revision: "switch to legs" });

		expect(res.status).toBe(200);
		// One retry, then the previous brief — with a line saying so rather than a blank page.
		expect(coach.inputs.length).toBe(callsBefore + 2);
		expect(res.body.stale).toBe(true);
		expect(res.body.note).toContain("nothing to do");
		expect(res.body.brief.id).toBe(good.body.brief.id);
		expect(res.body.brief.workout.exercises.length).toBeGreaterThan(0);

		// Nothing was written, so the rest of the day is not stuck with the empty answer.
		expect(await countBriefs(today, "rev@example.com")).toBe(briefsBefore);
		const after = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(after.body.brief.id).toBe(good.body.brief.id);
	});

	it("keeps a rest day, which is the one brief that is allowed to have nothing in it", async () => {
		coach.nextBrief = {
			...SAMPLE_BRIEF,
			headline: "Rest — three days running",
			workout: { type: "rest", targets: ["recovery"], exercises: [] },
		};
		const res = await request(app)
			.post("/api/coach/next/regenerate")
			.set(headers)
			.send({ tz_offset_min: tz, revision: "I need a day off" });
		expect(res.status).toBe(200);
		expect(res.body.stale).toBe(false);
		expect(res.body.brief.workout).toMatchObject({ type: "rest", exercises: [] });
	});

	it("says the coach could not make the change, rather than 500ing, when the provider is down", async () => {
		const good = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		coach.failNext = new Error("529 overloaded");
		const res = await request(app)
			.post("/api/coach/next/regenerate")
			.set(headers)
			.send({ tz_offset_min: tz, revision: "harder" });
		expect(res.status).toBe(200);
		expect(res.body.stale).toBe(true);
		expect(res.body.note).toContain("could not make that change");
		expect(res.body.brief.id).toBe(good.body.brief.id);
	});

	it("refuses a revision longer than the box allows", async () => {
		const res = await request(app)
			.post("/api/coach/next/regenerate")
			.set(headers)
			.send({ tz_offset_min: tz, revision: "x".repeat(501) });
		expect(res.status).toBe(400);
	});
});

// ── Field fix: a cold start is not a beginner ────────────────────────────────────────
// Someone who has trained for three years and downloads this today has no history in it.
// The coach used to read that as "new to lifting". One sentence into the Log sheet fixes
// it, and the sentence is saved the way every other statement is: profile merge, no
// second thought, and — the guard that matters — no coach call.

describe("training background — what the user brings with them", () => {
	const tz = 0;
	const today = localDay(new Date(), tz).date;
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("bg@example.com");
		headers = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
	}, 60_000);

	it("asks a user it knows nothing about for their background", async () => {
		const res = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body.nudge_action).toEqual({
			kind: "tell_background",
			goal_id: null,
			label: "Tell me your background",
		});
		// And the prompt is told not to guess in the meantime.
		expect(coach.inputs.at(-1)!.rules.statements.join("\n")).toContain("Do NOT assume a beginner");
	});

	it("saves an experience, a background and reference loads from one sentence, with no coach call", async () => {
		const said = "I've been lifting three years, I bench 165 for 3x5";
		// Two calls: the router says "a statement about how they train", then the focused
		// plan-fields call reads the background out of it.
		nextFusion(
			{ kind: "statement", scope: "preference", text: said },
			{
				fields: {
					diet_style: null,
					protein_g: null,
					carbs_max_g: null,
					training_days: null,
					environment: null,
					equipment: null,
					eatback: null,
					experience: "intermediate",
					background: "three years of lifting",
					reference_loads: [{ exercise: "Bench Press", load_lb: 165, reps: 5 }],
				},
			}
		);

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", said)
			.field("tz_offset_min", String(tz));
		expect(analyzed.status).toBe(200);
		expect(analyzed.body.result.fields).toMatchObject({ experience: "intermediate" });

		const before = coach.inputs.length;
		const confirmed = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), results: [analyzed.body.result], text: said, tz_offset_min: tz });
		expect(confirmed.status).toBe(201);
		// Saying where you are starting from is a profile merge, not a question.
		expect(coach.inputs.length).toBe(before);

		const profile = await request(app).get(`/api/profile?tz=${tz}`).set(headers);
		expect(profile.body).toMatchObject({ experience: "intermediate", background: "three years of lifting" });
		expect(profile.body.reference_loads).toEqual([{ exercise: "Bench Press", load_lb: 165, reps: 5 }]);
		// Dated, like every other stated field (concept-v2 §Goals and profile).
		for (const field of ["experience", "background", "reference_loads"]) {
			expect(profile.body.stated_at[field]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
	});

	it("prescribes the first session from the stated load instead of from nothing", async () => {
		const res = await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });
		expect(res.status).toBe(200);

		const inputs = coach.inputs.at(-1)!;
		expect(inputs.plan).toMatchObject({ experience: "intermediate", background: "three years of lifting" });
		expect(inputs.rules.prescriptions).toEqual([
			expect.objectContaining({ exercise: "Bench Press", load_lb: 165, sets: 3, reps: 5, rule: "reference", days_since: null }),
		]);
		// It no longer asks for a background it has been given, and it no longer plans
		// for a beginner.
		expect(inputs.rules.nudge.action).not.toMatchObject({ kind: "tell_background" });
		expect(inputs.rules.statements.join("\n")).toContain("Pitch the session at that, not at a beginner");
	});

	it("restating one lift updates it in place and leaves the others alone", async () => {
		const said = "I squat 225 now";
		nextFusion(
			{ kind: "statement", scope: "preference", text: said },
			{
				fields: {
					diet_style: null,
					protein_g: null,
					carbs_max_g: null,
					training_days: null,
					environment: null,
					equipment: null,
					eatback: null,
					experience: null,
					background: null,
					reference_loads: [{ exercise: "Back Squat", load_lb: 225, reps: null }],
				},
			}
		);
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", said)
			.field("tz_offset_min", String(tz));
		const confirmed = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), results: [analyzed.body.result], text: said, tz_offset_min: tz });
		expect(confirmed.status).toBe(201);
		expect(confirmed.body.profile.reference_loads).toEqual([
			{ exercise: "Bench Press", load_lb: 165, reps: 5 },
			{ exercise: "Back Squat", load_lb: 225, reps: null },
		]);
	});

	it("stops reading the stated load once the exercise has been logged for real", async () => {
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({
				description: "3 × 5 bench at 175 lb",
				exercise: "Bench Press",
				sets: 3,
				reps: 5,
				load_lb: 175,
				kcal: 110,
				confidence: "high",
				logged_at: localInstant(addDays(today, -1), "18:00", tz),
			});
		coachLlm.nextOutput = READING;
		await request(app).post("/api/coach/next/regenerate").set(headers).send({ tz_offset_min: tz });

		const prescriptions = coach.inputs.at(-1)!.rules.prescriptions;
		const bench = prescriptions.filter((item) => item.exercise === "Bench Press");
		expect(bench).toHaveLength(1);
		// From the log — 175, what they actually did — not from the 165 they claimed.
		expect(bench[0]).toMatchObject({ load_lb: 175, rule: "new" });
	});
});

describe("the exercise sheet", () => {
	let headers: Record<string, string>;
	let bench: { id: string; name: string };

	beforeAll(async () => {
		const token = await signUp("nell@example.com");
		headers = { Authorization: `Bearer ${token}` };

		const { rows } = await db.pool.query<{ id: string; name: string }>(
			`SELECT id, name FROM exercise_catalog WHERE name = 'Bench Press'`
		);
		bench = rows[0]!;

		// What scripts/import-exercise-media.ts leaves behind: two frames on disk and the
		// steps on the row. The importer's own tests cover how it gets there.
		await db.pool.query(
			`UPDATE exercise_catalog
			    SET instructions = $2, media_count = 2, source_slug = 'Barbell_Bench_Press_-_Medium_Grip',
			        level = 'beginner'
			  WHERE id = $1`,
			[bench.id, ["Lie back on a flat bench.", "Press the bar back to the start."]]
		);
		await exerciseMedia.put(bench.id, 0, Buffer.from("frame-zero"));
		await exerciseMedia.put(bench.id, 1, Buffer.from("frame-one"));
	});

	it("answers with the catalogue row, its steps and the urls of its frames", async () => {
		const res = await request(app).get(`/api/exercises/${bench.id}`).set(headers);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			id: bench.id,
			name: "Bench Press",
			category: "strength",
			primary_muscles: ["chest"],
			level: "beginner",
			source: { dataset: "free-exercise-db", slug: "Barbell_Bench_Press_-_Medium_Grip" },
		});
		expect(res.body.instructions).toHaveLength(2);
		expect(res.body.equipment).toContain("barbell");
		expect(res.body.media).toEqual([
			{ index: 0, url: `/api/exercises/${bench.id}/media/0` },
			{ index: 1, url: `/api/exercises/${bench.id}/media/1` },
		]);
	});

	it("says an exercise with no import yet has no steps and no photos", async () => {
		const { rows } = await db.pool.query<{ id: string }>(
			`SELECT id FROM exercise_catalog WHERE name = 'Other Activity'`
		);
		const res = await request(app).get(`/api/exercises/${rows[0]!.id}`).set(headers);
		expect(res.status).toBe(200);
		// The sheet falls back to name-only rather than to an error.
		expect(res.body).toMatchObject({ instructions: [], media: [], source: null, level: null });
	});

	it("streams a frame as a jpeg, cached for a year", async () => {
		const res = await request(app).get(`/api/exercises/${bench.id}/media/1`).set(headers);
		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toBe("image/jpeg");
		expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
		expect(res.body.toString()).toBe("frame-one");
	});

	it("404s an unknown id, a malformed id and a frame the row does not claim", async () => {
		expect((await request(app).get(`/api/exercises/${randomUUID()}`).set(headers)).status).toBe(404);
		expect((await request(app).get(`/api/exercises/not-a-uuid`).set(headers)).status).toBe(404);
		expect((await request(app).get(`/api/exercises/${bench.id}/media/2`).set(headers)).status).toBe(404);
		expect((await request(app).get(`/api/exercises/${bench.id}/media/-1`).set(headers)).status).toBe(404);
	});

	it("needs a session — the illustrations are ours to host, not the internet's", async () => {
		expect((await request(app).get(`/api/exercises/${bench.id}`)).status).toBe(401);
		expect((await request(app).get(`/api/exercises/${bench.id}/media/0`)).status).toBe(401);
	});

	it("puts the catalogue id on a logged activity and on the coach's Do list", async () => {
		const tz = 0;
		const today = localDay(new Date(), tz).date;
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 8 bench at 135 lb", exercise: "db bench", sets: 3, reps: 8, load_lb: 135, kcal: 110 });

		const day = await request(app).get(`/api/day/${today}?tz=${tz}`).set(headers);
		const logged = day.body.items.activities.find((a: { exercise: string }) => a.exercise === "Dumbbell Bench Press");
		// The alias resolved, so the row carries an id and the name on Today is tappable.
		expect(logged.exercise_id).toMatch(/^[0-9a-f-]{36}$/);

		const log = await request(app).get(`/api/day/${today}/log?tz=${tz}`).set(headers);
		expect(log.body.entries[0].record.exercise_id).toBe(logged.exercise_id);

		coachLlm.nextOutput = READING;
		const coachRes = await request(app).get(`/api/coach/next?tz=${tz}`).set(headers);
		expect(coachRes.status).toBe(200);
		// SAMPLE_BRIEF's Do list is "Lat Pulldown" and "Overhead Press" — both catalogued,
		// so the app opens their sheets by id and never matches a name.
		for (const exercise of coachRes.body.brief.workout.exercises) {
			expect(exercise.exercise_id).toMatch(/^[0-9a-f-]{36}$/);
		}
	});
});

// ---------------------------------------------------------------------------
// Always log, best effort · the machine as its own fact · places and equipment
// ---------------------------------------------------------------------------

/**
 * The field report this branch is for, said the way it was actually said — twice over, with
 * the user talking themselves through a movement they have no name for. The one rule it has
 * to prove: **it saves, and it asks nothing.**
 */
const NAMELESS_MACHINE =
	"I don't know what it is called but it is something is inclined, but I lay down on my " +
	"tummy on my tummy and I pulled it up to my chest from down up down up. I don't know " +
	"what that mission is called kind of inclined, but I laid up I lay on my tummy and using " +
	"my BOSS hand pull it up to my chest. I don't know what that exercise what that machine " +
	"is called but I did three reps of three sets of 12 rep at 45 pound.";

describe("always log — a movement nobody could name", () => {
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("nameless@example.com");
		headers = { Authorization: `Bearer ${token}` };
	}, 60_000);

	it("saves it as a workout with the numbers, the machine and a guess at the movement", async () => {
		// What the reader is asked to do with a log like this: name the closest movement it
		// can, keep the machine separately, take the numbers at face value, and say it is a
		// guess with the confidence rather than with a question.
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "Chest-Supported Row",
					equipment: "inclined chest-supported row machine",
					description: "3 × 12 chest-supported row at 45 lb",
					sets: 3,
					reps: 12,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 90,
					confidence: "low",
				},
			],
		});

		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", NAMELESS_MACHINE)
			.field("tz_offset_min", "0");

		expect(analyzed.status).toBe(200);
		// One part, and it is a workout. Nothing to answer before it can be saved.
		expect(analyzed.body.results).toHaveLength(1);
		expect(analyzed.body.results[0].kind).toBe("activities");
		expect(analyzed.body.results[0].items[0]).toMatchObject({
			sets: 3,
			reps: 12,
			load_lb: 45,
			equipment: "inclined chest-supported row machine",
			confidence: "low",
		});

		const saved = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({
				client_id: randomUUID(),
				results: analyzed.body.results,
				text: NAMELESS_MACHINE,
				text_kind: "transcript",
				tz_offset_min: 0,
			});
		expect(saved.status).toBe(201);

		// The movement resolved to the catalogue, so the muscle groups came with it — a
		// workout with no muscles in it is invisible to coverage and to the weekly sets.
		const row = saved.body.activities[0];
		expect(row.exercise).toBe("Chest-Supported Row");
		expect(row.exercise_id).not.toBeNull();
		expect(row.equipment).toBe("inclined chest-supported row machine");
		expect(row.muscle_groups).toContain("back");
		expect(row.confidence).toBe("low");
	});

	it("shows the machine as the sub-line, and still compares on the movement", async () => {
		const today = localDay(new Date(), 0).date;
		const day = await request(app).get(`/api/day/${today}?tz=0`).set(headers);
		expect(day.status).toBe(200);
		const activity = day.body.items.activities.find(
			(item: { exercise: string | null }) => item.exercise === "Chest-Supported Row"
		);
		expect(activity.equipment).toBe("inclined chest-supported row machine");

		const log = await request(app).get(`/api/day/${today}/log?tz=0`).set(headers);
		const entry = log.body.entries.find((row: { kind: string }) => row.kind === "activity");
		expect(entry.record.equipment).toBe("inclined chest-supported row machine");
		expect(entry.understood).toContain("inclined chest-supported row machine");
		// And the words are kept, verbatim, under the record they became.
		expect(entry.raw_text).toBe(NAMELESS_MACHINE);
	});

	it("offers the catalogue name as a chip when it could only paraphrase", async () => {
		// The other half of best effort: the reader kept the user's words because it was not
		// sure. The catalogue is matched against them here, so the card can offer the name.
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "inclined machine chest pull",
					equipment: "incline bench row machine",
					description: "3 × 12 at 45 lb on the inclined machine",
					sets: 3,
					reps: 12,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 90,
					confidence: "low",
				},
			],
		});
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", NAMELESS_MACHINE)
			.field("tz_offset_min", "0");

		const item = analyzed.body.results[0].items[0];
		expect(item.refine).toEqual({ question: "Was it a Chest-Supported Row?", exercise: "Chest-Supported Row" });
		// The guess is not silent: the muscle groups it borrows are on the card, editable,
		// before anything is written.
		expect(item.muscle_groups).toContain("back");
		expect(item.exercise).toBe("inclined machine chest pull");
	});
});

// ---------------------------------------------------------------------------
// The qualifier is the movement · an assisted machine is help, not load
// ---------------------------------------------------------------------------

/** The field report, said the way it was said. */
const ASSISTED_CHIN_UP = "assisted chin up with 55 pounds";

describe("a qualifier the catalogue must not drop", () => {
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("assisted@example.com");
		headers = { Authorization: `Bearer ${token}` };
	}, 60_000);

	it("saves it as an Assisted Chin-Up, never as a Chin-Up", async () => {
		// What the reader returns now the prompt tells it to keep the user's qualifiers.
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "assisted chin up",
					equipment: "assisted pull-up machine",
					description: "Assisted chin-up at 55 lb",
					sets: null,
					reps: null,
					load_lb: 55,
					duration_min: null,
					distance_mi: null,
					kcal: 40,
					confidence: "high",
				},
			],
		});
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", ASSISTED_CHIN_UP)
			.field("tz_offset_min", "0");
		expect(analyzed.status).toBe(200);
		expect(analyzed.body.results[0].items[0]).toMatchObject({ exercise: "assisted chin up", load_lb: 55 });

		const saved = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({
				client_id: randomUUID(),
				results: analyzed.body.results,
				text: ASSISTED_CHIN_UP,
				text_kind: "transcript",
				tz_offset_min: 0,
			});
		expect(saved.status).toBe(201);
		const row = saved.body.activities[0];
		// The whole report, in four assertions: the qualifier survived, the row is the
		// assisted movement and not the plain one, and the 55 is still 55.
		expect(row.exercise).toBe("Assisted Chin-Up");
		expect(row.exercise).not.toBe("Chin-Up");
		expect(row.load_lb).toBe(55);
		expect(row.exercise_id).not.toBeNull();

		const { rows } = await db.pool.query<{ name: string; load_direction: string }>(
			`SELECT name, load_direction FROM exercise_catalog WHERE id = $1`,
			[row.exercise_id]
		);
		expect(rows[0]).toMatchObject({ name: "Assisted Chin-Up", load_direction: "assistance" });
	});

	it("shows five pounds LESS assistance as the good news on the day", async () => {
		const today = localDay(new Date(), 0).date;
		await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "assisted chin-up at 50 lb", exercise: "assisted chin up", load_lb: 50, kcal: 40 });

		const day = await request(app).get(`/api/day/${today}?tz=0`).set(headers);
		const rows = day.body.items.activities.filter((item: { exercise: string }) => item.exercise === "Assisted Chin-Up");
		expect(rows).toHaveLength(2);
		// The second is 5 lb lighter: the number went down, and that is progress here.
		expect(rows[1].delta_vs_last).toMatchObject({ text: "-5 lb", direction: "down", sentiment: "good" });
	});

	it("tells the coach the load is help, not resistance", async () => {
		coachLlm.nextOutput = READING;
		const asked = await request(app).get(`/api/coach/next?tz=0`).set(headers);
		expect(asked.status).toBe(200);
		const prompt = buildCoachPrompt(coach.inputs.at(-1)!);
		expect(prompt).toContain("Assisted Chin-Up");
		expect(prompt).toContain("of assistance (help, not resistance — less is stronger)");
		expect(prompt).toContain("ASSISTED MACHINES");
		expect(prompt).toContain("progress is the number coming\n  DOWN");
	});

	it("keeps the user's words verbatim for a variation the catalogue does not have", async () => {
		// The other half of the rule, and what the old matcher got wrong: a qualifier with
		// no entry behind it is not a licence to save the nearest name.
		const created = await request(app)
			.post("/api/entries/movement")
			.set(headers)
			.send({ description: "3 × 5 deficit deadlift at 225", exercise: "deficit deadlift", load_lb: 225, kcal: 90 });
		expect(created.status).toBe(201);
		expect(created.body[0]).toMatchObject({ exercise: "deficit deadlift", exercise_id: null });

		// A correction obeys the same rule, in both directions.
		const patched = await request(app)
			.patch(`/api/entries/movement/${created.body[0].id}`)
			.set(headers)
			.send({ exercise: "paused bench press" });
		expect(patched.body).toMatchObject({ exercise: "paused bench press", exercise_id: null });

		const fixed = await request(app)
			.patch(`/api/entries/movement/${created.body[0].id}`)
			.set(headers)
			.send({ exercise: "assisted dips" });
		expect(fixed.body.exercise).toBe("Assisted Dip");
		expect(fixed.body.exercise_id).not.toBeNull();
	});
});

describe("the clarify loop — a question that remembers itself", () => {
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("clarify@example.com");
		headers = { Authorization: `Bearer ${token}` };
	}, 60_000);

	it("asks once, then resolves the answer against the question it asked", async () => {
		nextFusion({ kind: "unclear", question: "Was that a bench press?" });
		const asked = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", "did the thing")
			.field("tz_offset_min", "0");
		expect(asked.body.results[0]).toEqual({ kind: "unclear", question: "Was that a bench press?" });

		// "Yes" on its own is not a log. Sent back with the words it is about and the
		// question it answers, it is.
		nextFusion({
			kind: "activities",
			items: [
				{
					exercise: "Bench Press",
					equipment: null,
					description: "bench press",
					sets: null,
					reps: null,
					load_lb: null,
					duration_min: null,
					distance_mi: null,
					kcal: 60,
					confidence: "medium",
				},
			],
		});
		const answered = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", "yes")
			.field("clarify_original", "did the thing")
			.field("clarify_question", "Was that a bench press?")
			.field("tz_offset_min", "0");

		expect(answered.status).toBe(200);
		expect(answered.body.results[0].kind).toBe("activities");
		// The reader was handed both halves and told to read them together.
		const system = llm.requests.at(-1)!.system!;
		expect(system).toContain("did the thing");
		expect(system).toContain("Was that a bench press?");
		expect(system).toContain("ANSWER TO A QUESTION YOU ASKED");

		const saved = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), results: answered.body.results, text: "yes", tz_offset_min: 0 });
		expect(saved.status).toBe(201);
		expect(saved.body.activities[0].exercise).toBe("Bench Press");
	});

	it("ignores half a clarify round rather than asking about a message it cannot see", async () => {
		nextFusion({ kind: "weight", weight_lb: 180, confidence: "high" });
		const res = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", "180 this morning")
			.field("clarify_question", "Was that a bench press?")
			.field("tz_offset_min", "0");
		expect(res.status).toBe(200);
		expect(llm.requests.at(-1)!.system).not.toContain("ANSWER TO A QUESTION");
	});
});

describe("places — what the room has been seen to contain", () => {
	let headers: Record<string, string>;

	beforeAll(async () => {
		const token = await signUp("place@example.com");
		headers = { Authorization: `Bearer ${token}` };
	}, 60_000);

	/** Save one activity, exactly as the Log sheet would. */
	async function logActivity(exercise: string | null, equipment: string | null) {
		return request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({
				client_id: randomUUID(),
				results: [
					{
						kind: "activities",
						items: [
							{
								exercise,
								equipment,
								description: `${exercise ?? equipment}`,
								category: null,
								muscle_groups: null,
								sets: 3,
								reps: 10,
								load_lb: 100,
								duration_min: null,
								distance_mi: null,
								kcal: 90,
								confidence: "medium",
								sources: null,
							},
						],
					},
				],
				tz_offset_min: 0,
			});
	}

	it("saves a workout with no place set, and records nothing", async () => {
		// The state every account starts in, and most stay in. It must simply work.
		const saved = await logActivity("Lat Pulldown", "cable stack");
		expect(saved.status).toBe(201);
		const profile = await request(app).get("/api/profile").set(headers);
		expect(profile.body.place).toBeNull();
	});

	it("names the place when the user names it, and makes it the current one", async () => {
		nextFusion(
			{ kind: "statement", scope: "preference", text: "my gym is New Millennium" },
			{
				fields: {
					diet_style: null,
					protein_g: null,
					carbs_max_g: null,
					training_days: null,
					environment: "gym",
					equipment: null,
					eatback: null,
					experience: null,
					background: null,
					reference_loads: null,
					place_name: "New Millennium",
					place_kind: "gym",
				},
			}
		);
		const analyzed = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("text", "my gym is New Millennium")
			.field("tz_offset_min", "0");
		expect(analyzed.body.results[0].kind).toBe("preference");

		const saved = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), results: analyzed.body.results, tz_offset_min: 0 });
		expect(saved.status).toBe(201);

		const profile = await request(app).get("/api/profile").set(headers);
		expect(profile.body.place).toMatchObject({ name: "New Millennium", kind: "gym", equipment_count: 0 });
	});

	it("accrues what each workout used, once per label", async () => {
		await logActivity("Lat Pulldown", "cable stack");
		let profile = await request(app).get("/api/profile").set(headers);
		// The machine and the movement are two different facts about the room.
		expect(profile.body.place.equipment_count).toBe(2);

		// The same session again: the labels are bumped, not duplicated.
		await logActivity("Lat Pulldown", "Cable Stack");
		profile = await request(app).get("/api/profile").set(headers);
		expect(profile.body.place.equipment_count).toBe(2);

		// A movement the catalogue does not know is the user's paraphrase, not equipment.
		await logActivity("the inclined thing", "leg sled");
		profile = await request(app).get("/api/profile").set(headers);
		expect(profile.body.place.equipment_count).toBe(3);
	});

	it("tells the coach what has been seen there, and how to treat it", async () => {
		coachLlm.nextOutput = READING;
		const res = await request(app).get("/api/coach/next?tz=0").set(headers);
		expect(res.status).toBe(200);
		const plan = coach.inputs.at(-1)!.plan;
		expect(plan.place).toMatchObject({ name: "New Millennium", kind: "gym" });
		expect(plan.place!.equipment).toContain("cable stack");
		const prompt = buildCoachPrompt(coach.inputs.at(-1)!);
		expect(prompt).toContain("Seen at New Millennium (gym)");
		expect(prompt).toContain("prefer these when you prescribe");
		expect(prompt).toContain("name a substitution");
	});

	it("says nothing about a place for a user who has never named one", async () => {
		const token = await signUp("noplace@example.com");
		const other = { Authorization: `Bearer ${token}` };
		coachLlm.nextOutput = READING;
		const res = await request(app).get("/api/coach/next?tz=0").set(other);
		expect(res.status).toBe(200);
		const inputs = coach.inputs.at(-1)!;
		expect(inputs.plan.place).toBeNull();
		expect(buildCoachPrompt(inputs)).not.toContain("Seen at");
	});
});

// ── "Make a change" — the review-and-tell flow (concept-v2 §Principles 7: NO FORMS) ──
// The user never types into a field. They read back what was understood and TELL the app
// what is wrong with it; `POST /api/log/analyze` takes the parts plus the instruction and
// returns them revised, ready for the same confirm.

describe("fusion — revising by telling it", () => {
	let headers: Record<string, string>;
	beforeAll(async () => {
		headers = { Authorization: `Bearer ${await signUp("revise@example.com")}` };
	});

	const pending = {
		kind: "activities" as const,
		items: [
			{
				exercise: "Chest-Supported Row",
				equipment: "chest-supported row machine",
				description: "3 × 12 chest-supported row at 45 lb",
				category: "strength",
				muscle_groups: ["back"],
				sets: 3,
				reps: 12,
				load_lb: 45,
				duration_min: null,
				distance_mi: null,
				kcal: 120,
				confidence: "low" as const,
				sources: null,
				refine: null,
			},
		],
	};

	/** What the detail call answers with — the same schema the analyze pipeline uses. */
	const revisedItems = {
		items: [
			{
				exercise: "Chest-Supported Row",
				equipment: "chest-supported row machine",
				description: "3 × 4 chest-supported row at 50 lb",
				sets: 3,
				reps: 4,
				load_lb: 50,
				duration_min: null,
				distance_mi: null,
				kcal: 120,
				confidence: "high",
			},
		],
		photo_fields: [],
		photo_indexes: [],
	};

	it("applies a told change to the pending parts and returns them for the same confirm", async () => {
		llm.outputs.push(revisedItems);
		const res = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("tz_offset_min", "0")
			.field(
				"revise",
				JSON.stringify({ results: [pending], instruction: "reps were 4 and it was 50 pounds" })
			);

		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(1);
		expect(res.body.results[0].items[0]).toMatchObject({ sets: 3, reps: 4, load_lb: 50 });
		// Nothing was routed: a revision is one focused call, not a fresh read.
		expect(llm.requests.at(-1)!.schemaName).toBe("activities");
		expect(llm.requests.at(-1)!.system).toContain("reps were 4 and it was 50 pounds");
		// And no evidence was stored for a round that carried no photos.
		expect(res.body.evidence).toEqual([]);

		// The revised parts confirm exactly like an unrevised preview.
		const saved = await request(app)
			.post("/api/log/confirm")
			.set(headers)
			.send({ client_id: randomUUID(), results: res.body.results, tz_offset_min: 0 });
		expect(saved.status).toBe(201);
		const activities = await request(app).get("/api/entries/movement").set(headers);
		expect(activities.body[0]).toMatchObject({ sets: 3, reps: 4, load_lb: 50 });
	});

	it("takes one saved row as `record` — the DayLog's make-a-change", async () => {
		llm.outputs.push({
			description: "chicken and rice",
			meal_type: "lunch",
			kcal: 620,
			protein_g: 45,
			carbs_g: 60,
			fat_g: 18,
			fiber_g: 6,
			items: [],
			confidence: "high",
			photo_fields: [],
			photo_indexes: [],
		});
		const res = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("tz_offset_min", "0")
			.field(
				"revise",
				JSON.stringify({
					record: {
						kind: "meal",
						description: "chicken and rice",
						meal_type: "dinner",
						kcal: 620,
						protein_g: 45,
						carbs_g: 60,
						fat_g: 18,
						fiber_g: 6,
						items: [],
						confidence: "high",
						sources: null,
					},
					instruction: "that meal was lunch not dinner",
				})
			);

		expect(res.status).toBe(200);
		// One part in, one part out — and `result` for the single-part shape the card draws.
		expect(res.body.results).toHaveLength(1);
		expect(res.body.result).toMatchObject({ kind: "meal", meal_type: "lunch" });
	});

	it("refuses a revision with no parts, no instruction, or photos attached", async () => {
		const bad = async (body: unknown) =>
			(
				await request(app)
					.post("/api/log/analyze")
					.set(headers)
					.field("tz_offset_min", "0")
					.field("revise", JSON.stringify(body))
			).status;
		expect(await bad({ instruction: "make it lunch" })).toBe(400);
		expect(await bad({ results: [pending], instruction: "   " })).toBe(400);
		expect(
			(
				await request(app)
					.post("/api/log/analyze")
					.set(headers)
					.field("revise", "not json")
			).status
		).toBe(400);
		// A correction is words. The photos belong to the round that read them.
		expect(
			(
				await request(app)
					.post("/api/log/analyze")
					.set(headers)
					.field("revise", JSON.stringify({ results: [pending], instruction: "heavier" }))
					.attach("photos", await png(200, 100), { filename: "x.jpg", contentType: "image/jpeg" })
			).status
		).toBe(400);
	});

	it("re-projects a revised goal's timeline, like any other preview", async () => {
		llm.outputs.push({
			spec: {
				kind: "lose_fat",
				title: "Get to 165 lb",
				metrics: [
					{ measure: "body_weight", scope: null, target: 165, unit: "lb", direction: "decrease", rate: null, by: null },
				],
				active_to: null,
			},
			facts: { current_weight_lb: 191, training_days: null, environment: null, age_years: null },
		});
		const res = await request(app)
			.post("/api/log/analyze")
			.set(headers)
			.field("tz_offset_min", "0")
			.field(
				"revise",
				JSON.stringify({
					results: [
						{
							kind: "goal",
							spec: {
								kind: "lose_fat",
								title: "Get to 170 lb",
								metrics: [
									{ measure: "body_weight", scope: null, target: 170, unit: "lb", direction: "decrease", rate: null, by: null },
								],
								active_from: null,
								active_to: null,
							},
							proposed_timeline: null,
							facts: null,
						},
					],
					instruction: "make it 165, not 170",
				})
			);

		expect(res.status).toBe(200);
		expect(res.body.results[0].spec.metrics[0].target).toBe(165);
		// The date is arithmetic and the server owns it, on a revision as on a first read.
		expect(res.body.results[0].proposed_timeline).not.toBeNull();
	});
});
