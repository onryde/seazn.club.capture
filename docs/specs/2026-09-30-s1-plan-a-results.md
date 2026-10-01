# S1 plan A — results

**Date:** 2026-09-30 to 2026-10-01. **Branch:** `feat/s1-plan-a`, from `293a88e`
(PR #6). It merges cleanly onto `4b1c925` (plan B, PR #7).
**Spec:** [2026-09-30-s1-live-stream-design.md](2026-09-30-s1-live-stream-design.md).
**Plan:** [S1 plan A](../superpowers/plans/2026-09-30-s1-plan-a-js-domain-and-screens.md).

Plan A is the JS half of S1: the domain, the ports and every Live Stream
screen, built against the fake engine. Plan B (merged) is the Kotlin core.
Plan C joins them: it supplies the native bridge, the preview and the shared
session record.

**Nothing in this document was checked on a phone.** Every claim below comes
from the test suite (react-native-web in jsdom) or from reading code.
Production still wires the fake engine until plan C (D25). The device list
further down is for the owner, unticked.

The working ledger, reports and reviews live in the git-ignored
`.superpowers/sdd/2026-09-30-s1-plan-a-js-domain-and-screens/` folder of the
plan A worktree; plan B's are in its own worktree. This document carries what
must survive them: the owner-visible rulings, the device list, the deferred
items and every plan C carry from both plans.

Every code, token and credential used in tests is made up
(`test/fixtures/wire.ts`). The whole-app probe in the final review found none
of them in the session record after scan, arm, going live,
background/foreground, stop and Scan another.

## Counts

| Point                                                 | Tests passed / run | Test files | `pnpm check` |
| ----------------------------------------------------- | ------------------ | ---------- | ------------ |
| Plan start (`293a88e`)                                | 447 / 447          | —          | EXIT=0       |
| All 26 tasks, after nine batches' reviews (`667222d`) | 1829 / 1829        | 84         | EXIT=0       |
| After the final review's fixes (`82fc841`)            | 1897 / 1897        | 87         | EXIT=0       |
| After the re-review's fixes (fix round 2)             | 1919 / 1919        | 87         | EXIT=0       |

Counts were read from `vitest --reporter=json`, not from a summary line:
tests from `numTotalTests`, test files from the length of `testResults`.
An earlier version of this table gave 280 and 293 "files". Those were
`numTotalTestSuites`, which counts every file and every `describe` block
within it (vitest 5.0.0, `dist/task-utils.js:24-26`).

## What shipped

**Phase 1: the domain and the ports (Tasks 1–14).**

- **The record.** A levelled logger feeds a ring session record, through an
  allow-list scrub.
- **The key-value port:**
  - a 5 s timeout;
  - refused writes are logged;
  - a refused orientation lock is retried once.
- **The leave rules:** each leave is logged, M2 re-reads after the leave
  write, and a failed session is reset.
- **Codes and the session descriptor.**
  - capture-qr.v2 is parsed into `StreamSession`. Both credential shapes are
    in hand at scan time (C1).
  - `recognise` accepts v2 only.
  - The descriptor port has a fetch implementation and a fake. Trust is the
    environment's exact host. A foreign `heartbeatUrl` refuses the
    descriptor; a foreign or `/relay` `overlayUrl` means no overlay.
  - The saved code keeps its descriptor. Times are shown in the venue's zone.
  - Home checks a stream code with the server before opening it.
- **The engine port and its fake.** The port was reshaped, and the fake plays
  the spec's scenes. Its guards match plan B's `SessionMachine`: reset only
  from Ended, arm only from Idle, and stop ends any session.
- **Status and pre-flight:**
  - the status line is an i18n key, in four languages;
  - the warming gate;
  - the pre-flight chips;
  - the tally plate.

**Phase 2: the screens against the fake (Tasks 15–26).**

- **New dependencies:** react-native-webview 13.16.1 and expo-video ~57.0.5.
  Both load lazily; a missing module reports itself unavailable and never
  crashes at boot.
- **The surfaces port** and the stream settings store.
- **The HUD:**
  - TallyPlate, LivePlate, Elapsed, the permanent AudioMeter and the
    EdgeStrip;
  - the 3-second hold (`HoldAction`) for both Go live and Stop.
- **The overlay preview** is the Tier A route in a transparent WebView. It is
  confined to its own origin, and its `delay` is 0. An overlay crash never
  takes the HUD with it.
- **"What viewers see":** the hold-to-peek, using expo-video.
- **The viewfinder:**
  - arming, Arm and every on-air state;
  - Ended, Scan another, and reopening while live;
  - adopt-or-replace by code: sid, slot and token.
- **Settings and Diagnostics**, reachable in every state, with a LIVE plate.
  Diagnostics shows the session record and a Share button. Dev scenes appear
  only in dev builds.
- **The phase 2 gate:**
  - a locale sweep over every fake scene × four languages;
  - the four questions;
  - the mutation record;
  - the device list below.

**The final review's fixes:**

| Item | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Proved by                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1   | Forget, while the code's session is armed or ended, disarms it: stop, then reset once Ended. An armed or ended engine that no saved code owns is an orphan, cleared at launch and on every foreground by the same path. Live is never touched.                                                                                                                                                                                                                                      | `HomeScreen.forget.test.tsx` (the reviewer's probe P2, end to end), `useDisarm.test.tsx`, `reopen.test.ts`                                                                                                                                                                                                                                                                                      |
| I2   | This document                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                                                               |
| M1   | `useSnapshotFreshness` and `selectReportedAtMs` were deleted. Nothing consumed them, and the spec asks for no stale-snapshot line. The port doc no longer promises one: what the app shows when native stops reporting is plan C's decision.                                                                                                                                                                                                                                        | typecheck; full suite                                                                                                                                                                                                                                                                                                                                                                           |
| M2   | The leave's reset is recorded (`intent.reset {action: 'leave'}`), as arm, start and stop already are. The orphan reset (`{action: 'orphan'}`) and Forget's (`{action: 'forget'}`) are recorded too.                                                                                                                                                                                                                                                                                 | `useStreamLeave.test.tsx`, `HomeScreen.forget.test.tsx`                                                                                                                                                                                                                                                                                                                                         |
| M3   | The record masks the held session's token, passphrases, stream keys and stream ids by value: under any key, in the event name, raw or decoded. Each decoding is read on its own: percent-decoded, then + as a space, and + as a space before decoding (fix round 2, M-a). An escape that is not UTF-8 reads as U+FFFD and never hides the rest of its run (M-b). A public URL may carry the stream id (it is the playback path), but nothing else. `Logger.protect` only ever adds. | `scrub.test.ts`, `logger.test.ts`, `StreamSession.test.ts`, `StreamScreen.arm.test.tsx` (armed and adopted on air)                                                                                                                                                                                                                                                                              |
| M4   | The root boundary records `ui.crash` (no message text), lifts the splash, says the broadcast may still be live, and offers Try again. Try again restarts the navigation port and remounts the shell, so the reopen gate takes a live engine back to the viewfinder (fix round 2, I-A).                                                                                                                                                                                              | In jsdom only: `RootBoundary.test.tsx` (a HUD crash on air → Try again → Stop shows and ends the broadcast; then a foreground, and a fresh scan; a crash while armed → Arm, then Continue), under a router double that resets to `/` on a fresh mount as Expo Router's root Stack does. `ErrorBoundary.test.tsx`, `expoRouterNavigation.test.ts`. **Unproved on a phone**: see the device list. |
| M5   | The production fake keeps only intent kinds, capped at 100: no session, token or key. Tests that read whole intents wrap the engine in `test/fakePorts.ts`.                                                                                                                                                                                                                                                                                                                         | `FakeCaptureEngine.test.ts`                                                                                                                                                                                                                                                                                                                                                                     |
| M6   | Not fixed. `selectSurvivesBackground` has no consumer; see plan C below.                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                               |
| R1   | A replacing visit's first committed frame never shows the old code's label, Ended or On air. A recorder over committed text proves it.                                                                                                                                                                                                                                                                                                                                              | `StreamScreen.newCode.test.tsx`                                                                                                                                                                                                                                                                                                                                                                 |
| R2   | The replace line logs under `action` (`intent.replace {action: 'stop' \| 'reset'}`), which the scrub keeps, and it is asserted.                                                                                                                                                                                                                                                                                                                                                     | `StreamScreen.newCode.test.tsx`                                                                                                                                                                                                                                                                                                                                                                 |

**The re-review's fixes (fix round 2):**

| Item | What changed                                                                                                                                                                                                                                                                                                                                                                      | Proved by                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I-A  | Try again on air led to Home with no Stop anywhere. The ports outlive the root boundary's remount, so the navigation adapter still believed in `stream`, while Expo Router's root Stack had started again at `/`: the reopen gate's move was a no-op, and so was every later foreground, Continue and scan. `NavigationPort.restart()` now runs on Try again, before the remount. | `RootBoundary.test.tsx`, `expoRouterNavigation.test.ts`. The routed harness (`test/routedApp.tsx`) now drives the production adapter over a router double that resets on mount; the reviewer's probe reproduced red there first. Device-only: see the device list. |
| M-a  | A secret holding both a space and a `+`, form-encoded (`fake+pass%2B…`), passed the URL check. Every decoding is now read on its own (M3 row).                                                                                                                                                                                                                                    | `scrub.test.ts`                                                                                                                                                                                                                                                    |
| M-b  | One escape that is not UTF-8 (`%FF`) left its whole run undecoded, so an escaped token after it passed. Decoding now goes byte by byte.                                                                                                                                                                                                                                           | `scrub.test.ts`                                                                                                                                                                                                                                                    |
| M-c  | Three errors in this document: the M4 row claimed more than jsdom proves, the C2 row named the wrong row, and the counts called describe blocks files.                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                  |
| M-d  | Forget while its stop was unanswered, then a foreground: the reopen gate sent a second stop. One clearing per engine now, whoever asks.                                                                                                                                                                                                                                           | `useDisarm.test.tsx`, `HomeScreen.forget.test.tsx`                                                                                                                                                                                                                 |
| Nit  | The fake's no-credential test now also checks its snapshot.                                                                                                                                                                                                                                                                                                                       | `FakeCaptureEngine.test.ts`                                                                                                                                                                                                                                        |

## Owner-visible rulings

Every ruling marked OWNER-VISIBLE in the plan A ledger, in order. Where a
later ruling replaced an earlier one, both are listed.

| Batch          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-flight     | D13's timeout sentence was shortened to fit the 48-character status-line budget. The owner was told at the time.                                                                                                                                                                                                                                                                                                      |
| 3 (owner)      | The owner agreed (2026-09-30, directly) that `heartbeatUrl` and `overlayUrl` must be on Seazn's host. This was later made exact and per environment: a production build trusts only the production host, a staging build only the staging host.                                                                                                                                                                       |
| 5, C2          | After our own camera reopen, the line must not say "Opening the link." while the link is fine. **Withdrawn** by the "5, I1" row, two rows down.                                                                                                                                                                                                                                                                       |
| 5, C3          | When the session is degraded and the mic is silent, the line names the fallback, not "no sound" (D39). The permanent audio meter shows the silence.                                                                                                                                                                                                                                                                   |
| 5, I1          | Native is the authority. The fake's camera-reopened scene mirrors plan B: degraded / camera-taken, with `sinceEpochMs` kept and never connecting, then publishing at the first frame.                                                                                                                                                                                                                                 |
| 5, R1          | During our own reopen or switch, the camera line never claims "slate on air". A reopening, resuming or switching camera reads as a camera-reopening line; a taken camera reads as the slate line.                                                                                                                                                                                                                     |
| 7              | The audio meter rounds up. Any sound above zero lights at least one segment, orange below the floor, so a quiet mic reads "alive but too quiet". True silence stays at 0.                                                                                                                                                                                                                                             |
| 7              | The hold fill always animates, reduced motion or not. It shows the hold's progress, which is information, not decoration.                                                                                                                                                                                                                                                                                             |
| 7, M5 (safety) | Leaving the foreground (background, a call, the lock) cancels any hold in progress and stops the peek. Go live and Stop never fire on return; the operator holds again.                                                                                                                                                                                                                                               |
| 7, M6          | A device advisory ("Not charging", heat) outranks the score-ahead note on the edge strip. The strip's order is: shed > overlay failed > not charging > score ahead. This overrides plan D17/D18.                                                                                                                                                                                                                      |
| 7, N4          | While the turn card shows, any hold in progress is cancelled and the peek is dropped. Nothing under the card acts.                                                                                                                                                                                                                                                                                                    |
| 8              | **The camera line follows the state:**<br>• A camera taken on air (publishing or degraded) reads as the slate line.<br>• A camera taken before air (armed, or connecting before the first frame) reads "Camera in use by another app", with no slate claim.<br>• Reconnecting keeps the hold countdown, whatever the camera does.<br>• Ended shows the ended lines.<br>• The camera-reopening line shows only on air. |
| 8, I2          | "Stop the broadcast first" after Back on air is transient: about 4 s, or until the next change of state kind. Any outage or fault line outranks it. This overrides the plan.                                                                                                                                                                                                                                          |
| 8, N4          | Returning to the app after the code expired on a stopped Ended screen resets the engine on the way to Home. The next code scanned never opens on the old Ended screen.                                                                                                                                                                                                                                                |
| 9              | Diagnostics numbers use the language's decimal separator: "9,2 s" in es, fr and nl.                                                                                                                                                                                                                                                                                                                                   |
| 9, I1          | A visit adopts the engine's session only for the same code, meaning the same sid, slot (C7) and token (N2). Opening a different code over an armed or ended session replaces it: stop, then reset once Ended, then arm, each reconciled against the next snapshot (N1). A replacing visit never shows the old session's Ended screen; it reads "Waiting for the session details." until the new code is armed (N3).   |
| Final, I1      | Forget while armed or ended disarms, and an orphaned session is cleared, as in the table above. It is never shown as a Ready viewfinder.                                                                                                                                                                                                                                                                              |

**Also visible, not yet ruled by the owner:**

- **The M4 crash screen's copy:** "Something broke" / "The broadcast may
  still be live. Try again to get back to Stop.", with a Try again button.
  The copy is mine.
- **The language of the crash screen.** It sits outside the language
  provider, so it reads in the phone's language, not the operator's pick.
- **A boundary for the viewfinder alone.** The reviewer suggested one whose
  fallback keeps the plate and a Stop hold. It is an owner-visible design
  call, so it is raised here and not built.

**Plan B's owner-visible rulings,** from its ledger, for the record. Plan B
merged without a results document.

- **Refused ingest does not end a session by itself.**
  - The session ends as stopped-by-organiser only on a 410, or when the
    heartbeat or descriptor says it is over.
  - A "live" answer keeps the session retrying under the hold clock.
  - This departs from spec §1.
- **After a clean far-end drop,** the bitrate regulator restarts at the last
  _healthy_ target, not the last target.
- **While the mic is silenced** (a call), both rate floors are suspended.
  Only a true stall rebuilds.
- **The 20 s-per-60 s lag rule** misses delivery above about 67 % of real
  time. It stays as an unmeasured constant for the staging match.
- **On SRT,** sender drops cut the link and loss marks it failing, whatever
  the send-buffer value. This departs from the plan's Task 6 text.
- **A camera switch holds LIVE for at most about 3 s:**
  - The hold starts at the switch while frames were advancing, otherwise at
    the last real frame.
  - LIVE never outlasts the last real frame by more than 3 s plus one tick.
  - The bound is ≤3.5 s with Frames readings every tick, and under 4 s
    without.
- **A camera taken before the first frame** reads Connecting at the machine.
  Plan A shows the camera-taken line whenever `camera` is `taken`.
- **Once the hold has run out,** an input landing before the tick ends the
  session as hold-expired. That includes a returning frame or an organiser
  stop.
- **After a session has ended,** a fatal error is only recorded. The first
  end reason stands, so an operator Stop is never relabelled as a fatal
  error.

## Device list for the owner (not claimed)

Nothing here was run. All of it needs a phone, and much of it needs plan C's
bridge.

**Before any of it**

- [ ] **A fresh local native build.** react-native-webview and expo-video
      autolink, and the S0 dev client cannot boot HEAD's JS.
  - Run `pnpm expo prebuild -p android --no-install --clean`, then
    `pnpm expo run:android --no-bundler`.
  - Revert the `package.json` script rewrite afterwards. Never EAS.
- [ ] **The manifests merge.** Both packages build and merge with no clash
      (two FileProvider authorities). This includes the expo-video plugin
      entry, which was left out of `app.json`.
- [ ] **Until plan C, every engine-driven line, plate, chip and Diagnostics
      value comes from the fake.**

**Colour and type** (sun, two metres, the owner's eyes)

- [ ] **Plates:** red only for LIVE, lime for Ready, orange for Trouble,
      Connecting inert. Check the chips, the meter segments, the edge strip
      and the peek's border too.
- [ ] **Ink, as Fabric paints it.** Fabric's default text colour is black, so
      check that every Text sets its ink. This covers the plate ink, a
      disabled label's ink3, and the crash screen's lime Try again plate.
- [ ] **Barlow Condensed at 150 dp in fr and nl.** The longest tally, action
      and status copy must fit: fr "Passer en direct", es "Lo que ve el
      público", and the es/fr leave line.
- [ ] **Column heights** at Arm, Live and Ended, on two landscape geometries.
      Nothing may be clipped.
- [ ] **Touch targets:** the 56 dp plate and the 48 dp peek.
- [ ] **The bottom strip** (label, Settings, Diagnostics, Home) in nl and fr,
      on the narrowest geometry.
- [ ] **Diagnostics values** are in Geist Mono with tabular figures, and do
      not twitch at 1 Hz.
- [ ] **Settings and Diagnostics in landscape** scroll on two geometries.
- [ ] **ChoiceRow borders,** checked and unchecked, can be told apart
      outdoors.
- [ ] **Decimal commas** ("9,2 s") come from Hermes's `Intl.NumberFormat`.

**Holds and presses** (the owner's hands)

- [ ] **The hold fills,** with and without reduced motion:
  - lime for Go live, cream at 35 % for Stop;
  - linear over 3 s.
- [ ] **Press feedback,** and Android's press-rect release (sliding off
      cancels).
- [ ] **The peek** answers the instant a finger lands.
- [ ] **A hold interrupted at 2 s** by a call, the power button or Home:
  - on return nothing acts, and a fresh hold works;
  - check whether the OS sends `onPressOut`;
  - a finger still down when the turn card mounts.

**Overlay WebView** (some against the real Tier A page, in phase 5)

- [ ] **The overlay page itself:**
  - transparent, and never takes a touch;
  - `delay=0`;
  - no reload on re-render.
- [ ] **The four failure callbacks fire.** No white error plate ever commits.
- [ ] **Retry** after hide and show, and after shed and cool.
- [ ] **The origin guard:**
  - a same-origin navigation loads, and a cross-origin one is refused and
    reported;
  - `window.open` stays in the view;
  - the overlay cannot open another app or the camera.
- [ ] **Android residuals:**
  - POST navigations and subframes;
  - a JS thread busy for more than 250 ms lets one navigation through;
  - no download toast;
  - the `getUserMedia` shim (best effort);
  - backslash URLs.
- [ ] **An off-origin subframe on the real page** fails the overlay. The lazy
      `import()` of both packages resolves under Metro, in dev and release.
- [ ] **TalkBack over the overlay:** is the scorebug DOM read, and is it
      noise?

**Peek video**

- [ ] **expo-video playback:**
  - starts on press, muted, no loop, no cache;
  - capped rendition;
  - the data cost over five peeks.
- [ ] **The warm player** stays loaded for 30 s and is hidden from TalkBack.
      Backgrounding mid-peek leaves no frozen frame.

**TalkBack**

- [ ] **Announcements:**
  - the tally live region announces LIVE → TROUBLE;
  - the turn card is announced before Go live sits behind it.
- [ ] **Holds and states read aloud:**
  - double-tap-and-hold drives the 3 s hold;
  - the peek's hint is read;
  - a disabled Go live's reason is reachable;
  - Settings switch and radio states are read.

**Lifecycle, timing and navigation**

- [ ] **Timers paused in the background:** the warming gate after a lock or
      doze across the deadline.
- [ ] **The 4 s leave line** as the operator reads it.
- [ ] **Keep-awake** through a 30-minute armed wait.
- [ ] **A real camera take,** before air and on air. No camera permission at
      arm.
- [ ] **Controls left and right:** nothing over the middle third.
- [ ] **Expo Router's real Stack:**
  - Settings and Diagnostics keep the viewfinder mounted;
  - `back` returns without a remount;
  - `replace('/')` from a sub-route clears the stack;
  - hardware Back on each screen;
  - Back on air says how to stop.
- [ ] **Scan another** opens the scanner while Home shows the turn card.
- [ ] **Share on air** (a background round trip): the broadcast keeps
      publishing, no hold fires, the lock does not move, and the preview
      holds its frame rate under Diagnostics.
- [ ] **Share record:**
  - opens the chooser;
  - a full 1000-line record fits the intent;
  - the shared text holds no secret. **Do not screenshot it.**
- [ ] **Dev scenes** are absent in a release build.

**Code replacement and Forget** (plan C's bridge must report sid, slot and
tokenTag first)

- [ ] **Code B over an armed A:**
  - B reads Not ready, with no flash of A's Ended or Ready, until it is
    armed;
  - then Go live publishes to B, as seen on the session page.
- [ ] **A slot-2 code over slot 1's armed session** re-arms and publishes to
      slot 2.
- [ ] **A re-issued code over its own session** uses the new token and
      credentials.
- [ ] **Forget on the Continue card** while the code's session is armed:
  - the engine goes idle;
  - the next foreground stays on Home, with no turn card held by an armed
    lock.
- [ ] **A real render crash under Expo Router** (I-A; proved in jsdom only):
  - the crash screen shows in the phone's language;
  - on air, Try again remounts the Stack on Fabric and lands on the
    viewfinder with Stop, and the Stop hold ends the broadcast;
  - after Try again, background and foreground keeps the viewfinder; after
    Stop, Home, Continue and a fresh scan each open it.

## Translations (`_review`)

es, fr and nl each still carry `"_review": "pending native speaker"`.
`scripts/check-i18n-release.mjs` refuses a release while any dictionary
carries it.

| Measure                                                           | Count |
| ----------------------------------------------------------------- | ----- |
| Keys added to `en.json` since S0 (`bf8653b`)                      | 149   |
| es/fr/nl strings waiting for review (149 × 3)                     | 447   |
| S0 keys removed (two `stream.placeholder.*`, five `stream.dev.*`) | 7     |
| S0 strings changed                                                | 0     |

The list is `git diff bf8653b -- src/i18n/en.json`. Most wording was copied
from the briefs. These keys are the implementers' own wording:

- `diag.audio` ("Sending audio");
- the six `diag.camera*` keys;
- `crash.heading` and `crash.mayBeLive` (M4).

Copy budgets (`src/i18n/budgets.test.ts`) hold in all four languages, but they
count characters, not pixels; the device list checks the fit.

## Deferred (known, not fixed)

- **M6:** `selectSurvivesBackground` has no consumer. That is correct while
  the fake always survives. Plan C wires the iOS P1 warning to it, not to a
  platform check.
- **The two scrubs differ in masking.** M3's JS mask removes the whole value;
  native masks the secret in place with `***`. Plan C reconciles them when
  it joins the two records (below).
- **Native may ignore an intent mid-replace,** and the intent is not
  repeated. The visit then reads Not ready until the operator leaves and
  continues. That is fail-safe; a retry would be a second state machine.
- **No screen test opens a new code over a _failed_ session.** It shares the
  ended path with stopped, which is covered by the domain rows and screen
  tests.
- **A late SecureStore write after a timeout can still land** in storage,
  after the call has already reported a timeout (batch 1, M4).
- **The record and lint have small gaps:**
  - a refused language _read_ is not logged;
  - `no-console` misses a destructured or `globalThis` console;
  - the release script uses `console` (a CLI, outside the linted paths);
  - a domain test that imports react-native is not caught, because tests
    turn the boundary rule off.
- **Parser edges:**
  - the `/relay` check misses `\relay` and percent-encoded forms (server-sent
    only);
  - `recognise`'s link regex admits `\` (exact match, routing only);
  - an upper-case `HTTPS` scheme is accepted, which is correct.
- **Phase 5, against the real descriptor endpoint:**
  - the 403 and HTML-200 copy;
  - the sid's UUID shape;
  - status lines longer than 48 characters if a hold window exceeds 999 s;
  - the unbounded 429 retry (D5).
- **An S2 carry:** opening from the code panel should take the scan flight
  (R5).

**Plan text that the rulings overrode** (the ledger is the record; the plan
file was not edited mid-run):

- D17/D18, the strip order (batch 7, M6);
- the permanent leave line, made transient (batch 8, I2);
- the C2 camera-reopen line, withdrawn (batch 5);
- adoption by sid alone, which became sid + slot + token with replace by
  stop → reset → arm (batch 9);
- the fake's reset from any state, which became Ended only, as native's is
  (batch 9, N1).

## Carried to plan C

Consolidated from both ledgers: plan A's (A) and plan B's (B). Plan C's
research plan is
[2026-09-30-s1-plan-c-research.md](../superpowers/plans/2026-09-30-s1-plan-c-research.md).

**The bridge and the snapshot**

1. **Replace the fake engine** in `createNativePorts` (D25) with the Expo
   Module bridge, and run `test/engineContract.ts` (`describeEngineContract`)
   against it:
   - use a real `settle`;
   - the wait step must allow the 500 ms tick, because an ignored intent
     emits no snapshot;
   - `getSnapshot()` must report native's real state from construction.
     (A: batch 9 N1, round 3 c2)
2. **Name the session in the snapshot.** It must carry the session's `sid`,
   `slot` and `tokenTag` for every armed and ended session, taken from
   `SessionConfig`.
   - Name it from the arm itself, so a refused arm that goes straight to
     Ended still identifies its session.
   - Without these, every Continue resets a non-live session, the operator
     loses their own Ended screen, and a replacing visit stays Not ready for
     good.
   - `tokenTag` uses the same FNV-1a 32-bit hash as JS, pinned by a
     cross-language test vector that includes a non-ASCII token.
     (A: C8, round 3 c1/c3)
3. **Map `Snapshot.camera`.** A null camera keeps Go live off for good. Pin it
   in the snapshot contract test. (A: batch 8 N3; B)
4. **Re-hydrate the descriptor** on the JS side, with its Date fields.
   (A: batch 5 R2)
5. **Telemetry from the bridge:**
   - `cameraReady`, `networkReachable` and `audioLevel`;
   - `deliveryCheckedAtMs`, as epoch ms;
   - `captureTimestampMs`;
   - the `reasons.first()` mapping;
   - null frame and packet rates stay null ("not measured", shown as a dash).
     (A: final-review boundary list; B: C3)
   - `durationMs` is **no longer** a bridge carry: the core's Ended carries
     it (B: M-3 withdrew A's C5).
6. **Pin the wire strings** for `ConnectFailure` and `HeartbeatResult`, and
   the snapshot's shape, so that no `shed` field slips into the state, in the
   snapshot contract test. (B: B2, M-e)
7. **`survivesBackground`** drives the iOS P1 warning through
   `selectSurvivesBackground` (M6).
8. **Stale snapshots.** Decide what the app shows when native stops
   reporting (`reportedAtMs`). Plan A makes no staleness claim today (M1).
9. **The preview:** the native preview view replaces today's empty stage
   (D16).
10. **The `switchCamera` intent** is in the port with no S1 control. It is
    reserved, not a defect.

**The session record**

11. **One record.** JS lines go into the native SessionRecord (D20), with one
    shared allow-list file and drift tests on both sides. Decide key by key,
    not by a blind union: JS keeps `key`, `slot` and `host` plain, for
    example. Reconcile the mask marker (`[scrubbed]` against `***`) and
    whole-value against in-place masking. Pin both with one cross-language
    vector. (A: M3; B: M-2, B5 final-review carry)
12. **Threading and counters.** The levelled logger's feed into the record is
    posted through the Scheduler. Diagnostics shows `reentrantDropped` beside
    `sinkFailures`. (B: B5)
13. **The SRT URL.** Proposed and not separately ruled: build it with
    `URLEncoder` only, as defence in depth beside the core's masking.
    (B: B5)

**The platform adapter and threading**

14. **Deep sleep.** `Handler.postDelayed` uses `uptimeMillis`, which stops in
    deep sleep, while the clock uses `elapsedRealtime`. Hold a partial wake
    lock while armed or live, or document that tasks may fire late. (B: B1)
15. **Report any `Throwable` at the scheduler task boundary.** An Error
    escaping `process(Tick)` stops the tick for good. Call Engine
    `start`/`stop` only on the scheduler thread. (B: B5, B6 C7)
16. **Rate sampling:** one poller per link, or a minimum sample interval, so
    a double post cannot spike the rate. (B: M-g)
17. **The descriptor adapter:**
    - it always echoes the request id;
    - it calls the core's pure "descriptor says over" function. (B: B6, M-4)
18. **Permanent failures are sticky.**
    - Once one is seen, every later Connect, `Rebuild.next` and
      `StartNewSession.next` is answered with `PlatformFailed(thatId)`.
    - There is one Engine per process.
    - Decide how to report a failure before a session's first Connect.
    - This supersedes the earlier "stamp PlatformFailed" wording.
      (B: C-1)
19. **Camera switches:** keep Frames readings every 500 ms through a switch,
    so the switch's LIVE bound stays ≤3.5 s. (B: B7 m1)
20. **The HTTP adapter:**
    - a test that HTTP 204 maps to NoContent (OkHttp's `isSuccessful` is true
      for 204);
    - a no-cache test;
    - on staging, check that hint 0.1 returns one variant, and measure
      Cloudflare's listed window. (B: B4)
21. **Plan C's first batch:** an RR-12 table test (every end path keeps the
    duration and the network fact) and the RR-13 KDoc nit. (B: closing
    re-review)

**Device measurements** (plan C's device work)

22. **The mic at a call:**
    - the order of mic-silenced against the audio dip when a call is
      answered;
    - the audio figure at hang-up. (B: B3)
23. **API 24–28** has no silencing signal, so `micSilenced` is always false
    there. Check the 25 s reset against a link that collapses every
    25–30 s. (B: B3)
24. **The camera:**
    - a taken camera with no slate frames reads Degraded indefinitely;
    - measure the camera-switch time. (B: B6)
25. **An uplink drop reported after the 3 s stall window** is ignored behind
    the rebuild, and never counts toward the RTMPS fallback (N4). (B: B6)
26. **The lag rule** (20 s per 60 s) is an unmeasured constant; measure it at
    the staging match. (B: B4)

**From the final re-review** (plan A, not blocking today)

27. **A stop native never answers.** One clearing per engine (M-d) means a
    stop that never reaches Ended now blocks every caller on that engine, not
    only its own. The fake always answers; the bridge needs a bound — give up
    the clearing after a timeout and record it — or a test that native always
    answers a stop.
28. **Forget, then a re-scan of the same code** while native still holds the
    stop. The new visit arms only from idle and the disarm ends at idle, so
    the arm follows the reset; reaching it needs native to sit on a stop for a
    whole scan round trip. Pin it with the contract kit once the bridge exists.
