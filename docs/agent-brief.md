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

## Reporting
Your final message is read by the orchestrator, not the user. Return: WP name, merged commit
sha, test counts, files of note, anything deferred or uncertain, and any question the user must
answer. Keep it under 300 words.
