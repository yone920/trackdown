import { BAR_LB, isBarbell, perSideLb, perSideNote, plateText } from '@/lib/plates';

// What the user actually puts on the bar (field report 2026-09-02: "coach says 115… minus
// the 45 bar… 70… 35 a side"). The total is stored and prescribed — progression math works
// on totals and a history that said "35" for a 115 lb lift would be a history that lies —
// so the app says both rather than choosing.

describe('isBarbell', () => {
  it('reads the catalogue, which is the only thing that knows', () => {
    // "Bench Press" is a barbell and does not say so; the name can never answer this.
    expect(isBarbell(['barbell', 'bench'])).toBe(true);
    expect(isBarbell(['Barbell'])).toBe(true);
  });

  it('is false for everything a bar is not', () => {
    expect(isBarbell(['dumbbell'])).toBe(false);
    expect(isBarbell(['machine', 'cable'])).toBe(false);
    expect(isBarbell(['bodyweight'])).toBe(false);
    expect(isBarbell([])).toBe(false);
    expect(isBarbell(null)).toBe(false);
    expect(isBarbell(undefined)).toBe(false);
  });
});

describe('perSideLb', () => {
  it('takes the bar off and halves what is left', () => {
    expect(perSideLb(115)).toBe(35);
    expect(perSideLb(135)).toBe(45);
    expect(perSideLb(225)).toBe(90);
  });

  it('says nothing about a bar with nothing on it', () => {
    // "0/side" is arithmetic nobody asked for; an empty bar is just the bar.
    expect(perSideLb(BAR_LB)).toBeNull();
    expect(perSideLb(45)).toBeNull();
    expect(perSideLb(30)).toBeNull();
    expect(perSideLb(0)).toBeNull();
  });

  it('handles a half plate without inventing precision', () => {
    // 120 on the bar is 37.5 a side — a real loading, and it prints as one.
    expect(perSideLb(120)).toBe(37.5);
    expect(perSideLb(100)).toBe(27.5);
  });

  it('says nothing when there is no load at all', () => {
    expect(perSideLb(null)).toBeNull();
    expect(perSideLb(undefined)).toBeNull();
    expect(perSideLb(Number.NaN)).toBeNull();
  });
});

describe('plateText', () => {
  it('prints a whole number as a whole number, and a half as a half', () => {
    expect(plateText(45)).toBe('45');
    expect(plateText(37.5)).toBe('37.5');
    // Never "45.00" and never "37.50".
    expect(plateText(45.0)).toBe('45');
  });
});

describe('perSideNote — what actually gets drawn', () => {
  it('reads the way the bar is racked', () => {
    expect(perSideNote(115, ['barbell'])).toBe('35/side + bar');
    expect(perSideNote(120, ['barbell', 'bench'])).toBe('37.5/side + bar');
  });

  it('is silent for everything that is not a bar', () => {
    // A dumbbell figure is ALREADY per hand (the fusion rules make it so), a machine's
    // number is the stack, and a bodyweight movement has no plates. Printing "/side" on
    // any of them would be a different lie from the one this fixes.
    expect(perSideNote(45, ['dumbbell'])).toBeNull();
    expect(perSideNote(150, ['machine'])).toBeNull();
    expect(perSideNote(150, ['cable'])).toBeNull();
    expect(perSideNote(0, ['bodyweight'])).toBeNull();
    expect(perSideNote(115, null)).toBeNull();
  });

  it('is silent for a bar carrying nothing, and for no load at all', () => {
    expect(perSideNote(45, ['barbell'])).toBeNull();
    expect(perSideNote(null, ['barbell'])).toBeNull();
  });
});
