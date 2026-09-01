import { matchedRecordIds, recordFacts, truthLine } from '@/lib/plan-truth';
import { clock } from '@/lib/format';
import type { CompletionRecord, ExerciseCompletion } from '@/lib/types';

// The line that says what actually happened under what was asked for. A formatting rule,
// tested without a renderer — and the one thing it must never do is invent matching: the
// records it prints are the ones the server matched to make the tick.

const record = (over: Partial<CompletionRecord> = {}): CompletionRecord => ({
  id: 'a1',
  logged_at: '2026-09-01T12:02:00.000Z',
  sets: 2,
  reps: 10,
  load_lb: 85,
  duration_min: null,
  kcal: 60,
  ...over,
});

const completion = (over: Partial<ExerciseCompletion> = {}): ExerciseCompletion => ({
  done: true,
  sets_done: 4,
  sets_prescribed: 4,
  partial: false,
  records: [record()],
  ...over,
});

describe('recordFacts', () => {
  it('reads sets, reps and load the way a lifter says them', () => {
    expect(recordFacts(record())).toBe('2 × 10 @ 85');
  });

  it('keeps a half-plate honest and drops a pointless decimal', () => {
    expect(recordFacts(record({ load_lb: 82.5 }))).toBe('2 × 10 @ 82.5');
    expect(recordFacts(record({ load_lb: 85.0 }))).toBe('2 × 10 @ 85');
  });

  it('says minutes for a piece of cardio, which has no sets at all', () => {
    expect(recordFacts(record({ sets: null, reps: null, load_lb: null, duration_min: 17 }))).toBe('17 min');
  });

  it('counts bare sets when nobody said the reps', () => {
    expect(recordFacts(record({ reps: null, load_lb: null }))).toBe('2 sets');
    expect(recordFacts(record({ sets: 1, reps: null, load_lb: null }))).toBe('1 set');
  });
});

describe('truthLine', () => {
  it('says when it was done and what it came to', () => {
    expect(truthLine(completion())).toBe(`Done ${clock('2026-09-01T12:02:00.000Z')} · 2 × 10 @ 85`);
  });

  it('prints BOTH halves of a split record against the one line that prescribed it', () => {
    // The drop set. Printing only the first record would be the double-counting bug
    // wearing a new hat — the whole reason the load change is visible at all is that both
    // parts are on the line.
    const line = truthLine(
      completion({
        records: [record({ id: 'a1', load_lb: 85 }), record({ id: 'a2', load_lb: 70 })],
      }),
    );
    expect(line).toContain('2 × 10 @ 85 + 2 × 10 @ 70');
  });

  it('counts a part-done line off against what was asked for', () => {
    expect(
      truthLine(completion({ done: false, partial: true, sets_done: 2, sets_prescribed: 4 })),
    ).toContain('2 of 4 sets');
  });

  it('says nothing at all about a line nobody has touched', () => {
    // A plan is not a list of things you are behind on (concept-v2 §Principles 8).
    expect(truthLine(completion({ done: false, sets_done: 0, records: [] }))).toBeNull();
    expect(truthLine(undefined)).toBeNull();
  });

  it('survives an older server that sends a completion with no records on it', () => {
    expect(truthLine({ done: true, sets_done: 3, sets_prescribed: 3, partial: false })).toBeNull();
  });
});

describe('matchedRecordIds', () => {
  it('collects every id the plan accounted for, across all its lines', () => {
    const ids = matchedRecordIds([
      { completion: completion({ records: [record({ id: 'a1' }), record({ id: 'a2' })] }) },
      { completion: completion({ records: [record({ id: 'a3' })] }) },
      { completion: completion({ records: [] }) },
      {},
    ]);
    expect([...ids].sort()).toEqual(['a1', 'a2', 'a3']);
  });
});
