// Is this weigh-in believable?
//
// Field report 2026-09-02: a 110 lb reading was logged by somebody who weighs about 212.
// Whether it was a slip or a test, the app swallowed it whole — the 7-day average fell to
// 161, the week header printed "−102.0 lb", and the goal card announced **"Reached · The
// measure says you are there."**
//
// That is the no-unearned-verdicts law again, and this time it did not merely mis-state the
// day: it CONGRATULATED the user for a number their body never had. A wrong verdict that
// flatters is worse than one that scolds, because nothing about it invites a second look.
//
// Two rules, and they are deliberately different in kind:
//
//   * **Never block.** The always-log law holds (concept-v2 §Principles — "the user can
//     correct a name in one tap; they cannot correct a workout that was never saved"). A
//     reading the app doubts is still the user's to record, and 110 might be true — a scale
//     in kilograms, a different person, a genuine loss over months away from the app.
//   * **Never silently believe.** So it is CHALLENGED before it counts: the review card asks
//     in words, the user confirms in one tap, and the row is marked low-confidence even
//     then. Everything downstream that could congratulate somebody reads that mark.

/** What we know about the recent readings, as the check needs them. */
export interface RecentWeights {
	/** The 7-day average before this reading. Null when nothing recent has been logged. */
	avg_7d: number | null;
	/** The most recent reading before this one, for the question's own words. */
	previous: { weight_lb: number; logged_at: string } | null;
	/** How many readings the average was made from. */
	count: number;
}

/**
 * The threshold, in two parts, and the pair is the point.
 *
 * A flat percentage over-challenges a small body and under-challenges a large one; a flat
 * pound figure does the reverse. So a reading is doubted when it is further than BOTH — 15
 * pounds, and a tenth of the recent average — which is 21 lb for a 212 lb person and stays
 * at the 15 lb floor for anybody under 150.
 *
 * Sized to be quiet. Real weight does not move this much against a seven-day average: water,
 * a heavy meal and a different scale together account for a handful of pounds, not fifteen.
 * A threshold that fires on ordinary noise teaches people to tap through the question, which
 * would leave the app with a confirmation that means nothing.
 */
export const OUTLIER_MIN_LB = 15;
export const OUTLIER_FRACTION = 0.1;

export interface WeighInCheck {
	/** How far it sits from the recent average, always positive. */
	delta_lb: number;
	/** What it is being measured against. */
	avg_7d: number;
	/** The reading it is furthest from, in the user's own history. */
	previous_lb: number | null;
	previous_at: string | null;
	/** The question, as the card asks it. */
	question: string;
}

/** The bar this reading had to clear to go unquestioned. */
export function outlierThresholdLb(avg7d: number): number {
	return Math.max(OUTLIER_MIN_LB, avg7d * OUTLIER_FRACTION);
}

/**
 * The challenge for one weigh-in, or null when there is nothing to doubt.
 *
 * Null when there is NO recent data, and that is not a loophole — it is the honest answer.
 * A first weigh-in, or the first after months away, has nothing to be implausible against,
 * and inventing a baseline to doubt it with would be the app making up the very history it
 * is supposed to be recording.
 */
export function checkWeighIn(weightLb: number, recent: RecentWeights, tzOffsetMin = 0): WeighInCheck | null {
	const avg = recent.avg_7d;
	if (avg == null || recent.count === 0 || !Number.isFinite(weightLb)) return null;

	const delta = Math.abs(weightLb - avg);
	if (delta < outlierThresholdLb(avg)) return null;

	const previous = recent.previous;
	const direction = weightLb < avg ? "below" : "above";
	const gap = previous ? Math.abs(weightLb - previous.weight_lb) : delta;
	const anchor = previous ? dayLabel(previous.logged_at, tzOffsetMin) : "your recent average";
	return {
		delta_lb: round(delta),
		avg_7d: round(avg),
		previous_lb: previous ? previous.weight_lb : null,
		previous_at: previous ? previous.logged_at : null,
		// The words the user has to answer. It states the gap and names what it is a gap
		// FROM, because "is that right?" on its own is a question nobody can check.
		question: `That is ${round(gap)} lb ${direction} ${anchor}. Is that right?`,
	};
}

/** "Monday", "today" — what a person calls the day a reading came from. */
function dayLabel(loggedAt: string, tzOffsetMin: number): string {
	const local = new Date(new Date(loggedAt).getTime() + tzOffsetMin * 60_000);
	const now = new Date(Date.now() + tzOffsetMin * 60_000);
	const days = Math.floor((dateOnly(now) - dateOnly(local)) / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 7) return local.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
	return local.toISOString().slice(0, 10);
}

function dateOnly(at: Date): number {
	return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
