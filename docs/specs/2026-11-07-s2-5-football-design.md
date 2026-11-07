# S2-5 — Remote Scoring, football: design

Status: **approved by the owner, 2026-11-08** ("approve"). Brainstormed in the session "s2-5" on 2026-11-07, in parallel with
S2-4 (cricket, session "s2-4"). Rulings here are numbered from 100 (the block agreed with S2-4: cricket 64–99,
football 100–129; the numbers are clerical and the owner may renumber them). A ruling is the owner's unless marked
_the controller's_; everything marked _the controller's_ is open to the owner's correction while reading. The owner
delegated the calls left open in this brainstorm ("you can own everything", ruling 103), so most of §6–§9 is the
controller's under that delegation, and says so.

This design adds football to Remote Scoring. It argues from the S2 design
(`docs/specs/2026-11-01-s2-remote-scoring-design.md`, "the S2 design"), S2-2
(`docs/specs/2026-11-03-s2-2-table-tennis-design.md`) and S2-3 (chess, PR #42, draft), whose rulings and sections hold
for football unless a line here says otherwise.

## 1. Intent

A volunteer on the touchline scores a football match on their own phone: scan the match's scoring code, check it is
the right match, run the match clock, and record what happens — goals with the scorer, cards, substitutions, the end
of each period, and a penalty shootout when the rules reach one. Everything goes into the same ledger the web console
writes, so the public scoreboard, the console and a second scorer see one match.

Football is not badminton. Goals are rare (two or three a match); cards and substitutions are as common. A big "tap
the half to score" target would make the rarest event the easiest accident. So the pad is new, built for a thumb, one
column per team, every action under the team it belongs to (ruling 105). It is the first S2 sport with a match clock,
and the first whose taps name players from a team sheet.

## 2. Goals, non-goals, anti-goals

Goals:

- Everything the engine and the web support for football today (ruling 100): goals (scorer, assist, own goal,
  penalty), cards (yellow, second yellow, red, with a reason), substitutions, the end of each period, extra time, the
  penalty shootout, missed penalties, the sin-bin, shots.
- The match clock (ruling 101): Start, Pause and Correct, one clock shared by the phone, a second scorer and the
  web console, anchored on the server (ruling 107), showing match time (ruling 108).
- Named players (ruling 102): the scorer, the carded player and both sides of a substitution come from the team sheet
  the organiser set on the web.
- Every variant the engine has (ruling 104): 11-a-side, youth, small-sided and mini-soccer; two halves or four
  quarters; rolling substitutions; extra time and a shootout when the fixture's rules have them. The pad reads the
  fixture's `cfg`, never a fixed format.
- A web change (ruling 103), owned by this work: the device link's bootstrap carries each player's team-sheet slot,
  shirt number, position and role; the console's football clock follows the shared clock and shows match time (§10).

Non-goals:

- Building or editing a team sheet on the phone. The organiser does it on the web before kick-off; the web refuses a
  device link both reading and writing team sheets (`fixtures.ts:765, 875`, `rejectDeviceLink`) and refuses any edit
  once the fixture is not `scheduled` (`fixtures.ts:798`). _The controller's_, under ruling 103.
- A forfeit, an abandon, a settle or a finalize from the phone. The web refuses all four from a device link (§4,
  probed); finalizing stays the organiser's, as for the other sports.
- Added-time entry. The web's period sheet sends `{phase}` only and has no way to enter it (`football.tsx:512-531`);
  the phone's clock runs on past the nominal length (§7). `addedMinutes` is accepted by the engine and stays unused
  here, as on the web.
- A second state machine in TypeScript. The match is a fold of the ledger by `@seazn/engine`'s football module, as
  every S2 sport is (S2 design §6.1). The clock's running reading is a view of the ledger, not an authority (§7).
- Team-sheet extras the web shows (captain, roles, a pitch diagram), match reports, ratings.

Anti-goals (a failure even if it works):

- A goal recorded by a stray touch. The Goal button is smaller than the column's other room (ruling 105), nothing is
  sent until the goal sheet closes (ruling 106), and Undo is one tap.
- A goal, card or sub credited to the wrong team. Every action sits in its team's column: there is no "which team?"
  step to get wrong.
- A phone and the console showing different minutes for the same event, or a phone whose events the web refuses for
  time running backwards (§7.3).
- A pad that shows the bench as on the pitch. Today the phone marks every bootstrap row as a starter
  (`setBasedEngine.ts:63`); for football that would offer a bench player the web then refuses (§4).

## 3. The owner's rulings (S2-5)

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100 | Scope is whatever the web and the engine support for football today ("whatever web engine suport today", 2026-11-07), not goals only. The pad is a new design, not a copy of the web pad ("As we are designing a brand new one so let's go with that").                                                                                                                                            |
| 101 | The match clock is in ("Let's have the clock as well?", 2026-11-07), after the controller showed it rides the ledger as the web's does (§7).                                                                                                                                                                                                                                                       |
| 102 | A volunteer can pick the scorer and make substitutions ("should a volunteer be able to pick the scorer and make substitutions yes", 2026-11-07): named players, not team-only.                                                                                                                                                                                                                     |
| 103 | This work owns the web change too ("you can own everyhinh", 2026-11-07), in answer to whether the web session should make it. Read by the controller as also delegating the calls the brainstorm had left open; each is marked _the controller's_ below.                                                                                                                                           |
| 104 | Every football variant ("I think all varinat right?", 2026-11-07): 11-a-side, youth, small-sided, mini-soccer, as the fixture's `cfg` says.                                                                                                                                                                                                                                                        |
| 105 | Layout C, team columns ("yes", 2026-11-07, to the controller's recommendation), with the Goal button at three quarters of the size first drawn and Card and Sub growing into the room ("yes, but 3/4 of Goal button?", then "2" between the two readings shown). Mockups: `pad-layout-c-v3.html` in the brainstorm's companion directory.                                                          |
| 106 | The tap flows as played back ("Ok", 2026-11-07) and as drawn in the flow mockup ("yes", 2026-11-07, `goal-sub-flow.html`): §5 and §6.                                                                                                                                                                                                                                                              |
| 107 | A shared clock anchored on the server that every screen resyncs to ("can we have some shared clock in server which can resync with mobile?", then "yes" to the controller's proposal, 2026-11-08), after the builder check showed the web does not share a running clock today (§7.1). Built from the ledger's own clock events, no new server state (§7.2); the web console follows it too (§10). |
| 108 | The clock shows match time, as football counts it: the second half starts at 45:00, added time reads "90+3"; and the web console's football clock changes to match ("A, change console too", 2026-11-08).                                                                                                                                                                                          |
| 109 | In added time the clock face shows the time passed, "90+2:30", and an event's minute is the minute being played, "90+3'" for the same moment, as football counts a goal at 0:30 as the 1st minute ("A", 2026-11-08).                                                                                                                                                                               |

## 4. What staging answered (probed before this design)

S2-3's first lesson was to probe the web with a device link before designing around an event. A throwaway fixture was
made on staging for it (org `my-organization-31`, competition _Football S2-5 Test_, division _Open 11-a-side_,
knockout, 2 × 45, extra time 2 × 15, 5 penalties each, sin-bin 10 min; Northgate Utd S25 v Riverside FC S25, 16
players a side, 11 starting with a goalkeeper and 5 on the bench, shirt numbers 1–16). 42 POSTs went through the
device link, one event each, on 2026-11-07; the match ended 5–5, 4–1 on penalties, `decided`, not finalized. The
fixture is spent; the device run needs a fresh one (§11).

| Event                                                                                                                                         | Answer                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| any write while the division is not started                                                                                                   | 422 `WRONG_PHASE` ("division has not started — scoring is closed"); the bootstrap's `screen` says `division_not_started` |
| `core.start {}`                                                                                                                               | 201, status `in_play`                                                                                                    |
| `football.clock {running, at}`                                                                                                                | 201; `at.elapsed` as a string → 422 `INVALID_EVENT`                                                                      |
| `football.goal` team-only `{by, at}`                                                                                                          | 201                                                                                                                      |
| goal with scorer and assist (starters)                                                                                                        | 201                                                                                                                      |
| goal with a bench or other-side scorer                                                                                                        | 422 `INVALID_EVENT`, "scorer … is not on the pitch for …"; nothing written                                               |
| goal with a bench player as **assist**                                                                                                        | 201: the assist is not checked                                                                                           |
| `ownGoal: true` (`by` = the side whose player put it in, `scorer` = that player; the goal counts for the other side, `football.ts:1255-1271`) | 201                                                                                                                      |
| `penalty: true` goal                                                                                                                          | 201                                                                                                                      |
| `football.card` yellow, second yellow, red, with reason                                                                                       | 201 each; a card for a player already sent off → 422; an unknown reason → 422                                            |
| card for a bench player                                                                                                                       | 201 (allowed)                                                                                                            |
| `football.sub {by, off, on, at}`                                                                                                              | 201; the player who came on can then score, the one taken off cannot                                                     |
| `core.lineup.substitution`                                                                                                                    | 201 too; the web pad sends `football.sub` (`football.tsx:1292-1314`), so the phone does                                  |
| sub of a sent-off player / a return in 11-a-side                                                                                              | 422 (the first with a misleading "not in this squad": a web bug, §12)                                                    |
| `football.penalty` missed                                                                                                                     | 201; `outcome: "scored"` → 422 (a scored penalty is a goal)                                                              |
| `sinbin.start` / `sinbin.end`                                                                                                                 | 201 / 201; the binned player cannot score meanwhile                                                                      |
| `football.shot`                                                                                                                               | 201, with or without `at`                                                                                                |
| an `at` earlier than the newest one recorded                                                                                                  | 422 `NON_MONOTONIC_TIME`                                                                                                 |
| `football.period {phase: "HT"}`                                                                                                               | 201; H2 opens by itself. A goal stamped `H1` after HT counts in H2: the fold's phase decides                             |
| `period FT` at a level score                                                                                                                  | 201; extra time opens by itself; `ET_FT` level → the shootout opens by itself                                            |
| `shootout.kick {by, person, scored}`                                                                                                          | 201; out of turn → 422 ("kicks must alternate: expected …")                                                              |
| the deciding kick                                                                                                                             | 201, `outcome {kind: "win", method: "shootout"}`, status `decided` by itself                                             |
| a kick after the decision                                                                                                                     | 422 `ALREADY_DECIDED`                                                                                                    |
| `core.void {event_id}` of the link's own event                                                                                                | 201; again → 409 `UNDO_ALREADY_VOIDED`; another's → 403. A void on a decided match reopens it                            |
| `core.forfeit`, `core.abandon`, `core.settle`                                                                                                 | 403 `FORBIDDEN` ("Only an organiser can …")                                                                              |
| `core.finalize`                                                                                                                               | 403 `FORBIDDEN` ("Finalizing needs an organiser or scorer account")                                                      |

The bootstrap: `sport_key: "football"`, `engine_epoch_required: 4`, `cfg` with `halves`, `halfMinutes`,
`extraTime`, `shootout`, `shootoutAttempts`, `sinBinMinutes` and the rest; each side's `lineup` is 16 rows of
`{person_id, pair_order: null}` and nothing else. **It cannot tell the eleven from the bench**, which is what §10
fixes. Ledger rows carry `{id, seq, type, payload, recorded_at, recorded_by, device_link_id, voids_event_id}`.

Engine: `@onryde/seazn-engine` 2.0.0 (the phone's pin) has the same football module as 3.0.2 (origin/main 40d692b):
no file under `sports/football`, `sports/period` or `core` changed between them, and football's fold epoch is 4 in
both (`sport/fold-epoch.ts:51,61`). No engine bump is needed.

## 5. How a scorer meets it

1. Scan the match's scoring code from Home's Remote Scoring tile (S2 flow, unchanged). The match check shows the two
   teams, home first.
2. If nobody has started the match, **Start match** records `core.start {}`, as every S2 sport's Start does; the pad
   opens with the clock at 0:00, stopped, and the clock bar's **Start** at kick-off starts it (`football.clock
{running: true, at: {period: "H1", elapsed: 0}}`). Two taps, not one: the runtime turns one tap into one event
   (`scoringSport.ts:83`, `scoringMatchTaps.ts:69-75`), and one Undo must take back one thing, so the shared runtime
   is not changed for football (_the controller's_, after the builder check). A match another scorer started opens
   on the pad, its clock seeded from the ledger (§7).
3. The pad: the clock bar across the top, then two columns, home on the left, each with the team's name, its score,
   **Goal**, **Card** and **Sub**; under them the last-tap line, then the bottom row (§6).
4. A tap opens a sheet that names the team in its title and walks the steps (§6.3). Nothing is sent until the last
   step; Cancel, the dim and Back record nothing (ruling 106).
5. **End of period** (labelled by what it ends: Half-time, Full time, the quarter, the extra-time half) records the
   period's end and stops the clock. Start begins the next period.
6. A level score at full time with extra time in the rules goes into extra time by itself; a level score after it,
   with a shootout in the rules, opens the **shootout view** (§6.5). The deciding kick decides the match.
7. Decided: the pad shows the result, the last-tap line names the last event, Undo stays inside the S2 window (45 s
   after this phone's own tap decided it). Finalizing is the organiser's on the web, as for every sport.

## 6. The screen

`FootballPadScreen`, its own screen over the shared kit (S2 ruling 38), in portrait, as every scoring pad.

### 6.1 Clock bar

Across the top, under the top bar. Left: the clock, Barlow Condensed in lime with `tabular-nums`, `MM:SS` counted
the way the match counts (45:00 starts the second half, §7.4), and once a period runs past its length the added
minutes over ("45+2", "90+3"; ruling 108). Under it the period in `ink3` caps ("1st half", "2nd half", "Extra time
1st half", "1st quarter", …, "Half-time" between periods). Right: one button, **Start** while the clock is stopped,
**Pause** while it runs.

The clock is the shared one (§7.2): a Start, Pause or Correct on the console or a second phone shows here within a
read. A tap on the clock opens **Correct** (§7.5). The web's Correct panel is part of its clock bar
(`pad-host.tsx:1216-1295`); a phone's bar has no room for four steppers, so it is a sheet (_the controller's_).
Correct is also in More (§6.4), so it is findable without knowing the clock is a button.

The bar is a kit part (`ClockBar`, no sport named, AGENTS.md §3 and the lint's `SPORT_MODULES`), drawn from a view
model the sport fills, so hockey can take it (S2 design §5, _a clock part in the kit_).

### 6.2 Team columns

Two columns of equal width, home left, away right (ruling 105). Each, top to bottom:

- The team's name, Barlow Condensed 600, mixed case as typed (AGENTS.md §5's exception for names), up to two lines,
  then an ellipsis. Home carries the lime 3 dp bar the other pads give the first side; away the lilac (`ink3`), as the
  match label does (AGENTS.md §6, C2).
- The score: LED lime digits for the leading side, cream for the other, `tabular-nums` (as the mockup).
- Marks under the score, one row, only when present: a red-card count, a yellow count, a sin-bin mark with the
  player's shirt number. The card icons are the scoring pad's (`cardCaution`, `cardDismissal`, AGENTS.md §5:
  drawings, not status).
- **Goal**, a lime plate with night ink (AGENTS.md §5's rule for primary buttons), then **Card** and **Sub** on
  `surface2`. Goal is three quarters of the height it had in the first mockup, and Card and Sub share the room it gave
  up (ruling 105); the exact split is the builder's, held by a fit test, with every target at least 48 dp tall.

Every button in a column acts for that column's team; there is no team step anywhere on this pad.

### 6.3 The sheets (ruling 106)

`StepSheet`s, one cover at a time, Back to the previous step, Cancel closes with nothing recorded. The bounce guard
(250 ms, S2-2) holds the first step against the second touch of a double tap, and the pad arms again after a sheet
closes (S2-3's `arm()` lesson). Each player row reads `#9 Okafor`: the shirt number from the team sheet (§10), then
the name; with no shirt number, the name alone.

**Goal** — _Who scored? · {team}_: the team's players on the pitch (the fold's `onPitch`), then _Own goal (by {other
team})_ and _Don't know_. A player opens _Assist?_: the same team's players on the pitch but the scorer, then _No
assist_. Own goal opens _Who put it in?_: the **other** team's players on the pitch, then _Don't know_; it records
`{by: <the other team>, ownGoal: true, scorer: <that player>}`: in the engine `by` is the side whose player put it
in, and the goal counts for the other side (`football.ts:1255-1271`; corrected by the plan, the probe agrees). _Don't know_ records the goal
for the team with no scorer. A **penalty** goal is a toggle on the scorer step ("Penalty"), which adds `penalty: true`
and skips the assist step (_the controller's_: a penalty has no assist). Sent when the sheet closes on its last step:
one `football.goal`, the scorer in the same event (the engine's `scorer` is a field of the goal, not a follow-up
event).

**Card** — _Card · {team}_: Yellow, Second yellow, Red. Then the player: on the pitch first, then the bench under a
"Bench" label (the engine allows a bench booking, §4), leaving out anyone already sent off. Then the reason, from the
engine's `CardReason` list (`football.ts:256`), _No reason_ first. One `football.card`.

**Sub** — _Who comes off? · {team}_: the players on the pitch. Then _Who comes on? · for {player}_: the bench, and
with rolling substitutions (the variant's, or `cfg.rollingSubs`) the players who came off before. One `football.sub
{by, off, on, at}`. When the engine says the team has no substitution left (`maxSubs`, `subWindows`), Sub is disabled
with one line, "No subs left" (_the controller's_; the builder reads the engine's judgement rather than counting).

### 6.4 Bottom row

`ToolRow`, at most two cells: **End of period** (its word is what it ends: _Half-time_, _Full time_, _End Q1_ …, _End
of ET 1st half_, _End of extra time_) and **More**. Undo is in the top bar, as on every pad. Before kick-off and while
the shootout runs the row has More only.

**More** (a `StepSheet` list, items only when the match takes them): _Missed penalty · {team}_ ×2, _Sin-bin · {team}_
×2, _Back from sin-bin · #n {name}_ (one per player in the bin), _Shot · {team}_ ×2, _Correct clock_, and _Match
details_ (the kit's `MatchDetailsSheet`, football rows: format, half length, extra time, shootout, subs). A missed
penalty asks taker, goalkeeper and outcome (the engine's list), a sin-bin asks player and reason, a shot asks taker
and outcome. The sin-bin's end is the scorer's tap, as on the web; the player's mark reads "Sin-bin over" once the
clock passes `cfg.sinBinMinutes`, but the pad sends nothing by itself (_the controller's_: an automatic write is a
second authority).

### 6.5 Shootout view

When the fold's phase is the shootout, the columns keep their names, the scores read "5 (4)" (the match score, then
the kicks scored), and Goal, Card and Sub give way to **Scored** and **Missed**, live only in the column whose turn
the engine says it is; the other is dimmed (kicks must alternate, §4). Each opens _Who kicked? · {team}_ with the
team's players and _Don't know_ (the engine's `person` is optional). Under the columns, a row of kick marks per team,
●/○. The deciding kick decides the match, and the pad shows the result as §5 says. _The controller's_ layout; the web
shows kick tiles (`football.tsx:691`).

### 6.6 With no team sheet

When the bootstrap has no slots for a team (the organiser set none, or the web is older than §10), that team has no
players to name (_the controller's_, under ruling 103):

- **Goal** records the team at once, with no sheet, as the web's does; the last-tap line says so, and Undo is there.
- **Card** asks the colour and the reason, and records no player.
- **Sub** is disabled with one line, "No team sheet".
- A missed penalty, a sin-bin and a shootout kick record no player.

The pad says nothing more about it; the organiser's console is where team sheets are made.

### 6.7 Strip, last-tap line, Undo, sync

The strip carries one note at the right or nothing: "Extra time", "Penalties", "Not started". The last-tap line names
the last event with its minute ("Goal · Riverside · #10 Silva 41'", "Sub · Northgate · #8 off, #14 on 61'"). Undo,
the sync badge, the refusal banner, the ask sheet and the match-ended prompt are the kit's, unchanged. Undo voids the
last event this phone recorded, a clock event included.

Home's finished card reads the score first-side-first, with the shootout in brackets: "5–5 (4–1)". Numbers and
punctuation only, as `resultLine` requires (S2-3: no translated words on Home's card) (_the controller's_).

### 6.8 Fit

`footballFit.test.ts`, the S2 fit-test pattern: 320 and 360 dp, four languages. Held: two 24-character team names
wrap to two lines and end in an ellipsis without moving the score or the buttons; the clock's "120+15:00" and the longest
period word fit beside Start/Pause; every sheet row's `#99 ` and a 24-character name; the longest End-of-period word in
each language in a row of two cells.

## 7. The clock

### 7.1 What the ledger holds, and what the web does with it

Start, Pause and Correct are each recorded as a `football.clock {running, at}` event (`pad-host.tsx:2470-2485`,
`publishClock`), and every goal, card, sub and the rest carries `at`, the game time `{period, elapsed}`, `elapsed` in
whole seconds from the start of that period (§4). The engine keeps `clockRunning` and `asOf`, the latest stamped `at`
(`football.ts:660, 2384-2389`), and a period marker sets `clockRunning: false` itself (`football.ts:2407`); it never
reads wall time (`core/clock.ts`).

**The web does not share a running clock between screens** (corrected after the builder check; the brainstorm told
the owner it did). Each web pad keeps its own clock (`clock.ts`): it starts paused; when it does not yet know the
period's time it seeds once from the fold's `asOf`; once its scorer has started or set it, it ignores later stamps
(`reseatClock`, `clock.ts:354-384`); and nothing on the web reads `clockRunning`. What screens share is the minute
each event was recorded at, not the ticking. The owner chose a shared clock given that (ruling 107).

### 7.2 The shared clock (ruling 107)

The anchor is the **latest `football.clock` event** in the ledger (Start, Pause or Correct, from any screen), with two
things it already carries: its `at` (the match time when it was tapped) and its row's `recorded_at` (the server's
time when it arrived, §4). No new table, endpoint or field. From it every screen computes the same reading:

- running: `at.elapsed + (serverNow − recorded_at)`, in `at.period`;
- stopped: `at.elapsed`, frozen;
- no clock event yet in the current period: 0, stopped. A period marker stops the clock in the fold (§7.6), so a new
  period always starts from its own Start.

`serverNow` is the device's own time corrected by an offset the phone measures against the server: from the HTTP `Date`
header on each scoring reply, against the request's midpoint, smoothed over the last few (the plans' finding: no
reply carries `recorded_at`, and an accepted tap stays in the phone's ledger stamped with the phone's own time,
`sync.ts:396-406`; so the phone's own clock events count on its own clock and other screens' on the server's). A phone whose own clock is minutes wrong still
reads the shared time.

**Resync.** The reading is re-derived whenever a read brings a newer clock event (the Realtime nudge already wakes a
read for every new event, S2 design §6.3), so a Pause on the console stops the phone's clock within the read's
latency, and a Correct on the phone moves the console's. Goals, cards and subs never move the clock; only clock
events do. That is the line between this and the web's old rule against re-seating on every event (§7.1): a clock
re-seated from a clock event projects forward to now, so it never "shows the past".

**This phone's own taps** apply at once, locally, before the server has them (the queue's optimistic display, S2
design §6.2): Start shows running from the tap. When the server's copy arrives, the reading moves to its anchor, a
jump of the network delay, under a second online. A clock tap made **offline** is anchored by the server when it
finally arrives, so screens that read it then are off by the time it waited; the phone keeps its own count meanwhile,
and the next clock tap from any screen puts every screen back on one anchor (_the controller's_; a wall-time field on
the event would need an engine schema change, which this work does not make).

It is a pure function in `src/domain/scoring/footballClock.ts`, `reading(anchor, serverNow)`, with the offset and the
timer in the screen's hook, never in the fold. The same arithmetic goes into the web's clock (§10), so the phone and the
console cannot disagree about format or rounding.

### 7.3 Stamping, and never going backwards

A tap is stamped with the clock's reading when it is made, if the clock knows the time:
`at = {period: <the fold's phase>, elapsed: <reading>}`, where `asOf.elapsed` is a floor **only when `asOf` is in the
same period** (_the controller's_, after the builder check). The period always comes from the fold, never from the
phone's own count, since the fold decides it anyway (§4). A clock that has never been told the time stamps nothing:
`at` is optional on every football payload, and absent beats wrong (the web's rule, `clock.ts` `stampOf`).

**A substitution is stamped as the web stamps it** (`football.tsx:282-296`): with the fold's `asOf` when `asOf` is
in the current phase, else with no `at`. Subs with the same stamp count as one window, and with a window cap a new
window past the cap is refused (`football.ts:1376-1393`, `SUB_WINDOW_EXCEEDED`), so two changes at one stoppage must
share a stamp; a live reading would put them in two windows (_the controller's_, the web's rule).

The web refuses an `at` earlier than the newest one (`NON_MONOTONIC_TIME`, §4), which a queued tap overtaken by
another scorer's later events would cause. `payloadForSend` (S2 design §6.2), for a queued tap the ledger does not
yet hold (`copied` false):

- in the **same period** as the ledger's newest stamp and below it: moves `at` up to it, never down;
- in an **earlier period** than the ledger's phase: drops `at` and sends the event unstamped, rather than move a
  first-half goal into the second half;
- a substitution is restamped by its own rule above, at send.

`expected_seq` turns any race into a 409 and a re-read before `NON_MONOTONIC_TIME` can arise; what matters is that
the fold judges queued taps with their corrected stamps, so an offline tap is never dropped before it is sent (the
plan's finding).

### 7.4 What the scorer sees

Match time (ruling 108): `MM:SS` counted from the start of the match. The second half starts at 45:00 (from
`cfg.halfMinutes`), extra time at 90:00, each quarter at the sum of the ones before (`cfg.periodSeconds`, variants).
Past a period's nominal end the clock reads the time passed in added time, "45+1:20", "90+2:30" (ruling 109). Events in the
last-tap line and the sheets name the minute the same way ("67'", "90+3'"). Only the display adds the earlier periods'
lengths: `at.elapsed` stays seconds within the period on the wire, as the engine requires. The arithmetic is one pure
function, `matchTime(at, cfg)`, written once for the phone and mirrored in the web (§10); the builder reads the
quarter period names in `core/time.ts` before writing its table.

### 7.5 Correct

A sheet with the reading, four steppers (−1 min, −10 s, +10 s, +1 min, as the web's, `pad-host.tsx:1216-1295`) and
**Set**. Set records `football.clock {running: <unchanged>, at: <the corrected reading>}`. A correction below the
ledger's newest `at` cannot be recorded (the web would refuse it), so the backward steppers stop at that floor and the
sheet says "Can't go before the last event" (_the controller's_; the builder checks whether the web's Correct has the
same floor).

### 7.6 Periods

**End of period** records `football.period {phase, at}`, one event; the fold stops the clock on a period marker
itself (`football.ts:2407`), and the phone's clock stops with it. **Start** in a new period records `football.clock
{running: true, at: {period: <the new phase>, elapsed: 0}}`.

## 8. Taps and events

| Tap                        | Event                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Start match (not started)  | `core.start {}`                                                                              |
| Start / Pause              | `football.clock {running, at}`                                                               |
| Correct · Set              | `football.clock {running, at}`                                                               |
| Goal                       | `football.goal {by, scorer?, assist?, ownGoal?, penalty?, at}`                               |
| Card                       | `football.card {by, person?, color, reason?, at}`                                            |
| Sub                        | `football.sub {by, off, on, at}`                                                             |
| End of period              | `football.period {phase, at}` (the fold stops the clock, §7.6)                               |
| Missed penalty             | `football.penalty {by, taker?, goalkeeper?, outcome, offence?, at}`                          |
| Sin-bin / Back             | `football.sinbin.start {by, person?, reason?, at}` / `football.sinbin.end {by, person?, at}` |
| Shot                       | `football.shot {by, taker?, goalkeeper?, outcome, at}`                                       |
| Shootout · Scored / Missed | `football.shootout.kick {by, person?, scored}`                                               |
| Undo                       | `core.void {event_id}` (the kit's, unchanged)                                                |

Every write carries `{sport: "football", epoch: 4}` and the rules version, as every S2 sport's does. The payloads are
read from `football.ts:241-451` and each was accepted on staging (§4); the plan types them from the engine's own
schemas (`FOOTBALL_EVENT_SCHEMAS`, `football.ts:474-485`), never a copy. The engine's `minute` field is not sent (the
fold never reads it).

## 9. The app's side

Football is one more sport behind `ScoringSport` (S2 ruling 38): its own module set and screen, nothing generic
naming it (the lint's `SPORT_MODULES` gains the football group). The file plan, _the controller's_ sketch:

- `src/domain/scoring/footballSport.ts`: the `ScoringSport` row, key `football`, epoch `foldEpochOf('football')`.
- `footballEngine.ts`: the bootstrap's sides and team sheets as the engine's `LineupSlot`s (`slot`, `squadNumber`,
  `positionKey`, `orderNo`, `role`, `roles`, from §10's fields), built as the web's server fold builds them
  (`server/engine-db/lineups.ts:64-79`), so the phone and the console fold the same pitch. A team with no slots is
  folded as all starting and shown team-only (§6.6): folded with no lineup, a goal naming a player from the console
  would make the ledger unreplayable on the phone (`football.ts:1260-1267`; the plan's finding). The set-based sports' `setBasedEngine.ts` is not touched.
- `footballFold.ts`, `footballEvents.ts` (taps → events; `payloadForSend` with §7.3's restamp), `footballPad.ts` (the
  display → the pad's view), `footballClock.ts` (§7.2, pure), `footballHistory.ts`.
- `src/ui/screens/FootballMatchScreen.tsx` and `FootballPadScreen.tsx`; rows in `sports.ts` and `scoringScreens.ts`.
- Kit: `ClockBar` (§6.1) and what the columns need. The kit's `PadView` is shaped for two halves; football needs
  columns, a clock and a shootout row. A second view variant in the kit, or the football screen composing kit parts
  itself, is the builder's call, held to AGENTS.md §3 (the kit names no sport) and §12 (three levels of JSX).
- `src/domain/scoring/wire.ts`: the bootstrap's lineup row reads §10's new fields as optional and keeps `pair_order`
  exactly as it is.
- Dictionaries: `scoring.football.*` in en; es, fr and nl as drafts the owner has not read (S2-3's rule: no `_review`
  markers).
- Record lines (period, event type) go on the scrub allow-list (S2-3's lesson); player ids and names never go in the
  record.

The four questions (AGENTS.md §10), for the plan's tests: a second call (a double tap on Goal, a second Start while
the first is queued); an empty input (no team sheet, no shirt numbers, no extra time, a team of five); an interruption
(backgrounded mid-sheet, a process death with the clock running and taps queued, a `NON_MONOTONIC_TIME` refusal);
another mode, orientation or language (four dictionaries at 320 dp).

The main checkout's `node_modules` has engine 1.1.0 against the 2.0.0 pin (S2-3's warning, confirmed by the recon):
the builder installs in its own worktree.

Shared files with S2-3 (chess, PR #42) and S2-4 (cricket): the sport tables, `SPORT_MODULES`, AGENTS.md §1/§3, the
glossary and the dictionaries. Whoever rebases second resolves the tables; a change to AGENTS.md §1/§3 or the glossary
is told to the other session before it is pushed (agreed with S2-4, 2026-11-07).

## 10. The web side

One change in `onryde/seazn.club`, on its own branch and PR, owned by this work (ruling 103):

- `apps/web/src/server/usecases/device-link-bootstrap.ts` (the lineup is narrowed at `:22-23, 52, 58`): each lineup
  row also carries `slot` (`starting` | `bench`), `position_key`, `order_no`, `role` and `roles` from the lineups
  table, and `squad_number` from the entrant's members (`entrant_members`; the lineups table has none,
  `lineups.ts:14-17`, `fixtures.ts:893`), as `readLineup` joins them (`fixtures.ts:891`). `role` and `roles` are there
  because both web folds pass them to the engine (`server/engine-db/lineups.ts:49-50`, `scorepad/registry.tsx:60-86`):
  without them a coach on the starting sheet would count as on the pitch on the phone only, and the phone and the
  console would fold different pitches. `pair_order` stays exactly as it is: table tennis reads it (the web session,
  2026-11-07). `order_no` also closes the table-tennis phone's earlier request #4. Cricket (S2-4) needs the same fields
  from the same file (its batting order is the starting rows with role player, by `order_no`; its stumping offers the
  wicketkeeper from `roles`); one PR serves both, owned by this work, field names exactly as `readLineup`'s, agreed
  with S2-4 on 2026-11-07. No `cfg` change is needed: the bootstrap's `cfg` is the
  effective one the web pad folds with (`resolveFixtureCfg`, stage merge included, `fixtures.ts:123-186`), with no
  sport-specific branch (S2-4, 2026-11-07).
- The bootstrap's route test (`apps/web/src/app/api/v1/device-link/__tests__/route.test.ts`) asserts `side.lineup`
  with `toEqual` and is updated; a new case holds a bench row and a row with no squad number.
- **The console's football clock** (rulings 107, 108), in the same PR: the web pad's clock
  (`components/v2/scorepad/v3/clock.ts`, `pad-host.tsx`) re-anchors on every newer `football.clock` event in the
  ledger by §7.2's arithmetic, in place of `reseatClock`'s "never follow once known" branch, and football's display
  shows match time (§7.4). Football only: `formatClock` and the clock serve other sports (hockey and the rest count
  minutes within a period), so the change is behind football's skin, not in the shared formatter. The web's ledger
  read must expose `recorded_at` to the pad if it does not already (the builder checks). Its clock tests
  (`clock.ts`'s properties) are updated for the new rule, and a new test holds two pads following one anchor.
- No new endpoint, no change to who may read lineups, no change to the events route. The device link still cannot read
  or write a team sheet; it receives the one it is scoring with, as the web's own `/score/{token}` pad already does on
  the server (`app/score/[token]/page.tsx:205-217`).

Order: the web change ships to staging first; the phone tolerates its absence (§6.6), so neither blocks the other's
merge. Production needs the web change deployed before football on the phone is worth releasing. The web session has
no open work on these files; its draft #1135 touches only `server/engine-db/lineups.ts` (2026-11-07).

## 11. Exit bar

On a phone, a local build, against a fresh staging football fixture with team sheets and a started division (the
probe's is spent), the owner's hands where it needs them:

1. Scan, check, Start match, Start: the clock runs on the phone and on the console within a second of each other, in
   match time. A Pause on the console stops the phone's clock; a Correct on the phone moves the console's; a phone
   whose own clock is set five minutes wrong still shows the shared time.
2. A goal with scorer and assist, an own goal, a penalty goal, a goal with _Don't know_: each on the console with the
   right team, player and minute.
3. Yellow, second yellow, red on named players; a booking from the bench.
4. A substitution: the player who came on is then offered as a scorer, the one who came off is not. Rolling subs on a
   small-sided fixture: the player who came off comes back on.
5. Half-time, the second half's Start, a Correct, a Pause and Start. A second scorer (the console) records events in
   between, and no phone event is refused for time (§7.3).
6. A level full time into extra time, then the shootout; kicks alternate; the deciding kick decides it; Undo of the
   deciding kick reopens it.
7. A fixture with no team sheet: Goal and Card record the team only; Sub is disabled.
8. 320 dp, the four languages.
9. Offline: three taps queued with the clock running; back online, all accepted, in order, minutes intact.

## 12. Open for the owner

None blocking. Not in this work unless the owner adds it: the public scoreboard and match pages are not changed;
whether they also show football in match time is the owner's call after this ships. For the web, not this work: the probe's "not in this squad" for a sent-off player's substitution is a
misleading message (§4); the controller tells the web session.

## 13. Left to the builder

- The exact Goal/Card/Sub height split (ruling 105's three quarters), held by the fit test.
- The quarter period names (§7.4), the `NON_MONOTONIC_TIME` retry (§7.3), and Correct's floor against the web's
  (`adjustClock`'s guard, §7.5): each read from the engine or the web, then recorded in the plan.
- A `PadView` variant or composition (§9).
- The shootout's ●/○ row and the "Sin-bin over" mark's drawing.
- Football's Match details rows.
