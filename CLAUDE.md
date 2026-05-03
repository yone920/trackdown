# TrackDown - Weight Loss Tracking App

## Mission Statement
TrackDown is a React Native (Expo) iOS/Android app for weight loss tracking with AI-powered food logging, exercise tracking, and weight monitoring.

## Tech Stack
- **Framework:** React Native with Expo SDK, Expo Router
- **Styling:** NativeWind (Tailwind for RN)
- **State Management:** Zustand
- **Data Fetching:** TanStack Query
- **Charts:** Victory Native / Skia
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- **AI Vision:** Claude Sonnet (claude-sonnet-4-20250514) for food/scale/equipment photo analysis
- **Voice:** OpenAI Whisper for voice transcription
- **Nutrition APIs:** Open Food Facts API + USDA FoodData Central
- **Monitoring:** Sentry + PostHog

## Core Features
- AI photo meal logging (snap food photo -> auto-log calories/macros)
- AI gym equipment photo recognition for calorie burn estimation
- AI scale photo reading for weight logging
- Voice and text food logging
- Macro tracking (carbs, fat, protein, fiber)
- Red/green daily net calorie indicator
- Weight trend chart
- Streak system
- Adaptive TDEE targets
- Weekly AI meal suggestions

## Database Schema (Supabase/Postgres)
Tables:
- `users` - Auth users
- `profiles` - User profiles, goals, TDEE settings
- `meals` - Meal entries (breakfast, lunch, dinner, snacks)
- `meal_items` - Individual food items within meals
- `calorie_expenditure` - Exercise/activity calorie burn records
- `weight_logs` - Weight measurements over time
- `daily_summaries` - Aggregated daily calorie/macro totals
- `body_photos` - Progress photos
- `meal_templates` - Saved/favorite meals for quick logging

## Common Commands

### Development
```bash
# Start Expo dev server
npx expo start

# Run on iOS simulator
npx expo run:ios

# Run on Android emulator
npx expo run:android

# Run tests
npx jest

# Lint
npx eslint .

# Type check
npx tsc --noEmit
```

### Running Expo from this Fedora dev VM

The Fedora VM hosting this project sits behind Proxmox NAT — its `192.168.1.200`
LAN address is **not reachable** from phones on the home WiFi. The dev iPhone
must reach Expo over Tailscale (`100.126.117.105`).

**Always start Expo with the Tailscale hostname:**
```bash
export REACT_NATIVE_PACKAGER_HOSTNAME=100.126.117.105
npx expo start --offline
```
- `REACT_NATIVE_PACKAGER_HOSTNAME` makes the QR encode `exp://100.126.117.105:8081`
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
- QR shows `192.168.1.200` instead of `100.126.117.105` → env var didn't take.
  Re-`export` it and restart.

**Sanity check from the VM that Metro is alive:**
```bash
curl -s http://localhost:8081/status   # should print "packager-status:running"
```

### Supabase
```bash
# Start local Supabase
npx supabase start

# Generate types from schema
npx supabase gen types typescript --local > src/types/supabase.ts

# Push migrations
npx supabase db push

# Create new migration
npx supabase migration new <name>
```
