// What a cardio minute is worth (user decision 2026-08-31).
//
// A hundred and fifty minutes a week is the WHO's number and it is not a number of
// *minutes*: the guideline is 150 minutes of MODERATE activity, or 75 of vigorous, and it
// counts them against each other. So a fifteen-minute run and a fifteen-minute stroll were
// being added up as thirty identical minutes, and the user who runs was told they were
// behind while the user who ambles was told they were fine.
//
// Equivalent minutes fix that with one multiplier per session:
//
//     light ×0.5      moderate ×1      vigorous ×2
//
// and the week reads "50 of 150" in equivalent minutes, with the arithmetic shown
// underneath ("20 brisk + 15 run×2") so nobody has to take it on faith.
//
// **It is decided in code, deterministically, from the catalogue's category and the
// activity's own name — never by a model.** The same sentence must produce the same
// multiplier today and next March, because it moves a number the coach prescribes from;
// a classifier that can change its mind is a weekly target that can change its mind.
//
// ## The pace rule, and where it does not apply
//
// When a session carried a distance, its pace is better evidence than its name — "run"
// logged at 14 min/mi is a jog and "walk" logged at 9 is not a walk. Minutes per mile:
//
//     < 12          vigorous   (a sub-12 mile is running)
//     12 – 17.99    moderate   (a jog, or a brisk walk)
//     >= 18         light      (a stroll)
//
// Those thresholds are for **travel on foot**, and that is the whole of the exception:
// a bicycle covers a mile in three minutes at an easy spin and a rowing machine's "mile"
// is not the same mile at all, so a pace on one of those would read as vigorous for the
// wrong reason. `PACE_EXEMPT` names the machines where the pace is meaningless and the
// name decides instead.
//
// ## The lists
//
// Maintained as lists, in the style of `QUALIFIERS` in services/exerciseMatch.ts: short,
// readable, and easy to extend when somebody logs a word we have not seen. Multi-word
// entries match as adjacent words and the **longest match wins**, so "incline treadmill
// walk" is one moderate phrase rather than an argument between "incline" and "walk".
//
// Everything unrecognised is **moderate**. That is the honest default rather than a
// generous one: it is what the guideline itself assumes, it is what most logged cardio
// actually is, and being wrong in that direction costs the user nothing they can see.

/** The three classes the guideline counts in. */
export const CARDIO_INTENSITIES = ["light", "moderate", "vigorous"] as const;
export type CardioIntensity = (typeof CARDIO_INTENSITIES)[number];

/** What one minute of each is worth against a moderate-minutes target. */
export const INTENSITY_MULTIPLIER: Record<CardioIntensity, number> = {
	light: 0.5,
	moderate: 1,
	vigorous: 2,
};

/** Minutes per mile at or under which foot travel is running. */
export const PACE_VIGOROUS_MAX = 12;
/** Minutes per mile at or over which foot travel is a stroll. */
export const PACE_LIGHT_MIN = 18;

/**
 * Machines whose min/mi is not a walking pace. A bike at 3 min/mi is an easy spin, not a
 * sprint, so on these the NAME decides and the pace is ignored.
 */
const PACE_EXEMPT = ["bike", "biking", "cycle", "cycling", "spin", "spinning", "row", "rower", "rowing", "erg", "swim", "swimming", "elliptical"];

/** Phrases that are vigorous when nothing measured a pace. Longest match wins. */
const VIGOROUS_NAMES = [
	"run",
	"running",
	"sprint",
	"sprints",
	"interval",
	"intervals",
	"hiit",
	"stair",
	"stairs",
	"stairmaster",
	"stair climber",
	"jump rope",
	"skipping",
	"row",
	"rower",
	"rowing",
	"erg",
	"swim",
	"swimming",
];

/** Phrases that are moderate. The default too, so these exist to beat a longer light one. */
const MODERATE_NAMES = [
	"brisk walk",
	"power walk",
	"fast walk",
	"incline walk",
	"incline treadmill",
	"treadmill walk",
	"uphill walk",
	"cycle",
	"cycling",
	"bike",
	"biking",
	"spin",
	"spinning",
	"elliptical",
	"hike",
	"hiking",
];

/** Phrases that are light: moving, and not working. */
const LIGHT_NAMES = ["stroll", "strolling", "casual walk", "leisurely walk", "leisure walk", "easy walk", "slow walk", "gentle walk"];

/** Generic activity nouns a short label drops when there is something more specific. */
const GENERIC_WORDS = ["walk", "walking", "run", "running", "ride", "session", "machine", "workout", "cardio"];

function words(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** True when `phrase`'s words appear as an adjacent run inside `tokens`. */
function contains(tokens: readonly string[], phrase: string): boolean {
	const needle = phrase.split(" ");
	for (let start = 0; start + needle.length <= tokens.length; start += 1) {
		if (needle.every((word, offset) => tokens[start + offset] === word)) return true;
	}
	return false;
}

/** Every list, in the order equal-length ties are broken in. No phrase is on two of them. */
const NAME_LISTS: readonly { intensity: CardioIntensity; phrases: readonly string[] }[] = [
	{ intensity: "vigorous", phrases: VIGOROUS_NAMES },
	{ intensity: "moderate", phrases: MODERATE_NAMES },
	{ intensity: "light", phrases: LIGHT_NAMES },
];

interface NameMatch {
	intensity: CardioIntensity;
	phrase: string;
}

/** The longest phrase any list matches, with the class it belongs to. Null when none do. */
function byName(exercise: string): NameMatch | null {
	const tokens = words(exercise);
	let best: NameMatch | null = null;
	let bestLength = 0;
	for (const list of NAME_LISTS) {
		for (const phrase of list.phrases) {
			if (!contains(tokens, phrase)) continue;
			// Longest wins, so "brisk walk" is one moderate phrase rather than two guesses.
			const length = phrase.split(" ").length;
			if (length > bestLength) {
				best = { intensity: list.intensity, phrase };
				bestLength = length;
			}
		}
	}
	return best;
}

/** True when this activity's min/mi is a walking pace rather than a machine's. */
export function paceApplies(exercise: string): boolean {
	const tokens = words(exercise);
	return !PACE_EXEMPT.some((name) => contains(tokens, name));
}

export interface CardioClassInput {
	exercise: string | null;
	/** The catalogue's category, when the row carries one. */
	category?: "cardio" | "strength" | "mobility" | "other" | null;
	/** Minutes per mile, when the session measured a distance. */
	paceMinMi?: number | null;
}

export interface CardioClass {
	intensity: CardioIntensity;
	multiplier: number;
	/** One clause naming the rule that fired, for the row's tooltip and the coach's why. */
	why: string;
}

function classOf(intensity: CardioIntensity, why: string): CardioClass {
	return { intensity, multiplier: INTENSITY_MULTIPLIER[intensity], why };
}

/**
 * What one session counts as. Deterministic and pure: name, category and pace in, one of
 * three classes out.
 */
export function classifyCardio({ exercise, category = null, paceMinMi = null }: CardioClassInput): CardioClass {
	const name = exercise?.trim() ?? "";

	// A stretch is movement and it is not cardio work; it is on the ledger, not in the week.
	if (category === "mobility") return classOf("light", "mobility — light");

	const named = byName(name);

	// The pace, when there is one and when it means what it usually means.
	if (paceMinMi != null && paceMinMi > 0 && (name === "" || paceApplies(name))) {
		const pace = Math.round(paceMinMi * 10) / 10;
		if (pace < PACE_VIGOROUS_MAX) return classOf("vigorous", `pace ${pace} min/mi — vigorous`);
		if (pace < PACE_LIGHT_MIN) return classOf("moderate", `pace ${pace} min/mi — moderate`);
		return classOf("light", `pace ${pace} min/mi — light`);
	}

	if (named) return classOf(named.intensity, `${named.phrase} — ${named.intensity}`);
	return classOf("moderate", "nothing recognised — counted as moderate");
}

/** Minutes, weighted. Whole minutes: nobody reads "17.5 equivalent minutes". */
export function equivalentMinutes(minutes: number | null | undefined, multiplier: number): number {
	if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return 0;
	return Math.round(minutes * multiplier);
}

/**
 * A short name for a row in the week's arithmetic. "Brisk Walk" is "brisk", "Incline
 * Treadmill Walk" is "incline": the qualifier is the part that distinguishes it, and the
 * line it goes on is one line on a phone.
 */
export function shortLabel(exercise: string): string {
	const tokens = words(exercise);
	if (tokens.length === 0) return exercise.trim().toLowerCase();
	if (tokens.length === 1) return tokens[0] as string;
	const trimmed = tokens.filter((word) => !GENERIC_WORDS.includes(word));
	return (trimmed[0] ?? tokens[0]) as string;
}

export interface EquivalentRow {
	label: string;
	minutes: number;
	multiplier: number;
}

/** How many contributors the line names before it starts counting the rest. */
const MAX_NAMED_ROWS = 3;

/**
 * The week's arithmetic, shown: "20 brisk + 15 run×2". A ×1 row prints no multiplier —
 * it is the unit everything else is measured in and saying so on every row is noise.
 */
export function equivalentText(rows: readonly EquivalentRow[]): string {
	const real = rows.filter((row) => row.minutes > 0);
	if (real.length === 0) return "";
	const sorted = [...real].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));
	const named = sorted.slice(0, MAX_NAMED_ROWS).map((row) => {
		const factor = row.multiplier === 1 ? "" : `×${row.multiplier}`;
		return `${Math.round(row.minutes)} ${row.label}${factor}`;
	});
	const rest = sorted.length - named.length;
	return rest > 0 ? `${named.join(" + ")} + ${rest} more` : named.join(" + ");
}

/**
 * The shortfall, in the two currencies it can be paid in: "22 moderate min or 11 hard".
 * Null when the week is already there — there is no alternative to nothing.
 */
export function alternativesText(equivShortMin: number): string | null {
	if (!Number.isFinite(equivShortMin) || equivShortMin <= 0) return null;
	const moderate = Math.round(equivShortMin);
	const hard = Math.max(1, Math.round(equivShortMin / INTENSITY_MULTIPLIER.vigorous));
	return `${moderate} moderate min or ${hard} hard`;
}
