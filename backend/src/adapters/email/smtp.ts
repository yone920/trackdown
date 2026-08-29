import nodemailer from "nodemailer";
import type { Config } from "../../config/index.js";

// Transactional email for the sign-in code. SMTP is optional: without SMTP_HOST the
// code is logged to the console instead of sent, which is how sign-in is exercised in
// local dev. In production config/index.ts does not require SMTP either — deliberately,
// so a missing mail server shows up as "no email arrived" in the smoke test rather than
// a refused boot; the console log makes the cause obvious.

export type SendOtp = (data: { email: string; otp: string }) => Promise<void>;

export function createSmtpOtpSender(smtp: Config["smtp"]): SendOtp {
	const transporter = smtp.host
		? nodemailer.createTransport({
				host: smtp.host,
				port: smtp.port,
				secure: smtp.secure,
				auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
			})
		: null;

	if (!transporter) {
		console.warn("⚠️  SMTP_HOST is unset — sign-in codes will be logged to the console, not emailed");
	}

	return async ({ email, otp }) => {
		const subject = `${otp} is your TrackDown sign-in code`;
		const text = `Your TrackDown sign-in code is ${otp}.\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`;
		const html = `<p>Your TrackDown sign-in code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:600">${otp}</p><p>It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`;

		if (!transporter) {
			console.log(`📧 [email not sent — no SMTP configured]\n   to: ${email}\n   code: ${otp}`);
			return;
		}
		try {
			await transporter.sendMail({ from: smtp.from, to: email, subject, text, html });
			console.log(`✅ Sent sign-in code to ${email}`);
		} catch (error) {
			console.error(`❌ Failed to send sign-in code to ${email}:`, error);
			throw error;
		}
	};
}
