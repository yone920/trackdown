import {
  LOST_ANSWER_NOTE,
  pollForPlan,
  RECOVERY_DELAYS_MS,
  RECOVERY_WINDOW_MS,
} from '@/lib/coach-recovery';
import type { CoachStatus } from '@/lib/types';

// What to do when the plan was written but the answer never arrived (field report
// 2026-09-02: "Thinking…", then the page reverted to "Nothing planned yet", with a
// five-item brief sitting finished on the server).

const status = (has_plan: boolean): CoachStatus => ({
  date: '2026-09-02',
  has_plan,
  headline: has_plan ? 'Pull day: back, biceps and hamstrings' : null,
  done_count: 0,
  total_count: has_plan ? 5 : 0,
  complete: false,
});

/** A sleep that records what it was asked to wait and returns at once. */
function fakeSleep() {
  const waited: number[] = [];
  return {
    waited,
    sleep: async (ms: number) => {
      waited.push(ms);
    },
  };
}

describe('pollForPlan', () => {
  it('finds the plan that was written while the answer was lost', async () => {
    const { sleep } = fakeSleep();
    const checkStatus = jest.fn().mockResolvedValue(status(true));
    await expect(pollForPlan({ checkStatus, sleep })).resolves.toBe(true);
    // It waits before the first check: the answer was late, not instant.
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while the server is still writing, and stops the moment it is done', async () => {
    const { sleep, waited } = fakeSleep();
    const checkStatus = jest
      .fn()
      .mockResolvedValueOnce(status(false))
      .mockResolvedValueOnce(status(false))
      .mockResolvedValueOnce(status(true));

    await expect(pollForPlan({ checkStatus, sleep })).resolves.toBe(true);
    expect(checkStatus).toHaveBeenCalledTimes(3);
    // Backing off: polling hard would add load to the server writing the answer.
    expect(waited).toEqual([2_000, 3_000, 5_000]);
  });

  it('does not give up because ONE status check failed', async () => {
    // The network being unreliable is the whole premise; one refused GET says nothing
    // about the next one.
    const { sleep } = fakeSleep();
    const checkStatus = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(status(true));
    await expect(pollForPlan({ checkStatus, sleep })).resolves.toBe(true);
    expect(checkStatus).toHaveBeenCalledTimes(2);
  });

  it('gives up after the window, rather than spinning for ever', async () => {
    const { sleep, waited } = fakeSleep();
    const checkStatus = jest.fn().mockResolvedValue(status(false));
    await expect(pollForPlan({ checkStatus, sleep })).resolves.toBe(false);
    expect(checkStatus).toHaveBeenCalledTimes(RECOVERY_DELAYS_MS.length);
    expect(waited).toEqual([...RECOVERY_DELAYS_MS]);
  });

  it('waits about two minutes in total — long enough for a slow model, short enough to speak up', () => {
    expect(RECOVERY_WINDOW_MS).toBeGreaterThan(100_000);
    expect(RECOVERY_WINDOW_MS).toBeLessThan(140_000);
  });

  it('stops early when the screen has gone away', async () => {
    const { sleep } = fakeSleep();
    const checkStatus = jest.fn().mockResolvedValue(status(false));
    await expect(pollForPlan({ checkStatus, sleep, cancelled: () => true })).resolves.toBe(false);
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('never claims the plan failed, because it does not know that', () => {
    // The honest statement is that the answer did not come back — the plan may yet exist.
    expect(LOST_ANSWER_NOTE).toMatch(/may still be being written/);
    expect(LOST_ANSWER_NOTE).not.toMatch(/failed|error|wrong/i);
  });
});
