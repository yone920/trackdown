import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { startTestDatabase, type TestDatabase } from "./test/db.js";
import { createFakeLlm } from "./test/fakes/llm.js";
import { createFakeCoach } from "./test/fakes/coach.js";
import { createFakeEvidenceStore } from "./test/fakes/storage.js";
import { createFakeExerciseMediaStore } from "./test/fakes/exerciseMedia.js";
import { createLogParser } from "./services/parseLog.js";
import { createFusionAnalyzer } from "./services/fusion/analyze.js";
import { createDayReadings } from "./services/readings/readings.js";
import { createProfileReadings } from "./services/readings/dossier.js";

// The origin gate, measured the way production runs it.
//
// **Why this file exists at all.** The first TestFlight build could not create an account:
// Better Auth answered "Missing or null Origin". Every auth test in this repo was green,
// and could only ever be green — Better Auth turns the origin check OFF when `NODE_ENV=test`
// (`skipOriginCheck: … isTest() ? true : false`), which vitest sets for the whole suite. So
// this file asks for the production posture explicitly (`productionOriginSemantics`) and
// then walks the header shapes real clients actually send.
//
// The shapes, and who sends them:
//   · no Origin, no hints          curl, health probes, some native stacks
//   · no Origin + `Sec-Fetch-*`    the iOS production build — the reported failure
//   · a dev-server Origin          Expo web and Metro
//   · a bogus Origin               an attacker's page; must still be refused
//   · `Origin: null`               a sandboxed browser context; must still be refused

const DEV_ORIGIN = "http://localhost:8081";

let db: TestDatabase;
let app: Express;

beforeAll(async () => {
	db = await startTestDatabase();
	const llm = createFakeLlm();
	const coachLlm = createFakeLlm("coach");
	app = createApp({
		pool: db.pool,
		auth: createAuth({
			pool: db.pool,
			secret: "test-secret-test-secret-test-secret",
			baseUrl: "http://localhost:8000",
			trustedOrigins: [DEV_ORIGIN],
			// The whole point: without this the gate is open and this file proves nothing.
			productionOriginSemantics: true,
		}),
		parser: createLogParser(llm),
		fusion: createFusionAnalyzer(llm),
		evidence: createFakeEvidenceStore(),
		exerciseMedia: createFakeExerciseMediaStore(),
		readings: createDayReadings(coachLlm),
		profileReadings: createProfileReadings(coachLlm),
		coach: createFakeCoach(),
		allowedOrigins: [DEV_ORIGIN],
		version: "test",
		commit: "test",
		rateLimiting: false,
	});
}, 120_000);

afterAll(async () => {
	await db?.stop();
});

let counter = 0;
const freshEmail = () => `origin-${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = "correct-horse-battery";

/** Headers a native production build sends: no Origin, and iOS's fetch metadata. */
const NATIVE: Record<string, string> = {
	"Sec-Fetch-Site": "cross-site",
	"Sec-Fetch-Mode": "cors",
	"Sec-Fetch-Dest": "empty",
};

describe("creating an account from a native client", () => {
	// The reported bug, exactly: this returned 403 MISSING_OR_NULL_ORIGIN.
	it("works with no Origin and the fetch-metadata headers iOS attaches", async () => {
		const res = await request(app).post("/api/auth/sign-up/email").set(NATIVE).send({
			name: "native",
			email: freshEmail(),
			password: PASSWORD,
		});

		expect(res.status).toBe(200);
		expect(res.body.token).toBeTruthy();
		expect(res.headers["set-auth-token"]).toBeTruthy();
	});

	it("works with no Origin and no hints at all — curl, and every script we own", async () => {
		const res = await request(app)
			.post("/api/auth/sign-up/email")
			.send({ name: "curl", email: freshEmail(), password: PASSWORD });
		expect(res.status).toBe(200);
	});

	it("signs in and out again from the same origin-less client", async () => {
		const email = freshEmail();
		await request(app).post("/api/auth/sign-up/email").set(NATIVE).send({ name: "n", email, password: PASSWORD });

		const signIn = await request(app).post("/api/auth/sign-in/email").set(NATIVE).send({ email, password: PASSWORD });
		expect(signIn.status).toBe(200);
		const token = signIn.headers["set-auth-token"] as string;
		expect(token).toBeTruthy();

		// The token works on a real endpoint…
		const board = await request(app).get("/api/training/board?tz=0").set({ Authorization: `Bearer ${token}` }).set(NATIVE);
		expect(board.status).toBe(200);

		// …and sign-out is an auth POST from the same client, so it is on the same path.
		const out = await request(app)
			.post("/api/auth/sign-out")
			.set(NATIVE)
			.set({ Authorization: `Bearer ${token}` });
		expect(out.status).toBe(200);
	});

	it("still refuses a wrong password — the gate opening is not the lock opening", async () => {
		const email = freshEmail();
		await request(app).post("/api/auth/sign-up/email").set(NATIVE).send({ name: "n", email, password: PASSWORD });
		const res = await request(app).post("/api/auth/sign-in/email").set(NATIVE).send({ email, password: "wrong-password-entirely" });
		expect(res.status).toBe(401);
	});
});

describe("the browser is still gated", () => {
	it("lets the dev server through", async () => {
		const res = await request(app)
			.post("/api/auth/sign-up/email")
			.set({ Origin: DEV_ORIGIN })
			.send({ name: "web", email: freshEmail(), password: PASSWORD });
		expect(res.status).toBe(200);
	});

	it("refuses an origin nobody allow-listed, before the route runs", async () => {
		const res = await request(app)
			.post("/api/auth/sign-up/email")
			.set({ Origin: "https://evil.example" })
			.send({ name: "evil", email: freshEmail(), password: PASSWORD });
		expect(res.status).toBe(403);
	});

	// `Origin: null` from a client with no cookie is let THROUGH — some native stacks send
	// it, and a locked-out user is a real cost — but it is given nothing to read back: no
	// `Access-Control-Allow-Origin`, so a browser in that state is refused the response by
	// its own rules. The request succeeding is not the same as the answer being readable.
	it("lets a cookie-less null origin sign up, but hands it no CORS grant", async () => {
		const res = await request(app)
			.post("/api/auth/sign-up/email")
			.set({ Origin: "null" })
			.send({ name: "sandbox", email: freshEmail(), password: PASSWORD });
		expect(res.status).toBe(200);
		expect(res.headers["access-control-allow-origin"]).toBeUndefined();
	});

	// A cookie with a null origin is a session being used from somewhere it should not be.
	it("still refuses a null origin that carries a cookie", async () => {
		const res = await request(app)
			.post("/api/auth/sign-in/email")
			.set({ Origin: "null", Cookie: "better-auth.session_token=whatever" })
			.send({ email: "someone@example.com", password: PASSWORD });
		expect(res.status).toBe(403);
	});

	// The hints are only dropped for a request that cannot be a cookie CSRF. A browser
	// carrying a session keeps every check it had.
	it("keeps the origin check for anything holding a cookie", async () => {
		const res = await request(app)
			.post("/api/auth/sign-in/email")
			.set({ ...NATIVE, Cookie: "better-auth.session_token=whatever" })
			.send({ email: "someone@example.com", password: PASSWORD });
		expect(res.status).toBe(403);
		expect(res.body.code).toBe("MISSING_OR_NULL_ORIGIN");
	});
});
