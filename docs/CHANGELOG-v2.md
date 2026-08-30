# TrackDown v2 — changelog

One section per work package (`docs/build-plan.md`): what shipped, what was deferred, and
every decision that had to be made along the way. This file is the handover.

## Testing on the phone

```bash
cd ~/Work/trackdown
export REACT_NATIVE_PACKAGER_HOSTNAME=100.64.198.50   # Tailscale address of this VM
npx expo start --offline
```

Open **Expo Go** on the iPhone (Tailscale must be on and connected) and scan the QR, or
open `exp://100.64.198.50:8081` directly.

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
