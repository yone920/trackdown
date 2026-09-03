// How the ONE logger sheet introduces itself, and nothing else.
//
// There is exactly one input surface in this app (concept-v2 §Principles 7) and it is
// reached from several doors: the + on every tab, "Adjust the plan" under the session,
// "Tell me" on the You page. The sheet behind all of them is the same sheet — same Photo /
// Speak / Type, same reader, same routing — but until now it introduced itself the same way
// too, which meant the You page's door opened on **"What did you do?"** over a placeholder
// about shoulder presses (field report 2026-09-01: "shouldn't it be aware of where it's
// being called from? It should say tell me more about you").
//
// So a door may pass a FRAMING. It changes the words and nothing else: no second form, no
// second endpoint, no change to how anything is classified. The fusion router already knows
// a preference from a workout — what it cannot know is which button was pressed to reach it,
// and that is the only thing this carries.
//
// A door whose surface implies no particular register passes nothing and gets the default.
// That is most of them, and it is the right answer for them.

export const FRAMINGS = ['default', 'plan', 'plan-new', 'about-you'] as const;
export type Framing = (typeof FRAMINGS)[number];

export interface FramingCopy {
  /** The sheet's headline on the say-it step. */
  title: string;
  /** What the empty box suggests. Sets the register more than the title does. */
  placeholder: string;
  /**
   * A line under the title, when the sheet is doing something a reader could mistake for
   * logging. Null for the default door, where there is nothing to disambiguate.
   */
  note: string | null;
  /** The line under the Photo / Speak / Type controls. */
  hint: string;
  /** The say-it step's button. Only the plan door renames it — it does not log a record. */
  submit: string | null;
}

const COPY: Record<Framing, FramingCopy> = {
  default: {
    title: 'What did you do?',
    placeholder: 'Shoulder press, three sets of ten at forty pounds…',
    note: null,
    hint: 'Say it, snap it, or type it — any mix. Same for food, weight, goals.',
    submit: null,
  },
  plan: {
    title: "Adjust today's plan",
    placeholder: 'Add some core · switch to legs · only 30 minutes…',
    note: 'This changes today’s plan — it does not log anything you did. Say what to add or what to work instead, and it is added to the plan rather than replacing it.',
    hint: 'Say it, snap it, or type it. A photo is saved as context for today instead.',
    submit: 'Adjust the plan',
  },
  /**
   * The door to a plan that does not exist yet (user decision 2026-09-03).
   *
   * "Generate today's workout" used to fire the moment it was pressed. It asks for a whole
   * session, and the one thing the user might want to say about it — *"shorter today", "my
   * knee", "something different"* — had nowhere to go except a separate trip through the +
   * beforehand, which nobody would think to make.
   *
   * So the button opens this sheet first. **Saying nothing is the normal case**: Generate
   * with an empty box runs exactly the generation the button used to run, immediately. It
   * is an offer to speak, never a demand — this app has no required fields (concept-v2
   * §Principles 7), and a sheet that refused to proceed without words would be a form.
   */
  'plan-new': {
    title: 'What should today be?',
    placeholder: 'Only 30 minutes · legs feel heavy · something with the bands…',
    note: 'I read your log, your goals and the week and write the session. Anything you say here shapes it — how long you have, how you feel, something you fancy working. Say nothing and I will just write it.',
    hint: 'Say it, snap it, type it — or say nothing and press Generate. A photo is kept as context for today.',
    submit: 'Generate',
  },
  'about-you': {
    title: 'Tell me about you',
    placeholder: 'I’m 45, I train four days a week, bad left knee, no dairy…',
    note: 'Anything about how you train, how you eat, or what to work around. It shapes your plan and your profile — it is not a log of something you did.',
    hint: 'Say it, snap it, or type it. Goals, constraints and preferences all arrive the same way.',
    submit: null,
  },
};

/** The framing a door asked for, or the default. An unknown value is a door that said nothing. */
export function framingOf(value: string | string[] | undefined): Framing {
  return typeof value === 'string' && (FRAMINGS as readonly string[]).includes(value)
    ? (value as Framing)
    : 'default';
}

export function copyFor(framing: Framing): FramingCopy {
  return COPY[framing];
}
