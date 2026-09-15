import type { CoachStatus } from '@/lib/types';

// What to do when the plan was written but the answer never arrived (field report
// 2026-09-02).
//
// The user pressed the generate button, watched "Thinking…", and then watched the page
// go back to "Nothing planned yet". The generation had SUCCEEDED — the brief was on the
// server, five items, stored — and the app had simply stopped listening: a model call over
// a phone connection outran the platform's 60-second fetch ceiling, the promise rejected,
// and the screen reset.
//
// **A dropped response is not a failed generation, and on a long call it is the expected
// case rather than the exceptional one.** So a lost answer is recovered rather than
// reported: ask `/api/coach/status`, which is an exists-check that cannot itself generate,
// until it says there is a plan.
//
// The delays back off, because the thing being waited for takes tens of seconds and polling
// hard would only add load to a server that is already busy writing the answer. They stop
// at about two minutes: past that, saying so in words beats a spinner that has become
// furniture (§NEVER END IN SILENCE, below).

/**
 * How long to wait before each check, in order. Fibonacci-ish: quick enough to catch a
 * response that was only just lost, slack enough not to hammer a working generation.
 * Sums to ~2 minutes over 8 checks.
 */
export const RECOVERY_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 34_000, 34_000];

export const RECOVERY_WINDOW_MS = RECOVERY_DELAYS_MS.reduce((total, ms) => total + ms, 0);

/**
 * What the user is told when the window closes with nothing. It NEVER ends in silence and
 * it never claims the plan failed, because it does not know that: the honest statement is
 * that the answer did not come back and the plan may yet exist.
 */
export const LOST_ANSWER_NOTE =
  'That didn’t come back — the plan may still be being written. Check again in a moment.';

export interface RecoveryOptions {
  /** `GET /api/coach/status` — cheap, and it cannot generate anything. */
  checkStatus: () => Promise<CoachStatus | null>;
  sleep: (ms: number) => Promise<void>;
  /** Overridable so a test does not wait two real minutes. */
  delays?: readonly number[];
  /** Lets a caller stop early — the screen went away, or the user asked again. */
  cancelled?: () => boolean;
}

/**
 * Poll until a plan appears, or until the window closes. True means there is a plan on the
 * server now and the caller should fetch and draw it.
 *
 * A failing status check is not a reason to stop: the network being unreliable is the whole
 * premise of this function, and one refused GET says nothing about the next one.
 */
export async function pollForPlan({
  checkStatus,
  sleep,
  delays = RECOVERY_DELAYS_MS,
  cancelled,
}: RecoveryOptions): Promise<boolean> {
  for (const ms of delays) {
    if (cancelled?.()) return false;
    await sleep(ms);
    if (cancelled?.()) return false;
    try {
      const status = await checkStatus();
      if (status?.has_plan) return true;
    } catch {
      // Keep waiting. A dropped check is the same weather that dropped the answer.
    }
  }
  return false;
}
