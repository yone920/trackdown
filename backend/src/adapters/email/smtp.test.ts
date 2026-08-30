import { afterEach, describe, expect, it, vi } from "vitest";
import { createSmtpEmailer } from "./smtp.js";

const noSmtp = { host: undefined, port: 587, user: undefined, password: undefined, secure: false, from: "TrackDown <noreply@yonelab.net>" } as const;

describe("smtp email adapter", () => {
	afterEach(() => vi.restoreAllMocks());

	it("logs the message instead of throwing when SMTP_HOST is unset", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await createSmtpEmailer(noSmtp).send({ to: "ada@example.com", subject: "Reset your password", text: "link" });
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toContain("ada@example.com");
	});
});
