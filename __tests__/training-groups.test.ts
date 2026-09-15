import { clock } from '@/lib/format';
import { groupTraining, sessionSpan, splitBySource } from '@/lib/training-groups';
import type { DayActivity, MuscleSummary } from '@/lib/types';

// The filing rule, tested without a renderer: which heading a row appears under decides
// whether a workout reads as what happened, and it is now the rule for BOTH day pages.

function activity(overrides: Partial<DayActivity> = {}): DayActivity {
  return {
    id: 'a1',
    logged_at: '2026-09-01T07:36:00.000Z',
    description: 'exercise',
    exercise: 'Bench Press',
    exercise_id: 'ex-1',
    media_count: 0,
    equipment: null,
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 200,
    source: 'manual',
    confidence: 'high',
    block_id: null,
    delta_vs_last: null,
    evidence: [],
    ...overrides,
  };
}

const summary = (...muscles: [string, number][]): MuscleSummary[] =>
  muscles.map(([muscle, sets]) => ({ muscle, sets, exercises: [] }));

describe('splitBySource', () => {
  it('keeps Health out of the logged rows, because Health is a source and not a section', () => {
    const manual = activity();
    const health = activity({ id: 'a2', source: 'health' });
    const { logged, health: fromHealth } = splitBySource([manual, health]);
    expect(logged).toEqual([manual]);
    expect(fromHealth).toEqual([health]);
  });
});

describe('groupTraining', () => {
  it('files a strength row under the first muscle heading that claims it, once', () => {
    // A press touches chest and triceps. It belongs to one heading, not to both — drawing
    // it twice would say the user did it twice.
    const press = activity({ muscle_groups: ['chest', 'triceps'] });
    const { byMuscle, unfiled } = groupTraining([press], summary(['chest', 6], ['triceps', 6]));
    expect(byMuscle).toHaveLength(1);
    expect(byMuscle[0]!.muscle).toBe('chest');
    expect(byMuscle[0]!.sets).toBe(6);
    expect(byMuscle[0]!.members).toEqual([press]);
    expect(unfiled).toEqual([]);
  });

  it('draws cardio once under Cardio and never under its muscle tags', () => {
    // Field report 2026-09-01: one treadmill walk was drawn under "calves" AND "glutes".
    // A walk's muscle tags credit the body map; they do not file it.
    const walk = activity({
      id: 'a2',
      category: 'cardio',
      exercise: 'Incline Treadmill Walk',
      muscle_groups: ['calves', 'glutes'],
      duration_min: 17,
    });
    const press = activity();
    const groups = groupTraining([press, walk], summary(['chest', 6], ['calves', 0], ['glutes', 0]));
    expect(groups.cardio).toEqual([walk]);
    expect(groups.cardioMinutes).toBe(17);
    expect(groups.byMuscle.map((group) => group.muscle)).toEqual(['chest']);
    expect(groups.unfiled).toEqual([]);
  });

  it('adds up the minutes of several cardio rows and drops a heading nothing claimed', () => {
    const walk = activity({ id: 'a2', category: 'cardio', muscle_groups: [], duration_min: 17 });
    const bike = activity({ id: 'a3', category: 'cardio', muscle_groups: [], duration_min: 23 });
    const groups = groupTraining([walk, bike], summary(['chest', 6]));
    expect(groups.cardioMinutes).toBe(40);
    expect(groups.byMuscle).toEqual([]);
  });

  it('leaves a movement no heading knows under "Also" rather than dropping it', () => {
    const hike = activity({ id: 'a4', exercise: 'Yoga class', category: null, muscle_groups: [] });
    const { byMuscle, unfiled } = groupTraining([hike], summary(['chest', 6]));
    expect(byMuscle).toEqual([]);
    expect(unfiled).toEqual([hike]);
  });

  it('draws every row exactly once, whatever the tags say', () => {
    const rows = [
      activity({ id: 'a1', muscle_groups: ['chest', 'triceps'] }),
      activity({ id: 'a2', muscle_groups: ['triceps'] }),
      activity({ id: 'a3', category: 'cardio', muscle_groups: ['glutes'], duration_min: 12 }),
      activity({ id: 'a4', muscle_groups: [] }),
    ];
    const groups = groupTraining(rows, summary(['chest', 6], ['triceps', 3], ['glutes', 0]));
    const drawn = [
      ...groups.cardio,
      ...groups.byMuscle.flatMap((group) => group.members),
      ...groups.unfiled,
    ];
    expect(drawn.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(new Set(drawn).size).toBe(4);
  });
});

describe('sessionSpan', () => {
  it('spans the EARLIEST log to the latest, whatever order they arrive in', () => {
    // Read through `clock` so the assertion is about the ordering, which is this
    // function's job, and not about the runner's timezone.
    const first = '2026-09-01T07:36:00.000Z';
    const last = '2026-09-01T08:35:00.000Z';
    expect(sessionSpan([activity({ logged_at: last }), activity({ logged_at: first })])).toBe(
      `${clock(first)}–${clock(last)}`,
    );
  });

  it('says nothing about one row, whose own time is already beside it', () => {
    expect(sessionSpan([activity()])).toBeNull();
    expect(sessionSpan([])).toBeNull();
  });
});
