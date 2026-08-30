import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { config } from "./config/index.js";
import { describeTarget, pool } from "./db/client.js";
import { createClaudeLogParser } from "./services/parseLog.js";

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

const auth = createAuth({
	pool,
	secret: config.auth.secret,
	baseUrl: config.auth.baseUrl,
	trustedOrigins: config.allowedOrigins,
});

const app = createApp({
	pool,
	auth,
	parser: createClaudeLogParser(config.anthropic),
	allowedOrigins: config.allowedOrigins,
	version: resolveVersion(),
	commit: resolveCommit(),
});

app.listen(config.port, () => {
	console.log(`🚀 TrackDown API listening on port ${config.port} (auth base URL ${config.auth.baseUrl})`);
});
