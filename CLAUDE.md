# TrackDown - Weight Loss Tracking App

## Mission Statement
TrackDown is a React Native (Expo) iOS/Android app for workout and weight tracking. Meal/food
logging was fully removed 2026-09-08 to focus the app on training and body weight only — see
the migration `backend/migrations/0021_drop_meals.sql` for the schema-level cut.

## Tech Stack
- **Framework:** React Native with Expo SDK, Expo Router
- **Styling:** NativeWind (Tailwind for RN)
- **State Management:** Zustand
- **Data Fetching:** TanStack Query
- **Charts:** hand-built on `react-native-svg` (`components/charts.tsx`, `components/day-arc.tsx`). No Victory, no Skia.
- **Backend:** `backend/` — Express 5 + Better Auth (email + password, bearer tokens) + self-hosted Postgres 17 in Docker. Migrated off Supabase 2026-08-28; see `docs/supabase-migration-plan.md`
- **LLMs:** two roles, each with a provider default in `backend/src/config/index.ts` (override with `LLM_MODEL_*`): **fusion** (parsing a log, text + photos) uses Claude Haiku 4.5 (`claude-haiku-4-5`; OpenAI alternative `gpt-4.1-mini`) and **coach** uses Claude Sonnet 4.5 (`claude-sonnet-4-5`; OpenAI alternative `gpt-4.1`). Entry points: `backend/src/services/parseLog.ts` (one log → one call) and `backend/src/services/fusion/`.
- **AI vision is live, not planned:** scale and equipment photos travel through `LlmPort` as base64 images in the fusion pipeline (`backend/src/services/fusion/analyze.ts`). `backend/src/services/images.ts` downscales uploads server-side with `sharp` before they reach the model or the disk.

Every third-party service sits behind a port. `backend/src/ports/*` holds the interfaces
(`llm` — messages carry text **and** base64 images; `coach`; `email`; `storage` for evidence
files; `exerciseMedia`), `backend/src/adapters/**` the SDK calls (`llm/anthropic.ts`,
`llm/openai.ts`, plus `llm/policy.ts` for retry/fallback policy and `llm/unavailable.ts`;
`coach/llm.ts`; `email/smtp.ts`; `storage/local.ts`, `storage/exerciseMedia.ts`), and
`backend/src/container.ts` picks one from `LLM_PROVIDER` / `COACH_LLM_PROVIDER` (and
`EVIDENCE_PROVIDER`, currently `local` only) — an unknown name refuses to boot.
Routes and services import ports only; ESLint fails a build that imports `@anthropic-ai/sdk`,
`openai` or `nodemailer` outside `src/adapters/**`, or reads `process.env` outside `src/config/`.
Tests use the fakes in `backend/src/test/fakes/`; each adapter has a contract test that runs
only when that provider's key is in `backend/.env`.
- **Voice:** on-device speech recognition in the app via `expo-speech-recognition`
  (`lib/ports/speech.expo.ts`); the backend only ever receives text. No Whisper, no audio upload.
- **Monitoring:** none wired. Sentry and PostHog are not dependencies.

### Backend service map (`backend/src/services/`)
`fusion/` (log → structured record, incl. refine/revise/confirm), `day/` (auto-blocks, deltas,
day estimate and narrative), `goals/` (detection, measures, verdicts), `coach/` (the brief:
rules, catalog, prompt, schema), `recommendation/` (exercise pool, scheduler, muscle registry,
coverage — read `recommendation/ENGINE.md` first), `readings/` (the "what I know about you"
dossier), `training/` (training board and history). Design docs: `docs/concept-v2.md`
(product), `docs/build-plan.md` (engineering), `docs/agent-brief.md` (working rules for
implementation agents; its `migrate-off-supabase` integration-branch workflow is from the
migration period — current work goes through `main`).

## Core Features
- AI gym equipment photo recognition for calorie burn estimation
- AI scale photo reading for weight logging
- Voice and text activity/weight logging, fused into one record by AI (`backend/src/services/fusion/`)
- Weight trend chart
- Streak system
- Goal tracking (strength, endurance, muscle, custom/weight-target), judged daily against training and weight trend

## Database Schema (Postgres — `backend/migrations/`)
Tables:
- `user`, `session`, `account`, `verification` - Better Auth (0001, `account.issuer` added in 0003)
- `profiles` - User profiles and training plan fields (goals, equipment, experience, etc.)
- `activities` - Exercise/workout records, including a per-workout calorie-burn estimate (renamed from `calorie_expenditure` in 0004)
- `weight_logs` - Weight measurements over time
- `daily_summaries` - One row per closed day: training earned, verdict, blocks, muscle groups, the day's reading
- `evidence` - Polymorphic photo/transcript/text evidence, owned by an activity, a weigh-in, or a goal plan
- `goals` - Training/weight goals and their metrics, judged daily against training and weight trend
- `coach_briefs` - Cached on-demand workout coaching briefs
- `day_readings` - Cached "Right now"/"In short" AI narrative text per day
- `record_corrections` - History of user-driven corrections to a logged activity or weigh-in
- `exercise_catalog` - The exercise vocabulary the fusion prompt and the coach share; seeded from `backend/data/exercises.json` as part of `npm run db:migrate` (0004)
- `health_samples` - Samples synced from the phone's health store, unique per (user, external id) (0004)
- `log_confirmations` - Fusion results awaiting the user's confirmation; a sweep handles rows older than 24 h (0005)
- `coach_contexts` - State the coach carries between briefs: the title sentence and pending items such as mark_reached / adjust_goal / weigh_in (0008)
- `places`, `place_equipment` - Gyms and other places accrued from logs (one row per name per user, upserted) and the equipment seen there (0012)
- `profile_readings` - Profile-scoped AI readings, keyed by (user, kind) (0017)

`meals`/`meal_items` and the whole calorie-budget/macro/TDEE column set on `daily_summaries`
and `profiles` were dropped in migration 0021 (meal-tracking removal, 2026-09-08).

## Common Commands

### Development
```bash
# Start Expo dev server
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android

# Run app tests (Jest; the backend uses Vitest, see below)
npx jest

# Lint
npx eslint .

# Type check
npx tsc --noEmit
```

A `Makefile` at the repo root wraps the common ones: `make pg` / `make pg-migrate` /
`make pg-reset` (local Postgres), `make backend`, `make app`, `make test` (backend tests),
`make typecheck`, `make lint`, `make status`, and the maintainer-only `make docker-prod` /
`make docker-prod-down` / `make rollback`. `docker-compose.yml` targets the home Docker
host and publishes the API on host port **8003** (8000-8002 are taken there).

### Running Expo from the Omarchy dev VM

This project lives on the Omarchy VM (Proxmox VM 108, LAN `192.168.1.251`, Tailscale
`100.64.198.50`). The Fedora VM it used to live on was deleted 2026-09-01. The VM's LAN
address has not been reachable from phones on the home WiFi, so the dev iPhone reaches
Expo over Tailscale.

**Always start Expo with the Tailscale hostname:**
```bash
export REACT_NATIVE_PACKAGER_HOSTNAME=100.64.198.50
npx expo start --offline
```
- `REACT_NATIVE_PACKAGER_HOSTNAME` makes the QR encode `exp://100.64.198.50:8081`
  instead of the unreachable LAN IP.
- `--offline` skips Expo's `api.expo.dev` doctor check (it sometimes fails from
  this VM and kills the start).

The phone must have **Tailscale on and connected** to scan this QR.

**Stopping Expo:**
- In the Expo terminal: `Ctrl+C`
- If port 8081 is stuck (Expo says "Port 8081 is running this app in another window"):
  ```bash
  kill <pid>           # PID is shown in the message
  kill -9 <pid>        # if it doesn't die
  ```
- Or check what's holding the port: `ss -tlnp | grep 8081`

**Common errors:**
- `TypeError: fetch failed` at startup → doctor check can't reach Expo's API.
  Use `--offline`.
- `ExpoSecureStore.default.getValueWithKeyAsync is not a function` → web bundle
  trying to use a native-only module. Don't press `w`; only scan the iOS QR.
- QR shows `192.168.1.251` (or any `192.168.x.x`) instead of `100.64.198.50` → env var
  didn't take. Re-`export` it and restart.

**Sanity check from the VM that Metro is alive:**
```bash
curl -s http://localhost:8081/status   # should print "packager-status:running"
```

### Backend
```bash
cd backend
npm run dev                      # API on :8000 with hot reload (needs Postgres: `make pg`)
npm test                         # Vitest (integration tests on an embedded Postgres, no Docker)
npm run db:migrate               # apply backend/migrations/*.sql to DATABASE_URL
npm run db:migrate-from-supabase # one-time data copy, see docs/supabase-migration-plan.md
npm run db:seed-exercises        # re-seed the exercise catalog on its own (db:migrate already does it)
npm run measure-cache            # prompt-cache measurement script (src/scripts/measure-cache.ts)
```
Config lives in `backend/src/config/index.ts` (the only file that reads `process.env`);
`.env.example` at the repo root documents every variable. The app reads the API base
URL from `EXPO_PUBLIC_API_URL` (repo-root `.env`, inlined at bundle time).

### Auth flow
Email + password through Better Auth's `emailAndPassword` (min 8 characters):
`POST /api/auth/sign-up/email` (name, email, password — auto-signs in) and
`POST /api/auth/sign-in/email`. The v1 email-OTP endpoints are gone (404). The session
token comes back in the `set-auth-token` header and is stored in `expo-secure-store`
(`lib/token-store.ts`); every API call sends it as a bearer token.

There is no SMTP server, so there is no self-service password reset: `sendResetPassword`
is deliberately left unset in `backend/src/auth.ts` (the `EmailPort` and `adapters/email/smtp.ts`
exist and are registered, but nothing wires them to reset). Recovery is an operator command
on the host that owns the database:
`cd backend && npm run reset-password -- <email> <newPassword>`. It also gives a v1
OTP-era account (which has no password at all) its first one.
