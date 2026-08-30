# TrackDown v2 — build plan

For the implementing agents (Opus). Read `docs/concept-v2.md` first — it is the product
spec; this file is the engineering plan. Screens: the design canvas
https://claude.ai/code/artifact/0b66a20c-e465-4e42-90ba-b37f89547796 (Today, Log, Coach, Day,
Progress, Profile). Decisions already made — do not reopen them:

| Decision | Value |
|---|---|
| Units | pounds in the UI (`profiles.units` stays; default `imperial`) |
| Session model | none — the day is the container; auto-blocks (90 min) are presentation |
| Coach | on demand only, Claude Sonnet by default, cached per day |
| Fusion / vision | Claude Haiku 4.5 by default |
| Voice | on-device transcription (`expo-speech-recognition`); no audio upload |
| Health | optional source; every row has `source`; overlap rules in concept-v2 |
| Providers | every third-party behind a port; swapping = one env var, zero refactor |
| Design | **direction A** — `docs/design-system.md` is the spec; the old cream/Fraunces look is gone |
| Goals | optional, spec + measure catalog (`concept-v2.md` §Goals); Today/Progress/Days judge against the active goal; no goal = no judgement colours |
| Morning test | the user tests on an iPhone in **Expo Go** over Tailscale at 07:00 — a running Metro (`npx expo start --offline`, `REACT_NATIVE_PACKAGER_HOSTNAME=100.64.198.50`) and Expo-Go-safe modules are part of "done". Native-only modules (speech) sit behind ports with a null adapter |
| Auth | **email + password** (Better Auth `emailAndPassword`); the email-OTP flow is removed; no SMTP. Password reset = admin script until SMTP exists |
| Branch | `migrate-off-supabase` (already deployed to the Docker host); PR to `main` at the end |

## Architecture rules (SOLID, enforced by lint + tests)

Same shape as My Read Coach (`~/Work/my-read-coach/backend/src/{ports,adapters,container.ts}`).

```
backend/src/
  ports/          interfaces only — no SDK imports
    llm.ts        LlmPort:        parseStructured({system, messages(text+images), schema}) → T
    vision.ts     (folded into LlmPort — images are part of the message; keep one port)
    coach.ts      CoachPort:      brief(inputs) → Brief   (default impl composes LlmPort)
    transcription.ts TranscriptionPort: transcribe(audio) → text   (cloud fallback only)
    storage.ts    EvidenceStore:  put(bytes, mime) → id; get(id) → stream; delete(id)
    email.ts      EmailPort:      send({to, subject, text, html})
    health.ts     (client-side port, see app)
  adapters/
    llm/anthropic.ts   llm/openai.ts        (openai is the proof the port is honest)
    transcription/openai.ts
    storage/local.ts   (volume) storage/s3.ts (later)
    email/smtp.ts
  container.ts    builds every port from config.*Provider; unknown name = refuse to start
  config/index.ts the ONLY file that reads process.env (eslint rule exists)
```

- Routes and services import **ports** only. ESLint: `no-restricted-imports` for
  `@anthropic-ai/sdk`, `openai`, `nodemailer` outside `adapters/**` (add to
  `backend/eslint.config.js`).
- Prompts and zod schemas live in `services/` (provider-neutral); an adapter receives the
  schema and returns parsed output. Anthropic adapter uses `messages.parse` +
  `zodOutputFormat`; OpenAI adapter uses `responses.parse` + `zodTextFormat`.
- Every port has a **fake** in `src/test/fakes/` used by the integration tests; adapters get
  contract tests that run only when the provider's key is present (skip otherwise).
- Config: `LLM_PROVIDER=anthropic|openai`, `COACH_LLM_PROVIDER` (defaults to LLM_PROVIDER),
  `LLM_MODEL_FUSION`, `LLM_MODEL_COACH`, `TRANSCRIPTION_PROVIDER=none|openai`,
  `EVIDENCE_STORAGE=local|s3`. Document all in `.env.example`.
- App side, same idea: `lib/ports/` (`speech.ts` → expo-speech-recognition adapter,
  `health.ts` → HealthKit adapter / `null` adapter on Android/web), `lib/api.ts` is the one
  HTTP client. Screens import hooks from `lib/queries.ts` only.

## Work packages

Run in order; each is one PR-sized change with its own tests. "Done" means: `make typecheck`,
`make lint`, `make test` green; the WP's acceptance list checked; `docs/` updated where noted.

### WP0a — Email + password auth (backend + app, small)
Replace the `emailOTP` plugin with `emailAndPassword: { enabled: true, minPasswordLength: 8 }`;
delete the OTP send/verify code paths and `adapters/email/smtp.ts` usage from auth (keep the
EmailPort for later reset emails, wired to a console logger when SMTP_HOST is unset).
Add `npm run reset-password -- <email> <newPassword>` (`src/scripts/reset-password.ts`, uses
Better Auth's internal adapter/`auth.api` to set the hash — never write bcrypt/scrypt by hand).
App: `lib/auth.ts` exposes `signIn(email, password)`, `signUp(email, password)`; the sign-in
screen gets a password field and a "Create account" toggle; keep the existing visual style.
Delete the OTP user `yonas.fhs@gmail.com` row on the host DB only if the user asks — otherwise
leave it; a fresh sign-up with the same email must produce a clear "already exists" error, and
the reset script is the way to give that account a password.
Accept: tests cover sign-up, sign-in, wrong password, sign-out, reset script; OTP endpoints 404.

### WP0 — Ports & container refactor (backend, ~small)
Extract `LlmPort` from `services/parseLog.ts`; add `adapters/llm/anthropic.ts` and
`adapters/llm/openai.ts`; `container.ts`; eslint boundary rule; fakes; config keys above.
`parseLog` becomes provider-neutral. Accept: existing 13 tests pass unchanged; `LLM_PROVIDER=openai`
boots and parses with a real key (contract test); lint fails on a direct SDK import in a route.

### WP1 — Schema v2 (migration `0004_v2.sql` — 0003 went to WP0a)
Shipped; the deltas from what is written below are marked **(built:)**.
- `calorie_expenditure` → `activities` (rename + add: exercise_id, category
  cardio|strength|mobility|other, muscle_groups text[], sets int, reps int, load_lb numeric,
  duration_min int, distance_mi numeric, source manual|fused|health, confidence low|medium|high,
  external_id text unique nullable, block_id uuid nullable). All nullable; existing rows valid.
  **(built:** also an `exercise` **text** column beside `exercise_id` — the catalogue is a
  normaliser, not a gate, so a lift it has never heard of still gets a name; the v1
  `duration_minutes` column was **renamed** to `duration_min` rather than duplicated; and
  `external_id` is unique per `(user_id, external_id)`, since two phones can mint the same
  sample uuid.**)**
- `exercise_catalog` (id, name unique, aliases text[], category, primary_muscles text[],
  secondary_muscles text[], equipment text[]) — seed ~120 common exercises from a JSON file in
  `backend/data/exercises.json`.
- `evidence` (id, user_id, activity_id | meal_id | plan_id nullable, kind photo|transcript|text,
  storage_key, mime, width, height, text, created_at).
- `health_samples` (user_id, kind, external_id unique, start_at, end_at, value numeric, unit,
  raw jsonb).
- `goals` (id, user_id, kind, title, metrics jsonb, priority int, status active|reached|expired|dropped,
  active_from, active_to, stated_at, created_at) + `measure_catalog` as code (`services/goals/measures.ts`:
  one calculator per measure, unit-tested). **(built:** plus `reached_candidate_at`, which WP4's
  reached-detection job sets and the coach turns into "mark it done?".**)**
- `profiles` gains: diet_style, protein_g, carbs_max_g, training_days, environment, equipment text[],
  constraints text[], preferences text[], eatback none|half|all default half, stated_at jsonb.
  **(built:** `training_days` is an int, days-per-week; concept-v2's separate `plans` table is
  these columns, since it is 1:1 with the user.**)**
- `daily_summaries`: add eaten, earned, allowance, status, blocks jsonb, muscle_groups text[],
  closed_at. **(built:** plus `verdict` and `in_short`, which WP3 writes at close.**)**
- `coach_briefs` (id, user_id, date, asked_at, context text, workout jsonb, nutrition jsonb,
  nudge, rationale, model, inputs_hash, created_at).
Keep the old `/api/entries/movement` routes working (alias to activities) so the current app
keeps functioning until WP6. **(built:** those routes also accept the new activity fields, and
`npm run db:migrate` seeds `exercise_catalog` from `backend/data/exercises.json` after applying
the SQL — `npm run db:seed-exercises` re-runs just that.**)**

### WP2 — Evidence storage + fusion endpoint
- `EvidenceStore` local adapter → Docker volume `trackdown_uploads` (add to compose), served by
  `GET /api/evidence/:id` (auth + ownership), `multer` for upload, images downscaled server-side
  too (sharp, max 1600 px) as a safety net.
- `POST /api/log/analyze` (multipart: `photos[]` ≤ 4, `text`, `kind_hint` optional) → Claude
  with images + text + context (today's items, user vocabulary from `exercise_catalog` +
  their past activity names, units) → discriminated result: `{kind: "activities", items[]} |
  {kind: "meal", meal, items[]} | {kind: "weight", ...} | {kind: "plan_update", fields} |
  {kind: "coach_context", text}`; each with per-field confidence and `sources`
  (photo|text) map. Preview only — nothing saved.
- `POST /api/log/confirm` saves the (possibly edited) preview + links evidence, in one
  transaction. Client sends an idempotency key (uuid) — repeat = same result.
- Prompt lives in `services/fusion/prompt.ts`; schema in `services/fusion/schema.ts`;
  provider via `LlmPort`. Tests with the fake port cover routing of every `kind`, evidence
  linking, idempotency, ownership on `/api/evidence/:id`.

### WP3 — Day model, blocks, calorie model, day readings
- `services/day.ts`: `computeDay(userId, date)` → items, blocks (90-min clustering of
  activities, block title from muscle groups / "Walk" / "Run"), eaten, earned (manual/fused vs
  health overlap rules from concept-v2 §Health), target (TDEE − pace deficit, port
  `lib/tdee.ts` + `lib/recommendations.ts` to `backend/src/services/tdee.ts` and make the app
  read the server's numbers), allowance, status (on_track|over|under), macros.
- `GET /api/day/:date`, `GET /api/week?end=`; day-close job: on the first request after local
  midnight (client sends its tz offset) write `daily_summaries` for every unclosed past day.
- `GET /api/day/:date` also returns: `verdict` (served|missed|unlogged, judged against the goal
  active that day; `none` when no goal), per-exercise `delta_vs_last` (same/+5 lb/+1 set/−), the
  eating pattern line, the **reading** (`in_short` for closed days, written once at close;
  `right_now` for today, regenerated on each log — both via `LlmPort`, ≤ 2 sentences + next action
  with `actions[]` chips), the day-arc events, and `expected` items (next meal, weigh-in).
- Unit tests: clustering, overlap rules with synthetic Health samples, status thresholds,
  timezone edges, delta_vs_last, verdict per goal kind.

### WP4 — Goals and profile by talking
`goal` / `constraint` / `preference` kinds from WP2 → `POST /api/goals` (with proposed timeline from
safe rates, returned in the preview for confirmation), `PATCH /api/goals/:id` (status changes, edits),
`GET /api/goals` (active + history), `PUT /api/profile` merge with `stated_at`. Reached-detection job
(smoothed rules in concept-v2 §Goals) sets a `reached_candidate_at` the coach turns into a prompt.
Tests: proposal maths, reached detection on fixtures, priority ordering, history retention.

### WP5 — Coach
- `services/coach/features.ts`: pure functions over the last 28 days → features listed in
  concept-v2 (days since last workout, per-muscle recency and weekly sets, per-exercise last
  load×sets×reps + best-in-4-weeks + trend, cardio minutes, adherence 1/3/7d, weight trend,
  data-quality flags). Unit-tested on fixtures.
- `services/coach/rules.ts`: progression + recovery + gap rules as data the prompt receives.
- `CoachPort` default = `LlmCoach(LlmPort, model: LLM_MODEL_COACH)`; prompt + zod `Brief`
  schema (`workout{type, targets[], why, exercises[{name, load_lb, sets, reps, note}]}`,
  `nutrition{kcal, protein_g, carbs_max_g, ideas[], why}`, `nudge`).
- `GET /api/coach/next?context=` returns today's cached brief or generates; `POST
  /api/coach/next/regenerate`. Cache key = date + inputs_hash; context text is appended to
  the day's key so a new context regenerates.

### WP6 — App: new screens (direction A)
Rebuild per `docs/design-system.md` — new tokens, Barlow / Barlow Condensed, dark UI. Remove the
old theme. Screens: Today, Log, Days, Day, DayLog, Progress, Goals (incl. empty/propose/reached/
history), plus account rows inside Goals. Must run in **Expo Go** (SDK 54): speech behind
`lib/ports/speech.ts` with a null adapter when the native module is missing; camera/image picker
via expo modules that Expo Go bundles.
- Navigation: tabs Today · Days · Progress · Goals; `+` FAB → Log modal; Coach, Day, DayLog as
  stack screens.
- Log screen: Photo (expo-camera / image picker + expo-image-manipulator downscale), Speak
  (expo-speech-recognition; transcript editable), Type; confirm card renders every `kind`;
  Save → `/api/log/confirm`; "Add more" keeps the sheet open.
- Today: ring (eaten/allowance), earned line, status line, week dots, coach button, blocks.
- Day, Progress (weight sparkline with 7-day average, week grid of day dots, training coverage
  bars), Coach (brief + context input + regenerate), Profile (plan rows with dates, "Tell me
  what's changed" → Log sheet in plan mode, targets, Health toggle).
- `lib/queries.ts` rewired to the new endpoints; old hooks removed once no screen uses them.
- `app.json`: camera, microphone, speech-recognition, photo-library permission strings; EAS
  profile for a dev build.
Accept: `npx tsc --noEmit` and `npx expo lint` clean (fix the 8 pre-existing unescaped-quote
errors while touching those files); every screen renders with the fake API in a Storybook-less
smoke test (jest + react-native-testing-library for the Log confirm card and Today math).

### WP7 — Health (iOS first)
`lib/ports/health.ts` + HealthKit adapter (`react-native-health` or `expo-health`; pick the one
with a maintained Expo config plugin); sync on foreground → `POST /api/health/sync`
(idempotent by `external_id`); Profile toggle; Android/web adapter returns `null`.

### WP8 — Hardening
Offline evidence queue (persist pending confirms in SQLite/MMKV, retry with backoff), cloud
transcription fallback behind `TranscriptionPort`, meal label photos, backup script extension
for the uploads volume, rate limits on `/api/log/analyze`, cost logging per LLM call.

## Overnight schedule (Opus)

| Order | WP | Depends on |
|---|---|---|
| 1 | WP0 ports | — |
| 2 | WP1 schema | WP0 |
| 3 | WP2 fusion + evidence | WP1, ANTHROPIC key for the contract test |
| 4 | WP3 day model | WP1 |
| 5 | WP4 plan | WP2 |
| 6 | WP5 coach | WP3, WP4 |
| 7 | WP6 app screens | WP2–WP5 (can start on Log + Today after WP2/WP3) |
| 8 | deploy to Docker host (`git pull && make docker-prod`), smoke test via LAN + tunnel | all |
| 9 | WP7, WP8 | after the user has the dev build on the phone |

Each WP: branch off `migrate-off-supabase` as `wp<N>-<slug>`, commit with tests, merge back
with `--no-ff`. Deploy only from the integration branch. Never touch `.env.production`
values except the ones the user filled in.

## Morning-testable minimum (do these fully before polishing anything)
1. Sign-up / sign-in with email + password against the deployed backend.
2. Log by typing and by photo (Expo Go camera) → confirm card → saved; Today shows it.
3. Today: header, goal banner (no-goal state included), goal-driven cards, Right now, day arc,
   Training/Eating sections.
4. Set a goal by talking/typing → proposal → confirm; Today switches its cards.
5. Days list and Day reading for yesterday (seed the user's account with two closed days of
   realistic fake data via a script so the morning demo has history: `npm run seed-demo -- <email>`).
6. Coach ask → brief.
7. Metro running on this VM with the Tailscale hostname; instructions at the top of
   `docs/CHANGELOG-v2.md` ("Open Expo Go, scan this QR / open exp://100.64.198.50:8081").

## Definition of done for the overnight run
- Backend: all WPs 0–5 merged, tests green, deployed, `/health` ok, `POST /api/log/analyze`
  proven with one real photo + text through the tunnel, `GET /api/coach/next` returns a brief
  for the user's account.
- App: WP6 complete, typecheck/lint clean, `eas build` configured; the one command for the
  user to run is written at the top of `docs/build-plan.md` under "Next for you".
- `docs/concept-v2.md` and this file updated with anything that changed; a short
  `docs/CHANGELOG-v2.md` of what was built and what was deferred.
