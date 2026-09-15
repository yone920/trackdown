# TrackDown v2 — logger + coach

Concept written 2026-08-29 from the product conversation; revised the same day: **no explicit
sessions — the day is the session**, and the coach is on demand. Supersedes the "AI calorie tracker"
framing in the April brief. v1 (what is built) is a text logger with a Claude parser; v2 makes
logging multimodal and day-based, and adds an on-demand coach.

## The shift in one sentence

**Log anything, any time, by narrating, photographing or typing — each log merged into one accurate
record, the day closing itself into a daily record — and, when asked, get one recommendation for
what to do next, grounded in that history.**

Two jobs, one loop: the better the log, the better the coaching; the coach's recommendation
becomes tomorrow's log.

## Principles

1. **Evidence in, one record out.** Every log is one thing you did — an exercise, a meal — and
   the photo, narration and typed note attached to it are *evidence*. Claude fuses the evidence
   into one record — the photo names the machine, the narration gives sets × reps × load — and
   the record shows what each fact came from.
2. **Nothing is required except the user.** Apple Health is a bonus source that fills gaps
   (walks, steps, phone-measured workouts). Everything works identically on Android or with
   Health off.
3. **Confirm, don't trust.** Every AI reading is shown before it counts, editable in one tap.
   Confidence is stored, and the coach discounts low-confidence data.
4. **Facts are computed, advice is generated.** The coach's inputs (what muscle groups were
   trained when, last load per exercise, macro adherence) are SQL, not LLM memory. The LLM
   only turns those facts into today's recommendation. Cheap, consistent, testable.
5. **"What's next", when asked.** The coach is a button, not a schedule: tap it and get today's
   workout with concrete loads and today's eating guidance, from everything logged so far.
   Cached for the day so asking twice is consistent and free. No weekly programs, no pushes.
6. **Never make the user open or close anything.** No sessions to start. The day is the
   container and it closes itself.
7. **One input mechanism for everything — and NO FORMS, ever.** Logging an exercise, a meal,
   a weight, asking the coach, setting goals, correcting anything already logged: the same
   Photo / Speak / Type panel. Claude classifies and routes; the app shows what it understood
   on a review screen ("Does this look right?" → Log it / Make a change); a change is *told*
   ("reps were 3, not 4"), never typed into a field. There are no editable field grids
   anywhere in the app. The single exception is the sign-in screen (passwords cannot be
   spoken). This is a product law, not a styling preference — user decision 2026-08-31.
   The one sheet **introduces itself by the door it was opened from** (`lib/log-framing.ts`,
   2026-09-01): the + asks what you did, the You page asks about you, the plan door says it
   is changing the plan. Only the words change — same panel, same reader, same routing.
8. **Log reality only — the app never shows what you were supposed to do.** A day with one
   meal in it shows one meal: no "Dinner — not logged yet" row, no dashed ghost dot on the
   arc, and no reading that says a meal is *due*, *expected* or *missing*. Anything logged
   can also be taken back where it is shown — one tap to ask, one to delete — because a
   record of reality has to be correctable. Arithmetic about what is left is welcome ("a
   ~650 kcal, 45 g-protein dinner would close today's targets"); an instruction is not, and
   the Right-now action chips are shortcuts to a screen, never reminders. Also a product
   law — user decision 2026-08-31.

## Logging

### The day is the session

There is nothing to start or stop. Each log — "did push-ups, three sets", a photo of the
treadmill display, a plate of food — is its own event with a timestamp, confirmed and saved in
one action. The day view is the running session: what was logged, calories in vs burned, macros,
activities. At day end (midnight, or the next app open) the day closes itself into a **daily
record** (`daily_summaries`, already in the schema): totals, every item, muscle groups worked,
weight if logged. Nothing for the user to remember.

**Auto-grouping** gives back the "one workout" summary without a session: activities logged
within 90 minutes of each other form a *block* in the day view — "Gym · 6:10–7:05 pm · 5
exercises · 430 kcal". Blocks are presentation and coach input only; the rows stay individual
activities, so a block is never something the user has to manage.

### Evidence → activity (the fusion pipeline)

```
 evidence for one log                           fusion (Claude, vision + text)              result
 ─────────────────────                          ─────────────────────────────              ──────
 📷 photo of the machine / weight stack  ─┐     one call, structured output:                activity
 🎤 "shoulder machine, 3 sets of 10,      ├──►  exercise (canonical name), muscle groups,   + evidence
     forty kilos"  → on-device transcript ─┤     sets, reps, load, duration, distance,       + confidence
 ⌨️  typed note                           ─┘     kcal estimate, confidence per field   ──►   shown for confirm
                                                context: today so far, units, the user's
                                                exercise history (name consistency)
```

- Voice is transcribed **on the phone** (iOS `SFSpeechRecognizer` via `expo-speech-recognition`;
  Android equivalent). No audio leaves the device; the transcript is editable before it is sent.
  Cloud transcription (OpenAI) is a fallback only if gym noise defeats on-device recognition.
- Photos are downscaled on the phone (~1280 px JPEG, ~300 KB) and stored on the Docker host
  (volume `trackdown_uploads`, served only through an authenticated route, backed up to TrueNAS).
- The fusion prompt gets today's earlier items and the user's exercise vocabulary, so "same
  machine as before, 45 this time" resolves and names stay consistent across weeks.
- Exercise names are normalised to a catalogue (`exercise_catalog`: name, category, primary and
  secondary muscle groups, equipment). This is what lets the coach say "no pulling movement
  since Monday".
- Strength calories are estimates (MET-based from block duration and body weight); cardio
  machine displays are read as-is. The UI labels which is which.

### Apple Health / Health Connect (optional source)

Synced on app foreground: workouts, steps, active energy, body mass.

| Situation | Rule |
|---|---|
| Health workout overlaps a block of logged activities | Attach it to the block as the *measured* source; use its duration/kcal where the user gave none. Never a second entry. |
| Health workout with no logged activity (a walk, a phone-detected run) | Auto-create an activity, `source: health`, editable, shown with a Health badge. |
| Daily active energy | Used as the day's baseline burn for the coach's energy balance; logged activities are not added on top of it a second time. |
| Body mass samples | Become weight logs (`source: health`) — the scale-photo feature becomes optional. |
| No Health at all | Nothing changes; all rows are `source: manual`. |

### Goals and profile — said, not typed into a form

"I want to get down to 80 kg by December, low-carb, four days a week, I weigh 91 now, bad
left knee." The same pipeline classifies this as a *plan update*, extracts structured fields
(goal weight, target date/pace, diet style, training days, environment, constraints, current
weight → a weight log), shows them for confirmation, and saves. The **Profile** screen renders
the plan organised — current weight and trend, goal and pace, daily target, diet style, training
days, constraints — each field with the date it was last stated, so the coach knows how old a
plan is. Updating is the same sentence again ("switching to keto"); a single field can also be
corrected with a tap.


## Goals — measurable specs, optional, two kinds

Goals are **optional**. With none, the app runs on a built-in standing intention (*stay
consistent, train the whole body, eat around maintenance*) and shows no green/red judgement.

- **Outcome goals** have a finish line: reach 170 lb, bench 185, run 5k under 27:00. Done when
  the measure says so (smoothed: 7-day-average weight at/under target for a week; a lift logged at
  target twice; weekly minutes hit two weeks running) — the coach then asks "Mark it done? What's
  next?". Never auto-closed, never invented.
- **Standing intentions** have no finish line: stay active, train 3×/week, keep weight steady,
  "focus on upper body for two months" (optional window). End when replaced, expired, or dropped.

A goal is stored as a **spec**, produced by the same input pipeline from what the user says and
confirmed before saving:

```
{ kind: lose_fat | gain_muscle | build_strength | improve_endurance | maintain | custom,
  title, metrics: [ { measure, scope?, target?, unit?, direction, rate?, by? } ],
  priority, status: active | reached | expired | dropped, active_from, active_to, stated_at }
```

`measure` comes from a **catalog the app can actually compute** from logs/Health: body_weight
(trend), calorie_balance, protein_g, carbs_g, weekly_sets (scope: muscle group), exercise_load
(scope: exercise), weekly_cardio_min, distance_mi / pace, steps, resting_hr, vo2 (Health).
Each measure has one calculator and one widget. New measure = one calculator + one widget.

Timelines are **proposed, not required**: safe rates (fat loss 0.5–1 %/week, a plate step every
1–2 weeks, cardio +10 %/week) give a projected date the user can accept, change, or drop. An
unrealistic user date is kept alongside the projection and said so. A stalled outcome goal (no
movement for 3 weeks) becomes the coach's nudge with an offer to adjust.

Multiple goals are allowed with a priority order; the primary decides Today's headline cards and
the coach's main focus; secondaries show as a strip. Past goals stay in history, and every closed
day is judged against the goal active **that day**.

The input classifier routes statements to: log · goal · constraint · preference · coach context,
always showing what it understood before saving.

## The tabs — Home · Train · Eat · Progress · You

Revised 2026-09-01, twice. First the app stopped landing on Today, which is the right page
when something is happening and the wrong one when nothing is. Then eating got a tab, which
left Today holding a calories card while another tab owned calories — two answers to one
question. So **each tab owns one verb**: Home is the whole day, Train is the session, Eat is
the food, Progress is the long view.

- **Home** — the morning glance, and the only page that thinks in whole days: the day
  number and its verdict (suppressed on a day nothing has happened on), the goal and its
  progress, the **Right now** reading — which reads food and training together and so
  belongs on neither half of them — one line of calories that opens Eat, the button into
  the session, the 7-day weight and the week in two numbers. Everything on it is a fact
  about the day or a door to the tab that owns the detail. **Nothing on Home can generate
  a plan.**
- **Train** — the session, and nothing else: the plan ticked off, each done line showing
  what was actually logged under what was asked for and opening those records, off-plan work
  under "Also" in the same card, Adjust / Replace, and *Start today's workout* — the only
  generator in the app — when there is no plan. No food, and no whole-day framing.
- **Eat** — the other half of the day, in four layers: today's numbers (the same arithmetic
  Today shows), the rolling seven-day averages against their targets — **computed**, with
  each target saying whether it was stated, derived or a guideline, and **the open day is
  never in them**: a day still being lived cannot be judged, and it has its own live layer
  above — a short **written**
  paragraph on which way to steer the nutrients (never a dish), and the food log. The
  paragraph is a cached reading, so opening the page generates nothing.
- **Progress** now opens with the **Days** list; there is no Days tab. **You** is unchanged.
  Today's row in the Days list goes to the **Train** tab rather than to a second copy of
  today; `/today` and `/days` both redirect.

## The two day views

- **The open day** is live, and it is split across Home (the day number, the verdict, the
  goal, the reading, the calories glance), Train (the session) and Eat (the food). Before
  2026-09-01 it was one page, described here as: a header stating where you are (day N, on
  track), the goal banner and
  goal-driven cards, a **Right now** reading (≤ 2 LLM sentences regenerated on each log: what's
  done, what's short, the one best next action), a **day arc** (6a–11p line: logs as dots,
  workout as a bar, NOW), then Do, Done, Eat and Body. Training is grouped the way the closed
  day groups it — Cardio with its minutes first, then muscle headings with set counts, every
  activity drawn exactly once — with the session's time span as a note rather than as the
  grouping principle. Only what was logged is on it — no ghost dot and no placeholder row for a
  meal nobody has eaten (§Principles 8). Every logged row is three targets: the exercise name
  opens its sheet, the ✕ deletes it in two taps, and the rest of the row opens it for a
  correction.
- **Day** (closed) is a reading, not a replay: verdict vs the goal active that day, an **In
  short** paragraph written at day close, training by muscle group with each exercise's load and
  its delta vs last time, eating as macros vs targets + a pattern line + meals by slot, body,
  the coach ask made that day. The raw entries live behind "See the log as recorded" with export.

## Calories — no negative counter

The original brief's model (start the day at −3,000, eat toward zero, workouts push it further
negative) is dropped: the number means nothing at 8 am and frames eating as debt. Instead:

- **Eating ring, fills up.** "1,450 eaten · 650 left" against today's target, derived from TDEE
  and goal pace (`lib/tdee.ts`, `lib/recommendations.ts`). Starts empty.
- **Workouts show as earned, not as a moving target.** "+300 earned from your walk" on its own
  line. A plan setting decides how much of it the ring lets the user eat back — none / half /
  all, default **half** (machine and app burn estimates run high).
- **Status line instead of a signed net.** *On track for a 500 kcal deficit* / *Over by 120* /
  *Under-eating: 900 below target*. This is the brief's red/green day indicator, worded as a
  judgment.
- **The week is the unit.** Seven day-dots, green/red, plus the weekly deficit total — "−2,900 of
  −3,500 this week ≈ 0.4 kg". Daily wiggle is noise; the week is what moves weight.
- **Strength calories are estimates** (MET-based from block duration and body weight); cardio
  machine displays are read as-is. The UI labels which is which — a block whose lifts gave no
  number carries a quiet "est." beside its figure. A barbell prints nothing, and a real session
  that reads "0 kcal earned" is a worse lie than an estimate that admits to being one.

Definitions: `target = TDEE − deficit(goal pace)`; `eaten = Σ meals`; `earned = Σ activities
(manual or Health, never both for the same block)`; `allowance = target + eatback × earned`;
status compares `eaten` to `allowance`; deficit for the week = Σ(TDEE + earned − eaten).

## Coach

### Inputs

- **Plan** (new profile section, set once, edited any time): goal (lose fat / gain strength /
  maintain), target weight and pace (exists), diet style (e.g. lower-carb, high-protein, a
  calorie deficit), training preferences (days per week, gym vs home, equipment, focus), and
  constraints (injuries, exercises to avoid).
- **Computed features** (SQL/TS, recomputed nightly and on demand): days since the last workout;
  per muscle group — days since last trained, weekly set volume; per exercise — last load × sets × reps, best in 4
  weeks, trend; cardio minutes this week; workout blocks this week vs plan; energy balance and macro
  adherence for the last 1, 3 and 7 days; weight trend; data-quality flags (low-confidence
  items).
- **Recent history**, verbatim but short: the last 3 workout blocks and yesterday's meals.

### Output — the brief, on demand

A "What's next?" button, and nothing else — no scheduled brief, no notification, ever. You
tap it when you are about to train (or eat) and it answers from everything logged up to that
moment. The ask opens the same Photo / Speak / Type panel, so context comes the usual way — "only 30
minutes", "knee hurts today", "feel like cardio" — and shapes the answer without overriding the
history. Generated by Claude Sonnet with
a structured schema; cached for the rest of the day so repeated taps are consistent and free;
*Regenerate* is explicit.

**Gap-aware.** Days since the last workout is a first-class input. After a 3–4 day gap the coach
says so and eases back in (lighter volume, familiar movements, loads held or dropped one step);
after two weeks or more it treats the return as a restart rather than resuming yesterday's
progression. It never scolds about the gap — it just plans from where you actually are.

- **Workout for today:** type (strength / cardio / rest), target muscle groups with the reason
  ("shoulders and back: last trained 5 days ago; legs trained yesterday"), 4–6 exercises, each
  with prescribed load × sets × reps derived from history, and a one-line "why".
- **Eating for today:** calorie and macro targets adjusted for yesterday and the plan ("yesterday
  ran 60 g over your carb target → aim for ≤120 g today"), 2–3 meal ideas that fit the diet
  style, and hydration if tracked.
- **One nudge:** the single most useful thing (a missing muscle group, a streak at risk, a
  weigh-in due).

### Progression rules (deterministic, fed to the model as constraints)

- New exercise: prescribe what the user reported the first time.
- Same load until the user hits the target reps on **all** sets in two consecutive workouts
  with confidence ≥ medium; then increase by the smallest plate step (+2.5 kg / +5 lb, or +5%
  on machines), never more than one step per week.
- A missed workout or a reported failure holds or drops one step; never punishes.
- Recovery: a muscle group trained within 48 h is not the day's primary target.
- Cardio prescribed by weekly minutes vs the plan, not by yesterday.

## Data model changes (one migration on top of 0002)

| Table | Change | Why |
|---|---|---|
| `calorie_expenditure` → `activities` | rename; add exercise_id, category, muscle_groups text[], sets, reps, load_lb, duration_min, distance_km, source (manual/fused/health), confidence, external_id | one row per exercise; existing rows keep working (all nullable) |
| `evidence` | new: id, user_id, activity_id / meal_id, kind (photo/transcript/text), storage_path, text, created_at | provenance and the photo gallery |
| `exercise_catalog` | new: id, name, aliases text[], category, primary_muscles, secondary_muscles, equipment | normalisation for the coach |
| `health_samples` | new: user_id, kind, external_id unique, start, end, value, unit, raw jsonb | idempotent Health import |
| `plans` | new: user_id, goal, goal_weight_lb, target_date, diet_style, training_days, environment, equipment, constraints jsonb, eatback (none/half/all), stated_at per field | the coach's standing instructions, set by talking |
| `coach_briefs` | new: user_id, date, workout jsonb, nutrition jsonb, nudge, rationale, model, inputs_hash, generated_at | cache for the day; history of advice |
| `daily_summaries` | add blocks jsonb, muscle_groups text[], closed_at | the day's record, written when the day closes |
| `meals` | add photo evidence via `evidence` | meal photos |

## API surface (additions)

```
POST   /api/log/analyze                   multipart: photo[] + text → activities / meal / weight / plan update (preview)
POST   /api/log/confirm                   save the (edited) result + evidence
PATCH  /api/activities/:id                corrections
GET    /api/day/:date                     items, blocks, eaten/earned/allowance/status; closes past days on first read
GET    /api/week                          7 day statuses + weekly deficit
POST   /api/health/sync                   batch of samples (idempotent by external_id)
GET    /api/coach/next                    the brief (generates on first ask each day)
POST   /api/coach/next/regenerate         explicit
GET    /api/evidence/:id                  authenticated photo
GET/PUT /api/plan
```

## App

- **Home:** goal and progress, weight trend, the week in two numbers, and one button into
  Today. Nothing on it generates anything.
- **Today:** Do / Done / Eat / Body, as above. The plan lives here, and so does the only
  generator in the app.
- **Log button:** one screen with three big controls — Photo, Speak, Type — and a confirm card
  (fields editable, confidence shown as a subtle marker). Save. That is the whole flow, for
  exercise and food alike.
- **Day / history:** past days as closed daily records; a block expands to its items and photos.
- **Profile:** the plan rendered organised (weight and trend, goal and pace, daily target, diet
  style, training days, constraints, eat-back setting), each field dated; "Tell me" opens the
  same input panel; single-field tap to correct. Health sync toggle.

## Phases

| Phase | Ships | Notes |
|---|---|---|
| **A · Fusion logging** | evidence storage, photo+narration fusion, exercise catalogue, auto-blocks, day close → daily record, on-device voice, new Home calorie model (ring / earned / status / week) | one dev build (camera, mic, speech permissions) |
| **B · Coach v1** | plan-by-talking + Profile screen, computed features, on-demand brief with context input, Coach screen | Sonnet; cached per day |
| **C · Health** | HealthKit import + merge rules; Health Connect on Android | optional source; nothing depends on it |
| **D · Hardening** | offline evidence queue with retry, meal photos (labels, plates), progression tuning from real use, cloud transcription fallback | after two weeks of real logs |

## Cost and risk

- Per gym visit with ~8 photos + narration: ≈ $0.03–0.08 (Haiku vision). Brief: ≈ $0.02
  (Sonnet). Well under $3 per active user per month.
- Photo accuracy on machine displays is high; on weight stacks it depends on the shot — the
  confirm card exists for this. Sets/reps never come from a photo.
- The coach is only as good as the log: unconfirmed items and empty days are surfaced as the
  nudge rather than silently ignored.
- Health double counting is the classic failure; the overlap rules above are the mitigation and
  are unit-tested with synthetic samples.

## Decisions needed

1. ~~Session scope~~ **Decided: the day is the session; no start/stop; auto-blocks.**
2. **Units:** kg and lb both, per the profile's `units` setting — confirm the gym is in kg.
3. **Coach model:** Sonnet for the brief (quality) vs Haiku (cost). Recommended: Sonnet.
4. **Voice:** on-device transcription first (recommended), with cloud fallback only if needed.
5. **Phase A first**, since the logs are what the coach feeds on.
6. ~~Coach cadence~~ **Decided: on demand via a button, with an optional intent line; no schedule, no notifications.**
