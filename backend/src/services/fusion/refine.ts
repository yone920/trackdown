import type { ActivityItem, Refinement } from "./schema.js";

// "Was it a Chest-Supported Row?" — the one-tap upgrade from a movement the user could only
// describe to the movement the catalogue knows.
//
// Why it is computed here and not asked of the model: the routing union pays for a new field
// by giving up an old one (see schema.ts), and `equipment` had already spent that budget.
// This one is affordable anyway — the model has been given the whole catalogue in its prompt,
// so if it could name the movement it did, and `exercise` resolves on save. This function is
// for the other case, where it kept the user's own words because it was not sure, and it
// answers a narrower question than the model was asked: *which catalogue entry do those words
// most look like?*
//
// The rules it follows, in one paragraph. Match the words the user was left with (the
// exercise as kept, the machine they named, and the description) against every catalogue
// name and alias, token by token, after stemming off the endings English throws around
// ("inclined" and "incline" are the same word to a gym). Generic gym vocabulary — machine,
// weight, exercise, press-as-in-"press it up" — scores nothing on its own, because every
// entry in the catalogue would match it. Two shared distinctive tokens is an offer; one is
// not, unless it is the whole of a two-word name. A tie is silence: a leading question with
// two right answers is worse than no question.

/** Words that separate nothing: they appear in the description of half the catalogue. */
const STOPWORDS = new Set([
	"a", "an", "and", "the", "with", "for", "on", "in", "at", "of", "to", "up", "down", "my",
	"it", "is", "was", "i", "did", "do", "some", "that", "this", "from", "by", "into",
	"machine", "machines", "exercise", "exercises", "movement", "gym", "workout", "set",
	"sets", "rep", "reps", "lb", "lbs", "pound", "pounds", "weight", "weights",
	"thing", "called", "know", "dont", "don", "like", "one", "other", "using", "use", "used",
	"what", "whats", "which", "how", "when", "where", "who", "why", "not", "cant", "didnt",
	"something", "sort", "kind", "any", "there", "here", "then", "them", "you", "your",
]);

/**
 * Crude, deliberate stemming: only the endings that make one gym word look like two.
 * "inclined" → "inclin", "rows" → "row", "pulling" → "pull". Nothing clever, because a
 * clever stemmer here would start matching "presses" to "pressure".
 */
export function stem(word: string): string {
	const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (w.length <= 3) return w;
	for (const ending of ["ing", "ed", "es", "s", "e"]) {
		if (w.endsWith(ending) && w.length - ending.length >= 3) return w.slice(0, w.length - ending.length);
	}
	return w;
}

/** The distinctive stems in a phrase, in no particular order and without repeats. */
export function tokens(phrase: string): Set<string> {
	const out = new Set<string>();
	for (const raw of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
		if (!raw || STOPWORDS.has(raw)) continue;
		const stemmed = stem(raw);
		if (stemmed.length >= 3 && !STOPWORDS.has(stemmed)) out.add(stemmed);
	}
	return out;
}

export interface RefineCandidate {
	name: string;
	aliases: string[];
}

/** Every phrase an entry answers to, canonical name first. */
function phrasesOf(entry: RefineCandidate): string[] {
	return [entry.name, ...entry.aliases];
}

/** Does the user's phrase name this entry outright? Then there is nothing to refine. */
export function namesExactly(said: string, catalog: readonly RefineCandidate[]): boolean {
	const needle = said.trim().toLowerCase();
	if (needle === "") return false;
	return catalog.some((entry) => phrasesOf(entry).some((phrase) => phrase.trim().toLowerCase() === needle));
}

/**
 * How much the words look like one catalogue entry: the best score over its name and its
 * aliases, where a score is the number of distinctive stems the two share, and a phrase the
 * user matched *entirely* ("seal row" against the alias "seal row") counts double so a short
 * exact-ish alias beats a long partial name.
 */
export function scoreEntry(said: Set<string>, entry: RefineCandidate): number {
	let best = 0;
	for (const phrase of phrasesOf(entry)) {
		const theirs = tokens(phrase);
		if (theirs.size === 0) continue;
		let shared = 0;
		for (const token of theirs) if (said.has(token)) shared += 1;
		const score = shared === theirs.size ? shared * 2 : shared;
		if (score > best) best = score;
	}
	return best;
}

/** Two distinctive words in common, or one that is the whole of the name it came from. */
const MIN_SCORE = 2;

export interface SuggestOptions {
	/** Everything the user's own words left us with, most specific first. */
	said: readonly (string | null | undefined)[];
	catalog: readonly RefineCandidate[];
}

/**
 * The catalogue entry those words most look like, or null. Null is the normal answer and
 * costs nothing: the record saves either way.
 */
export function bestCandidate({ said, catalog }: SuggestOptions): string | null {
	const words = tokens(said.filter((part): part is string => Boolean(part && part.trim())).join(" "));
	if (words.size === 0) return null;

	let best: { name: string; score: number } | null = null;
	let tied = false;
	for (const entry of catalog) {
		const score = scoreEntry(words, entry);
		if (score < MIN_SCORE) continue;
		if (!best || score > best.score) {
			best = { name: entry.name, score };
			tied = false;
		} else if (score === best.score && entry.name !== best.name) {
			tied = true;
		}
	}
	// A tie means the words fit two movements equally well, and asking "was it X?" when it
	// was just as likely Y is a question that teaches the user not to trust the chips.
	return best && !tied ? best.name : null;
}

/**
 * The refinement offer for one activity item, if there is one worth making.
 *
 * Three gates, all of them cheap: the model was not certain; the name it kept is not already
 * a catalogue name or alias (if it is, the save resolves it and there is nothing to upgrade);
 * and the words point at exactly one catalogue entry.
 */
export function suggestRefinement(
	item: Pick<ActivityItem, "exercise" | "equipment" | "description" | "confidence">,
	catalog: readonly RefineCandidate[]
): Refinement | null {
	if (item.confidence === "high") return null;
	if (item.exercise && namesExactly(item.exercise, catalog)) return null;

	const name = bestCandidate({ said: [item.exercise, item.equipment, item.description], catalog });
	if (!name) return null;
	// Suggesting what is already written is not an offer.
	if (item.exercise && item.exercise.trim().toLowerCase() === name.toLowerCase()) return null;
	return { question: `Was it a ${name}?`, exercise: name };
}
