import pg from "pg";
import { config } from "../config/index.js";
import { describeTarget } from "../db/client.js";
import { seedExercises } from "../db/exercises.js";

// CLI entry: `npm run db:seed-exercises`.
//
// `npm run db:migrate` already does this; this script exists for the case where only the
// JSON changed — a new exercise, a new alias — and there is no migration to run. Upsert by
// name, so it converges rather than duplicating.

async function main(): Promise<void> {
	console.log(`🏋️  Seeding the exercise catalogue into ${describeTarget(config.databaseUrl)}`);
	const client = new pg.Client({ connectionString: config.databaseUrl });
	await client.connect();
	try {
		const report = await seedExercises(client);
		console.log(`✅ ${report.total} exercises: ${report.inserted} new, ${report.updated} refreshed`);
	} finally {
		await client.end();
	}
}

main().catch((error) => {
	console.error("❌ Seeding the exercise catalogue failed:", error);
	process.exit(1);
});
