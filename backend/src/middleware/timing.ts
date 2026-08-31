import type { NextFunction, Request, Response } from "express";

// Server-Timing, so "the app feels slow" can be answered with a number instead of a guess.
//
// Every request is stamped when it arrives; a route or a middleware can name the phases it
// cares about, and the header goes out as
//
//   Server-Timing: auth;dur=41.2, db;dur=3.1, open;dur=0.4, total;dur=45.0
//
// which curl (`-w '%{time_total}'` plus `-D-`) and every browser's network panel read
// directly. `total` is the time up to the moment the header is written, so for a streamed
// response it is the time to first byte and not the transfer — the transfer is what the
// client's own timing already measures.
//
// It is deliberately not a global response hook: a header on every route would say almost
// nothing, and the two routes the phone waits on (the exercise sheet and its frames) are
// where the question actually is.

export interface TimedRequest extends Request {
	/** Milliseconds per named phase, in the order they finished. */
	timings?: [string, number][];
	/** `performance.now()` when the request arrived. */
	timingStart?: number;
}

/** Stamps the arrival time. Mounted first, so `total` covers the whole stack. */
export function beginTiming(req: Request, _res: Response, next: NextFunction): void {
	const timed = req as TimedRequest;
	timed.timingStart = performance.now();
	timed.timings = [];
	next();
}

/** Runs `work`, and records how long it took under `name`. Failures are timed too. */
export async function timePhase<T>(req: Request, name: string, work: () => Promise<T>): Promise<T> {
	const started = performance.now();
	try {
		return await work();
	} finally {
		(req as TimedRequest).timings?.push([name, performance.now() - started]);
	}
}

/**
 * Writes the header. Call it before the body starts — for a streamed response that means
 * before the pipe, which is also the only moment it can still be set.
 */
export function setServerTiming(req: Request, res: Response): void {
	if (res.headersSent) return;
	const timed = req as TimedRequest;
	const parts = (timed.timings ?? []).map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`);
	if (timed.timingStart !== undefined) {
		parts.push(`total;dur=${(performance.now() - timed.timingStart).toFixed(1)}`);
	}
	if (parts.length > 0) res.setHeader("Server-Timing", parts.join(", "));
}
