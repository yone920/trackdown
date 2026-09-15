# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Where the code runs (and how to push changes)

"The app" is two things in two places. Editing a file only changes it where you are;
to make it live, push it to whichever runtime owns it.

```
┌──────────────────────┐    HTTPS (bearer)  ┌──────────────────────────────────┐
│  YOUR PHONE          │ ──────────────────►│  DOCKER HOST (192.168.1.56)      │
│                      │                    │  behind cloudflared              │
│  - React Native code │                    │                                  │
│    (app/, lib/, ...) │                    │  trackdown-backend  (backend/)   │
│  - Runs in Hermes JS │                    │    /api/auth/*   Better Auth     │
│                      │                    │    /api/log      Claude parser   │
│                      │                    │    /api/entries, /api/weight, …  │
│                      │                    │  trackdown-postgres (Postgres 17)│
└──────────────────────┘                    └──────────────────────────────────┘
```

| You changed... | Where it runs | What to do |
|---|---|---|
| `app/**/*.tsx`, `lib/**/*.ts`, `components/**/*.tsx` | Your phone (Hermes) | Save → Metro hot-reloads. If not, press `r`, or restart with `--clear`. |
| `backend/src/**` | Docker host | commit, then on the Docker host: `git pull && make docker-prod` |
| `backend/migrations/*.sql` | Docker host Postgres | same — the backend container applies pending migrations on start |

### Local development

```bash
make install          # npm install for the app and backend/
make pg               # Postgres 17 in Docker on :5433 (docker-compose.dev.yml)
make pg-migrate       # apply backend/migrations
make backend          # API on http://localhost:8000 with hot reload
make app              # Expo dev server (see the Tailscale note below)
make test             # backend tests — embedded Postgres, no Docker needed
```

Copy `.env.example` to `backend/.env`. Sign-in is email + password, so no mail server is
needed; `SMTP_HOST` is unused for now and a forgotten password is fixed with
`cd backend && npm run reset-password -- <email> <newPassword>`. Without
`ANTHROPIC_API_KEY` everything works except free-text logging (`/api/log`).

Point the app at your backend with `EXPO_PUBLIC_API_URL` in a repo-root `.env`, e.g.
`EXPO_PUBLIC_API_URL=http://100.126.117.105:8000` when the phone reaches the dev VM over
Tailscale. It is inlined at bundle time, so restart Expo after changing it.

### Production

Runs on the home Docker host as the `trackdown-prod` compose project. First deploy and
the Supabase cutover are in `docs/supabase-migration-plan.md`; afterwards:

```bash
git pull && make docker-prod        # build, tag trackdown-backend:<version>, start
make status                          # containers + /health
make rollback VERSION=x.y.z          # repoint :latest at an earlier image
```

Backups: `scripts/backup-postgres.sh` (daily cron, `BACKUP_DIR` on the TrueNAS mount).

## Running Expo from the Fedora dev VM

The Fedora VM hosting this project sits behind Proxmox NAT — its `192.168.1.200`
LAN address is **not reachable** from phones on the home WiFi. The dev iPhone
must reach Expo over Tailscale (`100.126.117.105`).

### Start

```bash
export REACT_NATIVE_PACKAGER_HOSTNAME=100.126.117.105
npx expo start --offline
```

- `REACT_NATIVE_PACKAGER_HOSTNAME` makes the QR encode `exp://100.126.117.105:8081`
  instead of the unreachable LAN IP.
- `--offline` skips Expo's `api.expo.dev` doctor check (it sometimes fails from
  this VM and kills the start).

The phone must have **Tailscale on and connected** to scan the QR.

### Force a clean reload

If a code change isn't reflecting in the app (stuck on stale bundle, weird
import errors after renaming files), restart Metro with the cache cleared:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=100.126.117.105 npx expo start --clear
```

`--clear` wipes the Metro bundler cache. Use this when hot reload misses;
otherwise saving the file is enough.

### Stop

- In the Expo terminal: `Ctrl+C`.
- If port 8081 is stuck (Expo says "Port 8081 is being used by another
  process"), find the PID and kill it:

  ```bash
  ss -tlnp | grep 8081     # shows: users:(("node",pid=12345,...))
  # or
  lsof -i :8081            # cleaner output, shows PID column

  kill 12345               # use the PID from above
  kill -9 12345            # if it doesn't die

  # Or skip finding the PID and kill by name:
  pkill -f "expo start"
  ```

### Common errors

- `TypeError: fetch failed` at startup → doctor check can't reach Expo's API.
  Use `--offline`.
- `ExpoSecureStore.default.getValueWithKeyAsync is not a function` → web bundle
  trying to use a native-only module. Don't press `w`; only scan the iOS QR.
- QR shows `192.168.1.200` instead of `100.126.117.105` → env var didn't take.
  Re-`export` it and restart.

### Sanity check

From the VM, confirm Metro is alive:

```bash
curl -s http://localhost:8081/status   # should print "packager-status:running"
```

## Rebuilding the app

Most JS/TSX edits hot-reload — no rebuild needed. You only need to rebuild the
native dev client when you change native code: add/remove an Expo config
plugin, bump the SDK, change `app.json` native fields (bundle ID, icons,
permissions), or install a library that ships native modules.

### Local rebuild

```bash
npx expo prebuild --clean    # regenerate ios/ and android/ from app.json
npx expo run:ios             # rebuild + install on iOS simulator
npx expo run:android         # rebuild + install on Android emulator
```

### Cloud rebuild (EAS) — for installing on a real iPhone

```bash
npx eas build --profile development --platform ios
```

The build runs on Expo's servers; install the resulting `.ipa` over the air.
Requires an Apple Developer account ($99/yr) for device provisioning.

Docs: [Create a development build](https://docs.expo.dev/develop/development-builds/create-a-build/)

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
