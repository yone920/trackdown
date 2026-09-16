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
| 3 | Exercise pool: rotation, images, equipment, the anchor lift (`exercisePool.ts`) | **Done, not wired in** |
| 4a | Per-muscle coverage-level arithmetic (`coverage.ts`) | **Done, not wired in** |
| 4b | `coverageLedger()` and `lib/body-map.ts` actually migrated onto it | **Not done — deliberately** |

**Phase 2 is live.** `coach/features.ts`'s `recommendationMuscleStats()` computes real
`MuscleStat[]` for this registry's fourteen muscles straight from the activity window
(its own pass, not a reshaping of `muscleFeatures()` — see that function's own doc), and
`coach/rules.ts`'s `targetPriorityStatement()` now calls `chooseFamily` +
`allocateVolume` on those stats instead of a single lookup. A real brief's TODAY'S TARGET
line is computed by this module now, not guessed by a model reading a list.

Phase 3 (`exercisePool.ts`) and 4a (`coverage.ts`) are built and tested but NOT called
from anywhere live yet — exercise selection is still the model choosing from the full
catalogue, and the coverage map still reads the old flat band. Wiring each in is its own
next step, same discipline as Phase 2's wiring: real data adapter, full test coverage,
reviewed before it touches a live brief.

**4b is called out separately because it is not additive.** `coverageLedger()` feeds
BOTH the live coach prompt's COVERAGE DEBTS text and the Progress tab's map, and it still
speaks its own, older vocabulary (`LEDGER_MUSCLES`: twelve tokens, no `lower_back`, no
`neck`, `"core"` where this registry has a standalone `abs`). Migrating it is a real
production change to what today's brief says and what today's map shows — not a new,
inert file sitting beside the old one, the way Phases 1 through 4a were. It's the right
next step, but it's a deliberately separate one, reviewed on its own rather than folded
into a run of additive commits.

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

`avoidMuscles` exists for the override an explicit "give me chest today" request will
apply (§override.ts, not yet built): a muscle removed from consideration is excluded from
its family's case, not merely dropped from the final answer, so the rest of that family
still competes honestly.

**`allocateVolume(family, stats, totalSlots)`** — how a chosen family's exercise slots
split across its own muscles. Weighted by each muscle's shortfall against its OWN
`mavLow` floor (`max(0, mavLow − sets7d)`), apportioned by the largest-remainder method so
the slots always sum to exactly `totalSlots` with no muscle's fractional share rounded
away unfairly. When nothing in the family is short of its floor, the slots split evenly
instead of collapsing to zero everywhere — a well-covered family still gets a session,
just not one weighted by a shortfall that doesn't exist.

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

**The one safety valve**: if rotation and equipment together leave nothing with a photo,
media is what relaxes first — never rotation, never equipment. Prescribing something
already seen is a smaller failure than prescribing equipment that isn't there or a name
with no picture behind it; `coach.ts`'s own `dropRecovering` documents the identical
principle ("it will not empty a training day").

## The coverage-level arithmetic (`coverage.ts`)

`coverageLevel(stat, muscle)` — the same four-state judgment `lib/body-map.ts`'s own
`levelOf()` already makes (0 = not seen in the window at all, 1 = served but under the
floor, 2 = inside the band, 3 = over the ceiling), except level 2 and 3 are judged
against THIS muscle's own `mavLow`/`mavHigh` instead of one 10–20 sets/week band applied
to everyone. Ten sets of forearms work (its own MAV band) means something different from
ten sets of chest work (short of chest's own floor) — the flat band could never say that,
and this is the arithmetic that can.

Not called from anywhere yet — see 4b above.

## What's coming, and what's left after that

- **Accessories** (`abs`, `lower_back`, `neck`) attach only when their own debt crosses
  MEV, and only where they fit the day's pattern: abs on any day, lower_back only on Leg
  days (already primed by squats/deadlifts), neck only when severely overdue. Capped at
  1–2 extra items, never their own day.
- **The override**: an explicit request ("give me chest today") always wins for that day
  only. It never touches the debt ledger — the ledger keeps reflecting whatever actually
  gets logged, so the schedule just recomputes normally next time. `chooseFamily`'s
  `avoidMuscles` parameter already exists for this; nothing calls it yet.
- **4b**, above: `coverageLedger()` and `lib/body-map.ts` actually reading this module
  instead of `LEDGER_MUSCLES` and the flat band.
- **Wiring the whole module into `coach/coach.ts`**, so a real brief is built from
  `chooseFamily` / `allocateVolume` / `eligiblePool` instead of a model reading advisory
  prompt text. This is the step every phase above has been building toward, and none of
  them do it on their own.

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
├─ coverage.ts           — per-muscle map-level arithmetic (not wired in yet — see 4b)
├─ coverage.test.ts
├─ index.ts              — the ONLY public surface; everything else here is private
└─ ENGINE.md             — this file
```

`accessories.ts` and `override.ts` join this directory the same way every file above
did — their own small, independently-testable pure functions, the same composition
pattern `coach/rules.ts` already uses, just given a dedicated module boundary instead of
living loose inside one large file. Adding a muscle, retuning a band, or reassigning
which family a muscle belongs to stays a data edit in `registry.ts`; the code that reads
it doesn't change.
