import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_EDGE_PX, downscaleImage, isAcceptedUploadMime, parseExerciseMediaWidth, resizeToWidth } from "./images.js";

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

describe("parseExerciseMediaWidth", () => {
	it("takes the three widths we serve and nothing else", () => {
		expect(parseExerciseMediaWidth("320")).toBe(320);
		expect(parseExerciseMediaWidth("640")).toBe(640);
		expect(parseExerciseMediaWidth("1280")).toBe(1280);
	});

	it("says 'no width asked for' only when the parameter is absent", () => {
		// undefined is "serve the original"; everything else that is not one of ours is a
		// mistake worth a 400, because a client asking for 640 and silently getting four
		// megabytes is the bug the parameter exists to fix.
		expect(parseExerciseMediaWidth(undefined)).toBeUndefined();
		for (const value of ["", "0", "-320", "500", "640px", "abc", ["640"], 640]) {
			expect(parseExerciseMediaWidth(value)).toBeNull();
		}
	});
});

describe("resizeToWidth", () => {
	it("narrows to the width asked for and keeps the aspect ratio", async () => {
		const out = await resizeToWidth(await png(900, 600), 320);
		expect(await sharp(out).metadata()).toMatchObject({ format: "jpeg", width: 320, height: 213 });
	});

	it("never enlarges — a frame smaller than the ask is already the answer", async () => {
		const out = await resizeToWidth(await png(240, 160), 640);
		expect((await sharp(out).metadata()).width).toBe(240);
	});

	it("throws on bytes that are not an image, so the route can serve the original", async () => {
		await expect(resizeToWidth(Buffer.from("frame-zero"), 640)).rejects.toThrow();
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
