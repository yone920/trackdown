# TrackDown: Supabase → self-hosted backend

Built 2026-08-28. Pattern copied from My Read Coach (`~/Work/my-read-coach`): ordered SQL
migrations, Better Auth, Express + `pg`, a rehearsable `migrate-from-supabase` script, and a
cutover runbook. Status (2026-08-29): **deployed on the Docker host** (`~/trackdown`, containers `trackdown-postgres` +
`trackdown-backend`, LAN smoke test passed). Pending: Cloudflare route (`scripts/cloudflare-add-route.sh`),
SMTP and `ANTHROPIC_API_KEY` in `~/trackdown/.env.production`, EAS build. **No Supabase data copy is
needed** — the Supabase project holds no real data, so steps 1 and 3.2 below are skipped.

## What changed

| Supabase feature | Was | Now |
|---|---|---|
| Auth — email OTP (6-digit code, user auto-created) | `supabase.auth.signInWithOtp` / `verifyOtp` | Better Auth `emailOTP` + `bearer` plugins — `backend/src/auth.ts`, `lib/auth.ts` |
| PostgREST CRUD, RLS-scoped | `supabase.from(...)` in `lib/queries.ts` | `GET/POST/PATCH/DELETE /api/entries/:kind`, `/api/weight`, `/api/profile` — every query scoped by session user id (`backend/src/services/entries.ts`) |
| Edge function `parse-log` (Deno + Claude) | `supabase.functions.invoke('parse-log')` then 3 inserts from the phone | `POST /api/log` parses **and** saves in one transaction (`backend/src/routes/log.ts`); `POST /api/parse-log` is parse-only. Prompt and zod schema are verbatim (`backend/src/services/parseLog.ts`) |
| `handle_new_user` trigger → `profiles` row | trigger on `auth.users` | Better Auth `databaseHooks.user.create.after` |
| Session storage | supabase-js in SecureStore | one bearer token in SecureStore (`lib/token-store.ts`) |
| Storage / Realtime | never used | — |

Schema: `backend/migrations/0001_better_auth.sql` + `0002_app_tables.sql` (the four Supabase
migrations merged; `user_id` columns are `TEXT` so migrated Supabase UUIDs fit alongside Better
Auth ids; RLS removed because the backend is the only DB client).

Verified: `cd backend && npm test` — 13 integration tests on an embedded Postgres cover the OTP
sign-in flow, sign-out, per-user isolation, CRUD + range filters, validation, and `/api/log`.

## Runtime layout on the Docker host

```
phone ──HTTPS──► cloudflared ──► trackdown-backend :8003→8000 ──► trackdown-postgres (compose network)
```

`docker-compose.yml`, project `trackdown-prod`, volume `trackdown_postgres_data`. Host port 8003
(8000–8002 are taken by other stacks there). The backend container runs `db:migrate` before it
serves, so schema changes ship with the image.

## Cutover runbook

### 0. Prerequisites (you)

| Item | Where it goes |
|---|---|
| Public API hostname `trackdown-api.yonelab.net` → `http://localhost:8003` on the shared tunnel: `./scripts/cloudflare-add-route.sh` (uses `~/.cloudflare.token`) | `BETTER_AUTH_URL` in `.env.production`; `EXPO_PUBLIC_API_URL` in the app build |
| `POSTGRES_PASSWORD` (`openssl rand -base64 24`), `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) | `.env.production` |
| SMTP credentials for the code email (Read Coach's work) | `SMTP_*`, `EMAIL_FROM` in `.env.production` |
| `ANTHROPIC_API_KEY` (today a Supabase edge-function secret) | `.env.production` |
| Supabase DB password: Dashboard → Project Settings → Database → Reset. Use the **Session pooler** URI, append `?sslmode=no-verify` | only on the machine running step 3, never in a file |

`.env.production` lives next to `docker-compose.yml` on the Docker host and is gitignored.

### 1. Rehearse the data copy (safe any time — only reads Supabase)

```bash
make pg && make pg-migrate                       # throwaway local Postgres
cd backend
SUPABASE_DB_URL='postgresql://postgres.pkrmjhvpuuvcolgnbyxe:<pw>@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=no-verify' \
DATABASE_URL='postgres://trackdown:trackdown@127.0.0.1:5433/trackdown' \
  npm run db:migrate-from-supabase
```

Read the output: row counts must be ✅; **drift warnings** name Supabase columns no migration
knows about (their data is not copied — decide per column); **orphans** are rows of deleted
users. Then `npm run dev`, point the app at it, sign in with your real email (the code prints in
the backend console without SMTP) and confirm your history is there.

### 2. Deploy the stack (Docker host)

```bash
ssh yone@192.168.1.56
git clone https://github.com/yone920/trackdown.git ~/trackdown && cd ~/trackdown   # or git pull
cp .env.example .env.production && $EDITOR .env.production
make docker-prod
make status                    # expect /health → {"status":"ok","db":"ok",…}
```

Add the cloudflared route, then `curl https://<hostname>/health` from outside.

### 3. Copy the data (the actual cutover — ~10 min)

1. Supabase dashboard → Database → Backups → take a manual backup.
2. From the Docker host, with Postgres published only on the compose network, run the copy
   through the container network:
   ```bash
   cd ~/trackdown/backend && npm ci
   SUPABASE_DB_URL='…pooler…?sslmode=no-verify' \
   DATABASE_URL='postgres://trackdown:<POSTGRES_PASSWORD>@127.0.0.1:5433/trackdown' \
     npm run db:migrate-from-supabase
   ```
   (temporarily add `ports: ["127.0.0.1:5433:5432"]` to the postgres service for this, or run it
   inside a `node` container on the `trackdown` network — either works; remove the port after.)
   The script runs in one transaction: if it fails, nothing is written and it is safe to retry.
3. Build the app with `EXPO_PUBLIC_API_URL=https://<hostname>` (`npx eas build --profile development --platform ios`
   — native deps changed, so a new dev client is required) and install it.

### 4. Smoke test, in order

1. Sign in with your existing email → code arrives by email → home screen shows today.
2. History: past days, weight chart and profile settings are all present (confirms UUID
   preservation kept the FKs valid).
3. Log "two eggs and coffee, 30 min walk" → items appear with calories (confirms Claude + transaction).
4. Delete an entry, edit a meal's macros.
5. Sign out, sign back in.

### 5. Rollback

Supabase is untouched until you delete it. To go back: rebuild the app from the
`pre-migration` git tag (create it before merging: `git tag pre-migration <sha>`) — the
Supabase project, edge function and data are exactly as they were.

### 6. After a clean week

1. Set up the backup cron on the Docker host and **restore one backup into a scratch DB**:
   ```cron
   0 3 * * * cd /home/yone/trackdown && BACKUP_DIR=/mnt/backups/trackdown ./scripts/backup-postgres.sh >> /var/log/trackdown-backup.log 2>&1
   ```
2. Pause, then delete the Supabase project `pkrmjhvpuuvcolgnbyxe`.

## Things that will bite

- Native apps send no `Origin`, so CORS is irrelevant for the phone; it only matters for the
  Expo web target (`APP_ORIGIN`).
- `BETTER_AUTH_URL` must be the URL the **phone** uses. If it differs from the tunnel hostname,
  Better Auth rejects the request as an untrusted origin.
- Rotating `BETTER_AUTH_SECRET` signs everyone out.
- No SMTP in production = nobody can sign in; the backend logs a warning at boot and prints the
  code to the container log — check `docker logs trackdown-backend` before blaming the mail server.
