import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import type pg from "pg";
import type { Auth } from "./auth.js";
import { checkDatabase } from "./db/client.js";
import { createRequireUser } from "./middleware/auth.js";
import { beginTiming } from "./middleware/timing.js";
import { isLlmError } from "./services/llmErrors.js";
import type { CoachPort } from "./ports/coach.js";
import type { ExerciseMediaStore } from "./ports/exerciseMedia.js";
import type { EvidenceStore } from "./ports/storage.js";
import { coachRouter } from "./routes/coach.js";
import { dayRouter } from "./routes/day.js";
import { eatingRouter } from "./routes/eating.js";
import { entriesRouter } from "./routes/entries.js";
import { evidenceRouter } from "./routes/evidence.js";
import { exercisesRouter } from "./routes/exercises.js";
import { fusionRouter } from "./routes/fusion.js";
import { goalsRouter } from "./routes/goals.js";
import { logRouter } from "./routes/log.js";
import { profileRouter } from "./routes/profile.js";
import { trainingRouter } from "./routes/training.js";
import { weightRouter } from "./routes/weight.js";
import { youRouter } from "./routes/you.js";
import type { FusionAnalyzer } from "./services/fusion/analyze.js";
import type { ProfileReadings } from "./services/readings/dossier.js";
import type { DayReadings } from "./services/readings/readings.js";
import type { LogParser } from "./services/parseLog.js";

export interface AppDeps {
	pool: pg.Pool;
	auth: Auth;
	parser: LogParser;
	/** The multimodal classifier behind POST /api/log/analyze. */
	fusion: FusionAnalyzer;
	/** Where uploaded photos live; served back by GET /api/evidence/:id. */
	evidence: EvidenceStore;
	/** The exercise illustrations, served back by GET /api/exercises/:id/media/:n. */
	exerciseMedia: ExerciseMediaStore;
	/** The two generated sentences on a day, and their cache (WP3). */
	readings: DayReadings;
	/** The You screen's dossier, and its cache (migration 0017). */
	profileReadings: ProfileReadings;
	/** The on-demand brief behind GET /api/coach/next (WP5). */
	coach: CoachPort;
	allowedOrigins: string[];
	version: string;
	commit: string;
	/** Off in tests so repeated requests from one IP don't trip it. */
	rateLimiting?: boolean;
}

// Express 5 forwards rejected promises from async handlers to the error handler, so
// routes can `await` without try/catch.
/**
 * What a bug in here says out loud. One sentence, no internals: the log has the real one,
 * and the app renders its own copy for anything it does not recognise anyway.
 */
export const UNEXPECTED_MESSAGE = "Something went wrong on our end.";

/**
 * Browser hints, removed from requests that cannot possibly be a browser form post.
 *
 * **The bug (TestFlight, 2026-09-02).** Creating an account on the first production build
 * failed with Better Auth's "Missing or null Origin". A native build sends no `Origin`, and
 * iOS attaches `Sec-Fetch-*`; Better Auth's form-CSRF middleware reads any `Sec-Fetch-*`
 * header as "this came from a browser" and then *force-validates* an Origin that is not
 * there. The dev build never hit it because Metro gave every request an Origin, and the
 * suite never hit it because Better Auth turns the whole check off under `NODE_ENV=test`
 * (`auth.origin.test.ts` reproduces it by asking for production semantics on purpose).
 *
 * **What this does, and only this**: on `/api/auth/*`, for a request carrying **no cookie**,
 * drop the `Sec-Fetch-*` hints. A request with no cookie has no ambient credential to abuse
 * — CSRF is a browser attaching cookies it holds — and Better Auth's own `validateOrigin`
 * agrees: with no cookie header it returns without checking. Only the form-CSRF path, which
 * exists for cookie-session form posts, forces the issue, and that path is a false positive
 * for a bearer-token client.
 *
 * **What still protects a browser.** Everything that did before:
 *   · a request WITH a cookie keeps every hint and every check, untouched;
 *   · `cors()` above refuses any Origin not on the allow-list — including the literal
 *     `null` — with a 403 before a route runs, so a cross-site browser POST never reaches
 *     Better Auth's gate at all;
 *   · sessions here are bearer tokens (`set-auth-token` → `Authorization`), which an
 *     attacker's page can neither read nor cause to be sent.
 *
 * Deliberately not `advanced.disableCSRFCheck` (blanket), and not the undocumented
 * path-array form of `disableOriginCheck` (its published type is `boolean` and its
 * documented meaning is callbackURL validation — building auth on an untyped shape is how a
 * minor upgrade turns into an outage). Deliberately not `@better-auth/expo` either: that
 * plugin exists to trust an app-scheme Origin, and our failure is a MISSING one.
 */
/**
 * When an auth request is refused, say what it looked like.
 *
 * The TestFlight lockout cost a day mostly because nobody could see what the phone actually
 * sent: the app showed one sentence, the server logged nothing, and the shape had to be
 * inferred from the error string. This logs the SHAPE of any auth request the server turns
 * away — the origin, the referer's origin, the fetch-metadata triple, whether a cookie or a
 * bearer token was present — and nothing else. No bodies, no emails, no passwords, no
 * tokens: none of that is a shape.
 */
export function logRefusedAuth(req: Request, res: Response, next: NextFunction): void {
	res.on("finish", () => {
		if (res.statusCode < 400) return;
		const header = (name: string) => req.headers[name];
		const referer = typeof req.headers.referer === "string" ? safeOrigin(req.headers.referer) : undefined;
		console.warn(
			`🔒 auth refused ${res.statusCode} ${req.method} ${req.path} · ` +
				[
					`origin=${header("origin") ?? "—"}`,
					`referer_origin=${referer ?? "—"}`,
					`sec-fetch=${[header("sec-fetch-site"), header("sec-fetch-mode"), header("sec-fetch-dest")].filter(Boolean).join("/") || "—"}`,
					`cookie=${req.headers.cookie ? "yes" : "no"}`,
					`bearer=${req.headers.authorization ? "yes" : "no"}`,
					`ua=${String(header("user-agent") ?? "—").slice(0, 60)}`,
				].join(" · ")
		);
	});
	next();
}

/** The origin of a URL, or undefined — never the path, which can carry identifiers. */
function safeOrigin(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

export function normaliseNativeAuthRequest(req: Request, _res: Response, next: NextFunction): void {
	const header = (name: string): string | undefined => {
		const value = req.headers[name];
		return typeof value === "string" && value.trim() !== "" ? value : undefined;
	};

	const origin = header("origin");
	const referer = header("referer");
	const fetchMetadata = Boolean(
		header("sec-fetch-site") ?? header("sec-fetch-mode") ?? header("sec-fetch-dest") ?? header("sec-fetch-user")
	);

	// ── 1. Nothing here says "browser" at all ────────────────────────────────────────
	//
	// No Origin, no Referer, and no fetch metadata. **A CSRF-capable browser cannot
	// produce this combination.** Every engine that ships today sends `Sec-Fetch-*` on
	// every request (Chrome and Edge since 76, Firefox since 90, Safari since 16.4), and a
	// browser posting across origins — which is what a CSRF attack IS — sends an `Origin`
	// besides. A same-origin form post would still carry `Sec-Fetch-Site: same-origin`. So
	// this shape is a native HTTP client, and the cookie riding along with it is not a
	// browser session: it is iOS's `NSURLSession` cookie jar, which persists and replays
	// cookies for native apps automatically.
	//
	// That jar is what re-locked the TestFlight build after the first fix (production log,
	// 2026-09-03 06:59): Better Auth had set a cookie during the earlier *failed* attempts,
	// and the v1 rule only relaxed for cookie-less requests — so the failure planted the
	// cookie and the cookie sustained the failure, on a device that could never clear it
	// short of a reinstall. **A fix that requires a reinstall is not a fix.**
	//
	// The cookie is therefore dropped for this shape. We are a bearer-token server: the
	// session that matters arrives in `Authorization`, `bearer()` is what reads it, and a
	// stray cookie on a native request carries no authority we want and no protection we
	// lose. Better Auth then takes its own no-cookie path and stops demanding an Origin.
	if (!origin && !referer && !fetchMetadata) {
		delete req.headers.cookie;
		next();
		return;
	}

	// ── 2. Browser-shaped, but with no ambient credential to protect ─────────────────
	//
	// The first TestFlight failure: iOS attaches `Sec-Fetch-*` while sending no Origin, and
	// Better Auth's form-CSRF path reads those hints as proof of a browser and force-
	// validates an Origin that was never there. With no cookie there is nothing a
	// cross-site page could spend, so the hints are dropped and the check returns to what
	// Better Auth itself does for token clients.
	if (!req.headers.cookie) {
		delete req.headers["sec-fetch-site"];
		delete req.headers["sec-fetch-mode"];
		delete req.headers["sec-fetch-dest"];
		delete req.headers["sec-fetch-user"];

		// A literal `Origin: null` is the same story told a second way: it is not the origin
		// of a browser session, it is the absence of one. (The CORS layer above has already
		// decided such a request may proceed without being given anything to read.)
		if (req.headers.origin === "null") delete req.headers.origin;
	}

	// ── 3. Browser-shaped AND cookie-bearing ────────────────────────────────────────
	//
	// Untouched, in every respect. This is the only shape a CSRF attack can wear, and it
	// keeps every check Better Auth ships with.
	next();
}

export function createApp({
	pool,
	auth,
	parser,
	fusion,
	evidence,
	exerciseMedia,
	readings,
	profileReadings,
	coach,
	allowedOrigins,
	version,
	commit,
	rateLimiting = true,
}: AppDeps) {
	const app = express();
	app.set("trust proxy", 1); // behind cloudflared

	// First of all, so `total` on a Server-Timing header covers the whole stack.
	app.use(beginTiming);

	// The delegate form, because the decision needs the REQUEST and not just the origin:
	// whether it carries a cookie is what separates "a browser with a session" from "a
	// client holding a bearer token" (see normaliseNativeAuthRequest).
	app.use(
		cors((req, done) => {
			const base = { credentials: true, exposedHeaders: ["set-auth-token", "Server-Timing"] };
			const origin = req.headers.origin;

			// Native apps, curl and health probes send no Origin at all.
			if (!origin || allowedOrigins.includes(origin)) {
				done(null, { ...base, origin: true });
				return;
			}

			// A literal `null` origin from a client with NO COOKIE: let the request through,
			// and give it nothing to read back. Some native stacks and sandboxed contexts
			// send `Origin: null`, and a locked-out user is a real cost; a browser page in
			// that state is not, because `origin: false` sends no `Access-Control-Allow-Origin`
			// and so the browser refuses it the response anyway. A cookie-bearing `null`
			// origin is still refused outright — that one could be a session being used from
			// somewhere it should not be.
			if (origin === "null" && !req.headers.cookie) {
				done(null, { ...base, origin: false });
				return;
			}

			done(new Error(`Origin ${origin} not allowed by CORS`));
		})
	);

	if (rateLimiting) {
		app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
	}

	app.get("/health", async (_req, res) => {
		try {
			await checkDatabase(pool);
			res.json({ status: "ok", db: "ok", version, commit });
		} catch (error) {
			console.error("⚠️  Health check failed — Postgres unreachable:", error);
			res.status(503).json({ status: "error", db: "unreachable", version, commit });
		}
	});

	// Better Auth reads the raw request body itself — must be mounted before express.json
	app.all("/api/auth/*splat", normaliseNativeAuthRequest, logRefusedAuth, toNodeHandler(auth));

	app.use(express.json({ limit: "256kb" }));

	const requireUser = createRequireUser(auth);
	app.use("/api", requireUser);
	app.use(entriesRouter(pool));
	app.use(weightRouter(pool));
	app.use(profileRouter(pool));
	app.use(logRouter(pool, parser));
	app.use(fusionRouter(pool, fusion, evidence));
	app.use(evidenceRouter(pool, evidence));
	app.use(exercisesRouter(pool, exerciseMedia));
	app.use(dayRouter(pool, readings));
	app.use(eatingRouter(pool, readings));
	app.use(goalsRouter(pool));
	app.use(trainingRouter(pool));
	app.use(youRouter(pool, profileReadings));
	app.use(coachRouter(pool, coach, readings));

	// The last word on every failure, and the reason the field reports stopped.
	//
	// It used to echo `error.message` into the body. For an SDK error that message IS the
	// provider's JSON — `400 {"type":"error","error":{"type":"invalid_request_error",
	// "message":"Your credit balance is too low…"},"request_id":…}` — so a route that
	// simply let a throw propagate (which Express 5 encourages: async rejections come
	// here) published the provider's internals to a phone. Twice, with two different
	// statuses (services/llmErrors.ts).
	//
	// Now: a model failure answers by CODE, and anything else answers with one fixed line.
	// An unexpected 500 is a bug in here, and its message is for the log — a stack-adjacent
	// sentence on a screen in a gym helps nobody and can carry anything.
	app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		const message = error instanceof Error ? error.message : String(error);
		// The CORS refusal is this app's own sentence, and naming the origin is the point.
		if (message.startsWith("Origin ")) {
			res.status(403).json({ error: message });
			return;
		}
		if (isLlmError(error)) {
			console.error(`❌ unhandled llm failure: ${error.message}`);
			res.status(error.status).json({ error: error.userMessage, code: error.code });
			return;
		}
		console.error("Unhandled error:", error);
		res.status(500).json({ error: UNEXPECTED_MESSAGE });
	});

	return app;
}
