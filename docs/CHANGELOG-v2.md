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

### 2026-09-02 — a sauna is a thing you did, and a busy provider is weather (`fix-recovery-routing`)

#### The sauna went to the wrong bucket

"15 minutes sauna at 190 degrees" was routed to **statement / coach_context** — *"used the
next time you ask, then gone"*. So nothing would have been logged at all. The user meant to
keep it.

It is past tense with a length on it: a thing their body did. Passive recovery already
done — sauna, steam room, hot tub, ice bath, cold plunge, massage, foam rolling, stretching
— is an **activity**, and the always-log rule covers it exactly as it covers a set of
squats: category `other` (or `mobility` for rolling and stretching), the duration from
their words, muscle groups empty, kcal 0 or a small honest estimate, and the details they
gave — a temperature, which bath — kept in the description.

**The tell is tense and duration**, and the prompt now says so where the mistake was made:
a completed act with a length is a LOG however passive it was; a condition that shapes the
next answer, with nothing done in it, is context. *"If you can ask 'how long did it last?'
and the words answer, it happened: log it."* The cost of getting this wrong is asymmetric
and the rule says that too — a coach context is read once and gone, so mis-filing a record
there throws it away.

A contract test drives the literal input: 15 minutes, sauna in the name, no sets, no reps,
no load — and **190 never becomes a weight**, which is the other way this sentence could
have gone wrong. The Train view needed no change: a muscle-less `other` activity already
falls to "Also", where it now also draws as done.

#### And the 529 that reached the phone

While testing the above, the provider went down under load and the app showed what the SDK
had said:

    529 {"type":"error","error":{"type":"overloaded_error",...,"request_id":"req_011Ce..."}}

Three things were right about that — the typed text survived, the failure was not silent,
and it could be retried — and one was wrong: it is developer talk on a screen belonging to
somebody in a gym.

- **One retry, at one layer.** `adapters/llm/anthropic.ts` retries a 429/529 once after
  1.5 s. **Only** an overload: a 400 is a bug and a 401 is a configuration problem, and
  asking either twice is waiting longer to find out. Crucially, `adapters/coach/llm.ts`
  already retried *any* error once — so a brief would have made **four** calls to a provider
  that was already struggling. Retry policy is now single-layer and explicit: transport owns
  transient provider failures, the coach adapter owns malformed answers, and neither reaches
  into the other's job.
- **One human line.** `POST /api/log/analyze` catches a surviving overload and answers 503
  with *"The reader is busy right now — try again in a few seconds."* plus a
  `provider_overloaded` code. The status and request id go to the server log, where somebody
  who wants them can find them. The app maps on the **code**, not the prose — matching on
  English is how a fix stops working in a language nobody planned for — and every other
  failure still explains itself in the server's own words.

**Verified** — backend **728 → 739**: the overload predicate (both statuses, the message
shape the user actually saw, and *not* the 4xx that must fail fast), the copy carrying no
status or JSON, and the adapter retrying exactly once with a real backoff, giving up after
one so an outage still fails fast, and never retrying an unusable answer. App **391 → 393**:
the busy line on screen with the typed text intact and nothing from the wire, and an
ordinary error still speaking plainly.

**One honest note on the contract suite.** Both new cases — the sauna and yesterday's
equipment fix — pass individually against the real model. A full 20-case run could not be
got to green this session: the provider is intermittently returning 529 under load, and
twenty concurrent real calls provoke exactly the condition the second half of this entry is
about. Nothing in those failures is an assertion; every one is `overloaded_error`. Worth a
re-run when the weather clears.

### 2026-09-02 — the implement is a fact, and finished work looks finished (`fix-equipment-and-also`)

#### The reader overruled what the user typed

Typed, not spoken: **"barbel curl 3x10 at 50"**. Saved as **Dumbbell Curl**, described as
*"3 sets of 10 at 50 lb per dumbbell"*. The reader crossed the equipment class the user had
stated, and then invented per-dumbbell phrasing to justify the crossing.

Two things let it:

- The catalogue's `Dumbbell Curl` is aliased to the bare **"bicep curl"**, so a typo'd
  "barbel" drops to the plain movement and lands there — while `Barbell Curl` sits right
  beside it, aliased only to spellings that include the word.
- Yesterday's per-side rule read *"Dumbbells ("in each hand", "two 45s", **or the movement is
  a dumbbell one**)"*. That last clause is a licence to decide the class from the movement's
  usual form, which is exactly what happened, and the "per dumbbell" description followed
  from it.

**The implement somebody names is a fact, exactly like the numbers are.** The prompt now says
so outright: never move a log between barbell, dumbbell, machine, cable, kettlebell, band or
smith against what they said — not because the load looks unusual, not because the movement
is more commonly done another way. *A weight you find surprising is a weight they lifted.*
Read through the typo and keep the class: "barbel", "barble", "bar bell" and "burble curl"
are a barbell curl; correct the spelling, never the equipment. A named implement outranks
the catalogue's most familiar spelling — use the entry that matches their class, or their own
words if there is none. The same rule sits in the vocabulary block beside the qualifier rule
it is a sibling of, because a class is a qualifier: `barbel curl` is Barbell Curl and never
Dumbbell Curl.

The dumbbell clause is tightened to what it was for: it applies when they **said** dumbbells,
**described a pair**, or used a name that names them — never as an inference from the
movement. And the working is only shown when working was actually done: *"a load given as one
plain number was not computed, and its description says nothing about sides or per-dumbbell."*

A contract test now drives the literal input against the real model: `barbel curl 3x10 at 50`
→ a barbell curl, 3 × 10 at 50, no dumbbell anywhere in the name, equipment or description,
and no per-side arithmetic invented for a number nobody said was per side.

#### "Also" looked pending

Off-plan work sat under **Also** in the plan's own card with no done styling, next to plan
lines carrying a green ✓ — so finished work looked like work still owed. *"the way it is
listing under also don't show that it is done."*

Those rows are logged facts; they are done by definition. They now carry the same treatment a
finished plan line does — dimmed, with the green ✓ — and the calories move onto the line so
nothing is lost to the tick.

**It stays its own group.** Freelanced work is not the plan, it is still not in the N-of-M
count, and the heading still says how much of it there is. The treatment is deliberately NOT
applied to the full training log, where every row is done and a column of identical ticks
would say nothing at all — it earns its meaning here only by sitting beside lines that are
not.

**Verified** — app **389 → 391** (an Also row draws the ✓ and keeps its calories; Also stays a
separate group and the plan's count stays about the plan). Backend **728**, and the **fusion
contract suite 19/19 against the real API** — the new equipment case plus every existing one,
including the meal-consistency case that has historically flaked. `tsc` and both lints clean.

### 2026-09-02 — the total is what we store, the plates are what you load (`feat-per-side-loads`)

> coach says 115… minus the 45 bar… 70… 35 a side

A barbell load is stored and prescribed as a **total**, and that is right: progression works
on totals, and a history that recorded "35" for a 115 lb lift would be a history that lies.
But nobody loads a total. They load plates, per side — and the subtraction in between was
being done by the user, in a gym, mid-session.

So the app says both. The total leads, because it is what the plan, the history and the
progression are all keyed on; the plates follow, because they are what the hands do:

    115 lb · 35/side + bar

**Where it is drawn:** plan rows (the prescription), the lifts board's `load_text`, and the
receipt under a done lift — `2 × 10 @ 115 (35/side + bar)`. The confirm card is unchanged on
purpose: the fusion rules already show their working there ("45/side + 45 lb bar = 135 lb"),
which is the same fact arriving from the other direction.

**Only for a bar, and every exclusion is its own small truth.** A dumbbell figure is
*already* per hand — the fusion load rules make it so. A machine's number is the stack. An
**assisted** load is help, not plates. And a total at or below 45 is just the bar, where
"0/side" is arithmetic nobody asked for. `perSideLb` also refuses to round: a load that
cannot be made from a matching pair is left unannotated rather than turned into a number the
user would have to un-round at the rack.

**The catalogue decides, never the name.** "Bench Press" is a barbell and does not say so,
so `equipment` now rides out of `lookupExercises` with the ids and `withExerciseIds` puts a
`barbell` flag on each Do-list line. The finisher does not get one — stretching prescribes no
load for a per-side note to be about.

**The prompt too**, so a prescription reads the way it is racked: a barbell load's `note`
may say "35 a side plus the bar" when it has room, while `load_lb` stays the total it must
be. The instruction is explicit that the total is what gets copied and the plates are only
how it is *said*.

**Verified** — app **374 → 389**: the helper as a pure rule (bar taken off and halved, sub-bar
totals and empty bars silent, half plates printed as halves and never as "37.50", every
non-barbell excluded, no load at all handled), and the row rendering (plates beside the
prescribed total, a half plate on screen, silence for a non-barbell and for an empty bar, and
the plates carried onto a done lift's receipt). Backend **728**, with the board's own
expectation updated to the truth it now tells: 135 on the bar is 45 a side. `tsc` and both
lints clean.

### 2026-09-02 — an append that added the plan to itself (`fix-append-duplicates`)

Five movements planned — Lat Pulldown, Seated Cable Row, Barbell Curl, Hammer Curl, Good
Morning. Through *Add to today's plan* the user said, in effect, **"I'll have a one hour
session — regenerate based on that."**

Back came an **ADDED 7:09 AM** block containing the same five movements. Every exercise was
on the day twice.

The model did the most literal thing available to it: asked to regenerate for an hour, it
returned a whole one-hour session — which was the session it had just been shown. The append
path concatenated it wholesale.

**The gate, which is the actual fix.** `appendToBrief` now refuses any movement already on
today's plan, using the log's own qualifier-aware matcher: an **Assisted** Chin-Up is not a
Chin-Up and an **Incline** Bench is not a Bench, so a real variation still gets added, while
"Bench Press with Dumbbells" against a planned "Dumbbell Bench Press" is caught — word order
and plurals are not facts about an exercise. It also dedupes *within* one answer, since a
model that repeats itself inside a single append is the same bug arriving twice as fast.

**The drops are named, never silent.** The response carries "Lat Pulldown and Barbell Curl
are already on the plan, so they were not added again," and the Train page prints it above
the plan. A user who asked for more and got fewer items than the model offered is owed the
reason.

This lives in the append service and is unit-tested independently of any prompt, because it
is a data rule: two movements that are the same movement do not both belong on one day's
plan, whatever the model believed it was doing.

**The prompt, second.** The append block now says outright that it is **extending a plan it
has just been shown**, and that "regenerate", "rebuild" or "make it an hour" inside an
append do not license returning that plan again — *"handing them back writes each one onto
the day TWICE."* And when the ask is about total session length, that length covers the plan
above: an hour with five movements already on it has room for one or two more, not six,
complementing what is there rather than reloading the same muscle groups.

#### The sizing question: nothing is broken, and here is the arithmetic

The user asked why an hour produced only five movements. Traced end to end, **the default
flows correctly**:

- `profiles.session_minutes` is deliberately NULL-able with **no SQL default** — "NULL is the
  honest *nobody has told me*" — and `DEFAULT_SESSION_MINUTES = 60` is applied in TypeScript
  (`services/coach/rules.ts`).
- It reaches the model explicitly. For a user who has never stated a length the prompt reads:
  *"SESSION LENGTH: 60 minutes (nobody has said, so this is the standing hour). That is room
  for about 6 exercises — never more than 7 — plus 4 short stretch or mobility items to
  close."* The provenance is flagged, so the model is never told the user asked for sixty.
- The arithmetic: 8 working minutes per exercise, 5 for warm-up, the finisher off the end —
  60 − 5 − 4 = 51, ⌊51/8⌋ = **6 target**, cap 7, finisher 4.
- `capBrief` re-applies the ceiling in code on a fresh brief (never on a revision — "make it
  8 exercises" is the user overruling the size, and trimming their answer back would be the
  app arguing with them).

So the plumbing asked for about six and allowed seven; the model returned five. That is one
below a target the prompt states as approximate, and the same rules block ends *"fewer,
harder movements beat a list nobody can finish"* — which actively licenses the low end.
**No code change**, on the standing rule that sizing changes need evidence: there is none of
a fault here, only of a model exercising discretion the prompt gives it. Worth noting that
the user's "I'll have an hour" matched what the system already assumed, so their statement
changed nothing — which is why it read as being ignored.

**Verified** — backend **717 → 728**: the gate as a unit (the whole session dropped and every
name reported, genuinely new movements kept, qualified variations kept, word order and
plurals caught, a self-repeating answer refused, an ordinary append untouched), the note's
wording, and the route end to end reproducing the field report — five planned, five returned
plus one new, one added, drop named. App **373 → 374**: the note drawn above a plan that is
still entirely there. `tsc` and both lints clean.

### 2026-09-02 — a dropped answer is not a failed plan (`fix-lost-generation`)

The user pressed **"Start today's workout"**, watched **"Thinking…"**, and watched the page
go back to **"Nothing planned yet"**. The plan had been written: five items, *"Pull day:
back, biceps and hamstrings"*, sitting finished on the server the whole time. The app had
simply stopped listening, and then said nothing about it.

**Two bugs, and the second is the one that made it silent.**

1. **There was no explicit timeout on the fetch wrapper** — which does not mean there was
   none. iOS's `NSURLSession` gives up at **60 seconds**, and a coach brief is a Sonnet call
   over a phone connection. The platform's number was shorter than the work, so a generation
   that *succeeded* came back to the app as a network error.
2. **The error note was rendered only when a brief already existed** (`note && brief`). On
   the first generation of the day there is no brief by definition — so the one message that
   would have explained anything had nowhere to go, and the page reverted in silence.

**The fixes.**

- `lib/api.ts` gains an explicit deadline: `DEFAULT_TIMEOUT_MS` 30 s, and
  `GENERATE_TIMEOUT_MS` **180 s** for the one call that routinely outlives a phone's
  patience. An abort surfaces as a `TimeoutError`, not a bare network error, because "we
  stopped waiting" and "the network refused" lead to different recoveries. *A number the app
  chooses is a number it can reason about; a platform default is one it finds out about in a
  screenshot.*
- **A lost answer is recovered, not reported** (`lib/coach-recovery.ts`,
  `useStartWorkout`). On a dropped or slow generate, the app polls `/api/coach/status` —
  cheap, and constitutionally unable to generate anything — backing off 2 s → 34 s over
  about two minutes. The moment it says `has_plan`, the brief is fetched and drawn. On a
  long call **a dropped response is the expected case, not the exceptional one**, and the
  server's per-day semantics mean the brief is already there to be found.
- **A refusal is still a refusal.** An `ApiError` (a 503, say) is said plainly and does not
  start a poll for a plan nobody is writing. Only a *lost* answer is worth waiting on.
- **One spinner, one disabled button.** The recovery counts as busy, because from the user's
  side it is the same wait; a second tap during it does nothing and starts no second
  generation.
- **It never ends in silence.** If the window closes with nothing: *"That didn't come back —
  the plan may still be being written. Check again in a moment."* — with the button back.
  It never claims the plan failed, because it does not know that. And the note now draws
  with or without a brief, which was the actual silence.

**On the server: no behaviour change, and one honest admission.** There is no evidence of a
latency regression — and there could not be. The coach route emitted no timings at all, and
the logs that would have covered yesterday were destroyed by a container rebuild at 00:17
followed by a host reboot at 00:46. So the route is **instrumented** now: `Server-Timing`
with a `generate` phase on the regenerate path and a `brief` phase on the cheap read, using
the middleware two other routes already use. That writes a response header and changes
nothing else — it is the difference between diagnosing the next one and guessing at it.

Worth knowing for next time, from the same diagnosis: the coach is `claude-sonnet-4-5` (by
hardcoded default, not by env), the Anthropic client is constructed with **no timeout or
retry override**, and `adapters/coach/llm.ts` does one **silent retry** — so a slow call can
quietly become two, with only a `⚠️` line to show for it. The container is not
resource-starved.

**Verified** — app **357 → 373** across **28 suites**: the deadline (a hung request aborts
as a `TimeoutError`, waits its full time, actually cancels the fetch, and leaves a fast
request alone), the poll (finds the plan, backs off, survives a failed check, gives up after
~2 min, stops when the screen goes away), and the page (recovers and draws the found plan,
never ends in silence, guards the double tap, says a refusal plainly without polling).
Backend **715 → 717** for the timing header. `tsc` and `expo lint` clean.

### 2026-09-01 — the one sheet says which door you came through (`fix-log-framing`)

Pressing **"Tell me"** on the You page opened the logger saying **"What did you do?"** over a
placeholder about shoulder presses.

> shouldn't it be aware of where it's being called from? It should say tell me more about you

It is one sheet on purpose — there is exactly one input surface in this app (concept-v2
§Principles 7) — but one sheet reached from several doors was introducing itself as though
the + had been pressed every time.

A door may now pass a **framing**, and `lib/log-framing.ts` is the table of what each one
opens with: title, placeholder, the line under the title, the hint under the controls. Three
entries.

- **default** — the + on every tab. Unchanged, down to the shoulder-press placeholder.
- **about-you** — the You page's "Tell me". *"Tell me about you"*, a placeholder in that
  register (*"I'm 45, I train four days a week, bad left knee, no dairy…"*), and a line
  saying what it does: shapes your plan and your profile, and is not a log of something you
  did.
- **plan** — exactly as it shipped, generalised out of the `adjustPlan` flag it used to be.

**Only the words change.** No second form, no second endpoint, no kind hint smuggled in
behind the copy: an about-you sentence goes through `/api/log/analyze` and is classified by
the same router that already tells a preference from a workout. The framing carries the one
thing the router cannot know — which button was pressed — and nothing else. The `plan` door
remains the single exception that also changes where the words go, because it writes no
record at all.

The submit button is renamed only where the sheet is not logging a record, which is the plan
door alone. Borrowing a different verb for the same act would be the words drifting from the
deed.

Doors whose surface implies no register still pass nothing and still get the default — the
nudge actions, the goal sheet on Progress, every row that opens for a correction. That is
the right answer for them.

**Verified** — app **349 → 357** across **26 suites**: the table as a pure rule (every
framing has its copy, an unknown value falls back to default, only the plan door renames its
button), the You door opening in about-you framing, the + unchanged, the plan door unchanged,
and an about-you submission taking the identical path with no `kind_hint` and no coach call.
Backend untouched (715). `tsc` and `expo lint` clean.

### 2026-09-01 — a day still being lived cannot be judged (`fix-open-day-verdicts`)

A screenshot at 12:59 pm, one meal in. The Eat page's week said:

> protein came in at 105 g on **2026-09-01**, under the 148 g mark

2026-09-01 was that day. The week layer was passing a past-tense verdict on a day that was
half over — and worse, quietly averaging its partial totals in as though they were a whole
day's eating, which dragged 1,693 kcal/day and 164.5 g of protein down with it.

That is the no-unearned-verdicts law (concept-v2 §Principles 8) broken by **arithmetic**
rather than by wording. Every previous version of this rule was about what the app *says*;
this one was about what it *counts*, and the wording was only reporting it faithfully.

**The rolling week is CLOSED days now — yesterday backward.** The open day never appears in
an average, never appears in an outlier flag, and never appears in the "thin week" count,
which is the same fix said three ways: a caption that counts today flatters the week by
exactly the day it is not allowed to judge. Today needs none of it — it already has its own
live layer at the top of the same page.

Excluded **twice, deliberately**: the query ends yesterday so the open day is never read,
and `summarise` drops it again, because the rule is what that function is *for* and a rule
enforced only at the call site is one the next caller does not inherit. The direction
paragraph is handed the same closed-day facts — and is told in as many words that today is
not in its numbers, since a model given only closed days can still write "today came in at"
if nobody says not to. Its inputs hash moved with the numbers, so the cached paragraph
refreshes itself.

**And the Why card admits its age.** Its eyebrow is now "Why · as of 7:04a". The rationale is
a fact about the *answer* — written when the plan was asked for — so a plan asked at 7 am
reads yesterday, correctly, and said so nowhere. The user asked why it was "talking about
yesterday" on the same day as the screenshot above. A brief with no recorded ask time still
reads a plain "Why".

**Verified** — backend **706 → 715**: the open day out of the averages and out of the flags,
the last *closed* day still flagged when it deserves it, the caption counting closed days,
a future day dropped by the same rule read forwards, today-only weeks saying nothing at all,
and the route end to end. App **347 → 349**: the Why eyebrow with its time, and its fallback.
`tsc` and `expo lint` clean.

### 2026-09-01 — each tab owns one verb (`wp-train-tab`)

Giving eating its own tab left Today holding a calories card while another tab owned
calories — two answers to one question, on two screens. So Today stops being the day.

**HOME · TRAIN · EAT · PROGRESS · YOU.**

- **TRAIN** (was Today) is the session and nothing else: the plan with its receipts and
  ticks, off-plan work under "Also", Adjust / Replace, the coach's one nudge, and *Start
  today's workout* when there is no plan. The Done door survives for a day with no plan to
  hang the log off — that is still training, and this tab owns training. Off it come the Eat
  row, the calories-left card, the goal card, the "Day 2 · on track" header and the
  Right-now reading. **Nothing on this page links food-ward any more** except the global +.
- **HOME** is the morning glance and now the only page that thinks in whole days. It gains
  the day number and its verdict — with the empty-day suppression rule intact, because 0
  eaten is trivially "under allowance" and a green "on track" at 6 am judges a day nobody
  has lived — the **Right-now reading**, which reads food and training together and
  therefore belongs on neither half of them, and a one-line **calories glance** ("1,180
  eaten · 1,205 left") that opens Eat. It keeps the goal card, the 7-day weight, the week,
  and the button into the session.
- **EAT** is untouched; it already owned calories-left as its top layer.

Routes stay honest: `/today` redirects to `/train`, and the full training log moved with its
tab to `app/train/log.tsx`. Nothing was deleted from the data or the day views — Days in
Progress and the past-day pages are exactly as they were.

Every door is a door. Nothing on Home or Train can generate a plan: `/api/coach/status` is
an exists-check, `/api/day/:date` is a read, and `GET /api/coach/next?generate=false` cannot
write. *Start today's workout* is still the only generator in the app.

**Verified** — app **346 → 347** across 25 suites. New: Home carries the verdict and
suppresses it on an empty day, draws the reading, prints the calories line and reads "over"
rather than a negative, and has both doors while generating neither; Train contains no eat,
goal or verdict element; `/today` redirects. Backend untouched (706). `tsc` and `expo lint`
clean.

### 2026-09-01 — a page for eating, and five tabs instead of six (`wp-eat-page`)

Training had a plan, a log, a coverage map and a whole tab. Eating had a compact row and a
door. This is the other half of the day getting a page.

**The tab bar is Home · Today · Eat · Progress · You.** Days folded into Progress — the list
of closed days is the top section of that page now (`components/days-list.tsx`), with every
row, verdict, tally and tap exactly as the tab drew them. What changed is the container: a
FlatList became plain views, because a list inside a scrolling page is two scrollers
fighting, and paging became an *Earlier days* button, because "load more at the bottom" has
no bottom to reach inside a longer page. `/days` redirects to `/progress`.

**The Eat page is four layers, and the order is the argument.**

1. **Today** — what is left of the day, from `computeDay`, which is the same arithmetic
   Today's compact row shows. One authoritative figure; two screens must never disagree
   about one day's calories.
2. **The week, COMPUTED** — `services/eating/features.ts`. A rolling seven days from the
   logged meals: average calories, protein, carbohydrate, fat and fibre, each against a
   target that says where it came from. Nothing on this layer came out of a model.
   - **A day nobody logged is an absence, not a zero.** The divisor is days that had food on
     them, and the page says how many those were — an average over two days is called a thin
     week rather than passed off as a trend.
   - **"Stated" means the user actually said it.** The day view's macro targets are
     *derived*, so the week is measured against the profile's own columns instead; where
     there is nothing, protein is derived from body weight at 0.7 g/lb and the fibre
     guideline (25–38 g) stands in — and each says which it did. Handing a default back as
     the user's own aim is the thing that field exists to prevent.
   - Outliers name what stood out about the most recent logged day, and are silent when
     nothing did. A page that always has a complaint on it is a page people stop reading.
3. **The direction, WRITTEN** — the one generated thing on the page, and it is a **reading,
   not a brief**: cached in `day_readings` (migration 0019) against the week's own inputs
   hash, so opening the page when nothing has moved costs nothing, and it is never
   scheduled and never nags. Nutrient direction only — the prompt forbids naming a dish, a
   meal or a food in as many words, because that is the line the user drew: *"it doesn't
   have to be a dish… general direction of nutrients."* It is handed the computed averages,
   the user's diet style and preferences, and the guardrails (protein 0.7–1 g/lb, the fibre
   band, carbs sized to training) — never the meal rows.
4. **The food log** — the by-slot list, absorbed from `app/today/eating.tsx`, which is gone.
   Today's compact Eat row now opens the tab. No dead routes.

An empty week generates nothing at all: no model call, no paragraph. A concern invented
about a week that has not happened is worse than silence.

**Verified** — backend **677 → 705**: the features module as pure arithmetic (window math,
which targets are stated versus derived versus guideline, the outlier rules, an empty week),
the direction's cache key, the prompt's own contract, and the route end to end including
*generates nothing on a warm open* and *writes a new one once the week moves*. App **337 →
346** across **25 suites**: all four layers, both empty states, the meal row's correct and
delete, no input surface on the page, and the `/days` redirect. `tsc` and `expo lint` clean
on both sides.

### 2026-09-01 — the plan and the log are one section (`wp-plan-log-merge`)

Today had a **Do** list and a **Done** row, and they were two views of the same facts. The
plan said *Chest Press Machine · 85 lb · 4 × 10*; the log said *2 × 10 · 85 lb* and
*2 × 10 · 70 lb*. To see that the load had dropped partway through, the reader had to hold
both lists in their head and match them by name — which is exactly the work the server had
already done, because that is how the ✓ gets there.

> "if it's done, it's checked, you can click it, you can see the log, everything I logged
> about it"

**The plan is the skeleton and the log hangs off it.**

- Each prescribed line keeps its name (still a door to the sheet) and its prescription. Once
  something has been logged against it, a **truth line** appears underneath — "Done 8:02a ·
  2 × 10 @ 85 + 2 × 10 @ 70" — and **tapping the row** opens the records themselves, each
  with its evidence, its correction and its ✕. Tapping the NAME still opens the exercise
  sheet; the two taps do different things and always did.
- **Several records against one line is the case this is for.** A drop set corrected into
  two rows (migration 0018) is two records against one prescribed line, and printing only
  the first would be the double-counting bug wearing a new hat. Both are on the line and
  both are reachable.
- **Off-plan work joins the same card**, under "Also", with the full logged row treatment —
  the extra set, the walk home, cardio nobody prescribed. Nothing the user actually did
  renders in a second section any more.
- The section header carries the totals the Done row used to: "569 kcal earned" with the
  session's span beside it. **The compact Done row disappears whenever a plan exists.** On a
  no-plan day there is no skeleton to hang the log off, so the row and its door stay exactly
  as they were, and `app/today/training.tsx` remains the full log behind them.
- The **delta chips** ("−2 sets", "−3 min") are off inside the merged card. The prescription
  sits directly above the truth line, so planned-versus-actual reads off the row itself; a
  third comparison against a different baseline is noise on top of it. They stay on the full
  log screen and on a closed Day, where there is no prescription to read against.
  Completion math — the ✓, "2 of 4 sets", "5 of 6 done" — is untouched.

**The app never matches anything.** The server already links plan items to logged records to
make the tick, and `ExerciseCompletion.records` now carries those matches out with it —
ids, times and numbers, oldest first. Additive and optional the whole way down, so an older
app tolerates it and an older server just means no truth line rather than a crash. A second
matcher in the app would eventually disagree with the tick sitting beside it, and then the
line would stop meaning what it says.

Off-plan work is a **set difference on ids the server gave**, not a second matching pass.

**Verified** — backend **677** (was 672): the matcher's new half is unit-tested (both halves
of a split against one line, logged order, a row with no id counted but not listed, nothing
against an untouched line) and `app.test.ts` checks the ids arrive over HTTP. App **316 →
335** across **24 suites**: `lib/plan-truth.ts` as a pure formatting rule, and the merged
card against the real component — truth line, split parts both reachable, name-versus-row
taps, "Also", header totals, delta chips gone, and the no-plan day keeping its door.
`tsc` and `expo lint` clean.

### 2026-09-01 — the working page gets out of its own way (`wp-today-cleanup`)

The merged Today page, over Metro, with screenshots. Five corrections, and four of them
are the same correction: **it was pushing the day off its own screen.**

#### The second form had to go

The Do section had grown a text box, a PHOTO tile, a TYPE tile and its own submit button.
That is a second input surface, and there is exactly one:

> "there is only one way to update anything in the app and that is the logger… if needed it
> should be a link to the logger."

So the whole inline form is gone. **"Adjust the plan" is a door** into the same sheet the +
opens (`app/log.tsx` §`adjustingPlan`): the same say / type / snap affordances, a header
that states plainly that this changes the plan rather than recording anything you did, and
a submission that goes straight to the coach's adjust endpoint with **append semantics
unchanged**. Nothing is analysed and nothing is confirmed — an adjustment is not a record.

The pair of chips under the plan was reworked with it, because half of their copy pointed
at a box that no longer exists. *Adjust* opens the logger; *Replace* stays where it is as
its own deliberate act — two taps, no words needed, and it says what it is about to do. The
empty-day generator lost its optional context box too: **"Start today's workout" takes no
words**, and what the coach should know about today is told through the + like everything
else.

A photo sent while adjusting takes the road it always took — saved against today as coach
context, which every later ask reads back. The coach's adjust endpoint has nowhere to put
an image, and pretending otherwise would have been the third input surface.

#### Everything else came off the page

- **The logs are behind doors.** Done and Eat are one line each — "569 kcal earned ·
  7:36a–8:35a · 8 moves", "480 eaten · 2,385 left" — and a tap opens the full grouped log
  (`app/today/training.tsx`, `app/today/eating.tsx`). The rows lost nothing in the move:
  the same grouping rule, the same two-tap delete, the same tap-to-correct, the same
  tappable names.
- **"The day so far" is gone.** "It is useless." No replacement — the Done line already
  says when the day happened.
- **The Body section and the 7-day weight card are gone.** Both live on Home. Neither moves
  over the course of a day, so neither is news on the working page.

#### One number, and it is the day's own

The Eat card printed **2,385 kcal left three times in three type sizes**, and then quoted a
coach paragraph underneath saying 2,100 and 200 g — figures from an earlier generation of
the brief. Two disagreeing calorie numbers on one card is worse than no number at all.

The compact row now carries exactly one figure and it is the day's own arithmetic; the
coach's eating guidance moved behind the door, a screen away from the number that counts.

Resulting Today, top to bottom: day header → goal → calories left → Right now → Do (the
plan, or Start) → Done → Eat → the +.

#### Verified

App **312 → 316** across **23 suites** (the row-level contracts moved to
`__tests__/today-logs.test.tsx` rather than being dropped; `coach.test.tsx` rewritten to the
door). New tests pin the things that must stay true: the adjust door opens the logger and
writes nothing by opening, the logger's plan mode posts to the coach and never to
`/api/log/analyze`, the arc / Body / weight card are absent, the doors navigate, and an
over-allowance day reads "over" rather than a negative amount left. `tsc` and `expo lint`
clean. Backend untouched — 672 unit tests green, typecheck clean.

### 2026-09-01 — one page for the open day, a landing page for the rest, and a correction that can split a record (`wp-one-today-and-correction-split`)

Four things, one branch. Three of them came out of the same complaint said three different
ways: **the app knows what it is doing and will not tell you where.**

#### A — one living page for the open day

There were two pages drawing today. The **Today** tab grouped training by auto-block (the
90-minute clustering), and **`/day/<today>`**, reachable from the Days list, grouped it by
muscle with a Cardio heading in front. The same session read two different ways depending on
which door you came through, and the user said so.

Today is now the only page for the open day.

- **`lib/training-groups.ts`** — the filing rule, once, for both pages. Cardio first with the
  day's cardio minutes; then the muscle summary's groups with their set counts; then "Also".
  **Every activity is drawn exactly once**: cardio never files under its muscle tags (it
  carries them to credit the body map, not to file a walk under "glutes"), and a lift that
  touches two muscles belongs to the first heading that claims it. Pure, and tested without a
  renderer — which heading a row lands under is a rule, and rules rot quietly inside
  components.
- **`components/activity-row.tsx`** — the logged-exercise row, which had been written twice
  and had already drifted apart.
- The **session's time span** ("7:36a–8:35a") is a note on the Training header. When a workout
  happened is a fact about it, not a way to file it.
- The **Days list** sends today's row to the Today tab, and **`/day/<today>` redirects** there
  rather than drawing a second, quieter copy of the day. `app/day/[date].tsx` is the archival
  reading of a closed day now; it still handles `is_today` defensively.

#### B — Home lands, Today is where the day happens

**Deliverable 3 changed direction mid-flight.** It began as a *Plan tab* — the coach page
given a tab of its own — and that was built, then held by the user in favour of something
better: the plan **merged into Today**, and a new **Home** tab for the days when nothing is
happening. The Plan-tab work is kept, unmerged, on the `shelf-plan-tab` branch.

The complaint behind both: *"if I want to quickly see what should I do, I have to go to the
home page, scroll down, find that orange button."* And the deeper problem the merge fixes:
the plan and the record of what you actually did were on two different screens, when they are
two halves of one day.

- **Tabs are now Home · Today · Days · Progress · You.** `app/(tabs)/index.tsx` is Home;
  Today moved to `/today`.
- **Home** — the goal and its progress, the 7-day weight and its trend, the week in two
  numbers (sessions against what you said you train; cardio in *equivalent* minutes — light
  ×½, moderate ×1, vigorous ×2 — against the weekly target), and one big button into Today.
  Light on purpose, and a dead end for everything but navigation.
- **Today** is Do / Done / Eat / Body. `components/plan-section.tsx` carries the whole coach
  page — the Why card, the Do list with its ticks, the added-later dividers, the finisher, the
  plan-complete card, Add / Replace, the nudge and the told adjustment — and
  `components/eat-guidance.tsx` carries its Eat card in beside the meals, where eating is.
  `/coach` is a redirect into `/today`; no dead routes.
- **The hard constraint held, and it mattered more after the move than before it.** Opening a
  tab generates nothing. Home reads `/api/coach/status` (an exists-check that cannot write);
  Today reads `/api/coach/next?generate=false`. **"Start today's workout" is the only
  generator in the app**, and the tests assert it on both pages — a tab is opened by accident,
  on the way to somewhere else, dozens of times a day.
- On a rest day nobody presses it, the Do section stays one card and a button, and meals,
  weigh-ins and everything else work exactly as they do on a training day. Tested.

#### C — a correction can replace one record with several

The field report: the user logged *"4 sets of 10 at 85, the last two sets I reduced to 70"*.
The **create** path splits that correctly (shipped in `fix-exercise-sheet-ux`). Told the same
story about the record that was **already saved**, the model had nowhere to put a second load
— so it wrote "2 sets at 85, 2 sets at 70" into the *description* and left `sets=4`,
`load=null`, while a separate 2×10@70 row still stood beside it, counting two sets nobody did.

A record carries ONE load. A load that changed partway through the sets is two records or it
is nothing, and nothing in the correction path could make two.

- **`revision_mode`** (`schema.ts` §ACTIVITY_REVISION_MODES) — an activities part is revised
  through its own schema now, answering `"amend"` or `"split"`. The field is **FIRST in the
  schema**, because structured output is decoded in field order: a mode declared after the
  items it governs would be chosen to fit items already written. One enum on a single-branch
  schema; the contract test proved the grammar still compiles.
- **The mode is honoured in one direction.** A `"split"` with no more items than went in is an
  amend; an `"amend"` with *more* items has its extras dropped — on this path the part may be
  a row that already exists, and inventing a second one is the failure being fixed.
- **`carryForward` carries the movement to every part of a split.** Without it a drop set
  loses its muscle groups, and both halves fall off the body map and out from under their own
  heading.
- **Fields, not prose.** The prompt says so, and the summing rule is the create path's, word
  for word: the parts add up to what was done, never a total plus a partial.
- **Descriptions stopped repeating the fields.** One row read `4 × 10 · 4 × 10 chest press
  machine: …` — the row drawing sets × reps from the fields and the description saying them
  again. The description now names the movement and adds only what the fields cannot carry.
- **Migration 0018** — `record_corrections.replaces_activity_id`. The original row is
  corrected **in place into the first part** and keeps its id, its evidence and its own
  history; the other parts are new rows that name what they came out of. `ON DELETE SET NULL`,
  not `CASCADE`: deleting the original must not delete what came out of it.
- **`POST /api/entries/movement/:id/split`** writes it in one transaction. Separate from the
  PATCH because a PATCH moves the fields of one row and this creates rows. The app sends a
  multi-item revision there instead of PATCHing `items[0]` and silently dropping the rest —
  which is exactly what it used to do, with no error and no warning.

#### D — saying what the app already knows

- **"Last 7 days"** over the coverage figures. The colours are a rolling seven-day count and
  the question people were left asking was whether it resets on a Monday.
- **`app/how-it-works.tsx`** — the workings, plainly, from a quiet row on You. Twelve short
  sections: the day as the session, the rolling coverage clock and the 10–20 sets band, the
  neglect ledger, the 48h recovery rule, progression (hold until proved twice, then one
  smallest step, reversed on assisted machines), gaps, cardio's equivalent minutes against the
  WHO's 150, what a load means on a bar / dumbbell / machine, MET estimates, the arithmetic
  check on meals, told corrections, and the coach answering only when asked. Content lives in
  `lib/how-it-works.ts`, so a new rule is a new entry rather than a new layout — and a test
  pins the figures, so the page cannot quietly stop being true.

#### Verified

- **Backend** 695 → 703, typecheck and lint clean. The one failure across a full run is the
  known-flaky meal-consistency contract case (the model intermittently returns `kcal: null`);
  it passes in isolation and was not weakened.
- **Fusion contract suite: 18/18 against the real API**, including the new correction-split
  case and an ordinary amend that must NOT split.
- **App** 279 → 312 (21 → 22 suites), `tsc` clean, `expo lint` clean but for one pre-existing unused import in
  `components/goal-banner.tsx`.

#### Deferred

- The **Plan tab** (`shelf-plan-tab`, commit 9e80c55) is kept unmerged. Nothing on the branch
  is wanted as it stands; it is there so the work is not lost.
- The split handles **one** record becoming several. Which of *two* originals a new part came
  out of is not a question positions can answer, and a guessed provenance is worse than none —
  so a many-to-many revision still records no history, as before.

### 2026-09-01 — a name you can tap, a picture you can see coming, and no empty gutter (`fix-exercise-sheet-ux`)

Four screenshots from a gym on one bar of cellular, and every one of them was about the
same line of the app: **the exercise name**. Some of them did nothing when you pressed
them. The ones that worked took three round trips and arrived as full-size photographs.
None of them said, before the tap, whether there was anything behind it. And down the left
of the plan ran fifty points of nothing.

#### A — no dead taps

`openExercise` always navigated; what did not was the *finisher*, whose rows had no
`onTitlePress` at all. They are stretches, so almost none of them resolved to a catalogue
row, and a row with nothing behind it had been left as a row you cannot press — which on a
phone reads as a broken app, not as an absence of data.

Every exercise name in the app is now a door: the coach's Do list **and its finisher**,
Today, Day, the DayLog, the six on Progress, the cardio rows, and the all-lifts screen.
Without an id it opens the sheet in **name-only mode**, where the form video is a YouTube
search and works for a movement nobody catalogued. Today's and Day's rows that never
resolved a movement open under their own description rather than not at all.

#### B — the catalogue knows nineteen stretches now

The deeper reason the finisher was dead: `exercise_catalog` had one mobility row called
**Stretching** and nothing a finisher is actually made of. `data/exercises.json` gains
**nineteen** — Chest, Triceps, Hip Flexor, Quad, Hamstring, Shoulder, Calf, Lat, Glute,
Neck, Groin, Upper Back, Biceps, Forearm, Side and IT Band stretches, Child's Pose,
Cat-Cow and World's Greatest — each named the way the coach writes it, each aliased both to
the phrasings a person uses ("doorway chest stretch", "couch stretch", "figure four") and
to the **free-exercise-db entry that has photographs of it** ("Chest And Front Of Shoulder
Stretch", "Kneeling Hip Flexor", "Lying Glute"). All nineteen match a photo-backed entry;
the catalogue's illustrated share went 99/129 → 118/148 with the same misses as before.

The qualifier-safe matcher did the rest unchanged, which is the point of it: "Doorway Chest
Stretch" resolves, "chest press" still does not resolve to a stretch, and `stretching`,
`hip mobility`, `bench press` and `assisted chin up` all still land exactly where they did.

**The import is not automatic on this deploy.** `import-exercise-media` short-circuits when
the media volume already has frames, so the new rows need one `--force` run on the host
after the release (in the deploy notes, and in the report).

#### B′ — a bench press with plates on it

The sheet for **Bench Press** showed an **empty bar**. The match was correct —
"Bench Press - Powerlifting" is a bench press — and the photographs were useless: the user
could not tell it was a barbell at all and went looking for what was wrong with his 135 lb
log. `PREFERRED_SOURCE_NAMES` in `services/exerciseMedia.ts` names
**"Barbell Bench Press - Medium Grip"** instead, which is the same movement with plates on
it. Explicit, like `AMBIGUOUS_SOURCE_NAMES` beside it and for the same reason: "prefer the
entry whose photographs are clearer" is not a rule a computer can apply. A preference the
dataset cannot honour is ignored rather than turned into a miss — a picture of the wrong
grip beats no picture at all.

Re-pointing a row is only half a fix if the old bytes stay on the volume, and they did: the
importer skips a frame that is already on disk, so the empty-bar photographs survived the
swap under the new slug. It now **re-downloads a frame whose source has moved**, and drops
every resized copy made from the bytes it replaces (`ExerciseMediaStore.clearVariants`) —
a `?w=640` cached from the old picture would otherwise be served beside the new original
for ever.

**And it asks the volume, not the column.** The first attempt at this compared
`exercise_catalog.source_slug` against the fresh match, which does not work and is worth
writing down: the column is written *after* the downloads, so a run that re-points a row and
skips its frames leaves the column saying the new thing about the old bytes — and the next
run then compares new against new and sees nothing to do. That state is unreachable by any
number of `--force` runs. The store records the slug beside the frames it describes
(`sourceOf` / `setSource`; `<id>/source.txt` in the local adapter, which is not a `.jpg` and
so counts as neither a picture nor a variant), and what is on the disk is what is believed.
A volume that has never recorded one re-downloads **once**, on the next `--force`, which is
how every volume from before this corrects itself.

#### C — the affordance, and no legend

Names with illustrations carry a small stroke `IconPhoto`, `dim`, beside the underline.
Names without carry nothing and stay tappable. There is no legend: a small picture beside a
word does not need one.

`media_count` is threaded from the row the server already stores, on the lookup that already
resolves the id — so it costs no extra query anywhere except the day, which pays one
`id = ANY(...)`. It reaches: `CatalogMatch`, the brief's exercises **and finisher**
(`withExerciseIds` resolves both now), `BoardLift`, `BoardCardioRow`, and `DayItemActivity`.
It is optional in the app's types, and unknown draws **no** glyph — the alternative is a
glyph that sometimes lies.

#### D — instant open

The count travels with the tap (`media` on the navigation params), so the sheet draws its
own skeleton on the first frame: two boxes for a bench press, **none** for a stretch. Two
grey rectangles that turn out to be nothing was a small lie the sheet had been telling.
`useExercise` was already `staleTime: Infinity` with a disk cache (`lib/exercise-cache.ts`),
and there is now a test that a prefetched row renders the finished sheet with **no skeleton
and no request at all**.

#### E — smaller bytes

`GET /api/exercises/:id/media/:n?w=` takes **320, 640 or 1280** — a closed list, because
every distinct width is a file on disk for ever. sharp resizes once, on the first request
that asks, and the result is filed **beside the original** in the media store
(`<id>/<n>@<w>.jpg`); every request after is a plain read of a smaller file. The app asks
for 640 for the sheet's photographs and leaves the full-screen zoom at full size, which is
the one place the pixels are the point.

- **Anything else in `w` is a 400.** A client asking for 640 and quietly getting four
  megabytes is the bug the parameter exists to fix, so it is refused loudly.
- **The width is in the ETag** (`"<id>-<n>-w640"`): two sizes of one frame are two
  documents, and an ETag that did not say which would let a cache answer a 640 with an
  original.
- **Everything about the variant is best-effort except the picture.** A store that cannot be
  written to costs the next reader a resize; bytes sharp will not decode fall back to the
  original. A frame is a photograph of a movement and is never worth a 500.
- The prefetch asks for the same 640. The width is in the URL, so a prefetch at any other
  size would warm a cache entry the sheet never reads — a download for nobody.

#### F — the prefetch did cover the plan, and now covers more of it

The report suggested the coach plan had been missed. It had not: `app/coach.tsx` has called
`usePrefetchExercises` since `wp-progress-you-rework`, and `app/(tabs)/progress.tsx` covers
the top six and the cardio rows. Both were verified and both are now tested by watching
`Image.prefetch`. What changed: the finisher is on the list too, the count is passed so a
name with **no** photographs costs no image request at all, and the photo is warmed at the
width the sheet will ask for.

#### G — the clock column belongs to lists that keep a clock

`Row` always drew a 50 pt gutter for the time stamp — on the coach's plan, its finisher and
the goal history, none of which have times in them. The contract is now `time !== undefined`
rather than a truthy `time`: a timed list whose row has no stamp passes `time={null}` and
keeps its column, so the times above and below stay in line; leaving the prop off is how a
list says it has no clock. Every current caller was audited; the timed lists (Today's and
Day's meals and activities) all pass a string.

#### H — a load per side is arithmetic, not a guess

`services/fusion/prompt.ts` gains the one number the reader is allowed to compute. On a
barbell lift the total is the plates **plus the 45 lb bar** ("45 on each side" benched is
135); on a plate-loaded machine, or whenever the user names a machine, it is the plates
alone, because machines have no bar; dumbbells are the per-dumbbell load. The working goes
in the description — *"45/side + 45 lb bar = 135 lb"* — so the number can be seen being
made, and when the kit is ambiguous it follows the user's own equipment words and drops to
`medium` confidence rather than asking a question.

And a **drop set is a split, not an addition**. *"4 sets of 10 at 85, the last two at 70"*
was being saved as a four-set item **plus** a two-set item — six sets for four that were
done — because an item carries one load and the reader had nowhere to put the second. A load
change mid-exercise now splits into items whose sets **sum** to what was said (2 × 10 at 85,
2 × 10 at 70), each saying which part it was, and never a total beside a partial.
`anthropic.fusion.contract.test.ts` pins it against the real model.

#### I — Day: one row per activity, and no macros for a day with no meals

Two field reports fixed in the same tree and shipped here (`app/day/[date].tsx`):

- **A treadmill walk was drawn twice**, under "calves" and under "glutes", because the
  muscle fan-out drew an activity under every heading it touched. Training now renders each
  activity exactly once: **Cardio** gets its own heading with the day's total minutes — its
  muscle tags credit the body map, they do not file a walk — a lift belongs to the first
  muscle heading that claims it, and anything left over goes under "Also".
- **A day with nothing eaten no longer prints "PROTEIN 0 g · CARBS 0 g · FAT 0 g."** It
  prints one line instead — hour-picked and playful on the live day (`nothingEatenYet`),
  plainly "Nothing eaten was logged." on a closed one — and the section's "0 kcal" summary
  is suppressed. The macros, the hints and the pattern all come back with the first meal.

**Tests** — **686 passing, 2 skipped** in `backend` (was 669/2); **279 passing** in the app
(was 255).

- `src/app.test.ts`: `media_count` on the day's rows, the board's rows and every line of
  the plan including the finisher; the resize round trip end to end (900 px original → 320
  px answer, the variant filed beside the original, the second request the same bytes, 1280
  handing back the original's 900 rather than an upscale); six bad widths, each a 400; and
  a frame whose bytes are not an image served as the original rather than as a 500.
- `src/services/images.test.ts` (+5): the width parser on every input shape, the resize and
  its no-enlargement rule, and the throw the route's fallback is built on.
- `src/adapters/storage/local.test.ts` (+4): a variant filed beside its original and not on
  top of it, idempotently; a width outside the list refused before it can name a file;
  `clearVariants` dropping every width of one frame while the original and the next frame's
  variants stay put; and the provenance note read back, absent from `usage`, and surviving
  a `clearVariants`.
- `src/services/exerciseMatch.test.ts` (+3): twenty-seven phrasings of the nineteen
  stretches resolving, nothing the catalogue already owned taken from it, and the guard
  still refusing a stretch as an answer to a movement.
- `src/scripts/import-exercise-media.test.ts` (+5, fixture +2): a `stretching` entry matched
  onto Chest Stretch through the alias that names it; the preferred source beating the
  derived-key hit the rules would take; the preference falling back to the rules when the
  dataset does not have the entry it names; a re-pointed row's frames replaced on disk with
  their 640 thrown away **while the column says otherwise**; a row whose entry has not moved
  left completely alone; and a volume with no recorded provenance re-fetching exactly once.
- `__tests__/exercise.test.tsx` (8 → 13): the skeleton count from the tap, none at all when
  the tap said none, the two-box fallback when nobody said, a prefetched sheet with no
  skeleton and no request, and 640 on the tiles against full size in the zoom.
- `__tests__/coach.test.tsx` (26 → 30), `lifts.test.tsx` (5 → 8), `progress.test.tsx`
  (30 → 32), `today.test.tsx` (21 → 23), `day.test.tsx` (+ the cardio and empty-Eating
  regressions), `delete-control.test.tsx` (5 → 8, the clock column).

**Decisions**

- **The widths live on the port**, not in the route: they bound the filenames a store can
  ever be asked to write, and a caller-chosen number would be a file on disk per number.
- **A variant is a cache, not a second object.** The original is the truth; deleting every
  variant would cost the next reader one resize and nothing else.
- **`media_count` is optional in the app's types.** An older phone against a newer server is
  the case that matters here, and "unknown" has to draw nothing rather than guess.
- **The stretches are seeded, not imported.** `data/exercises.json` is the catalogue's source
  of truth and `db:migrate` reseeds it on every container start, so this needed no migration.
- **A better photograph is a list, not a heuristic.** "Prefer the entry whose pictures are
  clearer" cannot be computed; `PREFERRED_SOURCE_NAMES` holds one entry and will hold the
  next one somebody reports.

**Deferred**

- **The DayLog's "How to do …" link carries no count**, so it draws no glyph and its sheet
  falls back to two skeletons. The day-log payload does not thread `media_count` yet.
- **`?w=` has no `webp`.** Half the bytes again for the same picture, and every client here
  is an `expo-image` that would take it — but it is a second variant per width on disk and
  a second thing to get wrong in the same release.
- **The all-lifts screen does not prefetch.** It is reached by a tap from a screen that
  already warmed the six that matter, and warming twenty sheets to save one is the wrong
  trade on a phone.
- **`anthropic.fusion.contract.test.ts` › "never returns a meal that is both internally
  inconsistent and confident" is still flaky against the live model**, exactly as
  `wp-progress-you-rework` recorded. Nothing in this branch touches fusion.

### 2026-08-31 — a body instead of a bar chart, and a page that says who you are (`wp-progress-you-rework`)

Five changes the user asked for after a week on the phone, and the same complaint under
four of them: the app knew things and said them in the wrong shape. Eleven horizontal bars
for eleven muscles. Twenty lift rows above the goals. A grid of label-and-value on the
screen whose first law is that there are no forms. A cardio target of 150 that nobody chose,
counting a sprint and a stroll as the same minute.

#### A — the coverage ledger, drawn on a body

The **sets-per-muscle bars and the "Overdue a turn · Calves · never · Core · 21 days" line
under them are gone**, replaced by a front-and-back figure with twelve tappable regions.
They were the same twelve numbers twice — one list sorted by volume, one by debt — in a
vocabulary that only reads if you already know the answer. "The whole back of you is grey"
is a sentence a picture writes in one look.

- **`react-native-body-highlighter` (MIT), and the evidence for it.** Its `package.json`
  declares one dependency, `react-native-svg ^15.9.0`, which this app already ships at
  15.12.1; the published build is CommonJS and there is no native module anywhere in it, so
  Expo Go and the new architecture both run it unchanged. That is the test the brief set, it
  passed, and the hand-drawn fallback was not needed.
- **The colour rule is ours** (`lib/body-map.ts`, pure and tested without a renderer). The
  ledger is the only input — never `frequency.muscles`, which is the catalogue's vocabulary
  and a different set of buckets, and a map that disagreed with the brief about what is
  overdue would be two answers to one question. Grey (`track`) is *nothing in four weeks*;
  above it a three-step accent ramp on the week's sets against the **10–20 band** — under
  it, in it, past it. A muscle trained ten days ago and not this week is the *faintest step*
  and not the grey, because grey means "I have never seen this" — and grey is
  `days_since == null` and nothing else, which the live read is what settled: a treadmill
  walk serves the calves and the glutes and records **no sets at all**, so a muscle can be
  `days_since: 0` with `sets_28d: 0`, and grey there would say "not in four weeks" about
  something done that morning.
- **Overdue regions carry a 1.2 px accent stroke** — the only thing that distinguishes
  "never trained" from "not trained this week" on a grey region — and a legend explains
  every colour, including the outline.
- **A tap answers with the week**: *"Biceps — 3 sets this week · last trained Tue · target
  10+/wk"*, in a small card under the figure, dismissed by tapping the same region again.
- The twelve map onto the package's slugs one-to-one except for two, and those two are a
  judgement worth reading the note for: it has **no `lats` slug at all**, so `lats` takes
  `upper-back` (the wing under the shoulder blades) and the ledger's `upper_back` takes
  `trapezius`. `stretching` stays on the ledger and off the map — it is a category, not a
  place on a body.
- `CoverageEntry` gained **`sets_7d`** so the ramp and the sheet read one number. The
  alternative was the app re-summing `frequency.muscles` over each entry's tokens, which
  would have put a second copy of `LEDGER_MUSCLES` on the phone.

#### B — six lifts, and a door to the rest (`app/lifts.tsx`)

The board is one row per exercise logged in four weeks. On an account that trains properly
that is twenty-odd rows sitting between the goals and everything else on the tab, and nobody
reached the bottom.

Progress keeps **six**, ranked the way the question is asked (`topLifts`): trained this
week, then the ones **held mid-progression** — a hold with an eta, so there is a specific
thing being waited for — then the ones **owed a baseline** (`new` or `reference`), then the
rest. **"All lifts (N) →"** pushes a screen grouped by primary muscle, freshest group first,
two lines a row (name · trend dot, then load · when) and **no advice line**: twenty "Hold
135 lb until 3 × 8 twice"s is a to-do list the user did not write (§Principles 8). Anything
untouched for a **fortnight** folds into *"Not trained lately"* at the end — the board's own
window is four weeks, so ">4 weeks" would be a group that can never hold a row, and a
fortnight is where `prescribeLoads` already decides a movement is a `restart`.

The tab's order is now **goals → snapshot strip → Lifts → Cardio → Coverage → Body**, with
the strip one line of the three numbers the sections below spell out — *"2 of 4 sessions
this week · 50 of 150 cardio min · −0.8 lb/wk"* — so the tab answers "where do I stand"
before anything is scrolled to. Every part of it is dropped when it is not known.

#### C — a minute of cardio is not a minute of cardio

150 min/week was the WHO's guideline standing in as though it were a plan, and every minute
counted the same whether it was a stroll or a set of intervals.

- **`services/coach/cardioIntensity.ts`** classifies deterministically — light ×0.5,
  moderate ×1, vigorous ×2 — from the catalogue's category and the activity's name, with
  **pace overriding when a distance was measured**: under 12 min/mi vigorous, 12–17.99
  moderate, 18 and over light. Bikes, ergs, ellipticals and swims are exempt from the pace
  rule and read by name, because a 4 min/mi cycling "pace" is not a sprint. A plain "walk",
  a "jog" and anything unrecognised are **moderate**, which is the honest default, and each
  answer carries its own `why`.
- **The week reads equivalent minutes**: *"50 of 150 · 20 brisk + 15 run×2"*, with the
  breakdown on a tap and *"Still short: 100 moderate min or 50 hard"* under it. `short_by_min`
  is now the shortfall in equivalent minutes, and `cardioNextMinutes` divides by the
  activity's own multiplier — so the brief and the board still quote one number, and a user
  who only ever walks sees exactly the arithmetic they saw yesterday.
- **`cardio_minutes_target` (migration `0016`)**, nullable, said out loud like every other
  plan field, extracted on the plan-fields call and **nowhere near the routing union** (the
  same assertion `session_minutes` carries). `target_source` is `goal` → `stated` →
  `default`, and the screen says which: *"Standard guideline — tell me yours"*. That is the
  `daily_calorie_target` lesson applied to the second number that had it.

#### D — the exercise sheet, instant and photographs-first

- **The "How to do it" steps are gone.** Four numbered paragraphs of dataset prose, sitting
  where the pictures should be, on the screen a person opens standing in a gym. Two
  photographs and a form video answer "how does this go" faster, and the video is a search,
  so it works for the movements the dataset never described.
- The two photos are **full width, stacked and tappable to zoom** (a `Modal`, the same one
  the Log sheet's lightbox uses — no new dependency). While the row is in flight they are
  two skeleton tiles of exactly that size, so nothing moves when the bytes land.
- **`lib/exercise-cache.ts`** writes catalogue rows to a file in the cache directory and
  reads them back into the query cache before the first screen mounts. `staleTime` and
  `gcTime` are both `Infinity`: what a bench press works cannot go stale. Hand-rolled rather
  than `@tanstack/react-query-persist-client` — persisting the whole cache would have meant
  three packages and would have restored the day, the coach and the goals from disk too, and
  a stale day is a *wrong* day. Every path in it is best-effort: no file system means no
  cache means the screen fetches, exactly as before.
- **`usePrefetchExercises`** warms the row and the first photograph for everything on the
  coach's plan and the six lifts, in an effect, sequentially, with every failure swallowed.

#### E — You is a dossier, not a form with the inputs taken out

"How you train" and "How you eat" were two cards of label-and-value — *Days a week · 4*,
*Diet style · —*, *Daily target · 2100* — on the screen whose first law is NO FORMS. And the
interesting half of a plan is the half nobody has said yet, which a row reading "—" asks for
about as persuasively as anything can.

`GET /api/you` returns two paragraphs (`services/readings/dossier.ts`, migration `0017`):
**what is known**, stated facts blended with what four weeks of logs actually show, and
**what is missing**, every sentence an invitation with the benefit attached — *"Tell me how
long a session usually runs and I can size each plan to fit it"*, never *"you have not told
me"*. Page order: dossier → Constraints → Health sync → Account → one **Tell me**.

The sheet the model is given labels every number with where it came from, which is the one
thing the day sheet does not have to do: a day's calories are measured, but a plan is half
things the user said and half things the app assumed, and a paragraph that hands a default
back as a statement is the `daily_calorie_target` bug in prose.

**Decisions**

- **A dossier is not a day reading.** `profile_readings` is keyed `(user_id, kind)`;
  keying it by date would regenerate it at every local midnight, for ever, to say the same
  thing about a profile nobody touched.
- **It is not a field on `GET /api/profile`.** The profile is invalidated after every
  confirmed log, so a generated paragraph living there would be a model call per meal. `you`
  joined `invalidateAfterLog` instead: the read is cheap and the server decides whether the
  paragraph actually changed.
- **`PROMPT_FINGERPRINT` now covers all three prompts**, `9bbc420b` → `ea19e0af`. One
  fingerprint rather than three is deliberately blunt: every cached *day* reading is
  rewritten once, on its next read, and the alternative is three things to get wrong instead
  of one. (A literal NUL byte inside the old fingerprint template — which is why `grep` had
  been treating `readings/prompt.ts` as binary — went with it.)
- **The board's cardio fields hang off `cardio` and are all additive.** `short_by_min` is
  the one whose *meaning* moved, and for a week of moderate work it is the same number it
  always was.
- **The lifts board narrows on Progress and nowhere else.** `GET /api/training/board` still
  returns every row; the six are the app's choice, so an older phone is unaffected and the
  ranking can change without a deploy.
- **Two new dependencies**, both with a reason: `react-native-body-highlighter` (MIT) for
  the figure — see the evidence above — and `expo-file-system`, which was already in the
  tree transitively and is now declared, because a module this app imports directly should
  be a dependency it names.
- Two migrations, `0016` and `0017`.

**Tests** — 669 passing, 2 skipped in `backend` (was 623/2); **255 passing in the app** (was
224).

- `src/services/coach/cardioIntensity.test.ts` (new): every rule in the table, the pace
  override in both directions, the machine exemption, the unrecognised default, the
  equivalent arithmetic, `equivalentText` in all three multiplier shapes and the
  alternatives line.
- `src/services/coach/features.test.ts`, `rules.test.ts`, `training/board.test.ts`: a mixed
  week's equivalent minutes, the shortfall in them, the three target sources and their
  precedence, the next step divided by the activity's own multiplier with the cap and the
  floor still holding — and the six-history agreement between `buildBoard` and `buildRules`
  still passing, which is the test that design exists for.
- `src/services/fusion/fusion.test.ts`: the new plan field's bounds and default, and its
  absence from the routing union.
- `src/services/readings/readings.test.ts`: the dossier schema inside the 1,500-byte
  budget, the new pinned fingerprint, the two-paragraph / no-list / invitation rules as
  strings, and the sheet carrying the stated facts and the observed patterns and no ids.
- `src/app.test.ts`: `GET /api/you` generating once and then costing **zero** further port
  calls, regenerating when the profile moves, 401ing unauthenticated, and returning the
  stale row when the provider fails; the cardio wire shape for a mixed week; and *"I want
  200 minutes of cardio a week"* reaching the column through analyze → confirm with
  `stated_at` set and the board then reading `target_source: "stated"`.
- `anthropic.readings.contract.test.ts`: the dossier against the **real model**, asserting
  two paragraphs, no bullet characters, no obligation phrasings, and a second paragraph that
  reads as an invitation. Four for four.
- `__tests__/body-map.test.ts` (new, 11) and `__tests__/lifts.test.tsx` (new, 5): the ramp
  at every boundary, the slug map with no region claiming another's path, the detail line,
  the overdue sort with "never" always first — and the grouped screen with its fortnight
  fold, its trend dots and the absent advice line.
- `__tests__/progress.test.tsx` (23 → 30): the figure coloured from the ledger front and
  back with the legend, the tap and its sheet, the overdue line, the bars and the old text
  list both **absent**; equivalent minutes with the provenance and the breakdown on a tap;
  the top six with "All lifts (9) · 3 more" and the push it does; and the snapshot strip.
- `__tests__/progress-sections.test.ts` (23 → 29), `you.test.tsx` (7 → 5, four of them new),
  `exercise.test.tsx` (6 → 8) and `safe-area.test.tsx` (nine screens → ten).

**Deferred**

- **A cardio row's intensity is not correctable by hand.** It is inferred, it says why, and
  the way to change it is to say what the session actually was — which is how everything
  else on this app is corrected.
- **The dossier has no "why do you say that".** Every fact in it is on a sheet the server
  built, but nothing links a sentence back to the row it came from.
- **The body map is one figure, not a history.** It is this week against the band; how a
  muscle's volume moved over the month is a chart nobody has asked for yet.
- **`anthropic.fusion.contract.test.ts` › "never returns a meal that is both internally
  inconsistent and confident" is flaky against the live model, and it was before this
  branch.** The model intermittently returns `kcal: null` for that lunch — which the schema
  permits and best-effort logging is built for — and the assertion is `> 0`. Measured: it
  failed 3 of 5 runs on this branch and 1 of 4 on `98c0f73` with the branch's changes
  nowhere in the tree. Left alone rather than weakened, because loosening another work
  package's contract assertion to make this merge green is the wrong trade. Everything else
  is green.

### 2026-08-31 — a button that knows, and a page that stops answering unasked (`fix-plan-aware-button`)

Two complaints, one root. Today's accent pill said **"What should I do today?"** to somebody
who had asked at seven and had a plan with two of four items already ticked; and the only
way to find out whether there *was* a plan was to ask for one, because `GET /api/coach/next`
generated the day's brief when there was not one. So the button could not know, and opening
the Coach screen was itself the act that wrote the day's advice — a schedule with extra
steps, which is the one thing concept-v2 §Principles 5 says the coach is not.

#### A — two read-only doors, and neither can reach the model

`GET /api/coach/status?tz=` is new: `{ date, has_plan, headline, done_count, total_count,
complete }`, and that is all of it. `GET /api/coach/next` takes `generate=false`, reads the
standing brief and answers **`brief: null`** when there is none.

The guarantee is structural rather than careful. `briefStatus()` and `standingBrief()` in
`services/coach/coach.ts` **do not take a `CoachPort`** — there is no flag to get wrong and
no branch to fall through, because there is nothing in scope to generate with. The status
route does not run the day close either: closing a day writes a reading, and drawing a
button is not a reason to write anything.

The count comes from `completionOf`, the same matcher the ticks on the Coach screen come
from, over the same day view — so the button and the page cannot disagree about how far
through the plan you are. `briefStatus` is deliberately the cheaper of the two: one brief
row, one name lookup and `computeDay`, rather than the features, the goals and the whole
rule set that `standingBrief` needs.

#### B — the button says which day it is standing in

- **No plan** — *"What should I do today?"*, exactly as before, and the tap opens the Coach
  screen, which asks on demand.
- **A plan** — **"Today's plan"** with the count underneath: *"4 moves"*, *"2 of 4 done"*,
  or **"Plan complete ✓"**. A rest day (a plan with nothing to tick) carries no count. The
  tap only opens the page; nothing on Today generates anything, ever.
- **A status that has not arrived** reads as the question. It is the half of the pair that
  promises nothing that might not be there, and the tap does the same thing either way.

#### C — the Coach page asks for a tap

With `brief: null` the screen draws one card and one button — *What should I do today?* —
and that button is the only thing on the page that can make the first brief of the day.
Anything typed into the box before pressing it goes as `context`, as it always did.

#### D — three ways to change a plan, two of them explicit

Under the Do list, where the plan is:

- **"Add to today's plan"** — the append path, surfaced. Everything above it stays.
- **"Replace today's plan"** — outlined in accent, and armed rather than fired: the first
  tap changes it to **"Replace? This clears today's plan"** and says *"Everything above
  goes, ticks included"*; the second does it. Pressing anything else disarms it.
- **The box** sends no mode at all. Only the model has read the sentence, so it still
  decides — but its **tie-break flipped to append**. It used to be rewrite, reasoning that a
  rewrite is always a complete answer; that is true and it was the wrong thing to optimise.
  Now that Replace exists as its own button behind its own confirmation, an ambiguous line
  typed into the box has a cheap way to be wrong (two movements too many, under the plan)
  and an expensive one (the plan gone).

`BriefRevision.mode` carries the button's choice to the prompt — *"THE USER PRESSED 'Add to
today's plan'. THIS IS AN APPEND and the decision is already made"* — and is **enforced in
`askUsable`**, which merges by `revision.mode ?? answer.revision_mode`. A promise the model
can overrule by answering "rewrite" is not a promise, and this is the same file that already
learnt that a rule living only in a prompt is a suggestion. `assertUsableRevision` now takes
the effective mode too, so an answer is checked against the rule the merge will actually use.

**And the box's empty state stopped being a silent regenerate.** *Ask again* with nothing
typed used to POST a plain regenerate — the least explicit control on the page, replacing
the plan without saying so. It is *Adjust it*, disabled until there are words in the box.

**Decisions**

- **`generate` defaults to TRUE on the route.** An app built before this field existed asks
  the question it always asked and gets the answer it always got; only the new app sends
  `generate=false`. The opposite default would have turned every phone still on the previous
  build into one that never generates a brief at all.
- **`brief` became nullable rather than the route 404ing or inventing an empty brief.** "No
  plan yet" is a state the screen draws, not an error it recovers from — and an empty brief
  would have been a lie the app then had to detect.
- **The status endpoint is not `/api/coach/next` with a flag.** Two callers with two
  budgets: Today draws on every open and wants six fields, the Coach screen opens rarely and
  wants everything. Folding them together would have made the cheap call pay for the
  expensive one's inputs.
- **`done_count` counts done lines, not sets.** It is the same number the group heading
  prints; a second arithmetic for the same sentence is a second answer.
- **The confirmation is a second tap, not a modal.** Every other destructive control in this
  app arms and waits (`DELETE_ARM_MS`, the row's ✕), and a plan is not more dangerous than a
  logged meal.
- No new dependencies. No migration. No model-facing schema changed — `revision_mode` is the
  same field it was; the mode is decided before the call rather than by it.

**Tests** — 623 passing, 2 skipped in `backend` (was 613/2); 224 passing in the app (was 209).

- `src/app.test.ts` (+10): the status payload with no plan and the page load's `brief: null`,
  both asserting **zero `CoachPort` calls** and zero rows written; the count moving 0 → 1 → 2
  and `complete` turning true across two logged lifts, still with the coach asked nothing;
  the page load serving the standing plan *with* its ticks, its `nutrition_now` and
  `stale: true`; an app that sends no `generate` at all still generating; a bad tz and an
  unauthenticated status read; and the two forced modes — an Add that appends over a model
  answering `"rewrite"` (and is refused when it adds nothing, checked against the merge's
  rule rather than the label), a confirmed Replace that rewrites over a model answering
  `"append"`, the box leaving the mode to the model, and an unknown mode rejected. The
  prompt assertions cover all three: `THIS IS AN APPEND`, `THIS IS A REWRITE`, and the box's
  *"it is an APPEND"* tie-break.
- `anthropic.coach.contract.test.ts` — **the flipped tie-break cost a contract run to get
  right, which is the second time this field has.** With the first wording — *"its default is
  an ADDITION"* — the live model read **"give me 7-8 workouts"** as an append, and it is not:
  a count for the whole session is a statement about what today IS. The default stands, and
  the block now names the shape that is not covered by it (a number, a length or an intensity
  describing the WHOLE session) before falling through to append. The three existing revision
  cases pass unchanged against the live model, which is what they are for.
- `__tests__/today.test.tsx` (+6): the two labels and the sub-line in all four states
  (`4 moves`, `2 of 4 done`, `Plan complete ✓`, and none on a rest day); the button reading
  `/api/coach/status` and neither of the two endpoints that generate; the fall back to the
  question when the status read fails; and the tap that only navigates.
- `__tests__/coach.test.tsx` (+9): the page load carrying `generate: false`; the ask card
  over a null brief with nothing POSTed until it is pressed, and the typed line going as
  `context`; no ask button while the read is in flight; Add sending `mode: "append"` with and
  without a typed line; Replace refusing the first tap, committing on the second, and
  disarming when anything else is pressed; and the empty box no longer able to regenerate.

**Deferred**

- **The status is not pushed.** A plan finished on another device shows up on the next open
  or pull-to-refresh. A socket for a six-field read is not worth its reconnect logic.
- **`headline` is carried and not drawn on the button.** "Today's plan" reads better at pill
  width than a truncated *"Pull day: back and shoul…"*, and the headline is the first thing
  on the next screen. The field is there for a caller that wants it.
- **Nothing undoes a Replace.** The old brief is still in `coach_briefs` — every distinct
  answer is a row — so restoring one is a read away, but there is no screen for it and the
  confirmation is the guard for now.

### 2026-08-31 — a treadmill between two barbells, and three charts of nothing (`fix-board-split`)

Three screenshots from the phone, all of them the same mistake in different clothes: a
screen drawing a shape it had no numbers for.

#### A — Lifts and Cardio are two sections (`services/training/board.ts`)

**"Incline Treadmill Walk · 20 min next"** was a row in the **Lifts** section, between two
barbell rows. The placement is the smaller half of it. The larger half is that "20 min next"
is not a next step at all — it is last time, repeated, because `prescribeLoads`' cardio
branch reports `last.duration_min` and says so in its own `why`: *cardio volume follows the
week, not the session.* That is a true sentence about a number that had no business being
called "next".

So the board splits, **by the activity's own category**:

- **`lifts`** keeps its field name and its shape, and now holds strength only. An assisted
  machine is still a lift (it has a load, and less help is progress); "other" and an
  uncategorised row with a load are lifts too.
- **`cardio.activities`** is the new array — one row per cardio activity, carrying the last
  session's `duration_min`, its `distance_mi` and `pace_min_mi` when anybody measured them,
  the fastest pace in the window, a trend series and a `summary_text` of *"20 min · 1.2 mi ·
  16.7 min/mi"*. It is **not** a `BoardLift` with the pounds left blank: there is no load, set
  or rep on the type, so nothing on a cardio row can print "lb" by accident.
- **Mobility goes in neither.** A stretch has no load to progress and no weekly target to
  chase. What it has is a place on the coverage ledger, which already says how long it has
  been.
- An **uncategorised** row is read by its shape — minutes with no sets and no load is
  cardio, the same honest guess `isCardio` already makes for the weekly bars.

**The next step is the week, not the session.** `cardioNextMinutes(shortByMin, lastMinutes)`
is new in `services/coach/rules.ts` and both callers use it: the brief's cardio line and the
board's row. The shortfall against the plan's weekly target, capped at **+10 % on this
activity's own last session**, floored at ten minutes. The field row now reads **"22 min
next"** (20 min logged, 130 short of 150); a week already at its target reads **"Hold 20
min"**.

#### B — the Progress tab, in two sections

**Lifts** and **Cardio**, each with its own units. A cardio row draws minutes, miles and a
pace and never a pound; its sparkline is minutes. The delta line judges **pace only** —
"1 min/mi faster" is green — and reports minutes without a verdict, because a shorter walk on
a Tuesday is not a step backwards: cardio volume is a weekly quantity and the weekly bars
above are where a short week is actually said.

**Cardio is hidden entirely** when there is nothing in it and nobody asked for any: a section
of zeroes on the screen of somebody who lifts and does not run is the app inventing a
shortfall. When a *goal* named the weekly minutes (`cardio.target_stated`) and nothing has
been logged, it says so in one quiet line instead.

#### C — one weigh-in is not a flat line (`lib/progress-sections.ts`)

A goal with a single weigh-in drew **110 px of empty box** with a dashed target across it and
**"No movement yet"** underneath. Nothing had moved because nothing *can* move with one
point, and the sentence blamed the user for arithmetic.

- Under two readings the chart is `sparse`: a **44 px strip**, the dot against its target, no
  room reserved for a projection that cannot be drawn. `TrendLine` now marks a series of one
  finite value with a dot — a path with a single moveto draws nothing.
- **"No movement yet" is replaced by what was measured and what to do**: *"One weigh-in so
  far (212.0 lb · Mon, Aug 31). Weigh in a few mornings and your trend appears."* The nouns
  come from the measure — weigh-ins for `body_weight`, sessions for a lift, runs for a pace,
  days for the eating measures, readings for the Health ones.
- With **no readings at all**: no chart, and *"Log a weigh-in to start the line."*

#### D — a bar with no target is not a bar (`app/day/[date].tsx`)

After the profile was wiped, the Eating card drew three full-width **empty grooves**: grams ÷
a target nobody set is a zero-width fill, and an empty bar reads as *nothing eaten* rather
than as *nothing set*. A macro with no target now draws **no track at all** — the label and
the grams, which are measured — and the group carries one quiet line: *"No targets set — tell
me your protein and carb aims and these become bars."* Mixed is normal and reads as *"No
target for carbs and fat — …"*, with protein keeping its bar.

**Decisions**

- **The new array hangs off `cardio` rather than replacing it.** `board.cardio` was already
  an object with the weekly bars in it, and turning that key into an array would be a red
  screen on every phone still on the previous build (`docs/agent-brief.md`: keep response
  shapes stable for screens already built). `lifts` narrowing to strength is safe the other
  way round — an older app simply draws one row fewer, which *is* the fix. `activities` and
  `target_stated` are optional on the app's type for one release: an older server not sending
  them is not the same as sending an empty list.
- **The board rounds its cardio step to the minute; the brief still rounds to five.** A
  session plan is written in fives; a row about one treadmill is not, and "22 min next"
  rounded to 20 is the progression quietly not happening. Both numbers come out of the same
  function, so they cannot disagree about the rate.
- **`prescribeLoads` is unchanged** and still emits its cardio prescription for the coach.
  The board no longer reads it: a description of what happened is not a next step.
- **The zero-reading line is only the action.** The standing line two rows up already says
  "Nothing measured yet"; saying it twice on one card is the empty-bar problem in words.
- No new dependencies. No migration. No model-facing schema changed.

**Tests** — 613 passing, 2 skipped in `backend` (was 600/2); 209 passing in the app (was 195).

- `src/services/training/board.test.ts` (+12): the mixed fixture split — assisted chin-ups
  and bench in `lifts`, a walk and a run in `cardio.activities`, yoga in neither and on the
  ledger; an uncategorised row read by its shape, with a load ruling it out; a row's minutes,
  distance, pace and `summary_text` with no "lb" in it, and the same row with no distance at
  all; pace judged and minutes not; the +10 % step (`22 min next`), the hold, the cap at the
  shortfall, the ten-minute floor, the half-hour start for a row nothing has timed; and the
  board's step against `buildRules`' own cardio line.
- `src/app.test.ts` (+1, one amended): the run out of `lifts` and into `cardio.activities`
  over the wire, with its 33-minute step and `target_stated: false`.
- `__tests__/progress.test.tsx` (+8): the cardio row drawn in its own card, out of the lifts,
  with "22 min next" and no pound anywhere in it; the section hidden on an account with no
  cardio and no cardio goal; the quiet line when a goal asked; the one-weigh-in card on a
  44 px strip with its explanatory line; the no-reading card with no chart; and two readings
  unchanged at 110 px.
- `__tests__/progress-sections.test.ts` (+4): the sparse chart and its `projection` of nulls;
  the wording per measure; the no-reading line; and the two-point card untouched.
- `__tests__/day.test.tsx` (+3): the bar when a target exists, no track and one hint line when
  none does, and the mixed case naming carbs and fat.

**Deferred**

- **Cardio rows have no eta.** A lift's hold can say "~1–2 wks" because the sessions to go are
  countable; cardio's horizon is the week itself, which the bars already draw.
- **`best_pace_min_mi` is carried and not yet drawn.** The section's own "best" line covers
  the account; a per-row personal best is a design question, not a bug.
- **Nothing reconciles a walk logged as "strength".** The split trusts the category on the
  row; a miscategorised activity is a correction, and corrections have a home now.

### 2026-08-31 — 398 g of carbohydrate, and a correction nobody kept (`wp-meal-accuracy`)

Photographed and spoken into the Log sheet: tuna, two eggs, a quarter of an onion, one
chilli, two cups of vegetables, two tablespoons of olive oil and **"four slices of this
bread"**, with photos of the bread bag's nutrition label and the tuna can's. It came back

    918 kcal · 67 g protein · 398 g carbs · 35 g fat        — HIGH confidence

4 × 67 + 4 × 398 + 9 × 35 ≈ **2,175 kcal**, which is not 918 by a factor of two. The 398 is
the label's whole-loaf figure taken for four slices of it, and the reading contradicted
itself in the same four numbers it was asserting with confidence. The user corrected it by
telling — "the carbs look wrong" → 89 — and **that correction appeared nowhere**: the record
showed 89 as if it had always said so.

Three things, and the third is the one with a migration under it.

#### A — the arithmetic gate

`services/fusion/arithmetic.ts` is one pure module, applied to **every meal this analyzer
produces** — the routed part and a segment, at analyze and at revise:

    implied = 4·protein + 4·carbs + 9·fat        against the kcal stated beside them

- **Generous on purpose:** ±25 % or ±150 kcal, whichever is *larger*. The Atwater factors
  are round numbers, fibre yields about 2 kcal/g rather than 4 (so `implied` runs high on a
  high-fibre plate), alcohol yields 7 and is in none of the three (so it runs low on a night
  out), and a portion estimate is an estimate. This is not a nutritionist; it is looking for
  the reading that is wrong by a *factor*, and 918 against 2,175 clears any honest tolerance
  several times over. A difference exactly **at** the tolerance passes — a gate that fires on
  its own boundary is one nobody can reason about.
- **A missing macro is not a zero.** All three or nothing is checked: failing a plate whose
  fat figure nobody read would be the gate inventing a disagreement out of a blank.
- **On failure, one automatic re-ask** — the meal detail call again, same message, same
  schema, with the discrepancy spelled out in numbers (*"your macros imply about 2,175 kcal
  but you said 918"*) and the hypothesis named, because "these do not add up" with no
  hypothesis is an instruction to guess again rather than to check something. On the routed
  path this re-ask is the meal detail call that path otherwise never makes.
- **If it still does not add up, the meal is presented ANYWAY and the confidence is forced to
  `low`**, whatever the model claimed. Refusing to log what somebody ate is the failure
  "always log" exists to prevent; what we can honestly stop doing is calling it certain. A
  re-ask that throws, or that escapes the check by quietly dropping the macros, is flagged
  the same way — nothing left to check is not the same as checked and fine.
- **`consistency` is a new PUBLIC field on the meal branch** — `{ outcome: "adjusted" |
  "flagged", stated_kcal, implied_kcal }`, null when the first reading was fine, which is
  nearly always. Derived, never asked for, so **no model-facing schema pays a byte for it**
  and the grammar ceiling is untouched. It is stripped from `compactPart`, so a revision
  never shows the model our verdict on its last answer instead of its answer.

#### B — what a photo is evidence *about*

Three rules, in the routing prompt's `EVIDENCE` block and again on the meal's own detail
call. Prompt text only: no field, no schema change, no grammar spent.

- **A photo never adds an item.** It is evidence about something the user already mentioned
  — a label, a packet, a machine in frame is there to *price* what they said. Something a
  photo shows is added only when nothing they said matches it at all.
- **A nutrition label is a PER-SERVING table.** Stated quantity × the per-serving row. The
  per-container column is what the whole packet holds and nobody ate the packet unless they
  said so. A loaf's carbohydrate total is not four slices of bread.
- **Confidence is the weakest link, and the weakest link is the numbers.** Recognising the
  food is the easy half and it does not make the portion, the serving count or the macros
  "high".

The meal detail call also carries the arithmetic as a *cheap* rule — *multiply before you
answer; if 4P+4C+9F is not within about a quarter of your kcal, one of the four is wrong and
it is nearly always a serving size* — so the common case never needs the second call. The
gate still runs regardless, because a rule that lives only in a prompt is a suggestion.

#### C — correction history (`0015_corrections.sql`)

`record_corrections`: one row per told change, per record it changed — the user's own
instruction and the field-level diff, with exactly one owner (`activity_id` / `meal_id` /
`weight_id`), `ON DELETE CASCADE` throughout. Both ways a correction can be made write
through `services/corrections.ts`:

- **A pending preview**, corrected before it was ever saved. The diff is computed by the
  server during `POST /api/log/analyze`'s revise — the only place both sides exist — and
  returned as `corrections: [{ part, item, instruction, changes }]`. The app relays it back
  on the confirm, which writes it **inside the same transaction** as the rows it points at:
  a correction whose record failed to save is not a correction that happened. The client
  relays rather than computes, because a client that could write its own history could write
  one that never happened.
- **A saved row**, corrected in place. `PATCH /api/entries/:kind/:id` and `PATCH
  /api/weight/:id` take `correction_instruction` — not a column, the sentence behind the
  change — and the service diffs the row **before against after** itself.

`GET /api/day/:date/log` carries each entry's `corrections`, oldest first, from one query per
day. The record view's provenance list — built to take appended entries — now reads:

> **How this was recorded**
> You said: "…four slices of this bread"  [two photos]
> Corrected 1:45p: "the carbs look wrong" · carbs 398 → 89

#### D — and the chip says why

The chip already read **"Low confidence — check me"**. What was missing was the reason, and
it is a reason the user cannot see because it is a multiplication nothing on the card
performs. A flagged meal now carries one line under the plate: *"The numbers didn't add up —
918 kcal against 2,175 from the macros; flagged, not adjusted."* An adjusted one says it was
read again and put right. A meal that added up first time draws nothing at all.

**Decisions**

- **The gate is deterministic and it is in code.** The prompt asks the model to multiply;
  the code checks. The whole field report is a model that had already decided it was sure.
- **Present, never refuse.** The gate downgrades confidence; it never blocks a save.
- **An activities part's items are diffed and filed separately** — each item is its own
  `activities` row and its own line in the log, so each correction points at the row it is
  actually about. A revision that changed how many exercises there are is not a field-level
  correction and returns no diff rather than a fictional one.
- **A correction that moved nothing is not written.** "Make it 880" said at a meal that is
  already 880 is not history, and an empty changes row under a record reads as a change the
  user cannot see.
- **`confidence` is not a correctable field.** It moves on every revision by design (the user
  is the authority), and "confidence: medium → high" under every correction is noise on top of
  the one line anybody wanted.
- **Goals and statements keep no history here.** A goal's spec IS its record and it is edited
  on its own screen; a statement lives in an array on the profile. The confirm files a
  correction by the part's own *kind*, never by whichever id it happens to carry — a goal
  part carries the weigh-in its stated facts produced, and correcting the goal is not
  correcting that weight.
- **`corrections` is optional on the app's `DayLogEntry`.** One release of compatibility: an
  older server simply does not send it, which is not the same as sending an empty list.
- No new dependencies. One migration.

**Tests** — 600 passing, 2 skipped in `backend` (was 563/2, with the key set so the contract
tests run); 195 passing in the app (was 185).

- `src/services/fusion/arithmetic.test.ts` (new, 10): the Atwater sum and its null when a
  macro is missing; the tolerance as the larger of 25 % and 150 kcal; the **918/398 field
  case as a fixture**, with its implied 2,175 and its 230-kcal tolerance; a reading exactly
  at the tolerance passing and one calorie past it failing; the alcohol shape failing in the
  other direction while a beer on a small plate stays inside the floor; nothing checked when
  there is nothing to check; and the discrepancy line naming both numbers.
- `src/services/corrections.test.ts` (new, 9): the diff of the field case; a cleared field as
  a change to null; arrays compared structurally and `45` against NUMERIC's `45.0`; a field
  the patch never named ignored; an activities part's items kept apart with their indexes; no
  fictional diff when the shape changed under it; and silence on a goal, a statement and a
  question.
- `src/services/fusion/fusion.test.ts` (+10): a meal that adds up costing no second call; the
  **one** re-ask with 2,175 and 918 in its prompt and the model's own answer beside them (and
  our verdict NOT beside them), keeping the reconciled numbers as `adjusted`; the re-ask that
  fails, the re-ask that throws and the re-ask that drops the macros all landing on
  `flagged` + forced `low` with the meal still saveable; the gate on a meal that arrived as a
  second part; the gate at revise; and the three photo-binding rules present on the router and
  on the meal call and absent from the activities call.
- `src/app.test.ts` (+6): the field case end to end — revise → `corrections` on the wire →
  confirm → the correction on `GET /api/day/:date/log`, written against the meal and nothing
  else; a saved row PATCHed with `correction_instruction` and the server's own diff appended
  chronologically; an instruction that moved nothing writing no row; a corrected weigh-in and
  a corrected lift each filed against their own record; the history cascading away with a
  deleted meal; and a correction for a part that is no longer being saved dropped rather than
  filed elsewhere.
- `anthropic.fusion.contract.test.ts` (+2, **all fifteen run here against the real model,
  fifteen for fifteen**): the field transcript, asserting the honesty guarantee rather than a
  number — whatever comes back either adds up or says it does not and is not called high; and
  a **generated nutrition label** (15 g of carbohydrate a slice, 300 g a package) with "I ate
  four slices of this bread", asserting the answer is priced per serving, that the label added
  no item of its own, and that the photo belongs to the meal.
- `__tests__/log-correction.test.tsx` (+4): both corrections drawn in the provenance list under
  the words and the photos, oldest first, with `carbs 398 → 89` and no column name printed at
  anybody; nothing drawn for an uncorrected record; a server that has never heard of
  corrections; and the PATCH carrying `correction_instruction`.
- `__tests__/log.test.tsx` (+3): two told changes on one pending preview relayed to the confirm
  in order; nothing sent for a log nobody corrected; and a dropped part taking its history with
  it rather than sliding onto the part beside it.
- `__tests__/confirm-card.test.tsx` (+3): the flagged line with both figures beside the
  forced-low chip, the adjusted line, and nothing at all for the meal that added up.

**Deferred**

- **The gate only knows meals.** An activity's kcal has no arithmetic to check it against —
  the MET estimate is already ours (`fix-strength-kcal`) — and a weigh-in is one number.
- **`meal_items` are not checked against the meal.** The parts could be summed and compared
  with the total, which would catch a different bug (a plate whose items do not add to it).
  The field case is the totals contradicting themselves, and one gate that fires is worth
  more than two that argue.
- **One re-ask, never two.** A model that cannot reconcile it in one look is not going to on
  the third, and the honest answer is a low confidence rather than a third round trip on the
  hot path.
- **A correction cannot be undone.** It is a record of what happened, and un-correcting is a
  new correction — which the log will show, because that is also what happened.
- **Nothing surfaces corrections outside the record view.** The Day screen and the DayLog list
  show the row as it now stands; the history is one tap away, where the row is.

### 2026-08-31 — the brief is a plan, not a verdict (`wp-coach-living-plan`)

Photographed mid-workout: the user asked the coach at eleven, having lifted at eight, and
the morning's plan was replaced by **"Rest today · 0 MOVES"**. Everything below follows from
the one sentence the user wrote about it — *the day's brief is a PLAN, never a verdict* —
plus the programming the plan needs to be worth keeping open all day.

#### A — the plan, ticked off

- **Completion is computed at read time and stored nowhere.** `services/coach/completion.ts`
  matches each prescribed line against the day's logged activities — `exercise_id` when both
  sides have one, otherwise a **qualifier-safe name match** — and returns
  `{ done, sets_done, sets_prescribed, partial }`. `withLiveState` in `services/coach/coach.ts`
  attaches it on the way out of `nextBrief`, so both the GET and the POST carry it. Nothing
  is written to `coach_briefs`, and a test asserts the stored jsonb has no `completion` in
  it: the brief is what the coach *said*, and whether the pulldown has since been done is a
  question only the log can answer — one that changes again when a row is corrected or
  deleted.
- **The matcher is the log's own rule, pointed the other way.** `sameMovement` compares
  normalised, singularised, *sorted* token sets (so "bench press with dumbbells" and
  "dumbbell bench press" are one movement) and then refuses any pair whose qualifiers
  differ. A plain **Chin-Up** in the log does not tick an **Assisted Chin-Up** off the plan.
  Word order stops mattering; `assisted` never does.
- **The screen keeps every item all day.** A done row is dimmed to 0.45 and carries a ✓; a
  half-done one reads `2/3`; an untouched one carries **nothing** — a column of `0/3` is a
  to-do list the user did not write (§Principles 8). The group heading counts *"1 of 3
  done"*. When the last item lands, a **Plan complete** card appears **above a list that is
  still all there**.
- **The button says "What should I do today?", always.** It used to flip to *tomorrow* the
  moment anything was logged, which told someone standing in the gym that today was over.
  `workout_done` is no longer read on Today.

#### B — never a retroactive rest verdict

`workout.type: "rest"` is a *plan* for a day of recovery. It is not a reaction to work
already done, and two places used to let it become one.

- **`gapRule(0)`** said "Already trained today. Anything prescribed is in addition to that —
  consider mobility, cardio or rest." It now says the session must be **named** and the
  answer built **around** it, that anything added is a COMPLEMENT, and that today "is not a
  rest day and must never be called one".
- **The prompt** gained a `NEVER A RETROACTIVE REST VERDICT` block saying the same thing in
  the model's own terms, including the two ways the old answer was written and why neither
  is allowed: *"Nothing more strenuous today" is a fine answer — as a sentence in "why",
  beside a short recovery list. It is NOT said by setting workout.type to "rest", and it is
  NOT said by returning an empty Do list, which replaces the user's plan with a blank page.*
  It also spells out what a complement may be, because "do not answer rest" with no
  alternative is a rule with nowhere to go: *a ten-minute stretch of what was trained, a
  twenty-minute walk, or two mobility drills is a complete and honest answer.*
- **And it is enforced in code, because the prompt was not enough.** Checked against the
  live account after the first deploy: the user had logged four sets of pulldowns that
  morning, and the model — having read the rule, twice — still answered `type: "rest"` with
  an empty list, reasoning that a second lat session would be overtraining. The reasoning
  was fine; the *shape* was the bug. `resolveRestAfterTraining` now runs on every answer
  when the day has anything logged: a rest label over a list that has something in it is
  **relabelled `mixed`** and kept (the label was wrong, the session was right), and a rest
  label over an empty list is **thrown**, so the caller asks once more and falls back to the
  standing plan rather than writing a blank page into the record. The gap rule's own line
  became a directive for the same reason — `workout.type MUST NOT be "rest" and the Do list
  MUST NOT be empty` — after the gentler wording was read, agreed with, and ignored.
- **`today.logged`** is new on `CoachToday`: every movement of the day with its set count,
  not just the block titles, printed as *"Logged today, movement by movement: … This work is
  DONE and counts."* The completion match reads the same list, so the sentence the model is
  given and the ticks on screen come from one place.
- A contract case reproduces the field report against the live model — lats, rows and an
  assisted chin-up logged at 07:40, first ask at 11:20 — and asserts the answer is not rest,
  is not empty, and names what was done.

#### C — add-ons append

`POST /api/coach/next/regenerate` with a `revision` now goes through `CoachPort.revise`,
whose schema is the brief plus **`revision_mode: "append" | "rewrite"`**. The model decides.

- On **append** the model returns ONLY the new items and `appendToBrief` merges: the
  exercises are concatenated with the new ones stamped `added_at` (the local clock), and the
  plan keeps its **headline**, its **nutrition card** and its **nudge**. `why` becomes the
  plan's reasoning followed by the model's sentence about the addition. The app draws an
  **"Added 2:05p"** divider above each group.
- On **rewrite** ("switch to legs", "make it 8 exercises") nothing changes from before: the
  whole brief comes back and replaces the old one.
- `assertUsableRevision` refuses an append that adds nothing, retries once, and falls back to
  the standing plan with a note — the same shape of guard as the empty Do list.

**The decision this cost a contract run to find: `revision_mode` is the FIRST field in the
schema, and that is load-bearing.** Structured output is decoded in schema order, so a flag
at the end is chosen *after* the answer is written — and a model that has just written a
complete replacement session answers "rewrite", correctly. On identical prompts, "add core"
came back as a rewrite with the flag last and as an append with it first. Deciding before
answering is the whole point of the field.

#### D — Eat goes live

The Eat card counted down the day's **target**, which stopped being the interesting number
the moment anything was eaten. `nutritionNow()` computes `allowance − eaten` and
`protein target − eaten protein` from the same day view the ring is drawn from, on every
read, stored nowhere. The card's big figure is what is **left**; past the allowance it is the
amount **over** and one flat line — *"320 kcal over today's allowance · protein is there."* —
with no advice attached, tested for the absence of "try", "should" and "tomorrow". The
model's `nutrition.kcal` is untouched: it is the target, and it does not move.

#### E — the programming brain

- **`session_minutes` (migration `0014`).** Nullable, checked to 10–240, `NULL` = nobody has
  said — *not* `DEFAULT 60`, which is the `daily_calorie_target` lesson: a column default
  reported back as a stated value. `DEFAULT_SESSION_MINUTES` lives in TypeScript beside the
  rules that read it. Set by talking, like every plan field: it is on `ProfileFieldsSchema`
  (the **second** call, never the routing union — pinned by a test) with a prompt line
  separating "my sessions are about 45 minutes" (a standing fact) from "only 30 today"
  (coach context, which still overrides for the day).
- **`sessionSizing()`** turns minutes into a shape: ~8 working minutes per exercise, 5 of
  warm-up, the finisher off the top. An hour is 5–6 movements, which is what the prompt
  always asked for, so the default changes nobody's brief; 25 minutes is 2. It reaches the
  model as a `SESSION LENGTH` rule **and** is enforced in code — `capBrief` trims the tail —
  because a cap that lives only in a prompt is a suggestion, and the user with 25 minutes is
  the one who pays. The cap is **not** applied to a revision: "make it 8 exercises" is the
  user overruling the size, and trimming their answer back would be arguing with them.
- **The coverage ledger.** `coverageLedger()` is a second, coarser reading of the same
  window: twelve entries in a lifter's vocabulary (`core` = abs + obliques, `upper back` =
  back + traps) plus **stretching**, which is counted in *sessions* because a stretch has no
  sets. Each carries days-since-served, 14- and 28-day counts, and `overdue` (never served,
  or unserved for two weeks). It reaches the prompt as `COVERAGE LEDGER` and as
  `COVERAGE DEBTS` — *"core: 21 days unserved"* — with the rule that today retires the
  largest debts it can **within the recovery constraints**, which are still absolute.
- **Variety and one introduction.** `introductionCandidates()` reads the catalogue for
  entries this user has **never** logged (all time, by id or name), preferring ones whose
  primary muscles are on the debt list and then ones with photographs, and offers ten. The
  prompt may mark **at most one** exercise `is_new`, with the reason in its `note`;
  `capBrief` drops the flag off any extras and **keeps the exercises** — the chip was wrong,
  not the movement. The app draws a "New to you" chip that opens the exercise sheet.
- **A finisher, in its own array.** `workout.finisher` is 2–4 stretch/mobility items scaled
  with the minutes and aimed at what the day trained. It fitted: `CoachBriefSchema` is
  1,934 JSON-schema bytes against a 3,000-byte budget and a 4,500 ceiling, and the contract
  test compiles it on the live model. The fold-into-`exercises` fallback was not needed.
- **The board carries the ledger.** `GET /api/training/board` returns `frequency.coverage` —
  `features.coverage` straight through, not a second reading of the same rows, for the same
  reason the board's next step is `prescribeLoads` and not a copy of it. Progress draws one
  line, **"Overdue a turn · Calves · never · Core · 21 days"**, replacing the older "not
  trained in four weeks" line rather than sitting beside it.

**Decisions**

- **Completion is derived, never stored.** Two copies of "has this been done" is two answers
  the moment a row is corrected, and the log is the one that is right.
- **A tick is not a nag.** An untouched line carries no marker at all. `0/3` on five rows is
  a to-do list, which concept-v2 §Principles 8 exists to keep out of this app.
- **An append keeps the plan's headline.** A new headline is what makes an addition look
  like a regeneration on screen, which is the bug. The nutrition card and the nudge are kept
  for the same reason — "add core" is not a statement about eating.
- **`revise` is its own port method**, not an optional argument to `brief`. It answers a
  different schema, and the caller has to know the mode before it can merge.
- **The ledger is coarser than the catalogue on purpose.** `TRACKED_MUSCLES` still drives the
  recovery rule and the muscle bars, untouched. Merging `abs` and `obliques` into "core" is
  about what the sentence should say, and doing it inside the recovery rule would have
  changed a progression to improve a paragraph.
- **`session_minutes` is nullable.** See the migration's note, and `fix-safearea-target-label`.
- **The brief's inputs hash now includes the coverage ledger**, because it is part of
  `features`. Every brief written before today reads as `stale: true` on the first ask after
  deploy — correctly: the advice really was built without it. Nothing is regenerated
  unasked.
- No new dependencies. One migration.

**Tests** — 563 passing, 2 skipped in `backend` (was 505/2, with the key set so the contract
tests run); 185 passing in the app (was 176).

- `src/services/coach/completion.test.ts` (new, 14): the match across case, punctuation,
  plurals and word order; the assisted family refused **both ways round**; the id winning
  over the name and disagreeing with it; none / partial / done / past-done; sets summed
  across the rows one visit produced; a row with no set count read as done rather than as
  "0 of 3"; and an empty plan never "complete".
- `src/services/coach/features.test.ts` (+7): a row per tracked muscle plus stretching
  whether or not it was trained; the 14/28-day counts and days-since; abs + obliques folding
  into "core" and back + traps into "upper back"; stretching counted in **sessions**;
  overdue at fourteen days with "never" as the largest debt there is; the future ignored;
  and the ledger on `computeFeatures` being the same object the board gets.
- `src/services/coach/rules.test.ts` (+20): the default hour and what it sizes to; the list
  shrinking with the minutes and flooring at two; the cap one over the ask; the finisher
  scaling; absurd minutes held to 10–240; `buildRules` carrying it and saying who said it;
  the debts named with their numbers and the recovery constraint kept above them; the "nothing
  is overdue" wording; the candidate list and its silence when there is nothing to introduce;
  `gapRule(0)` demanding a complement and forbidding "rest"; `resolveRestAfterTraining`
  relabelling a rest day that has a complement in it, throwing on one that has nothing,
  leaving a genuinely planned rest day alone and touching no training day at all; and the
  revision schema refusing a missing or unknown mode, an append that adds nothing, and a
  rewrite with an empty training day.
- `src/services/training/board.test.ts` (+1): the ledger on the board being `features.coverage`
  itself, with chest served, quads never, stretching in sessions, and the debts first.
- `src/services/fusion/fusion.test.ts` (+1): `session_minutes` on the plan-fields call, its
  bounds both ways, its default when absent, and **not one byte of it on the routing union**.
- `src/app.test.ts` (+12): the plan ticked from none → partial → complete over real rows with
  every item still on screen and **no `completion` in the stored jsonb**; the Eat card equal
  to `GET /api/day`'s own numbers, and the over-allowance line with nothing to do about it;
  an append landing under the plan with the headline, nutrition and nudge kept, the reasoning
  extended and only the new rows stamped; a rewrite replacing the list; an empty append
  refused and not stored; three `is_new` flags cut to one with all three exercises kept; the
  mid-workout ask carrying every movement with its sets and the two prompt rules; **the
  photographed answer reproduced through the fake** — "Rest or light cardio — you trained
  lats today" with an empty list — asked twice, stored never, and the same answer *with* a
  five-minute lat stretch in it kept and relabelled `mixed`; the ledger
  and its debts in the prompt; the sizing block, the candidate list (never a logged
  exercise); and 25 stated minutes cutting five movements to three.
- `anthropic.coach.contract.test.ts` (+2, all five run here against the real model, **five for
  five**): "add core" coming back as an **append** of two to four core movements that are not
  the ones already in the plan; and the field report — lats logged this morning, asked at
  11:20 — coming back as a session that names what was done, with `type` not rest and the Do
  list not empty. The two existing revision cases now assert `revision_mode: "rewrite"`.
- `__tests__/coach.test.tsx` (+8): the ✓, the `2/3`, the "1 of 3 done" heading and the absent
  `0/3`; Plan complete drawn above a list that is still there; one divider per added *group*;
  the "New to you" chip on exactly one row and the sheet it opens; the finisher; the Eat card
  reading the live numbers and not the target; the over-allowance state; and an older server
  with no `nutrition_now` still drawing a card.
- `__tests__/progress.test.tsx` (+1) and `__tests__/today.test.tsx` (1 rewritten): the overdue
  line, longest first, replacing the untrained one; and the coach button asking about **today**
  with a workout logged.

**Deferred**

- **An append is still not a conversation.** Two appends in an afternoon are two groups under
  two dividers, which reads correctly — but the second one is written with no memory of the
  first instruction, only of the plan it produced.
- **The finisher has no completion.** Stretching is rarely logged, and ticking off an item
  nobody logs would draw a permanently unfinished list under a finished plan.
- **`is_new` is not remembered.** A movement introduced today and never done is offered again
  tomorrow, because the candidate query asks the *log*, not the briefs. Right, probably —
  an introduction the user ignored is not evidence they know it — but it is a choice.
- **The ledger's vocabulary is a list.** Twelve entries and stretching, hand-mapped to the
  catalogue's tags. A tag nobody mapped (`hip_flexors`, `adductors`, `neck`) pays into no
  ledger entry and is invisible to the debts; the muscle bars still show it.
- **Nothing re-sizes a plan already on screen** when `session_minutes` changes. The next
  brief is sized to the new number; today's stands, which is what sticky means.

### 2026-08-31 — one tab for where you stand, and a board for what you lift (`wp-progress-scoreboard`)

Two tabs answered one question badly. **Goals** said what was being chased and **Progress**
said where it stood, and neither of them said anything at all about the thing the user
actually does four times a week: lifting. The user's decision, in one line — *Progress is
"what am I chasing and where do I stand", and training is first class on it.*

#### A — Goals and Progress are one tab

The tab bar is **Today · Days · Progress · You**. `app/(tabs)/goals.tsx` is deleted;
`components/tab-bar.tsx` maps the three tab routes and draws **You** as a fourth button that
pushes a stack screen, because You is one screen deep from two places (the avatar on Today
and the avatar on Progress) and nothing about it wants a navigation stack of its own.

The new `app/(tabs)/progress.tsx` is, top to bottom:

1. **A card per active goal.** Title big; then one line of standing — *"212.0 → 210.4 lb now
   (7-day avg) · 10.4 lb to go · −0.4 lb/wk"* — the metric drawn from where it started to
   where it is, with a **dotted projection** to where this rate lands, the target as a dashed
   line across it, and a **pace verdict against the date the user named**: *Ahead of / On pace
   for / Behind · <projected> at this rate*, in `good` or `accent`. Then *"This week: 4 of 7
   served · −0.4 lb"*, the reached and stalled prompts (still questions — nothing here closes
   a goal), Mark reached / Not yet / Drop, the priority arrows, and **Add another goal**.
   Goal history sits at the bottom of the screen with its outcomes.
2. **The lifts board.** One row per exercise logged in four weeks, goal or no goal: the name
   (tappable → the exercise sheet), the working load, a sparkline, a sentiment-coloured delta,
   and the **next step**.
3. **How often** — sessions a week over eight weeks, and sets per muscle group over four.
4. **Cardio** — minutes a week against the plan's intent, last and best pace where there is
   distance.
5. **Body** — the weight line, and **only when no weight goal already owns it**.

Every no-data state is one quiet line (`Nothing lifted in the last four weeks.`), never a
chart of zeroes and never a judgement colour.

The pace verdict and the standing line are `lib/progress-sections.ts` `goalCard()` — pure,
tested without a renderer, like every other calculation in this app. `consistencySection`
and `coverageSection` are gone: they counted days-with-a-muscle-group out of the Days list,
and the board carries the real thing (sessions, sets, minutes).

#### B — `GET /api/training/board`, and why it is not a second progression engine

`services/training/board.ts` builds the board from `computeFeatures` and **calls
`prescribeLoads`** — the same function `buildRules` calls for the brief. The board adds one
thing a brief does not need: **when**. A hold reads *"Hold 135 lb until 3 × 8 twice · ~1–2
wks"*, where the weeks are the sessions still to go at that exercise's own median cadence.
An assisted machine reads *"50 lb of assistance next — one step less help"*, and its delta
reads *"5 lb less help"* in green (migration 0013's `load_direction`, the same flag the day's
`sentiment` uses).

The test that matters is at the bottom of `board.test.ts`: six histories, each run through
`buildRules` and through `buildBoard`, asserting rule, load, sets, reps and `why` are
identical. Two opinions about the next weight is the failure this design exists to prevent.

`catalogFactsFor` moved out of `services/coach/coach.ts` into `services/coach/catalog.ts`
unchanged, because the board needs the same equipment and load-direction lookup and two
copies is how they start disagreeing. The route is a plain read — no model, no cache,
nothing written — which is why a tab may fetch it on open.

#### C — You

`app/you.tsx` is the old Goals bottom half: how you train / how you eat with each field's
stated date and the target's provenance, constraints and preferences, the place and its
machine tally, the disabled Health toggle, the account and sign out. **NO FORMS** — the test
asserts there is not one `TextInput` on the screen; every row is changed by saying it again
through the Log sheet.

#### D — The delete control is one control

Reported: the targets were too small and ✓/✕ were confusable. `DeleteControl` no longer arms
into "Delete? ✓ ✕". At rest it is **one ✕** with 44 pt of target; armed, the same spot becomes
**one wide pill reading "Delete?"** — the whole pill is the target and there is nothing beside
it to hit by mistake. Every way out of it is something other than a button next to the
confirm one: a tap anywhere else, a scroll (`dismissDeletes()` on Today's, Day's and
Progress's scrollers), another row's ✕, or **three seconds**. A destructive action should be
easy to abandon and hard to do by accident.

#### E — A row never repeats itself

`lib/row-facts.ts` is new and pure. Today drew the raw description under the title, so a row
read **"Lat Pulldown"** over **"4 × 15 lat pulldown at 60 lb"**: the name twice, and the
numbers about to be drawn again. The sub-line is now structured facts — `4 × 15 · 60 lb` —
with the raw sentence appended **only when it still carries something they do not** (a machine
with no column, a note: *"last set was ugly"*). The test for "adds nothing" is word
accounting, the same shape of rule as `exerciseMatch.ts`: every meaningful word of the
description must be covered by the name, the equipment or a number already shown. Today, Day
and the board all read it.

#### F — The Log sheet, from five field reports in one morning

- **The primary action was a chip.** "Log" was a `Chip` the same size and shape as "From
  library" beside it and greyed until there was something to read; the user could not tell
  what to press. It is `BigButton` now — 56 pt, full width, `accent` with a `bg` display
  label, the weight of Today's coach button — and it **keeps that shape in every state**:
  disabled is the same button at 0.45 opacity, pending is the same button with a spinner and
  "Reading…". Same for the review step's "Log it" / "Save changes".
- **The action bar is pinned.** It sits below the scroller and rises with the keyboard
  (`footerLift()`: the keyboard's height on iOS, where `automaticallyAdjustKeyboardInsets`
  moves the *content* and not a sibling; zero on Android, where the `KeyboardAvoidingView`
  already shrank the container). Submitting never requires dismissing the keyboard.
- **The compose box is capped** at `composeMaxHeight()` — 42 % of the window less the top
  inset — so a long paragraph scrolls inside the input and iOS keeps the caret visible.
  Applied to the coach's context box too.
- **A photo is removed by its badge and by nothing else.** Tapping a thumbnail used to delete
  it with no affordance at all; a user found out by accident. Each pre-save thumbnail now
  carries a 24 pt ✕ badge over its corner (40 pt of target with the slop) and the image body
  opens the photo instead. `components/evidence.tsx` grew `LocalThumbs`, a shared `Thumb` and
  a `Lightbox` — a `Modal`, no new dependency.
- **The record shows its photos, under the record.** "This is what was saved" quoted the
  user's words and showed none of the pictures the record was made from. The screen is
  reordered: the **as-recorded card first**, then the change affordance, then a quieter
  **"How this was recorded"** section — a vertical list of provenance entries, the quote first
  with its photos attached to it. Corrections will append as further entries when the server
  emits them; the shape is already a list so that costs no redesign. `GET /api/day/:date/log`
  already carried the evidence ids, so no server change was needed.
- **The confidence chip says what it is about.** A bare "HIGH" beside a meal was read as
  "high calories". It is *"High confidence"* / *"Medium confidence"* / *"Low confidence —
  check me"* now, and only the low one is drawn in `accent`.

**Decisions**

- **`prescribeLoads`, not a copy of it.** The board could have re-derived "next weight" from
  the same features in twenty lines. It would have been right on the day it was written.
- **No reference loads on the board.** A stated load ("I bench 165") is a claim; the board is
  what the user has *done*. The brief is the place that is allowed to plan from a claim.
- **The board's cardio target is the goal's**, when a goal names weekly minutes, else the
  WHO's 150 — the same number `cardioFeature` uses, so the bars and the brief agree.
- **"first time" stays on the delta line**, not in the sub-line: the day already computes it
  with a sentiment and a colour, and printing it twice is the bug this change is about.
- **You is a button in the tab bar, not a tab.** The bar reads Today · Days · Progress · You
  as decided; the screen is a stack route, which is what the avatar on Today already pushed.

**Tests** — backend and app both green. New: `services/training/board.test.ts` (24 — the
rows, the words, the assistance flip both ways, frequency/cardio/body buckets, and the
six-history agreement with `buildRules`), `src/app.test.ts` (+4: the route end to end over
real rows including an assisted machine, an empty account, and a 401), `__tests__/progress.test.tsx`
(15), `__tests__/you.test.tsx` (7, converted from goals.test.tsx), `__tests__/row-facts.test.ts`
(9), `__tests__/delete-control.test.tsx` (5), plus additions to `log.test.tsx`, `log-correction.test.tsx`,
`today.test.tsx`, `progress-sections.test.ts` and `confirm-card.test.tsx`. `safe-area.test.tsx`
now walks You instead of Goals — the convention is still one assertion per screen.

**Deferred**

- **Corrections in the provenance list.** The section is a list on purpose; the server does
  not yet emit a row's correction history.
- **The board is four weeks of lifts.** An exercise last done five weeks ago drops off it.
  The window is `COACH_WINDOW_DAYS` and moving it moves the coach's too.
- **No per-lift chart beyond the sparkline.** Tapping a name opens the exercise sheet, which
  is where a full load history belongs if anyone asks for one.

### 2026-08-31 — a header under the clock, and a target nobody stated (`fix-safearea-target-label`)

**The reports.** Two, from the same screen. The Goals header was photographed with its
"1 ACTIVE" eyebrow beside the iOS clock. And the plan said **"Daily target 2100 · From
stated"** on an account that had stated nothing at all.

#### A — the top of a screen is the screen's own job

No screen in this app has a navigation header: `headerShown: false` in both layouts, and
the tab bar is at the bottom. So the first pixel of every screen is at the very top of the
display, and the whole convention is `paddingTop: insets.top + <a little>` on the scroller
the screen is built in.

**Audited all ten screens. Every one already had it**, Goals included, and Goals has had it
since WP6b — the arithmetic there is character-for-character what Today does. So the
padding was never missing from the source; what can go missing is the *inset*.
`useSafeAreaInsets` returns 0 before the provider has measured, and 0 for good on a host
with no insets to give. Zero is how a correct screen still draws its eyebrow at y = 0.

- **`lib/screen.ts`** is new and is nine lines of substance: `useScreenInsets()` returns
  the real insets with `top` floored at `STATUS_BAR_MIN` (20 — the pre-notch iOS status
  bar). No iOS device reports a genuine full-screen top inset below that, so the floor
  costs nothing on a phone and makes the collision impossible everywhere else.
- **Only `top` is floored.** A device with no home indicator really does have a zero bottom
  inset, and the tab bar needs that zero to sit flush — `components/tab-bar.tsx` keeps
  `useSafeAreaInsets` unchanged.
- **All nine scroll screens now call it**: Today, Days, Progress, Goals, Coach, Log, Day,
  DayLog, Exercise. One import and one call each; every `paddingTop` expression, every
  `paddingBottom`, and all scroll behaviour are exactly as they were. The tenth screen,
  sign-in, is a centred `SafeAreaView edges={['top','bottom']}` and was left alone.
- **`__tests__/safe-area.test.tsx`** is the convention as a test, and it is the part that
  lasts: each screen is rendered twice, once with a 59 pt inset and once with none, and its
  scroller's `paddingTop` is asserted against both. A tenth screen that forgets the
  convention fails the first assertion; a regression in the floor fails the second.

#### B — 2100 is a column default, not something you said

`profiles.daily_calorie_target` is `INT DEFAULT 2100` (migration 0002). `computeDayTargets`
used it as the fallback whenever the TDEE inputs were incomplete, and reported that fallback
as `source: "stated"` — so a reset profile was told, in the app's own words, that its 2100
was a number it had given. It never had.

`profiles.stated_at` (migration 0004) is the only evidence either way: every write path —
`updateProfile`, the fusion confirm, `places.ts` — stamps the field it touches, so the key
is present exactly when a human said the number.

- **`TargetSource` is now four values**, and they are provenance rather than arithmetic:
  `derived` (worked out from the TDEE inputs), `stated` (`stated_at` has the field),
  `default` (the column's DEFAULT and nothing else), `none` (no target at all).
- `computed` was renamed to `derived` in the same pass, because "computed" and "default"
  read as neighbours and those two are the ones a reader must not confuse. `none` is
  unchanged and still means the profile cannot produce a target.
- **`stated_at` is now selected** by `services/profile.ts` and `services/day.ts` and is a
  field of `TdeeProfile`. It is nullable there on purpose: a row read without it answers
  `default`, which is the safe way to be wrong.
- **The app says it in words.** Goals' "Daily target" sub-line is now "From your stats" /
  "From stated" / "Default until you tell me more", and the unchanged "Tell me your height,
  age and weight" when there is no target at all. It used to print the wire value directly,
  which is how "stated" reached a user's eyes in the first place.
- Nothing else reads `source`: Today's "No calorie target yet" card is gated on
  `allowance == null` and is unaffected, and no calorie *number* moved anywhere.

**A note for the next app build.** The wire value changed, so a phone running a build older
than this one will draw "From derived" on that row until it is updated. The number beside it
is right either way.

### 2026-08-31 — "assisted" is not a spelling of "chin-up" (`fix-exercise-qualifiers`)

**The report.** The user said **"assisted chin up with 55 pounds"**. It was saved as a plain
**Chin-Up at 55 lb**.

Two failures, and the second is the expensive one. The catalogue had no Assisted Chin-Up, so
the name resolved to the nearest thing it did have and the qualifier went on the floor. And
because the qualifier went, the number changed meaning: on an assisted machine 55 lb is the
**help the machine gives** — easier than a bodyweight rep — and it was recorded as 55 lb of
load hanging off a belt, which is much harder. The progression then pointed the wrong way for
ever: the rule is "two good sessions, add a plate", and adding a plate of *assistance* is
getting worse at chin-ups, not better.

#### A — a match has to account for every word

`services/exerciseMatch.ts` is new and pure, and it holds the whole rule:

> A catalogue match is accepted only when every meaningful word of the phrase is accounted
> for by the matched entry's own name **or one of its aliases** — and never when the phrase
> carries a QUALIFIER the entry does not carry.

- **`QUALIFIERS`** is the maintained list: assisted, machine/band assisted, banded, weighted,
  incline, decline, close-grip, wide-grip, neutral-grip, reverse-grip, underhand, overhand,
  single-arm, one-arm, single-leg, one-leg, unilateral, seated, standing, kneeling, lying,
  smith, smith machine, deficit, paused, pause, tempo, eccentric, isometric, suspended,
  elevated, negative. Multi-word ones match as adjacent words and the longest wins, so
  "machine assisted" is one qualifier and not two.
- **Aliases count as the entry's own words.** "dips" is nowhere inside "Chest Dip"; it is
  still one of the things it is called. That is why the accounting is against the union of
  the name and every alias, and why nothing the catalogue deliberately offers is refused —
  a test walks every name and alias in `data/exercises.json` and finds each one.
- **A refusal is not a failure.** The phrase is stored verbatim with `exercise_id` null, which
  best-effort logging has supported since `field-fixes-best-effort-places`. The catalogue
  normalises; it does not decide what the user is allowed to have done.
- **Where it applies:** `lookupExercises` in `services/entries.ts`, the one matcher behind the
  fusion confirm, the direct `POST /api/entries/movement`, the `PATCH` correction and the
  coach's Do-list link. It now reads the whole catalogue (a curated list in the low hundreds)
  and decides in TypeScript, because "every meaningful word is accounted for" written in SQL
  would be a worse copy of the same code.
- **And the refinement chip**, which turned out to be the *other* nearest-name matcher:
  `suggestRefinement` would have offered "Was it a Chin-Up?" for those words. It reads a
  rambling description loosely on purpose, so only the qualifier half of the rule applies to
  it (`missingQualifiers`) — it may still guess, it may never guess a qualifier away. It also
  says "an Assisted Chin-Up" now; the assisted family made the article visible.

#### B — the assisted family, and a flag for what the number means

`data/exercises.json` gains **Assisted Chin-Up**, **Assisted Pull-Up** and **Assisted Dip** —
their parents' muscles, aliases for the ways people say them ("machine assisted…", and
"banded pull up" as an alias of Assisted Pull-Up), and equipment `assisted_machine`.

`load_direction` is the new catalogue flag (**migration `0013`**: a `text` column defaulting
to `'resistance'` with a check constraint, and seed support; optional in the JSON, so only the
three entries that are not the default say anything). Note on the equipment token: the file's
convention is snake_case (`smith_machine`, `pullup_bar`), so it is `assisted_machine` rather
than a spaced "assisted machine" — and deliberately *not* one of `STACK_EQUIPMENT`, so the
step stays a flat 5 lb rather than 5 % of a stack.

#### C — progression, with the sign it deserves

`prescribeLoads` takes a `loadDirection` map and every rule runs through two helpers,
`harder()` and `easier()`, instead of `+ step` / `- step`:

| history | resistance | assistance |
|---|---|---|
| two sessions at target reps | `step_up`, +5 lb | `step_up`, **−5 lb** ("one step LESS help") |
| two sessions short of target | `step_down`, −5 lb | `step_down`, **+5 lb** ("one step MORE help") |
| restart after a fortnight | one step under | one step **more help** |
| "same" logic | unchanged | unchanged |

`daysSinceLastStep` follows the same flip: "never more than one step a week" is a rule about
*progress*, so on an assisted machine the step it watches for is the number going down. The
floor differs too — a resistance load never drops below one step, an assistance load stops at
**0**, which is the goal (no help left is an unassisted rep).

The coach is told, twice and only when it matters: each prescribed load prints as "55 lb of
assistance (help, not resistance — less is stronger)", and `buildRules` adds an **ASSISTED
MACHINES** line to the rules block *only* when one is in today's list.

#### D — the delta, and the colour it is drawn in

`DeltaVsLast` gains **`sentiment`** (`good` / `watch` / `neutral`) beside `direction`.
`direction` says which way the number went; `sentiment` says whether that was progress, and on
an assisted machine those are opposites. `computeDay` reads the day's exceptions from the
catalogue in one small query (only the non-`resistance` rows, since resistance is the default
on both sides) and hands them to `withDeltas`. Only `load_lb` flips — an extra set is progress
on any machine.

Both screens' `deltaColor` now takes the delta and reads `sentiment`, falling back to
`direction` so a response from an older build still renders. **"−5 lb" on an assisted chin-up
is green.**

#### E — and the reader is told, in one line

`describeVocabulary` prints the qualifier rule next to the catalogue it would otherwise be
tempted to snap to: keep the user's qualifiers, never rename a variation to the plain version
or to another variation, keep their own phrase when the exact variation is not in the list. It
travels with the vocabulary, so the focused per-part call carries it too.

**Nothing rewrites existing rows.** The migration adds a column to `exercise_catalog` and
touches `activities` not at all. **The user's existing chin-up row is theirs to correct** —
tap it, or say "that was an assisted chin-up" through Make a change, and it re-points at the
new catalogue entry. A back-fill was considered and refused: this branch cannot know which
past "Chin-Up" rows were assisted and which were real, and guessing at somebody's training
history is worse than one wrong row they can already see and fix.

**Decisions**

- **`load_direction` on the catalogue, not on the activity.** Which way a load points is a
  fact about the movement. On the row it could be contradicted by a correction, and there is
  no honest answer to "an assisted chin-up whose load is resistance".
- **`sentiment` rather than colouring by exercise in the app.** The app never has to know what
  an assisted machine is; the server, which has the catalogue, answers the question once.
- **The guard can only ever refuse.** It adds no fuzziness of its own — punctuation, case,
  word order within an alias, plurals, and nothing else. There is no "nearest name", because a
  nearest name is what saved this log wrong.

**Tests** — 477 passing, 2 skipped in `backend` (was 445/2, with the key set so the contract
tests run); 109 passing in the app (was 108).

- `src/services/exerciseMatch.test.ts` (new, 15): the reported phrase resolving to Assisted
  Chin-Up; **the same phrase against a catalogue with the assisted family removed returning
  null** — the verbatim-keep path, pinned; qualifier reading including the longest-first rule;
  aliases counting as the entry's words; a two-word qualifier assembled out of two different
  aliases still refused; the variations we do not have (`deficit deadlift`, `paused bench
  press`, `smith machine bench press`) refused rather than snapped; and every name and alias
  in the catalogue found as itself.
- `src/app.test.ts` (+4), on the exact sentence: analyze → confirm saving **"Assisted
  Chin-Up", not "Chin-Up", with 55 still 55** and an `exercise_id` whose catalogue row is
  `load_direction: assistance`; a second row 5 lb lighter reading `-5 lb` / `down` / **good**
  on the day; the coach prompt carrying "of assistance" and the ASSISTED MACHINES rule; and
  `deficit deadlift` / `paused bench press` kept verbatim on both insert and PATCH while
  `assisted dips` resolves.
- `src/services/coach/rules.test.ts` (+7): each row of the table above, the once-a-week rule
  keyed on a *drop* in assistance, the floor at 0, the rules line present only when an
  assisted machine is in the list — and the same history with no flag stepping the wrong way,
  which is the test that says the catalogue does the work.
- `src/services/day/day.test.ts` (+4) and `src/services/fusion/fusion.test.ts` (+2): the
  sentiment for both directions of both kinds of load, sets not flipping, the map reaching
  `withDeltas`, the prompt line, and the chip refusing to strip a qualifier.
- `__tests__/day.test.tsx` (+1): "−5 lb" drawn in `C.good` with `sentiment: 'good'` and in
  `C.accent` with `'watch'`.

**Deferred**

- **No back-fill**, per above.
- **The qualifier list is a list.** It is not a taxonomy of every variation anyone will ever
  say, and it does not need to be: an unknown qualifier fails the word-accounting rule anyway
  and the phrase is kept verbatim. The list exists so that a *generous alias* can never
  quietly open the door back up.
- **`Assisted Dip` borrows Chest Dip's muscles**, not Triceps Dip's — the assisted machine is
  the parallel-bar one.

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
