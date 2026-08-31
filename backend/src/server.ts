import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { config } from "./config/index.js";
import { createContainer } from "./container.js";
import { describeTarget, pool } from "./db/client.js";
import { sweepUnlinkedEvidence } from "./services/evidence.js";
import { createFusionAnalyzer } from "./services/fusion/analyze.js";
import { createLogParser } from "./services/parseLog.js";
import { createDayReadings } from "./services/readings/readings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Version/commit come from Docker build args in production; outside Docker fall back to
// package.json / git so /health stays accurate in local dev.
function resolveVersion(): string {
	if (config.appVersion) return config.appVersion;
	try {
		return JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf-8")).version;
	} catch {
		return "unknown";
	}
}
function resolveCommit(): string {
	if (config.gitSha) return config.gitSha;
	try {
		return execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return "unknown";
	}
}

console.log(
	`🗄️  Postgres target: ${describeTarget(config.databaseUrl)}${config.databaseUrlIsExplicit ? "" : " (local dev default, DATABASE_URL unset)"}`
);

const container = createContainer(config);

const auth = createAuth({
	pool,
	secret: config.auth.secret,
	baseUrl: config.auth.baseUrl,
	trustedOrigins: config.allowedOrigins,
});

const app = createApp({
	pool,
	auth,
	parser: createLogParser(container.llm),
	fusion: createFusionAnalyzer(container.llm),
	evidence: container.evidence,
	exerciseMedia: container.exerciseMedia,
	// The day readings run on the coach model: they are two sentences of judgement, not
	// an extraction (config COACH_LLM_PROVIDER / LLM_MODEL_COACH).
	readings: createDayReadings(container.coachLlm),
	coach: container.coach,
	allowedOrigins: config.allowedOrigins,
	version: resolveVersion(),
	commit: resolveCommit(),
});

app.listen(config.port, () => {
	console.log(`🚀 TrackDown API listening on port ${config.port} (auth base URL ${config.auth.baseUrl})`);
	console.log(`🤖 LLM: ${config.llm.provider}/${container.llm.model} · coach ${config.llm.coachProvider}/${container.coachLlm.model}`);
	console.log(`🖼️  Evidence store: ${container.evidence.describe}`);

	// Photos are stored when /api/log/analyze runs, before the user confirms anything, so
	// an abandoned preview leaves bytes owning nothing. One sweep at boot is enough: the
	// process restarts on every deploy, and a day of grace costs a few megabytes.
	sweepUnlinkedEvidence(pool, container.evidence)
		.then(({ rows, files }) => {
			if (rows > 0) console.log(`🧹 Swept ${rows} unconfirmed evidence row(s), ${files} file(s)`);
		})
		.catch((error) => console.error("⚠️  Evidence sweep failed:", error));
});
