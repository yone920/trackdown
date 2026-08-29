/**
 * The single place the backend reads `process.env` (same convention as My Read Coach).
 * Validation happens once at startup: missing credentials are fatal in production and
 * a warning in development, so a misconfigured deploy fails before it listens rather
 * than on the first user request.
 */
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

const missing: string[] = [];

function read(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

const port = Number(read("PORT") ?? 8000);

// Native apps send no Origin header, so CORS only matters for the Expo web target and
// local tooling. Better Auth's trustedOrigins uses the same list.
const allowedOrigins = [
	...new Set(
		[read("APP_ORIGIN"), "http://localhost:8081", "http://localhost:19006"].filter(
			(origin): origin is string => Boolean(origin)
		)
	),
];

// Matches the postgres service in docker-compose.dev.yml
const DEFAULT_DATABASE_URL = "postgres://trackdown:trackdown@localhost:5433/trackdown";
const databaseUrlFromEnv = read("DATABASE_URL");

if (!databaseUrlFromEnv && isProduction) {
	throw new Error(
		"❌ DATABASE_URL is not set but NODE_ENV=production. Refusing to start: every data " +
			"endpoint goes through this connection and the local dev default does not exist in " +
			"production. Set it in .env.production — see .env.example."
	);
}

const DEV_AUTH_SECRET = "dev-only-better-auth-secret-do-not-use-in-production";
const betterAuthSecretFromEnv = read("BETTER_AUTH_SECRET");

if (!betterAuthSecretFromEnv) {
	if (isProduction) {
		throw new Error("❌ BETTER_AUTH_SECRET must be set in production (openssl rand -base64 32)");
	}
	if (!isTest) console.warn("⚠️  BETTER_AUTH_SECRET is unset — using the insecure dev secret");
}

// Optional everywhere: without it POST /api/log answers with a clear error while sign-in,
// manual logging and every other endpoint keep working (createClaudeLogParser handles the
// empty key). Warned about at boot so a forgotten key is visible in the container log.
const anthropicApiKey = read("ANTHROPIC_API_KEY") ?? "";
if (!anthropicApiKey && !isTest) {
	console.warn("⚠️  ANTHROPIC_API_KEY is unset — free-text logging (POST /api/log) will fail until it is set");
}

const smtpHost = read("SMTP_HOST");
const smtpPort = Number(read("SMTP_PORT") ?? 587);

if (missing.length > 0 && !isTest) {
	const list = missing.map((entry) => `   • ${entry}`).join("\n");
	if (isProduction) {
		throw new Error(
			`❌ Missing required configuration (NODE_ENV=production):\n${list}\n\n` +
				`Set these in .env.production — see .env.example.`
		);
	}
	console.warn(
		`⚠️  Missing configuration — the features below will fail when used:\n${list}\n` +
			`   Auth, the database and every CRUD endpoint work without them.`
	);
}

export const config = Object.freeze({
	nodeEnv,
	isProduction,
	isTest,
	port,
	allowedOrigins,

	appVersion: read("APP_VERSION"),
	gitSha: read("GIT_SHA"),

	databaseUrl: databaseUrlFromEnv ?? DEFAULT_DATABASE_URL,
	databaseUrlIsExplicit: Boolean(databaseUrlFromEnv),

	auth: Object.freeze({
		secret: betterAuthSecretFromEnv ?? DEV_AUTH_SECRET,
		/** Public base URL of this backend — where /api/auth/* is reachable from the phone. */
		baseUrl: read("BETTER_AUTH_URL") ?? `http://localhost:${port}`,
	}),

	anthropic: Object.freeze({
		apiKey: anthropicApiKey,
		// The Supabase edge function used claude-haiku-4-5; kept env-tunable.
		model: read("ANTHROPIC_MODEL") ?? "claude-haiku-4-5",
	}),

	smtp: Object.freeze({
		host: smtpHost,
		port: smtpPort,
		user: read("SMTP_USER"),
		password: read("SMTP_PASSWORD"),
		secure: read("SMTP_SECURE") === "true" || smtpPort === 465,
		from: read("EMAIL_FROM") ?? "TrackDown <noreply@yonelab.net>",
	}),
});

export type Config = typeof config;
