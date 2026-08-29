import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import type pg from "pg";
import type { SendOtp } from "./adapters/email/smtp.js";

// Better Auth replaces Supabase Auth. The app signed in with Supabase's email OTP
// (signInWithOtp + verifyOtp, 6-digit code, user auto-created) — the email-otp plugin
// reproduces exactly that flow:
//   POST /api/auth/email-otp/send-verification-otp  { email, type: "sign-in" }
//   POST /api/auth/sign-in/email-otp                { email, otp }
// Sessions live in the same Postgres as the app data, so verifying a request is a local
// query. The bearer plugin returns the session token in a `set-auth-token` header and
// accepts it as `Authorization: Bearer …`, which is what a native app wants instead of
// cookies.

export interface AuthDeps {
	pool: pg.Pool;
	secret: string;
	baseUrl: string;
	trustedOrigins: string[];
	sendOtp: SendOtp;
}

export function createAuth({ pool, secret, baseUrl, trustedOrigins, sendOtp }: AuthDeps) {
	return betterAuth({
		database: pool,
		secret,
		baseURL: baseUrl,
		basePath: "/api/auth",
		trustedOrigins,

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

		plugins: [
			emailOTP({
				otpLength: 6,
				expiresIn: 60 * 10,
				allowedAttempts: 5,
				sendVerificationOTP: async ({ email, otp, type }) => {
					// Only sign-in codes exist in this app; the other types are unreachable
					// because email/password auth is not enabled.
					if (type !== "sign-in") return;
					await sendOtp({ email, otp });
				},
			}),
			bearer(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
