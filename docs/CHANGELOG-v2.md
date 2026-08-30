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
