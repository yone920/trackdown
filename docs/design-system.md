# TrackDown design — direction A "Bold Sport"

The canvas (https://claude.ai/code/artifact/aa915ba4-69d1-457e-af06-91d4281dceaa) is the visual
reference; this file is the buildable spec. Dark UI, condensed numerals, one hot accent.

## Tokens (replace `tailwind.config.js` colors; drop cream/terracotta/Fraunces entirely)

| token | hex | use |
|---|---|---|
| `bg` | `#121418` | screen background |
| `card` | `#1C1F25` | every card / sheet |
| `track` | `#2A2E36` | progress tracks, dividers inside cards, disabled |
| `line` | `#23262D` | row dividers |
| `ink` | `#F3F1EC` | primary text, light buttons |
| `mute` | `#8B8F98` | secondary text, eyebrows |
| `dim` | `#5C6069` | inactive tab icons |
| `accent` | `#FF7A1A` | goal ring, primary CTA, workout bar, "goal · active" |
| `good` | `#3DD68C` | served / on track / earned / NOW marker |

Fonts (`@expo-google-fonts/barlow` + `@expo-google-fonts/barlow-condensed`):
`Barlow_400Regular/500Medium/600SemiBold` for text; `BarlowCondensed_600SemiBold/700Bold` for
display (`disp`). Numerals always `fontVariant: ['tabular-nums']`.

Scale: eyebrow 11px/600, letterSpacing 1.6, uppercase, `mute`; body 15/500; secondary 12–13
`mute`; card numeral 40–44 `disp` 700; screen title 26–32 `disp` 700; section title 20 `disp` 600.
Radii: cards 20, pills 999, thumbnails 10, small tiles 14. Screen padding 24. Card padding 18.
Tab bar 84 high, 4 tabs: Today · Days · Progress · Goals (icons stroke 1.8, inactive `dim`).
Floating `+` 64px circle, `ink` on `bg`, bottom-right above the tab bar → opens Log.
No emoji anywhere; icons are stroke SVGs (react-native-svg).

## Shared components
- **GoalBanner**: card row — 56px progress ring (`accent`, % inside) or flag icon when no goal;
  eyebrow "GOAL · ACTIVE" (`accent`) / "NO GOAL SET" (`mute`); title `disp` 22; sub 12 `mute`; chevron.
- **MetricCard**: eyebrow + big numeral + small unit + one of: bar, segment row, sparkline, ring.
- **Reading card** (`In short` / `Right now`): card with 3px left border (`accent` for closed day,
  `good` for live), eyebrow, paragraph 15/1.55.
- **DayArc**: 6a→11p line; `ink` dots = logs, `accent` bar = workout span, `good` NOW marker,
  hour labels 9px. **No ghost dots** — the arc draws what happened (decision 2026-08-31).
- **Row**: time (12 `mute`, 50 wide) · title 15/500 + sub 12 `mute` · right numeral `disp` 18;
  optional trailing ✕ (`dim`, drawn at 28px, 44px hit target) that arms into "Delete? ✓ ✕" in
  the row itself — `DeleteControl` in `components/kit.tsx`.
- **Chips**: pill, 12/700; primary = `ink` bg / `bg` text; secondary = 1px `track` border.
- **Section**: `disp` 20 title left, 12 `mute` summary right, 26 top padding.

## Screens

### Today (tab)
Header: eyebrow date+time · `disp` "Day N · on track/over/—" (`good`/`accent`/`mute`) · avatar.
GoalBanner. Metric cards decided by the primary goal (see `concept-v2.md` §Goals):
fat loss → calories-left ring (full width) + weekly-deficit dots + weight trend; muscle → protein +
sets/week + per-muscle coverage strip; endurance → cardio minutes by day + last-run pace + resting
HR (Health); strength → target lift + next step due + push/pull/legs; no goal → workouts/week +
cardio minutes + coverage, **no judgement colours**. Then **Right now** reading (LLM, regenerated on
every log; ≤ 2 sentences + the single next action) with action chips. **DayArc**. Then Training and
Eating sections organised as on Day (below) — **only what was logged**: no placeholder row for a
meal nobody has eaten (decision 2026-08-31). Every logged row has three targets: the exercise
**name** opens its sheet, the **✕** deletes it, the **rest of the row** opens it for a
correction (the same `/log` review-and-tell screen the DayLog routes to). Coach button
(`accent` pill): "What should I do today?" → "…tomorrow?" once today's workout is logged.
Tabs + `+`.

### Log (modal from `+`, also from chips) — NO FORMS (concept-v2 principle 7)
Title `disp` 34 "What did you do?"; transcript/typed text area (`disp` 20) with attached photo
thumbnails; three 76px controls Photo / Speak / Type (Speak is the primary, `ink` filled);
helper line "Say it, snap it, or type it — any mix. Same for food, weight, goals." Below: the
**confirm card** for whatever was recognised (exercise / meal / weight / goal / coach context):
eyebrow "RECOGNIZED · <kind>", confidence chip (`good` high / `mute` medium / `accent` low),
title, sources line ("machine from photo, load from your voice"), a read-only review of what was understood; corrections are TOLD via the same input ("Make a change" returns to the panel), never edited in fields. Primary button label: **Log** → review page → **Log it** / **Make a change**. In Expo Go, Speak is hidden if the
speech port reports unavailable.

### Days (tab)
Title `disp` 30 "Days" + eyebrow of the active goal. Rows grouped by week (week eyebrow + tally
"5 of 7 served · −3,100 · −0.9 lb"). Row: weekday `disp` 16 over a 10px dot (`good` served,
`accent` missed, `track` not logged, outlined = today open) · verdict words + one-line summary ·
day number (`good`/`accent`) · chevron. Tap → Day.

### Day (stack)
Nav: back "Days" · ‹ date › . Verdict: 36px `good` check circle + `disp` 32 "Served your goal"
(or `accent` "Over by N" / `mute` "Not logged"); sub: kcal delta · goal active THAT day · day N.
**In short** reading card (LLM, written once at day close). 3-col stats (Eaten / Earned `good` /
Allowance). Section Training: per muscle group (eyebrow + sets) rows of exercise · load · delta
vs last time (`good` "+5 lb"/"+1 set", `mute` "same", `accent` "−"); photos row; Health items as
a slim card with heart icon and badge. Section Eating: Protein/Carbs/Fat bars vs targets with
notes ("under"), pattern line, meals by slot (Breakfast/Lunch/Dinner/Snacks) with kcal + protein.
Section Body: Weight / 7-day avg / Trend. Coach-ask card if any. Footer: "See the log as
recorded" pill + export icon button.

### DayLog (stack, from Day)
Title `disp` 28 "The log, as recorded"; rows: time · icon (keyboard/mic/camera/heart) · the raw
text in quotes or "photo" italic · meta (source · what was understood · confidence). Tap → correct.
Export = share sheet with JSON/CSV of the day.

### Progress (tab)
One section per active goal, rendered from its metrics (weight line with 7-day average and
target line; lift load trend; weekly cardio bars; sets per muscle group); then Consistency
(workouts/week, 8 weeks) and Coverage bars. No goal → Consistency + Coverage + weight line if
logged, no judgement colours.

### Goals (tab)
Active goals as GoalBanner-style cards (progress ring, pace line, "reached?" prompt when the
measure says so). Empty state: `disp` 26 "No goal yet" + "Training for consistency" + a Speak
button "Tell me what you're after". Setting a goal = the Log sheet in goal mode: recognised
card shows kind, metrics, proposed date ("about 20 weeks at a standard pace → Jan 14 · change
date · no date"); Confirm. History list of past goals with outcome. Below goals: **How you
train** / **How you eat** / **Constraints** / **Health sync** / **Account** (email, sign out).
