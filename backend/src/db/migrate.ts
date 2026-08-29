import pg from "pg";
import { config } from "../config/index.js";
import { describeTarget } from "./client.js";
import { runMigrations } from "./migrations.js";

// CLI entry: `npm run db:migrate` (uses DATABASE_URL, or the dev-compose default).

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
	} finally {
		await client.end();
	}
}

main().catch((error) => {
	console.error("❌ Migration run failed:", error);
	process.exit(1);
});
