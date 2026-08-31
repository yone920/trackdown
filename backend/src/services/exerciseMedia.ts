// Matching our exercise catalogue against free-exercise-db.
//
// Pure, and separate from the script that downloads things, because *which picture goes
// with which exercise* is the only part of the import worth arguing about — and the only
// part a test can check without a network.
//
// The dataset (github.com/yuhonas/free-exercise-db, Unlicense) names movements the way a
// bodybuilding site does — "Barbell Bench Press - Medium Grip", "Hyperextensions (Back
// Extensions)", "Concentration Curls" — while ours are named the way a person speaks
// (data/exercises.json, plus its aliases). Three rules close most of that gap, in this
// order of preference:
//
//   1. the whole name, normalised (case, punctuation, apostrophes, "&");
//   2. the same with a trailing " - qualifier" dropped ("Triceps Pushdown - Rope
//      Attachment" → "triceps pushdown");
//   3. the same with a plural last word singularised ("Concentration Curls" → curl).
//
// Parenthesised asides are removed in all three, which is what turns "Machine Shoulder
// (Military) Press" into our "machine shoulder press" and "Box Jump (Multiple Response)"
// into "box jump".
//
// An exact-name key always beats a derived one, so "Front Squat (Clean Grip)" wins over
// "Front Barbell Squat" for our Front Squat. Everything else is an alias in
// data/exercises.json — the same list the fusion prompt matches spoken names against, so
// a rename that helps here helps there too.

/** One entry of the dataset's `dist/exercises.json`, narrowed to what we use. */
export interface DatasetExercise {
	id: string;
	name: string;
	category: string;
	level: string | null;
	equipment: string | null;
	primaryMuscles: string[];
	secondaryMuscles: string[];
	instructions: string[];
	/** Repo-relative image paths, e.g. `Barbell_Squat/0.jpg`. Two, for almost every entry. */
	images: string[];
}

/** What the matcher needs from `exercise_catalog`. */
export interface CatalogRow {
	id: string;
	name: string;
	aliases: string[];
}

/**
 * Dataset names that collide with one of our aliases but are a different movement.
 * free-exercise-db's "Air Bike" is a floor crunch; ours is the fan bike you sit on. There
 * is no rule that separates those two — only knowing what they are — so the list is here,
 * short and explicit, rather than as a heuristic that would quietly drop good matches too.
 */
const AMBIGUOUS_SOURCE_NAMES = new Set(["Air Bike"]);

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

function singularise(normalized: string): string | null {
	const words = normalized.split(" ");
	const last = words.at(-1);
	if (!last || !last.endsWith("s") || last.endsWith("ss")) return null;
	return [...words.slice(0, -1), last.slice(0, -1)].join(" ");
}

/**
 * The keys a dataset name can be found under, exact first. Used to build the index; our
 * own names and aliases are looked up in it verbatim (they are already how people write).
 */
export function datasetNameKeys(name: string): { exact: string; derived: string[] } {
	const exact = normalizeExerciseName(name);
	const derived: string[] = [];
	const add = (key: string | null): void => {
		if (key && key !== exact && !derived.includes(key)) derived.push(key);
	};

	const withoutQualifier = name.includes(" - ") ? normalizeExerciseName(name.split(" - ")[0] as string) : null;
	add(withoutQualifier);
	add(singularise(exact));
	if (withoutQualifier) add(singularise(withoutQualifier));
	return { exact, derived };
}

export interface CatalogMatchReport {
	/** Catalogue row id → the dataset entry it takes its pictures and steps from. */
	matches: Map<string, DatasetExercise>;
	/** Catalogue names with no entry in the dataset, in catalogue order. */
	unmatched: string[];
	total: number;
}

/**
 * Match every catalogue row we can. Entries with fewer than two images are skipped: the
 * sheet shows a start and an end position, and one picture of a movement is not a
 * movement. Nothing is guessed — a row either has a name or an alias that resolves, or it
 * is reported as a miss and the app falls back to name-only.
 */
export function matchCatalog(catalog: readonly CatalogRow[], dataset: readonly DatasetExercise[]): CatalogMatchReport {
	const exact = new Map<string, DatasetExercise>();
	const derived = new Map<string, DatasetExercise>();
	for (const entry of dataset) {
		if (entry.images.length < 2 || AMBIGUOUS_SOURCE_NAMES.has(entry.name)) continue;
		const keys = datasetNameKeys(entry.name);
		if (!exact.has(keys.exact)) exact.set(keys.exact, entry);
		for (const key of keys.derived) if (!derived.has(key)) derived.set(key, entry);
	}

	const matches = new Map<string, DatasetExercise>();
	const unmatched: string[] = [];
	for (const row of catalog) {
		// The catalogue's own spelling first, then its aliases in the order they are written:
		// data/exercises.json puts the most common phrasing first.
		const keys = [row.name, ...row.aliases].map(normalizeExerciseName).filter(Boolean);
		let found: DatasetExercise | undefined;
		for (const index of [exact, derived]) {
			for (const key of keys) {
				const entry = index.get(key);
				if (entry) {
					found = entry;
					break;
				}
			}
			if (found) break;
		}
		if (found) matches.set(row.id, found);
		else unmatched.push(row.name);
	}
	return { matches, unmatched, total: catalog.length };
}

/** Reads and narrows the dataset JSON, naming the offending entry when it cannot. */
export function parseDataset(json: unknown): DatasetExercise[] {
	if (!Array.isArray(json)) throw new Error("The exercise dataset is not a JSON array.");
	return json.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) throw new Error(`dataset[${index}] is not an object`);
		const e = entry as Record<string, unknown>;
		const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
		const list = (value: unknown): string[] =>
			Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		const id = text(e.id);
		const name = text(e.name);
		if (!id || !name) throw new Error(`dataset[${index}] has no id or name`);
		return {
			id,
			name,
			category: text(e.category) ?? "other",
			level: text(e.level),
			equipment: text(e.equipment),
			primaryMuscles: list(e.primaryMuscles),
			secondaryMuscles: list(e.secondaryMuscles),
			instructions: list(e.instructions).map((step) => step.trim()).filter(Boolean),
			images: list(e.images),
		};
	});
}
