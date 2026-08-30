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
