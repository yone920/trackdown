import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import type pg from "pg";

// Better Auth replaces Supabase Auth. v1 used the email-otp plugin to mimic Supabase's
// magic-code sign-in; v2 uses plain email + password (build-plan Decisions table) because
// there is no SMTP server yet and a code that never arrives is not a sign-in flow:
//   POST /api/auth/sign-up/email  { name, email, password }  → session (autoSignIn)
//   POST /api/auth/sign-in/email  { email, password }        → session
//   POST /api/auth/sign-out
// Sessions live in the same Postgres as the app data, so verifying a request is a local
// query. The bearer plugin returns the session token in a `set-auth-token` header and
// accepts it as `Authorization: Bearer …`, which is what a native app wants instead of
// cookies.

/** Mirrored by the app's sign-in screen so the client rejects short passwords first. */
export const MIN_PASSWORD_LENGTH = 8;

export interface AuthDeps {
	pool: pg.Pool;
	secret: string;
	baseUrl: string;
	trustedOrigins: string[];
}

export function createAuth({ pool, secret, baseUrl, trustedOrigins }: AuthDeps) {
	return betterAuth({
		database: pool,
		secret,
		baseURL: baseUrl,
		basePath: "/api/auth",
		trustedOrigins,

		emailAndPassword: {
			enabled: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			// `sendResetPassword` is deliberately unset: without it Better Auth refuses
			// /request-password-reset outright, which is honest while there is no mail
			// server. Recovery is `npm run reset-password -- <email> <password>`
			// (src/scripts/reset-password.ts). Wire it to the EmailPort once SMTP exists.
		},

		// Supabase's handle_new_user trigger created the profiles row on signup; this hook
		// is its replacement. Migrated users already have a profiles row (copied by
		// migrate-from-supabase.ts), and migration inserts bypass this hook anyway.
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await pool.query(
							`INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
							[user.id]
						);
					},
				},
			},
		},

		plugins: [bearer()],
	});
}

export type Auth = ReturnType<typeof createAuth>;
