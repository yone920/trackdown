import { createLocalAccountIssuer } from "@better-auth/core/db";
import type { Auth } from "../auth.js";

// Setting a password without an email round-trip. There is no SMTP server yet, so Better
// Auth's /request-password-reset (which needs `sendResetPassword`) is switched off and this
// is the recovery path: an operator on the host runs `npm run reset-password`.
//
// Everything here goes through Better Auth's own context — `password.hash` is the exact
// hasher the sign-in route verifies with, and `internalAdapter` writes the account row the
// same way /reset-password does. Hand-rolling scrypt/bcrypt here would produce hashes the
// sign-in route cannot read.

export type SetPasswordResult = { userId: string; account: "created" | "updated" };

export async function setUserPassword(auth: Auth, email: string, password: string): Promise<SetPasswordResult> {
	const ctx = await auth.$context;

	const { minPasswordLength, maxPasswordLength } = ctx.password.config;
	if (password.length < minPasswordLength) {
		throw new Error(`Password must be at least ${minPasswordLength} characters.`);
	}
	if (password.length > maxPasswordLength) {
		throw new Error(`Password must be at most ${maxPasswordLength} characters.`);
	}

	const found = await ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase());
	if (!found) {
		throw new Error(`No account with the email ${email}. Sign up in the app first.`);
	}
	const userId = found.user.id;
	const hash = await ctx.password.hash(password);

	// Users created by v1's email-OTP flow have no credential account at all, so the
	// account row has to be created rather than updated — the same branch /reset-password
	// takes for an OAuth-only user who is setting a password for the first time.
	const credential = await ctx.internalAdapter.findCredentialAccount(userId);
	if (credential) {
		await ctx.internalAdapter.updatePassword(userId, hash);
		return { userId, account: "updated" };
	}

	await ctx.internalAdapter.createAccount({
		userId,
		providerId: "credential",
		issuer: createLocalAccountIssuer("credential"),
		accountId: userId,
		password: hash,
	});
	return { userId, account: "created" };
}
