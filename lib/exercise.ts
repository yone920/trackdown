import type { Router } from 'expo-router';

// Opening an exercise sheet, from the four places an exercise name is drawn: the coach's
// Do list, Today's training rows, Day's training rows and the DayLog.
//
// The sheet is addressed by the catalogue id the *server* resolved (`exercise_id` on the
// activity, on the day-log record, on each line of the brief). The app never matches
// exercise strings — "db bench" and "Dumbbell Bench Press" are the same row and only the
// catalogue knows that.
//
// A name with no id is still worth a tap: the sheet opens in name-only mode, with no
// photos and no steps, and the form video — which is a search, not a lookup — still works.
// That is every cardio machine and every sport in the catalogue, and anything the user
// logged in words the catalogue has never heard.

/** The stand-in id for "not in the catalogue"; not a uuid, so no fetch is attempted. */
export const NO_EXERCISE_ID = 'unknown';

export function openExercise(
  router: Pick<Router, 'push'>,
  exercise: { id?: string | null; name?: string | null },
): void {
  const name = exercise.name?.trim();
  if (!name) return;
  router.push({
    pathname: '/exercise/[id]',
    // The name rides along so the sheet has a title and a video link before — or without —
    // the fetch.
    params: { id: exercise.id ?? NO_EXERCISE_ID, name },
  });
}

/**
 * "Watch form video" is a YouTube *search*, not a curated link: a search stays right when
 * a video is taken down, and picking one video for everyone is a recommendation nobody
 * here is qualified to make.
 */
export function formVideoUrl(name: string): string {
  const query = encodeURIComponent(`${name} proper form`).replace(/%20/g, '+');
  return `https://www.youtube.com/results?search_query=${query}`;
}
