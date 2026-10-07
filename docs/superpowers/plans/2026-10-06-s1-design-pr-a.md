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

**Architecture:** Almost all of this is JavaScript and React Native UI over the existing ports. The one native change is to the readiness predicate in the pure-Kotlin core (`modules/capture-engine/android/core`). There, `Readiness.sound` becomes "the mic is available", and `SoundHold`'s 15 s window is deleted. That change is JVM-tested, and is driven through the JVM host's JS contract by the `bridge` vitest project.

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
2. **§5's leave reuses the existing leave rule.** Check that the card is shown only by a leave that really went Home. Check that the code is forgotten exactly as before. Check that a fatal end keeps the code, as the card's wording claims.
3. **Rotation (`free`) must never let the activity rotate under a held broadcast or a committed camera.** Read every `current === 'free'` path in `orientationGate`.
4. **Layout claims that jsdom cannot see are routed to Task 9, not asserted in vitest.** A test that reads `getComputedStyle` pins declared sizes only. It never proves a fit.
5. **Removed things are gone everywhere.** `/stream/diagnostics`, `homeIntent`, `EndedBlock`, `SoundHold` and the `audio-below-floor` reason must leave nothing that still names them (`grep -a`).

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

## Spec premises found false

- **F1. The `audio-below-floor` degrade reason is not native.** §4 lists it beside the native change. It is TypeScript-only: `SessionState.ts:72-78` says so, and `Vocabulary.kt:15-29` records that native never sends it. Its removal is JS-only (Task 1). Natively there is `MIC_SILENCED` alone, which stays.
- **F2. "_Open-source licences_ moves under the power advice" is already true.** `SettingsScreen.tsx` renders `SideChoice`, power label, power advice, `Licences`, in that order. Task 5 pins the order with a test instead of moving anything.
- **F3. The 640 × 360 fit is not achievable as written for every §2 label case** (Q4).
- **F4. The spec's verification names `pnpm check`.** That command runs the full vitest suite, which the owner's standing rule forbids locally. This plan runs `check`'s three non-test parts plus the scoped vitest files. CI runs `pnpm check` itself.
- **Checked and true:** "_Something failed. Your code is kept._" is truthful on a fatal end.
  - `forgetsSaved` (`src/domain/mode/reopen.ts`) forgets only on an unpair or an operator stop.
  - `leaveRule` gives a failed engine `free`, which runs `setActive(null)` and keeps the saved code.
  - Home's Continue card (`continueCard.ts`, kind `saved`) then offers it, and `tapToPairMark` re-pairs it.
  - The card reuses `stream.status.endedFatal` unchanged.

## Plan decisions

- **D1. Native's `sound` is "a reading from the open capture, and not silenced by the system".**
  - A NaN reading is not a reading: it keeps `ReadinessTest`'s NaN case meaningful.
  - The capture's close clears it, as today (the C4a carry).
  - When the system restores the mic, the sound check is ready again at once if the capture is still reading. §4 says "ready when the call ends", and the glue keeps reading through a call.
  - `Readiness.AUDIO_FLOOR` and its parity test go: nothing native reads the level any more.
  - `wire/audio-floor.json` and the JS `AUDIO_FLOOR` stay, because the meter's segments still use them.
- **D2. `BridgeCore` loses its `silenceMs` parameter, so the glue rule test changes.** `GlueRulesTest`'s "final r2" rule ("the glue never passes a readiness timing override") becomes "BridgeCore declares no `…Ms` timing parameter". A new one then re-opens the rule instead of passing silently.
- **D3. The JVM host learns `micSilenced` on its `readiness` line.** The JS contract's `ready.sound = false` maps to it: a level can no longer make sound not ready.
- **D4. The advisory caption moves into the status strip, under the status line.** `topAdvisory` and its priorities are unchanged: _keepOpen_, _shed_, _overlayFailed_, _notCharging_, then _scoreAhead_. _scoreAhead_ is already before-air only, from its `paired` input.
  - The top and bottom `EdgeStrip`s go, and so does `EdgeStrip.tsx`, whose only user is the stage. Nothing is drawn over the camera box but the overlay and the _What viewers see_ video.
  - AGENTS §6's "Full-bleed preview" rule is amended in Task 8.
- **D5. `StreamStage` becomes the camera half and `StreamColumn` becomes the controls half.** Both keep their file names, so the existing tests' imports stay valid. Back's refusal line (`useColumnLine`) moves to `StreamScreen`, which hands the line to the strip.
- **D6. The card's _You stopped the broadcast._ and _Something failed. Your code is kept._ reuse the existing `stream.status.endedOperator` and `stream.status.endedFatal`.** They are the same strings in all four languages, so nothing is translated twice. New keys exist only for the title and OK.
- **D7. An Ended with no time on air goes Home too, and the card says _Never went live_ in place of the duration.** That covers the 401-deferral stop and a fatal end before the first frame. A Stop before the first frame is Paired, not Ended (`SessionMachine.kt:107-113`), so it stays on the viewfinder as §5 asks.
- **D8. `endedNotice` is an in-memory port built in `createNativePorts`.** A restart clears it by construction. `show` always stores a fresh object, so a second broadcast's card is never the first one's.
- **D9. Rotation.** `Target` gains `free`.
  - `routeTarget` returns `landscape` for `/stream` and `free` for everything else, which is Home and `/stream/settings`.
  - `free` with nothing held locks nothing (`lockAsync(OrientationLock.DEFAULT)`, which is Android's `UNSPECIFIED`). It follows the phone, within the user's own auto-rotate setting.
  - `free` while a broadcast is held keeps the lock. If nothing is locked yet, or the lock is `free`, it locks landscape (the R37 analogue). It never shows a card.
  - Returning to `landscape` while paired from a `free` lock never keeps `free`. It locks how the phone is held, with the turn card, as R24 does, or locks landscape when there is no reading yet. A `null` current keeps today's meaning.
  - `portrait` and `turnUpright` stay in the domain and its tests, though no route asks for them now. Removing them is a separate change the reviewer may ask for.
- **D10. Home's layout is `landscape` when the window is wider than tall (`useWindowDimensions`).** It is one tree, branched by style, with a `dataSet={{ layout }}` marker that tests read. jsdom's default window is 1024 × 768, so every existing Home suite renders the landscape branch. Task 7 pins both branches explicitly and proves they offer the same controls in the same order.
- **D11. The logo lives at `src/ui/assets/logo-wide-night.png`, inside the `ui` element, so the import is legal.** A `src/ui/assets/png.d.ts` declares `*.png` as an `ImageSourcePropType`, because `expo-env.d.ts` is gitignored and cannot be relied on.
- **D12. `homeIntent` is deleted.** Its only producer was _Scan another_. Its consumer, `useScanRequest` in `useHome.ts`, goes with it.

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

| Key                           | en                                          | es                                          | fr                                        | nl                            | Change, budget                                             |
| ----------------------------- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `stream.chip.sound`           | Mic                                         | Micro                                       | Micro                                     | Microfoon                     | changed (T1); 10                                           |
| `stream.blocker.sound`        | Mic not available                           | Micro no disponible                         | Micro indisponible                        | Geen microfoon                | changed (T1); 24. nl: _niet beschikbaar_ would be 26       |
| `stream.status.notReadySound` | Can't go live yet — the mic isn't available | Aún no se puede emitir: micro no disponible | Pas encore de direct : micro indisponible | Nog niet live: geen microfoon | changed (T1); 48. Lengths 43, 43, 41, 29                   |
| `stream.status.liveNoSound`   | —                                           | —                                           | —                                         | —                             | removed (T1)                                               |
| `stream.link.diagnostics`     | —                                           | —                                           | —                                         | —                             | removed (T4)                                               |
| `diag.section.record`         | —                                           | —                                           | —                                         | —                             | removed (T5) if `grep -a` finds no other user              |
| `stream.ended.scanAnother`    | —                                           | —                                           | —                                         | —                             | removed (T6), with its `budgets.test.ts` row               |
| `brand`                       | Seazn Club                                  | Seazn Club                                  | Seazn Club                                | Seazn Club                    | changed (T7): the logo's accessible name, never translated |
| `home.ended.title`            | Stream ended                                | Emisión terminada                           | Direct terminé                            | Stream beëindigd              | new (T6); the card's title and its region name             |
| `home.ended.ok`               | OK                                          | Aceptar                                     | OK                                        | OK                            | new (T6). es: Android's own button word                    |

Reused unchanged: `stream.ended.duration`, `stream.ended.neverLive`, `stream.ended.scanAgain`, `stream.status.endedOperator`, `stream.status.endedFatal`, `diag.title`, `diag.share`, `diag.shareFailed`, `stream.link.settings`, `stream.home` and `stream.peek.label`. Task 8 adds _Stream ended_, _OK (button)_ and _Mic not available_ to the glossary.

## File map

| Path                                                                                                                                                                                                                                                                                                                                                                                                                                        | Tasks | What                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Readiness.kt`                                                                                                                                                                                                                                                                                                                                            | 1     | `micAvailable` replaces `audioPeak`; floor removed   |
| `…/engine/adapter/BridgeCore.kt`, `…/engine/adapter/SoundHold.kt` (deleted)                                                                                                                                                                                                                                                                                                                                                                 | 1     | mic availability; no silence window                  |
| `…/core/host/src/main/kotlin/com/seazn/capture/engine/host/Host.kt`                                                                                                                                                                                                                                                                                                                                                                         | 1     | `micSilenced` on the readiness line; no `SILENCE_MS` |
| `…/core/Vocabulary.kt`                                                                                                                                                                                                                                                                                                                                                                                                                      | 1     | stale `audio-below-floor` comment                    |
| `…/src/test/…/core/ReadinessTest.kt`, `Configs.kt`; `…/adapter/BridgeCoreTest.kt`, `GlueRulesTest.kt`, `HeldPoseTest.kt`, `EncoderKeysTest.kt`, `SoundHoldTest.kt` (deleted)                                                                                                                                                                                                                                                                | 1     | tests                                                |
| `src/hooks/statusKey.ts`, `src/domain/session/SessionState.ts`, `src/hooks/engineSelectors.test-d.ts`, `src/hooks/statusKey.test.ts`                                                                                                                                                                                                                                                                                                        | 1     | no `audio-below-floor`, no live-no-sound             |
| `modules/capture-engine/src/FakeCaptureEngine.ts`, `FakeCaptureEngine.test.ts`, `test/hostEngine.ts`                                                                                                                                                                                                                                                                                                                                        | 1     | fake and contract say "mic not available"            |
| `src/domain/session/matchLabel.ts` (+ test), `src/ui/components/MatchLabel.tsx` (+ test), `src/ui/theme/type.ts`                                                                                                                                                                                                                                                                                                                            | 2     | the label                                            |
| `src/ui/theme/tokens.ts`, `src/ui/theme/viewfinderFit.test.ts`, `src/ui/screens/StreamScreen.tsx`, `src/ui/components/StreamStage.tsx`, `StreamColumn.tsx`, `StatusStrip.tsx` (new), `HoldAction.tsx`, `EdgeStrip.tsx` (deleted)                                                                                                                                                                                                            | 3     | the halves                                           |
| `src/ui/components/Glyph.tsx` (new), `PreflightChips.tsx`, `IconButton.tsx` (new), `test/setup-ui.ts`                                                                                                                                                                                                                                                                                                                                       | 4     | icons                                                |
| `app/stream/diagnostics.tsx` (deleted), `src/ui/screens/DiagnosticsScreen.tsx` (deleted), `SettingsScreen.tsx`, `src/ui/components/DiagnosticsCard.tsx` (new), `src/hooks/settingsDiagnostics.ts` (new), `src/domain/mode/homeLayout.ts` (new), `src/hooks/diagnostics.ts`, `src/services/devicePorts.ts`, `src/services/native/expoRouterNavigation.ts`, `src/hooks/useStreamLinks.ts`, `test/routedApp.tsx`, `test/backFromSubScreen.tsx` | 5     | Diagnostics in Settings                              |
| `src/services/endedNotice.ts` (new), `src/services/homeIntent.ts` (deleted), `src/domain/session/endedCard.ts` (new), `src/hooks/useEndedNotice.ts` (new), `src/ui/components/EndedCard.tsx` (new), `EndedBlock.tsx` (deleted), `src/hooks/useViewfinder.ts`, `useHome.ts`, `usePorts.tsx`, `nativePorts.ts`, `test/fakePorts.ts`, `src/domain/mode/reopen.ts` (comments)                                                                   | 6     | Stop → Home                                          |
| `src/ui/assets/logo-wide-night.png` (copied), `src/ui/assets/png.d.ts`, `src/domain/orientation/orientation.ts`, `src/hooks/useOrientationGate.ts`, `src/services/native/nativeOrientationLock.ts`, `HomeScreen.tsx`, `HomeFooter.tsx`                                                                                                                                                                                                      | 7     | Home, logo, rotation                                 |
| `AGENTS.md`, `docs/i18n-glossary.md`, the four dictionaries                                                                                                                                                                                                                                                                                                                                                                                 | 8     | rules, review pass                                   |

---

## Task 1: A silent room is ready (§4)

**Files:**

- Modify:
  - `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Readiness.kt`
  - `…/core/Vocabulary.kt` (the comment at lines 15–29)
  - `…/adapter/BridgeCore.kt` (constructor at lines 34–43, the `sounds` field at line 53, `readiness` at lines 190–205, `silenced` and `micSilenced` at lines 283–302, and the comments at lines 540 and in `CappedLines`)
  - `modules/capture-engine/android/core/host/src/main/kotlin/com/seazn/capture/engine/host/Host.kt` (lines 13–32, 63–69 and 119–157)
- Delete:
  - `…/adapter/SoundHold.kt`
  - `…/src/test/kotlin/com/seazn/capture/engine/adapter/SoundHoldTest.kt`
- Test:
  - `…/core/ReadinessTest.kt`
  - `…/core/Configs.kt:86`
  - `…/adapter/BridgeCoreTest.kt` (lines 1210–1338, the sound tests)
  - `…/adapter/GlueRulesTest.kt:125-150`
  - `…/adapter/HeldPoseTest.kt:57`
  - `…/adapter/EncoderKeysTest.kt:25`
  - `…/host/src/test/kotlin/com/seazn/capture/engine/host/ProtocolTest.kt`, if it constructs a `Readiness`
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
class BridgeCore(clock, scheduler, platform, store, appVersion, model, newId = …) // no silenceMs
fun BridgeCore.readiness(cameraFrames: Boolean? = null, audioPeak: Double? = null, pose: Pose? = null) // unchanged signature: the glue still passes the peak
```

- [ ] **Step 1: Baselines.**
  - Run `pnpm install --frozen-lockfile` once.
  - Run the Gradle filter below and the JS files below, and record the counts. These are the "before" numbers every later count is relative to.
  - Write down the `NotReady.SOUND`, `sound` and `audioPeak` uses: `cd "$WT" && grep -arn "audioPeak\|SoundHold\|SILENCE_MS\|silenceMs\|AUDIO_FLOOR\b" modules/capture-engine/android --include=*.kt | grep -v /build/`. Every hit is either changed in this task or named here as untouched. `StallWatchdog.AUDIO_FLOOR_FPS` is the audio packet rate, unrelated, and stays.

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
    assertFalse("degraded" in kinds(), "no degrade was ever recorded")
  }

  /** The C4a carry, kept: the capture's close is not ready at once; the next opening's first reading is. */
  @Test
  fun `C4a carry the capture's close is not sound, and the next opening's first reading is`() {
    core.start()
    pair()
    core.viewfinder(true)
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"])
    core.viewfinder(false)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "closed: nothing records")
    core.viewfinder(true)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"], "open, no reading yet")
    core.readiness(audioPeak = 0.0)
    scheduler.advanceBy(0)
    assertEquals(true, readyOn(core)["sound"], "its first reading, silent or not")
  }

  /** D1: a reading that is no number is no reading. */
  @Test
  fun `S4 a NaN reading is not a working mic`() {
    core.start()
    pair()
    core.viewfinder(true)
    core.readiness(audioPeak = Double.NaN)
    scheduler.advanceBy(0)
    assertEquals(false, readyOn(core)["sound"])
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
- In `GlueRulesTest.kt`, rewrite `final r2 the glue never passes the core a readiness timing override` as `D2 BridgeCore declares no readiness timing parameter`. Keep the constructor parse and assert `assertEquals(emptyList(), timing, "a new timing parameter re-opens final r2: the glue must never pass it")`.
- `Configs.READY` becomes `Readiness(cameraFrames = true, micAvailable = true, pose = Pose.Held(Side.LEFT))`. `HeldPoseTest:57` and `EncoderKeysTest:25` change likewise.

- [ ] **Step 3: Run them red.**

  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.adapter.BridgeCoreTest' --tests 'com.seazn.capture.engine.core.ReadinessTest' --tests 'com.seazn.capture.engine.adapter.GlueRulesTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  ```

  Expected: compilation fails on `micAvailable`. That is the red state for a signature change. Note it, then go on.

- [ ] **Step 4: Implement.**
  - `Readiness.kt`: as in _Interfaces_. Delete `AUDIO_FLOOR` and its KDoc. Rewrite the class KDoc to cite spec §4 and the owner's words.
  - `BridgeCore.kt`:
    - remove the `silenceMs` parameter, its KDoc, and the `sounds` field;
    - add the two facts and one predicate:

    ```kotlin
      /** Spec §4: the open capture has given a reading (a finite one; D1). Cleared at the capture's close. */
      private var micReading = false

      /** The system's last word on our recording (F-P5-8, `MicSilenceWatch`), kept across the capture's close. */
      private var systemSilenced = false

      private fun micAvailable() = micReading && !systemSilenced
    ```

    - in `readiness(...)`, drop `atMs`, the `sounds.sample` call and the `peak` line;
    - inside the scheduled block, put:

    ```kotlin
          if (audioPeak != null && audioPeak.isFinite()) micReading = true
          readiness = readiness.copy(cameraFrames = cameraFrames ?: readiness.cameraFrames, micAvailable = micAvailable(), pose = ours ?: readiness.pose)
    ```

    - `silenced()` becomes `micReading = false; turnMic()`;
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
  - Run three mutations, one at a time, each from a `cp` backup:
    - **M1.** `Readiness.sound` → `get() = true`. `S4 a call…` must fail.
    - **M2.** `micAvailable()` → `micReading`, dropping `&& !systemSilenced`. `S4 a call…` must fail.
    - **M3.** In `readiness`, `audioPeak != null` without `&& audioPeak.isFinite()`. `S4 a NaN reading…` must fail.
  - A fourth check, of the old rule rather than of a new guard: put `micAvailable() && (audioPeak ?: 0.0) >= 0.05` back as the predicate. `S4 a room silent…`, `S4 sixty seconds…` and `S4 on air…` must all fail. That proves the tests witness §4, not just the refactor.

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

- [ ] **Step 7: Scoped JS run.**

  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui --project types src/hooks/statusKey.test.ts src/hooks/engineSelectors.test-d.ts modules/capture-engine/src/FakeCaptureEngine.test.ts src/hooks/preflight.test.ts src/ui/components/Hud.test.tsx src/ui/components/PreflightChips.test.tsx src/i18n/budgets.test.ts src/i18n/dictionaries.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && CAPTURE_BRIDGE=1 pnpm vitest run --project bridge --reporter=json --outputFile="$TMPDIR/b.json" > "$TMPDIR/b.log" 2>&1; echo "EXIT=$?"
  ```
  - The `bridge` project is the JVM host's contract (`test/hostEngine.ts`). It is the seam's real producer and consumer, so it is owed here (AGENTS failure class 1).
  - Then run `pnpm typecheck`, `rtk proxy pnpm lint` (read `✖ N problems`) and `pnpm format:check`.
  - `grep -a` must find no `audio-below-floor`, `liveNoSound`, `SoundHold` or `SILENCE_MS` in `src app modules test`.

- [ ] **Step 8: Commit** with the message `feat(capture): a silent room is ready; the mic's availability is sound (spec §4)` and the trailer.

## Task 2: The match label, split on its sides (§2)

**Files:**

- Create:
  - `src/domain/session/matchLabel.ts`
  - `src/domain/session/matchLabel.test.ts`
  - `src/ui/components/MatchLabel.tsx`
  - `src/ui/components/MatchLabel.test.tsx`
- Modify: `src/ui/theme/type.ts`, which gains `label`, `labelLong` and `stripStatus`.

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
    // Q4 option A: doubles are long. Under option B or C this literal is 'regular'.
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

- The doubles case's size is `'long'` under Q4 option A, and `'regular'` under options B and C. Write the literal the owner's answer gives, never a value read from the code.
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
  const longest = Math.max(...parts.flatMap((part) => part.lines.map((line) => line.length)));
  return longest > LONG_LINE_OVER ? 'long' : 'regular';
}
```

Under Q4 option A, `labelSize` also returns `'long'` when any part has `wrap === 1`, meaning partners. Add that line, and the doubles case pins it.

- **Mutation:** change `>` to `>=` in `labelSize`. "the size turns at 26" must fail.
- **Mutation:** remove `.filter(...)`. "a lone ' / '" must fail.

- [ ] **Step 3: Type roles.** In `type.ts`, add:
  - `label`: `font.displaySemibold`, 20/22, `colour.ink`;
  - `labelLong`: 17/19, the same otherwise;
  - `stripStatus`: `font.body`, 15/22, `colour.ink2`. These are the board's status-strip figures.

  The grey `v` uses `metricUnit` (12/16, `ink3`).

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

  Whether any of these clip at 640 × 360 is invisible here. That is Task 9, item 2.

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
  statusLinesMax: 2,
  captionLinesMax: 2,
```

- Use the values Q4's answer gives. Option B makes `captionLinesMax: 1` and `stripPadV: 10`.
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
    const label = layout.labelLinesMax * typeScale.labelLong.lineHeight; // Q4 A: doubles are long
    const status = layout.statusLinesMax * typeScale.stripStatus.lineHeight;
    const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
    const items = [label, status, caption];
    expect(items).toHaveLength(3);
    expect(stack(items, layout.stripGap, layout.stripPadV)).toBeLessThanOrEqual(
      SMALLEST.height - BOX,
    );
  });

  it('the controls half before air: plate, chips, the flexible gap, icons, hold and its reason', () => {
    const items = [
      layout.plateHeight,
      layout.chip,
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

- Red first: `labelLong`, `stripStatus` and the new tokens are missing until Steps 1 and Task 2 land. Run it after Step 1 alone, and the strip case must be green at exactly 180.
- **Mutation:** set `stripPadV: 10` without option B. The strip case must fail at 184. This is the arithmetic that made Q4 an owner question.

- [ ] **Step 3: The layout test, failing first** (`StreamScreen.layout.test.tsx`, `ui`). Use `renderViewfinder` and assert:
  - The root has two children, `testID="camera-half"` and `testID="controls-half"`, each with computed `flex-grow: 1`. That is spec §1's 50/50.
  - `flex-direction` is `row` for `side: 'right'`, and `row-reverse` after `settings.change({ side: 'left' })`. The test sets the side through the store, then re-reads.
  - Inside `camera-half`, in DOM order: `testID="camera-box"`, which contains `preview` and, with the overlay on and a URL, `overlay`, then `testID="status-strip"`. The `viewer-video` is inside `camera-box` during a peek. Use `view.engine.scene('live')`, then press and hold _What viewers see_.
  - `status-strip` contains `match-label`, then the status line, then, before air with the overlay on, the text _You see the score slightly ahead of viewers_. In scene `live`, that text is absent.
  - `controls-half`'s children, in DOM order, before air: `tally-plate` and the meter in one row (`testID="plate-row"`), then the chips row, then `testID="controls-gap"`, then `testID="icon-row"`, then the hold button. On air: `plate-row` holds `tally-plate` and the elapsed text, then the meter, `controls-gap`, `icon-row`, and the hold button.
  - Computed `min-height` of the hold button's plate is `${layout.holdHeight}px`, and `background-color` of `status-strip` is `colour.surface`, painted with the same `paintOf` helper `Hud.test.tsx` uses.
  - Organiser-stopped (`view.engine.forceState` with Paired and `lastEnd: 'organiser'`, or the fake's scene for it; re-pin which) still renders both halves. This is §1's last bullet.
  - **Sequence:** Paired, then live, then the call starts (scene `mic-silenced`), then the call ends (scene `live`). The strip's status line follows each step, and the halves never remount: the `camera-box` element is the same object before and after (`toBe`).
  - Run red: no halves yet.

- [ ] **Step 4: Implement.**
  - `StreamScreen`: `<View testID="viewfinder" style={side === 'left' ? styles.mirrored : styles.halves}>`, holding `<StreamStage …line={line} />` and then `<StreamColumn …/>`. `halves` is `{ flex: 1, flexDirection: 'row' }` and `mirrored` is `row-reverse`.
    - `useColumnLine(view, leave.blocked)` moves here from `StreamColumn`, unchanged.
    - `StreamStage` gets `line`, `paired`, `overlayOn`, `peek`, `canLeave`, `onHome` and `onSettings`. `onDiagnostics` is kept until Task 4.
  - `StreamStage` is the camera half (`testID="camera-half"`, `flex: 1`). It holds:
    - `camera-box`: `width: '100%'`, `aspectRatio: layout.previewAspect`, `backgroundColor: colour.stage`, `overflow: 'hidden'`. Inside it go `PreviewBoundary`, `OverlayPreview` and `StageVideo`, as today; their `absoluteFill` now fills the box only.
    - `<StatusStrip line={line} advisory={advisory} />`. `advisory` is `topAdvisory(...)` exactly as `TopStrip` computes it today, with the same inputs.
    - `TopStrip`, `BottomStrip` and the `EdgeStrip` import are deleted.
  - `StatusStrip` (`testID="status-strip"`, `flex: 1`, `backgroundColor: colour.surface`, padding `stripPadV`/`stripPadH`, gap `stripGap`) holds:
    - `<MatchLabel />`;
    - `<StatusLine variant="stripStatus" numberOfLines={layout.statusLinesMax}>{line}</StatusLine>`;
    - when the advisory is not null, `<Text variant="metricUnit" numberOfLines={layout.captionLinesMax}>{t(ADVISORY_KEY[advisory])}</Text>`.
  - `StreamColumn` is the controls half (`testID="controls-half"`, `flex: 1`, padding `controlsPad`, gap `controlsGap`, `backgroundColor: colour.ground`). It holds:
    - `plate-row` (`flexDirection: 'row'`, gap `space.sm`): `TallyPlate`, then `view.onAir ? <Elapsed /> : <AudioMeter />`;
    - `view.onAir ? <AudioMeter /> : null`;
    - before air, `<PreflightChips …/>`;
    - `<View testID="controls-gap" style={{flex:1}}/>`, written through `StyleSheet`;
    - `<View testID="icon-row">` with the existing `GhostButton`s for Settings, Diagnostics and Home (if `canLeave`). The icon row receives `onSettings`, `onDiagnostics`, `onHome` and `canLeave` from `StreamScreen`. On air, `ColumnPeek` goes into this row, after Settings;
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
  - `src/ui/screens/StreamScreen.` is a deliberate substring. It must match all eight `StreamScreen.*.test.tsx` files plus the new layout test. Check the printed names.
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
      Glyph: ({ name, slashed }: { name: string; slashed?: boolean }) =>
        createElement(View, {
          testID: 'glyph',
          dataSet: { name, slashed: String(slashed === true) },
        } as ViewProps),
    };
  });
  ```

- [ ] **Step 2: Failing chip tests** (`PreflightChips.test.tsx`). Keep the existing border-colour cases, which already read `TOKEN.lime` and `TOKEN.caution` through computed style. Add:
  - For each chip (camera, mic, network) × ok (true, false), 6 cases with `expect(count).toBe(6)`:
    - the accessible name is `"{Camera|Mic|Network}: ready|not ready"`, from en via `stream.chip.ok` and `stream.chip.notOk`;
    - the glyph's `data-name` is `camera`, `mic` or `network`;
    - the camera glyph's `data-slashed` is `"true"` only when the camera is not ready, and the other two are never slashed;
    - computed `width` and `height` are `${layout.chip}px`.
  - No chip has a visible word: `queryByText('Camera')` is null. AUTO stays a word chip, now 44 tall.
  - _Held_ has no chip (§3): exactly 3 elements named `/: (ready|not ready)$/`.
  - **Sequence (a call):** scene `paired-ready`, then `view.engine.setReady({ sound: false })` (the call), then `setReady({ sound: true })` (it ends). The mic chip's name goes "Mic: ready", then "Mic: not ready", then "Mic: ready". Its border goes lime, caution, lime.
  - "Starts {time}" is in the same row as the chips (`testID="chip-row"`), after them.

  Run red.

- [ ] **Step 3: Implement the chips.** Each `ChipView` is a `View`:
  - `accessible`, with the same `accessibilityLabel`;
  - style `{ width: layout.chip, height: layout.chip, borderWidth: 2, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center' }`, with the border lime or caution;
  - containing `<Glyph name={GLYPH[chip]} slashed={chip === 'camera' && !ok} tone={ok ? 'lime' : 'caution'} />`.

  `GLYPH` is `{ camera: 'camera', sound: 'mic', network: 'network' }`. The row is `chip-row` and carries the start time on its right (`marginLeft: 'auto'`).

- [ ] **Step 4: The icon row, test first** (`IconButton.test.tsx` and additions to `StreamScreen.layout.test.tsx`):
  - `IconButton`: role `button`, accessible name = `label`, computed `width` and `height` `${layout.iconButton}px`, border `ink3`, `onPress` called once per press.
  - Before air, the icon row's buttons in order are `Settings`, then `Home`.
  - On air (scene `live`), the order is `Settings`, then the _What viewers see_ button, which keeps its text, and no `Home`.
  - No button named `Diagnostics` exists in either state.
  - **Sequence (a second press):** pressing Settings twice navigates once. `useStreamLinks.settings` already guards this; assert `app.nav.history`, which shows one push.

  Run red, then implement:
  - `StreamColumn`'s icon row holds `<IconButton glyph="settings" label={t('stream.link.settings')} …/>`;
  - before air, when `canLeave`, `<IconButton glyph="home" label={t('stream.home')} …/>`;
  - on air, `ColumnPeek` with `flex: 1`.

  Remove `onDiagnostics` from `StreamScreen`, `StreamStage` and `StreamColumn`. Delete `stream.link.diagnostics` from the four dictionaries. `useStreamLinks.diagnostics` stays until Task 5.

- [ ] **Step 5: Scoped run, mutation, commit.**
  - **Mutation:** make `slashed={!ok}`, so every glyph is slashed when not ready. The "camera only" case must fail.
  - Run:
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/ui/components/PreflightChips.test.tsx src/ui/components/IconButton.test.tsx src/ui/screens/StreamScreen. src/ui/components/StreamColumn.test.tsx src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
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
- Modify:
  - `src/ui/screens/SettingsScreen.tsx`
  - `src/ui/screens/SettingsScreen.test.tsx`, including lines 218–223
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
  - Assert that `settingsDiagRows(...)`:
    - has exactly the Q1 rows, in the board's order;
    - carries `section` on the first row of each of Link, Delivery, Phone and Heartbeat, with the translated `diag.section.*` text, and `null` on every other row;
    - has 9 rows under Q1's recommendation (`expect(rows).toHaveLength(9)`, the anti-vacuity count);
    - has no Engine row.
  - Under Q1's alternative, the count is 20, and the "card does not scroll" test in Step 3 becomes "the card scrolls within itself". Write whichever the owner chose.
  - **Mutation:** drop one key from `SETTINGS_DIAG_ROWS`. The length and order assertion must fail.

- [ ] **Step 2: Implement** `settingsDiagnostics.ts`. It flattens the sections, keeps rows whose `key` is in `SETTINGS_DIAG_ROWS`, orders them by that list, and sets `section` on the first row of each section.

- [ ] **Step 3: Failing Settings tests** (`SettingsScreen.test.tsx`):
  - A card titled `Diagnostics` (`diag.title`) with a `Share record` button (`diag.share`) in its header row. Pressing Share calls `ports.share` once with the whole record. Count the lines shared against `record` length, not against a tail.
  - Its rows render section | item | value. Each row is a `View` with three `Text`s, `testID="diag-row"`, and `diag-row` count equals `settingsDiagRows(...)` length, so the anti-vacuity count is the domain's.
  - The rows tick: after `vi.advanceTimersByTime(1000)` with a changed bitrate, the Bitrate row shows the new value.
  - `session-record-lines` does not exist.
  - The dev scenes render only when `devTools` is true, as on Diagnostics today: move that case from `DiagnosticsScreen.test.tsx`.
  - Order, which also checks F2: the switch hints, the side radios, the power label and advice, then `Open-source licences`, then the Diagnostics card in portrait (`dataset.layout === 'portrait'`).
  - Landscape (Task 7 sets the window size; here, set `window.innerWidth = 844; window.innerHeight = 390` and dispatch `resize`): the screen root has `testID="settings-halves"`, with `flex-direction: row`. The settings `ScrollView` is the first half and the card is the second.
  - The card itself is not a `ScrollView`: `card.closest('[data-testid=diagnostics-card]')` has no scrolling ancestor inside the card. Whether it fits at 640 × 360 is Task 9.
  - Settings re-renders at most once a second while open. `DiagnosticsCard` holds `useDiagnostics()` itself, so the switches do not re-render on a tick. Assert it with a render counter, on the pattern of `StreamScreen.memo.test.tsx`.

  Run red.

- [ ] **Step 4: Implement, then remove the route.**
  - `DiagnosticsCard` (`testID="diagnostics-card"`, `memo`): a header row with `<Text variant="control">{t('diag.title')}</Text>` and `<GhostButton label={t('diag.share')} …/>`, the `shareFailed` line, the rows as a grid (`section` 84 dp wide, `label` `flex: 1`, `value` right-aligned in `metricValue`), then `<DevScenes />`.
  - `SettingsScreen`:
    - portrait: one `ScrollView`, with the current content and then `<DiagnosticsCard />`;
    - landscape: a row of two `flex: 1` halves. The current content goes in a `ScrollView`, and `<DiagnosticsCard />` goes in a plain `View`.
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
  - `src/hooks/useHome.ts`: `useScanRequest` goes, and `useTapTile` clears the card.
  - `src/hooks/usePorts.tsx`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts`: `homeIntent` becomes `endedNotice`.
  - `src/ui/screens/HomeScreen.tsx`
  - `src/hooks/useEngineFollow.ts`: its comment "their Stop stays on Ended".
  - `src/domain/mode/reopen.ts`: the comment "A permanent failure keeps its code and its Ended screen".
  - `src/i18n/budgets.test.ts`: the `stream.ended.scanAnother` row goes.
  - the four dictionaries
- Rewrite:
  - `src/ui/screens/StreamScreen.ended.test.tsx`
  - `src/ui/screens/HomeScreen.test.tsx:921,943`, the `homeIntent` cases

**Interfaces:**

```ts
// src/domain/session/endedCard.ts
import type { EndReason } from '@/domain/session/SessionState';
export type EndedCard = { readonly reason: EndReason; readonly durationMs: number | null };
export type EndedLines = {
  readonly time:
    { readonly kind: 'onAir'; readonly durationMs: number } | { readonly kind: 'neverLive' };
  readonly reason: 'stopped' | 'failed';
  /** Spec §5: only after the operator's own Stop; a fatal end keeps its code, so there is nothing to rescan. */
  readonly scanAgain: boolean;
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
  - `endedCard.test.ts`. The table is spec §5 plus D7, so 4 cases, with `expect(n).toBe(4)`:

  ```ts
  it.each([
    [
      { reason: 'operator-stopped', durationMs: 754_000 },
      { time: { kind: 'onAir', durationMs: 754_000 }, reason: 'stopped', scanAgain: true },
    ],
    [
      { reason: 'fatal-error', durationMs: 754_000 },
      { time: { kind: 'onAir', durationMs: 754_000 }, reason: 'failed', scanAgain: false },
    ],
    [
      { reason: 'operator-stopped', durationMs: null },
      { time: { kind: 'neverLive' }, reason: 'stopped', scanAgain: true },
    ],
    [
      { reason: 'fatal-error', durationMs: null },
      { time: { kind: 'neverLive' }, reason: 'failed', scanAgain: false },
    ],
  ] as const)('%o', (card, lines) => expect(endedLines(card)).toEqual(lines));
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
export function endedLines({ reason, durationMs }: EndedCard): EndedLines {
  return {
    time: durationMs === null ? { kind: 'neverLive' } : { kind: 'onAir', durationMs },
    reason: reason === 'operator-stopped' ? 'stopped' : 'failed',
    scanAgain: reason === 'operator-stopped',
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
  4. **Stop before the first frame → stays.** Scan to Paired, then `view.engine.forceState(...)`, using whatever the fake gives for a Stop before live. Re-pin the existing "a Stop before live (owner decision 1)" tests and keep them. Then:
     - the route is still `'stream'`;
     - no `Stream ended` region exists;
     - the viewfinder shows its neverLive state as today.
  5. **A second broadcast after OK → a fresh card.** Run case 1, press OK, scan the code again, go live, then `forceState({ kind: 'ended', reason: 'operator-stopped', durationMs: 61_000 })`. The card reads `On air 0:01:01` (worked by hand: 61 s is 0 h 01 min 01 s). `On air 0:12:34` is absent.
  6. **A second Stop.** In case 1, deliver the Ended snapshot twice, by `scene('stopped')` then `patch({})` before the flush. Then:
     - `app.nav.history.filter((r) => r === 'home')` gains exactly one entry;
     - the region appears once;
     - `modeStore.forget` resolves without a second write warning.
  7. **A new scan clears it.** After case 1, tap the Live Stream tile with the scanner queued to cancel. The region is gone.
  8. **A restart clears it.** After case 1, `cleanup()` and `launchApp()` again with the same KV seed. There is no region.
  9. **Never went live, on Ended (D7).** `forceState({ kind: 'ended', reason: 'fatal-error', durationMs: null })` from Paired goes Home with `Never went live` in place of the duration, and no scan-again line.

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
    useEffect(() => {
      if (reason === null) return;
      leaveWith(() => endedNotice.show({ reason, durationMs }));
    }, [reason, durationMs, leaveWith, endedNotice]);
  }
  ```

  - `StreamScreen` calls `useEndedToHome(leave.leaveWith)`. `useScanAnother` and the `onScanAnother` prop go.
  - `useViewfinder`: `ViewfinderAction = 'goLive' | 'stop' | 'none'`, with `ended: 'none'`. `ColumnAction` returns `null` for `'none'`, for the one frame before the leave.
  - `EndedCard` (`accessibilityRole="summary"` or a `View` with `aria-label={t('home.ended.title')}` and `role="region"`; re-pin what react-native-web 0.21 renders for each):
    - a header row: `<Text variant="state">{t('home.ended.title')}</Text>` and the time line in `metricValue`: `t('stream.ended.duration', { duration: formatElapsed(ms) })`, or `t('stream.ended.neverLive')`;
    - the reason in `body`: `stream.status.endedOperator` or `stream.status.endedFatal`;
    - when `scanAgain`, `stream.ended.scanAgain` in `metricUnit`;
    - `<GhostButton label={t('home.ended.ok')} onPress={endedNotice.clear} />`.
  - `HomeScreen`'s `HomeContent` renders `<EndedSlot />` after `StatusLine` and before `ContinueSlot`. `EndedSlot` reads `useEndedCard()`, and renders nothing for null.
  - `useTapTile` calls `endedNotice.clear()` beside `setPanel(null)`.
  - Copy: add `home.ended.title` and `home.ended.ok` (_Copy_) to all four dictionaries with the `_review` marker. Delete `stream.ended.scanAnother` and its budget row.
  - Rewrite the two comments. `useEngineFollow.ts`: "their Stop goes Home with the card, by StreamScreen's leave (spec §5)". `reopen.ts`: "A permanent failure keeps its code; the viewfinder then leaves for Home with the card (spec §5)".
  - Delete `EndedBlock.tsx`. `grep -a "EndedBlock\|scanAnother\|homeIntent\|requestScan\|takeScan"` must be empty across `src app test modules`.

- [ ] **Step 5: Mutations.**
  - **M1.** In `useEndedToHome`, drop `if (reason === null) return;`. Case 4 must fail: Paired would leave.
  - **M2.** In `useTapTile`, delete the `clear()` call. Case 7 must fail.
  - **M3.** In `endedLines`, `scanAgain: true`. Case 3 must fail.
  - **M4.** `useLeaveOnce`'s pending guard is existing behaviour, but case 6 depends on it. Disable it once and record whether case 6 fails. If case 6 stays green, the effect's own dependency list is what guards it. Name that in the commit body (AGENTS failure class 3: two guards, each mutated alone).

- [ ] **Step 6: Scoped run.**
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui src/domain/session/endedCard.test.ts src/services/endedNotice.test.ts src/ui/screens/StreamScreen. src/ui/screens/HomeScreen. src/hooks/useEngineFollow.test.tsx src/hooks/useStreamLeave.test.tsx src/hooks/useReopenGate.test.tsx src/domain/mode/reopen.test.ts test/fakePorts.test.ts test/routedApp.drift.test.ts src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  ```
  Then run typecheck, lint and format. Commit `feat(stream): the phone's Stop returns Home with a Stream ended card (spec §5)`.

## Task 7: The logo, a Home that turns, and Settings that turns (§7)

**Gates:** Q2 and Q3 answered.

**Files:**

- Copy: `/Users/ashokhein/github/seazn.club/apps/web/public/logo-wide-night.png` → `src/ui/assets/logo-wide-night.png`. Read the source; never write to that repo.
- Create:
  - `src/ui/assets/png.d.ts`
  - `src/ui/assets/logo.test.ts`
  - `src/services/native/nativeOrientationLock.test.ts`
  - `src/ui/screens/HomeScreen.layout.test.tsx`
- Modify:
  - `src/domain/orientation/orientation.ts` and its test
  - `src/hooks/useOrientationGate.ts` and its test
  - `src/hooks/engineSelectors.ts`: `selectBroadcastHeld`.
  - `src/services/native/nativeOrientationLock.ts`
  - `src/services/devicePorts.ts`: `OrientationLockPort.lock(target: Target)` now accepts `free`, through `Target`.
  - `src/ui/screens/HomeScreen.tsx`
  - `src/ui/components/HomeFooter.tsx`
  - `src/ui/theme/tokens.ts`: `layout.logo` and `layout.logoLandscape`.
  - the four dictionaries: `brand`.

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

- [ ] **Step 2: Rotation, pure, failing first** (`orientation.test.ts`):
  - `routeTarget`: `/stream` → `landscape`; `/stream/settings` → `free`; `/` → `free`. That is 3 cases.
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
- `routeTarget`: `pathname === '/stream' ? 'landscape' : 'free'`.
- `useOrientationGate(target)` selects the holding fact by target:
  - `target === 'free'` uses `useEngineSelector(selectBroadcastHeld)` (Q3's answer). Under Q3's alternative this is `selectHoldsOrientation`, and the 32-case oracle's "holding" means paired or live;
  - otherwise it uses `selectHoldsOrientation`.

  Call both selectors unconditionally (rules of hooks) and pick between them.

- `selectBroadcastHeld = (s) => selectEngineStatus(s) === 'live'`, at module scope.
- `nativeOrientationLock`: `free` → `OrientationLock.DEFAULT`, `portrait` → `PORTRAIT_UP`, `landscape` → `LANDSCAPE`. Write it as a `Record<Target, OrientationLock>`.
- `nativeOrientationLock.test.ts` mocks `expo-screen-orientation` with `{ lockAsync: vi.fn(), OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 3, LANDSCAPE: 5 } }`. These numbers are the module's own enum (`expo-screen-orientation/build/ScreenOrientation.types`); re-read them from `node_modules` before writing. Assert each target's call. That is 3 cases.
- `useOrientationGate.test.tsx`: Home (`/`) while idle locks `free` and shows no card. Home after leaving a live broadcast that just ended locks `free`, which retires R35's "Home in landscape" card case: amend that test's expectation and cite §7. Settings while live keeps the viewfinder's landscape lock, with no `lock` call.
- **Mutations:**
  - in `freeGate`, `current === null` only, without `|| current === 'free'`. The remote-Go-live sequence must fail;
  - in `orientationGate`, `fromFree` set to `false`. The "leaving free while paired" cases must fail.

- [ ] **Step 4: Home turns, failing first** (`HomeScreen.layout.test.tsx`):
  - In a helper, set the window: `window.innerWidth = w; window.innerHeight = h; window.dispatchEvent(new Event('resize'))`. Then `renderWithPorts(<HomeScreen />)` and read `screen.getByTestId('home').dataset.layout`.
  - Portrait (390 × 844), in DOM order: the logo (`getByLabelText('Seazn Club')`, computed `width` `200px`, `height` `70px`), the status line, the ended card (when shown, through `ports.endedNotice.show(...)`), Continue, the three tiles (`testID="tiles"`, `flex-direction: column`), then the footer: Language, then version.
  - Landscape (844 × 390): `testID="home-top"`, a row holding the logo (Q2's size, computed), the status line, the Language picker and the version, in that order. Then the ended card, as one row (`flex-direction: row`). Then `tiles` with `flex-direction: row`, holding 3 tiles. There is no footer after the tiles.
  - **The same controls in both** (AGENTS: a control-set diff, never box sizes). Collect `getAllByRole('button').map(name)` plus the logo's label in each layout. They are equal in membership and order, apart from the footer moving to the top. State the expected order as a literal list from the spec's layout description, not from the code.
  - Run red. Then implement in `HomeScreen`:
    - `const { width, height } = useWindowDimensions(); const layout = screenLayout(width, height);`
    - the root `View` gets `testID="home"` and `dataSet={{ layout }}`;
    - the logo is `<Image source={logo} accessibilityLabel={t('brand')} accessibilityRole="image" style={layout === 'landscape' ? styles.logoLandscape : styles.logo} />`, replacing `<Text variant="title">{t('brand')}</Text>`;
    - in landscape, logo, status and `HomeFooter`'s two parts sit in `home-top`. `HomeFooter` gains a `layout` prop and renders inline in the top row in landscape, and as today in portrait;
    - `EndedSlot` and `ContinueSlot` stay where Task 6 put them;
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

  | en                             | es                  | fr                 | nl               | Note                                              |
  | ------------------------------ | ------------------- | ------------------ | ---------------- | ------------------------------------------------- |
  | Stream ended (Home card title) | Emisión terminada   | Direct terminé     | Stream beëindigd | The broadcast nouns, as above.                    |
  | OK (button)                    | Aceptar             | OK                 | OK               | es: Android's own button word.                    |
  | Mic not available (blocker)    | Micro no disponible | Micro indisponible | Geen microfoon   | nl: _niet beschikbaar_ overruns the blocker's 24. |

  Then run `cd "$WT" && pnpm i18n:release-check; echo "EXIT=$?"`. It must exit 0.

- [ ] **Step 2: AGENTS.md, as the spec rules it.** Edit only these passages:
  - **§1, line 61.** The five-screen list becomes "**Scan** → **Paired** → **Live** (HUD) → **Settings**, with Diagnostics as a card inside Settings (2026-10-06 design follow-up §6)".
  - **§6, lines 214–222.**
    - "everything else is portrait (ruling 4)" becomes "Home and Settings follow the phone; Settings keeps the lock while a broadcast is held (2026-10-06 design follow-up §7, amending ruling 4)".
    - Keep the turn-card text for the viewfinder.
  - **§6, lines 226–230.** Replace "Full-bleed preview…" with: "The viewfinder is two halves (design follow-up §1): a 16:9 camera box with the status strip below it, and the controls half. Nothing is drawn over the camera box but the overlay and the _What viewers see_ video. Advisory text rides the status strip, under the status line."
  - **§6, lines 248–250.** "audio above the level floor" becomes "the mic available (a silent room is ready; design follow-up §4)".
  - **§6, lines 251–262.** "Settings and Diagnostics stay reachable…" becomes "Settings, with its Diagnostics card, stays reachable in every state, live included". Keep the rest of the paragraph's reasoning.
  - **§10, line 340.** "Assert an audio **level floor**, never stream presence" stays for the meter and the pipeline. Append: "Readiness is not the level: a silent room is ready (design follow-up §4)."
  - Then run `pnpm prettier --check AGENTS.md docs/i18n-glossary.md docs/superpowers/plans/2026-10-06-s1-design-pr-a.md`.

- [ ] **Step 3: The PR's scoped gate.** Run every vitest file named in Tasks 1 to 7, in one command, with the JSON reporter, and paste the counts: total, failed, and the file list.
  - Run the Gradle filters from Task 1, and `:host:test`.
  - Run the `bridge` project.
  - Run `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm format:check` and `pnpm i18n:release-check`.
  - Never `pnpm check`, never `pnpm test` (F4).
  - Run each command three times if any one of them was ever red in this branch, because flaky-shaped reds recur.
  - Commit `docs: AGENTS.md and the glossary as the design follow-up rules them; translation review`.

## Task 9: Device verification (the owner's hands)

This task is a checklist for the owner. An agent never simulates it, infers it, or ticks it. The orchestrator hands it over after Task 8, and the owner's results are recorded beside each line, with a screenshot of the app only.

**The build:** the owner's local release build of this branch, as AGENTS §11 has it. Never EAS.

- [ ] **1. Fit at the smallest landscape.**
  - On the owner's phone, or an emulator at 640 × 360 dp, look at the viewfinder before air, not ready, with the longest not-ready line in each of en, es, fr and nl.
  - Then look at it on air.
  - Nothing is clipped and nothing scrolls. Record the phone's dp size and its font scale.
- [ ] **2. The §2 label cases.** Show each of the seven labels from Task 2 on a staging fixture, or through dev scenes if one carries a label.
  - Each one wraps or ellipsises as §2 says, and nothing is clipped.
  - Also try one case at the phone's largest font scale, and note what happens there. Font scale is not covered by Q4's arithmetic.
- [ ] **3. The camera box.**
  - The preview is 16:9, edge to edge across its half.
  - The overlay and the _What viewers see_ video sit inside the box only.
  - _Controls on the left_ mirrors the halves.
- [ ] **4. A silent room.**
  - In a quiet room the mic chip is lime and Go live enables.
  - On air in silence for a minute, the line stays _Live_.
  - A phone call on air shows the mic-silenced warning. When the call ends, the warning clears.
- [ ] **5. Stop after live.**
  - Go live, hold Stop. The app lands on Home with the _Stream ended_ card: title, _On air_ time, _You stopped the broadcast._, the scan-again line, and OK. This must be observed, not inferred.
  - OK clears it.
  - Go live again, stop again: a fresh card with the new time.
- [ ] **6. Diagnostics in Settings.**
  - Portrait and landscape.
  - The card does not scroll at the phone's size.
  - Share record opens the share sheet.
  - There is no Diagnostics button anywhere.
- [ ] **7. Rotation.**
  - Home turns with the phone, provided auto-rotate is on, and stays put when it is off. Record which.
  - Settings turns while paired, per Q3. After a rotation in Settings, Back to the viewfinder: the preview is upright and landscape.
  - Settings while live does not turn.
  - The viewfinder never turns.
- [ ] **8. Logo.** The logo is sharp at 200 × 70 in portrait, at Q2's size in landscape, and TalkBack reads it as "Seazn Club".
- [ ] **9. Locales.** Repeat 1, 5 and 6 in es, fr and nl: screenshots of each.

Any line that fails is a finding for the orchestrator. It is never a change made on the device run.

## Self-review

- **Spec coverage.**
  - §1 is Task 3.
  - §2 is Task 2, rendered by Task 3, with clipping checked in Task 9 (2).
  - §3 is Task 4.
  - §4 is Task 1. Its four owed JVM tests are `S4 a room silent…`, `S4 sixty seconds…`, `S4 a call…` and `S4 on air…`, and the predicate is mutated in M1 to M3.
  - §5 is Task 6. Its five owed tests are cases 1 to 5, and cases 6 to 9 are its sequences and D7.
  - §6 is Task 5.
  - §7 is Task 7.
  - The spec's _Verification_ is Task 8 (3) and Task 9, minus `pnpm check` (F4).
- **Sequence cases owed by the brief:**
  - a second Stop: Task 6, case 6;
  - OK then a new broadcast: Task 6, case 5;
  - a call starting and ending: Task 1 (`S4 a call…`, twice), Task 4 (the mic chip) and Task 3 (the strip's line).
- **Anti-vacuity.** Every table or sweep states its count: the 60 s sweeps, the 7 label cases, the 6 chip cases, the 9 rows (or 20), the 4 ended lines, the 32 rotation cases, the 3 route targets and the 5 layout cases.
- **Unresolved, by design:**
  - Q1 to Q4 are the owner's.
  - Font scale above 1.0 is not covered by any fit arithmetic (Task 9, item 2).
  - Whether Android's `UNSPECIFIED` respects a user who has turned auto-rotate off is Task 9, item 7.
- **Placeholders:**
  - The _Owner answers_ lines are empty on purpose, and filled before Task 1.
  - `Q4_DOUBLES` in Task 2 is a literal the owner's answer fixes.
  - The "re-pin" notes mark line numbers and fake APIs that must be read before editing (AGENTS failure class 5). They are not open design.
