# S1 design follow-up, PR A: the owner's canvas, in the app

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, one task per implementer, one reviewer pass per task, in the order below. Steps use checkbox (`- [ ]`) syntax for tracking. **Nothing starts until the orchestrator has put Q1 to Q4 (under _Owner questions_) to the owner and written the answers into _Owner answers_.** Tasks 2, 3, 5 and 7 build on those answers.

**Goal:** Ship spec §1 to §7 as one pull request:

- the viewfinder as two halves: a 16:9 camera box with a status strip below it, and a controls half (§1);
- the match label shown big, split on its two sides (§2);
- icon chips and an icon row (§3);
- a silent room counts as ready (§4);
- the phone's Stop returns to Home with a _Stream ended_ card (§5);
- Diagnostics moves inside Settings and its route goes (§6);
- the Seazn Club logo, a Home that turns with the phone, and Settings that turns when not on air (§7).

**Architecture:** Almost all of this is JavaScript and React Native UI over the existing ports. The one native change is to the readiness predicate in the pure-Kotlin core (`modules/capture-engine/android/core`). There, `Readiness.sound` becomes "the mic is available", and `SoundHold`'s 15 s window is deleted. "Available" means an audio buffer arrived within `BridgeCore.NO_AUDIO_MS` (2 s) and the system has not silenced the mic (pre-flight F4). That needs a three-line glue change too: `PeakMeter.take()` reports "no buffer since the last take" as `null`, and the glue's close reports no buffer. The change is JVM-tested through the real `PeakMeter`, and is driven through the JVM host's JS contract by the `bridge` vitest project.

Three facts stay where they live:

- **Native** keeps readiness: JS still reads `ready.sound` off the snapshot.
- **The domain** gains pure functions: the label split, the ended card's lines, the orientation rule for `free`, and the Home layout rule.
- **A new in-memory port, `endedNotice`,** replaces the `homeIntent` port. Once _Scan another_ goes, `homeIntent` has no producer.

**Tech Stack:**

- Expo SDK 57, React Native 0.86.3, Expo Router, TypeScript strict;
- vitest projects `domain` (node), `ui` (jsdom with react-native-web, setup `test/setup-ui.ts`), `types` and `bridge` (`CAPTURE_BRIDGE=1`);
- `react-native-svg` for the glyphs;
- `expo-screen-orientation`;
- Kotlin with the Gradle core build: JDK 17, `allWarningsAsErrors` on.

**Spec:** `docs/specs/2026-10-06-s1-design-followup-design.md`, owner-approved 2026-10-06, read at `ff4f191`. This plan covers PR A only: §1 to §7 and _Verification (PR A)_. PR B (§8, §9), PR C (§10) and the round line (§2, _not PR A_) are out of scope. The design of record is the owner's canvas, version 23 (https://claude.ai/artifact/EfaxpYmC7ReNAmUQZtkQ8F). The spec rules: "Where they disagree, ask — do not pick." Every disagreement found is an owner question below, never a choice made here.

**Sources, in authority order:**

1. the spec;
2. the canvas boards, version 23;
3. the owner's answers to Q1 to Q4, once recorded;
4. this plan's _Plan decisions_, which fill gaps that neither the spec nor the boards cover.

## Global Constraints

- **Worktree.** Execute in `/Users/ashokhein/github/seazn.club.capture/.claude/worktrees/s1-design` on branch `feat/s1-design-followup`. Call it `$WT` below. Put `cd "$WT" &&` in every command, because the shell cwd resets between calls.
  - The worktree has no `node_modules`. Run `pnpm install --frozen-lockfile` once, before Task 1.
  - Never run a bare `git stash`: the stash stack is shared with the main checkout.
  - To back up a file for a mutation, `cp` it to `"$TMPDIR"` and restore it from there, never with `git checkout`.
- **Never EAS.** No `eas build`, `eas submit` or `eas update`, ever. Only Task 9 builds anything native. It is the owner's local release build, on the owner's hands (AGENTS §11).
- **The web repo is read-only.** `/Users/ashokhein/github/seazn.club` is only ever read. Task 7 copies one file out of it and changes nothing there.
- **Secrets.** Never log, print, screenshot or commit a code's raw value, a `tok`, an SRT passphrase or stream id, or an RTMPS key. Test fixtures are made up.
- **Device screenshots are of the app only.**
- **Layering** is enforced by lint (`eslint-plugin-boundaries`):
  - `src/domain` stays pure;
  - `ui` reaches native only through `Ports`, and imports services as types only;
  - a hook may import services.
- **Styling.** `StyleSheet.create` only, never an inline style object. Every colour, size and gap comes from `src/ui/theme/tokens.ts` or `type.ts`, and a literal in a component is a review blocker. New sizes become tokens (Task 3), so tests and the fit arithmetic read one number.
- **Tests.**
  - Every task's new tests fail without its change: run them once before the change and record the red count.
  - Expected values come from the spec, the boards or the engine's declarations, never from the code under test. Copy comes from `en.json` through the translator, or as the literal English the spec gives.
  - No snapshot tests.
  - Every sweep or table states how many cases it ran, with an anti-vacuity `expect(count).toBe(N)`.
  - Every new guard is mutated once and a named test must fail. Restore from the `cp` backup.
  - **Sequence cases are owed**: a second Stop, OK then a new broadcast, and a call starting and ending. Each task lists its own.
- **Scoped verification only. Never a full suite.**
  - Never run `pnpm test`, `pnpm check` (it ends in a full `vitest run`), a bare `pnpm vitest run`, or an unfiltered `./gradlew test`. CI runs the full suites.
  - The `bridge` project is always run with its one file named: `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts` (F19).
  - `pnpm typecheck` and `pnpm lint` stay allowed: they are not test suites, and the owner's rule bans full test runs only (F19).
  - Each task runs:
    - the vitest files it names;
    - the Gradle filters it names;
    - `pnpm typecheck`;
    - `pnpm lint`, read through `rtk proxy pnpm lint` because the rtk wrapper hides lint output;
    - `pnpm format:check`;
    - `pnpm prettier --check` on every file it touched outside `src app modules test`.
- **Counting JS tests.** Never trust a summary line: rtk prints `PASS(0) FAIL(0)` for a suite that failed to collect, and swallows exit codes. Use this:
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui <files…> --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
  ```
  - Positional paths are **substring filters**, so a typo silently runs fewer files. Confirm every printed `name` is a file you meant to run, and that the list is the length you expect.
  - Also confirm the `.json` file's mtime is from this run: a refused config leaves a stale one behind.
- **Counting Kotlin tests.** Read the counts from the XML, never from Gradle's summary:
  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests '<FQCN>' … > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"\| failures="[0-9]*"' build/test-results/test/*.xml | sort | uniq -c
  ```
  - Use `:test`, the core project's own task. `test` alone also runs `:host:test`, where a class filter matches nothing and Gradle fails with "No tests found".
- **Copy.**
  - Every operator-visible string is in all four dictionaries (`src/i18n/{en,es,fr,nl}.json`), copied from the _Copy_ table below.
  - Each task that changes es, fr or nl copy also adds `"_review": "pending translation review"` to each dictionary it touched, per `docs/i18n-glossary.md` _Translation review_. Task 8 runs the AI review pass, clears every marker, and adds the new terms to the glossary.
  - The glossary binds: es tú, fr vous, nl je; a colon, never a dash, in es, fr and nl status lines; French U+00A0, written ` ` in the JSON, before `:` `;` `?` `!`; straight apostrophes; sentence case.
  - Lengths fit `src/i18n/budgets.test.ts`.
  - Every key a task removes is checked with `grep -a` across `src app modules test` before it goes.
- **Commits.**
  - One commit per task, `git add` by path, never `-A`.
  - The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never write an `owner/repo#N` reference.
  - Nothing is pushed by an implementer. The orchestrator pushes and opens the PR after Task 8.

## Review Focus

1. **§4 is a native readiness change.** Every path that turned sound off must still turn it off: a call, the capture's close, an unpair. A silent room must never turn it off, before air or on air.
   - **New guard (F4): no audio buffer for `NO_AUDIO_MS` is not sound.** It is evaluated at each `readiness` call. The glue calls every 500 ms while the capture is open, whether or not a buffer came (`StreamerAdapter.kt:149-154`), so detection takes at most 2.5 s. Check that a silent buffer (level `0.0`) still counts as a buffer, and that only `null` means none.
   - **The close path (F5).** The glue's real order is `silenced()` (`BridgeCore.kt:280`), then the release's `readiness(false, …)` (`StreamerAdapter.kt:232`). That call passed `0.0`, which is a buffer under the new rule and would turn sound back on after the close. It now passes `null`. A GlueRulesTest rule pins the text.
   - **Cost of the window (F4).** StreamPack's own audio starts only with the stream. Between `beforeConnect`'s `sound.stop()` (`StreamerAdapter.kt:236`) and the first frame on air, a connect slower than 2 s shows sound not ready. The machine reads readiness only in Armed (`Pairings.kt:94-101`), so that cannot stop a connect. Only the meter turns orange. Task 9 item 29 looks at it.
   - **A residual race, pre-existing.** A glue tick posted after `silenced()` but before the release cancels the job can carry a real buffer. Nothing ticks after the close, so sound would read ready until the next opening. `SoundHold` had the same hole. It is named here, not fixed.
   - **The glue change compiles first on Task 9's release build.** `StreamerAdapter.kt`, `CoreCalls.kt` and `EngineHost.kt` are in the Android module, which no local task compiles. Keep the change to the three lines Task 1 names.
2. **§5's leave reuses the existing leave rule.** Check that the card is shown only by a leave that really went Home. Check that the code is forgotten exactly as before. Check that a fatal end keeps the code, as the card's wording claims. Check the two F14 guards: a code-ended Stop has no "Scan the code again" line, and Continue clears the card.
3. **Rotation (`free`) must never let the activity rotate under a held broadcast or a committed camera.** Read every `current === 'free'` path in `orientationGate`. The code says paired Settings closes the capture (F16, Task 7's top note). The phone confirms it in Task 9 item 65, and if it does not, Settings stays landscape-locked while paired.
4. **Layout claims that jsdom cannot see are routed to Task 9, not asserted in vitest.** A test that reads `getComputedStyle` pins declared sizes only. It never proves a fit. The window-size helper (D13) flips a branch. It proves nothing about fit.
5. **Removed things are gone everywhere.** `/stream/diagnostics`, `homeIntent`, `EndedBlock`, `SoundHold` and the `audio-below-floor` reason must leave nothing that still names them (`grep -a`). Neither may the old English strings: _No sound_, _Sound: ready_ and _Live with no sound_ (F1).
6. **All five advisories now live in the status strip, on air too (D4, F17, accepted).** The top strip is gone, so the strip is their only home. Check that none of the five is lost.

## Owner questions (ask before Task 1)

The orchestrator puts these to the owner as recommendations with their reasons, never as rulings. Each answer goes into _Owner answers_ with the date, and is committed with the plan before Task 1.

**Q1. Which Diagnostics rows go in Settings (gates Task 5).**

- §6 says "sections Link, Delivery, Phone, Heartbeat from the existing `useDiagnostics` sections". It also says the card fits "without the Diagnostics card scrolling at 640 × 360".
- Those four sections hold 20 rows today (`src/hooks/diagnostics.ts`): Link 8, Delivery 4, Phone 5, Heartbeat 3.
- In landscape at 360 dp tall, the card has about 290 dp after the header. At the board's row height of 22 to 24 dp, that is about 10 rows, plus its own header row.
- The Settings boards show 9 rows: Link (Transport, Bitrate, Round trip), Delivery (Viewers receiving, Behind live, Checked), Phone (Battery, Heat) and Heartbeat (Last sent).
- _Recommendation:_ the board's 9 rows, which are the keys `diag.transport`, `diag.bitrate`, `diag.rtt`, `diag.delivery`, `diag.lag`, `diag.checked`, `diag.battery`, `diag.thermal` and `diag.hbSent`. The other 11 rows and the Engine section stop being shown, and the whole record is still shared. _Alternative:_ every row, with the card scrolling inside itself, which amends §6's "without scrolling".

**Q2. The logo's size in landscape (gates Task 7).**

- §7 says 200 × 70 dp.
- The _After · you stopped_ landscape board and the Home landscape board draw it at 160 × 56, in the top row.
- _Recommendation:_ 200 × 70 in portrait, 160 × 56 in landscape, as the boards draw it. 200 × 70 in a 360 dp-tall landscape top row leaves too little for the tiles.

**Q3. What "not on air" means for Settings' rotation (gates Task 7).**

- §7 says Settings follows the phone "when not on air. On air, the existing lock-keeping rule holds".
- The existing rule (`selectHoldsOrientation`, ruling R24) holds the lock while **paired or live**, because the camera is committed from Paired (CD37). Read literally, then, Settings would only turn while idle. Settings is under `/stream`, though, so it is rarely open while idle, and §7's change would almost never be visible.
- _Recommendation:_ in Settings, "on air" means a broadcast is held (`selectEngineStatus === 'live'`). Paired Settings follows the phone. While Settings is open, the viewfinder's preview is detached: `BridgeCore.viewfinder(false)` closes the capture, so rotating Settings cannot rotate a live picture. Returning to the viewfinder re-locks landscape. Task 9 confirms on the phone that the preview comes back upright after a rotation in paired Settings. _Alternative:_ the literal reading.

**Q4. The status strip cannot fit the worst case at 640 × 360 (gates Tasks 2 and 3).**

- At 640 × 360 the camera half is 320 wide, so its 16:9 box is 180 tall and the strip has 180 dp.
- The strip's worst case before air needs 196 dp:
  - padding 10 + 10;
  - a doubles label, 4 partner lines at 20/22 = 88;
  - gap 6;
  - a 48-character not-ready status line, 2 lines at 15/22 = 44 in 288 dp of Geist;
  - gap 6;
  - a 56-character advisory at 12/16 Geist (`metricUnit`), 2 lines = 32.
- That is 16 dp over. §2's own rule moves only labels over 26 characters to 17 sp, so a doubles label of short names stays at 20 sp.
- The options:
  - **A, recommended:** the label also takes 17 sp whenever either side has partners (doubles), and the strip's vertical padding is 8. That gives 16 + 76 + 6 + 44 + 6 + 32 = 180, exactly, with no slack. Android font scale above 1.0 will still clip (see _What jsdom cannot see_).
  - **B:** the advisory caption is clamped to one line with an ellipsis. That fits at 20 sp (164) but can cut an advisory's meaning.
  - **C:** below 390 dp tall, the strip may clip its last line. This amends §1's "nothing clipped".

## Owner answers

_To be filled by the orchestrator before Task 1, one line per question: the answer, the date, and the owner's words._

- Q1: the recommendation, the board's 9 rows (`diag.transport`, `diag.bitrate`, `diag.rtt`, `diag.delivery`, `diag.lag`, `diag.checked`, `diag.battery`, `diag.thermal`, `diag.hbSent`); the other rows and the Engine section stop showing; Share record still shares the whole record. 2026-10-07, owner: "yes" (to all four recommendations).
- Q2: the recommendation, 200 × 70 in portrait and 160 × 56 in landscape. 2026-10-07, owner: "yes".
- Q3: the recommendation, Settings follows the phone unless a broadcast is held (`selectEngineStatus === 'live'`); paired Settings turns; the viewfinder re-locks landscape on return. 2026-10-07, owner: "yes".
- Q4: option A, a doubles label (either side has partners) takes 17 sp, and the strip's vertical padding is 8 (180 of 180 dp). 2026-10-07, owner: "yes".

## Pre-flight amendments

The pre-flight scan of this plan at `daa230c` found F1 to F20 (`.superpowers/sdd/2026-10-06-s1-design-pr-a/preflight.md`). Each carries the controller's ruling, applied here as written:

| #   | Finding, in short                                                                                | Landed in                                                                  |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| F1  | Three suites outside Task 1 assert the old sound copy                                            | Task 1 _Files_, Step 6 and Step 7 (the old English grep too)               |
| F2  | Task 4 removes Diagnostics, but `SettingsScreen.test.tsx` clicks it                              | Task 4 _Files_, Step 4a and Step 5 run; taken out of Task 5                |
| F3  | `stopped` and `fatal` leave for Home after Task 6                                                | Task 6 _Files_, Step 4 and Step 6 run                                      |
| F4  | No producer ever reports "no audio"                                                              | D1, D15; Task 1 _Interfaces_, Steps 2, 4 and 5 (M3, M5); Review Focus 1    |
| F5  | The glue's close re-turns sound on                                                               | Task 1 Step 2 (the C4a test and the glue rule), Step 4 and Step 5 (M4, M6) |
| F6  | `"degraded" in kinds()` can never fail                                                           | Task 1 Step 2: deleted                                                     |
| F7  | The D2 rule rewrite lost its positive control                                                    | Task 1 Step 2: `clock` and `newId` must parse                              |
| F8  | The `.filter` mutation names a test that cannot reach it; Q4-A has no code                       | Task 2 Steps 1 and 2                                                       |
| F9  | The fit test reserves the long size only                                                         | D17; Task 3 Steps 1 and 2; Task 9 items 16 to 18                           |
| F10 | `StreamStage` props, `chip-row`, the suite count, `TallyPlate` and `AudioMeter`, `onScanAnother` | Task 3 _Files_, Steps 3, 4 and 6                                           |
| F11 | `borderWidth: 2`; the double-press test pins old code; the `Glyph` mock drops `tone`             | Task 4 Steps 1 to 5                                                        |
| F12 | react-native-web reads `documentElement`, not `innerWidth`                                       | D10, D13; Task 5 Step 3; Task 7 Step 4                                     |
| F13 | Settings `dataSet`; the row count read from the code under test; the 84 dp literal               | Task 5 Steps 1, 3 and 4                                                    |
| F14 | A code-ended Stop says "scan again"; Continue keeps the card; case text                          | D7, D16; Task 6 _Interfaces_, Steps 1 to 5 (cases 4, 6, 10, 11; M5, M6)    |
| F15 | `routeTarget`'s file, `EndedCard` in landscape, the File map, Continue's place                   | File map; Task 7 _Files_, Steps 2 to 4                                     |
| F16 | Q3's "re-locks landscape"; whether Settings closes the capture                                   | Task 7's top note (the code fact); Task 7 Step 3; Task 9 item 65           |
| F17 | D4 moves all five advisories into the strip                                                      | D4 (accepted); Review Focus 6                                              |
| F18 | Task 9 misses no-audio, mic after reopen, the longest start time and the capture in Settings     | D14; Task 3 Step 2; Task 4 Steps 2 and 3; Task 9 items 22 to 29, 65 and 21 |
| F19 | Stale self-review, `Q4_DOUBLES`, AGENTS line numbers, an unfiltered bridge run                   | Global Constraints; Task 1 Step 7; Task 8 Steps 2 and 3; Self-review       |
| F20 | `stripStatus` duplicates `body`                                                                  | Task 2 Step 3; Task 3 Steps 2 and 4                                        |

## Spec premises found false

Labelled SP1 to SP4 since the pre-flight, so they never read as its F1 to F20.

- **SP1. The `audio-below-floor` degrade reason is not native.** §4 lists it beside the native change. It is TypeScript-only: `SessionState.ts:72-78` says so, and `Vocabulary.kt:15-29` records that native never sends it. Its removal is JS-only (Task 1). Natively there is `MIC_SILENCED` alone, which stays.
- **SP2. "_Open-source licences_ moves under the power advice" is already true.** `SettingsScreen.tsx` renders `SideChoice`, power label, power advice, `Licences`, in that order. Task 5 pins the order with a test instead of moving anything.
- **SP3. The 640 × 360 fit is not achievable as written for every §2 label case** (Q4).
- **SP4. The spec's verification names `pnpm check`.** That command runs the full vitest suite, which the owner's standing rule forbids locally. This plan runs `check`'s three non-test parts plus the scoped vitest files. CI runs `pnpm check` itself.
- **Checked and true:** "_Something failed. Your code is kept._" is truthful on a fatal end.
  - `forgetsSaved` (`src/domain/mode/reopen.ts`) forgets only on an unpair or an operator stop.
  - `leaveRule` gives a failed engine `free`, which runs `setActive(null)` and keeps the saved code.
  - Home's Continue card (`continueCard.ts`, kind `saved`) then offers it, and `tapToPairMark` re-pairs it.
  - The card reuses `stream.status.endedFatal` unchanged.

## Plan decisions

- **D1. Native's `sound` is "an audio buffer within the last `NO_AUDIO_MS`, and not silenced by the system" (F4).**
  - **The fact this rests on (F4).** Before this PR, an empty `PeakMeter.take()` returned `0.0` (`DeviceReadings.kt:38`). The glue handed that to the core every 500 ms (`StreamerAdapter.kt:149-154`), so "no buffer" and "a silent buffer" looked the same. `take()` now returns `null` when nothing was offered since the last take. A silent buffer is `0.0`, never `null`. The glue passes the take through unchanged, and `CoreCalls.readiness` (`CoreCalls.kt:13`) takes a `Double?`.
  - **No buffer for `NO_AUDIO_MS` (2 000 ms) is "audio capture unavailable" (§4).** The next buffer makes sound ready again, at the call that carries it. The constant is a `BridgeCore` companion value, not a constructor parameter, so D2 holds. Its cost: a real pause in buffers of over 2 s reads _Mic not available_. That happens at a connect (Review Focus 1); it is never a silent room.
  - A non-finite level never reaches the core as a buffer: `PeakMeter.offer` drops it (`DeviceReadings.kt:35`), so a take of only non-finite offers is `null`. The old NaN test guarded a value no producer sends. It is replaced by the no-buffer test, driven through `PeakMeter` (Task 1, M3 and M5).
  - **The capture's close clears it (the C4a carry), in the glue's real order (F5).** `noticeCapture` calls `silenced()` (`BridgeCore.kt:280`). Then the glue's `release()` reports `calls.readiness(false, 0.0)` (`StreamerAdapter.kt:232`), which this PR changes to `null`. Left at `0.0`, it is a buffer, and sound would read ready after the close.
  - When the system restores the mic, sound is ready again at once if a buffer came within the window. §4 says "ready when the call ends", and the glue keeps reading through a call.
  - `Readiness.AUDIO_FLOOR` and its parity test go: nothing native reads the level any more.
  - `wire/audio-floor.json`, `audioFloor.ts` and the JS `AUDIO_FLOOR` were deleted in Task 1. The meter's segments are `ceil(level * 6)` and its colour follows `selectSoundReady`, so nothing read them.
- **D2. `BridgeCore` loses its `silenceMs` parameter, so the glue rule test changes.** `GlueRulesTest`'s "final r2" rule ("the glue never passes a readiness timing override") becomes "BridgeCore declares no `…Ms` timing parameter". A new one then re-opens the rule instead of passing silently.
- **D3. The JVM host learns `micSilenced` on its `readiness` line.** The JS contract's `ready.sound = false` maps to it: a level can no longer make sound not ready. The host's `meter()` offers a reading every 500 ms (`Host.kt:123-128`), so the host never meets the no-buffer window. That window is proved in the JVM core tests through `PeakMeter`, not in the contract.
- **D4. The advisory caption moves into the status strip, under the status line.** `topAdvisory` and its priorities are unchanged: _keepOpen_, _shed_, _overlayFailed_, _notCharging_, then _scoreAhead_. _scoreAhead_ is already before-air only, from its `paired` input.
  - **Accepted at pre-flight (F17).** §1 names only _scoreAhead_ for the strip, but the top strip is gone and the other four must stay visible, on air too. The strip is their only home. Cost if wrong: a layout tweak.
  - The top and bottom `EdgeStrip`s go, and so does `EdgeStrip.tsx`, whose only user is the stage. Nothing is drawn over the camera box but the overlay and the _What viewers see_ video.
  - AGENTS §6's "Full-bleed preview" rule is amended in Task 8.
- **D5. `StreamStage` becomes the camera half and `StreamColumn` becomes the controls half.** Both keep their file names, so the existing tests' imports stay valid. Back's refusal line (`useColumnLine`) moves to `StreamScreen`, which hands the line to the strip.
- **D6. The card's _You stopped the broadcast._ and _Something failed. Your code is kept._ reuse the existing `stream.status.endedOperator` and `stream.status.endedFatal`.** They are the same strings in all four languages, so nothing is translated twice. New keys exist only for the title and OK.
- **D7. An Ended with no time on air goes Home too, and the card says _Never went live_ in place of the duration.** That covers the 401-deferral stop and a fatal end before the first frame. A Stop before the first frame is Paired, not Ended (`SessionMachine.kt:107-113`), so it stays on the viewfinder as §5 asks.
  - **A Stop over a code that ended (the 401 deferral, F14 a).** `SessionMachine.kt:111` ends a Stop as `operator-stopped` when `pairing.codeEndedPending` is set, live or not. That code is dead, so _Scan the code again_ would send the operator back to a dead code. Ended keeps the pairing, so its snapshot still carries `codeEndedPending: true` (`Projection.kt:38`, `CaptureEnginePort.ts:96`).
  - The card then omits _Scan the code again_ and shows the existing code-ended wording, `panel.codeEnded.body`: _This code has ended. Scan the new one._ (`en.json:45`, used today by `CodePanel.tsx:98`). No new copy. Cost: one less hint.
  - The card reads `codeEnded` only for `operator-stopped`, the deferral's own path. A fatal end with `codeEndedPending` set is outside this ruling. It keeps D6's _Your code is kept._ (see _Self-review, Unresolved_).
- **D8. `endedNotice` is an in-memory port built in `createNativePorts`.** A restart clears it by construction. `show` always stores a fresh object, so a second broadcast's card is never the first one's.
- **D9. Rotation.** `Target` gains `free`.
  - `routeTarget` returns `landscape` for `/stream` and `free` for everything else, which is Home and `/stream/settings`.
  - `free` with nothing held locks nothing (`lockAsync(OrientationLock.DEFAULT)`, which is Android's `UNSPECIFIED`). It follows the phone, within the user's own auto-rotate setting.
  - `free` while a broadcast is held keeps the lock. If nothing is locked yet, or the lock is `free`, it locks landscape (the R37 analogue). It never shows a card.
  - Returning to `landscape` while paired from a `free` lock never keeps `free`. It locks how the phone is held, with the turn card, as R24 does, or locks landscape when there is no reading yet. A `null` current keeps today's meaning.
  - `portrait` and `turnUpright` stay in the domain and its tests, though no route asks for them now. Removing them is a separate change the reviewer may ask for.
- **D10. Home's layout is `landscape` when the window is wider than tall (`useWindowDimensions`).** It is one tree, branched by style, with a `dataSet={{ layout }}` marker that tests read. Task 7 pins both branches explicitly and proves they offer the same controls in the same order.
  - **Corrected at pre-flight (F12).** react-native-web 0.21.2 never reads `window.innerWidth`. Its `Dimensions.update` reads `window.visualViewport` when there is one, else `document.documentElement.clientWidth` and `clientHeight` (`node_modules/react-native-web/dist/exports/Dimensions/index.js:44-58`). It re-reads them on window `resize` (lines 117-121). jsdom has no `visualViewport`, and its `documentElement` is 0 × 0, so `screenLayout(0, 0)` is `portrait`. Every existing Home and Settings suite therefore renders the **portrait** branch, today's layout, unless a test sets the window with D13's helper.
- **D11. The logo lives at `src/ui/assets/logo-wide-night.png`, inside the `ui` element, so the import is legal.** A `src/ui/assets/png.d.ts` declares `*.png` as an `ImageSourcePropType`, because `expo-env.d.ts` is gitignored and cannot be relied on.
- **D12. `homeIntent` is deleted.** Its only producer was _Scan another_. Its consumer, `useScanRequest` in `useHome.ts`, goes with it.
- **D13. The window-size test helper (F12, "pick one"): stub `documentElement`'s `clientWidth` and `clientHeight` getters and fire `resize`.** The rejected alternative was mocking `useWindowDimensions`.
  - _Why:_ the stub drives react-native-web's real `Dimensions` → `useWindowDimensions` path, so a test also proves the screen reads the window. A mock would make the marker follow the mock and prove only the branch.
  - It is one shared file, `test/windowSize.ts`, created in Task 5 (its first user) and reused in Task 7. Each test file that uses it registers `afterEach(restoreWindowSize)`.
  - Each task that uses it has a positive control, which shows the helper really flips the layout.
- **D14. The AUTO start time stays on its own line under the chips (F18, "pick one").** It does not share `chip-row`, and the fit test counts it as its own line. The rejected alternative was a chip row that wraps to a second line.
  - _Why:_ this is where `PreflightChips.tsx:39-41` already puts it (amendment §2). The longest start time is es _Empieza a las 14:32 CEST_. It would have about 70 dp beside three 44 dp chips and AUTO in a 288 dp row, and would wrap to three lines. Under the chips it has the whole 288 dp.
  - The fit arithmetic: 340 of 360 before air, with the line counted (Task 3 Step 2).
  - Task 4 therefore does not move it into the row.
- **D15. `NO_AUDIO_MS` is judged at each `readiness` call, not by a timer of its own (F4).**
  - _Why:_ the glue calls every 500 ms while the capture is open, buffer or not (`StreamerAdapter.kt:149-154`). A timer per buffer would put up to 50 cancellations a second on the core's scheduler.
  - The JVM tests drive the same cadence: a readiness call every 500 ms, the glue's `READINESS_MS`.
- **D16. Continue clears the _Stream ended_ card, like a new scan (F14 b).** `useContinue` (`useHome.ts:472-499`) calls `endedNotice.clear()` beside `setStatusKey(null)`, on the path that re-pairs. An expired code does not re-pair and leaves the card. Cost: none visible.
- **D17. The strip's label reservation is the larger of the two size rules (F9).**
  - _Written assumption:_ a side of 26 characters or fewer, at 20 sp Barlow Condensed 600, does not wrap in the strip's 288 dp. That is 26 × about 9 dp = 234 dp. A side over 26 characters is already 17 sp (§2), and doubles are 17 sp (Q4 A).
  - So the regular size needs at most 2 lines (`labelLinesRegular`, 2 × 22 = 44), and the long size at most 4 (4 × 19 = 76). The test reserves `max(44, 76)`.
  - Doubles are two partners a side. A side with three partners is 3 lines and overruns, so it is a Task 9 observation.
  - _Cost if wrong:_ one clipped line on a 360 dp-tall phone. Task 9 item 17 catches it with a 26-character side.

## What jsdom can and cannot see

- **jsdom can see:**
  - text, roles and accessible names, and DOM order;
  - `dataSet` markers;
  - computed styles that react-native-web injects. `Hud.test.tsx`'s `backgroundOf` already reads them with `getComputedStyle`, so `min-height`, `width`, `height`, `flex-direction` and `border-color` can all be pinned to their tokens.
  - jsdom also runs the pure fit arithmetic in `src/ui/theme/viewfinderFit.test.ts`, which sums the declared reservations against 640 × 360.
- **jsdom cannot see**, so each item is a Task 9 check on the phone:
  - real layout: whether text wraps, where an ellipsis lands, and whether anything is clipped;
  - the real 16:9 box from `aspectRatio`;
  - font metrics: whether a 48-character status line takes 2 lines in 288 dp;
  - Android font scale;
  - the rotation itself: `lockAsync(DEFAULT)` against the phone's auto-rotate;
  - the overlay WebView over the box;
  - the native preview after a rotation;
  - a Stop after live landing on Home.

  No vitest test may claim one of these.

## Copy

Lengths are counted with `s.length`, as `budgets.test.ts` counts. French ` ` counts as 1.

| Key                           | en                                          | es                                          | fr                                        | nl                                      | Change, budget                                             |
| ----------------------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `stream.chip.sound`           | Mic                                         | Micro                                       | Micro                                     | Microfoon                               | changed (T1); 10                                           |
| `stream.blocker.sound`        | Mic not available                           | Micro no disponible                         | Micro indisponible                        | Microfoon niet bruikbaar                | changed (T1); 24. nl: _niet beschikbaar_ would be 26       |
| `stream.status.notReadySound` | Can't go live yet — the mic isn't available | Aún no se puede emitir: micro no disponible | Pas encore de direct : micro indisponible | Nog niet live: microfoon niet bruikbaar | changed (T1); 48. Lengths 43, 43, 41, 29                   |
| `stream.status.liveNoSound`   | —                                           | —                                           | —                                         | —                                       | removed (T1)                                               |
| `stream.link.diagnostics`     | —                                           | —                                           | —                                         | —                                       | removed (T4)                                               |
| `diag.section.record`         | —                                           | —                                           | —                                         | —                                       | removed (T5) if `grep -a` finds no other user              |
| `stream.ended.scanAnother`    | —                                           | —                                           | —                                         | —                                       | removed (T6), with its `budgets.test.ts` row               |
| `brand`                       | Seazn Club                                  | Seazn Club                                  | Seazn Club                                | Seazn Club                              | changed (T7): the logo's accessible name, never translated |
| `home.ended.title`            | Stream ended                                | Emisión terminada                           | Direct terminé                            | Stream beëindigd                        | new (T6); the card's title and its region name             |
| `home.ended.ok`               | OK                                          | Aceptar                                     | OK                                        | OK                                      | new (T6). es: Android's own button word                    |

Reused unchanged: `stream.ended.duration`, `stream.ended.neverLive`, `stream.ended.scanAgain`, `stream.status.endedOperator`, `stream.status.endedFatal`, `panel.codeEnded.body` (the code-ended Stop, F14 a), `stream.status.micSilenced`, `diag.title`, `diag.share`, `diag.shareFailed`, `stream.link.settings`, `stream.home` and `stream.peek.label`. Task 8 adds _Stream ended_, _OK (button)_ and _Mic not available_ to the glossary.

## File map

| Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tasks | What                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Readiness.kt`                                                                                                                                                                                                                                                                                                                                                                                                                                                | 1     | `micAvailable` replaces `audioPeak`; floor removed                               |
| `…/engine/adapter/BridgeCore.kt`, `…/engine/adapter/SoundHold.kt` (deleted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1     | mic availability: a buffer within `NO_AUDIO_MS`, not silenced; no silence window |
| `…/engine/adapter/DeviceReadings.kt` (`PeakMeter`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 1     | `take()` is `null` when no buffer came (F4)                                      |
| `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture/StreamerAdapter.kt`, `…/capture/run/CoreCalls.kt`                                                                                                                                                                                                                                                                                                                                                                                                                | 1     | the glue passes the take as is; its close reports no buffer (F4, F5)             |
| `…/core/host/src/main/kotlin/com/seazn/capture/engine/host/Host.kt`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 1     | `micSilenced` on the readiness line; no `SILENCE_MS`                             |
| `…/core/Vocabulary.kt`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1     | stale `audio-below-floor` comment                                                |
| `…/src/test/…/core/ReadinessTest.kt`, `Configs.kt`; `…/adapter/BridgeCoreTest.kt`, `GlueRulesTest.kt`, `DeviceReadingsTest.kt`, `HeldPoseTest.kt`, `EncoderKeysTest.kt`, `SoundHoldTest.kt` (deleted)                                                                                                                                                                                                                                                                                                                                           | 1     | tests                                                                            |
| `src/hooks/statusKey.ts`, `src/domain/session/SessionState.ts`, `src/hooks/engineSelectors.test-d.ts`, `src/hooks/statusKey.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                            | 1     | no `audio-below-floor`, no live-no-sound                                         |
| `src/ui/components/StreamColumn.test.tsx`, `src/ui/screens/StreamScreen.onAir.test.tsx`, `StreamScreen.paired.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                         | 1     | the old sound copy (F1)                                                          |
| `modules/capture-engine/src/FakeCaptureEngine.ts`, `FakeCaptureEngine.test.ts`, `test/hostEngine.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                            | 1     | fake and contract say "mic not available"                                        |
| `src/domain/session/matchLabel.ts` (+ test), `src/ui/components/MatchLabel.tsx` (+ test), `src/ui/theme/type.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                | 2     | the label                                                                        |
| `src/ui/theme/tokens.ts`, `src/ui/theme/viewfinderFit.test.ts`, `src/ui/screens/StreamScreen.tsx`, `StreamScreen.layout.test.tsx` (new), `src/ui/components/StreamStage.tsx`, `StreamColumn.tsx`, `StatusStrip.tsx` (new), `StatusLine.tsx`, `HoldAction.tsx`, `TallyPlate.tsx`, `AudioMeter.tsx`, `PreflightChips.tsx` (`chip-row`), `EdgeStrip.tsx` (deleted)                                                                                                                                                                                 | 3     | the halves                                                                       |
| `src/ui/components/Glyph.tsx` (new), `PreflightChips.tsx`, `IconButton.tsx` (new), `test/setup-ui.ts`, `src/ui/theme/tokens.ts` (`chipBorder`), `src/ui/screens/SettingsScreen.test.tsx` (F2)                                                                                                                                                                                                                                                                                                                                                   | 4     | icons                                                                            |
| `app/stream/diagnostics.tsx` (deleted), `src/ui/screens/DiagnosticsScreen.tsx` (deleted), `SettingsScreen.tsx`, `src/ui/components/DiagnosticsCard.tsx` (new), `src/hooks/settingsDiagnostics.ts` (new), `src/domain/mode/homeLayout.ts` (new), `src/hooks/diagnostics.ts`, `src/services/devicePorts.ts`, `src/services/native/expoRouterNavigation.ts`, `src/hooks/useStreamLinks.ts`, `src/ui/theme/tokens.ts` (`diagSection`), `test/windowSize.ts` (new), `test/routedApp.tsx`, `test/backFromSubScreen.tsx`                               | 5     | Diagnostics in Settings                                                          |
| `src/services/endedNotice.ts` (new), `src/services/homeIntent.ts` (deleted), `src/domain/session/endedCard.ts` (new), `src/hooks/useEndedNotice.ts` (new), `src/ui/components/EndedCard.tsx` (new), `EndedBlock.tsx` (deleted), `src/hooks/engineSelectors.ts` (`selectCodeEndedPending`), `src/hooks/useViewfinder.ts`, `useHome.ts`, `usePorts.tsx`, `nativePorts.ts`, `test/fakePorts.ts`, `src/domain/mode/reopen.ts` (comments), `src/ui/screens/SettingsScreen.test.tsx` (F3)                                                             | 6     | Stop → Home                                                                      |
| `src/ui/assets/logo-wide-night.png` (copied), `src/ui/assets/png.d.ts`, `src/ui/assets/logo.test.ts` (new), `src/domain/orientation/orientation.ts` (+ test), `src/hooks/useOrientationGate.ts` (`routeTarget`, + test), `src/hooks/engineSelectors.ts` (`selectBroadcastHeld`), `src/services/devicePorts.ts`, `src/services/native/nativeOrientationLock.ts` (+ new test), `src/ui/theme/tokens.ts` (`logo`, `logoLandscape`), `HomeScreen.tsx`, `HomeScreen.layout.test.tsx` (new), `HomeFooter.tsx`, `EndedCard.tsx` (one row in landscape) | 7     | Home, logo, rotation                                                             |
| `AGENTS.md`, `docs/i18n-glossary.md`, the four dictionaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 8     | rules, review pass                                                               |

---

## Task 1: A silent room is ready (§4)

**Files:**

- Modify:
  - `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Readiness.kt`
  - `…/core/Vocabulary.kt` (the comment at lines 15–29)
  - `…/adapter/BridgeCore.kt` (constructor at lines 34–43, the `sounds` field at line 53, `readiness` at lines 190–205, `silenced` and `micSilenced` at lines 283–302, and the comments at lines 540 and in `CappedLines`)
  - `modules/capture-engine/android/core/host/src/main/kotlin/com/seazn/capture/engine/host/Host.kt` (lines 13–32, 63–69 and 119–157)
  - `…/engine/adapter/DeviceReadings.kt:26-39` (`PeakMeter`, F4)
  - The glue, three call sites (F4, F5). It is compiled first by Task 9's release build (Review Focus 1):
    - `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture/StreamerAdapter.kt:118` (`facts()`), `:149-154` (`reportReadiness`) and `:232` (`release()`'s last line)
    - `…/capture/run/CoreCalls.kt:13` (`readiness`'s type)
- Delete:
  - `…/adapter/SoundHold.kt`
  - `…/src/test/kotlin/com/seazn/capture/engine/adapter/SoundHoldTest.kt`
- Test:
  - `…/core/ReadinessTest.kt`
  - `…/core/Configs.kt:86`
  - `…/adapter/BridgeCoreTest.kt` (lines 1210–1338, the sound tests)
  - `…/adapter/GlueRulesTest.kt:125-150`, plus one new rule (F5)
  - `…/adapter/DeviceReadingsTest.kt:29-48` (the `PeakMeter` cases, F4)
  - `…/adapter/HeldPoseTest.kt:57`
  - `…/adapter/EncoderKeysTest.kt:25`
  - `…/host/src/test/kotlin/com/seazn/capture/engine/host/ProtocolTest.kt`, if it constructs a `Readiness`
- JS tests that assert the old sound copy (F1):
  - `src/ui/components/StreamColumn.test.tsx:117-131` (_No sound_)
  - `src/ui/screens/StreamScreen.onAir.test.tsx:83-88` and `:119-125` (_Live with no sound…_)
  - `src/ui/screens/StreamScreen.paired.test.tsx:58`, `:80` and `:106` (_Sound: ready_, `'Sound'`, `'No sound'`)
- JS:
  - `src/hooks/statusKey.ts` (lines 1, 25 and 155–159)
  - `src/domain/session/SessionState.ts:60-90`
  - `src/hooks/engineSelectors.test-d.ts:46`
  - `src/hooks/statusKey.test.ts` (lines 133–149 and 538)
  - `modules/capture-engine/src/FakeCaptureEngine.ts` (the `paired-not-ready` scene, around lines 300–310)
  - `modules/capture-engine/src/FakeCaptureEngine.test.ts:461`
  - `test/hostEngine.ts` (lines 84–92 and the comment at 203–207)
  - `src/ui/components/AudioMeter.tsx` (its KDoc)
  - `src/ui/components/Hud.test.tsx:235-238` (its comment)
  - the four dictionaries

Re-pin every line number before editing. They are from `ff4f191`.

**Interfaces:**

```kotlin
data class Readiness(val cameraFrames: Boolean, val micAvailable: Boolean, val pose: Pose) {
  val sound: Boolean get() = micAvailable
  // held, side, notReady(camera, networkValidated) unchanged
  companion object { val UNKNOWN = Readiness(cameraFrames = false, micAvailable = false, pose = Pose.NotHeld) }
}
class BridgeCore(clock, scheduler, platform, store, appVersion, model, newId = …) { // no silenceMs
  companion object {
    /** Spec §4, pre-flight F4: no audio buffer for this long is "audio capture unavailable". */
    const val NO_AUDIO_MS = 2_000L
  }
}
// Unchanged signature. A null audioPeak is "no buffer since the last call" (F4): it refreshes nothing.
fun BridgeCore.readiness(cameraFrames: Boolean? = null, audioPeak: Double? = null, pose: Pose? = null)

class PeakMeter {
  fun offer(level: Double)  // unchanged: a non-finite level is dropped
  fun take(): Double?       // F4: null when nothing was offered since the last take; a silent buffer is 0.0
}
class CoreCalls(…, val readiness: (cameraFrames: Boolean, audioPeak: Double?) -> Unit, …)
```

- [ ] **Step 1: Baselines.**
  - Run `pnpm install --frozen-lockfile` once.
  - Run the Gradle filter below and the JS files below, and record the counts. These are the "before" numbers every later count is relative to.
  - Write down the `NotReady.SOUND`, `sound` and `audioPeak` uses: `cd "$WT" && grep -arn "audioPeak\|SoundHold\|SILENCE_MS\|silenceMs\|AUDIO_FLOOR\b" modules/capture-engine/android --include=*.kt | grep -v /build/`. Every hit is either changed in this task or named here as untouched. `StallWatchdog.AUDIO_FLOOR_FPS` is the audio packet rate, unrelated, and stays.
  - Write down the old English too (F1): `cd "$WT" && grep -arn "No sound\|Sound: \|'Sound'\|Live with no sound\|no sound from the mic" src app modules test`. Each hit is rewritten in Step 6. `Live. Sound and picture going out.` is not matched by these patterns and stays.

- [ ] **Step 2: Write the failing JVM tests (§4's four, plus the carries).**
  - Delete `SoundHoldTest.kt`. Each of its rules either dies with the window or moves to `BridgeCoreTest`, as listed in Step 5.
  - In `BridgeCoreTest.kt`, replace the five sound tests at lines 1210–1338: "silent at the open…", `C4a carry…`, and the three `hysteresis …` tests. Put these in their place:

```kotlin
  /** Spec §4 (owner, 2026-10-06): "even though there is no sound … it is ok … should allow to go live". */
  @Test
  fun `S4 a room silent from the start is sound at its first reading`() {
    core.start()
    pair()
    core.viewfinder(true)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "no reading yet: the mic is not known to be available")
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "a silent reading is a working mic")
    assertTrue(lines().last { it.getString("kind") == "readiness" }.getBoolean("sound"), "and on the record")
  }

  /** Spec §4: 60 s of silence is still ready. 60 s is the spec's figure; the cadence is the engine's tick. */
  @Test
  fun `S4 sixty seconds of silence stays sound`() {
    core.start()
    pair()
    core.viewfinder(true)
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    val from = clock.monotonicMs()
    var readings = 0
    while (clock.monotonicMs() < from + 60_000) {
      core.readiness(audioPeak = 0.0)
      scheduler.advanceBy(0)
      assertEquals(true, readyOn(core)["sound"], "${clock.monotonicMs() - from} ms of silence")
      scheduler.advanceBy(Engine.TICK_MS)
      readings += 1
    }
    assertEquals(60_000 / Engine.TICK_MS, readings.toLong(), "the sweep's own count")
  }

  /** Spec §4: a call takes the mic (F-P5-8) and gives it back; the sequence twice, so the second call is not the first's leftovers. */
  @Test
  fun `S4 a call makes sound not ready at once, and ready again the moment it ends, twice`() {
    core.start()
    pair()
    core.viewfinder(true)
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    repeat(2) { call ->
      core.report(Input.MicSilenced(true))
      scheduler.advanceBy(0)
      assertEquals(false, readyOn(core)["sound"], "call ${call + 1}: at once, with no reading after it")
      core.readiness(audioPeak = 0.4)
      scheduler.advanceBy(Engine.TICK_MS)
      assertEquals(false, readyOn(core)["sound"], "call ${call + 1}: a loud reading while silenced is not sound")
      core.report(Input.MicSilenced(false))
      scheduler.advanceBy(0)
      assertEquals(true, readyOn(core)["sound"], "call ${call + 1}: ready when the call ends, with no reading after it")
    }
    assertEquals(2, kinds().count { it == "mic-silenced" }, "the machine heard both calls, as ever")
  }

  /** Spec §4: on air, a silent room never degrades, and the broadcast never leaves publishing. */
  @Test
  fun `S4 on air a silent room never degrades`() {
    live()
    assertEquals("publishing", state())
    val from = clock.monotonicMs()
    var readings = 0
    while (clock.monotonicMs() < from + 60_000) {
      core.readiness(audioPeak = 0.0)
      scheduler.advanceBy(Engine.TICK_MS)
      assertEquals("publishing", state(), "${clock.monotonicMs() - from} ms of silence on air")
      readings += 1
    }
    assertEquals(60_000 / Engine.TICK_MS, readings.toLong(), "the sweep's own count")
    assertEquals(true, readyOn(core)["sound"])
    // F6: no record assertion. No record kind "degraded" exists, so one could never fail; the per-step state() is the witness.
  }

  /**
   * C4a carry, in the glue's real call order (pre-flight F5). The close is `noticeCapture` → `silenced()`
   * (BridgeCore.kt:280), then the glue's `release()` reports `readiness(false, null)` (StreamerAdapter.kt:232, `0.0`
   * before this task). Spec §4: a closed capture is "audio capture unavailable", so sound is not ready after it.
   */
  @Test
  fun `C4a carry the capture's close is not sound after the glue's close report, and the next opening's first buffer is`() {
    core.start()
    pair()
    core.viewfinder(true)
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"])
    core.viewfinder(false) // posted first: noticeCapture closes the capture and calls silenced()
    core.readiness(cameraFrames = false, audioPeak = null) // posted after: the glue's release(), as it reports
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "closed: the capture delivers nothing")
    core.viewfinder(true)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "open, no buffer yet")
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "its first buffer, silent or not")
  }

  /**
   * Spec §4 "audio capture unavailable", pre-flight F4. Driven through the real producer: the glue's tick hands the
   * core PeakMeter's take every READINESS_MS (StreamerAdapter.kt:149-154), and the take is null when no buffer came.
   */
  @Test
  fun `S4 no audio buffer for NO_AUDIO_MS is not sound, and the next buffer is`() {
    val glueTickMs = 500L // StreamerAdapter.READINESS_MS, the glue's cadence
    val meter = PeakMeter()
    core.start()
    pair()
    core.viewfinder(true)
    meter.offer(0.0) // a silent buffer: a working mic
    core.readiness(audioPeak = meter.take())
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "a silent buffer is a working mic")
    var ticks = 0
    for (elapsed in glueTickMs..(BridgeCore.NO_AUDIO_MS + glueTickMs) step glueTickMs) {
      scheduler.advanceBy(glueTickMs)
      core.readiness(audioPeak = meter.take()) // nothing was offered: null
      scheduler.advanceBy(0)
      assertEquals(elapsed < BridgeCore.NO_AUDIO_MS, readyOn(core)["sound"], "$elapsed ms with no audio buffer")
      ticks += 1
    }
    assertEquals((BridgeCore.NO_AUDIO_MS / glueTickMs + 1).toInt(), ticks, "the sweep's own count")
    meter.offer(0.0)
    core.readiness(audioPeak = meter.take())
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "the next buffer, silent, is a working mic again")
  }
```

- `DeviceReadingsTest.kt` (F4), at the producer:
  - In `the meter keeps the highest peak until it is taken`, the second `take()` becomes `assertNull(meter.take(), "no buffer since the last take")`.
  - In `a level that is not finite is no reading…`, the last line becomes `assertNull(meter.take(), "an infinite level alone is no buffer")`.
  - Add one case:

```kotlin
  /** Pre-flight F4: a silent buffer and no buffer are different facts; only the first is a working mic (spec §4). */
  @Test
  fun `a silent buffer is 0, and no buffer since the last take is null`() {
    val meter = PeakMeter()
    assertNull(meter.take(), "nothing offered yet")
    meter.offer(0.0)
    assertEquals(0.0, meter.take(), "a silent buffer")
    assertNull(meter.take(), "and none since")
  }
```

- `GlueRulesTest.kt` gains a rule for the close path (F5). It reads the glue's text, like every rule there:

```kotlin
  /**
   * Pre-flight F5: under spec §4 any finite level is a buffer, so the release's closing report must carry none, or
   * sound reads ready after the capture is gone. The tick hands over PeakMeter's take as it is (F4).
   */
  @Test
  fun `F5 the glue's release reports no audio buffer, and its tick hands over the meter's take`() {
    val glue = sources().single { it.name == "StreamerAdapter.kt" }.readText()
    val at = glue.indexOf("override suspend fun release()").also { assertTrue(it >= 0, "release()") }
    val release = glue.substring(at, glue.indexOf("\n    }\n", at))
    assertTrue("calls.readiness(false, null)" in release, "release() reports no buffer: $release")
    assertFalse(Regex("""calls\.readiness\([^)]*\b0\.0\b""").containsMatchIn(glue), "no literal level reaches the core as a buffer")
    assertTrue("ready.take())" in glue.substring(glue.indexOf("private suspend fun reportReadiness()")), "the tick passes the take")
  }
```

- Keep `hysteresis a pair, an unpair and a re-pair carry no readiness window over` under a new name, `S4 a pair, an unpair and a re-pair carry no mic state over`. Change it like this:
  - drop its two silence sweeps;
  - after the unpair and re-pair, assert `sound` is false until pairing 2's first reading, and true at it, at level `0.0`.
- Before writing any of these, confirm that `live()` (BridgeCoreTest line 54) leaves the core with `viewfinder(true)`. If it does not, open the viewfinder before the sweep.
- In `ReadinessTest.kt`:
  - delete `A11 the floor is the one JS draws its notch at`;
  - rewrite `ready` as `Readiness(cameraFrames = true, micAvailable = true, pose = Pose.Held(Side.RIGHT))`;
  - make the SOUND case `ready.copy(micAvailable = false)`;
  - replace the floor test with `S4 sound is the mic's availability, whatever the level`: `assertNull(ready.notReady(OWN, true))` and `assertEquals(NotReady.SOUND, ready.copy(micAvailable = false).notReady(OWN, true))`.
- In `GlueRulesTest.kt`, rewrite `final r2 the glue never passes the core a readiness timing override` as `D2 BridgeCore declares no readiness timing parameter`. Keep the constructor parse. Replace `assertTrue("silenceMs" in timing, …)` with a positive control (F7), so an empty parse fails instead of passing:

```kotlin
    assertTrue("clock" in params && "newId" in params, "the constructor parsed: $params")
    assertEquals(emptyList(), timing, "a new timing parameter re-opens final r2: the glue must never pass it")
```

`NO_AUDIO_MS` is a companion constant, not a parameter, so this rule stays green with it. Drop the old rule's call-site loop: it reads `timing.first()`, which an empty list cannot give, and the empty list already says there is nothing to pass.

- `Configs.READY` becomes `Readiness(cameraFrames = true, micAvailable = true, pose = Pose.Held(Side.LEFT))`. `HeldPoseTest:57` and `EncoderKeysTest:25` change likewise.
- **The window touches existing tests (F4).** A test that reports one reading, waits past `NO_AUDIO_MS`, and then reports another fact (a pose, the camera) now reads sound not ready at that report. That is §4's rule, not a regression. Give such a test a reading at the glue's cadence before the report. Never change an assertion about another check to make it pass. List each test changed this way in the commit body.

- [ ] **Step 3: Run them red.**

  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.adapter.BridgeCoreTest' --tests 'com.seazn.capture.engine.core.ReadinessTest' --tests 'com.seazn.capture.engine.adapter.GlueRulesTest' --tests 'com.seazn.capture.engine.adapter.DeviceReadingsTest' --tests 'com.seazn.capture.engine.adapter.HeldPoseTest' --tests 'com.seazn.capture.engine.adapter.EncoderKeysTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  ```

  Re-pin each class's package before running: a `--tests` filter that matches nothing fails the run with "No tests found", which is the signal to fix it, not to drop the filter.

  Expected: compilation fails on `micAvailable`. That is the red state for a signature change. Note it, then go on.

- [ ] **Step 4: Implement.**
  - `Readiness.kt`: as in _Interfaces_. Delete `AUDIO_FLOOR` and its KDoc. Rewrite the class KDoc to cite spec §4 and the owner's words.
  - `BridgeCore.kt`:
    - remove the `silenceMs` parameter, its KDoc, and the `sounds` field;
    - add the two facts, the window and one predicate:

    ```kotlin
      /** Spec §4, pre-flight F4: when the open capture last delivered an audio buffer (D1). Cleared at the capture's close. */
      private var lastAudioAtMs: Long? = null

      /** The system's last word on our recording (F-P5-8, `MicSilenceWatch`), kept across the capture's close. */
      private var systemSilenced = false

      /** D15: judged at each call; the glue calls every 500 ms while the capture is open, buffer or not. */
      private fun micAvailable(): Boolean {
        val heard = lastAudioAtMs ?: return false
        return clock.monotonicMs() - heard < NO_AUDIO_MS && !systemSilenced
      }
    ```

    - add `NO_AUDIO_MS = 2_000L` to the companion, with the KDoc in _Interfaces_;
    - in `readiness(...)`, keep `atMs`, and drop the `sounds.sample` call and the `peak` line;
    - inside the scheduled block, put:

    ```kotlin
          if (audioPeak != null && audioPeak.isFinite()) lastAudioAtMs = atMs // a null is no buffer (F4)
          readiness = readiness.copy(cameraFrames = cameraFrames ?: readiness.cameraFrames, micAvailable = micAvailable(), pose = ours ?: readiness.pose)
    ```

    - `silenced()` becomes `lastAudioAtMs = null; turnMic()`;
    - `micSilenced(silenced)` becomes `systemSilenced = silenced; turnMic()`;
    - add `turnMic`:

    ```kotlin
      /** Sends readiness when the mic's availability changed since the last one sent; nothing before the first. */
      private fun turnMic() {
        readiness = readiness.copy(micAvailable = micAvailable())
        val last = sent ?: return
        if (last.sound != readiness.sound) sendReadiness()
      }
    ```

    - keep each call site of `silenced()` and `micSilenced()` on the thread it is on today;
    - rewrite the KDocs that cite `SoundHold` (`readiness`, `silenced`, `micSilenced`, line 540, `CappedLines`) to cite spec §4.

  - `Host.kt`:
    - construct `BridgeCore(...)` without `silenceMs`;
    - in `"readiness"`, before `core.readiness(...)`, add `(json.opt("micSilenced") as? Boolean)?.let { core.report(Input.MicSilenced(it)) }`;
    - ack with `whenQuiet(seq, METER_SETTLE_MS)`;
    - delete `settleFor` and `SILENCE_MS`;
    - rewrite the class KDoc's sound paragraph: sound is ready at the first reading, and `micSilenced` is the contract's only way to make it not ready.
  - `Vocabulary.kt`: the "Also absent: `audio-below-floor`…" sentence becomes "Also absent: any level-based reason; a silent room is ready and on air is plain Live (spec §4)."
  - `DeviceReadings.kt`, `PeakMeter` (F4):

    ```kotlin
    class PeakMeter {
      private var peak: Double? = null

      @Synchronized
      fun offer(level: Double) {
        if (level.isFinite()) peak = maxOf(peak ?: level, level)
      }

      /** The highest level since the last take, or null when no buffer came (spec §4: no buffer is no mic). */
      @Synchronized fun take(): Double? = peak.also { peak = null }
    }
    ```

    Rewrite its KDoc: a level that is not finite is no buffer.

  - The glue, exactly three call sites (F4, F5):
    - `StreamerAdapter.kt:118`: `CaptureFacts(shown.take() ?: 0.0, clock.lastVideoEpochMs)`. The meter shows no buffer as silence, as it does today.
    - `StreamerAdapter.kt:151` stays `calls.readiness(current.value?.let(::cameraOurs) ?: false, ready.take())`, now passing a `Double?`.
    - `StreamerAdapter.kt:232`: `calls.readiness(false, null)`. Add a comment: "no buffer: the capture is gone (spec §4, pre-flight F5)".
    - `CoreCalls.kt:13`: `val readiness: (cameraFrames: Boolean, audioPeak: Double?) -> Unit`. The lambda at `EngineHost.kt:143` needs no change.
  - Delete `SoundHold.kt`.

- [ ] **Step 5: Run green, then mutate.**
  - Run the Step 3 command, then the host and the bridge contract:

  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :host:test :host:installDist > "$TMPDIR/h.log" 2>&1; echo "EXIT=$?"
  ```
  - Each `SoundHoldTest` rule maps like this:
    - "first loud reading is sound" → `S4 a room silent…`;
    - the window rules die with the window (owner, 2026-10-06);
    - "micSilenced" → `S4 a call…`;
    - "reset" → the C4a carry.
  - Run six mutations, one at a time, each from a `cp` backup. M3 to M6 are the new guards' own (F4, F5):
    - **M1.** `Readiness.sound` → `get() = true`. `S4 a call…` must fail.
    - **M2.** In `micAvailable()`, drop `&& !systemSilenced`. `S4 a call…` must fail.
    - **M3, the no-audio window (F4).** In `micAvailable()`, drop the window: `return !systemSilenced` after the null check. `S4 no audio buffer for NO_AUDIO_MS…` must fail at 2 000 ms.
    - **M4, the close (F5).** In `silenced()`, delete `lastAudioAtMs = null`. `C4a carry the capture's close…` must fail at "closed".
    - **M5, the producer (F4).** In `PeakMeter.take()`, reset to `0.0` instead of `null`. `a silent buffer is 0, and no buffer… is null` must fail. So must `S4 no audio buffer…`, at 2 000 ms.
    - **M6, the glue's close report (F5).** Put `calls.readiness(false, 0.0)` back at `StreamerAdapter.kt:232`. `F5 the glue's release reports no audio buffer…` must fail.
  - A seventh check, of the old rule rather than of a new guard: make the predicate `micAvailable() && (audioPeak ?: 0.0) >= 0.05` again. `S4 a room silent…`, `S4 sixty seconds…` and `S4 on air…` must all fail. That proves the tests witness §4, not just the refactor.

- [ ] **Step 6: The JS side.**
  - In `statusKey.ts`:
    - delete the `'audio-below-floor'` row and the `AUDIO_FLOOR` import;
    - `case 'publishing': return 'stream.status.live';`.
  - In `SessionState.ts`, delete `| 'audio-below-floor'` and its comment (lines 72–78).
  - In `engineSelectors.test-d.ts:46`, make it `expectTypeOf<DegradeReason>().toEqualTypeOf<'not-delivered' | 'camera-taken' | 'mic-silenced' | 'poor-uplink' | 'fell-back-to-rtmps'>()`.
  - In `statusKey.test.ts`, replace lines 133–149 with:

```ts
// Spec §4 (owner, 2026-10-06): the level decides nothing on air; a quiet room is plain Live.
it.each([0, 0.01, 0.049, 0.05, 0.4])('says plain Live on air at level %s', (audioLevel) => {
  expect(line(snap(LIVE, { ...ARMED_OK, audioLevel }))).toBe('Live. Sound and picture going out.');
});
// The mic-silenced warning stays (spec §4): its line is the DEGRADED table's, unchanged.
```

- Drop `'stream.status.liveNoSound'` from the list at line 538.
- Run the new `it.each` red first, before the `statusKey.ts` change: 3 of 5 fail (0, 0.01, 0.049).
- `FakeCaptureEngine.ts`: the `paired-not-ready` scene keeps `ready.sound: false`. Its comment becomes "the mic is not available". Its level becomes `0`, so no test can read a below-floor level as the cause.
- `FakeCaptureEngine.test.ts:461`: the title becomes "paired-not-ready has the mic not available". Assert `ready.sound === false` only, with no `AUDIO_FLOOR` comparison.
- `test/hostEngine.ts` `readinessLine`: `...(ready.sound === undefined ? {} : { micSilenced: !ready.sound })`. Remove the `audioPeak` mapping. Rewrite the comment at lines 203–207: sound is ready at the host's first reading, and the wait is the host-alive check.
- `AudioMeter.tsx` KDoc: "orange when the mic is not available" (no behaviour change: it already colours by `selectSoundReady`). Change the `Hud.test.tsx:235-238` comment the same way.
- Copy: the `stream.chip.sound`, `stream.blocker.sound` and `stream.status.notReadySound` rows of _Copy_, in all four languages. Delete `stream.status.liveNoSound` from all four. Add the `_review` marker to es, fr and nl.
- **The three suites that assert the old copy (F1).** The expected strings are the spec's English (§4: _Mic not available_) and _Copy_'s en column:
  - `StreamColumn.test.tsx:122` and `:131`: `'No sound'` becomes `'Mic not available'`.
  - `StreamScreen.paired.test.tsx:58` and `:106`: `getByLabelText('Sound: ready')` becomes `getByLabelText('Mic: ready')`. The row at `:80`, `['sound', 'Sound', 'No sound']`, becomes `['sound', 'Mic', 'Mic not available']`.
  - `StreamScreen.onAir.test.tsx:83-88` is replaced. Its D39 rule is gone (§4):

```ts
it('says plain Live when the room is quiet on air (spec §4: a silent room is ready)', async () => {
  const view = await onAir('live');
  act(() => view.engine.patch({ audioLevel: 0.01 }));
  expect(plate()).toBe('Live');
  expect(screen.getByText(LIVE_LINE)).toBeTruthy();
  expect(screen.queryByText('Live with no sound. Check the mic now.')).toBeNull();
});
```

- `StreamScreen.onAir.test.tsx:119-125` keeps ruling I2 ("never hides a fault"). The fault is now the one §4 keeps, a call taking the mic. Re-pin that `CALM_ON_AIR` (`statusKey.ts`) does not hold `stream.status.micSilenced`, then write:

```ts
it('never hides a fault: the mic-silenced line outranks it at once (ruling I2, spec §4)', async () => {
  const view = await onAir('live');
  act(() => void view.back.press());
  expect(screen.getByText('Stop the broadcast first — hold Stop.')).toBeTruthy();
  act(() => view.engine.scene('mic-silenced'));
  expect(screen.getByText(en['stream.status.micSilenced'])).toBeTruthy();
  expect(screen.queryByText('Stop the broadcast first — hold Stop.')).toBeNull();
});
```

- Add `import en from '@/i18n/en.json';` to that file, as `StreamScreen.paired.test.tsx:4` has it.

- [ ] **Step 7: Scoped JS run.**

  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui --project types src/hooks/statusKey.test.ts src/hooks/engineSelectors.test-d.ts modules/capture-engine/src/FakeCaptureEngine.test.ts src/hooks/preflight.test.ts src/ui/components/Hud.test.tsx src/ui/components/PreflightChips.test.tsx src/ui/components/StreamColumn.test.tsx src/ui/screens/StreamScreen.onAir.test.tsx src/ui/screens/StreamScreen.paired.test.tsx src/i18n/budgets.test.ts src/i18n/dictionaries.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && CAPTURE_BRIDGE=1 pnpm vitest run --project bridge modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts --reporter=json --outputFile="$TMPDIR/b.json" > "$TMPDIR/b.log" 2>&1; echo "EXIT=$?"
  ```
  - The `bridge` project is the JVM host's contract (`test/hostEngine.ts`). It is the seam's real producer and consumer, so it is owed here (AGENTS failure class 1). Its one file is named (F19); confirm it is the only `name` in `b.json`.
  - Then run `pnpm typecheck`, `rtk proxy pnpm lint` (read `✖ N problems`) and `pnpm format:check`.
  - `grep -a` must find no `audio-below-floor`, `liveNoSound`, `SoundHold` or `SILENCE_MS` in `src app modules test`.
  - Step 1's old-English grep (F1) must now be empty.

- [ ] **Step 8: Commit** with the message `feat(capture): a silent room is ready; the mic's availability is sound (spec §4)` and the trailer.

## Task 2: The match label, split on its sides (§2)

**Files:**

- Create:
  - `src/domain/session/matchLabel.ts`
  - `src/domain/session/matchLabel.test.ts`
  - `src/ui/components/MatchLabel.tsx`
  - `src/ui/components/MatchLabel.test.tsx`
- Modify: `src/ui/theme/type.ts`, which gains `label` and `labelLong`. The status line reuses the existing `body` role (F20).

**Interfaces:**

```ts
export const SIDES = ' v ';
export const PARTNERS = ' / ';
/** Spec §2: 17 sp "when the longest line is over 26 chars". */
export const LONG_LINE_OVER = 26;
export type LabelPart = { readonly lines: readonly string[]; readonly wrap: 1 | 2 };
export type MatchLabel =
  | { readonly kind: 'block'; readonly block: LabelPart }
  | { readonly kind: 'sides'; readonly a: LabelPart; readonly b: LabelPart };
export function splitMatchLabel(label: string): MatchLabel;
export function labelSize(label: MatchLabel): 'regular' | 'long';
```

`wrap` is each line's `numberOfLines`: 1 for a partner line, which ends in an ellipsis, and 2 for a side or block that wraps.

- [ ] **Step 1: Write the failing domain test** (`matchLabel.test.ts`). Every case is §2's list, with the expectation taken from §2's rule text:

```ts
import { describe, expect, it } from 'vitest';
import { labelSize, splitMatchLabel } from '@/domain/session/matchLabel';

// Spec §2's owed cases, each with what §2's display rule says it shows.
const CASES = [
  [
    'short singles',
    'Ana Ruiz v Bea Lima',
    { kind: 'sides', a: { lines: ['Ana Ruiz'], wrap: 2 }, b: { lines: ['Bea Lima'], wrap: 2 } },
    'regular',
  ],
  [
    'long singles',
    'Alexandra Konstantinopoulou v Maria Fernanda Albuquerque',
    {
      kind: 'sides',
      a: { lines: ['Alexandra Konstantinopoulou'], wrap: 2 },
      b: { lines: ['Maria Fernanda Albuquerque'], wrap: 2 },
    },
    'long',
  ],
  [
    'doubles',
    'Ana Ruiz / Bea Lima v Cai Wen / Dee Roy',
    // Q4 option A (owner, 2026-10-07): doubles are long. Every line here is 8 characters or fewer, so only that rule makes it long.
    {
      kind: 'sides',
      a: { lines: ['Ana Ruiz', 'Bea Lima'], wrap: 1 },
      b: { lines: ['Cai Wen', 'Dee Roy'], wrap: 1 },
    },
    'long',
  ],
  [
    'long doubles',
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    {
      kind: 'sides',
      a: { lines: ['Alexandra Konstantinopoulou', 'Bea Lima'], wrap: 1 },
      b: { lines: ['Cai Wen', 'Maria Fernanda Albuquerque Santos'], wrap: 1 },
    },
    'long',
  ],
  ['Match {n}', 'Match 4', { kind: 'block', block: { lines: ['Match 4'], wrap: 2 } }, 'regular'],
  [
    'two " v "',
    'Ana v Bea v Cai',
    { kind: 'sides', a: { lines: ['Ana'], wrap: 2 }, b: { lines: ['Bea v Cai'], wrap: 2 } },
    'regular',
  ],
  [
    'the 200-char maximum',
    `${'A'.repeat(98)} v ${'B'.repeat(99)}`,
    {
      kind: 'sides',
      a: { lines: ['A'.repeat(98)], wrap: 2 },
      b: { lines: ['B'.repeat(99)], wrap: 2 },
    },
    'long',
  ],
] as const;

describe('splitMatchLabel (spec §2)', () => {
  it.each(CASES)('%s', (_name, label, shape, size) => {
    const split = splitMatchLabel(label);
    expect(split).toEqual(shape);
    expect(labelSize(split)).toBe(size);
  });

  it('covers every case §2 owes', () => {
    expect(CASES).toHaveLength(7);
    expect(`${'A'.repeat(98)} v ${'B'.repeat(99)}`).toHaveLength(200);
  });

  it('a side missing on either end is one block, not an empty side', () => {
    for (const label of [' v Bea', 'Ana v ', ' v '])
      expect(splitMatchLabel(label).kind).toBe('block');
  });

  it('an empty partner piece is dropped, not shown as a blank line (§2: one partner per line)', () => {
    // The one input that reaches the filter: the side is not trimmed away to 'Ana /', so the split yields ''.
    expect(splitMatchLabel('Ana /  / Bea v Cai')).toEqual({
      kind: 'sides',
      a: { lines: ['Ana', 'Bea'], wrap: 1 },
      b: { lines: ['Cai'], wrap: 2 },
    });
  });

  it('a lone " / " is not a partner list', () => {
    expect(splitMatchLabel('Ana / v Bea')).toEqual({
      kind: 'sides',
      a: { lines: ['Ana /'], wrap: 2 },
      b: { lines: ['Bea'], wrap: 2 },
    });
  });

  it("the size turns at §2's 26 characters, not before", () => {
    expect(labelSize(splitMatchLabel(`${'A'.repeat(26)} v B`))).toBe('regular');
    expect(labelSize(splitMatchLabel(`${'A'.repeat(27)} v B`))).toBe('long');
  });
});
```

- The doubles case's size is `'long'`, the owner's Q4 answer (option A), written as a literal, never a value read from the code.
- The 200-char case keeps §2's maximum exactly. The `toHaveLength(200)` line guards the fixture itself.
- Run it red: the module does not exist.

- [ ] **Step 2: Implement `matchLabel.ts`.**

```ts
function side(text: string): LabelPart {
  const partners = text
    .split(PARTNERS)
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return partners.length > 1 ? { lines: partners, wrap: 1 } : { lines: [text.trim()], wrap: 2 };
}

export function splitMatchLabel(label: string): MatchLabel {
  const at = label.indexOf(SIDES);
  const a = at < 0 ? '' : label.slice(0, at).trim();
  const b = at < 0 ? '' : label.slice(at + SIDES.length).trim();
  if (a === '' || b === '') return { kind: 'block', block: { lines: [label.trim()], wrap: 2 } };
  return { kind: 'sides', a: side(a), b: side(b) };
}

export function labelSize(label: MatchLabel): 'regular' | 'long' {
  const parts = label.kind === 'block' ? [label.block] : [label.a, label.b];
  // Q4 option A (owner, 2026-10-07): a doubles label, either side with partners, is long.
  if (parts.some((part) => part.wrap === 1)) return 'long';
  const longest = Math.max(...parts.flatMap((part) => part.lines.map((line) => line.length)));
  return longest > LONG_LINE_OVER ? 'long' : 'regular';
}
```

- **Mutation:** change `>` to `>=` in `labelSize`. "the size turns at 26" must fail.
- **Mutation (F8):** remove `.filter(...)`. "an empty partner piece is dropped…" must fail, with `['Ana', '', 'Bea']`. "a lone ' / '" cannot fail here: `'Ana /'` is trimmed before the split, and gives the same output either way (checked by hand with `node`).
- **Mutation (F8, Q4 A):** delete the Q4 option A line in `labelSize`. The `doubles` case must fail with `'regular'`. Its lines are all 8 characters or fewer, so nothing else makes it long.

- [ ] **Step 3: Type roles.** In `type.ts`, add:
  - `label`: `font.displaySemibold`, 20/22, `colour.ink`;
  - `labelLong`: 17/19, the same otherwise.

  The status strip's line uses the existing `body` role (`font.body`, 15/22, `colour.ink2`, `type.ts:110-115`), which is already the board's status-strip figure. No `stripStatus` role is added (F20). The grey `v` uses `metricUnit` (12/16, `ink3`).

- [ ] **Step 4: The component and its failing test.**
  - `MatchLabel` reads `selectLabel` and renders nothing for a null label.
  - It renders each part's lines as `<Text variant={size === 'long' ? 'labelLong' : 'label'} numberOfLines={part.wrap}>`. For `sides`, side B's first line is preceded by a `<Text variant="metricUnit">v</Text>` on the same row.
  - The root carries `testID="match-label"` and `dataSet={{ size, kind: split.kind }}`.
  - `MatchLabel.test.tsx` renders it through `renderWithPorts` and patches the fake's label with `view.engine.forceState` or the `pairing.label` the fake exposes. Re-pin how `FakeCaptureEngine` sets a label before writing.
  - For each of the seven `CASES`, assert:
    - the visible lines are exactly the shape's lines, in order: `textContent` of each `Text` whose variant is a label role;
    - the `v` exists only for `sides`;
    - `dataset.size` is the case's size;
    - each line's `-webkit-line-clamp` or `numberOfLines`, as react-native-web renders it, equals `wrap`. Read it with `getComputedStyle`. If react-native-web does not expose it, assert the prop through a `dataSet={{ wrap }}` on each line instead, and say so in the test's comment.
  - Add `expect(seen).toBe(7)`.
  - Run red (no component), implement, then run green.

  Whether any of these clip at 640 × 360 is invisible here. That is Task 9, item 16.

- [ ] **Step 5: Scoped run, mutation note, commit.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/domain/session/matchLabel.test.ts src/ui/components/MatchLabel.test.tsx --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  - Then run typecheck, lint and format.
  - The component is not mounted until Task 3. Its seam is proven there, by `StreamScreen` rendering it from a real snapshot (AGENTS failure class 1).
  - Commit `feat(viewfinder): the match label split on its sides (spec §2)`.

## Task 3: The viewfinder as two halves (§1)

**Files:**

- Modify:
  - `src/ui/theme/tokens.ts`: `layout` loses `columnWidth`, and gains the values in Step 1.
  - `src/ui/screens/StreamScreen.tsx`
  - `src/ui/components/StreamStage.tsx`: this becomes the camera half.
  - `src/ui/components/StreamColumn.tsx`: this becomes the controls half.
  - `src/ui/components/HoldAction.tsx`: `minHeight` becomes `layout.holdHeight`.
  - `src/ui/components/StatusLine.tsx`: a `variant` prop, defaulting to `status`, so Home is unchanged.
  - `src/ui/components/TallyPlate.tsx:37` (`minHeight: 56` becomes `layout.plateHeight`) and `src/ui/components/AudioMeter.tsx:36` (`height: 12` becomes `layout.meterHeight`) (F10).
  - `src/ui/components/PreflightChips.tsx:33`: the chips' row `View` gains `testID="chip-row"`, so this task's layout test can name it (F10). Nothing else in the file changes until Task 4.
- Create:
  - `src/ui/components/StatusStrip.tsx`
  - `src/ui/theme/viewfinderFit.test.ts`
  - `src/ui/screens/StreamScreen.layout.test.tsx`
- Delete: `src/ui/components/EdgeStrip.tsx`
- Update: `src/ui/components/Hud.test.tsx`, `StreamColumn.test.tsx` and the `StreamScreen.*.test.tsx` files, wherever they read the old strips or column.

- [ ] **Step 1: Tokens.** Add to `layout`. Each value is the spec's or the board's figure, written beside it:

```ts
  /** Spec §1: the hold button is 72 dp tall. */
  holdHeight: 72,
  /** Spec §3: readiness chips are 44 dp square. */
  chip: 44,
  /** Spec §3: icon-row buttons are 48 dp square. */
  iconButton: 48,
  /** The tally plate's floor (TallyPlate), unchanged. */
  plateHeight: 56,
  /** AudioMeter's bar, unchanged. */
  meterHeight: 12,
  /** Board "Before": the controls half's padding and gap. */
  controlsPad: 16,
  controlsGap: 12,
  /** Board "Before": the status strip's padding and gap (Q4 A: vertical 8, not the board's 10). */
  stripPadV: 8,
  stripPadH: 16,
  stripGap: 6,
  /** Lines the strip reserves: the label at most 4, the status line 2, the caption 2 (Q4). */
  labelLinesMax: 4,
  /** D17 (F9): a regular-size label is at most 2 lines, one a side, by the written assumption. */
  labelLinesRegular: 2,
  statusLinesMax: 2,
  captionLinesMax: 2,
```

- These are the values of Q4's answer, option A.
- `TallyPlate`, `AudioMeter` and `HoldAction` read these tokens instead of their literals.

- [ ] **Step 2: The fit arithmetic, failing first** (`viewfinderFit.test.ts`, `domain` project):

```ts
import { describe, expect, it } from 'vitest';
import { layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

// Spec §1: "Must fit a landscape phone from 640 × 360 dp up". This proves the RESERVATIONS fit;
// whether real text stays inside them is Task 9's, on the phone.
const SMALLEST = { width: 640, height: 360 } as const;
const HALF = SMALLEST.width / 2; // spec §1: two equal halves
const BOX = HALF / layout.previewAspect; // spec §1: a 16:9 box across the half
const stack = (items: readonly number[], gap: number, pad: number) =>
  2 * pad + items.reduce((sum, item) => sum + item, 0) + gap * (items.length - 1);

describe('the viewfinder fits 640 × 360 (spec §1)', () => {
  it('the camera box is 16:9 across the half: 320 × 180', () => {
    expect(BOX).toBe(180);
  });

  it('the status strip, worst case before air', () => {
    // D17 (F9): the larger of the two size rules. Regular: 2 lines at 22 (a side of 26 or fewer does not wrap).
    // Long: 4 lines at 19 (a side over 26 wraps to 2, or doubles take one partner a line; Q4 A).
    const regular = layout.labelLinesRegular * typeScale.label.lineHeight;
    const long = layout.labelLinesMax * typeScale.labelLong.lineHeight;
    const label = Math.max(regular, long);
    const status = layout.statusLinesMax * typeScale.body.lineHeight; // F20: the strip's line is `body`
    const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
    const items = [label, status, caption];
    expect(items).toHaveLength(3);
    expect(stack(items, layout.stripGap, layout.stripPadV)).toBeLessThanOrEqual(
      SMALLEST.height - BOX,
    );
  });

  it('the controls half before air: plate, chips and the start line, the flexible gap, icons, hold and its reason', () => {
    const items = [
      layout.plateHeight,
      layout.chip + space.xs + typeScale.metricUnit.lineHeight, // D14 (F18): the AUTO start line under the chips
      0,
      layout.iconButton,
      layout.holdHeight + space.xs + typeScale.metricUnit.lineHeight,
    ];
    expect(items).toHaveLength(5);
    expect(stack(items, layout.controlsGap, layout.controlsPad)).toBeLessThanOrEqual(
      SMALLEST.height,
    );
  });

  it('the controls half on air: plate with timer, meter, the flexible gap, icons, hold', () => {
    const items = [layout.plateHeight, layout.meterHeight, 0, layout.iconButton, layout.holdHeight];
    expect(items).toHaveLength(5);
    expect(stack(items, layout.controlsGap, layout.controlsPad)).toBeLessThanOrEqual(
      SMALLEST.height,
    );
  });
});
```

- Red first: the new tokens are missing until Step 1 lands (`label` and `labelLong` come from Task 2). Run it after Step 1 alone. The strip case must be green at exactly 180: 2 × 8 + 76 + 44 + 32 + 2 × 6. The controls half before air is 340 of 360: 2 × 16 + 56 + 64 + 0 + 48 + 92 + 4 × 12.
- **Mutation:** set `stripPadV: 10`. The strip case must fail at 184. This is the arithmetic that made Q4 an owner question.
- **Mutation (F9):** set `labelLinesRegular: 4`. The regular rule then reserves 88 dp, and the strip case must fail at 192. That is the reviewer's case, and it proves the `max` reads both rules.

- [ ] **Step 3: The layout test, failing first** (`StreamScreen.layout.test.tsx`, `ui`). Use `renderViewfinder` and assert:
  - The root has two children, `testID="camera-half"` and `testID="controls-half"`, each with computed `flex-grow: 1`. That is spec §1's 50/50.
  - `flex-direction` is `row` for `side: 'right'`, and `row-reverse` after `settings.change({ side: 'left' })`. The test sets the side through the store, then re-reads.
  - Inside `camera-half`, in DOM order: `testID="camera-box"`, which contains `preview` and, with the overlay on and a URL, `overlay`, then `testID="status-strip"`. The `viewer-video` is inside `camera-box` during a peek. Use `view.engine.scene('live')`, then press and hold _What viewers see_.
  - `status-strip` contains `match-label`, then the status line, then, before air with the overlay on, the text _You see the score slightly ahead of viewers_. In scene `live`, that text is absent.
  - `controls-half`'s children, in DOM order, before air: `tally-plate` and the meter in one row (`testID="plate-row"`), then `chip-row` (added in this task, F10), with the AUTO start line after it when AUTO is on (D14), then `testID="controls-gap"`, then `testID="icon-row"`, then the hold button. On air: `plate-row` holds `tally-plate` and the elapsed text, then the meter, `controls-gap`, `icon-row`, and the hold button.
  - Computed `min-height` of the hold button's plate is `${layout.holdHeight}px`, and `background-color` of `status-strip` is `colour.surface`, painted with the same `paintOf` helper `Hud.test.tsx` uses.
  - Organiser-stopped (the fake's scene `paired-after-organiser-stop`, `FakeCaptureEngine.ts:315`) still renders both halves. This is §1's last bullet.
  - **Sequence:** Paired, then live, then the call starts (scene `mic-silenced`), then the call ends (scene `live`). The strip's status line follows each step, and the halves never remount: the `camera-box` element is the same object before and after (`toBe`).
  - Run red: no halves yet.

- [ ] **Step 4: Implement.**
  - `StreamScreen`: `<View testID="viewfinder" style={side === 'left' ? styles.mirrored : styles.halves}>`, holding `<StreamStage …line={line} />` and then `<StreamColumn …/>`. `halves` is `{ flex: 1, flexDirection: 'row' }` and `mirrored` is `row-reverse`.
    - `useColumnLine(view, leave.blocked)` moves here from `StreamColumn`, unchanged.
    - `StreamStage` gets `line`, `paired`, `overlayOn` and `peek` only. It keeps no buttons, so it takes no `canLeave`, `onHome`, `onSettings` or `onDiagnostics` (F10).
    - `StreamColumn` gets `canLeave`, `onHome` and `onSettings`, and `onDiagnostics` until Task 4. It keeps `onScanAnother`, passed through unchanged, until Task 6 deletes it (F10).
  - `StreamStage` is the camera half (`testID="camera-half"`, `flex: 1`). It holds:
    - `camera-box`: `width: '100%'`, `aspectRatio: layout.previewAspect`, `backgroundColor: colour.stage`, `overflow: 'hidden'`. Inside it go `PreviewBoundary`, `OverlayPreview` and `StageVideo`, as today; their `absoluteFill` now fills the box only.
    - `<StatusStrip line={line} advisory={advisory} />`. `advisory` is `topAdvisory(...)` exactly as `TopStrip` computes it today, with the same inputs.
    - `TopStrip`, `BottomStrip` and the `EdgeStrip` import are deleted.
  - `StatusStrip` (`testID="status-strip"`, `flex: 1`, `backgroundColor: colour.surface`, padding `stripPadV`/`stripPadH`, gap `stripGap`) holds:
    - `<MatchLabel />`;
    - `<StatusLine variant="body" numberOfLines={layout.statusLinesMax}>{line}</StatusLine>` (F20);
    - when the advisory is not null, `<Text variant="metricUnit" numberOfLines={layout.captionLinesMax}>{t(ADVISORY_KEY[advisory])}</Text>`.
  - `StreamColumn` is the controls half (`testID="controls-half"`, `flex: 1`, padding `controlsPad`, gap `controlsGap`, `backgroundColor: colour.ground`). It holds:
    - `plate-row` (`flexDirection: 'row'`, gap `space.sm`): `TallyPlate`, then `view.onAir ? <Elapsed /> : <AudioMeter />`;
    - `view.onAir ? <AudioMeter /> : null`;
    - before air, `<PreflightChips …/>`, whose `chip-row` now carries its testID;
    - `<View testID="controls-gap" style={{flex:1}}/>`, written through `StyleSheet`;
    - `<View testID="icon-row">` with the existing `GhostButton`s for Settings, Diagnostics and Home (if `canLeave`). These move here from `StreamStage.tsx:113-115`. The icon row receives `onSettings`, `onDiagnostics`, `onHome` and `canLeave` from `StreamScreen`. On air, `ColumnPeek` goes into this row, after Settings;
    - `ColumnAction`.

    `StreamColumn` no longer renders `StatusLine`. `StreamStage` keeps no buttons.

  - `HoldAction` plate: `minHeight: layout.holdHeight`.
  - Delete `EdgeStrip.tsx`. `grep -a "EdgeStrip"` must be empty.

- [ ] **Step 5: Update the existing suites.**
  - Run `StreamColumn.test.tsx`, `Hud.test.tsx`, every `StreamScreen.*.test.tsx`, `OverlayPreview.test.tsx`, `ViewerPeek.test.tsx` and `PreviewBoundary.test.tsx`.
  - Fix each failure only where the test read the old structure. That covers the top strip's caption, which is now in `status-strip`; the bottom strip's label, which is now `match-label`; and the column's width.
  - Never weaken an assertion about behaviour.
  - List every test you changed, and why, in the commit body.

- [ ] **Step 6: Scoped run.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/ui/theme/viewfinderFit.test.ts src/ui/screens/StreamScreen. src/ui/components/StreamColumn.test.tsx src/ui/components/Hud.test.tsx src/ui/components/OverlayPreview.test.tsx src/ui/components/ViewerPeek.test.tsx src/ui/components/PreviewBoundary.test.tsx src/ui/components/HoldAction.test.tsx src/ui/components/MatchLabel.test.tsx src/ui/components/hookOrder.test.tsx --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  - `src/ui/screens/StreamScreen.` is a deliberate substring. It must match eight files: the seven existing `StreamScreen.*.test.tsx` (`ended`, `locales`, `memo`, `native`, `newCode`, `onAir`, `paired`) and the new `layout` test (F10). Check the printed names.
  - Then run typecheck, lint and format. Commit `feat(viewfinder): two halves, a 16:9 camera box and the status strip (spec §1)`.

## Task 4: Icon chips and the icon row (§3)

**Files:**

- Create:
  - `src/ui/components/Glyph.tsx`
  - `src/ui/components/IconButton.tsx`
  - `src/ui/components/IconButton.test.tsx`
- Modify:
  - `src/ui/components/PreflightChips.tsx`
  - `src/ui/components/PreflightChips.test.tsx`
  - `src/ui/components/StreamColumn.tsx`: the icon row.
  - `src/ui/screens/StreamScreen.tsx`: no `onDiagnostics`.
  - `test/setup-ui.ts`: the `Glyph` stand-in.
  - `src/ui/theme/tokens.ts`: `layout.chipBorder` (F11).
  - `src/ui/screens/SettingsScreen.test.tsx:216-234`: its viewfinder cases click the Diagnostics button this task removes (F2). The edit moves here from Task 5; Step 4a has it.
  - the four dictionaries: remove `stream.link.diagnostics`.

**Interfaces:**

```ts
export type GlyphName = 'camera' | 'mic' | 'network' | 'settings' | 'home';
export const Glyph: (props: {
  name: GlyphName;
  slashed?: boolean;
  tone: 'ink' | 'lime' | 'caution';
}) => JSX.Element;
export const IconButton: (props: {
  glyph: GlyphName;
  label: string;
  onPress: () => void;
}) => JSX.Element;
```

- [ ] **Step 1: `Glyph.tsx`**, modelled on `ModeIcon.tsx` (react-native-svg, 24-unit viewBox, stroke 2, no fill). The paths are copied from the canvas, version 23:
  - camera: `M3 8h3l2-3h8l2 3h3v11H3z` plus `<Circle cx={12} cy={13} r={3.5} />`; when `slashed`, also `M3 3l18 18`;
  - mic: `<Rect x={9} y={3} width={6} height={11} rx={3} />` plus `M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8`;
  - network: `M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0` plus `<Circle cx={12} cy={19.5} r={1} />`;
  - settings: `M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0` plus circles at (16,6), (10,12) and (18,18), each r 2;
  - home: `M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5`.

  The stroke colour comes from `colour[tone]`. In `test/setup-ui.ts`, mock it like `TurnGlyph`:

  ```ts
  vi.mock('@/ui/components/Glyph', async () => {
    const { createElement } = await import('react');
    const { View } = await import('react-native');
    return {
      // F11: the stand-in keeps `tone`, so a test can see the glyph's colour.
      Glyph: ({ name, slashed, tone }: { name: string; slashed?: boolean; tone: string }) =>
        createElement(View, {
          testID: 'glyph',
          dataSet: { name, slashed: String(slashed === true), tone },
        } as ViewProps),
    };
  });
  ```

- [ ] **Step 2: Failing chip tests** (`PreflightChips.test.tsx`). Keep the existing border-colour cases, which already read `TOKEN.lime` and `TOKEN.caution` through computed style. Add:
  - For each chip (camera, mic, network) × ok (true, false), 6 cases with `expect(count).toBe(6)`:
    - the accessible name is `"{Camera|Mic|Network}: ready|not ready"`, from en via `stream.chip.ok` and `stream.chip.notOk`;
    - the glyph's `data-name` is `camera`, `mic` or `network`;
    - the camera glyph's `data-slashed` is `"true"` only when the camera is not ready, and the other two are never slashed;
    - the glyph's `data-tone` is `lime` when ready and `caution` when not (§3: the state is in the colour; F11);
    - computed `width` and `height` are `${layout.chip}px`, and computed `border-width` is `${layout.chipBorder}px`.
  - No chip has a visible word: `queryByText('Camera')` is null. AUTO stays a word chip, now 44 tall.
  - _Held_ has no chip (§3): exactly 3 elements named `/: (ready|not ready)$/`.
  - **Sequence (a call):** scene `paired-ready`, then `view.engine.setReady({ sound: false })` (the call), then `setReady({ sound: true })` (it ends). The mic chip's name goes "Mic: ready", then "Mic: not ready", then "Mic: ready". Its border goes lime, caution, lime.
  - The AUTO start line stays where it is today, under `chip-row` and not inside it (D14, F18): with `auto` and a `startsAt`, `chip-row` does not contain the _Starts {time}_ text, and that text follows `chip-row` in DOM order.

  Run red.

- [ ] **Step 3: Implement the chips.** Each `ChipView` is a `View`:
  - `accessible`, with the same `accessibilityLabel`;
  - style `{ width: layout.chip, height: layout.chip, borderWidth: layout.chipBorder, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center' }`, with the border lime or caution. Add `/** Spec §3, the board's chip outline; today's PreflightChips border. */ chipBorder: 2` to `layout` (F11). `styles.chip`'s `borderWidth: 2` at `PreflightChips.tsx:77` reads it too;
  - containing `<Glyph name={GLYPH[chip]} slashed={chip === 'camera' && !ok} tone={ok ? 'lime' : 'caution'} />`.

  `GLYPH` is `{ camera: 'camera', sound: 'mic', network: 'network' }`. The row keeps `chip-row` (Task 3), and the start line stays under it (D14).

- [ ] **Step 4: The icon row, test first** (`IconButton.test.tsx` and additions to `StreamScreen.layout.test.tsx`):
  - `IconButton`: role `button`, accessible name = `label`, computed `width` and `height` `${layout.iconButton}px`, border `ink3`, `onPress` called once per press.
  - Before air, the icon row's buttons in order are `Settings`, then `Home`.
  - On air (scene `live`), the order is `Settings`, then the _What viewers see_ button, which keeps its text, and no `Home`.
  - No button named `Diagnostics` exists in either state.
  - No double-press test (F11). It would pin `NavigationPort.go`'s existing dedupe; `useStreamLinks.ts:8` has no guard of its own. So it cannot fail because of this task. `IconButton`'s own "`onPress` once per press" case is the press test this task owes.

  Run red, then implement:
  - `StreamColumn`'s icon row holds `<IconButton glyph="settings" label={t('stream.link.settings')} …/>`;
  - before air, when `canLeave`, `<IconButton glyph="home" label={t('stream.home')} …/>`;
  - on air, `ColumnPeek` with `flex: 1`.

  Remove `onDiagnostics` from `StreamScreen` and `StreamColumn`. Delete `stream.link.diagnostics` from the four dictionaries. `useStreamLinks.diagnostics` stays until Task 5.

- [ ] **Step 4a: `SettingsScreen.test.tsx`'s viewfinder cases (F2).** Replace the `describe` at lines 216-234 with the following. The scene list is unchanged here; Task 6 trims it (F3).

```ts
describe('the viewfinder’s way into Settings (AGENTS §6; spec §3, §6: no Diagnostics button)', () => {
  const SCENES = ['paired-ready', 'connecting', 'live', 'holding', 'stopped', 'fatal'] as const;

  it.each(SCENES)('Settings is there while %s, and Diagnostics is not', async (scene) => {
    const view = await renderViewfinder();
    act(() => view.engine.scene(scene));
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(view.navigation.current()).toBe('streamSettings');
  });

  it('covers its scenes', () => expect(SCENES).toHaveLength(6));

  it('reads in Spanish', async () => {
    await renderViewfinder({ deviceLanguages: ['es'] });
    expect(screen.getByRole('button', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Diagnóstico' })).toBeNull();
  });
});
```

Each absence has its positive pair in the same case: the Settings button is found and pressed.

- [ ] **Step 5: Scoped run, mutation, commit.**
  - **Mutation:** make `slashed={!ok}`, so every glyph is slashed when not ready. The "camera only" case must fail.
  - **Mutation (F11):** make `tone="lime"` whatever `ok` is. The `data-tone` assertion must fail on every not-ready case.
  - Run:
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/ui/components/PreflightChips.test.tsx src/ui/components/IconButton.test.tsx src/ui/screens/StreamScreen. src/ui/components/StreamColumn.test.tsx src/ui/screens/SettingsScreen.test.tsx src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  - Then run typecheck, lint and format. Commit `feat(viewfinder): icon chips and the icon row; the Diagnostics button goes (spec §3)`.

## Task 5: Diagnostics inside Settings (§6)

**Gate:** Q1 answered.

**Files:**

- Delete:
  - `app/stream/diagnostics.tsx`
  - `src/ui/screens/DiagnosticsScreen.tsx`
  - `src/ui/screens/DiagnosticsScreen.test.tsx`, after moving its still-true cases. Step 4 lists them.
  - `src/ui/components/DiagnosticsSection.tsx`, if nothing else uses it.
- Create:
  - `src/ui/components/DiagnosticsCard.tsx`
  - `src/hooks/settingsDiagnostics.ts`
  - `src/hooks/settingsDiagnostics.test.ts`
  - `test/windowSize.ts`: the shared window-size helper (D13, F12). Task 7 reuses it.
- Modify:
  - `src/ui/screens/SettingsScreen.tsx`: the Diagnostics card, the halves, and `dataSet={{ layout }}` on its root (F13).
  - `src/ui/screens/SettingsScreen.test.tsx`. Its viewfinder cases (lines 216-234) are Task 4's now (F2).
  - `src/ui/theme/tokens.ts`: `layout.diagSection` (F13).
  - `src/hooks/diagnostics.ts`: `RECORD_TAIL` goes.
  - `src/hooks/useDiagnostics.ts`: `useSessionRecord` keeps `share` and `shareFailed`. `lines` goes if nothing else reads it.
  - `src/hooks/useStreamLinks.ts`: `diagnostics()` goes.
  - `src/services/devicePorts.ts`: `Route` loses `streamDiagnostics`, and `isStreamSubRoute` names `streamSettings` only.
  - `src/services/native/expoRouterNavigation.ts` and its test: `Path` and `PATH` lose `/stream/diagnostics`.
  - `test/routedApp.tsx`: `ROUTE_OF` and `RoutedApp` lose the route.
  - `test/backFromSubScreen.tsx`
  - `src/hooks/useEngineFollow.test.tsx:189`
  - `src/hooks/useReopenGate.test.tsx:283-304`
  - `src/hooks/useStreamLeave.test.tsx:148`
  - `src/ui/screens/StreamScreen.locales.test.tsx`
  - the dictionaries: `diag.section.record`, after `grep -a`.

**Interfaces:**

```ts
export type DiagRow = {
  readonly key: MessageKey;
  readonly section: string | null;
  readonly label: string;
  readonly value: string;
};
/** Q1's rows, in the board's order; `section` only on each section's first row. */
export const SETTINGS_DIAG_ROWS: readonly MessageKey[];
export function settingsDiagRows(
  sections: readonly DiagnosticsSection[],
  t: Translate,
): readonly DiagRow[];
```

`DiagnosticsSection` today carries translated labels only. Add the row's `key: MessageKey` to `DiagnosticsRow` in `diagnostics.ts`, so selection is by key and never by translated text.

- [ ] **Step 1: Failing domain test** (`settingsDiagnostics.test.ts`).
  - Build `diagnosticsSections` from a fake snapshot, the way `src/hooks/diagnostics.test.ts` does. Re-pin its helper first.
  - The expected rows are the owner's Q1 answer, written as literals (F13). They are never read from `SETTINGS_DIAG_ROWS` or from `settingsDiagRows`, which are the code under test:

```ts
// Owner, Q1 (2026-10-07): the board's 9 rows, in the board's order. The section keys are diagnostics.ts:45-48's.
const Q1_ROWS = [
  ['diag.transport', 'diag.section.link'],
  ['diag.bitrate', null],
  ['diag.rtt', null],
  ['diag.delivery', 'diag.section.delivery'],
  ['diag.lag', null],
  ['diag.checked', null],
  ['diag.battery', 'diag.section.device'],
  ['diag.thermal', null],
  ['diag.hbSent', 'diag.section.heartbeat'],
] as const;

it("shows Q1's rows, in the board's order, each section named once on its first row", () => {
  const rows = settingsDiagRows(diagnosticsSections(SNAPSHOT, NOW, say), say);
  expect(rows).toHaveLength(9); // Q1's count, a literal (anti-vacuity: 0 rows would fail)
  expect(rows.map((row) => row.key)).toEqual(Q1_ROWS.map(([key]) => key));
  expect(rows.map((row) => row.section)).toEqual(
    Q1_ROWS.map(([, section]) => (section === null ? null : en[section])),
  );
  expect(rows.some((row) => row.key.startsWith('diag.engine'))).toBe(false);
});
```

- `SNAPSHOT`, `NOW` and `say` are the helpers `diagnostics.test.ts` already uses. Re-pin their names; never build a new snapshot builder.
- **Mutation:** drop one key from `SETTINGS_DIAG_ROWS`. The length assertion must fail at 8.

- [ ] **Step 2: Implement** `settingsDiagnostics.ts`. It flattens the sections, keeps rows whose `key` is in `SETTINGS_DIAG_ROWS`, orders them by that list, and sets `section` on the first row of each section.

- [ ] **Step 3: Failing Settings tests** (`SettingsScreen.test.tsx`):
  - A card titled `Diagnostics` (`diag.title`) with a `Share record` button (`diag.share`) in its header row. Pressing Share calls `ports.share` once with the whole record. Count the lines shared against `record` length, not against a tail.
  - Its rows render section | item | value. Each row is a `View` with three `Text`s and `testID="diag-row"`. Assert `expect(screen.getAllByTestId('diag-row')).toHaveLength(9)`: Q1's literal count, never `settingsDiagRows(...)`'s length, which would let 0 = 0 pass (F13).
  - The rows tick: after `vi.advanceTimersByTime(1000)` with a changed bitrate, the Bitrate row shows the new value.
  - `session-record-lines` does not exist.
  - The dev scenes render only when `devTools` is true, as on Diagnostics today: move that case from `DiagnosticsScreen.test.tsx`.
  - Order, which also checks SP2: the switch hints, the side radios, the power label and advice, then `Open-source licences`, then the Diagnostics card. This is in portrait: `screen.getByTestId('settings').dataset.layout === 'portrait'`, jsdom's 0 × 0 default (D10).
  - Landscape, through D13's helper. Create `test/windowSize.ts`:

```ts
import { act } from '@testing-library/react';

/**
 * D13 (pre-flight F12): react-native-web 0.21 reads the window from documentElement's clientWidth and
 * clientHeight (jsdom has no visualViewport, and its documentElement is 0 × 0), and re-reads it on window
 * `resize`. A stub of those two getters, then `resize`, moves useWindowDimensions for real.
 */
export function setWindowSize(width: number, height: number): void {
  const root = document.documentElement;
  Object.defineProperty(root, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => height });
  act(() => void window.dispatchEvent(new Event('resize')));
}

/** Back to jsdom's own getters (Element.prototype's), and tell react-native-web. Register with afterEach. */
export function restoreWindowSize(): void {
  const root = document.documentElement;
  Reflect.deleteProperty(root, 'clientWidth');
  Reflect.deleteProperty(root, 'clientHeight');
  act(() => void window.dispatchEvent(new Event('resize')));
}
```

- The landscape cases, with `afterEach(restoreWindowSize)` in the file:

```ts
it('the helper really turns the window (positive control, D13)', () => {
  renderSettings();
  expect(screen.getByTestId('settings').dataset.layout).toBe('portrait');
  setWindowSize(844, 390);
  expect(Dimensions.get('window')).toMatchObject({ width: 844, height: 390 });
  expect(screen.getByTestId('settings').dataset.layout).toBe('landscape');
});

it('in landscape, settings on one half and Diagnostics on the other (spec §6)', () => {
  setWindowSize(640, 360); // spec §1's smallest landscape phone
  renderSettings();
  const halves = screen.getByTestId('settings-halves');
  expect(getComputedStyle(halves).flexDirection).toBe('row');
  expect(halves.children).toHaveLength(2);
  expect(halves.children[0]?.contains(screen.getByText('Open-source licences'))).toBe(true);
  expect(halves.children[1]?.contains(screen.getByTestId('diagnostics-card'))).toBe(true);
});
```

- `Dimensions` comes from `react-native`. `renderSettings` is the file's existing helper; re-pin its name.
- The card itself is not a `ScrollView`: `card.closest('[data-testid=diagnostics-card]')` has no scrolling ancestor inside the card. Whether it fits at 640 × 360 is Task 9.
- Settings re-renders at most once a second while open. `DiagnosticsCard` holds `useDiagnostics()` itself, so the switches do not re-render on a tick. Assert it with a render counter, on the pattern of `StreamScreen.memo.test.tsx`.

Run red.

- [ ] **Step 4: Implement, then remove the route.**
  - `DiagnosticsCard` (`testID="diagnostics-card"`, `memo`): a header row with `<Text variant="control">{t('diag.title')}</Text>` and `<GhostButton label={t('diag.share')} …/>`, the `shareFailed` line, the rows as a grid (`section` `layout.diagSection` wide, `label` `flex: 1`, `value` right-aligned in `metricValue`), then `<DevScenes />`. Add `/** Board "Settings": the Diagnostics card's section column. */ diagSection: 84` to `layout` (F13).
  - `SettingsScreen`:
    - the root `View` gets `testID="settings"` and `dataSet={{ layout }}`, the marker the tests read (F13);
    - portrait: one `ScrollView`, with the current content and then `<DiagnosticsCard />`;
    - landscape: `testID="settings-halves"`, a row of two `flex: 1` halves. The current content goes in a `ScrollView`, and `<DiagnosticsCard />` goes in a plain `View`;
    - `layout` is `screenLayout(width, height)` from `useWindowDimensions()`.
    - The portrait/landscape decision is Task 7's `homeLayout`. Until Task 7 lands, Task 5 adds it as `src/domain/mode/homeLayout.ts` with this interface:

    ```ts
    export type ScreenLayout = 'portrait' | 'landscape';
    /** Wider than tall is landscape; a square window is portrait. */
    export function screenLayout(width: number, height: number): ScreenLayout;
    ```

    Its test is `homeLayout.test.ts`, with the cases (390,844)→portrait, (844,390)→landscape, (640,360)→landscape, (500,500)→portrait and (0,0)→portrait, and `expect(n).toBe(5)`. Task 7 reuses it.

  - Delete `app/stream/diagnostics.tsx`, `DiagnosticsScreen.tsx` and its test, after moving these cases into `SettingsScreen.test.tsx`: share, share failed, dev scenes, and the sections' values. Each moved case is named in the commit body.
  - Update `Route`, `isStreamSubRoute`, `Path`, `PATH`, `ROUTE_OF`, `RoutedApp`, `useStreamLinks` and the five hook tests listed. A test that asserted Back from Diagnostics returns to the camera is deleted. Its rule ("a sub-screen's Back is its own") is still covered by the Settings case of `describeBackFromSubScreen`; confirm that it is.
  - `grep -a "diagnostics" app src test` may name only `diag.*` keys, `useDiagnostics`, `diagnostics.ts`, `settingsDiagnostics` and `DiagnosticsCard`. There must be no route or path.

- [ ] **Step 5: Scoped run.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/hooks/settingsDiagnostics.test.ts src/hooks/diagnostics.test.ts src/domain/mode/homeLayout.test.ts src/ui/screens/SettingsScreen.test.tsx src/services/native/expoRouterNavigation.test.ts src/hooks/useEngineFollow.test.tsx src/hooks/useReopenGate.test.tsx src/hooks/useStreamLeave.test.tsx src/ui/screens/StreamScreen.locales.test.tsx test/routedApp.drift.test.ts src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  - Find every user of `describeBackFromSubScreen` with `grep -arl "describeBackFromSubScreen" src test`, and add each file to the run.
  - Then run typecheck, lint and format. Commit `feat(settings): Diagnostics as a card in Settings; the route goes (spec §6)`.

## Task 6: The phone's Stop returns to Home (§5)

**Files:**

- Create:
  - `src/domain/session/endedCard.ts` and its test
  - `src/services/endedNotice.ts` and its test
  - `src/hooks/useEndedNotice.ts`
  - `src/ui/components/EndedCard.tsx`
  - `src/ui/screens/HomeScreen.ended.test.tsx`
- Delete:
  - `src/ui/components/EndedBlock.tsx`
  - `src/services/homeIntent.ts` and `homeIntent.test.ts`
- Modify:
  - `src/ui/screens/StreamScreen.tsx`: `useScanAnother` goes, `useEndedToHome` comes.
  - `src/ui/components/StreamColumn.tsx`: `ColumnAction` has no `ended` branch.
  - `src/hooks/useViewfinder.ts`: `ViewfinderAction` `'ended'` becomes `'none'`.
  - `src/hooks/useHome.ts`: `useScanRequest` goes; `useTapTile` clears the card, and so does `useContinue` when it re-pairs (D16, F14 b).
  - `src/hooks/engineSelectors.ts`: `selectCodeEndedPending = (s) => s.codeEndedPending`, at module scope (F14 a).
  - `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`: `homeIntent` becomes `endedNotice`.
  - `src/ui/screens/HomeScreen.tsx`
  - `src/hooks/useEngineFollow.ts`: its comment "their Stop stays on Ended".
  - `src/domain/mode/reopen.ts`: the comment "A permanent failure keeps its code and its Ended screen".
  - `src/i18n/budgets.test.ts`: the `stream.ended.scanAnother` row goes.
  - `src/ui/screens/SettingsScreen.test.tsx`: Task 4's viewfinder `SCENES` lose `stopped` and `fatal` (F3, Step 4).
  - the four dictionaries
- Rewrite:
  - `src/ui/screens/StreamScreen.ended.test.tsx`
  - `src/ui/screens/HomeScreen.test.tsx:921,943`, the `homeIntent` cases

**Interfaces:**

```ts
// src/domain/session/endedCard.ts
import type { EndReason } from '@/domain/session/SessionState';
export type EndedCard = {
  readonly reason: EndReason;
  readonly durationMs: number | null;
  /** The Ended snapshot's `codeEndedPending` (CaptureEnginePort.ts:96): the 401 deferral's Stop (D7, F14 a). */
  readonly codeEnded: boolean;
};
export type EndedLines = {
  readonly time:
    { readonly kind: 'onAir'; readonly durationMs: number } | { readonly kind: 'neverLive' };
  readonly reason: 'stopped' | 'failed';
  /**
   * Spec §5: only after the operator's own Stop over a code that still works. A fatal end keeps its code, so there is
   * nothing to rescan; a code-ended Stop's code is dead (SessionMachine.kt:111), so rescanning it is wrong (F14 a).
   */
  readonly scanAgain: boolean;
  /** F14 a: the code-ended Stop shows `panel.codeEnded.body` in place of the scan-again line. */
  readonly codeEnded: boolean;
};
export function endedLines(card: EndedCard): EndedLines;

// src/services/endedNotice.ts
export type EndedNotice = {
  show(card: EndedCard): void;
  clear(): void;
  getSnapshot(): EndedCard | null;
  subscribe(listener: () => void): () => void;
};
export function createEndedNotice(): EndedNotice;

// src/hooks/useEndedNotice.ts
export function useEndedCard(): EndedCard | null;
export function useEndedToHome(leaveWith: (beforeHome: () => void) => void): void;
```

- [ ] **Step 1: Failing pure tests.**
  - `endedCard.test.ts`. The table is spec §5 plus D7 and its F14 a case, so 6 cases, with `expect(CASES).toHaveLength(6)`. A fatal end with `codeEnded` is outside F14 a (D7), so it is not in the table:

  ```ts
  const CASES = [
    [
      { reason: 'operator-stopped', durationMs: 754_000, codeEnded: false },
      {
        time: { kind: 'onAir', durationMs: 754_000 },
        reason: 'stopped',
        scanAgain: true,
        codeEnded: false,
      },
    ],
    [
      { reason: 'fatal-error', durationMs: 754_000, codeEnded: false },
      {
        time: { kind: 'onAir', durationMs: 754_000 },
        reason: 'failed',
        scanAgain: false,
        codeEnded: false,
      },
    ],
    [
      { reason: 'operator-stopped', durationMs: null, codeEnded: false },
      { time: { kind: 'neverLive' }, reason: 'stopped', scanAgain: true, codeEnded: false },
    ],
    [
      { reason: 'fatal-error', durationMs: null, codeEnded: false },
      { time: { kind: 'neverLive' }, reason: 'failed', scanAgain: false, codeEnded: false },
    ],
    // F14 a: the 401 deferral's Stop (SessionMachine.kt:111), before and after the first frame. The code is dead.
    [
      { reason: 'operator-stopped', durationMs: null, codeEnded: true },
      { time: { kind: 'neverLive' }, reason: 'stopped', scanAgain: false, codeEnded: true },
    ],
    [
      { reason: 'operator-stopped', durationMs: 754_000, codeEnded: true },
      {
        time: { kind: 'onAir', durationMs: 754_000 },
        reason: 'stopped',
        scanAgain: false,
        codeEnded: true,
      },
    ],
  ] as const;

  it.each(CASES)('%o', (card, lines) => expect(endedLines(card)).toEqual(lines));
  it('covers its cases', () => expect(CASES).toHaveLength(6));
  ```

  - `endedNotice.test.ts`:
    - `getSnapshot()` is null at creation;
    - `show(a)` notifies once and reads an object equal to `a`, but not `a` itself (D8);
    - `show(a)` twice with equal values is two distinct snapshots and two notifications. That is the "fresh card" rule at its source;
    - `clear()` notifies and reads null;
    - a second `clear()` does not notify;
    - an unsubscribed listener hears nothing;
    - **a restart:** two `createEndedNotice()` calls share nothing.

  Run red.

- [ ] **Step 2: Implement both.**

```ts
export function endedLines({ reason, durationMs, codeEnded }: EndedCard): EndedLines {
  const stopped = reason === 'operator-stopped';
  return {
    time: durationMs === null ? { kind: 'neverLive' } : { kind: 'onAir', durationMs },
    reason: stopped ? 'stopped' : 'failed',
    scanAgain: stopped && !codeEnded, // F14 a: never send the operator back to a dead code
    codeEnded: stopped && codeEnded, // D7: the deferral's own path only
  };
}

export function createEndedNotice(): EndedNotice {
  let card: EndedCard | null = null;
  const listeners = new Set<() => void>();
  const set = (next: EndedCard | null) => {
    if (next === null && card === null) return;
    card = next;
    for (const listener of listeners) listener();
  };
  return {
    show: (next) => set({ ...next }),
    clear: () => set(null),
    getSnapshot: () => card,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

- Wire it: `Ports.endedNotice: EndedNotice` (`usePorts.tsx`), `createEndedNotice()` in `createNativePorts` (`nativePorts.ts:72`, replacing `createHomeIntent()`) and in `test/fakePorts.ts:93`.
- Delete `homeIntent.ts`, its test, `useScanRequest`, and its call at `useHome.ts:135`.
- **Mutation:** `show: (next) => set(next)`. The "two distinct snapshots" case must fail.

- [ ] **Step 3: Failing screen tests.** Rewrite `StreamScreen.ended.test.tsx` and create `HomeScreen.ended.test.tsx`, both through `launchApp` and `scanFromHome(app, captureRaw(...))`, as the existing ended tests do. Each case reads the route from `app.nav.current()`.
  1. **Stop after live → Home with the card.** Scan, then `app.engine.scene('live')`, `flush()`, `pressIn` on Stop, advance `HOLD_MS`, `flush()`. The fake answers the `stop` intent with Ended (`operator-stopped`); re-pin how the fake ends on `stop`, and use `scene('stopped')` if it does not. Then:
     - `app.nav.current()` is `'home'`;
     - a region named `Stream ended` holds, in DOM order, `Stream ended`, `On air 0:12:34`, `You stopped the broadcast.`, `Scan the code again for the next broadcast`, and a button `OK`. `0:12:34` is the fake's declared `ON_AIR_MS` through `formatElapsed`, the same value the old Ended test used;
     - the region sits above the tiles, compared by DOM order;
     - `stop` was sent once (`intentKinds`);
     - the code is forgotten: no Continue card.
  2. **OK clears it.** Press OK. The region is gone and stays gone after `flush(2000)`.
  3. **A fatal end → its reason.** Scan, live, then `scene('fatal')`. Home shows the card with `Something failed. Your code is kept.` and no scan-again line. The Continue card for the kept code is present, which is the truth of that line.
  4. **Stop before the first frame → stays.** Scan to Paired, then `app.engine.forceState(...)`, using whatever the fake gives for a Stop before live (F14 c: `app`, the `launchApp` handle these cases use, not `view`). Re-pin the existing "a Stop before live (owner decision 1)" tests and keep them. Then:
     - the route is still `'stream'`;
     - no `Stream ended` region exists;
     - the viewfinder shows its neverLive state as today.
  5. **A second broadcast after OK → a fresh card.** Run case 1, press OK, scan the code again, go live, then `forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: 61_000 })`. The card reads `On air 0:01:01` (worked by hand: 61 s is 0 h 01 min 01 s). `On air 0:12:34` is absent.
  6. **A second Stop.** In case 1, deliver the Ended snapshot twice, by `scene('stopped')` then `patch({})` before the flush. Then:
     - `app.nav.history.filter((r) => r === 'home')` gains exactly one entry;
     - the region appears once.

     The old third bullet ("without a second write warning") is dropped (F14 d): nothing in the fakes records it, so it could not be observed. The two above are the witnesses.

  7. **A new scan clears it.** After case 1, tap the Live Stream tile with the scanner queued to cancel. The region is gone.
  8. **A restart clears it.** After case 1, `cleanup()` and `launchApp()` again with the same KV seed. There is no region.
  9. **Never went live, on Ended (D7).** `forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null })` from Paired goes Home with `Never went live` in place of the duration, and no scan-again line.
  10. **A Stop over a code that ended (F14 a).** Scan, `app.engine.scene('live')`, then `act(() => app.engine.patch({ codeEndedPending: true }))`, the 401 heard while live. Hold Stop. The fake's `stop()` ends it `operator-stopped` and leaves `codeEndedPending` set (`FakeCaptureEngine.ts:577-588`), as native's Ended keeps its pairing (`Phase.kt:378-382`, `Projection.kt:38`). Then:
      - the route is `'home'`, and the region holds `You stopped the broadcast.` and `This code has ended. Scan the new one.` (`panel.codeEnded.body`);
      - `Scan the code again for the next broadcast` is absent from the region. Its positive pair is case 1, where the same line is present.
  11. **Continue clears the card (F14 b, D16).** Run case 3, a fatal end, which keeps the code. The region and the Continue card are both on Home. Press Continue. The route is `'stream'`, and the fake pairs. Press the viewfinder's Home (paired, so `canLeave`). Back on Home, there is no `Stream ended` region, and the Continue card is there again.

  Run red.

- [ ] **Step 4: Implement.**
  - `useEndedNotice.ts`:

  ```ts
  export function useEndedCard(): EndedCard | null {
    const { endedNotice } = usePorts();
    return useSyncExternalStore(endedNotice.subscribe, endedNotice.getSnapshot);
  }

  /**
   * Spec §5: an Ended (the phone's Stop after live, or a fatal end) leaves for Home by the
   * one leave rule, and shows the card only if that leave really goes Home (M9). A Stop
   * before the first frame is Paired, never Ended, so it stays.
   */
  export function useEndedToHome(leaveWith: (beforeHome: () => void) => void): void {
    const { endedNotice } = usePorts();
    const reason = useEngineSelector(selectEndReason);
    const durationMs = useEngineSelector(selectEndedDurationMs);
    const codeEnded = useEngineSelector(selectCodeEndedPending); // F14 a
    useEffect(() => {
      if (reason === null) return;
      leaveWith(() => endedNotice.show({ reason, durationMs, codeEnded }));
    }, [reason, durationMs, codeEnded, leaveWith, endedNotice]);
  }
  ```

  - `StreamScreen` calls `useEndedToHome(leave.leaveWith)`. `useScanAnother` and the `onScanAnother` prop go.
  - `useViewfinder`: `ViewfinderAction = 'goLive' | 'stop' | 'none'`, with `ended: 'none'`. `ColumnAction` returns `null` for `'none'`, for the one frame before the leave.
  - `EndedCard` (`accessibilityRole="summary"` or a `View` with `aria-label={t('home.ended.title')}` and `role="region"`; re-pin what react-native-web 0.21 renders for each):
    - a header row: `<Text variant="state">{t('home.ended.title')}</Text>` and the time line in `metricValue`: `t('stream.ended.duration', { duration: formatElapsed(ms) })`, or `t('stream.ended.neverLive')`;
    - the reason in `body`: `stream.status.endedOperator` or `stream.status.endedFatal`;
    - when `scanAgain`, `stream.ended.scanAgain` in `metricUnit`;
    - when `codeEnded`, `panel.codeEnded.body` in `metricUnit`, in the same place (F14 a);
    - `<GhostButton label={t('home.ended.ok')} onPress={endedNotice.clear} />`.
  - `HomeScreen`'s `HomeContent` renders `<EndedSlot />` after `StatusLine` and before `ContinueSlot`. `EndedSlot` reads `useEndedCard()`, and renders nothing for null.
  - `useTapTile` calls `endedNotice.clear()` beside `setPanel(null)`.
  - `useContinue` (`useHome.ts:472-499`) calls `endedNotice.clear()` beside `setStatusKey(null)`, in the `.then` that re-pairs (D16, F14 b).
  - `SettingsScreen.test.tsx` (F3): Task 4's `SCENES` become `['paired-ready', 'connecting', 'live', 'holding']`, and its count `toHaveLength(4)`. _Why:_ after this task, `stopped` and `fatal` leave the viewfinder for Home (§5), so there is no Settings button to press. Cases 1 and 3 own those two states now. Write the reason as a comment above `SCENES`.
  - Copy: add `home.ended.title` and `home.ended.ok` (_Copy_) to all four dictionaries with the `_review` marker. Delete `stream.ended.scanAnother` and its budget row.
  - Rewrite the two comments. `useEngineFollow.ts`: "their Stop goes Home with the card, by StreamScreen's leave (spec §5)". `reopen.ts`: "A permanent failure keeps its code; the viewfinder then leaves for Home with the card (spec §5)".
  - Delete `EndedBlock.tsx`. `grep -a "EndedBlock\|scanAnother\|homeIntent\|requestScan\|takeScan"` must be empty across `src app test modules`.

- [ ] **Step 5: Mutations.**
  - **M1.** In `useEndedToHome`, drop `if (reason === null) return;`. Case 4 must fail: Paired would leave.
  - **M2.** In `useTapTile`, delete the `clear()` call. Case 7 must fail.
  - **M3.** In `endedLines`, `scanAgain: true`. Case 3 must fail.
  - **M4.** `useLeaveOnce`'s pending guard is existing behaviour, but case 6 depends on it. Disable it once and record whether case 6 fails. If case 6 stays green, the effect's own dependency list is what guards it. Name that in the commit body (AGENTS failure class 3: two guards, each mutated alone).
  - **M5 (F14 a).** In `endedLines`, `scanAgain: stopped`, dropping `&& !codeEnded`. The two F14 a table rows and case 10 must fail.
  - **M6 (F14 b).** In `useContinue`, delete the `endedNotice.clear()` call. Case 11 must fail.

- [ ] **Step 6: Scoped run.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/domain/session/endedCard.test.ts src/services/endedNotice.test.ts src/ui/screens/StreamScreen. src/ui/screens/HomeScreen. src/ui/screens/SettingsScreen.test.tsx src/hooks/engineSelectors.test.ts src/hooks/useEngineFollow.test.tsx src/hooks/useStreamLeave.test.tsx src/hooks/useReopenGate.test.tsx src/domain/mode/reopen.test.ts test/fakePorts.test.ts test/routedApp.drift.test.ts src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  Then run typecheck, lint and format. Commit `feat(stream): the phone's Stop returns Home with a Stream ended card (spec §5)`.

## Task 7: The logo, a Home that turns, and Settings that turns (§7)

**Gates:** Q2 and Q3 answered.

> **Code fact (pre-flight F16): opening Settings while Paired closes the capture, so Q3's answer stands and the fallback is NOT applied.** The chain, read from code:
>
> 1. `/stream/settings` is an opaque, non-modal push on Live Stream's native stack: `app/stream/_layout.tsx:12` sets only `headerShown`, `animation: 'none'` and `gestureEnabled`, and `app/stream/settings.tsx` sets no presentation.
> 2. react-native-screens 4.26.2's `ScreenStack.onUpdate` takes every screen under a non-translucent new top out of the fragment transaction (`node_modules/react-native-screens/android/src/main/java/com/swmansion/rnscreens/ScreenStack.kt:273-278`, `transaction.remove(wrapper.fragment)`). The viewfinder's view leaves the window.
> 3. `CapturePreviewView.onDetachedFromWindow` reports `detach` (`CapturePreviewView.kt:84-94`), which calls `BridgeCore.viewfinder(false)`.
> 4. `noticeCapture` then wants the capture only if `phase.holdsBroadcast || (viewfinder && held)` (`BridgeCore.kt:271-281`). Paired holds no broadcast, so the capture closes (`platform.capture(false)`, then `silenced()`). From Arming on (`Phase.kt:250-259`, `heldSid`), it stays open, and JS's `live` status covers the same phases (`engineSelectors.ts:21-34`).
>
> So a rotation in paired Settings turns no open camera. This is read, not run. `CapturePreviewView.kt:20-21` itself says a pushed screen "may" detach the view. **Task 9 item 65 checks it on the phone. If the capture stays open while paired Settings is shown, Q3's fallback applies:** Settings stays landscape-locked while paired (§7 read literally), `useOrientationGate`'s `free` target uses `selectHoldsOrientation`, and the orchestrator takes that back to the owner.
>
> **Q3's "re-locks landscape on return", as the gate really does it (F16).** Leaving paired Settings for the viewfinder with the phone **upright** gives `{ lock: 'portrait', card: 'turnSideways' }`: the turn card shows until the phone is turned, then the gate locks landscape. With the phone sideways or flat it locks landscape at once. Step 2's "leaving free" cases pin both. Task 9 item 70 is worded the same way.

**Files:**

- Copy: `/Users/ashokhein/github/seazn.club/apps/web/public/logo-wide-night.png` → `src/ui/assets/logo-wide-night.png`. Read the source; never write to that repo.
- Create:
  - `src/ui/assets/png.d.ts`
  - `src/ui/assets/logo.test.ts`
  - `src/services/native/nativeOrientationLock.test.ts`
  - `src/ui/screens/HomeScreen.layout.test.tsx`
- Modify:
  - `src/domain/orientation/orientation.ts` and its test: `Target` gains `free`, and `orientationGate` its `free` cases.
  - `src/hooks/useOrientationGate.ts` and its test. `routeTarget` lives here, at `useOrientationGate.ts:17`, not in `orientation.ts`, and its table is `useOrientationGate.test.tsx:325-334` (F15).
  - `src/hooks/engineSelectors.ts`: `selectBroadcastHeld`.
  - `src/services/native/nativeOrientationLock.ts`
  - `src/services/devicePorts.ts`: `OrientationLockPort.lock(target: Target)` now accepts `free`, through `Target`.
  - `src/ui/screens/HomeScreen.tsx`
  - `src/ui/components/HomeFooter.tsx`
  - `src/ui/components/EndedCard.tsx`: a `layout` prop; one row in landscape (F15).
  - `src/ui/theme/tokens.ts`: `layout.logo` and `layout.logoLandscape`.
  - the four dictionaries: `brand`.
- Reuse: `test/windowSize.ts` (Task 5, D13).

- [ ] **Step 1: The logo, with its proof first** (`logo.test.ts`, `domain`):

```ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { layout } from '@/ui/theme/tokens';

const png = readFileSync(new URL('./logo-wide-night.png', import.meta.url));

describe('the Seazn Club night logo (spec §7)', () => {
  it("is the web repo's file, byte for byte", () => {
    // sha256 of seazn.club apps/web/public/logo-wide-night.png, read 2026-10-06 (800 × 280, 19.9 KB)
    expect(createHash('sha256').update(png).digest('hex')).toBe(
      'bee2648f76fa2590ac81d2c1e14050fe4c62687b8630437b0d6e6b080c2f90e8',
    );
  });

  it("is drawn at spec §7's 200 × 70, its own aspect", () => {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20); // the PNG IHDR
    expect([width, height]).toEqual([800, 280]);
    expect(layout.logo).toEqual({ width: 200, height: 70 });
    expect(width / height).toBeCloseTo(layout.logo.width / layout.logo.height, 6);
  });
});
```

- Run red. Then:

```bash
cd "$WT" && mkdir -p src/ui/assets && cp /Users/ashokhein/github/seazn.club/apps/web/public/logo-wide-night.png src/ui/assets/logo-wide-night.png && shasum -a 256 src/ui/assets/logo-wide-night.png
```

- `png.d.ts`:

```ts
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
```

- Add to `layout`: `logo: { width: 200, height: 70 }` and `logoLandscape: { width: 160, height: 56 }`, the latter per Q2. Under the other answer it is `logo`'s size.
- Change `brand` to `Seazn Club` in all four dictionaries. It is the logo's accessible name, a brand that is never translated. It is still changed copy, so es, fr and nl get the `_review` marker, which Task 8 clears. Confirm with `grep -a "'brand'"` that HomeScreen is its only user.

- [ ] **Step 2: Rotation, failing first** (`orientation.test.ts`, and `routeTarget` in `useOrientationGate.test.tsx`):
  - `routeTarget`, in its existing table at `useOrientationGate.test.tsx:325-334` (F15). Rewrite the rows to `['/', 'free']`, `['/stream', 'landscape']`, `['/stream/settings', 'free']` and `['/streaming-help', 'free']`, and add `expect(ROWS).toHaveLength(4)`. The last row keeps the existing guard that `/streaming-help` is not Live Stream.
  - `orientationGate('free', physical, holding, current)` over every combination: physical in `portrait`, `landscape`, `flat` and `unknown`; holding true or false; current in `null`, `portrait`, `landscape` and `free`. That is 32 cases, with `expect(n).toBe(32)`. The expected value comes from §7 and D9, written as its own small oracle in the test, never as `orientationGate`'s code:
    - not holding: `{ lock: 'free', card: 'none' }`;
    - holding, with current `null` or `free`: `{ lock: 'landscape', card: 'none' }`;
    - holding otherwise: `{ lock: 'keep', card: 'none' }`.
  - **Leaving `free` for the viewfinder while paired:** a `free` lock is never kept.
    - `orientationGate('landscape', 'portrait', true, 'free')` is `{ lock: 'portrait', card: 'turnSideways' }`. It locks the hands, with the card, exactly as a paired arrival from today's portrait Home keeps `portrait`. The activity is portrait in both cases, and the lock now holds it there.
    - With `physical: 'unknown'`, it is `{ lock: 'landscape', card: 'none' }`: R37's "nothing locked, lock the target".
    - With `physical: 'landscape'` or `'flat'`, it is `{ lock: 'landscape', card: 'none' }`.
    - A `null` current keeps today's behaviour in every case. The change touches `'free'` only.
  - **Sequence:** `free` on Settings while idle, then a remote Go live arrives while Settings is open. The gate for `free` with `holding: true` and `current: 'free'` locks `landscape`. Then the broadcast ends (`holding: false`), and the gate goes back to `free`.
  - Every existing `landscape` and `portrait` case is unchanged.

  Run red.

- [ ] **Step 3: Implement.**

```ts
export type Target = 'portrait' | 'landscape' | 'free';

export function orientationGate(
  target: Target,
  physical: Physical,
  holding: boolean,
  current: Target | null,
): GateView {
  if (target === 'free') return freeGate(holding, current);
  // D9: a `free` lock is no lock to keep; `null` keeps its R34/R37 meaning unchanged.
  const fromFree = current === 'free';
  if (physical === 'unknown') return unsettled(target, holding, fromFree ? null : current);
  if (physical === 'flat' || physical === target) return { lock: target, card: 'none' };
  return { lock: holding && !fromFree ? 'keep' : physical, card: cardFor(target) };
}

/** Spec §7 (D9): follows the phone; while a broadcast is held, the lock never moves, and a `free` lock is no lock to keep. */
function freeGate(holding: boolean, current: Target | null): GateView {
  if (!holding) return { lock: 'free', card: 'none' };
  return { lock: current === null || current === 'free' ? 'landscape' : 'keep', card: 'none' };
}
```

- `orientationGate` changes only where `current === 'free'`. Every existing R24, R34, R35 and R37 case must stay green unchanged, except the R35 Home case named below. Any other red is a finding to bring back, not something to edit away.
- `routeTarget`, at `useOrientationGate.ts:17` (F15): `pathname === '/stream' ? 'landscape' : 'free'`. Rewrite its KDoc: Live Stream's viewfinder is the only landscape-locked route (§7).
- `useOrientationGate(target)` selects the holding fact by target:
  - `target === 'free'` uses `useEngineSelector(selectBroadcastHeld)` (Q3's answer). Under Q3's alternative this is `selectHoldsOrientation`, and the 32-case oracle's "holding" means paired or live;
  - otherwise it uses `selectHoldsOrientation`.

  Call both selectors unconditionally (rules of hooks) and pick between them.

- `selectBroadcastHeld = (s) => selectEngineStatus(s) === 'live'`, at module scope.
- `nativeOrientationLock`: `free` → `OrientationLock.DEFAULT`, `portrait` → `PORTRAIT_UP`, `landscape` → `LANDSCAPE`. Write it as a `Record<Target, OrientationLock>`.
- `nativeOrientationLock.test.ts` mocks `expo-screen-orientation` with `{ lockAsync: vi.fn(), OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3, LANDSCAPE: 5 } }`. These numbers are the module's own enum (`expo-screen-orientation/build/ScreenOrientation.types`); re-read them from `node_modules` before writing. Assert each target's call. That is 3 cases.
- `useOrientationGate.test.tsx`:
  - Home (`/`) while idle locks `free` and shows no card.
  - Home after leaving a live broadcast that just ended locks `free`. That retires R35's "Home in landscape" card case: amend that test's expectation and cite §7.
  - Settings while live keeps the viewfinder's landscape lock, with no `lock` call.
  - **Leaving paired Settings for the viewfinder (F16).** Paired, target `free`, then the target becomes `landscape`. With the phone reading `portrait`, the result is `{ lock: 'portrait', card: 'turnSideways' }`, and `orientationLock.locks` ends in `'portrait'`. Then the phone reads `landscape`, and the result is `{ lock: 'landscape', card: 'none' }`, with `locks` ending in `'landscape'`. This is the gate's own R24 rule, which Q3's "re-locks landscape on return" shortens.
- **Mutations:**
  - in `freeGate`, `current === null` only, without `|| current === 'free'`. The remote-Go-live sequence must fail;
  - in `orientationGate`, `fromFree` set to `false`. The "leaving free while paired" cases must fail.

- [ ] **Step 4: Home turns, failing first** (`HomeScreen.layout.test.tsx`):
  - Set the window with Task 5's `setWindowSize(w, h)` (D13, F12), with `afterEach(restoreWindowSize)` in the file. Then `renderWithPorts(<HomeScreen />)` and read `screen.getByTestId('home').dataset.layout`.
  - **Positive control (F12):** render at jsdom's default and read `portrait`. Then `setWindowSize(844, 390)`, and the same rendered tree reads `landscape`, with `Dimensions.get('window')` at `{ width: 844, height: 390 }`. Then `setWindowSize(390, 844)`, and it reads `portrait` again. A helper that moved nothing fails here, before any layout case can pass on a default.
  - Portrait (390 × 844), in DOM order: the logo (`getByLabelText('Seazn Club')`, computed `width` `200px`, `height` `70px`), the status line, the ended card (when shown, through `ports.endedNotice.show(...)`), Continue, the three tiles (`testID="tiles"`, `flex-direction: column`), then the footer: Language, then version.
  - Landscape (844 × 390): `testID="home-top"`, a row holding the logo (Q2's size, computed), the status line, the Language picker and the version, in that order. Then, between `home-top` and the tiles, in this order (F15): the ended card, as one row (computed `flex-direction: row`), then Continue, as one row. Then `tiles` with `flex-direction: row`, holding 3 tiles. There is no footer after the tiles. Portrait keeps today's order. Seed both cards for this case: `ports.endedNotice.show(...)` and a saved code, as `HomeScreen.test.tsx`'s Continue cases do (re-pin their seed).
  - **The same controls in both** (AGENTS: a control-set diff, never box sizes). Collect `getAllByRole('button').map(name)` plus the logo's label in each layout. They are equal in membership and order, apart from the footer moving to the top. State the expected order as a literal list from the spec's layout description, not from the code.
  - Run red. Then implement in `HomeScreen`:
    - `const { width, height } = useWindowDimensions(); const layout = screenLayout(width, height);`
    - the root `View` gets `testID="home"` and `dataSet={{ layout }}`;
    - the logo is `<Image source={logo} accessibilityLabel={t('brand')} accessibilityRole="image" style={layout === 'landscape' ? styles.logoLandscape : styles.logo} />`, replacing `<Text variant="title">{t('brand')}</Text>`;
    - in landscape, logo, status and `HomeFooter`'s two parts sit in `home-top`. `HomeFooter` gains a `layout` prop and renders inline in the top row in landscape, and as today in portrait;
    - `EndedSlot` and `ContinueSlot` stay where Task 6 put them, which is between `home-top` and the tiles in landscape too (F15). `EndedSlot` passes `layout` to `EndedCard`, whose root is `flexDirection: 'row'` in landscape and a column in portrait. Continue's card takes the same row style in landscape;
    - `ModeTiles` gets `styles.tilesRow` in landscape.
  - Settings' halves (Task 5) now use the same `screenLayout`. Check that Task 5's landscape test still passes.

- [ ] **Step 5: Scoped run.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/ui/assets/logo.test.ts src/domain/orientation/orientation.test.ts src/hooks/useOrientationGate.test.tsx src/services/native/nativeOrientationLock.test.ts src/hooks/engineSelectors.test.ts src/domain/mode/homeLayout.test.ts src/ui/screens/HomeScreen. src/ui/screens/SettingsScreen.test.tsx src/ui/components/OrientationGate.test.tsx src/ui/components/TurnCard.test.tsx src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  Then run typecheck, lint (the boundaries rule must accept the `ui` → asset import) and format. Commit `feat(home): the Seazn Club logo; Home and Settings turn with the phone (spec §7)`.

## Task 8: Translation review pass, AGENTS.md, and the PR's scoped gate

**Files:**

- Modify:
  - `src/i18n/es.json`, `src/i18n/fr.json`, `src/i18n/nl.json`: remove the `_review` markers.
  - `docs/i18n-glossary.md`
  - `AGENTS.md`

- [ ] **Step 1: The AI review pass** (`docs/i18n-glossary.md`, _Clearing the marker_). For every key in _Copy_ marked new or changed:
  - check the string against en, where it renders (`grep -a` the key in `src`), the glossary and the budgets;
  - correct it if needed, and record any correction in the commit body;
  - remove `_review` from es, fr and nl;
  - add three glossary rows:

  | en                             | es                  | fr                 | nl                       | Note                                              |
  | ------------------------------ | ------------------- | ------------------ | ------------------------ | ------------------------------------------------- |
  | Stream ended (Home card title) | Emisión terminada   | Direct terminé     | Stream beëindigd         | The broadcast nouns, as above.                    |
  | OK (button)                    | Aceptar             | OK                 | OK                       | es: Android's own button word.                    |
  | Mic not available (blocker)    | Micro no disponible | Micro indisponible | Microfoon niet bruikbaar | nl: _niet beschikbaar_ overruns the blocker's 24. |

  Then run `cd "$WT" && pnpm i18n:release-check; echo "EXIT=$?"`. It must exit 0.

- [ ] **Step 2: AGENTS.md, as the spec rules it.** Edit only these passages. The line numbers were re-pinned at pre-flight (F19); re-pin them again before editing:
  - **§1, line 60.** The five-screen list becomes "**Scan** → **Paired** → **Live** (HUD) → **Settings**, with Diagnostics as a card inside Settings (2026-10-06 design follow-up §6)".
  - **§6, lines 214–225.**
    - "everything else is portrait (ruling 4)" becomes "Home and Settings follow the phone; Settings keeps the lock while a broadcast is held (2026-10-06 design follow-up §7, amending ruling 4)".
    - Keep the turn-card text for the viewfinder.
  - **§6, lines 226–230.** Replace "Full-bleed preview…" with: "The viewfinder is two halves (design follow-up §1): a 16:9 camera box with the status strip below it, and the controls half. Nothing is drawn over the camera box but the overlay and the _What viewers see_ video. Advisory text rides the status strip, under the status line."
  - **§6, lines 248–250.** "audio above the level floor" becomes "the mic available (a silent room is ready; design follow-up §4)".
  - **§6, lines 251–263.** "Settings and Diagnostics stay reachable…" becomes "Settings, with its Diagnostics card, stays reachable in every state, live included". Keep the rest of the paragraph's reasoning.
  - **§10, line 340.** "Assert an audio **level floor**, never stream presence" stays for the meter and the pipeline. Append: "Readiness is not the level: a silent room is ready (design follow-up §4)."
  - Then run `pnpm prettier --check AGENTS.md docs/i18n-glossary.md docs/superpowers/plans/2026-10-06-s1-design-pr-a.md`.

- [ ] **Step 3: The PR's scoped gate.** Run every vitest file named in Tasks 1 to 7, in one command, with the JSON reporter, and paste the counts: total, failed, and the file list.
  - Run the Gradle filters from Task 1, and `:host:test`.
  - Run the `bridge` project with its one file named: `CAPTURE_BRIDGE=1 pnpm vitest run --project bridge modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts` (F19).
  - Run `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm format:check` and `pnpm i18n:release-check`.
  - Never `pnpm check`, never `pnpm test` (SP4).
  - Run each command three times if any one of them was ever red in this branch, because flaky-shaped reds recur.
  - Commit `docs: AGENTS.md and the glossary as the design follow-up rules them; translation review`.

## Task 9: Device verification (the owner's hands)

> **OWNER HANDS ONLY — not simulated.** No agent performs, simulates, infers or ticks any line of this task. There is no phone, no `adb`, no build and no test in it for an agent to run.

The orchestrator hands this list to the owner once PRs A, B and C are merged. The owner does each line on the phone and writes the result beside it: _pass_, _fail_ with what was seen, or _could not make_ with why. Add a screenshot of the app only where a picture helps.

**Standing rules** (the owner's; they bind every line below):

- Pull the phone's session record to the laptop before any install.
- Install with `adb install -r`. Never uninstall the app.
- Screenshots show the app only. Crop the status bar off (AGENTS §13, _Device evidence_, has the `ffmpeg` crop). Delete anything personal that shows.
- Never screenshot a QR code, a scan screen or a scanned code.
- Never EAS. The build is the owner's local release build (AGENTS §11).
- Delete the recordings after every run: the stream's recording on Cloudflare, and any screen recording of the phone.

**How to read a line.**

- Each line is one action and one thing you should see.
- A line that does not match is a finding for the orchestrator. It is never a change made during the device run.
- A line that cannot be made to happen on this phone is _could not make_, never a pass.
- Sizes are written width × height in dp, the unit Android draws in, with the phone held sideways.
- Unless a line says otherwise, start from a phone that is paired to a staging match, held sideways, and not yet live. Pair by scanning the match's stream code on the Stream tile.

### A. Setup

- [ ] **1. Build.** After PRs A, B and C are merged, build the release app from `main` the way AGENTS §11 says: prebuild, then the release assemble, then undo the change prebuild makes to `package.json`. You should see the build finish with no error. An error in the Android part is a finding.
- [ ] **2. Pull the record.** Before installing, copy the phone's session record to the laptop, your usual way. You should see the file on the laptop and not empty.
- [ ] **3. Install.** Install the release app with `adb install -r`. You should see `Success`, and the app opens on Home.
- [ ] **4. Note the phone.** Write down the phone's model, its screen size in dp (pixels from `adb shell wm size`, times 160, divided by `adb shell wm density`) and its font size setting. You should have three values at the top of your results. Later lines refer to them.
- [ ] **5. Make the small sizes.** Run `adb shell wm size 360x640` and `adb shell wm density 160`, then hold the phone sideways. You should see the app drawn at 640 × 360 dp, the smallest landscape the design allows. For 800 × 360 dp use `360x800` instead, the common 20:9 phone shape. The last line resets both.

### B. Viewfinder, before air

- [ ] **6. Smallest landscape, not ready.** At 640 × 360 dp, make a "Can't go live yet" line show: a phone call gives the mic line, another camera app held open gives the camera line. You should see the camera box and the status strip under it on one half, the controls on the other half, nothing clipped and nothing that scrolls.
- [ ] **7. The camera box.** At 640 × 360 dp, look at the camera picture. You should see a 16:9 picture that fills the width of its half, edge to edge.
- [ ] **8. A wider phone.** At 800 × 360 dp, and again on the phone's own size if it is wider than 16:9, look at the camera picture. You should see the picture smaller and centred in its half, with a plain bar on each side, and the strip text under it still fully visible.
- [ ] **9. The bar colour.** At 800 × 360 dp, look at the bars on each side of the picture. You should see them in the strip's own colour. Write down whether you want that colour or the darker stage colour.
- [ ] **10. The first moment on a wide phone.** At 800 × 360 dp, tap Home, then open the viewfinder again, and watch its first moment (a screen recording helps; delete it afterwards). You should see the camera picture appear at its final size. Write down whether it first appears wide and then jumps smaller.
- [ ] **11. Too short.** Make the window under 180 dp tall: split-screen if the phone allows it, otherwise `adb shell wm size 170x640` with the phone sideways. You should see the app still running, with no crash. The design asks for 360 dp tall and up, so a missing or tiny picture here is information, not a failure. Write down what you see.
- [ ] **12. Controls on the left.** In Settings, change "Controls on the" to the other side (Left or Right), then go Back to camera. You should see the two halves swap sides. Put the setting back afterwards.
- [ ] **13. The chips, ready.** With the camera, mic and network all ready, look at the three chips. You should see three square icons, each with a lime border.
- [ ] **14. The chips, not ready.** Switch airplane mode on. You should see the network chip's border turn orange, the status line say "Can't go live yet — no network", and Go live say "No network". Switch airplane mode off and the chip goes lime again.
- [ ] **15. The icon row.** Look at the row of icon buttons. You should see Settings and Home, and no Diagnostics button.
- [ ] **16. The twelve match names.** For each row, name the two sides of a staging match as typed, and look at the strip. You should see what the right-hand column says, with nothing clipped. "Larger" is the 20 sp size; "smaller" is 17 sp. The three-partner row and the two emoji rows matter most. If the staging page will not take a name, write _could not make_ for that row.

  | #   | Name as typed                                                                                  | You should see                                                                                              |
  | --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
  | 1   | `Ana Ruiz v Bea Lima`                                                                          | Larger size. Each name on its own line with a small grey "v" between them.                                  |
  | 2   | `Alexandra Konstantinopoulou v Maria Fernanda Albuquerque`                                     | Smaller size. Each name may wrap to two lines.                                                              |
  | 3   | `Ana Ruiz / Bea Lima v Cai Wen / Dee Roy`                                                      | Smaller size. One partner per line, two lines a side.                                                       |
  | 4   | `Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos`         | Smaller size. One partner per line. A partner that is too long ends in "…" on its line; it does not wrap.   |
  | 5   | `Match 4`                                                                                      | Larger size. One block, up to two lines.                                                                    |
  | 6   | `Ana v Bea v Cai`                                                                              | Larger size. Side A reads "Ana", side B reads "Bea v Cai".                                                  |
  | 7   | 98 letters A, then the word "v" (a space each side), then 99 letters B (200 characters in all) | Smaller size. Each side wraps to at most two lines and nothing is clipped.                                  |
  | 8   | `Ana v BBBBBBBBBBBBBBBBBBBBBBBBBBB` (27 letters B)                                             | Smaller size, because side B is over 26 characters.                                                         |
  | 9   | `Ana Ruiz v Cai Wen / Dee Roy`                                                                 | Smaller size, because one side has partners. Side B shows one partner per line.                             |
  | 10  | `Ana / Bea / Cai v Dee Roy`                                                                    | Smaller size. Side A is one block, "Ana / Bea / Cai", wrapping to at most two lines. It is not three lines. |
  | 11  | `AAAAAAAAAAAAAAAAAAAAAAAAA🎾 v Bea` (25 letters A, then the tennis ball)                       | Larger size. Side A is 26 characters, the emoji counting as one, and stays on one line.                     |
  | 12  | `Ana Ruiz v Los Volantes de Sevilla 🏸🏸`                                                      | Larger size. Side B is 26 characters, the two emoji counting as one each, and stays on one line.            |

- [ ] **17. A 26-character side.** Name a match `Alexandra Konstantinopoulo v Bea Lima` (side A is exactly 26 characters). You should see side A on one line at the larger size. If it wraps, write that down: the design's assumption is false, and the strip can clip one line on a 360 dp tall phone.
- [ ] **18. The biggest font.** Set the phone's font size to the largest. Show the doubles name (row 3 above) at 640 × 360 dp and look at the strip. Write down what happens: whether anything wraps more, clips or is pushed off. Font size above normal is not covered by any size arithmetic, so this is a record, not a pass.
- [ ] **19. TalkBack reads the name as one stop.** Turn TalkBack on and swipe to the match name, using the doubles name from row 3. You should hear the whole name read in one stop, and not one stop per name or per line. Turn TalkBack off afterwards.
- [ ] **20. TalkBack reads the chips.** With TalkBack on, swipe across the three chips. You should hear "Camera: ready", "Mic: ready" and "Network: ready". Turn TalkBack off afterwards.
- [ ] **21. The longest start time.** In Spanish, turn on "Start and stop automatically" in Settings, have the organiser turn automatic on for the match, and give it a start time. At 640 × 360 dp, look under the chips. You should see "Empieza a las 14:32 CEST" (with your time) on one line under the chips, with nothing below it clipped or pushed off the screen.
- [ ] **22. A silent room.** In a quiet room, with the app open on the viewfinder, look at the mic chip and Go live. You should see the mic chip lime and Go live enabled.
- [ ] **23. A call before Go live.** Still paired and not live, in a quiet room, take a phone call. Within about a second you should see the mic chip turn orange and Go live say "Mic not available".
- [ ] **24. The call ends.** End the call. Within about a second you should see the mic chip lime again.
- [ ] **25. A capture with no audio.** Start a voice-recorder app and keep it recording, then open the viewfinder. Within about two and a half seconds you should see the mic chip orange and Go live say "Mic not available". If the phone shares its mic and sound keeps flowing, write that down: _could not make_ on this phone.
- [ ] **26. The record says so.** After item 25, use Share record and look in the record. You should see a `watch-failed` line with `action: sound`. Skip this if item 25 was _could not make_.
- [ ] **27. The viewfinder closes and reopens.** In a quiet room, open Settings, then go Back. Within a second of the picture returning you should see the mic chip lime again, with no sound needed.
- [ ] **28. A call across the close.** Take a call, and with the call still going open Settings and go Back. You should see the mic chip orange as soon as the picture is back, and still orange until the call ends. It must not flash lime. This is the old race the plan parked.

### C. Viewfinder, on air

- [ ] **29. Go live.** Hold Go live for 3 seconds and watch the sound meter from the end of the hold until the first picture. You should see the status reach "Live. Sound and picture going out.". Write down whether the meter turned orange and for how long. It may for a connect over 2 seconds. It must never stop the connect.
- [ ] **30. On air, smallest landscape.** At 640 × 360 dp, look at the viewfinder on air. You should see the timer, the sound meter, the match name and the status line, with nothing clipped and nothing that scrolls.
- [ ] **31. A silent minute.** On air, stay silent in a quiet room for a full minute. You should see the status line stay "Live. Sound and picture going out." and no "no sound" warning.
- [ ] **32. The score overlay.** With Score preview on in Settings, look at the camera picture on air. You should see the score over the picture only, and nothing drawn over the strip or the controls.
- [ ] **33. What viewers see.** On air, press and hold "What viewers see". You should see the viewers' video inside the camera picture only, and nowhere else on the screen.
- [ ] **34. The icon row on air.** On air, look at the row of icon buttons. You should see Settings, then "What viewers see". Take photo is PR B's and is not checked here.
- [ ] **35. A warning in the strip.** On air, unplug the charger. You should see "Not charging — plug in for a long match" under the status line in the strip, readable, with the match name above it still fully shown. Plug the charger back in.
- [ ] **36. A call on air.** On air, take a phone call. You should see "Mic silenced by a call" in the status line.
- [ ] **37. The call ends.** End the call. You should see the warning clear.
- [ ] **38. The broadcast ends during a call.** Go live, take a call (the warning shows), end the broadcast from the organiser's console while the call goes on, then end the call. Within about a second you should see the mic chip lime again, with no restart of the app.
- [ ] **39. The organiser stops it.** Go live, then stop the broadcast from the organiser's console. You should see the phone stay on the viewfinder saying "Organiser stopped it — waiting for Go live", with no jump to Home and no "Stream ended" card.

### D. Stop and the Stream ended card

- [ ] **40. Stop after live.** Go live, let it run for a minute, then hold Stop. You should land on Home with the "Stream ended" card: the title, "On air" with the time, "You stopped the broadcast.", "Scan the code again for the next broadcast", and OK. This must be seen on the phone, not assumed.
- [ ] **41. No Continue.** With the card showing, look at Home under it. You should see no Continue card for that code, because your own Stop forgets it.
- [ ] **42. OK clears it.** Tap OK. You should see the card go.
- [ ] **43. A second broadcast.** Scan the code again, go live, and stop again. You should see a new card with the new on-air time, not the old one.
- [ ] **44. A restart clears it.** With the card showing, close the app completely and open it again. You should see Home without the card.
- [ ] **45. A new scan clears it.** With the card showing, tap the Stream tile and close the scanner without scanning (no screenshot). You should see Home with no card when you come back.
- [ ] **46. Stop before the first picture.** Go live and hold Stop at once, while it still says it is connecting, before the first picture. You should stay on the viewfinder, waiting for Go live, with no card and no jump to Home.
- [ ] **47. A code that ended, while on air.** Go live, have that code ended from the organiser's console (ask the orchestrator which control does it), then hold Stop. You should land on Home with the card showing the on-air time, "You stopped the broadcast." and "This code has ended. Scan the new one." in place of the scan-again line, and no Continue card for that code.
- [ ] **48. A code that ended before the first picture.** Do the same, with the code ended before the first picture. You should see the card say "Never went live" in place of the time, then "This code has ended. Scan the new one.", and no Continue card. If you cannot time it, write _could not make_.
- [ ] **49. A failed end (only if one happens).** Do not force one. If a broadcast ever ends by failing, you should land on Home with the card saying "Something failed. Your code is kept." and a Continue card; tapping Continue clears the card.

### E. Settings, with Diagnostics

- [ ] **50. Open Settings.** Before air, tap Settings in the icon row. You should see the settings in order (Score preview, Start and stop automatically, Controls on the, then Power with its advice, then Open-source licences straight after the advice) and the Diagnostics card with Share record.
- [ ] **51. The nine rows.** On air, open Settings and look at the Diagnostics card. You should see nine rows with readings, grouped under Link, Delivery, Phone and Heartbeat: Transport, Bitrate, Round trip, Viewers receiving, Behind live, Checked, Battery, Heat and Last sent. There is no Engine section.
- [ ] **52. No Diagnostics button.** Look at the viewfinder before air, the viewfinder on air, and Home. You should see no button called Diagnostics on any of them.
- [ ] **53. The smallest landscape.** At 640 × 360 dp, open Settings with the phone sideways. You should see the settings on one half and the Diagnostics card on the other, the card not scrolling, and no row cut off.
- [ ] **54. The gaps between the halves.** In the same view, look at the space between the two halves and between the rows. You should see even gaps, with nothing touching or overlapping.
- [ ] **55. Portrait.** Not on air, turn the phone upright in Settings. You should see one column: the settings, then the Diagnostics card.
- [ ] **56. The biggest font, in Settings.** In the Settings screen itself, with the phone's font size at the largest, at 640 × 360 dp, look at the Diagnostics card. Write down what happens: whether rows wrap, clip or scroll, and whether Share record can still be reached. Font size above normal is not covered by any size arithmetic, so this is a record, not a pass.
- [ ] **57. Share record.** Tap Share record. You should see the phone's share sheet open. Close it without sending, or send it to yourself.

### F. Home, portrait and landscape

- [ ] **58. Portrait Home.** Upright, with no broadcast, look at Home. You should see, top to bottom, the Seazn Club logo (sharp at 200 × 70), the status line, a Continue card if there is one, the three tiles in a column, then Language and Version. Nothing scrolls sideways.
- [ ] **59. Landscape Home.** Turn the phone sideways on Home. You should see one top row with the logo (sharp at 160 × 56), the status line, Language and Version, then the three tiles side by side, with nothing under the tiles and nothing scrolling sideways.
- [ ] **60. The Language list.** In landscape, tap Language in the top row. You should see the four languages in a list that is fully in view, not cut off at 360 dp tall. Pick one and the app changes language; pick English again.
- [ ] **61. The cards, one row each.** At 800 × 360 dp in landscape, show the Stream ended card (after a Stop), then separately a Continue card (leave a paired viewfinder with Home). You should see each as a single row between the top row and the tiles, with all of Home in view and nothing that scrolls.
- [ ] **62. Smaller, or both cards.** At 640 × 360 dp in landscape, show a card. You should see Home scroll up and down, which is accepted at this size and when both cards show together. Nothing should be cut off that you cannot scroll to, and nothing should scroll sideways.
- [ ] **63. A code message at 360 dp tall.** In landscape at 360 dp tall, bring up a code message: scan a code that has ended (no screenshot of the scan). You should see the whole panel in view, with its title, its text and its buttons, nothing clipped.
- [ ] **64. TalkBack reads the logo.** With TalkBack on, swipe to the logo on Home. You should hear "Seazn Club". Turn TalkBack off afterwards.

### G. Rotation

Do the first two lines before the rest of this group.

- [ ] **65. Settings closes the camera while paired.** Paired and not on air, open Settings. You should see Android's camera-in-use dot in the status bar (Android 12 and up) go out within about a second. Share the record afterwards and look for the capture closing. If the dot stays on while paired, stop this group: the finding goes to the orchestrator, because Settings must then stay locked sideways while paired.
- [ ] **66. Settings keeps the camera on air.** Go live, then open Settings. You should see the dot stay on.
- [ ] **67. Home turns.** With auto-rotate on, turn the phone on Home. You should see Home turn with it, portrait and landscape.
- [ ] **68. Auto-rotate off.** Switch auto-rotate off, then turn the phone on Home. You should see Home stay where it is. Write down what it did.
- [ ] **69. Settings turns while paired.** Paired and not on air, open Settings and turn the phone upright. You should see Settings turn to portrait.
- [ ] **70. Back to the camera, phone upright.** From Settings, with the phone upright, tap Back to camera. You should see the "Turn your phone sideways" card. Turn the phone sideways: you should see the viewfinder lock sideways with the camera picture upright, not rotated.
- [ ] **71. Back to the camera, phone sideways.** Repeat item 70 with the phone already sideways. You should see the viewfinder lock sideways at once, with no turn card.
- [ ] **72. Settings on air does not turn.** On air, open Settings and turn the phone upright. You should see Settings stay sideways.
- [ ] **73. The viewfinder never turns.** On the viewfinder, before air and then on air, turn the phone upright. You should never see a portrait layout of the viewfinder.

### H. Translations: Spanish, French and Dutch

Switch the language with Language on Home before each group of three lines below (Spanish 74 to 76, French 77 to 79, Dutch 80 to 82), and take a screenshot of each result.

- [ ] **74. Spanish, before air.** At 640 × 360 dp, show the longest not-ready line (in Spanish the camera one, "Aún no se puede emitir: la cámara no está lista"). You should see the strip and controls with nothing clipped and nothing that scrolls.
- [ ] **75. Spanish, the Stream ended card.** Stop after live. You should see "Emisión terminada", the time, the two lines, and the button "Aceptar", all in view and not clipped.
- [ ] **76. Spanish, Diagnostics.** At 640 × 360 dp, open Settings. You should see every label and value in full in the Diagnostics card, with no row cut off and no "…" on a fixed word.
- [ ] **77. French, before air.** As item 74, in French (the mic one, "Pas encore de direct : micro indisponible"). You should see nothing clipped and nothing that scrolls.
- [ ] **78. French, the Stream ended card.** As item 75. You should see "Direct terminé", the time, the two lines and "OK", all in view and not clipped.
- [ ] **79. French, Diagnostics.** As item 76. You should see every label and value in full, with no row cut off.
- [ ] **80. Dutch, before air.** As item 74, in Dutch (the mic one, "Nog niet live: microfoon niet bruikbaar"). You should see nothing clipped and nothing that scrolls.
- [ ] **81. Dutch, the Stream ended card.** As item 75. You should see "Stream beëindigd", the time, the two lines and "OK", all in view and not clipped.
- [ ] **82. Dutch, Diagnostics.** As item 76. You should see every label and value in full, with no row cut off.
- [ ] **83. Spanish "Sin datos".** In Spanish, find the delivery row with no reading yet (in the first seconds after going live, before the first check). You should see "El público recibe" beside "Sin datos". Write down whether that reads as "no data about whether viewers receive", or wrongly as "viewers receive no data".
- [ ] **84. Dutch "Stokt".** In Dutch, make viewers stop receiving on air (for example switch the phone's network off for a while, then back on) and open Settings. You should see the delivery row say "Stokt". Write down whether it reads clearly as stalled. If it never shows, write _could not make_.
- [ ] **85. Dutch "Microfoon niet bruikbaar".** In Dutch, take a phone call before Go live. You should see "Microfoon niet bruikbaar" beside Go live, fitting without clipping, and it reads right for a mic taken by a call.
- [ ] **86. The share failure, Spanish and French.** In each language, try to make Share record fail (for example with no app to share to). You should see "Falló. Reintentar" in Spanish and "Échec. Réessayer" in French. Write down whether each tells you what failed. If you cannot make it fail, write _could not make_.

### I. One forced RTMPS session against staging

Any time after the merge. It needs no PR C code: staging's own switch does the forcing, and the app has no RTMPS switch of its own. Staging's SRT flag must be off before the session and back on after it, and the orchestrator does both with the web lane.

- [ ] **87. Ask for SRT off.** Tell the orchestrator you are about to start. It pings the web lane to switch staging's SRT flag off. Wait until the orchestrator tells you the web lane confirms it is off. Do not go live before that.
- [ ] **88. Go live in French.** Set the app to French, pair to a staging match, and go live. You should see the status reach "Live" and the picture playing on the staging match page.
- [ ] **89. The link in Diagnostics.** On air, open Settings and look at the Transport row. You should see "RTMPS seul", because SRT is not offered.
- [ ] **90. Record the session id.** Write down the session id of this broadcast, from the staging console for the match or from the shared record. Give it to the orchestrator: it goes to the web lane.
- [ ] **91. Stop and tell the orchestrator.** Hold Stop, then tell the orchestrator you are done. It pings the web lane to switch the SRT flag back on. Wait for its word that the flag is restored before any other staging run.
- [ ] **92. Delete the recording.** Delete the broadcast's recording on Cloudflare, and the input with it. You should see it gone from the list.

### J. Wrap-up

- [ ] **93. Put the phone back.** Run `adb shell wm size reset` and `adb shell wm density reset`. Turn TalkBack off, set the font size to what you wrote down in item 4, switch auto-rotate and the charger back on, and set "Controls on the" as it was. You should see the phone as you found it.
- [ ] **94. Hand it over.** Give the orchestrator your written results, the screenshots (app only, status bar cropped) and any finding. You should hear back which findings need a fix and which are accepted.

**Where each earlier reference went.** Other parts of this plan, and the ledger, point at this task by its old item numbers or by name. They mean these items:

| Earlier reference                                                                           | Items                  |
| ------------------------------------------------------------------------------------------- | ---------------------- |
| Old item 1, fit at the smallest landscape                                                   | 6, 30                  |
| Old item 2, label cases, the 26-character side, font size                                   | 16, 17, 18             |
| Old item 3, the camera box                                                                  | 7, 8, 12, 32, 33       |
| Old item 4, the mic: silent room, connect, no audio, calls, reopen                          | 22 to 29, 31, 36 to 38 |
| Old item 5, Stop after live                                                                 | 40 to 43               |
| Old item 6, Diagnostics in Settings                                                         | 50 to 57               |
| Old item 7, rotation, the capture while Settings is open                                    | 65 to 73               |
| Old item 8, the logo                                                                        | 58, 59, 64             |
| Old item 9, locales                                                                         | 74 to 86               |
| Old item 10, the longest start time                                                         | 21                     |
| Mic chip after the viewfinder reopens; the parked glue race                                 | 27, 28                 |
| Bar colour; first picture jump on wide phones; split-screen under 180 dp tall               | 9, 10, 11              |
| TalkBack: match name as one stop; logo as "Seazn Club"                                      | 19, 64                 |
| Card-row wrapping at 800 × 360; Language list; code message at 360 dp tall                  | 61, 60, 63             |
| Auto-rotate off; leaving paired Settings upright                                            | 68, 70, 71             |
| Owner's-eye wording: Sin datos, RTMPS seul, Stokt, Microfoon niet bruikbaar, share failures | 83 to 86, 89           |
| Organiser-stopped; never went live; code ended                                              | 39, 46, 47, 48         |
| The forced RTMPS session, for the web lane                                                  | 87 to 92               |

Any line that fails is a finding for the orchestrator. It is never a change made on the device run.

## Self-review

- **Spec coverage.**
  - §1 is Task 3.
  - §2 is Task 2, rendered by Task 3, with clipping checked in Task 9 (items 16 to 18).
  - §3 is Task 4.
  - §4 is Task 1. Its four owed JVM tests are `S4 a room silent…`, `S4 sixty seconds…`, `S4 a call…` and `S4 on air…`. "Audio capture unavailable" is `S4 no audio buffer…`, driven through `PeakMeter` (F4). The predicate and its producers are mutated in M1 to M6.
  - §5 is Task 6. Its five owed tests are cases 1 to 5. Cases 6 to 9 are its sequences and D7, and cases 10 and 11 are F14 a and b.
  - §6 is Task 5.
  - §7 is Task 7.
  - The spec's _Verification_ is Task 8 (3) and Task 9, minus `pnpm check` (SP4).
- **Sequence cases owed by the brief:**
  - a second Stop: Task 6, case 6;
  - OK then a new broadcast: Task 6, case 5;
  - a call starting and ending: Task 1 (`S4 a call…`, twice), Task 4 (the mic chip) and Task 3 (the strip's line).
- **Anti-vacuity.** Every table or sweep states its count: the 60 s sweeps, the no-buffer sweep (5 ticks), the 7 label cases, the 6 chip cases, the 6 viewfinder scenes into Settings (4 after Task 6), the 9 rows, the 6 ended lines, the 32 rotation cases, the 4 route targets and the 5 layout cases.
- **Unresolved, by design:**
  - Q1 to Q4 are answered (_Owner answers_, 2026-10-07).
  - Font scale above 1.0 is not covered by any fit arithmetic (Task 9, item 18).
  - Whether Android's `UNSPECIFIED` respects a user who has turned auto-rotate off is Task 9, item 68.
  - Whether paired Settings really closes the capture on the phone is Task 9, item 65 (F16). The code says it does.
  - **A fatal end with `codeEndedPending` set** is outside F14 a. Its card says _Your code is kept._ about a dead code (D7). This is for the orchestrator to put to the owner, not to decide here.
  - The pre-existing race after the capture's close (Review Focus 1) is named, not fixed.
- **Placeholders:** none. The owner's answers are recorded, and Task 2's doubles size is the literal `'long'` (Q4 A); there is no `Q4_DOUBLES` (F19). The "re-pin" notes mark line numbers and fake APIs that must be read before editing (AGENTS failure class 5). They are not open design.
