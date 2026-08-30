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

// ── LLM providers ────────────────────────────────────────────────────────────────────
// Every provider sits behind LlmPort (src/ports/llm.ts) and is chosen here; container.ts
// builds the adapter. An unknown provider name is fatal at boot rather than at the first
// request — a typo in LLM_PROVIDER should not look like a working deploy.
const LLM_PROVIDERS = ["anthropic", "openai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

function readProvider(name: string, fallback: LlmProvider): LlmProvider {
	const value = read(name);
	if (!value) return fallback;
	if ((LLM_PROVIDERS as readonly string[]).includes(value)) return value as LlmProvider;
	throw new Error(
		`❌ ${name}=${value} is not a known LLM provider. Use one of: ${LLM_PROVIDERS.join(", ")}.`
	);
}

const llmProvider = readProvider("LLM_PROVIDER", "anthropic");
const coachLlmProvider = readProvider("COACH_LLM_PROVIDER", llmProvider);

// Per-provider defaults so LLM_MODEL_* only has to be set when overriding. Also what the
// adapter contract tests call, so there is one source of truth for model names.
const DEFAULT_MODELS = Object.freeze({
	anthropic: Object.freeze({ fusion: "claude-haiku-4-5", coach: "claude-sonnet-4-5" }),
	openai: Object.freeze({ fusion: "gpt-4.1-mini", coach: "gpt-4.1" }),
});

// ANTHROPIC_MODEL is v1's name for the same setting; still honoured so the deployed
// .env.production keeps working.
const fusionModel =
	read("LLM_MODEL_FUSION") ??
	(llmProvider === "anthropic" ? read("ANTHROPIC_MODEL") : undefined) ??
	DEFAULT_MODELS[llmProvider].fusion;
const coachModel = read("LLM_MODEL_COACH") ?? DEFAULT_MODELS[coachLlmProvider].coach;

// Keys are optional everywhere: without one, sign-in, manual logging and every other
// endpoint keep working and only the LLM call fails, with a clear message (see
// adapters/llm/unavailable.ts). Warned about at boot so a forgotten key is visible in the
// container log.
const anthropicApiKey = read("ANTHROPIC_API_KEY") ?? "";
const openaiApiKey = read("OPENAI_API_KEY") ?? "";
const usedProviders = new Set<LlmProvider>([llmProvider, coachLlmProvider]);
const providerKeys: Record<LlmProvider, { key: string; envName: string }> = {
	anthropic: { key: anthropicApiKey, envName: "ANTHROPIC_API_KEY" },
	openai: { key: openaiApiKey, envName: "OPENAI_API_KEY" },
};
if (!isTest) {
	for (const provider of usedProviders) {
		const { key, envName } = providerKeys[provider];
		if (!key) {
			console.warn(`⚠️  ${envName} is unset — AI features using the ${provider} provider will fail until it is set`);
		}
	}
}

// ── Evidence storage ─────────────────────────────────────────────────────────────────
// Where the photos behind a log live (src/ports/storage.ts). `local` is a directory — the
// trackdown_uploads Docker volume in production, ./uploads in dev. `s3` arrives with its
// adapter; naming it here today would be a config key with nothing behind it.
const EVIDENCE_PROVIDERS = ["local"] as const;
export type EvidenceProvider = (typeof EVIDENCE_PROVIDERS)[number];

const evidenceProviderName = read("EVIDENCE_STORAGE") ?? "local";
if (!(EVIDENCE_PROVIDERS as readonly string[]).includes(evidenceProviderName)) {
	throw new Error(
		`❌ EVIDENCE_STORAGE=${evidenceProviderName} is not a known evidence store. ` +
			`Use one of: ${EVIDENCE_PROVIDERS.join(", ")}.`
	);
}
// /app is the Docker image's WORKDIR, so the volume mounts at /app/uploads there; outside
// a container the repo-relative ./uploads keeps a dev run self-contained.
const evidenceDir = read("EVIDENCE_DIR") ?? (isProduction ? "/app/uploads" : "./uploads");

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

	llm: Object.freeze({
		/** Log parsing and (WP2) photo fusion. */
		provider: llmProvider,
		fusionModel,
		/** The coach (WP5) — usually a bigger model, optionally a different provider. */
		coachProvider: coachLlmProvider,
		coachModel,
		defaultModels: DEFAULT_MODELS,
	}),

	anthropic: Object.freeze({
		apiKey: anthropicApiKey,
		// Identity-linked API keys must name the workspace on every request
		// (`anthropic-workspace-id`); legacy keys leave this unset.
		workspaceId: read("ANTHROPIC_WORKSPACE_ID"),
	}),

	openai: Object.freeze({
		apiKey: openaiApiKey,
		/** Point at a compatible gateway (Azure, a proxy) without changing the adapter. */
		baseUrl: read("OPENAI_BASE_URL"),
	}),

	evidence: Object.freeze({
		provider: evidenceProviderName as EvidenceProvider,
		/** Root directory for the local store; created on first upload. */
		dir: evidenceDir,
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
