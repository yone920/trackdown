# TrackDown v2 — changelog

One section per work package (`docs/build-plan.md`): what shipped, what was deferred, and
every decision that had to be made along the way. This file is the handover.

> **Post-test fix (2026-08-30 pm):** the coach brief is now one per day — a plain ask returns the existing brief (with a `stale` flag when inputs moved); only the first ask, explicit Regenerate, or new context generates. Also: all Pressable function-styles converted to static (NativeWind drops function styles — everything white was invisible on iOS), and the + moved into the tab bar.

## Morning test — read this first

**Two ways to run the app (2026-08-30):**

- **Dev build (recommended — has Speak):** on the iPhone open
  https://expo.dev/accounts/yone920/projects/trackdown-expo/builds/a5557405-b3fb-4739-b2d9-ebb8408f5306
  → *Install*. It is signed for your registered iPhone. It loads its JavaScript from the Metro
  server below, so Metro must be running.
- **Expo Go:** open `exp://100.64.198.50:8081` in Expo Go (Tailscale on). Speak is hidden there.

**Metro was left running on this VM** (100.64.198.50:8081, CI mode → no hot reload). If it is
not answering (`curl localhost:8081/status`), restart it — for the dev build drop `--go`:

**On this VM** (the Omarchy desktop, 100.64.198.50), start Metro:

```bash
cd ~/Work/trackdown
export REACT_NATIVE_PACKAGER_HOSTNAME=100.64.198.50   # Tailscale address of this VM
npx expo start --offline
```

**On the iPhone**: Tailscale on and connected, then open **Expo Go** and scan the QR — or
open `exp://100.64.198.50:8081` directly.

**Sign in**: `yonas.fhs@gmail.com` / `demo-pass-123` (seeded 2026-08-30 with a fat-loss goal and four days; tz −240). If the account has no data,
seed it from `backend/` on the Docker host:
`npm run seed-demo -- <email> --tz <your offset in minutes>` — three closed days and a
half-lived today.

**Android:** the EAS Android build errored in Gradle (build 6134851e); not investigated — iOS first.

### What to try, in this order

1. **Today** — day number and status in the header, the goal banner (or the "no goal"
   state), the cards the goal chose, the *Right now* paragraph with its chips, the day
   arc, Training and Eating.
2. **Log by typing** — the `+`, type "chicken and rice, about 700 calories", *Log*. The
   review page comes back: *Does this look right?* Press **Make a change** and say what is
   wrong — "make it 800 calories" — then *Log it*. Today updates. There is no field to type
   a number into anywhere in this flow, on purpose (concept-v2 principle 7).
3. **Log by photo** — the `+`, Photo, snap a machine display or a plate, add a line of
   narration, *Log*, *Log it*.
4. **Set a goal** — the `+`, "I want to get down to 170 pounds by December". The card
   comes back with the server's projected date and three choices: use the projection,
   keep my date, no date. Confirm — Today's cards change to match the goal.
5. **Days** — the list grouped by week with each week's tally. Scroll to the bottom: it
   pages. Tap yesterday.
6. **Day** — the verdict, the *In short* paragraph, the three stats, training by muscle
   group with each lift's delta, macros against targets, the meals, the body. Use ‹ › to
   walk back through the week. Tap the export button: the share sheet has the day's JSON.
7. **The log as recorded** — from the Day footer. Every entry as it arrived, quoted, with
   what it was understood to be. Tap one → the saved row read-only → *Make a change* → say
   what is wrong → *Save changes* → the Day updates.
8. **Progress** — a section per goal (weight line with its 7-day average and target,
   lifts, weekly bars), then Consistency and Coverage.
9. **Goals** — the goal card with its ring and pace line, reorder with the arrows if there
   is more than one, mark reached or drop. Below: How you train / How you eat /
   Constraints / Health sync / Account, with **Sign out** at the bottom.
10. **Coach** — the accent button on Today. The headline, the *why*, the Do list with
    load × sets × reps, Eat, and *One thing* with a button that actually does something.
    Type a line of context and *Ask again*.
11. **Any exercise name** — the underlined ones on Today, Day, the coach's Do list, the
    DayLog. Two photographs, the numbered steps, the muscles, the kit, and *Watch form
    video*. Try one the catalogue has no pictures of (a walk, a yoga session): it still
    opens, name only, and the video still works.

### What is deferred, on purpose

- **Speak needs the dev build.** `expo-speech-recognition` is a native module; in Expo Go
  the port reports unavailable and the mic control is simply not drawn. Photo and typing
  cover everything, including goals and coach context.
- **Health sync is WP7.** The toggle on the Goals tab is a labelled placeholder; nothing
  reads HealthKit yet, and no screen depends on it.
- The **Resting HR** card on Today and the resting-HR metric on Progress stay hidden until
  Health arrives — an absent number is not drawn as a zero.

---

## Field fixes

Real logs, from the phone, that the build plan had not imagined.

### 2026-08-31 — a log you can take back, and a day that stops asking for dinner (`field-fixes-delete-no-expectations`)

Two changes with one idea under them, which is now **concept-v2 §Principles 8**: the app is a
record of what happened. It can be corrected, and it never shows what was supposed to happen.

#### A — delete, in two taps, wherever the row is

Everything logged could be *corrected* and nothing could be *removed*. The endpoints had been
there since WP1 (`DELETE /api/entries/:kind/:id`, `DELETE /api/weight/:id`); no screen called
them, so a meal logged twice stayed logged twice and moved the ring, the week and the coach's
picture of the day for ever.

- **`DeleteControl` (`components/kit.tsx`)** is the whole affordance: a `dim` stroke ✕ drawn
  at 28 px with `hitSlop={8}` — 44 px of target without changing the row's height. One tap
  arms it and the row grows **"Delete? ✓ ✕"** in place; the second tap deletes. No Alert (a
  modal for a row is fussier than the row), no swipe gesture (undiscoverable, and the row
  already has a tap), **no new dependency**. `Row` takes `onDelete` and draws it; the DayLog's
  hand-rolled row imports the same component.
- **Where it is:** Today's Training rows (in a block and standalone) and Eating rows, the Day
  screen's activity and meal rows, and every activity / meal / **weigh-in** in "the log, as
  recorded". A `goal` is dropped from the Goals screen and a `statement` lives on the plan —
  neither is a row with a DELETE behind it, so neither gets a ✕.
- **`useDeleteRecord` (`lib/queries.ts`)** invalidates through the same `invalidateAfterLog`
  list a confirm uses — day, week, days, goals, profile, coach — so `earned`, the sets per
  muscle group, the status line, the allowance and the **Right-now reading** all recompute on
  the next read. The reading regenerates because the day's inputs hash changed, not because
  anything asked it to.
- **Evidence cascades, verified rather than assumed.** `evidence.activity_id`, `.meal_id` and
  `.plan_id` are `ON DELETE CASCADE` (`0004_v2.sql`), and `.weight_id` likewise
  (`0009_day_log.sql`). The new backend test inserts a photo row against the activity and
  asserts it is gone after the DELETE — the FK is what does it, not application code.
- Nested-Pressable note: on the DayLog the ✕ sits inside the row's own "tap to correct"
  Pressable. React Native gives the touch to the innermost responder, and the test pins that
  arming the ✕ does not open the correction sheet.

#### A′ — and while we were in these rows: tapping one corrects it

Reported alongside the delete: **Today's rows were not tappable at all**, and correcting
anything meant Day → "See the log as recorded" → the row. Two screens deep to fix a number
you are looking at.

The row body now pushes exactly what the DayLog pushes — `{ pathname: '/log', params: {
editDate, editId, editKind } }` — on Today (`editDate` is the screen's own `localDateKey()`,
so it is the phone's local day, not UTC's) and on Day (`editDate` is the day being read, not
today). `/log` already resolves that triple through `useDayLog`, so nothing new was needed on
the other end.

**Three targets on one row, settled by nesting rather than by z-order:** the exercise **name**
(a nested `Pressable`, still opening `/exercise/[id]`), the **✕** (28 px drawn, `hitSlop={8}`,
44 px of target), and the **rest of the row**, which is the correction. React Native hands the
touch to the innermost responder, so the name and the ✕ each win their own area and the row
gets everything else; the row is ~44 px tall on its own padding. The Row's outer Pressable
carries `accessibilityLabel="<title> — open to correct"` and a `-open` testID.

**Not done: weigh-in rows.** The scope note asks for them, and neither Today nor Day *has* a
weigh-in row — Today does not render `items.weights` at all and Day shows weight as three
stat tiles. Making one tappable would mean designing a Body section for Today first, which is
a screen change rather than a wiring change. Weigh-ins remain correctable and deletable in
"the log, as recorded", which already routes. **Flagged for the user.**

#### B — no expectations, anywhere

Today drew a dashed **"Dinner — not logged yet"** row and the arc drew a dashed ghost dot for
the same thing. Both are a to-do list the user never wrote.

- **Gone from the screens.** The placeholder row and the `Row` `dashed` prop are deleted (that
  prop had one caller); `DayArc` no longer draws ghost dots and `buildArc` no longer emits
  them, so `ArcKind` loses `"expected"` and `ArcInput` loses `expected` and `date`.
- **`expected` stays on `GET /api/day`.** The brief's preferred simplification — stop emitting
  it — was checked and refused: `services/readings/` uses it, both in `dayInputsHash` (an empty
  dinner slot changes what the sentence should say) and on the sheet the model is given. So it
  is computed, sent, and rendered by nothing; the field carries a comment saying so on both the
  server type and `lib/types.ts`. `ExpectedItem.at_minutes` *is* gone: it was where the dashed
  dot sat.
- **The prompt.** `VOICE` gains **NOTHING IS OWED**, with the three phrasings named as things
  not to write ("due", "expected", "missing", "still needs to") and the two that are welcome
  quoted beside them, because they are arithmetic: *"a ~650 kcal, 45 g-protein dinner would
  close today's targets"*. `RIGHT_NOW` no longer tells the model to prefer "what the day is
  actually waiting for"; the chip is described as **a shortcut to a screen, not a reminder**,
  and its label as "a place, not an order". The sheet's `EXPECTED BUT NOT LOGGED` heading is
  now `OPEN SLOTS (nothing logged here yet — a fact about the log, not something the user
  owes)`.
- **The action chips stay.** They are how the user gets to the Log sheet in one tap; nothing
  about them says anything is due.
- **The prompt is part of the cache key** (`PROMPT_FINGERPRINT`). Caught on the live read after
  deploying: the day's reading still said *"Dinner is the only meal left to log."* A reading is
  cached until the day's **inputs hash** changes, and the day had not changed — only the
  instructions had, so every reading already written would have kept the old wording until the
  user next logged something. `dayInputsHash` now carries a sha256 of the two prompt bodies, so
  editing the wording rewrites each cached reading once, on the next read. Hashing the prompts
  themselves rather than a hand-bumped version number means the next edit cannot forget; the
  unit test pins the current value so the rewrite is never accidental. `in_short` is unaffected
  — it returns whatever is stored without consulting the hash, because a closed day's reading
  is a record.

**Decisions**

- **Inline confirm over `Alert.alert`.** The question is asked where the answer lands, it is
  testable in jest without mocking a native module, and it costs one `useState`.
- **A Health-sourced row is deletable too.** It is a row in `activities` like any other, and a
  walk the watch invented wrongly is exactly the thing someone wants gone. The next Health sync
  may bring it back — nothing has asked for a tombstone yet, and inventing one for a feature
  that is not built (Phase C) would be guessing.
- **The DayView fixture moved** to `src/test/fixtures/dayView.ts`, out of `readings.test.ts`,
  so the contract test can ask the real model with the **real prompt**. Pinning the wording
  against a hand-written sheet would have pinned nothing.

**Tests** — 445 passing, 2 skipped in `backend` (was 439/2, with the key set so the contract
tests run); 108 passing in the app (was 99).

- `src/app.test.ts` (+1): deleting one lift out of a three-lift block — `earned` drops by its
  calories, the block's `exercise_count` and kcal follow, the allowance is `target + half` of
  what is left, the muscle's set count drops by that row's sets, the Right-now hash changes,
  the row's evidence is gone, and a retry of the same delete is a 404.
- `src/services/readings/readings.test.ts` (+4, one rewritten): the open-slots heading and the
  absence of the old one, the obligation ban present in **both** prompts with the arithmetic
  closer still allowed, the chip described as a shortcut, and the prompt fingerprint pinned.
- `anthropic.readings.contract.test.ts` (+1), **run here against the real model, four for
  four**: the real `buildRightNowPrompt` over the real fixture, with the answer's text, the
  next action's label and hint and every chip label checked against ten obligation phrasings.
- `__tests__/today.test.tsx` (+5): the two-tap delete of a lift with the training line going
  from "264 kcal earned" to "Nothing yet", the same for a meal with the cancel path proving no
  request goes out, a day whose `expected` holds a dinner rendering no trace of it, and the two
  targets on one row — the body pushing `/log` with `editId`/`editKind`, the name pushing
  somewhere that is *not* `/log`.
- `__tests__/day.test.tsx` (+2) and `__tests__/day-log.test.tsx` (+2): the same two taps on a
  closed day, its correction dated **that** day rather than today, the record view, and no ✕
  on a statement.

**Deferred**

- **No undo.** The confirm is the undo; a deleted row is gone. A soft delete would need a
  column, a filter on every read and a place to un-delete from, and nothing has asked.
- **No bulk delete**, and no delete on a whole block: a block is presentation, and removing one
  would mean deciding what happens to the rows inside it.
- **`ExpectedItem` is still called `expected`** in the API and the code. Renaming it (to
  `open_slots`, say) is a response-shape change for a field nothing renders; the comments say
  what it is for and the prompt is where the word mattered.

### 2026-08-31 — a lifting session worth 0 kcal (`fix-strength-kcal`)

**The report.** Four strength exercises logged between 8:00 and 8:39, no calories on any of
them, and the day said **"0 kcal earned"**. Cardio gets a number from the machine or the
watch; a barbell prints nothing, and nothing in the model estimated it. So a real forty
minutes in the gym moved the ring, the balance, the week's deficit and the coach's picture of
the day by exactly zero.

**The fix — a block-level MET estimate, never a stored one.** `services/day/estimate.ts` is
one pure module and it is applied where the blocks are built, on every read:

    kcal = MET × 3.5 × weight_kg / 200 × duration_min       MET 4.5 strength, 2.5 mobility

- **Nothing is written to `activities`.** A row keeps the calories the user or a machine gave
  it and no others (the column stores "nobody said" as 0, not NULL). The estimate is derived
  like the blocks themselves, so a correction — or a watch that turns up later with the real
  figure — replaces it rather than adding to something already saved.
- **Order matters.** buildBlocks → the Health overlap merge → the estimate. A block a watch
  measured keeps the watch's number: our guess about the same minutes is not an improvement,
  and adding both is the double count the overlap rules exist to prevent.
- **No double count inside the block either.** Minutes an activity's own calories already paid
  for are subtracted from the span before the estimate covers what is left, so the bike's 20
  minutes and its 180 kcal are never charged twice. Cardio is never estimated at all.
- **Floors and caps.** What remains is floored at **8 minutes per estimable exercise** (a lift
  logged at a single instant has no span, and no span must not mean no work) and capped at
  **120 minutes**. Those minutes are split between the exercises: one that named its own
  duration weighs that, one that did not weighs the 8-minute default, each at its own
  category's MET. Rounding is per exercise and the block is the sum, so the rows and the
  header always add up.
- **Which body.** `weight_kg` is the day's weigh-in (the mean, if several), else the latest one
  before it, else the plan's goal weight, else 80 kg. A wrong weight moves the answer a few per
  cent; no estimate moves it to zero.

The field case: 39 minutes, four exercises, 190 lb → 4 × 66 = **264 kcal**.

**One number, everywhere.** `Block.kcal_estimated` is new (presentation only, no schema
change). `earned` is Σ blocks as before, so the ring, the allowance, the balance, the week's
deficit and `daily_summaries` at close all move together — the close writes `computeDay`'s own
view, and the week reads the frozen record for a closed day and recomputes an open one; both
were checked against each other in the test. The one place that *did* read a rawer sum was
`goals/measures.ts` `calorie_balance`, which sums the facts window's activity kcal: `buildFacts`
now runs the same blocks → merge → estimate path per day in the window and carries each lift's
share on its fact (`kcal_estimated` beside it), so the measures, the goal progress and the
coach's "Earned from activity" read exactly what the ring reads. The coach's `today.earned`
already came from `view.earned` and needed no change; verified in the test rather than assumed.

**The label.** Today's training line and each block header, and the Day screen's *Earned* tile
and training line, carry a quiet **"est."** — `C.dim`, no caps, no colour — via new optional
`note` props on `Section` and `GroupHeading`. The Right-now and In-short readings read the
estimated value like any other number; they are told the day, not the provenance.

**Tests.** 12 new: the estimation maths (span, the per-exercise floor, the cap, mixed
cardio + strength, duration weighting, mobility's own MET, a watch-measured block left alone,
the weight fallbacks), `buildFacts` → `calorie_balance` agreeing with `earned`, the whole thing
end to end over real rows (earned 264, rows still 0, the close, the week, the coach's inputs),
and the "est." marker on Today.

### 2026-08-31 — no forms: review it, or tell it what to change (`wp-no-forms`)

Two field reports, one answer. The first: in the Log sheet the keyboard covered the box
being typed into and nothing would scroll far enough to bring it back. The second is a
product decision rather than a bug — **NO FORMS is a product law** (concept-v2 principle 7,
user decision 2026-08-31): the user types it, says it or photographs it; the app shows what
it understood; the user approves it or **tells** it what to change. Sign-in is the only
screen in the app with a field on it.

#### A — the keyboard, and why using both fixes is the bug

`automaticallyAdjustKeyboardInsets` on the ScrollView and `KeyboardAvoidingView` with
`behavior="padding"` each add the keyboard's height to the layout, so together they move
the content up twice as far as the keyboard is tall. The sheet had the second one, in a
**modal presentation**, where `keyboardVerticalOffset` is a number JS cannot know — the
sheet's offset from the window is UIKit's, and the offset that was there (none) is what put
the input under the keyboard.

So the rule is one function, `lib/keyboard.ts`, and it is that **iOS uses the scroll view's
own inset and Android uses the padding, never both**. `automaticallyAdjustKeyboardInsets`
is UIKit measuring the keyboard against the window: it insets the content, scrolls the
first responder into view, and is correct inside a modal by construction.
`keyboardPadding()` returns 0 on iOS *because the inset already did it* and the keyboard's
height on Android, which has no such inset and keeps the `KeyboardAvoidingView`
(`behavior="height"`). `keyboardDismissMode="interactive"` on both screens. Applied to the
Log sheet and to the coach's context box, which is the last thing on its screen and was
covered the same way.

**What could not be verified here:** the VM has no iPhone and no simulator. The logic is
unit-tested, the app typechecks and `npx expo export --platform ios` builds; that the
keyboard now behaves on the device is for the morning test.

#### B — Log → review → Log it, and "Make a change"

The Log sheet is two steps and neither has a form in it.

- **Say it.** The box, the photos, Speak — and one button, now called **"Log"** (it said
  "Read it").
- **Review.** Its own page: *"Does this look right?"*, the recognised parts as **read-only**
  cards, each droppable with its ✕, the refinement chip still one tap and still ignorable.
  **"Log it"** saves through the same confirm as before. **"Make a change"** goes back to
  the box with the parts kept and the placeholder *"Tell me what to change — 'reps were 3,
  not 4'…"*.
- A question (`unclear`) is not a review: it stays on the say-it step, where the answer to
  it is typed, and the clarify round is unchanged.

**`components/confirm-card.tsx` lost its TextInput grid** — every value is text now, and a
fact nobody read is simply absent rather than an empty box inviting a keyboard.
`components/fields.tsx` is deleted; nothing imported it.

#### C — the revision is the same call, not a new grammar

`POST /api/log/analyze` takes `revise: { results | record, instruction }`. Each part is
re-read by **its own existing detail call** (`ActivitiesDetailOutputSchema`, `meal`,
`weigh_in`, `goal_spec`, `statement`) with the part as compact JSON and the instruction in
the system prompt. No new union, no new branch, nothing added to the routing schema — the
grammar ceiling is a field budget and this change spends none of it.

- One call per part, in parallel, each told to return its part unchanged if the instruction
  is not about it. "That meal was lunch not dinner" is safe to say at a log holding a meal
  and a run.
- The prompt's one repeated rule: everything the user did not mention comes back exactly as
  it went in. "reps were 4 and it was 50 pounds" against 3 × 12 @ 45 is **3 sets**, 4 reps,
  50 lb.
- `carryForward` keeps `category` and `muscle_groups` — which the detail schemas never carry
  — across a revision, but only while the movement is still the same movement. Without it,
  correcting the reps on a saved row would have quietly deleted it from coverage.
- An `unclear` part is never sent: there is nothing in a question to revise.
- A revised goal is re-projected by `services/goals/proposal.ts` like any other preview.

#### D — the DayLog correction is the same screen again

Tapping a row in "the log, as recorded" opens the saved row **read-only**, with "Make a
change" as the only thing to press — a PATCH of the values it already has is not a
correction. Telling it the change sends that one row as `revise.record`, and the revised
values go out as the PATCH. `lib/edit-record.ts` survives, doing exactly what its name says
in both directions.

**Decisions**

- **Two revise shapes, not one.** `results` is a pending preview, `record` is one saved row.
  They are the same public union and the service treats them the same; the two names are so
  the request says which of the two things is being corrected.
- **A revision brings no photos.** The evidence belongs to the round that read it, and the
  round that produced these parts already stored it. A revise with photos attached is a 400.
- **The refinement chip stays, and it is not a form.** One tap on an offer the reader
  derived, with no keyboard and nothing to fill in. It is the only thing on the review page
  that changes a value.
- **A correction cannot be dropped.** The ✕ is on every card of a fresh log — removing the
  last one returns to the say-it step with the words still in the box — and on none of a
  saved row, because dropping a row that exists is a delete and a different verb.
- **The old `showActions` / `onSave` / `onAddMore` props are gone from the card.** The
  screen owns the buttons; the card draws what was understood.
- No new dependencies. No migration.

**Tests** — 422 passing, 2 skipped in `backend` (was 410/2, with the key set so the contract
tests run); 97 passing in the app (was 89).

- `src/services/fusion/fusion.test.ts` (+6): the kind each result revises through and the
  silence on a question; the compact part with the provenance and the chip taken out; the
  muscle groups carried across a change and *not* carried onto a renamed movement; the
  round trip through the fake, one call, on the analyze pipeline's own schema; and three
  parts revised at once with the question skipped.
- `src/app.test.ts` (+4): a told change on the pending parts, confirming afterwards through
  the unchanged confirm; one saved row as `record`; the four ways a revision is refused;
  and a revised goal's timeline re-projected.
- `anthropic.fusion.contract.test.ts` (+2), **run here against the real model, thirteen for
  thirteen**: "reps were 4 and it was 50 pounds" changing two numbers and leaving the third,
  the movement, the machine and the muscle groups alone; and "that meal was lunch not
  dinner" moving the slot and nothing else.
- `__tests__/log.test.tsx` (rewritten, 14): the button that says Log, the review page as its
  own page, **no TextInput anywhere on it**, the told change round trip with what goes out
  on the wire, the confirm still carrying the words that were SAID rather than the
  instruction that changed them, "never mind", the question that stays on the input step,
  the stack of parts with one ✕ and one save, the clarify round, and the keyboard rule on
  both platforms.
- `__tests__/log-correction.test.tsx` (new, 2): the saved row read-only with nothing to save,
  then told → `revise.record` → the review again → the PATCH with the revised values and the
  muscle groups still on it.
- `__tests__/confirm-card.test.tsx` (rewritten, 13): every kind drawn read-only, the facts
  nobody read left out rather than drawn as blanks, the meal's slot, the statement in quotes,
  and the chip still one tap.

**Deferred**

- **A revision is one instruction, not a conversation.** Each one is sent with the parts as
  they stand and no memory of the last instruction — the same limit the coach's revisions
  have, for the same reason: nothing has asked for a thread yet.
- **The keyboard is unverified on hardware.** See A.
- **`revise` costs one model call per part on screen.** Three cards is three calls, in
  parallel. Telling the model which part an instruction is about would need a router, which
  is a call of its own; at one to three parts the parallel calls are cheaper and simpler.
- **Removing the last part goes back to the box, it does not close the sheet.** The words
  are still there, which is usually what someone wants after dropping a misreading, but it
  is a guess and no one has said either way.

### 2026-08-31 — always log, the machine as its own fact, and a gym that remembers itself (`field-fixes-best-effort-places`)

One transcript, said out loud into the Log sheet by someone who did not know the name of the
machine they had just used:

> "I don't know what it is called but it is something is inclined, but I lay down on my tummy
> on my tummy and I pulled it up to my chest from down up down up. I don't know what that
> mission is called kind of inclined, but I laid up I lay on my tummy and using my BOSS hand
> pull it up to my chest. I don't know what that exercise what that machine is called but I
> did three reps of three sets of 12 rep at 45 pound."

It came back as a question. Three sets of twelve at forty-five pounds, described twice over
in as much detail as anyone could give, and the app asked what it was instead of writing it
down. That is the wrong trade in every direction: the numbers were certain, the name was not,
and the one thing the user cannot do later is log a workout that was never saved.

#### A — a question never gates a workout

- **`unclear` is now a last resort in the prompt.** It is for input that cannot be
  interpreted at all — a stray word, a photo of nothing. If a *movement* was described,
  however hazily, it is an activity, and every field is filled in with a best guess: the
  catalogue name when the reader is reasonably sure, a short phrase in the user's own words
  when it is not, the numbers exactly as stated, and a **low confidence** to say so. "That is
  what the low confidence is FOR. It is not a reason to return unclear."
- **A guessed movement is not a movement with nothing in it.** A paraphrase resolves to
  nothing in the catalogue, so the day used to see a workout with no muscle groups — invisible
  to coverage and to weekly sets. When the user's words point at exactly one catalogue entry,
  the item borrows that entry's category and muscle groups **on the confirm card, before
  anything is written**, which is the whole difference between a guess and a fabrication.
- **The refinement chip.** The same match becomes a one-tap offer — "Was it a Chest-Supported
  Row?" — that fills in the catalogue name and its id. It never blocks the Save, it is not
  drawn when the card already says what it would suggest, and it can be ignored forever.
  `services/fusion/refine.ts` is the matcher: stopword-stripped, crudely stemmed
  ("inclined" and "incline" are one word to a gym), scored on shared distinctive tokens
  across a name and its aliases, silent on a tie.

#### B — the movement and the machine are two facts

`0012_places_equipment.sql` adds **`activities.equipment`**. "Chest-Supported Row" is the
movement; "chest-supported row machine", "cable stack", "dumbbells" is the kit. Squashing them
into one string made the exercise name unmatchable *and* threw away the one detail the user
was actually sure of. It is on the confirm card as its own field, the sub-line on the Day and
in the DayLog's "understood" line — and `delta_vs_last` still keys on the movement, because
"heavier than last time" is a claim about the lift, not about which machine was free.

#### C — the clarify loop remembers its question

For the rare log that really cannot be read. `POST /api/log/analyze` takes `clarify_original`
and `clarify_question`; the app keeps both when a question comes back, empties the box, flips
the placeholder to "Answer the question…", and sends all three next time. "Yes" on its own is
not a log. "Yes" plus the question plus the words it was asked about is.

#### D — places, and what has been seen in them

Passive, and there is no form anywhere in it.

- `0012` also adds **`places`** (name, kind gym|home|travel|other), **`place_equipment`**
  (label, `exercise_id`, `first_seen`, `last_seen`, `times_seen`, source, unique on
  `(place_id, lower(label))`) and **`profiles.current_place_id`**.
- **"My gym is New Millennium"** — the statement's own detail call now extracts `place_name`
  and `place_kind`; the confirm upserts the place and makes it the current one.
- **Every workout saved afterwards accrues against it**, at confirm time: the machine it
  named, and the movement when the movement was identified. Bumping `last_seen` and
  `times_seen` rather than writing a second row, so it is safe on a replayed confirm.
- **The coach is told, in one line**: what has been seen there, most used first, with the
  instruction to prefer it, assume barbells and dumbbells and benches anyway, and name a
  substitution from the list when it prescribes something not on it. Observed is evidence of
  what is there, never proof of what is not.
- `GET /api/profile` returns `place` with an `equipment_count`, and the Goals tab's **Where**
  row reads "New Millennium · 14 machines seen".

**Decisions**

- **The grammar ceiling is a field budget, not a byte budget — and the byte pin was never
  weighing the right bytes.** `fusion.test.ts` measures `z.toJSONSchema(...)`; what the SDK
  actually sends is `zodOutputFormat(...)`, a different and larger document (bounds and enums
  become `description` strings, shared shapes become `$defs`). Adding `equipment` to the
  routing union was refused *at fewer JSON-schema bytes than the shape that shipped*, and
  stayed refused when the field was moved onto the branch, when the item's integers were
  relaxed to plain numbers (−600 bytes), and when the array bounds came off. It compiled only
  when another field came off the union. Every row of that was a real request against the live
  API; the table is in the note on `FusionRouteOutputSchema`.
- **`photo_fields` paid for `equipment`.** It was three copies of one fact — the meal branch's,
  the weight branch's, and one per activity item — answering a question about the whole log:
  which fields were read off a photo, when there is one message and one set of photos. Hoisted
  beside `result` it is a net −2 fields, which bought `equipment` with room to spare. The cost,
  stated plainly: within one activities log every item now shares one photo attribution. The
  focused per-kind calls keep their own, where there is room.
- **The size test now pins the field count, not the bytes**, and says in as many words that
  only `anthropic.fusion.contract.test.ts` knows. The old exact-byte pin was worse than
  useless: it went *down* while the schema became one the provider would not compile.
- **The refinement is derived, not asked for.** The model already has the whole catalogue in
  its prompt; if it could name the movement it did, and the save resolves it. This function is
  for the other case, and it answers a narrower question than the model was asked. It also
  costs the union nothing, which after the above is not a small consideration.
- **A named gym is a preference, not coach context.** The router called "my gym is New
  Millennium" a passing state — reasonably, on the old wording — so no plan-fields call ran and
  no place was ever created. One line in the routing rules ("WHERE they train and what it is
  called") fixed it; proved on the live model.
- **An unidentified exercise is not equipment.** A paraphrase of a movement the user could not
  name is their words, not a machine, so it is not accrued as a place label. The machine beside
  it is, and that is the half worth keeping.
- **No place set is the normal state** and every function in `services/places.ts` returns null
  or does nothing for it. Nothing upstream checks first, and nothing fails.
- No new dependencies. One migration.

**Tests** — 410 passing, 2 skipped in `backend` (was 384/2, with the key set so the contract
tests run); 89 passing in the app (was 82).

- `src/services/fusion/fusion.test.ts` (+11): the prompt's best-effort policy and the
  reserved `unclear`; the clarify block present and absent; the stemmer, the stopwords, the
  candidate and its silence on a tie; the three gates on the offer; the borrowed muscle groups
  and the ones it leaves alone; and the field-count pin on the routing union.
- `src/app.test.ts` (+15): the transcript above through analyze → confirm — one part, sets 3,
  reps 12, load 45, the machine on its own field, the muscle groups off the catalogue, the
  confidence low, and **no question**; the machine as the Day's sub-line and in the DayLog's
  understood line; the chip offered when the reader could only paraphrase; the clarify round
  end to end and the half-round ignored; a confirm with **no place set** saving cleanly; the
  place named from one sentence; accrual **idempotent per label**, case-insensitively, with an
  unidentified movement not counted; the coach's line present with data and absent without.
- `anthropic.fusion.contract.test.ts` (+4), **run here against the real model, eleven for
  eleven**: the nameless-machine transcript coming back as one activity with 3 × 12 at 45 and
  a low confidence; the machine kept out of the movement's name; "my gym is New Millennium"
  read as a place; and a bare "yes" resolving against the question it answers.
- `__tests__/log.test.tsx` (+2), `__tests__/confirm-card.test.tsx` (+3),
  `__tests__/goals.test.tsx` (+2): the question remembered and both halves sent back, and no
  clarify round on an ordinary log; the machine line and its field; the chip's one tap and its
  absence; the place row, singular and plural, and nothing drawn without one.

**Deferred**

- **The chip is one candidate, or none.** A tie is silence, which means the hardest cases — the
  ones where two movements fit equally — get no offer at all. A short list of two would be a
  better answer and needs a card that can draw one.
- **`place_equipment.source` is only ever `fused` or `stated`.** Nothing reads a machine off a
  photo into it yet, though the column and the check constraint are ready for it.
- **A place cannot be renamed, listed or switched from a screen.** Saying a different gym makes
  that one current, which is the only control there is. There is no screen for the equipment
  list either — it is memory the coach reads, not a page.
- **One place at a time.** Travelling means saying so; nothing infers a place from a location
  or a time of day, and nothing ever should without being asked.

### 2026-08-31 — a background, a brief you can argue with, and a screen that waits well (`field-fixes-background-revisions`)

Three things the morning test turned up, in one branch because they are all the same
complaint: the coach answers as if it has met you before, and the app loses what it is
showing you while it goes and asks.

#### A — a cold start is not a beginner

Someone who has trained for three years and installs this today has no history in it. The
coach read "no history" as "new to lifting" — `prescribeLoads` had nothing to prescribe
from, and the prompt was handed "no history yet: prescribe no loads". But they can simply
say so, and now one sentence into the Log sheet is enough.

- **Migration `0011_training_background.sql`** adds `profiles.experience`
  (beginner | intermediate | advanced), `profiles.background` (their own words) and
  `profiles.reference_loads` (jsonb `[{ exercise, load_lb, reps }]`). All three are stated
  facts, so all three are dated in `stated_at` like every other plan field.
- **The statement's own call learns to read them.** `ProfileFieldsSchema` — the second,
  focused call behind a constraint or a preference — gained the three fields, and the
  prompt says how: a claim of experience or a judgement from what they described, the
  history in one line, and one `reference_loads` entry per lift they say they do *now*
  ("I bench 165 for 3x5"). A load they want to reach is a goal and is explicitly not one
  of these.
- **Saving it is a profile merge and nothing else** — zero coach calls, pinned by a test.
  `reference_loads` merges rather than replaces: restating a lift updates its entry in
  place, a new lift is appended, and the list keeps the order things were first named.
- **`prescribeLoads` prescribes from a stated load** when the exercise has no logged
  history: same shape of prescription, `rule: "reference"`, `days_since: null`, three sets
  at the weight they named. The moment the exercise has real sessions, the log wins and
  the reference is not read again.
- **The prompt is told what it knows.** `CoachPlan` carries `experience` and `background`;
  the reference loads arrive as prescriptions, not as prose to parse. With nothing stated
  *and* nothing logged the rules say so in as many words — "Do NOT assume a beginner and
  do not assume an athlete" — and the nudge becomes `tell_background`, a button that opens
  the Log sheet in statement mode.

#### B — revisions, and never a blank brief

The field report: "give me 7-8 workouts" typed into the Coach screen, and nothing shown.
Both halves of that were real bugs.

- **`POST /api/coach/next/regenerate` takes a `revision`.** The model is handed the day's
  current brief as compact JSON plus the instruction, and must return the whole revised
  brief — "make it 8 exercises", "switch to legs", "harder", "I feel like chest". A
  revision is in the inputs hash, so two different instructions on one day are two rows,
  and a revised brief is the day's standing answer like any other (sticky rules unchanged).
- **The Do list may hold ten.** It was capped at six, and "give me 7-8" asked the model to
  answer past its own grammar. A bound on an array costs no grammar bytes; the prompt still
  says 4–6 unless the user asked for more.
- **A training day with an empty Do list is refused.** It parses — a rest day needs an
  empty array — and it is not an answer. `assertUsableBrief` throws on it,
  `services/coach/coach.ts` asks once more, and if the second answer is no better the
  route serves the previous brief with `stale: true` and a one-line `note`. **Nothing
  empty is ever stored**, which was the sticky half of the bug: one such brief written to
  `coach_briefs` became the day's standing answer and every later ask replayed it.
- **The app never blanks.** `useCoachNext` took the typed line as part of its query key, so
  every Ask started a brand-new, empty cache entry — the brief vanished for the duration —
  and fired a GET *alongside* the POST, which is two model calls for one tap. The hook now
  takes no context, the Ask button is the only thing that writes, and its answer goes
  straight into the cache with `setQueryData`.
- **`app/coach.tsx`**: once there is a brief the box is for adjusting it — the placeholder
  becomes "Adjust it — 'make it 8 exercises', 'switch to legs'…", the section reads "Not
  quite right?", and what is typed is sent as `revision`. While it runs, the brief stays
  where it is under a "Rewriting your brief…" line. On failure the note prints above the
  brief that was kept. An empty Do list is drawn as "Rest today." only when the workout
  really is rest; anything else says no exercises came back and what to do about it.

#### C — perceived and real speed

- **A shared `Skeleton` / `SkeletonLines`** in `components/kit.tsx`, in the design's own
  tokens (`track` on `card`, the same radii, a slow two-second pulse, no shimmer). Used on
  the exercise sheet (two tiles the exact size of the photographs, four lines where the
  steps go), the Day screen (verdict, paragraph, three stat cards), the Log sheet's
  analyze, and the Coach screen's first brief. The exercise sheet already opened instantly
  on the name it was tapped with; now it stops jumping when the row lands.
- **`expo-image` with `cachePolicy="disk"`** on the exercise frames and the evidence
  thumbnails, plus a `recyclingKey`. Both are immutable once written and both are looked at
  repeatedly, so the second view costs no request at all. `expo-image` was already a
  dependency and was already in use in both places — only the cache policy is new.
- **`Server-Timing` on `/api/exercises/:id` and `/media/:n`** (`backend/src/middleware/
  timing.ts`): `auth` is the Better Auth session lookup every `/api` request pays, `db` is
  the catalogue row, `open` is the file handle, `total` is up to the header. It is not a
  global hook — a header on every route would say nothing; these two are what the phone
  waits on when a name is tapped.

**Measured, through `https://trackdown-api.yonelab.net` from the Omarchy VM** (five runs
each, seconds):

| | before (`dd37f1f`) | after (`25e0834`) | `Server-Timing` |
|---|---|---|---|
| `/api/exercises/:id` TTFB | 0.106 – 0.173 | 0.095 – 0.155 | `auth 2.1–2.2 · db 0.3–0.7 · total 2.9–3.3` |
| `/api/exercises/:id/media/0` total, 54 KB | 0.119 – 0.171 | 0.107 – 0.156 | `auth 1.7–2.5 · db 0.3–0.5 · open 0.1 · total 2.5–3.5` |
| `/health` — no auth, no route work | 0.099 – 0.151 | 0.094 – 0.112 | — |

The answer the measurement gave: **the server is not the slow part, and it is not close.**
Either exercise route does about **3 ms** of work — 2 ms of it the Better Auth session
lookup, well under a millisecond for the catalogue row, a tenth of a millisecond to open
the file — against 95–155 ms on the wire. An unauthenticated `/health`, which does none of
that work, costs the same 95–112 ms, so effectively all of the wait is the cloudflared
tunnel round trip from this VM. The header now says that per request instead of leaving it
to be guessed. Nothing was "fixed" server-side because there was nothing to fix there — the
per-request auth query is 2 ms and stays — the win is the disk cache, which removes the request entirely on
every look after the first, and the skeletons, which remove the wait from the part the user
sees.

**Decisions**

- **The empty-brief guard lives in the service, not the adapter.** `adapters/coach/llm.ts`
  keeps its own retry for a malformed sample, but "a training day has something to do in
  it" is a rule about briefs and not about a provider, so it is in
  `services/coach/coach.ts` where every `CoachPort` — a rules-only coach, a hosted one —
  has to clear it. The fake coach validates against the real schema and *lets* an empty Do
  list through, because a fake that refused it would hide the bug it was written for.
- **A revision is not context.** Context is a fact about today the next brief should
  account for ("knee hurts"); a revision is an instruction about the answer in front of
  you. They are different fields on the request and different blocks in the prompt, and
  only the revision is handed the current brief.
- **A stated load is stepped down after a gap only when the gap is measured.** On a brand
  new account `days_since_last_workout` is null and `gapRule` calls that a restart — but
  "we have never seen you train" is not "you stopped training", and taking a plate off a
  weight the user just told us they lift is precisely the beginner assumption this change
  removes. After eighteen days since a *logged* session, the reference eases back with
  everything else.
- **The background rides on the second call, not the routing schema.** The routing union
  has about eighty bytes of headroom (see `fix-mixed-fusion`); `plan_fields` went
  964 → 1570 bytes and `statement` 1081 → 1687, and the routing schema is 3580, exactly
  what it was. Pinned, and proved on the live model by a contract test.
- **`tell_background` sits after the goal candidates and before every data-quality nudge.**
  With nothing logged, "no weigh-in" and "seven unlogged days" both fire and both are worse
  things to say to a new user than "tell me where you are starting from" — which is also
  the one answer that improves every brief after it.
- **`experience` / `background` / `reference_loads` are on `PATCH /api/profile` too**, for
  the same reason every other plan field is: single-field tap to correct.
- No new dependencies. One migration.

**Tests** — 384 passing, 2 skipped in `backend` (was 360/2, with the Anthropic key set so the
contract tests run); 82 passing in the app (was 73).

- `src/services/coach/rules.test.ts` (+10): a stated load prescribed and its shape; a
  logged exercise overriding it; the cold start taking it at face value against the
  measured gap easing it back; `tell_background` beating every data-quality nudge and
  stopping the moment one word is stated; `buildRules` refusing to assume a beginner, and
  pitching at a stated background instead; `assertUsableBrief` on rest, cardio, mixed and
  strength.
- `src/app.test.ts` (+11): the revision round trip end to end — the model handed the
  current brief, eight exercises back, the revised brief becoming the day's answer; the
  empty-workout brief retried once, **not stored** (`coach_briefs` row count unchanged) and
  the previous brief served with a note; a rest day still allowed through; the provider
  outage on a revision; the 400 on an over-long revision. Plus the background: the
  cold-start nudge, one sentence saving all three fields with **zero coach calls** and a
  `stated_at` on each, the first session prescribed from the stated 165, a restated lift
  updating in place, and the log taking over at 175.
- `src/services/fusion/fusion.test.ts` (+1, and `statement` added to the size pins): the
  routing schema still 3580 bytes, the widened plan fields parsing, and the two things they
  refuse (an unknown experience level, a load with no exercise on it).
- `anthropic.fusion.contract.test.ts` (+1) and `anthropic.coach.contract.test.ts` (+2),
  **run here against the real model, ten for ten**: "I've been lifting three years, I bench
  165 for 3x5" coming back as intermediate + a background line + one 165 × 5 reference and
  *not* as a workout; a revision returning seven to ten exercises with the nutrition card
  and the nudge intact and the bad knee still respected; and "switch to legs" rebuilding
  the session rather than appending to it.
- `__tests__/coach.test.tsx` (new, 9): one GET on open and nothing else; the typed line
  going out as `revision` with a brief and as `context` without one; **one** request per
  tap; the brief staying on screen mid-flight and after a failure, with the note above it;
  the empty Do list explained; the rest day not explained away; and the cold-start nudge
  routing to the Log sheet.

**Deferred**

- **A revision is not a conversation.** Each one is sent with the day's current brief and
  no memory of the last instruction, so "make it 8" then "now swap the rows" works only
  because the first is already in the brief being revised. A thread of instructions needs
  somewhere to keep them and nothing has asked for one.
- **The stated background is not editable on a screen.** It is on the profile row and
  `PATCH /api/profile` takes it, but the Goals tab does not draw it yet. Correcting it
  today means saying it again, which restates in place.
- **`Server-Timing` is on two routes.** The coach and the day are the other two the phone
  waits on, and both are dominated by a model call that is already logged. Add it when
  there is a question it would answer.
- **The tunnel is the latency.** ~100 ms of round trip from this VM on every request,
  including `/health`, against 3 ms of server. Nothing in this branch addresses it; a
  serious answer is a closer edge or a shorter path, and it is a network decision, not a
  code one.

---

### 2026-08-30 — one input, several things (`fix-mixed-fusion`)

People do not log one kind at a time. "Ate two eggs and toast, then ran 5k, weighed in at
181" is a meal, an activity and a weigh-in; one analyze returned one `FusionResult`, so two
of the three were dropped on the floor without a word. The product rule is concept-v2
§One input mechanism — the user says everything at once, the app sorts it out, one Save
writes it all — and the pipeline did not implement it.

- **The routing call now segments as well as routes.** It answers with the first thing the
  user said, in full, plus `more_kinds`: the bare list of what else is in there, in the
  order they said it. Each of those is filled in by a focused call with only its own kind's
  schema (`activities`, `meal`, `weigh_in`, `goal_spec`, `statement`), and all of them run
  in one `Promise.all`. So a mixed log is two round trips, the same as a goal has always
  been.
- **`POST /api/log/analyze` returns `results: FusionResult[]`** in statement order, with
  `part` on each stored evidence row saying which result the photo was read for. `result`
  is still returned when there is exactly one part, for one release of app compatibility.
- **`POST /api/log/confirm` takes `results[]` and `evidence_parts[]`** — one `client_id`,
  one transaction across every part. A meal that saved while the weigh-in beside it failed
  would be a day the user has to repair by hand, so it is all or nothing. The response
  gained `kinds` and `parts` (the ids each part became, in order) beside the existing
  first-of-each fields, plus `meals` and `weights`. Idempotency is unchanged.
- **App**: `app/log.tsx` draws one `ConfirmCard` per part down the sheet, each editable and
  each removable with an ✕, under a single "Save all 3". Removing a part takes the photos
  read for it with it. "Add more" saves the batch and keeps the sheet open. `ConfirmCard`
  gained `onRemove`, `showActions` and a `testID`; on its own — the DayLog correction — it
  is exactly what it was.

**Decisions**

- **The grammar ceiling is about 3.66 KB, not the 4.5 KB the old pin claimed, and the byte
  count is not what it measures.** The design called for a segmenter call in front of
  everything; that was rejected because it puts a second round trip on the hot path
  (logging a workout or a meal) to answer a question that *is* the routing decision. The
  obvious alternative, `results: FusionRoute[]`, was implemented, measured at 3.7 KB —
  under the pin — and refused outright by Anthropic with "the compiled grammar is too
  large": an array multiplies a union's grammar by far more than its JSON bytes. Measured
  against the live API, from a routing union of 3486 bytes: `+ more_kinds: SegmentKind[]`
  3655 **OK**; `+ more_kinds` and one string field 3687 **FAIL**; `+ more: [{kind, text}]`
  3764 **FAIL**; `+ more: [{kind, text, photo_indexes}]` 3908 **FAIL**. So a segment is a
  bare enum value and nothing else. It is not even monotonic in size — a 4.2 KB probe of a
  different shape compiled — which is why `fusion.test.ts`'s pin is now documented as an
  early warning and `anthropic.fusion.contract.test.ts` is named as the real gate. **Run
  the contract test before believing any change to a model-facing schema.**
- **A segment carries no quoted text.** There is no room for one, and the follow-up call is
  handed the whole original message anyway — quoting the words back at it would tell it
  nothing it cannot read for itself. It is told which kind to pull out and to leave the
  rest alone, since another call is already reading those.
- **`SEGMENT_KINDS` is the router's own five words, not the public seven.** Naming
  `constraint` / `preference` / `coach_context` in the list was tried and the model ignored
  it: the routing rules directly above it in the same prompt call all three "statement", so
  that is what it answered with, and the enum rejected it. The scope comes back from the
  statement's own follow-up call, which has room for it.
- **A weight stated on the way to a goal is still one part, not two.** The prompt says so
  and the model mostly obeys, but on the 212-goal field report it listed a `weight` part
  beside the goal — which would have put 212 on the scale twice in one Save.
  `dropWeightStatedWithGoal` removes a weight part within 0.5 lb of the goal's stated
  `current_weight_lb`; the goal's own weigh-in is the one kept, because it is what the
  timeline is projected from.
- **The transcript is kept once per part.** Three records from one sentence each get their
  own evidence row with the same words, so the DayLog shows "You said …" under all three
  rather than only under the first. For a single-part log this is byte-for-byte what it was.
- **Call counts are unchanged on the hot path**: one call for a single activities / meal /
  weight / coach context, two for a single goal or constraint — pinned by tests. A mixed
  input costs one call per extra part, in one extra round trip.
- No new dependencies. No migration.

**Schema sizes** (JSON bytes, `fusion.test.ts` pins them all under 4500 and the routing one
under 3660): `fusion_result` **3580** · `goal_spec` 1586 · `plan_fields` 964 · `activities`
1257 · `meal` 1430 · `weigh_in` 479 · `statement` 1081. The routing schema was 3486 before
this and would have been 3655 with `more_kinds` alone; dropping the pointless `maxLength: 40`
from `photo_fields` (three occurrences — the strings are only matched against a fixed list
of field names) paid for most of it.

**Tests** — 344 passing, 2 skipped in `backend` (was 324/2); 67 passing in the app (was 64).

- `src/services/fusion/fusion.test.ts` (+11): the three-part split and its call count and
  schema names, the dedupe of a repeated kind, the statement segment's scope, the goal
  segment naming its own title, the photo claim and its fallbacks, the unclear-alone rule,
  the weight-with-a-goal dedupe, the two new prompts, and the routing schema's size.
- `src/app.test.ts` (+4): "ate two eggs, ran 5k, weighed in at 181" end to end — three
  parts out of analyze, one confirm, ids back in order, three rows in three tables, the
  transcript against each, and **zero CoachPort calls**; the photo filed against the run
  and not the plate; a part that cannot be saved rolling back the ones that can; and a
  single-kind log answering exactly as before, including the old single-`result` body.
- `anthropic.fusion.contract.test.ts` (+3, against the real model): the sentence splitting
  into meal + activity + weigh-in in the order said and in miles, a three-exercise workout
  staying ONE part, and a photo landing on the activity rather than the meal. Run here,
  green — six for six.
- `__tests__/log.test.tsx` (+1), `__tests__/confirm-card.test.tsx` (+2): the stack, the ✕
  dropping a part and its photo, one Save with `results[]`, and the card's own buttons
  hidden when the sheet draws them.

**Deferred**

- **A photo cannot be moved between parts by hand.** The model assigns it and the user can
  only drop the whole part. Rare enough to wait for a complaint.
- **"Add more" still saves first.** It writes the batch and reopens the sheet rather than
  appending to an unsaved one, which is what it did before; a true multi-turn basket needs
  the preview to survive a second analyze, and nothing has asked for it yet.
- **The routing schema has under a hundred bytes of headroom.** The next field on it will
  most likely not fit. When one is needed, the meal branch's nested `items` array (528
  bytes) is the thing to move to a focused call — at the cost of the plate breakdown on the
  single-meal hot path.

### 2026-08-30 — a goal with facts in it (`fix-goal-fusion`)

One sentence typed into the Log sheet broke three things at once:

> "Currently I am 212 lbs, my goal is to go down to 200 lbs. come up with reasonable time to
> achieve that. I work out 4 days a week. At the same time I want to build body mascle. I am
> 45 read old. I go to gym to workout. I want a complete body workout through out the week."

- **Unscoped `weekly_sets` is a goal, not an error.** "A complete body workout through the
  week" names no muscle, and `validateMetrics` refused to save it — a blocking 400 with no
  way past it on the card. The measure now sums the week across every muscle group when no
  scope is given, and a measure declares whether its scope is a requirement (`exercise_load`
  — "best load" of nothing is nothing) or a narrowing (`weekly_sets`) with `scopeOptional`.
  The label follows: `measureLabel()` gives "Weekly sets, whole body" unscoped, "Weekly
  sets" for one muscle, and `GET /api/goals` titles the widget with it.
- **Facts stated alongside a goal are captured.** `GoalDetailOutputSchema` — the second,
  focused call — gained a `facts` object: `current_weight_lb`, `training_days`,
  `environment` (gym | home), `age_years`. `POST /api/log/confirm` for `kind: "goal"` saves
  the weight as a weigh-in and merges the rest into the profile (the age as
  `birth_year = this year − age`, dated in `stated_at`) **before** creating the goal. The
  preview carries them too, so the confirm card can show "Also noting: 212 lb today ·
  4 days/week · gym · 45 years old" — a fact saved silently is a fact the user cannot
  correct.
- **"Already reached" stayed, but honest.** The 212 was being thrown away, so the timeline
  was projected from a seeded 181.2 and came back "Already at 200 lb — mark it reached?".
  Two changes: a weight stated with the goal is the projection's starting point
  (`statedWeightLb`, threaded through `proposalForSpec` / `createGoal`), and when nothing was
  stated the note now names the number it went on — "Your last weigh-ins average 181.2 —
  already under 200 lb. Mark it reached, or tell me your current weight."
- **App**: the noted-facts line on the goal card, and **RECOGNISED → RECOGNIZED** (the app is
  US English) in `components/confirm-card.tsx` and `docs/design-system.md`.

**Decisions**

- **A stated weight beats the seven-day average — for the projection only.** The average
  exists to keep one glass of water out of the trend and is the right number for progress
  and for reached-detection, both of which still read it. It is the wrong number for "how
  long from here", when the user is standing on the scale telling us where *here* is. The
  weigh-in is also written, so the average catches up by itself.
- **`facts` is `.default(null)` on the public schema**, not required: a goal typed into the
  Goals screen states nothing alongside itself, and every client written before this sends
  one. Model-facing it is required-and-nullable like everything else, and sanitised on the
  way out — the loose model-facing bounds cost less grammar, and one nonsense age should not
  fail the whole confirm.
- **The grammar budget now fails on a laptop.** `fusion.test.ts` pins all three model-facing
  schemas under 4500 bytes (route 3.5 KB, goal spec 1.3 KB, plan fields 1.0 KB), so the next
  field is measured in a second rather than discovered by a provider at request time.
- **The goal prompt now demands `by` as YYYY-MM-DD.** The contract test caught the real model
  answering "December" — which `GoalDetailOutputSchema` allowed (a bare `z.string()`) and the
  public schema would then have rejected at confirm time. Nothing in the app changes; the
  prompt resolves the date against the context day it is already given.
- No new dependencies. No migration: `training_days`, `environment` and `birth_year` are
  columns the profile already had.

**Tests** — 324 passing, 2 skipped in `backend` (was 307/2); 64 passing in the app.

- `src/app.test.ts` (+2): the field report verbatim through analyze → confirm — the metric
  list survives, `facts` rides on the preview, the proposal reads `current: 212`, the save
  returns 201, `GET /api/weight` has the 212, the profile has `training_days 4`,
  `environment gym` and the birth year with `stated_at` on all three, and the goals list
  labels the metric "Weekly sets, whole body". Plus the honest already-reached wording for a
  user who stated nothing.
- `src/services/goals/measures.test.ts`, `proposal.test.ts`: the whole-body sum, the label,
  the unscoped metric validating, and the projection from a stated weight over a stale trend.
- `src/services/fusion/fusion.test.ts`: the facts widening, all-null → null, and the size pin.
- `anthropic.fusion.contract.test.ts` (+1): the field report against the real model — the
  extended `goal_spec` grammar compiles, 212 lands in `facts` rather than in the target, and
  `weekly_sets` comes back with a null scope. Run here, green.
- `__tests__/confirm-card.test.tsx` (+2): the noted-facts line, and that it is absent when
  nothing was stated.

**Deferred**

- **The noted facts are not editable on the card.** They render as a line; correcting the
  212 means saying it again. The fields are on the profile and the weigh-in is in the day
  log, both one tap from being fixed, so this waits for a real complaint.
- **`environment` is gym | home only.** The profile column takes any string and the
  constraint/preference path can already write "outdoor" or "mixed"; the goal path's enum is
  narrow because those two are what people say while setting a goal. Widening it costs
  grammar, so it needs a reason.

---

## Exercise illustrations (`wp-exercise-media`)

"Face pull" means nothing if you have never seen one. Every exercise name in the app is now
tappable and opens a sheet: two position photographs, the numbered steps, the muscles worked,
the equipment, and a **Watch form video** link. The pictures and the steps come from
**free-exercise-db** (github.com/yuhonas/free-exercise-db) — Unlicense, i.e. public domain,
with both the JSON and the photographs in the repo — imported once and then **self-hosted**,
so a phone showing a sheet never talks to GitHub and the dataset disappearing costs us nothing.

**Match rate: 98 of 126 catalogue exercises (78%)**, after 38 aliases were added to
`data/exercises.json`. Every big compound lift is illustrated, as is every exercise the
coach's prescriptions and `seed-demo` mention except *Walking*. The 28 misses are almost all
things the dataset simply does not contain — sports (Basketball, Soccer, Tennis, Pickleball,
Boxing), cardio modalities (Running, Walking, Swimming, Hiking, Rucking, Sprints, Spin Class,
Ski Erg, Assault Bike), mobility work (Yoga, Pilates, Stretching, Foam Rolling, Dynamic
Warm-Up, Hip Mobility Drill, Shoulder Dislocates) — plus Landmine Press, Bulgarian Split
Squat, Bicycle Crunch, Hollow Hold, Burpee, Neck Curl and the catch-all Other Activity. All of
those still open, in **name-only mode**, and their form video still works.

On the Docker host the import took one pass at first boot: **196 frames, 11.9 MB** in the
`trackdown_uploads` volume under `exercise-media/`. Every restart since short-circuits before
it even fetches the dataset.

**Added**

- `migrations/0010_exercise_media.sql` — `instructions text[]`, `media_count int`,
  `source_slug text`, `level text` on `exercise_catalog`.
- `src/services/exerciseMedia.ts` — the matching, pure and separately tested. Three rules,
  preferred in this order: the whole normalised name; the same with a trailing `" - qualifier"`
  dropped (`Triceps Pushdown - Rope Attachment` → `triceps pushdown`); the same with a plural
  last word singularised (`Concentration Curls` → `concentration curl`). Parenthesised asides
  are removed throughout, which is what turns `Machine Shoulder (Military) Press` into our
  `machine shoulder press`. An exact name always beats a derived one.
- `src/scripts/import-exercise-media.ts` (`npm run import-exercise-media`) — downloads the
  dataset from a **pinned commit** (`a859101`), matches, then downloads *only matched frames
  that are not already on disk*. Reports the match rate and names every miss.
- `src/ports/exerciseMedia.ts` + `src/adapters/storage/exerciseMedia.ts` — the frames live at
  `<evidence dir>/exercise-media/<exercise id>/{0,1}.jpg`, i.e. inside the `trackdown_uploads`
  volume, so one backup covers the user's photos and the illustrations both.
- `src/routes/exercises.ts` — `GET /api/exercises/:id` (row + steps + media urls) and
  `GET /api/exercises/:id/media/:n` (the jpeg, `private, max-age=31536000, immutable`).
- `app/exercise/[id].tsx`, `lib/exercise.ts`, `useExercise`, `exerciseMediaUrl`.

**Changed**

- **`exercise_id` now travels with the row it belongs to**: on a day activity, on a day-log
  record, and on every line of the coach's Do list. The brief's ids are resolved *on the way
  out* rather than stored — the model writes a name, and a name that was not in the catalogue
  last week may be in it today.
- `Row` (components/kit.tsx) gained `onTitlePress`. The title is underlined when it is one:
  a row that is a link in some places and not others has to say which it is.
- The DayLog keeps its own tap for corrections — that is the whole point of the screen — so
  the exercise gets its own "How to do X" line underneath instead.
- `backend/Dockerfile`'s CMD is `migrate && { import || warn } && serve`. The import is the
  only step that needs the internet and is never allowed to stop the boot: a sheet without
  pictures is a working screen, a container that will not start is an outage. With the volume
  already populated it short-circuits before it even fetches the dataset.

**Decisions**

- **The dataset's muscles and equipment are not stored.** `exercise_catalog` already carries
  curated ones and `db/exercises.ts` owns those columns on every `db:seed-exercises` run — a
  second copy would be silently overwritten by the next seed, or drift from what the coach and
  the day model read. Only `instructions`, `level`, `media_count` and `source_slug` are new.
- **Its own port, not a second use of `EvidenceStore`.** An evidence key is a minted,
  unguessable `YYYY/MM/<uuid>.jpg` belonging to one user; these are the opposite — fixed,
  shared and addressable. Sharing the key space would have meant loosening the pattern that
  stops a database value being handed to the filesystem as `../../etc/passwd`.
- **The frames are behind auth** even though the catalogue is shared. They are pictures we
  host; hosting them for the open internet is a bandwidth decision nobody made.
- **The video is a YouTube search, not a curated link.** A search stays right when a video is
  taken down, and picking one video for everyone is a recommendation nobody here is qualified
  to make. `<name> proper form`, with spaces as `+`.
- **One explicit exclusion**: free-exercise-db's *"Air Bike"* is a floor crunch and collides
  with our Assault Bike's alias. No rule separates those two — only knowing what they are — so
  `AMBIGUOUS_SOURCE_NAMES` names it, rather than a heuristic that would drop good matches too.
- **Entries with fewer than two frames are skipped**: the sheet shows a start and an end
  position, and one picture of a movement is not a movement.
- No new dependencies. The importer uses `fetch`.

**Tests** — 360 passing, 2 skipped in `backend` (was 344/2); 73 passing in the app (was 67).

- `src/scripts/import-exercise-media.test.ts` (+10): the normalisation rules, exact-beats-derived,
  the two-frame floor, alias and singular matching against the *real* catalogue, the Air Bike
  exclusion, unmatched rows left alone, a second run doing nothing at all, `--force` downloading
  nothing already on disk, and a failed frame leaving `media_count` at what is actually there.
  The dataset and the images are injected (`src/test/fixtures/exerciseDataset.ts`) — **no test
  in this repo touches the network.**
- `src/app.test.ts` (+6): the sheet's body, an un-imported exercise answering name-only rather
  than erroring, a frame streaming as a jpeg with its cache header, 404s for an unknown id, a
  malformed id and a frame the row does not claim, 401 without a session, and `exercise_id`
  arriving on a day activity, a day-log record and the coach's Do list.
- `__tests__/exercise.test.tsx` (+6): the photos, the numbered steps, the muscle pills and the
  equipment line; the video URL; name-only mode fetching nothing and still linking; and a tap on
  Day navigating by id.

**Deferred / uncertain**

- **28 exercises have no illustration** (list above) and no second source was added for them.
  wger's images are CC-BY-SA with attribution requirements and much sparser; a hand-shot set is
  a content project, not an engineering one.
- **`--force` is needed to pick up new aliases.** A plain run short-circuits as soon as any row
  has media, which is what makes it free at container start. Adding an alias means
  `npm run import-exercise-media -- --force` on the host.
- **The sheet does not say when the fetch failed.** A 404 or a dead network looks the same as
  "not in the catalogue": name-only. Right for the common case, thin if the API is down.

---

## WP6b — Days, Day, DayLog, Progress, Goals and the Coach screen

The second half of WP6: every screen WP6a left as a routed placeholder, plus the one
endpoint the DayLog needed. `components/placeholder.tsx` is gone.

**The one backend addition — `GET /api/day/:date/log?tz=`**

WP6a's handover said the DayLog had no endpoint and WP6b had to add it or drop it. It is
added, and two decisions shaped it.

- **It is built record-first, not evidence-first.** One entry per saved row (activity,
  meal, weigh-in, goal), with the evidence it was fused from hanging off it, plus any
  confirmed evidence that owns nothing as a `statement`. Listing evidence rows and joining
  outwards would have been the obvious reading of "list the evidence for a day", and it
  would silently omit every row that has no evidence — a Health import, anything the seed
  script wrote, anything logged before WP2. A log that quietly drops entries is worse than
  no log.
- **`0009_day_log.sql` adds `evidence.weight_id`.** A scale photo was linked with *no
  owner at all* (`weight_logs` had no column to point at), so nothing could say which
  weigh-in it was evidence for. The one-owner CHECK now counts four columns. Rows written
  before the migration keep their NULL and show up as statements; nothing is back-filled
  by guessing at timestamps.
- **`PATCH /api/weight/:id`** is new, so "tap → correct" on a weigh-in is a correction
  rather than a delete and a re-log. Meals and activities already had PATCH.

Four backend tests cover it: the ordering and the raw text, the correction in place, the
empty day and the two 400s, and that another user sees none of it. `npm test` is
**315 passed, 2 skipped**.

**Days** (`app/(tabs)/days.tsx`)

Rows grouped by week, each week carrying "5 of 7 served · −3,100 · −0.9 lb". A `FlatList`
that pages on `next_before`, so the list is as long as the history.

- **`lib/days-weeks.ts` is the grouping and the tally**, pure and tested — the same shape
  as `lib/today-cards.ts`. The tally is computed from the rows the page already carries;
  asking `GET /api/week` once per week on screen would be seven requests to say "5 of 7".
  The week the user is *living* is the exception: pass `GET /api/week` in and its `served`
  and `weekly_deficit` win, because that is the week the rest of the app is judging.
- Today's dot is an outline rather than a fill: the day is not over, and a filled dot is a
  verdict.

**Day** (`app/day/[date].tsx`)

The verdict with ‹ › date navigation, *In short*, Eaten / Earned / Allowance, Training by
muscle group with each lift's `delta_vs_last` and its evidence thumbnails, Health as one
badged card rather than a section, Eating as macro bars against the targets plus the
pattern line plus meals by slot, Body, the coach ask if there was one, and a footer.

- **Export is React Native's own `Share`, not `expo-sharing`.** The day is JSON; `Share`
  takes a string and needs no new dependency, while `expo-sharing` wants a file and
  therefore `expo-file-system` too. Two packages for a string is not a trade worth making.
- The route moved from `app/day.tsx` to `app/day/[date].tsx`, so the screen is addressable
  and ‹ › is `router.replace` on a date rather than state.

**DayLog** (`app/day/[date]/log.tsx`)

Time · icon (keyboard / mic / camera / heart) · the words in quotes, or "photo" · a meta
line of source, what was understood, and confidence.

- **Tapping a row opens the Log sheet in edit mode**, not a second editor: the same
  confirm card, seeded with the saved values, saving with PATCH. `lib/edit-record.ts` is
  the round trip and is pure in both directions. The screen the user learned the first
  time is the screen they get the second time (concept-v2 §Principles 7).
- Edit mode re-reads the row from the endpoint rather than taking it through navigation
  params — a screen that trusts its params shows a stale row after the previous edit.
- A statement (a constraint, a preference, a line of coach context) is not editable: there
  is no row to PATCH. It says so instead of offering a tap that would do nothing.

**Progress** (`app/(tabs)/progress.tsx`)

A section per active goal, then Consistency and Coverage.

- **`lib/progress-sections.ts` picks the chart by measure, and the rule is one sentence**:
  a measure whose number means something on a single day is a **line** (body weight, best
  load, pace, resting HR, VO₂); one that only means something over a week is **columns**
  (weekly sets, cardio minutes, macros, distance). New measure, no new decision.
- The weight section draws two lines: the measure's series, which is already a 7-day
  average, and the raw weigh-ins from the Days rows underneath it, thin and dim. The
  average is the claim; the weigh-ins are the evidence for it.
- Each goal fetches its own `/api/goals/:id/progress` — the goals list has the percentages
  but not the series — which is why a goal's block is a component and not a loop.
- Consistency and Coverage come from `GET /api/days?limit=60`, not from a new endpoint:
  the day rows already carry `muscle_groups`.
- No goal → no green and no orange, exactly as on Today.

**Goals** (`app/(tabs)/goals.tsx`)

Active goals as cards with a ring and a pace line, the empty state, the history, the plan
and the account.

- **The two prompts are questions, never actions.** `reached_candidate_at` renders "Looks
  like you reached it — mark done?" and `stalled_since` renders "Stalled — adjust?"; the
  PATCH happens on the tap. A goal is never auto-closed (concept-v2 §Goals).
- **"Not yet" is a session-local dismissal.** The candidate stays on the row because only
  the measure can clear it, and `PATCH /api/goals/:id` has no field for "the user said no"
  — deliberately, since inventing one would let the app un-detect its own detection. The
  prompt is back tomorrow if the goal really is done. If that turns out to be annoying in
  use, the field to add is `reached_dismissed_at`, and the rule stays the same.
- **Reorder is two arrows, not a drag.** `POST /api/goals/reorder` takes the whole order,
  and two arrows need no gesture handler, no measurement and no autoscroll. Priority is
  the user's order, so it moves only when they move it.
- Setting a goal is not a form: "Tell me what you're after" opens the Log sheet with
  `hint=goal`, and the proposal, the `confirm_date` / `no_date` choice and the confirm all
  happen there — the flow WP6a already shipped.
- Below the goals: **How you train** (days, environment, equipment), **How you eat** (diet
  style, daily target, eat-back), **Constraints** (and preferences when there are any),
  **Health sync** (a labelled, disabled toggle — WP7), and **Account** with the email and
  **Sign out**, which was the one control with nowhere to live.

**Coach** (`app/coach.tsx`)

Finished to the spec: the headline, the *why*, **Do** with load × sets × reps per
exercise, **Eat**, **One thing** with the button `nudge_action` names, the Photo / Speak /
Type panel for context, *Ask again*, and an "asked at" line that also says when the answer
came from the day's cache and when the log has moved since.

- **The nudge's button only ever routes or PATCHes what `rules.ts` already chose**:
  `mark_reached` → PATCH that goal, `adjust_goal` → the Log sheet in goal mode, `weigh_in`
  → the Log sheet in weight mode, `close_items` → today's log as recorded. The coach
  proposes; the tap disposes.
- Typed context is the query parameter on this ask. Photo and Speak open the Log sheet in
  `coach_context` mode, which saves the statement against today so every later ask reads
  it back — the panel is the same panel, so `Control` moved out of `app/log.tsx` into
  `components/control.tsx` rather than being copied.

**Shared pieces** — `components/charts.tsx` gains `TrendLine` (several lines over one x
domain, gaps for missing days, an optional dashed target) and `Columns` (vertical bars,
scaled by the caller, because a chart that rescales itself lies about the week it left
out). `components/icons.tsx` gains share, check-circle, alert-circle and the two vertical
chevrons. `lib/queries.ts` gains `useDaysPages` (infinite), `useDayLog`, `usePatchRecord`,
`useUpdateGoal` and `useReorderGoals`.

**Tests** — 34 new, 62 in nine files: `days-weeks` (the grouping and every part of the
tally), `progress-sections` (the chart per measure), `day` (the whole screen from one
fixture day), `goals` (empty / active / reached / stalled, including that nothing is
written until the tap) and `day-log` (the rows, the tap into edit mode, and the
edit-record round trip).

**Verified** — `npx tsc --noEmit` clean, `npx expo lint` clean, `npx expo export
--platform ios` builds a 4.56 MB bundle, backend `typecheck` / `lint` / `test` green
(315 passed, 2 skipped).

**One trap** — `.expo/types/router.d.ts` is generated by `expo start` and gitignored, so a
fresh checkout typechecks the new `/day/[date]` routes only after Metro has run once.
Nothing to fix; just do not be surprised by five "not assignable to parameter of type
Href" errors on a clean clone.

**Deferred** — Health sync (WP7) is a labelled placeholder; the previous-briefs list on
the Coach screen (concept-v2 §App mentions it) is not built, since `coach_briefs` keeps
the history but no route lists it and the morning test only needs today's; and a goal's
metrics cannot be edited from the Goals screen — the way to change a goal is to say it
again, which is what "Adjust it" does.

---

## WP6a — App foundation, Today and Log

The first half of WP6: the theme, the shared components, the API layer, and the two
screens the morning test needs — Today and Log. Days, Progress, Goals, Day and DayLog are
WP6b; they exist as routed placeholder screens so the navigation is real.

**The theme (docs/design-system.md)**

- `tailwind.config.js` is the token table: `bg` `card` `track` `line` `ink` `mute` `dim`
  `accent` `good`. The cream/terracotta palette and Fraunces are gone, along with
  `constants/theme.ts`, the `hooks/use-color-scheme*` pair and every `themed-*` component.
- `lib/theme.ts` holds the same values for the places a class name cannot reach: svg fills,
  the navigation theme, `fontVariant: ['tabular-nums']`. Two hex lists that can disagree is
  how a design system drifts, so one file is generated from the other by hand and reviewed
  together.
- Fonts are **Barlow** (text) and **Barlow Condensed** (display), imported **one weight at a
  time** — `@expo-google-fonts/barlow/500Medium`, not the package root, which re-exports
  every weight and italic and cost 3 MB of the exported bundle.
- `components/icons.tsx` is stroke svg on a 24 grid, 1.8 by default. No emoji, and no glyph
  font: `@expo/vector-icons` is no longer imported by anything.

**Shared components** — `components/`: `type.tsx` (Eyebrow/Body/Sub/Disp/Num, the scale),
`kit.tsx` (Card, Section, Row, Chip, Chips, GroupHeading), `charts.tsx` (Bar, Segments,
Ring, Sparkline — all svg, all pure), `metric-card.tsx`, `goal-banner.tsx`,
`reading-card.tsx`, `day-arc.tsx`, `evidence.tsx`, `fields.tsx`, `confirm-card.tsx`,
`tab-bar.tsx` (the 84px bar and the 64px `+`).

**The API layer**

- `lib/api.ts` stays the one HTTP client and gains `upload()` (multipart, for
  `/api/log/analyze`), `tzOffsetMin()`, and `authHeaders()`/`evidenceUrl()` so an
  `<Image>` can fetch the authenticated photo route.
- `lib/queries.ts` was rewritten around the v2 endpoints: `useDay`, `useWeek`, `useDays`,
  `useGoals`, `useGoalProgress`, `useProfile`, `useCoachNext`, `useRegenerateCoach`,
  `useAnalyze`, `useConfirm`. Every day-shaped call sends `tz`. The v1 hooks that fetched
  `/api/entries/*` and did the arithmetic on the phone are gone.
- **`lib/tdee.ts` and `lib/recommendations.ts` are deleted.** The server computes the
  targets (`GET /api/profile` → `targets`, WP4) and the app renders them; two
  implementations of "what should I eat" is how the phone and the server start disagreeing
  about the same day.
- `lib/types.ts` writes out the shapes the backend returns. When a service in
  `backend/src/services/**` changes one, this file is the other half of the change.

**Today** (`app/(tabs)/index.tsx`)

Header (day N · on track/over/—), goal banner including the no-goal state, the goal's
cards, the Right now reading with its action chips, the day arc, Training and Eating, the
coach button, pull-to-refresh.

- **Which cards appear is `lib/today-cards.ts`** — pure, and the only judgement the app
  makes for itself. fat loss → calories ring + weekly deficit + weight trend; muscle →
  protein + weekly sets + coverage; endurance → weekly cardio + pace + resting HR; strength
  → target lift + weekly sets + push/pull/legs; no goal (and `maintain` / `custom`) →
  workouts this week + cardio today + coverage, in `mute`, with no green and no orange.
- **A card with a missing number does not appear.** No zeros standing in for absent facts:
  an empty ring says the user ate nothing, which is a different claim from "we do not know".
  Resting HR therefore never draws until WP7 brings Health in, and the endurance goal shows
  two cards rather than three.
- `day.workout_done` is read if the backend ever sends it; today the label flips on
  `blocks.length > 0`, which is the same fact computed from what `/api/day` does return.

**Log** (`app/log.tsx`, a modal from the `+` and from the reading's chips)

Text area, photo thumbnails, the three 76px controls, analyze → confirm card → save.

- The confirm card renders **every** kind the classifier can return — activities, meal,
  weight, goal (with the proposed timeline and the `confirm_date` / `no_date` choice),
  constraint, preference, coach_context, and `unclear`, which shows the question and offers
  no Save. A kind it could not draw would be a log the user could not save.
- Photos: `expo-image-picker` (camera and library, ≤ 4) downscaled by
  `expo-image-manipulator` to 1280 px JPEG at quality 0.7 before upload — the server's
  sharp pass stays the safety net, not the first line.
- `client_id` is minted once per confirm card (`expo-crypto`), so a confirm retried after a
  timeout replays instead of logging the workout twice.
- **Speak is behind `lib/ports/speech.ts`.** `getSpeech()` `require`s the
  `expo-speech-recognition` adapter inside a try: the native module throws while it is
  being evaluated, which is exactly what Expo Go does, and the port answers
  `available: false`. The control is then not drawn at all and the helper line says why.
  Nothing imports `expo-speech-recognition` at the top level.

**Navigation** — tabs Today · Days · Progress · Goals with a hand-written tab bar (the
floating `+` has to know where the bar ends); `log` as a modal, `coach` and `day` as stack
routes. The old screens (`detail`, `eating`, `movement`, `weight`, the v1 `progress` and
`profile`) are deleted. `app/coach.tsx` is deliberately more than a placeholder — it asks
`GET /api/coach/next`, renders the brief and takes a line of context — because item 6 of the
morning-testable minimum is "coach ask → brief".

**One backend change** — `GET /api/day/:date` now returns `evidence: [{id, kind, mime,
width, height}]` on each activity and meal. The photo row under an exercise is in the design
and the day view had no way to point at one; it is one extra query per day, not N+1. Nothing
else about the shape moved.

**`app.json` / `eas.json`** — committed (they were uncommitted EAS edits). `userInterfaceStyle`
is `dark`, the splash and adaptive-icon backgrounds are `#121418`, the camera / photo library
/ microphone / speech-recognition permission strings are written, and the
`expo-speech-recognition` and `expo-image-picker` config plugins are configured. Expo Go
ignores plugins, which is the point: the sheet still works there without them.

**Tests** — jest + `jest-expo` + `@testing-library/react-native`, 28 in four files:
`today-cards` (the card rule per goal kind, including the hidden-when-missing rule),
`today` (rendered against a fake API), `confirm-card` (every kind, the sources line, the
edit callback) and `log` (Speak hidden when the port is unavailable, typed text through
analyze → edit → confirm with the idempotency key). `react-test-renderer` is pinned to
19.1.0 to match React; `jest-expo` to ~54 to match the SDK.

**Verified** — `npx tsc --noEmit` clean, `npx expo lint` clean (the 7 unescaped-quote errors
and the unused variable were all in deleted or rewritten files), `npx expo export
--platform ios` builds a 4.46 MB bundle, backend `typecheck`/`lint`/`test` still green
(311 passed, 2 skipped).

**One trap found on the way out** — the app's `tsconfig.json` included `**/*.ts`, which swept
up `backend/src`. Harmless until `expo-env.d.ts` exists (generated by `expo start`,
gitignored): it pulls in `expo/types`, the DOM's `setInterval` wins, and the backend's Node
one stops matching. `backend` and `dist` are now excluded — the backend has its own
tsconfig and its own `npm run typecheck`.

**Deferred to WP6b** — Days, Progress, Goals (with the empty/propose/reached/history states
and the account rows), Day and DayLog, the Coach screen's full design, and the Goals-screen
reorder. WP6b should know:

- `lib/today-cards.ts` is the pattern for Progress: a pure selector over `GoalWithProgress`,
  tested without a renderer.
- `GET /api/goals/:id/progress` carries the `series` the Progress charts want;
  `components/charts.tsx` already draws all four shapes.
- Nothing renders `profile.constraints` / `preferences` / `training_days` yet — those are
  the "How you train / How you eat / Constraints" rows under Goals.
- There is no sign-out control on any screen: it belongs in the Goals tab's account rows.
  `signOut()` in `lib/auth.ts` is ready and unused.
- `/api/day/:date` returns everything the Day screen needs (verdict, `in_short`,
  `muscle_summary`, macros, `eating_pattern`, `coach`); no backend work is left for it.
- DayLog ("the log as recorded") has **no endpoint**: `evidence` rows carry the raw text but
  nothing lists them for a day. That is a backend addition WP6b has to make or drop.

---

## WP5 — Coach

The brief. Everything with a number in it is computed; the model chooses the movements,
the order and the words. Asked for, never scheduled.

**`services/coach/features.ts` — the coach's inputs, pure**

- Every feature concept-v2 §Coach lists, as pure functions of the same 28-day `DayFacts`
  window `services/day.ts` already builds: days since the last workout, sessions this week
  against last, per muscle group days-since and 7-/28-day sets, per exercise last
  load × sets × reps + best in four weeks + trend, cardio minutes this week vs the plan,
  adherence over 1/3/7 days, the weight trend, and the data-quality flags.
- **A day is one session.** Three logged sets of bench in one visit are one session at that
  day's top load, because that is what "the same load in two consecutive workouts" counts.
  The warm-up set still counts as volume.
- **null is "we do not know", never zero** — the same rule the measure catalog runs on. A
  muscle group with no entry in four weeks reports `days_since: null`, and
  `TRACKED_MUSCLES` is a written-out list precisely so an *absence* is visible: "no pulling
  movement since Monday" is a sentence about rows that do not exist.
- Data quality is the coach's half of concept-v2's "the coach is only as good as the log":
  low-confidence items from the last week, days with nothing logged, a missing calorie
  target, a due weigh-in, meals with no protein figure.

**`services/coach/rules.ts` — the numbers the model is not allowed to invent**

- `gapRule` (3–4 days → ease back, ≥14 → restart, and never scold), `recoveryRule` (trained
  inside 48 h is not today's primary target), `cardioRule` (the week's shortfall, capped at
  one safe +10 % step — "by weekly minutes vs the plan, not by yesterday").
- **`prescribeLoads()`** turns history into the concrete load × sets × reps per exercise:
  a new exercise repeats what was reported; a session short of target holds and two short
  drop one plate; target reps on every set in two consecutive sessions steps up one plate
  (5 lb, or 5 % on a stack) unless the load already went up inside the last week; a
  restart-length gap comes back a step lighter and a set shorter.
- `selectNudge()` picks the single most useful thing — a reached goal first, then a stalled
  one, then unconfirmed items, then a due weigh-in, then the unlogged days — and returns the
  **action** with it (`mark_reached goal_id` / `adjust_goal goal_id` / `weigh_in` /
  `close_items`). The model writes the sentence; the button is not generated.

**The port, the schema and the prompt**

- `ports/coach.ts` — `CoachPort.brief(inputs) → Brief`, with `adapters/coach/llm.ts`
  composing `LlmPort` on the coach model (`COACH_LLM_PROVIDER` / `LLM_MODEL_COACH`, Sonnet
  by default) and `src/test/fakes/coach.ts` behind every integration test.
- `services/coach/schema.ts` — `{ headline, why, workout {type, targets[], exercises[{name,
  load_lb, sets, reps, minutes, note}]}, nutrition {kcal, protein_g, carbs_max_g, ideas[≤3],
  why}, nudge }`, ~1.6 KB of JSON schema against WP2's ~4.5 KB grammar ceiling, pinned by a
  budget test and proved on the real model by a contract test.
- The prompt hands over the goals in priority order, the plan and its constraints, the
  eating targets, today so far, the feature sheet, the rules as constraints, the prescribed
  loads, and the user's context — and says in three places that the numbers are not the
  model's to change.

**Routes**

- `GET /api/coach/next?tz=&context=` — the day's cached brief, or a new one. The response
  carries the brief, the computed `gap`, the `nudge_action` and the active goals with their
  candidates, so the app never has to parse anything back out of the model's sentences.
- `POST /api/coach/next/regenerate` — `{ tz_offset_min, context? }`, always generated.
- Both close the user's due days first, like every other day-shaped route.
- **Nothing else in the codebase produces a brief.** No job, no cron, no notification — that
  is concept-v2 §Principles 5 as a property of the code, and the note at the top of
  `routes/coach.ts` says so to whoever adds the first scheduler.

**Context has a home now**

`POST /api/log/confirm` with `kind: "coach_context"` writes a `coach_contexts` row on the
user's local day (migration 0008) instead of returning the text and forgetting it. The
coach reads that day's statements, joined with whatever was typed into the ask itself, and
both go into the cache key — so "knee hurts today" produces a different brief and is gone
tomorrow. A context that outlives the day is a *preference*, which is a different table.

**Migration — `backend/migrations/0008_coach.sql`**

- `coach_briefs.headline` and `.nudge_action`. 0004's `rationale` is the brief's `why`
  under its older name; `headline` is the title sentence the Coach screen opens with, and
  `nudge_action` is what the app can *do* about the nudge.
- `coach_contexts (user_id, date, text)`, with a unique index on `(user_id, date, md5(text))`
  — a phone with no signal retries the confirm, and the fusion ledger only covers a repeated
  `client_id`.

**Decisions**

- **The model never picks a number.** Loads, sets, reps, minutes and the calorie/protein
  targets are all computed and handed over to be copied. Ask a language model for "the next
  sensible weight" and it answers differently on Tuesday than on Monday for the same
  history, which is the one thing a progression must never do. The contract test asserts the
  copying against the real model, because it is a claim about behaviour that no fake can
  make.
- **"Target reps" is the best the user has proved at the load they are on**, not the average
  of their sessions and not a constant in the code. An average drifts *down* every time
  someone has a bad day — the finish line quietly moving to wherever they landed — and a set
  of twelve at a warm-up weight is not a target for the working weight.
- **The cache key is the whole feature set, plus the local hour.** Unlike the day reading —
  whose hash had to *exclude* a NOW marker that moves every minute — every number the coach
  reads is a fact about what was logged, so hashing all of it is right. The hour is in it
  because a brief at 6 am and one at 9 pm are different answers; the minute is not.
  `regenerate` rewrites the same row rather than adding a duplicate.
- **A failed generation serves the day's previous brief, or 503s.** The day readings are
  allowed to be absent; the brief is the answer the user asked for, and a blank Coach screen
  with no explanation is worse than a message saying the coach is down.
- **`nudge_action` is chosen, not generated**, and `mark_reached` never closes anything:
  concept-v2 §Goals is explicit that a goal is never auto-closed, so the action is a button
  the user presses and the prompt says as much.
- **The coach reads goals through `services/goals/store.ts`**, so it sees exactly what the
  Goals screen sees — priority order, progress and the candidates — rather than a second
  query that could disagree with it.
- **`GET /api/day/:date` gained a `coach` field**, the day's most recent brief. That is
  WP3's deferred coach-ask card, and it is a *record of an ask*, not a second place that
  generates advice.
- No new dependencies.

**Tests** — 311 passing, 2 skipped (was 243 / 2).

- `src/services/coach/features.test.ts` (22): the gap at 0, 1, 3 and never; sessions folded
  per day; muscle recency, weekly sets and the untrained list; the four-week trend and the
  window's edge; cardio counted against the week and not confused with a lift; adherence
  averaged per day rather than per meal, with the unlogged days named; the smoothed weight
  trend; and every data-quality flag, including the "nothing to flag" case.
- `src/services/coach/rules.test.ts` (32): every gap level and its wording; recovery;
  cardio's shortfall and its cap; `targetScheme` from the load they are on; the plate and
  the stack step; and `prescribeLoads` for new / hold / step up / stepped this week already
  / low confidence / two misses / ease back / restart / cardio / no history. Plus nudge
  priority (reached before stalled before items before weigh-in), and the schema's size.
- `src/app.test.ts` (+11): the brief built from real rows (features, prescriptions, the
  stated constraint), the cache serving the rest of the day free, a log invalidating it, a
  context on the query string and one said through the Log sheet, regenerate rewriting the
  same row, the reached candidate becoming `mark_reached` with the goal's id, a stalled goal
  becoming `adjust_goal`, an 18-day gap prescribing a restart, the coach-ask card on the Day
  view, the 503 and the stale fallback.
- `src/adapters/coach/anthropic.coach.contract.test.ts` (1, skipped without a key, run and
  green here): the grammar compiles on the coach model, and every exercise the model chose
  from the prescription list came back with that prescription's numbers.
- `src/scripts/seed-demo.test.ts`: the seeded brief on yesterday.

**Deferred**

- **No `GET /api/coach/briefs` history.** The Coach screen's "previous briefs" list has the
  rows (one per distinct answer per day) but no endpoint yet; WP6 can add the query it wants
  rather than one guessed at now.
- **The brief is not regenerated when a *goal* changes**, only when the goal's id, priority
  or candidates change — editing a goal's target mid-day leaves the morning's brief cached
  until something else moves. Adding the metrics to the hash is a one-line change if it
  bites.
- **`loadCoachInputs` runs `computeDay` and `listGoals` on every ask, cached or not.** The
  cache saves the model call, not the queries — the same trade WP3 made for readings.
- **Nothing writes `expired`.** WP4 left this for "WP5's coach to ask"; the coach asks about
  reached and stalled goals, and a goal whose `active_to` has passed still reads as active.
  It wants a decision about whether an expiry is a question or a sweep.
- **No app screens.** The Coach screen (brief, context input, regenerate, previous briefs)
  is WP6; this is the API it reads.

---

## WP4 — Goals and profile by talking

A goal is now a thing the server can propose, judge, notice the end of, and keep in
history. The model hears what the user wants; everything with a number in it is computed.

**`services/goals/proposal.ts` — the proposed timeline, pure**

- The safe rates from concept-v2 §Goals, as three formulas: **fat loss** at 0.5–1 %/week of
  body weight (compounding, at the profile's `goal_pace` — gentle 0.5, standard 0.75,
  aggressive 1.0), **a plate step** (5 lb) every 1–2 weeks by the same pace, and **cardio
  and other weekly volumes** at +10 %/week, flat: concept-v2 gives one number for it and it
  is a load-management rule, not an ambition dial. Weight *gain* is projected at half the
  fat-loss band (0.25–0.5 %/week), which concept-v2 does not name — the note in the file
  says why.
- `{ projected_date, weeks, rate, note, by, unrealistic, standing, metrics[] }`. A goal with
  several metrics takes the **slowest** of them: it is reached when all of it is.
- **The user's own date is never overwritten.** It comes back in `by` beside the
  projection, and `unrealistic` is judged against the *fastest safe* rate rather than the
  profile's chosen pace — so "170 by December" at 0.83 %/week is kept with a note saying it
  is brisker than usual, and only a date that needs more than the band allows is replaced
  by the projection (and `confirm_date: true` overrides even that).
- Measures with no journey — protein, carbs, a daily balance — get no date at all rather
  than an invented one, and a cardio goal with no cardio logged says so: 10 % of nothing
  never arrives.

**`services/goals/detect.ts` — reached and stalled, pure**

- The smoothed rules, verbatim from concept-v2: the **7-day average at/past target on every
  one of the last seven days**; a **lift logged at target on two separate days** (counted
  from the activities, because `exercise_load` answers "the best in four weeks" and one
  number cannot say "twice"); a **weekly volume at target two weeks running**. A week with
  no weigh-in breaks the run — we do not know the goal held.
- **Standing intentions are never reached and never stalled.** `at_least 150 min/week` has
  no finish line to arrive at (concept-v2's outcome-vs-standing split, applied through the
  `direction`).
- **Stalled** = no movement toward the target in three weeks, with "movement" sized per
  measure (0.5 lb on a 7-day average, one plate on a lift, 5 % elsewhere). Unknown is not
  stalled: a user with no data has a logging problem, and the day's reading already says so.
  `stalled_since` cannot predate the goal.
- Both are **candidates**. Nothing in the file changes a status — `reached_candidate_at` and
  `stalled_since` are what WP5's nudge reads, and the user is the one who closes a goal.

**Routes** (`routes/goals.ts` over `services/goals/store.ts`)

- `GET /api/goals` — active in priority order, each with `progress` (per-metric current,
  baseline, target, percent) and the two candidate columns; `history` with the `outcome` it
  ended on; `no_goal`, which is the state the app renders with no judgement colours.
- `POST /api/goals` — spec → validated against the measure catalog → projected → saved
  `active`, priority appended. `confirm_date` keeps the user's date, `no_date` saves it
  open-ended. 400 names the problem ("Best load needs an exercise — say which one").
- `PATCH /api/goals/:id` — title, metrics, priority, and status. **Every closing status
  writes `active_to`**: reached and dropped end today, expired ends on the date it was due.
- `POST /api/goals/reorder` — `{ ids }` applied as 1…n; goals not named keep their place at
  the end.
- `GET /api/goals/:id/progress` — the same per-metric numbers plus a **trend series over the
  goal's life**, thinned to 90 points, from one row load: the calculators ignore rows dated
  after the day they are asked about, so ninety dates cost one query, not ninety.
- Someone else's goal is a 404, not a 403.

**One path for a goal, whoever set it**

`POST /api/log/confirm` with `kind: "goal"` now calls the same `createGoal`, so a goal set
by talking and one typed into the Goals screen get the same validation, the same priority
and the same computed timeline. `POST /api/log/analyze` attaches the proposal to the
preview (`{ result, proposal, evidence, context }`) and overwrites `result.proposed_timeline`
with it — **the model is no longer asked to do the arithmetic**: `GoalDetailOutputSchema`
dropped `proposed_timeline` and the prompt now says to put the user's own date on the
metric's `by` and leave the projection alone. The contract test on the real model checks
exactly that.

**Profile**

- `GET /api/profile` returns the row **plus `targets`** — `tdee`, `eat_target`, `deficit`,
  `safe_floor`, the four macros, `source` (computed | stated | none), `tracking_only`,
  `eatback`, the weight they were computed for and the day they are for. The app can stop
  doing this arithmetic (WP6 deletes `lib/tdee.ts`).
- `PATCH /api/profile` accepts the plan columns (diet_style, protein_g, carbs_max_g,
  training_days, environment, equipment, eatback, constraints, preferences) and **dates
  every field it touches** in `stated_at`, merged rather than replaced. The spoken path
  keeps appending and deduping; an edit from the Profile screen replaces the list, because
  deleting a row is something only a tap can mean.
- `eatback` was already respected by `computeDay`; it now has a test that walks
  none → half → all and watches the allowance move.

**Migration — `backend/migrations/0007_goal_progress.sql`**

- `goals.stalled_since DATE`, the other half of `reached_candidate_at`.
- A backfill giving every non-active goal with no `active_to` an end date, so the day model
  can judge by the **date window alone**. That is the WP3 note closed: `services/day.ts` no
  longer filters `status <> 'dropped'`, so a goal dropped today goes on judging the
  fortnight it was live for and stops judging tomorrow.

**`npm run seed-demo -- <email> [--goal fat_loss|muscle|none]`**

The second scenario flag. `muscle` seeds a `gain_muscle` goal (bench 185 + 175 g protein) so
the muscle cards have something to render; `none` is the no-goal state the morning demo has
to be able to show — it ends the goals *this script* set, dated, and leaves any other goal
alone with a warning. The goal is now written through `createGoal` after the days are
seeded, so the demo's timeline is projected from the demo's own weigh-ins.

**Decisions**

- **`unrealistic` means unsafe, not "faster than your pace".** concept-v2 gives a band
  (0.5–1 %/week), and treating the profile's pace as the ceiling would have overruled a
  user's perfectly safe December date. The projection still runs at their pace; the flag is
  judged at the top of the band.
- **The timeline left the model.** It was in the fusion schema since WP2 (the prompt asked
  for a projection). A date is arithmetic, the Goals screen, the row and the coach all have
  to show the same one, and a model that is asked for a number will produce a different one
  each time. Removing it also shrinks the second call's grammar.
- **A dropped goal keeps its days.** WP3 had to exclude dropped goals entirely; now the
  window governs and the status is only a label. The migration backfills the goals dropped
  before this, using `stated_at` as the closest thing to "when it stopped" the old schema
  recorded.
- **Progress is measured from the baseline**, the metric's value on `active_from` — 195 → 170
  is 0 % at 195, not the 87 % that "current over target" would put on the ring on day one.
  A goal's own percentage is its **slowest** metric, the same rule reached-detection uses.
- **`loadTargets` lives in `services/profile.ts`**, not in the goals module, and the goals
  store imports it. The day model, the goals list and `GET /api/profile` all need "what
  should this user eat today", and it belongs next to the profile it is derived from.
- **No idempotency key on `POST /api/goals`.** The spoken path is idempotent through
  `log_confirmations`; the Goals screen's create is a button a human presses, and a
  duplicate goal is visible and one tap to drop. Worth revisiting if the app ever retries it
  automatically.
- No new dependencies.

**Tests** — 243 passing, 2 skipped (was 185 / 2).

- `src/services/goals/proposal.test.ts` (20): the projection for each measure at each pace
  (pinned to the week counts, so a changed constant fails here rather than surprising
  someone in six months), the brisk-but-safe date, the unrealistic one, a date in the past,
  already-there, no-data, the slowest metric, standing intentions, the confirm card's shape,
  and the catalog validation.
- `src/services/goals/detect.test.ts` (17): every "not reached" case is a day whose raw
  number says the goal is met and whose rule says wait — one weigh-in, the first dip, two
  sets in one session, one good week. Plus a gaining goal from the other side, a two-metric
  goal, and the stall (flat weight, moving weight, a stuck lift, a goal set last week, and a
  reached goal never being called stalled).
- `src/app.test.ts` (+13): the goals API end to end; the close writing
  `reached_candidate_at` and keeping the first one; marking a goal reached and the list
  going empty; yesterday still judged by the goal that was dropped today, and losing its
  judgement when the end date moves before it; the profile's derived targets, the dated
  merge, spoken-append vs edited-replace on constraints, and eatback moving the allowance;
  and analyze → proposal → confirm for a goal set by talking, including "no date" and
  "that date, I meant it".
- `src/test/fixtures/facts.ts`: the `DayFacts` builders WP1's measures.test.ts had grown
  privately, now shared.
- `src/scripts/seed-demo.test.ts` (+2): both new scenarios, spawned for real.
- The Anthropic fusion contract test now asserts the model puts the user's December date on
  the metric and leaves `proposed_timeline` null. Run here, green.

**Deferred**

- **`GET /api/goals` computes progress on every call.** One row load and a handful of pure
  calculators, capped at 180 days of baseline — fine for a handful of goals, and the place
  to look first if the Goals tab ever feels slow.
- **The trend series has no per-week bucketing.** It samples days; a year-long goal is 90
  evenly spaced points, which is what a sparkline wants but not what a "weekly average"
  chart would.
- **Nothing writes `expired` on its own.** A goal whose `active_to` has passed still reads
  as `active` until someone patches it; the day model already stops judging with it. A
  sweep at close would be a one-liner, but auto-changing a status is the thing concept-v2
  says not to do, so it waits for WP5's coach to ask.
- **The reached candidate is not surfaced anywhere yet** beyond `GET /api/goals` — the nudge
  that says "mark it done?" is WP5's.
- **No app screens.** Goals, Progress and Profile are WP6; this is the API they read.

---

## WP3 — Day model, blocks, calorie model, day readings

The day is now a thing the server computes. One function answers "what happened on this
day, and was it any good", and Today, the closed Day, the week, the Days list, the close
job and (next) the coach all read that one answer.

**The calorie maths moved server-side**

- `src/services/tdee.ts` is `lib/tdee.ts` + `lib/recommendations.ts`, ported: Mifflin-St
  Jeor, the ISSN percentage deficit, the 1 %/week cap, the NHLBI/0.8×BMR floor, the macro
  split, the projection. Same constants, same rounding — `tdee.test.ts` pins it to the
  **app's own outputs**, produced by running the shipped `lib/` code over four profiles and
  pasting the numbers in, so a change on either side fails here instead of quietly giving
  the phone and the server two different targets.
- One deliberate difference: `computeTdee` takes **the day being computed** as the date to
  age against. The app read `new Date().getFullYear()` at the call site, which is fine in a
  UI and wrong in a server recomputing March for a December birthday — and untestable.
- `computeDayTargets(profile, weightLb, day)` is the bridge the day model calls: the target
  is derived from **the day's own body weight** (the day's weigh-in, else the most recent
  one before it), falls back to the profile's stated `daily_calorie_target` when the TDEE
  inputs are incomplete, and is `null` when there is neither. A stated `protein_g` /
  `carbs_max_g` beats the computed macro.

**`src/services/day.ts` — `computeDay(db, { userId, date, tzOffsetMin, now })`**

Returns items, blocks, the calorie model, macros, weight, muscle groups, the eating
pattern, the day arc, `expected`, the verdict and a one-line summary. Highlights:

- **Blocks** (`day/blocks.ts`): activities within **90 minutes** of each other, measured
  from the *end* of the previous one so a 60-minute bike does not split the visit. Title
  from the muscle groups with the most sets ("Back & Chest"), or "Walk" / "Run" /
  "Mobility" / "Cardio" for a block with no lifting. Nothing writes `activities.block_id`:
  blocks are computed on every read, which is what makes them something the user never has
  to manage.
- **Health overlap rules** (concept-v2 §Health), the double-count mitigation, unit-tested
  with synthetic samples: a workout overlapping a block is *attached* to it and fills in
  the calories and minutes **only where the user gave none**; one overlapping nothing
  becomes an activity with `source: health` and is counted; a sample already materialised
  as an `activities` row is the same event and is counted once; two workouts over one block
  keep the longest and drop the other. A ±15-minute grace covers a watch started before the
  first log. **Daily active energy is never added to `earned`** — it is the baseline the
  TDEE already accounts for. Body-mass samples become the day's weigh-in only when the user
  logged none themselves.
- **The calorie model**: `eaten = Σ meals`, `earned = Σ blocks + standalone Health`,
  `allowance = target + eatback × earned` (`none|half|all`, default half),
  `balance = TDEE + earned − eaten`.
- **Status** `on_track | over | under | none`: `none` whenever there is nothing to judge
  against — no allowance, or a goal the calorie number does not speak for (a strength goal
  is not served by eating less). Over needs to clear a **100 kcal** tolerance; under is
  more than **25 %** below the allowance, or under the safe floor — and a **live** day is
  not called under-fed before **20:00 local**, because a day that is short at lunchtime is
  a day that is not finished.
- **`delta_vs_last`** per exercise (`day/deltas.ts`): the previous occurrence of the same
  exercise, earlier today or weeks ago. Load first, then sets, then reps, then duration and
  distance — "+5 lb", "+1 set", "-10 lb", "same", "first time".
- **The eating-pattern line and the day arc are computed, not generated** (`day/narrative.ts`):
  back-loaded / front-loaded / the longest gap / evenly spread, and the 6a→11p events with
  the block as a span, NOW, and the dashed `expected` dots (the next meal slot the clock is
  waiting for, and a weigh-in if the day has had none).
- **Verdict** (`services/goals/verdict.ts`), judged against the goal active **on that
  date** (not today's), via the measure catalog: fat loss / maintain → the calorie status;
  muscle / strength → protein against target **plus** training done, with a rest-day rule
  (trained yesterday, or the week already has the planned number of sessions); endurance →
  trailing-7-day cardio minutes against the goal's weekly target at 90 % tolerance; custom
  → its own first metric when that metric is computable; no goal → `none`; nothing logged →
  `unlogged`, never `missed`.

**Readings — the one generated part of a day** (`services/readings/`)

- `right_now` for the live day (≤ 2 sentences + `next_action {label, kind, hint}` and up to
  three `actions` chips) and `in_short` for a closed one, both through `LlmPort` on the
  **coach** model (`COACH_LLM_PROVIDER` / `LLM_MODEL_COACH`).
- The model is given the **computed day sheet** — totals, blocks, deltas, the verdict, what
  is still expected — never the rows, and never a database id.
- Cached in the new `day_readings` table by an **inputs hash** over the day's material
  facts. The clock moving is not a regeneration; a logged meal is. `in_short` is written
  once at close and never revised.
- A missing key or a provider outage returns the last good reading, or `null`, and the day
  renders without it. The reading is the one part of a day allowed to be absent.

**Day close** (`services/dayClose.ts`)

No cron: the close runs on the **first request after the user's local midnight**, because
only the phone knows when that was. Every day-shaped route calls it first; a second request
costs one indexed query. It writes every column from 0004 plus the new ones, and
`closed_at` is the idempotency guard — a closed day is a record, not a cache, so a retry,
a burst at 00:01 and `POST /api/day/close` all converge and the reading is generated once.
Reach is 60 days; days with nothing logged are never written.

**Migration — `backend/migrations/0006_day_readings.sql`**

- `day_readings (user_id, date, kind, inputs_hash, text, next_action, actions, model)`. The
  live day's reading could not live in `daily_summaries`: that row's existence means "this
  day is finished", and Right now belongs to a day that is not.
- `daily_summaries.summary_line`, `.meal_count`, `.tdee`. The Days list has to be one
  indexed read rather than a sentence re-derived from `blocks` jsonb, and the week's
  deficit is Σ(TDEE + earned − eaten) — with no column, recomputing a TDEE for June from
  today's weight would quietly rewrite June.

**Routes**

- `GET /api/day/:date?tz=` — `today` or `YYYY-MM-DD`; live for today (with `right_now`),
  the day plus its `in_short` for a past one. 400 for a future date.
- `GET /api/week?end=&tz=` — seven days of status/verdict, `weekly_deficit`, `served`,
  `judged`. Closed days come from their record, today is computed.
- `GET /api/days?before=&tz=&limit=` — the Days list: verdict words, the one-line summary,
  the day number, `next_before` for the next page. The open day leads the list.
- `POST /api/day/close` — `{ tz_offset_min, date? }`, for tests, admin and the seed script.
  Refuses the day the user is still living.
- The old entry, weight, profile, log, fusion and evidence routes are untouched.

**`npm run seed-demo -- <email> [--tz <min>] [--password …] [--force]`**

Creates or reuses the account (password `demo-pass-123`, set through the same code path as
`reset-password`), a fat-loss goal, a profile the calorie model can work from, and four
days: three closed with a gym block of four exercises, a Health-only rest day, weigh-ins
and macro-bearing meals — with deltas across the two gym days (+5 lb bench, +5 lb row,
+1 set press, pulldown held) — then **today half-lived**, breakfast and lunch in and dinner
still expected. It writes through the same services the API uses and closes the past days
so `in_short` exists. Without an API key its own canned readings stand in, parsed through
the caller's schema. Re-running converges; it refuses an account with more than 10 closed
days unless `--force`.

**Decisions**

- **The day view recomputes; `daily_summaries` is the frozen record.** `computeDay` never
  reads the summary back, so correcting yesterday's lunch shows up immediately in the day
  view, while the closed record stays what was true at close (and the week and Days list
  read that). The cost: after an edit to a closed day, the list and the day can disagree
  until something re-closes it. Judged the right way round — the record is evidence, and
  silently rewriting history to match a late edit is worse than a stale summary line.
- **`under` is `served` for a fat-loss goal.** A deficit day served the goal; the
  under-eating caution is a health signal and the status line already carries it. Marking a
  light day as a failure would be judging the user twice for one number.
- **Status has a `none` that the schema does not.** `daily_summaries.status` allows
  `on_track|over|under` only (0004), so "no judgement" is written as NULL, not a fourth
  value.
- **A dropped goal still judges the days it was live for**, since 0004 has no record of
  *when* it was dropped; the query filters `status <> 'dropped'` and by the date window.
  WP4 owns status changes and can tighten this by setting `active_to` on drop.
- **`localDay` moved out of `services/fusion/context.ts`** into `services/localTime.ts` (it
  re-exports it, so nothing else moved). The day model, the close and the week all need the
  same local-midnight arithmetic, and two copies of it is how a log at 23:30 in Los Angeles
  lands on two different dates.
- **The eating pattern is computed, not an LLM sentence.** Paying a model to notice that
  60 % of the calories came after 6 pm would be slower, dearer and less reliable than
  counting them (concept-v2 §Principles).
- `eslint.config.js`: `no-unused-vars` gained `ignoreRestSiblings` — dropping one key from
  a response by destructuring it out is the readable way, and naming what you drop is the
  point of it.
- No new dependencies.

**Tests** — 185 passing, 2 skipped (was 104 / 2).

- `src/services/day/day.test.ts` (41): clustering (the gym hour, the gap measured from the
  end of an activity, the 90-minute split, titles, Health rows kept out); the overlap rules
  on synthetic samples (attach, fill in only missing calories, standalone, the grace
  window, two workouts over one block); `delta_vs_last` for every field and the
  earlier-today case; the status thresholds including the live-day rule; the verdict for
  every goal kind, the rest-day rule and the unlogged/no-goal cases; the eating-pattern
  lines; `expected`; and the local-day edges (23:30 in Los Angeles, 00:30 in Auckland).
- `src/services/tdee.test.ts` (14): the app's four golden profiles, the exclusions, and
  `computeDayTargets` including the stated-target fallback and tracking-only.
- `src/services/readings/readings.test.ts` (10): both schemas under a 1.5 KB budget against
  the ~4.5 KB grammar ceiling, the day sheet's contents (and that it carries no row ids),
  and the inputs hash — unchanged by the clock, changed by a log.
- `src/app.test.ts` (+13): the live day end to end (one block, the calorie model, macros,
  the weight trend, `+5 lb` against last week's bench, `first time`, the arc, no goal → no
  judgement); the reading generated once and reused until the day changes; Health merging
  over real rows (block attached, walk standalone, active energy excluded from `earned`);
  the close writing every column and its reading, being idempotent, and refusing today;
  the closed day served from its record; the week; the paged Days list; and a meal logged
  at 23:30 local at UTC−7 landing on that local day in the day view *and* in the close.
- `src/scripts/seed-demo.test.ts` (3): the script spawned for real against a real database
  — three closed days with readings, the blocks, the goal, safe to re-run, and it wants an
  email.
- `src/adapters/llm/anthropic.readings.contract.test.ts` (2, skipped without a key, run and
  green here): both reading grammars compile on the coach model and `right_now` comes back
  as at most two sentences with a valid action kind.

**Deferred**

- **The app still computes its own targets.** `lib/tdee.ts` and `lib/recommendations.ts`
  are untouched and the phone reads neither `/api/day` nor `/api/week` yet — WP6 rewires
  the screens and deletes the app-side copy. Until then the two agree because the port is
  pinned to the app's outputs.
- **`activities.block_id` is still unwritten.** Blocks are computed; the column is there
  for a future "the user split this block" edit.
- **No `/api/health/sync`** — WP7 owns it. The overlap rules are already live and read
  whatever is in `health_samples`, which is how the tests and the seed script exercise them.
- **The week and the Days list can lag an edit to a closed day** (see the decision above);
  nothing re-closes a day today.
- **`GET /api/day` is not paginated for a very long day** and returns the whole day's items;
  a day is small.
- **No coach-ask card on the Day view** — `coach_briefs` is WP5's, and the day view has the
  shape ready for it.

---

## WP2 — Evidence storage + fusion endpoints

Logging became multimodal. A photo, a transcript and a typed note now go up together, come
back as one preview, and are saved in one transaction when the user confirms.

**New endpoints**

- **`POST /api/log/analyze`** — multipart (`multer`, memory storage): up to **4 photos**
  ≤ **8 MB** each on the `photos` field (`photos[]` and `photo` also accepted), plus `text`,
  `kind_hint`, `client_time`, `tz_offset_min`. Photos are downscaled with **sharp** (longest
  edge 1600 px, JPEG q82, EXIF stripped by the re-encode), stored, and their evidence rows
  created **before** the model call — so the preview carries `evidence[].id` and the confirm
  that follows can link them. Returns `{ result, evidence[], context }`; nothing is saved.
  400 on an empty log or a stray field name, 415 on a non-image, 413 over 8 MB.
- **`POST /api/log/confirm`** — `{ client_id (uuid), result, evidence_ids[], text,
  text_kind, logged_at, source }`. One transaction: activities (exercise normalised against
  the catalogue, `source` fused when evidence is attached), meal + `meal_items` + meal_type,
  `weight_logs`, `goals` (status active, priority appended), profile constraints/preferences
  with `stated_at`, and the evidence links. Returns the saved rows plus `replayed`.
  422 with the model's question for `kind: "unclear"`.
- **`GET /api/evidence/:id`** — auth + ownership, streams the file with
  `Cache-Control: private, max-age=31536000, immutable` and an ETag. Someone else's id is a
  404, not a 403.
- **`POST /api/log` and `/api/parse-log` are unchanged for the app**, but `/api/log` now
  *saves* through the fusion pipeline (`saveConfirmed` per parsed item, one transaction),
  and keeps the typed line as a `text` evidence row.

**Ports, adapters, storage**

- `src/ports/storage.ts` — `EvidenceStore { describe, put, get, delete, stat }`. Keys are
  opaque; only the adapter interprets them.
- `src/adapters/storage/local.ts` — a directory, keys `YYYY/MM/<uuid>.<ext>`. Rejects any
  key that could climb out of the root, twice (pattern, then resolved-path check).
  `src/test/fakes/storage.ts` is the in-memory fake the integration tests run on.
- `container.ts` builds it from `EVIDENCE_STORAGE` (`local`; an unknown name refuses to
  boot) and `EVIDENCE_DIR` (default `./uploads` in dev, `/app/uploads` in production).
  `docker-compose.yml` gains the **`trackdown_uploads`** volume; the Dockerfile creates
  `/app/uploads` owned by `node` so the unprivileged process can write to a fresh volume.
- **Sweep on boot** (`sweepUnlinkedEvidence`, called from `server.ts`): evidence with no
  `confirmed_at` older than 24 h is deleted, row and file. That is what pays for storing
  photos before the confirm.

**Migration — `backend/migrations/0005_evidence_confirm.sql`**

- `evidence.confirmed_at` — the sweep's test. Absence of an owner id could not be it: a
  weight, a constraint and a coach context have no owner column to point at.
- `log_confirmations (user_id, client_id, result jsonb)` — the idempotency ledger. The
  confirm claims the `client_id` first; a concurrent duplicate blocks on the primary key and
  then replays the first attempt's response verbatim.

**Decisions**

- **The provider's grammar limit shaped the schema.** Anthropic compiles a structured-output
  schema into a decoding grammar and refuses one over roughly 4.5 KB ("The compiled grammar
  is too large") — on Haiku *and* Sonnet. The eight-branch union from the plan is 8.9 KB and
  does not compile. So `services/fusion/schema.ts` holds two shapes: the **public**
  `FusionResultSchema` (the eight kinds, what the API returns and the confirm accepts) and a
  **model-facing** routing schema at 4.0 KB that the service widens back
  (`toFusionResult`). The three differences: constraint / preference / coach_context share
  one `statement` branch with a `scope`; `photo_fields: string[]` replaces the per-field
  source object (one array node instead of seven `anyOf`s) and is expanded into the
  documented `sources` map on the way out; and the two plan-shaped kinds — a goal's spec and
  a constraint's plan fields — come from a **second focused call**. Logging a workout or a
  meal, the hot path, is still one call. This was found by the contract test, which is the
  reason it exists.
- **`category` and `muscle_groups` are not asked of the model.** `services/entries.ts`
  already fills them from the catalogue when it recognises the exercise, and two sources for
  one fact is how they drift apart.
- **`/api/log` keeps the v1 parser** rather than routing through `/api/log/analyze`. A typed
  log is routinely several things at once ("protein shake after my 30 min walk, 181 on the
  scale") and the fusion schema is one log, one kind; sending that text through analyze would
  throw two of the three items away. The parser does the multi-item split, confirm does the
  write — one save path, no regression for the shipped app.
- **DATE columns now come back as `YYYY-MM-DD` strings** (`db/client.ts`). node-postgres
  handed back a `Date` at the *server's* midnight, which JSON renders in UTC and which turns
  a goal's `2026-12-01` into `2026-11-30` for anyone west of it. Day boundaries are the
  user's local midnight; a DATE is a calendar date, not an instant. This is what PostgREST
  did too, so nothing in the app changes.
- **Photos are stored before the model is asked.** The alternative — hold 4 × 8 MB in memory
  until the user confirms — makes the server's memory a function of how many people are
  hesitating. The cost is unconfirmed rows, which is what the sweep is for.
- **Evidence for a weight, a constraint or a coach context has no owner id** (the table has
  columns for activity / meal / goal only). It is still marked confirmed, which keeps the
  sweep off it.
- New dependencies: **`sharp`** (server-side downscale — the plan's safety net behind the
  phone's own resize) and **`multer`** + `@types/multer` (multipart parsing; nothing in
  Express 5 does it). sharp is imported directly in `services/images.ts`, not behind a port:
  it is a local library like `pg`, with no key, no vendor and nothing to swap. The eslint
  boundary stays about provider SDKs.

**Tests** — 104 passing, 2 skipped (was 62 / 2).

- `src/app.test.ts` (+12): a real multipart upload of a generated 2400 × 1200 PNG comes back
  1600 × 800 as `image/jpeg` and the stored bytes really are a JPEG; the model was sent the
  image, the catalogue and the kind hint; nothing is saved by analyze. Then the photo streams
  back to its owner and 404s for a stranger, for an unknown uuid and for a non-uuid. Too many
  photos → 400, a text file → 415, 9 MB → 413, an empty log → 400. Confirm covers every kind:
  activities (catalogue spelling, the user's edited load, `source: fused`, both evidence rows
  linked to the activity), meal + items + slot, weight, two goals (priority 1 then 2, the
  timeline as `active_to`), constraint then the same constraint again (not duplicated), a
  preference that sets plan fields and dates them, coach context that writes no row, and
  `unclear` → 422. Idempotency: the same `client_id` twice → `replayed: true`, the same
  activity id, one row in the table. Another user's evidence id is simply not linked.
- `src/services/fusion/fusion.test.ts` (16): local-day arithmetic across a timezone,
  the prompt (today's items, the vocabulary, the goals, the empty-day and kind-hint wording,
  and that v1's grouping rules survived), the schema accepting all eight kinds and refusing a
  goal about a measure the app cannot compute, the widening (`statement` → three kinds,
  `photo_fields` → the source map, catalogue-derived fields left null), and the analyzer's
  two-call paths — a second call for a goal and for a constraint, none for coach context.
- `src/services/images.test.ts` (4) — the downscale, the small-image passthrough, EXIF gone,
  non-image rejected, the accepted mime list.
- `src/adapters/storage/local.test.ts` (4) — put/stat/get/delete on a real temp directory,
  double delete, unknown key, and four path-traversal keys refused.
- `src/adapters/llm/anthropic.fusion.contract.test.ts` (2, skipped without a key, run and
  green here): a tiny generated JPEG plus "I ran 2 miles in 18 minutes" comes back as
  `activities` with `distance_mi` 2, `duration_min` 18 and `sets` null; "get down to 170
  pounds by December" comes back as a `goal` on `body_weight`, through both calls. The key
  is read through `config` and never printed.
- `src/test/fakes/llm.ts` gained an `outputs` queue, for the two-call paths.

**Deferred**

- **Rate limiting on `/api/log/analyze`** is still the global 600/15 min — WP8 owns the
  per-endpoint limit and the cost logging.
- **Prompt caching for the second call.** The goal/plan-fields follow-up re-sends the same
  images. It is rare enough not to matter, and `cache_control` is not in `LlmPort` yet.
- **Backing up the `trackdown_uploads` volume** to TrueNAS is a deploy-side change (WP8).
- **`EVIDENCE_STORAGE=s3`** has no adapter; the config name refuses anything but `local`.
- **`coach_context` saves no row.** The text comes back on the confirm response and is kept
  as evidence; WP5 decides where a day's context lives.
- **`transcript` evidence is written by the client** telling us `text_kind: "transcript"`.
  There is no server-side transcription (WP8's `TranscriptionPort`).

---

## WP1 — Schema v2

The v2 tables, the exercise catalogue, and the measure catalog as code. No new endpoints —
WP2–WP5 fill these in. Everything is additive or a rename, so the deployed app and the rows
already on the Docker host stay valid.

**Migration — `backend/migrations/0004_v2.sql`** (0003 was WP0a's `account.issuer`)

- `calorie_expenditure` → **`activities`**, plus `exercise`, `exercise_id` (FK →
  `exercise_catalog`), `category`, `muscle_groups text[]`, `sets`, `reps`, `load_lb`,
  `distance_mi`, `source` (manual|fused|health, NOT NULL default `manual`), `confidence`,
  `external_id`, `block_id`. Every column nullable or defaulted.
- **`exercise_catalog`** (name unique, aliases, category, primary/secondary muscles,
  equipment) + a GIN index on aliases and a unique index on `lower(name)`.
- **`evidence`** (photo | transcript | text; `storage_key`, `mime`, `width`, `height`,
  `text`; FKs to activity / meal / goal with a CHECK that at most one is set).
- **`health_samples`** (kind, external_id, start/end, value, unit, raw jsonb).
- **`goals`** (kind, title, metrics jsonb, priority, status, active_from/to, stated_at,
  reached_candidate_at) — the spec from concept-v2 §Goals.
- **`profiles`** + diet_style, protein_g, carbs_max_g, training_days, environment,
  equipment[], constraints[], preferences[], eatback (default `half`), stated_at jsonb.
- **`daily_summaries`** + eaten, earned, allowance, status, verdict, blocks jsonb,
  muscle_groups[], in_short, closed_at.
- **`coach_briefs`** (date, asked_at, context, workout/nutrition jsonb, nudge, rationale,
  model, inputs_hash) with a partial unique index on (user_id, date, inputs_hash) — the
  per-day cache key.

**Exercise catalogue**

- `backend/data/exercises.json` — **126** exercises (93 strength, 25 cardio, 7 mobility, 1
  "Other Activity" fallback), each with aliases, category, primary/secondary muscles and
  equipment. Aliases are the spoken forms ("db bench", "rdl", "stairmaster") the fusion
  prompt has to resolve.
- `src/db/exercises.ts` — validating loader + `seedExercises()`, an upsert **by name** (one
  jsonb payload, not parallel arrays: `text[]` columns of different lengths cannot travel as
  a rectangular multidimensional array). Rows the JSON stops listing are left alone — an
  activity may still point at one.
- Run automatically by `npm run db:migrate` after the SQL, by `npm run db:seed-exercises` on
  its own (for a JSON-only change), and by `src/test/db.ts`. `Dockerfile` now copies `data/`
  alongside `migrations/`.

**`services/goals/measures.ts`** — the measure catalog as code

Twelve typed descriptors `{ id, label, unit, scope?, windowDays, derivedFrom, compute(ctx) }`
over a `DayFacts` input (the day, a trailing window of meals / activities / weights / Health
samples, and the day's TDEE). Pure: no SQL, no clock, no LLM — WP3/WP4 build the `DayFacts`
and call in. `body_weight` (7-day average, each day counted once), `calorie_balance` (TDEE +
earned − eaten, positive = deficit), `protein_g`, `carbs_g`, `weekly_sets` (scope: muscle),
`exercise_load` (scope: exercise, best in 4 weeks), `weekly_cardio_min`, `distance_mi`,
`pace` (total time ÷ total distance), `steps`, `resting_hr`, `vo2`.

**`/api/entries/movement` still works**, now as an alias over `activities` (`KINDS.movement`),
and `POST`/`PATCH` also accept `exercise, category, muscle_groups, sets, reps, load_lb,
duration_min, distance_mi, source, confidence`. A recognised `exercise` is stored under the
catalogue's spelling with its `exercise_id`, and fills in `category` / `muscle_groups` when
the caller gave none.

**Decisions**

- **`activities.exercise` is text beside `exercise_id`.** The catalogue normalises names; it
  does not decide what a user is allowed to log. An unknown exercise keeps what the user said
  and gets a null `exercise_id`.
- **`duration_minutes` renamed to `duration_min`**, not duplicated. Nothing in the app or the
  API reads it (grepped), and two columns for one fact is how data goes wrong.
- **`health_samples` is unique on `(user_id, external_id)`**, not `external_id` alone: two
  phones can mint the same sample uuid, and one user's import must never collide with
  another's. `/api/health/sync` is still idempotent.
- **concept-v2's `plans` table became columns on `profiles`.** It is strictly 1:1 with the
  user, so this is one row to read instead of two.
- **`protein_g` / `carbs_g` return null on a day with no meals, not 0.** An unlogged day must
  not judge as a perfect one; its verdict is `unlogged`.
- **`weekly_sets` needs its scope** and returns null without one — an unscoped "sets this
  week" would be a different number pretending to be the same one.
- **Health-derived measures return null with no samples**, asserted in a test that loops over
  every `derivedFrom: "health"` measure, so adding one cannot quietly break "works without
  Health".
- `runMigrations` gained `upTo` (stop after a named file) purely so a test can build a
  database at the old schema and migrate it forward with data in it.
- No new dependencies.

**Tests** — 62 passing, 2 skipped (was 28 / 2).

- `src/db/migrations.test.ts` (10): a database at 0001–0003 with a user, a profile, a
  `calorie_expenditure` row and a `daily_summaries` row is migrated forward — the movement row
  arrives in `activities` with its description, kcal and duration intact and every v2 column
  null; the profile picks up the plan defaults; the new CHECKs reject bad enum values; Health
  ids are unique per user, not globally. Then a *fresh* database (a second database on the
  same server, so no second Postgres has to start) gets the whole schema and a seeded
  catalogue in one run. Plus catalogue seeding convergence and alias lookup.
- `src/services/goals/measures.test.ts` (22): every calculator on fixtures — window edges,
  case-insensitive scopes, the null-not-zero rules, and the catalog's own integrity.
- `src/app.test.ts` (+2): the movement alias saves the v2 fields and normalises "db bench" →
  "Dumbbell Bench Press"; an exercise the catalogue does not know is still saved. The rest of
  the suite is unchanged and passes against the renamed table.

**Deferred**

- No routes for goals, evidence, health or the coach — WP2/WP4/WP5/WP7 own those. The tables
  and the measure calculators are here waiting for them.
- `evidence.storage_key` has a unique index but nothing writes it yet (WP2).
- `src/scripts/migrate-from-supabase.ts` now maps Supabase's `calorie_expenditure` to our
  `activities`. That script's real run is done; the change keeps a rehearsal honest but is
  untested against a live Supabase.

---

## WP0a — Email + password auth

Sign-in is email + password. v1's email-OTP flow is gone: there is no SMTP server, so the
6-digit code was never going to arrive.

**Backend**

- `src/auth.ts` — `emailOTP()` replaced by `emailAndPassword: { enabled: true,
  minPasswordLength: 8 }` (exported as `MIN_PASSWORD_LENGTH`, mirrored by the app). The
  `bearer` plugin and the `profiles`-row creation hook are unchanged. Endpoints:
  `POST /api/auth/sign-up/email` (name, email, password — auto-signs in),
  `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`. The old
  `/api/auth/email-otp/*` and `/api/auth/sign-in/email-otp` now 404 (asserted in a test).
- `emailAndPassword.sendResetPassword` is deliberately **unset**: Better Auth then refuses
  `/request-password-reset` outright, which is honest while no mail server exists.
- `migrations/0003_account_issuer.sql` — Better Auth 1.7 requires `account."issuer"`
  (`local:credential` for email+password). 0001 predates it because the OTP flow never
  wrote an account row; email+password does, so the column had to exist before the first
  sign-up. Added nullable, backfilled `'local:' || "providerId"`, set NOT NULL, plus the
  unique `(issuer, accountId)` index Better Auth looks accounts up by.
  **Note for WP1: the schema-v2 migration is now `0004_v2.sql`, not `0003_v2.sql`.**
- `src/services/password.ts` + `src/scripts/reset-password.ts` —
  `npm run reset-password -- <email> <newPassword>`. Everything goes through
  `auth.$context`: `password.hash` (the exact hasher sign-in verifies with) and
  `internalAdapter.updatePassword` / `createAccount`, the same two branches Better Auth's
  own `/reset-password` takes. No hashing is written by hand. It also gives a v1 OTP-era
  account — a user row with no credential account at all — its first password.
- `src/ports/email.ts` (`EmailPort`) + `src/adapters/email/smtp.ts`
  (`createSmtpEmailer`) — the old `createSmtpOtpSender` generalised. Nothing sends mail
  today; the port is kept so password-reset emails have somewhere to land once SMTP
  exists. Without `SMTP_HOST` it logs the message instead of sending it (unit-tested).

**App**

- `lib/auth.ts` — `emailOTPClient` plugin removed; `signIn(email, password)` and
  `signUp(email, password)` replace `sendSignInCode` / `verifySignInCode`. `signUp` sends
  the email's local part as Better Auth's required `name`.
- `app/(auth)/sign-in.tsx` — one screen, two modes: a password field
  (`secureTextEntry`, min 8, checked client-side before the request) and a
  "No account yet? Create one" / "Already have an account? Sign in" toggle. Backend error
  messages are surfaced verbatim, so a duplicate sign-up reads "User already exists…".
  Kept in the existing cream/Fraunces style — WP6 restyles it.

**Decisions**

- Duplicate sign-up returns 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` rather than Better
  Auth's silent enumeration-protection response, because that response only applies with
  `requireEmailVerification` or `autoSignIn: false`, and neither is on. This is what the
  build plan asked for ("a clear already-exists error").
- New dependency `@better-auth/core@^1.7.2` (already installed transitively by
  `better-auth`) — for `createLocalAccountIssuer`, so the reset script writes the same
  issuer string Better Auth does instead of hard-coding `"local:credential"`.
- The OTP user row on the production database was **not** touched. Give it a password with
  the reset script.

**Tests** — `backend`: 21 passing (was 13). New/rewritten: sign-up creates user + profile,
sign-in with the right password, wrong password and unknown email both 401, password under
8 rejected, duplicate email rejected, sign-out kills the token, OTP endpoints 404, reset
script updates an existing password, reset script creates a first password for an OTP-era
account, reset script rejects unknown email / short password, SMTP console fallback.

**Deferred** — self-service password reset (needs SMTP), and the `EmailPort` is
implemented but not yet called from anywhere.

---

## WP0 — Ports & adapters

Third-party services now sit behind interfaces, so swapping one is an env var.

**New**

- `src/ports/llm.ts` — `LlmPort.parseStructured({ system, messages, schema, schemaName,
  maxTokens })`. Messages carry **text and images** (`{ type: "image", mediaType:
  "image/jpeg" | "image/png", base64 }`) even though only text is used today: WP2 sends a
  machine photo plus a spoken set/rep count as one call, and the port had to be designed for
  that now rather than widened later. Vision is folded in here — no separate `VisionPort`.
- `src/adapters/llm/anthropic.ts` — `messages.parse` + `zodOutputFormat`. Keeps the optional
  `anthropic-workspace-id` default header (`ANTHROPIC_WORKSPACE_ID`) that identity-linked
  keys require.
- `src/adapters/llm/openai.ts` — `responses.parse` + `zodTextFormat`, images as
  `input_image` data URLs. New dependency: `openai@^7.8.0` — the second adapter is what
  proves the port is an abstraction and not a rename.
- `src/adapters/llm/unavailable.ts` — the "no API key" adapter. A missing key must not stop
  the server booting (sign-in, manual logging, every CRUD endpoint are unaffected); it fails
  at the one call that needed it, naming the variable.
- `src/container.ts` — the composition root. Builds `llm`, `coachLlm` and `email` from
  config; a provider with no adapter throws.
- `src/test/fakes/llm.ts`, `src/test/fakes/email.ts` — the fakes integration tests use. The
  LLM fake validates through the caller's own schema, so it cannot return a shape the real
  provider could not.

**Changed**

- `services/parseLog.ts` is provider-neutral: it owns `SYSTEM_PROMPT` and the zod schema and
  exports `createLogParser(llm: LlmPort)`. `createClaudeLogParser` and its Anthropic import
  are gone. `LogParser` (what routes depend on) is unchanged.
- `config/index.ts` gained `LLM_PROVIDER`, `COACH_LLM_PROVIDER` (defaults to `LLM_PROVIDER`),
  `LLM_MODEL_FUSION`, `LLM_MODEL_COACH`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`. An unknown
  provider name throws at boot. Per-provider default models live in `config.llm.defaultModels`
  (anthropic `claude-haiku-4-5` / `claude-sonnet-4-5`, openai `gpt-4.1-mini` / `gpt-4.1`) —
  one source of truth, also used by the contract tests. `ANTHROPIC_MODEL` still works as an
  alias for `LLM_MODEL_FUSION` so the deployed `.env.production` keeps working.
- `eslint.config.js` — `no-restricted-imports` for `@anthropic-ai/sdk`, `openai` and
  `nodemailer` (and their subpaths, e.g. `@anthropic-ai/sdk/helpers/zod`) everywhere except
  `src/adapters/**`. Verified by temporarily importing all four into `routes/log.ts`: 4
  errors; codebase clean again afterwards.
- `.env.example` and `docker-compose.yml` document and pass through the new variables.
  `TRANSCRIPTION_PROVIDER` and `EVIDENCE_STORAGE` are listed as "not read yet" — their ports
  arrive with WP8 and WP2 rather than as dead config now.

**Decisions**

- `schemaName` is part of the port because OpenAI's structured outputs require a
  model-visible schema name; the Anthropic adapter ignores it.
- OpenAI assistant-role messages with array content are flattened to text — assistant turns
  are context we wrote and never carry images, and the Responses API wants `output_text`
  there.
- Contract tests build their client lazily: an SDK constructed with an empty key throws, and
  that would fail the file instead of skipping it.

**Tests** — 28 passing, 2 skipped (was 21). New: 3 container tests (per-provider wiring,
missing key names the variable at the call, unknown provider refused), 2 `createLogParser`
tests over the fake port, and 2×2 adapter contract tests (structured parse + an image part,
checked against a 16×16 red PNG). `app.test.ts` now drives the real `parseLog` service over
the fake `LlmPort` instead of a fake `LogParser`, with every assertion unchanged.

**Deferred / uncertain**

- **The OpenAI contract tests have never run**: `backend/.env` has no `OPENAI_API_KEY`, so
  both skip. The adapter typechecks against the real SDK types, but "LLM_PROVIDER=openai
  parses with a real key" from the WP0 acceptance list is unverified, and the openai default
  model names are a reasonable guess rather than a tested value. Add a key and run
  `npm test` to close this.
- `CoachPort`, `TranscriptionPort` and `EvidenceStore` are not built — they would be empty
  interfaces with no caller. They arrive with WP5, WP8 and WP2.
