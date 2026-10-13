# S1 Plan D: staging results

Date: 2026-10-10 to 2026-10-13. The D3 staging run took 2026-10-10 and 2026-10-11; the fixes branch's device
sessions took 2026-10-12 and 2026-10-13. Spec: `docs/specs/2026-10-09-s1-plan-d-design.md` §5. Plan:
`docs/superpowers/plans/2026-10-09-s1-plan-d3-staging-run.md`. Fixes: `docs/specs/2026-10-11-s1-d3-findings-design.md`
(the D3 findings design) and `docs/superpowers/plans/2026-10-11-s1-d3-fixes.md` (the D3 fixes plan), on
`feat/s1-d3-fixes`.

Build: capture main 633918c (origin/main, the PR #21 merge), release APK sha256
`ed3652d00597d34004430294cc4c0d9d3156e758caca6be3a943946e0339b0b4`, local Gradle (`BUILD SUCCESSFUL` in 15 m 53 s,
no EAS). The fixes branch's rows ran on local release builds of `feat/s1-d3-fixes` at 2cd26dc, 273c1a4, 4aa3ded,
be87d76 and e144a38; every row below names its build. Web: staging at a99147bd0 for Task 1 Steps 1–4
(2026-10-10, about 22:14–22:25Z), then d053616ca (web PR #933), live from 2026-10-11T09:50:06Z. That is not the
e201fab8f the spec expected. No row spanned the deploy. On 2026-10-12 the web's record endpoint was live on staging at
55ac34d5d; later web deploys are not in the ledgers.

Handsets: phone A, OnePlus NE2211, Android 16, serial 12be753e; phone B, CPH2569, Android 15 (SDK 35), serial
7d5e1f34. Physical geometry on both: `wm size` 1080x2412 and `wm density` 480, with no override. Sideways with
3-button navigation, phone A lays the app out at 728 × 328 dp on every route (N35).

Evidence lives outside the repo and is never committed: `$HOME/seazn-d3-evidence/2026-10-10/` holds the runs of
2026-10-10 and 2026-10-11, and `$HOME/seazn-d3-evidence/2026-10-12/` holds 2026-10-12 and 2026-10-13, except N37's cut,
in `$HOME/seazn-d3-evidence/2026-10-13/`. Files are cited by name. A record sent with Send record is cited by the ref
the web answered (R-…). The working ledgers are git-ignored:
`.superpowers/sdd/2026-10-09-s1-plan-d3-staging-run/progress.md` (main checkout) and
`.superpowers/sdd/2026-10-11-s1-d3-fixes/progress.md` (the fixes worktree). Times are UTC.

Findings are cited by ID (`_FINDINGS.md` N27–N40) and not repeated here. Rulings are cited with their source:
R-numbers name their spec, the D3 findings design's R1–R6 are the owner's and its R7–R13 the controller's, and a
ruling the controller made during a session is named by its subject and date.

## Verdict

Of the 18 rows, 7 pass (2a, 2b, 2c, 4, 5, 7 and 12), 4 pass in part (1, 3, 8 and 10), 1 is not proven (6: the
server never recorded `stop_ignored`), and 5 were not run (1a, 1b, 1c, 9 and 13). The exit bar, row 11, **has not
passed**. Its one run was voided by the controller's error, the continuous run was dropped, and two of its events
(block UDP, take a call) were not run. Its clauses are mapped below to the evidence that exists, and the owner has not
ruled whether that mapping is enough (Open owner questions, 1). Row 7's over-183 s half failed on be87d76, where the
phone rejoined a session its strip had called over (N37); it passes on e144a38 after the owner's ruling on N37. Row 2b
took verdict B on the release build of main with the app's battery Optimized (N27). With the battery Unrestricted the
locked phone kept beating, and on e144a38 a phone locked for several minutes started and delivered real video. What
viewers see is hidden (the owner's ruling, 2026-10-09), so its steps in rows 12 and 13 and the §8 HLS check are
deferred, not passed.

## Rulings in force

- **Plan D design R1–R11** (spec §1; all the owner's, 2026-10-08 and 2026-10-09). The ones these rows test: R1 (no
  score preview), R3 (C2), R4 (keep-awake by default while paired, the locked phone as the fallback), R8 (the dim),
  R9 (the ladder), and R2 and R10 (What viewers see), which are built and hidden behind `FEATURES.viewerCheck` by the
  owner's ruling of 2026-10-09.
- **The D3 findings design** (`docs/specs/2026-10-11-s1-d3-findings-design.md`). R1–R6 are the owner's (2026-10-11;
  R2's gear, 2026-10-12). R7–R13 are the controller's: R10 is superseded by the owner's ruling on N37, and R11 is
  marked "owner to confirm".
- **The owner's ruling on N37** (2026-10-13, option a): when the hold runs out, the phone ends the session itself and
  waits for a new Go live.
- **Other owner rulings in these sessions:** "don't worry about credit" (2026-10-11 21:35:43Z); Send record on now
  (2026-10-12); skip the gate tests (2026-10-12 14:46:08Z); the French tiles check ignored (2026-10-13 10:09:55Z);
  "skip both" for the router UDP block and the phone call (as the controller's brief for this document records it;
  the ledger shows Task 9 run with "no router/no call").
- **Relayed by the web, not ruled here:** the app says nothing about dropped lines and shows only the ref (relayed
  2026-10-12 09:29:27Z, to confirm with the owner here); the server drops bad lines, never refuses them (relayed
  2026-10-12 13:03:52Z).
- **The controller's rulings used below**, each the owner's to overrule: the automatic stop judged as the first beat
  after the result plus 180 s (2026-10-11); row 5's same sid shown indirectly (2026-10-11); row 8 read from records
  already shared (2026-10-11); row 10's #9 filing (2026-10-11); N28's pass mark (2026-10-12); the 728 × 328 geometry
  (2026-10-12, N35); the press state, a fill and a brighter edge, never opacity alone, and its fill, cream at 20 %
  (2026-10-13); the amendment to the N38 ruling (2026-10-13); Batch 8 Step C's camera fix dropped (2026-10-13, after
  N39); and the D3 fixes plan's rulings P1–P12 (the controller's: `docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`).
- **The web basis, as the peer reported it (not an owner ruling):** the plan's Global Constraints, plus what
  `mobile-s1-web` added during the run: the automatic switch is per fixture (the stream panel), not per org; a live
  input exists only after a session starts; and the server's automatic stop lands only once the result has stood
  180 s (`AUTO_STOP_AFTER_RESULT_SECONDS`; web `relay/domain/auto-stream.ts:100`, `relay/config.ts:379`, as the
  ledger cites them).

## Prerequisites

- **D1 and D2 on main** (Task 0 Step 1): build 633918c, `FILES=0`, `OVERLAY_GREP=1`, and
  `BEAT_KIND=beat-interval,beats` (D1's §3.4 fallback: one line per cadence change and one count per minute;
  `BeatLog.kt:42`, `:59`). Step 4's `keys.txt` has 71 lines, with `shed`, `hotLive`, `hot` and the `peek` keys, and the
  hint no longer says "Press and hold".
- **Step 2a** (the v2 → v3 settings carry-over): skipped by the owner ("skip, install it"). Not run.
- **Step 3a:** `dumpsys package` counts `WRITE_SETTINGS` 0 on both phones. The owner reports Seazn Capture is not under
  Modify system settings, Live Stream Settings has only the automatic switch (no Score preview), and Forget left no
  pairing (device-only).
- **Credit:** topped up by the owner; the web read 23 (the ledger sum, last entry 2026-10-10 22:06:53Z).
- **Fixtures:** M1 (Girls U-14 R1 m8, b v c, 5aab9882) and M2 (R2, d v b, fd8e63a2), with start times set by the web
  at 22:17 and 22:18 on 2026-10-10; 3fcc4eaa (R1 m7, a v d) for Task 2; TestDevicePad SF; and on the fixes branch the
  testaddnewplayer fixtures #4 (c4f51ade) and #5 (3ca06c23).
- **Second phone:** yes, phone B (CPH2569), over wireless adb. Phone A's wireless adb dropped at least five times.
- **Not arranged:** a phone to call phone A (row 11); a router that can drop outbound UDP (rows 9 and 11); wall power
  at the start (phone A was unplugged at 14–22 % through Task 1, on AC later).
- **Cloudflare token:** `success:true` (owner, Task 0 Step 7).

## Rows

### Row 1: automatic start and stop

- **Expected** (Task 1 Steps 1–8): paired in automatic with "Auto" and "Starts {time}"; within one poll of `in_play`,
  live with no touch (`broadcast-start` `cause` `automatic`); within one poll of the result, "Match finished — stream
  stopped" (`stream.status.stoppedMatch`), `broadcast-ended` `stopped-automatically`.
- **Screen** (633918c, phone A, M1, web a99147bd0, 2026-10-10): at 22:17:31Z, "Waiting for Go live · B_YoutubeTest"
  (`stream.status.waitingGoLive`), the chips "Auto" and "Starts 22:17 UTC", READY. The start time the web set at
  22:16:09Z reached the paired phone by 22:17:13Z with no rescan. With no touch, the notification read "Paired ·
  waiting for Go live" at 22:19:47, CONNECTING at 22:19:52 and "LIVE · 1500k · 0 min" at 22:19:56. At 22:20:02 the
  tally was red LIVE at 0:00:08, the on-air row read Settings, Take photo and Remote scoring, and the strip read "Not
  charging — plug in for a long match" (an advisory beats the routine Live line, `LINE_TIER`). The owner put the match
  `in_play` at 22:19, to the minute only, so the gap is at most 52 s: the one-poll bound is not proven to the second.
- **The stop:** not seen on M1. The web reports M1's one session, 8731c014, as an automatic start that ended
  `operator_stopped` at 22:24Z, by the owner's phone Stop, with no result entered. It was seen on M2 on 2026-10-11
  (web d053616ca): a fresh pairing at 12:56:33 with Auto on and a console Go live (cause `organiser`, not automatic),
  then the result; the server ended session 3ea7c642 `auto_stopped` at 13:01:45Z, and at 13:02Z the strip read "Match
  finished — stream stopped". The result's time is unknown.
- **Record lines:** not read for M1. The owner's paste ended at 21:54:44Z, before M1's start, and the full file was
  never pulled. M2's start, from `r2a-record-1.ndjson` (130 lines, 12:56:29–13:00:52Z): `broadcast-start`
  `cause` `organiser` 12:56:44, armed `srt`, `connected` 12:56:48, `live` 12:56:49. Its stop lines fall after the
  file's end.
- **Screenshots:** `r1-paired.png`, `r1-live.png`, `m2-stopped.png` (2026-10-10 folder). No `r1-stopped`: adb was
  down. The notifications were read as text from `dumpsys notification`, never photographed: the shade shows other
  apps' notifications.
- **Verdict: pass in part.** The automatic start passes on screen. The automatic stop was seen on a console-started
  session on another match. Neither 10 s bound is proven. The plan's bound was wrong: the server stops a session only
  once the result has stood 180 s (the controller's ruling, 2026-10-11, takes that as the bound). Carries 20 and 26
  moved to M2 and Task 2, because M1 was stopped after about 5 minutes.
- **Device-only:** the notification texts and the red tally.

### Row 1a: A12, organiser Stop

- **Expected** (Task 1 Step 11): after a console Stop on a match still `in_play`, no automatic restart; "Organiser
  stopped it — waiting for Go live".
- **Verdict: not run in D3.** The owner reports testing it earlier, before the run, with no record or screenshot. The
  console Stop and its line were seen with the phone in operator mode in row 2a, where no restart could fire.

### Row 1b: A16, late pairing

- **Expected** (Task 1 Step 10): exactly one `broadcast-start` `cause` `automatic` after a scan into a running match.
- **Verdict: not run in D3.** The owner's earlier informal test (paired to an `in_play` match, and it started) has no
  record or screenshot and may have run on the pre-D2 build installed on 2026-10-09. The web found one session,
  d24b5973 on input 94e5c93b, 18 s, at 19:26:43Z on 2026-10-10, probably that test.

### Row 1c: A15, manual restart

- **Expected** (Task 1 Steps 9 and 12): (i) a hand restart during the match is stopped when the result lands; (ii) a
  hand start after the result, inside the grace, is admitted and not stopped.
- **Verdict: not run.** (i) rests on the owner's earlier test. (ii) was skipped by the owner ("Leave, go for next
  check"), so row 3's grace check has no evidence either. Nearest evidence: M2's session 3ea7c642, created before the
  result and started from the console, ended `auto_stopped` (row 1).

### Row 2a: console Go live and Stop, dimmed (R4 default)

- **Expected** (Task 2 Steps 1–5): a dimmed phone reads present; console Go live → live within one poll; console Stop
  → "Organiser stopped it — waiting for Go live" on the next beat; the foreground service held.
- **Screen** (633918c, phone A, 3fcc4eaa, web d053616ca, 2026-10-11): dimmed while waiting (the owner's eye). Console
  Go live at 13:08 → the notification "LIVE · 1600k · 0 min" at 13:08:43. Red LIVE, the a/d label and round 1; the
  strip read "Phone hot · still live" (`stream.advisory.hotLive`) at thermal status 2. Console Stop → the notification
  "Paired · waiting for Go live" at 13:10:14, and the strip "Organiser stopped it — waiting for Go live"
  (`stream.status.stoppedOrganiser`), READY, no Auto chip. The owner saw no `phone_not_responding` this time. The chip
  still read "Starts 06:05 UTC", a start already past (Findings).
- **Service:** `dumpsys activity services` showed `isForeground=true`, count 1, while paired and live.
- **Record lines:** the 13:08 broadcast's own lines were not read (no shared record covers 13:08–13:10). The same path
  with record lines, from `r2-record-2.ndjson` (203 lines, 13:38:47–13:50:51Z): sid d55c9469, `broadcast-start`
  `organiser` 13:39:19, `live` 13:39:21, then on the console Stop `heartbeat` `Over` and `broadcast-ended`
  `stopped-by-organiser` `wasLive` true at 13:47:03; sid a363f441, `organiser` 13:48:36, `live` 13:48:38,
  `stopped-by-organiser` 13:50:37. On 2026-10-11 at 22:02, sid bb409e95 (`r12-record.ndjson`): `Open` 22:02:30,
  `connected` 22:02:31 (`srt`), `live` 22:02:32, `Over` 22:04:41.
- **Screenshots:** `r2a-live.png`, `r2a-stopped.png`.
- **Verdict: pass.** The press time is known to the minute only, so "within one poll" is not proven to the second. An
  earlier report on M2 (dimmed, then live "after 1 min") disagrees with that record, where the start came on the first
  beat after pairing; the console press time was asked for and is not in the ledger.
- **Device-only:** the dim, the notification texts, the tally.

### Row 2b: console Go live with the phone locked (fallback). Verdict: B on main; A with the battery Unrestricted

- **Expected** (Task 2 Steps 6–11): locked 5 minutes or more; verdict A (beats continue, the locked phone publishes)
  or verdict B (beats stop, the console refuses with `phone_not_responding`); either verdict, written down, passes.
- **633918c, battery Optimized (not on the deviceidle allowlist), 3fcc4eaa, 2026-10-11.** Locked at 13:14Z;
  `mWakefulness=Dozing` at 13:14:21; the main process held `FOREGROUND_SERVICE` (procState 4). The owner saw the
  console read the phone as not responding while locked. Locked again from 13:21Z, the console's Go live answered "The
  phone stopped checking in. Open Seazn Capture on it" (about 13:23Z) and then disabled Go live. Unlocked, the console
  read the phone present again; Go live → "LIVE · 1600k · 0 min" at 13:24:13.
  - Record (`r2-record.ndjson`, 999 lines, 13:14:14–13:30:39Z): `tick-late` `gapMs` 324486 (13:14:40 → 13:20:05) and
    121790 (13:21:28 → 13:23:30), no beat between, the wake lock held. **Verdict B.**
  - The same build at 22:06–22:09Z: about 2 minutes locked, then "The phone stopped checking in" again. Beats stopped
    after the 22:06:22 heartbeat until the 22:09:04 minute line. A lock of about 2.5 minutes at 22:02 kept beating, so
    there is no clean threshold (N27).
- **633918c, battery Unrestricted, battery saver off, on AC, 2026-10-11 (the B8 probe).** Locked 22:19:51 → 22:28:32:
  beats 6 a minute from 22:20 to 22:25 (one failed at 22:26), Go live heard at 22:26:04, `live` at 22:26:07 while
  locked. **Verdict A** for the control path. The console read Trouble and YouTube stayed on "Preparing stream"; N28
  reads the media side (frames encoded and delivered, the trouble beginning at the unlock).
- **be87d76, Unrestricted, fixture #4, 2026-10-12 (Batch 8 path 2).** Locked about 21:41Z, beats every minute while
  locked. Console Go live at 21:46:59 → session 9a116935; beats `paired [not_ready, not_responding]` 21:47:00, then
  `armed [not_ready]` 21:47:10; the console read "Phone not ready: camera · Waiting for the phone's video". Cloudflare
  connected at 21:47:46.4, after the owner's unlock; `first_ingest` 48.4 s after the session's creation; the 720p
  variant h264 1280x720, blackdetect 0. **The locked phone held until the unlock.** It did not reproduce on e144a38,
  and its cause is unexplained (N39).
- **e144a38, Unrestricted, fixture #4, 2026-10-13.**
  - Test A (sid 2e0255cd): dozing from 15:35:52, console start created 15:36:13.8. The start reached the phone after
    4.8 s, `armed` at 15:36:18.72, the camera ready at 15:36:19.02, Cloudflare `srt` connected after 9.6 s, and
    `first_ingest` after 13.0 s, all while locked. Segments h264 1280x720, blackdetect empty. `not_ready` cleared at
    about 15:37:06 with no unlock. Ended `operator-stopped` at 15:38:05.
  - Test B (sid e6aeaee3): a hand wake at 15:43:30 broke the first lock, so the phone was locked from about 15:45:40
    (the ledger counts about 7 minutes), Dozing. Console start created 15:52:07.6; `armed [not_ready]` at 15:52:23.7
    (16.1 s); the camera opened at 15:52:28.9 by the phone's own log; Cloudflare `srt` connected after 23.9 s;
    `publishing` at 15:52:33.7; `first_ingest` after 27.9 s. It recovered with no unlock (the next hand wake, at
    15:53:00, came after). Recording c7bd2583, 134 s: blackdetect and freezedetect found nothing, so moving video
    throughout.
  - Record R-DJSE (received 328, kept 197, dropped 131, invalid 0): `camera` and `sound` true from 15:52:29 to the stop;
    no camera-lost, camera-taken or mic-silenced line; `held` false at 15:52:14, 15:52:38.955 and 15:53:28.005, true at
    15:52:27.6 and 15:54:48. The 14 s wait was the Armed gate waiting for the held pose (N39).
- **A lock while live** (633918c, fresh process, 2026-10-11): Dozing 13:42:23–13:43:45 while LIVE, the bitrate rising
  2600k → 3000k with delivery; after the unlock still LIVE at 0:05:18. One TROUBLE at 13:44:33, LIVE again by 13:44:48.
  Step 11 as written (Stop from the console while locked) was not run.
- **Screenshots and files:** `r2b-live.png`, `r11-unlock.png`, `b8-record.ndjson`, `b8-media-camera.txt`
  (2026-10-10 folder); `p2-segment-frame.png`, `lock-cmp.png`, `lock-diag-filtered.log`, `lockB-diag-filtered.log`
  (2026-10-12 folder). The witness capture of the lock was measured for brightness and deleted unviewed.
- **Verdict: pass** (written down under both verdicts, as the plan allows). On phone A the fallback alone fails with the
  battery Optimized; with it Unrestricted, a locked phone keeps beating and, on e144a38, starts and delivers.
- **Device-only:** the lock, Doze, the camera and microphone on a locked phone, the video, the console's words.

### Row 2c: a phone not responding (negative check)

- **Expected** (Task 2 Steps 12–13): after a force-stop and 120 s, the console's Go live shows `phone_not_responding`;
  the reopened app re-pairs with no scan (`heartbeat` `claim` `resume`) and the error clears.
- **Screen** (633918c, phone A, 3fcc4eaa, 2026-10-11): force-stopped at about 13:37:53–55Z with the owner's OK. The
  owner reopened the app and pressed the console's Go live → "LIVE · 1700k" at 13:39:50, the clock at 0:02:01, the
  picture moving, "Phone hot · still live". The fresh process logged no `waitForFreeSlotThenRelock TIMED_OUT`.
- **Record lines** (`r2-record-2.ndjson`): `previous-session-lost` `exit` `user-requested`, then `intent.pair`
  `claim` `resume`, paired at 13:38:48, `heartbeat` `claim` `resume` 200: re-paired with no scan.
- **Screenshots:** `r2c-live.png`.
- **Verdict: pass, as the ledger rules it.** The console's `phone_not_responding` after the force-stop was not read
  in this run (the reopen came before the 120 s were up); it rests on the owner's earlier test. The console's refusal
  of a silent phone was seen twice on locked phones (row 2b).
- **Device-only:** the console's reading.

### Row 3: start gates

- **Expected** (Task 3): each of `no_destination`, `not_entitled` and `no_credit` shows its own line; three
  `start-refused` lines in that order and no `connected` between them; a start after the result, inside the grace, is
  admitted; nothing goes on air.
- **Screen** (633918c, phone A, 2026-10-11):
  - `not_entitled` at 20:56:50Z: READY, still paired, Go live enabled, the strip "Streaming isn't included for this
    club" (`stream.status.refusedEntitlement`), one line, whole. The first try, about 20:52, went LIVE because the
    switch had not been set properly (the owner); that reading was withdrawn.
  - `no_credit` at 21:00:19Z: the strip "No streaming credit — ask the organiser" (`stream.status.refusedCredit`), one
    line, whole.
  - `no_destination`: not arrangeable on 3fcc4eaa (staging always loads a destination), then found on TestDevicePad SF,
    which had none, at 21:25:31Z: before the hold, "Waiting for the organiser to pick a destination"
    (`stream.status.waitingDestination`); after the owner's hold, "Ask the organiser to pick where to stream"
    (`stream.status.refusedDestination`), one line, whole, and nothing on air.
- **Record lines** (`r3-record.ndjson`, 379 lines): `start-refused` `not_entitled` 20:56:32Z, then `no_credit`
  21:00:03Z, in order. No shared record covers the `no_destination` refusal (about 21:25Z), so its line is not read.
- **Screenshots:** `r3-entitlement.png` (the withdrawn first try), `r3-entitlement-2.png`, `r3-credit.png`,
  `r3-nodest-waiting.png`, `r3-nodest-held.png` (2026-10-10 folder).
- **Not met:** "nothing goes on air". Four broadcasts went live while the gates were being set: 25146c57 (operator,
  20:51:51), 49287662 (organiser, 20:54:33), ca245033 (operator, 20:57:19) and 9f7c34e4 (operator, 20:59:15).
- **The fixes-branch re-run** (4aa3ded, 2026-10-12): not run. 3fcc4eaa's code had ended, so the first gate was
  re-planned on TestDevicePad's f/5 (a147c733), which had no destination. The owner scanned testaddnewplayer's f/5
  (3ca06c23) instead, and a Go live hold went LIVE at 14:40:02Z (session a8f64382, one credit, on air 0:02:16). The
  owner then said to skip the gate tests. The `r3-*` files in the 2026-10-12 folder are from that attempt and are not
  row evidence.
- **Verdict: pass in part.** The three gate lines pass; the after-result admission is not run (row 1c (ii) was
  skipped).
- **Device-only:** none beyond the screen lines.

### Row 4: A9

- **Expected** (Task 4 Steps 1–2): phone A hears `replaced` when phone B pairs the same code, then `taken` when B is
  live and A rescans.
- **Screen** (633918c, phones A and B, Girls U-14 Championship · Round 3, a v b, 2026-10-11): B scanned at 21:07 (the
  console: "The camera moved to another phone (CPH2569) at 21:07…"). At 21:08:31Z phone A was on Home with "Paired on
  another phone" and "This code is now paired on another phone. Scan it again to use this one." (`panel.replaced.*`).
  At 21:10:41Z, after B went live from the console, A's rescan showed "Already live" and "This camera is live on
  another phone." (`panel.taken.*`). B was LIVE at 0:00:41 at 21:10:53Z.
- **Record lines** (`r5-a-record.ndjson`, 875 lines): `heartbeat` `Replaced` at 21:07:51; `Taken` on every rescan
  from 21:10:27 to 21:13:48.
- **Screenshots:** `r4-a-replaced.png`, `r4-a-taken.png`, `r4-b-live.png`. No `r4-b-paired`: B was off adb then.
- **Verdict: pass.** Phone B's preview was pillarboxed (N30).
- **Device-only:** the pillarbox.

### Row 5: A14

- **Expected** (Task 4 Steps 3–5): after phone B's network is cut, phone A's rescan takes over and the same sid goes
  live with no Go live pressed.
- **Screen** (633918c): B's data and Wi-Fi off at 21:12:18Z; the owner's rescans read "Already live" at 21:14:00
  (102 s); A was LIVE at 0:00:25 at 21:14:31Z with no Go live pressed (the camera box black: the phone lay face down).
- **Record lines** (`r5-a-record.ndjson`): `heartbeat` `Open` and `broadcast-start` `cause` `rejoin` sid c1778787 at
  21:14:01.729, 103 s after the cut; `connected` 21:14:02; `live` 21:14:03. The web: `phone_takeover {dead:true}` at
  21:14:01Z (pairing 8e49892b replaced f9f5bc3b) on that session.
- **Screenshots:** `r5-a-live.png`.
- **Verdict: pass.** The same sid is shown indirectly (the controller's ruling, 2026-10-11): phone A's cause `rejoin`
  rejoins only an existing sid, and the web saw the takeover on that session. Phone B's record could not be read
  (N33).

### Row 6: A17

- **Expected** (Task 4 Steps 6–7): phone B's late stop hears `replaced` (or `taken`), the server records
  `stop_ignored {held:true}`, and phone A's broadcast is never interrupted.
- **Screen** (633918c, 2026-10-11): the owner held Stop on B offline, turned Wi-Fi on and rescanned. Phone A stayed
  LIVE (0:03:44 at 21:17:51Z), and `r6-manifest.txt` read 200 throughout. Phone B showed "Already live"
  (`panel.taken.title`) at 21:18:16, by the owner's eye; no screenshot (B off adb).
- **The web:** no `stop_ignored` anywhere after 20:00Z; c1778787 was closed at 21:19:46.697Z by a client stop (the
  owner's console Stop, Task 4 Step 8); 22 `claim_refused {claimRow:T3}` from 21:10Z; no beat from f9f5bc3b stored
  after 21:13:30Z. So B's late stop never reached the server's step 4: its claim was refused first, or it was never
  sent.
- **Screenshots:** `r6-a-live.png`; `r6-manifest.txt`.
- **Verdict: not proven.** Phone A's side passes. The live·dead T4 case (`stop_ignored`) was not exercised, and phone
  B's record could not be read from Home (N33, since fixed).

### Row 7: A10 hold window

- **Expected** (Task 5): a cut under 183 s shows "Uplink lost — holding, {remaining} s of 183" and rejoins the same
  sid; a cut over 183 s ends it, "Connection lost too long — stream stopped", and the beat answers `Over` for the old
  sid; S3, the SRT hold, is measured. The D3 run of 2026-10-11 did not reach Task 5; it ran on the fixes branch,
  with airplane mode by hand (Android 16's shell cannot toggle Wi-Fi or airplane mode).
- **Under 183 s** (4aa3ded, phone A, #4 c4f51ade, sid cb872bbd, 2026-10-12): airplane mode about 30 s (down
  16:08:34–16:08:56, up 16:09:07). The strip read "Uplink lost — holding, 173 s of 183" at 16:08:45, then TROUBLE
  "Weak signal. Still live." until 16:10:33 or later, and LIVE by 16:11:04 with the clock unbroken. Cloudflare's input
  reconnected (`srt`) at 16:09:24.9; the same video uid 871f1bb3 and the same sid stayed live; the manifest read 200
  throughout. Beats: `reconnecting [not_ready, not_responding]` at 16:09:04, then `reconnecting`, `degraded` and
  `publishing` in turn, until `publishing [hot]` at 16:10:45. **Pass.**
- **Over 183 s, before the fix** (be87d76, phone A, #4, sid d060573f, `srt`, 2026-10-12): airplane mode about
  21:29:50–21:33:05. The first recording, 8e5d8976, ended at about 21:29:52.4 (68.12 s) and was finalised at
  21:33:23.2; the manifest read 200 until a first 204 at 21:33:24. The server kept the session live. After the
  restore the phone rejoined the same sid and Cloudflare started a second recording, 1c09ef99, at 21:33:37.4. **Fail**
  (N37).
- **Over 183 s, after the fix** (e144a38, phone A, #4, sid 12c5da78, 2026-10-13; N37's device proof, record R-1WRJ and
  the web's rows; evidence: `$HOME/seazn-d3-evidence/2026-10-13/n37-cut-web-report.md`): cut at 20:29:38; `hold-expired`
  at 20:32:46, 183.4 s after `dropped`; the server kept the session live throughout; the network back at 20:33:34.6; the
  first beat, at 20:33:35.4, carried the phone already off the sid; the server ended the session 0.5 s later, and the
  phone logged `stopped-delivered 200`. One `broadcast-start`, no rejoin, one recording, no credit. **Pass.**
- **S3:** inconclusive. On the d060573f cut the manifest stayed 200 until the phone was back, and its 204 at 21:33:24
  coincides with Cloudflare finalising the first recording. A cut over 300 s would measure it.
- **Screenshots and files** (2026-10-12 folder, by the plan's row-7 names and their UTC times; the ledger quotes the
  screen, not these files): `r7-pre.png`, `r7-check.png`, `r7-manifest.txt` and the `r7a-*` series for the first cut;
  `r7b-live.png`, `r7b-manifest.txt` and the `r7b-*` series for the second.
- **Verdict: pass on e144a38** for the over-183 s half; the under-183 s half was seen on 4aa3ded, and Batch 16's
  review checked that a return inside the hold still reconnects the same sid. S3 not measured.
- **Device-only:** the strip lines, Cloudflare's recordings.

### Row 8: beat cadence

- **Expected** (Task 6): from the beat-send lines, 60 s waiting more than 30 minutes out, 10 s within 30 minutes or in
  play, 5 s while starting, 10 s at most live, each ±2 s; the web's history corroborates.
- **Read** (the controller's ruling, 2026-10-11: from records already shared, no new waits; `beat-interval` and
  `beats`): 60 s waiting (`r3-record.ndjson`, `r5-a-record.ndjson`: `intervalMs` 60000, `NoBroadcast` once a minute);
  10 s waiting in the window or in play (`r2-record.ndjson`: `NoBroadcast` 5–6 a minute); 5 s starting
  (`r2-record-2.ndjson`: one `intervalMs` 5000); 10 s live (`Open` 6 a minute in `r2-record.ndjson`,
  `r2a-record-1.ndjson` and `r5-a-record.ndjson`). Whether the 60 s wait was more than 30 minutes from a start was not
  checked.
- **Fixes branch:** while locked on e144a38, the web saw a steady 10.05 s (Test B, 2026-10-13), and a gap of about
  50 s once in Test A (Doze, inference).
- **The web:** the beats export is `d3-beats-2026-10-11.ndjson` (99 lines, md5 70fe7c7b…) with
  `d3-beats-2026-10-11.summary.txt`: window A 23 rows (5 sessionless), window B 76 rows (53 sessionless). Not
  tabulated.
- **Verdict: pass in part.** All four cadences were seen, but the per-state ±2 s tabulation was never done (it was
  left for Task 12 and is not in the ledger), and the web's rows are not set beside them.

### Row 9: the forced-RTMPS session id

- **Expected** (Task 7): with outbound UDP blocked, "Opening the link." for about 19 s, then "Switched to backup link
  (RTMPS)" and LIVE; `fell-back` `srt` → `rtmps`; the sid sent to `mobile-s1-web`.
- **Verdict: not run.** No router rule was arranged, and the owner said to skip it.

### Row 10: round line on real data (with the §5.2 table, a Seen column added)

633918c, phone A, operator mode, 2026-10-11. The expected strings come from the web's rule; the line is drawn in caps.

| n   | Org               | Division and match                        | Expected                                | Seen                                                                                     |
| --- | ----------------- | ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | TestDevicePad     | the SF fixture                            | "TestDevicePad · SF"                    | "TESTDEVICEPAD · SF" (`r10-1.png`): match                                                |
| 2   | my-organization-4 | Tile Open Renamed, pool A, round 1        | "Tile Open Renamed · Group A · Round 1" | unread: no draw, so no match and no code (no draw was made on another test org)          |
| 3   | s-a-f-e           | Girls Under-14 Championship, knockout R1  | "Girls Under-14 Championship · SF"      | "GIRLS UNDER-14 CHAMPIONSHIP · SF" (`r10-3.png`): match                                  |
| 4   | s-a-f-e           | Girls Under-14 Championship, the R2 final | "Girls Under-14 Championship · Final"   | unread: no code until the previous stage completes                                       |
| 5   | s-a-f-e           | Girls Under-14 Championship, league round | "Girls Under-14 Championship · Round N" | unread: whether Task 4's "Round 3" is a league round was never settled                   |
| 6   | s-a-f-e           | Mixed Doubles U-17, knockout R1           | "QF"                                    | unread: the knockout follows the swiss stage                                             |
| 7   | s-a-f-e           | Mixed Doubles U-17, R2                    | "SF"                                    | unread: no match yet                                                                     |
| 8   | s-a-f-e           | Mixed Doubles U-17, the R3 final          | "Final"                                 | unread: no match yet                                                                     |
| 9   | s-a-f-e           | Mixed Doubles U-17, a scheduled swiss R2  | "Round 2"                               | "ROUND 2" (`r10-9.png`): match, filed by the controller's ruling (2026-10-11); see below |
| 10  | s-a-f-e           | Mixed Doubles U-17, swiss R3              | "Round 3"                               | unread: no match yet                                                                     |

- Row 9's residual: a knockout R2 would read "SF", and the cross-check (row 7 must read "SF") is not available.
- In French the round line stayed "ROUND 2": the server's text, localised by the org's `default_locale` (N34).
- Task 8 Step 1's `r10-operator` was not captured (the scanner was open at the shot); the owner's word stands. Step 3
  (no `broadcast-start` in Task 8's record) was not read: no record was shared for Task 8.
- **Verdict: pass in part.** Three of ten read, and all three match; seven unread. No label differed, so nothing was
  sent to the web for this row.

### Row 11: exit bar (web S10)

- **Expected** (spec §5.1 row 11 and Task 9): pull the uplink, block UDP, lock 5+ minutes, open another camera app,
  take a call, Stop from the console; the Phone node shows beats throughout; read the record back. Web S10 adds: a
  real phone starts from the console and from the phone, streams a real match to YouTube, stops from each end, and
  takes over a dead phone (A14), recorded with the device model.
- **Task 9 run 1** (be87d76, phone A, #5 3ca06c23, 2026-10-12): the phone's hold → sid 9d27130e, cause `operator`,
  created 22:00:05.2Z, Cloudflare `srt` connected after 7.2 s, `first_ingest` after 8.7 s, no credit (a free restart);
  the owner saw YouTube playing. The session ended `operator_stopped` at 22:00:44.4Z, 39 s after the start: **voided by
  the controller**. The controller's screenshot predated the start landing, it told the owner to hold Go live, and the
  button was Stop by then. What followed ran on a stopped session (the manifest served the ended broadcast until
  22:03:48). The owner skipped step 2's 30 s cut as covered by row 7. The continuous run was then dropped, pending
  the owner (Open owner questions, 1). Files: `r11-live.png`, `r11-manifest.txt` (2026-10-12 folder, by name and
  time).
- **The clauses, mapped to the evidence that exists:**

| Clause                       | Evidence                                                                                                                                                                                | Build, phone      | Reading                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| Pull the uplink, under 183 s | Row 7's first cut, sid cb872bbd: the holding line, the same sid, one recording, manifest 200                                                                                            | 4aa3ded, A        | pass                                                        |
| Pull the uplink, over 183 s  | N37's cut, sid 12c5da78: `hold-expired` 183.4 s after `dropped`, `stopped-delivered 200` on restore, no rejoin, one recording, no credit (R-1WRJ)                                       | e144a38, A        | pass                                                        |
| Block UDP (RTMPS fallback)   | none                                                                                                                                                                                    | none              | not run                                                     |
| Lock 5+ minutes              | Test B, sid e6aeaee3: locked about 7 minutes, Dozing; Cloudflare after 23.9 s; recovered with no unlock; real video. Test A, sid 2e0255cd: Cloudflare after 9.6 s. Path 2 held (row 2b) | e144a38 (be87d76) | a locked start: seen; a 5-minute lock already live: not run |
| Another camera app           | Batch 8 path 3, sid abee2a82: started by the phone's hold, the system camera opened while live, one `srt` reconnect, the same sid, real 720p after (`p3-segment-frame.png`)             | be87d76, A        | pass on the video; strip and record lines not read          |
| Take a call                  | none                                                                                                                                                                                    | none              | not run                                                     |
| Stop from the console        | sids d55c9469 and a363f441: `heartbeat` `Over`, `broadcast-ended` `stopped-by-organiser` (`r2-record-2.ndjson`); `r2a-stopped.png`                                                      | 633918c, A        | pass                                                        |
| Start from the console       | Batch 8 path 1, sid 2d066043: from Home with the screen on, Cloudflare `srt` after 5.0 s, `first_ingest` after 8.3 s, 720p (`p1-segment-frame2.png`); rows 2a and 2b                    | be87d76, A        | pass                                                        |
| Start from the phone         | path 3, sid abee2a82, cause `operator`; run 1, sid 9d27130e (voided)                                                                                                                    | be87d76, A        | seen                                                        |
| Stop from the phone          | sid 2e0255cd: `ended` `operator-stopped` `wasLive` true at 15:38:05.2 (R-N4F3); sid d060573f ended `operator_stopped` at 21:38:10.3Z                                                    | e144a38, be87d76  | seen; "You stopped the broadcast." not read                 |
| YouTube                      | the owner's word at run 1 (voided)                                                                                                                                                      | be87d76, A        | the owner's word only                                       |
| A14 takeover                 | row 5, sid c1778787, 103 s after the cut                                                                                                                                                | 633918c, A and B  | pass                                                        |
| Phone node shows beats       | the web's beat rows, read per event (row 7's cuts, Tests A and B, N37's cut); never watched through one run. With the battery Optimized, beats stop when locked (N27)                   | several           | not shown as one run                                        |
| Read the record back         | R-N4F3 (178 / 76 / 102 / 0), R-DJSE (328 / 197 / 131 / 0), R-1WRJ (623 / 621 / 2 / 0): received, kept, dropped, invalid. R-MA1P kept 0 before the fix (N38)                             | e144a38 (be87d76) | pass; the 1000-line overflow not seen on a device           |
| S11, `phone_lost` at 15 min  | none                                                                                                                                                                                    | none              | not run                                                     |

- **Device model:** OnePlus NE2211 (phone A); CPH2569 (phone B, row 5 only).
- **Verdict: not passed.** No continuous exit-bar run exists. Two events were not run, the camera-app event's strip
  and record lines were not read, and the Phone node was never watched through a run. Whether the mapping above is
  enough is the owner's call (Open owner questions, 1).
- **Device-only:** every clause.

### Row 12: Part 2 on the device

- **Expected** (Task 10): no score layer; the on-air row Settings, Take photo, Remote scoring, with no What viewers
  see cell; no `viewer.*` or `peek.*` line; C2 at both sizes and in both languages; the dim at 30 s on the window only,
  woken by a touch or a console Go live; back from the background or a lock at full brightness; the geometry reset.
- **Screen** (633918c, phone A, Mixed Doubles U-17 R2 in operator mode, 2026-10-11):
  - Step 1: paired, the camera's picture with nothing drawn over it, READY, no Auto chip (`r12-paired.png`); "Opening
    the link." (`r12-connecting.png`); LIVE at 0:00:15 with no score layer, the on-air row Settings, Take photo and
    Remote scoring packed from the start, no What viewers see cell, no reason line, and every control on screen
    (`r12-live.png`). The camera box went dark there because the owner had the phone face down.
  - Step 6, from `r12-paired.png`: the round line "ROUND 2" in lime caps; side 1 with a lime bar and side 2 with a
    lilac bar, one line each, in mixed case; a small v in the left margin between the rows; one message line,
    "Waiting for Go live · B_YoutubeTest".
  - Step 6a: the camera box measured 1162 × 654 px, 387.3 × 218 dp (16:9). The arithmetic's 394.7 × 222 is for
    804 × 332; the phone lays the app out at 728 × 328 (N35).
  - Step 7 (French, `r12-c2-804-fr.png`): PRÊT, PASSER EN DIRECT, the strip "Arrêté par l'organisateur : en attente
    du direct" on one line, whole; C2 as in English; nothing clipped. The Home tile titles in French ran past their
    tiles (`r12-home-fr-landscape.png`; N31).
  - Step 8 (`wm size 360x640`, `wm density 160`): in French (`r12-c2-640-fr.png`) side 1 wraps to two lines inside its
    row beside a lime bar the height of its row, side 2 is one line, the v sits between the rows, and the strip is cut
    with an ellipsis ("Arrêté par l'organisateur : en att…"); in English (`r12-c2-640-en.png`) the same, with
    "Organiser stopped it — waiting …". The controls half is whole and nothing overlaps.
  - Step 9: reset; `wm size` and `wm density` show only Physical 1080x2412 and 480, no Override.
  - Step 10 and 10a: dimmed about 30 s after the console Stop (the owner's count). While dimmed, the window's `sbrt`
    was 0.1 and the system `screen_brightness` was 2753, as before the dim; the display's brightness went 2347.7 →
    534.0. Battery saver was on.
  - Step 10b: one tap on the Settings icon woke it and opened Stream Settings, where the automatic switch read off
    (`r12-dim-settings.png`); it dimmed inside Settings at 21:51:21; a tap on the turn card left it dim, as designed;
    sideways and a touch woke it (`r12-dim-turncard.png`, taken after the wake).
  - Step 10c: the Home button after a dim and back about 43 s later: full brightness, system brightness unchanged.
  - Step 10d: locked on Home, a console Go live: the console read "Waiting for the phone's video", then LIVE while the
    phone was still Dozing (sid bb409e95, row 2a's lines). After the unlock the app was on Live Stream, paired and
    waiting, at full brightness (`r12-locked-unlock.png`), and it dimmed again with no touch.
  - Step 10e: dimmed at 21:56:18; a console Go live with no touch; full brightness at 21:56:28, about 3 s before live
    (`r12-dim-golive.png`: LIVE 0:00:02, "Live. Sound and picture going out."); no dim through about 111 s live.
- **Record lines** (`r12-record.ndjson`, 185 lines from 22:01Z): no `viewer.*` and no `peek.*` line.
- **Unread:** Step 5b's label half (TalkBack), skipped by the owner.
- **Deferred (view hidden):** Steps 2, 3, 4, 5, 5a, 5c and 5d, and the cover half of 5b.
- **Verdict: pass** for every step run.
- **Device-only:** the brightness, the colours of the bars and the round line, TalkBack.

### Row 13: thermal rung

- **Expected** (Task 11): on a debug build, `thermalservice override-status` 2, 3 and 4: "Phone hot · still live"
  beside the LIVE plate, the record's `shed` lines `viewer-feed`, `preview-framerate` and `encode`, and the Spanish
  caption at 640 × 360.
- **Verdict: not run.** The ledgers have no Task 11 entry: no status was forced. Natural heat gave part of it on the
  release build: thermal status 2 at 13:09Z on 2026-10-11 with "Phone hot · still live" beside LIVE (`r2a-live.png`,
  device-only), and `b8-record.ndjson` holds thermal 3 at 22:28:47 with `shed` `preview-framerate`.

## What the fixes branch changed and how it was proven

`feat/s1-d3-fixes`, base 0a2c565 (the spec at 7ea8f63, approved by the owner on 2026-10-11). The last counts in the
ledger: vitest 4902 passed, 0 failed at e144a38; Kotlin core 1406 passed, 0 failed at dcc5bb0 (Batch 19, the last native change;
1397 before it). Batches 1–7 and 10–19 and the final review each had a spec and quality review; the fix rounds are in the
commit lists.

- **Batch 1**, N27–N34 filed and AGENTS amended: 018ade1, 65dcff4; fix round 06e1d75. Docs only.
- **Batch 2**, N29's rejoin with a reason and a back-off (D3 findings design R10, the controller's): 588ca11, 3eb3c1a,
  b6e6422, 4e27a9b, 12bfd2f; fix round 279413f, 641103a, 9941961, a4756e1. On the device (be87d76, sid d060573f) the
  rejoin resurrected a session the strip had called over: N37, and Batch 16 removed it.
- **Batch 3**, N30's 16:9 preview (spike verdict `DECORATOR`): 7dfced7, 8d3a7b5, 0e8bb97, 24d47ba, ea2db77; fix round
  b383525, 8dbbc91. Device: the owner reports phone B's 16:9 camera box works (2026-10-13 10:09:55Z, on be87d76,
  phone B's last install); no `dumpsys media.camera` or screenshot was taken. Device-only.
- **Batch 4**, Forget on the notification (D3 findings design R6, the owner's; R7, the controller's): 698200c,
  ecd1211, 6875b19, 725fd16; fix round 1cd83b7, 89e6a47. Device: phone B on 4aa3ded, 2026-10-12 21:24:40Z: the owner
  tapped Forget, the notification went, and adb showed no foreground service and no Seazn notification. Device-only.
- **Batch 5**, Stream settings from Home and the battery row (R2 and R5, the owner's; R11–R13, the controller's):
  73dc5ae, fdc8b41, c5a2401, bba172b; fix round f0e4659, 98ca2dc, 6940739, 6a5847e. The battery row's readings were
  not checked on a device in the ledger; its es/fr/nl words are drafts.
- **Batch 6**, Send record to Seazn behind its switch (R3 and R4, the owner's; R9, the controller's), and Share record
  in the record row: 8b99943, 4920ea3, 9802354, 33ffe85; fix round 1 d89f5da, 8ddb33f, 7747e4e; fix round 2 023ab03.
  Device: Batch 18.
- **Batch 7**, N31's tile titles and N35's 728 × 328: 50ac1d4, 5c851e4; fix round 1 37ef42e, 74f62cf, 1193a76; fix
  round 2 d081acc, a92a6bf; the controller's wording fix 354a4c9. Device: the owner chose to ignore the French tiles
  check (2026-10-13); not checked.
- **Batch 8**, N28. Step A's hypothesis: 2cd26dc. Step B on be87d76 (2026-10-12): path 1 passed (sid 2d066043), path
  2 held until the unlock (sid 9a116935), path 3 passed with the camera taken while live (sid abee2a82); the
  pre-start variant was not run. Step C was not built: the controller dropped it on 2026-10-13 after N39. The final
  review's fixes: 4421fb2, d62907d, 55e6b9e, 1fad270, aaa968a, 29c8df0, 273c1a4; the owner reports the Diagnostics card
  fits at 728 × 328 (2026-10-13).
- **Batch 9**, the device pass (the owner's hands), no commits: A1 works on phone B; the Diagnostics card fits; the
  French tiles ignored; the gear reads as sliders and its words' position is "fine"; press feedback **failed** (the
  owner held the gear and saw no change, 2026-10-13 10:13:12Z), so Batch 17; Forget passed on phone B (Batch 4); A3's
  paths are Batch 8's; Send record kept none of a long session (N38), so Batch 18.
- **Batch 10**, Stream settings is a gear in the Live Stream tile's corner (the owner's ruling, 2026-10-12): f034948,
  5375e9e. Equal portrait thirds still do not fit with a card, so R11 stands.
- **Batch 11**, the record contract vendored at web 53f28ebfc, the real path, and the switch on (the owner's ruling,
  2026-10-12): 7ccfbd8, 866f3f8, 4aee72f, fccfc90, ac06e3a, ebac190; fix round 52b65f6, 7d09fd4, f46dcfb, 4aa3ded.
  Device: 4aa3ded installed on phone A (14:25:46Z) and phone B (16:15:06Z, the second try), 2026-10-12.
- **Batch 12**, the contract re-vendored at web 55ac34d5d: ea636f2, 5d82779.
- **Batch 13**, every fatal end of a pairing writes `ended {reason: fatal-error}`: 6ebc91a, a66aa20; fix round
  86000d0.
- **Batch 14**, the gear waits out a scan in flight, and the plan's P6 on a Paired Continue: 5fef108, e71cbdf, the
  controller's 3764d39; fix round be87d76. Device: be87d76 installed on phones A and B at about 21:25Z on 2026-10-12
  (`install-be87d76-A.txt`, `install-be87d76-192.168.1.73.txt`: Success).
- **Batch 15**, the contract re-vendored at web a6cc1f038 (#944): 64a1ac2, f7ca618; the controller's 9cbefd6.
- **Batch 16**, N37 (the owner's ruling, 2026-10-13): de2a5ce, 8335583, 3bff4aa; fix round a5be0b0. Device: N37's cut
  on e144a38 (sid 12c5da78, R-1WRJ; row 7; evidence: `$HOME/seazn-d3-evidence/2026-10-13/n37-cut-web-report.md`).
- **Batch 17**, press feedback: 702b08d; fix round 1 acd92f0; fix round 2 71931d8; the review's test minors 7a63b2c. Device: e144a38, phone A,
  2026-10-13. An adb hold of 4 s on the Home tile's gear, captured at 1.5 s, shows a lighter rounded box (`cmp.png`,
  rest and held side by side). The owner then saw it with a finger. Device-only.
- **Batch 18**, N38's pinned lines: 0d3fefd; fix round e144a38. Device: R-N4F3, R-DJSE and R-1WRJ
  (row 11; R-1WRJ's evidence: `$HOME/seazn-d3-evidence/2026-10-13/n37-cut-web-report.md`).
- **The controller's aba6771** filed N36–N39 and marked N29 superseded by N37.
- **Batch 19 (dcc5bb0)** fixed N39's stuck camera state after a session ended, at the owner's word "fix it now" (2026-10-13).

Phone A had e144a38 from 2026-10-13 14:47:44Z. Phone B never had it: its last install is be87d76 (2026-10-12, about
21:25Z).

## Open owner questions

1. **The exit bar.** Map S10's clauses to the evidence that exists (row 11's table), or run one continuous exit-bar
   run? The controller recommends the mapping.
2. **Send record's source.** Send the native 5 MB disk record (`RecordFile`) instead of the JS ring? The ledger
   records no recommendation; the standing rule is R9 of the D3 findings design (the controller's: what Share record
   shares, one record and one truth), as amended by the controller for N38. The 1000-line overflow has not been seen
   on a device.
3. **What was not run:** the UDP 778 block (row 9 and the exit bar), the phone call (the exit bar) and the start gates
   on the fixes branch (row 3). Accept them as not run, or schedule them? The ledger records no recommendation. The
   three gate lines passed on 633918c (row 3).
4. **es/fr/nl copy.** The failure copy for Send record (Batch 11) and the battery row's words (Batch 5) are drafts and
   need a native speaker's check. Open since Batch 11; no recommendation recorded.
5. **N36.** Keep the screen awake on Home while paired, which N36 leaves open, or accept the battery setting as the
   cure (Stream Settings has the battery row)? The controller recommends the battery setting (the ledger, 2026-10-12
   21:49:21Z: "option B suffices": the locked phone kept beating and armed).
6. **N39's camera carry-over: fixed in Batch 19.** After a hold expiry or an organiser's end, a RESUMING or SWITCHING
   camera state was copied into the pairing (`Verdicts.over`, `Pairings.kt:302` before Batch 19), so the camera check stayed false and no start was
   possible on that pairing until a rescan (confirmed by a probe, reviewer, 2026-10-13). The owner first said "leave
   all three out and ship" while it was unproven, then "fix it now". The fix carries only TAKEN and REOPENING
   (`CameraState.afterSession`, dcc5bb0; core 1406/0). Still open and device-only: does "Phone not ready: camera"
   clear on a phone after a switch and a hold expiry? Whether the carry-over made the first beat after N37's restore
   say `notReady: "camera"` is not shown.
7. **The controller's rulings.** The D3 findings design's R1–R6 are the owner's; its R7–R13, the D3 fixes plan's
   P-rulings and the session rulings in Rulings in force are the controller's. Each stands until the owner overrules
   it. R11 (portrait tiles grow from their words, Home scrolls) is marked "owner to confirm".
8. **Updating the app on a user's phone.** Nothing exists today: `expo-updates` is not installed and `app.json` has no
   `updates` or `runtimeVersion` entry; AGENTS §11 holds only the rule (check on launch, never apply while paired or
   holding a broadcast). A native change (the engine, Kotlin) needs a new APK, which an installed app cannot swap for
   itself: through Google Play, the in-app update API can tell the app a newer version exists and offer a flexible
   update, but Play's own background update can restart the app mid-match; a sideloaded APK cannot update silently
   (Android asks for each install). A JS-only change can be applied by Expo Updates from a self-hosted update server
   (EAS is ruled out, 2026-09-11) for a build with a matching `runtimeVersion`. Either way, nothing may apply while
   the phone is paired or live; a Home banner ("New version available") that never interrupts Live Stream is the
   shape. The controller recommends Play distribution with the in-app update banner first, and self-hosted Expo
   Updates later if JS-only fixes between releases are needed. It is a later spec (AGENTS §1 scope lock), not part of
   this branch. Which channel: Play, or direct APKs?

## For the web brief

- **(a)** The beat should carry which readiness check failed (N39). `not_ready` alone sent the console, the operator
  and the controller to the camera when the false check was `held`. "Phone not ready: camera" is the console's
  wording, not the phone's (`en.json` has no such string).
- **(b)** The server records a hold-expiry end as `operator_stopped`, the same as a hand Stop; only the absence of
  `phone_stop` tells them apart (web `capture-phone.ts:584`, as N37 cites it).
- **(c)** The record contract's description still says "the record is the phone's last 1000 lines"
  (`contracts/capture-record.v1.json:5`). The app now sends the pairing's `pair` and `broadcast-start` lines first,
  then the newest lines (N38).
- **(d)** N34, the round line in other languages: answered by the web (2026-10-11), no app change.
- **(e)** The server's `degraded` beat word at 15:53:14 on 2026-10-13 (sid e6aeaee3) has no phone-side line; the
  nearest is a bitrate step 1.8M → 1.35M at 15:53:04.2. Ask how the word is derived.
- **(f)** `not_responding` is judged on the pairing's previous beat (web `capture-phone.ts:537`, as the controller's
  brief cites it). The ledger had asked why it showed during a reconnect (row 7's first cut, 2026-10-12). Not an
  issue.

## Carries

### Carry 20: hint 0.1 and Cloudflare's listed window

Read on M2, not M1 (M1 was stopped before Step 5), at 13:02:10Z on 2026-10-11, 633918c, web d053616ca, with the
`playbackUrl` from `r2a-record-1.ndjson` (never written down): 4 renditions; with `clientBandwidthHint=0.1`, 1; the
variant lists 8 segments, 15.968 s, target 4; the master answers 200. **Pass.**

### Carry 26: the 20 s per 60 s lag rule

- M2 (633918c, 2026-10-11): the bitrate reached 3000k by 12:59:20. `video-stalled` `below-floor` at 12:59:52 (video
  8.9 fps, audio 32.0) and 12:59:58 (17.2 and 17.5), then `not-delivered` `lagging` at 13:00:17 (`stalledMs` 7600,
  `lagGrowthMs` 20155): three reconnects in 25 s, `delivered` at 13:00:27, and the bitrate reset to 1500k.
- `r2-record-2.ndjson`: three `not-delivered` in 8 minutes on a live that looked healthy, each a reconnect of about
  1.6 s: 13:41:14 `lagging` 16154 / 20475; 13:42:33 `stalled` 20135 / 20323; 13:44:26 `lagging` 15627 / 20426.
- `b8-record.ndjson`: 22:30:15 `lagging`, `stalledMs` 18151, `lagGrowthMs` 20456 (N32).
- No Diagnostics "Behind live" reading was taken: Task 1 Step 6's 15 minutes never ran.
- On the fixes branch, `degraded` and `publishing` flapped in the beats for about 100 s after row 7's first cut, and
  "Weak signal" flapped on Batch 8's path 1.
- **Verdict:** recorded, rule unchanged: R8 of the D3 findings design (the controller's, 2026-10-11), N32. Whether
  Cloudflare really lagged 16–20 s needs a playlist poll beside the record.

## Owed to the web (mobile-s1-web)

| Step                                                                           | What was sent                                             | When              | Result                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| S3                                                                             | nothing: no hold was measured                             | not sent          | inconclusive (row 7)                                                 |
| S10 (web §12, the exit bar)                                                    | nothing as one set; the ledger records no send            | not sent          | owner question 1                                                     |
| Forced-RTMPS session id (not a §12 step; nearest: S1 flag-false, S2 RTMPS leg) | nothing: row 9 not run                                    | not sent          | not run                                                              |
| S11                                                                            | nothing: neither run done                                 | not sent          | not run                                                              |
| S2b                                                                            | not run: moot under W26                                   | none              | moot                                                                 |
| Round lines                                                                    | no label read differed; the French round line asked about | 2026-10-11        | the web localises by the org's `default_locale`; no app change (N34) |
| Row 6, `stop_ignored` for c1778787                                             | the sid                                                   | 2026-10-11        | no `stop_ignored`; the session closed by a client stop (row 6)       |
| Row 8, the beats rows                                                          | the sids and windows                                      | 2026-10-11        | `d3-beats-2026-10-11.ndjson` received; not tabulated                 |
| The asks from the 2026-10-13 device pass (the same brief, §5)                  | nothing: written, not sent                                | not sent          | pending                                                              |
| The D3 findings web brief (`docs/specs/2026-10-11-s1-d3-web-brief.md`)         | the brief                                                 | 2026-10-11 22:37Z | the record endpoint built and deployed; the Q7 correction accepted   |

## Device facts re-established (spec §5.3)

- **The camera and microphone open on a locked phone** (device-only). 633918c with the battery Unrestricted: one
  1280x720 stream to the encoder's SurfaceTexture and no preview while locked (`b8-media-camera.txt`). e144a38: the
  camera opened at 15:52:28.9 on a Dozing phone (`lockB-diag-filtered.log`); R-DJSE has `camera` and `sound` true from
  15:52:29 to the stop.
- **Readiness on a locked phone** (device-only). R-DJSE: `held` went false and true while locked (row 2b); the start
  waited for `held`, by design (A11), and the beat could not say so (N39).
- **The notification** (device-only, read as text from `dumpsys notification`): "Paired · waiting for Go live", "LIVE ·
  1500k · 0 min" (2026-10-10), "LIVE · 1600k · 0 min" and "TROUBLE · 1600k" (2026-10-11). The foreground service had
  types 0xC0 (camera and microphone), and the partial wake lock `seazn:capture` was held (2026-10-11 22:09Z).
- **Beats under lock:** they stop with the battery Optimized (N27) and run with it Unrestricted.

## HLS start inside 5 s (spec §8)

Not run: What viewers see is hidden (the owner's ruling, 2026-10-09), so there were no taps, no pictures to count and
no not-readies. The ingest timings in rows 2b and 11 (Cloudflare's connect after a start) are not this number.

## Recordings deleted

The web session deleted them, not the owner's terminal: on its own owner's instruction on 2026-10-11, and at the
controller's request on 2026-10-12 and 2026-10-13.

| Input or session (8 chars…)                           | Videos                               | Durations  | Deleted                                        | Re-listed empty         |
| ----------------------------------------------------- | ------------------------------------ | ---------- | ---------------------------------------------- | ----------------------- |
| Every input in the account, 2026-10-10 and 2026-10-11 | 109 (35 live inputs)                 | not listed | 2026-10-11 22:42–22:44:25Z, by the web         | yes: 0 videos, 0 inputs |
| a8f64382 (the wrong-fixture start)                    | 6f3a4a0a                             | not listed | 2026-10-12 15:26:49Z; input 14:43:27Z          | not in the ledger       |
| cb872bbd (row 7, first cut), input 713aa0a3           | 871f1bb3                             | not listed | 2026-10-12 16:21:49.6Z; input 16:21:50.7Z      | not in the ledger       |
| d060573f (row 7, second cut), input 8cae18a5          | 8e5d8976, 1c09ef99                   | 68.12 s, — | 21:39:52.1Z and 21:46:21.5Z; input 21:46:22.5Z | not in the ledger       |
| Batch 8 paths                                         | 3f8ccdf7/eb23c175, 9ae88354/c1da293f | not listed | 2026-10-12 22:10:19–23Z                        | not in the ledger       |
| 2e0255cd (Test A), input 03fd9e95                     | 3dd86839                             | 97.4 s     | 2026-10-13 15:48:51.5Z; input 15:48:52.6Z      | not in the ledger       |
| e6aeaee3 (Test B), input c1248bd4                     | c7bd2583                             | 134 s      | asked 2026-10-13 16:12:45Z                     | not in the ledger       |

Before the account-wide delete the web listed, from its database only: M1 8731c014 one video of 189 s; M2 c225cea9
one video of 241 s; and 0 for every session of 2026-10-11. Cloudflare held recordings the database did not
(Findings). Not in any cleanup line: path 2's input 2ddbeee2 (sid 9a116935), run 1's sid 9d27130e, and N37's cut
(sid 12c5da78, one recording). Task 12 Step 2's final sweep is not in the ledger.

## Deviations

- Row 13 did **not** use Android's thermal override: Task 11 was not run.
- Step 2a (the settings carry-over) was skipped; the notification was read as text, never photographed.
- The web was a99147bd0, then d053616ca, not e201fab8f.
- Rows 1 and 1c judge the automatic stop as the result plus 180 s, not 10 s (the controller's ruling, 2026-10-11).
- M1 was stopped by the owner's phone Stop after about 5 minutes, so carries 20 and 26 were read elsewhere.
- Row 3's `no_destination` was recovered on another fixture, and four broadcasts went on air during Task 3.
- Row 5's same sid is indirect; row 6's phone B record was not obtainable.
- Row 8 was read from records already shared, with no new waits, and never tabulated.
- Row 10's #9 was filed by the controller's ruling.
- Tasks 5 and 9 ran on fixes-branch builds, not 633918c; Task 5's cuts used airplane mode by hand. Task 7 never ran.
- Task 9's run 1 was voided by the controller's error, and the continuous run was dropped.
- The recordings were deleted by the web, inputs included; the plan's recipe leaves inputs alone.
- Task 12 Step 1's last geometry check is not in the ledger; Task 10 Step 9 confirmed the reset.
- This document covers the fixes branch's device sessions as well, and is committed on `feat/s1-d3-fixes`, not on a
  docs branch from main.
- Frames that showed anything personal (a launcher, the code scanner, a family photo in a Cloudflare frame) were
  deleted and never quoted.

## Findings

| ID  | Row            | For                | State (see `_FINDINGS.md`)                                                                       |
| --- | -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| N27 | 2b             | owner              | mitigation landed (the battery row); the cause, OxygenOS's, stays open                           |
| N28 | 2b, 11         | owner              | open; on be87d76 paths 1 and 3 delivered, path 2 held until the unlock; Step C dropped           |
| N29 | 2b, 7          | —                  | superseded by N37                                                                                |
| N30 | 4              | —                  | fixed; the owner's eye on phone B                                                                |
| N31 | 12             | owner              | fixed; the device check ignored by the owner                                                     |
| N32 | carry 26       | —                  | recorded; rule unchanged                                                                         |
| N33 | 6              | —                  | fixed                                                                                            |
| N34 | 12             | mobile-s1-web      | resolved by the web; no app change                                                               |
| N35 | 12             | —                  | fixed in docs and tests                                                                          |
| N36 | Batch 8 path 1 | owner              | open (Open owner questions, 5)                                                                   |
| N37 | 7              | mobile-s1-web (b)  | fixed; device-verified on e144a38                                                                |
| N38 | 11             | owner (question 2) | fixed; device-checked                                                                            |
| N39 | 2b             | mobile-s1-web (a)  | carry-over fixed (Batch 19, dcc5bb0); the beat naming the failed check is open for the web brief |
| N40 | Batch 9        | —                  | fixed (Batch 17); seen on phone A, device-only                                                   |

Not filed as N-IDs, from the ledgers:

- **For the owner:** a "Starts" chip shows a start already past, with no day (`m2-stopped.png`: "Starts 22:18 UTC"
  the next day; `r2a-stopped.png`: "Starts 06:05 UTC"). Hide a past start, or add the day?
- **For the owner:** the automatic switch was reachable only after a scan, so a first scan of an `in_play` match in
  automatic could spend a credit before the switch was seen. Answered by R2 of the D3 findings design (the owner's)
  and built in Batch 5.
- **Fixed, filed afterwards as N40:** the gear showed no press feedback (Batch 9), fixed in Batch 17.
- **For mobile-s1-web:** the console's words differ from the plan's quote: "The phone stopped checking in. Open Seazn
  Capture on it", not "The camera phone isn't responding…".
- **For mobile-s1-web:** Cloudflare held recordings for sessions whose database `video_uids` were empty (the web's
  own finding); YouTube can stay on "Preparing stream" after a start with no video (N28; the web brief §4); the console
  never says that a saved destination was removed (a Directory → Streaming "Remove" archived 9bfe4ce2 on 2026-10-11).
- **Candidate, unfiled:** `degraded` and `publishing` flapping for about 100 s after a restore (carry 26).
- **Ledger only:** the camera flapped on an earlier pairing on 2026-10-10 (19:29:35–38, "Capture failed with code 0",
  `camera-lost`, `capture-rebuilt`); offline, the connect retry wrote 73 `capture-start-failed` lines in 183 s (N37's
  edges); the phone's clock ran about 13 s ahead of the server on 2026-10-12 and about 0.8 s behind it on 2026-10-13 (the web's reading).
