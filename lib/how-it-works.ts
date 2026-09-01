// What the app is actually doing, in the app's own voice (user request 2026-09-01, after
// the coverage map left them wondering whether it resets on a Monday).
//
// The rule this page is written to: **every number in it is a number the code actually
// uses.** It is not marketing and it is not a tour. Someone reads this because a colour
// changed, or a load went up, or a plan came back lighter than they expected, and they want
// to know what decided that. So each section names the mechanism and the figure, and stops.
//
// Kept as data rather than JSX so a new rule is a new entry, not a new layout.

export interface HowItWorksSection {
  title: string;
  /** Two or three sentences. Plain paragraphs; no markup, no lists. */
  body: string;
}

export const HOW_IT_WORKS: HowItWorksSection[] = [
  {
    title: 'The day is the session',
    body:
      'There is nothing to start or stop in order to log. Everything goes in through the + — said out loud, typed, or photographed — and lands on the day it happened. The only thing you start is the workout itself, when you press Start: that is what asks for a plan, and a day with no workout in it is still a perfectly good day of eating and weighing in.',
  },
  {
    title: 'The coverage map',
    body:
      'Every set carries its own rolling seven-day clock. A muscle is coloured by how many of its sets are still inside that window — nothing resets on a Monday, and a set drops out of the count exactly seven days after you did it. The band it is measured against is 10 to 20 sets a week, which is where the hypertrophy research puts the useful range for most people.',
  },
  {
    title: 'The neglect ledger',
    body:
      'A second clock runs per muscle, two to four weeks long, and it tracks how long since each one had a turn. A muscle that runs past its window is marked overdue, and the plan is required to work it back in rather than leave it to chance. This is why the plan sometimes picks something you were not expecting.',
  },
  {
    title: 'Recovery',
    body:
      'A muscle trained within about 48 hours is not today’s primary target. That single rule is what produces the push, pull and legs-shaped alternation you see across a week — the plan is not following a template, it is avoiding what is still recovering and picking up what is overdue.',
  },
  {
    title: 'Progression',
    body:
      'Loads are computed from what you have actually lifted, never guessed. A weight is held until you hit the target reps on every set twice in a row, and then it goes up by one smallest step — 5 lb, or about 5% on a machine — and never more than one step in a week. On assisted machines the number is the help the machine gives you, so progress is the number going down, and the arithmetic runs the other way.',
  },
  {
    title: 'Coming back from a gap',
    body:
      'Three or four days off and the next session comes back lighter: less volume, familiar movements, loads held or dropped one step. Fourteen days or more and it stops resuming and restarts the loads instead. The plan is priced off the absence, and it never mentions the gap as a failing — it just plans from where you actually are.',
  },
  {
    title: 'Cardio',
    body:
      'The weekly cardio number counts equivalent minutes, not clock minutes: moderate effort counts once, vigorous counts double, light counts half. The default target is the WHO’s 150 minutes a week, until you say otherwise. It grows by at most 10% a week.',
  },
  {
    title: 'What a load means',
    body:
      'A barbell total includes the 45 lb bar, so 45 a side is 135. Dumbbells are counted per hand, because that is how dumbbell work is tracked and progressed — two 45s is 45, not 90. A plate-loaded machine counts the plates alone. When the arithmetic is not obvious the card shows its working.',
  },
  {
    title: 'Calories',
    body:
      'Machines report their own figure and it is taken as read. Lifts report nothing, so their calories are a MET-based estimate from the time and your body weight, and anything estimated is marked "est." rather than presented as measured. The day’s allowance is your target plus a share of what you earned.',
  },
  {
    title: 'When the app is not sure',
    body:
      'Every meal is checked against its own arithmetic — four calories a gram of protein and carbohydrate, nine for fat, against the calories claimed. A meal that does not add up is read a second time, and if it still does not, it is saved anyway and marked low confidence. Being confidently wrong about a number you cannot check is the one thing worth avoiding.',
  },
  {
    title: 'Corrections',
    body:
      'Anything read wrong is corrected by saying what is wrong with it, in words — there are no fields to type into anywhere in this app. What you said is kept beside the record along with what it moved, so a number you do not recognise can always explain itself. Nothing is quietly overwritten.',
  },
  {
    title: 'The coach',
    body:
      'It answers when asked and at no other time. Nothing is generated on a schedule, by a notification, or by opening a page — one plan per day, written when you ask for it and the same one every time you look at it. You change it by telling it what to change.',
  },
];
