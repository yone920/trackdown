import { copyFor, framingOf, FRAMINGS } from '@/lib/log-framing';

// Which words the ONE logger sheet opens with, decided by the door that opened it. A pure
// table, so the register is a rule rather than a branch buried in a component — and so a
// new door is an entry rather than another ternary in the title.

describe('framingOf', () => {
  it('reads the framing a door asked for', () => {
    expect(framingOf('plan')).toBe('plan');
    expect(framingOf('about-you')).toBe('about-you');
    expect(framingOf('default')).toBe('default');
  });

  it('gives the default to a door that said nothing, and to one that said nonsense', () => {
    // Most doors imply no particular register and pass nothing. That is the right answer
    // for them, and an unrecognised value is the same situation.
    expect(framingOf(undefined)).toBe('default');
    expect(framingOf('')).toBe('default');
    expect(framingOf('whatever')).toBe('default');
    expect(framingOf(['plan'])).toBe('default');
  });
});

describe('the copy each door opens with', () => {
  it('leaves the + exactly as it was', () => {
    const copy = copyFor('default');
    expect(copy.title).toBe('What did you do?');
    expect(copy.placeholder).toContain('Shoulder press');
    // Nothing to disambiguate when the + was pressed: no note, no renamed button.
    expect(copy.note).toBeNull();
    expect(copy.submit).toBeNull();
  });

  it('asks about the person on the You page door, not about a workout', () => {
    // Field report 2026-09-01: "shouldn't it be aware of where it's being called from? It
    // should say tell me more about you".
    const copy = copyFor('about-you');
    expect(copy.title).toBe('Tell me about you');
    expect(copy.placeholder).not.toContain('Shoulder press');
    expect(copy.placeholder).toMatch(/train four days a week/);
    // And it says what saying something here actually does.
    expect(copy.note).toMatch(/shapes your plan and your profile/);
    expect(copy.note).toMatch(/not a log of something you did/);
  });

  it('keeps the plan door exactly as it shipped', () => {
    const copy = copyFor('plan');
    expect(copy.title).toBe("Adjust today's plan");
    expect(copy.submit).toBe('Adjust the plan');
    expect(copy.note).toMatch(/does not log anything you did/);
  });

  // User decision 2026-09-03: "Generate today's workout" opens the sheet instead of firing,
  // so a session can be shaped before it is written.
  it('opens the new-plan door on an offer to speak, never a demand', () => {
    const copy = copyFor('plan-new');
    expect(copy.title).toBe('What should today be?');
    expect(copy.submit).toBe('Generate');
    // The note has to say both halves: what the coach reads by itself, and that saying
    // nothing is a complete answer.
    expect(copy.note).toMatch(/log|goals|week/i);
    expect(copy.note).toMatch(/say nothing/i);
    expect(copy.hint).toMatch(/say nothing/i);
    // It is not the adjust door: there is no plan yet to adjust.
    expect(copy.title).not.toBe(copyFor('plan').title);
  });

  it('gives every framing a title, a placeholder and a hint', () => {
    for (const framing of FRAMINGS) {
      const copy = copyFor(framing);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.placeholder.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
    }
  });

  it('renames the submit button only where the sheet is not logging a record', () => {
    // The plan door does not write a log, so its verb differs. Everything else does, and
    // borrowing a different verb for the same act would be the words drifting from the deed.
    expect(copyFor('plan').submit).toBeTruthy();
    expect(copyFor('plan-new').submit).toBe('Generate');
    expect(copyFor('default').submit).toBeNull();
    expect(copyFor('about-you').submit).toBeNull();
  });
});
