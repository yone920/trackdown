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
Tab bar 84 high, 4 items: Today · Days · Progress · **You** (icons stroke 1.8, inactive `dim`).
You is a stack screen rather than a tab route — the fourth item pushes it, as the avatars do.
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
  optional trailing ✕ (`dim`, 44px target) that **morphs** into one wide "Delete?" pill in
  the same spot — the whole pill is the target, and a tap elsewhere, a scroll or 3 s puts it
  back. `DeleteControl` in `components/kit.tsx` (redesign 2026-08-31: the old ✓/✕ pair was
  two small confusable targets). The row's sub-line is **structured facts, never the raw
  description again** — `lib/row-facts.ts`.
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
Title `disp` 34 "What did you do?"; transcript/typed text area (`disp` 20), capped at ~42 %
of the window so a long log scrolls inside itself, with attached photo thumbnails — each
carrying a 24px ✕ badge over its corner, which is the ONLY thing that removes it (tapping
the image opens it full screen); three 76px controls Photo / Speak / Type (Speak is the
primary, `ink` filled); the **primary action is a pinned bar below the scroller** that rises
with the keyboard: one 56px `accent` pill ("Log" → "Log it" → "Save changes", the same
button when disabled and while pending) with the small secondary chips beneath it;
helper line "Say it, snap it, or type it — any mix. Same for food, weight, goals." Below: the
**confirm card** for whatever was recognised (exercise / meal / weight / goal / coach context):
eyebrow "RECOGNIZED · <kind>", confidence chip, in words — "High confidence" / "Medium confidence" / "Low confidence —
check me" (`good` / `mute` / `accent`; only the low one asks for the eye),
title, sources line ("machine from photo, load from your voice"), a read-only review of what was understood; corrections are TOLD via the same input ("Make a change" returns to the panel), never edited in fields. Primary button label: **Log** → review page → **Log it** / **Make a change**. A record opened
for correction reads: the as-recorded card first, then the change affordance, then a quieter
**"How this was recorded"** list — the quote, with the record's photos attached to it. In Expo Go, Speak is hidden if the
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

### Progress (tab) — goals and training in one place (user decision 2026-08-31)
Header: eyebrow ("2 active" / "No goal set") · `disp` 30 "Progress" · avatar → You.
1. **A card per active goal**: title `disp` 26; standing line "212.0 → 210.4 lb now (7-day
   avg) · 10.4 lb to go · −0.4 lb/wk"; the metric as a `TrendLine` with the target dashed
   across it and a **dotted projection** from today to where the rate lands; the pace verdict
   ("Ahead of / On pace for / Behind · <date> at this rate", `good`/`accent`/`mute`); "This
   week: 5 of 7 served · −0.6 lb"; reached/stalled prompts; Mark reached · Not yet · Adjust
   it · Drop; priority arrows. Then **Add another goal**. Extra metrics of the same goal
   render as small widgets inside its card (`goalSections`).
2. **Lifts** — one row per exercise logged in four weeks, goal or not: name (tappable →
   exercise sheet), working load ("55 lb of assistance" where that is what it is), sparkline,
   sentiment-coloured delta, and the **next step** from `prescribeLoads` with an eta
   ("Hold 135 lb until 3 × 8 twice · ~1–2 wks").
3. **How often** — sessions a week (8 weeks) + sets per muscle group (4 weeks), and one dim
   line naming the groups with no sets at all.
4. **Cardio** — minutes a week against the plan's weekly target, last and best pace.
5. **Body** — the weight line, only when no weight goal owns it.
6. Goal history with outcomes, at the bottom.
Every empty state is one quiet `Sub`; no judgement colours without a goal.
Data: `GET /api/goals`, `GET /api/goals/:id/progress`, `GET /api/week`, and
`GET /api/training/board`.

### You (stack, from the avatars and the tab bar's fourth item)
What was the bottom half of the old Goals tab: **How you train** / **How you eat** (each row
dated with when it was stated, the daily target with its provenance) / **Constraints** and
preferences / **Health sync** (disabled, WP7) / **Account** (email, sign out). Read-only —
NO FORMS; "Tell me" opens the Log sheet.
