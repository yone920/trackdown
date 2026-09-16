// The override: an explicit request always wins, for that ask only (ENGINE.md §The
// override). "Give me chest", "legs today", "no shoulders" — the one place the engine
// reads the user's words, and it reads them for exactly one thing: WHICH muscles or family
// were named, and whether they were named to be worked or to be skipped. Everything else
// in the sentence ("only 30 minutes", "harder", "with the bands") stays the model's to
// understand, the same line the whole module holds to: the engine owns arithmetic, the
// model owns language.
//
// A pure function of the text. It never touches the debt ledger — a forced chest day is
// logged like any other and the schedule simply recomputes from what was actually done
// next time — and it never invents a muscle: every name it can hear resolves to a
// registry key, and a word it does not know is a word it ignores.

import { MUSCLES, type RotationFamily } from "./registry.js";

export interface Override {
	/** A whole family asked for by name — "legs", "push day", "a pull session". */
	family: RotationFamily | null;
	/** Muscles asked for by name, registry keys, in the order they were said, no repeats. */
	muscles: string[];
	/** Muscles asked to be left out — "no shoulders", "skip legs", "my knee… " is not one. */
	avoid: string[];
}

/**
 * What people actually call each muscle, in the box. Spoken names, not catalogue tokens
 * (`registry.ts`'s `tokens` are what an activity's `muscle_groups` column holds; nobody
 * types "upper_back"). Multi-word names first within an entry so "lower back" is heard
 * before "back" gets a chance to claim it — the matcher below tries longer phrases first
 * across the whole table for the same reason.
 */
const SPOKEN_NAMES: Readonly<Record<string, readonly string[]>> = {
	chest: ["chest", "pecs", "pec", "pectorals"],
	shoulders: ["shoulders", "shoulder", "delts", "delt", "deltoids"],
	triceps: ["triceps", "tricep", "tris"],
	lats: ["lats", "lat"],
	upper_back: ["upper back", "traps", "trapezius", "rhomboids"],
	biceps: ["biceps", "bicep", "bis"],
	forearms: ["forearms", "forearm", "grip"],
	quads: ["quads", "quad", "quadriceps"],
	hamstrings: ["hamstrings", "hamstring", "hams", "hammies"],
	glutes: ["glutes", "glute"],
	calves: ["calves", "calf"],
	abs: ["abs", "ab", "core", "obliques", "abdominals", "six pack"],
	lower_back: ["lower back", "low back", "erectors"],
	neck: ["neck"],
};

/**
 * Words that name MORE than one muscle at once. "Back" is the important one: a back day
 * is lats and upper back, and neither key on its own is what somebody asking for "back"
 * means. "Arms" crosses families on purpose — it is what the user said, and the schedule
 * below splits the slots across whatever was named regardless of family.
 */
const SPOKEN_GROUPS: Readonly<Record<string, readonly string[]>> = {
	back: ["lats", "upper_back"],
	arms: ["biceps", "triceps"],
};

/**
 * A whole family, by name. "Legs" on its own is unambiguous; "push" and "pull" on their
 * own are not ("push harder", "pull-ups"), so they are only heard as the day they name.
 */
const SPOKEN_FAMILIES: Readonly<Record<string, RotationFamily>> = {
	legs: "legs",
	leg: "legs",
	"leg day": "legs",
	"lower body": "legs",
	"push day": "push",
	"push session": "push",
	"push workout": "push",
	"pull day": "pull",
	"pull session": "pull",
	"pull workout": "pull",
};

/** "no X", "skip X", "without X", "not X", "avoid X", "leave out X", "rest my X". */
const NEGATION = /\b(?:no|not|skip|skipping|without|avoid|avoiding|minus|except|drop|leave out|leaving out|rest|resting|nothing for|none for)\s+(?:the\s+|my\s+|any\s+|more\s+)?$/;
/** "X hurts", "X is sore", "X are tight" — a complaint about a muscle is a request to skip it. */
const COMPLAINT =
	/^\s*(?:(?:is|are|still|feels?|very|really|a bit|kind of|kinda|so|pretty)\s+)*(?:sore|hurts?|hurting|tight|tweaked|injured|painful|aching|aches|cooked|fried|dead|smoked|shot|wrecked)\b/;

interface Hit {
	index: number;
	length: number;
	keys: string[];
	family: RotationFamily | null;
	negated: boolean;
}

function escape(phrase: string): string {
	return phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every phrase this parser can hear, longest first, so "lower back" beats "back". */
const PHRASES: readonly { phrase: string; keys: string[]; family: RotationFamily | null }[] = [
	...Object.entries(SPOKEN_NAMES).flatMap(([key, names]) => names.map((phrase) => ({ phrase, keys: [key], family: null }))),
	...Object.entries(SPOKEN_GROUPS)
		.filter(([, keys]) => keys.length > 0)
		.map(([phrase, keys]) => ({ phrase, keys: [...keys], family: null })),
	...Object.entries(SPOKEN_FAMILIES).map(([phrase, family]) => ({ phrase, keys: [], family })),
].sort((a, b) => b.phrase.length - a.phrase.length);

/**
 * The muscles and families named in `text`, and whether each was named to be worked or
 * skipped. Null when nothing in the sentence names a muscle at all — the ordinary case,
 * where the schedule is the engine's own.
 *
 * Deliberately literal: it does not decide what "switch to chest" means for the rest of
 * the plan (the prompt's append/rewrite mode does), and it does not know an exercise
 * name. "Add chest press machine" names chest, which is right — an exercise for a muscle
 * is a request for that muscle.
 */
export function parseOverride(text: string | null | undefined): Override | null {
	const said = (text ?? "").toLowerCase();
	if (!said.trim()) return null;

	const hits: Hit[] = [];
	const claimed: boolean[] = new Array(said.length).fill(false);
	for (const { phrase, keys, family } of PHRASES) {
		const pattern = new RegExp(`(?<![a-z])${escape(phrase)}(?![a-z])`, "g");
		for (const match of said.matchAll(pattern)) {
			const index = match.index ?? 0;
			const end = index + phrase.length;
			// A longer phrase already took these characters ("lower back" owns "back").
			if (claimed.slice(index, end).some(Boolean)) continue;
			for (let i = index; i < end; i += 1) claimed[i] = true;
			const before = said.slice(0, index);
			const after = said.slice(end);
			hits.push({ index, length: phrase.length, keys, family, negated: NEGATION.test(before) || COMPLAINT.test(after) });
		}
	}
	if (hits.length === 0) return null;
	hits.sort((a, b) => a.index - b.index);

	const muscles: string[] = [];
	const avoid: string[] = [];
	let family: RotationFamily | null = null;
	for (const hit of hits) {
		if (hit.family) {
			if (hit.negated) {
				// "No legs" — every muscle in the family is out, and the family cannot be forced.
				for (const muscle of MUSCLES) if (muscle.family === hit.family && !avoid.includes(muscle.key)) avoid.push(muscle.key);
			} else if (family == null) {
				family = hit.family;
			}
			continue;
		}
		for (const key of hit.keys) {
			const list = hit.negated ? avoid : muscles;
			if (!list.includes(key)) list.push(key);
		}
	}
	// Named to be skipped wins over named to be worked, in the one sentence that says both:
	// "chest, but no chest press today" is not a request for a chest day with no chest.
	const wanted = muscles.filter((key) => !avoid.includes(key));
	if (wanted.length === 0 && family == null && avoid.length === 0) return null;
	return { family, muscles: wanted, avoid };
}

/** Every key the tables above can produce — for the test that pins them to the registry. */
export const SPOKEN_MUSCLE_KEYS: readonly string[] = [
	...new Set([...Object.keys(SPOKEN_NAMES), ...Object.values(SPOKEN_GROUPS).flat()]),
];
