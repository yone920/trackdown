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
