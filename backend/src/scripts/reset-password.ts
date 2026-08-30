import { createAuth } from "../auth.js";
import { config } from "../config/index.js";
import { pool } from "../db/client.js";
import { setUserPassword } from "../services/password.js";

// npm run reset-password -- <email> <newPassword>
//
// The whole password-recovery story until there is an SMTP server (build-plan WP0a): run
// this on the host that owns the database. It also gives a v1 email-OTP account its first
// password — those users exist but have no credential row yet.

const [email, password] = process.argv.slice(2);

if (!email || !password) {
	console.error("Usage: npm run reset-password -- <email> <newPassword>");
	process.exit(2);
}

const auth = createAuth({
	pool,
	secret: config.auth.secret,
	baseUrl: config.auth.baseUrl,
	trustedOrigins: config.allowedOrigins,
});

try {
	const { account } = await setUserPassword(auth, email, password);
	console.log(
		account === "created"
			? `✅ ${email} now has a password (first one — the account had none).`
			: `✅ Password updated for ${email}.`
	);
} catch (error) {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
