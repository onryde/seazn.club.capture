# S1 design follow-up, PR C: the scorer code and the round line

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, one task per implementer (model sonnet), one reviewer pass per task, in the order below. Steps use checkbox (`- [ ]`) syntax for tracking. **Nothing starts until PR A and PR B have merged and the orchestrator has put Q-C2 (under _Owner questions_) to the owner and written the answer into _Owner answers_.** Task 8 builds on Q-C2. **Task 9 is skipped** (controller ruling RQ-C3 on Q-C3, under _Owner answers and controller rulings_): no other task depends on it. Tasks 2, 3, 4, 5, 6, 8 and 10 also build on the controller rulings R-F3, R-F5, R-F18 and R-F20 (same section), which the owner may overturn; the orchestrator puts those to the owner too, as recommendations. This plan was re-pinned on 2026-10-08 against PR B's head `a9079cf` by the re-pin rulings RP1 to RP10 (same section), which are the controller's, not the owner's.

**Goal:** Ship spec §10 and the "Round line" bullet of §2 as one pull request:

- a Remote scoring button and QR on the camera phone, the QR drawn by the app with the Seazn logo in the centre at error correction H, shown on a tap and hidden after 10 s or on _Hide_;
- the round line, a small grey line above the match label, shown verbatim from the descriptor's `stage.label` when the descriptor's `stage.role.kind` is one the contract names;
- the contracts re-vendored at the web's `7e75fd4a7`;
- ~~a staging-only way to force one RTMPS session, for the owner's device run.~~ **Dropped (RQ-C3): Task 9 is skipped.** The web lane's owner runs the forced-RTMPS test themselves, so the app carries no forcing machinery.

**Architecture:**

- The scoring link is fetched by **native**, on the path `POST start` already takes: `BridgeCore.ask` over `Platform.http`, with the pairing's `tok` and the phone id, neither of which JS holds. The URL crosses the bridge once, as the resolved value of a new Expo `AsyncFunction("scoringLink")`: the bridge's second answering call, after PR B's `takePhoto`. The answer goes point-to-point to the one caller that asked, into memory in a hook. There is no event, no request id and no listener fan-out, and no new backstop: `BridgeCore.ask`'s own backstop is the native bound, and JS gives up first, at 12 s, and drops a late answer. The URL never enters a snapshot, the session record, a beat, a saved code or a store. The call stays **off the machine's failure path** (RP4): whatever it throws, including an `Error` the scheduler would classify as a permanent failure, is answered `unavailable` and never reaches `GuardedScheduler`'s `failed`.
- The round line rides the waiting fields. The descriptor's `stage.label` is read by `Bodies.read` (Kotlin) and `parseWaitingFields` (TS) only when `stage.role.kind` is in the closed set the contract names (15 values, one shared file, `wire/stage-kinds.json`). It is seeded through the pair intent like `venueTimezone`, and kept across beats only while the match label is unchanged.
- The QR is `qrcode-generator` at level H, drawn with `react-native-svg` at a whole number of dp per module, with the web's own knock-out geometry. A `jsqr` decode of the rasterised painted path, logo area filled adversarially, proves the symbol still reads.

**Tech Stack:** Expo SDK 57, React Native 0.86.3, TypeScript strict, vitest projects `domain`, `ui`, `types`, `bridge`, `react-native-svg`, Kotlin core (JDK 17, `allWarningsAsErrors`), new: `qrcode-generator` (dependency), `jsqr` (dev dependency).

**Spec:** `docs/specs/2026-10-06-s1-design-followup-design.md` §10 (Scorer code) and the "Round line" bullet in §2, read at the worktree's HEAD `2460d1a`. Also PR A's plan `docs/superpowers/plans/2026-10-06-s1-design-pr-a.md` (Task 3, Task 4, Global Constraints), whose strip arithmetic and icon row this PR extends, and PR B's plan `docs/superpowers/plans/2026-10-07-s1-design-pr-b.md` (Task 1 and Task 2), whose `takePhoto` call, `photoPort`, shutter and icon-row arrays this PR copies the shape of. Contracts: the web repo at merge commit `7e75fd4a7` (`docs/contracts/capture-{descriptor,start,scoring-link,beat}.v1.json`).

**Sources, in authority order:** the spec; the contracts at `7e75fd4a7`; the owner's answer to Q-C2; the controller rulings below (until the owner answers them); this plan's _Plan decisions_.

## Global Constraints

Every task's requirements include this section. The first block is the owner's, verbatim.

- The QR shows on a tap, auto-hides after 10 s or on Hide, and has no screenshot block.
- Never screenshot a scanned code's raw value or a QR.
- The scoring URL is a scoring credential: never logged, never in the session record, never in a beat.
- Scoped tests only; never `pnpm check`, `pnpm test` or a full vitest.
- Never run EAS.
- Agents use model sonnet.
- Copy goes in 4 locales with `_review` markers.
- StyleSheet uses tokens only.
- Every new guard gets one named mutation.
- The final task is a device checklist for the owner's hands, and it includes ONE forced-RTMPS session (SRT off) against staging ingest live.cloudflare.com:443, whose session id is reported to the web lane.

_Controller note on the last bullet (2026-10-08, from the dispatch; not the owner's words and not a change to the bullet):_ the web lane's owner runs the SRT-off test themselves, so the device run needs no SRT flip on the web side and no ping to the web lane. The operator sends them any session id from an RTMPS device pass (Task 11 item 12). Task 9, the app-side flag that would force one, is skipped on the same ground (RQ-C3), so this PR adds no way to force RTMPS and item 12 asks only for a session id.

Carried from PR A's Global Constraints, unchanged unless marked:

- **Worktree.** A new branch `feat/s1-scorer-code` in a new worktree off `main` after PRs A and B have merged. Call it `$WT`. Put `cd "$WT" &&` in every command. Run `pnpm install --frozen-lockfile` once, before Task 1. Never a bare `git stash`. To back up a file for a mutation, `cp` it to `"$TMPDIR"` and restore it from there, never with `git checkout`.
- **The base is PR B as merged.** This plan is written against PR B's landed shape: a sixth `GlyphName`, `shutter`; the icon row `[Settings, Home, Take photo]` before air and `[Settings, Take photo, What viewers see]` on air; the photo line in `controls-gap`; `Ports.photo` and `FakePorts.photo`; `nativePorts.ts` taking the module once as `native`; the module's `AsyncFunction("takePhoto")` with `import expo.modules.kotlin.Promise`; `HostModule.takePhoto` and `FakeNativeModule.takePhoto`; and AGENTS §2's recorded exception for `takePhoto`. Re-pin every file and line this plan names against the merged tree before editing it (AGENTS failure class 5). The numbers below were re-pinned on 2026-10-08 against PR B's head `a9079cf` (RP1); if PR B merged with other edits, re-pin again.
- **The web repo is read-only.** `/Users/ashokhein/github/seazn.club` is only read: `git -C /Users/ashokhein/github/seazn.club show 7e75fd4a7:<path>` and `cp` out of its working tree. Nothing is written there.
- **Secrets.** Never log, print, screenshot or commit a code's raw value, a `tok`, an SRT passphrase or stream id, an RTMPS key, or a scoring URL. Test fixtures are made up: the scoring secret in every test is the made-up `dl_` plus 43 characters named `TEST_SECRET` in Task 5's vectors, `SCORING_SECRET` in the JVM host (Task 5) and `FAKE_SCORING_SECRET` in the TS fake (Tasks 6 to 8), never a real one.
- **Layering** is enforced by lint (`eslint-plugin-boundaries`): `src/domain` stays pure; `ui` reaches native only through `Ports` and imports services as types only; a hook may import services.
- **Styling.** `StyleSheet.create` only, never an inline style object. Every colour, size and gap comes from `src/ui/theme/tokens.ts` or `type.ts`. New sizes become tokens.
- **Tests.** Every task's new tests fail without its change: run them once before the change and record the red count. Expected values come from the spec, the contracts or the engine's own declarations, never from the code under test. No snapshot tests. Every sweep states its count with an anti-vacuity `expect(count).toBe(N)`. Every new guard is mutated once and a named test must fail. Sequence cases are owed: a second tap, a hide then a re-open, a refusal then a success, a rate limit then its end, a late answer after the deadline or after a Hide.
- **Scoped verification only.** Never `pnpm test`, `pnpm check`, a bare `pnpm vitest run`, or an unfiltered `./gradlew test`. The `bridge` project runs with its one file named: `CAPTURE_BRIDGE=1 pnpm vitest run --project bridge modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts`. `pnpm typecheck` and `rtk proxy pnpm lint` and `pnpm format:check` stay allowed.
- **Counting JS tests** (rtk prints `PASS(0) FAIL(0)` for a suite that failed to collect):
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui <files…> --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
  ```
  Positional paths are substring filters: confirm every printed `name` is a file you meant, and the `.json` mtime is from this run.
- **Counting Kotlin tests:**
  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests '<FQCN>' … > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"\| failures="[0-9]*"' build/test-results/test/*.xml | sort | uniq -c
  ```
  The JVM host's own tests (`ProtocolTest`, `ScriptedServerTest`) run with `./gradlew :host:test --tests '<FQCN>'`.
- **Copy.** Every operator-visible string is in all four dictionaries (`src/i18n/{en,es,fr,nl}.json`), from the _Copy_ table. **None of the four dictionaries carries a `_review` key at `a9079cf`** (RP8), so there is nothing to keep: the task that adds or changes es, fr or nl copy **adds** `"_review": "pending translation review"` to each of es, fr and nl that it touched, for those new or changed keys, and **never to en** (`pnpm i18n:release-check` refuses a dictionary that carries it, which is why Task 8 runs without that check). Task 10 runs the review pass and clears the markers it finds. The glossary binds: es tú, fr vous, nl je; a colon, never a dash, in es, fr and nl status lines; French U+00A0 before `:` `;` `?` `!`; straight apostrophes; sentence case; the screens never say QR (say "code" or "link").
- **Commits.** One commit per task, `git add` by path, never `-A`. The message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never write an `owner/repo#N` reference. Nothing is pushed by an implementer.

## Review Focus

Most likely first. Each line has its test in the task that owns the code.

1. **A stable code is re-pointed at the next match, and the round line goes stale.** The stage is read at the scan and at the descriptor GET at Go live. A beat carries no `stage` (the beat contract is unchanged) but does carry the match `label`. After a beat moves the label, the old match's round line under the new match's label is a wrong fact on the tripod. The reasonable expectation: no line, never the old one. Task 2 keeps the stage across a beat only while the label is the one the stage was read with, and drops it otherwise. Cost, named in Q-C4: between matches on one paired code the line is absent until the next Go live.
2. **The URL leaking through a side door.** `url` is on the record's public-URL list, so a line written under `url` passes the scrub unless the secret is protected. Task 5 protects the secret in the native record before the answer is handed to the caller, and Task 6 does the same in the JS logger before the port resolves, in a bucket of its own that is capped (16) and deduplicated by value so a long session of taps never grows the masks, and never evicts the pairing token. Expected: the URL's secret appears in no record line, no snapshot, no beat body, no saved code, no `toString`, whether it is written under `url` or inside a `message`.
3. **A second tap, a hide, then a tap, and a late answer.** A tap while the first is in flight, a Hide before the answer, an answer after the Hide, an answer after the 12 s deadline, and a tap after a rate limit. Expected: one request in flight at a time; an answer that arrives after a Hide or after the deadline is dropped, never shown; a rate limit blocks taps until its `Retry-After` has passed.
4. **A refused phone.** `replaced` (another phone took the slot), `code_ended`, `match_finished` and `not_entitled` are different sentences, and none of them shows a QR or a stale one. Task 8 drives each word through the real hook.
5. **A bad answer shown as a QR.** A 200 whose `url` is off the build's host, is not `https`, or has a short secret. Expected: nothing shown, "Can't reach Seazn". Task 5 (native) and Task 6 (JS) both hold it, each mutated alone.
6. **The logo knocks out modules the decoder needs.** Task 7 decodes the rasterised painted path with `jsqr`, once with the logo area white and once filled adversarially, at both environments' URL lengths, and holds the painted string equal to the closures it was built from.
7. **A long, odd, or absent round line.** 40 characters of any script, an emoji, a label of 41 characters, an empty one, a stage with an unknown `role.kind` (no line, even with a good label: R-F20), a stage with no `role`, and no `stage` at all. Task 2 and Task 3 sweep them.
8. **The round line on a long double.** With no new strip reserve (R-F5), the strip is 180 dp at every real geometry, so the line hides whenever the label takes three or four lines. Task 4 derives the strip from `cameraBoxSize` over the four real geometries and holds the hide and the show on both sides of the boundary.
9. **A fourth cell in the on-air icon row.** Settings, Take photo and Remote scoring leave the peek button 120 dp, and its label wraps to two lines in all four languages while its reason wraps to two in es and nl. Task 8 measures both with the shipped fonts and holds the controls half inside the screen (the on-air total is 320 of 360, with PR B's photo line in it).
10. **A tap that throws ends the broadcast.** `BridgeCore.ask` catches only `Exception`, so an `Error` out of the transport (an `UnsatisfiedLinkError` from a missing TLS library) or out of the caller's own resolver would reach `GuardedScheduler`'s `failed`, which holds a `LinkageError` against the process and ends the pairing fatal-error, mid-match, from a tap on a side button (RP4). Expected: the tap answers `unavailable`, the pairing stays `paired`, `taskFailures` stays 0 and `stickyFailure` stays false, one `scoring-link` line names the class, and the 16 s backstop that `ask` leaves armed adds no second answer or line. Task 5's `ScoringTap` and its four failure-path tests, mutated alone (m) to (s); Task 6's `scoringLinkPortFor` makes the same call safe on the JS side (a stale module without `scoringLink` is `unavailable`, not an exception).

## Owner questions (ask before Task 1)

The orchestrator puts these to the owner as recommendations with reasons, never as rulings. Each answer goes into _Owner answers_ with the date, committed with the plan before Task 1. (Q-C1, the round line and the strip, is now the controller ruling R-F5 below; the owner may still overturn it.)

**Q-C2. Where the QR shows (gates Task 8).** The canvas has no board for it, so the spec's "a button … shows a QR" leaves the place open.

- _Recommendation:_ a panel that **covers the camera half** (the 16:9 box and the strip): 320 × 360 at the smallest phone, a title, a **171 dp** square QR (3 dp a module on the 57-unit symbol, R-F7), one hint line, a 48 dp _Hide_. The controls half stays visible and live, so **Stop is never covered**. The preview is hidden for at most 10 s; capture and the broadcast are untouched. _Alternative:_ over the controls half, which would cover Go live and Stop. Not recommended.
- The button is a 48 dp icon in the icon row, named _Remote scoring_ (R-F18), present while a pairing is held: Paired and on air, before and during live.

**Q-C3. Forcing RTMPS for the owner's one device session (gated Task 9). SETTLED by the controller, not asked: RQ-C3 (below) skips Task 9, because the web lane's owner runs the forced-RTMPS test themselves. The text below is kept for the record, and for the day the owner asks for the flag after all.** There is no app switch today and no build flag (see _Code facts_, fact 10). Two ways:

- _Recommendation:_ a **staging-only build flag**, `EXPO_PUBLIC_FORCE_RTMPS=1`, set on the owner's local build. Native then keeps only the RTMPS target of the descriptor, and refuses to honour the request on a production pairing. About 20 lines across JS and Kotlin; Task 9. The web lane needs nothing from this: its owner runs their own SRT-off test and is sent any RTMPS session id afterwards.
- _Alternative:_ no app change; the web lane turns `STREAM_SRT_ENABLED` off on staging for the run, so `cred.srt` is null and `preferred` is `rtmps` (`Bodies.kt:188-194` already handles it). This changes staging for everyone during the run, and needs the web lane in the loop on the day. The controller note under Global Constraints says the web lane is not to be pinged, so this is only for an owner who asks for it.

**Q-C4. The round line between matches on one paired code (information, not gating).** The stage is fresh at the scan and at Go live only. If the owner wants it refreshed on every beat, the web adds `stage` to the beat answer's waiting fields, a beat-contract change the web lane has not made (the beat sha is unchanged at `7e75fd4a7`). This PR does not ask for it. The plan's behaviour until then is Review Focus 1.

## Owner answers and controller rulings

**Owner answers.** _To be filled by the orchestrator before Task 1, one line per question: the answer, the date, and the owner's words._

- Q-C2: _pending_
- Q-C3: _not put to the owner_. The controller ruled it away (RQ-C3 below: Task 9 is skipped). This line is not an owner answer; if the owner wants the app-side flag, Task 9's text below is the plan for it.

**Controller rulings (2026-10-08).** The controller made these so the plan could be written. They are **not** the owner's answers (AGENTS recurring failure class 17). The orchestrator puts each to the owner as a recommendation; if the owner overturns one, the cost line below says what moves. Each is applied in the tasks named.

- **R-F3. `scoringLink` is an `AsyncFunction` that answers its caller, like PR B's `takePhoto`.** No `onScoringLink` event, no request id, no listener fan-out, no new 16 s backstop machinery; the URL goes point-to-point to the caller that asked. JS gives up at 12 s and drops a late answer. AGENTS §2's recorded exception becomes "two calls answer: `takePhoto` (PR B) and `scoringLink` (PR C)". _Cost:_ none known, and less code. _If overturned:_ Tasks 5 and 6 go back to an event with ids and a backstop, and Task 10's AGENTS text changes to name an upward event. Tasks 5, 6, 10.
- **R-F5. The round line yields to the camera box, and no strip reserve is added.** PR A's camera box and its 180 dp strip stay as ruled. The line shows when the strip has room for it beside the label and hides when it does not. By the arithmetic of `cameraBoxSize` over the four real geometries the strip is 180 dp at every one of them, so the line is hidden whenever the label takes three or four lines (long doubles), at 360 dp tall and at the other three. _Cost:_ no round line in that case. _If overturned:_ the owner picks a reserve (a taller strip takes box height) or a clipped last line, which is PR A's declined options; Task 4's yield and its arithmetic change. Task 4, Task 11 item 3.
- **R-F18. The button is named _Remote scoring_,** the desktop fixture page's name (spec §10). It is the same word as the panel's title, so the button's accessible name is the title key and there is no separate `open` key. The glossary no longer claims that _Not on your plan_ is "the same words the web shows"; the spec names the sentence, and Task 10 records only that. _Cost:_ the word _scoring_ appears on the button and again as the panel's title. _If overturned:_ the owner names it; one copy key changes in four locales. Task 8, Task 10.
- **R-F20. An unknown `role.kind` shows no round line, even with a good label.** This follows the contract (one authority): the `role.kind` description says consumers show nothing for an unknown kind, and lists today's 15. The app holds the 15 in one shared file that both readers are tested against. _Cost:_ a new kind the web adds shows nothing until the app learns it. _If overturned:_ the owner accepts showing the server's label for any kind; Task 2 and Task 3 drop the kind check and the shared file. Task 2, Task 3.
- **RQ-C3. Task 9 is skipped.** The web lane (r1-laned, 2026-10-08) says its owner runs the forced-RTMPS test themselves, so the app needs no forcing machinery, and the owner wants this simple. _Cost if wrong:_ the flag is added in a later PR; Task 9's text stays below, marked skipped, as the plan for that. Nothing else depends on it: Task 11's build line, item 8 and item 12 no longer do (RP9), the scrub-kind count stops at 84, and Task 10's gate list stops at Task 8. Task 9, Task 10, Task 11.

**Re-pin rulings (controller, 2026-10-08), against PR B's head `a9079cf`.** RP<n> is the n-th ruling in `pr-c/repin-rulings.md`. They are the controller's, applied so the plan matches the tree PR C will be built on; they are not the owner's words. Each says where it landed.

- **RP1. Line and number re-pins** (the numbers in _Code facts_, the File map and the tasks): `StreamScreen.layout.test.tsx` icon-row tests `:350`, `:370`, `:387` and the Ended array `:403` (so the old `:350-393` is `:350-404`); `CaptureEngineModule.kt` `core` `:12`, `Events` `:16`, `send` `:31`, `tail` `:35`, `takePhoto` `:36-37`, `View` `:40`, fact 8 `:14-35`, and the new call goes after `:37`; `engineSelectors.ts` `selectLabel` `:81-82`, `selectHeld*` `:113-115`, `selectDelivery` `:65-66`; the selector test builder is `snapshot(state, overrides, { pairing })` at `:38` with `FAKE_PAIRING` (there is no `snapshotWith` and no `basePairing`); AGENTS §2 `:91-96`, §6 `:238-245`; `FakeNativeModule.takePhoto` `:34-40`, `hostEngine.ts` `takePhoto` stub `:72-75`, `bounded` `:133`, the line switch `:160`; the scrub `kinds` count is 83, so 84, with `scoring-link` between `resumed` and `scripted`; `budgets.test.ts` takes its new rows after `stream.photo.(saved|failed)` (`:33`) and `WIDEST` (`:40`) gets `seconds: '300'` after `duration`. Tasks 2 to 6, 8, 10.
- **RP2. `StreamColumn.test.tsx` has no icon-row arrays** (they are `StreamScreen.layout.test.tsx`'s). It takes three edits or `tsc` goes red: `onScoringLink` in `ICONS` (`:13-17`), `scoring` in `viewOf` (`:20-40`), and `onScoringLink` in the hand-built `column()` helper (`:132-140`), which does not spread `ICONS`. Task 8.
- **RP3. `nativePorts` never gets the inline port back.** It keeps `photo: photoPortFor(native)` (`:88`) and gains `scoringLink: scoringLinkPortFor(native, { logger, hosts })`, a pure function beside `photoPortFor`, with stub-native tests and the `wiringOf` AST pin extended to require it with the same `native` and still exactly one load. Task 6.
- **RP4. `scoringLink` stays off the machine's failure path.** Any throw, in the transport, the reading, the protection, or the caller's own resolver, answers `unavailable` and never reaches `GuardedScheduler`'s `failed` (`BridgeCore.kt:43`, `:487-490`), where a `LinkageError` would end the pairing fatal-error for the process. Task 5.
- **RP5. AGENTS §2 names exactly two calls,** `takePhoto` and `scoringLink`, each with its own bound; PR B's `takePhoto` wording stays verbatim; "a shorter one in JS" is dropped; "neither runs on the machine's failure path" stays, and is true only with RP4. Task 10.
- **RP6. Every "the one call that answers" claim is reworded:** `CaptureEngineModule.kt:36`, `Capture.kt:45`, `nativeModule.ts:13` and `:25`, `usePorts.tsx:69`, `photoPort.ts:3`, the spec §8 sentence (`docs/specs/2026-10-06-s1-design-followup-design.md:162`), and `StreamStage.tsx:30` ("It keeps no buttons", stale once Hide joins the camera half). Tasks 5, 6, 8, 10.
- **RP7. The fit numbers:** the on-air controls half is 320 dp (PR B's 16 dp photo-line item is in it); `scoringFit` (A) stacks that same 16 (`typeScale.metricUnit.lineHeight`), not 0; the shown code panel is 321 dp of 360 with the code at 171 dp, the largest whole multiple of 57 that fits. Task 8.
- **RP8. `_review`:** none exists at `a9079cf`; a task that adds or changes es, fr or nl copy adds it to those files only, never to en. Global Constraints, Task 8, Task 10.
- **RP9. Task 11:** the build line, item 8 and item 12 no longer depend on Task 9; item 12 is "send r1-laned any session id from an RTMPS device pass"; item 9 never asks for a screenshot with the code up (the owner's rule), it scans the code with a second phone's camera and confirms the scoring pad opens; item 2 adds a viewer-video z-order check. Task 11.
- **RP10. The fourth icon narrows the on-air peek cell from 176 to 120 dp,** so its label wraps to two lines and the es and nl reason to two. Measured, fits, accepted. _Plan decisions_ D16.

## Code facts (verified against the worktree at `adb7f5f`, re-pinned at `a9079cf` (PR B's head) where RP1 says so, and the web repo at `7e75fd4a7`)

Re-pin every line number before editing: PR B's merge may have moved them again (AGENTS failure class 5). RP1 lists the cites that were re-pinned at `a9079cf`; any other cite below is at `adb7f5f` and was not re-checked line by line, so the executor re-pins it before editing.

1. **Contracts are vendored under `test/fixtures/contracts/`**, not `contracts/` (whose README still says nothing is vendored, and is stale). Pinned by sha256 in `modules/capture-engine/src/serverBodies.test.ts:17-21` (`PINNED`, at web `5bb72e8a2`), hashed in the test at `:60-62` (the controller's brief said `:63-65`; the tree at `adb7f5f` has `:60-62`; re-pin). `.prettierignore:7-8` keeps them byte for byte. The files today: `capture-beat.v1.json`, `capture-descriptor.v1.json`, `capture-start.v1.json`. The scoring-link contract is new. That test also sweeps `wire/server-bodies.json` (`:64-70`, "all 7 bodies, PairWire four and the host three").
2. **`Bodies.kt` is `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/adapter/Bodies.kt`.** `WAITING_KEYS` is at `:109` (`label, autoAllowed, pollSeconds, venueTimezone, scheduledStart, destinationName, overlayUrl`), `WAITING_OWED` at `:106`. `read()` at `:133-146` returns `WaitingRead(WaitingFields(...), null)` or names the first refused field. `waiting()` at `:130` serves the waiting descriptor (`code()` at `:174`), `broadcast()` at `:225` serves the open shapes. `beatWaiting()` at `:149-153` treats a beat as owing the waiting fields when its state requires them or when it sends any `WAITING_KEYS` key. **`stage` is not in `WAITING_KEYS` and must not be**: a bad stage is display-only and never makes the waiting fields unreadable.
3. **How a field reaches JS:** `WaitingFields` (`core/Pairing.kt:114-132`, with `over()` at `:127` and `UNKNOWN` at `:131`) → `PairingState.waiting` → `PairingView` (`core/Snapshot.kt:147`, `core/Projection.kt:32`) → `SnapshotWire.pairing()` (`adapter/SnapshotWire.kt:43-58`) → JS `toPairing()` (`modules/capture-engine/src/snapshotWire.ts:251-273`) → `PairingInfo` (`src/domain/session/Pairing.ts:30-45`) → selectors in `src/hooks/engineSelectors.ts` (`selectLabel` at `:81-82` at `a9079cf`, `selectDelivery` `:65-66`, and the three scalar `selectHeld*` at `:113-115`). Beats merge with `over()` at `core/SessionMachine.kt:623`; a descriptor merges at `core/Pairings.kt:120`.
4. **Stage is NOT in the beat answer.** At pairing, `Pairings.pair` (`core/Pairings.kt:33`) seeds `WaitingFields.UNKNOWN.copy(venueTimezone = input.request.venueTimezone)` from the scan's JS `GET code`. That is the only pre-air carrier, so the stage label is seeded the same way (Task 2, Task 3).
5. **Two readers of one descriptor:** JS `parseWaitingFields` (`src/domain/credentials/waitingFields.ts:77-102`) at the scan, and Kotlin `Bodies.read` at Arming. One vector file pins both: `modules/capture-engine/src/wire/waiting-vectors.json` (29 rows today: 26 read by Kotlin, 27 by JS, 3 `jsOnly`, 2 `kotlinOnly`, 19 unreadable among JS's), run by `modules/capture-engine/src/waitingVectors.test.ts` (counts at `:13-16`) and `BodiesTest.kt` (`:25` 29 rows, `:52` 26 read, `:53` 2 beats).
6. **`tok` lives in native for every call after the scan.** JS reads it from the saved code (`src/domain/mode/savedCode.ts`, parsed by `parseStreamCodeText`) only to build the pair intent (`src/hooks/usePairing.ts:25-40`) and for the scan's `GET code` (`src/services/fetchCodePort.ts:93-96`). Native holds `PairRequest.token` (`core/Pairing.kt:140-147`; `toString` masks it at `:181`).
7. **`POST start` is native:** `Pairings.kt:313` builds `Command.PostStart(id, pairing.request.startUrl, pairing.token, Beats.startBody(pairing.phone.phoneId))`; `adapter/BridgeCore.kt:342` runs `ask({ HttpRequests.start(command) }) { report(HttpAnswers.start(command.requestId, it)) }`; `adapter/Http.kt:70-73` builds the request (`Bearer`, `Content-Type`, `Cache-Control: no-store`); `BridgeCore.ask` is at `:389-404` and answers once. **Its backstop is `ANSWER_BACKSTOP_MS = 2 × HttpRequests.TIMEOUT_MS = 16 000 ms`** (`BridgeCore.kt:499`); **8 s is the OkHttp request timeout** (`Http.kt:50`), not the backstop. `HttpRequest.toString` (`Http.kt:17-20`) prints no URL, bearer or body. **JS does not know the phone id** (`fetchCodePort.ts:83`: "G0-d: the phone id is native's"; `grep phoneId src` finds nothing), and the scoring-link body is `{phone}`. So the scoring-link call must be native; a JS `fetch` could not build its body.
8. **The bridge today carries intents down and snapshots up:** `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/CaptureEngineModule.kt:14-35` at `a9079cf` (`private val core get() = EngineHost.core(app())` at `:12`, `Events("onSnapshot", "onRecord", "onAck")` at `:16`, `Function("send")` at `:31`, `Function("tail")` at `:35`, then PR B's `AsyncFunction("takePhoto")` with its comment at `:36-37` and the `View` at `:40`; the new call goes after `:37`); `modules/capture-engine/src/nativeModule.ts:15-27` (the module's TS surface, "every call returns void or a value read at once" at `:13`, which PR B amended for `takePhoto`, whose doc says "the one call that answers" at `:25`); AGENTS §2 (the section is `:78-100`: "JS receives a ~1 Hz state snapshot. That is the entire upward contract", "Commands are intents, not RPC", and PR B's recorded `takePhoto` exception at `:91-96`, ending "It is the only such call."). PR B made the first call that answers (`AsyncFunction("takePhoto")`); this PR adds the second, `scoringLink`, in the same shape, so Task 10 amends AGENTS §2's exception to name exactly those two (RP5), and Tasks 5, 6, 8 and 10 reword every "the one call that answers" PR B wrote (RP6).
9. **The record scrub:** `modules/capture-engine/src/scrub/allow-list.json` (one source for `SessionRecord.kt:235` `NEVER` and `src/services/scrub.ts:91` `NEVER_KEYS`; `url` is on `publicUrl`, `message` on `text`, `kinds` lists every record kind), parity vectors in `scrub/vectors.json` run by `ScrubParityTest.kt` and `src/services/scrubParity.test.ts`. `SessionRecord.protect(secrets, …)` (`core/SessionRecord.kt:91`) is additive and masks a value everywhere, URLs included; its `adding` (`:103-104`) already deduplicates by value. JS `logger.protect({secrets, streamIds})` (`src/services/logger.ts:39-46`) **concatenates with no dedupe**. `note` is not an allowed record key (it is masked whole), so a leak test that writes the secret under `note` proves nothing: use `message` (masked by value) and `url`. `BridgeCore.record` is private to `BridgeCore.kt:45`; `BridgeCore.log` (`:221`) writes synchronously through `engine.log`.
10. **RTMPS cannot be forced from the app today** (Task 9 would have added a way; it is skipped, RQ-C3, so this stays true after this PR). `grep -rniE 'force.?rtmps|rtmps.?only|srt.?off'` over `src`, `modules`, `app`, `*.gradle` finds nothing in app code. RTMPS-only happens only when the server sends `cred.srt: null` with `preferred: "rtmps"` (`Bodies.kt:188-194`, amendment A18), which is the web's `STREAM_SRT_ENABLED` flag (spec `2026-10-01-s1-amendment-stable-code-design.md:34`, `:654`). The only app-side dev gates are `__DEV__` and the fake-engine variables `EXPO_PUBLIC_FAKE_ENGINE` and `EXPO_PUBLIC_FAKE_CODE` (`src/hooks/nativePorts.ts:50-52`, `:64-67`), and `chooseEngine` honours the fake only in dev. The ingest host is `live.cloudflare.com` for both environments (amendment `:36`).
11. **No QR library is installed** (`package.json:25-61`). `react-native-svg` 15.15.4 is (`:49`). The web's one QR helper is `apps/web/src/lib/seazn-qr.ts` (EC `H`, icon fraction 0.22, quiet zone 4, knock-out of the smallest odd square holding the icon plus a 1-module pad) over `qrcode`; its icon is `apps/web/public/icons/icon-192.png` (sha256 `f757f37875068e3f6620ce4638797e2baa4ce6ac96030d755ca2ed6f828237d2`, 32 KB). The owner's rule: every QR carries the Seazn logo in the centre, at EC H. `qrcode` itself is the node/browser package; this plan uses the zero-dependency `qrcode-generator` so Metro needs no polyfill.
12. **The app already recognises the link:** `src/domain/mode/recognise.ts:38` reads `/score/<token>` into `{ mode: 'scoring' }`. "One QR format" (spec §10) is therefore already true on the scanner side; this PR draws what that scanner reads.
13. **The JVM host is how the real Kotlin core is driven from vitest,** and a new native call is invisible to the `bridge` project until the host speaks it. `host/Host.kt:54-56` dispatches the stdin ops (`send`, `log`, `script`, `readiness`, `quiet`, `exit`); `host/ScriptedServer.kt` answers three paths (`PATHS` at `:108`, `path()` at `:47-53`) with default bodies that are `wire/server-bodies.json`'s `host/` rows, each held to a contract by `serverBodies.test.ts` (ajv) and to the Kotlin default by `ScriptedServerTest.kt` (`m-4`); `host/Protocol.kt` encodes the events; `test/hostEngine.ts:51` (`HostModule implements CaptureEngineNative`, `HostLine` at `:32-37`, PR B's rejecting `takePhoto` stub at `:72-75`, the `bounded` helper at `:133`, the line `switch` at `:160`) turns host lines into module events; `FakeNativeModule.ts:11` is the other implementer (its `takePhoto` is at `:34-40`). `scriptFor` in `test/serverScript.ts` maps the kit's server words to `beat` and `start` scripts only.
14. **The strip is 180 dp at every real geometry.** `cameraBoxSize` (`src/ui/theme/cameraBox.ts`) sizes the box against `STRIP_RESERVE` = 180, so on 640 × 360, 800 × 360, 844 × 390 and 915 × 412 (`viewfinderFit.test.ts` `GEOMETRIES`) the box is `height - 180` wherever the half is wide enough, and the strip gets exactly 180. Only a screen that does not exist (a 640-wide, 412-tall one) has more.
15. **The on-air icon row's gap is `space.sm` = 8** (`StreamColumn.tsx` `iconRow`: `gap: space.sm`), not `layout.controlsGap` (12). The peek button is `minHeight 48`, `paddingHorizontal space.sm`, a `layout.iconBorder` (1) border; its label is `actionSecondary` (Barlow Condensed 600, 16, line 19, letterspacing 0.6, uppercase) and its reason `metricUnit` (Geist 500, 12, line 16).

## Plan decisions

- **D1. Native fetches; the URL is the resolved value of one call.** `BridgeCore.scoringLink(answer: (Map<String, Any?>) -> Unit)` asks and calls `answer` once with `{outcome, url?, retryAfterS?}`; the Expo module is `AsyncFunction("scoringLink") { promise: Promise -> core.scoringLink { promise.resolve(it) } }`; JS awaits it with a 12 s deadline and drops a late answer (R-F3). The URL is in no `Snapshot`, no `RecordEntry` and no `Command` (`Command.toString` and `HttpRequest.toString` already print lengths only).
- **D2. The scoring-link body is `Beats.startBody(phoneId)`**, the same `{phone}` as `/start`; the URL is the pairing's `codeUrl` plus `/scoring-link` (`PairRequest.problems()` pins `codeUrl` to the code's own URL on the build's host, `core/Pairing.kt:167`).
- **D3. Outcome words** (native to JS, a closed set): `ok`, `code_ended`, `replaced`, `match_finished`, `not_entitled`, `rate_limited`, `unavailable`. Everything else, `no_destination`, `no_credit`, `invalid`, an unconfirmed 401, a 5xx, a timeout, a body that is not the server's, a pairing that is gone, is `unavailable`. A 404 `not_a_stream_code` is `code_ended` (the same operator action: scan again).
- **D4. The phone shows the stage label only, and only for a role kind the contract names** (R-F20). `code`, `role.n`, `role.entrants` and `pool` are not read: the server renders the whole line (spec §2). The stage is read when `stage.role.kind` is a string in the 15 values of `wire/stage-kinds.json` and `stage.label` is 1 to 40 characters; a stage with an unknown kind, no `role`, or a kind that is not a string shows nothing, even with a good label. This is the contract's own rule ("Consumers show nothing for an unknown kind"), held in one shared file that Kotlin and TS are each tested against, and that is itself tested against the contract's description.
- **D5. A bad `stage` never fails the descriptor.** It is display-only: any malformation, including a null, a non-object, an unknown kind, a label of 0 or over 40 characters, reads as no stage, and the rest of the waiting fields are read as ever.
- **D6. Stale-stage rule (Review Focus 1).** `WaitingFields` carries `stageLabel` and `stageFor` (the match label it was read with). A descriptor sets both; a beat's answer keeps them only while its label equals `stageFor`. The pair intent seeds both from the saved waiting fields (`stageLabel`, `stageMatch`). In JS the saved waiting fields keep `stage: { label, kind }` (both or neither), so a saved copy reads back through the same parser, including the kind rule.
- **D7. The QR panel is its own state machine in one hook** (`useScoringLink`): `hidden`, `asking`, `shown`, `refused`. One request in flight; an answer after a Hide is dropped by a request token, not by timing; an answer after the port's deadline never arrives (the port resolved `unavailable`).
- **D8. Auto-hide is 10 000 ms from the moment the QR is shown** (not from the tap), cleared on Hide, unmount, the app leaving the foreground, and a change of the held pairing's name.
- **D9. No screenshot block.** The plan adds no `FLAG_SECURE`, no `expo-screen-capture`, and Task 8 pins their absence. The owner's rule is the other half: nobody screenshots a QR (Task 11).
- **D10. A QR is drawn from a pure plan.** `seaznQrPlan(text)` returns the version, the module count, the path and the logo square. The component only paints a plan. Tests read the plan, and the decode test rasterises the plan's **painted path string** (the exact `d` the component paints), then holds it equal to the closures it was built from.
- **D11. Link secrets have a bucket of their own** (Review Focus 2): at most 16, deduplicated by value, newest kept, in both `SessionRecord` and the JS logger. A general cap would evict the pairing token, so the cap is on this bucket only. A link evicted after 16 re-issues is long revoked (an organiser's _Revoke & reissue_ is the only thing that changes it).
- **D12. The round line has no reserve** (R-F5). `stageFits` decides on the strip's measured height and the label's measured height, and the strip is 180 at the real geometries (fact 14).
- **D13. The QR is drawn at a whole number of dp per module** (R-F7, R-F8): `layout.qrSize` is the largest whole multiple of the 57-unit symbol (49 modules + 2 × 4 quiet) that fits the 360 dp panel with the title, the hint, _Hide_, the padding, the gaps and at least 4 dp of slack, so every module edge lands on a pixel and no `shapeRendering` is needed.
- **D14. `scoringLink` is off the machine's failure path** (RP4). `BridgeCore.scoringLink` runs on the guarded scheduler, whose `failed` (`BridgeCore.kt:43`, `:487-490`) treats a `LinkageError` as a permanent failure and ends the pairing fatal-error for the process (`Failures.permanent`). A tap must never do that: `ask` catches only `Exception`, so an `Error` out of the transport, the reading, the protection or the caller's own resolver would have. One small class, `ScoringTap` (`adapter/ScoringLinks.kt`), hands the caller its answer at most once, and runs each stage of the call in `apart { … }`, which turns any `Throwable` (a dead caller's included) into one `scoring-link` record line per throw (the class name only) and the answer `unavailable`; its `spent` flag stops the backstop that `ask` leaves armed after an `Error` from writing a second line for the same tap. AGENTS §2 says "neither runs on the machine's failure path" because of this (RP5).
- **D15. The scoring-link port is wired by a pure function, like the photo port** (RP3). `nativePorts.ts` keeps `photo: photoPortFor(native)` and gains `scoringLink: scoringLinkPortFor(native, { logger, hosts })`; the inline `createPhotoPort(native === null ? …)` is never restored, and `createScoringLinkPort` is never called inline there. `scoringLinkPortFor` (`src/hooks/scoringLinkPortWiring.ts`) is tested with a stub native; the composition root, which no test renders, is held by the `wiringOf` AST pin in `photoPortWiring.test.ts`, extended to require the call with the same `native` and still exactly one `loadCaptureEngineNative`.
- **D16. The fourth icon narrows the on-air peek cell, and that is accepted** (RP10). On air the icon row is Settings, Take photo, Remote scoring and What viewers see: the peek cell is 176 dp at 640 with three cells and **120 dp** with four. Its label therefore wraps to two lines in all four languages and its reason to two lines in es and nl. This was measured with the shipped fonts (Task 8, `scoringFit.test.ts` (A)) and it fits; it is not a defect, and Task 11 item 3 records what the phone shows.

## Copy

New keys (en is the source; es, fr, nl are drafts carrying `_review` until Task 10: Task 8 adds the marker, since none exists at `a9079cf`, and never to en; RP8). No string contains "QR" (glossary). The button's accessible name is `stream.scoring.title` (R-F18): there is no separate `open` key.

| key                                    | en                                  | es                                                  | fr                                           | nl                                             |
| -------------------------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `stream.scoring.title`                 | Remote scoring                      | Anotación remota                                    | Score à distance                             | Scoren op afstand                              |
| `stream.scoring.hint`                  | Scan with any phone camera          | Escanea con la cámara de cualquier móvil            | Scannez avec l'appareil photo d'un téléphone | Scan met de camera van een telefoon            |
| `stream.scoring.hide`                  | Hide                                | Ocultar                                             | Masquer                                      | Verbergen                                      |
| `stream.scoring.asking`                | Getting the link                    | Obteniendo el enlace                                | Récupération du lien                         | Link ophalen                                   |
| `stream.scoring.code`                  | Remote scoring code for this match  | Código de anotación remota de este partido          | Code de score à distance pour ce match       | Code voor scoren op afstand van deze wedstrijd |
| `stream.scoring.refused.codeEnded`     | This code has ended. Scan it again. | Este código ha terminado. Escanéalo de nuevo.       | Ce code est terminé. Scannez-le de nouveau.  | Deze code is beëindigd. Scan hem opnieuw.      |
| `stream.scoring.refused.replaced`      | Another phone has this camera now.  | Otro móvil tiene esta cámara ahora.                 | Un autre téléphone a cette caméra.           | Een andere telefoon heeft deze camera nu.      |
| `stream.scoring.refused.matchFinished` | This match is finished.             | Este partido ha terminado.                          | Ce match est terminé.                        | Deze wedstrijd is afgelopen.                   |
| `stream.scoring.refused.notEntitled`   | Not on your plan                    | No está en tu plan                                  | Pas dans votre offre                         | Niet in je abonnement                          |
| `stream.scoring.refused.rateLimited`   | Try again in {seconds} s            | Inténtalo en {seconds} s                            | Réessayez dans {seconds} s                   | Probeer het over {seconds} s opnieuw           |
| `stream.scoring.refused.unavailable`   | Can't reach Seazn. Try again.       | No se puede conectar con Seazn. Inténtalo de nuevo. | Seazn est injoignable. Réessayez.            | Seazn is niet bereikbaar. Probeer het opnieuw. |

The round line has no key: it is the server's text, shown verbatim.

Budgets (Task 8 adds them to `src/i18n/budgets.test.ts`): `^stream\.scoring\.title$` at 20 (an icon button's label, like PR B's `stream.photo.label`; the lengths are 14, 16, 16, 17), `^stream\.scoring\.refused\.` at 56, `^stream\.scoring\.(hint|asking|code)$` at 48, `^stream\.scoring\.hide$` at 14, and `WIDEST.seconds = '300'`. Placement (RP1, `a9079cf`): the new rows go right after `stream.photo.(saved|failed)` (`budgets.test.ts:33`), and `WIDEST` (declared `:40`) gets `seconds: '300'` after its `duration` entry (`:44`).

## File map

| area                                                            | files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts                                                       | `test/fixtures/contracts/capture-{descriptor,start,scoring-link,beat}.v1.json`, `modules/capture-engine/src/serverBodies.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Stage, native                                                   | `…/adapter/Bodies.kt`, `…/core/Pairing.kt`, `…/core/Pairings.kt`, `…/core/SessionMachine.kt`, `…/adapter/PairMapping.kt`, `…/adapter/SnapshotWire.kt`, `wire/waiting-vectors.json`, `wire/pair-intent-vectors.json`, `wire/snapshot-vectors.json`, `wire/stage-kinds.json` (new), Kotlin tests                                                                                                                                                                                                                                                                                                                                                                         |
| Stage, JS                                                       | `src/domain/credentials/waitingFields.ts`, `src/domain/session/Pairing.ts`, `src/domain/session/stageLine.ts` (new), `src/hooks/usePairing.ts`, `modules/capture-engine/src/{CaptureEnginePort,intentWire,snapshotWire,FakeCaptureEngine}.ts`, `src/hooks/engineSelectors.ts`, `modules/capture-engine/src/stageKinds.test.ts` (new)                                                                                                                                                                                                                                                                                                                                   |
| Strip                                                           | `src/ui/theme/tokens.ts`, `src/ui/theme/stageFit.ts` (new), `src/ui/components/{StageLine,StatusStrip,MatchLabel}.tsx`, `src/ui/components/StatusStrip.stage.test.tsx` (new), `src/ui/theme/viewfinderFit.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Scoring link, native                                            | `…/adapter/{Http,ScoringLinks (new, with `ScoringTap`),BridgeCore}.kt`, `…/core/SessionRecord.kt`, `…/android/src/main/java/…/CaptureEngineModule.kt` (the call after `:37`; the comment at `:36`), `…/android/src/main/java/…/capture/Capture.kt` (a comment, `:45`), `scrub/allow-list.json`, `wire/scoring-link-vectors.json` (new), `wire/host-vectors.json`, `wire/server-bodies.json`, `…/adapter/GlueRulesTest.kt`                                                                                                                                                                                                                                              |
| Scoring link, host harness                                      | `…/host/{Host,ScriptedServer,Protocol}.kt`, `…/host/src/test/…/{ProtocolTest,ScriptedServerTest}.kt`, `test/hostEngine.ts`, `test/hostEngine.test.ts`, `modules/capture-engine/src/{NativeCaptureEngine.bridge.test,hostVectors.test}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Scoring link, JS                                                | `modules/capture-engine/src/nativeModule.ts`, `modules/capture-engine/src/testing/FakeNativeModule.ts`, `src/services/scoringLinkPort.ts` (new, with its test), `modules/capture-engine/src/scoringLinkBodies.test.ts` (new), `test/fakeScoringLinkPort.ts` (new), `src/services/logger.ts`, `src/services/photoPort.ts` (a comment, `:3`), `src/hooks/{usePorts.tsx,nativePorts.ts}`, `src/hooks/scoringLinkPortWiring.ts` (new, with its test), `src/hooks/photoPortWiring.test.ts` (the `wiringOf` pin, extended), `test/fakePorts.ts`                                                                                                                              |
| QR                                                              | `package.json`, `pnpm-lock.yaml`, `src/ui/assets/seazn-qr-logo.png` (new, with `qrLogo.test.ts`), `src/domain/qr/seaznQr.ts` (new, with its test), `src/ui/components/SeaznQr.tsx` (new, with its test), `src/ui/theme/tokens.ts` (`qrGround`), `test/setup-ui.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| Panel and button                                                | `src/hooks/useScoringLink.ts` (new, with its test), `src/hooks/useViewfinder.ts` (+ `useViewfinder.scoring.test.tsx`, new), `src/ui/components/{ScoringLinkPanel (new, with its test),Glyph,StreamColumn,StreamStage}.tsx`, `src/ui/components/{Glyph,IconButton,StreamColumn}.test.tsx` (`StreamColumn.test.tsx`: `ICONS`, `viewOf` and the hand-built `column()`, RP2), `src/ui/screens/StreamScreen.tsx`, `src/ui/screens/{StreamScreen.scoring.test.tsx,noScreenshotBlock.test.ts}` (new), `src/ui/screens/StreamScreen.layout.test.tsx`, `src/ui/theme/{tokens.ts,scoringFit.test.ts (new),viewfinderFit.test.ts}`, `src/i18n/*.json`, `src/i18n/budgets.test.ts` |
| RTMPS switch (Task 9, SKIPPED: RQ-C3; no file below is touched) | `src/hooks/{nativePorts,engineWiring,usePorts,usePairing}.ts(x)`, `test/fakePorts.ts`, `modules/capture-engine/src/{CaptureEnginePort,intentWire}.ts`, `…/core/{Pairing,Pairings,Answers}.kt`, `…/adapter/PairMapping.kt`, `scrub/allow-list.json`, `NativeCaptureEngine.bridge.test.ts`                                                                                                                                                                                                                                                                                                                                                                               |
| Docs                                                            | `AGENTS.md` (§2 and §6), `docs/i18n-glossary.md`, `docs/specs/2026-10-06-s1-design-followup-design.md` (§8, one sentence, `:162`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Task 1: Re-vendor the contracts at `7e75fd4a7`

**Files:**

- Modify: `test/fixtures/contracts/capture-descriptor.v1.json`, `test/fixtures/contracts/capture-start.v1.json`, `modules/capture-engine/src/serverBodies.test.ts`
- Create: `test/fixtures/contracts/capture-scoring-link.v1.json`
- Unchanged, re-verified: `test/fixtures/contracts/capture-beat.v1.json`

**Interfaces:**

- Produces: the four contract files byte for byte, pinned by sha256; `PINNED` in `serverBodies.test.ts` lists four files. Later tasks validate bodies against `capture-scoring-link.v1.json#/$defs/ok` and `#/$defs/refusal`.

- [ ] **Step 1: Write the failing pin.** In `modules/capture-engine/src/serverBodies.test.ts`, replace the comment and `PINNED` (`:16-21`) with:

```ts
/** The web repo's contracts at 7e75fd4a7, pinned by sha256 (PR C Task 1; beat unchanged since 5bb72e8a2). */
const PINNED = {
  "capture-beat.v1.json":
    "e14329132400d45cd38e03b19cf85189fe35acb0b8b9a51e7ca98879fe07c736",
  "capture-descriptor.v1.json":
    "45fc9ad71f763ed0d34e654b729e4103e3d47c82fd6af1e9e46cc3ad5ef5ed55",
  "capture-scoring-link.v1.json":
    "f0f1188655f3ca83b3e42ce7fedd6f6210a3a141b0bcf02fa250eb2448b1c85f",
  "capture-start.v1.json":
    "012d6e3851e84d0ce659ad23449fa91b61f0d20cfac1e58f2ccbc7cbb0742bae",
} as const;
```

In the test `it('sweeps all 7 bodies…')` nothing changes. Add one count so a dropped file cannot pass:

```ts
it("pins exactly 4 contracts", () => {
  expect(Object.keys(PINNED)).toHaveLength(4);
});
```

- [ ] **Step 2: Run red.**

```bash
cd "$WT" && pnpm vitest run --project domain modules/capture-engine/src/serverBodies.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

Count with the JSON recipe. Expected red: the descriptor and start pins mismatch, and the scoring-link file does not exist (the suite may fail to collect: that counts as red, read the log).

- [ ] **Step 3: Copy the contracts.** Only reads on the web repo.

```bash
W=/Users/ashokhein/github/seazn.club
for f in descriptor start scoring-link beat; do
  git -C "$W" show 7e75fd4a7:docs/contracts/capture-$f.v1.json > "$WT/test/fixtures/contracts/capture-$f.v1.json"
done
cd "$WT/test/fixtures/contracts" && shasum -a 256 capture-*.v1.json
```

Expected, exactly: descriptor `45fc9ad7…ed55`, start `012d6e38…bae`, scoring-link `f0f11886…1c85`, beat `e1432913…c736`. If any differs, stop: the web moved, and the orchestrator re-pins with the web lane.

- [ ] **Step 4: Read the diff, record it.** `git -C "$WT" diff --stat -- test/fixtures/contracts`. Expected in the commit body: start gains `match_finished` in its refusal enum; descriptor gains `stage` on all six `oneOf` branches; scoring-link is new; beat is unchanged. Then `grep -a -n "5bb72e8a2" modules/capture-engine/src modules/capture-engine/android/core/src -r` and for each hit that says "copied from the web repo at 5bb72e8a2" change the SHA to `7e75fd4a7` only where it describes the contract files (the `about` strings of `wire/server-bodies.json` and `wire/pair-intent-vectors.json`); leave history comments alone.

- [ ] **Step 5: Run green, then the suites that read the contracts.**

```bash
cd "$WT" && pnpm vitest run --project domain modules/capture-engine/src/serverBodies.test.ts modules/capture-engine/src/waitingVectors.test.ts modules/capture-engine/src/streamCodeVectors.test.ts src/hooks/pairIntentWire.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

Expected: all green (the schema only gained an optional field; the made-up bodies stay valid). Then `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm prettier --check modules/capture-engine/src/serverBodies.test.ts modules/capture-engine/src/wire`.

- [ ] **Step 6: Mutation (named): `contract pin`.** Change one byte of `capture-scoring-link.v1.json` (add a space). `serverBodies.test.ts` `capture-scoring-link.v1.json is the pinned copy` must fail. Restore from the `cp` backup.

- [ ] **Step 7: Commit** `chore(contracts): vendor the web contracts at 7e75fd4a7 (stage, scoring-link, match_finished)`.

---

## Task 2: The stage label in native (Kotlin)

**Files:**

- Create: `modules/capture-engine/src/wire/stage-kinds.json`
- Modify (under `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/`): `core/Pairing.kt:114-132` and `:140-152`, `core/Pairings.kt:33` and `:120`, `core/SessionMachine.kt:623`, `adapter/Bodies.kt`, `adapter/PairMapping.kt`, `adapter/SnapshotWire.kt:43-58`
- Modify (vectors): `modules/capture-engine/src/wire/waiting-vectors.json`, `wire/pair-intent-vectors.json`, `wire/snapshot-vectors.json`
- Modify (the sweeps that count the vector files, F11): `modules/capture-engine/src/waitingVectors.test.ts:13-16`, `modules/capture-engine/src/snapshotWire.test.ts:216` (and its `EXPECTED` map), `…/src/test/kotlin/com/seazn/capture/engine/adapter/BodiesTest.kt:25`, `:52` and the `expected` builder at `:40-50`, `…/adapter/SnapshotWireTest.kt:229` (and its `builders` map)
- Test: `…/src/test/kotlin/com/seazn/capture/engine/adapter/{BodiesTest,PairIntentVectorsTest,SnapshotWireTest}.kt`, `…/core/PairingTest.kt`, `…/core/Configs.kt` (the `WaitingFields(` call at `:89` takes the new defaults; no edit unless it uses positional args past `pollSeconds`)

**Interfaces:**

- Produces (Kotlin): `WaitingFields(…, pollSeconds, stageLabel: String? = null, stageFor: String? = null)`; `WaitingFields.overBeat(held): WaitingFields`; `PairRequest(…, venueTimezone = "", stageLabel: String? = null, stageMatch: String? = null)`; the snapshot wire's `pairing.stageLabel: String?`; `Bodies.STAGE_KINDS` (internal).
- Wire (JS to native, Task 3 writes it): pair intent keys `stageLabel` and `stageMatch`, each a string, both optional.
- Shared authority: `wire/stage-kinds.json`, `{ "about": …, "kinds": [15 strings] }`, the contract's own list (R-F20, D4).

- [ ] **Step 1: Vectors first (they are the contract between the two languages).**

`wire/stage-kinds.json`, in the contract's order. The contract's `role.kind` description at `7e75fd4a7` lists these, and Task 3's `stageKinds.test.ts` holds this file to that description, so the list is never typed from memory:

```json
{
  "about": "The values of capture-descriptor.v1 stage.role.kind that the contract names (its description lists them and calls the string OPEN). A stage with any other kind, or none, shows no round line: the contract says consumers show nothing for an unknown kind. Read by Bodies.kt and waitingFields.ts, each tested against this file; this file is tested against the contract (stageKinds.test.ts). Change only with all three.",
  "kinds": [
    "round_of",
    "quarter_final",
    "semi_final",
    "final",
    "winners_final",
    "losers_round",
    "losers_final",
    "grand_final",
    "grand_final_reset",
    "third_place",
    "qualifier1",
    "eliminator",
    "qualifier2",
    "rung",
    "plain_round"
  ]
}
```

In `wire/waiting-vectors.json` append these **12** rows to `cases`, after the last row. Each is shaped as the descriptor's waiting branch with the made-up values of the first row: copy that row's `fields` and `expected` as the base, add `stage` to `fields`, and add `stageLabel` to `expected` (`null` unless stated). Every existing row whose `expected` is not `null` also gains `"stageLabel": null`, so the file's rows stay uniform; a row whose `expected` is `null` stays `null`.

| `why`                                                                    | `fields.stage`                                                                            | `expected.stageLabel` |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------- |
| `stage: a label with a known kind`                                       | `{"code":"QF","role":{"kind":"quarter_final"},"label":"QF"}`                              | `"QF"`                |
| `stage: the 40-character label`                                          | `{"code":"R2","role":{"kind":"plain_round","n":2},"pool":"A","label":"` + 40 × `x` + `"}` | the 40 characters     |
| `stage: 40 characters counted as code points`                            | `role` `{"kind":"final"}`, label = 39 × `x` + `🏏`                                        | the same string       |
| `stage: a 41-character label reads as no stage, the rest stays readable` | `role` `{"kind":"final"}`, label = 41 × `x`                                               | `null`                |
| `stage: an empty label`                                                  | `{"code":"QF","role":{"kind":"quarter_final"},"label":""}`                                | `null`                |
| `stage: no label`                                                        | `{"code":"QF","role":{"kind":"quarter_final"}}`                                           | `null`                |
| `stage: null is no stage`                                                | `null`                                                                                    | `null`                |
| `stage: not an object`                                                   | `"QF"`                                                                                    | `null`                |
| `stage: an unknown role kind with a good label shows NOTHING (R-F20)`    | `{"code":"X1","role":{"kind":"a_future_kind"},"label":"X1"}`                              | `null`                |
| `stage: no role shows nothing`                                           | `{"code":"QF","label":"QF"}`                                                              | `null`                |
| `stage: a role kind that is not a string shows nothing`                  | `{"code":"QF","role":{"kind":7},"label":"QF"}`                                            | `null`                |
| `stage: absent`                                                          | (no key)                                                                                  | `null`                |

Every such row keeps the rest of `expected` readable (not `null`). **Update the counts that sweep the file (F11), reading each before you edit it:**

| where                                                                     | today | becomes                               |
| ------------------------------------------------------------------------- | ----- | ------------------------------------- |
| `waitingVectors.test.ts:13` title and `:14` `vectors.cases`               | 29    | 41                                    |
| `waitingVectors.test.ts:15` `rows` (the file minus the `kotlinOnly` rows) | 27    | 39                                    |
| `waitingVectors.test.ts:16` unreadable rows among them                    | 19    | 19 (the 12 new rows are all readable) |
| `BodiesTest.kt:25` `cases.length()`                                       | 29    | 41                                    |
| `BodiesTest.kt:52` rows Kotlin reads (the file minus `jsOnly`)            | 26    | 38                                    |
| `BodiesTest.kt:53` Kotlin-only beat rows                                  | 2     | 2                                     |

and in `BodiesTest.kt:40-50` the `expected` builder gains the two new constructor arguments: `if (e.isNull("stageLabel")) null else e.getString("stageLabel")`, and `stageFor` = the row's `label` when `stageLabel` is non-null, else `null`. Also fix the comment at `:24`, "The file's rows: 29, of which 3 are JS's alone", to say 41.

In `wire/pair-intent-vectors.json` add `"stageLabel": "QF", "stageMatch": "Example Town v Sample CC"` to the **first** intent's `wire` only, leaving the second without them (an intent without a stage is the common case). In `PairIntentVectorsTest.kt` assert for each row that `request.stageLabel` and `request.stageMatch` equal the sent keys or null, and keep both counts (`2`).

In `wire/snapshot-vectors.json` add `"stageLabel": null` to `pairingBase` and add one case (a 15th) whose `pairing` override is `{"stageLabel": "QF"}`. Update the file's case-count assertions: `snapshotWire.test.ts:216` (`toHaveLength(14)` and the test's title "each of the 14 cases") → 15, and add the new case's name to its `EXPECTED` map (the test also checks `Object.keys(EXPECTED)` equals the case names); `SnapshotWireTest.kt:229` (`assertEquals(14, cases.size, "the vector file's fourteen cases")`) → 15, and add a builder for the new case's name to the `builders` map (`:230` checks `builders.keys` equals the case names). Both of those sweeps already compare every case, so the new case is judged by the existing loops.

- [ ] **Step 2: Failing Kotlin tests.** In `BodiesTest.kt` add (the vector rows are swept by the existing sweep once `WaitingFields` carries the field; add the sequence rules and the kinds parity by hand):

```kotlin
  @Test
  fun `a descriptor's stage replaces the held one and a beat keeps it only while the match label is unchanged`() {
    val held = WaitingFields("Example Town v Sample CC", "Europe/London", null, true, null, null, 10, "QF", "Example Town v Sample CC")
    // A beat's answer carries no stage (capture-beat.v1): the same match keeps its round line.
    val sameMatch = WaitingFields("Example Town v Sample CC", "", null, true, null, null, 10)
    assertEquals("QF", sameMatch.overBeat(held).stageLabel)
    // The stable code was re-pointed at the next match: the old round line is a wrong fact, so none.
    val nextMatch = WaitingFields("Sample CC v Other CC", "", null, true, null, null, 10)
    assertNull(nextMatch.overBeat(held).stageLabel)
    assertNull(nextMatch.overBeat(held).stageFor)
    // A descriptor is fresh: what it says replaces what is held, and silence is no stage.
    val fresh = WaitingFields("Sample CC v Other CC", "Europe/London", null, true, null, null, 10, "SF", "Sample CC v Other CC")
    assertEquals("SF", fresh.over(held).stageLabel)
    val silent = WaitingFields("Sample CC v Other CC", "Europe/London", null, true, null, null, 10)
    assertNull(silent.over(held).stageLabel)
  }

  /** A waiting descriptor with [stage] spliced in, as the server would send it. */
  private fun withStage(stage: String): String =
    """{"state":"waiting","code":"fx42hmnp7k2q","label":"A v B","autoAllowed":true,"pollSeconds":10,"venueTimezone":"Europe/London","stage":$stage}"""

  @Test
  fun `a stage is read tolerantly and never makes the waiting fields unreadable`() {
    val good = """{"code":"QF","role":{"kind":"quarter_final"},"label":"QF"}"""
    val read = Bodies.code(200, withStage(good), null, Environment.STAGING) as CodeAnswer.Waiting
    assertEquals("QF", read.waiting.stageLabel)
    assertEquals("A v B", read.waiting.stageFor)
    val bad =
      listOf(
        "null",
        "\"QF\"",
        "[]",
        """{"role":{"kind":"quarter_final"},"label":7}""",
        """{"role":{"kind":"quarter_final"},"label":""}""",
        // R-F20: the contract says consumers show nothing for a kind they do not know, or for no role.
        """{"code":"X1","role":{"kind":"a_future_kind"},"label":"X1"}""",
        """{"code":"QF","label":"QF"}""",
        """{"code":"QF","role":{"kind":7},"label":"QF"}""",
      )
    for (stage in bad) {
      val answer = Bodies.code(200, withStage(stage), null, Environment.STAGING)
      // Still a waiting answer with its label: the stage alone was dropped.
      val waiting = (answer as CodeAnswer.Waiting).waiting
      assertNull(waiting.stageLabel, stage)
      assertEquals("A v B", waiting.label, stage)
    }
    assertEquals(8, bad.size)
  }

  @Test
  fun `the open session shape carries the stage too`() {
    val body = JSONObject(PairWire.SESSION).put("stage", JSONObject("""{"code":"QF","role":{"kind":"quarter_final"},"label":"QF"}""")).toString()
    val open = Bodies.code(200, body, null, Environment.STAGING) as CodeAnswer.Open
    assertEquals("QF", open.waiting?.stageLabel)
  }

  @Test
  fun `the role kinds are the shared file's fifteen, and each shows its label (R-F20)`() {
    val array = Shared.read("wire/stage-kinds.json").getJSONArray("kinds")
    val file = (0 until array.length()).map(array::getString)
    assertEquals(15, file.size)
    assertEquals(file.toSet(), Bodies.STAGE_KINDS)
    var shown = 0
    for (kind in file) {
      val answer = Bodies.code(200, withStage("""{"code":"X","role":{"kind":"$kind"},"label":"L1"}"""), null, Environment.STAGING)
      assertEquals("L1", (answer as CodeAnswer.Waiting).waiting.stageLabel, kind)
      shown += 1
    }
    assertEquals(15, shown)
  }
```

In `PairingTest.kt` add one case: a `PairRequest` built with `stageLabel = "QF", stageMatch = "A v B"` pairs, and the snapshot's `pairing` (via `Projection`) carries `stageLabel = "QF"` while the held label is `""` (UNKNOWN) and after a beat with label `"A v B"`, and carries `null` after a beat with label `"C v D"`. Copy the builder idiom of the existing `venueTimezone` case in that file.

- [ ] **Step 3: Run red.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.adapter.BodiesTest' --tests 'com.seazn.capture.engine.adapter.PairIntentVectorsTest' --tests 'com.seazn.capture.engine.adapter.SnapshotWireTest' --tests 'com.seazn.capture.engine.core.PairingTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Expected: compile errors for `stageLabel`, `overBeat`, `STAGE_KINDS` (read as red). Record the XML counts after Step 4.

- [ ] **Step 4: Implement.**

`core/Pairing.kt`, `WaitingFields` (new fields last, defaulted, so the three test call sites that pass seven positional arguments still compile):

```kotlin
data class WaitingFields(
  val label: String,
  val venueTimezone: String,
  val scheduledStartEpochS: Long?,
  val autoAllowed: Boolean,
  val destinationName: String?,
  val overlayUrl: String?,
  val pollSeconds: Int,
  /** The descriptor's `stage.label` (W28), shown verbatim as the round line; null when none, unreadable or of a kind the contract does not name. Display only. */
  val stageLabel: String? = null,
  /** The match [label] the stage was read with: a stage is only true of that match (the code is stable, so a beat can move the label). */
  val stageFor: String? = null,
) {
  fun over(held: WaitingFields): WaitingFields = if (venueTimezone.isEmpty()) copy(venueTimezone = held.venueTimezone) else this

  /**
   * A beat's answer over what is held. The beat carries no `stage` (capture-beat.v1), so the held stage
   * stays while this answer's [label] is the match it was read with, and goes when the label moved: the
   * stable code may now point at the next match, and the old round line would be a wrong fact on the tripod.
   */
  fun overBeat(held: WaitingFields): WaitingFields {
    val merged = over(held)
    val still = held.stageLabel != null && held.stageFor == label
    return merged.copy(stageLabel = held.stageLabel.takeIf { still }, stageFor = held.stageFor.takeIf { still })
  }
```

`PairRequest` (after `venueTimezone`): `val stageLabel: String? = null, val stageMatch: String? = null,` with the doc "The round line the scan's GET gave, and the match label it was read with; both or neither. Not a secret."

`core/Pairings.kt:33`:

```kotlin
        waiting = WaitingFields.UNKNOWN.copy(venueTimezone = input.request.venueTimezone, stageLabel = input.request.stageLabel, stageFor = input.request.stageMatch),
```

`core/SessionMachine.kt:623`: `?.overBeat(pairing.waiting)` in place of `?.over(pairing.waiting)`. Leave `Pairings.kt:120` on `over`.

`adapter/Bodies.kt`: add beside `LABEL`:

```kotlin
  /** capture-descriptor.v1 `stage.label`: 1 to 40 characters, in code points. */
  private val STAGE_LABEL = 1..40

  /**
   * `stage.role.kind`'s values (R-F20): the contract's description lists them and calls the string OPEN, and says
   * consumers show nothing for any other. `wire/stage-kinds.json` is the authority; BodiesTest holds this set to it
   * and `stageKinds.test.ts` holds the file to the contract. Internal for that test.
   */
  internal val STAGE_KINDS =
    setOf(
      "round_of", "quarter_final", "semi_final", "final", "winners_final", "losers_round", "losers_final", "grand_final",
      "grand_final_reset", "third_place", "qualifier1", "eliminator", "qualifier2", "rung", "plain_round",
    )
```

In `read()` build the stage after the overlay line and pass it:

```kotlin
    val stage = stageLabel(fields["stage"])
    return WaitingRead(WaitingFields(label, zone.orNull() ?: "", start.orNull(), auto, destination.orNull(), seazn, poll, stage, stage?.let { label }), null)
```

and the reader:

```kotlin
  /**
   * capture-descriptor.v1 `stage` (W28): its `label`, shown verbatim, 1 to 40 characters in code points, but only
   * when `role.kind` is one the contract names ([STAGE_KINDS]); an unknown kind, no `role` or a kind that is not a
   * string shows no line, even with a good label (R-F20). Display only, so anything else, a null, a non-object, a
   * label of 0 or over 40, is no stage and never makes the waiting fields unreadable; that is why `stage` is not in
   * [WAITING_KEYS]. `code`, `role.n`, `role.entrants` and `pool` are not read: the server renders the whole line.
   */
  private fun stageLabel(value: Any?): String? {
    val stage = value as? Map<*, *> ?: return null
    val kind = (stage["role"] as? Map<*, *>)?.get("kind") as? String ?: return null
    if (kind !in STAGE_KINDS) return null
    return (stage["label"] as? String)?.takeIf { it.characters in STAGE_LABEL }
  }
```

`adapter/PairMapping.kt` after `venueTimezone`:

```kotlin
      // The round line the scan's GET gave, with the match label it belongs to. Display only: outside 1 to 40
      // characters, or without its match, it is none, and never refuses a pair. JS read the kind rule at the scan.
      stageLabel = WireValues.text(wire["stageLabel"]).takeIf { it.characters in 1..40 && WireValues.text(wire["stageMatch"]).isNotEmpty() },
      stageMatch = WireValues.text(wire["stageMatch"]).takeIf { it.isNotEmpty() && WireValues.text(wire["stageLabel"]).characters in 1..40 },
```

(Both or neither: a stage without its match, or a match without a valid stage, seeds nothing.)

`adapter/SnapshotWire.kt` `pairing()`: add `"stageLabel" to w.stageLabel,` after `"overlayUrl"`.

- [ ] **Step 5: Run green.** Re-run the Step 3 command, then read the XML counts (`tests=` and `failures=` lines). Also run `GlueRulesTest` and `SessionRecordTest` only if the compiler asks. `cd "$WT" && pnpm vitest run --project domain modules/capture-engine/src/waitingVectors.test.ts modules/capture-engine/src/snapshotWire.test.ts` is run in Task 3 (it needs the TS side first).

- [ ] **Step 6: Mutations (named, each alone).** (a) `stale stage`: in `overBeat` replace `held.stageFor == label` with `true`: the `a beat keeps it only while the match label is unchanged` test must fail on `nextMatch`. (b) `stage tolerance`: add `"stage"` to `WAITING_KEYS` and make `read()` return `unreadable("stage")` when `stageLabel` is null and the key exists: the `never makes the waiting fields unreadable` test must fail. (c) `stage bound`: change `1..40` to `1..41`: the vectors row `a 41-character label` must fail. (d) `kind gate`: delete the `if (kind !in STAGE_KINDS) return null` line: the `unknown role kind` and `no role` vector rows, and the `bad` list, must fail. (e) `kinds list`: delete one value from `STAGE_KINDS`: `the role kinds are the shared file's fifteen` must fail. Restore each from `"$TMPDIR"`.

- [ ] **Step 7: Commit** `feat(engine): the descriptor's stage label rides the waiting fields for a known role kind; a beat keeps it only for the same match`.

---

## Task 3: The stage label in JS

**Files:**

- Create: `src/domain/session/stageLine.ts`, `src/domain/session/stageLine.test.ts`, `modules/capture-engine/src/stageKinds.test.ts`
- Modify: `src/domain/credentials/waitingFields.ts`, `src/domain/session/Pairing.ts`, `src/hooks/usePairing.ts`, `src/hooks/engineSelectors.ts`, `modules/capture-engine/src/{CaptureEnginePort,intentWire,snapshotWire,FakeCaptureEngine}.ts`
- Test: `src/domain/credentials/waitingFields.test.ts`, `modules/capture-engine/src/waitingVectors.test.ts` (Task 2 edited its counts; this task changes its mapping), `modules/capture-engine/src/{snapshotWire,intentWire,FakeCaptureEngine}.test.ts`, `src/hooks/{pairIntentWire,engineSelectors,usePairing}.test.ts(x)`, `src/domain/mode/savedCode.test.ts`

**Interfaces:**

- Consumes: Task 2's wire keys `stageLabel`, `stageMatch` (intent) and `pairing.stageLabel` (snapshot), and `wire/stage-kinds.json`.
- Produces:

```ts
// src/domain/session/stageLine.ts
export const STAGE_LABEL_MAX = 40;
/** The round line to show for a stage label, or null: 1 to 40 characters (code points), verbatim. */
export function stageLine(label: string | null | undefined): string | null;
// src/domain/credentials/waitingFields.ts
export const STAGE_KINDS: ReadonlySet<string>; // the 15 of wire/stage-kinds.json
export type StageRead = { readonly label: string; readonly kind: string };
// WaitingFields gains
//   readonly stage: StageRead | null;   // both label and kind, or neither: a saved copy reads back through the same parser
// src/domain/session/Pairing.ts: PairingInfo gains
//   readonly stageLabel: string | null;
// modules/capture-engine/src/CaptureEnginePort.ts: PairIntent gains
//   readonly stageLabel?: string; readonly stageMatch?: string;
// src/hooks/engineSelectors.ts
export const selectStageLine: (snapshot: EngineSnapshot) => string | null;
```

- [ ] **Step 1: Failing tests.**

`src/domain/session/stageLine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stageLine, STAGE_LABEL_MAX } from "@/domain/session/stageLine";

// The contract's own bound (capture-descriptor.v1 stage.label: 1..40), in code points.
const CASES: readonly (readonly [
  why: string,
  input: string | null | undefined,
  shown: string | null,
])[] = [
  ["a short code", "QF", "QF"],
  ["a pool and a round, verbatim", "Grupo A · R2", "Grupo A · R2"],
  ["exactly 40 characters", "x".repeat(40), "x".repeat(40)],
  [
    "40 code points where the last is an emoji (two UTF-16 units)",
    `${"x".repeat(39)}🏏`,
    `${"x".repeat(39)}🏏`,
  ],
  ["41 characters shows no line, never a cut one", "x".repeat(41), null],
  ["empty", "", null],
  ["null", null, null],
  ["absent", undefined, null],
];

describe("the round line (spec §2: a missing, empty or over-40 label shows no line)", () => {
  it.each(CASES)("%s", (_why, input, shown) => {
    expect(stageLine(input)).toBe(shown);
  });

  it("swept 8 cases, and the bound is the contract’s 40", () => {
    expect(CASES).toHaveLength(8);
    expect(STAGE_LABEL_MAX).toBe(40);
  });
});
```

`modules/capture-engine/src/stageKinds.test.ts` (`domain` project). The contract is the authority: the shared file and the TS set are both held to the description the web wrote.

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGE_KINDS } from "@/domain/credentials/waitingFields";
import shared from "./wire/stage-kinds.json";

type Json = Record<string, unknown>;
const contract = JSON.parse(
  readFileSync(
    new URL(
      "../../../test/fixtures/contracts/capture-descriptor.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { oneOf: Json[] };

const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Json | undefined)?.[key], value);

/** `stage.role.kind`'s description in every branch of the descriptor that carries a stage. */
const descriptions = contract.oneOf
  .map((branch) =>
    at(
      branch,
      "properties",
      "stage",
      "properties",
      "role",
      "properties",
      "kind",
      "description",
    ),
  )
  .filter((text): text is string => typeof text === "string");

/** The backticked words of the description: today's values, which the contract calls an OPEN string. */
const listed = (text: string) =>
  [...text.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]);

describe("the stage role kinds: the contract, the shared file and the app agree (R-F20)", () => {
  it("finds the description in all 6 branches of the descriptor, and they say the same 15", () => {
    expect(contract.oneOf).toHaveLength(6);
    expect(descriptions).toHaveLength(6);
    const first = listed(descriptions[0] ?? "");
    expect(first).toHaveLength(15);
    for (const text of descriptions) expect(listed(text)).toEqual(first);
  });

  it("the shared file lists exactly the contract’s kinds, in its order", () => {
    expect(shared.kinds).toEqual(listed(descriptions[0] ?? ""));
  });

  it("the TS set is the shared file’s, no more and no fewer", () => {
    expect([...STAGE_KINDS].sort()).toEqual([...shared.kinds].sort());
    expect(STAGE_KINDS.size).toBe(15);
  });
});
```

`waitingFields.test.ts`: first, **update the existing key-list test**: the expected sorted keys gain `'stage'` (between `'scheduledStart'` and `'startUrl'`). Then add:

```ts
import {
  CODE_STATES,
  parseWaitingFields,
  STAGE_KINDS,
  waitingToWire,
} from "@/domain/credentials/waitingFields";

const STAGE = (over: Record<string, unknown> = {}) => ({
  code: "QF",
  role: { kind: "quarter_final" },
  label: "QF",
  ...over,
});

describe("the stage at the scan (spec §2, R-F20)", () => {
  it("reads the label of a stage with a known kind, and keeps the kind with it", () => {
    expect(parseWaitingFields(fields({ stage: STAGE() }), HOST)?.stage).toEqual(
      {
        label: "QF",
        kind: "quarter_final",
      },
    );
  });

  it.each([
    ["a label of 41 characters", STAGE({ label: "x".repeat(41) })],
    ["an empty label", STAGE({ label: "" })],
    ["no label", { code: "QF", role: { kind: "quarter_final" } }],
    ["null", null],
    ["not an object", "QF"],
    [
      "an unknown kind with a good label (R-F20)",
      STAGE({ role: { kind: "a_future_kind" } }),
    ],
    ["no role", { code: "QF", label: "QF" }],
    ["a kind that is not a string", STAGE({ role: { kind: 7 } })],
  ])(
    "%s is no stage, and the rest of the answer is still read",
    (_why, stage) => {
      const read = parseWaitingFields(fields({ stage }), HOST);
      expect(read).not.toBeNull();
      expect(read?.stage).toBeNull();
      expect(read?.label).toBe("Example Town v Sample CC");
    },
  );

  it("reads no stage when the answer has none", () => {
    expect(parseWaitingFields(fields(), HOST)?.stage).toBeNull();
  });

  it("shows the label for each of the 15 kinds the contract names", () => {
    let shown = 0;
    for (const kind of STAGE_KINDS) {
      expect(
        parseWaitingFields(fields({ stage: STAGE({ role: { kind } }) }), HOST)
          ?.stage?.label,
      ).toBe("QF");
      shown += 1;
    }
    expect(shown).toBe(15);
  });

  it("round-trips a stage through the saved wire, kind and all, and a saved code from before this change reads none", () => {
    const read = parseWaitingFields(fields({ stage: STAGE() }), HOST);
    if (read === null) throw new Error("the fixture must parse");
    expect(waitingToWire(read)).toMatchObject({
      stage: { role: { kind: "quarter_final" }, label: "QF" },
    });
    expect(parseWaitingFields(waitingToWire(read), HOST)).toEqual(read);
    // Without a stage the wire carries no `stage` key at all, so older saved codes and new ones agree.
    const none = parseWaitingFields(fields(), HOST);
    if (none === null) throw new Error("the fixture must parse");
    expect(Object.keys(waitingToWire(none))).not.toContain("stage");
  });
});
```

`waitingVectors.test.ts`: the file's rows carry `stageLabel` (Task 2); map the TS result to that shape. Replace the `seen` line with:

```ts
const { stage, ...rest } = read ?? { stage: null };
const seen =
  read === null
    ? null
    : {
        ...rest,
        scheduledStart: inSeconds(read.scheduledStart),
        stageLabel: stage?.label ?? null,
      };
```

(Keep the `read === null` branch exactly as the file's today; only the keys are new.) The title and the counts are Task 2's (41, 39, 19).

`snapshotWire.test.ts`, `intentWire.test.ts`, `pairIntentWire.test.ts`: the vector rows from Task 2 are swept by the existing loops; add (1) `intentWire` passes `stageLabel` and `stageMatch` through when present and writes neither key when absent (assert `Object.keys`), (2) `pairIntentFor(saved, facts)` carries them from `saved.stream.waiting.stage` (`stageLabel` its label, `stageMatch` the waiting `label`) when `stage !== null` and omits both keys otherwise.

`savedCode.test.ts`: one case that a saved stream code whose waiting fields carry a stage decodes to the same stage after `encodeSavedCode`/`decodeSavedCode`, and that a record written without the key (every record saved before this PR) decodes with `stage === null`.

`engineSelectors.test.ts` (RP1: the file's builder is `snapshot(state, overrides, { pairing, broadcast })` at `:38`, with `FAKE_PAIRING` imported from `@/engine/FakeCaptureEngine` and the file's own `PAIRED`, `LIVE` and `BROADCAST` constants; there is no `snapshotWith` and no `basePairing`. The neighbouring `withPairing` helper at `:301-302` is scoped to its own `describe`, so the new block declares its own). Add `selectStageLine` to the file's import from `@/hooks/engineSelectors`, then:

```ts
describe("the round line selector (spec §2)", () => {
  const paired = (over: Partial<PairingInfo>) =>
    snapshot(PAIRED, {}, { pairing: { ...FAKE_PAIRING, ...over } });

  it("selectStageLine is the pairing’s stage label, only while a match label is known, and null otherwise", () => {
    expect(selectStageLine(paired({ label: "A v B", stageLabel: "QF" }))).toBe(
      "QF",
    );
    expect(selectStageLine(paired({ label: "", stageLabel: "QF" }))).toBeNull();
    expect(
      selectStageLine(paired({ label: "A v B", stageLabel: null })),
    ).toBeNull();
    expect(
      selectStageLine(paired({ label: "A v B", stageLabel: "x".repeat(41) })),
    ).toBeNull();
    expect(selectStageLine(snapshot(PAIRED, {}, { pairing: null }))).toBeNull();
  });

  it("a known match label is the broadcast’s too: selectLabel reads it before the pairing’s", () => {
    const live = snapshot(
      LIVE,
      {},
      {
        pairing: { ...FAKE_PAIRING, label: "", stageLabel: "QF" },
        broadcast: BROADCAST,
      },
    );
    expect(selectStageLine(live)).toBe("QF");
  });
});
```

- [ ] **Step 2: Run red** with the JSON recipe over the files above. Record the red count.

- [ ] **Step 3: Implement.**

`src/domain/session/stageLine.ts`:

```ts
/** capture-descriptor.v1 `stage.label`: 1 to 40 characters in the org's locale, shown verbatim (spec §2). */
export const STAGE_LABEL_MAX = 40;

/** Code points, as JSON Schema counts a length: a 🏏 is one character, two UTF-16 units. */
const characters = (text: string) => [...text].length;

/**
 * The round line for a stage label, or null. A missing, empty or over-40 label shows no line; one that is
 * too long is never cut, because the server omits it rather than cut it. The phone builds and translates
 * nothing: this is the server's text.
 */
export function stageLine(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const length = characters(label);
  return length >= 1 && length <= STAGE_LABEL_MAX ? label : null;
}
```

`waitingFields.ts`: add `readonly stage: StageRead | null;` to the type (and the `StageRead` type above it); a `STAGE = { min: 1, max: 40 }` bound beside the others; the kinds, in the contract's order (the same list as `wire/stage-kinds.json`, which `stageKinds.test.ts` holds this set to and holds to the contract):

```ts
/** capture-descriptor.v1 `stage.role.kind`'s values (R-F20): an open string, of which only these show a line. */
export const STAGE_KINDS: ReadonlySet<string> = new Set([
  "round_of",
  "quarter_final",
  "semi_final",
  "final",
  "winners_final",
  "losers_round",
  "losers_final",
  "grand_final",
  "grand_final_reset",
  "third_place",
  "qualifier1",
  "eliminator",
  "qualifier2",
  "rung",
  "plain_round",
]);

/**
 * W28: display only, so anything wrong is no stage and never makes the answer unreadable (Bodies.stageLabel). The label
 * counts only for a role kind the contract names, and is kept with its kind so a saved copy reads back the same way.
 */
function readStage(value: unknown): StageRead | null {
  if (!isRecord(value) || !isRecord(value.role)) return null;
  const { kind } = value.role;
  if (!isText(kind) || !STAGE_KINDS.has(kind)) return null;
  return textWithin(value.label, STAGE) ? { label: value.label, kind } : null;
}
```

and `stage: readStage(input.stage),` in the object `parseWaitingFields` returns. `waitingToWire` returns `{ ...rest, scheduledStart: seconds }` today; change it to:

```ts
const { scheduledStart, stage, ...rest } = fields;
const seconds =
  scheduledStart === null ? null : Math.floor(scheduledStart.getTime() / 1000);
// A saved stage is `{ role: { kind }, label }`: what the one parser reads back, kind rule included. `code` and `pool` are not read.
const saved =
  stage === null
    ? {}
    : { stage: { role: { kind: stage.kind }, label: stage.label } };
return { ...rest, scheduledStart: seconds, ...saved };
```

`Pairing.ts`: `readonly stageLabel: string | null;` on `PairingInfo`. `CaptureEnginePort.ts`: on `PairIntent` add `readonly stageLabel?: string; readonly stageMatch?: string;` with a doc that both ride together and are the scan's. `intentWire.ts`: destructure `stageLabel, stageMatch` and spread `...(stageLabel !== undefined && stageMatch !== undefined ? { stageLabel, stageMatch } : {})` after `venueTimezone`. `usePairing.ts` `pairIntentFor`:

```ts
    venueTimezone: waiting.venueTimezone,
    ...(waiting.stage === null
      ? {}
      : { stageLabel: waiting.stage.label, stageMatch: waiting.label }),
```

`snapshotWire.ts` `toPairing`: add `stageLabel` to the destructure, `if (!textOrNull(stageLabel)) return undefined;` (reuse `textOrNull` as `destinationName` does) and `stageLabel` in the result. Run `pnpm typecheck` and fix every literal `WaitingFields` and `PairingInfo` it names (the fake engine's builders, `fakeCodePort`, test fixtures) with `stage: null` or `stageLabel: null`. `engineSelectors.ts`:

```ts
/**
 * The round line (spec §2): the pairing's stage label, once the match label is known. Native keeps it only for
 * the match it was read with; the length is held again here, so an over-long one can never paint.
 */
export const selectStageLine = (snapshot: EngineSnapshot) =>
  selectLabel(snapshot) === null
    ? null
    : stageLine(snapshot.pairing?.stageLabel);
```

(import `stageLine`). `FakeCaptureEngine`: `setPairing({ stageLabel: 'QF' })` already works through `Partial<PairingInfo>`; add `stageLabel: null` to its default pairing, `FAKE_PAIRING` (`FakeCaptureEngine.ts:209`, which `engineSelectors.test.ts` spreads), and leave its `broadcastFor` untouched.

- [ ] **Step 4: Run green**, same file list, plus the native vectors the TS side shares: `modules/capture-engine/src/waitingVectors.test.ts` and `snapshotWire.test.ts`. Then `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm format:check`.

- [ ] **Step 5: Mutations (named, each alone).** (a) `stage length`: in `stageLine` change `<= STAGE_LABEL_MAX` to `<= STAGE_LABEL_MAX + 1`; the `41 characters` row must fail. (b) `stage seed`: delete the spread in `pairIntentFor`; the `pairIntentFor carries them` test must fail. (c) `match gate`: make `selectStageLine` skip the `selectLabel` check; the `label: ''` expectation must fail. (d) `kind gate`: delete the `!STAGE_KINDS.has(kind)` test in `readStage`; the `unknown kind` and `no role` cases and the vector rows must fail. (e) `saved kind`: drop the `role` from the saved stage in `waitingToWire`; the round-trip test and the `savedCode` case must fail. (f) `kinds list`: delete one value from `STAGE_KINDS`; `stageKinds.test.ts` must fail. Restore each.

- [ ] **Step 6: Commit** `feat(stage): the stage label crosses the scan, the intent and the snapshot to JS, for the role kinds the contract names`.

---

## Task 4: The round line in the status strip (controller ruling R-F5)

R-F5 is the controller's, not the owner's (see _Owner answers and controller rulings_): the camera box and the 180 dp strip stay as PR A ruled, no reserve is added, and the round line shows only when the strip has room for it beside the label. If the owner overturns R-F5 and picks a reserve or a clipped last line, this task's `stageFits` and its table change and nothing else moves; say which in the commit body.

**Files:**

- Create: `src/ui/components/StageLine.tsx`, `src/ui/components/StageLine.test.tsx`, `src/ui/theme/stageFit.ts`, `src/ui/theme/stageFit.test.ts`, `src/ui/components/StatusStrip.stage.test.tsx`
- Modify: `src/ui/theme/tokens.ts`, `src/ui/components/StatusStrip.tsx`, `src/ui/components/MatchLabel.tsx`, `src/ui/components/MatchLabel.test.tsx`, `src/ui/theme/viewfinderFit.test.ts`, `src/ui/screens/StreamScreen.layout.test.tsx`

**Interfaces:**

- Consumes: Task 3's `selectStageLine`; PR A's `StatusStrip`, `MatchLabel`, `cameraBoxSize` and `STRIP_RESERVE` (`src/ui/theme/cameraBox.ts`), `layout` tokens (`stripPadV`, `stripGap`, `statusLinesMax`, `captionLinesMax`), `typeScale` roles `body` and `metricUnit`; the existing `test/layOut.ts` helper.
- Produces:

```ts
// src/ui/theme/stageFit.ts
/** Whether the round line fits above a label of [labelHeight] dp in a strip of [stripHeight] dp, status and caption reserved at their worst case. */
export function stageFits(stripHeight: number, labelHeight: number): boolean;
// MatchLabel gains an optional onLayoutHeight?: (height: number) => void   (production use: StatusStrip)
// StageLine: ({ text }: { text: string }) => JSX.Element
// layout gains stageLines: 1
```

**The arithmetic (the reason for R-F5), from PR A's tokens.** `cameraBoxSize` sizes the box against `STRIP_RESERVE` (180), so the strip is whatever the screen has left under the box. Over the four real geometries of `viewfinderFit.test.ts` (`GEOMETRIES`) that is 180 dp at every one: the box is `height - 180` wherever the half is wide enough, and the strip gets exactly 180.

| geometry (dp) | half width | full box (half ÷ 16/9) | box = min(full box, height − 180) | strip = height − box |
| ------------- | ---------- | ---------------------- | --------------------------------- | -------------------- |
| 640 × 360     | 320        | 180                    | 180                               | **180**              |
| 800 × 360     | 400        | 225                    | 180                               | **180**              |
| 844 × 390     | 422        | 237.4                  | 210                               | **180**              |
| 915 × 412     | 457.5      | 257.3                  | 232                               | **180**              |

Line heights: stage `metricUnit` 16, label regular 22 or long 19, status `body` 22, caption `metricUnit` 16; `stripPadV` 8, `stripGap` 6.

| strip content (180 available)                                                | dp               |
| ---------------------------------------------------------------------------- | ---------------- |
| PR A worst case, no stage: 2×8 + 76 + 44 + 32 + 2×6                          | 180              |
| plus the round line, label 4 lines long: 2×8 + 16 + 76 + 44 + 32 + 3×6       | **202, 22 over** |
| round line, label 1 line regular (22)                                        | 148              |
| round line, label 2 lines regular (44)                                       | 170              |
| round line, label 2 lines long (38)                                          | 164              |
| round line, label 3 lines regular (66)                                       | 192, over        |
| round line, label 3 lines long (57)                                          | 183, over        |
| the room a label has beside the round line: 180 − (2×8 + 16 + 44 + 32 + 3×6) | **54**           |

So the round line shows for a label of at most two lines (22, 44 or 38 dp) and is hidden for three or four (57 to 76 dp), **at every geometry, 360 dp tall included**: a long double's strip has no room for it. That is the cost of R-F5 and it is stated plainly in Task 11 item 3.

- [ ] **Step 1: Failing fit tests** (`stageFit.test.ts`, `domain` project). The strip heights are derived from `cameraBoxSize` over the four real geometries, not typed in, and the expected booleans are the table above written by hand, not computed from `stageFits`:

```ts
import { describe, expect, it } from "vitest";
import { cameraBoxSize, STRIP_RESERVE } from "@/ui/theme/cameraBox";
import { stageFits } from "@/ui/theme/stageFit";
import { layout } from "@/ui/theme/tokens";
import { typeScale } from "@/ui/theme/type";

// The four real geometries of viewfinderFit.test.ts (spec §1). There is no 640 × 412 phone: the strip
// here is what cameraBoxSize leaves under the box, never a number typed to suit the test.
const GEOMETRIES = [
  [640, 360],
  [800, 360],
  [844, 390],
  [915, 412],
] as const;

const stripAt = (width: number, height: number) =>
  height -
  cameraBoxSize({
    halfWidth: width / 2,
    height,
    stripContent: STRIP_RESERVE,
    aspect: layout.previewAspect,
  }).height;

const regular = typeScale.label.lineHeight; // 22
const long = typeScale.labelLong.lineHeight; // 19

// [why, label height, fits]: the table in Task 4, restated in dp (room 54).
const LABELS: readonly (readonly [string, number, boolean])[] = [
  ["1 line regular", regular, true],
  ["2 lines regular", 2 * regular, true],
  ["2 lines long", 2 * long, true],
  ["3 lines long", 3 * long, false],
  ["3 lines regular", 3 * regular, false],
  ["4 lines long (the strip’s worst case)", 4 * long, false],
];

let checked = 0;

describe("the round line yields when the strip has no room (R-F5)", () => {
  it("the strip is 180 dp at each of the four real geometries (P8)", () => {
    const strips = GEOMETRIES.map(([width, height]) => stripAt(width, height));
    expect(strips).toEqual([180, 180, 180, 180]);
  });

  it("the room beside the round line is 54 dp", () => {
    const room =
      180 -
      (2 * layout.stripPadV +
        layout.stageLines * typeScale.metricUnit.lineHeight +
        layout.statusLinesMax * typeScale.body.lineHeight +
        layout.captionLinesMax * typeScale.metricUnit.lineHeight +
        3 * layout.stripGap);
    expect(room).toBe(54);
  });

  describe.each(GEOMETRIES)("at %i × %i", (width, height) => {
    it.each(LABELS)("%s", (_why, label, fits) => {
      expect(stageFits(stripAt(width, height), label)).toBe(fits);
      checked += 1;
    });
  });

  it("not measured yet, strip or label, is hidden: a phone never paints a line it may have to take back", () => {
    expect(stageFits(0, 2 * regular)).toBe(false);
    expect(stageFits(180, 0)).toBe(false);
  });

  it("checked 4 geometries × 6 labels, with both answers present (anti-vacuity)", () => {
    expect(LABELS).toHaveLength(6);
    expect(LABELS.filter((row) => row[2])).toHaveLength(3);
    expect(LABELS.filter((row) => !row[2])).toHaveLength(3);
    expect(checked).toBe(GEOMETRIES.length * LABELS.length);
  });
});
```

Add to `viewfinderFit.test.ts` the PR A strip case unchanged (180) and one more that **states the over-run, so nobody “fixes” it by deleting the yield or by adding a reserve the owner did not choose**:

```ts
it("the round line plus PR A’s worst-case strip is 202 dp, 22 over the 180 the strip has, which is why it yields (R-F5)", () => {
  const worst = layout.labelLinesMax * typeScale.labelLong.lineHeight;
  const status = layout.statusLinesMax * typeScale.body.lineHeight;
  const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const items = [stage, worst, status, caption];
  expect(items).toHaveLength(4);
  expect(stack(items, layout.stripGap, layout.stripPadV)).toBe(202);
  expect(stack(items, layout.stripGap, layout.stripPadV) - STRIP_WORST).toBe(
    22,
  );
  // No reserve was added: the strip's reserve is still the worst case WITHOUT the round line.
  expect(STRIP_RESERVE).toBe(STRIP_WORST);
});
```

- [ ] **Step 2: Failing component tests** (`ui` project).
  - `StageLine.test.tsx`: renders its text verbatim in one element with `testID="stage-line"`; one line (`white-space: nowrap` and `text-overflow: ellipsis`, which is how react-native-web renders `numberOfLines={1}`, as `MatchLabel.test.tsx`'s `linesAllowed` reads it); the same size and colour as the label's own small grey `v` (the `metricUnit` role: render a `Text variant="metricUnit"` beside it and compare `fontSize` and `color`). Sweep three texts (`QF`, a 40-character one, one with an emoji) and state the count.
  - `MatchLabel.test.tsx`: one case: `MatchLabel` rendered with `onLayoutHeight` calls it with the height `layOut(root, { width: 300, height: 44 })` delivers, and again with a new height when the layout changes; without the prop, `layOut` still works (the handler tolerates its absence).
  - `StatusStrip.stage.test.tsx` (new). **F19: the label's height cannot be measured in jsdom, and the production `StatusStrip` takes no test-only prop.** The test replaces `MatchLabel` with `vi.mock`, a stand-in that captures the real `onLayoutHeight` prop `StatusStrip` passes it, and a hoisted holder lets the test call it:

```tsx
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusStrip } from "@/ui/components/StatusStrip";
import { layOut } from "../../../test/layOut";
import { renderWithPorts } from "../../../test/renderWithPorts";

const standIn = vi.hoisted(() => ({
  report: undefined as undefined | ((height: number) => void),
}));

vi.mock("@/ui/components/MatchLabel", async () => {
  const { createElement } = await import("react");
  const { View } = await import("react-native");
  return {
    MatchLabel: ({
      onLayoutHeight,
    }: {
      onLayoutHeight?: (height: number) => void;
    }) => {
      standIn.report = onLayoutHeight;
      return createElement(View, { testID: "match-label" });
    },
  };
});

function stripWith(stageLabel: string | null) {
  const view = renderWithPorts(<StatusStrip line="Ready" advisory={null} />);
  act(() => {
    view.engine.setPairing({ label: "A v B", stageLabel });
    view.engine.scene("paired-ready");
  });
  return view;
}
const label = (height: number) => act(() => standIn.report?.(height));
const strip = (height: number) =>
  layOut(screen.getByTestId("status-strip"), { width: 320, height });
```

Cases (each states what it asserts): the stand-in really received a function (`typeof standIn.report` is `function`, so the wiring is not vacuous); with the strip at 180 and the label at 44 the `stage-line` is present; at 57 it is absent; with no strip layout yet it is absent; with no label height yet it is absent; after 57 then 44 (a shorter label arrives) it comes back; after 44 then 57 it goes; with `stageLabel: null` it is absent even when it fits (positive pair: the same render with `'QF'` shows it); with a stage but an empty match label it is absent. This is a **wiring test, not a fit proof**: the fit itself is Task 11, item 3.

- `StreamScreen.layout.test.tsx` (real components, nothing mocked): in `status-strip`, once `layOut(byId('status-strip'), { width: 320, height: 180 })` and `layOut(byId('match-label'), { width: 300, height: 44 })` have been delivered, DOM order is `stage-line`, `match-label`, the status line, and `view.engine.setPairing({ stageLabel: 'QF', label: 'A v B' })` shows `QF`; with `stageLabel: null` it is absent (positive pair: `match-label` is present in both); with a `stageLabel` of 41 characters it is absent; with the label at 57 dp it is absent. The strip root must take an `onLayout` (the existing probe in this file shows `layOut` throws on an element that has none; add the matching case for `status-strip`).

- [ ] **Step 3: Run red.**

- [ ] **Step 4: Implement.**

`tokens.ts` `layout`: add `/** Spec §2 round line: one line above the label. */ stageLines: 1,`.

`stageFit.ts`:

```ts
import { layout } from "@/ui/theme/tokens";
import { typeScale } from "@/ui/theme/type";

/**
 * R-F5. The round line is the least important line in the status strip, so it is the one that yields: it shows
 * only when, with the status and the caption still reserved at their worst case, the label leaves room for it.
 * No reserve was added to the strip, which is 180 dp at every real geometry, so a label of three or four lines
 * (a long double) leaves it no room and the line is hidden. Unmeasured (a strip or a label of 0) it is hidden too,
 * so a phone never paints a line it may have to take back.
 */
export function stageFits(stripHeight: number, labelHeight: number): boolean {
  if (stripHeight <= 0 || labelHeight <= 0) return false;
  const stage = layout.stageLines * typeScale.metricUnit.lineHeight;
  const status = layout.statusLinesMax * typeScale.body.lineHeight;
  const caption = layout.captionLinesMax * typeScale.metricUnit.lineHeight;
  // 2 padding + stage + label + status + caption + the 3 gaps between the 4 items.
  const needed =
    2 * layout.stripPadV +
    stage +
    labelHeight +
    status +
    caption +
    3 * layout.stripGap;
  return needed <= stripHeight;
}
```

`StageLine.tsx`:

```tsx
import { Text } from "@/ui/components/Text";

/** The round line (spec §2): the server's text, small and grey, one line, never translated or built here. */
export function StageLine({ text }: { text: string }) {
  return (
    <Text variant="metricUnit" numberOfLines={1} testID="stage-line">
      {text}
    </Text>
  );
}
```

`MatchLabel.tsx`: `MatchLabel` accepts `{ onLayoutHeight }` and passes it to `SplitLabel`, which puts `onLayout={onLayout}` on its root `View` where `onLayout` is a `useCallback((e: LayoutChangeEvent) => onLayoutHeight?.(e.nativeEvent.layout.height), [onLayoutHeight])`. `StatusStrip` passes the `useState` setter, which is stable.

`StatusStrip.tsx`: read `const stage = useEngineSelector(selectStageLine)`; keep `const [stripHeight, setStripHeight] = useState(0)` and `const [labelHeight, setLabelHeight] = useState(0)`; the strip root gets `onLayout={(e) => setStripHeight(e.nativeEvent.layout.height)}` (a `useCallback`); render `{stage !== null && stageFits(stripHeight, labelHeight) ? <StageLine text={stage} /> : null}` above `<MatchLabel onLayoutHeight={setLabelHeight} />`. **No new prop on `StatusStrip`**: it keeps `line` and `advisory`.

- [ ] **Step 5: Run green** (`stageFit.test.ts`, `viewfinderFit.test.ts`, `StageLine.test.tsx`, `StatusStrip.stage.test.tsx`, `StreamScreen.layout.test.tsx`, `MatchLabel.test.tsx`, `Hud.test.tsx`, and every `StreamScreen.` file). Confirm the printed names. Then typecheck, lint, format.

- [ ] **Step 6: Mutations (named).** (a) `yield`: make `stageFits` return `stripHeight > 0 && labelHeight > 0`; the `3 lines long` and `4 lines long` rows (at all four geometries) must fail. (b) `yield wiring`: delete the `stageFits(...)` condition in `StatusStrip` (render whenever `stage !== null`); the wiring test with `57` must fail. (c) `gap`: change `3 * layout.stripGap` to `2 *`; the `3 lines long` rows must fail (183 vs 180 is exactly the margin this row guards). (d) `label unmeasured`: delete the `labelHeight <= 0` half of the first guard; the `no label height yet` case and the `stageFits(180, 0)` assertion must fail. (e) `label wiring`: delete `onLayoutHeight={setLabelHeight}`; `typeof standIn.report` must fail.

- [ ] **Step 7: Commit** `feat(viewfinder): the round line above the match label, yielding when the strip has no room (spec §2, R-F5)`.

---

## Task 5: The scoring-link call in native (and the JVM host that speaks it)

R-F3 (controller ruling): the call is an Expo `AsyncFunction` that answers its caller, the second one after PR B's `takePhoto`. There is no event, no request id, no listener fan-out and no new backstop. The bound on the native side is `BridgeCore.ask`'s existing one: `ANSWER_BACKSTOP_MS` = 2 × `HttpRequests.TIMEOUT_MS` (8 000) = 16 000 ms (`BridgeCore.kt:499`), so native always answers once, at the latest at 16 s; JS gives up first, at 12 s (Task 6).

**RP4 (controller ruling): the call is off the machine's failure path.** `BridgeCore` runs its work on `GuardedScheduler`, whose `onFailure` is `failed` (`BridgeCore.kt:43`, `:487-490`): a `LinkageError` (or a `PermanentPlatformFailure`) that reaches it is classified permanent, makes the sticky failure fatal for the process and ends the pairing, and any other throw is counted and recorded as an `engine-error`. `ask` catches only `Exception` (`:401`), so an `Error` out of the transport (an `UnsatisfiedLinkError` from a missing TLS library is the realistic one), out of the reading, or out of the caller's own resolver would take that route, and a tap on a side button must never end a broadcast. So every stage of the call is a guarded task that cannot reach `failed`: a small `ScoringTap` hands the caller its answer at most once, and runs each stage in `apart { … }`, which answers `unavailable` and notes the throw as one `scoring-link` line naming the throwable's class and nothing else (CD30).

**Files:**

- Create (under `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/`): `adapter/ScoringLinks.kt` (the answer type, the wire value and `ScoringTap`, RP4)
- Create: `modules/capture-engine/src/wire/scoring-link-vectors.json`, `…/android/core/src/test/kotlin/com/seazn/capture/engine/adapter/ScoringLinkTest.kt`
- Modify (core): `adapter/Http.kt:47-74`, `adapter/Bodies.kt`, `adapter/BridgeCore.kt`, `core/SessionRecord.kt`, `modules/capture-engine/src/scrub/allow-list.json` (the `kinds` map only), `modules/capture-engine/src/wire/host-vectors.json`, `modules/capture-engine/src/wire/server-bodies.json`, `modules/capture-engine/src/serverBodies.test.ts`
- Modify (module): `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/CaptureEngineModule.kt` (the new call goes after PR B's `takePhoto` at `:36-37`; the comment at `:36` is reworded, RP6), `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture/Capture.kt` (the doc comment at `:45` only, RP6)
- Modify (JVM host, F1; under `modules/capture-engine/android/core/host/src/main/kotlin/com/seazn/capture/engine/host/`): `Host.kt:54-56` (the `when` of stdin ops), `ScriptedServer.kt` (`PATHS` at `:108`, `path()` at `:47-53`, the default answer, `SCORING_SECRET`), `Protocol.kt`
- Test: `ScoringLinkTest.kt` (new), `adapter/BodiesTest.kt` (vector sweep), `core/HostsTest.kt` (map and count), `core/SessionRecordTest.kt` (the link bucket), `core/ScrubParityTest.kt:78` (kinds count 83 to 84), `adapter/GlueRulesTest.kt` (F2 text pin), `host/src/test/kotlin/com/seazn/capture/engine/host/{ProtocolTest,ScriptedServerTest}.kt`, `modules/capture-engine/src/hostVectors.test.ts`, `src/services/scrubParity.test.ts:66-68` (kinds count 83 to 84)

**Interfaces:**

- Produces (Kotlin):

```kotlin
sealed interface ScoringLinkAnswer {
  val word: String                                   // "ok" or a refusal word (D3)
  class Link(val url: String) : ScoringLinkAnswer    // toString prints a length only
  class Refused(override val word: String, val retryAfterS: Int?) : ScoringLinkAnswer
}
object ScoringLinks {
  fun wire(answer: ScoringLinkAnswer): Map<String, Any?>   // {outcome, url?, retryAfterS?}: the value the promise resolves with
  fun secret(url: String): String                          // the dl_… segment
}
Bodies.scoringLink(status: Int, body: String, retryAfterS: Int?, env: Environment): ScoringLinkAnswer
HttpRequests.scoringLink(url: String, bearer: String, body: String): HttpRequest
BridgeCore.scoringLink(answer: (Map<String, Any?>) -> Unit)    // any thread; [answer] runs once, on the scheduler thread; nothing it, the transport or the reading throws reaches GuardedScheduler's failed (RP4)
internal class ScoringTap(resolve: (Map<String, Any?>) -> Unit, note: (Throwable) -> Unit)   // hand(wire): the first only; apart(work): a throw is noted and answered unavailable; spent: handed already
SessionRecord.protectLink(secret: String)                      // its own bucket: at most LINK_SECRETS (16), newest kept, deduplicated
```

- Produces (module): `AsyncFunction("scoringLink") { promise: Promise -> core.scoringLink { answer -> promise.resolve(answer) } }`. **`Events(...)` is unchanged** (three events), and `Platform` gains nothing: the answer goes to the caller, not to the platform's emitter.
- Produces (JVM host, F1): stdin op `{"op":"scoringLink","call":N}` and stdout event `{"ev":"scoringLink","call":N,"answer":{outcome,url?,retryAfterS?}}`; the scripted path `scoring-link` (a plain unnumbered `script` op: a numbered one waits for its path's next answer, so the kit's `scriptFor` is not extended).
- The resolved value: `{ outcome: "ok"|"code_ended"|"replaced"|"match_finished"|"not_entitled"|"rate_limited"|"unavailable", url?: String (only with ok), retryAfterS?: Double (only with rate_limited, when the server sent one) }`.

- [ ] **Step 1: The vectors** (`wire/scoring-link-vectors.json`). The bodies are made up, each valid against the contract in Task 6's ajv test unless the row says `contractValid: false`. `TEST_SECRET` is `dl_` followed by `AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE` (43 characters: count them in the test). The two rows that carry `userinfo` and `uppercase` are the cross-language host rule's cases (F14): the contract's pattern is `^https:\/\/[^/]+\/score\/dl_[A-Za-z0-9_-]{43}$`, which a `user@` host satisfies, so only the host rule refuses it, in Kotlin and in JS alike.

```json
{
  "about": "POST scoring-link answers (capture-scoring-link.v1 at web 7e75fd4a7) as Bodies.scoringLink in Kotlin reads them, and as the contract allows them (scoringLinkBodies.test.ts, ajv). env is the build's. expected is the outcome word. The 2xx rows that carry a url are also fed to the JS port (scoringLinkPort.test.ts), which must accept exactly the rows Kotlin calls ok. Change only with both.",
  "cases": [
    {
      "why": "ok on the build's host",
      "env": "staging",
      "status": 200,
      "body": {
        "url": "https://stg.seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "ok"
    },
    {
      "why": "ok on production",
      "env": "production",
      "status": 200,
      "body": {
        "url": "https://seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "ok"
    },
    {
      "why": "ok but off the build's host is no link",
      "env": "staging",
      "status": 200,
      "body": {
        "url": "https://seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "unavailable",
      "contractValid": true
    },
    {
      "why": "ok with userinfo naming another host is no link",
      "env": "staging",
      "status": 200,
      "body": {
        "url": "https://stg.seazn.club@evil.example/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "unavailable",
      "contractValid": true
    },
    {
      "why": "ok with an upper-case host is the build's host",
      "env": "staging",
      "status": 200,
      "body": {
        "url": "https://STG.seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "ok",
      "contractValid": true
    },
    {
      "why": "401 code_ended",
      "env": "staging",
      "status": 401,
      "body": { "code": "code_ended", "message": "m" },
      "expected": "code_ended"
    },
    {
      "why": "401 that is not the server's refusal is no answer",
      "env": "staging",
      "status": 401,
      "body": { "code": "other", "message": "m" },
      "expected": "unavailable"
    },
    {
      "why": "404 not_a_stream_code",
      "env": "staging",
      "status": 404,
      "body": { "code": "not_a_stream_code", "message": "m" },
      "expected": "code_ended"
    },
    {
      "why": "409 replaced",
      "env": "staging",
      "status": 409,
      "body": { "code": "replaced", "message": "m" },
      "expected": "replaced"
    },
    {
      "why": "409 match_finished",
      "env": "staging",
      "status": 409,
      "body": { "code": "match_finished", "message": "m" },
      "expected": "match_finished"
    },
    {
      "why": "402 not_entitled",
      "env": "staging",
      "status": 402,
      "body": { "code": "not_entitled", "message": "m" },
      "expected": "not_entitled"
    },
    {
      "why": "429 rate_limited with Retry-After",
      "env": "staging",
      "status": 429,
      "retryAfter": "30",
      "body": { "code": "rate_limited", "message": "m" },
      "expected": "rate_limited",
      "retryAfterS": 30
    },
    {
      "why": "429 without Retry-After",
      "env": "staging",
      "status": 429,
      "body": { "code": "rate_limited", "message": "m" },
      "expected": "rate_limited",
      "retryAfterS": null
    },
    {
      "why": "503 unavailable",
      "env": "staging",
      "status": 503,
      "body": { "code": "unavailable", "message": "m" },
      "expected": "unavailable"
    },
    {
      "why": "422 invalid is retryable-looking, never a link",
      "env": "staging",
      "status": 422,
      "body": { "code": "invalid", "message": "m" },
      "expected": "unavailable"
    },
    {
      "why": "402 no_credit is not this route's word",
      "env": "staging",
      "status": 402,
      "body": { "code": "no_credit", "message": "m" },
      "expected": "unavailable"
    },
    {
      "why": "200 that is not an object",
      "env": "staging",
      "status": 200,
      "rawBody": "<html>sign in</html>",
      "expected": "unavailable"
    },
    {
      "why": "200 with a short secret",
      "env": "staging",
      "status": 200,
      "body": { "url": "https://stg.seazn.club/score/dl_short" },
      "expected": "unavailable",
      "contractValid": false
    },
    {
      "why": "200 with http",
      "env": "staging",
      "status": 200,
      "body": {
        "url": "http://stg.seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
      },
      "expected": "unavailable",
      "contractValid": false
    }
  ]
}
```

(`contractValid` is read by Task 6's ajv sweep: absent means true. The rows with `contractValid` are the bad-answer cases of Review Focus 5. 19 rows; 7 of them are 2xx rows carrying a `url`.)

In `wire/host-vectors.json` add two `seazn` rows (F14), after the last `seazn` row, in that file's own shape: `{ "env": "staging", "role": "seazn", "url": "https://stg.seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE", "ok": true }` and `{ "env": "staging", "role": "seazn", "url": "https://seazn.club/score/dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE", "ok": false }`. Update the counts that sweep that file: `hostVectors.test.ts` (`sweeps all 13 Seazn rows` becomes 15) and `HostsTest.kt:25` (`mapOf("seazn true" to 5, "seazn false" to 8, …)` becomes `6` and `9`).

In `wire/server-bodies.json` add the host's own scoring-link body (F1), after `host/start-ok`: `{ "name": "host/scoring-link-ok", "schema": "capture-scoring-link.v1.json#/$defs/ok", "body": { "url": "https://stg.seazn.club/score/dl_HostLinkAbCdEfGhIjKlMnOpQrStUvWxYz012345678" } }` (the secret is 3 + 43 characters: `ScriptedServer.SCORING_SECRET` below). In `serverBodies.test.ts` the sweep `all 7 bodies, PairWire four and the host three` becomes `all 8 bodies, PairWire four and the host four` (`Array(4).fill('host')`).

- [ ] **Step 2: Failing Kotlin tests.**

`BodiesTest.kt`: a sweep over the vector file, in the file's own idiom (`Shared.read`):

```kotlin
  @Test
  fun `the scoring-link answers one reading, over the vector rows`() {
    val rows = Shared.read("wire/scoring-link-vectors.json").getJSONArray("cases")
    assertEquals(19, rows.length())
    var checked = 0
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val body = if (row.has("rawBody")) row.getString("rawBody") else row.getJSONObject("body").toString()
      val retry = Bodies.retryAfter(row.optString("retryAfter").takeIf { it.isNotEmpty() })
      val answer = Bodies.scoringLink(row.getInt("status"), body, retry, Environment.of(row.getString("env")))
      assertEquals(row.getString("expected"), answer.word, row.getString("why"))
      if (answer is ScoringLinkAnswer.Refused && row.has("retryAfterS")) {
        assertEquals(row.optInt("retryAfterS").takeIf { !row.isNull("retryAfterS") }, answer.retryAfterS, row.getString("why"))
      }
      checked += 1
    }
    assertEquals(19, checked)
  }
```

`ScoringLinkTest.kt` drives the REAL path: `BridgeCore`, the real mapping, the real bodies, on `FakeClock`/`FakeScheduler`, with `RecordingPlatform` (**no change to it**: the answer no longer goes through the platform). Use the builder idiom of `BridgeCoreTest` (copy `build`, `ready`, `pair`, `live`). `got` collects what the callback was handed.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

class ScoringLinkTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val platform = RecordingPlatform()
  private val core = BridgeCore(clock, scheduler, platform, MemoryStore(), "1.0.0", "Test Phone") { Configs.PHONE_ID }.also { platform.core = it }

  /** Made up: `dl_` and 43 base64url characters, the contract's shape. Never a real link. */
  private val secret = "dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE"
  private val url = "https://stg.seazn.club/score/$secret"

  /** What each tap's callback was handed, in order. */
  private val got = mutableListOf<Map<String, Any?>>()

  @AfterTest fun forget() = BridgeCore.resetShared()

  private fun paired() {
    core.start()
    core.report(Input.Network(true))
    core.readiness(cameraFrames = true, audioPeak = 0.4, pose = Pose.Held(Side.LEFT))
    scheduler.advanceBy(Engine.TICK_MS)
    core.readiness(audioPeak = 0.4)
    core.send(PairWire.valid())
    scheduler.advanceBy(0)
  }

  private fun tap() = core.scoringLink { got += it }

  private fun answering(status: Int, body: String, retryAfter: String? = null) {
    platform.answer = { request ->
      if (request.url.endsWith("/scoring-link")) HttpOutcome.Answered(status, body, retryAfter) else PairWire.answer(request)
    }
  }

  private val ok get() = """{"url":"$url"}"""
  private fun lines() = platform.lines.map(::JSONObject)
  private fun scoringLines() = lines().filter { it.getString("kind") == "scoring-link" }
  private fun state() = (core.current()["state"] as Map<*, *>)["kind"]
  private fun telemetry() = core.current()["telemetry"] as Map<*, *>
  private val unavailable = mapOf("outcome" to "unavailable")

  /**
   * RP4's witness. Nothing reached the task boundary (`taskFailures`, and no `engine-error` line), nothing is held
   * against the process (`stickyFailure`), and the pairing carries on. A `LinkageError` that did reach `failed` would
   * make all three fail at once, which is how `BridgeCoreTest`'s "carry 18" sees one.
   */
  private fun assertUntouched(why: String) {
    assertEquals("paired", state(), why)
    assertEquals(listOf(0.0, false), listOf(telemetry()["taskFailures"], telemetry()["stickyFailure"]), why)
    assertTrue("engine-error" !in lines().map { it.getString("kind") }, why)
  }

  @Test
  fun `a tap asks the server with the pairing's bearer and the start's own body, and the answer is handed over once`() {
    paired()
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    val asked = platform.http.single { it.url.endsWith("/scoring-link") }
    assertEquals("POST", asked.method)
    assertEquals("${PairWire.ORIGIN}/scoring-link", asked.url)
    assertEquals("Bearer ${Configs.TOKEN}", asked.headers.toMap()["Authorization"])
    assertEquals("no-store", asked.headers.toMap()["Cache-Control"])
    assertEquals(Beats.startBody(Configs.PHONE_ID), asked.body)
    assertEquals(listOf(mapOf("outcome" to "ok", "url" to url)), got)
    // The answer is handed over once however long the clock runs: the backstop that guards the request is cancelled.
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(1, got.size)
  }

  @Test
  fun `the url reaches no record line, no snapshot, no beat and no toString`() {
    paired()
    answering(200, ok)
    tap()
    scheduler.advanceBy(Engine.TICK_MS * 3)
    val everything =
      platform.lines + platform.snapshots.map { it.toString() } + platform.http.filter { it.url.endsWith("/beats") }.map { it.body ?: "" } +
        platform.http.map { it.toString() } + core.tail().map { it.toString() } + core.current().toString()
    assertTrue(everything.isNotEmpty())
    for (text in everything) assertFalse(text.contains(secret), "the secret is in: ${text.take(80)}")
    // The record knows a link was asked for, by word and status only, and the allow-list decides that line (kind and keys).
    val line = lines().last { it.getString("kind") == "scoring-link" }
    assertEquals(setOf("at", "kind", "result", "status"), line.keySet())
    assertEquals("ok", line.getString("result"))
    assertEquals(200, line.getInt("status"))
    val list = Shared.read("scrub/allow-list.json")
    assertTrue("scoring-link" in list.getJSONObject("kinds").keySet())
    val plain = list.getJSONArray("plain").let { array -> (0 until array.length()).map(array::getString) }
    assertTrue("result" in plain && "status" in plain)
  }

  /**
   * F16. The scoring url is on the record's public-URL key list, so a line written under `url` passes the scrub unless
   * the secret is protected; and a line that names the bare secret in a `message` is masked by value only if it is
   * protected. Both are written the way a caller (or a library's error) could write them, after the answer.
   */
  @Test
  fun `a link's secret is masked under url and inside a message once it is known, and not before`() {
    paired()
    // Before the answer the process cannot know the secret: the same probe shows its text. This is the witness
    // that the masking below is the protect call's work, not a property of the probe.
    core.log("info", "probe", mapOf("message" to "x $secret y"))
    scheduler.advanceBy(0)
    assertTrue(platform.lines.last().contains(secret), "the probe carries the secret before it is known")
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    core.log("info", "probe", mapOf("url" to url, "message" to "x $secret y"))
    scheduler.advanceBy(0)
    val after = JSONObject(platform.lines.last())
    assertEquals("probe", after.getString("kind"))
    assertEquals(SessionRecord.MASK, after.getString("url"))
    assertEquals("x *** y", after.getString("message"))
  }

  @Test
  fun `each refusal is one word, a 429 keeps its Retry-After, and none carries a url`() {
    paired()
    val table =
      listOf(
        Triple(401, """{"code":"code_ended","message":"m"}""", "code_ended"),
        Triple(409, """{"code":"replaced","message":"m"}""", "replaced"),
        Triple(409, """{"code":"match_finished","message":"m"}""", "match_finished"),
        Triple(402, """{"code":"not_entitled","message":"m"}""", "not_entitled"),
        Triple(503, """{"code":"unavailable","message":"m"}""", "unavailable"),
      )
    for ((status, body, word) in table) {
      answering(status, body)
      tap()
      scheduler.advanceBy(0)
      assertEquals(word, got.last()["outcome"], body)
      assertFalse(got.last().containsKey("url"), body)
    }
    answering(429, """{"code":"rate_limited","message":"m"}""", "30")
    tap()
    scheduler.advanceBy(0)
    assertEquals(mapOf("outcome" to "rate_limited", "retryAfterS" to 30.0), got.last())
    assertEquals(6, got.size)
  }

  @Test
  fun `a refusal then a success then a repeat: each tap is its own ask and a repeat gets the same link`() {
    paired()
    answering(409, """{"code":"replaced","message":"m"}""")
    tap()
    scheduler.advanceBy(0)
    answering(200, ok)
    tap()
    tap()
    scheduler.advanceBy(0)
    assertEquals(listOf("replaced", "ok", "ok"), got.map { it["outcome"] })
    assertEquals(got[1], got[2])
    assertEquals(3, platform.http.count { it.url.endsWith("/scoring-link") })
  }

  @Test
  fun `no answer at all is unavailable at the existing backstop, and a second tap while the first is out is its own ask`() {
    paired()
    platform.unanswered = { it.url.endsWith("/scoring-link") }
    tap()
    tap()
    scheduler.advanceBy(0)
    assertEquals(0, got.size)
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(listOf("unavailable", "unavailable"), got.map { it["outcome"] })
    // 16 000 ms is the pre-existing backstop (P7), twice the 8 000 ms request timeout: this call adds none of its own.
    assertEquals(2 * HttpRequests.TIMEOUT_MS, BridgeCore.ANSWER_BACKSTOP_MS)
    assertEquals(16_000L, BridgeCore.ANSWER_BACKSTOP_MS)
  }

  @Test
  fun `with no pairing there is nothing to ask, and the answer says so without a request`() {
    core.start()
    tap()
    scheduler.advanceBy(0)
    assertEquals(0, platform.http.count { it.url.endsWith("/scoring-link") })
    assertEquals(listOf(mapOf("outcome" to "unavailable")), got)
    // RP4: a missing pairing is a plain answer, not a caught exception: nothing is noted, so no line is written.
    assertEquals(0, scoringLines().size)
  }

  @Test
  fun `a link is still asked for after live and after the broadcast ended, as the spec has it`() {
    paired()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(3_000)
    tap()
    scheduler.advanceBy(0)
    assertEquals(listOf("ok", "ok"), got.map { it["outcome"] })
  }

  @Test
  fun `a transport that throws is answered unavailable at once, whatever it throws, and the pairing is not failed (RP4)`() {
    paired()
    val thrown =
      listOf(
        IllegalStateException("no activity"), // an Exception: ask's own catch already answers it
        PermanentPlatformFailure("tls"), // an Exception that Failures.permanent calls permanent; still caught by ask
        UnsatisfiedLinkError("libssl.so not found"), // a LinkageError: permanent, and an Error that ask does not catch
        NoClassDefFoundError("okhttp3/Call"), // the same class of failure, another one
        Error("jni"), // an Error that is not permanent: it would be counted as a task failure and recorded as engine-error
      )
    for ((i, failure) in thrown.withIndex()) {
      platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) failure else null }
      tap()
      scheduler.advanceBy(0)
      assertEquals(unavailable, got.last(), failure.toString())
      assertEquals(i + 1, got.size, "answered once: $failure")
      assertUntouched(failure.toString())
    }
    assertEquals(5, got.size)
    // The pairing still works: the same tap, with the transport mended, gets its link.
    platform.throwOnHttp = { null }
    answering(200, ok)
    tap()
    scheduler.advanceBy(0)
    assertEquals(mapOf("outcome" to "ok", "url" to url), got.last())
    assertUntouched("after the transport is mended")
  }

  @Test
  fun `after a throw out of the transport the backstop that ask left armed adds no second answer and no second line (RP4)`() {
    paired()
    platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) UnsatisfiedLinkError("libssl.so not found") else null }
    tap()
    scheduler.advanceBy(0)
    val noted = scoringLines()
    assertEquals(1, noted.size)
    assertEquals(setOf("at", "kind", "result", "error"), noted.single().keySet())
    assertEquals(listOf("failed", "UnsatisfiedLinkError"), listOf(noted.single().getString("result"), noted.single().getString("error")))
    // An Error leaves ask before it can cancel its backstop, so the backstop fires into a tap that was answered long ago.
    scheduler.advanceBy(BridgeCore.ANSWER_BACKSTOP_MS + 1)
    assertEquals(listOf(unavailable), got)
    assertEquals(1, scoringLines().size, "the late backstop wrote a second line for the one tap")
    assertUntouched("after the backstop")
  }

  @Test
  fun `a callback that throws is noted by its class, the tap is not answered twice, and the pairing is not failed (RP4)`() {
    paired()
    answering(200, ok)
    var calls = 0
    core.scoringLink {
      calls += 1
      throw UnsatisfiedLinkError("jni dead")
    }
    scheduler.advanceBy(0)
    assertEquals(1, calls, "handed once; the failure is not answered into the same callback again")
    val noted = scoringLines().filter { it.has("error") }
    assertEquals(1, noted.size)
    assertEquals(listOf("failed", "UnsatisfiedLinkError"), listOf(noted.single().getString("result"), noted.single().getString("error")))
    assertUntouched("a callback that is dead")
  }

  @Test
  fun `a callback that is dead as well is tried once with unavailable, both failures are noted, and nothing reaches the failure path (RP4)`() {
    paired()
    platform.throwOnHttp = { if (it.url.endsWith("/scoring-link")) NoClassDefFoundError("okhttp3/Call") else null }
    var calls = 0
    core.scoringLink {
      calls += 1
      throw UnsatisfiedLinkError("jni dead")
    }
    scheduler.advanceBy(0)
    assertEquals(1, calls, "the unavailable answer was tried once")
    assertEquals(listOf("NoClassDefFoundError", "UnsatisfiedLinkError"), scoringLines().map { it.getString("error") })
    assertUntouched("the transport and the callback both dead")
  }

  @Test
  fun `the tap hands over once and ignores every later hand`() {
    val handed = mutableListOf<Map<String, Any?>>()
    val tap = ScoringTap({ handed += it }) {}
    assertFalse(tap.spent)
    tap.hand(mapOf("outcome" to "ok"))
    tap.hand(mapOf("outcome" to "replaced"))
    assertEquals(listOf(mapOf("outcome" to "ok")), handed)
    assertTrue(tap.spent)
  }

  @Test
  fun `work that fails apart is answered unavailable once and noted, and work that fails after the hand-over is only noted`() {
    val handed = mutableListOf<Map<String, Any?>>()
    val noted = mutableListOf<Throwable>()
    val before = ScoringTap({ handed += it }) { noted += it }
    val first = IllegalStateException("one")
    before.apart { throw first }
    assertEquals(listOf(unavailable), handed)
    assertEquals(listOf<Throwable>(first), noted)
    val after = ScoringTap({ handed += it }) { noted += it }
    val second = Error("two")
    after.apart {
      after.hand(mapOf("outcome" to "ok"))
      throw second
    }
    assertEquals(listOf(unavailable, mapOf("outcome" to "ok")), handed)
    assertEquals(listOf<Throwable>(first, second), noted)
    // Work that does not fail is not noted.
    ScoringTap({ handed += it }) { noted += it }.apart {}
    assertEquals(2, noted.size)
  }
}
```

Read before writing: `core.log(level, kind, fields)` and `core.tail()` exist on `BridgeCore` (the module calls them in `CaptureEngineModule.kt`); `BridgeCore.ANSWER_BACKSTOP_MS` is a public `const val` (`:499`); `Configs.TOKEN`, `Configs.PHONE_ID`, `PairWire.ORIGIN` exist; If the "after the broadcast ended" case needs a different stop idiom, copy the one `BridgeCoreTest` uses.

`SessionRecordTest.kt`: the link bucket (F15), in the file's idiom (a `SessionRecord { sink }` that collects lines; `append(atMs, RecordEntry(…))`). Every secret is made up: `link(n)` is `"dl_" + "%02d".format(n) + "B".repeat(41)`, 43 characters after `dl_`.

```kotlin
  private fun link(n: Int) = "dl_" + "%02d".format(n) + "B".repeat(41)

  /** Writes `message` with [secret] in it and returns what the record wrote. */
  private fun SessionRecord.wrote(secret: String): String {
    append(0, RecordEntry("probe", listOf("message" to "x $secret y")))
    return lastLines().last()
  }

  @Test
  fun `a link's secret is masked in text and under a public url key, from protectLink on`() {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    assertTrue(record.wrote(link(1)).contains(link(1)), "the witness: not masked before it is known")
    record.protectLink(link(1))
    assertFalse(record.wrote(link(1)).contains(link(1)))
    record.append(0, RecordEntry("probe", listOf("url" to "https://stg.seazn.club/score/${link(1)}")))
    assertTrue(record.lastLines().last().contains(""""url":"***""""))
  }

  @Test
  fun `a repeated link never pushes another out of the bucket, and the 17th distinct one evicts the oldest`() {
    val record = SessionRecord {}
    record.protectLink(link(0))
    record.protectLink(link(1))
    repeat(20) { record.protectLink(link(1)) }
    assertFalse(record.wrote(link(0)).contains(link(0)), "dedupe: twenty repeats of one link left the other masked")
    for (n in 2..16) record.protectLink(link(n))
    // 17 distinct links have been protected (0 to 16): the oldest is outside the bucket now, which holds 16.
    // Its cost is the plan's D11: a link 16 re-issues old is long revoked.
    assertTrue(record.wrote(link(0)).contains(link(0)), "the cap: the 17th distinct link evicted the first")
    for (n in 1..16) assertFalse(record.wrote(link(n)).contains(link(n)), "link $n is held")
  }

  @Test
  fun `a pairing token is never evicted by links, and a link never loosens a protected value`() {
    val record = SessionRecord {}
    val token = "tok-test-0000000000000"
    record.protect(listOf(token))
    for (n in 0..30) record.protectLink(link(n))
    assertFalse(record.wrote(token).contains(token), "31 links later the token is still masked")
    record.protect(listOf("another-secret-0001"))
    assertFalse(record.wrote(link(30)).contains(link(30)), "protect after links keeps the links")
  }
```

`GlueRulesTest.kt` (F2): the text pin on the module, using the file's own `glue(name)` helper (`:194`, which requires exactly one file of that name). Note the file is `CaptureEngineModule.kt` (the controller's ruling called it `Module.kt`):

```kotlin
  @Test
  fun `the scoring link is the module's second answering call, an AsyncFunction on the Promise (R-F3), and no event carries it`() {
    val module = glue("CaptureEngineModule.kt")
    val pattern = Regex("""AsyncFunction\("scoringLink"\)\s*\{\s*promise: Promise ->\s*core\.scoringLink \{ answer -> promise\.resolve\(answer\) \}\s*\}""")
    assertEquals(1, pattern.findAll(module).count(), "one AsyncFunction, resolved with the core's answer, point to point")
    assertEquals(1, Regex("""AsyncFunction\("takePhoto"\)""").findAll(module).count(), "PR B's call is still the other one")
    assertEquals(2, Regex("""\bAsyncFunction\(""").findAll(module).count(), "two calls answer, no more (AGENTS §2)")
    assertTrue(Regex("""Events\("onSnapshot", "onRecord", "onAck"\)""").containsMatchIn(module), "the three events, and the scoring link is none of them")
    assertFalse("onScoringLink" in module, "no event")
    assertFalse(Regex("""fun scoringLink""").containsMatchIn(glue("AndroidPlatform.kt")), "the platform does not carry the answer")
  }
```

Host harness tests (F1), JVM host module (`./gradlew :host:test`):

`ScriptedServerTest.kt`: in the `m-4` test add `"host/scoring-link-ok" to ask("${ScriptedServer.ORIGIN}/scoring-link").body` to `ours` and move `assertEquals(3, checked, …)` to `4`; in `a script for an unknown path is refused…` add `assertEquals(200, ask("${ScriptedServer.ORIGIN}/scoring-link").status)`; add:

```kotlin
  @Test
  fun `a scoring-link request is its own path, scriptable, and the default link is the host's on the staging host`() {
    val request = HttpRequest("POST", "${ScriptedServer.ORIGIN}/scoring-link", emptyList(), "{}")
    assertEquals("scoring-link", server.path(request))
    assertEquals("https://stg.seazn.club/score/${ScriptedServer.SCORING_SECRET}", JSONObject(ask("${ScriptedServer.ORIGIN}/scoring-link").body).getString("url"))
    server.script("scoring-link", 409, JSONObject("""{"code":"replaced","message":"m"}"""))
    assertEquals(409, ask("${ScriptedServer.ORIGIN}/scoring-link").status)
    assertEquals(200, ask("${ScriptedServer.ORIGIN}/beats").status, "other paths keep theirs")
    assertEquals(46, ScriptedServer.SCORING_SECRET.length)
  }
```

`ProtocolTest.kt`:

```kotlin
  @Test
  fun `a scoring-link answer is one line naming its call, with the answer inside`() {
    val line = Protocol.scoringLink(7, mapOf("outcome" to "rate_limited", "retryAfterS" to 30.0))
    assertFalse('\n' in line)
    val json = JSONObject(line)
    assertEquals("scoringLink", json.getString("ev"))
    assertEquals(7, json.getInt("call"))
    assertEquals("rate_limited", json.getJSONObject("answer").getString("outcome"))
    assertEquals(30, json.getJSONObject("answer").getInt("retryAfterS"))
  }

  /** The link's secret leaves the host in exactly one line, the answer to the call that asked, and in no snapshot, record or request line. */
  @Test
  fun `the scoring link reaches the caller once and no other line the host writes carries its secret`() {
    val out = mutableListOf<String>()
    val executor = ExecutorScheduler()
    val host = Host(executor) { synchronized(out) { out += it } }
    host.handle("""{"op":"send","seq":1,"intent":${ScriptedServer.PAIR}}""")
    executor.drain()
    await(out) { it.getString("ev") == "snapshot" && it.getJSONObject("body").getJSONObject("state").getString("kind") == "paired" }
    host.handle("""{"op":"scoringLink","call":1}""")
    executor.drain()
    await(out) { it.getString("ev") == "scoringLink" && it.getInt("call") == 1 }
    // A refusal, scripted, then asked again: the sequence, and a second call number.
    host.handle("""{"op":"script","path":"scoring-link","status":409,"body":{"code":"replaced","message":"m"}}""")
    host.handle("""{"op":"scoringLink","call":2}""")
    executor.drain()
    await(out) { it.getString("ev") == "scoringLink" && it.getInt("call") == 2 }
    val all = synchronized(out) { out.toList() }
    val answers = all.map(::JSONObject).filter { it.getString("ev") == "scoringLink" }
    assertEquals(listOf("ok", "replaced"), answers.map { it.getJSONObject("answer").getString("outcome") })
    assertEquals("https://stg.seazn.club/score/${ScriptedServer.SCORING_SECRET}", answers[0].getJSONObject("answer").getString("url"))
    assertFalse(answers[1].getJSONObject("answer").has("url"))
    val carrying = all.filter { ScriptedServer.SCORING_SECRET in it }
    assertEquals(1, carrying.size, "only the first answer carries the secret")
    assertEquals("scoringLink", JSONObject(carrying.single()).getString("ev"))
    // Anti-vacuity: the lines it was kept out of exist (the snapshots, the record, and the scoring-link request itself).
    val events = all.map { JSONObject(it).getString("ev") }
    assertTrue(events.count { it == "snapshot" } > 0 && events.count { it == "record" } > 0 && events.count { it == "request" } > 0)
    executor.shutdown()
  }
```

(`await` is the file's own helper; read how the sibling test calls it and copy the signature.)

- [ ] **Step 3: Run red.** Command as in Task 2 with `BodiesTest`, `ScoringLinkTest`, `SessionRecordTest`, `HostsTest`, `ScrubParityTest`, `GlueRulesTest`; and `./gradlew :host:test --tests 'com.seazn.capture.engine.host.ProtocolTest' --tests 'com.seazn.capture.engine.host.ScriptedServerTest'`. Expect compile errors; record the counts after Step 4.

- [ ] **Step 4: Implement.**

`adapter/Http.kt`, in `HttpRequests` after `start`:

```kotlin
  /** §10: the same auth and body as `start` (web ask: `{phone}`); never retried by the engine, called on a tap only. */
  fun scoringLink(url: String, bearer: String, body: String): HttpRequest = post(url, bearer, body)
```

`adapter/ScoringLinks.kt`:

```kotlin
package com.seazn.capture.engine.adapter

import java.util.concurrent.atomic.AtomicBoolean

/**
 * The scoring-link route's answer (capture-scoring-link.v1). A link is a scoring credential for one fixture
 * (spec §10): `toString` prints a length, never the URL, and nothing here writes it anywhere but [ScoringLinks.wire].
 */
sealed interface ScoringLinkAnswer {
  /** "ok", or a refusal word (plan decision D3). */
  val word: String

  class Link(val url: String) : ScoringLinkAnswer {
    override val word: String get() = "ok"
    override fun toString(): String = "Link(url=<${url.length} chars>)"
  }

  class Refused(override val word: String, val retryAfterS: Int?) : ScoringLinkAnswer {
    override fun toString(): String = "Refused($word)"
  }
}

object ScoringLinks {
  /** What the module's promise resolves with: the one place the URL leaves native. Every number a Double. */
  fun wire(answer: ScoringLinkAnswer): Map<String, Any?> =
    linkedMapOf<String, Any?>("outcome" to answer.word).also {
      when (answer) {
        is ScoringLinkAnswer.Link -> it["url"] = answer.url
        is ScoringLinkAnswer.Refused -> answer.retryAfterS?.let { s -> it["retryAfterS"] = s.toDouble() }
      }
    }

  /** The link's secret: the `dl_` segment, which the record protects before the answer is handed over. */
  fun secret(url: String): String = url.substringAfterLast('/')
}

/**
 * RP4. One tap's hand-over, and the only thing between a tap and `GuardedScheduler`'s failure path. Everything the call
 * does runs through [apart], so what the transport, the reading or the caller's own [resolve] throws (an `Error` included:
 * `BridgeCore.ask` catches only `Exception`) answers `unavailable`, is noted by its class, and stops here. Without it a
 * `LinkageError` (an `UnsatisfiedLinkError` from a missing TLS library is the realistic one) reaches `BridgeCore.failed`,
 * which holds it against the process for good and ends the pairing: a tap on a side button would end a broadcast.
 * [hand] answers the caller at most once, whoever asks. One tap, one tap object; never shared.
 */
internal class ScoringTap(private val resolve: (Map<String, Any?>) -> Unit, private val note: (Throwable) -> Unit) {
  private val handed = AtomicBoolean(false)

  /** True once the caller has been answered (or has been tried): a late backstop has nothing left to say. */
  val spent: Boolean get() = handed.get()

  /** The first call answers the caller; a later one is dropped. A throw from [resolve] is the caller's own to [apart]. */
  fun hand(wire: Map<String, Any?>) {
    if (handed.compareAndSet(false, true)) resolve(wire)
  }

  /**
   * Runs [work]; if it throws, answers `unavailable` (once, if nothing has been handed yet) and notes the throwable.
   * A [resolve] that is dead as well is noted too, and the second throw stops here, never at the failure path.
   */
  fun apart(work: () -> Unit) {
    try {
      work()
    } catch (failure: Throwable) {
      val again = try {
        hand(UNAVAILABLE)
        null
      } catch (second: Throwable) {
        second
      }
      note(failure)
      again?.let(note)
    }
  }

  private companion object {
    val UNAVAILABLE = ScoringLinks.wire(ScoringLinkAnswer.Refused("unavailable", null))
  }
}
```

`adapter/Bodies.kt` (add near `start`):

```kotlin
  /** capture-scoring-link.v1 `$defs.ok.url`: the server's https origin, `/score/`, and `dl_` with 43 base64url characters. */
  private val SCORING_URL = Regex("https://[^/]+/score/dl_[A-Za-z0-9_-]{43}")

  /**
   * A tap's answer (spec §10, web ask W27). By status and `code`, like [start]: a 401 or 404 only from the
   * server's refusal naming it (X1), so a captive portal's page is unavailable, never "code ended". A 2xx is
   * a link only when its `url` is exactly the contract's shape on the build's own Seazn host: anything else
   * is no link and is never shown as a QR. The URL is a credential, so nothing here prints it.
   */
  fun scoringLink(status: Int, body: String, retryAfterS: Int?, env: Environment): ScoringLinkAnswer {
    val fields = obj(body)
    val code = fields?.get("code") as? String
    val none = ScoringLinkAnswer.Refused("unavailable", null)
    return when {
      status in 200..299 -> {
        val url = (fields?.get("url") as? String)?.takeIf { SCORING_URL.matches(it) && Hosts.onSeazn(it, env) }
        url?.let { ScoringLinkAnswer.Link(it) } ?: none
      }
      status == 401 || status == 404 -> if (unconfirmed(status, fields)) none else ScoringLinkAnswer.Refused("code_ended", null)
      status == 409 && code == "replaced" -> ScoringLinkAnswer.Refused("replaced", null)
      status == 409 && code == "match_finished" -> ScoringLinkAnswer.Refused("match_finished", null)
      status == 402 && code == "not_entitled" -> ScoringLinkAnswer.Refused("not_entitled", null)
      status == 429 && code == "rate_limited" -> ScoringLinkAnswer.Refused("rate_limited", retryAfterS)
      else -> none
    }
  }
```

(`unconfirmed(401, fields)` is true unless `code == "code_ended"`, and `unconfirmed(404, …)` unless `code == "not_a_stream_code"`, from the file's own `ENDING` map at `:70`, as `start` uses it at `:266`.)

`core/SessionRecord.kt` (F15): the link bucket, kept apart from what `protect` holds so a link can never evict the pairing token. Rename the three accumulators `protect` builds (`secrets`, `urlSecrets`, `textOnly`) to `heldSecrets`, `heldUrlSecrets`, `heldTextOnly`, keep the fields the scrub reads (`secrets`, `urlSecrets`, `textSecrets`) as the derived ones, and:

```kotlin
  /** The secrets of scoring links, newest last: at most [LINK_SECRETS], no value twice. A bucket of its own, so a link never evicts the token. */
  private val links = ArrayDeque<String>()

  fun protect(secrets: List<String>, notInUrls: List<String> = emptyList(), inTextOnly: List<String> = emptyList()) {
    heldSecrets = adding(heldSecrets, secrets)
    heldUrlSecrets = adding(heldUrlSecrets, secrets - notInUrls.toSet())
    heldTextOnly = adding(heldTextOnly, inTextOnly)
    refresh()
  }

  /**
   * Spec §10: a scoring link's secret, protected before the answer that carries it is handed to the caller. It is
   * masked everywhere a [protect]ed value is. A repeat (the server returns the same link) moves it to the newest
   * place and adds nothing; past [LINK_SECRETS] distinct links the oldest is dropped. A link 16 re-issues old is long
   * revoked (an organiser's Revoke & reissue is the only thing that changes one), so the bound costs nothing real,
   * and the bucket cannot grow for as long as a phone taps.
   */
  fun protectLink(secret: String) {
    if (secret.isBlank()) return
    links.remove(secret)
    links.addLast(secret)
    while (links.size > LINK_SECRETS) links.removeFirst()
    refresh()
  }

  private fun refresh() {
    val forLinks = withEncodings(links.toList())
    secrets = (heldSecrets + forLinks).distinct().sortedByDescending { it.length }
    urlSecrets = (heldUrlSecrets + forLinks).distinct().sortedByDescending { it.length }
    textOnly = heldTextOnly
    textSecrets = (secrets + textOnly).distinct().sortedByDescending { it.length }
  }
```

and in the `companion object`: `const val LINK_SECRETS = 16`. (If `textOnly` is only read by `protect` today, drop the derived `textOnly` and read `heldTextOnly` in `refresh`; keep whichever the compiler leaves unused-free under `allWarningsAsErrors`.)

`adapter/BridgeCore.kt` (next to `send`/`report`):

```kotlin
  /**
   * Spec §10, from any thread, on a tap only: ask the server for this match's Remote scoring link with the
   * pairing's own bearer and the start's body, and hand [answer] the result once. It bypasses the machine on
   * purpose: it changes no state, and a repeat returns the same link (the server never revokes one). The
   * request is guarded by [ask]'s own backstop ([ANSWER_BACKSTOP_MS]), so [answer] runs at the latest then,
   * with the word `unavailable`: the module's promise always resolves. With no pairing it is answered at once,
   * with no request. [answer] runs on the scheduler thread. The record learns the word and the status, never the
   * URL, whose secret is protected before [answer] is called.
   *
   * RP4: **off the machine's failure path.** Each stage is a guarded task whose body runs in [ScoringTap.apart], so a
   * throw from the transport, the reading or [answer] itself answers `unavailable` and is noted by its class; it never
   * reaches [failed], which would hold a `LinkageError` against the process and end the pairing.
   */
  fun scoringLink(answer: (Map<String, Any?>) -> Unit) {
    val tap = ScoringTap(answer) { failure ->
      engine.log(RecordEntry("scoring-link", listOf("result" to "failed", "error" to failure.javaClass.simpleName)))
    }
    guarded.schedule(0) { tap.apart { scoringAsk(tap) } }
  }

  private fun scoringAsk(tap: ScoringTap) {
    val pairing = engine.phase.pairing
    if (pairing == null) {
      tap.hand(ScoringLinks.wire(ScoringLinkAnswer.Refused("unavailable", null)))
      return
    }
    val env = pairing.request.environment
    ask({ HttpRequests.scoringLink("${pairing.request.codeUrl}/scoring-link", pairing.token, Beats.startBody(pairing.phone.phoneId)) }) { outcome ->
      guarded.schedule(0) { tap.apart { scoringAnswered(outcome, env, tap) } }
    }
  }

  private fun scoringAnswered(outcome: HttpOutcome, env: Environment, tap: ScoringTap) {
    // An Error out of the transport leaves ask before it can cancel its backstop; the backstop then answers into a tap
    // that was answered already, and must not write a second line for it.
    if (tap.spent) return
    val answered = outcome as? HttpOutcome.Answered
    val read = if (answered == null) ScoringLinkAnswer.Refused("unavailable", null) else Bodies.scoringLink(answered.status, answered.body, Bodies.retryAfter(answered.retryAfter), env)
    if (read is ScoringLinkAnswer.Link) record.protectLink(ScoringLinks.secret(read.url))
    engine.log(RecordEntry("scoring-link", listOf("result" to read.word, "status" to answered?.status)))
    tap.hand(ScoringLinks.wire(read))
  }
```

(`engine.log(RecordEntry(…))` is the idiom `BridgeCore.kt:411` uses. `record.protectLink` comes before the line and before `tap.hand`. Note what that order does and does not prove: `engine.log` and the module's `core.log` both post to the one FIFO scheduler, so a line cannot be written between two statements of this task; the order is a statement of intent that no test can tell from its reverse, and the test that matters is that the secret IS protected by the time any later line is written, which `a link's secret is masked …` pins.)

`modules/capture-engine/src/scrub/allow-list.json` (RP1): add to `kinds`, between `resumed` (`:208`) and `scripted` (`:209`) at `a9079cf` (that stretch is alphabetical: `resumed`, `scoring-link`, `scripted`), `"scoring-link": "native: a tap asked for the Remote scoring link; its word and status only, never the url; or, when the call failed locally (RP4), result failed and the throwable's class name"`. `result`, `status` and `error` are on the `plain` list already. **No key is added to `never`** (F16): the secret's protection is by value, tested above, not by a key. Update the kind counts that sweep the file: `ScrubParityTest.kt:78` (`assertEquals(83, kinds.size)`) and `src/services/scrubParity.test.ts:66-68` ("the record's 83 kinds") both become 84.

`CaptureEngineModule.kt` (RP1, RP6; lines are `a9079cf`'s: `takePhoto` is `:36-37`, `Events` `:16`, the `View` `:40`, and the intent comment above `send` says "every one returns nothing" at `:30`; the file already imports `expo.modules.kotlin.Promise` for `takePhoto`). Two edits. PR B's comment at `:36`, "Spec §8: the one call that answers (AGENTS §2, recorded). It resolves "saved" or "failed", within native's bound.", is reworded (the call itself is untouched), and the new call goes right after `:37`, before the blank line and the `View`:

```kotlin
    // Spec §8: one of the two calls that answer (the other is scoringLink; AGENTS §2, recorded). It resolves "saved" or "failed", within native's bound.
    AsyncFunction("takePhoto") { promise: Promise -> EngineHost.capture(app()).takePhoto { word -> promise.resolve(word) } }
    // Spec §10, a tap: the other call that answers (AGENTS §2). The promise is resolved once, by the core, point to
    // point; no event carries the link, so no other listener can hear it. Its own bound is native's ANSWER_BACKSTOP_MS.
    AsyncFunction("scoringLink") { promise: Promise ->
      core.scoringLink { answer -> promise.resolve(answer) }
    }
```

`capture/Capture.kt:45` (RP6, a comment only): "The one call that answers, recorded in AGENTS §2." becomes "One of the two calls that answer (the other is `scoringLink`), recorded in AGENTS §2.".

`host/ScriptedServer.kt`: `PATHS = setOf("beat", "code", "start", "scoring-link")`; in `path()` add `request.url.endsWith("/scoring-link") -> "scoring-link"` before the `CODE_URL` branch; in `unscripted` add `"scoring-link" -> JSONObject().put("url", "https://stg.seazn.club/score/$SCORING_SECRET")`; the class doc's "The stdin protocol names the paths `beat`, `code` and `start`" gains `scoring-link`; and in the companion:

```kotlin
    /** The host's made-up scoring secret: `dl_` and 43 base64url characters, the contract's shape. No line but the call's own answer may carry it. */
    const val SCORING_SECRET = "dl_HostLinkAbCdEfGhIjKlMnOpQrStUvWxYz012345678"
```

`host/Protocol.kt`:

```kotlin
  /** An `AsyncFunction`'s answer: `{"ev":"scoringLink","call":N,"answer":{…}}`, the call it resolves and the value Expo would resolve it with. */
  fun scoringLink(call: Int, answer: Map<String, Any?>): String = encode("scoringLink", mapOf("call" to call.toDouble(), "answer" to answer))
```

`host/Host.kt`: the class doc's list of ops gains `scoringLink`, and in `handle`'s `when`, after `"log"`:

```kotlin
        // §10: the module's AsyncFunction("scoringLink"), through the same core call; the answer is one event naming the call.
        "scoringLink" -> {
          val call = json.getInt("call")
          core.scoringLink { answer -> write(Protocol.scoringLink(call, answer)) }
        }
```

(`ScriptedPlatform` needs no change: it already writes a `request` event for every path `ScriptedServer.path` names, and the default answer is served by `ScriptedServer.answer`.)

- [ ] **Step 5: Run green** (the Kotlin classes of Step 3), read the XML counts. Then `./gradlew :host:installDist` once (the bridge project in Task 6 runs the built host, so a stale binary is the inert seam), and `cd "$WT" && pnpm vitest run --project domain src/services/scrub.test.ts src/services/scrubParity.test.ts modules/capture-engine/src/hostVectors.test.ts modules/capture-engine/src/serverBodies.test.ts`.

- [ ] **Step 6: Mutations (named, each alone).** (a) `protect`: delete the `record.protectLink(…)` line in `scoringAnswered`; `a link's secret is masked under url and inside a message` and the host's `…no other line the host writes carries its secret` must fail. (b) `protect the url, not the secret`: pass `read.url` to `protectLink`; the bare-secret `message` assertion must fail (`x *** y`). (c) `host gate`: remove `&& Hosts.onSeazn(it, env)` from `Bodies.scoringLink`; the `off the build's host` and `userinfo` rows must fail. (d) `shape gate`: loosen `SCORING_URL` to `https://[^/]+/score/.+`; the `short secret` and `http` rows must fail. (e) `401 portal`: replace `unconfirmed(status, fields)` with `false`; the `401 that is not the server's refusal` row must fail. (f) `no pairing`: make `scoringAsk` ask with a null pairing (`pairing!!`); the `with no pairing` test must fail on its new no-line assertion (the `NullPointerException` is caught and noted, so the answer alone would still read `unavailable`). (g) `bucket cap`: change `LINK_SECRETS` to 17; `the 17th distinct one evicts the oldest` must fail. (h) `bucket dedupe`: delete `links.remove(secret)`; `a repeated link never pushes another out` must fail. (i) `bucket isolation`: in `refresh`, build `secrets` from the links alone (drop `heldSecrets`); `a pairing token is never evicted by links` must fail. (j) `module`: change the module's `promise.resolve(answer)` to a no-op; the `GlueRulesTest` pin must fail. (k) `host op`: delete the `"scoringLink"` branch in `Host.handle`; `the scoring link reaches the caller once` must fail (and Task 6's bridge case after it). (l) `host path`: drop `"scoring-link"` from `PATHS`; `a script for an unknown path` / the scripted refusal must fail. **RP4, the failure path** (each alone): (m) `stage 1 unguarded`: `guarded.schedule(0) { tap.apart { scoringAsk(tap) } }` becomes `guarded.schedule(0) { scoringAsk(tap) }`; `a transport that throws` must fail, and its assertion message must name an `Error` row (`UnsatisfiedLinkError`: state `ended`, `stickyFailure` true; `Error(jni)`: `taskFailures` 1 and no answer), never one of the two `Exception` rows, which `ask`'s own catch always answered (they are the control); `after a throw out of the transport the backstop…` and `a callback that is dead as well` must fail too. (n) `stage 2 unguarded`: `tap.apart { scoringAnswered(outcome, env, tap) }` becomes `scoringAnswered(outcome, env, tap)`; `a callback that throws is noted by its class` must fail (the `UnsatisfiedLinkError` reaches `failed` and ends the pairing). (o) `spent`: delete `if (tap.spent) return` in `scoringAnswered`; the backstop test must fail on `the late backstop wrote a second line`. (p) `hand once`: `hand` always calls `resolve(wire)` (drop the `compareAndSet`); `the tap hands over once`, and `a callback that throws…` (`calls` is 2) must fail. (q) `note`: delete `note(failure)` in `apart`; the backstop test and both callback tests must fail on the missing line. (r) `dead callback`: drop the inner `try` around `hand(UNAVAILABLE)` in `apart`; `a callback that is dead as well` must fail (the second throw reaches `failed`). (s) `unavailable`: delete `hand(UNAVAILABLE)` from `apart`; the three `Error` rows must fail on the missing answer. Restore each from `"$TMPDIR"`.

  **One mutant that is equivalent, and is not to be "killed" with a vacuous test:** moving `record.protectLink(…)` after the `engine.log(…)` line or after `answer(…)` inside `scoringAnswered`. `engine.log` and the module's `core.log` both post to the one FIFO scheduler, and the `scoring-link` line carries no secret, so no line can be written between those statements; the order is invisible to any observer on or off the scheduler thread. Say so in the report; the protection that matters is pinned by (a) and (b).

- [ ] **Step 7: Commit** `feat(engine): the Remote scoring link, an AsyncFunction asked on a tap with the pairing's bearer; the url crosses once and is never recorded (spec §10)`.

---

## Task 6: The JS side of the call, the host over the bridge, and the leak guards

R-F3: the JS side is a port over one promise, in the shape of PR B's `photoPort` (`src/services/photoPort.ts`): `createScoringLinkPort(call | null, deps)`. It has a 12 s deadline, drops a late answer, never rejects, and protects the link's secret before it can be logged. It is assembled in the composition root by a pure function, `scoringLinkPortFor(native, { logger, hosts })`, beside `photoPortFor` (RP3), never by an inline expression in `nativePorts.ts`, and `nativePorts.ts` keeps `photo: photoPortFor(native)`.

**Files:**

- Create: `src/services/scoringLinkPort.ts`, `src/services/scoringLinkPort.test.ts`, `src/hooks/scoringLinkPortWiring.ts`, `src/hooks/scoringLinkPortWiring.test.ts` (RP3), `test/fakeScoringLinkPort.ts`, `modules/capture-engine/src/scoringLinkBodies.test.ts`
- Modify: `modules/capture-engine/src/nativeModule.ts` (the call, and the two "answers" claims at `:13` and `:25`, RP6), `modules/capture-engine/src/testing/FakeNativeModule.ts` (after `takePhoto`, `:34-40`), `test/hostEngine.ts` (`HostLine` `:32-37`, `HostModule` `:51` and its `takePhoto` stub `:72-75`, `bounded` `:133`, the line switch `:160`; F1), `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts` (F2), `src/services/logger.ts`, `src/services/photoPort.ts` (the doc comment at `:3` only, RP6), `src/hooks/usePorts.tsx` (the new member, and the comment at `:69`, RP6), `src/hooks/nativePorts.ts` (one added line, RP3), `test/fakePorts.ts`
- Test: `src/services/logger.test.ts` (the link bucket), `src/services/scoringLinkPort.test.ts`, `src/hooks/scoringLinkPortWiring.test.ts`, `src/hooks/photoPortWiring.test.ts` (the `wiringOf` AST pin, extended; RP3), `modules/capture-engine/src/scoringLinkBodies.test.ts`, `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts` (the `bridge` project), `test/hostEngine.test.ts` (the harness guards that need no JVM, run on every push) and `test/fakePorts.test.ts`
- Not touched: `engineWiring.ts` (no `chooseScoringLink`: R-F3 leaves one port and one wiring line), `photoPortWiring.ts` (the photo wiring stays as PR B wrote it; the scoring link has a sibling file, not an addition to it)

**Interfaces:**

- Consumes: Task 5's module call `scoringLink(): Promise<unknown>` resolving `{outcome, url?, retryAfterS?}`; PR B's `photoPort.ts` as the shape to copy, and PR B's `photoPortWiring.ts` (`photoPortFor`) and its `wiringOf` AST pin in `photoPortWiring.test.ts` as the shape of the wiring and its test; `httpsHost` from `@/domain/credentials/wire` and `seaznHosts` from `@/services/seaznHosts` (F14: the one host rule, not a second regex).
- Produces:

```ts
// src/services/scoringLinkPort.ts
export const SCORING_WORDS = [
  "code_ended",
  "replaced",
  "match_finished",
  "not_entitled",
  "rate_limited",
  "unavailable",
] as const;
export type ScoringWord = (typeof SCORING_WORDS)[number];
export type ScoringLinkOutcome =
  | { readonly kind: "ok"; readonly url: string }
  | {
      readonly kind: "refused";
      readonly word: ScoringWord;
      readonly retryAfterS: number | null;
    };
export interface ScoringLinkPort {
  /** Never rejects and never takes longer than the deadline. */ request(): Promise<ScoringLinkOutcome>;
}
export const SCORING_URL: RegExp; // ^https://[^/]+/score/dl_[A-Za-z0-9_-]{43}$
export const SCORING_DEADLINE_MS: number; // 12_000
export function scoringSecret(url: string): string;
export function readAnswer(value: unknown, host: string): ScoringLinkOutcome; // pure
export function createScoringLinkPort(
  call: (() => Promise<unknown>) | null,
  deps: {
    protect: (secret: string) => void;
    host: string;
    deadlineMs?: number;
  },
): ScoringLinkPort;
// CaptureEngineNative gains: scoringLink(): Promise<unknown>;
// Logger gains: protectLink(secret: string): void;          (a bucket of its own: at most 16, newest kept, deduplicated)
// Ports gains: readonly scoringLink: ScoringLinkPort;
// test/fakeScoringLinkPort.ts: FakeScoringLinkPort = ScoringLinkPort & { calls; answerWith(outcome); hold(); release(outcome?) }
// test/hostEngine.ts: HostEngine gains scoringLink(): Promise<unknown> and script(path, status, body): void
// src/hooks/scoringLinkPortWiring.ts   (RP3: pure, beside photoPortFor; nativePorts.ts calls it, never createScoringLinkPort)
export function scoringLinkPortFor(
  native: Pick<CaptureEngineNative, "scoringLink"> | null,
  deps: {
    readonly logger: Pick<Logger, "protectLink">;
    readonly hosts: readonly string[];
  },
): ScoringLinkPort; // host = deps.hosts[0] ?? ''; protect = deps.logger.protectLink
```

- [ ] **Step 1: Failing tests.**

`scoringLinkBodies.test.ts` (ajv, the contract is the authority; reads Task 5's vector file):

```ts
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import vectors from "./wire/scoring-link-vectors.json";

const contract = JSON.parse(
  readFileSync(
    new URL(
      "../../../test/fixtures/contracts/capture-scoring-link.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { $id: string };
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(contract);
const ok = ajv.getSchema(`${contract.$id}#/$defs/ok`)!;
const refusal = ajv.getSchema(`${contract.$id}#/$defs/refusal`)!;

// A 2xx body is held to $defs.ok and anything else to $defs.refusal, unless the row says the contract refuses it too.
const rows = vectors.cases.filter((row) => "body" in row);

describe("the made-up scoring-link bodies are the contract’s shapes", () => {
  it("sweeps 18 of the 19 rows (the portal page has no JSON body)", () => {
    expect(vectors.cases).toHaveLength(19);
    expect(rows).toHaveLength(18);
  });
  it.each(rows.map((row) => [row.why, row] as const))("%s", (_why, row) => {
    const validate = row.status >= 200 && row.status < 300 ? ok : refusal;
    const expectedValid =
      (row as { contractValid?: boolean }).contractValid ?? true;
    expect(validate(row.body)).toBe(expectedValid);
  });
});
```

`scoringLinkPort.test.ts` (`domain` project; the file's idiom follows `photoPort.test.ts`, fake timers on):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNativeModule } from "@/engine/testing/FakeNativeModule";
import { seaznHosts } from "@/services/seaznHosts";
import {
  createScoringLinkPort,
  readAnswer,
  SCORING_DEADLINE_MS,
  scoringSecret,
  type ScoringLinkOutcome,
} from "@/services/scoringLinkPort";
import vectors from "@/engine/wire/scoring-link-vectors.json";

/** Made up: the contract's shape (`dl_` and 43 base64url characters). Never a real link. */
const SECRET = "dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const HOST = "stg.seazn.club";
const URL_OK = `https://${HOST}/score/${SECRET}`;
const UNAVAILABLE: ScoringLinkOutcome = {
  kind: "refused",
  word: "unavailable",
  retryAfterS: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
```

Cases (each is a `describe`/`it` with a real assertion):

1. **`readAnswer`, the pure reading.** One table, `it.each`:

| native says                                                                | reads as                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| `{ outcome: 'ok', url: URL_OK }`                                           | `{ kind: 'ok', url: URL_OK }`                   |
| `{ outcome: 'replaced' }`                                                  | refused `replaced`, `retryAfterS: null`         |
| `{ outcome: 'rate_limited', retryAfterS: 30 }`                             | refused `rate_limited`, 30                      |
| `{ outcome: 'rate_limited' }`                                              | refused `rate_limited`, null                    |
| `{ outcome: 'rate_limited', retryAfterS: -1 }` and `'30'` and `NaN`        | `retryAfterS: null` (one row each)              |
| `{ outcome: 'replaced', retryAfterS: 30 }`                                 | `retryAfterS: null` (only a rate limit has one) |
| `{ outcome: 'teapot' }`                                                    | unavailable                                     |
| `{ outcome: 'ok' }`                                                        | unavailable                                     |
| ok, `url` off the build's host (`https://seazn.club/score/…`)              | unavailable                                     |
| ok with `http`                                                             | unavailable                                     |
| ok with a short secret                                                     | unavailable                                     |
| ok, userinfo naming another host (`https://stg.seazn.club@evil.example/…`) | unavailable                                     |
| ok, upper-case host (`https://STG.seazn.club/…`)                           | `{ kind: 'ok', url }`                           |
| `{ outcome: 'replaced', url: URL_OK }`                                     | refused `replaced` (a refusal's url is ignored) |
| `null`, `undefined`, `'ok'`, `3`, `[]` (one row each)                      | unavailable                                     |

and a count: `expect(rows).toHaveLength(N)` for the number of rows written. With an empty `host` (`''`) every `ok` reads unavailable (a build that trusts no host).

2. **F14, parity with Kotlin over the shared vectors.** For the 2xx rows of `scoring-link-vectors.json` that carry a `url` (7 of the 19), feed the JS reader the answer a hostile native would give, `{ outcome: 'ok', url: row.body.url }`, with `host = seaznHosts(row.env)[0]`: it reads `ok` exactly when the row's `expected` is `ok`. Assert the count (7), that 3 are ok and 4 are refused, so a file with the rows removed cannot pass. This is the JS gate held to the same rows as Kotlin's `Bodies.scoringLink`, each gate refusing alone (Review Focus 5).

3. **The port.**
   - asks the module each time and resolves its answer: over a `FakeNativeModule` (`scoringAnswer = { outcome: 'ok', url: URL_OK }`), `request()` resolves `{ kind: 'ok', url: URL_OK }`, `module.scoringCalls` is 1, then 2 after a second `request()`; `vi.getTimerCount()` is 0 after each (the timer is cleared on settle).
   - **protects the secret first:** `protect` and the resolution write into one shared `order` array; the result is `['protect', 'resolved']`, and `protect` was handed `scoringSecret(URL_OK)` (which equals `SECRET`, and `SECRET.length` is 46: the anti-vacuity guard that the made-up value is the contract's shape).
   - a refusal, a bad answer and an unavailable never reach `protect`.
   - `null` call is unavailable; a rejection and a synchronous throw are both unavailable, never an exception.
   - **M-deadline: gives up at the deadline exactly.** A call that never answers: at `SCORING_DEADLINE_MS - 1` the request is pending, at `SCORING_DEADLINE_MS` it resolves unavailable. `expect(SCORING_DEADLINE_MS).toBe(12_000)` (the controller's ruling; native's own bound is `ANSWER_BACKSTOP_MS` 16 000, P7, so JS always gives up first).
   - **A late answer is dropped, and its secret is still protected.** After the deadline, resolve the held call with `{ outcome: 'ok', url: URL_OK }`: the request's outcome is still unavailable (check by awaiting the promise captured before, and that a fresh variable set by `.then` did not change), and `protect` WAS called with the secret once (a late native answer cannot change the result, but its secret reached JS memory and the record must mask it).
   - **Sequence:** a rate limit, then a success, then a second success on the same link: three `request()`s, three module calls, the outcomes in order, `protect` called twice with the same secret.
   - two requests in flight at once resolve each its own answer (a held first and an immediate second).
   - **The real logger, the JS twin of Task 5's native test, lives in `scoringLinkPortWiring.test.ts`** (RP3), because it has to go through the production wiring (`scoringLinkPortFor`) and not a hand-written copy of it; this file stays with the port alone and a `protect` stub.

`logger.test.ts` (the link bucket, F15), in the file's idiom (`createRingRecord`, `parsed`, `SCRUBBED`). Every secret is made up: `link(n)` is `dl_` + two digits + 41 `B`s (43 characters after `dl_`). Read `scrub.ts` for exactly what free text becomes after `release()` (it is `SCRUBBED` whole) and adjust the one expectation that depends on it.

```ts
const link = (n: number) => `dl_${String(n).padStart(2, "0")}${"B".repeat(41)}`;

describe("the link bucket (F15)", () => {
  function rig() {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0 });
    // A session in hand, or free text is masked whole and the "shown before" witness below could never show.
    logger.protect({ secrets: ["tok-test-0000000000000"], streamIds: [] });
    /** Logs [secret] inside a message and returns what the record kept of the message. */
    const wrote = (secret: string) => {
      logger.info("probe", { message: `x ${secret} y` });
      return String(parsed(record.lines()).at(-1)?.fields.message);
    };
    return { record, logger, wrote };
  }

  it("protectLink masks a link’s secret in text and under a public url key, and only from then on", () => {
    const { record, logger, wrote } = rig();
    expect(wrote(link(1))).toBe(`x ${link(1)} y`);
    logger.protectLink(link(1));
    expect(wrote(link(1))).toBe(`x ${SCRUBBED} y`);
    logger.info("probe", { url: `https://stg.seazn.club/score/${link(1)}` });
    expect(parsed(record.lines()).at(-1)?.fields.url).toBe(SCRUBBED);
  });

  it("a repeated link never pushes another out of the bucket, and the 17th distinct one evicts the oldest", () => {
    const { logger, wrote } = rig();
    logger.protectLink(link(0));
    logger.protectLink(link(1));
    for (let i = 0; i < 20; i += 1) logger.protectLink(link(1));
    // Deduplicated by value: twenty repeats of link 1 did not push link 0 out.
    expect(wrote(link(0))).toBe(`x ${SCRUBBED} y`);
    for (let n = 2; n <= 16; n += 1) logger.protectLink(link(n));
    // 17 distinct links have been protected (0 to 16) into a bucket of 16: the oldest is out. D11: a link 16 re-issues old is long revoked.
    expect(wrote(link(0))).toBe(`x ${link(0)} y`);
    for (let n = 1; n <= 16; n += 1)
      expect(wrote(link(n))).toBe(`x ${SCRUBBED} y`);
  });

  it("a pairing token is never evicted by links, and a later protect keeps the links", () => {
    const { logger, wrote } = rig();
    for (let n = 0; n <= 30; n += 1) logger.protectLink(link(n));
    expect(wrote("tok-test-0000000000000")).toBe(`x ${SCRUBBED} y`);
    logger.protect({ secrets: ["tok-test-0000000000001"], streamIds: [] });
    expect(wrote(link(30))).toBe(`x ${SCRUBBED} y`);
  });

  it("release forgets nothing: free text is masked whole, and the next protect keeps the links", () => {
    const { logger, wrote } = rig();
    logger.protectLink(link(1));
    logger.release();
    expect(wrote("anything")).toBe(SCRUBBED);
    logger.protect({ secrets: ["tok-test-0000000000002"], streamIds: [] });
    expect(wrote(link(1))).toBe(`x ${SCRUBBED} y`);
  });
});
```

`test/hostEngine.test.ts` (F1; the domain project, **no JVM**): the harness's new call is guarded where every push runs it. A stub host written to a temp dir with a `#!${process.execPath}` shebang (the file's existing mute-host test is the idiom) prints `ready`, acks each `readiness` op by its `seq`, and for each `{"op":"scoringLink","call":N}` it is sent: (1) **out of order:** it holds the first call and, when the second arrives, answers the second before the first (`{"ev":"scoringLink","call":N,"answer":{"outcome":"replaced","call":N}}`); `Promise.all([host.scoringLink(), host.scoringLink()])` resolves each to the answer of its own call number (1 then 2), not to arrival order; (2) **a host that never answers a call:** `scoringLink()` rejects with `no scoring-link answer` within its 5 s budget, and the process is gone after `dispose`. Both end with `await host.dispose()`.

`test/fakePorts.test.ts`: the fake scoring port counts two requests; a held request stays pending until `release`, two held ones release oldest first, and `release(outcome)` resolves with that outcome while a plain `release()` resolves with the default.

**`scoringLinkPortWiring.test.ts`** (new; `domain` project; RP3). `scoringLinkPortFor` is the one place the production port is assembled, so it is tested with stub natives and a recording logger, the way `photoPortWiring.test.ts` tests `photoPortFor`. It is the test of the wiring, not of the port (`scoringLinkPort.test.ts` is that): what it adds is that the right module call, the right logger method and the right host reach the port.

```ts
import { describe, expect, it, vi } from "vitest";
import type { CaptureEngineNative } from "@/engine/nativeModule";
import { FakeNativeModule } from "@/engine/testing/FakeNativeModule";
import { scoringLinkPortFor } from "@/hooks/scoringLinkPortWiring";
import { createLogger } from "@/services/logger";
import { SCRUBBED } from "@/services/scrub";
import { seaznHosts } from "@/services/seaznHosts";
import { createRingRecord, parseRecordLine } from "@/services/sessionRecord";
import {
  FAKE_SCORING_SECRET,
  FAKE_SCORING_URL,
} from "../../test/fakeScoringLinkPort";

type Native = Pick<CaptureEngineNative, "scoringLink">;

/** The made-up link on production's host (FAKE_SCORING_URL is staging's). */
const PRODUCTION_URL = FAKE_SCORING_URL.replace("stg.seazn.club", "seazn.club");
const UNAVAILABLE = {
  kind: "refused",
  word: "unavailable",
  retryAfterS: null,
} as const;

/** A logger that only records which secret it was asked to protect, in [order]. */
const recording = (order: string[]) => ({
  protectLink: vi.fn((secret: string) => {
    order.push(`protect:${secret}`);
  }),
});
const parsed = (lines: readonly string[]) => lines.map(parseRecordLine);

describe("which scoring-link port the composition root wires (spec §10, RP3)", () => {
  const ANSWERS = [
    [
      "a link",
      { outcome: "ok", url: FAKE_SCORING_URL },
      { kind: "ok", url: FAKE_SCORING_URL },
    ],
    [
      "a refusal",
      { outcome: "replaced" },
      { kind: "refused", word: "replaced", retryAfterS: null },
    ],
    [
      "a rate limit",
      { outcome: "rate_limited", retryAfterS: 30 },
      { kind: "refused", word: "rate_limited", retryAfterS: 30 },
    ],
  ] as const;
  let answered = 0;

  it.each(ANSWERS)(
    "a request asks the module exactly once and reads its answer: %s",
    async (_why, said, read) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = said;
      const port = scoringLinkPortFor(module, {
        logger: recording([]),
        hosts: seaznHosts("staging"),
      });
      await expect(port.request()).resolves.toEqual(read);
      expect(module.scoringCalls).toBe(1);
      answered += 1;
    },
  );

  it("answered all 3 kinds of answer (anti-vacuity)", () => {
    expect(ANSWERS).toHaveLength(3);
    expect(answered).toBe(3);
  });

  it("no module (iOS in S1, web) is unavailable, and protects nothing", async () => {
    const order: string[] = [];
    const port = scoringLinkPortFor(null, {
      logger: recording(order),
      hosts: seaznHosts("staging"),
    });
    await expect(port.request()).resolves.toEqual(UNAVAILABLE);
    expect(order).toEqual([]);
  });

  it("a stale module without scoringLink is unavailable, not an exception", async () => {
    const stale = {} as unknown as Native;
    const port = scoringLinkPortFor(stale, {
      logger: recording([]),
      hosts: seaznHosts("staging"),
    });
    await expect(port.request()).resolves.toEqual(UNAVAILABLE);
  });

  it("calls scoringLink on the module, so its this stays bound", async () => {
    const seen: unknown[] = [];
    const native = {
      scoringLink() {
        seen.push(this);
        return Promise.resolve({ outcome: "unavailable" });
      },
    };
    await scoringLinkPortFor(native, {
      logger: recording([]),
      hosts: seaznHosts("staging"),
    }).request();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(native);
  });

  it("protects the link's secret through the logger BEFORE the caller has the answer, and only for a link", async () => {
    const order: string[] = [];
    const ask = (said: unknown) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = said;
      return scoringLinkPortFor(module, {
        logger: recording(order),
        hosts: seaznHosts("staging"),
      })
        .request()
        .then((outcome) => {
          order.push("resolved");
          return outcome;
        });
    };
    await ask({ outcome: "ok", url: FAKE_SCORING_URL });
    expect(FAKE_SCORING_SECRET).toHaveLength(46); // anti-vacuity: the contract's shape, `dl_` and 43
    expect(order).toEqual([`protect:${FAKE_SCORING_SECRET}`, "resolved"]);
    // Not a link: nothing to protect, so protect is never called.
    order.length = 0;
    await ask({ outcome: "replaced" });
    await ask({ outcome: "ok" });
    await ask({ outcome: "ok", url: PRODUCTION_URL }); // off the staging build's host
    expect(order).toEqual(["resolved", "resolved", "resolved"]);
  });

  it("trusts exactly hosts[0]: the build's own Seazn host and no other", async () => {
    const kindOf = async (hosts: readonly string[], url: string) => {
      const module = new FakeNativeModule();
      module.scoringAnswer = { outcome: "ok", url };
      const port = scoringLinkPortFor(module, {
        logger: recording([]),
        hosts,
      });
      return (await port.request()).kind;
    };
    const rows = [
      [seaznHosts("staging"), FAKE_SCORING_URL, "ok"],
      [seaznHosts("staging"), PRODUCTION_URL, "refused"],
      [seaznHosts("production"), PRODUCTION_URL, "ok"],
      [seaznHosts("production"), FAKE_SCORING_URL, "refused"],
      // The first of two, not the last and not any of them.
      [["seazn.club", "stg.seazn.club"], PRODUCTION_URL, "ok"],
      [["seazn.club", "stg.seazn.club"], FAKE_SCORING_URL, "refused"],
      // A build that names no host trusts none.
      [[], FAKE_SCORING_URL, "refused"],
    ] as const;
    for (const [hosts, url, kind] of rows) {
      expect(await kindOf(hosts, url), `${hosts.join(",")} ${url}`).toBe(kind);
    }
    expect(rows).toHaveLength(7);
  });

  it("the real logger behind the real wiring masks the secret in a message and under url once the answer is heard, and not before (the JS twin of the native leak test)", async () => {
    const record = createRingRecord();
    const logger = createLogger({ record, now: () => 0, minLevel: "debug" });
    // A session in hand, or free text is masked whole and the witness below could never show.
    logger.protect({ secrets: ["tok-test-0000000000000"], streamIds: [] });
    logger.info("probe", { message: `x ${FAKE_SCORING_SECRET} y` });
    expect(parsed(record.lines()).at(-1)?.fields.message).toBe(
      `x ${FAKE_SCORING_SECRET} y`,
    ); // the witness: not masked before it is known
    const module = new FakeNativeModule();
    module.scoringAnswer = { outcome: "ok", url: FAKE_SCORING_URL };
    await scoringLinkPortFor(module, {
      logger,
      hosts: seaznHosts("staging"),
    }).request();
    logger.info("probe", {
      url: FAKE_SCORING_URL,
      message: `x ${FAKE_SCORING_SECRET} y`,
    });
    const after = parsed(record.lines()).at(-1);
    expect(after?.fields.message).toBe(`x ${SCRUBBED} y`);
    expect(after?.fields.url).toBe(SCRUBBED);
    expect(record.lines().slice(1).join("")).not.toContain(FAKE_SCORING_SECRET);
  });
});
```

and the function it tests, in `src/hooks/scoringLinkPortWiring.ts` (Step 3 below). **`photoPortWiring.test.ts`: extend the `wiringOf` AST pin** (RP3). It already reads `createNativePorts` from `nativePorts.ts` as a syntax tree and returns what `photo:` is given, what `chooseEngine` gets as `native`, and how often the module is loaded. Make it also return what `scoringLink:` is given: the first argument of its `scoringLinkPortFor(…)` call, and the sorted names of that call's second argument's properties, so a swapped `hosts` or a dropped `logger` is seen. Replace `wiringOf`, `SKELETON` and the two tests that use them (everything from the `function wiringOf` doc comment to the end of the file; the first `describe` of the file is untouched):

```ts
/**
 * `createNativePorts` is the composition root and no test renders it (it imports Expo Router and the device
 * ports), so its photo and scoring-link wiring is read from its source, as `routedApp.drift.test.ts` reads the
 * layout's. The syntax tree has no comments, so a line commented out is not wiring. What it gives `photoPortFor`,
 * what it gives `scoringLinkPortFor` (its module and the names of its dependencies), what it gives `chooseEngine`
 * as `native`, and how often it loads the module.
 */
type Wiring = {
  photo: string | null;
  scoringLink: string | null;
  scoringLinkDeps: string | null;
  engine: string | null;
  loads: number;
};

function wiringOf(source: string): Wiring {
  const file = ts.createSourceFile(
    "nativePorts.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const inside: ts.Node[] = [];
  const collect = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "createNativePorts"
    )
      inside.push(node);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const root = inside[0];
  if (root === undefined) throw new Error("no createNativePorts");
  const result: Wiring = {
    photo: null,
    scoringLink: null,
    scoringLinkDeps: null,
    engine: null,
    loads: 0,
  };
  const calledAs = (node: ts.CallExpression, name: string) =>
    ts.isIdentifier(node.expression) && node.expression.text === name;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && calledAs(node, "loadCaptureEngineNative"))
      result.loads += 1;
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "photo") {
      const call = node.initializer;
      if (ts.isCallExpression(call) && calledAs(call, "photoPortFor")) {
        result.photo = call.arguments
          .map((arg) => arg.getText(file))
          .join(", ");
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === "scoringLink"
    ) {
      const call = node.initializer;
      if (ts.isCallExpression(call) && calledAs(call, "scoringLinkPortFor")) {
        result.scoringLink = call.arguments[0]?.getText(file) ?? null;
        const deps = call.arguments[1];
        result.scoringLinkDeps =
          deps !== undefined && ts.isObjectLiteralExpression(deps)
            ? deps.properties
                .map((property) => property.name?.getText(file) ?? "?")
                .sort()
                .join(", ")
            : null;
      }
    }
    if (ts.isCallExpression(node) && calledAs(node, "chooseEngine")) {
      const options = node.arguments[0];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (property.name?.getText(file) !== "native") continue;
          result.engine = ts.isShorthandPropertyAssignment(property)
            ? property.name.text
            : ts.isPropertyAssignment(property)
              ? property.initializer.getText(file)
              : null;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

const PHOTO = "photoPortFor(native)";
const SCORING = "scoringLinkPortFor(native, { logger, hosts })";
const LOAD = "loadCaptureEngineNative()";
const SKELETON = (photo: string, scoring: string, load: string) => `
  export function createNativePorts() {
    // photo: photoPortFor(null),
    // scoringLink: scoringLinkPortFor(null, { logger, hosts }),
    const native = ${load};
    const wired = chooseEngine({ dev: true, native });
    return { engine: wired.engine, photo: ${photo}, scoringLink: ${scoring} };
  }`;

describe("createNativePorts hands the module it loaded once to the engine, to the photo port and to the scoring-link port", () => {
  it("reads the wiring from a source, and tells a null, a second load, a stray name and a swapped dependency apart", () => {
    expect(wiringOf(SKELETON(PHOTO, SCORING, LOAD))).toEqual({
      photo: "native",
      scoringLink: "native",
      scoringLinkDeps: "hosts, logger",
      engine: "native",
      loads: 1,
    });
    expect(wiringOf(SKELETON("photoPortFor(null)", SCORING, LOAD)).photo).toBe(
      "null",
    );
    expect(
      wiringOf(SKELETON("createPhotoPort(native)", SCORING, LOAD)).photo,
    ).toBeNull();
    expect(
      wiringOf(
        SKELETON(PHOTO, "scoringLinkPortFor(null, { logger, hosts })", LOAD),
      ).scoringLink,
    ).toBe("null");
    // The inline port back (RP3 forbids it) is not wiring the pin recognises.
    expect(
      wiringOf(SKELETON(PHOTO, "createScoringLinkPort(native)", LOAD))
        .scoringLink,
    ).toBeNull();
    expect(
      wiringOf(SKELETON(PHOTO, "scoringLinkPortFor(native, { logger })", LOAD))
        .scoringLinkDeps,
    ).toBe("logger");
    expect(wiringOf(SKELETON(PHOTO, SCORING, "null")).loads).toBe(0);
  });

  it("the real createNativePorts: photoPortFor(native), scoringLinkPortFor(native, { hosts, logger }), chooseEngine({ native }), one load", () => {
    const source = readFileSync(join(__dirname, "nativePorts.ts"), "utf8");
    expect(wiringOf(source)).toEqual({
      photo: "native",
      scoringLink: "native",
      scoringLinkDeps: "hosts, logger",
      engine: "native",
      loads: 1,
    });
  });
});
```

The fake module's own behaviour is covered by case 3's first bullet; the bridge case below drives the real core.

**The bridge case (F2) — `NativeCaptureEngine.bridge.test.ts`** (the `bridge` project; it drives the REAL Kotlin core through the JVM host and the REAL JS port; a fixture on both ends would prove the fixture). Add, after the `the server script, read back by the real core` block:

```ts
import {
  createScoringLinkPort,
  scoringSecret,
} from "@/services/scoringLinkPort";
import serverBodies from "./wire/server-bodies.json";

/** The host's own link, from the contract-checked vector the host answers with (never typed here). */
const HOST_LINK = (() => {
  const url = serverBodies.bodies.find(
    (body) => body.name === "host/scoring-link-ok",
  )?.body.url;
  if (typeof url !== "string")
    throw new Error("host/scoring-link-ok names no url");
  return url;
})();

describe("the scoring link over the real Kotlin core (JVM host)", () => {
  let host: HostEngine | null = null;
  afterEach(async () => {
    await host?.dispose();
    host = null;
  });
  const paired = async () => {
    host = await startHostEngine();
    host.engine.send(KIT_CODE_A);
    await host.settle!();
    return host;
  };
  // …cases below
});
```

Cases:

1.  **`resolves the link to the caller that asked, as the module would`:** `await h.scoringLink()` equals `{ outcome: 'ok', url: HOST_LINK }`; `HOST_LINK` ends with `ScriptedServer.SCORING_SECRET`'s value only through the vector (assert `scoringSecret(HOST_LINK).length` is 46).
2.  **`the real port over the real core: ok, the secret protected, and in no record line, snapshot or request`:** `createScoringLinkPort(() => h.scoringLink(), { protect: (s) => protectedSecrets.push(s), host: 'stg.seazn.club' })`; the outcome is `{ kind: 'ok', url: HOST_LINK }`; `protectedSecrets` equals `[scoringSecret(HOST_LINK)]`; `h.record.join('\n')`, `JSON.stringify(h.engine.getSnapshot())` and `JSON.stringify(h.requests)` do not contain that secret; anti-vacuity: `h.record.length > 0`, and `h.requests.some((r) => r.path === 'scoring-link')`.
3.  **`a refusal then a success (the sequence)`:** `h.script('scoring-link', 409, { code: 'replaced', message: 'm' })` then `await h.scoringLink()` is `{ outcome: 'replaced' }` with no `url` key; `h.script('scoring-link', 200, { url: HOST_LINK })` then the next is `ok` again.
4.  **`a 429 with no Retry-After header is rate_limited with no retryAfterS`** (the host's scripted answers carry no headers).
5.  **`with no pairing: unavailable, and no request is sent`:** a fresh `startHostEngine()` with nothing paired; the answer is `{ outcome: 'unavailable' }` and `h.requests` has no `scoring-link`.
6.  **`two calls in flight each resolve their own`:** `Promise.all([h.scoringLink(), h.scoringLink()])` gives two `ok` answers.

- [ ] **Step 2: Run red.** `scoringLinkPort.test.ts`, `scoringLinkBodies.test.ts`, `scoringLinkPortWiring.test.ts`, `photoPortWiring.test.ts`, `logger.test.ts` with the JSON recipe. Expected reds: the port, wiring and logger suites fail to collect or fail on the missing module and `protectLink`; `photoPortWiring.test.ts`'s SKELETON case is already green (it reads a string), and its `the real createNativePorts` case is red on `scoringLink: null` until `nativePorts.ts` has the one added member. The bridge case needs the host built after Task 5 (`cd "$WT/modules/capture-engine/android/core" && ./gradlew :host:installDist`), then `CAPTURE_BRIDGE=1 pnpm vitest run --project bridge modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts -t "scoring link"` while iterating, and the whole file once before the commit.

- [ ] **Step 3: Implement** `src/services/scoringLinkPort.ts`:

```ts
import { httpsHost } from "@/domain/credentials/wire";

/** The words native answers with besides `ok` (plan decision D3), a closed set. */
export const SCORING_WORDS = [
  "code_ended",
  "replaced",
  "match_finished",
  "not_entitled",
  "rate_limited",
  "unavailable",
] as const;
export type ScoringWord = (typeof SCORING_WORDS)[number];

export type ScoringLinkOutcome =
  | { readonly kind: "ok"; readonly url: string }
  | {
      readonly kind: "refused";
      readonly word: ScoringWord;
      readonly retryAfterS: number | null;
    };

/** One ask per tap (spec §10). The URL is a scoring credential: it lives in the promise's value and nowhere else. */
export interface ScoringLinkPort {
  /** Never rejects and never takes longer than the deadline. */
  request(): Promise<ScoringLinkOutcome>;
}

/** capture-scoring-link.v1 `$defs.ok.url`. */
export const SCORING_URL = /^https:\/\/[^/]+\/score\/dl_[A-Za-z0-9_-]{43}$/;

/**
 * The controller's ruling (R-F3): JS gives up at 12 s. Native's own bound is the existing request backstop, 16 s
 * (twice its 8 s request timeout), so JS always gives up first and a late native answer finds nobody waiting.
 */
export const SCORING_DEADLINE_MS = 12_000;

const UNAVAILABLE: ScoringLinkOutcome = {
  kind: "refused",
  word: "unavailable",
  retryAfterS: null,
};

export const scoringSecret = (url: string): string =>
  url.slice(url.lastIndexOf("/") + 1);

const isWord = (value: unknown): value is ScoringWord =>
  SCORING_WORDS.some((word) => word === value);

/**
 * What native resolved, as an outcome. Native has already judged the server's answer; this holds the same rules
 * again, because a link is never drawn on trust (Review Focus 5): the shape is the contract's and the host is the
 * build's own, read by the one host rule (`httpsHost`, which drops userinfo and a port and compares exactly),
 * never a second regex. An empty `host` trusts nothing.
 */
export function readAnswer(value: unknown, host: string): ScoringLinkOutcome {
  if (typeof value !== "object" || value === null) return UNAVAILABLE;
  const { outcome, url, retryAfterS } = value as Record<string, unknown>;
  if (outcome === "ok") {
    const good =
      typeof url === "string" &&
      host !== "" &&
      SCORING_URL.test(url) &&
      httpsHost(url) === host;
    return good ? { kind: "ok", url } : UNAVAILABLE;
  }
  if (!isWord(outcome)) return UNAVAILABLE;
  const retry =
    typeof retryAfterS === "number" &&
    Number.isFinite(retryAfterS) &&
    retryAfterS >= 0
      ? retryAfterS
      : null;
  return {
    kind: "refused",
    word: outcome,
    retryAfterS: outcome === "rate_limited" ? retry : null,
  };
}

export function createScoringLinkPort(
  call: (() => Promise<unknown>) | null,
  deps: {
    protect: (secret: string) => void;
    host: string;
    deadlineMs?: number;
  },
): ScoringLinkPort {
  if (call === null) return { request: () => Promise.resolve(UNAVAILABLE) };
  const deadlineMs = deps.deadlineMs ?? SCORING_DEADLINE_MS;
  return {
    request: () =>
      new Promise<ScoringLinkOutcome>((resolve) => {
        let settled = false;
        const settle = (outcome: ScoringLinkOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };
        const timer = setTimeout(() => settle(UNAVAILABLE), deadlineMs);
        const heard = (value: unknown) => {
          const outcome = readAnswer(value, deps.host);
          // Before the caller can have it, and even when it is too late to use: the secret reached JS memory, so the
          // record masks it from here on. The caller of a late answer gets nothing (settle ignores it).
          if (outcome.kind === "ok") deps.protect(scoringSecret(outcome.url));
          settle(outcome);
        };
        try {
          call().then(heard, () => settle(UNAVAILABLE));
        } catch {
          settle(UNAVAILABLE);
        }
      }),
  };
}
```

`nativeModule.ts`: in `CaptureEngineNative`, after PR B's `takePhoto`, add (and amend the type's doc: _"…except `takePhoto` and `scoringLink`"_):

```ts
  /**
   * Spec §10: this match's Remote scoring link. The second call that answers (AGENTS §2, recorded; the first is
   * `takePhoto`): native resolves one `{ outcome, url?, retryAfterS? }` within its own bound (16 s), point to point to
   * this caller and to nobody else, and the port reads anything else as unavailable. The value may carry a
   * credential: never log it. Required, not optional: an absent member would be a button that quietly never works.
   */
  scoringLink(): Promise<unknown>;
```

`FakeNativeModule.ts`, inside the class, right after PR B's `takePhoto` (`photoAnswer`, `photoCalls` and `takePhoto` are `:34-40` at `a9079cf`):

```ts
  /** What `scoringLink` answers, and how often it was asked. Tests set the first and read the second. */
  scoringAnswer: unknown = { outcome: 'unavailable' };
  scoringCalls = 0;
  scoringLink(): Promise<unknown> {
    this.scoringCalls += 1;
    return Promise.resolve(this.scoringAnswer);
  }
```

`test/hostEngine.ts` (F1, RP1; the lines are `a9079cf`'s). In the `HostLine` union (`:32-37`) add `| { ev: 'scoringLink'; call: number; answer: unknown }`. In `HostModule` (`:51`), right after PR B's `takePhoto` stub (the comment and the rejecting method, `:72-75`; it stays as it is):

```ts
  private nextCall = 1;
  private readonly asked = new Map<number, (answer: unknown) => void>();

  /** The module's `scoringLink()` over the host: one stdin op, resolved by the one event that names its call. */
  scoringLink(): Promise<unknown> {
    const call = this.nextCall++;
    return new Promise<unknown>((resolve) => {
      this.asked.set(call, resolve);
      this.write({ op: 'scoringLink', call });
    });
  }
  /** The host answered call [call]: resolve the promise that asked, once. */
  answered(call: number, answer: unknown): void {
    this.asked.get(call)?.(answer);
    this.asked.delete(call);
  }
```

in the line switch (`switch (line.ev)` at `:160`), `case 'scoringLink': native.answered(line.call, line.answer); return;`; in `HostEngine` add the two members documented under Interfaces, and in `startHostEngine`'s returned object `scoringLink: () => bounded(native.scoringLink(), SCORING_MS, () => 'no scoring-link answer'), script: (path, status, body) => write({ op: 'script', path, status, body }),` (`bounded` is the helper at `:133`) with `const SCORING_MS = 5_000;` beside the other budgets (`QUIET_MS`, `SAY_MS`, `READY_MS`, `EXIT_MS`, `:20-26`) (an **unnumbered** script: a numbered one waits for its path's next answer, and this one is asked on demand).

`src/services/logger.ts` (F15). `Logger` gains:

```ts
  /**
   * Spec §10: a scoring link's secret, protected before the answer that carries it can be logged. Masked everywhere a
   * `protect`ed value is. A bucket of its own, at most `LINK_SECRETS` (16), the newest kept, no value twice: a repeat
   * (the server returns the same link) adds nothing, and a link 16 re-issues old is long revoked. A separate bucket
   * so a link never evicts the pairing token `protect` holds.
   */
  protectLink(secret: string): void;
```

and in `createLogger`: keep what `protect` accumulates in `base`, the links in `links`, and compose `held` from both:

```ts
export const LINK_SECRETS = 16;

let base: Required<HeldSecrets> = { secrets: [], streamIds: [], textOnly: [] };
let links: readonly string[] = [];
let held: Required<HeldSecrets> = base;
const unique = (values: readonly string[]) => [...new Set(values)];
const compose = (): void => {
  held = {
    secrets: unique([...base.secrets, ...links]),
    streamIds: base.streamIds,
    textOnly: base.textOnly,
  };
};
const protect = (more: HeldSecrets): void => {
  base = {
    secrets: unique([...base.secrets, ...more.secrets]),
    streamIds: unique([...base.streamIds, ...more.streamIds]),
    textOnly: unique([...base.textOnly, ...(more.textOnly ?? [])]),
  };
  compose();
  inHand = true;
};
const protectLink = (secret: string): void => {
  if (secret === "") return;
  links = [...links.filter((existing) => existing !== secret), secret].slice(
    -LINK_SECRETS,
  );
  compose();
  inHand = true;
};
```

and `protectLink` in the returned object. (`protect`'s dedupe by value matches native's `adding`; it has no observable effect beyond the array's length, so it is a documented equivalent in the mutations below. The cap is on the link bucket only: a cap on `protect`'s values could evict a live token.)

`src/hooks/usePorts.tsx`: `import type { ScoringLinkPort } from '@/services/scoringLinkPort';` and in `Ports`, after `photo`: `/** Spec §10: the match's Remote scoring link (the second call that answers). */ readonly scoringLink: ScoringLinkPort;`.

`test/fakeScoringLinkPort.ts` (test code, copying PR B's `fakePhotoPort.ts`):

```ts
import type {
  ScoringLinkOutcome,
  ScoringLinkPort,
} from "@/services/scoringLinkPort";

/** Made up: the contract's shape. Never a real link. */
export const FAKE_SCORING_SECRET =
  "dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
export const FAKE_SCORING_URL = `https://stg.seazn.club/score/${FAKE_SCORING_SECRET}`;

export type FakeScoringLinkPort = ScoringLinkPort & {
  readonly calls: number;
  /** Every later request answers with this, until changed. Default: ok, with FAKE_SCORING_URL. */
  answerWith(outcome: ScoringLinkOutcome): void;
  /** The next request stays pending until `release`. */
  hold(): void;
  release(outcome?: ScoringLinkOutcome): void;
};

export function createFakeScoringLinkPort(): FakeScoringLinkPort {
  let calls = 0;
  let next: ScoringLinkOutcome = { kind: "ok", url: FAKE_SCORING_URL };
  let holdNext = false;
  const held: ((outcome: ScoringLinkOutcome) => void)[] = [];
  return {
    get calls() {
      return calls;
    },
    answerWith(outcome) {
      next = outcome;
    },
    hold() {
      holdNext = true;
    },
    release(outcome) {
      held.shift()?.(outcome ?? next);
    },
    request() {
      calls += 1;
      if (holdNext) {
        holdNext = false;
        return new Promise<ScoringLinkOutcome>((resolve) => held.push(resolve));
      }
      return Promise.resolve(next);
    },
  };
}
```

`test/fakePorts.ts`: import `createFakeScoringLinkPort, type FakeScoringLinkPort`; add `readonly scoringLink: FakeScoringLinkPort;` to `FakePorts` and `scoringLink: createFakeScoringLinkPort(),` to the `fakes` object (it then spreads into `ports`, as `photo` does). Its own cases are in `test/fakePorts.test.ts` (above).

`src/hooks/scoringLinkPortWiring.ts` (new; RP3), the pure function beside `photoPortFor` that assembles the production port. The wiring is a function and not an inline expression in `nativePorts.ts` for the reason `photoPortFor` is one: `createNativePorts` imports Expo Router and the device ports, no test renders it, and an inline expression there is untested wiring.

```ts
import type { CaptureEngineNative } from "@/engine/nativeModule";
import type { Logger } from "@/services/logger";
import {
  createScoringLinkPort,
  type ScoringLinkPort,
} from "@/services/scoringLinkPort";

/**
 * Spec §10: the production scoring-link port over the native module `createNativePorts` loaded once. No module
 * (iOS in S1, web) is a port that says unavailable; a stale build whose module has no `scoringLink` throws inside
 * the port, which says unavailable too. The call is a closure over the module, so native's `this` stays bound. The
 * link's secret is protected through the logger before the caller has the answer (a bucket of its own), and the
 * host the port trusts is the build's own, `hosts[0]` (`seaznHosts` gives one; none trusts nothing). Pure, so the
 * wiring is tested, like `photoPortFor`.
 */
export function scoringLinkPortFor(
  native: Pick<CaptureEngineNative, "scoringLink"> | null,
  deps: {
    readonly logger: Pick<Logger, "protectLink">;
    readonly hosts: readonly string[];
  },
): ScoringLinkPort {
  return createScoringLinkPort(
    native === null ? null : () => native.scoringLink(),
    {
      protect: (secret) => deps.logger.protectLink(secret),
      host: deps.hosts[0] ?? "",
    },
  );
}
```

`src/hooks/nativePorts.ts` (F13, RP3): **one coherent wiring, and no inline port**. PR B already took the module once (`const native = loadCaptureEngineNative();` at `:39`, passed to `chooseEngine`) and wires the photo port as `photo: photoPortFor(native)` at `:88`. **That line stays exactly as it is, and the inline `createPhotoPort(native === null ? null : () => native.takePhoto())` is never restored.** This task adds one import and one returned member beside it; nothing else, and no second load of the module:

```ts
import { photoPortFor } from "@/hooks/photoPortWiring";
import { scoringLinkPortFor } from "@/hooks/scoringLinkPortWiring"; // the one added import
// …
export function createNativePorts(): Ports {
  const ring = createRingRecord();
  const native = loadCaptureEngineNative(); // PR B: taken once, for the engine and for each call that answers
  // …wired, record, logger, kv, scanner, clock, env, hosts, code: unchanged…
  return {
    // …unchanged members…
    photo: photoPortFor(native), // PR B's line (:88), untouched
    scoringLink: scoringLinkPortFor(native, { logger, hosts }), // the one added member
    // …unchanged members…
  };
}
```

(`logger` is `createLogger(…)` at `:49` and `hosts` is `seaznHosts(env)` at `:55`, both already in scope. A development build with the fake engine and a native module still calls the real `scoringLink`, which answers `unavailable` with no pairing: truthful, and there is no second gate to keep. The two lines are proven three ways: `pnpm typecheck` (a `Ports` without `scoringLink` does not compile), `scoringLinkPortWiring.test.ts` (what the function assembles) and the extended `wiringOf` pin in `photoPortWiring.test.ts` (that the composition root calls it with the same `native`, a `{ logger, hosts }` and one module load), plus the bridge case above (the real port over the real core) and Task 11 item 7 on the phone.)

`modules/capture-engine/src/nativeModule.ts` also gets its two stale claims reworded (RP6), beside the new member: the type's doc at `:13`, "Every call returns void or a value read at once, except `takePhoto`: intents, not RPC (AGENTS §2)", becomes "…except `takePhoto` and `scoringLink`, the two calls that answer: intents, not RPC (AGENTS §2)"; and `takePhoto`'s doc at `:25`, "The one call that answers (AGENTS §2, recorded)", becomes "One of the two calls that answer (the other is `scoringLink`; AGENTS §2, recorded)". `src/services/photoPort.ts:3`, "The one call that answers (AGENTS §2, recorded).", becomes "One of the two calls that answer (the other is the scoring link; AGENTS §2, recorded)." and `src/hooks/usePorts.tsx:69`, "(the one call that answers, Q2)", becomes "(one of the two calls that answer, Q2)". These are comments: `git grep -an -i 'the one call that answers'` over `src`, `modules`, `test` and `AGENTS.md` finds nothing once Task 10 has run.

- [ ] **Step 4: Run green** for `scoringLinkPort.test.ts`, `scoringLinkBodies.test.ts`, `scoringLinkPortWiring.test.ts`, `photoPortWiring.test.ts` (the extended pin; confirm in `.testResults[].name` that it ran, since it is the only thing that reads `nativePorts.ts`), `logger.test.ts`, `engineWiring.test.ts`, `nativeCaptureEngine.test.ts`, `FakeCaptureEngine.contract.test.ts`, `photoPort.test.ts` and `useEngineProbe.test.tsx` (they build `Ports`); then the bridge project command above with the whole file; typecheck, lint, format.

- [ ] **Step 5: Mutations (named).** (a) `host`: drop `&& httpsHost(url) === host` from `readAnswer`; the `off the build's host` and `userinfo` rows, in both the table and the vector sweep, must fail. (b) `shape`: drop `SCORING_URL.test(url) &&`; the `short secret` and `http` rows must fail. (c) `protect first`: move `deps.protect(...)` after `settle(outcome)`; the shared-`order` test must fail. (d) `protect when late`: guard `deps.protect` with `if (!settled)`; the late-answer test (`protect WAS called`) must fail. (e) `late answer`: delete the `if (settled) return;` line in `settle`; the late-answer test (the outcome must stay unavailable) must fail. (f) `deadline`: delete the `setTimeout(...)` line; the `gives up at the deadline exactly` test must fail. (g) `rejection`: replace the rejection handler with one that rethrows; the rejection case must fail. (h) `retry`: let a non-rate-limit word keep `retryAfterS`; the `replaced with a retryAfterS` row must fail. (i) `link cap`: `LINK_SECRETS = 17`; `the 17th distinct one evicts the oldest` must fail. (j) `link dedupe`: delete the `links.filter(...)` part; `a repeated link never pushes another out` must fail. (k) `bucket isolation`: build `held.secrets` from `links` alone; `a pairing token is never evicted by links` must fail. (l) `bridge`: in `HostModule.scoringLink` write `{ op: 'send' }` instead of the op; every bridge case must fail (the seam is driven, not assumed). (m) `call number`: have `HostModule.answered` resolve the oldest pending promise instead of the one the event names; the no-JVM out-of-order test in `hostEngine.test.ts` must fail. (n) `protect line deleted` (RP3): in `scoringLinkPortFor` replace `protect: (secret) => deps.logger.protectLink(secret)` with `protect: () => undefined` (a bare deletion is a `tsc` error and, at runtime, a `TypeError` in the port's answer handler that leaves the request pending, so the no-op is the clean mutant); `protects the link's secret through the logger BEFORE the caller has the answer` and the real-logger test (`x *** y`) must both fail. (o) `host` (RP3): `deps.hosts[0] ?? ""` becomes `deps.hosts.at(-1) ?? ""`; `trusts exactly hosts[0]` must fail on its two-host rows. (p) `null native` (RP3): in `nativePorts.ts` pass `null` instead of `native` to `scoringLinkPortFor`; the pin's `the real createNativePorts` case must fail on `scoringLink: "null"`. (q) `second load` (RP3): in `nativePorts.ts` add `const scoringNative = loadCaptureEngineNative();` and pass that to `scoringLinkPortFor`; the same case must fail on `loads: 2` (and on `scoringLink: "scoringNative"`). (r) `inline port back` (RP3): replace the member by an inline `createScoringLinkPort(…)`; the same case must fail on `scoringLink: null`. Restore each from `"$TMPDIR"`. **Equivalent, documented, not "killed":** removing the `unique(...)` in `protect` has no effect a record line can show (only the array's length); it exists to match native `adding` and is one line. Likewise, removing the `native === null ? null :` check inside `scoringLinkPortFor` changes nothing a caller can see: a null module then throws inside the port's own `try` and reads `unavailable` (and the timer it armed is cleared in the same tick). Do not write a vacuous test for it; the null that matters is (p), the composition root passing `null` to a live module.

- [ ] **Step 6: Commit** `feat(engine): the scoring-link port, bounded at 12 s with a late answer dropped; the link's secret is protected before it can be logged (spec §10)`.

---

## Task 7: The QR, with the Seazn logo at error correction H

**Files:**

- Create: `src/domain/qr/seaznQr.ts`, `src/domain/qr/seaznQr.test.ts`, `src/ui/components/SeaznQr.tsx`, `src/ui/components/SeaznQr.test.tsx`, `src/ui/assets/seazn-qr-logo.png`, `src/ui/assets/qrLogo.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `src/ui/theme/tokens.ts` (`colour.qrGround`), `test/setup-ui.ts`

(The logo lives with the app's other image, `src/ui/assets/`, and is imported the way `HomeScreen.tsx:11` imports `logo-wide-night.png`: a `require` of a path outside `src` would not load under vitest, and F10 needs the real component to run there.)

**Interfaces:**

- Produces:

```ts
// src/domain/qr/seaznQr.ts  (pure; imports qrcode-generator only)
export const SEAZN_QR_ERROR_CORRECTION = "H" as const;
export const SEAZN_QR_QUIET_MODULES = 4;
export const SEAZN_QR_ICON_FRACTION = 0.22;
export const SEAZN_QR_ICON_PAD_MODULES = 1;
export type SeaznQrPlan = {
  readonly version: number; // 1..40
  readonly modules: number; // the symbol's edge, without the quiet zone
  readonly total: number; // with the quiet zone: the viewBox edge
  readonly path: string; // the string the component PAINTS: run-length path of the dark modules, quiet zone applied, logo square knocked out
  readonly logo: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
  }; // in viewBox units
  readonly dark: (row: number, column: number) => boolean; // true for a dark module outside the knock-out: the closure `path` was built from
  readonly knocked: (row: number, column: number) => boolean;
};
export function seaznQrPlan(text: string): SeaznQrPlan;
// src/ui/components/SeaznQr.tsx
export function SeaznQr(props: {
  plan: SeaznQrPlan;
  size: number;
  label: string;
}): JSX.Element;
```

`size` must be a whole multiple of `plan.total` (3 dp a module on the 57-unit symbol): the caller's job, pinned where the size is chosen (Task 8's fit test). The component sets no `shapeRendering` (F8): a whole number of dp per module gives crisp edges by itself, and `crispEdges` would only turn antialiasing off.

- [ ] **Step 1: Dependencies and the logo.**

```bash
cd "$WT" && pnpm add qrcode-generator@1.4.4 && pnpm add -D jsqr@1.4.0
cd "$WT" && ls node_modules/qrcode-generator/*.d.ts node_modules/jsqr/dist/*.d.ts
cd "$WT" && git diff --stat -- pnpm-lock.yaml package.json
```

`pnpm add` has been seen to churn unrelated `eslint-config-next` peer entries in the lockfile. If the diff shows anything beyond the two new packages and their own entries, restore those hunks by hand, then prove `pnpm install --frozen-lockfile` passes. If `qrcode-generator` ships no declaration file (the `ls` fails), add `src/types/qrcode-generator.d.ts`:

```ts
declare module "qrcode-generator" {
  type ErrorCorrection = "L" | "M" | "Q" | "H";
  interface QRCode {
    addData(
      data: string,
      mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji",
    ): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, column: number): boolean;
  }
  export default function qrcode(
    typeNumber: number,
    errorCorrectionLevel: ErrorCorrection,
  ): QRCode;
}
```

Copy the logo from the web repo (a read, then a write in this worktree) and pin it with the same kind of test `logo.test.ts` is:

```bash
cp /Users/ashokhein/github/seazn.club/apps/web/public/icons/icon-192.png "$WT/src/ui/assets/seazn-qr-logo.png"
shasum -a 256 "$WT/src/ui/assets/seazn-qr-logo.png"   # expect f757f37875068e3f6620ce4638797e2baa4ce6ac96030d755ca2ed6f828237d2
```

`qrLogo.test.ts` (copy `logo.test.ts`'s shape): the file is the web repo's, byte for byte (that sha256), and 192 × 192 (the PNG IHDR: square, so the knock-out never distorts it). Commit `pnpm-lock.yaml` with the change. `pnpm-workspace.yaml` lists ignored install scripts: if pnpm reports either new package has one, add it to `ignoredBuiltDependencies` with a comment, as the file's header asks (a new install script shows up as a decision).

- [ ] **Step 2: Failing tests** (`seaznQr.test.ts`, `domain` project). The expectations come from the QR standard's table and the web helper's declared constants, not from the code under test. **F9: the decode rasterises the string the component paints (`plan.path`), read back by a parser, and a separate test holds that string equal to the closures it was built from.** A decode of the closures proves the closures; the phone paints the string.

```ts
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import {
  SEAZN_QR_ERROR_CORRECTION,
  SEAZN_QR_ICON_FRACTION,
  SEAZN_QR_ICON_PAD_MODULES,
  SEAZN_QR_QUIET_MODULES,
  seaznQrPlan,
  type SeaznQrPlan,
} from "@/domain/qr/seaznQr";

// ISO/IEC 18004: byte-mode capacity at error correction H, versions 1 to 10.
const H_BYTES = [7, 14, 24, 34, 44, 58, 64, 84, 98, 119];
const versionFor = (bytes: number) =>
  H_BYTES.findIndex((capacity) => capacity >= bytes) + 1;

/** Made up: the contract's shape on each host. */
const SECRET = "dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE";
const URLS = [
  `https://stg.seazn.club/score/${SECRET}`,
  `https://seazn.club/score/${SECRET}`,
] as const;

const Q = SEAZN_QR_QUIET_MODULES;
const RUN = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;

/**
 * The modules the PAINTED string covers, read back from `plan.path` alone: each `M x y h w v1 h-w z` is one run of
 * `w` modules in row `y - Q` from column `x - Q`. Throws unless the string is made of those runs and nothing else,
 * so a path the parser cannot read is a failure and not an empty set.
 */
function paintedModules(plan: SeaznQrPlan): Set<string> {
  const runs = [...plan.path.matchAll(RUN)];
  if (runs.map((run) => run[0]).join("") !== plan.path)
    throw new Error("the painted path holds more than runs");
  const covered = new Set<string>();
  for (const [, x, y, width, back] of runs) {
    if (width !== back) throw new Error("a run that does not close on itself");
    for (let column = 0; column < Number(width); column++)
      covered.add(`${Number(y) - Q},${Number(x) - Q + column}`);
  }
  return covered;
}

/** Rasterise the painted path to RGBA at [scale] px per module, the logo's knock-out filled by [fill]. */
function raster(
  plan: SeaznQrPlan,
  scale: number,
  fill: (row: number, column: number) => boolean,
) {
  const covered = paintedModules(plan);
  const side = plan.total * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  let black = 0;
  for (let row = 0; row < plan.modules; row++) {
    for (let column = 0; column < plan.modules; column++) {
      const isBlack = plan.knocked(row, column)
        ? fill(row, column)
        : covered.has(`${row},${column}`);
      if (!isBlack) continue;
      black += 1;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at =
            (((row + Q) * scale + y) * side + (column + Q) * scale + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  return { pixels, side, black };
}

describe("the Seazn QR (owner rule: every QR carries the logo, at error correction H)", () => {
  it.each(URLS)(
    "%s is at the version error correction H needs, not the one M would",
    (url) => {
      const plan = seaznQrPlan(url);
      expect(SEAZN_QR_ERROR_CORRECTION).toBe("H");
      expect(plan.version).toBe(
        versionFor(new TextEncoder().encode(url).length),
      );
      expect(plan.version).toBe(8); // 71 and 75 bytes
      expect(plan.modules).toBe(4 * plan.version + 17);
      expect(plan.total).toBe(plan.modules + 2 * SEAZN_QR_QUIET_MODULES);
      expect(plan.total).toBe(57); // 49 + 2 × 4: the number Task 8's whole-module size (3 × 57 = 171) divides
    },
  );

  it("the logo square is centred, odd, holds the icon and its pad, and covers well under H’s 30%", () => {
    const plan = seaznQrPlan(URLS[0]);
    const n = plan.modules;
    const icon = n * SEAZN_QR_ICON_FRACTION;
    let knocked = 0;
    let edge = 0;
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++)
        if (plan.knocked(row, column)) knocked += 1;
    for (let column = 0; column < n; column++)
      if (plan.knocked(Math.floor(n / 2), column)) edge += 1;
    expect(edge % 2).toBe(1);
    expect(edge).toBeGreaterThanOrEqual(
      Math.ceil(icon + 2 * SEAZN_QR_ICON_PAD_MODULES),
    );
    expect(edge * edge).toBe(knocked);
    expect(knocked / (n * n)).toBeLessThan(0.3);
    expect(plan.logo.size).toBeCloseTo(icon, 5);
    expect(plan.logo.x + plan.logo.size / 2).toBeCloseTo(plan.total / 2, 5);
  });

  // F9: the string the component paints IS the closures it was built from, module for module.
  it.each(URLS)(
    "%s: the painted path covers exactly the closures’ dark modules, and none under the logo",
    (url) => {
      const plan = seaznQrPlan(url);
      const covered = paintedModules(plan);
      const expected = new Set<string>();
      let underLogo = 0;
      for (let row = 0; row < plan.modules; row++) {
        for (let column = 0; column < plan.modules; column++) {
          if (plan.dark(row, column)) expected.add(`${row},${column}`);
          if (plan.knocked(row, column) && covered.has(`${row},${column}`))
            underLogo += 1;
        }
      }
      expect(expected.size).toBeGreaterThan(plan.modules * 10); // anti-vacuity: a real symbol has hundreds of dark modules
      expect([...covered].sort()).toEqual([...expected].sort());
      expect(underLogo).toBe(0);
    },
  );

  const FILLS = [
    ["white", () => false],
    ["black", () => true],
    [
      "a checkerboard",
      (row: number, column: number) => (row + column) % 2 === 0,
    ],
  ] as const;
  const CASES = URLS.flatMap((url) =>
    FILLS.map(([why, fill]) => [url, why, fill] as const),
  );

  it.each(CASES)(
    "%s decodes, from the painted path, with the logo area %s",
    (url, _why, fill) => {
      const plan = seaznQrPlan(url);
      const { pixels, side, black } = raster(plan, 4, fill);
      expect(black).toBeGreaterThan(0);
      expect(jsQR(pixels, side, side)?.data).toBe(url);
    },
  );

  it("swept 6 decodes", () => {
    expect(CASES).toHaveLength(6);
  });

  // The decoder is no yes-machine: with the painted modules removed, nothing decodes.
  it("a symbol with no painted path decodes to nothing", () => {
    const plan = { ...seaznQrPlan(URLS[0]), path: "" };
    const { pixels, side } = raster(plan, 4, () => false);
    expect(jsQR(pixels, side, side)).toBeNull();
  });
});
```

`SeaznQr.test.tsx` (`ui` project; F10). `test/setup-ui.ts` replaces `SeaznQr` with a marker for every other suite (below); **this suite is of the drawing itself**, so it takes the real component the way `Glyph.test.tsx` does, with `vi.importActual`, over a `react-native-svg` whose elements become the SVG elements they stand for (the real source does not load under react-native-web in jsdom):

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { seaznQrPlan } from "@/domain/qr/seaznQr";
import type * as SeaznQrModule from "@/ui/components/SeaznQr";
import logo from "@/ui/assets/seazn-qr-logo.png";
import { colour } from "@/ui/theme/tokens";

vi.mock("react-native-svg", async () => {
  const { createElement } = await import("react");
  const element =
    (tag: string) =>
    ({ testID, accessibilityLabel, ...props }: Record<string, unknown>) =>
      createElement(tag, {
        ...props,
        "data-testid": testID,
        "aria-label": accessibilityLabel,
      });
  return {
    default: element("svg"),
    Path: element("path"),
    Rect: element("rect"),
    Image: element("image"),
  };
});

const actual: typeof SeaznQrModule = await vi.importActual(
  "@/ui/components/SeaznQr",
);
const { SeaznQr } = actual;
```

Cases (each states what it asserts): for both URLs' plans at `size` 171, the real component renders **one `svg`** with `width`/`height` 171, `viewBox` `0 0 57 57` (from the plan), `aria-label` equal to the `label` prop; **exactly one `path`, and its `d` attribute is `plan.path` character for character** (the string the phone paints is the plan's, the one Task 7's decode rasterised); its `fill` is `colour.ground`; the background `rect` is `colour.qrGround` and covers the whole viewBox; the `image` has `href` equal to the imported logo and `x`, `y`, `width`, `height` equal to `plan.logo`; **no `shape-rendering` or `shapeRendering` attribute on any element** (F8: crisp edges come from the whole-module size, and `crispEdges` would only switch antialiasing off); re-rendering with the other URL's plan changes `d` (nothing is memoised past its plan); a sweep count (`2` plans checked, anti-vacuity).

- [ ] **Step 3: Run red.**

- [ ] **Step 4: Implement** `seaznQr.ts`. This is the web helper's geometry (`apps/web/src/lib/seazn-qr.ts`) over `qrcode-generator`; keep the constants' names:

```ts
import qrcode from "qrcode-generator";

/** Owner rule (2026-09-30): every Seazn QR carries the logo in the centre, so error correction is H. */
export const SEAZN_QR_ERROR_CORRECTION = "H" as const;
export const SEAZN_QR_QUIET_MODULES = 4;
/** The icon covers 0.22 of the symbol: the web's share (apps/web/src/lib/seazn-qr.ts). */
export const SEAZN_QR_ICON_FRACTION = 0.22;
export const SEAZN_QR_ICON_PAD_MODULES = 1;

export type SeaznQrPlan = {
  readonly version: number;
  readonly modules: number;
  readonly total: number;
  readonly path: string;
  readonly logo: {
    readonly x: number;
    readonly y: number;
    readonly size: number;
  };
  readonly dark: (row: number, column: number) => boolean;
  readonly knocked: (row: number, column: number) => boolean;
};

/**
 * A symbol and where its logo goes, pure. The logo's knock-out is the smallest ODD square of modules that holds
 * the icon plus a one-module pad on every side, so it centres on a module. The symbol's own data modules under
 * it are recovered by error correction H.
 */
export function seaznQrPlan(text: string): SeaznQrPlan {
  const symbol = qrcode(0, SEAZN_QR_ERROR_CORRECTION);
  symbol.addData(text, "Byte");
  symbol.make();
  const n = symbol.getModuleCount();
  const icon = n * SEAZN_QR_ICON_FRACTION;
  let k = Math.ceil(icon + 2 * SEAZN_QR_ICON_PAD_MODULES);
  if (k % 2 === 0) k += 1;
  const k0 = (n - k) / 2;
  const q = SEAZN_QR_QUIET_MODULES;
  const knocked = (row: number, column: number) =>
    row >= k0 && row < k0 + k && column >= k0 && column < k0 + k;
  const dark = (row: number, column: number) =>
    symbol.isDark(row, column) && !knocked(row, column);
  let path = "";
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      if (!dark(row, column)) continue;
      const start = column;
      while (column < n && dark(row, column)) column++;
      path += `M${start + q} ${row + q}h${column - start}v1h-${column - start}z`;
    }
  }
  const at = q + (n - icon) / 2;
  return {
    version: (n - 17) / 4,
    modules: n,
    total: n + 2 * q,
    path,
    logo: { x: at, y: at, size: icon },
    dark,
    knocked,
  };
}
```

`SeaznQr.tsx`:

```tsx
import Svg, { Image as SvgImage, Path, Rect } from "react-native-svg";
import type { SeaznQrPlan } from "@/domain/qr/seaznQr";
import logo from "@/ui/assets/seazn-qr-logo.png";
import { colour } from "@/ui/theme/tokens";

/**
 * Paints a plan: white ground with its quiet zone, the dark modules in the night ink, the Seazn icon in the
 * knocked-out centre. Drawing only; what it draws is `seaznQrPlan`'s `path`, which the plan's own tests rasterise
 * and decode. `size` is a whole number of dp per module (the caller's rule, held by Task 8's fit test), so the edges
 * are crisp without `shapeRendering`.
 */
export function SeaznQr({
  plan,
  size,
  label,
}: {
  plan: SeaznQrPlan;
  size: number;
  label: string;
}) {
  const viewBox = `0 0 ${plan.total} ${plan.total}`;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      accessible
      accessibilityLabel={label}
      testID="seazn-qr"
    >
      <Rect width={plan.total} height={plan.total} fill={colour.qrGround} />
      <Path d={plan.path} fill={colour.ground} />
      <SvgImage
        href={logo}
        x={plan.logo.x}
        y={plan.logo.y}
        width={plan.logo.size}
        height={plan.logo.size}
      />
    </Svg>
  );
}
```

Add `qrGround: '#ffffff'` to `colour` in `tokens.ts` with the comment "A QR needs a white quiet zone to scan; the only white in the app" (the web's `INK` is `#150b36`, which is `colour.ground`). In `test/setup-ui.ts` add the `SeaznQr` stand-in for every other suite (the real drawing is `SeaznQr.test.tsx`'s):

```ts
vi.mock("@/ui/components/SeaznQr", async () => {
  const { createElement } = await import("react");
  const { View } = await import("react-native");
  return {
    SeaznQr: ({
      plan,
      size,
      label,
    }: {
      plan: { version: number; modules: number };
      size: number;
      label: string;
    }) =>
      createElement(View, {
        testID: "seazn-qr",
        accessibilityLabel: label,
        style: { width: size, height: size },
        dataSet: {
          version: String(plan.version),
          modules: String(plan.modules),
          size: String(size),
        },
      } as ViewProps),
  };
});
```

- [ ] **Step 5: Run green** (`seaznQr.test.ts`, `SeaznQr.test.tsx`, `qrLogo.test.ts`, `logo.test.ts`), typecheck, lint, format.

- [ ] **Step 6: Mutations (named).** (a) `error correction`: change `'H'` to `'M'`; the version expectation (`8`) and the version-for-H table must fail (the same URL needs v5 at M). (b) `knock-out size`: use `k = Math.ceil(icon)` (no pad) and let the odd rule go; the `holds the icon and its pad` test must fail. (c) `knock-out too big`: set `SEAZN_QR_ICON_FRACTION` to `0.6`; the `well under H's 30%` test and a decode case must fail. (d) `path under the logo`: build `path` from `symbol.isDark` without the `!knocked` (use `symbol.isDark(row, column)` in the run loop); `none under the logo` and the painted-equals-closures test must fail. (e) `quiet zone`: drop `+ q` from the path's coordinates; the painted-equals-closures test and every decode must fail. (f) `painted string`: in `SeaznQr.tsx` paint `d={plan.path.slice(1)}`; `its d attribute is plan.path` must fail. (g) `crispEdges`: add `shapeRendering="crispEdges"` back; the absence assertion must fail. (h) `logo`: drop the `SvgImage` line; the `image` assertions must fail. Restore each from `"$TMPDIR"`.

- [ ] **Step 7: Commit** `feat(qr): the Seazn QR at error correction H with the logo in the centre, proven by a decode of the painted path (owner rule)`.

---

## Task 8: The Remote scoring button, hook and panel (gated by Q-C2)

R-F18 names the button _Remote scoring_ (the title key is its accessible name). R-F3 gives the hook one port to call (`usePorts().scoringLink`, Task 6). PR B owns the shutter and the icon-row arrays (F12): this task rebases onto them and adds one button.

**If Q-C2 is answered "over the controls half"**, the panel's parent changes to `controls-half` and Stop is covered: stop and re-plan. Do not improvise a second placement.

**Files:**

- Create: `src/hooks/useScoringLink.ts`, `src/hooks/useScoringLink.test.tsx`, `src/hooks/useViewfinder.scoring.test.tsx`, `src/ui/components/ScoringLinkPanel.tsx`, `src/ui/components/ScoringLinkPanel.test.tsx`, `src/ui/screens/StreamScreen.scoring.test.tsx`, `src/ui/screens/noScreenshotBlock.test.ts`, `src/ui/theme/scoringFit.test.ts`
- Modify: `src/hooks/useViewfinder.ts`, `src/ui/components/Glyph.tsx` (a `qr` glyph), `src/ui/components/Glyph.test.tsx`, `src/ui/components/IconButton.test.tsx`, `src/ui/components/StreamColumn.tsx`, `src/ui/components/StreamColumn.test.tsx`, `src/ui/components/StreamStage.tsx`, `src/ui/screens/StreamScreen.tsx`, `src/ui/screens/StreamScreen.layout.test.tsx`, `src/ui/theme/tokens.ts`, `src/ui/theme/viewfinderFit.test.ts`, `src/i18n/{en,es,fr,nl}.json`, `src/i18n/budgets.test.ts`
- Not touched: `ViewerPeek.tsx` (its box and fonts are PR A's; this task measures them, F6), `IconButton.tsx`, `HoldAction.tsx`, `SeaznQr.tsx` (Task 7's)

**Interfaces:**

- Consumes: Task 6's `ScoringLinkPort` (`usePorts().scoringLink`), `ScoringLinkOutcome`, `ScoringWord`, `SCORING_WORDS` and the fake (`calls`, `answerWith`, `hold`, `release`, `FAKE_SCORING_URL`, `FAKE_SCORING_SECRET`); Task 7's `seaznQrPlan`, `SeaznQr` (and its stand-in in `test/setup-ui.ts`); PR A's `IconButton({ glyph, label, onPress })`, `Glyph`, `testID="icon-row"`, `layout`; **PR B's** `Viewfinder.shutter`, `ShutterGlyph`, `IconRow` (re-pin it: PR B's order is Settings, then Take photo (on air only), the peek, Home, Take photo (before air only)), `StreamScreen.layout.test.tsx`'s three icon-row tests, `IconButton.test.tsx`'s `BUTTONS`, `Glyph.test.tsx`'s `DRAWN`; `usePorts().{foreground, clock, logger}`; `selectHeldCode`, `selectHeldSlot`, `selectHeldTokenTag` (three scalars: **not** `selectHeldName`, whose doc says it is for one-off reads, "a new object each call", and would re-render a `useEngineSelector` forever).
- Produces:

```ts
// src/hooks/useScoringLink.ts
export const SCORING_SHOW_MS = 10_000;
export type ScoringLinkView =
  | { readonly kind: "hidden" }
  | { readonly kind: "asking" }
  | { readonly kind: "shown"; readonly url: string }
  | {
      readonly kind: "refused";
      readonly word: ScoringWord;
      readonly retryAfterS: number | null;
    };
export function useScoringLink(): {
  readonly view: ScoringLinkView;
  open(): void;
  hide(): void;
}; // open and hide are stable
// Viewfinder gains:  readonly scoring: boolean;
// layout gains:      qrSize: 171, peekLabelLines: 2, peekReasonLines: 2
// GlyphName gains:   'qr'
```

**The icon-row arrays this task produces** (PR B's arrays plus one button, which is the last of the camera-side pair in both states):

| state              | `icon-row` button names, in order                                    |
| ------------------ | -------------------------------------------------------------------- |
| Paired, before air | Settings, Home, Take photo, Remote scoring                           |
| on air             | Settings, Take photo, Remote scoring, What viewers see               |
| Ended              | Settings, Home (unchanged: no pairing, so no shutter and no scoring) |
| idle, pairing      | Settings, Home (unchanged)                                           |

- [ ] **Step 1: Failing tests.**

**`useViewfinder.scoring.test.tsx`** is `useViewfinder.shutter.test.tsx`'s twin (PR B's file, same imports, same `STATE: Record<Kind, SessionState>`; copy it and change the field). The rulebook is "a pairing is held" (Q-C2: Paired and on air, before and during live), written out per kind, typed over every kind so a new kind is a compile error. It is a separate field from `shutter` on purpose: the two buttons happen to share a rule today, and the reason is different (a camera picture to save, a code to show):

```tsx
const SCORING: Record<Kind, boolean> = {
  idle: false,
  pairing: false,
  paired: true,
  arming: true,
  armed: true,
  connecting: true,
  publishing: true,
  degraded: true,
  reconnecting: true,
  ended: false,
};
```

Case 1 sweeps all ten kinds, asserting `{ kind, scoring }` equals the table and `checked` is `10` and `offered` is `7` (anti-vacuity: an `ended` and an `idle` that would offer it are the failures). Case 2 follows one session: `[true, true, true, false]` through `paired`, `publishing`, `reconnecting`, `ended`.

**`useScoringLink.test.tsx`** renders the real hook in `wrapperFor(fakes)` with `vi.useFakeTimers()` and the fake `scoringLink` port. The harness:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCORING_SHOW_MS, useScoringLink } from "@/hooks/useScoringLink";
import {
  SCORING_WORDS,
  type ScoringLinkOutcome,
} from "@/services/scoringLinkPort";
import { createFakePorts, readRecord } from "../../test/fakePorts";
import {
  FAKE_SCORING_SECRET,
  FAKE_SCORING_URL,
} from "../../test/fakeScoringLinkPort";
import { savedStreamCode } from "../../test/fixtures/savedStream";
import { pairCode } from "../../test/pairCode";
import { wrapperFor } from "../../test/renderWithPorts";

const OK: ScoringLinkOutcome = { kind: "ok", url: FAKE_SCORING_URL };
const refused = (
  word: (typeof SCORING_WORDS)[number],
  retryAfterS: number | null = null,
): ScoringLinkOutcome => ({
  kind: "refused",
  word,
  retryAfterS,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const fakes = createFakePorts();
  pairCode(fakes.engine, savedStreamCode());
  const hook = renderHook(() => useScoringLink(), {
    wrapper: wrapperFor(fakes),
  });
  return {
    fakes,
    hook,
    view: () => hook.result.current.view,
    /** A tap, then the fake's already-resolved promise lands. */
    tap: () => act(async () => hook.result.current.open()),
    /** Timers armed beyond the harness's own, so a leaked 10 s timer shows as a number. */
    armed: (
      (base) => () =>
        vi.getTimerCount() - base
    )(vi.getTimerCount()),
  };
}
```

(`armed` takes its baseline at setup time, after the render: the harness's own providers may arm timers of their own, so an absolute `getTimerCount() === 0` would be a guess.) Cases, each stating what it asserts:

1. **A tap from hidden asks once.** After `tap()` with the fake held, `view().kind` is `'asking'`, `fakes.scoringLink.calls` is `1`, and the record holds a `scoring.open` line.
2. **Shown, then hidden after exactly `SCORING_SHOW_MS`, and the url is gone.** `answerWith(OK)`; after `tap()` the view is `{ kind: 'shown', url: FAKE_SCORING_URL }`; at `SCORING_SHOW_MS - 1` it is still shown; at `SCORING_SHOW_MS` it equals `{ kind: 'hidden' }`, and `JSON.stringify(view())` has no `FAKE_SCORING_SECRET` (D8).
3. **The 10 s runs from the answer, not from the tap.**
   ```ts
   fakes.scoringLink.hold();
   await tap();
   expect(view().kind).toBe("asking");
   act(() => vi.advanceTimersByTime(4_000));
   await act(async () => fakes.scoringLink.release(OK));
   expect(view().kind).toBe("shown");
   act(() => vi.advanceTimersByTime(SCORING_SHOW_MS - 100));
   expect(view().kind).toBe("shown"); // 4 s asking + 9.9 s shown: a timer from the tap would have fired at 10 s
   act(() => vi.advanceTimersByTime(100));
   expect(view()).toEqual({ kind: "hidden" });
   ```
4. **`hide()` while shown** goes to `hidden` and clears the timer: `armed()` is `0` straight after, and advancing 10 s changes nothing.
5. **A tap while asking is ignored, and a Hide while asking drops the late answer** (D7, Review Focus 3):
   ```ts
   fakes.scoringLink.hold();
   await tap();
   await tap(); // ignored
   expect(fakes.scoringLink.calls).toBe(1);
   act(() => hook.result.current.hide());
   await act(async () => fakes.scoringLink.release(OK)); // the old ask answers after the Hide
   expect(view()).toEqual({ kind: "hidden" });
   expect(armed()).toBe(0);
   expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
     "scoring.shown",
   );
   ```
6. **Hide, then open asks again, and the old ask's answer arriving after that is dropped.** Hold, tap (ask A), hide, hold, tap (ask B): `calls` is `2`. `release` answers oldest first, so release A with a different `ok` url: it is dropped and the view is still `asking`; then release B: the view is `shown` with B's url, never A's.
7. **A tap while shown is ignored and does not restart the clock.** Shown; advance 6 s; tap; `calls` is still `1`; advance 4 s: `hidden`.
8. **Every refusal word, from the port's own list.** `it.each(SCORING_WORDS)`: `answerWith(refused(word, word === 'rate_limited' ? 30 : null))`, tap, the view is `{ kind: 'refused', word, retryAfterS }`, and after `SCORING_SHOW_MS` it is `hidden`. `expect(SCORING_WORDS).toHaveLength(6)` and a counter of `6` rows run (anti-vacuity; a seventh word added to the port is a row for free). The record has one `scoring.refused` line per row, with `reason` the word.
9. **Rate limit.** `answerWith(refused('rate_limited', 30))`, tap (refused, `calls` 1); advance the fake timers 10 s (hidden) and set the ports' clock to 29.9 s after the answer (`fakes.setNow(new Date(t0 + 29_900))`, `t0` read from `fakes.ports.clock()` before the first tap): a tap now does **not** ask (`calls` stays `1`) and shows `{ kind: 'refused', word: 'rate_limited', retryAfterS: 1 }` (the 0.1 s left, rounded up); at `t0 + 30_000` a tap asks (`calls` `2`). Then `retryAfterS: null` blocks nothing: a second tap right after asks.
10. **A rate limit the Hide made unseen still counts.** Hold, tap, hide, then release `refused('rate_limited', 30)`: the view stays hidden (dropped), but the next tap does not ask.
11. **Leaving the foreground hides it.** Shown, then `fakes.foreground.leave()`: `hidden`, `armed()` `0`. Also `fakes.foreground.leaveListeners()` is `1` while mounted and `0` after `unmount()`.
12. **The held pairing changing hides it, and so does losing it.** Shown; `pairCode(fakes.engine, savedStreamCode({ slot: 2 }))` (read `FakeCaptureEngine`'s `pair` handling: if it refuses a pair while paired, send `{ kind: 'unpair' }` first) → `hidden`. A second run: shown, then `fakes.engine.send({ kind: 'unpair' })` → `hidden`. Both rows counted (`2`).
13. **Unmount.** While asking: `unmount()`, then `release(OK)`: no throw, `armed()` is `0` (no timer is armed for a view nobody has). While shown: `unmount()`: `armed()` is `0`. (React no longer warns on a state update after unmount, so a `console.error` spy would pass on a broken guard: the leaked timer is the witness.)
14. **The url reaches no record line.** After a full cycle (tap, shown, hide), `JSON.stringify(fakes.record.lines())` does not contain `FAKE_SCORING_SECRET`, **and** the record holds a `scoring.open` line and a `scoring.shown` line (the positive pair: the lines exist, so their absence of the secret means something). The fake port does not call `protect`, so a hook that logged the url under `url` (a public-URL key) would leak here.
15. **`open` and `hide` keep their identity across a view change** (the column is `memo`, M7): collect `result.current.open` before and after a tap and a hide; `toBe` the same function each time.

**`ScoringLinkPanel.test.tsx`** (`renderWithPorts(<ScoringLinkPanel view={…} onHide={…} />, { deviceLanguages: [lang] })`; the copy is read from the dictionaries, never typed): over `for (const lang of ['en','es','fr','nl'])` and the four visible views (count `4 × 4 = 16`):

- `hidden` renders nothing (`queryByTestId('scoring-panel')` is null).
- `asking` shows the title (`stream.scoring.title`), `stream.scoring.asking` and a Hide button; no `seazn-qr`.
- `shown` shows the `seazn-qr` stand-in whose `dataset.version` is `'8'` and `dataset.size` is `String(layout.qrSize)` and whose `aria-label` is `stream.scoring.code`; the title, `stream.scoring.hint` and Hide; **and `container.innerHTML` does not contain `FAKE_SCORING_SECRET`** (the panel hands the url to `seaznQrPlan` and nowhere else).
- `refused`: for each of the six words the sentence from a table typed `Record<ScoringWord, MessageKey>` in the test (a new word is a compile error): `rate_limited` with `retryAfterS: 30` has `{seconds}` filled (the English row is `Try again in 30 s`); `rate_limited` with `retryAfterS: null` says the `unavailable` sentence (there is no number to fill, and "Try again in 0 s" would be false); **no `seazn-qr`** in any refused view; Hide present. Count `6 × 4 = 24` sentences checked, plus the null row in each language.
- Hide: `fireEvent.click` on the button named `stream.scoring.hide` calls `onHide` once; its computed `minHeight` is `${layout.iconButton}px` (a 48 dp target); its `role` is `button`.
- The panel is `position: absolute` with `top`, `left`, `right`, `bottom` all `0px`: it covers whatever it is a child of (Q-C2), and the screen test below shows that is the camera half.
- Re-rendering `shown` with the same url keeps the same plan: spy `seaznQrPlan` through `vi.mock('@/domain/qr/seaznQr', async (importOriginal) => ({ ...(await importOriginal()), seaznQrPlan: vi.fn(actual.seaznQrPlan) }))` and `rerender` twice with an equal view: called once. (The plan is memoised on the url, so a re-render never re-encodes.)

**`StreamScreen.scoring.test.tsx`** (the seam, through `renderViewfinder`, with fake timers): reads names from `en`, finds the button inside `icon-row`.

1. **Before air** (Paired): the icon row has a button named `en['stream.scoring.title']`; tapping it makes `view.scoringLink.calls` `1`; after the answer the `scoring-panel` is a descendant of `camera-half`, **not** of `controls-half`; `controls-half` still contains the Go live hold button (Q-C2: the controls are never covered); after `SCORING_SHOW_MS` the panel is gone.
2. **On air** (`act(() => view.engine.scene('live'))`): the same, and with the panel up the Stop hold still works: `pressIn(stopLive())`, then the `hold-fill` stand-in's `dataset.holding` is `'true'`. Read `HoldAction.test.tsx` for the idiom; `stopLive` is the layout test's helper (copy it, do not export it).
3. **The panel appears in the camera half and replaces nothing in the controls half:** `within(byId('controls-half'))` has the same button names (`buttonNames(byId('icon-row'))`) before and after the panel opens.
4. **A refusal is shown in the camera half, with its sentence and no code:** `answerWith(refused('replaced'))`; `getByText(en['stream.scoring.refused.replaced'])` is inside `scoring-panel`; no `seazn-qr`.
5. **Where it is not offered:** an idle engine (`renderViewfinder({}, { engine: 'idle' })`) and the Ended frame have no button named `en['stream.scoring.title']` (the absence witnesses; the positive pairs are 1 and 2).
6. **Leaving the foreground hides it:** open, `view.foreground.leave()`, the panel is gone (the real hook, mounted by the real screen).

**`StreamScreen.layout.test.tsx`** (F12, RP1). PR B's three icon-row tests are at `:350` (`keeps the icon row: …`), `:370` (`on air: …`) and `:387` (`follows the broadcast through the icon row: …`), the last ending with the Ended array at `:403`: `:350-404` in all at `a9079cf` (the old `:350-393` cite is stale). Re-pin them if PR B merged with other edits. Start from **PR B's arrays** and add the button; change nothing else:

- `keeps the icon row: Settings, Home, then Take photo before air, …`: the title gains `, then Remote scoring`; `buttonNames(...)` is `[en['stream.link.settings'], en['stream.home'], en['stream.photo.label'], en['stream.scoring.title']]`; the 48 dp loop's names gain `en['stream.scoring.title']`.
- `on air: Take photo, then What viewers see, …`: the array is `[en['stream.link.settings'], en['stream.photo.label'], en['stream.scoring.title'], en['stream.peek.label']]`; the title says `Take photo and Remote scoring, then What viewers see`. Its `peek()` and `flexGrow` assertions stay.
- `follows the broadcast through the icon row: …`: before air `[settings, home, photo, scoring]`; live `[settings, photo, scoring, peek]`; **Ended stays `[settings, home]`** (the absence witness: a stopped broadcast leaves no pairing to score for).

**`StreamColumn.test.tsx`** (RP2). This file has **no icon-row arrays**: those are `StreamScreen.layout.test.tsx`'s, above. It takes **three** edits for the new required prop and the new field, and a missing one is a `tsc` error and nothing else (vitest does not type-check and stays green), so run `pnpm typecheck` after:

1. `ICONS` (`:13-17`) gains `onScoringLink: vi.fn(),`.
2. `viewOf` (`:20-40`) gains `scoring: false,` beside PR B's `shutter: false,`.
3. The hand-built `column()` helper in the icon-row `describe` (`:132-140`) passes `canLeave`, `onHome` and `onSettings` by hand and does **not** spread `ICONS`, so it needs the prop too:

```tsx
const column = (
  canLeave: boolean,
  onSettings: () => void,
  onHome: () => void,
) => (
  <StreamColumn
    view={viewOf({})}
    canLeave={canLeave}
    onHome={onHome}
    onSettings={onSettings}
    onScoringLink={vi.fn()}
    peek={PEEK}
  />
);
```

New cases, in the icon-row `describe` (it has one test today, at `:142`; add `within` to the file's `@testing-library/react` import). The names are the spec's and the dictionary's English: `Settings`, `Home`, `Take photo`, `Remote scoring` (spec §10) and `What viewers see`.

```tsx
/** The icon row's accessible names, in order (an icon button has no text, only its label). */
const rowNames = () =>
  within(screen.getByTestId("icon-row"))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);

it("offers Remote scoring only while a pairing is held, presses onScoringLink once and nothing else, and keeps Settings either way", () => {
  const onScoringLink = vi.fn();
  const onSettings = vi.fn();
  const onHome = vi.fn();
  const handlers = { ...ICONS, onScoringLink, onSettings, onHome };
  const { rerender } = renderWithPorts(
    <StreamColumn view={viewOf({ scoring: true })} {...handlers} peek={PEEK} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remote scoring" }));
  expect(onScoringLink).toHaveBeenCalledTimes(1);
  expect(onSettings).not.toHaveBeenCalled();
  expect(onHome).not.toHaveBeenCalled();
  // No pairing held: the button goes and Settings stays, so the absence is not an empty row.
  rerender(
    <StreamColumn
      view={viewOf({ scoring: false })}
      {...handlers}
      peek={PEEK}
    />,
  );
  expect(screen.queryByRole("button", { name: "Remote scoring" })).toBeNull();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

it("before air it is the last of the row, after Take photo", () => {
  renderWithPorts(
    <StreamColumn
      view={viewOf({ scoring: true, shutter: true })}
      {...ICONS}
      peek={PEEK}
    />,
  );
  expect(rowNames()).toEqual([
    "Settings",
    "Home",
    "Take photo",
    "Remote scoring",
  ]);
});

it("on air it follows Take photo and leads What viewers see, and Home is not offered (leaving is not allowed on air)", () => {
  renderWithPorts(
    <StreamColumn
      view={viewOf({
        onAir: true,
        action: "stop",
        scoring: true,
        shutter: true,
      })}
      {...ICONS}
      canLeave={false}
      peek={PEEK}
    />,
  );
  expect(rowNames()).toEqual([
    "Settings",
    "Take photo",
    "Remote scoring",
    "What viewers see",
  ]);
});
```

**Glyph and IconButton** (PR B moved the counts; read them first): `Glyph.test.tsx`'s `DRAWN` gains `['qr', ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2M14 19h2M18 18h3v3h-3z'], [], 0]` with the comment `// the plan's drawing (D9 of PR B's convention), not the canvas's`, and its two counts move from 6 to 7 (`drew all seven glyphs`). `IconButton.test.tsx`'s `BUTTONS` gains `['qr', 'Remote scoring']` and its two counts move from 3 to 4.

**`noScreenshotBlock.test.ts`** (`domain` project; D9). Reads `package.json` and the source trees and asserts none names `expo-screen-capture`, `FLAG_SECURE`, `preventScreenCapture` or `setSecure`. **The needles are built from parts** (`['FLAG', 'SECURE'].join('_')`), or this file would name them and fail itself. It reads `src`, `app` and `modules` with `readdirSync(dir, { recursive: true })`, skipping any path with a `build` or `node_modules` segment, for `.ts`, `.tsx`, `.kt`, `.java`, `.xml`; `package.json` is parsed and its `dependencies` and `devDependencies` keys checked. Anti-vacuity: print the number of files scanned once, and assert `scanned` is at least that count rounded down to the nearest 50 (it must be well over 100: the Kotlin core alone is dozens of files), plus a positive control: a string built the same way (`['Flag', 'Secure'].join('_').toUpperCase()`) is found by the same matcher in a scratch string, so the matcher is not dead.

**`scoringFit.test.ts`** (`domain` project; **F6 and F7**; the shape of `homeFit.test.ts`: `loadFont` from `test/fontMetrics.ts`, the dictionaries, the four `GEOMETRIES` copied with their comment, and a local `linesOf`, the 12-line helper `homeFit.test.ts` keeps, copied rather than exported to keep this task off that file). Two halves:

**(A) The on-air icon row, measured (F6).** Four cells in the row (Settings, Take photo, Remote scoring, the peek: pinned on the rendered tree by `StreamScreen.layout.test.tsx`'s on-air test above), three of them 48 dp icon buttons and three `space.sm` gaps, so the peek cell is `W/2 - 2 × layout.controlsPad - 3 × layout.iconButton - 3 × space.sm`: **120 dp at 640**, 200 at 800, 222 at 844, 257.5 at 915. The peek button inside it has a `layout.iconBorder` border and `space.sm` of padding each side, so its text is 102 wide at 640. The label is `actionSecondary` (Barlow Condensed 600 at 16, letter-spacing 0.6, uppercase): `loadFont('barlow-condensed-600').width(label.toUpperCase(), 16) + 0.6 × [...label].length`. The reason is `metricUnit` (Geist 500 at 12) across the whole cell. Per geometry and language (16 rows, counted):

- every **word** of the label fits the text width by itself (a longer word would break mid-word);
- `linesOf(label, textWidth, measure)` is at most `layout.peekLabelLines`, and the reason's lines at most `layout.peekReasonLines`;
- the on-air controls half still fits: `stack([layout.plateHeight, layout.meterHeight, typeScale.metricUnit.lineHeight, rowHeight, layout.holdHeight], layout.controlsGap, layout.controlsPad) <= H` (RP7: the third item is PR B's photo line, 16, exactly as `viewfinderFit.test.ts` stacks it; an earlier draft had `0` there, which understated the half by 16 dp and so could pass a geometry where the real half did not fit), with `rowHeight = max(layout.iconButton, labelLines × typeScale.actionSecondary.lineHeight + 2 × layout.iconBorder) + space.xs + reasonLines × typeScale.metricUnit.lineHeight` (the reason is shown only while there is no viewer picture: the worst case);
- **at 640 the numbers are asserted as they were measured, not as hoped.** The label takes **2 lines in all four languages** (it is wider than the 102 dp in every one: 119.7, 136.3, 140.9 and 113.5 dp; `expect(lines).toBe(2)` per language), and the reason takes 2 in es and nl and 1 in en and fr (its es width, 120.9 dp, is 0.9 dp over the cell, so the test asserts `<= layout.peekReasonLines` for the reason and `Math.max(...reasonLines)` is `2` as an anti-vacuity: if no language wrapped, the 2-line reserve in `viewfinderFit.test.ts` would be a number nothing needs). The widths are measured from the shipped font files and the dictionaries, never from `layout`: there is no `peekMin` token to compare against itself. **And the 640 on-air stack is pinned as a literal (RP7):** with 2 label lines and 2 reason lines (es and nl, the worst) `rowHeight` is `max(48, 2 × typeScale.actionSecondary.lineHeight + 2 × layout.iconBorder) + space.xs + 2 × typeScale.metricUnit.lineHeight = 84`, so the stack is `56 + 12 + 16 + 84 + 72 + 4 × 12 + 2 × 16 = 320`, `expect(stack).toBe(320)`, the same number `viewfinderFit.test.ts` pins (the two fit files stack the same half; they must agree).
- `layout.peekLabelLines` is derived, not typed, in the test: `Math.floor((48 - 2 × layout.iconBorder) / typeScale.actionSecondary.lineHeight)` (`ViewerPeek`'s `minHeight` literal is 48) must equal it, so the token cannot drift from the component's height.

**(B) The code panel, and the QR's size (F7).** The panel is `absoluteFill` of the camera half, with `layout.controlsPad` padding and `layout.controlsGap` between its children, so the shown panel's stack is the title (`control`, 18), the QR, the hint (`metricUnit`, 16 a line), and Hide (`layout.iconButton`), **four** items and three gaps (an earlier draft counted three items and two gaps and left the title out: F7). Its width is the half's less the padding (`W/2 - 2 × layout.controlsPad`: 288 at 640).

- The title is one line in all four languages (measured at `control`, Geist 500 at 14), the hint is one line in all four at 288 (measured at `metricUnit`; the widest is French at 257.4 dp, so `<= 2` with the max pinned at `1`).
- **`qrSize` is derived, then pinned.** `UNITS` is `seaznQrPlan(url).total` for both environments' urls (`FAKE_SCORING_URL`, and the same with `seazn.club` for `stg.seazn.club`), asserted equal to each other and `57` (49 modules + 2 × 4 quiet, Task 7). `room = 360 - 2 × layout.controlsPad - 3 × layout.controlsGap - typeScale.control.lineHeight - hintLines × typeScale.metricUnit.lineHeight - layout.iconButton - SLACK` with `SLACK = 4`; `perModule = Math.floor(room / UNITS)`; then `expect(layout.qrSize).toBe(perModule * UNITS)`, **and the literal pins** `expect(perModule).toBe(3)` and `expect(layout.qrSize).toBe(171)`. A whole number of dp per module is what makes the edges crisp without `shapeRendering` (D13, F8).
- **Largest, and fits.** The shown panel is `18 + 171 + 16 + 48 = 253` for the four items, `3 × 12 = 36` for the gaps and `2 × 16 = 32` for the padding: **321 of 360** (RP7), pinned as a literal, `expect(stack([title, layout.qrSize, hint, layout.iconButton], controlsGap, controlsPad)).toBe(321)`, beside the derived checks. `stack([title, layout.qrSize, hint, layout.iconButton], controlsGap, controlsPad) + SLACK <= 360` at every geometry's height (`360, 360, 390, 412`); and one more dp per module does **not** fit: `stack([title, 4 × UNITS, hint, layout.iconButton], …) > 360` (`4 × 57 = 228` makes it `378`), so a `qrSize` of 228 (or any other too-large multiple) fails here and a too-small one fails the derived equality.
- The QR fits the panel's width at 640: `layout.qrSize <= 288`.
- **The panel without a code fits too.** `asking` and the six refusal sentences (with `{seconds}` filled with `300`, the widest, as `budgets.test.ts` does) are `body` text (Geist 400 at 15, line 22), measured in 288: `stack([title, lines × typeScale.body.lineHeight, layout.iconButton], …) <= 360` for every sentence in every language: `(6 + 1) × 4 = 28` strings, counted. The measured worst is 2 lines (the Spanish, French and Dutch `codeEnded`, `unavailable` and others).
- Counters: `geometriesChecked` is `4`, the row cases `16`, the panel strings `28`.

**`viewfinderFit.test.ts`** (RP7): the on-air `CONTROLS` entry (five items at `a9079cf`: plate 56, meter 12, **PR B's photo line 16**, the icon item 68, hold 72) changes its icon item's reason line from one line to `layout.peekReasonLines × typeScale.metricUnit.lineHeight` (so the item is `48 + 4 + 32 = 84`, not 68) with the comment `// the peek cell is 120 dp at 640 since Remote scoring joined the row: es and nl wrap the reason to two lines (scoringFit.test.ts measures it)`. **The on-air total at 640 × 360 is 320, not 304**: `56 + 12 + 16 + 84 + 72 = 240` for the five items, `4 × 12 = 48` for the gaps, `2 × 16 = 32` for the padding. (An earlier draft summed four items and got 304 by leaving PR B's photo line out; 304 is what `a9079cf` itself comes to with the 68 dp icon item, so Remote scoring costs exactly 16.) The new entry pins the total as a literal, `expect(stack(onAir, layout.controlsGap, layout.controlsPad)).toBe(320)` (on purpose: it fails if the photo-line item is dropped, which is how 304 was written), and it must stay `<= 360`, with 40 dp to spare. The before-air entry and the strip test and the `GEOMETRIES` stay as they are.

`budgets.test.ts` gains (RP1; line numbers at `a9079cf`): `[/^stream\.scoring\.title$/, 20]` (an icon button's accessible name and a panel title), `[/^stream\.scoring\.refused\./, 56]`, `[/^stream\.scoring\.(hint|asking|code)$/, 48]`, `[/^stream\.scoring\.hide$/, 14]`, **as new rows right after `[/^stream\.photo\.(saved|failed)$/, 36]` (`:33`, the Take photo group, whose comment says the same of its own keys)**, and `seconds: '300'` in `WIDEST` (declared `:40`), after its `duration: '10:00:00'` entry (`:44`). (`code` is a screen-reader name, but a budget row per key keeps a new key from being added unbudgeted.)

- [ ] **Step 2: Run red** for every new and changed file, and read why each fails (a missing module, a missing field, a missing button), not just that it does. `scoringFit.test.ts` is red on `layout.qrSize`/`layout.peekLabelLines` being undefined; `noScreenshotBlock.test.ts` is green from the start (it guards an absence): its true red is the mutation (h) below.

- [ ] **Step 3: Implement.**

`tokens.ts`, in `layout`, with their comments:

```ts
  /**
   * Spec §10, Q-C2: the Remote scoring code, drawn at a whole number of dp per module so every module edge lands on a
   * pixel (D13): 3 × the 57-unit symbol (49 modules + a quiet zone of 4 each side). The largest such multiple that
   * fits the smallest half with the title, the hint, Hide and 4 dp to spare (scoringFit.test.ts derives it).
   */
  qrSize: 171,
  /** The lines the peek's label and its reason may take in the 120 dp cell at 640: measured by scoringFit.test.ts, read by it and by viewfinderFit.test.ts. */
  peekLabelLines: 2,
  peekReasonLines: 2,
```

`useViewfinder.ts`: add to `Viewfinder` after PR B's `shutter`, and to `project`'s result:

```ts
  /** A pairing is held, so Remote scoring is offered (spec §10, Q-C2): Paired and on air, before and during live. */
  readonly scoring: boolean;
  // …
    scoring: kind === 'paired' || action === 'stop',
```

`useScoringLink.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectHeldCode,
  selectHeldSlot,
  selectHeldTokenTag,
} from "@/hooks/engineSelectors";
import { useEngineSelector } from "@/hooks/useCaptureEngine";
import { usePorts } from "@/hooks/usePorts";
import type { ScoringWord } from "@/services/scoringLinkPort";

/** Spec §10: the code hides itself after 10 s. Counted from the moment it is shown, not from the tap. */
export const SCORING_SHOW_MS = 10_000;

export type ScoringLinkView =
  | { readonly kind: "hidden" }
  | { readonly kind: "asking" }
  | { readonly kind: "shown"; readonly url: string }
  | {
      readonly kind: "refused";
      readonly word: ScoringWord;
      readonly retryAfterS: number | null;
    };

const HIDDEN: ScoringLinkView = { kind: "hidden" };

/**
 * Spec §10. The scoring url is a credential, so it lives only in this hook's state while the code is up: never in a
 * store, a ref that outlives it, a log field or the engine. One ask at a time; the answer to an ask that was hidden
 * meanwhile is dropped by its token. `open` and `hide` are stable, so the memoised column skips (M7).
 */
export function useScoringLink() {
  const { scoringLink, foreground, clock, logger } = usePorts();
  // What names the pairing, as three scalars: a new pairing is a new code, and the link in hand is for the old one.
  const code = useEngineSelector(selectHeldCode);
  const slot = useEngineSelector(selectHeldSlot);
  const tokenTag = useEngineSelector(selectHeldTokenTag);
  const [view, setView] = useState<ScoringLinkView>(HIDDEN);
  const ask = useRef(0); // the request token: every hide and every new ask moves it
  const busy = useRef(false); // asking, or the code is up: a tap meanwhile is ignored
  const blockedUntil = useRef(0); // epoch ms; the server's Retry-After, honoured even for an answer nobody saw
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const hide = useCallback(() => {
    ask.current += 1; // whatever is in flight is no longer wanted
    busy.current = false;
    clear();
    setView(HIDDEN);
  }, [clear]);
  const show = useCallback(
    (next: ScoringLinkView) => {
      busy.current = next.kind === "shown";
      setView(next);
      clear();
      timer.current = setTimeout(hide, SCORING_SHOW_MS);
    },
    [clear, hide],
  );
  const open = useCallback(() => {
    if (busy.current) return;
    const waitMs = blockedUntil.current - clock().getTime();
    if (waitMs > 0) {
      // Rate limited: say so again, with what is left, and ask nothing.
      show({
        kind: "refused",
        word: "rate_limited",
        retryAfterS: Math.ceil(waitMs / 1000),
      });
      return;
    }
    ask.current += 1;
    const token = ask.current;
    busy.current = true;
    clear();
    setView({ kind: "asking" });
    logger.info("scoring.open");
    void scoringLink.request().then((outcome) => {
      if (!alive.current) return;
      if (
        outcome.kind === "refused" &&
        outcome.word === "rate_limited" &&
        outcome.retryAfterS !== null
      ) {
        blockedUntil.current = clock().getTime() + outcome.retryAfterS * 1000;
      }
      if (token !== ask.current) return; // hidden meanwhile: not wanted, never shown
      if (outcome.kind === "ok") {
        logger.info("scoring.shown"); // the words only: the url is never a log field
        show({ kind: "shown", url: outcome.url });
        return;
      }
      logger.warn("scoring.refused", {
        reason: outcome.word,
        retryAfterS: outcome.retryAfterS,
      });
      show({
        kind: "refused",
        word: outcome.word,
        retryAfterS: outcome.retryAfterS,
      });
    });
  }, [clock, clear, logger, scoringLink, show]);

  useEffect(() => foreground.subscribeBackground(hide), [foreground, hide]);
  // Another code, or none: the link in hand is for a match this pairing no longer holds. Runs on mount too: harmless.
  useEffect(() => hide(), [code, slot, tokenTag, hide]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clear();
    };
  }, [clear]);
  return { view, open, hide };
}
```

(`scoring.open`, `scoring.shown` and `scoring.refused` are JS record events with allow-listed fields only: `reason` and `retryAfterS` are on `allow-list.json`'s `plain` list, "a reason word" and "JS: seconds". `ScoringLinkPort.request()` never rejects (Task 6), so the `.then` needs no `.catch`; if the port's contract ever changes, a rejection would leave the view `asking` until the next Hide, which is why the port's own test pins "never rejects".)

`ScoringLinkPanel.tsx`:

```tsx
import { memo, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { seaznQrPlan } from "@/domain/qr/seaznQr";
import { useT } from "@/hooks/useLanguage";
import type { ScoringLinkView } from "@/hooks/useScoringLink";
import type { MessageKey } from "@/i18n/messages";
import type { ScoringWord } from "@/services/scoringLinkPort";
import { SeaznQr } from "@/ui/components/SeaznQr";
import { Text } from "@/ui/components/Text";
import { colour, layout, radius, space } from "@/ui/theme/tokens";

/** By literal and typed over every word: a new word is a compile error, and each key type-checks. */
const REFUSED: Readonly<Record<ScoringWord, MessageKey>> = {
  code_ended: "stream.scoring.refused.codeEnded",
  replaced: "stream.scoring.refused.replaced",
  match_finished: "stream.scoring.refused.matchFinished",
  not_entitled: "stream.scoring.refused.notEntitled",
  rate_limited: "stream.scoring.refused.rateLimited",
  unavailable: "stream.scoring.refused.unavailable",
};

type PanelProps = {
  readonly view: ScoringLinkView;
  readonly onHide: () => void;
};

/**
 * Spec §10, Q-C2: the code over the camera half, for at most 10 s. It is drawn over the shot on purpose and it is the
 * second thing that is (AGENTS §6); the controls half, Stop included, stays live beside it. The url goes to
 * `seaznQrPlan` and nowhere else, and the plan is made once per url.
 */
export const ScoringLinkPanel = memo(function ScoringLinkPanel({
  view,
  onHide,
}: PanelProps) {
  const { t } = useT();
  const url = view.kind === "shown" ? view.url : null;
  const plan = useMemo(() => (url === null ? null : seaznQrPlan(url)), [url]);
  if (view.kind === "hidden") return null;
  return (
    <View testID="scoring-panel" style={styles.panel}>
      <Text variant="control">{t("stream.scoring.title")}</Text>
      {plan === null ? null : (
        <>
          <SeaznQr
            plan={plan}
            size={layout.qrSize}
            label={t("stream.scoring.code")}
          />
          <Text variant="metricUnit">{t("stream.scoring.hint")}</Text>
        </>
      )}
      {view.kind === "asking" ? (
        <Text variant="body">{t("stream.scoring.asking")}</Text>
      ) : null}
      {view.kind === "refused" ? (
        <Text variant="body" style={styles.sentence}>
          {view.word === "rate_limited"
            ? view.retryAfterS === null
              ? t(REFUSED.unavailable) // no number to say: the generic "try again"
              : t(REFUSED.rate_limited, { seconds: view.retryAfterS })
            : t(REFUSED[view.word])}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("stream.scoring.hide")}
        onPress={onHide}
        style={styles.hide}
      >
        <Text variant="control">{t("stream.scoring.hide")}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: layout.controlsGap,
    padding: layout.controlsPad,
    backgroundColor: colour.ground,
  },
  sentence: { textAlign: "center" },
  hide: {
    minHeight: layout.iconButton,
    minWidth: layout.iconButton,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
});
```

`Glyph.tsx`: `GlyphName` gains `'qr'`; the chain's last branch (PR B's `ShutterGlyph`) becomes `name === 'shutter' ? <ShutterGlyph /> : <QrGlyph />`, and:

```tsx
/** The plan's drawing (Remote scoring): three finder squares and a few data cells, in the others' stroke. */
function QrGlyph() {
  return (
    <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2M14 19h2M18 18h3v3h-3z" />
  );
}
```

`StreamColumn.tsx`: `ColumnProps` gains `readonly onScoringLink: () => void;`; `IconRowProps` gains `readonly scoring: boolean; readonly onScoring: () => void;`; `StreamColumn` passes `scoring={view.scoring}` and `onScoring={props.onScoringLink}`. In `IconRow`, **the two camera-side buttons travel together** (PR B's `shutter` const, then `scoring`):

```tsx
const scoring = props.scoring ? (
  <IconButton
    glyph="qr"
    label={t("stream.scoring.title")}
    onPress={props.onScoring}
  />
) : null;
const camera = (
  <>
    {shutter}
    {scoring}
  </>
);
return (
  <View testID="icon-row" style={styles.iconRow}>
    <IconButton
      glyph="settings"
      label={t("stream.link.settings")}
      onPress={props.onSettings}
    />
    {props.onAir ? camera : null}
    <ColumnPeek
      onAir={props.onAir}
      peekable={props.peekable}
      peek={props.peek}
    />
    {props.canLeave ? (
      <IconButton
        glyph="home"
        label={t("stream.home")}
        onPress={props.onHome}
      />
    ) : null}
    {props.onAir ? null : camera}
  </View>
);
```

(Re-read PR B's `IconRow` before editing: if it differs from the above, keep PR B's structure and only add `scoring` immediately after `shutter` in each place. The doc comment gains "and Remote scoring (§10)". A fragment of two nullable children renders nothing when both are null, so Ended and idle stay `[Settings, Home]`.)

`StreamStage.tsx`: `StageProps` gains `readonly scoring: ScoringLinkView; readonly onHideScoring: () => void;`, and `<ScoringLinkPanel view={props.scoring} onHide={props.onHideScoring} />` is the **last child of `camera-half`**, after `StatusStrip` (so it paints over the box and the strip). The component's doc comment (`StreamStage.tsx:24-30` at `a9079cf`) changes in two places (RP6). "Nothing is drawn over the shot but the overlay preview and the peek" becomes "Nothing is drawn over the shot but the overlay preview and the peek, and, for at most 10 s on a tap, the Remote scoring code (AGENTS §6, Q-C2)". And its last sentence, **"It keeps no buttons." (`:30`), is stale** once _Hide_ joins the camera half, and becomes "Its one button is the Remote scoring panel's _Hide_, while the panel is up; the controls half keeps the rest.". A comment that says the half has no buttons, above a half that has one, is how the next reader deletes the panel. `StreamScreen.tsx`: `const scoring = useScoringLink();`, `scoring={scoring.view}` and `onHideScoring={scoring.hide}` to the stage, `onScoringLink={scoring.open}` to the column.

Copy (RP8): add the eleven keys of _Copy_ to the four dictionaries. **No dictionary carries a `_review` key at `a9079cf`, so there is none to keep:** add `"_review": "pending translation review"` to **es, fr and nl** (the keys are new), and **never to en** (`dictionaries.test.ts` asserts `'_review' in en` is false). Task 10 reviews the copy and clears the markers. Keys are typed (`MessageKey` is `keyof typeof en`), so a missing key is a `tsc` error; `dictionaries.test.ts` holds the key sets and placeholders equal across the four.

- [ ] **Step 4: Run green** on every file named above, plus `IconButton.test.tsx`, `StreamColumn.test.tsx`, every `StreamScreen.` file, `viewfinderFit.test.ts`, `homeFit.test.ts` and `settingsFit.test.ts` (they share `fontMetrics.ts`), `src/i18n/`, `HoldAction.test.tsx`, `ViewerPeek.test.tsx`, `useViewfinder.shutter.test.tsx`, `StatusStrip.stage.test.tsx`. Confirm the printed names and the totals. Then typecheck, lint, format. `pnpm i18n:release-check` is expected to FAIL until Task 10 (the markers), so do not run it here.

- [ ] **Step 5: Mutations (named, each alone, restored from a `cp` backup).**
      (a) `token`: delete `ask.current += 1;` from `hide`; case 5 (the answer after Hide is dropped) must fail.
      (b) `in flight`: delete `if (busy.current) return;`; case 5's second-tap check and case 7 must fail.
      (c) `from the answer`: start the timer in `open` (arm `setTimeout(hide, SCORING_SHOW_MS)` there) and not in `show`; case 3 must fail.
      (d) `rate limit`: drop the `waitMs > 0` branch; case 9 must fail.
      (e) `unseen rate limit`: move the `blockedUntil` update below the `token !== ask.current` return; case 10 must fail.
      (f) `background`: delete the `subscribeBackground` effect; case 11 must fail.
      (g) `pairing change`: delete the `[code, slot, tokenTag, hide]` effect; case 12 must fail (both rows).
      (h) `screenshot block`: add `FLAG_SECURE` to a comment in `src/ui/screens/StreamScreen.tsx`; `noScreenshotBlock.test.ts` must fail.
      (i) `leak`: log `{ url: outcome.url }` on `scoring.shown`; case 14 must fail (the fake port does not protect it, so `url`, a public-URL key, passes the scrub).
      (j) `alive`: delete the `if (!alive.current) return;` line; case 13's asking row must fail on the leaked timer. And delete `clear()` from the unmount cleanup; case 13's shown row must fail.
      (k) `no refusal code`: render `SeaznQr` for `refused` too; the panel test's `no seazn-qr` and the screen test 4 must fail.
      (l) `size`: set `qrSize` to `228`; `scoringFit.test.ts`'s derived equality, its literal `171` and its fit must fail. And set it to `114`: the derived equality and the literal must fail (a too-small code is also a failure).
      (m) `scoring gate`: make `scoring` `kind === 'paired'`; `useViewfinder.scoring.test.tsx` must fail on the seven-of-ten count and the screen test 2 (on air) must fail.
      (n) `placement`: render the panel in `StreamColumn` instead of `StreamStage`; screen tests 1 and 3 (the panel is in `camera-half`, the controls half is unchanged) must fail.
      (o) `order`: put `{scoring}` before `{shutter}` in `camera`; the three layout arrays must fail.
      (p) `peek lines`: set `peekLabelLines` to `1`; `scoringFit.test.ts` must fail (the label takes two lines in every language). Set `peekReasonLines` to `1`; it must fail on es and nl.
      (q) `column() prop` (RP2): delete `onScoringLink={vi.fn()}` from `StreamColumn.test.tsx`'s hand-built `column()`. Vitest stays green (it does not type-check) and **`pnpm typecheck` goes red**: that is the only checker of that edit, so run it and say so.
      (r) `on-air total` (RP7): drop the photo-line item (`typeScale.metricUnit.lineHeight`, 16) from `viewfinderFit.test.ts`'s on-air entry; the literal `toBe(320)` must fail (304).
      (s) `photo line in scoringFit` (RP7): put `0` back for the photo line in (A)'s stack; the 640 literal `toBe(320)` must fail (304).
      The `alive`-guard and `clear`-on-unmount lines are the only two here with a possible equivalent: if (j)'s second mutation survives, the unmount cleanup is covered by something else and the test's claim is wrong, so find which line covers it and say so in the report.

- [ ] **Step 6: Commit** `feat(viewfinder): the Remote scoring code on a tap, over the camera half, hiding after 10 s (spec §10)`.

---

## Task 9: Force one RTMPS session on staging — SKIPPED (RQ-C3: the web lane's owner runs the forced-RTMPS test themselves)

**Skipped by controller ruling (RQ-C3, 2026-10-08): do not build, review or gate any of this task, and no other task depends on it.** Its text stays below, unchanged, only so the ruling can be reversed. The facts for the choice are _Code facts_, fact 10.

**Files:**

- Modify: `src/hooks/nativePorts.ts`, `src/hooks/engineWiring.ts`, `src/hooks/usePorts.tsx`, `src/hooks/usePairing.ts`, `test/fakePorts.ts`, `modules/capture-engine/src/CaptureEnginePort.ts`, `modules/capture-engine/src/intentWire.ts`, `…/core/Pairing.kt`, `…/core/Pairings.kt`, `…/core/Answers.kt`, `…/adapter/PairMapping.kt`, `modules/capture-engine/src/scrub/allow-list.json`
- Test: `src/hooks/engineWiring.test.ts`, `src/hooks/usePairing.test.tsx`, `modules/capture-engine/src/intentWire.test.ts`, `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts` (the `bridge` project), `…/adapter/PairMappingTest.kt`, `…/core/StartTest.kt`, `…/core/Configs.kt` (a fixture parameter), `…/core/ScrubParityTest.kt` and `src/services/scrubParity.test.ts` (the `kinds` count, 84 to 85)

**Interfaces:**

- Produces: build flag `EXPO_PUBLIC_FORCE_RTMPS=1`; `Ports.forceRtmps: boolean`; `PairIntent.rtmpsOnly?: true`; `PairRequest.rtmpsOnly: Boolean = false`; `BroadcastDescriptor.rtmpsOnly(): BroadcastDescriptor?`; record kind `dev-rtmps-only`.

The flag is honoured **only for a staging pairing** (`Environment.STAGING`), in any build type, so the owner's local release build can carry it and a production build can never force a club's real broadcast onto RTMPS. JS decides it once, in `forceRtmps(flag, environment)` when the ports are built, and native decides it again from the pair intent's own `environment`: two guards, each mutated alone.

**F17.** The record line is written **only when the pairing was forced** (an earlier draft of this task wrote it only when SRT had been dropped, which says nothing in the one case that matters: a forced run that did not drop SRT). It names the transport actually armed, so a forced run that ended on SRT shows `transport: srt` instead of silence. The kind is in `allow-list.json` (one source for both sides), and the test the first version only described is written out below.

- [ ] **Step 1: Failing tests.**

`Configs.kt` (a fixture, test code): `pairRequest(...)` gains `rtmpsOnly: Boolean = false` after `codeUrl`, passed to `PairRequest(..., rtmpsOnly = rtmpsOnly)`.

`StartTest.kt`, next to the A18 test (`A18 RTMPS alone plans no fallback…`, `:486` before the other tasks moved it; re-pin). The machine rig is the idiom: `MachineRig(request, descriptor).armed()` pairs, answers the code open and connects.

```kotlin
  private fun forced(descriptor: BroadcastDescriptor = Configs.descriptor()) =
    MachineRig(request = Configs.pairRequest(rtmpsOnly = true), descriptor = descriptor).armed()

  private fun said(rig: MachineRig) =
    rig.commands.filterIsInstance<Command.Record>().map { it.entry }.filter { it.kind == "dev-rtmps-only" }

  @Test fun `PR C Task 9 a forced pairing arms on RTMPS alone, with no fallback, and says so once`() {
    val rig = forced()
    val session = assertIs<Phase.Armed>(rig.phase).session
    assertEquals(Transport.RTMPS, session.config.primary.transport)
    assertNull(session.config.fallback)
    assertEquals(false, session.broadcast.srtOffered)
    val lines = said(rig)
    assertEquals(1, lines.size, "once per broadcast")
    assertEquals(Transport.RTMPS, lines.single().field("transport"))
    assertTrue("dev-rtmps-only" in Shared.read("scrub/allow-list.json").getJSONObject("kinds").keySet(), "a kind off the list is masked")
  }

  @Test fun `PR C Task 9 an unforced pairing is untouched: SRT first, RTMPS behind it, and no line`() {
    val rig = MachineRig().armed()
    val session = assertIs<Phase.Armed>(rig.phase).session
    assertEquals(Transport.SRT, session.config.primary.transport)
    assertEquals(Transport.RTMPS, session.config.fallback?.transport)
    assertEquals(true, session.broadcast.srtOffered)
    assertEquals(0, said(rig).size, "the line is the flag's alone")
  }

  @Test fun `PR C Task 9 a forced pairing on a server that already sent RTMPS alone still says so`() {
    val rig = forced(Configs.descriptor(primary = Configs.rtmps, fallback = null))
    val session = assertIs<Phase.Armed>(rig.phase).session
    assertEquals(Transport.RTMPS, session.config.primary.transport)
    assertEquals(1, said(rig).size, "iff forced, whether or not anything was dropped")
  }

  @Test fun `PR C Task 9 rtmpsOnly keeps the RTMPS target and every other field, from either slot, and is null with none`() {
    val both = Configs.descriptor()
    val kept = assertNotNull(both.rtmpsOnly())
    assertEquals(Configs.rtmps.url, kept.primary.url)
    assertNull(kept.fallback)
    assertEquals(false, kept.srtOffered)
    for ((name, was, now) in listOf(
      Triple("playbackUrl", both.playbackUrl, kept.playbackUrl), Triple("overlayUrl", both.overlayUrl, kept.overlayUrl),
      Triple("label", both.label, kept.label), Triple("maxDurationMinutes", both.maxDurationMinutes, kept.maxDurationMinutes),
      Triple("scoreUpdates", both.scoreUpdates, kept.scoreUpdates), Triple("warmingDeadlineEpochS", both.warmingDeadlineEpochS, kept.warmingDeadlineEpochS),
      Triple("holdWindowSeconds", both.holdWindowSeconds, kept.holdWindowSeconds),
    )) assertEquals(was, now, name)
    // The RTMPS target in the fallback slot (the usual shape) and in the primary slot (a reversed offer) both land first.
    val reversed = Configs.descriptor(primary = Configs.rtmps, fallback = Configs.srt)
    assertEquals(Configs.rtmps.url, assertNotNull(reversed.rtmpsOnly()).primary.url)
    assertNull(reversed.rtmpsOnly()!!.fallback)
    // SRT alone: nothing to keep, so null (the caller keeps the server's descriptor and the line shows what armed).
    assertNull(Configs.descriptor(primary = Configs.srt, fallback = null).rtmpsOnly())
  }
```

(Read `IngestTarget`'s members before asserting on `url`: `SrtTarget` and `RtmpsTarget` both carry one in `Configs`; if the common supertype names it differently, compare the target objects with `assertSame` on the fixture's own `Configs.rtmps`.)

`PairMappingTest.kt` (`wire()` is the file's builder):

```kotlin
  @Test
  fun `rtmpsOnly is a staging-only flag: a Boolean true keeps it, a word or a number never does, and production never does (PR C Task 9)`() {
    assertEquals(false, PairMapping.request(wire()).rtmpsOnly, "absent is off")
    assertEquals(true, PairMapping.request(wire().also { it["rtmpsOnly"] = true }).rtmpsOnly)
    assertEquals(false, PairMapping.request(wire().also { it["rtmpsOnly"] = false }).rtmpsOnly)
    for (bad in listOf("yes", "true", 1.0, null)) {
      assertEquals(false, PairMapping.request(wire().also { it["rtmpsOnly"] = bad }).rtmpsOnly, "$bad")
    }
    val production = PairMapping.request(wire().also { it["rtmpsOnly"] = true; it["environment"] = "production" })
    assertEquals(Environment.PRODUCTION, production.environment, "the row really is production, so the false below is the rule's")
    assertEquals(false, production.rtmpsOnly, "a production pairing cannot be forced")
  }
```

`NativeCaptureEngine.bridge.test.ts` (the `bridge` project; the seam driven through its REAL producer and consumer: the intent as JS shapes it, `intentWire`, the host, the real core; a fixture on both ends would prove the fixture). After the existing `I-2 a start settles on air` case:

```ts
it("PR C Task 9: a pair that says rtmpsOnly publishes on RTMPS through the real core, and the same pair without it publishes on SRT", async () => {
  const transports: string[] = [];
  for (const rtmpsOnly of [true, false]) {
    host = await startHostEngine();
    host.engine.send(
      rtmpsOnly ? { ...KIT_CODE_A, rtmpsOnly: true } : KIT_CODE_A,
    );
    await host.settle!();
    host.engine.send({ kind: "start" });
    await host.settle!();
    await publishes(host);
    const { state } = host.engine.getSnapshot();
    transports.push(state.kind === "publishing" ? state.transport : state.kind);
    await host.dispose();
    host = null;
  }
  expect(transports).toEqual(["rtmps", "srt"]);
});
```

(Re-pin: the host's default code body, `wire/server-bodies.json`'s `host/` row, must offer both transports for the unforced twin to publish on SRT; read it first. If `ScriptedPlatform` reports the connect's transport some other way than the attempt's, read how `state.transport` is set and keep the assertion on what the snapshot says. The two runs are one case so the pair is read together: a host that always said `rtmps` would pass the first half alone.)

`engineWiring.test.ts` (a pure helper, table-driven):

```ts
describe('forceRtmps (PR C Task 9): a staging-only flag, "1" and nothing else', () => {
  const ROWS = [
    ["1", "staging", true],
    ["1", "production", false],
    ["0", "staging", false],
    ["", "staging", false],
    [undefined, "staging", false],
    ["true", "staging", false],
  ] as const;
  it.each(ROWS)("flag %j on %s is %s", (flag, environment, expected) => {
    expect(forceRtmps(flag, environment)).toBe(expected);
  });
  it("swept 6 rows", () => expect(ROWS).toHaveLength(6));
});
```

`intentWire.test.ts`: a pair intent with `rtmpsOnly: true` is sent with `rtmpsOnly: true`; the same without the key has **no `rtmpsOnly` key** (`Object.keys`); a caller that spreads `rtmpsOnly: false` or a string in is not copied (`Object.keys` has no such key). `pair-intent-vectors.json`'s rows are unchanged.

`usePairing.test.tsx`: next to the case that pairs an idle engine with the build's environment, one with `createFakePorts({ forceRtmps: true })` (the ports overrides): the intent sent has `rtmpsOnly: true`; with the default ports it has no `rtmpsOnly` key (`'rtmpsOnly' in intent` is false); and `pairIntentFor(saved, { …facts, rtmpsOnly: true })` carries it while `pairIntentFor(saved, facts)` does not.

`ScrubParityTest.kt` and `src/services/scrubParity.test.ts`: the `kinds` count goes from 84 (after Task 5) to 85, with the new kind named in the comment.

- [ ] **Step 2: Run red.**

- [ ] **Step 3: Implement.**

`engineWiring.ts` (import `Environment` from `@/domain/session/Pairing`):

```ts
/** A staging-only build flag: the owner's one forced-RTMPS device run (PR C Task 9). Never true in production. */
export const forceRtmps = (
  flag: string | undefined,
  environment: Environment,
): boolean => flag === "1" && environment === "staging";
```

`nativePorts.ts`: `forceRtmps: forceRtmps(process.env.EXPO_PUBLIC_FORCE_RTMPS, seaznEnvironment(env)),` on the returned `Ports`; `usePorts.tsx`: `/** PR C Task 9: staging only; the owner's forced-RTMPS run. */ readonly forceRtmps: boolean;`; `test/fakePorts.ts`: `forceRtmps: false,` in the `ports` object, before `...portOverrides` so a test can override it. Every file that builds a full `Ports` (Task 6's list) gets the field from `tsc`. `usePairing.ts`: `const { engine, logger, streamSettings, environment, forceRtmps } = usePorts();`, `PairFacts` gains `readonly rtmpsOnly?: true;`, the `facts` object gains `...(forceRtmps ? { rtmpsOnly: true as const } : {})`, and the callback's dependency list gains `forceRtmps`; `pairIntentFor` already spreads `...facts`. `CaptureEnginePort.ts`: `readonly rtmpsOnly?: true;` on `PairIntent`, documented ("staging only; native decides again"). `intentWire.ts`: `const { …, environment, rtmpsOnly } = intent;` and `...(rtmpsOnly === true ? { rtmpsOnly: true } : {})` in the returned object.

Kotlin. `PairRequest` (`Pairing.kt`) gains `val rtmpsOnly: Boolean = false,` after `venueTimezone` (and after Task 2's `stageMatch`), documented "PR C Task 9: staging only; set only by PairMapping". `PairMapping`:

```kotlin
    val environment = Environment.of(wire["environment"] as? String)
    return PairRequest(
      // …the fields as they are, with `environment = environment`…
      // PR C Task 9: a staging build's one forced-RTMPS run. A Boolean true only (a word or a number is off), and
      // never for a production pairing: JS decides too, and this is the guard that cannot be built around.
      rtmpsOnly = WireValues.flag(wire["rtmpsOnly"]) == true && environment == Environment.STAGING,
    )
```

(`request` becomes a block body; keep every existing line and comment.) `Answers.kt`, in `BroadcastDescriptor`:

```kotlin
  /**
   * PR C Task 9, staging only: this broadcast with SRT taken away, so the phone publishes RTMPS alone (A18's
   * shape, as if the server had sent `cred.srt: null`). Null when the server offered no RTMPS target.
   */
  fun rtmpsOnly(): BroadcastDescriptor? {
    val rtmps = listOfNotNull(primary, fallback).firstOrNull { it.transport == Transport.RTMPS } ?: return null
    return BroadcastDescriptor(rtmps, null, holdWindowSeconds, playbackUrl, overlayUrl, label, maxDurationMinutes, scoreUpdates, warmingDeadlineEpochS)
  }
```

`Pairings.opened` (the only place a descriptor becomes a session: a reconnect's code fetch reads a verdict and replaces nothing):

```kotlin
    val forced = arming.pairing.request.rtmpsOnly
    val descriptor = if (forced) answer.descriptor.rtmpsOnly() ?: answer.descriptor else answer.descriptor
    // …config, session and the `armed` line as they are…
    // F17: written iff the pairing was forced, once per broadcast, naming what actually armed.
    val forcedLine = if (forced) line("dev-rtmps-only", "transport" to config.primary.transport) else null
    return Step(Phase.Armed(session), listOfNotNull(unreadable, armed, forcedLine))
```

`allow-list.json`, in `kinds`: `"dev-rtmps-only": "native: a staging build forced RTMPS (EXPO_PUBLIC_FORCE_RTMPS), once per broadcast; names the transport that armed (F17)"`. `transport` is already on `plain`.

- [ ] **Step 4: Run green**; typecheck, lint, format; the Gradle classes named above (`StartTest`, `PairMappingTest`, `ScrubParityTest`, `RecordLinesTest`, and the whole `:host` build if the bridge case ran); the bridge project with its one file.

- [ ] **Step 5: Mutations (named, each alone).** (a) `staging only, native`: drop `&& environment == Environment.STAGING` in `PairMapping`; the production row must fail. (b) `staging only, JS`: make `forceRtmps` `flag === '1'` alone; the `'1'` production row must fail. (c) `really drops SRT`: make `rtmpsOnly()` return `this`; the armed test, the `srtOffered` assertion and the unit test must fail. (d) `iff forced`: write the line unconditionally (`val forcedLine = line(…)`); the unforced twin (`0` lines) must fail. (e) `iff forced, the other way`: write it only when `!descriptor.srtOffered`; the third test (RTMPS-alone, forced, still `1` line) must fail. (f) `a Boolean`: read the flag as `wire["rtmpsOnly"] != null`; the `"yes"`, `1.0` and `false` rows must fail. (g) `the seam`: drop `rtmpsOnly` from `intentWire`'s output; the intentWire test **and the bridge case** must fail (the bridge case is the one that proves the producer reaches the consumer). (h) `the hook`: drop `...(forceRtmps ? … : {})` from `usePairing`; the `forceRtmps: true` case must fail. Restore each from a `cp` backup.

- [ ] **Step 6: Commit** `feat(dev): a staging-only build flag that forces one RTMPS session, for the owner's device run`.

---

## Task 10: Translation review, AGENTS.md, and the PR's scoped gate

**Files:**

- Modify: `src/i18n/{es,fr,nl}.json` (clear the `_review` markers that Task 8 added; none exists at `a9079cf`, RP8), `docs/i18n-glossary.md`, `AGENTS.md`, `docs/specs/2026-10-06-s1-design-followup-design.md` (the one sentence in §8, `:162`, RP6)

- [ ] **Step 1: The AI review pass** (`docs/i18n-glossary.md`, _Clearing the marker_). For every key in _Copy_ (eleven): check it against en, where it renders (`grep -a` the key in `src`), the glossary and the budgets; correct it if needed and record the correction in the commit body; remove `_review` from es, fr and nl **where Task 8 added it** (RP8: no `_review` exists in any dictionary at `a9079cf`, so there is nothing to "keep"; the rule is: add `_review` to es, fr and nl for each new or changed key as the task writes it, never to en, and this step clears them). Glossary rows to add (the table has five columns: en, es, fr, nl, note):

  | en                                                       | es                 | fr                   | nl                    | note                                                                                                            |
  | -------------------------------------------------------- | ------------------ | -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
  | scoring link (the address the Remote scoring code opens) | enlace             | lien                 | link                  | fr _lien_, never _liaison_, and nl _link_, never _verbinding_: those are the connection (the _link_ row above). |
  | Hide (a panel)                                           | Ocultar            | Masquer              | Verbergen             |                                                                                                                 |
  | Not on your plan                                         | No está en tu plan | Pas dans votre offre | Niet in je abonnement | Spec §10 names the sentence. The row claims nothing about the web's wording (R-F18).                            |

  The existing _Remote Scoring (mode)_ row gains "and the viewfinder's button and its panel title" in its note: the button's accessible name is the mode's name, and the copy is already the row's (`Anotación remota`, `Score à distance`, `Scoren op afstand`). Check the register on the hint and the refusals (es tú, fr vous, nl je) and that _Try again_ matches its row (`Inténtalo de nuevo`, `Réessayez`, `Probeer het opnieuw`). Then `cd "$WT" && pnpm i18n:release-check; echo "EXIT=$?"` must exit 0.

- [ ] **Step 2: AGENTS.md, as the spec and the rulings say.** Re-pinned (RP1) at `a9079cf`, PR B's head: §2's recorded exception is `AGENTS.md:91-96` (the last lines of the intents bullet) and §6's viewfinder bullet is `:238-245`. If PR B merged with other edits, **read PR B's merged text and edit that**, not the text below if it differs. Edit only these:

  - **§2, PR B's recorded exception (F4's neighbour; R-F3; RP5).** At `a9079cf` the exception reads: _"One recorded exception (design follow-up §8; owner, 2026-10-08): `takePhoto` is a request with an answer, one call that resolves `saved` or `failed` within native's 2 s bound when the call honours cancellation; the app gives up at 4 s. It carries no session state, runs on a scope of its own with no path to the session's failure path, and is never read by the machine, the snapshot or the heartbeat. It is the only such call."_ **Keep every word of it up to the last sentence, verbatim** (the 2 s bound when the call honours cancellation, the app giving up at 4 s: PR B's, measured, not this PR's to reword), change _"One recorded exception"_ to _"Two recorded exceptions"_, and replace only _"It is the only such call."_ with: _"The second is `scoringLink` (design follow-up §10): one call that resolves the Remote scoring link, or one of six refusal words, to the caller that asked, within native's 16 s backstop (`BridgeCore.ANSWER_BACKSTOP_MS`); the app gives up at 12 s, and a late answer is dropped. It carries no session state and is never read by the machine, the snapshot or the heartbeat. Neither call runs on the machine's failure path: `takePhoto` has a scope of its own, and `scoringLink` runs every stage in `ScoringTap.apart`, so what its transport, its reading or its caller throws answers `unavailable` and never reaches the failure path. `scoringLink` answers a scoring credential: its URL is never in a snapshot, the record, a beat or a store, it goes to the one caller that asked, and its secret is masked in both records before the caller has it. These are the only two such calls."_ Three things this text does on purpose. It names **exactly two** calls, each with **its own bound** (2 s and 4 s for `takePhoto`, 16 s and 12 s for `scoringLink`); the earlier draft's _"native's own and a shorter one in JS"_ is gone, since it was true of one and did not say which. _"Neither runs on the machine's failure path"_ stays, and it is true only because of RP4 (Task 5's `ScoringTap` and its tests): if that task is cut, this sentence is cut with it. And it does **not** write _"owner"_ against `scoringLink`: R-F3 is a controller ruling until _Owner answers_ says otherwise (class 17). If the owner overturned R-F3 and the plan went back to an event, this paragraph names an upward event instead and says why.
  - **§6, the viewfinder bullet (F4).** Its sentence _"Nothing is drawn over the camera box but the overlay and the What viewers see video"_ (and PR B's closing clause _"nothing else is drawn over the camera box"_) is amended to name the QR panel as the **second** exception, after the viewer video's own layer (PR B). Append: _"One thing more is drawn over the camera half, on the operator's tap and for at most 10 s: the Remote scoring panel (design follow-up §10; the second exception). It covers the camera half and never the controls half, so Stop is never covered. The round line sits above the match label in the status strip and hides when the strip has no room for it (long doubles on a phone 360 dp tall); the camera box never gives way for it (design follow-up §2)."_
  - **§6, a new bullet after the viewfinder's.** _"Every QR carries the Seazn logo in the centre at error correction H (`src/domain/qr/seaznQr.ts`); the app draws it from a pure plan, at a whole number of dp per module. Nobody screenshots a QR; the app adds no screenshot block and no test depends on one."_
  - **The "one call that answers" sweep (RP6).** Two calls answer now, so every sentence that says one is stale. The code and comment sites were reworded where their tasks touch them (`CaptureEngineModule.kt:36` and `Capture.kt:45` in Task 5; `nativeModule.ts:13` and `:25`, `usePorts.tsx:69` and `photoPort.ts:3` in Task 6); this step does the rest and proves none is left. Spec `docs/specs/2026-10-06-s1-design-followup-design.md:162` (§8): _"It is the one request-with-an-answer among the commands (AGENTS §2, recorded)."_ becomes _"It is one of the two requests-with-an-answer among the commands (the other is the scoring link, §10; AGENTS §2, recorded)."_ Then, from the worktree root, `git grep -an -i -e 'the one call that answers' -e 'only such call' -e 'one request-with-an-answer' -e 'the one request' -- src modules test docs/specs AGENTS.md` must print nothing (at `a9079cf` it prints exactly seven lines: `AGENTS.md:96`, the spec's `:162`, and the five code sites (`nativeModule.ts:13` says "except `takePhoto`" and matches none of the patterns, so it is reworded by hand); it is scoped to `docs/specs`, not `docs`, because PR B's and this plan quote the phrases on purpose) (an empty result from the wrong directory is a false clean, so run it with a positive control: `git grep -an 'two calls that answer' -- src modules AGENTS.md` prints at least the Task 5 and Task 6 comments). `StreamStage.tsx:30` is Task 8's (RP6): "It keeps no buttons" is stale once _Hide_ joins the camera half.
  - Then `pnpm prettier --check AGENTS.md docs/i18n-glossary.md docs/specs/2026-10-06-s1-design-followup-design.md docs/superpowers/plans/2026-10-07-s1-design-pr-c.md`. **`AGENTS.md` may already be prettier-dirty; never `--write` it.** If `--check` fails on it, prove the failure is not in your lines: save `git show HEAD:AGENTS.md` to the scratchpad, run `pnpm prettier --check` on that copy, and show the failure is the same one.

- [ ] **Step 3: The PR's scoped gate.** Scoped means the tests that cover what this branch changed, and nothing else: never `pnpm check`, never `pnpm test`, never `pnpm vitest run` with no path.
  - **Build the file list as an array and assert it is not empty before running.** An empty list in zsh runs the whole suite. The list is every test file named in Tasks 1 to 8 (Task 9 is skipped, RQ-C3) plus the test next to each changed source file (`git diff --name-only $(git merge-base HEAD origin/main) -- 'src' 'modules' 'test'` is where to start). One vitest command, the JSON reporter to a file, `numPassedTests`, `numTotalTests`, `numFailedTests` pasted, and `.testResults[].name` read back to prove the files that ran are the files named (a suite that fails to collect is not in the count).
  - Gradle, from `modules/capture-engine/android/core` (read the XML counts after each): `BodiesTest`, `ScoringLinkTest`, `PairIntentVectorsTest`, `SnapshotWireTest`, `PairingTest`, `PairMappingTest`, `StartTest`, `HostsTest`, `GlueRulesTest`, `BridgeCoreTest`, `ServerBodiesTest`, `ScrubParityTest`, `SessionRecordTest`, `RecordLinesTest`; then `./gradlew :host:test`, then `./gradlew :host:installDist` (the bridge project runs the built host, so a stale binary is the inert seam).
  - The bridge project, `CAPTURE_BRIDGE=1`, with its one file named: `NativeCaptureEngine.bridge.test.ts`.
  - `pnpm typecheck`, `rtk proxy pnpm lint` (read `✖ N problems`), `pnpm format:check`, `pnpm i18n:release-check`.
  - Re-run any command that was ever red in this branch three times. A red you cannot explain is reported, not skipped.

- [ ] **Step 4: Commit** `docs: AGENTS.md and the glossary as the design follow-up §10 rules them; translation review`.

---

## Task 11: Device verification (the owner's hands)

This task is a checklist for the owner. An agent never simulates it, infers it, or ticks it. The results are recorded beside each line. **Never screenshot a QR or a scanned code's raw value;** a QR is checked by scanning it with a second phone. Screenshots are of the app only, and never of the code panel.

Every line below is here because jsdom cannot judge it: the unit tests prove the rule, the arithmetic and the wiring; only a phone shows what a person sees (AGENTS, recurring failure classes 2 and 15). The ruling each line settles is named in brackets.

**The build:** the owner's local build of this branch, never EAS, the normal staging build for every item. No item needs a build flag: Task 9 (forcing RTMPS) is skipped (RQ-C3), so this checklist has no second build (RP9).

- [ ] **1. The Remote scoring code, end to end** [Q-C2, R-F18]. Staging, a fixture with a code paired. The icon row has a button; its accessible name (TalkBack, or the long-press label) is _Remote scoring_ in en, and _Anotación remota_, _Score à distance_ and _Scoren op afstand_ in es, fr and nl. Tap it. The panel covers the camera half; the code shows; the Seazn logo is in the centre. Scan it with a **second phone's own camera app**: the scoring pad opens in the browser on that fixture. Open the same fixture's desktop _Remote scoring_ code and compare: the same address (compare the part after `/score/` by eye on the second phone's address bar, do not copy it anywhere).
- [ ] **2. Ten seconds, Hide, a tap again, and Stop never covered** [D8, Q-C2]. The code goes by itself after about 10 s, counted from when it appeared. _Hide_ closes it at once. Tap again: the same link opens the same pad (the server returns the same link). Leaving the app (Home button) while it is up closes it. **While the panel is up, the camera preview does not show through or around it** (the panel is a view over a native camera surface; z-order is a device fact). **On air, with the panel up, press and hold Stop: the hold fills and Stop works** (the controls half is never covered). **On air, with the panel up, hold _What viewers see_: the viewer video must not draw over the code** (the viewer video is a second native layer, `StageVideo`, over the same camera box; the code has to stay on top of it, and the code has to stay scannable while it plays). Record what you saw (RP9).
- [ ] **3. Fit at 640 × 360 (the smallest landscape), phone and emulator** [R-F5, R-F6, R-F7].
  - **The panel:** the code (171 dp, 3 dp a module), the title, the hint and _Hide_ are all inside the camera half, nothing clipped.
  - **The icon row on air:** Settings, Take photo, Remote scoring and What viewers see. The viewers button's cell is 120 dp wide at 640. Its label **wraps to two lines in en, es, fr and nl** (Task 8 measured this with the shipped fonts; it is expected, not a defect). Record, for each language, whether any word is clipped or breaks mid-word, and what the reason line under the button does while there is no viewer picture (two lines in es and nl). The controls half stays inside the screen: the hold button is fully visible and fully pressable.
  - **The round line (R-F5), said plainly: it is hidden on long doubles at 360 dp tall.** Short singles label: the round line shows above the label. A label that takes **three or four lines** (a long doubles label): the round line is **absent** and nothing is clipped. That is the ruled cost, not a defect, and it holds at every real phone size, not only 360 tall (the strip is 180 dp at all of them). Record the phone's dp size, the label used and how many lines the label took. A round line that shows beside a three-line label, or a label clipped by the line, is a finding.
- [ ] **4. The round line's text, and a kind the app does not know** [spec §2, R-F20]. A pooled group match shows, verbatim, the web's line (for example _Group A · R1_ in an English org, _Grupo A · R1_ in a Spanish one). A knockout match shows its code (_QF_). A match the web gives no stage for shows no line, with no gap above the label. **An unknown role kind shows no line even with a good label:** this needs a fixture whose stage carries a kind outside the contract's list; ask the web lane for one, and if there is none record "not run" (the vectors prove the rule, not the screen).
- [ ] **5. The stable code moves to the next match (Review Focus 1)** [D6]. Pair, see the round line for match 1. Let the organiser re-point the code at match 2 (or change the fixture's match on the web). When the label changes on the phone, the old round line goes. It returns after Go live (the descriptor refresh) if the web gives match 2 a stage. Record what you saw at each step.
- [ ] **6. Each refusal, in the four locales** [D3]. Using a fixture where you can cause each: another phone scanning the same code (_Another phone has this camera now._), the organiser ending the code (_This code has ended. Scan it again._), the match finished (_This match is finished._), an org not on the plan (_Not on your plan_), airplane mode (_Can't reach Seazn. Try again._). None shows a code. Each sentence fits the panel on two lines at most, in all four languages, with nothing clipped.
- [ ] **7. Rate limit, a dead network, and a late answer** [Review Focus 3, R-F3]. Tap the button repeatedly until the server answers 429 (staging allows it): the panel says _Try again in N s_ and taps do nothing but say it again, with the seconds left, until N has passed. Then **airplane mode on, tap:** the panel says it is getting the link, then _Can't reach Seazn. Try again._ after about **12 s** (not at once, not after a minute). Turn the network back on and wait 10 s: **no code appears late** (the late answer is dropped).
- [ ] **8. No leaks** [Review Focus 2]. After items 1 to 7, **Share record** from Settings' Diagnostics card. Open the shared text in a text viewer on a computer and search for `/score/` and `dl_`: neither appears. Search for `scoring-link` and `scoring.shown`: lines exist, carrying only a result word and a status (a `scoring-link` line with `result` `failed` and an `error` class name is the call's own failure note, Task 5; it should not appear on a healthy run, and if it does, record the class).
- [ ] **9. The code scans from a second phone, and nobody screenshots it** [D9, the owner's rule, RP9]. With the code up on the phone under test, scan it with a **second phone's own camera app** and confirm the scoring pad opens in that phone's browser, on the right fixture. **Do not take a screenshot of the code on either phone:** the app adds no screenshot block (D9), and this item does not probe for one. Record yes or no for the scan.
- [ ] **10. The code on real hardware, at the smallest panel** [R-F7, R-F8]. At 640 × 360 and at the phone's own size, look closely: the modules are hard-edged even squares at the phone's pixel density, with no soft or doubled edges (a whole number of dp a module). Then scan it from 30 cm and from 60 cm with two different second phones. Record which phones scanned and any that did not. If 3 dp a module is too small to scan at 60 cm, that is a finding for R-F7: the next size up (228 dp) does not fit with the title.
- [ ] **11. Revoke and reissue.** Staging, a fixture with a code paired. Tap the button and note the link opens its pad. On the web, as the organiser, _Revoke & reissue_ the scoring link. Tap the button again: it opens the **new** link; the old pad no longer scores. (Spec §10: links do not expire; reissuing is what changes one; nothing is cached.)
- [ ] **12. Send r1-laned any session id from an RTMPS device pass** [RQ-C3, RP9]. This PR adds no way to force RTMPS and flips nothing on staging or on the web side (Task 9 is skipped: the web lane's owner runs the forced-RTMPS test themselves). When a pass of this run is on RTMPS (Settings' Diagnostics shows transport RTMPS), copy the one `sid` value from that session's `broadcast-start` record line into your message to r1-laned, and nothing else from the record. Record who it was sent to and when. If no pass of this run was on RTMPS, record "no RTMPS pass; nothing sent", and send nothing.

Any line that fails is a finding for the orchestrator. It is never a change made on the device run.

---

## Self-review

- **Spec coverage.** §10, the button and the code: Task 8 (button, hook, panel), Task 7 (the code drawn by the app, logo, EC H). "The app draws the QR itself, with the Seazn logo in the centre (error correction H)": Task 7, with the decode proof of the **painted** path. "Hides after 10 s, or on _Hide_": Task 8 cases 2, 3, 4, 7. "No screenshot block": Task 8 `noScreenshotBlock.test.ts` (the app adds none); Task 11 item 9 scans the code with a second phone and takes no screenshot (the owner's rule). "One QR format": fact 12, scanner side already true; Task 11 item 1 compares the desktop code. The contract (route, auth, body, 200 shape, six refusals, `Cache-Control`, called only on a tap): Task 5 (`Bodies.scoringLink`, `HttpRequests.scoringLink`, the word table) and Task 1 (pin). "Never logged, never in the session record, never in a beat": Task 5 (native leak tests through `message` and `url`, `protect` before the answer, the link bucket, the `kinds` entry), Task 6 (the JS bucket, `protect` before the port resolves), Task 8 case 14, Task 11 item 8. "Links do not expire; Revoke & reissue changes it; the next tap fetches the new one": no caching anywhere (the hook keeps the url only while shown), Task 8 case 6, Task 11 item 11. §2 round line: Tasks 1 to 4 (contract, native read, JS read and seed, strip). "A missing, empty or over-40 label shows no line": Task 2 vectors (12 rows), Task 3 `stageLine` (8 cases). "Unknown `role.kind` shows nothing": D4, R-F20, the shared `stage-kinds.json` and the vector rows. "The phone never builds or translates it": `StageLine` takes text only. The owner constraints: Global Constraints, verbatim, the first block. The forced-RTMPS run: Task 9 is **skipped** (RQ-C3); Task 11 item 12 only sends the web lane a session id from any RTMPS device pass. A tap that throws: Task 5's `ScoringTap` and its tests (RP4).
- **Placeholder scan.** Searched for TBD, TODO, "appropriate", "similar to Task N": none. A handful of lines say "read X first", each because the executor must open a named file to pin a signature this plan could not run, and each names the file and the thing to read: `IngestTarget`'s member name and `ScriptedPlatform`'s transport report (Task 9, skipped, so owed only if the flag is ever built), `FakeCaptureEngine`'s `pair` handling while paired (Task 8 case 12), `HoldAction.test.tsx`'s press idiom (Task 8 screen test 2), PR B's merged `IconRow`, icon-row tests, AGENTS text and `Glyph`/`IconButton` counts (Tasks 8 and 10); Task 1's four sha256 values are typed from the web repo's files at `7e75fd4a7` and re-checked with `shasum` in Task 1, so a wrong digit is a red pin and not a silent pass. Every test body that carries a guard is written out in full or has its assertions listed one by one with their counts.
- **Type consistency.** `ScoringLinkOutcome` (`kind: 'ok' | 'refused'`, `word`, `retryAfterS`) is defined in Task 6 and read in Task 8's hook; `ScoringWord` is the same six words in Task 5's Kotlin table (`code_ended`, `replaced`, `match_finished`, `not_entitled`, `rate_limited`, `unavailable`), Task 6's `SCORING_WORDS`, Task 8's `REFUSED` map (typed `Record<ScoringWord, MessageKey>`) and its copy keys. `SCORING_URL`'s regex is the contract's `^https:\/\/[^/]+\/score\/dl_[A-Za-z0-9_-]{43}$` in Task 5 (Kotlin) and Task 6 (TS). `stageLabel` / `stageMatch` / `stageFor` are named once each: wire intent keys `stageLabel` and `stageMatch` (Tasks 2, 3), Kotlin `PairRequest.stageMatch` and `WaitingFields.stageFor`, snapshot key `stageLabel`. `seaznQrPlan` and `SeaznQr` props agree between Tasks 7 and 8. `layout.stageLines` is added and used in Task 4; `layout.qrSize`, `layout.peekLabelLines` and `layout.peekReasonLines` in Task 8 (there is no `peekMin`: it compared a token with the arithmetic that produced it). `Viewfinder.scoring`, `Ports.scoringLink` (Task 6), `Logger.protectLink` (Task 6) and `scoringLinkPortFor` (Task 6, consumed by `nativePorts.ts` and pinned by the `wiringOf` AST test) are each produced in one task and consumed in a later one; `ScoringTap` is produced and consumed in Task 5. `Ports.forceRtmps` was Task 9's and does not exist in this PR (RQ-C3), so no `Ports` fixture gains it.
- **Review Focus.** Line 1 (stale stage): Task 2 sequence test and mutation (a). Line 2 (leaks): Tasks 5 and 6 leak tests, Task 8 case 14 and its mutation (i). Line 3 (taps): Task 8 cases 1, 5, 6, 7, 9, 10, 15 and mutations (a), (b), (d), (e); the 12 s bound and the late answer in Task 6. Line 4 (refusals): Task 8 case 8 over the port's own word list, the panel's `no seazn-qr`, screen test 4. Line 5 (bad answers): Task 5 vector rows and mutations, Task 6 cases. Line 6 (logo): Task 7 decode sweep of 6 over the painted path, and painted equals closures. Line 7 (odd round lines): Task 2 vectors (12), Task 3 `stageLine` (8). Line 8 (long double): Task 4's six labels (three shown, three hidden) over the four real geometries, and Task 11 item 3. Line 9 (the fourth cell): Task 8's `scoringFit.test.ts` (16 measured rows, 28 panel strings; the on-air stack pinned at 320, the code panel at 321) and Task 11 item 3. Line 10 (a tap that throws): Task 5's four failure-path tests and two `ScoringTap` units, mutations (m) to (s), and Task 6's wiring tests.
- **Unresolved, by design.** Q-C2 is open until the owner answers; Q-C3 was settled by the controller (RQ-C3: Task 9 is skipped, nothing is put to the owner). RP1 to RP10 are the controller's re-pin rulings against PR B's head `a9079cf`, applied on 2026-10-08. R-F3, R-F5, R-F18 and R-F20 are controller rulings, written so the plan could be finished; the orchestrator puts them to the owner as recommendations, and each says what moves if the owner overturns it. Q-C4 (the round line between matches) is information for the owner, not a decision this PR makes. The icon row's exact arrays depend on PR B's shutter: Task 8 starts from PR B's and re-pins them. The label's real wrap, the round line's yield, the panel's z-order over the camera surface, the code's crispness and its real scan are device-only (Task 11 items 2, 3, 10): jsdom cannot measure them, so Tasks 4 and 8 test the rule, the arithmetic from the shipped fonts, and the wiring, not the fit.
