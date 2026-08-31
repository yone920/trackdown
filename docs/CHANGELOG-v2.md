# TrackDown v2 — changelog

One section per work package (`docs/build-plan.md`): what shipped, what was deferred, and
every decision that had to be made along the way. This file is the handover.

> **Post-test fix (2026-08-30 pm):** the coach brief is now one per day — a plain ask returns the existing brief (with a `stale` flag when inputs moved); only the first ask, explicit Regenerate, or new context generates. Also: all Pressable function-styles converted to static (NativeWind drops function styles — everything white was invisible on iOS), and the + moved into the tab bar.

## Morning test — read this first

**Two ways to run the app (2026-08-30):**

- **Dev build (recommended — has Speak):** on the iPhone open
  https://expo.dev/accounts/yone920/projects/trackdown-expo/builds/a5557405-b3fb-4739-b2d9-ebb8408f5306
  → *Install*. It is signed for your registered iPhone. It loads its JavaScript from the Metro
  server below, so Metro must be running.
- **Expo Go:** open `exp://100.64.198.50:8081` in Expo Go (Tailscale on). Speak is hidden there.

**Metro was left running on this VM** (100.64.198.50:8081, CI mode → no hot reload). If it is
not answering (`curl localhost:8081/status`), restart it — for the dev build drop `--go`:

**On this VM** (the Omarchy desktop, 100.64.198.50), start Metro:

```bash
cd ~/Work/trackdown
export REACT_NATIVE_PACKAGER_HOSTNAME=100.64.198.50   # Tailscale address of this VM
npx expo start --offline
```

**On the iPhone**: Tailscale on and connected, then open **Expo Go** and scan the QR — or
open `exp://100.64.198.50:8081` directly.

**Sign in**: `yonas.fhs@gmail.com` / `demo-pass-123` (seeded 2026-08-30 with a fat-loss goal and four days; tz −240). If the account has no data,
seed it from `backend/` on the Docker host:
`npm run seed-demo -- <email> --tz <your offset in minutes>` — three closed days and a
half-lived today.

**Android:** the EAS Android build errored in Gradle (build 6134851e); not investigated — iOS first.

### What to try, in this order

1. **Today** — day number and status in the header, the goal banner (or the "no goal"
   state), the cards the goal chose, the *Right now* paragraph with its chips, the day
   arc, Training and Eating.
2. **Log by typing** — the `+`, type "chicken and rice, about 700 calories", *Read it*,
   correct a number on the confirm card, Save. Today updates.
3. **Log by photo** — the `+`, Photo, snap a machine display or a plate, add a line of
   narration, *Read it*, Save.
4. **Set a goal** — the `+`, "I want to get down to 170 pounds by December". The card
   comes back with the server's projected date and three choices: use the projection,
   keep my date, no date. Confirm — Today's cards change to match the goal.
5. **Days** — the list grouped by week with each week's tally. Scroll to the bottom: it
   pages. Tap yesterday.
6. **Day** — the verdict, the *In short* paragraph, the three stats, training by muscle
   group with each lift's delta, macros against targets, the meals, the body. Use ‹ › to
   walk back through the week. Tap the export button: the share sheet has the day's JSON.
7. **The log as recorded** — from the Day footer. Every entry as it arrived, quoted, with
   what it was understood to be. Tap one → the same confirm card with the saved values in
   it → *Save changes* → the Day updates.
8. **Progress** — a section per goal (weight line with its 7-day average and target,
   lifts, weekly bars), then Consistency and Coverage.
9. **Goals** — the goal card with its ring and pace line, reorder with the arrows if there
   is more than one, mark reached or drop. Below: How you train / How you eat /
   Constraints / Health sync / Account, with **Sign out** at the bottom.
10. **Coach** — the accent button on Today. The headline, the *why*, the Do list with
    load × sets × reps, Eat, and *One thing* with a button that actually does something.
    Type a line of context and *Ask again*.

### What is deferred, on purpose

- **Speak needs the dev build.** `expo-speech-recognition` is a native module; in Expo Go
  the port reports unavailable and the mic control is simply not drawn. Photo and typing
  cover everything, including goals and coach context.
- **Health sync is WP7.** The toggle on the Goals tab is a labelled placeholder; nothing
  reads HealthKit yet, and no screen depends on it.
- The **Resting HR** card on Today and the resting-HR metric on Progress stay hidden until
  Health arrives — an absent number is not drawn as a zero.

---

## Field fixes

Real logs, from the phone, that the build plan had not imagined.

### 2026-08-30 — a goal with facts in it (`fix-goal-fusion`)

One sentence typed into the Log sheet broke three things at once:

> "Currently I am 212 lbs, my goal is to go down to 200 lbs. come up with reasonable time to
> achieve that. I work out 4 days a week. At the same time I want to build body mascle. I am
> 45 read old. I go to gym to workout. I want a complete body workout through out the week."

- **Unscoped `weekly_sets` is a goal, not an error.** "A complete body workout through the
  week" names no muscle, and `validateMetrics` refused to save it — a blocking 400 with no
  way past it on the card. The measure now sums the week across every muscle group when no
  scope is given, and a measure declares whether its scope is a requirement (`exercise_load`
  — "best load" of nothing is nothing) or a narrowing (`weekly_sets`) with `scopeOptional`.
  The label follows: `measureLabel()` gives "Weekly sets, whole body" unscoped, "Weekly
  sets" for one muscle, and `GET /api/goals` titles the widget with it.
- **Facts stated alongside a goal are captured.** `GoalDetailOutputSchema` — the second,
  focused call — gained a `facts` object: `current_weight_lb`, `training_days`,
  `environment` (gym | home), `age_years`. `POST /api/log/confirm` for `kind: "goal"` saves
  the weight as a weigh-in and merges the rest into the profile (the age as
  `birth_year = this year − age`, dated in `stated_at`) **before** creating the goal. The
  preview carries them too, so the confirm card can show "Also noting: 212 lb today ·
  4 days/week · gym · 45 years old" — a fact saved silently is a fact the user cannot
  correct.
- **"Already reached" stayed, but honest.** The 212 was being thrown away, so the timeline
  was projected from a seeded 181.2 and came back "Already at 200 lb — mark it reached?".
  Two changes: a weight stated with the goal is the projection's starting point
  (`statedWeightLb`, threaded through `proposalForSpec` / `createGoal`), and when nothing was
  stated the note now names the number it went on — "Your last weigh-ins average 181.2 —
  already under 200 lb. Mark it reached, or tell me your current weight."
- **App**: the noted-facts line on the goal card, and **RECOGNISED → RECOGNIZED** (the app is
  US English) in `components/confirm-card.tsx` and `docs/design-system.md`.

**Decisions**

- **A stated weight beats the seven-day average — for the projection only.** The average
  exists to keep one glass of water out of the trend and is the right number for progress
  and for reached-detection, both of which still read it. It is the wrong number for "how
  long from here", when the user is standing on the scale telling us where *here* is. The
  weigh-in is also written, so the average catches up by itself.
- **`facts` is `.default(null)` on the public schema**, not required: a goal typed into the
  Goals screen states nothing alongside itself, and every client written before this sends
  one. Model-facing it is required-and-nullable like everything else, and sanitised on the
  way out — the loose model-facing bounds cost less grammar, and one nonsense age should not
  fail the whole confirm.
- **The grammar budget now fails on a laptop.** `fusion.test.ts` pins all three model-facing
  schemas under 4500 bytes (route 3.5 KB, goal spec 1.3 KB, plan fields 1.0 KB), so the next
  field is measured in a second rather than discovered by a provider at request time.
- **The goal prompt now demands `by` as YYYY-MM-DD.** The contract test caught the real model
  answering "December" — which `GoalDetailOutputSchema` allowed (a bare `z.string()`) and the
  public schema would then have rejected at confirm time. Nothing in the app changes; the
  prompt resolves the date against the context day it is already given.
- No new dependencies. No migration: `training_days`, `environment` and `birth_year` are
  columns the profile already had.

**Tests** — 324 passing, 2 skipped in `backend` (was 307/2); 64 passing in the app.

- `src/app.test.ts` (+2): the field report verbatim through analyze → confirm — the metric
  list survives, `facts` rides on the preview, the proposal reads `current: 212`, the save
  returns 201, `GET /api/weight` has the 212, the profile has `training_days 4`,
  `environment gym` and the birth year with `stated_at` on all three, and the goals list
  labels the metric "Weekly sets, whole body". Plus the honest already-reached wording for a
  user who stated nothing.
- `src/services/goals/measures.test.ts`, `proposal.test.ts`: the whole-body sum, the label,
  the unscoped metric validating, and the projection from a stated weight over a stale trend.
- `src/services/fusion/fusion.test.ts`: the facts widening, all-null → null, and the size pin.
- `anthropic.fusion.contract.test.ts` (+1): the field report against the real model — the
  extended `goal_spec` grammar compiles, 212 lands in `facts` rather than in the target, and
  `weekly_sets` comes back with a null scope. Run here, green.
- `__tests__/confirm-card.test.tsx` (+2): the noted-facts line, and that it is absent when
  nothing was stated.

**Deferred**

- **The noted facts are not editable on the card.** They render as a line; correcting the
  212 means saying it again. The fields are on the profile and the weigh-in is in the day
  log, both one tap from being fixed, so this waits for a real complaint.
- **`environment` is gym | home only.** The profile column takes any string and the
  constraint/preference path can already write "outdoor" or "mixed"; the goal path's enum is
  narrow because those two are what people say while setting a goal. Widening it costs
  grammar, so it needs a reason.

---

## WP6b — Days, Day, DayLog, Progress, Goals and the Coach screen

The second half of WP6: every screen WP6a left as a routed placeholder, plus the one
endpoint the DayLog needed. `components/placeholder.tsx` is gone.

**The one backend addition — `GET /api/day/:date/log?tz=`**

WP6a's handover said the DayLog had no endpoint and WP6b had to add it or drop it. It is
added, and two decisions shaped it.

- **It is built record-first, not evidence-first.** One entry per saved row (activity,
  meal, weigh-in, goal), with the evidence it was fused from hanging off it, plus any
  confirmed evidence that owns nothing as a `statement`. Listing evidence rows and joining
  outwards would have been the obvious reading of "list the evidence for a day", and it
  would silently omit every row that has no evidence — a Health import, anything the seed
  script wrote, anything logged before WP2. A log that quietly drops entries is worse than
  no log.
- **`0009_day_log.sql` adds `evidence.weight_id`.** A scale photo was linked with *no
  owner at all* (`weight_logs` had no column to point at), so nothing could say which
  weigh-in it was evidence for. The one-owner CHECK now counts four columns. Rows written
  before the migration keep their NULL and show up as statements; nothing is back-filled
  by guessing at timestamps.
- **`PATCH /api/weight/:id`** is new, so "tap → correct" on a weigh-in is a correction
  rather than a delete and a re-log. Meals and activities already had PATCH.

Four backend tests cover it: the ordering and the raw text, the correction in place, the
empty day and the two 400s, and that another user sees none of it. `npm test` is
**315 passed, 2 skipped**.

**Days** (`app/(tabs)/days.tsx`)

Rows grouped by week, each week carrying "5 of 7 served · −3,100 · −0.9 lb". A `FlatList`
that pages on `next_before`, so the list is as long as the history.

- **`lib/days-weeks.ts` is the grouping and the tally**, pure and tested — the same shape
  as `lib/today-cards.ts`. The tally is computed from the rows the page already carries;
  asking `GET /api/week` once per week on screen would be seven requests to say "5 of 7".
  The week the user is *living* is the exception: pass `GET /api/week` in and its `served`
  and `weekly_deficit` win, because that is the week the rest of the app is judging.
- Today's dot is an outline rather than a fill: the day is not over, and a filled dot is a
  verdict.

**Day** (`app/day/[date].tsx`)

The verdict with ‹ › date navigation, *In short*, Eaten / Earned / Allowance, Training by
muscle group with each lift's `delta_vs_last` and its evidence thumbnails, Health as one
badged card rather than a section, Eating as macro bars against the targets plus the
pattern line plus meals by slot, Body, the coach ask if there was one, and a footer.

- **Export is React Native's own `Share`, not `expo-sharing`.** The day is JSON; `Share`
  takes a string and needs no new dependency, while `expo-sharing` wants a file and
  therefore `expo-file-system` too. Two packages for a string is not a trade worth making.
- The route moved from `app/day.tsx` to `app/day/[date].tsx`, so the screen is addressable
  and ‹ › is `router.replace` on a date rather than state.

**DayLog** (`app/day/[date]/log.tsx`)

Time · icon (keyboard / mic / camera / heart) · the words in quotes, or "photo" · a meta
line of source, what was understood, and confidence.

- **Tapping a row opens the Log sheet in edit mode**, not a second editor: the same
  confirm card, seeded with the saved values, saving with PATCH. `lib/edit-record.ts` is
  the round trip and is pure in both directions. The screen the user learned the first
  time is the screen they get the second time (concept-v2 §Principles 7).
- Edit mode re-reads the row from the endpoint rather than taking it through navigation
  params — a screen that trusts its params shows a stale row after the previous edit.
- A statement (a constraint, a preference, a line of coach context) is not editable: there
  is no row to PATCH. It says so instead of offering a tap that would do nothing.

**Progress** (`app/(tabs)/progress.tsx`)

A section per active goal, then Consistency and Coverage.

- **`lib/progress-sections.ts` picks the chart by measure, and the rule is one sentence**:
  a measure whose number means something on a single day is a **line** (body weight, best
  load, pace, resting HR, VO₂); one that only means something over a week is **columns**
  (weekly sets, cardio minutes, macros, distance). New measure, no new decision.
- The weight section draws two lines: the measure's series, which is already a 7-day
  average, and the raw weigh-ins from the Days rows underneath it, thin and dim. The
  average is the claim; the weigh-ins are the evidence for it.
- Each goal fetches its own `/api/goals/:id/progress` — the goals list has the percentages
  but not the series — which is why a goal's block is a component and not a loop.
- Consistency and Coverage come from `GET /api/days?limit=60`, not from a new endpoint:
  the day rows already carry `muscle_groups`.
- No goal → no green and no orange, exactly as on Today.

**Goals** (`app/(tabs)/goals.tsx`)

Active goals as cards with a ring and a pace line, the empty state, the history, the plan
and the account.

- **The two prompts are questions, never actions.** `reached_candidate_at` renders "Looks
  like you reached it — mark done?" and `stalled_since` renders "Stalled — adjust?"; the
  PATCH happens on the tap. A goal is never auto-closed (concept-v2 §Goals).
- **"Not yet" is a session-local dismissal.** The candidate stays on the row because only
  the measure can clear it, and `PATCH /api/goals/:id` has no field for "the user said no"
  — deliberately, since inventing one would let the app un-detect its own detection. The
  prompt is back tomorrow if the goal really is done. If that turns out to be annoying in
  use, the field to add is `reached_dismissed_at`, and the rule stays the same.
- **Reorder is two arrows, not a drag.** `POST /api/goals/reorder` takes the whole order,
  and two arrows need no gesture handler, no measurement and no autoscroll. Priority is
  the user's order, so it moves only when they move it.
- Setting a goal is not a form: "Tell me what you're after" opens the Log sheet with
  `hint=goal`, and the proposal, the `confirm_date` / `no_date` choice and the confirm all
  happen there — the flow WP6a already shipped.
- Below the goals: **How you train** (days, environment, equipment), **How you eat** (diet
  style, daily target, eat-back), **Constraints** (and preferences when there are any),
  **Health sync** (a labelled, disabled toggle — WP7), and **Account** with the email and
  **Sign out**, which was the one control with nowhere to live.

**Coach** (`app/coach.tsx`)

Finished to the spec: the headline, the *why*, **Do** with load × sets × reps per
exercise, **Eat**, **One thing** with the button `nudge_action` names, the Photo / Speak /
Type panel for context, *Ask again*, and an "asked at" line that also says when the answer
came from the day's cache and when the log has moved since.

- **The nudge's button only ever routes or PATCHes what `rules.ts` already chose**:
  `mark_reached` → PATCH that goal, `adjust_goal` → the Log sheet in goal mode, `weigh_in`
  → the Log sheet in weight mode, `close_items` → today's log as recorded. The coach
  proposes; the tap disposes.
- Typed context is the query parameter on this ask. Photo and Speak open the Log sheet in
  `coach_context` mode, which saves the statement against today so every later ask reads
  it back — the panel is the same panel, so `Control` moved out of `app/log.tsx` into
  `components/control.tsx` rather than being copied.

**Shared pieces** — `components/charts.tsx` gains `TrendLine` (several lines over one x
domain, gaps for missing days, an optional dashed target) and `Columns` (vertical bars,
scaled by the caller, because a chart that rescales itself lies about the week it left
out). `components/icons.tsx` gains share, check-circle, alert-circle and the two vertical
chevrons. `lib/queries.ts` gains `useDaysPages` (infinite), `useDayLog`, `usePatchRecord`,
`useUpdateGoal` and `useReorderGoals`.

**Tests** — 34 new, 62 in nine files: `days-weeks` (the grouping and every part of the
tally), `progress-sections` (the chart per measure), `day` (the whole screen from one
fixture day), `goals` (empty / active / reached / stalled, including that nothing is
written until the tap) and `day-log` (the rows, the tap into edit mode, and the
edit-record round trip).

**Verified** — `npx tsc --noEmit` clean, `npx expo lint` clean, `npx expo export
--platform ios` builds a 4.56 MB bundle, backend `typecheck` / `lint` / `test` green
(315 passed, 2 skipped).

**One trap** — `.expo/types/router.d.ts` is generated by `expo start` and gitignored, so a
fresh checkout typechecks the new `/day/[date]` routes only after Metro has run once.
Nothing to fix; just do not be surprised by five "not assignable to parameter of type
Href" errors on a clean clone.

**Deferred** — Health sync (WP7) is a labelled placeholder; the previous-briefs list on
the Coach screen (concept-v2 §App mentions it) is not built, since `coach_briefs` keeps
the history but no route lists it and the morning test only needs today's; and a goal's
metrics cannot be edited from the Goals screen — the way to change a goal is to say it
again, which is what "Adjust it" does.

---

## WP6a — App foundation, Today and Log

The first half of WP6: the theme, the shared components, the API layer, and the two
screens the morning test needs — Today and Log. Days, Progress, Goals, Day and DayLog are
WP6b; they exist as routed placeholder screens so the navigation is real.

**The theme (docs/design-system.md)**

- `tailwind.config.js` is the token table: `bg` `card` `track` `line` `ink` `mute` `dim`
  `accent` `good`. The cream/terracotta palette and Fraunces are gone, along with
  `constants/theme.ts`, the `hooks/use-color-scheme*` pair and every `themed-*` component.
- `lib/theme.ts` holds the same values for the places a class name cannot reach: svg fills,
  the navigation theme, `fontVariant: ['tabular-nums']`. Two hex lists that can disagree is
  how a design system drifts, so one file is generated from the other by hand and reviewed
  together.
- Fonts are **Barlow** (text) and **Barlow Condensed** (display), imported **one weight at a
  time** — `@expo-google-fonts/barlow/500Medium`, not the package root, which re-exports
  every weight and italic and cost 3 MB of the exported bundle.
- `components/icons.tsx` is stroke svg on a 24 grid, 1.8 by default. No emoji, and no glyph
  font: `@expo/vector-icons` is no longer imported by anything.

**Shared components** — `components/`: `type.tsx` (Eyebrow/Body/Sub/Disp/Num, the scale),
`kit.tsx` (Card, Section, Row, Chip, Chips, GroupHeading), `charts.tsx` (Bar, Segments,
Ring, Sparkline — all svg, all pure), `metric-card.tsx`, `goal-banner.tsx`,
`reading-card.tsx`, `day-arc.tsx`, `evidence.tsx`, `fields.tsx`, `confirm-card.tsx`,
`tab-bar.tsx` (the 84px bar and the 64px `+`).

**The API layer**

- `lib/api.ts` stays the one HTTP client and gains `upload()` (multipart, for
  `/api/log/analyze`), `tzOffsetMin()`, and `authHeaders()`/`evidenceUrl()` so an
  `<Image>` can fetch the authenticated photo route.
- `lib/queries.ts` was rewritten around the v2 endpoints: `useDay`, `useWeek`, `useDays`,
  `useGoals`, `useGoalProgress`, `useProfile`, `useCoachNext`, `useRegenerateCoach`,
  `useAnalyze`, `useConfirm`. Every day-shaped call sends `tz`. The v1 hooks that fetched
  `/api/entries/*` and did the arithmetic on the phone are gone.
- **`lib/tdee.ts` and `lib/recommendations.ts` are deleted.** The server computes the
  targets (`GET /api/profile` → `targets`, WP4) and the app renders them; two
  implementations of "what should I eat" is how the phone and the server start disagreeing
  about the same day.
- `lib/types.ts` writes out the shapes the backend returns. When a service in
  `backend/src/services/**` changes one, this file is the other half of the change.

**Today** (`app/(tabs)/index.tsx`)

Header (day N · on track/over/—), goal banner including the no-goal state, the goal's
cards, the Right now reading with its action chips, the day arc, Training and Eating, the
coach button, pull-to-refresh.

- **Which cards appear is `lib/today-cards.ts`** — pure, and the only judgement the app
  makes for itself. fat loss → calories ring + weekly deficit + weight trend; muscle →
  protein + weekly sets + coverage; endurance → weekly cardio + pace + resting HR; strength
  → target lift + weekly sets + push/pull/legs; no goal (and `maintain` / `custom`) →
  workouts this week + cardio today + coverage, in `mute`, with no green and no orange.
- **A card with a missing number does not appear.** No zeros standing in for absent facts:
  an empty ring says the user ate nothing, which is a different claim from "we do not know".
  Resting HR therefore never draws until WP7 brings Health in, and the endurance goal shows
  two cards rather than three.
- `day.workout_done` is read if the backend ever sends it; today the label flips on
  `blocks.length > 0`, which is the same fact computed from what `/api/day` does return.

**Log** (`app/log.tsx`, a modal from the `+` and from the reading's chips)

Text area, photo thumbnails, the three 76px controls, analyze → confirm card → save.

- The confirm card renders **every** kind the classifier can return — activities, meal,
  weight, goal (with the proposed timeline and the `confirm_date` / `no_date` choice),
  constraint, preference, coach_context, and `unclear`, which shows the question and offers
  no Save. A kind it could not draw would be a log the user could not save.
- Photos: `expo-image-picker` (camera and library, ≤ 4) downscaled by
  `expo-image-manipulator` to 1280 px JPEG at quality 0.7 before upload — the server's
  sharp pass stays the safety net, not the first line.
- `client_id` is minted once per confirm card (`expo-crypto`), so a confirm retried after a
  timeout replays instead of logging the workout twice.
- **Speak is behind `lib/ports/speech.ts`.** `getSpeech()` `require`s the
  `expo-speech-recognition` adapter inside a try: the native module throws while it is
  being evaluated, which is exactly what Expo Go does, and the port answers
  `available: false`. The control is then not drawn at all and the helper line says why.
  Nothing imports `expo-speech-recognition` at the top level.

**Navigation** — tabs Today · Days · Progress · Goals with a hand-written tab bar (the
floating `+` has to know where the bar ends); `log` as a modal, `coach` and `day` as stack
routes. The old screens (`detail`, `eating`, `movement`, `weight`, the v1 `progress` and
`profile`) are deleted. `app/coach.tsx` is deliberately more than a placeholder — it asks
`GET /api/coach/next`, renders the brief and takes a line of context — because item 6 of the
morning-testable minimum is "coach ask → brief".

**One backend change** — `GET /api/day/:date` now returns `evidence: [{id, kind, mime,
width, height}]` on each activity and meal. The photo row under an exercise is in the design
and the day view had no way to point at one; it is one extra query per day, not N+1. Nothing
else about the shape moved.

**`app.json` / `eas.json`** — committed (they were uncommitted EAS edits). `userInterfaceStyle`
is `dark`, the splash and adaptive-icon backgrounds are `#121418`, the camera / photo library
/ microphone / speech-recognition permission strings are written, and the
`expo-speech-recognition` and `expo-image-picker` config plugins are configured. Expo Go
ignores plugins, which is the point: the sheet still works there without them.

**Tests** — jest + `jest-expo` + `@testing-library/react-native`, 28 in four files:
`today-cards` (the card rule per goal kind, including the hidden-when-missing rule),
`today` (rendered against a fake API), `confirm-card` (every kind, the sources line, the
edit callback) and `log` (Speak hidden when the port is unavailable, typed text through
analyze → edit → confirm with the idempotency key). `react-test-renderer` is pinned to
19.1.0 to match React; `jest-expo` to ~54 to match the SDK.

**Verified** — `npx tsc --noEmit` clean, `npx expo lint` clean (the 7 unescaped-quote errors
and the unused variable were all in deleted or rewritten files), `npx expo export
--platform ios` builds a 4.46 MB bundle, backend `typecheck`/`lint`/`test` still green
(311 passed, 2 skipped).

**One trap found on the way out** — the app's `tsconfig.json` included `**/*.ts`, which swept
up `backend/src`. Harmless until `expo-env.d.ts` exists (generated by `expo start`,
gitignored): it pulls in `expo/types`, the DOM's `setInterval` wins, and the backend's Node
one stops matching. `backend` and `dist` are now excluded — the backend has its own
tsconfig and its own `npm run typecheck`.

**Deferred to WP6b** — Days, Progress, Goals (with the empty/propose/reached/history states
and the account rows), Day and DayLog, the Coach screen's full design, and the Goals-screen
reorder. WP6b should know:

- `lib/today-cards.ts` is the pattern for Progress: a pure selector over `GoalWithProgress`,
  tested without a renderer.
- `GET /api/goals/:id/progress` carries the `series` the Progress charts want;
  `components/charts.tsx` already draws all four shapes.
- Nothing renders `profile.constraints` / `preferences` / `training_days` yet — those are
  the "How you train / How you eat / Constraints" rows under Goals.
- There is no sign-out control on any screen: it belongs in the Goals tab's account rows.
  `signOut()` in `lib/auth.ts` is ready and unused.
- `/api/day/:date` returns everything the Day screen needs (verdict, `in_short`,
  `muscle_summary`, macros, `eating_pattern`, `coach`); no backend work is left for it.
- DayLog ("the log as recorded") has **no endpoint**: `evidence` rows carry the raw text but
  nothing lists them for a day. That is a backend addition WP6b has to make or drop.

---

## WP5 — Coach

The brief. Everything with a number in it is computed; the model chooses the movements,
the order and the words. Asked for, never scheduled.

**`services/coach/features.ts` — the coach's inputs, pure**

- Every feature concept-v2 §Coach lists, as pure functions of the same 28-day `DayFacts`
  window `services/day.ts` already builds: days since the last workout, sessions this week
  against last, per muscle group days-since and 7-/28-day sets, per exercise last
  load × sets × reps + best in four weeks + trend, cardio minutes this week vs the plan,
  adherence over 1/3/7 days, the weight trend, and the data-quality flags.
- **A day is one session.** Three logged sets of bench in one visit are one session at that
  day's top load, because that is what "the same load in two consecutive workouts" counts.
  The warm-up set still counts as volume.
- **null is "we do not know", never zero** — the same rule the measure catalog runs on. A
  muscle group with no entry in four weeks reports `days_since: null`, and
  `TRACKED_MUSCLES` is a written-out list precisely so an *absence* is visible: "no pulling
  movement since Monday" is a sentence about rows that do not exist.
- Data quality is the coach's half of concept-v2's "the coach is only as good as the log":
  low-confidence items from the last week, days with nothing logged, a missing calorie
  target, a due weigh-in, meals with no protein figure.

**`services/coach/rules.ts` — the numbers the model is not allowed to invent**

- `gapRule` (3–4 days → ease back, ≥14 → restart, and never scold), `recoveryRule` (trained
  inside 48 h is not today's primary target), `cardioRule` (the week's shortfall, capped at
  one safe +10 % step — "by weekly minutes vs the plan, not by yesterday").
- **`prescribeLoads()`** turns history into the concrete load × sets × reps per exercise:
  a new exercise repeats what was reported; a session short of target holds and two short
  drop one plate; target reps on every set in two consecutive sessions steps up one plate
  (5 lb, or 5 % on a stack) unless the load already went up inside the last week; a
  restart-length gap comes back a step lighter and a set shorter.
- `selectNudge()` picks the single most useful thing — a reached goal first, then a stalled
  one, then unconfirmed items, then a due weigh-in, then the unlogged days — and returns the
  **action** with it (`mark_reached goal_id` / `adjust_goal goal_id` / `weigh_in` /
  `close_items`). The model writes the sentence; the button is not generated.

**The port, the schema and the prompt**

- `ports/coach.ts` — `CoachPort.brief(inputs) → Brief`, with `adapters/coach/llm.ts`
  composing `LlmPort` on the coach model (`COACH_LLM_PROVIDER` / `LLM_MODEL_COACH`, Sonnet
  by default) and `src/test/fakes/coach.ts` behind every integration test.
- `services/coach/schema.ts` — `{ headline, why, workout {type, targets[], exercises[{name,
  load_lb, sets, reps, minutes, note}]}, nutrition {kcal, protein_g, carbs_max_g, ideas[≤3],
  why}, nudge }`, ~1.6 KB of JSON schema against WP2's ~4.5 KB grammar ceiling, pinned by a
  budget test and proved on the real model by a contract test.
- The prompt hands over the goals in priority order, the plan and its constraints, the
  eating targets, today so far, the feature sheet, the rules as constraints, the prescribed
  loads, and the user's context — and says in three places that the numbers are not the
  model's to change.

**Routes**

- `GET /api/coach/next?tz=&context=` — the day's cached brief, or a new one. The response
  carries the brief, the computed `gap`, the `nudge_action` and the active goals with their
  candidates, so the app never has to parse anything back out of the model's sentences.
- `POST /api/coach/next/regenerate` — `{ tz_offset_min, context? }`, always generated.
- Both close the user's due days first, like every other day-shaped route.
- **Nothing else in the codebase produces a brief.** No job, no cron, no notification — that
  is concept-v2 §Principles 5 as a property of the code, and the note at the top of
  `routes/coach.ts` says so to whoever adds the first scheduler.

**Context has a home now**

`POST /api/log/confirm` with `kind: "coach_context"` writes a `coach_contexts` row on the
user's local day (migration 0008) instead of returning the text and forgetting it. The
coach reads that day's statements, joined with whatever was typed into the ask itself, and
both go into the cache key — so "knee hurts today" produces a different brief and is gone
tomorrow. A context that outlives the day is a *preference*, which is a different table.

**Migration — `backend/migrations/0008_coach.sql`**

- `coach_briefs.headline` and `.nudge_action`. 0004's `rationale` is the brief's `why`
  under its older name; `headline` is the title sentence the Coach screen opens with, and
  `nudge_action` is what the app can *do* about the nudge.
- `coach_contexts (user_id, date, text)`, with a unique index on `(user_id, date, md5(text))`
  — a phone with no signal retries the confirm, and the fusion ledger only covers a repeated
  `client_id`.

**Decisions**

- **The model never picks a number.** Loads, sets, reps, minutes and the calorie/protein
  targets are all computed and handed over to be copied. Ask a language model for "the next
  sensible weight" and it answers differently on Tuesday than on Monday for the same
  history, which is the one thing a progression must never do. The contract test asserts the
  copying against the real model, because it is a claim about behaviour that no fake can
  make.
- **"Target reps" is the best the user has proved at the load they are on**, not the average
  of their sessions and not a constant in the code. An average drifts *down* every time
  someone has a bad day — the finish line quietly moving to wherever they landed — and a set
  of twelve at a warm-up weight is not a target for the working weight.
- **The cache key is the whole feature set, plus the local hour.** Unlike the day reading —
  whose hash had to *exclude* a NOW marker that moves every minute — every number the coach
  reads is a fact about what was logged, so hashing all of it is right. The hour is in it
  because a brief at 6 am and one at 9 pm are different answers; the minute is not.
  `regenerate` rewrites the same row rather than adding a duplicate.
- **A failed generation serves the day's previous brief, or 503s.** The day readings are
  allowed to be absent; the brief is the answer the user asked for, and a blank Coach screen
  with no explanation is worse than a message saying the coach is down.
- **`nudge_action` is chosen, not generated**, and `mark_reached` never closes anything:
  concept-v2 §Goals is explicit that a goal is never auto-closed, so the action is a button
  the user presses and the prompt says as much.
- **The coach reads goals through `services/goals/store.ts`**, so it sees exactly what the
  Goals screen sees — priority order, progress and the candidates — rather than a second
  query that could disagree with it.
- **`GET /api/day/:date` gained a `coach` field**, the day's most recent brief. That is
  WP3's deferred coach-ask card, and it is a *record of an ask*, not a second place that
  generates advice.
- No new dependencies.

**Tests** — 311 passing, 2 skipped (was 243 / 2).

- `src/services/coach/features.test.ts` (22): the gap at 0, 1, 3 and never; sessions folded
  per day; muscle recency, weekly sets and the untrained list; the four-week trend and the
  window's edge; cardio counted against the week and not confused with a lift; adherence
  averaged per day rather than per meal, with the unlogged days named; the smoothed weight
  trend; and every data-quality flag, including the "nothing to flag" case.
- `src/services/coach/rules.test.ts` (32): every gap level and its wording; recovery;
  cardio's shortfall and its cap; `targetScheme` from the load they are on; the plate and
  the stack step; and `prescribeLoads` for new / hold / step up / stepped this week already
  / low confidence / two misses / ease back / restart / cardio / no history. Plus nudge
  priority (reached before stalled before items before weigh-in), and the schema's size.
- `src/app.test.ts` (+11): the brief built from real rows (features, prescriptions, the
  stated constraint), the cache serving the rest of the day free, a log invalidating it, a
  context on the query string and one said through the Log sheet, regenerate rewriting the
  same row, the reached candidate becoming `mark_reached` with the goal's id, a stalled goal
  becoming `adjust_goal`, an 18-day gap prescribing a restart, the coach-ask card on the Day
  view, the 503 and the stale fallback.
- `src/adapters/coach/anthropic.coach.contract.test.ts` (1, skipped without a key, run and
  green here): the grammar compiles on the coach model, and every exercise the model chose
  from the prescription list came back with that prescription's numbers.
- `src/scripts/seed-demo.test.ts`: the seeded brief on yesterday.

**Deferred**

- **No `GET /api/coach/briefs` history.** The Coach screen's "previous briefs" list has the
  rows (one per distinct answer per day) but no endpoint yet; WP6 can add the query it wants
  rather than one guessed at now.
- **The brief is not regenerated when a *goal* changes**, only when the goal's id, priority
  or candidates change — editing a goal's target mid-day leaves the morning's brief cached
  until something else moves. Adding the metrics to the hash is a one-line change if it
  bites.
- **`loadCoachInputs` runs `computeDay` and `listGoals` on every ask, cached or not.** The
  cache saves the model call, not the queries — the same trade WP3 made for readings.
- **Nothing writes `expired`.** WP4 left this for "WP5's coach to ask"; the coach asks about
  reached and stalled goals, and a goal whose `active_to` has passed still reads as active.
  It wants a decision about whether an expiry is a question or a sweep.
- **No app screens.** The Coach screen (brief, context input, regenerate, previous briefs)
  is WP6; this is the API it reads.

---

## WP4 — Goals and profile by talking

A goal is now a thing the server can propose, judge, notice the end of, and keep in
history. The model hears what the user wants; everything with a number in it is computed.

**`services/goals/proposal.ts` — the proposed timeline, pure**

- The safe rates from concept-v2 §Goals, as three formulas: **fat loss** at 0.5–1 %/week of
  body weight (compounding, at the profile's `goal_pace` — gentle 0.5, standard 0.75,
  aggressive 1.0), **a plate step** (5 lb) every 1–2 weeks by the same pace, and **cardio
  and other weekly volumes** at +10 %/week, flat: concept-v2 gives one number for it and it
  is a load-management rule, not an ambition dial. Weight *gain* is projected at half the
  fat-loss band (0.25–0.5 %/week), which concept-v2 does not name — the note in the file
  says why.
- `{ projected_date, weeks, rate, note, by, unrealistic, standing, metrics[] }`. A goal with
  several metrics takes the **slowest** of them: it is reached when all of it is.
- **The user's own date is never overwritten.** It comes back in `by` beside the
  projection, and `unrealistic` is judged against the *fastest safe* rate rather than the
  profile's chosen pace — so "170 by December" at 0.83 %/week is kept with a note saying it
  is brisker than usual, and only a date that needs more than the band allows is replaced
  by the projection (and `confirm_date: true` overrides even that).
- Measures with no journey — protein, carbs, a daily balance — get no date at all rather
  than an invented one, and a cardio goal with no cardio logged says so: 10 % of nothing
  never arrives.

**`services/goals/detect.ts` — reached and stalled, pure**

- The smoothed rules, verbatim from concept-v2: the **7-day average at/past target on every
  one of the last seven days**; a **lift logged at target on two separate days** (counted
  from the activities, because `exercise_load` answers "the best in four weeks" and one
  number cannot say "twice"); a **weekly volume at target two weeks running**. A week with
  no weigh-in breaks the run — we do not know the goal held.
- **Standing intentions are never reached and never stalled.** `at_least 150 min/week` has
  no finish line to arrive at (concept-v2's outcome-vs-standing split, applied through the
  `direction`).
- **Stalled** = no movement toward the target in three weeks, with "movement" sized per
  measure (0.5 lb on a 7-day average, one plate on a lift, 5 % elsewhere). Unknown is not
  stalled: a user with no data has a logging problem, and the day's reading already says so.
  `stalled_since` cannot predate the goal.
- Both are **candidates**. Nothing in the file changes a status — `reached_candidate_at` and
  `stalled_since` are what WP5's nudge reads, and the user is the one who closes a goal.

**Routes** (`routes/goals.ts` over `services/goals/store.ts`)

- `GET /api/goals` — active in priority order, each with `progress` (per-metric current,
  baseline, target, percent) and the two candidate columns; `history` with the `outcome` it
  ended on; `no_goal`, which is the state the app renders with no judgement colours.
- `POST /api/goals` — spec → validated against the measure catalog → projected → saved
  `active`, priority appended. `confirm_date` keeps the user's date, `no_date` saves it
  open-ended. 400 names the problem ("Best load needs an exercise — say which one").
- `PATCH /api/goals/:id` — title, metrics, priority, and status. **Every closing status
  writes `active_to`**: reached and dropped end today, expired ends on the date it was due.
- `POST /api/goals/reorder` — `{ ids }` applied as 1…n; goals not named keep their place at
  the end.
- `GET /api/goals/:id/progress` — the same per-metric numbers plus a **trend series over the
  goal's life**, thinned to 90 points, from one row load: the calculators ignore rows dated
  after the day they are asked about, so ninety dates cost one query, not ninety.
- Someone else's goal is a 404, not a 403.

**One path for a goal, whoever set it**

`POST /api/log/confirm` with `kind: "goal"` now calls the same `createGoal`, so a goal set
by talking and one typed into the Goals screen get the same validation, the same priority
and the same computed timeline. `POST /api/log/analyze` attaches the proposal to the
preview (`{ result, proposal, evidence, context }`) and overwrites `result.proposed_timeline`
with it — **the model is no longer asked to do the arithmetic**: `GoalDetailOutputSchema`
dropped `proposed_timeline` and the prompt now says to put the user's own date on the
metric's `by` and leave the projection alone. The contract test on the real model checks
exactly that.

**Profile**

- `GET /api/profile` returns the row **plus `targets`** — `tdee`, `eat_target`, `deficit`,
  `safe_floor`, the four macros, `source` (computed | stated | none), `tracking_only`,
  `eatback`, the weight they were computed for and the day they are for. The app can stop
  doing this arithmetic (WP6 deletes `lib/tdee.ts`).
- `PATCH /api/profile` accepts the plan columns (diet_style, protein_g, carbs_max_g,
  training_days, environment, equipment, eatback, constraints, preferences) and **dates
  every field it touches** in `stated_at`, merged rather than replaced. The spoken path
  keeps appending and deduping; an edit from the Profile screen replaces the list, because
  deleting a row is something only a tap can mean.
- `eatback` was already respected by `computeDay`; it now has a test that walks
  none → half → all and watches the allowance move.

**Migration — `backend/migrations/0007_goal_progress.sql`**

- `goals.stalled_since DATE`, the other half of `reached_candidate_at`.
- A backfill giving every non-active goal with no `active_to` an end date, so the day model
  can judge by the **date window alone**. That is the WP3 note closed: `services/day.ts` no
  longer filters `status <> 'dropped'`, so a goal dropped today goes on judging the
  fortnight it was live for and stops judging tomorrow.

**`npm run seed-demo -- <email> [--goal fat_loss|muscle|none]`**

The second scenario flag. `muscle` seeds a `gain_muscle` goal (bench 185 + 175 g protein) so
the muscle cards have something to render; `none` is the no-goal state the morning demo has
to be able to show — it ends the goals *this script* set, dated, and leaves any other goal
alone with a warning. The goal is now written through `createGoal` after the days are
seeded, so the demo's timeline is projected from the demo's own weigh-ins.

**Decisions**

- **`unrealistic` means unsafe, not "faster than your pace".** concept-v2 gives a band
  (0.5–1 %/week), and treating the profile's pace as the ceiling would have overruled a
  user's perfectly safe December date. The projection still runs at their pace; the flag is
  judged at the top of the band.
- **The timeline left the model.** It was in the fusion schema since WP2 (the prompt asked
  for a projection). A date is arithmetic, the Goals screen, the row and the coach all have
  to show the same one, and a model that is asked for a number will produce a different one
  each time. Removing it also shrinks the second call's grammar.
- **A dropped goal keeps its days.** WP3 had to exclude dropped goals entirely; now the
  window governs and the status is only a label. The migration backfills the goals dropped
  before this, using `stated_at` as the closest thing to "when it stopped" the old schema
  recorded.
- **Progress is measured from the baseline**, the metric's value on `active_from` — 195 → 170
  is 0 % at 195, not the 87 % that "current over target" would put on the ring on day one.
  A goal's own percentage is its **slowest** metric, the same rule reached-detection uses.
- **`loadTargets` lives in `services/profile.ts`**, not in the goals module, and the goals
  store imports it. The day model, the goals list and `GET /api/profile` all need "what
  should this user eat today", and it belongs next to the profile it is derived from.
- **No idempotency key on `POST /api/goals`.** The spoken path is idempotent through
  `log_confirmations`; the Goals screen's create is a button a human presses, and a
  duplicate goal is visible and one tap to drop. Worth revisiting if the app ever retries it
  automatically.
- No new dependencies.

**Tests** — 243 passing, 2 skipped (was 185 / 2).

- `src/services/goals/proposal.test.ts` (20): the projection for each measure at each pace
  (pinned to the week counts, so a changed constant fails here rather than surprising
  someone in six months), the brisk-but-safe date, the unrealistic one, a date in the past,
  already-there, no-data, the slowest metric, standing intentions, the confirm card's shape,
  and the catalog validation.
- `src/services/goals/detect.test.ts` (17): every "not reached" case is a day whose raw
  number says the goal is met and whose rule says wait — one weigh-in, the first dip, two
  sets in one session, one good week. Plus a gaining goal from the other side, a two-metric
  goal, and the stall (flat weight, moving weight, a stuck lift, a goal set last week, and a
  reached goal never being called stalled).
- `src/app.test.ts` (+13): the goals API end to end; the close writing
  `reached_candidate_at` and keeping the first one; marking a goal reached and the list
  going empty; yesterday still judged by the goal that was dropped today, and losing its
  judgement when the end date moves before it; the profile's derived targets, the dated
  merge, spoken-append vs edited-replace on constraints, and eatback moving the allowance;
  and analyze → proposal → confirm for a goal set by talking, including "no date" and
  "that date, I meant it".
- `src/test/fixtures/facts.ts`: the `DayFacts` builders WP1's measures.test.ts had grown
  privately, now shared.
- `src/scripts/seed-demo.test.ts` (+2): both new scenarios, spawned for real.
- The Anthropic fusion contract test now asserts the model puts the user's December date on
  the metric and leaves `proposed_timeline` null. Run here, green.

**Deferred**

- **`GET /api/goals` computes progress on every call.** One row load and a handful of pure
  calculators, capped at 180 days of baseline — fine for a handful of goals, and the place
  to look first if the Goals tab ever feels slow.
- **The trend series has no per-week bucketing.** It samples days; a year-long goal is 90
  evenly spaced points, which is what a sparkline wants but not what a "weekly average"
  chart would.
- **Nothing writes `expired` on its own.** A goal whose `active_to` has passed still reads
  as `active` until someone patches it; the day model already stops judging with it. A
  sweep at close would be a one-liner, but auto-changing a status is the thing concept-v2
  says not to do, so it waits for WP5's coach to ask.
- **The reached candidate is not surfaced anywhere yet** beyond `GET /api/goals` — the nudge
  that says "mark it done?" is WP5's.
- **No app screens.** Goals, Progress and Profile are WP6; this is the API they read.

---

## WP3 — Day model, blocks, calorie model, day readings

The day is now a thing the server computes. One function answers "what happened on this
day, and was it any good", and Today, the closed Day, the week, the Days list, the close
job and (next) the coach all read that one answer.

**The calorie maths moved server-side**

- `src/services/tdee.ts` is `lib/tdee.ts` + `lib/recommendations.ts`, ported: Mifflin-St
  Jeor, the ISSN percentage deficit, the 1 %/week cap, the NHLBI/0.8×BMR floor, the macro
  split, the projection. Same constants, same rounding — `tdee.test.ts` pins it to the
  **app's own outputs**, produced by running the shipped `lib/` code over four profiles and
  pasting the numbers in, so a change on either side fails here instead of quietly giving
  the phone and the server two different targets.
- One deliberate difference: `computeTdee` takes **the day being computed** as the date to
  age against. The app read `new Date().getFullYear()` at the call site, which is fine in a
  UI and wrong in a server recomputing March for a December birthday — and untestable.
- `computeDayTargets(profile, weightLb, day)` is the bridge the day model calls: the target
  is derived from **the day's own body weight** (the day's weigh-in, else the most recent
  one before it), falls back to the profile's stated `daily_calorie_target` when the TDEE
  inputs are incomplete, and is `null` when there is neither. A stated `protein_g` /
  `carbs_max_g` beats the computed macro.

**`src/services/day.ts` — `computeDay(db, { userId, date, tzOffsetMin, now })`**

Returns items, blocks, the calorie model, macros, weight, muscle groups, the eating
pattern, the day arc, `expected`, the verdict and a one-line summary. Highlights:

- **Blocks** (`day/blocks.ts`): activities within **90 minutes** of each other, measured
  from the *end* of the previous one so a 60-minute bike does not split the visit. Title
  from the muscle groups with the most sets ("Back & Chest"), or "Walk" / "Run" /
  "Mobility" / "Cardio" for a block with no lifting. Nothing writes `activities.block_id`:
  blocks are computed on every read, which is what makes them something the user never has
  to manage.
- **Health overlap rules** (concept-v2 §Health), the double-count mitigation, unit-tested
  with synthetic samples: a workout overlapping a block is *attached* to it and fills in
  the calories and minutes **only where the user gave none**; one overlapping nothing
  becomes an activity with `source: health` and is counted; a sample already materialised
  as an `activities` row is the same event and is counted once; two workouts over one block
  keep the longest and drop the other. A ±15-minute grace covers a watch started before the
  first log. **Daily active energy is never added to `earned`** — it is the baseline the
  TDEE already accounts for. Body-mass samples become the day's weigh-in only when the user
  logged none themselves.
- **The calorie model**: `eaten = Σ meals`, `earned = Σ blocks + standalone Health`,
  `allowance = target + eatback × earned` (`none|half|all`, default half),
  `balance = TDEE + earned − eaten`.
- **Status** `on_track | over | under | none`: `none` whenever there is nothing to judge
  against — no allowance, or a goal the calorie number does not speak for (a strength goal
  is not served by eating less). Over needs to clear a **100 kcal** tolerance; under is
  more than **25 %** below the allowance, or under the safe floor — and a **live** day is
  not called under-fed before **20:00 local**, because a day that is short at lunchtime is
  a day that is not finished.
- **`delta_vs_last`** per exercise (`day/deltas.ts`): the previous occurrence of the same
  exercise, earlier today or weeks ago. Load first, then sets, then reps, then duration and
  distance — "+5 lb", "+1 set", "-10 lb", "same", "first time".
- **The eating-pattern line and the day arc are computed, not generated** (`day/narrative.ts`):
  back-loaded / front-loaded / the longest gap / evenly spread, and the 6a→11p events with
  the block as a span, NOW, and the dashed `expected` dots (the next meal slot the clock is
  waiting for, and a weigh-in if the day has had none).
- **Verdict** (`services/goals/verdict.ts`), judged against the goal active **on that
  date** (not today's), via the measure catalog: fat loss / maintain → the calorie status;
  muscle / strength → protein against target **plus** training done, with a rest-day rule
  (trained yesterday, or the week already has the planned number of sessions); endurance →
  trailing-7-day cardio minutes against the goal's weekly target at 90 % tolerance; custom
  → its own first metric when that metric is computable; no goal → `none`; nothing logged →
  `unlogged`, never `missed`.

**Readings — the one generated part of a day** (`services/readings/`)

- `right_now` for the live day (≤ 2 sentences + `next_action {label, kind, hint}` and up to
  three `actions` chips) and `in_short` for a closed one, both through `LlmPort` on the
  **coach** model (`COACH_LLM_PROVIDER` / `LLM_MODEL_COACH`).
- The model is given the **computed day sheet** — totals, blocks, deltas, the verdict, what
  is still expected — never the rows, and never a database id.
- Cached in the new `day_readings` table by an **inputs hash** over the day's material
  facts. The clock moving is not a regeneration; a logged meal is. `in_short` is written
  once at close and never revised.
- A missing key or a provider outage returns the last good reading, or `null`, and the day
  renders without it. The reading is the one part of a day allowed to be absent.

**Day close** (`services/dayClose.ts`)

No cron: the close runs on the **first request after the user's local midnight**, because
only the phone knows when that was. Every day-shaped route calls it first; a second request
costs one indexed query. It writes every column from 0004 plus the new ones, and
`closed_at` is the idempotency guard — a closed day is a record, not a cache, so a retry,
a burst at 00:01 and `POST /api/day/close` all converge and the reading is generated once.
Reach is 60 days; days with nothing logged are never written.

**Migration — `backend/migrations/0006_day_readings.sql`**

- `day_readings (user_id, date, kind, inputs_hash, text, next_action, actions, model)`. The
  live day's reading could not live in `daily_summaries`: that row's existence means "this
  day is finished", and Right now belongs to a day that is not.
- `daily_summaries.summary_line`, `.meal_count`, `.tdee`. The Days list has to be one
  indexed read rather than a sentence re-derived from `blocks` jsonb, and the week's
  deficit is Σ(TDEE + earned − eaten) — with no column, recomputing a TDEE for June from
  today's weight would quietly rewrite June.

**Routes**

- `GET /api/day/:date?tz=` — `today` or `YYYY-MM-DD`; live for today (with `right_now`),
  the day plus its `in_short` for a past one. 400 for a future date.
- `GET /api/week?end=&tz=` — seven days of status/verdict, `weekly_deficit`, `served`,
  `judged`. Closed days come from their record, today is computed.
- `GET /api/days?before=&tz=&limit=` — the Days list: verdict words, the one-line summary,
  the day number, `next_before` for the next page. The open day leads the list.
- `POST /api/day/close` — `{ tz_offset_min, date? }`, for tests, admin and the seed script.
  Refuses the day the user is still living.
- The old entry, weight, profile, log, fusion and evidence routes are untouched.

**`npm run seed-demo -- <email> [--tz <min>] [--password …] [--force]`**

Creates or reuses the account (password `demo-pass-123`, set through the same code path as
`reset-password`), a fat-loss goal, a profile the calorie model can work from, and four
days: three closed with a gym block of four exercises, a Health-only rest day, weigh-ins
and macro-bearing meals — with deltas across the two gym days (+5 lb bench, +5 lb row,
+1 set press, pulldown held) — then **today half-lived**, breakfast and lunch in and dinner
still expected. It writes through the same services the API uses and closes the past days
so `in_short` exists. Without an API key its own canned readings stand in, parsed through
the caller's schema. Re-running converges; it refuses an account with more than 10 closed
days unless `--force`.

**Decisions**

- **The day view recomputes; `daily_summaries` is the frozen record.** `computeDay` never
  reads the summary back, so correcting yesterday's lunch shows up immediately in the day
  view, while the closed record stays what was true at close (and the week and Days list
  read that). The cost: after an edit to a closed day, the list and the day can disagree
  until something re-closes it. Judged the right way round — the record is evidence, and
  silently rewriting history to match a late edit is worse than a stale summary line.
- **`under` is `served` for a fat-loss goal.** A deficit day served the goal; the
  under-eating caution is a health signal and the status line already carries it. Marking a
  light day as a failure would be judging the user twice for one number.
- **Status has a `none` that the schema does not.** `daily_summaries.status` allows
  `on_track|over|under` only (0004), so "no judgement" is written as NULL, not a fourth
  value.
- **A dropped goal still judges the days it was live for**, since 0004 has no record of
  *when* it was dropped; the query filters `status <> 'dropped'` and by the date window.
  WP4 owns status changes and can tighten this by setting `active_to` on drop.
- **`localDay` moved out of `services/fusion/context.ts`** into `services/localTime.ts` (it
  re-exports it, so nothing else moved). The day model, the close and the week all need the
  same local-midnight arithmetic, and two copies of it is how a log at 23:30 in Los Angeles
  lands on two different dates.
- **The eating pattern is computed, not an LLM sentence.** Paying a model to notice that
  60 % of the calories came after 6 pm would be slower, dearer and less reliable than
  counting them (concept-v2 §Principles).
- `eslint.config.js`: `no-unused-vars` gained `ignoreRestSiblings` — dropping one key from
  a response by destructuring it out is the readable way, and naming what you drop is the
  point of it.
- No new dependencies.

**Tests** — 185 passing, 2 skipped (was 104 / 2).

- `src/services/day/day.test.ts` (41): clustering (the gym hour, the gap measured from the
  end of an activity, the 90-minute split, titles, Health rows kept out); the overlap rules
  on synthetic samples (attach, fill in only missing calories, standalone, the grace
  window, two workouts over one block); `delta_vs_last` for every field and the
  earlier-today case; the status thresholds including the live-day rule; the verdict for
  every goal kind, the rest-day rule and the unlogged/no-goal cases; the eating-pattern
  lines; `expected`; and the local-day edges (23:30 in Los Angeles, 00:30 in Auckland).
- `src/services/tdee.test.ts` (14): the app's four golden profiles, the exclusions, and
  `computeDayTargets` including the stated-target fallback and tracking-only.
- `src/services/readings/readings.test.ts` (10): both schemas under a 1.5 KB budget against
  the ~4.5 KB grammar ceiling, the day sheet's contents (and that it carries no row ids),
  and the inputs hash — unchanged by the clock, changed by a log.
- `src/app.test.ts` (+13): the live day end to end (one block, the calorie model, macros,
  the weight trend, `+5 lb` against last week's bench, `first time`, the arc, no goal → no
  judgement); the reading generated once and reused until the day changes; Health merging
  over real rows (block attached, walk standalone, active energy excluded from `earned`);
  the close writing every column and its reading, being idempotent, and refusing today;
  the closed day served from its record; the week; the paged Days list; and a meal logged
  at 23:30 local at UTC−7 landing on that local day in the day view *and* in the close.
- `src/scripts/seed-demo.test.ts` (3): the script spawned for real against a real database
  — three closed days with readings, the blocks, the goal, safe to re-run, and it wants an
  email.
- `src/adapters/llm/anthropic.readings.contract.test.ts` (2, skipped without a key, run and
  green here): both reading grammars compile on the coach model and `right_now` comes back
  as at most two sentences with a valid action kind.

**Deferred**

- **The app still computes its own targets.** `lib/tdee.ts` and `lib/recommendations.ts`
  are untouched and the phone reads neither `/api/day` nor `/api/week` yet — WP6 rewires
  the screens and deletes the app-side copy. Until then the two agree because the port is
  pinned to the app's outputs.
- **`activities.block_id` is still unwritten.** Blocks are computed; the column is there
  for a future "the user split this block" edit.
- **No `/api/health/sync`** — WP7 owns it. The overlap rules are already live and read
  whatever is in `health_samples`, which is how the tests and the seed script exercise them.
- **The week and the Days list can lag an edit to a closed day** (see the decision above);
  nothing re-closes a day today.
- **`GET /api/day` is not paginated for a very long day** and returns the whole day's items;
  a day is small.
- **No coach-ask card on the Day view** — `coach_briefs` is WP5's, and the day view has the
  shape ready for it.

---

## WP2 — Evidence storage + fusion endpoints

Logging became multimodal. A photo, a transcript and a typed note now go up together, come
back as one preview, and are saved in one transaction when the user confirms.

**New endpoints**

- **`POST /api/log/analyze`** — multipart (`multer`, memory storage): up to **4 photos**
  ≤ **8 MB** each on the `photos` field (`photos[]` and `photo` also accepted), plus `text`,
  `kind_hint`, `client_time`, `tz_offset_min`. Photos are downscaled with **sharp** (longest
  edge 1600 px, JPEG q82, EXIF stripped by the re-encode), stored, and their evidence rows
  created **before** the model call — so the preview carries `evidence[].id` and the confirm
  that follows can link them. Returns `{ result, evidence[], context }`; nothing is saved.
  400 on an empty log or a stray field name, 415 on a non-image, 413 over 8 MB.
- **`POST /api/log/confirm`** — `{ client_id (uuid), result, evidence_ids[], text,
  text_kind, logged_at, source }`. One transaction: activities (exercise normalised against
  the catalogue, `source` fused when evidence is attached), meal + `meal_items` + meal_type,
  `weight_logs`, `goals` (status active, priority appended), profile constraints/preferences
  with `stated_at`, and the evidence links. Returns the saved rows plus `replayed`.
  422 with the model's question for `kind: "unclear"`.
- **`GET /api/evidence/:id`** — auth + ownership, streams the file with
  `Cache-Control: private, max-age=31536000, immutable` and an ETag. Someone else's id is a
  404, not a 403.
- **`POST /api/log` and `/api/parse-log` are unchanged for the app**, but `/api/log` now
  *saves* through the fusion pipeline (`saveConfirmed` per parsed item, one transaction),
  and keeps the typed line as a `text` evidence row.

**Ports, adapters, storage**

- `src/ports/storage.ts` — `EvidenceStore { describe, put, get, delete, stat }`. Keys are
  opaque; only the adapter interprets them.
- `src/adapters/storage/local.ts` — a directory, keys `YYYY/MM/<uuid>.<ext>`. Rejects any
  key that could climb out of the root, twice (pattern, then resolved-path check).
  `src/test/fakes/storage.ts` is the in-memory fake the integration tests run on.
- `container.ts` builds it from `EVIDENCE_STORAGE` (`local`; an unknown name refuses to
  boot) and `EVIDENCE_DIR` (default `./uploads` in dev, `/app/uploads` in production).
  `docker-compose.yml` gains the **`trackdown_uploads`** volume; the Dockerfile creates
  `/app/uploads` owned by `node` so the unprivileged process can write to a fresh volume.
- **Sweep on boot** (`sweepUnlinkedEvidence`, called from `server.ts`): evidence with no
  `confirmed_at` older than 24 h is deleted, row and file. That is what pays for storing
  photos before the confirm.

**Migration — `backend/migrations/0005_evidence_confirm.sql`**

- `evidence.confirmed_at` — the sweep's test. Absence of an owner id could not be it: a
  weight, a constraint and a coach context have no owner column to point at.
- `log_confirmations (user_id, client_id, result jsonb)` — the idempotency ledger. The
  confirm claims the `client_id` first; a concurrent duplicate blocks on the primary key and
  then replays the first attempt's response verbatim.

**Decisions**

- **The provider's grammar limit shaped the schema.** Anthropic compiles a structured-output
  schema into a decoding grammar and refuses one over roughly 4.5 KB ("The compiled grammar
  is too large") — on Haiku *and* Sonnet. The eight-branch union from the plan is 8.9 KB and
  does not compile. So `services/fusion/schema.ts` holds two shapes: the **public**
  `FusionResultSchema` (the eight kinds, what the API returns and the confirm accepts) and a
  **model-facing** routing schema at 4.0 KB that the service widens back
  (`toFusionResult`). The three differences: constraint / preference / coach_context share
  one `statement` branch with a `scope`; `photo_fields: string[]` replaces the per-field
  source object (one array node instead of seven `anyOf`s) and is expanded into the
  documented `sources` map on the way out; and the two plan-shaped kinds — a goal's spec and
  a constraint's plan fields — come from a **second focused call**. Logging a workout or a
  meal, the hot path, is still one call. This was found by the contract test, which is the
  reason it exists.
- **`category` and `muscle_groups` are not asked of the model.** `services/entries.ts`
  already fills them from the catalogue when it recognises the exercise, and two sources for
  one fact is how they drift apart.
- **`/api/log` keeps the v1 parser** rather than routing through `/api/log/analyze`. A typed
  log is routinely several things at once ("protein shake after my 30 min walk, 181 on the
  scale") and the fusion schema is one log, one kind; sending that text through analyze would
  throw two of the three items away. The parser does the multi-item split, confirm does the
  write — one save path, no regression for the shipped app.
- **DATE columns now come back as `YYYY-MM-DD` strings** (`db/client.ts`). node-postgres
  handed back a `Date` at the *server's* midnight, which JSON renders in UTC and which turns
  a goal's `2026-12-01` into `2026-11-30` for anyone west of it. Day boundaries are the
  user's local midnight; a DATE is a calendar date, not an instant. This is what PostgREST
  did too, so nothing in the app changes.
- **Photos are stored before the model is asked.** The alternative — hold 4 × 8 MB in memory
  until the user confirms — makes the server's memory a function of how many people are
  hesitating. The cost is unconfirmed rows, which is what the sweep is for.
- **Evidence for a weight, a constraint or a coach context has no owner id** (the table has
  columns for activity / meal / goal only). It is still marked confirmed, which keeps the
  sweep off it.
- New dependencies: **`sharp`** (server-side downscale — the plan's safety net behind the
  phone's own resize) and **`multer`** + `@types/multer` (multipart parsing; nothing in
  Express 5 does it). sharp is imported directly in `services/images.ts`, not behind a port:
  it is a local library like `pg`, with no key, no vendor and nothing to swap. The eslint
  boundary stays about provider SDKs.

**Tests** — 104 passing, 2 skipped (was 62 / 2).

- `src/app.test.ts` (+12): a real multipart upload of a generated 2400 × 1200 PNG comes back
  1600 × 800 as `image/jpeg` and the stored bytes really are a JPEG; the model was sent the
  image, the catalogue and the kind hint; nothing is saved by analyze. Then the photo streams
  back to its owner and 404s for a stranger, for an unknown uuid and for a non-uuid. Too many
  photos → 400, a text file → 415, 9 MB → 413, an empty log → 400. Confirm covers every kind:
  activities (catalogue spelling, the user's edited load, `source: fused`, both evidence rows
  linked to the activity), meal + items + slot, weight, two goals (priority 1 then 2, the
  timeline as `active_to`), constraint then the same constraint again (not duplicated), a
  preference that sets plan fields and dates them, coach context that writes no row, and
  `unclear` → 422. Idempotency: the same `client_id` twice → `replayed: true`, the same
  activity id, one row in the table. Another user's evidence id is simply not linked.
- `src/services/fusion/fusion.test.ts` (16): local-day arithmetic across a timezone,
  the prompt (today's items, the vocabulary, the goals, the empty-day and kind-hint wording,
  and that v1's grouping rules survived), the schema accepting all eight kinds and refusing a
  goal about a measure the app cannot compute, the widening (`statement` → three kinds,
  `photo_fields` → the source map, catalogue-derived fields left null), and the analyzer's
  two-call paths — a second call for a goal and for a constraint, none for coach context.
- `src/services/images.test.ts` (4) — the downscale, the small-image passthrough, EXIF gone,
  non-image rejected, the accepted mime list.
- `src/adapters/storage/local.test.ts` (4) — put/stat/get/delete on a real temp directory,
  double delete, unknown key, and four path-traversal keys refused.
- `src/adapters/llm/anthropic.fusion.contract.test.ts` (2, skipped without a key, run and
  green here): a tiny generated JPEG plus "I ran 2 miles in 18 minutes" comes back as
  `activities` with `distance_mi` 2, `duration_min` 18 and `sets` null; "get down to 170
  pounds by December" comes back as a `goal` on `body_weight`, through both calls. The key
  is read through `config` and never printed.
- `src/test/fakes/llm.ts` gained an `outputs` queue, for the two-call paths.

**Deferred**

- **Rate limiting on `/api/log/analyze`** is still the global 600/15 min — WP8 owns the
  per-endpoint limit and the cost logging.
- **Prompt caching for the second call.** The goal/plan-fields follow-up re-sends the same
  images. It is rare enough not to matter, and `cache_control` is not in `LlmPort` yet.
- **Backing up the `trackdown_uploads` volume** to TrueNAS is a deploy-side change (WP8).
- **`EVIDENCE_STORAGE=s3`** has no adapter; the config name refuses anything but `local`.
- **`coach_context` saves no row.** The text comes back on the confirm response and is kept
  as evidence; WP5 decides where a day's context lives.
- **`transcript` evidence is written by the client** telling us `text_kind: "transcript"`.
  There is no server-side transcription (WP8's `TranscriptionPort`).

---

## WP1 — Schema v2

The v2 tables, the exercise catalogue, and the measure catalog as code. No new endpoints —
WP2–WP5 fill these in. Everything is additive or a rename, so the deployed app and the rows
already on the Docker host stay valid.

**Migration — `backend/migrations/0004_v2.sql`** (0003 was WP0a's `account.issuer`)

- `calorie_expenditure` → **`activities`**, plus `exercise`, `exercise_id` (FK →
  `exercise_catalog`), `category`, `muscle_groups text[]`, `sets`, `reps`, `load_lb`,
  `distance_mi`, `source` (manual|fused|health, NOT NULL default `manual`), `confidence`,
  `external_id`, `block_id`. Every column nullable or defaulted.
- **`exercise_catalog`** (name unique, aliases, category, primary/secondary muscles,
  equipment) + a GIN index on aliases and a unique index on `lower(name)`.
- **`evidence`** (photo | transcript | text; `storage_key`, `mime`, `width`, `height`,
  `text`; FKs to activity / meal / goal with a CHECK that at most one is set).
- **`health_samples`** (kind, external_id, start/end, value, unit, raw jsonb).
- **`goals`** (kind, title, metrics jsonb, priority, status, active_from/to, stated_at,
  reached_candidate_at) — the spec from concept-v2 §Goals.
- **`profiles`** + diet_style, protein_g, carbs_max_g, training_days, environment,
  equipment[], constraints[], preferences[], eatback (default `half`), stated_at jsonb.
- **`daily_summaries`** + eaten, earned, allowance, status, verdict, blocks jsonb,
  muscle_groups[], in_short, closed_at.
- **`coach_briefs`** (date, asked_at, context, workout/nutrition jsonb, nudge, rationale,
  model, inputs_hash) with a partial unique index on (user_id, date, inputs_hash) — the
  per-day cache key.

**Exercise catalogue**

- `backend/data/exercises.json` — **126** exercises (93 strength, 25 cardio, 7 mobility, 1
  "Other Activity" fallback), each with aliases, category, primary/secondary muscles and
  equipment. Aliases are the spoken forms ("db bench", "rdl", "stairmaster") the fusion
  prompt has to resolve.
- `src/db/exercises.ts` — validating loader + `seedExercises()`, an upsert **by name** (one
  jsonb payload, not parallel arrays: `text[]` columns of different lengths cannot travel as
  a rectangular multidimensional array). Rows the JSON stops listing are left alone — an
  activity may still point at one.
- Run automatically by `npm run db:migrate` after the SQL, by `npm run db:seed-exercises` on
  its own (for a JSON-only change), and by `src/test/db.ts`. `Dockerfile` now copies `data/`
  alongside `migrations/`.

**`services/goals/measures.ts`** — the measure catalog as code

Twelve typed descriptors `{ id, label, unit, scope?, windowDays, derivedFrom, compute(ctx) }`
over a `DayFacts` input (the day, a trailing window of meals / activities / weights / Health
samples, and the day's TDEE). Pure: no SQL, no clock, no LLM — WP3/WP4 build the `DayFacts`
and call in. `body_weight` (7-day average, each day counted once), `calorie_balance` (TDEE +
earned − eaten, positive = deficit), `protein_g`, `carbs_g`, `weekly_sets` (scope: muscle),
`exercise_load` (scope: exercise, best in 4 weeks), `weekly_cardio_min`, `distance_mi`,
`pace` (total time ÷ total distance), `steps`, `resting_hr`, `vo2`.

**`/api/entries/movement` still works**, now as an alias over `activities` (`KINDS.movement`),
and `POST`/`PATCH` also accept `exercise, category, muscle_groups, sets, reps, load_lb,
duration_min, distance_mi, source, confidence`. A recognised `exercise` is stored under the
catalogue's spelling with its `exercise_id`, and fills in `category` / `muscle_groups` when
the caller gave none.

**Decisions**

- **`activities.exercise` is text beside `exercise_id`.** The catalogue normalises names; it
  does not decide what a user is allowed to log. An unknown exercise keeps what the user said
  and gets a null `exercise_id`.
- **`duration_minutes` renamed to `duration_min`**, not duplicated. Nothing in the app or the
  API reads it (grepped), and two columns for one fact is how data goes wrong.
- **`health_samples` is unique on `(user_id, external_id)`**, not `external_id` alone: two
  phones can mint the same sample uuid, and one user's import must never collide with
  another's. `/api/health/sync` is still idempotent.
- **concept-v2's `plans` table became columns on `profiles`.** It is strictly 1:1 with the
  user, so this is one row to read instead of two.
- **`protein_g` / `carbs_g` return null on a day with no meals, not 0.** An unlogged day must
  not judge as a perfect one; its verdict is `unlogged`.
- **`weekly_sets` needs its scope** and returns null without one — an unscoped "sets this
  week" would be a different number pretending to be the same one.
- **Health-derived measures return null with no samples**, asserted in a test that loops over
  every `derivedFrom: "health"` measure, so adding one cannot quietly break "works without
  Health".
- `runMigrations` gained `upTo` (stop after a named file) purely so a test can build a
  database at the old schema and migrate it forward with data in it.
- No new dependencies.

**Tests** — 62 passing, 2 skipped (was 28 / 2).

- `src/db/migrations.test.ts` (10): a database at 0001–0003 with a user, a profile, a
  `calorie_expenditure` row and a `daily_summaries` row is migrated forward — the movement row
  arrives in `activities` with its description, kcal and duration intact and every v2 column
  null; the profile picks up the plan defaults; the new CHECKs reject bad enum values; Health
  ids are unique per user, not globally. Then a *fresh* database (a second database on the
  same server, so no second Postgres has to start) gets the whole schema and a seeded
  catalogue in one run. Plus catalogue seeding convergence and alias lookup.
- `src/services/goals/measures.test.ts` (22): every calculator on fixtures — window edges,
  case-insensitive scopes, the null-not-zero rules, and the catalog's own integrity.
- `src/app.test.ts` (+2): the movement alias saves the v2 fields and normalises "db bench" →
  "Dumbbell Bench Press"; an exercise the catalogue does not know is still saved. The rest of
  the suite is unchanged and passes against the renamed table.

**Deferred**

- No routes for goals, evidence, health or the coach — WP2/WP4/WP5/WP7 own those. The tables
  and the measure calculators are here waiting for them.
- `evidence.storage_key` has a unique index but nothing writes it yet (WP2).
- `src/scripts/migrate-from-supabase.ts` now maps Supabase's `calorie_expenditure` to our
  `activities`. That script's real run is done; the change keeps a rehearsal honest but is
  untested against a live Supabase.

---

## WP0a — Email + password auth

Sign-in is email + password. v1's email-OTP flow is gone: there is no SMTP server, so the
6-digit code was never going to arrive.

**Backend**

- `src/auth.ts` — `emailOTP()` replaced by `emailAndPassword: { enabled: true,
  minPasswordLength: 8 }` (exported as `MIN_PASSWORD_LENGTH`, mirrored by the app). The
  `bearer` plugin and the `profiles`-row creation hook are unchanged. Endpoints:
  `POST /api/auth/sign-up/email` (name, email, password — auto-signs in),
  `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`. The old
  `/api/auth/email-otp/*` and `/api/auth/sign-in/email-otp` now 404 (asserted in a test).
- `emailAndPassword.sendResetPassword` is deliberately **unset**: Better Auth then refuses
  `/request-password-reset` outright, which is honest while no mail server exists.
- `migrations/0003_account_issuer.sql` — Better Auth 1.7 requires `account."issuer"`
  (`local:credential` for email+password). 0001 predates it because the OTP flow never
  wrote an account row; email+password does, so the column had to exist before the first
  sign-up. Added nullable, backfilled `'local:' || "providerId"`, set NOT NULL, plus the
  unique `(issuer, accountId)` index Better Auth looks accounts up by.
  **Note for WP1: the schema-v2 migration is now `0004_v2.sql`, not `0003_v2.sql`.**
- `src/services/password.ts` + `src/scripts/reset-password.ts` —
  `npm run reset-password -- <email> <newPassword>`. Everything goes through
  `auth.$context`: `password.hash` (the exact hasher sign-in verifies with) and
  `internalAdapter.updatePassword` / `createAccount`, the same two branches Better Auth's
  own `/reset-password` takes. No hashing is written by hand. It also gives a v1 OTP-era
  account — a user row with no credential account at all — its first password.
- `src/ports/email.ts` (`EmailPort`) + `src/adapters/email/smtp.ts`
  (`createSmtpEmailer`) — the old `createSmtpOtpSender` generalised. Nothing sends mail
  today; the port is kept so password-reset emails have somewhere to land once SMTP
  exists. Without `SMTP_HOST` it logs the message instead of sending it (unit-tested).

**App**

- `lib/auth.ts` — `emailOTPClient` plugin removed; `signIn(email, password)` and
  `signUp(email, password)` replace `sendSignInCode` / `verifySignInCode`. `signUp` sends
  the email's local part as Better Auth's required `name`.
- `app/(auth)/sign-in.tsx` — one screen, two modes: a password field
  (`secureTextEntry`, min 8, checked client-side before the request) and a
  "No account yet? Create one" / "Already have an account? Sign in" toggle. Backend error
  messages are surfaced verbatim, so a duplicate sign-up reads "User already exists…".
  Kept in the existing cream/Fraunces style — WP6 restyles it.

**Decisions**

- Duplicate sign-up returns 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` rather than Better
  Auth's silent enumeration-protection response, because that response only applies with
  `requireEmailVerification` or `autoSignIn: false`, and neither is on. This is what the
  build plan asked for ("a clear already-exists error").
- New dependency `@better-auth/core@^1.7.2` (already installed transitively by
  `better-auth`) — for `createLocalAccountIssuer`, so the reset script writes the same
  issuer string Better Auth does instead of hard-coding `"local:credential"`.
- The OTP user row on the production database was **not** touched. Give it a password with
  the reset script.

**Tests** — `backend`: 21 passing (was 13). New/rewritten: sign-up creates user + profile,
sign-in with the right password, wrong password and unknown email both 401, password under
8 rejected, duplicate email rejected, sign-out kills the token, OTP endpoints 404, reset
script updates an existing password, reset script creates a first password for an OTP-era
account, reset script rejects unknown email / short password, SMTP console fallback.

**Deferred** — self-service password reset (needs SMTP), and the `EmailPort` is
implemented but not yet called from anywhere.

---

## WP0 — Ports & adapters

Third-party services now sit behind interfaces, so swapping one is an env var.

**New**

- `src/ports/llm.ts` — `LlmPort.parseStructured({ system, messages, schema, schemaName,
  maxTokens })`. Messages carry **text and images** (`{ type: "image", mediaType:
  "image/jpeg" | "image/png", base64 }`) even though only text is used today: WP2 sends a
  machine photo plus a spoken set/rep count as one call, and the port had to be designed for
  that now rather than widened later. Vision is folded in here — no separate `VisionPort`.
- `src/adapters/llm/anthropic.ts` — `messages.parse` + `zodOutputFormat`. Keeps the optional
  `anthropic-workspace-id` default header (`ANTHROPIC_WORKSPACE_ID`) that identity-linked
  keys require.
- `src/adapters/llm/openai.ts` — `responses.parse` + `zodTextFormat`, images as
  `input_image` data URLs. New dependency: `openai@^7.8.0` — the second adapter is what
  proves the port is an abstraction and not a rename.
- `src/adapters/llm/unavailable.ts` — the "no API key" adapter. A missing key must not stop
  the server booting (sign-in, manual logging, every CRUD endpoint are unaffected); it fails
  at the one call that needed it, naming the variable.
- `src/container.ts` — the composition root. Builds `llm`, `coachLlm` and `email` from
  config; a provider with no adapter throws.
- `src/test/fakes/llm.ts`, `src/test/fakes/email.ts` — the fakes integration tests use. The
  LLM fake validates through the caller's own schema, so it cannot return a shape the real
  provider could not.

**Changed**

- `services/parseLog.ts` is provider-neutral: it owns `SYSTEM_PROMPT` and the zod schema and
  exports `createLogParser(llm: LlmPort)`. `createClaudeLogParser` and its Anthropic import
  are gone. `LogParser` (what routes depend on) is unchanged.
- `config/index.ts` gained `LLM_PROVIDER`, `COACH_LLM_PROVIDER` (defaults to `LLM_PROVIDER`),
  `LLM_MODEL_FUSION`, `LLM_MODEL_COACH`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`. An unknown
  provider name throws at boot. Per-provider default models live in `config.llm.defaultModels`
  (anthropic `claude-haiku-4-5` / `claude-sonnet-4-5`, openai `gpt-4.1-mini` / `gpt-4.1`) —
  one source of truth, also used by the contract tests. `ANTHROPIC_MODEL` still works as an
  alias for `LLM_MODEL_FUSION` so the deployed `.env.production` keeps working.
- `eslint.config.js` — `no-restricted-imports` for `@anthropic-ai/sdk`, `openai` and
  `nodemailer` (and their subpaths, e.g. `@anthropic-ai/sdk/helpers/zod`) everywhere except
  `src/adapters/**`. Verified by temporarily importing all four into `routes/log.ts`: 4
  errors; codebase clean again afterwards.
- `.env.example` and `docker-compose.yml` document and pass through the new variables.
  `TRANSCRIPTION_PROVIDER` and `EVIDENCE_STORAGE` are listed as "not read yet" — their ports
  arrive with WP8 and WP2 rather than as dead config now.

**Decisions**

- `schemaName` is part of the port because OpenAI's structured outputs require a
  model-visible schema name; the Anthropic adapter ignores it.
- OpenAI assistant-role messages with array content are flattened to text — assistant turns
  are context we wrote and never carry images, and the Responses API wants `output_text`
  there.
- Contract tests build their client lazily: an SDK constructed with an empty key throws, and
  that would fail the file instead of skipping it.

**Tests** — 28 passing, 2 skipped (was 21). New: 3 container tests (per-provider wiring,
missing key names the variable at the call, unknown provider refused), 2 `createLogParser`
tests over the fake port, and 2×2 adapter contract tests (structured parse + an image part,
checked against a 16×16 red PNG). `app.test.ts` now drives the real `parseLog` service over
the fake `LlmPort` instead of a fake `LogParser`, with every assertion unchanged.

**Deferred / uncertain**

- **The OpenAI contract tests have never run**: `backend/.env` has no `OPENAI_API_KEY`, so
  both skip. The adapter typechecks against the real SDK types, but "LLM_PROVIDER=openai
  parses with a real key" from the WP0 acceptance list is unverified, and the openai default
  model names are a reasonable guess rather than a tested value. Add a key and run
  `npm test` to close this.
- `CoachPort`, `TranscriptionPort` and `EvidenceStore` are not built — they would be empty
  interfaces with no caller. They arrive with WP5, WP8 and WP2.
