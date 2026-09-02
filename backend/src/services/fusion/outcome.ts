import { classifyProviderError, describeProviderError } from "../llmErrors.js";
import type { FusionResult } from "./schema.js";

// What a reading DID, said out loud in the server log.
//
// Field bug 2026-09-02: a user typed "I just the same bawl of the lunch I had earlier",
// tapped Log, and nothing happened — no review card, no error, no question, their words
// still in the box. The server log had one `fusion.route` cache line and then silence, so
// there was no way to tell from the outside whether the model had answered, what it had
// answered, or where the request had stopped.
//
// **The diagnosis gap is the bug.** A log attempt is the one thing in this app that must
// never be undiagnosable afterwards: it is the user's own words going in, and if they
// vanish there has to be a line saying where. So every analyze and every parse now ends
// with exactly one line — what came back, how many parts and of what kinds, and how long it
// took — and every failure ends with one naming its class.
//
// **No user content.** Kinds, counts and milliseconds; never the sentence, never a meal's
// description, never a question's text. The words belong to the user; the SHAPE of what
// happened to them is what an operator needs.

/** "meal×1, activities×2" — the parts, counted by kind, in a stable order. */
export function kindsOf(results: readonly FusionResult[]): string {
	const counts = new Map<string, number>();
	for (const result of results) counts.set(result.kind, (counts.get(result.kind) ?? 0) + 1);
	return (
		[...counts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([kind, count]) => (count === 1 ? kind : `${kind}×${count}`))
			.join(", ") || "nothing"
	);
}

export interface OutcomeFacts {
	/** "analyze", "revise", "parse-log" — which door this was. */
	where: string;
	results: readonly FusionResult[];
	ms: number;
	/** Photos that arrived with it; the count only. */
	photos?: number;
	/** True when the router asked a question rather than reading a record. */
	unclear?: boolean;
}

/**
 * One line per finished reading. `info` because this is the normal case: the whole point is
 * that a *successful* log leaves a trace too, so "nothing happened" can be told apart from
 * "something happened and the phone did not draw it".
 */
export function logOutcome({ where, results, ms, photos = 0, unclear }: OutcomeFacts): void {
	const parts = results.length;
	const asked = unclear ?? results.some((result) => result.kind === "unclear");
	console.info(
		`📖 ${where}: ${parts} part${parts === 1 ? "" : "s"} (${kindsOf(results)})` +
			`${asked ? " · asked a question" : ""}${photos > 0 ? ` · ${photos} photo${photos === 1 ? "" : "s"}` : ""}` +
			` · ${ms.toFixed(0)}ms`
	);
	// The shape that should not be reachable: a 200 with nothing in it and nothing asked.
	// The client cannot draw it and the user sees their words sit there (routes/fusion.ts
	// refuses to send it now; this line is here for the day something else produces one).
	if (parts === 0 && !asked) {
		console.error(`❌ ${where}: read nothing and asked nothing — the caller has nothing to draw.`);
	}
}

/** One line per failed reading, with the class the policy gave it. */
export function logFailure(where: string, error: unknown, ms: number): void {
	console.error(
		`❌ ${where} failed after ${ms.toFixed(0)}ms: code=${classifyProviderError(error)} · ${describeProviderError(error)}`
	);
}
