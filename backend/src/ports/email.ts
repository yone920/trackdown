// Transactional email, as the rest of the backend sees it. No provider details leak past
// this interface: adapters/email/* implement it (SMTP today, anything later), and nothing
// outside adapters/** may import a mail SDK — see backend/eslint.config.js.

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface EmailPort {
	send(message: EmailMessage): Promise<void>;
}
