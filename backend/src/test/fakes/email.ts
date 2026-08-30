import type { EmailMessage, EmailPort } from "../../ports/email.js";

export interface FakeEmailer extends EmailPort {
	/** Everything "sent", oldest first. */
	readonly sent: EmailMessage[];
}

export function createFakeEmailer(): FakeEmailer {
	const sent: EmailMessage[] = [];
	return {
		sent,
		async send(message) {
			sent.push(message);
		},
	};
}
