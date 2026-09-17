# Recommendation Engine

Anyone who wants to understand how a workout gets recommended should start here. This
file is updated in the same commit as any change to this module — if the code and this
doc ever disagree, that's a bug in this doc.

## Why this exists

The coach used to decide which muscle to train, and how much, by asking a language model
to read a page of advisory text and act on it. On a real account it produced exactly the
failures you'd expect from that: chest sat seven days unserved while a muscle that had
merely cleared its 48-hour recovery window got targeted again; the same four chest
exercises repeated session after session because nothing forced rotation; two different,
disagreeing muscle-name vocabularies lived in the codebase at once, so real logged sets
silently failed to count toward the right muscle.

The fix is a line, not a patch: **the engine owns arithmetic — which muscle, how much,
how recently. The model owns language — understanding what was said, writing what comes
back.** Every failure above happened because that line was blurry.

## Status

| Phase | What | Status |
|---|---|---|
| 1 | The muscle registry (`registry.ts`) | **Done** |
| 2 | The scheduler: family + volume selection (`scheduler.ts`) | **Done, and wired in** |
| 3 | Exercise pool: rotation, images, equipment, the anchor lift (`exercisePool.ts`) | **Done, wired in, and enforced on the answer** |
| 4a | Per-muscle coverage-level arithmetic (`coverage.ts`) | **Done, and wired in** |
| 4b | `coverageLedger()` and `lib/body-map.ts` migrated onto the registry | **Done** |
| 5 | The override: an explicit request wins for that ask (`override.ts`, `scheduleTargets`) | **Done, and wired in** |

**Phases 2 through 5 are all live.** `coach/features.ts`'s `recommendationMuscleStats()`
computes real `MuscleStat[]` for this registry's fourteen muscles straight from the
activity window (its own pass, not a reshaping of `muscleFeatures()` — see that
function's own doc), and `coach/rules.ts`'s `targetPriorityStatement()` calls
`chooseFamily` + `allocateVolume` on those stats. `coach/coach.ts`'s `loadCoachInputs`
recomputes that same family and allocation ahead of the model, fetches each targeted
muscle's catalogue candidates (`catalog.ts`'s `catalogCandidatesFor`), re-keys real
rotation history onto the registry (`rules.ts`'s `exercisePoolInputsByMuscle`), and runs
`eligiblePool()` — the stated place's equipment included — before handing the result to
`rules.ts`'s `eligibleExercisesStatement()` as the brief's TODAY'S MENU line. A real
brief's target AND its exercise menu are both computed by this module now, not guessed
by a model reading a list.

`coverageLedger()` (`coach/features.ts`) reads this registry's fourteen muscles instead
of its own older `LEDGER_MUSCLES` vocabulary, and stamps each entry with
`coverage.ts`'s `coverageLevel()` plus that muscle's own `band_low`/`band_high` — the
level judged against ITS OWN MAV band, not one flat 10–20 sets/week range for everyone.
`lib/body-map.ts` reads `level`/`band_low`/`band_high` straight off the entry the server
sends rather than recomputing a flat-band level locally, and `BODY_REGIONS` carries all
fourteen muscles, `abs` where the old map had `core`, plus `lower_back` and `neck` — both
real slugs in `react-native-body-highlighter` (`lower-back` on the back figure, `neck` on
both) that the old twelve-muscle map had nowhere to put.

## The registry (`registry.ts`)

Fourteen muscles, one canonical vocabulary — replacing the two that used to disagree in
this codebase (`coach/features.ts`'s `TRACKED_MUSCLES` had no forearms or neck;
`LEDGER_MUSCLES` folded traps into `upper_back` with no `lower_back` of its own). Every
muscle carries:

- **`family`** — `push` / `pull` / `legs` / `accessory`. The first three are what a day's
  theme rotates through; accessories never win a rotation turn (see below).
- **`recoveryHours`** — how long before this muscle is available as today's target again.
  The existing app's own 48-hour rule, generalized: a muscle described as recovering in
  "48–72h" is stored at 48, the conservative end, matching the precedent
  `coach/rules.ts`'s `RECOVERY_DAYS` already set.
- **`mev` / `mavLow` / `mavHigh` / `mrv`** — minimum effective, maximum adaptive (a
  band), and maximum recoverable volume, in sets/week. This is what replaces the flat
  10–20 sets/week band every muscle is held to today, regardless of size.

**Sourcing, honestly:** the ≥2×/week-beats-1×/week frequency claim is a real, replicated
finding (Schoenfeld & Grgic 2016, and follow-ups). The MEV/MAV/MRV numbers are the
Renaissance Periodization volume-landmark framework — the standard the industry actually
cites, but evidence-*informed* coaching consensus, not a single controlled trial. Treat
every number in `registry.ts` as a tuned default worth arguing with, not a constant.

`lower_back` is the deliberate odd one out: its whole band sits below any limb's MEV,
because "more sets" is not simply better for it the way it is for a quad — it's
injury-sensitive, and the registry says so in the numbers, not just a comment.

## The scheduler (`scheduler.ts`) — live

Takes a `MuscleStat[]` — `{key, daysSince, sets7d}`, from wherever the caller computed it
— and answers two questions, each a pure function with no knowledge of the other:

**The real adapter, live in `coach/features.ts`:** `recommendationMuscleStats(facts)`
computes exactly that `MuscleStat[]`, one entry per registry muscle, straight from the
same 28-day activity window every other coach feature reads — matching each muscle's
`tokens` (its own catalogue-vocabulary aliases, e.g. `upper_back` is `back` + `traps`)
against `activity.muscle_groups`. `CoachFeatures.recommendation_stats` carries the
result, and `coach/rules.ts`'s `targetPriorityStatement(stats, totalSlots)` is what
turns `chooseFamily` + `allocateVolume`'s answer into the brief's TODAY'S TARGET line —
naming the family, every muscle in it getting a slot, and how many exercises each one
gets, computed rather than guessed.

**`chooseFamily(stats, avoidMuscles?)`** — which of push/pull/legs is today's theme. A
family's debt is the WORST excess-idle-days among its own members that have cleared
their own recovery gate (`daysSince - recoveryHours / 24`); the family whose
most-neglected available muscle is the most neglected wins. Never-trained
(`daysSince: null`) outranks any finite number of idle days. A muscle still inside its own
gate is excluded from driving its family's case entirely — not merely deprioritized —
mirroring how a muscle inside 48h is already never today's primary target elsewhere in
this app.

This is the direct, tested fix for the real failure this project started from: on
2026-09-16, chest sat seven days unserved (five past its own 48-hour gate) while back —
which had only just cleared its OWN gate at two days, zero days past it — got targeted
again anyway. `chooseFamily` given those exact numbers picks push (chest's family), and
`scheduler.test.ts` pins that scenario down by name so it can never silently regress.

`avoidMuscles` is how the override (below) takes a muscle out of the day: a muscle
removed from consideration is excluded from its family's case, not merely dropped from
the final answer, so the rest of that family still competes honestly.

**`allocateVolume(family, stats, totalSlots, avoidMuscles?)`** — how a chosen family's
exercise slots split across its own muscles. Weighted by each muscle's shortfall against
its OWN `mavLow` floor (`max(0, mavLow − sets7d)`), apportioned by the largest-remainder
method so the slots always sum to exactly `totalSlots` with no muscle's fractional share
rounded away unfairly. When nothing in the family is short of its floor, the slots split
evenly instead of collapsing to zero everywhere — a well-covered family still gets a
session, just not one weighted by a shortfall that doesn't exist. `allocateAcross(members,
stats, totalSlots)` is the same apportionment over any list of muscles; `allocateVolume`
is it over a family, the override is it over whatever was asked for.

**`scheduleTargets(stats, totalSlots, override?)`** — the one entry point a caller
building a day should use: `chooseFamily` + `allocateVolume` with the override applied,
so the family the TARGET line names, the menu built for it, and the request that shaped
both can never disagree. Returns the family, the allocation, and three lists the brief is
told about — `requested` (named and scheduled), `recovering` (named but still inside its
own gate), `avoided`.

## The override (`override.ts`) — live

An explicit request always wins, for that ask only. This is the second half of the
2026-09-16 field report: the user typed "generate chest workout" into the Adjust box on a
day the debt had given chest ZERO slots (twelve sets six days earlier, still inside the
7-day window — exactly its floor), so TODAY'S MENU had no chest on it and the model
reached for the same four movements from memory. The engine's arithmetic was right about
the debt and wrong about the day, because it never heard the request.

**`parseOverride(text)`** is the ONE place the engine reads the user's words, and it
reads them for exactly one thing: which muscles or family were named, and whether to be
worked or skipped. Spoken names ("pecs", "delts", "core", "hammies") resolve to registry
keys — it never invents a muscle, and a word it doesn't know is a word it ignores. "Back"
is lats + upper back; "arms" is biceps + triceps, across families, because that is what
was said; "lower back" is heard before "back" can claim it. "Legs" alone is a family;
"push"/"pull" are only heard as the day they name ("push day", "pull session") because
"push harder" and "pull-ups" are ordinary speech. A negation ("no shoulders", "skip
legs", "without calves") or a complaint ("my shoulder hurts", "quads are still sore") is
a request to leave that muscle out. Everything else in the sentence — "only 30 minutes",
"harder", "with the bands" — stays the model's to understand.

**How it wins**, in `scheduleTargets`, in this order:

1. **Muscles named to be worked get the whole session**, split between them by the same
   shortfall weighting a family's members get: "give me chest" is a chest day. A named
   muscle still inside its OWN recovery gate is not forced — the same gate `chooseFamily`
   holds every muscle to — and is reported so the brief says why ("They also asked for
   Chest, which is still inside its own recovery window and is not targeted today").
2. **A family named** is forced, split across its members as always.
3. **Otherwise the debt decides**, exactly as before.

Skipped muscles apply at every step: out of the split and out of their family's case.

It never touches the ledger. A forced chest day is logged like any other, and the
schedule recomputes from what was actually done next time.

**Live in `coach/coach.ts`'s `loadCoachInputs`**, which parses THIS ask's own words — the
revision ("switch to legs" from the sheet) and the context ("chest day" said while asking
for a session) — and hands the result to `scheduleTargets` ahead of the model, so the
menu is built for what was asked; and to `buildRules` as `override`, so
`targetPriorityStatement` writes "TODAY'S TARGET — push, AS ASKED: Chest — 6 exercises…
the user asked for this by name, and it wins today over the rotation's own pick". The
day's SAVED contexts are deliberately not read for this: a request is for the ask it was
made in.

The app side of the same report: the Adjust box is hard-wired to append (a promise the
model may not overrule — `coach/coach.ts`'s merge), and "Replace today's plan" used to
fire on a second tap with no words. It now opens the logger in `plan-replace` framing
(`lib/log-framing.ts`, `app/log.tsx` §runReplacePlan): the sheet says the plan goes,
takes what today should be, and sends it as a `rewrite` revision — which is where this
module first hears it.

## The exercise pool (`exercisePool.ts`)

Which catalogue exercises are even eligible to fill a muscle's slots — the engine
deciding the menu, not hoping the model rotates on its own. Four filters, composed by
`eligiblePool()` in the order that matters:

1. **`filterByRotation`** — excludes anything used in the muscle's last
   `ROTATION_WINDOW_SESSIONS` (2, matching `coach/rules.ts`'s own `STRENGTH_RUT_SESSIONS`)
   sessions. This is the direct fix for the OTHER real failure this project started from:
   Bench Press, Cable Crossover, Chest Press Machine and Assisted Dip repeating
   exercise-for-exercise across chest's last two sessions, because nothing stopped it.
2. **The anchor exception** — `chooseAnchor()` picks whichever logged exercise for a
   muscle has the most sessions carrying an actual load (ties broken by most recent), and
   `filterByRotation` exempts it from the rotation filter entirely. Progressive overload
   needs one exercise held still to have a number to track going up; an anchor with no
   loaded sessions in its history (bodyweight, cardio) is a real `null` — nothing there
   needed that continuity.
3. **`filterByEquipment`** — `null` (unknown place) passes everything through, matching
   `places.ts`'s own "no place is the normal state"; a real equipment list filters for
   real, including down to an empty list for a bodyweight-only place. This is what turns
   "I'm home today" into an enforced fact instead of the prompt-text suggestion it is in
   the live app today (`services/coach/prompt.ts`: "prefer these when you prescribe" —
   never a filter).
4. **`filterByMedia`** — only what the catalogue can show a picture of.

The anchor is exempt from the photo requirement as well as from rotation — the user has
done it, so a picture is not what makes it a recommendation — and a tie in loaded-session
count breaks toward the HEAVIEST lift before the most recent one. Both from the same real
account on 2026-09-16: four chest movements with three loaded sessions each, all last done
the same day, where registry order had handed the anchor to a 55 lb assisted dip with no
photo (which the media filter then dropped) over a 135 lb bench press.

**The one safety valve**: if rotation and equipment together leave nothing with a photo,
media is what relaxes first — never rotation, never equipment. Prescribing something
already seen is a smaller failure than prescribing equipment that isn't there or a name
with no picture behind it; `coach.ts`'s own `dropRecovering` documents the identical
principle ("it will not empty a training day").

**Live in `coach/coach.ts`'s `loadCoachInputs`.** The place's equipment is read ahead of
`buildRules` now (it used to be read after); `chooseFamily` + `allocateVolume` run once
there, over the same `features.recommendation_stats` and session sizing
`targetPriorityStatement` uses, to name today's targeted muscles. For each one,
`catalog.ts`'s `catalogCandidatesFor` fetches its catalogue candidates,
`rules.ts`'s `exercisePoolInputsByMuscle` re-keys real rotation history and load history
onto it, and `eligiblePool()` narrows the two down to what the muscle may actually
choose from today. The result is a `Record<muscleKey, string[]>` handed into
`buildRules` as `eligibleExercises`, which `rules.ts`'s `eligibleExercisesStatement`
turns into the brief's TODAY'S MENU line — recomputing the same family and allocation
`targetPriorityStatement` already named, so the two lines can never disagree about which
muscles are today's target.

**Enforced on the answer, not only asked for.** The same menu rides along in
`CoachBriefInputs.menu`, and after the model answers, `coach.ts`'s `enforceMenu` holds
every movement for a targeted muscle to it (the catalogue's own primary-muscle tag says
which muscle a movement is for, mapped onto the registry by `registryKeyForToken`). An
off-menu movement is SWAPPED for the first free menu item — one with a prescription
first, since the user has done it and it arrives with its own numbers, else the next
listed one with no load and a note to pick the weight — and the brief's note says what
went and what came. Only when the menu is exhausted is it dropped, and it will not empty
a training day. Lines the user already had on an append are never touched; on a rewrite,
nothing is promised, and a line the model carried over from the old plan is held to the
menu like any other. This is the second half of the 2026-09-16 field report: asked for a
chest day, the model kept the four repeated chest movements from the plan it was
rewriting and took one item from the ten-item menu built to rotate them out. The prompt
now also says the menu applies to a plan being revised; the enforcement is what makes
that true.

## The coverage-level arithmetic (`coverage.ts`) — live

`coverageLevel(stat, muscle)` — the same four-state judgment `lib/body-map.ts`'s own
`levelOf()` used to make locally (0 = not seen in the window at all, 1 = served but
under the floor, 2 = inside the band, 3 = over the ceiling), except level 2 and 3 are
judged against THIS muscle's own `mavLow`/`mavHigh` instead of one 10–20 sets/week band
applied to everyone. Ten sets of forearms work (its own MAV band) means something
different from ten sets of chest work (short of chest's own floor) — the flat band could
never say that, and this is the arithmetic that can.

**Live in `coach/features.ts`'s `coverageLedger()`**, which now reads this registry's
fourteen muscles instead of its own older `LEDGER_MUSCLES` (twelve tokens, no
`lower_back`, no `neck`, `"core"` where this registry has a standalone `abs`) and stamps
each entry with `coverageLevel()`'s answer plus that muscle's own `band_low`/`band_high`
(`mavLow`/`mavHigh`, `null` for the `stretching` entry, which has no volume-landmark
band of its own). `catalog.ts`'s `introductionCandidates` reads the registry directly
(`muscleByKey`) for the same lookup `LEDGER_MUSCLES.find()` used to do.

`lib/body-map.ts` no longer computes a level itself: `bodyRegions()` reads
`entry.level`/`entry.band_low`/`entry.band_high` straight off what the server sends,
`BODY_REGIONS` carries all fourteen keys (`abs` where the old map had `core`, plus
`lower_back` and `neck`), and the legend and detail line quote a muscle's own floor
instead of one number for everyone. Both `lower-back` and `neck` are real slugs in
`react-native-body-highlighter` (`lower-back` on the back figure, `neck` on both) — the
old twelve-muscle vocabulary simply never had anywhere to put them.

## What's coming, and what's left after that

- **Accessories** (`abs`, `lower_back`, `neck`) attach only when their own debt crosses
  MEV, and only where they fit the day's pattern: abs on any day, lower_back only on Leg
  days (already primed by squats/deadlifts), neck only when severely overdue. Capped at
  1–2 extra items, never their own day.
- **The recovery gate, once:** `override.ts` and `chooseFamily` hold a requested muscle
  to the registry's per-muscle `recoveryHours`, while `coach/rules.ts`'s older
  `recoveryRule` (and `coach.ts`'s `dropRecovering` enforcement) still use one flat
  48-hour `RECOVERY_DAYS` over `TRACKED_MUSCLES`. They agree for every 48-hour muscle;
  for a 24-hour one (triceps, biceps, forearms, calves, abs) asked for on day one, the
  engine will schedule it and the flat rule will then strip its exercises. Folding the
  flat rule onto the registry is the remaining migration.

Full detail on all of it, including the exact data contract the logging agent needs to
honor (a canonical muscle name, never an invented one; a two-tier confidence fallback for
an unrecognized exercise name), lives in the original design spec this module implements.

## Module shape

```
backend/src/services/recommendation/
├─ registry.ts           — the data: muscles, families, MEV/MAV/MRV, recovery hours
├─ registry.test.ts      — the registry's own invariants
├─ scheduler.ts          — chooseFamily + allocateVolume, reading the registry
├─ scheduler.test.ts     — including the exact real-account scenario, pinned by name
├─ exercisePool.ts       — rotation, media, equipment filters + the anchor exception
├─ exercisePool.test.ts  — including the exact chest-roster repeat, pinned by name
├─ coverage.ts           — per-muscle map-level arithmetic, read by coverageLedger()
├─ coverage.test.ts
├─ override.ts           — parseOverride: the one place the engine reads the user's words
├─ override.test.ts      — including the exact sentence from the field report
├─ index.ts              — the ONLY public surface; everything else here is private
└─ ENGINE.md             — this file
```

`accessories.ts` joins this directory the same way every file above did — its own
small, independently-testable pure functions, the same composition pattern
`coach/rules.ts` already uses, just given a dedicated module boundary instead of living
loose inside one large file. Adding a muscle, retuning a band, or reassigning which
family a muscle belongs to stays a data edit in `registry.ts`; the code that reads it
doesn't change.
