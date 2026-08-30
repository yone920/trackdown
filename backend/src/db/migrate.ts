import pg from "pg";
import { config } from "../config/index.js";
import { describeTarget } from "./client.js";
import { seedExercises } from "./exercises.js";
import { runMigrations } from "./migrations.js";

// CLI entry: `npm run db:migrate` (uses DATABASE_URL, or the dev-compose default).
// Seeding the exercise catalogue is part of migrating: an empty catalogue would make the
// fusion prompt and the coach silently worse rather than fail, so it must never be a
// step someone can forget. Both halves are idempotent, so re-running is a no-op.

async function main(): Promise<void> {
	console.log(`🗄️  Migrating ${describeTarget(config.databaseUrl)}`);
	const client = new pg.Client({ connectionString: config.databaseUrl });
	await client.connect();
	try {
		const report = await runMigrations(client);
		console.log(
			report.applied.length > 0
				? `✅ Applied ${report.applied.length} migration(s), ${report.total} total`
				: `✅ Database is up to date (${report.total} migrations)`
		);
		const seeded = await seedExercises(client);
		console.log(`🏋️  Exercise catalogue: ${seeded.total} exercises (${seeded.inserted} new)`);
	} finally {
		await client.end();
	}
}

main().catch((error) => {
	console.error("❌ Migration run failed:", error);
	process.exit(1);
});
