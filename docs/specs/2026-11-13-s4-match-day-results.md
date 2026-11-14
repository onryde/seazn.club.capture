# S4 Match Day — device exit bar (results)

The exit bar is the spec's §10 (`2026-11-07-s4-match-day-design.md`). This file is the runbook for the device pass
on 13 Nov 2026 and, once it has run, its results.

## Build and phone

- Build 1142 (`com.seazn.capture.dev`, "Seazn Club (dev)", 1.0.8), from `feat/s4-match-day` at 14dcc984, a local
  release build pointed at staging (stg.seazn.club), installed with `adb install -r` on 12 Nov; replaced on 13 Nov by
  build 1146 (from 00705e06, Task 8c), which ran the pass.
- The owner's NE2211, Android 16.

## What a Match Day code's Day means

A code is minted for one **Day**, the date in the code sheet's Day box:

- **It works from 00:00 to 24:00 on that date**, in the organisation's time zone (S.A.F.E: Europe/London). Scanned
  before 00:00 it does not open yet, and the phone says when it opens. After 24:00 the phone says "Match Day ended"
  and forgets the code.
- **It lists the matches scheduled on that date**, plus any match in play whatever its time, and the day's finished
  matches. A match with no time, or on another date, is not on the list.

So a test on 13 Nov needs matches on 13 Nov and a code whose Day is 13/11. A code minted on 12 Nov for 12/11 stops at
midnight, which is why this pass was moved to the 13th.

## Staging setup (built 12 Nov)

Organisation S.A.F.E, competition **MD Test 13 Nov** (private, 13 Nov only), badminton, every match one game to 15.

| Venue        | Courts           |
| ------------ | ---------------- |
| Chase School | Court 1, Court 2 |
| Hall B       | Court 3          |

**Men's Singles** (Swiss, 2 rounds): Arun Nair, Ben Okafor, Chen Wei, Dev Patel.

| Time  | Court            | Match                                                       |
| ----- | ---------------- | ----------------------------------------------------------- |
| 09:00 | Court 1          | Arun Nair v Chen Wei (round 1)                              |
| 09:00 | Court 2          | Dev Patel v Ben Okafor (round 1)                            |
| 09:30 | Court 1, Court 2 | round 2, paired when round 1 is done (the phone's approval) |

**Women's Singles** (two groups of three, then semi-finals and a final): Asha Rao, Bea Lund, Cara Doyle, Dina Haddad,
Eva Novak, Fay Mensah.

| Time  | Court            | Match                                                            |
| ----- | ---------------- | ---------------------------------------------------------------- |
| 09:00 | Court 3          | Bea Lund v Cara Doyle (B)                                        |
| 09:30 | Court 3          | Asha Rao v Dina Haddad (A)                                       |
| 10:00 | Court 1          | Eva Novak v Asha Rao (A)                                         |
| 10:00 | Court 3          | Fay Mensah v Bea Lund (B)                                        |
| 10:30 | Court 1          | Dina Haddad v Eva Novak (A)                                      |
| 10:30 | Court 2          | Cara Doyle v Fay Mensah (B)                                      |
| 11:00 | Court 1, Court 2 | semi-finals, drawn when the groups finish (the phone's approval) |
| 11:30 | Court 1          | final                                                            |

Round 2 and the knockout were given times in advance, so they show on the list the moment they are drawn.

## Codes to mint on 13 Nov

On the competition's **Open Match Day** desk (it shows from 13 Nov), mint:

1. **Whole competition, Approve ticked**, Day 13/11. The main code for items 1–4, 6, 8 and 9.
2. **Venue Hall B, Approve not ticked**, Day 13/11. Items 5 and 7.

Show the QR on the laptop screen and scan it with the phone. The code's value is never photographed or written down.

## The pass (spec §10)

Steps marked _owner_ need the owner's hands; the controller reads the phone over adb and takes app-only screenshots,
status bar cropped.

| #   | Step                                                                                                                                     | Who                                            | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| 1   | Scan code 1 → the list matches the web desk: Courts 1–3, Now/Next as above                                                               | owner                                          |        |
| 2   | Tap a Now row → the pad; score; ‹ Court → the list. Tap a Next row → the Start screen                                                    | owner                                          |        |
| 3   | Kill the app on the list, and on a pad → it reopens where it was                                                                         | owner                                          |        |
| 4   | Flight mode: score two matches, back, Exit → "taps still sending" and the Sending card; network back → the taps land, the console agrees | owner                                          |        |
| 5   | Scan code 2 → only Hall B's Court 3                                                                                                      | owner                                          |        |
| 6   | Finish Men's round 1 → banner, Review, 3 s hold → round 2 on Courts 1–2. Finish the groups → the same for the draw                       | owner (results may be entered on the web desk) |        |
| 7   | With code 2 → the banner and no button                                                                                                   | owner                                          |        |
| 8   | Withdraw code 1 on the web → the next tile tap says "Match Day code withdrawn"                                                           | owner                                          |        |
| 9   | A match's own scoring QR still opens that match alone                                                                                    | owner                                          |        |

Then a 320 dp pass (`adb shell wm size` / `wm density`, reset afterwards) and the device-only list from the reviews:
row ellipsis, the pull spinner, caution colour, scroll to the court, Back's TalkBack name, Android Back, the hold's
fill and feel, TalkBack on the approval overlay, the Exit glyph and sheet, es/fr/nl on Hermes.

## Results

Run on 13 Nov 2026, 08:50–09:45 (Europe/London), on build 1146 (versionCode 1146, from 00705e06: Task 8c's not-open
sheet and tile line on top of 14dcc984). The owner held the phone; the controller read it over adb (app-only
screenshots, status bar cropped) and read the web desk in Chrome. Codes were minted and scanned by the owner; no code's
value was read, photographed or written down.

| #   | Result | What the phone showed                                                                                                                                                                                                                                                                                                 |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pass   | Courts 1–3 with Now/Next as the desk's board.                                                                                                                                                                                                                                                                         |
| 2   | Pass   | Men's round 1 scored to the end on Courts 1 and 2; ‹ Court returned to the list.                                                                                                                                                                                                                                      |
| 3   | Pass   | Force-stopped on the list → reopened on the list. Force-stopped on Court 3's pad at 9–9 → reopened on that pad.                                                                                                                                                                                                       |
| 4   | Pass   | Offline: 7 taps on Bea v Cara (Court 3), 6 on Eva v Asha (Court 1). ‹ to Home keeps the code (by design; Exit is ⋯). ⋯ → Exit → Home read "Sending 7 taps · Court 3" and "Sending 6 taps · Court 1", tile "Scan the Match Day code". Network back → the desk's ledgers gained exactly 7 and 6 rallies, both Verified. |
| 5   | Pass   | Hall B code: "MD Test 13 Nov · Hall B", Court 3 only.                                                                                                                                                                                                                                                                 |
| 6   | Pass   | Swiss: banner → Review → 3 s hold → round 2 on Courts 1–2 (Arun v Dev, Ben v Chen). Groups: after the desk's Complete stage (F-T8-2), Review → hold → semi-finals Eva v Bea (Court 1) and Asha v Fay (Court 2), the desk's proposal.                                                                                  |
| 7   | Pass   | With the no-Approve code: "Round 1 complete · pair on the web desk", no button.                                                                                                                                                                                                                                       |
| 8   | Pass   | Code withdrawn on the desk → tile tap → "Match Day code withdrawn", tile back to "Scan the Match Day code".                                                                                                                                                                                                           |
| 9   | Pass   | A match's own scoring QR opened that match alone (owner's observation; the phone had left the app before it was read).                                                                                                                                                                                                |

Four group results were entered on the web desk by the controller (Result only → Set score), at the owner's request:
Asha v Dina 15–10, Fay v Bea 15–12, Dina v Eva 8–15, Cara v Fay 11–15.

### Findings

- **F-T8-1** (copy): tapping a match never opened on this phone while offline shows only "Offline". Rec: "Offline · open
  this match once you're back online".
- **F-T8-2** (product): the knockout draw is offered only once the desk marks the group stage complete
  (`seedingSourceReady` needs the source stage's status `complete`); every group match decided is not enough, and the
  phone says nothing meanwhile. Rec: a banner line "Groups done · complete the stage on the web desk".
- **F-T8-3** (inert seam): the day read carries `round_label` and the phone parses it (`Row.roundLabel`), but no screen
  draws it. Owner asked for it on every row ("R1", "SF1", "F1").
- **F-T8-4** (owner request): a seat with no entrant reads "To be decided"; the owner wants the web's wording ("Winner of
  Group A", "Winner of SF·1"). The day read does not carry slot labels yet: a web contract change.
- **F-T8-5** (product): every finished match of the day is listed under its court. Rec: the latest one, then "+N more
  finished".
- **F-T8-6** (web): the desk's free-court panel said "Nothing is waiting to be played here today" for Court 1 while the
  court list showed the semi-final queued on it. Suspected stale candidates after the draw; reload check pending.

All six are fixed: F-T8-1 and F-T8-5 in task 8d-A, F-T8-2, F-T8-3 and F-T8-4 in task 8d-B (with web #1207's
`round_tag`, slot labels and `waiting`), F-T8-6 in web #1207 (candidates per division).

Second device pass, 13 Nov afternoon (builds 1211–1215, after the rebase onto 1.0.10), owner's phone, staging:

- **F-T8-7** (layout, fixed 255555ea): the round chip stood over Next's label but beside a finished row's names, and the
  call sheet indented its rows by an empty label column, cutting the names. The chip now sits just before the names in
  every row kind.
- **F-T8-8** (copy, fixed 011d7f3a + web #1209): "draw" for the knockout's seeding reads as a drawn match to a scorer
  (owner: "does it confuse with match draw?"). English says _bracket_ on the phone; the desk's tick is "Approve
  pairings and brackets".
- **F-T8-9** (layout, fixed b206293f): Call was a full-width button under the rows (owner: "a small button beside
  Free"). Call and Undo are now compact buttons beside the court's state chip; a row's label hugs its word, so there is
  no gap between "Next" and the chip.
- **F-T8-10** (data, not a defect): Court 3's Call list showed one match. Men's Singles was set to Courts 1–2 only, so
  its R2 was not a candidate for Court 3 (the web's `callableCourtsByFixture`, the scheduler's own court set). The owner
  had Court 3 added to Men's Singles on staging; the list then showed both.
- **F-T8-11** (layout, fixed 6930dda4): a light hairline between matches in the call sheet (owner request).
- **F-T8-12** (copy, fixed 4ba0dae3 + web #1212): a candidate already CALLED to another court read "Next on Court 2",
  the same as one only queued there. The web's candidate now carries `called` (the desk's own rule), and the phone reads
  "Called to Court 2" (es _Convocado a_, fr _Appelé sur_, nl _Opgeroepen naar_); a web without the field reads as not
  called.
- **F-T8-13** (copy, fixed 2a49a492): the quiet preview's "No knock-on" read as jargon (owner: "No Knockon mean?"). It
  now says "No other match moves" (es _Ningún otro partido cambia_, fr _Aucun autre match ne bouge_, nl _Geen andere
  wedstrijd verschuift_), and the loading line says "Checking the other matches…".
- **F-T8-14** (layout, fixed cf9bac67): the day list had no dividers while the call sheet did (owner: "why don't have
  divide line in match day screen in app?"). Every match after the first in a court's queue or finished list now has a
  hairline above it, and the Finished heading carries one too.

Call to court on build 1215, staging, in portrait (§7a below). The controller drove the phone over adb, read it in
app-only screenshots and used test data in S.A.F.E:

| #   | Result  | What the phone showed                                                                                                                                                                                                                                                                                |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pass    | With the tick: a small Call beside Free.                                                                                                                                                                                                                                                             |
| 2   | Pass    | Court 3 → Call → R2 Ben Okafor v Chen Wei. The preview said there was no effect on other matches. A release at 1 s called nothing. The full hold called it: Called, Now 18:49.                                                                                                                       |
| 3   | Partial | Undo on this phone's call: the confirm read "Undo call? … goes back to where it was", with Keep first. Both Keep and Back kept the call. Undo call put R2 back to Next on Court 2 09:30, and Court 3 read Free. The desk-made refusal was not run: the owner's own F call on Court 2 was left alone. |
| 4–5 | Not run | They need the desk to act while the phone's sheet is open.                                                                                                                                                                                                                                           |
| 6   | Pass    | Back during the hold closed the sheet and called nothing. TalkBack was dropped from this pass (owner: "no need TalkBack").                                                                                                                                                                           |
| 7   | Pass    | nl and fr fit in the list, the sheet, the preview and the hold plate. The app was put back to English afterwards.                                                                                                                                                                                    |

### The closing pass (14 Nov)

Run on 14 Nov 2026 on build 1241 (from d1b0379e, PR #57: the court's day #55, the venue line #56 and the division line
#57 on main 1.0.12), staging, portrait, with a code for "Club Day 14 Nov" (S.A.F.E; 5 divisions on 4 shared courts)
minted and scanned by the owner. The controller drove the phone over adb (app-only screenshots) and the desk in Chrome.

| Check                       | Result  | What the phone showed                                                                                                                                                                 |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Division line               | Pass    | Every row names its division under the names (Men's Singles A, Women's Singles, …), ink2, dimmer on a finished row; a row reads "R1, Men's Singles A, Next, …".                       |
| A court's day, full queue   | Pass    | Court 1: Next, Then and five more unlabelled, each with its division and time, then the latest finished. Android Back returned to the list. The venue is said once (#56).             |
| A match opened from its day | Pass    | A row in Court 1's day opened its pad; ‹ returned to the list, the day closed.                                                                                                        |
| 320 dp (`wm density 540`)   | Pass    | List, a court's day and the Call sheet fit: long names and "Court 1 (Sports H…" end in an ellipsis, nothing overlaps. Density reset afterwards.                                       |
| §7a 3, a desk call          | Pass    | A call made on the desk showed as Now with Undo; Undo call → the sheet closed, the call stayed, and "Called from the web desk — ask the organiser to undo it" stood under the header. |
| §7a 4                       | Pass    | Undo's sheet open, the desk undid the call: within a poll the sheet read "Court 1 (Sports Hall) is no longer called" with Close only.                                                 |
| §7a 5                       | Partial | The refusal's line was gone after the next good read. The Offline line was not run: it needs the phone's network switched off.                                                        |
| "+N more" in a court's day  | Not run | The day had one finished match per court. The same rows are tested in jsdom, and the list's "+2 more finished" was seen on 13 Nov.                                                    |

Two findings, both web, neither blocking:

- **F-T8-15** (web, day read): a call outlives its day. Court 3 was called from the phone on 13 Nov at 22:16, which
  moved the match to 13 Nov; on 14 Nov the day read gave Court 3 `called` with `now: null` (the match is not on the
  code's day), so the phone showed CALLED with nothing on the court and no Undo, while the desk showed the match and its
  Undo. The controller undid it on the desk. Rec: the day read lists a called, unstarted match on a court in scope as
  `now` whatever its date, or a call lapses at the end of its day.
- **F-T8-16** (web, copy): a candidate later in another court's queue reads "Next on Court 1" though it is third there
  (desk and phone alike: the phone prints the web's `other_court`). Rec: "Queued on {court}" for any but the first.

### Status

Match Day is closed on the phone (owner, 14 Nov: "close after tomorrow's test"). It needs the web on production before
an organiser can use it: seazn.club answers 404 to the Match Day calls (last web production deploy v1.0.8-beta,
11 Nov), so v1.0.12 on Play's internal track runs Match Day against staging only. Backlog: F-T8-15, F-T8-16, §7a 5's
Offline line, the flaky `ScoreHalf.tennisStill` test (failed once under load), and the split of `HomeScreen.test.tsx`.
TalkBack is out of this pass on the owner's word.

Calling a match to a court (S4 design §7a; final review 8), on a local build, staging, in portrait:

1. A code minted WITH "Call matches to courts": a free court shows a small Call beside Free; a code minted without the
   tick shows no button anywhere (the court, the list, the sheet). With the tick: seen on build 1213–1215 (Pass).
2. Call a match: the candidates list (a blocked row dimmed with its reason), a tap on one shows the preview, one line per
   warning; "Hold to call" fills for 3 s and calls, an early release calls nothing. The court reads Called with the match
   in Now within one read, also on a weak cell.
3. Undo call on a call this phone made: the confirm (Keep first), then the match is back where it was. A call made at the
   web desk: Undo is refused, "Called from the web desk — ask the organiser to undo it".
4. Undo's sheet open while the desk starts the match or moves the call: within a poll it says "{court} is no longer called"
   with Close only.
5. A line from Undo ("Offline", "It has moved since — refreshing") is gone after the next good read; a refusal's reason
   stays for one poll.
6. Android Back mid-hold closes the sheet and cancels it; Back on Undo's sheet is Keep. TalkBack: the list beneath is
   unreachable; "Call a match, Court 2" and "Undo call, Court 2" are spoken, one per called court.
7. nl and fr on the hold plate and the candidate's place line: they wrap, they are not cut, on the owner's phone.
