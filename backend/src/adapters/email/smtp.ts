import nodemailer from "nodemailer";
import type { Config } from "../../config/index.js";
import type { EmailPort } from "../../ports/email.js";

// SMTP adapter for EmailPort. SMTP is optional: without SMTP_HOST the message is logged
// to the backend console instead of sent, so local dev never needs a mail server and a
// forgotten production setting shows up as a visible log line rather than a crash.
//
// Nothing sends mail yet — v1's only email was the sign-in code, and v2 signs in with a
// password (src/auth.ts). The port stays so password-reset emails have somewhere to land
// once there is an SMTP server; until then recovery is `npm run reset-password`.

export function createSmtpEmailer(smtp: Config["smtp"]): EmailPort {
	const transporter = smtp.host
		? nodemailer.createTransport({
				host: smtp.host,
				port: smtp.port,
				secure: smtp.secure,
				auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
			})
		: null;

	return {
		async send({ to, subject, text, html }) {
			if (!transporter) {
				console.log(`📧 [email not sent — SMTP_HOST is unset]\n   to: ${to}\n   subject: ${subject}\n   ${text}`);
				return;
			}
			try {
				await transporter.sendMail({ from: smtp.from, to, subject, text, html });
				console.log(`✅ Sent "${subject}" to ${to}`);
			} catch (error) {
				console.error(`❌ Failed to send "${subject}" to ${to}:`, error);
				throw error;
			}
		},
	};
}
