# Working rules for implementation agents

Read `docs/concept-v2.md` (product), `docs/build-plan.md` (engineering), then your work package.
Screens: https://claude.ai/code/artifact/0b66a20c-e465-4e42-90ba-b37f89547796 (you cannot open it;
the build plan and concept describe every screen — follow them and the app's existing tokens in
`tailwind.config.js`).

## Repo
- Path: `~/Work/trackdown`. Integration branch: `migrate-off-supabase`. Never commit to `main`.
- For each work package: `git checkout -b wp<N>-<slug> migrate-off-supabase`, commit in small
  steps, then `git checkout migrate-off-supabase && git merge --no-ff wp<N>-<slug>` and
  `git push origin migrate-off-supabase`. Commit trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Backend: `cd backend && npm run typecheck && npm run lint && npm test` must be green before
  merging. App: `npx tsc --noEmit && npx expo lint` clean (fix pre-existing lint errors in files
  you touch).
- Tests run against an embedded Postgres (`backend/src/test/db.ts`) — no Docker needed. Docker is
  NOT available on this machine; do not try to start containers here.
- `backend/.env` holds real keys (ANTHROPIC_API_KEY, maybe OPENAI_API_KEY). Never print, log,
  copy or commit them. Contract tests that need a key must `skip` when it is absent.
- Do not touch the Docker host (192.168.1.56) or `.env.production`; deployment is a separate step.
- Keep `docs/CHANGELOG-v2.md` updated: one section per WP — what shipped, what was deferred, any
  decision you had to make. That file is your handover.

## Engineering rules
- Ports & adapters (build-plan §Architecture). Routes/services import interfaces only; SDKs only
  in `adapters/**`; `process.env` only in `config/`. Add/keep ESLint rules that enforce this.
- Provider-neutral prompts and zod schemas live in `services/`; adapters receive the schema.
- Every port has a fake under `src/test/fakes/`; integration tests use the fakes.
- Idempotent writes where the client may retry (confirm endpoints take a client uuid).
- Units: pounds in the UI; store `_lb` columns. Timezones: the client sends its offset; day
  boundaries are the user's local midnight.
- Keep response shapes stable for screens already built; when you must change one, update the
  app in the same WP.
- Prefer boring, readable code over cleverness. No new dependencies without a one-line reason in
  the changelog.

## Live verification on the user's account — READ ONLY

The deployed server holds a real account with a real day on it. When a work package ends
with a check against production, that check is **GETs and nothing else**.

- **Never regenerate or replace the standing coach brief**, and never any other piece of the
  user's daily state: no `POST /api/coach/next/regenerate` (with or without a revision or a
  `mode`), no `GET /api/coach/next` without `generate=false` — a plain GET generates the
  day's brief when there is not one, which is a write. `GET /api/coach/status` and
  `GET /api/coach/next?generate=false` are the two safe doors, and they exist partly for
  this. The same goes for anything else that is one-per-day: readings, day closes, goal
  status, the plan row.
- **Never log, correct or delete a row on the user's account.** Not a test meal, not a
  weigh-in, not "I'll delete it afterwards" — a deletion is a second write, and the day's
  totals, its verdict and its coach brief have all moved by then.
- **Write paths are verified against rows the agent created**, on an account the agent made
  itself (sign up, exercise the path, remove what you made). If a write path cannot be
  verified that way, it is verified in the test suite against the embedded Postgres, and the
  report says it was not exercised live. An untested write is a smaller problem than a
  rewritten day.
- Report the payloads you read. "I checked it works" is not a check the user can audit.

## Reporting
Your final message is read by the orchestrator, not the user. Return: WP name, merged commit
sha, test counts, files of note, anything deferred or uncertain, and any question the user must
answer. Keep it under 300 words.
