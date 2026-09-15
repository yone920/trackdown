// Matching a spoken exercise name against the catalogue — and, more importantly, refusing to.
//
// The field report this file exists for: "assisted chin up with 55 pounds" was saved as a
// plain **Chin-Up at 55 lb**. The qualifier was dropped on the floor and the meaning
// inverted with it — 55 lb of *help* became 55 lb of *load*, an easier-than-bodyweight rep
// recorded as a much harder one, with a progression that would then push the number the
// wrong way for ever.
//
// So the rule here is narrow and absolute:
//
//   A catalogue match is accepted only when every meaningful word of what the user said is
//   accounted for by the matched entry's own name or one of its aliases — and never when
//   the phrase carries a QUALIFIER the entry does not carry.
//
// A phrase that fails either test is not "close enough"; it is a different movement, and
// the honest thing is to keep the user's words verbatim with no `exercise_id`. Best-effort
// logging already supports exactly that (an activity row may name an exercise the catalogue
// has never heard of), so refusing costs the user nothing and saves them a wrong number.
//
// Everything here is pure: phrases and catalogue rows in, a decision out. `lookupExercises`
// in services/entries.ts is the one caller that talks to the database.

/**
 * The words that make one movement a *different* movement rather than another way of
 * saying the same one. Not an exhaustive taxonomy — an exhaustive one is impossible — but
 * the ones that change what the exercise is, what it loads, or which way its load points.
 *
 * Multi-word qualifiers are written as they read after normalisation ("close-grip" and
 * "close grip" are the same key), and matched as adjacent words.
 */
export const QUALIFIERS: readonly string[] = [
	"assisted",
	"machine assisted",
	"band assisted",
	"banded",
	"weighted",
	"incline",
	"declined",
	"decline",
	"close grip",
	"wide grip",
	"neutral grip",
	"reverse grip",
	"underhand",
	"overhand",
	"single arm",
	"one arm",
	"single leg",
	"one leg",
	"unilateral",
	"seated",
	"standing",
	"kneeling",
	"lying",
	"smith",
	"smith machine",
	"deficit",
	"paused",
	"pause",
	"tempo",
	"eccentric",
	"isometric",
	"suspended",
	"elevated",
	"negative",
];

/** The longest first, so "machine assisted" is read before "assisted". */
const QUALIFIER_PHRASES = [...QUALIFIERS].sort((a, b) => b.split(" ").length - a.split(" ").length);

/**
 * Words that carry no identity: they join a phrase together rather than saying what the
 * movement is. Dropped before the accounting, so "bench press with dumbbells" is not
 * refused over the word "with".
 */
const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"of",
	"on",
	"in",
	"at",
	"to",
	"for",
	"with",
	"my",
	"some",
	"x",
]);

/** Case, punctuation and parenthesised asides gone; "&" spelled out; one space between words. */
export function normalizeExerciseName(name: string): string {
	return name
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/['’]/g, "")
		.replace(/\([^)]*\)/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

/** "chin-ups" and "Chin Up" are the same word list. Empty for an empty phrase. */
export function tokenize(phrase: string): string[] {
	const normalized = normalizeExerciseName(phrase);
	return normalized === "" ? [] : normalized.split(" ");
}

/**
 * A crude singular. Crude on purpose: it is only ever used to build an *extra* key, never
 * to replace one, so "crunches" → "crunche" simply matches nothing and the real alias
 * "crunches" still does the work.
 */
function singular(word: string): string {
	return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The keys one phrase can be found under: as written, and with every word singularised. */
export function phraseKeys(phrase: string): string[] {
	const tokens = tokenize(phrase);
	if (tokens.length === 0) return [];
	const asWritten = tokens.join(" ");
	const singularised = tokens.map(singular).join(" ");
	return singularised === asWritten ? [asWritten] : [asWritten, singularised];
}

/** The qualifiers a phrase carries, as canonical keys. Order follows the phrase. */
export function qualifiersIn(phrase: string): string[] {
	const tokens = tokenize(phrase).map(singular);
	const found: string[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		for (const qualifier of QUALIFIER_PHRASES) {
			const words = qualifier.split(" ");
			if (words.every((word, offset) => tokens[i + offset] === singular(word))) {
				if (!found.includes(qualifier)) found.push(qualifier);
				// Past the whole phrase: "machine assisted" is one qualifier, not two.
				i += words.length - 1;
				break;
			}
		}
	}
	return found;
}

/** What the guard needs from a catalogue row. */
export interface MatchableExercise {
	name: string;
	aliases: readonly string[];
}

/**
 * Every word the entry answers to — its own name and all of its aliases, singularised.
 * The union is what "accounted for" is measured against, because a catalogue entry is the
 * sum of the ways people say it: "dips" is not in "Chest Dip", but it is one of its names.
 */
function vocabularyOf(entry: MatchableExercise): Set<string> {
	const words = new Set<string>();
	for (const phrase of [entry.name, ...entry.aliases]) {
		for (const token of tokenize(phrase)) words.add(singular(token));
	}
	return words;
}

/** The qualifiers an entry itself carries, across its name and every alias. */
function qualifiersOf(entry: MatchableExercise): Set<string> {
	const carried = new Set<string>();
	for (const phrase of [entry.name, ...entry.aliases]) {
		for (const qualifier of qualifiersIn(phrase)) carried.add(qualifier);
	}
	return carried;
}

/**
 * The qualifiers the phrase carries and the entry does not — empty when the entry is a fair
 * answer to those words. Exported on its own because the refinement chip
 * (services/fusion/refine.ts) needs exactly this test and none of the rest: it matches a
 * rambling description loosely on purpose, but it must still never offer to strip an
 * "assisted" off what the user said.
 */
export function missingQualifiers(phrase: string, entry: MatchableExercise): string[] {
	const carried = qualifiersOf(entry);
	return qualifiersIn(phrase).filter((qualifier) => !carried.has(qualifier));
}

export interface QualifierVerdict {
	ok: boolean;
	/** Why it was refused, for the log line and for the test to read. Empty when ok. */
	reason: string;
}

/**
 * The whole rule, in one place. Two ways to fail, and the second is the field report:
 *
 *   1. a word of the phrase the entry answers to under no name at all ("banded" against a
 *      plain Pull-Up);
 *   2. a QUALIFIER the entry does not carry — which is (1) again for the words we know
 *      change the movement, stated separately so it can be refused with a reason and so a
 *      generous alias list can never quietly open the door back up.
 */
export function isQualifierSafeMatch(phrase: string, entry: MatchableExercise): QualifierVerdict {
	const spoken = tokenize(phrase).map(singular).filter((token) => !STOPWORDS.has(token));
	if (spoken.length === 0) return { ok: false, reason: "nothing was said" };

	const vocabulary = vocabularyOf(entry);
	const unaccounted = spoken.filter((token) => !vocabulary.has(token));
	if (unaccounted.length > 0) {
		return { ok: false, reason: `"${entry.name}" does not answer to ${unaccounted.join(", ")}` };
	}

	const missing = missingQualifiers(phrase, entry);
	if (missing.length > 0) {
		return { ok: false, reason: `"${entry.name}" is not ${missing.join(", ")}` };
	}
	return { ok: true, reason: "" };
}

/** An index over the catalogue, built once and asked many times. */
export interface ExerciseIndex<T extends MatchableExercise> {
	find(phrase: string): T | null;
	readonly size: number;
}

/**
 * Build the lookup. Keys are the entry's name and each alias, normalised and singularised;
 * the first entry to claim a key keeps it, so catalogue order breaks a tie the same way
 * every time (the media importer makes the same choice for the same reason).
 *
 * `find` is deliberately not fuzzy. It resolves punctuation, case, word order in the sense
 * that an alias can be written any way round, and plurals — and nothing else. There is no
 * "nearest name", because a nearest name is what saved the user's assisted chin-up as a
 * chin-up. Every hit still has to pass `isQualifierSafeMatch` before it is returned.
 */
export function buildExerciseIndex<T extends MatchableExercise>(entries: readonly T[]): ExerciseIndex<T> {
	const byKey = new Map<string, T>();
	for (const entry of entries) {
		for (const phrase of [entry.name, ...entry.aliases]) {
			for (const key of phraseKeys(phrase)) if (!byKey.has(key)) byKey.set(key, entry);
		}
	}
	return {
		size: byKey.size,
		find(phrase: string): T | null {
			for (const key of phraseKeys(phrase)) {
				const candidate = byKey.get(key);
				if (candidate && isQualifierSafeMatch(phrase, candidate).ok) return candidate;
			}
			return null;
		},
	};
}
