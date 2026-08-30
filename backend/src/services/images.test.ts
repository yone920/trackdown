import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_EDGE_PX, downscaleImage, isAcceptedUploadMime } from "./images.js";

// The server-side safety net. The phone already downscales; this is what happens when
// something uploads a full-size original anyway.

function png(width: number, height: number): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
	})
		.png()
		.toBuffer();
}

describe("downscaleImage", () => {
	it("fits the longest edge to the limit and keeps the aspect ratio", async () => {
		const result = await downscaleImage(await png(2400, 1200));
		expect(result).toMatchObject({ mime: "image/jpeg", extension: "jpg", width: MAX_EDGE_PX, height: 800 });
		expect(await sharp(result.data).metadata()).toMatchObject({ format: "jpeg", width: MAX_EDGE_PX, height: 800 });
	});

	it("leaves a small image its own size but still re-encodes it", async () => {
		const result = await downscaleImage(await png(120, 60));
		expect(result).toMatchObject({ width: 120, height: 60, mime: "image/jpeg" });
		// Re-encoding is not busywork: it is what drops the EXIF, and with it the GPS
		// coordinates of the user's gym.
		expect((await sharp(result.data).metadata()).exif).toBeUndefined();
	});

	it("rejects bytes that are not an image", async () => {
		await expect(downscaleImage(Buffer.from("this is a text file"))).rejects.toThrow();
	});
});

describe("isAcceptedUploadMime", () => {
	it("takes what a phone or a browser sends, and nothing else", () => {
		for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "IMAGE/JPEG"]) {
			expect(isAcceptedUploadMime(mime)).toBe(true);
		}
		for (const mime of ["application/pdf", "text/plain", "video/mp4", "image/svg+xml"]) {
			expect(isAcceptedUploadMime(mime)).toBe(false);
		}
	});
});
