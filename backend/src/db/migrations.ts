import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

// Ordered-SQL migration runner. Applies backend/migrations/*.sql in filename order and
// records applied files in schema_migrations, so re-runs are no-ops. A Postgres advisory
// lock prevents two runners from racing.

export const MIGRATIONS_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../migrations"
);

const ADVISORY_LOCK_ID = 2026_0828;

export interface MigrationReport {
	applied: string[];
	total: number;
}

export interface MigrationOptions {
	log?: (message: string) => void;
	/**
	 * Stop after this filename (inclusive), e.g. "0003_account_issuer.sql". Tests use it
	 * to build a database at an older schema version and then migrate it forward with
	 * real data in it — the case a fresh-database test can never cover.
	 */
	upTo?: string;
}

export async function runMigrations(
	client: pg.Client | pg.PoolClient,
	{ log = console.log, upTo }: MigrationOptions = {}
): Promise<MigrationReport> {
	await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);
	try {
		await client.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name TEXT PRIMARY KEY,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);

		const all = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
		if (upTo && !all.includes(upTo)) throw new Error(`No migration named ${upTo} in ${MIGRATIONS_DIR}`);
		const files = upTo ? all.filter((f) => f <= upTo) : all;
		const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
		const alreadyApplied = new Set(rows.map((row) => row.name));

		const applied: string[] = [];
		for (const file of files) {
			if (alreadyApplied.has(file)) {
				log(`⏭️  ${file} (already applied)`);
				continue;
			}
			const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
			await client.query("BEGIN");
			try {
				await client.query(sql);
				await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				log(`❌ ${file} failed, rolled back`);
				throw error;
			}
			log(`✅ ${file}`);
			applied.push(file);
		}
		return { applied, total: files.length };
	} finally {
		await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
	}
}
