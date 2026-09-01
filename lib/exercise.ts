import type { Router } from 'expo-router';

// Opening an exercise sheet, from every place an exercise name is drawn: the coach's Do
// list and its finisher, Today's training rows, Day's training rows, the DayLog, the lifts
// board and the all-lifts screen.
//
// The sheet is addressed by the catalogue id the *server* resolved (`exercise_id` on the
// activity, on the day-log record, on each line of the brief). The app never matches
// exercise strings — "db bench" and "Dumbbell Bench Press" are the same row and only the
// catalogue knows that.
//
// **A name with no id is still worth a tap**, and that is the whole point of this file. The
// sheet opens in name-only mode, with no photos and no steps, and the form video — which is
// a search, not a lookup — still works. That is every cardio machine, every sport, every
// stretch on a finisher, and anything the user logged in words the catalogue has never
// heard. A row that does nothing when it is pressed reads as a broken app, not as a row
// with nothing behind it (field report 2026-09-01: the finisher's items were dead).
//
// The `media` count rides along with the name so the sheet can draw its own skeleton — N
// photo boxes, or none — on the first frame, with no request made and nothing to move when
// one lands.

/** The stand-in id for "not in the catalogue"; not a uuid, so no fetch is attempted. */
export const NO_EXERCISE_ID = 'unknown';

export function openExercise(
  router: Pick<Router, 'push'>,
  exercise: { id?: string | null; name?: string | null; mediaCount?: number | null },
): void {
  const name = exercise.name?.trim();
  if (!name) return;
  router.push({
    pathname: '/exercise/[id]',
    // The name rides along so the sheet has a title and a video link before — or without —
    // the fetch; the count so it knows the shape of what is coming.
    params: {
      id: exercise.id ?? NO_EXERCISE_ID,
      name,
      // Absent rather than "0" when nobody knows: an older server sends no count, and the
      // sheet's two-skeleton guess is a better answer there than a confident zero.
      ...(exercise.mediaCount == null ? {} : { media: String(exercise.mediaCount) }),
    },
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
