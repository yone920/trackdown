import { activitySubLine, descriptionAdds, structuredFacts } from '@/lib/row-facts';

// The sub-line under a logged exercise (lib/row-facts.ts). The rule it exists for: it must
// not repeat the title above it or the numbers beside it. The field report was a row that
// read "Lat Pulldown" over "4 × 15 lat pulldown at 60 lb".

describe('structured facts, in the order a lifter reads them', () => {
  it('is the kit, the shape of the work, the load, then time and distance', () => {
    expect(
      structuredFacts({
        equipment: 'cable tower',
        sets: 4,
        reps: 15,
        load_lb: 60,
        duration_min: 12,
        distance_mi: 1.5,
      }),
    ).toEqual(['cable tower', '4 × 15', '60 lb', '12 min', '1.5 mi']);
  });

  it('says what an assistance load is, because the number means the opposite', () => {
    expect(structuredFacts({ load_lb: 55, load_direction: 'assistance' })).toEqual(['55 lb assistance']);
  });

  it('prints half a scheme when only half was said', () => {
    expect(structuredFacts({ reps: 12 })).toEqual(['12 reps']);
    expect(structuredFacts({ sets: 3 })).toEqual(['3 sets']);
  });
});

describe('the raw description is a fallback, not the line', () => {
  const pulldown = {
    exercise: 'Lat Pulldown',
    description: '4 × 15 lat pulldown at 60 lb',
    sets: 4,
    reps: 15,
    load_lb: 60,
  };

  it('drops a description that only repeats the name and the numbers', () => {
    expect(descriptionAdds(pulldown)).toBe(false);
    expect(activitySubLine(pulldown)).toBe('4 × 15 · 60 lb');
  });

  it('keeps one that carries something the fields cannot', () => {
    const withNote = { ...pulldown, description: '4 × 15 lat pulldown at 60 lb, right shoulder twinged' };
    expect(descriptionAdds(withNote)).toBe(true);
    expect(activitySubLine(withNote)).toBe(
      '4 × 15 · 60 lb · 4 × 15 lat pulldown at 60 lb, right shoulder twinged',
    );
  });

  it('does not repeat a machine that is already its own fact', () => {
    expect(
      activitySubLine({
        exercise: 'Chest Press',
        equipment: 'hammer strength machine',
        description: 'hammer strength machine chest press, 3 sets of 10 at 90 lb',
        sets: 3,
        reps: 10,
        load_lb: 90,
      }),
    ).toBe('hammer strength machine · 3 × 10 · 90 lb');
  });

  it('reads the words when there are no numbers at all', () => {
    expect(activitySubLine({ exercise: null, description: 'walked the dog round the park' })).toBe(
      'walked the dog round the park',
    );
  });

  it('has nothing to say about a row with nothing on it', () => {
    expect(activitySubLine({ exercise: 'Bench Press', description: 'bench press' })).toBeNull();
  });
});
