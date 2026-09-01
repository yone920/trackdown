import type pg from "pg";
import { addDays, type IsoDate } from "../localTime.js";

// The eating week, computed. Facts are computed, advice is generated (concept-v2
// §Principles 4) — so everything on this page's middle layer is SQL and arithmetic, and the
// paragraph underneath it is handed these numbers rather than the rows.
//
// The window is a ROLLING SEVEN DAYS and it is the same shape as the coverage ledger: every
// meal carries its own clock and drops out of the average exactly seven days after it was
// eaten. Nothing resets on a Monday, because nobody's eating does.
//
// **Days with nothing logged are not zeros.** A day the user never opened the app is not a
// day they ate no protein, and averaging a blank in would drag every number toward a lie
// that flatters nobody. So the divisor is *days that have a meal on them*, and how many
// those were is reported beside the averages — an average over two days says so.

type Queryable = pg.Pool | pg.PoolClient;

/** The guideline band for fibre, in grams a day (US DGA 25 g women / 38 g men). */
export const FIBER_BAND = { low: 25, high: 38 } as const;

/**
 * Protein for muscle retention in a deficit, in grams per POUND of body weight. The band
 * the evidence keeps landing in; the low end is the floor worth defending, the high end is
 * where the returns flatten.
 */
export const PROTEIN_PER_LB = { low: 0.7, high: 1.0 } as const;

export interface MacroAverage {
	/** Grams a day, averaged over the days that had a meal on them. Null with no days. */
	avg_per_day: number | null;
	/** What the average is measured against; null when nobody has said. */
	target: number | null;
	/** How the target reads — a floor to reach, or a ceiling to stay under. */
	direction: "at_least" | "at_most";
	/** Where the target came from, so the page can say when it is standing in. */
	source: "stated" | "derived" | "guideline" | "none";
}

export interface EatingDay {
	date: IsoDate;
	kcal: number;
	protein_g: number;
	carbs_g: number;
	fat_g: number;
	fiber_g: number;
	meals: number;
}

export interface EatingWeek {
	/** Oldest first, only the days that had something logged on them. */
	days: EatingDay[];
	/** How many of the seven days had a meal logged. The divisor, said out loud. */
	days_logged: number;
	avg_kcal: number | null;
	protein: MacroAverage;
	carbs: MacroAverage;
	fat: MacroAverage;
	fiber: MacroAverage;
	/**
	 * What stands out about the most recent logged day, in the app's own words. Empty on a
	 * day that was unremarkable — which is most days, and saying nothing is the point.
	 */
	outliers: string[];
}

export interface EatingTargets {
	protein_g: number | null;
	carbs_max_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
	/** Body weight, for the protein band. The 7-day average when there is one. */
	weight_lb: number | null;
	/** Whether the active goal is a fat-loss one — protein matters more in a deficit. */
	losing: boolean;
}

/** One row per local day in the window, from the meals themselves. */
export async function eatingDays(
	db: Queryable,
	userId: string,
	end: IsoDate,
	tzOffsetMin: number,
	days = 7
): Promise<EatingDay[]> {
	const start = addDays(end, -(days - 1));
	const { rows } = await db.query<{
		date: string;
		kcal: string;
		protein_g: string;
		carbs_g: string;
		fat_g: string;
		fiber_g: string;
		meals: string;
	}>(
		`SELECT to_char((logged_at + ($4 || ' minutes')::interval)::date, 'YYYY-MM-DD') AS date,
		        COALESCE(SUM(kcal), 0)      AS kcal,
		        COALESCE(SUM(protein_g), 0) AS protein_g,
		        COALESCE(SUM(carbs_g), 0)   AS carbs_g,
		        COALESCE(SUM(fat_g), 0)     AS fat_g,
		        COALESCE(SUM(fiber_g), 0)   AS fiber_g,
		        COUNT(*)                    AS meals
		   FROM meals
		  WHERE user_id = $1
		    AND (logged_at + ($4 || ' minutes')::interval)::date BETWEEN $2::date AND $3::date
		  GROUP BY 1
		  ORDER BY 1`,
		[userId, start, end, String(tzOffsetMin)]
	);
	return rows.map((row) => ({
		date: row.date as IsoDate,
		kcal: Number(row.kcal),
		protein_g: Number(row.protein_g),
		carbs_g: Number(row.carbs_g),
		fat_g: Number(row.fat_g),
		fiber_g: Number(row.fiber_g),
		meals: Number(row.meals),
	}));
}

/** The average of one macro over the days that had a meal on them. */
function average(days: readonly EatingDay[], pick: (day: EatingDay) => number): number | null {
	if (days.length === 0) return null;
	return round(days.reduce((sum, day) => sum + pick(day), 0) / days.length);
}

/**
 * The protein target: what the user said, or — failing that — the low end of the retention
 * band against their body weight. Derived is not the same as stated and the page says which.
 */
export function proteinTarget(targets: EatingTargets): { target: number | null; source: MacroAverage["source"] } {
	if (targets.protein_g != null) return { target: targets.protein_g, source: "stated" };
	if (targets.weight_lb != null) {
		return { target: Math.round(targets.weight_lb * PROTEIN_PER_LB.low), source: "derived" };
	}
	return { target: null, source: "none" };
}

/**
 * The week, from the days and the targets. Pure: everything it needs has already been read,
 * which is what makes it testable without a database.
 */
export function summarise(days: readonly EatingDay[], targets: EatingTargets): EatingWeek {
	// A day with a meal on it is a day that counts. Everything else is an absence, not a zero.
	const logged = days.filter((day) => day.meals > 0);
	const protein = proteinTarget(targets);
	return {
		days: [...logged],
		days_logged: logged.length,
		avg_kcal: average(logged, (day) => day.kcal),
		protein: {
			avg_per_day: average(logged, (day) => day.protein_g),
			target: protein.target,
			direction: "at_least",
			source: protein.source,
		},
		carbs: {
			avg_per_day: average(logged, (day) => day.carbs_g),
			target: targets.carbs_max_g,
			direction: "at_most",
			source: targets.carbs_max_g != null ? "stated" : "none",
		},
		fat: {
			avg_per_day: average(logged, (day) => day.fat_g),
			target: targets.fat_g,
			direction: "at_least",
			source: targets.fat_g != null ? "stated" : "none",
		},
		fiber: {
			avg_per_day: average(logged, (day) => day.fiber_g),
			// Nobody states a fibre target; the guideline band stands in, and says so.
			target: targets.fiber_g ?? FIBER_BAND.low,
			direction: "at_least",
			source: targets.fiber_g != null ? "stated" : "guideline",
		},
		outliers: outliersOf(logged, targets),
	};
}

/**
 * What stands out about the most recently logged day — the "yesterday ran 60 g over" line.
 * Measured against the week's own averages and the stated targets, never against a mood.
 *
 * Silent unless something is actually worth saying: a page that always has a complaint on
 * it is a page people stop reading.
 */
export function outliersOf(logged: readonly EatingDay[], targets: EatingTargets): string[] {
	const last = logged[logged.length - 1];
	if (!last) return [];
	const notes: string[] = [];
	if (targets.carbs_max_g != null && last.carbs_g > targets.carbs_max_g) {
		notes.push(`${round(last.carbs_g - targets.carbs_max_g)} g over your carb aim on ${last.date}`);
	}
	const protein = proteinTarget(targets).target;
	if (protein != null && last.protein_g < protein * 0.8) {
		notes.push(`protein came in at ${round(last.protein_g)} g on ${last.date}, under the ${protein} g mark`);
	}
	const fiberFloor = targets.fiber_g ?? FIBER_BAND.low;
	if (last.fiber_g > 0 && last.fiber_g < fiberFloor * 0.6) {
		notes.push(`only ${round(last.fiber_g)} g of fibre on ${last.date}`);
	}
	return notes;
}

/** One decimal at most, and never a trailing ".0". */
function round(value: number): number {
	return Math.round(value * 10) / 10;
}
