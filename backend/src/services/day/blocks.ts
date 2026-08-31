import type { ActivityCategory, Block, DayActivity, HealthWorkout } from "./types.js";

// Auto-blocks (docs/concept-v2.md §The day is the session): "activities logged within 90
// minutes of each other form a block in the day view". There is no session to start or
// stop, and a block is never something the user manages — it is computed on every read
// from the rows themselves, which is why nothing here writes `activities.block_id`.
//
// And the Health overlap rules (§Health), which live next to the clustering because they
// are about the same minutes: a watch that recorded the gym hour must colour the block it
// belongs to, never appear beside it as a second workout with a second calorie figure.

/** The gap that ends a block. Two lifts 90 minutes apart are two visits, not one. */
export const BLOCK_GAP_MIN = 90;

/**
 * How far a Health workout may sit outside a block and still be the same event. Watches
 * are started before the first log and stopped after the last one, so exact containment
 * would split the gym hour in two.
 */
export const HEALTH_OVERLAP_GRACE_MIN = 15;

const MS_PER_MIN = 60_000;

function ms(instant: string): number {
	return Date.parse(instant);
}

/** Where an activity ends: its logged instant plus whatever duration it claims. */
function endOf(activity: DayActivity): number {
	return ms(activity.logged_at) + (activity.duration_min ?? 0) * MS_PER_MIN;
}

function titleCase(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The block's name. Muscle groups when it was lifting ("Chest & Triceps"), the movement
 * when it was one cardio thing ("Walk", "Run"), and a plain word when the logs say
 * nothing more specific — a title is a label, not a claim.
 */
export function blockTitle(activities: DayActivity[]): string {
	const strength = activities.filter((a) => a.category === "strength");
	if (strength.length > 0) {
		const bySets = new Map<string, number>();
		for (const activity of strength) {
			for (const group of activity.muscle_groups) {
				const key = group.trim().toLowerCase();
				if (!key) continue;
				// Sets are the volume the group actually got; an exercise with no set count
				// still counts once, or a single unnumbered log would rank below nothing.
				bySets.set(key, (bySets.get(key) ?? 0) + (activity.sets ?? 1));
			}
		}
		const top = [...bySets.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 2)
			.map(([group]) => titleCase(group));
		return top.length > 0 ? top.join(" & ") : "Gym";
	}

	const names = activities.map((a) => (a.exercise ?? a.description).toLowerCase());
	if (names.every((name) => /\bwalk/.test(name))) return "Walk";
	if (names.every((name) => /\b(run|jog)/.test(name))) return "Run";
	if (activities.every((a) => a.category === "mobility")) return "Mobility";
	if (activities.length === 1) {
		const only = activities[0] as DayActivity;
		return only.exercise ?? titleCase(only.description);
	}
	return "Cardio";
}

function blockCategory(activities: DayActivity[]): ActivityCategory {
	if (activities.some((a) => a.category === "strength")) return "strength";
	if (activities.every((a) => a.category === "cardio")) return "cardio";
	if (activities.every((a) => a.category === "mobility")) return "mobility";
	return "other";
}

/**
 * Cluster one day's logged activities into blocks. Health-sourced rows are not clustered:
 * they go through {@link attachHealthWorkouts} with the samples, so that a materialised
 * Health walk and its sample cannot both land in the day.
 */
export function buildBlocks(activities: DayActivity[]): Block[] {
	const logged = activities
		.filter((a) => a.source !== "health")
		.slice()
		.sort((a, b) => ms(a.logged_at) - ms(b.logged_at));

	const clusters: DayActivity[][] = [];
	let current: DayActivity[] = [];
	let clusterEnd = 0;

	for (const activity of logged) {
		const start = ms(activity.logged_at);
		if (current.length > 0 && start - clusterEnd > BLOCK_GAP_MIN * MS_PER_MIN) {
			clusters.push(current);
			current = [];
		}
		current.push(activity);
		clusterEnd = Math.max(current.length === 1 ? 0 : clusterEnd, endOf(activity));
	}
	if (current.length > 0) clusters.push(current);

	return clusters.map((cluster) => {
		const first = cluster[0] as DayActivity;
		const start = ms(first.logged_at);
		const end = Math.max(...cluster.map(endOf));
		const muscles = new Map<string, string>();
		for (const activity of cluster) {
			for (const group of activity.muscle_groups) {
				const key = group.trim().toLowerCase();
				if (key) muscles.set(key, key);
			}
		}
		return {
			// The first activity's id makes the block stable for as long as its rows are:
			// the app can key a list on it and the coach can refer to it.
			id: `block-${first.id ?? start}`,
			title: blockTitle(cluster),
			start: new Date(start).toISOString(),
			end: new Date(end).toISOString(),
			minutes: Math.max(Math.round((end - start) / MS_PER_MIN), sumDuration(cluster)),
			kcal: sumKcal(cluster),
			kcal_from_health: false,
			exercise_count: cluster.length,
			activity_ids: cluster.map((a) => a.id).filter((id): id is string => id !== null),
			muscle_groups: [...muscles.values()],
			category: blockCategory(cluster),
			health: null,
		} satisfies Block;
	});
}

function sumKcal(activities: DayActivity[]): number {
	return activities.reduce((total, a) => total + (a.kcal ?? 0), 0);
}

function sumDuration(activities: DayActivity[]): number {
	return activities.reduce((total, a) => total + (a.duration_min ?? 0), 0);
}

export interface HealthMerge {
	blocks: Block[];
	/**
	 * Health workouts that matched no block — a walk, a phone-detected run. These become
	 * activities with `source: health` and they *are* counted in `earned`.
	 */
	standalone: HealthWorkout[];
}

function overlaps(workout: HealthWorkout, block: Block): boolean {
	const grace = HEALTH_OVERLAP_GRACE_MIN * MS_PER_MIN;
	const wStart = ms(workout.start_at);
	const wEnd = workout.end_at ? ms(workout.end_at) : wStart + (workout.duration_min ?? 0) * MS_PER_MIN;
	return wStart < ms(block.end) + grace && wEnd + grace > ms(block.start);
}

/**
 * The overlap rules from docs/concept-v2.md §Health, in one place because double counting
 * is the classic failure of this feature:
 *
 *   * a workout overlapping a block is *attached* to it as the measured source, and fills
 *     in the calories and the minutes the user never gave — it is never added on top and
 *     never becomes a second entry;
 *   * a workout overlapping nothing becomes an activity of its own, `source: health`;
 *   * a workout already materialised as an `activities` row (same external id) is the same
 *     event as its sample, and is only ever counted once.
 *
 * When two workouts overlap the same block, the longest one wins the attachment and the
 * rest are dropped rather than counted: they are the same minutes measured twice.
 */
export function attachHealthWorkouts(blocks: Block[], workouts: HealthWorkout[]): HealthMerge {
	const byBlock = new Map<string, HealthWorkout[]>();
	const standalone: HealthWorkout[] = [];

	for (const workout of workouts) {
		const block = blocks.find((candidate) => overlaps(workout, candidate));
		if (!block) {
			standalone.push(workout);
			continue;
		}
		byBlock.set(block.id, [...(byBlock.get(block.id) ?? []), workout]);
	}

	const merged = blocks.map((block) => {
		const matches = byBlock.get(block.id);
		if (!matches || matches.length === 0) return block;
		const health = matches
			.slice()
			.sort((a, b) => (b.duration_min ?? 0) - (a.duration_min ?? 0) || (b.kcal ?? 0) - (a.kcal ?? 0))[0] as HealthWorkout;
		const kcalFromHealth = block.kcal === 0 && (health.kcal ?? 0) > 0;
		return {
			...block,
			health,
			// "Use its duration/kcal where the user gave none" — where they gave one, theirs
			// stands: they know what they did, and the watch is an estimate too.
			kcal: kcalFromHealth ? (health.kcal as number) : block.kcal,
			kcal_from_health: kcalFromHealth,
			minutes: Math.max(block.minutes, health.duration_min ?? 0),
		} satisfies Block;
	});

	return { blocks: merged, standalone };
}

/** A standalone Health workout, as the activity the day view shows with a Health badge. */
export function healthWorkoutAsActivity(workout: HealthWorkout): DayActivity {
	const duration =
		workout.duration_min ??
		(workout.end_at ? Math.round((ms(workout.end_at) - ms(workout.start_at)) / MS_PER_MIN) : null);
	return {
		id: workout.activity_id ?? null,
		logged_at: workout.start_at,
		description: workout.name,
		exercise: workout.name,
		// A Health workout was never matched against the catalogue; there is no sheet.
		exercise_id: null,
		category: "cardio",
		muscle_groups: [],
		sets: null,
		reps: null,
		load_lb: null,
		duration_min: duration,
		distance_mi: workout.distance_mi ?? null,
		kcal: workout.kcal ?? 0,
		source: "health",
		confidence: null,
		external_id: workout.external_id ?? null,
	};
}
