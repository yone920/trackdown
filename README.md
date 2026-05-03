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

"The app" is actually three things running in three different places. When you
edit a file on your laptop, only your laptop sees the change — to make it live
you have to push it to whichever runtime owns that file.

```
┌──────────────────────┐    HTTPS calls    ┌──────────────────────────┐
│  YOUR PHONE          │ ─────────────────►│  SUPABASE SERVERS        │
│                      │                   │                          │
│  - React Native code │                   │  - Edge Functions        │
│    (app/, lib/, ...) │                   │    (supabase/functions/)  │
│  - Runs in Hermes JS │                   │  - Runs in Deno          │
│                      │                   │                          │
│                      │                   │  - Postgres database     │
│                      │                   │    (meals, weight_logs…) │
└──────────────────────┘                   └──────────────────────────┘
```

| You changed... | Where it runs | What to do |
|---|---|---|
| `app/**/*.tsx`, `lib/**/*.ts`, `components/**/*.tsx` | Your phone (Hermes) | Save → Metro hot-reloads. If it doesn't, press `r` in the Expo terminal, or restart with `--clear` (see below). |
| `supabase/functions/<name>/index.ts` | Supabase servers (Deno) | `npx supabase functions deploy <name>` |
| `supabase/migrations/*.sql` | Supabase Postgres | `npx supabase db push` |

**Mnemonic:** if the file is in `app/`, `lib/`, or `components/`, restart Expo.
If it's in `supabase/`, deploy or push.

### Common "wait, why isn't my change working?"

- Edited the AI prompt (`supabase/functions/parse-log/index.ts`) but the app
  still gives old responses → you forgot to deploy the function. Run
  `npx supabase functions deploy parse-log`.
- Added a new column in a migration but the app errors with "column not found"
  → you forgot to push the migration. Run `npx supabase db push`.
- Edited a `.tsx` file but the app looks the same → Metro probably hot-reloaded
  but the screen wasn't re-mounted; navigate away and back, or press `r`.

### Linking the Supabase CLI to your project

`db push` and `functions deploy` both need to know which Supabase project to
talk to. The CLI stores the link in `supabase/.temp/` (gitignored), so it's
**one-time per machine / per fresh clone**.

If you see `Cannot find project ref. Have you run supabase link?`:

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>
```

Your project ref is the subdomain in `EXPO_PUBLIC_SUPABASE_URL` —
`https://<REF>.supabase.co`. The link prompts for your database password (find
it in Supabase dashboard → Project Settings → Database).

### Migration history mismatch

If `db push` lists migrations you've **already applied via the dashboard SQL
editor**, do NOT push them again — `CREATE TABLE` will fail on existing
tables. Mark them as applied without re-running:

```bash
npx supabase migration repair --status applied 0001
npx supabase db push   # should now only show un-applied migrations
```

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
