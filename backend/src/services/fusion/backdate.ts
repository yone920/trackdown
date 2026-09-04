// "Two scoops of ice cream yesterday" — reading the day out of what was said.
//
// Until now every log landed on the day it was typed. A person who forgot to log Tuesday's
// dinner had no way to put it on Tuesday: the reader had no field for a date, and the app
// never sent one, so "yesterday" was a word that fell on the floor and the ice cream went
// on today (field report 2026-09-04).
//
// **This is code, not a model field.** The routing schema is at a grammar ceiling that a new
// field can only pass by trading an old one out (services/fusion/schema.ts §The ceiling is a
// field count), and asking a language model to do date arithmetic is the wrong tool anyway.
// The vocabulary people actually use for "not now" is small, closed, and every bit as
// checkable as 4·protein + 4·carbs + 9·fat. So it is checked here, deterministically, from
// the same text the reader saw.
//
// What it never does is decide. A backdate is an OFFER: the confirm card names the day it
// read and the user keeps it or puts it back on today (concept-v2 §Principles 3 — confirm,
// don't trust). That matters more here than for most readings, because the failure mode is
// silent — a meal filed on the wrong day is invisible until a week's totals look wrong.

/** How far back a phrase can reach. A fortnight is the window the Progress strip draws. */
export const MAX_DAYS_AGO = 14;

export interface Backdate {
	/** Whole days before the user's today. Always ≥ 1: today is not a backdate. */
	days_ago: number;
	/** The words that said so, as they were said — the card quotes them back. */
	phrase: string;
}

const WEEKDAYS = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
] as const;

/** Spelled-out counts, for "three days ago". Past ten nobody spells it. */
const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

/**
 * Phrases that name a day outright, in the order they must be tried: "the day before
 * yesterday" has to beat "yesterday", which is inside it.
 */
const PHRASES: readonly { pattern: RegExp; days: number }[] = [
	{ pattern: /\bday before yesterday\b/i, days: 2 },
	{ pattern: /\byesterday\b/i, days: 1 },
	{ pattern: /\blast night\b/i, days: 1 },
];

/**
 * The day a sentence is about, or null for one that is about now.
 *
 * `weekdayIndex` is the user's local day of the week (0 = Sunday), because "on Saturday"
 * only means something relative to what today is.
 */
export function readBackdate(text: string | null | undefined, weekdayIndex: number): Backdate | null {
	const said = (text ?? "").trim();
	if (!said) return null;

	// A question about a past day is not a log filed on it: "what did I eat yesterday" is
	// asking, and dating the answer to yesterday would be answering something else.
	if (/^\s*(what|when|how|did|was|were|do|does|is|are|show|tell)\b/i.test(said)) return null;

	for (const { pattern, days } of PHRASES) {
		const found = said.match(pattern);
		if (found) return { days_ago: days, phrase: found[0].toLowerCase() };
	}

	// "3 days ago", "three days ago". Also "a couple of days ago", which is two.
	const counted = said.match(/\b(\d{1,2}|[a-z]+)\s+days?\s+ago\b/i);
	if (counted) {
		const word = counted[1]!.toLowerCase();
		const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
		if (n != null && n >= 1 && n <= MAX_DAYS_AGO) {
			return { days_ago: n, phrase: counted[0].toLowerCase() };
		}
		// "a few days ago" names no number, so there is no day to file it on.
		return null;
	}

	// "on Saturday", "last Saturday" — the most recent one that has already happened. Today's
	// own weekday is NOT a backdate: "I trained Thursday" said on a Thursday means today.
	const named = said.match(
		/\b(?:last\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
	);
	if (named) {
		const target = WEEKDAYS.indexOf(named[1]!.toLowerCase() as (typeof WEEKDAYS)[number]);
		const back = (weekdayIndex - target + 7) % 7;
		if (back === 0) return null;
		return { days_ago: back, phrase: named[0].toLowerCase() };
	}

	return null;
}

/** `date` minus `days`, as a YYYY-MM-DD local date key. */
export function shiftDate(localDate: string, days: number): string {
	const [y, m, d] = localDate.split("-").map(Number);
	// UTC arithmetic on a date-only value: no zone, so no hour can push it over a boundary.
	const at = new Date(Date.UTC(y!, m! - 1, d!));
	at.setUTCDate(at.getUTCDate() - days);
	return at.toISOString().slice(0, 10);
}

/** How the card says it: "yesterday · Wed 3 Sep". */
export function backdateLabel(days: number): string {
	if (days === 1) return "yesterday";
	return `${days} days ago`;
}
