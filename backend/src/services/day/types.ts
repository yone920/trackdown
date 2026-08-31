// The shapes the day model passes around. Kept in their own file so the pure helpers
// (blocks, deltas, narrative, verdict) can be unit-tested without importing the SQL in
// services/day.ts — and so nothing in here needs a database to be true.

export type ActivitySource = "manual" | "fused" | "health";
export type ActivityCategory = "cardio" | "strength" | "mobility" | "other";
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** One activity row, as the day model reads it. `logged_at` is an absolute instant. */
export interface DayActivity {
	/** null for a Health workout that only exists as a sample (nothing has materialised it). */
	id: string | null;
	logged_at: string;
	description: string;
	exercise: string | null;
	/**
	 * The catalogue row `exercise` resolved to, when it resolved to one. It is what makes
	 * an exercise name on Today or Day tappable — the app opens the sheet by id and never
	 * has to match a string (routes/exercises.ts).
	 */
	exercise_id: string | null;
	/**
	 * What it was done on, when the user named it: "chest-supported row machine", "cable
	 * stack". The Day and DayLog draw it as the sub-line under the movement. It is never
	 * what `delta_vs_last` compares on — "heavier than last time" is a claim about the lift,
	 * not about which machine was free (migration 0012).
	 */
	equipment: string | null;
	category: ActivityCategory | null;
	muscle_groups: string[];
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	kcal: number;
	source: ActivitySource;
	confidence: "low" | "medium" | "high" | null;
	/** The Health sample this row came from, when it did. */
	external_id?: string | null;
}

export interface DayMeal {
	id: string;
	logged_at: string;
	description: string;
	/** The stored slot, or the one derived from the clock when nobody said. */
	slot: MealSlot;
	stated_slot: MealSlot | null;
	kcal: number;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
}

export interface DayWeight {
	id: string | null;
	logged_at: string;
	weight_lb: number;
	source: "manual" | "health";
}

/**
 * A Health workout, from `health_samples` (kind `workout`) or from an `activities` row
 * that a sync already materialised. Either way it is a *measured* record of the same
 * minutes the user may also have logged by hand — which is what the overlap rules are for.
 */
export interface HealthWorkout {
	external_id: string | null;
	name: string;
	start_at: string;
	end_at: string | null;
	kcal: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	/** Set when an activities row already represents this workout. */
	activity_id?: string | null;
}

/** A 90-minute cluster of logged activities. Presentation and coach input, never a row. */
export interface Block {
	/** Derived from the first activity in the cluster — stable across reads of the same day. */
	id: string;
	title: string;
	start: string;
	end: string;
	/** Wall-clock span of the cluster, minutes; at least the logged durations. */
	minutes: number;
	/** What the block cost: the members' calories, or the attached Health workout's when nobody gave one. */
	kcal: number;
	/** True when `kcal` came off the watch rather than the logs. */
	kcal_from_health: boolean;
	exercise_count: number;
	activity_ids: string[];
	muscle_groups: string[];
	category: ActivityCategory;
	/** The Health workout measured over these same minutes. Never a second entry. */
	health: HealthWorkout | null;
}
