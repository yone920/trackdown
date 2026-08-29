import pg from "pg";
import { config } from "../config/index.js";

// PostgREST serialized NUMERIC columns as JSON numbers and timestamps as ISO strings;
// node-postgres defaults to string/Date. Match PostgREST so the app's response shapes
// stay identical after leaving Supabase.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => parseFloat(value));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) => new Date(value).toISOString());
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) => new Date(value + "Z").toISOString());

/** Host:port/database only — never log the connection string, it carries the password. */
export function describeTarget(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
	} catch {
		return "<unparseable DATABASE_URL>";
	}
}

export function createPool(connectionString: string): pg.Pool {
	const pool = new pg.Pool({ connectionString });
	pool.on("error", (err) => {
		console.error("⚠️  Unexpected error on idle Postgres client:", err);
	});
	return pool;
}

const HEALTH_CHECK_TIMEOUT_MS = 2000;

/** Verify the database is reachable; /health uses this so a broken DATABASE_URL cannot report healthy. */
export async function checkDatabase(pool: pg.Pool): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Postgres health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
			HEALTH_CHECK_TIMEOUT_MS
		);
	});
	try {
		await Promise.race([pool.query("SELECT 1"), timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** The production pool. Tests build their own via createPool(). */
export const pool = createPool(config.databaseUrl);
