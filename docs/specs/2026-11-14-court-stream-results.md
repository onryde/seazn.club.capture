# Court stream — results

Status: the phone side is built and merged (#60, then #62 on top of it) and the device check ran on 2026-11-16 and
2026-11-17. The exit table below passes the items it has evidence for; the rest is listed Pending with what would prove
it. Design `docs/specs/2026-11-14-court-stream-design.md`, plan `docs/superpowers/plans/2026-11-14-court-stream-phone.md`
(ledger of record: `.superpowers/sdd/2026-11-14-court-stream-phone/progress.md`, git-excluded). The owner's OnePlus NE2211,
Android 16, the dev twin `com.seazn.capture.dev`, local builds, staging (stg.seazn.club), engine as pinned on main.

Evidence is labelled: **device** is read on the phone or in its session record on 2026-11-17; **ledger** is a result the
phone ledger records; **CI** is a green check on the pushed branch. The web's own PRs are cited by number as the ledger and
the device notes name them; their state is the web repo's to say. No stream code, token, destination or channel name is in
this file.

## What was built

| Where | What                                                                                                                                                                                                          | Landed                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| web   | #1235: the court link, the per-match Stream switch, the resolver and the beat answers                                                                                                                         | `c0577abb78` (ledger)                |
| web   | #1240: O15's 30 s tail, O16's desk countdown, a composed court test, a private competition with no live link, a linked free court's whole queue                                                               | CI green (ledger)                    |
| web   | #1242 and #1244: the start no longer waits in the beat and a linked court polls within 10 s; O17; YouTube's broadcast completes after the phone stops. #1246: the score timing and Next. #1247: `autoRefusal` | named by the device notes below      |
| phone | #60 `feat/court-stream`: Tasks 1 to 12, then the device check's fixes (N44, the beat retry and the start in flight; N38's pins)                                                                               | `a87b2ef5`, released in 1.0.14 (#61) |
| phone | #62 `fix/camera-taken-on-air`: N45 (another app takes our camera on air) and E2 (the waiting line says why an automatic start was refused)                                                                    | `3a2bd398`                           |

### The phone's batches (ledger)

| Batch   | Tasks                                              | Commits                                                                                                                                   | Counts                                     | Review                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1      | 1 to 4 (contracts, readers, pair intent, snapshot) | `2107cb2b`, `2697b9b4`, `7af3d7f5`, `eee116f4`                                                                                            | Kotlin 1461/0, TS 955/0                    | Opus: approved, 0 Critical, 0 Important, 5 Minor.                                                                                                                                                                               |
| P2      | 5, 5b, 6 (court Stop, no Forget, fake engine)      | `14eab160`, `4bf224de`, `74004ffa`, minors `c3e7c550`                                                                                     | scoped, mutants killed                     | Opus: approved, 3 Minor, plan gaps G1 and G2 (RP4, RP5).                                                                                                                                                                        |
| P3      | 7 to 9 (waiting screen, Exit, Continue card)       | `4b7fb073`, `5af43e54`, `6e72e22f`, minors `b8a5d6f0`; fix `9a326db8`, `0e6299d8`, `8a79c691`, `b7f971ea`                                 | scoped 401/401                             | Opus: T8 changes (I1, a refused forget on Leave was silent, RP7); the fix round re-reviewed clean.                                                                                                                              |
| P4      | 10 to 12 (scoring label, stale guard, AGENTS)      | `881b8b39`, `8fcb3b43`, `92ed6949`, minors `7bc941a1`; fixes `71e31bcb`, `898ea7ff`, `fef3cb0f`, `92d7d2c7`                               | Kotlin 177/177, TS 780/780, i18n 213/213   | Opus: I1 (an unpair give-up forgot a still-paired code), I2 (CI typecheck). Whole branch: ready after I1 (`52d4b6c7`) and I2 (`3834d94a`); 2087/2087 over 50 unpair and Forget files, 5/5 mutants. CI at `3834d94a`: all green. |
| Task 13 | the device check's fixes                           | N38 pins `40ecdaa4` to `12359c5f` (3 rounds); N44 `3b56c9bc`, `33f33219`, then `0a1f90e4`, `fc23ef80`, `867f1448`, `99d24cdd`, `32b6448a` | scoped, reviews clean                      | Opus review of the pins, and of N44's two fix rounds, clean.                                                                                                                                                                    |
| #62     | N45 and E2                                         | `ed29dfba` to `b4c0b5fb` (N45), `914edfad`, `ad6e5310`, `4705cd72`, `e9fbda8a` (E2)                                                       | touched Kotlin classes 171/0 (re-review 3) | Four review rounds; re-review 3 leaves one Minor (R3-M1, the misplaced KDoc, fixed in `fe7b1e1b` on this branch).                                                                                                               |

## Rulings

### O1 to O17 (the owner's)

The owner's words for O1 to O16 are in the design's §2 and §9; this table points at them.

| #   | Ruling                                                                                                                                                          | Where                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| O1  | One scan pairs a phone to a court; it then streams and stops each match by itself.                                                                              | design §2, §4                     |
| O2  | Each match is its own broadcast: own session, YouTube video and recording.                                                                                      | §2, §5.3                          |
| O3  | A per-match Stream switch on the desk, off by default.                                                                                                          | §5.2                              |
| O4  | A court code lasts the venue's day.                                                                                                                             | §5.1                              |
| O5  | The 3 s Stop hold ends this match's video only; Exit (⋯, asks first) unlinks the phone.                                                                         | §6.3                              |
| O6  | No waiting on the old video: starting the next streamed match ends the old one.                                                                                 | §5.4                              |
| O7  | The court phone offers the next called match's scoring QR to its scorer.                                                                                        | §5.6, §6.4                        |
| O8  | That QR shows only on a tap.                                                                                                                                    | §6.2                              |
| O9  | A court's destination is a connected YouTube account, never a plain key.                                                                                        | §5.1                              |
| O10 | A tap shows the court's next called match, streamed or not.                                                                                                     | §5.6                              |
| O11 | O2 supersedes the web Match Day design §8's court-idle card.                                                                                                    | §9 (Q1)                           |
| O12 | The notification's Forget is hidden on a court pairing; Exit is the only way off.                                                                               | §2; AGENTS §9 (Task 12, RP5)      |
| O13 | The server refuses a court code from a build without court support, with a refusal old builds already show.                                                     | §2                                |
| O14 | The Stream switch also shows on a linked court's waiting-to-be-called rows.                                                                                     | §9                                |
| O15 | A court-bound match's video stops 30 s after its result; per-fixture codes keep 180 s.                                                                          | §5.4, §9                          |
| O16 | The desk's Court card counts the tail down ("Video ends in N s").                                                                                               | §9                                |
| O17 | Stream switched off on a live match stops its video at once, with no tail. Owner, 2026-11-17: "switching Stream off should stop the video now". Measured below. | this file; design §9 stops at O16 |

### Other words of the owner's (ledger)

- 2026-11-16, "nobody is using app now and matchday, so don't assume for backfilling or making workaround for them": the
  pre-court saved code's gap (P1 M4) is dropped, and no compatibility or backfill work was built.
- 2026-11-16, "no Forget on court card is fine": confirms RP4 below.
- 2026-11-16, "Hope we are running scoped tests": from the P2 dispatch on, scoped tests only; full suites are CI's.
- 2026-11-16, "fix", to the device check's triage (the findings below).
- 2026-11-17, "yes", to fixing the start delay (a linked court polls within 10 s, the start prepared off the beat, a timed-out
  beat retried soon), the unlink-forget, the desk's "Updated N s ago · Refresh", and YouTube ending about 30 s after the phone
  stops; and to checking the Go live in-flight confusion on the phone (N44).
- 2026-11-17, "Ok", to the refusal line (web #1247's `autoRefusal`, phone #62), design §6.2.
- Infrastructure the owner did: the staging Cloudflare Access bypasses (2026-11-16) and `COURT_MIN_APP_VERSION` on staging,
  set to `1.0.13-1277`.

### The controller's rulings (ledger)

| Ruling                                                                                                                                                                                                                                       | Cost if wrong                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| RP1: Task 1 (vendoring the contracts) runs first, since the web had merged; new vector rows carry no `contractValid:false` flags.                                                                                                            | None.                                                        |
| RP2: every verification command runs in the worktree, never the main checkout (the plan's Kotlin path pointed at main).                                                                                                                      | Tests run against main.                                      |
| RP3: P1 minors M1, M2, M3 and M5 fold into batch P2.                                                                                                                                                                                         | None.                                                        |
| RP4 (G1; the owner's "no Forget on court card is fine"): Home's Continue card shows no Forget on a court pairing; Exit on the waiting screen is the only way off.                                                                            | One more tap to leave from Home.                             |
| RP5 (G2): Task 12 amends AGENTS §9 for O12.                                                                                                                                                                                                  | —                                                            |
| RP6: P2 minors m2 and m3 (tests) fold into P3; m1 (a Kotlin record line) folds into P4.                                                                                                                                                      | —                                                            |
| RP7: a refused forget on Leave is never silent (notice, then Home), overriding the brief's record-only handler (S0 R19, AGENTS failure class 3).                                                                                             | —                                                            |
| RP8: the Next line's label is cut by how wide it draws, not by a count of characters, so the time stays; the "24 characters" wording goes from the docs.                                                                                     | —                                                            |
| RP9: the other-mode sheet's unpair follows `codeStays`: a still-paired code is kept, the app stays on Home and does not open the other mode.                                                                                                 | —                                                            |
| RP10: the P4 fix rounds' scoped re-review folds into the whole-branch review.                                                                                                                                                                | —                                                            |
| RP11: the whole-branch review's I1, I2, the stale comments and the RP4 citation are fixed; the optional line for a give-up that keeps the code is not built (four languages of copy for a race of 5 s or less; the record has the line).     | A silent retry in that race.                                 |
| RP12: concern 2 (an idle engine with a saved code left on `/stream` after a late idle answer) is accepted as theoretical and watched on the device.                                                                                          | The operator presses Back.                                   |
| The failed-beat retry backs off 5, 10, 20 s, then the cadence, for a transport failure, a give-up, a 408 or a 5xx; every failure takes a step and only a 2xx resets (fix rounds 1 and 2; design §6.6).                                       | A slower recovery (up to 20 s) after three or more failures. |
| The device check's triage: 7 (handover order) and 10 (no switch on a no-court row) are by design; 9 a linked free court lists its whole queue with switches (O14's intent); 5 native carries pair and start lines as restart-surviving pins. | 9: a longer panel on a linked court, reversible.             |
| Restored record pins come back closed after a process death, and only the kept broadcast start is restored (D1); the start's sid makes the web keep the session's lines.                                                                     | Lines of a restarted process go unkept, as before the fix.   |
| The desk countdown shows only while the court session is `live`, not `ending`.                                                                                                                                                               | —                                                            |
| Web B: busy shows only on a manual Refresh (a "Refreshing" flash every 20 s is noise); `min-h-11` stays (touch target); the 30 s end is best effort on Fly, with the cron as the guarantee.                                                  | —                                                            |
| Web A fix round 2: a retry after the commit is a no-op; no faster re-claim after an end (double-prepare risk); a fixture code's 401 after a reissue is folded in.                                                                            | —                                                            |
| An automatic start's refusal says its own line on a court's waiting screen, and Automatic off and a missing destination speak over every word, since the web retries a court only while the phone is automatic (E2 fix round 1, I1).         | —                                                            |
| N45: a probe asks Camera2 whether our camera opens (never the transport); the app's return goes through the 30 s floor; Stop and unpair abandon a probe and never wait behind it (R2-M1, R2-M2).                                             | A held camera for a few seconds on a return.                 |

## The device check

On the owner's NE2211 against staging: a court linked on the Match Day desk, matches switched on, the phone scanned to the
court and mounted. The owner's hands held, scanned and pressed; the session record and the desk were read alongside. The
first pass (2026-11-16) found the problems triaged below and raised O15 and O16. These figures are from the second
(2026-11-17), after web #1242 and #1244, unless marked.

| Measure                                                          | Measured on the device                                                                                                                                                                                                 | Before                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Scorer's Start to the phone live                                 | 16, 18, 14, 14 and about 10 s.                                                                                                                                                                                         | 67 s to 1 min 47 s.                    |
| The phone off air after the result (O15)                         | 30 to 33 s.                                                                                                                                                                                                            | 180 s (a per-fixture code's tail).     |
| YouTube's broadcast complete                                     | At most 45 s after the phone stops (#1244).                                                                                                                                                                            | About 5 min (the cron alone).          |
| Stream switched off on a live match (O17)                        | Off air in 3 s; switching it back on does not restart the video.                                                                                                                                                       | —                                      |
| The court unlinked while live                                    | The match finishes on air, the phone is told `over`, and a 401 comes about 10 s later.                                                                                                                                 | —                                      |
| Scorebug against the picture                                     | At the default 3.1 s the scorebug changed 4 s and 4.5 s after the picture (2 samples). A court's phones now use 0 s (#1246): about 2 s after the picture (1 sample; YouTube's DVR frames 112.0 uncover, 114.0 change). | —                                      |
| "Next: <match>" on a court start                                 | Shown during a court start (#1246); a full clean start with it is still to be re-checked.                                                                                                                              | —                                      |
| A refused start (the owner had disconnected the YouTube account) | The waiting screen said "No streamed match yet". Fixed: web #1247 `autoRefusal`, a null `destinationName` when the target is archived, and the phone's refusal line (#62). **Not yet seen on a device.**               | The line above, which hid the refusal. |
| Another app opens our camera on air (N45)                        | Before: a stall, a reconnect loop of three uplinks in 13 s, only the server's slate covered viewers. Fixed in #62 (the phone's slate, a probe, no transport rebuild). **Not yet seen on a device.**                    | See `_FINDINGS.device.md` N45.         |
| Operator Stop holds at 14:48 and 16:34                           | Each ended its match early. The owner's own hand; not a defect.                                                                                                                                                        | —                                      |

### Findings of the device check

The ledger numbers the triage's findings; it records these.

| ID  | Finding                                                                                                                                                             | Resolution                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | The record kept 0 lines across a reload: N38's ring reset.                                                                                                          | Native carries the pair and the latest start line as restart-surviving pins (`40ecdaa4` to `12359c5f`). Send still never reads the whole disk file; N38's remainder is parked.      |
| 7   | The handover order: the server starts the new session then ends the old one; the phone tears A down before arming B.                                                | By design (design §5.4).                                                                                                                                                            |
| 9   | A linked free court showed nothing to switch on.                                                                                                                    | The controller's ruling: its whole queue lists with switches (O14's intent).                                                                                                        |
| 10  | No switch on a row with no court.                                                                                                                                   | By design.                                                                                                                                                                          |
| —   | The start waited up to about 2 min: the start-carrying beat timed out because the server awaits `startBroadcast` inside the beat, and an idle court polled at 60 s. | A linked court polls within 10 s, the start is prepared off the beat, and the phone retries a timed-out beat soon (N44). Measured: 10 to 18 s.                                      |
| —   | YouTube's broadcast completed only through the stream-tick cron.                                                                                                    | It now completes about 30 s after the phone stops (web #1244). Measured: 45 s at most.                                                                                              |
| —   | After a lost beat the phone was deaf to a Go live for a minute, and a held Go live looked like nothing happened.                                                    | N44 (`_FINDINGS.device.md`): the 5, 10, 20 s retry; `pairing.starting` and a disabled "Starting…"; Leave, Forget and A7's Confirm wait out a start in flight. Device re-check open. |
| —   | The match line read "No streamed match yet" over a refused start.                                                                                                   | Web #1247 and the phone's refusal line (#62, design §6.2). Device check pending.                                                                                                    |
| —   | Another app opening our camera on air made the phone reconnect.                                                                                                     | N45 (`_FINDINGS.device.md`), #62. Device check pending.                                                                                                                             |
| —   | The Go live in-flight confusion on the phone (the owner's request to check).                                                                                        | The same fix as N44's silent hold.                                                                                                                                                  |

Infrastructure the check needed: staging's Cloudflare Access bypasses for `/api/internal/relay/*`, `/overlay/*` and
`/_next/static/*` (the runner's calls and the compositor's overlay page), done by the owner on 2026-11-16, and the court
code's app-version floor on staging. **Production needs both before its first composed stream.**

## Exit table

The exit bar is the plan's Task 13 and the design's §7 cases. Pass needs evidence named in the last column; Pending says
what would prove it.

| #   | Item                                                                                                  | Result               | Evidence or what would prove it                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The branch is green: scoped suites, mutants, the whole-branch review, CI                              | **Pass**             | CI at `3834d94a`: check, kotlin-core, bridge-contract, assemble-debug (the first compile of `PairingKeeper.kt`) and CodeQL all green; the whole-branch review ready after its two fixes. (ledger, CI)               |
| 2   | A court linked on the desk, matches switched on, a phone scanned to the court (Task 13 steps 1 and 2) | **Pass**             | Five court starts were timed on 2026-11-17 (above). (device)                                                                                                                                                        |
| 3   | The court phone goes live by itself on the scorer's Start                                             | **Pass**             | Live 16, 18, 14, 14 and about 10 s after Start. (device)                                                                                                                                                            |
| 4   | The video stops after the result, and nothing follows (O15; YouTube's end)                            | **Pass**             | Off air 30 to 33 s after the result; YouTube's broadcast complete at most 45 s after the phone stops. (device)                                                                                                      |
| 5   | Stream switched off on a live match stops it (O17)                                                    | **Pass**             | Off air in 3 s; on again does not restart. (device)                                                                                                                                                                 |
| 6   | The link withdrawn while live (design §7, case 3)                                                     | **Pass** on the wire | The match finished on air, the phone got `over`, then a 401 about 10 s later. What the phone's screen read after the 401 was not recorded: Pending. (device)                                                        |
| 7   | The scorebug lines up with the picture                                                                | **Pass**, one sample | About 2 s after the picture with a court's 0 s setting, from 4 to 4.5 s at the default. One sample; a second would close it. (device)                                                                               |
| 8   | "Next: <match> · <time>" on the waiting screen and during a live court start, in English              | Pending              | The line showed during a court start (#1246). A full clean start with it, and the waiting screen's "Court N" line, are to be re-checked. Screenshot of each, status bar cropped.                                    |
| 9   | The same in es, fr and nl                                                                             | Pending              | Settings, then the language, then a screenshot of the waiting screen in each. The fit is pinned in jsdom (`stripTextFit`); only the picture is device-only.                                                         |
| 10  | The scoring panel names its match; the round line reads "Court N · stage" (Task 13 step 4)            | Pending              | A tap on Remote scoring on a court phone with the next match called; the panel title and the round line on the next start.                                                                                          |
| 11  | The Stop hold keeps the court (Task 13 step 5)                                                        | Pending              | Two holds ended matches (14:48, 16:34); the return to waiting with the court kept was not recorded. Hold Stop on a live court match, read the phone and the desk.                                                   |
| 12  | A second match starting inside the first's 30 s tail (step 6; O6)                                     | Pending              | Two streamed matches, the second's scorer starting it within 30 s of the first's result: the first video ends, the second has a new sid. The handover's order was seen once on 2026-11-16 (finding 7).              |
| 13  | Exit: ⋯, then Leave, unpairs (step 7)                                                                 | Pending              | Home shows no Continue card; the desk's phone reads Offline.                                                                                                                                                        |
| 14  | Process death while waiting, and while live (step 8; design §7, case 3)                               | Pending              | Kill the app on a court code; it re-pairs to the court, and a Stop on the next live match still keeps the court. While live: the cold start rejoins that sid, never a refused one.                                  |
| 15  | The phone offline across a handover                                                                   | Pending              | Flight mode across a handover: on return the phone rejoins the new sid, never the old.                                                                                                                              |
| 16  | A second phone scanning the same court code (A9)                                                      | Pending              | The first goes Home with Replaced and its Continue card is gone.                                                                                                                                                    |
| 17  | The court code expiring while live (R6's backstop)                                                    | Pending              | The live match finishes, then the phone shows the expiry notice. Needs a code whose day ends during a match.                                                                                                        |
| 18  | O13: an old build is refused with "Not valid for streaming"                                           | Pending              | The current Play internal build before this work scans a court's QR; record its build number.                                                                                                                       |
| 19  | TalkBack on the Leave sheet and the waiting screen (step 8b)                                          | Pending              | Swiping does not reach the controls behind the sheet; the waiting strip has no match-label row and the Next line shows its time.                                                                                    |
| 20  | A second geometry (the phone's own and `wm size` to 728 × 328, then reset)                            | Pending              | The waiting screen, Leave and the Next line in each, in the longest language.                                                                                                                                       |
| 21  | The desk's Court card countdown (O16) and "Updated N s ago · Refresh"                                 | Pending              | A live tail on the desk: "Video ends in N s" counts to 0, goes on handover and when the video stops; Refresh shows once and stays quiet at 20 s polls.                                                              |
| 22  | A refused start says its line (E2)                                                                    | Pending              | A court whose YouTube account is disconnected: the waiting screen names the destination as not ready (design §6.2), not "No streamed match yet".                                                                    |
| 23  | Another app takes our camera on air, and lets go (N45)                                                | Pending              | The camera app opened on air: the strip reads "Camera taken by another app — slate on air" with no reconnects, and `camera-released` within 5 s of the holder letting go. The list in N45's "Open, for the device". |
| 24  | A whole club day on one court with the phone untouched (design §1's success sentence)                 | Pending              | A day of streamed matches on one court, each its own video, with no hand on the phone but the scorers' Start; read from the desk, the record and YouTube.                                                           |

### Device-only claims

Nothing below can be settled by the jsdom suites. From the reviews: P3's one surviving mutant, `importantForAccessibility` on
the Leave sheet's covered content (Task 8's TalkBack claim, row 19); the camera app's behaviour in N45 (Camera2's refusal of
the probe while the app is on top, the order the NE2211 delivers the disconnect and availability events in, the slate on the
programme, the mic after the reopen, which stage a busy failure comes at); and every colour and press feedback on the new
screens.

## Open and backlog

- **Device check of #62:** the camera app on air (row 23), the refusal line (row 22) and Next on a full clean start (row 8).
- **The record line when the refusal changes:** the owner's call, parked.
- **`COURT_MIN_APP_VERSION`** moves up after the first court-capable release reaches Play.
- **Production's Access bypasses** (the owner's): `/api/internal/relay/*`, `/overlay/*`, `/_next/static/*`, before the first
  composed stream there.
- **A compositor's self-exit reads "Stopped by you":** a label to fix.
- **No automatic restart** after a phone re-pairs mid-match.
- **Kill the app, then Send record** (N38): parked; the record keeps the pair and start pins but not the whole disk file.
- **The handover inside the 30 s tail** (row 12), **the desk's countdown and Refresh** (row 21), **es, fr and nl** (row 9),
  **TalkBack** (row 19), **a second geometry** (row 20) and **the old build refused** (row 18).
- **Linked court ordering** is unchanged: a linked court folds in with the free courts unless it is selected (the
  controller's recommendation, not built).
- **Parked minors:** the countdown's `clock` prop in an effect's dependencies (web, low); a queue move and an edit in one
  commit (web, behaviour verified); the start's `no_match` arrives only on a 409 (P4 concern 1, accepted); "Opening the
  link." is a routine line, so a caption wins the strip on a warm phone (N44, the owner's call); the unbuilt line for a
  give-up that keeps the code (RP11); N45's residual (R1-M1, by read).

## What moved since the design

The design carries O15 and O16, the linked free court's queue, §6.6 (the beat retry and the start in flight), §6.2's refusal
line and the staging infrastructure note. It does not carry O17, which this file holds. AGENTS §1, §6 and §9 carry the court
rules (Task 12). `_FINDINGS.device.md` carries N44 and N45.
