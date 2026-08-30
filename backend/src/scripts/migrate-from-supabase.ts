import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

/**
 * Copies TrackDown's data out of Supabase into the self-hosted Postgres.
 *
 *   SUPABASE_DB_URL='postgresql://…pooler.supabase.com:5432/postgres?sslmode=no-verify' \
 *   DATABASE_URL='postgres://trackdown:…@127.0.0.1:5433/trackdown' \
 *     npm run db:migrate-from-supabase
 *
 * Same design as My Read Coach's script:
 * - Supabase auth.users UUIDs become Better Auth "user".id verbatim, so every user_id FK
 *   (profiles.id, meals, calorie_expenditure, weight_logs) stays valid without rewriting
 *   a row. Those columns are TEXT in 0002_app_tables.sql, so a UUID string fits.
 * - Nobody has a password (the app only ever used email OTP), so there is no hash to carry
 *   over and no "account" row to create. Users sign in after cutover exactly as before —
 *   with a code emailed to them — just from our SMTP instead of Supabase's.
 * - Idempotent: every write is an upsert keyed on the primary key, so re-running converges.
 *   Rehearse it as often as you like; it never writes to Supabase.
 * - Data tables are copied by introspecting both schemas and moving the intersection of
 *   their columns. Columns that exist only in Supabase are reported as drift, not dropped
 *   silently.
 *
 * Run order matters: users first, then profiles, then the three log tables.
 */

const SOURCE_URL = process.env.SUPABASE_DB_URL;
const TARGET_URL = process.env.DATABASE_URL;

/** Copied after users. Conflict target = primary key column. */
// `target` differs from `table` where our schema renamed one: Supabase still has the
// pre-v2 name (0004_v2.sql renamed calorie_expenditure to activities on our side).
const DATA_TABLES: { table: string; target?: string; pk: string; owner: string }[] = [
	{ table: "profiles", pk: "id", owner: "id" },
	{ table: "meals", pk: "id", owner: "user_id" },
	{ table: "calorie_expenditure", target: "activities", pk: "id", owner: "user_id" },
	{ table: "weight_logs", pk: "id", owner: "user_id" },
	{ table: "daily_summaries", pk: "user_id,date", owner: "user_id" },
];

const BATCH_SIZE = 250;

interface Column {
	name: string;
	dataType: string;
}

function requireEnv(): { source: string; target: string } {
	if (!SOURCE_URL || !TARGET_URL) {
		console.error(
			"❌ Both SUPABASE_DB_URL (source) and DATABASE_URL (target) must be set.\n" +
				"   SUPABASE_DB_URL: Supabase dashboard > Connect > Session pooler.\n" +
				"     Use the pooler host (direct hosts are IPv6-only) and end the URI with\n" +
				"     `?sslmode=no-verify` — node-postgres reads `require` as `verify-full`,\n" +
				"     which rejects Supabase's certificate chain.\n" +
				"   DATABASE_URL:    the self-hosted Postgres to load into (migrations already applied)"
		);
		process.exit(1);
	}
	if (SOURCE_URL === TARGET_URL) {
		console.error("❌ SUPABASE_DB_URL and DATABASE_URL point at the same database. Refusing to run.");
		process.exit(1);
	}
	return { source: SOURCE_URL, target: TARGET_URL };
}

async function columnsOf(client: pg.Client, table: string, schema = "public"): Promise<Column[] | null> {
	const { rows } = await client.query<{ column_name: string; data_type: string }>(
		`SELECT column_name, data_type FROM information_schema.columns
		 WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
		[schema, table]
	);
	return rows.length > 0 ? rows.map((r) => ({ name: r.column_name, dataType: r.data_type })) : null;
}

function quote(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

function bindValue(value: unknown, dataType: string): unknown {
	if (value === null || value === undefined) return null;
	if (dataType === "json" || dataType === "jsonb") return typeof value === "string" ? value : JSON.stringify(value);
	return value;
}

async function countRows(client: pg.Client, table: string, schema = "public"): Promise<number> {
	const { rows } = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quote(schema)}.${quote(table)}`);
	return Number(rows[0]!.count);
}

async function upsertBatched(
	target: pg.Client,
	table: string,
	columns: Column[],
	rows: Record<string, unknown>[],
	conflictTarget: string
): Promise<void> {
	if (rows.length === 0) return;
	const pkCols = conflictTarget.split(",").map((c) => c.trim());
	const updatable = columns.filter((c) => !pkCols.includes(c.name));
	const setClause = updatable.length > 0 ? updatable.map((c) => `${quote(c.name)} = EXCLUDED.${quote(c.name)}`).join(", ") : null;

	for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
		const batch = rows.slice(offset, offset + BATCH_SIZE);
		const params: unknown[] = [];
		const tuples = batch.map((row) => {
			const placeholders = columns.map((column) => {
				params.push(bindValue(row[column.name], column.dataType));
				return `$${params.length}`;
			});
			return `(${placeholders.join(", ")})`;
		});
		await target.query(
			`INSERT INTO ${quote(table)} (${columns.map((c) => quote(c.name)).join(", ")})
			 VALUES ${tuples.join(", ")}
			 ON CONFLICT (${pkCols.map(quote).join(", ")}) ${setClause ? `DO UPDATE SET ${setClause}` : "DO NOTHING"}`,
			params
		);
	}
}

interface SupabaseUser {
	id: string;
	email: string | null;
	email_confirmed_at: string | null;
	created_at: string | null;
	last_sign_in_at: string | null;
}

async function migrateUsers(source: pg.Client, target: pg.Client) {
	const { rows } = await source.query<SupabaseUser>(
		`SELECT id::text AS id, email, email_confirmed_at, created_at, last_sign_in_at
		 FROM auth.users WHERE deleted_at IS NULL ORDER BY created_at`
	);
	const skipped: string[] = [];
	const migrated = new Set<string>();
	for (const user of rows) {
		if (!user.email) {
			skipped.push(user.id);
			continue;
		}
		await target.query(
			`INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
			 VALUES ($1, $2, $3, $4, $5, $5)
			 ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "emailVerified" = EXCLUDED."emailVerified"`,
			[user.id, "", user.email.toLowerCase(), Boolean(user.email_confirmed_at), user.created_at ?? new Date().toISOString()]
		);
		migrated.add(user.id);
	}
	return { total: rows.length, migrated, skipped };
}

async function main(): Promise<void> {
	const { source: sourceUrl, target: targetUrl } = requireEnv();
	const source = new pg.Client({ connectionString: sourceUrl });
	const target = new pg.Client({ connectionString: targetUrl });
	await source.connect();
	await target.connect();

	try {
		await target.query("BEGIN");

		console.log("👤 auth.users → \"user\"");
		const users = await migrateUsers(source, target);
		console.log(`   ${users.migrated.size}/${users.total} migrated${users.skipped.length ? `, skipped (no email): ${users.skipped.join(", ")}` : ""}`);

		const report: { table: string; source: number; copied: number; orphans: number; note?: string }[] = [];

		for (const { table, target: targetTable = table, pk, owner } of DATA_TABLES) {
			const sourceCols = await columnsOf(source, table);
			const targetCols = await columnsOf(target, targetTable);
			if (!sourceCols) {
				report.push({ table, source: 0, copied: 0, orphans: 0, note: "not in Supabase, skipped" });
				continue;
			}
			if (!targetCols) throw new Error(`Target is missing table ${targetTable} — run npm run db:migrate first`);

			const targetNames = new Set(targetCols.map((c) => c.name));
			const shared = targetCols.filter((c) => sourceCols.some((s) => s.name === c.name));
			const drift = sourceCols.filter((c) => !targetNames.has(c.name)).map((c) => c.name);
			if (drift.length > 0) {
				console.warn(`⚠️  ${table}: columns in Supabase but not in our migrations (data NOT copied): ${drift.join(", ")}`);
			}

			const selectList = sourceCols
				.filter((c) => targetNames.has(c.name))
				.map((c) => (c.dataType === "uuid" && (c.name === owner) ? `${quote(c.name)}::text AS ${quote(c.name)}` : quote(c.name)))
				.join(", ");
			const { rows } = await source.query<Record<string, unknown>>(`SELECT ${selectList} FROM ${quote(table)}`);
			const kept = rows.filter((row) => users.migrated.has(String(row[owner])));
			const orphans = rows.length - kept.length;
			if (orphans > 0) console.warn(`⚠️  ${table}: ${orphans} row(s) belong to deleted users, skipped`);

			await upsertBatched(target, targetTable, shared, kept, pk);
			report.push({ table: targetTable, source: rows.length, copied: kept.length, orphans });
		}

		await target.query("COMMIT");

		console.log("\n📊 Row counts (source → target)");
		for (const r of report) {
			const targetCount = r.note ? 0 : await countRows(target, r.table);
			const ok = r.note || targetCount >= r.copied ? "✅" : "❌";
			console.log(`   ${ok} ${r.table.padEnd(20)} ${String(r.source).padStart(6)} → ${String(targetCount).padStart(6)}${r.orphans ? `  (${r.orphans} orphan(s) skipped)` : ""}${r.note ? `  ${r.note}` : ""}`);
		}
		console.log("\n✅ Done. Supabase was only read from; it is still the system of record until you say otherwise.");
	} catch (error) {
		await target.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await source.end();
		await target.end();
	}
}

main().catch((error) => {
	console.error("❌ Migration failed (target rolled back):", error);
	process.exit(1);
});
