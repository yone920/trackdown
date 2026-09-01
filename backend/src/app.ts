import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import type pg from "pg";
import type { Auth } from "./auth.js";
import { checkDatabase } from "./db/client.js";
import { createRequireUser } from "./middleware/auth.js";
import { beginTiming } from "./middleware/timing.js";
import type { CoachPort } from "./ports/coach.js";
import type { ExerciseMediaStore } from "./ports/exerciseMedia.js";
import type { EvidenceStore } from "./ports/storage.js";
import { coachRouter } from "./routes/coach.js";
import { dayRouter } from "./routes/day.js";
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

	app.use(
		cors({
			origin: (origin, callback) => {
				// Native apps, curl and health probes send no Origin
				if (!origin || allowedOrigins.includes(origin)) callback(null, true);
				else callback(new Error(`Origin ${origin} not allowed by CORS`));
			},
			credentials: true,
			exposedHeaders: ["set-auth-token", "Server-Timing"],
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
	app.all("/api/auth/*splat", toNodeHandler(auth));

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
	app.use(goalsRouter(pool));
	app.use(trainingRouter(pool));
	app.use(youRouter(pool, profileReadings));
	app.use(coachRouter(pool, coach, readings));

	app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("Origin ")) {
			res.status(403).json({ error: message });
			return;
		}
		console.error("Unhandled error:", error);
		res.status(500).json({ error: message });
	});

	return app;
}
