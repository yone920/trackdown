import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { seedExercises } from "../db/exercises.js";
import { runMigrations } from "../db/migrations.js";

// Real Postgres for integration tests, without Docker: embedded-postgres downloads a
// server binary into node_modules and runs it from a temp data directory.

export interface TestDatabase {
	pool: pg.Pool;
	url: string;
	stop(): Promise<void>;
}

export interface TestDatabaseOptions {
	/**
	 * Stop migrating after this file, e.g. "0003_account_issuer.sql" — for tests that put
	 * real rows on an old schema and then migrate forward. The exercise catalogue is not
	 * seeded in that case; its table may not exist yet.
	 */
	upTo?: string;
}

let nextPort = 54_000 + Math.floor(Math.random() * 1000);

export async function startTestDatabase({ upTo }: TestDatabaseOptions = {}): Promise<TestDatabase> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "trackdown-pg-"));
	const port = nextPort++;
	const embedded = new EmbeddedPostgres({
		databaseDir: dir,
		port,
		user: "trackdown",
		password: "trackdown",
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined,
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase("trackdown");

	const url = `postgres://trackdown:trackdown@127.0.0.1:${port}/trackdown`;
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	await runMigrations(client, { log: () => undefined, upTo });
	// Same order as the db:migrate CLI: migrate, then seed. Tests that stop at an older
	// migration skip it, exactly as that older release would have.
	if (!upTo) await seedExercises(client);
	await client.end();

	const pool = new pg.Pool({ connectionString: url });
	return {
		pool,
		url,
		async stop() {
			await pool.end();
			await embedded.stop();
			await rm(dir, { recursive: true, force: true });
		},
	};
}
