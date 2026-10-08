# S1 design follow-up, PR B: Take photo, and what viewers see

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, one task per implementer, one reviewer pass per task, in the order below. Steps use checkbox (`- [ ]`) syntax for tracking. Q1 and Q2 are answered (see _Owner answers_). **Lanes** (the ledger's ruling of 2026-10-08; parallel only where the file sets are disjoint): Task 1 then Task 2 in this worktree; Task 3 (orientation, JS-only) in a worktree of its own; Task 4 (a pure rule) in a worktree of its own; Task 5 only after Task 2, because both edit the dictionaries and `budgets.test.ts`. Tasks 6 and 7 come last. All implementers and reviewers run on **sonnet**; never override `model:` on a dispatch.

**Goal:** Ship spec §8 and §9 as one pull request, built from code and JVM/vitest tests only, and marked **UNVERIFIED-ON-DEVICE**:

- a _Take photo_ shutter in the icon row, whenever the camera picture shows (Paired and on air): one tap saves a still of the camera picture (no scorebug) to the phone's gallery, and a failed photo can never touch the broadcast (§8, in the shape the owner cut it to on 2026-10-08);
- _What viewers see_ stops showing "mostly nothing": the player waits for the first Cloudflare window, a visible _Waiting for the first picture_ state and a visible _No viewer picture_ state replace the blank layer, and the player starts, restarts and gives up by rule (§9);
- the carried PR A findings in files this PR touches: the `SoundMeter` leak and two orientation-gate retry defects (Tasks 1 and 3).

**Architecture:**

- **§8.** A still is a request with an answer, not a session intent, so it does not go through the engine, the machine or the snapshot. One new bridge call, `takePhoto`, resolves `saved` or `failed`. Native runs it on a scope of its own with a hard 2 s bound, so a snapshot can never block or fail the session; the app gives up at 4 s. The pure part (the file name and the bound) lives in a new `capture/photo` folder that core's JVM tests compile. The gallery write is `MediaStore` in the Android module (no library, no permission, no Expo config plugin: minSdk is 31).
- **§9.** The "first window" is already known natively: the delivery watch reports `delivery: ok` once a playlist head has advanced (`DeliveryWatch.kt:166`). A pure rule `viewerFeed` turns the engine's kind and delivery word into `none | waiting | playing | unavailable`. The player is mounted only in `playing`, so it is never pointed at a manifest nobody has seen. A `Video` surface status callback drives a bounded retry and a visible _Waiting_ note. The first-window time is written to the record as one number, so the 18–23 s hypothesis is measured, not assumed.

**Tech Stack:**

- Expo SDK 57, React Native 0.86.3, Expo Router, TypeScript strict, `expo-video` 57 (`VideoPlayer.status`, the `statusChange` event);
- vitest projects `domain` (node), `ui` (jsdom with react-native-web, setup `test/setup-ui.ts`), `types`;
- Kotlin with the Gradle core build: JDK 17, `allWarningsAsErrors` on; kotlinx-coroutines 1.10.2 test; StreamPack 3.2.1 (`IVideoInput.takeSnapshot`).

**Spec:** `docs/specs/2026-10-06-s1-design-followup-design.md`, §8 and §9 (binding), read at worktree `0b30ce0`. **Built on PR A:** `docs/superpowers/plans/2026-10-06-s1-design-pr-a.md`. PR A is merged (#13, `adb7f5f`), and PR B builds on its interfaces as that plan defines them (`IconButton`, `Glyph`, the icon row in `StreamColumn`, `controls-gap`, `StatusStrip`, the `Video` surface, `viewfinderFit.test.ts`). Every file name, prop and line number below that belongs to a PR A file is a **re-pin note**: read the merged file before editing (AGENTS failure class 5).

**Sources, in authority order:** the spec; the owner's answers to Q1 and Q2; the _Recommendations_ table once the owner has seen it; this plan's _Plan decisions_.

## Owner question (answered 2026-10-08)

The orchestrator puts this to the owner as a question with a recommended reading, never as a ruling. Spec §9 says: _"The owner's parked question — 'can't see the preview now' — is asked again before PR B starts."_

**Q1. What did "can't see the preview now" mean?**

- **Where it came from.** On 2026-10-06 21:13Z the owner reported the F-D1 symptom as _"mostly nothing and can't see the preview now"_, which the orchestrator recorded as "a blank peek". The second half was ambiguous, the owner was asked, and at 21:15Z the owner deferred it: _"we will come back on this"_ (`s1-plan-c` worktree, `.superpowers/sdd/2026-10-01-s1-plan-c-platform-and-bridge/progress.md:435-438`). The repo holds no other record of its meaning.
- **Three readings, and what each does to PR B.**
  - **(a) The _What viewers see_ layer is blank** (hold the button, nothing appears). This is §9 as written. Task 4 and Task 5 are the fix. _This is the recommended reading_, because it is the only one that matches the word "now" after a change to the peek, and the code reads as one cause of it: the player is created against a manifest that does not exist yet and then stays blank (Plan decisions D6).
  - **(b) The camera preview in the camera box is not visible** (the phone's own picture is black). That is not a PR B defect. It would be a regression in Plan C's preview or in PR A's camera box, and **Take photo depends on it** (a photo of a black preview is a black photo). If this is the meaning, stop: record it as a finding for the orchestrator, fix it before Task 1, and do not build on top of it.
  - **(c) The score overlay preview is not visible** over the camera. Out of scope for §8 and §9. It is `OverlayPreview` and `useStageOverlay`; record it as a separate finding.
- **Answered: (a)**, owner, 2026-10-08 (see _Owner answers_). Task 7, item 7 asks the owner to confirm on the device that the layer is no longer blank.

## Owner answers

_One line per question: the answer, the date, and the owner's words._

- Q1: **(a)**, owner, 2026-10-08: _"a — the What viewers see is blank"_. Tasks 4–5 are the fix, as written.
- Q2 and scope, owner, 2026-10-08: _"need a simply feature, where user can click to photo, nothing make complex"_. The photo is ONE direct call that answers, which is the simple option. Tasks 1 and 2 are that smallest shape (see _Owner scope cut_ below).

**Owner scope cut (2026-10-08).** Take photo is:

- One shutter icon in the icon row, shown whenever the camera picture is showing (Paired and on air).
- One tap: native takes a JPEG of the camera picture, with no scorebug, and saves it to `Pictures/Seazn Capture` as `Seazn_yyyyMMdd_HHmmss.jpg`. There is no permission prompt.
- One line for 3 s: _Photo saved_ or _Couldn't save the photo_.
- A tap while a photo is saving does nothing.

Native answers within a bound and never on the capture's serial queue (a snapshot must never stall the stream). That is the only safety rule.

Dropped:

- the 40-combination photo gate and its shedding and state rules (R5, F5);
- the busy-on-queued-block rule (F7);
- the separate "no picture right now" wording;
- a separate pure-rules task and a separate gate task.

Folded into two tasks: Task 1 (native snapshot, gallery write and bridge call) and Task 2 (the JS call, shutter and line). The four tests that matter are kept: saved; failed; the double tap; the bound when native never answers; and the shutter present in Paired and on air and absent otherwise. All four locales are kept.

**Follow-up, not in PR B (owner "Ok", 2026-10-08): a photo with the scorebug.** If it is wanted later, the candidate is an on-screen copy of the camera box (Android `PixelCopy`, cropped to the box). Spike it on the device first. Its known costs: screen resolution, not camera resolution; it captures whatever sits over the box; rotation and the mirror; and the on-screen score runs ahead of viewers. Never redraw the score in the app.

**Carried from PR A (merged #13, adb7f5f).** These are parked findings in files this PR touches:

- `SoundMeter.kt:32-38` leaks its `AudioRecord` when `startRecording` throws. Task 1 releases it on that path. Core's JVM cannot compile `AudioRecord`, so the local witness is a source-text pin and one mutant (M10), and Task 7, item 12 is the real check.
- `useOrientationGate.ts:58`: the effect cleanup cancels R26's 500 ms retry after a send made while nothing was locked. Cancel only when the lock changes.
- `/stream` after a double refusal under a hold: a tilt gives `keep` and sends nothing. Under a hold with nothing locked, lock the target, as R37 does.

Placed: the `SoundMeter` leak in Task 1; both orientation findings in Task 3, each with a named mutant (M22, M23).

## Owner question 2 (answered 2026-10-08)

**Q2. May `takePhoto` be the one call that is a request with an answer?**

- AGENTS §2 (`AGENTS.md:86-89`): _"Commands are intents, not RPC … return void and are reconciled against native state. A promise that must resolve mid-reconnect is a deadlock waiting for a bad cell."_
- A photo needs an answer the operator can see ("saved", or why not). **Recommendation:** one bounded request. Native answers within 2 s whatever happens (Task 1); JS gives up at 4 s (Task 2); the answer is one of two words; it carries no session state and is never read by the machine, the snapshot or the heartbeat. AGENTS §2 gains one recorded exception (Task 6).
- **Alternative:** a pure intent, with the result carried back on the 1 Hz snapshot as a new field (`lastPhoto: { seq, result }`). That changes the snapshot wire (`SnapshotWire.kt`, `snapshotWire.ts`, both vector files), makes the machine's projection own a UI convenience, and still needs a seq to tell one photo's answer from the last. It is a much larger blast radius for the same operator-visible result.
- **Answered** by the owner's direction of 2026-10-08 (_Owner answers_): the direct call is the simple option, so the alternative is not built.

## Recommendations the owner has not yet ruled on

Settled in this plan so the work can proceed. Each is a recommendation, marked as such, and each is cheap to reverse. The orchestrator shows this table to the owner with Q1 and records any objection under _Owner answers_.

| #   | Recommendation                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                             | Cost if the owner disagrees                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| R1  | **No gallery permission and no permission prompt.** The still is written with `MediaStore.Images` into `Pictures/Seazn Capture`.                                                                                  | The app is minSdk 31 (`EngineHost.kt:162`). From API 29, an app writes its own images to `MediaStore` with no storage permission. Nothing is asked of the operator, ever.                                                                                                                                                       | Task 1 swaps `GalleryPhoto`'s writer for another. The rest holds.                                        |
| R2  | **No gallery library.** `expo-media-library` is not added.                                                                                                                                                        | `package.json` has none (dependencies, lines 25-52). Adding it would need its config plugin, `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`/`READ_MEDIA_AUDIO` on Android 13+ (a prompt for a write-only action) and a base64 or file hop across the bridge, which AGENTS §2 forbids for frames (_"Frames never approach the bridge"_). | A new dependency, a manifest change, a prompt, and a config plugin.                                      |
| R3  | **The confirmation is one line for 3 s in the controls half's flexible gap**, above the icon row: _Photo saved_ (lime), or _Couldn't save the photo_ (caution). A second tap while one is in flight does nothing. | The gap already exists (PR A: `controls-gap`), costs no layout move, and nothing is drawn over the camera box (PR A's rule).                                                                                                                                                                                                    | Task 2 moves the line into the status strip's caption slot.                                              |
| R4  | **Icon-row order.** Before air: Settings, Home, Take photo. On air: Settings, Take photo, _What viewers see_.                                                                                                     | Take photo sits beside the controls it is least likely to be confused with, and _What viewers see_ keeps its flexible width at the end. The canvas order is not readable from this repo.                                                                                                                                        | Reorder two JSX lines and one test array.                                                                |
| R5  | **Dropped (owner's scope cut, 2026-10-08).** There is no photo gate: the shutter shows whenever the camera picture does (Paired and on air), with no shedding rule and no state rule.                             | _"need a simply feature, where user can click to photo, nothing make complex"_.                                                                                                                                                                                                                                                 | A new pure rule and a JS check; Task 1's bound already keeps a failed snapshot from failing the session. |
| R6  | **The file is named `Seazn_yyyyMMdd_HHmmss.jpg`**, never with the match, a side or a name.                                                                                                                        | Players are often minors, and a gallery is shared and synced. The name says nothing about who is playing.                                                                                                                                                                                                                       | One format string.                                                                                       |

## Spec premises found false or unverified

Labelled SB1 to SB6, so they never read as PR A's SP1 to SP4.

- **SB1. "LL-HLS starts slowly inside a hold" cannot be the cause as worded.** The peek plays **standard HLS**: _"Low-latency HLS is off. The web creates live inputs without it … so the peek plays standard HLS"_ (`docs/specs/2026-09-30-s1-live-stream-design.md:380`), and the phone adds no `protocol=llhls` (`src/domain/session/previewUrls.ts:29-39`). What a hold really does to the player is different: the playlist stops advancing and the old player sits on a stale edge. The plan fixes that (Task 4: `reconnecting` is `unavailable`, the player is unmounted, and the next `playing` starts a fresh one). Whether standard HLS also starts slowly is a **measurement** (Task 7, item 8).
- **SB2. "The first Cloudflare window lands 18–23 s after going live" has no evidence in the repo.** `grep -a` finds it only in the spec's hypotheses. The plan does not build a timer on it. It gates on native's own word (`delivery: ok`), patience-limits the wait at 60 s, and writes the measured number to the record (`peek.firstWindow`, Task 5) for the owner to read.
- **SB3. "PR B starts with a device spike" cannot happen in this PR.** No phone session is allowed while PR B is built. The spike becomes Task 7, item 1, and the code is built so that a spike that fails cannot hurt (Plan decisions D2).
- **SB4. "Gallery permission … settled in PR B's own spec section" is a no-op.** With R1 there is no permission. Task 6 writes the section anyway, so the decision is on record.
- **SB5. `takeJpegSnapshot` exists, but it is not a free call.** It is an extension over `takeSnapshot`, which takes the video input's `sourceMutex` (the lock `startStream`, `stopStream` and `setSource` also take), starts the source for the duration when it is not streaming, and **completes only when a frame is drawn** (`DefaultSurfaceProcessor$PendingSnapshot`; it fails with _"Snapshot is not available when video is muted"_). So a snapshot can wait on a stalled camera for ever and can hold up a Stop. Plan decisions D2 is built on exactly that. Task 1 calls `takeSnapshot` and compresses the bitmap itself, because the extension pops `Bitmap.compress`'s result (a failed compress would read as a saved, empty file) and never recycles the bitmap. All of this is `javap` of `streampack-core-3.2.1-runtime.jar`, not documentation.
- **SB6. PR A's plan says "Take photo joins in PR B" in §3's icon row.** True. PR B adds a sixth `GlyphName`, `shutter`; PR A defined none. `IconButton` is unchanged: the shutter is present or absent, never dimmed (D10).

## Code facts established (read, not assumed)

Pinned at worktree `0b30ce0`. Re-pin after PR A merges.

- **How the app reaches StreamPack's video input.** `StreamerAdapter` holds the streamer in `private val current = MutableStateFlow<SingleStreamer?>(null)` (`StreamerAdapter.kt:98`), exposed as `streamer` (`:99`). The video input is `current.value?.videoInput`, already read at `:127` (the preview's failure), `:167` (`cameraOurs`), `:314` (the slate check). `SingleStreamer.getVideoInput()` returns `IVideoInput`, which `extends ISnapshotable` (`javap`): `takeSnapshot(int rotationDegrees, Continuation<Bitmap>)`, and the extension `takeJpegSnapshot(OutputStream, quality, rotationDegrees)` (the quality argument goes to `Bitmap.compress`, the rotation to `takeSnapshot`, read from the bytecode). Nothing in the app calls either today. Task 1 calls `takeSnapshot` and compresses the bitmap itself (SB5).
- **How a call crosses the bridge.** JS: `NativeCaptureEngine.send` numbers an intent and calls `native.send({...intentWire(intent), seq})` (`modules/capture-engine/src/nativeCaptureEngine.ts:93`); the ack returns on `onAck` (`:89`). Native: `CaptureEngineModule` declares `Function("send")` and three siblings (`CaptureEngineModule.kt:30-34`), then `BridgeCore.send` maps it to a core `Input` on the scheduler thread and posts the ack (`BridgeCore.kt:115-123`). The JS type of the module is `CaptureEngineNative` (`nativeModule.ts:15-27`), loaded by `requireOptionalNativeModule('CaptureEngine')` (`:34-36`). A capture command reaches StreamPack as `Platform.execute` → `Capture.execute` for **every** `Command` (`AndroidPlatform.kt:30-47`), serialised by `CaptureSerial` (`CaptureSerial.kt:20-36`). **A photo must not use any of these**: a throw on that queue goes to `calls.failure` (`CaptureSerial.kt:30`), which is `BridgeCore.failure` (`BridgeCore.kt:135-137`) and, for a permanent failure, `sticky.fail(...)` for the whole process (`BridgeCore.kt:487-490`).
- **The gallery library.** None is in `package.json` (no `expo-media-library`, no `expo-file-system`). The manifest holds no storage permission (`AndroidManifest.xml:2-10`: CAMERA, RECORD_AUDIO, INTERNET, ACCESS_NETWORK_STATE, WAKE_LOCK, three FOREGROUND_SERVICE_*, POST_NOTIFICATIONS). minSdk is 31 (`EngineHost.kt:162`, `app.json` `expo-build-properties`). See R1 and R2.
- **How the viewer layer gets its URL and its hold.** `selectPlaybackUrl` reads `broadcast.playbackUrl` (`engineSelectors.ts:67-68`). `useViewfinder` marks the peek playable as soon as that URL exists and the state is on air (`useViewfinder.ts:104`, `:148`), and on air includes Arming, Armed and Connecting (`ACTION`, `useViewfinder.ts:78-89`). `usePeek` mounts the player on the finger landing and keeps it mounted for 30 s after release (`usePeek.ts:24-44`, `PEEK_WARM_MS`). `StreamStage` renders `StageVideo` whenever `peek.mounted && playbackUrl !== null` (`StreamStage.tsx:47-49`). `StageVideo` hands the URL to the `Video` surface (`StageVideo.tsx:27`), and `MutedVideo` creates the player **once, with that source, on mount** (`nativeSurfaces.tsx:160`). A manifest that does not exist yet puts the player in `error`, and nothing listens (the surface has no status), so the layer is a blank `VideoView` and stays blank for the 30 s warm window. That is a code-level cause of "mostly nothing", independent of SB1 and SB2.
- **The delivery word already exists.** `DeliveryWatch` polls the master every 2 s (`POLL_MS`, `DeliveryWatch.kt:255`). A `204` is "no variant live" (`:11-12`); `delivery` is `OK` once the head has advanced in the variant (`:166`), `STALLED` after the stall window (`:238-247`), and `UNKNOWN` again on a failed poll or off air (`:155`, `:238`). It reaches JS as `telemetry.delivery` (`CaptureEnginePort.ts:173`). During a hold (`reconnecting`) it is `unknown`, because the watch is off air (`FakeCaptureEngine.ts:188`, scene `holding` `:341-342`).
- **What a record line may carry.** Native and JS share one allow-list (`modules/capture-engine/src/scrub/allow-list.json`; `src/services/scrub.ts:44-86`): plain words under listed keys, numbers anywhere, URLs only under `url`, `playbackUrl`, `overlayUrl`, and never `tok`, `token`, `code`, `streamKey`, `streamId`, `passphrase`. This plan's new lines use only existing plain keys (`result`, `ms`, `state`, `delivery`, `attempt`, `status`, `action`, `error`) and the existing native kind `capture-call-failed`. **No allow-list change, and the kind count (83, `scrubParity.test.ts:66-68`) does not move.**

## Global Constraints

The owner's constraints, verbatim, then the repo's.

**The owner's, verbatim:**

- No phone sessions while PR B is built. It is built from code and JVM/vitest tests only, and the PR is marked UNVERIFIED-ON-DEVICE. The owner tests on the device after PRs A, B and C are merged.
- The final task is a device checklist for the owner's hands; it must not be simulated.
- Never run EAS. Builds are local, with Gradle. Scoped tests only; never `pnpm check`, `pnpm test` or a full vitest.
- Agents use model sonnet.
- New user-facing copy goes in all 4 locales (src/i18n/{en,es,fr,nl}.json), with `_review` markers on es, fr and nl only, never on en, as PR A does.
- StyleSheet uses tokens only.
- Every new guard gets one named mutation.

**The repo's (adapted from PR A):**

- **Worktree.** PR B starts from `main` after PR A is merged. Create `/Users/ashokhein/github/seazn.club.capture/.claude/worktrees/s1-design-b` on branch `feat/s1-design-pr-b` (`superpowers:using-git-worktrees`). Call it `$WT` below, and put `cd "$WT" &&` in every command, because the shell cwd resets between calls. A task that runs in a parallel lane (Tasks 3 and 4) gets its own worktree off this branch.
  - The worktree has no `node_modules`. Run `pnpm install --frozen-lockfile` once, before Task 1.
  - Never run a bare `git stash`: the stash stack is shared with the main checkout. To back up a file for a mutation, `cp` it to `"$TMPDIR"` and restore it from there, never with `git checkout`.
- **No phone, no emulator, no Gradle Android build, no Metro on a device.** Nothing in this PR is compiled for Android locally. The Kotlin in the Android module (`GalleryPhoto.kt`, the `StreamerAdapter.kt`, `CaptureEngineModule.kt` and `SoundMeter.kt` edits) first compiles on the owner's local release build (Task 7). So it is kept to the smallest possible size, and every StreamPack signature it uses is listed in Task 1 with the `javap` that proved it.
- **The web repo is read-only.** `/Users/ashokhein/github/seazn.club` is never changed.
- **Secrets.** Never log, print, screenshot or commit a code's raw value, a `tok`, a scoring link, an SRT passphrase or stream id, an RTMPS key, **or a playback or overlay URL**. Never write a `content://` URI, a file path or an exception message into a record line (only a class name). Test fixtures are made up.
- **Layering** (`eslint-plugin-boundaries`): `src/domain` is pure; `ui` reaches native only through `Ports` and imports services as types only; hooks may import services and the engine module; `services` imports services and domain only.
- **Styling.** `StyleSheet.create` only; every colour, size and gap comes from `src/ui/theme/tokens.ts` or `type.ts`.
- **Tests.**
  - Every task's new tests fail without its change: run them once before the change and record the red count.
  - Expected values come from the spec, the engine's declarations or the dictionary, never from the code under test. No snapshot tests.
  - Every table or sweep states how many cases it ran, with an anti-vacuity `expect(count).toBe(N)` (JS) or `assertEquals(N, count)` (Kotlin).
  - **Every new guard is mutated once and a named test must fail.** The mutations are numbered M1 to M33 in the tasks. Back the file up with `cp`, mutate, run the named test red, restore from the backup, run green. A mutation no test kills means the test is decoration: stop and strengthen it.
  - **Sequence cases are owed** (AGENTS §10, the four questions): a second tap, a photo after a stop or a hold, an empty input, another language. Each task lists its own.
- **Scoped verification only. Never a full suite.** Never `pnpm test`, `pnpm check`, a bare `pnpm vitest run`, or an unfiltered `./gradlew test`. Each task runs the vitest files it names, the Gradle filters it names, `pnpm typecheck`, `rtk proxy pnpm lint` (the rtk wrapper hides lint output), `pnpm format:check`, and `pnpm prettier --check` on every file it touched outside `src app modules test`.
- **Counting JS tests.** Never trust a summary line: rtk prints `PASS(0) FAIL(0)` for a suite that failed to collect.
  ```bash
  cd "$WT" && pnpm vitest run --project domain --project ui <files…> --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
  cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
  ```
  Positional paths are **substring filters**: a typo silently runs fewer files. Confirm every printed `name` is a file you meant, the list is the length you expect, and the `.json` mtime is from this run.
- **Counting Kotlin tests.** Read the counts from the XML, never from Gradle's summary. Use `:test`, the core project's own task.
  ```bash
  cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests '<FQCN>' … > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
  cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"\| failures="[0-9]*"' build/test-results/test/*.xml | sort | uniq -c
  ```
- **Copy.** Every user-visible string is in all four dictionaries, copied from the _Copy_ table. Task 2, the first to add copy, adds `"_review": "pending translation review"` as the first key of `es.json`, `fr.json` and `nl.json`, never `en.json` (`dictionaries.test.ts:19`); Task 5 makes sure it is there. `docs/i18n-glossary.md` binds: es tú, fr vous, nl je; sentence case; straight apostrophes; French U+00A0, written ` ` in the JSON, before `:` `;` `?` `!` (no PR B string has one). Lengths fit `src/i18n/budgets.test.ts`. Task 6 runs the review pass and clears the markers.
- **Commits.** One commit per task, `git add` by path, never `-A`. The message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never write an `owner/repo#N` reference. Nothing is pushed by an implementer; the orchestrator pushes and opens the PR after Task 6, titled `… [UNVERIFIED-ON-DEVICE]` (Task 6 has the body).

## Review Focus

The failure modes the spec implies and the tasks' own tests would not name unprompted, most likely first. Each has its test in the task that owns the code (the task is named).

1. **A snapshot that never completes or throws something that is not an `Exception`.** The processor completes a snapshot only when a frame is drawn, so a stalled camera never answers; a bitmap can throw `OutOfMemoryError`. Expected: `failed` within 2 s, the lock released, the next photo works, and nothing reaches the session's failure path. _Task 1 (M1, M2, M3, M5), Task 2 (the 4 s deadline, M13)._
2. **A stop or a go live tapped inside a snapshot's window.** The owner's scope cut left out the single-flight lock, the refusal beside a capture command and the pre-emption, so a Stop or Go live waits for StreamPack's source lock while a snapshot holds it, at most 2 s. No local test can see it; it is a stated cost, timed on the device. _Task 7, item 1._
3. **A double tap and a burst.** Expected: one photo at a time, a tap while one is saving does nothing, no flood of lines. _Task 2 (M15, M16)._
4. **A hiccup after the first window must not tear down a playing peek; a hold must; the next broadcast must not inherit the last one's "already delivered".** `delivery` goes `unknown` on any failed poll (`DeliveryWatch.kt:238`). Expected: a one-poll `unknown` keeps playing; `reconnecting` unmounts the player and the next `playing` starts a fresh one against a fresh `ok`; a second broadcast starts from `waiting`. _Task 4, Task 5 (M24 to M31)._
5. **A record line carrying a URL, a URI or an exception message.** The playback URL carries the stream id in its path; a `content://` URI names a file; a library message can quote either. Expected: lines hold only closed words and numbers. _Task 1 (the three-throwable case, M6), Task 2 (the line's keys), Task 5 (M32)._

Also covered, lower on the list: the shutter is present in Paired and on air and absent otherwise (Task 2, M17); the line is lime when saved and caution when not (M20); the photo in each of the four languages (Task 2); the fit at 640 × 360 with the line reserved (Task 2, M21); the peek notes in each language (Task 5); the orientation retries (Task 3, M22 to M23).

## Plan decisions

- **D1. The photo is a native request on its own scope, not a `Command`.** The machine never hears of it (Q2). `Capture` gains `fun takePhoto(done: (String) -> Unit)`; `StreamerAdapter` is its only implementer (`grep` found no other).
- **D2. Two guards make a failed snapshot unable to touch the broadcast** (the owner's scope cut of 2026-10-08 left these two). Each is a named mutation.
  1. _Own scope with its own handler, and no path to the engine._ `photoScope` in `StreamerAdapter` has a handler that writes one `capture-call-failed` line and calls nothing else; the capture's scope hands unhandled throws to `calls.failure` (`StreamerAdapter.kt:87`). `PhotoRun` and `GalleryPhoto` are never given `CoreCalls`, and a glue rule reads their source for `failure(`, `report(`, `readiness(`, `pairFailed` and `cameraBusy`. M5, M6.
  2. _Hard bound, class name only._ `withTimeoutOrNull(SHOT_MS = 2_000)` cancels the StreamPack call (which releases `sourceMutex`); `catch (t: Throwable)`, not `Exception`, writes only the class name. JS's 4 s deadline is the backstop for a call that ignores cancellation. M1, M2, M3.
  - **What the cut costs**, stated as consequences and not as the owner's words: (i) there is no single-flight lock, no refusal beside a capture command and no pre-emption in native, so a Stop or Go live tapped inside a snapshot's window waits for StreamPack's lock, at most 2 s when the call honours cancellation; (ii) a photo that finishes after the bound is still saved but reported failed; (iii) the only single-flight is JS dropping a second tap. Task 7, item 1 times (i).
- **D3. The shutter shows when the camera picture does.** `Viewfinder.shutter` is `kind === 'paired' || action === 'stop'`: Paired and on air, seven of the ten kinds. It is present or absent, never dimmed. A photo taken with the slate up is a truthful _Couldn't save the photo_, because `GalleryPhoto` refuses a source that is not the camera (M11).
- **D4. The photo's answer never changes session state in JS either.** It is local hook state (a 3 s notice), not engine state.
- **D5. The rotation is `Side.rotationDegrees` (90 or 270), the side held for the broadcast.** The semantics of `takeSnapshot`'s `rotationDegrees` against the processor's matrix is **device-only** (Task 7, item 2). If the picture comes out sideways, the fix is the one argument in `GalleryPhoto.shoot`.
- **D6. The viewer layer mounts a player only in `playing`.** A player created against a missing manifest is the code-level cause of a blank layer (Code facts). The retry is by remount (`key={attempt}`), because `expo-video` takes its source at creation.
- **D7. A hold ends the "already delivered" latch.** After a hold the Cloudflare session may be new (`DeliveryWatch.newSession`, `:129-145`), so `reconnecting` clears the latch and the next `playing` needs a fresh `ok`. A one-poll `unknown` while Publishing does not clear it.
- **D8. The patience is 60 s, counted from the broadcast first reading Publishing or Degraded (and again after each hold).** About three times the hypothesised upper bound (SB2). After it, _No viewer picture_ shows, and a later `ok` still recovers it. It is a timeout, not a ticking clock: no per-second re-render (AGENTS §8).
- **D9. The shutter glyph is two concentric circles (outer r 9, inner r 4).** The canvas's own path is not readable from this repo, so this is the plan's drawing. Task 7, item 6 compares it with canvas v23.
- **D10. `IconButton` and `Glyph`'s tones do not change.** There is no disabled state to draw: the shutter is present or absent (D3).
- **D11. Under a hold with nothing locked, a tilt locks the target and keeps the target's card** (Task 3). Locking `physical` would turn the activity under the camera (AGENTS §8, P4); showing no card would hide that the phone is held the wrong way for the lock just applied.

## Copy

Lengths are counted with `s.length`, as `budgets.test.ts` counts. New keys are in all four dictionaries. `stream.peek.unavailable` already exists (en _No viewer picture_) and is reused for the Not-available state; it is not changed. There is no _no picture to save_ string: a photo taken with the slate up says _Couldn't save the photo_.

| Key                   | en                            | es                          | fr                                | nl                          | Budget                     |
| --------------------- | ----------------------------- | --------------------------- | --------------------------------- | --------------------------- | -------------------------- |
| `stream.photo.label`  | Take photo                    | Hacer foto                  | Prendre une photo                 | Foto maken                  | 20; the icon's name        |
| `stream.photo.saved`  | Photo saved                   | Foto guardada               | Photo enregistrée                 | Foto opgeslagen             | 36; lengths 11, 13, 17, 15 |
| `stream.photo.failed` | Couldn't save the photo       | No se pudo guardar la foto  | Impossible d'enregistrer la photo | Foto opslaan mislukt        | 36; 23, 26, 33, 20         |
| `stream.peek.loading` | Waiting for the first picture | Esperando la primera imagen | En attente de la première image   | Wachten op het eerste beeld | 44; 29, 27, 32, 27         |

## File map

| Path                                                                                                                                                                                                                                                         | Task | What                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------- |
| `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture/photo/PhotoName.kt`, `PhotoRun.kt` (new)                                                                                                                                      | 1    | the file name, the two results, the bound                                   |
| `…/capture/GalleryPhoto.kt` (new), `…/capture/Capture.kt`, `…/capture/StreamerAdapter.kt`, `…/CaptureEngineModule.kt`, `…/capture/SoundMeter.kt`                                                                                                             | 1    | the snapshot and gallery write, the bridge function, the microphone release |
| `modules/capture-engine/android/core/build.gradle.kts`                                                                                                                                                                                                       | 1    | core's tests compile `capture/photo`                                        |
| `…/core/src/test/kotlin/com/seazn/capture/engine/capture/photo/PhotoRunTest.kt`, `PhotoNameTest.kt` (new); `…/adapter/GlueRulesTest.kt`                                                                                                                      | 1    | tests and the source-text pins                                              |
| `modules/capture-engine/src/nativeModule.ts`, `src/testing/FakeNativeModule.ts`, `test/hostEngine.ts`, `src/services/photoPort.ts` (new), `test/fakePhotoPort.ts` (new), `src/hooks/usePorts.tsx`, `nativePorts.ts`, `test/fakePorts.ts`                     | 2    | the JS port and its fakes                                                   |
| `src/hooks/usePhoto.ts` (new), `src/hooks/useViewfinder.ts`, `src/ui/components/Glyph.tsx`, `StreamColumn.tsx`, `src/ui/theme/viewfinderFit.test.ts`, `StreamScreen.layout.test.tsx`, the four dictionaries, `src/i18n/budgets.test.ts`                      | 2    | the hook, the shutter, the line, the copy                                   |
| `src/hooks/useOrientationGate.ts`, `src/domain/orientation/orientation.ts` and their two test files                                                                                                                                                          | 3    | the orientation retries                                                     |
| `src/domain/session/viewerFeed.ts` (new)                                                                                                                                                                                                                     | 4    | the pure feed rule                                                          |
| `src/hooks/useViewerFeed.ts` (new), `engineSelectors.ts`, `src/services/surfaces.ts`, `services/native/nativeSurfaces.tsx` (+ test), `src/ui/components/StageVideo.tsx`, `StreamStage.tsx`, `test/fakeSurfaces.ts`, the four dictionaries, `budgets.test.ts` | 5    | the hook, the surface, the layer                                            |
| `AGENTS.md`, `docs/specs/2026-10-06-s1-design-followup-design.md`, `docs/i18n-glossary.md`, `docs/superpowers/plans/2026-10-06-s1-design-pr-a.md`, the four dictionaries                                                                                     | 6    | rules, the settled §8 section, the PR A plan amendment, review pass         |

---

## Task 1: Take photo, native: the snapshot, the gallery write and the bridge call (§8)

The owner's scope cut (see _Owner answers_) in one sentence: one tap, one JPEG of the camera picture in the gallery, one answer, and a bound so a snapshot can never stall the stream. This task is the native half. It also carries the `SoundMeter` leak from PR A, because it is the same module and the same kind of check.

**Files:**

- Create (under `modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture/`):
  - `photo/PhotoName.kt`: the file name (R6), pure.
  - `photo/PhotoRun.kt`: the two results and the bound, pure.
  - `GalleryPhoto.kt`: the Android part, the snapshot and the MediaStore write.
- Modify:
  - `…/capture/Capture.kt`: `takePhoto`.
  - `…/capture/StreamerAdapter.kt`: `photoScope`, `gallery`, `photo`, `takePhoto`.
  - `…/CaptureEngineModule.kt` (`modules/capture-engine/android/src/main/java/com/seazn/capture/engine/`): the bridge call.
  - `…/capture/SoundMeter.kt`: release the `AudioRecord` whose start threw (carried from PR A).
  - `modules/capture-engine/android/core/build.gradle.kts`: core's tests compile `capture/photo`.
- Test (under `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/`):
  - Create `capture/photo/PhotoRunTest.kt` and `capture/photo/PhotoNameTest.kt`.
  - Modify `adapter/GlueRulesTest.kt`: the source-text pins.
- No change to `AndroidManifest.xml`, `app.json` or `app.plugin.ts` (R1, R2).

**Interfaces:**

- Produces (package `com.seazn.capture.engine.capture.photo`):

```kotlin
enum class PhotoResult(val wire: String) { SAVED("saved"), FAILED("failed") }

object PhotoName { fun of(wallMs: Long, zone: ZoneId): String }   // "Seazn_20261007_142501.jpg"

class PhotoRun(shoot: suspend (name: String) -> Unit, wallMs: () -> Long, line: (RecordEntry) -> Unit, zone: () -> ZoneId = { ZoneId.systemDefault() }) {
  suspend fun take(): PhotoResult      // never throws; a call that honours cancellation is cut off at SHOT_MS
  companion object { const val SHOT_MS = 2_000L }
}
```

- Produces in `com.seazn.capture.engine.capture`: `class GalleryPhoto(resolver, streamer, side) { suspend fun shoot(name: String) }`, `Capture.takePhoto(done: (String) -> Unit)`, and the module function `takePhoto()` (JS: `Promise<string>`), which resolves with `"saved"` or `"failed"`, the only two words.
- Consumes: `RecordEntry(kind, fields, level)` (`core/SessionRecord.kt:10`), `Side.rotationDegrees` (`core/Readiness.kt:4`), `CoreCalls.line` (`capture/run/CoreCalls.kt:14`), `EngineHost.capture(context)` (`EngineHost.kt:50`).
- **StreamPack 3.2.1 signatures this task relies on** (`javap` of `streampack-core-3.2.1-runtime.jar`, read on 2026-10-08; re-run `javap -cp <jar> -public <class>` if the version moves):
  - `SingleStreamer.getVideoInput(): IVideoInput`; `IVideoInput extends ISnapshotable`; `IVideoInput.getSourceFlow(): StateFlow<IVideoSource>`.
  - `ISnapshotable.takeSnapshot(int, Continuation<Bitmap>)`, Kotlin `suspend fun takeSnapshot(rotationDegrees: Int = 0): Bitmap`. It locks the input's source lock, and fails with _"Snapshot is not available when video is muted"_ and _"Input is released"_ (SB5).
  - **Why `takeSnapshot` and not `takeJpegSnapshot`.** The extension `takeJpegSnapshot(OutputStream, quality, rotationDegrees)` exists, but its bytecode calls `takeSnapshot`, then `Bitmap.compress`, and pops the `Boolean` that `compress` returns: a failed compress would be reported as a saved, empty file. It also never recycles the bitmap. So this task calls `takeSnapshot` and compresses itself, where `check(...)` can see the result.

- [ ] **Step 1: Failing tests.** Create the two test files and add the five pins to `GlueRulesTest`. Nothing compiles yet; that is the first red.

`PhotoRunTest.kt`:

```kotlin
package com.seazn.capture.engine.capture.photo

import com.seazn.capture.engine.core.RecordEntry
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Spec §8, Plan decisions D2: a photo is answered once, within a bound, and a failed photo is one line and a word.
 * Every case drives the real PhotoRun against a lambda that stands for the gallery write.
 */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent, currentTime
class PhotoRunTest {
  private val at = Instant.parse("2026-10-07T14:25:01Z").toEpochMilli()
  private val lines = mutableListOf<RecordEntry>()
  private var behaviour: suspend (String) -> Unit = {}
  private val names = mutableListOf<String>()
  private val run = PhotoRun({ name -> behaviour(name); names += name }, { at }, { lines += it }) { ZoneOffset.UTC }

  @Test
  fun `a photo is stored under the Seazn name, answers saved and writes no line`() =
    runTest {
      assertEquals(PhotoResult.SAVED, run.take())
      assertEquals(listOf("Seazn_20261007_142501.jpg"), names)
      assertEquals(emptyList(), lines)
    }

  @Test
  fun `M2 a snapshot that never completes is failed at the bound, with one line, and the next photo works`() =
    runTest {
      behaviour = { awaitCancellation() }
      assertEquals(PhotoResult.FAILED, run.take())
      assertEquals(PhotoRun.SHOT_MS, currentTime)
      assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to "timeout"))), lines)
      assertEquals(emptyList(), names, "nothing was stored")
      behaviour = {}
      assertEquals(PhotoResult.SAVED, run.take(), "a later photo is not held up by the stuck one")
    }

  @Test
  fun `M1 an Error and an Exception alike fail the photo, and the line carries the class name and nothing else`() =
    runTest {
      val secret = "content://media/external/images/media/77 /storage/emulated/0/Pictures/Seazn Capture/x.jpg"
      val thrown = listOf<Throwable>(OutOfMemoryError(secret), IllegalStateException(secret), java.io.IOException(secret))
      val expected = listOf("OutOfMemoryError", "IllegalStateException", "IOException")
      var seen = 0
      for ((index, throwable) in thrown.withIndex()) {
        lines.clear()
        behaviour = { throw throwable }
        assertEquals(PhotoResult.FAILED, run.take())
        assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to expected[index]))), lines)
        assertFalse(lines.toString().contains("content://"), "no URI in a line")
        assertFalse(lines.toString().contains("/storage/"), "no path in a line")
        seen++
      }
      assertEquals(3, seen, "all three throwables were driven")
    }

  @Test
  fun `M3 a library's own timeout inside the call is a failed photo, not a cancellation`() =
    runTest {
      behaviour = { withTimeout(10) { awaitCancellation() } }
      assertEquals(PhotoResult.FAILED, run.take())
      assertEquals(10L, currentTime, "it failed at the library's 10 ms, long before the bound")
      assertEquals(listOf(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to "TimeoutCancellationException"))), lines)
    }

  @Test
  fun `M3 the scope ending is cancellation, not a failed photo: no answer and no line`() =
    runTest {
      behaviour = { awaitCancellation() }
      val job = launch { run.take() }
      runCurrent()
      assertTrue(job.isActive, "the photo is in flight")
      job.cancel()
      job.join()
      assertTrue(job.isCancelled)
      assertEquals(emptyList(), lines, "a scope that ends writes no failure")
    }
}
```

`PhotoNameTest.kt`:

```kotlin
package com.seazn.capture.engine.capture.photo

import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals

class PhotoNameTest {
  private val at = Instant.parse("2026-10-07T14:25:01Z").toEpochMilli()

  @Test
  fun `M4 the name is the phone's wall clock in a 24 hour pattern, and says nothing about the match`() {
    // R6: Seazn_ + yyyyMMdd_HHmmss + .jpg. Two zones, so a hard-coded UTC or a 12 hour clock fails.
    assertEquals("Seazn_20261007_142501.jpg", PhotoName.of(at, ZoneOffset.UTC))
    assertEquals("Seazn_20261008_002501.jpg", PhotoName.of(at, ZoneOffset.ofHours(10)))
  }
}
```

`GlueRulesTest.kt`: add inside the class (it already has `sources()`, `glue(name)`, `body(text, signature)`, `src`; imports `File`, `assertEquals`, `assertFalse`, `assertTrue` are present). Five pins. **They are source-text rules: they read the files as text, comments included, so none proves behaviour. The device checklist (Task 7) is the witness for what they stand in front of.**

```kotlin
  /** Spec §8, D2: nothing the photo is made of can reach the session. A source-text rule: a comment counts, so a KDoc must not say these words. */
  @Test
  fun `M6 the photo's source never reaches the session`() {
    val photo = sources().filter { "/capture/photo/" in it.path || it.name == "GalleryPhoto.kt" }
    assertEquals(listOf("GalleryPhoto.kt", "PhotoName.kt", "PhotoRun.kt"), photo.map { it.name }.sorted())
    val banned = listOf("failure(", "report(", "readiness(", "pairFailed", "cameraBusy", "CoreCalls", "BridgeCore", "runBlocking", "android.util.Log", "println(")
    var checked = 0
    for (file in photo) {
      val text = file.readText()
      for (word in banned) {
        assertFalse(word in text, "${file.name}: $word")
        checked++
      }
    }
    assertEquals(3 * banned.size, checked)
  }

  /** Spec §8, D2 (1): the photo runs on a scope with a handler of its own, which writes one line and fails nothing; takePhoto answers from it and from no other. */
  @Test
  fun `M5 StreamerAdapter's photo scope has its own handler, and takePhoto answers from it`() {
    val text = glue("StreamerAdapter.kt")
    val at = text.indexOf("private val photoScope")
    assertTrue(at >= 0, "the photo scope is declared")
    assertEquals(at, text.lastIndexOf("private val photoScope"), "declared once")
    val declaration = text.substring(at, text.indexOf('\n', at))
    assertTrue("CoroutineExceptionHandler" in declaration, declaration)
    assertTrue("\"action\" to \"photo\"" in declaration, declaration)
    assertFalse("calls.failure" in declaration, declaration)
    assertFalse("calls.report" in declaration, declaration)
    val take = body(text, "override fun takePhoto(")
    assertTrue("photoScope.launch" in take, take)
    assertFalse(Regex("""\bscope\.launch|\brun\.|serial""").containsMatchIn(take), "never on the capture's scope or its queue: $take")
  }

  /** Spec §8, the seam: JS calls `takePhoto`; the module declares it once and hands it to the capture. Without this, every photo fails and nothing in a unit test says so. */
  @Test
  fun `M9 the bridge declares takePhoto once and asks the capture`() {
    val module = glue("CaptureEngineModule.kt")
    assertEquals(1, Regex("""AsyncFunction\("takePhoto"\)""").findAll(module).count())
    assertTrue(Regex("""AsyncFunction\("takePhoto"\)[^\n]*EngineHost\.capture\([^\n]*\.takePhoto""").containsMatchIn(module), "it asks the capture")
  }

  /** R1, R2: no storage permission in the manifest; the still goes to MediaStore, is cleaned up when it fails, and is the camera's own. */
  @Test
  fun `M7 M8 M11 the still needs no permission, goes to MediaStore, is removed when it fails, and is the camera's`() {
    val manifest = File(src, "main/AndroidManifest.xml").readText()
    for (banned in listOf("READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA_", "MANAGE_EXTERNAL_STORAGE")) assertFalse(banned in manifest, banned)
    assertTrue("CAMERA" in manifest, "the positive pair: this is the real manifest")
    val writer = glue("GalleryPhoto.kt")
    for (needed in listOf("MediaStore.Images.Media.EXTERNAL_CONTENT_URI", "RELATIVE_PATH", "IS_PENDING", "resolver.delete(", "is ICameraSource")) assertTrue(needed in writer, needed)
  }

  /**
   * Carried from PR A: a record that was built but would not start still holds the microphone. `AudioRecord` is
   * Android's, which core's JVM cannot compile, so this is a source-text rule and there is no behavioural witness
   * off a device (Task 7, item 12).
   */
  @Test
  fun `M10 SoundMeter releases an AudioRecord whose start threw`() {
    val start = body(glue("SoundMeter.kt"), "fun start()")
    assertTrue(Regex("""catch \(e: Exception\) \{\s+it\.release\(\)""").containsMatchIn(start), start)
  }
```

- [ ] **Step 2: Run red, in two phases.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.capture.photo.*' --tests 'com.seazn.capture.engine.adapter.GlueRulesTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Phase 1: `EXIT` non-zero, compile errors naming `PhotoRun`, `PhotoName`, `PhotoResult` (the two test sources and `GlueRulesTest` share one compile). Record it. Phase 2 comes in Step 3, once the pure files exist: the five pins must be red for the right reason (the files and lines are missing), not for a compile error.

- [ ] **Step 3: Implement the pure part, then re-run for phase 2.**

`photo/PhotoName.kt`:

```kotlin
package com.seazn.capture.engine.capture.photo

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** R6: the gallery file's name. The phone's wall clock and nothing else; never the match, a side or a name. */
object PhotoName {
  private val FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss", Locale.ROOT)

  fun of(wallMs: Long, zone: ZoneId): String = "Seazn_" + FORMAT.format(Instant.ofEpochMilli(wallMs).atZone(zone)) + ".jpg"
}
```

`photo/PhotoRun.kt`:

```kotlin
package com.seazn.capture.engine.capture.photo

import com.seazn.capture.engine.core.RecordEntry
import java.time.ZoneId
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull

/** What JS reads (spec §8): two words, closed, so the bridge can return nothing else. */
enum class PhotoResult(val wire: String) {
  SAVED("saved"),
  FAILED("failed"),
}

/**
 * Spec §8, Plan decisions D2: one photo, answered once, within a bound. It is handed nothing of the session, so
 * a photo that fails has no way to fail the broadcast; the caller runs it on a scope of its own, never on the
 * capture's queue. A call that honours cancellation is cut off at [SHOT_MS]; a call that does not is answered by
 * JS's own deadline (`PHOTO_DEADLINE_MS`, 4 000), which is why it is twice this.
 */
class PhotoRun(
  private val shoot: suspend (name: String) -> Unit,
  private val wallMs: () -> Long,
  private val line: (RecordEntry) -> Unit,
  private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) {
  /** Never throws. Only the scope ending escapes, as cancellation. */
  suspend fun take(): PhotoResult =
    try {
      val stored =
        withTimeoutOrNull(SHOT_MS) {
          shoot(PhotoName.of(wallMs(), zone()))
          true
        }
      if (stored == true) PhotoResult.SAVED else failed("timeout")
    } catch (t: Throwable) { // an Error too: a bitmap can throw OutOfMemoryError
      currentCoroutineContext().ensureActive() // our own scope ending is cancellation; any other throw, a library's timeout included, is a failed photo
      failed(t.javaClass.simpleName)
    }

  /** One line, the class name only: a message can quote a URI or a path. */
  private fun failed(error: String): PhotoResult {
    line(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to error)))
    return PhotoResult.FAILED
  }

  companion object {
    /** A snapshot takes one frame and a JPEG, a few hundred ms; this is generous. */
    const val SHOT_MS = 2_000L
  }
}
```

`core/build.gradle.kts`, after the `capture/run` block:

```kotlin
// Spec §8: the photo's bound and its two results import nothing Android or StreamPack, so core's tests run them
// against a lambda that stands for the gallery write. The writer, which does import them, is one folder up.
kotlin.sourceSets["test"].kotlin.srcDir("../src/main/java/com/seazn/capture/engine/capture/photo")
```

Run the same command again. Expected: `EXIT` non-zero; `PhotoRunTest` 5 and `PhotoNameTest` 1 **green**; `GlueRulesTest`'s five new pins **red** (`M6` finds no `GalleryPhoto.kt`, `M5`/`M9`/`M7 M8 M11` find no declaration, `M10` finds no release); the existing rules in the file stay green. Record the counts from the XML (Verification, below).

- [ ] **Step 4: Implement the Android part.** None of it is compiled by any local task; it first compiles on the owner's local release build (Task 7, item 0). The reviewer reads it against the signatures above and the existing imports of `StreamerAdapter.kt`.

`GalleryPhoto.kt`:

```kotlin
package com.seazn.capture.engine.capture

import android.content.ContentResolver
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import com.seazn.capture.engine.core.Side
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Spec §8, R1: one still of the camera picture, no scorebug (the score is a WebView, not in the frames), written to
 * `Pictures/Seazn Capture` with MediaStore. minSdk is 31, so the app writes its own image with no storage permission.
 * A throw goes up to PhotoRun, the one place that answers it.
 */
class GalleryPhoto(
  private val resolver: ContentResolver,
  private val streamer: () -> SingleStreamer?,
  private val side: () -> Side,
) {
  suspend fun shoot(name: String) {
    val video = streamer()?.videoInput ?: error("no-streamer")
    check(video.sourceFlow.value is ICameraSource) { "not-the-camera" } // the slate is up: that is not a picture of the match
    val bitmap = video.takeSnapshot(side().rotationDegrees) // D5: the side held for the broadcast
    try {
      withContext(Dispatchers.IO) { store(name, bitmap) }
    } finally {
      bitmap.recycle()
    }
  }

  private fun store(name: String, bitmap: Bitmap) {
    val pending =
      ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, name)
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Seazn Capture")
        put(MediaStore.Images.Media.IS_PENDING, 1)
      }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, pending) ?: error("no-uri")
    try {
      val stream = resolver.openOutputStream(uri) ?: error("no-stream")
      stream.use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, it)) { "compress-failed" } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    } catch (t: Throwable) {
      resolver.delete(uri, null, null) // no half-written row is left in the gallery
      throw t
    }
  }

  private companion object {
    const val QUALITY = 92
  }
}
```

`Capture.kt`: add to the interface (its only implementer is `StreamerAdapter`; `grep -a ": Capture"` at `adb7f5f` found no other):

```kotlin
  /**
   * Spec §8: one still, answered once with a photo word ("saved" or "failed"). Returns at once, from any thread; never
   * throws. The one call that answers, recorded in AGENTS §2.
   */
  fun takePhoto(done: (String) -> Unit)
```

`StreamerAdapter.kt` (re-pin; `side` is a constructor parameter at `:83` and is usable in a property initializer, so it stays one). After `private val run = CaptureRun(…)` (`:105`), add, **each declaration on one line** (the pin reads the line):

```kotlin
  /** D2 (1): a scope of its own, so a throw on a photo cannot reach `scope`'s handler above, which fails the session. */
  private val photoScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, t -> calls.line(RecordEntry("capture-call-failed", listOf("action" to "photo", "error" to t.javaClass.simpleName))) })
  private val gallery = GalleryPhoto(context.contentResolver, { current.value }, side)
  private val photo = PhotoRun({ name -> gallery.shoot(name) }, System::currentTimeMillis, calls.line)
```

and beside the other overrides (`:107-113`):

```kotlin
  override fun takePhoto(done: (String) -> Unit) {
    photoScope.launch { done(photo.take().wire) }
  }
```

Imports: `com.seazn.capture.engine.capture.photo.PhotoRun`.

`CaptureEngineModule.kt`: add `import expo.modules.kotlin.Promise` and, after `Function("tail")` (`:34`):

```kotlin
    // Spec §8: the one call that answers (AGENTS §2, recorded). It resolves "saved" or "failed", within native's bound.
    AsyncFunction("takePhoto") { promise: Promise -> EngineHost.capture(app()).takePhoto { word -> promise.resolve(word) } }
```

The comment above must not repeat the call's declaration: pin `M9` counts that text, comments included.

`SoundMeter.kt` (`:30-39`, the F10 leak): the record is built inside `.also { … }`, so a throw from `startRecording` leaves it unreachable and never released. Release it where it is still in hand, and keep the existing outer `catch`, which the `I-1` rule reads:

```kotlin
    val made =
      try {
        AudioRecord(MediaRecorder.AudioSource.MIC, RATE, MONO, PCM16, size).also {
          try {
            session = it.audioSessionId // before it records: MicWatch's callback for this very start reads it
            it.startRecording()
          } catch (e: Exception) {
            it.release() // built but would not start: it still holds the microphone
            throw e
          }
        }
      } catch (e: Exception) { // IllegalStateException, IllegalArgumentException, SecurityException
        session = null
        return line(RecordEntry("watch-failed", listOf("action" to "sound", "error" to e.javaClass.simpleName)))
      }
```

(The `I-1` regexes `session = it\.audioSessionId [^\n]*\n\s+it\.startRecording\(\)` and `catch \(e: Exception\) \{[^\n]*\n\s+session = null` still match; keep the spellings.)

**Check the KDocs before running.** The pin `M6` reads whole files, comments included. Over `photo/*.kt` and `GalleryPhoto.kt`:

```bash
cd "$WT/modules/capture-engine/android/src/main/java/com/seazn/capture/engine/capture" && grep -anE 'failure\(|report\(|readiness\(|pairFailed|cameraBusy|CoreCalls|BridgeCore|runBlocking|android\.util\.Log|println\(' photo/*.kt GalleryPhoto.kt; echo "EXIT=$?"
```

Expected: no output and `EXIT=1` (grep's no-match). The first draft of this plan's KDocs said "`CoreCalls`" and would have failed its own pin.

- [ ] **Step 5: Run green, then the mutations.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.capture.photo.*' --tests 'com.seazn.capture.engine.adapter.GlueRulesTest' --tests 'com.seazn.capture.engine.capture.run.*' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"\| failures="[0-9]*"' build/test-results/test/*.xml | sort | uniq -c
```

Expected: `EXIT=0`, zero failures; 11 new tests in all (5 `PhotoRunTest`, 1 `PhotoNameTest`, 5 pins); the existing `capture.run.*` suites and the existing `GlueRulesTest` rules stay green with their prior counts. Paste the counts.

**Mutations** (each: `cp` the file to `"$TMPDIR"`, mutate, run the named test red, restore from the copy, run green; never `git checkout`, the work is uncommitted):

| #   | Mutation                                                                                      | Test that must fail                         |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| M1  | `PhotoRun.take`: `catch (t: Throwable)` becomes `catch (t: Exception)`                        | `M1 an Error and an Exception alike …`      |
| M2  | delete the `withTimeoutOrNull(SHOT_MS)` wrapper (call `shoot` directly, `stored = true`)      | `M2 a snapshot that never completes …`      |
| M3  | delete the `currentCoroutineContext().ensureActive()` line                                    | `M3 the scope ending is cancellation …`     |
| M4  | `PhotoName`: `"yyyyMMdd_HHmmss"` becomes `"yyyyMMdd_hhmmss"`                                  | `M4 the name is the phone's wall clock …`   |
| M5  | `StreamerAdapter`: the `photoScope` handler's body becomes `calls.failure(t)`                 | `M5 StreamerAdapter's photo scope …`        |
| M6  | add the text `calls.report(` to a comment in `PhotoRun.kt`                                    | `M6 the photo's source never reaches …`     |
| M7  | add `<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />` to the manifest | `M7 M8 M11 the still needs no permission …` |
| M8  | delete `resolver.delete(uri, null, null)` in `GalleryPhoto`                                   | `M7 M8 M11 …` (the writer half)             |
| M9  | delete the `AsyncFunction("takePhoto")` line in the module                                    | `M9 the bridge declares takePhoto once …`   |
| M10 | `SoundMeter`: delete the `it.release()` line                                                  | `M10 SoundMeter releases an AudioRecord …`  |
| M11 | `GalleryPhoto`: delete the `check(video.sourceFlow.value is ICameraSource)` line              | `M7 M8 M11 …` (the writer half)             |

M3 has two tests that name it. The cancellation test is the one that kills the mutant; the library-timeout test is its positive pair (a throw that is not ours must still be a failed photo), so it must stay green under M3. **M2 is killed by a hang, not by an assertion:** with the bound deleted the stuck snapshot parks the test body for ever, and `runTest` ends it at its own 60 s limit. Wait for that failure; do not kill the run and read the silence as a survivor.

**What this task proves, plainly.** The JVM runs `PhotoRun` and `PhotoName` for real (6 tests, the bound, the class-name-only line, cancellation). Everything else Kotlin here is **source-text pins plus the device checklist**: `GalleryPhoto.kt`, the `StreamerAdapter` and module edits and the `SoundMeter` release are not compiled by any local task, and `M5` to `M10` read text, not behaviour. The `SoundMeter` leak (F10) has no behavioural witness off a device: core's JVM cannot compile `AudioRecord`, so `M10` is a source-text pin and one mutant, and Task 7, item 12 is the real check. The PR body says so (Task 6).

**What the owner's scope cut costs, stated here so it is not discovered on air.** There is no single-flight lock, no refusal beside a capture command and no pre-emption in native. A snapshot holds StreamPack's source lock (SB5), and Go live, Stop, a camera switch and a slate swap take the same lock, so one of them tapped inside a snapshot's window waits for it: at most `SHOT_MS` (2 s) when the call honours cancellation. JS drops a second tap while one is in flight (Task 2), which is the only single-flight. Task 7, item 1 times Stop and Go live beside a photo; if either is later by more than a second, the follow-up is the pre-emption rule that was cut, not a patch to this task.

- [ ] **Step 6: Commit** `feat(capture): Take photo, native: the snapshot, the gallery write and the bridge call (spec §8)`. Stage by path: the three new Kotlin files, the three new test files, the edited ones.

---

## Task 2: Take photo, JS: the port, the shutter, the line and the four locales (§8)

The JS half of the owner's scope cut: one shutter in the icon row, one tap, one line for 3 s, nothing else. It consumes Task 1's `takePhoto`.

**Files (PR A names; re-pin each against the merged tree):**

- Create:
  - `src/services/photoPort.ts`, `src/services/photoPort.test.ts`
  - `test/fakePhotoPort.ts`
  - `src/hooks/usePhoto.ts`, `src/hooks/usePhoto.test.tsx`
  - `src/hooks/useViewfinder.shutter.test.tsx`
  - `src/ui/screens/StreamScreen.photo.test.tsx`
- Modify:
  - `modules/capture-engine/src/nativeModule.ts`: `takePhoto`, a **required** member.
  - `modules/capture-engine/src/testing/FakeNativeModule.ts` and `test/hostEngine.ts`: the two implementers of `CaptureEngineNative` (F2), each gets a stub.
  - `src/hooks/usePorts.tsx` (`Ports.photo`), `src/hooks/nativePorts.ts` (build it), `test/fakePorts.ts` (`photo`).
  - `src/hooks/useViewfinder.ts`: `shutter`.
  - `src/ui/components/Glyph.tsx` (+ `Glyph.test.tsx`): the sixth `GlyphName`, `shutter`.
  - `src/ui/components/IconButton.test.tsx`: one more button in the table.
  - `src/ui/components/StreamColumn.tsx`: the icon row, the gap, the line.
  - `src/ui/screens/StreamScreen.layout.test.tsx` (`:350-393`): three tests pin the icon row's names (F1).
  - `src/ui/theme/viewfinderFit.test.ts`: reserve the line.
  - `src/i18n/{en,es,fr,nl}.json`, `src/i18n/budgets.test.ts`.
- `IconButton.tsx` does not change: the shutter is present or absent, never dimmed (D10).

**Interfaces:**

- Consumes: Task 1's module function; `Ports.logger`, `Ports.clock`; PR A's `IconButton({ glyph, label, onPress })`, `Glyph`, `testID="icon-row"`, `testID="controls-gap"`, `typeScale.metricUnit.lineHeight`.
- Produces:

```ts
// photoPort.ts
export type PhotoOutcome = 'saved' | 'failed';
export const PHOTO_DEADLINE_MS = 4_000;
export interface PhotoPort { take(): Promise<PhotoOutcome>; }   // never rejects
export function readOutcome(value: unknown): PhotoOutcome;
export function createPhotoPort(call: (() => Promise<unknown>) | null, deadlineMs?: number): PhotoPort;
// usePhoto.ts
export const PHOTO_NOTICE_MS = 3_000;
export type Photo = { readonly notice: PhotoOutcome | null; take(): void };
export function usePhoto(): Photo;
// useViewfinder.ts: Viewfinder gains
readonly shutter: boolean;   // the camera picture shows: Paired and on air
// nativeModule.ts: CaptureEngineNative gains
takePhoto(): Promise<unknown>;
// Ports gains `readonly photo: PhotoPort`; FakePorts gains `readonly photo: FakePhotoPort`
```

- `GlyphName` gains `'shutter'`, its sixth. `Glyph`'s tone list does not change.

- [ ] **Step 1: Copy first.** Add the three keys of the _Copy_ table to the four dictionaries, directly after `stream.peek.unavailable`, in the same order in each file. **Add `"_review": "pending translation review"` as the first key of `es.json`, `fr.json` and `nl.json` (the three PR A cleared; the glossary's _Translation review_ section), and never to `en.json`** (`dictionaries.test.ts:19` fails on it). Add to `BUDGETS` in `src/i18n/budgets.test.ts`:

```ts
  [/^stream\.photo\.label$/, 20],
  [/^stream\.photo\.(saved|failed)$/, 36],
```

Run `src/i18n/` red-to-green: the budget rows fail first if a string is over, and `dictionaries.test.ts` fails if a key is missing from one language.

- [ ] **Step 2: Failing tests.**

`src/services/photoPort.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import {
  PHOTO_DEADLINE_MS,
  createPhotoPort,
  readOutcome,
  type PhotoOutcome,
} from '@/services/photoPort';

describe('the photo port (spec §8, Q2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('M12 reads saved as saved and every other thing as failed', () => {
    expect(readOutcome('saved')).toBe('saved');
    expect(readOutcome('failed')).toBe('failed');
    const garbage: unknown[] = [
      undefined,
      null,
      'busy',
      'unavailable',
      'SAVED',
      42,
      true,
      {},
      ['saved'],
    ];
    for (const value of garbage) expect(readOutcome(value)).toBe('failed');
    expect(garbage).toHaveLength(9);
  });

  it('asks the module each time, and clears its timer when the answer comes', async () => {
    const module = new FakeNativeModule();
    const port = createPhotoPort(() => module.takePhoto());
    await expect(port.take()).resolves.toBe('saved');
    expect(module.photoCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    module.photoAnswer = 'failed';
    await expect(port.take()).resolves.toBe('failed');
    expect(module.photoCalls).toBe(2);
  });

  it('no native module is a failed photo', async () => {
    await expect(createPhotoPort(null).take()).resolves.toBe('failed');
  });

  it('a rejection and a synchronous throw are both failed, never an exception', async () => {
    await expect(createPhotoPort(() => Promise.reject(new Error('x'))).take()).resolves.toBe(
      'failed',
    );
    await expect(
      createPhotoPort(() => {
        throw new Error('not linked');
      }).take(),
    ).resolves.toBe('failed');
  });

  it('M13 gives up at the deadline exactly, and a late native answer does not change it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const port = createPhotoPort(() => new Promise((resolve) => (answer = resolve)));
    let outcome: PhotoOutcome | null = null;
    void port.take().then((value) => (outcome = value));
    await vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('failed');
    answer('saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('failed');
  });

  it('the deadline is 4 s, twice native’s 2 s bound (the owner’s number, written out)', () => {
    expect(PHOTO_DEADLINE_MS).toBe(4_000);
  });
});
```

`src/hooks/usePhoto.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_NOTICE_MS, usePhoto } from '@/hooks/usePhoto';
import { createFakePorts, readRecord, TEST_NOW } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

function setup() {
  const fakes = createFakePorts();
  const view = renderHook(() => usePhoto(), { wrapper: wrapperFor(fakes) });
  return { fakes, view };
}
const tap = (view: ReturnType<typeof setup>['view']) =>
  act(async () => {
    view.result.current.take();
  });

describe('usePhoto (spec §8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves, says so for 3 s, then clears the line', async () => {
    const { fakes, view } = setup();
    expect(PHOTO_NOTICE_MS).toBe(3_000);
    await tap(view);
    expect(fakes.photo.calls).toBe(1);
    expect(view.result.current.notice).toBe('saved');
    act(() => vi.advanceTimersByTime(2_999));
    expect(view.result.current.notice).toBe('saved');
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.notice).toBeNull();
  });

  it('says a failure too', async () => {
    const { fakes, view } = setup();
    fakes.photo.answerWith('failed');
    await tap(view);
    expect(view.result.current.notice).toBe('failed');
  });

  it('M15 a tap while a photo is saving does nothing, and the next one after the answer goes through', async () => {
    const { fakes, view } = setup();
    fakes.photo.hold();
    await tap(view);
    await tap(view);
    expect(fakes.photo.calls).toBe(1);
    expect(view.result.current.notice).toBeNull();
    await act(async () => fakes.photo.release('saved'));
    await tap(view);
    expect(fakes.photo.calls).toBe(2);
  });

  it('M16 a second photo inside the 3 s gets its own 3 s, not what is left of the first', async () => {
    const { fakes, view } = setup();
    await tap(view); // saved at 0; its line would clear at 3 000
    act(() => vi.advanceTimersByTime(2_000));
    fakes.photo.answerWith('failed');
    await tap(view); // failed at 2 000; its line is due at 5 000
    act(() => vi.advanceTimersByTime(2_999)); // 4 999: past the first photo's 3 000
    expect(view.result.current.notice).toBe('failed');
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.notice).toBeNull();
  });

  it('writes one record line with a word and a duration, and nothing else', async () => {
    const { fakes, view } = setup();
    fakes.photo.hold();
    await tap(view);
    fakes.setNow(new Date(TEST_NOW.getTime() + 250));
    await act(async () => fakes.photo.release('saved'));
    const lines = readRecord(fakes.record).filter((line) => line.event === 'photo.result');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ result: 'saved', ms: 250 });
  });
});
```

(A result that lands after the control unmounted sets state that React ignores, and leaves a timer of at most 3 s: nothing here guards it and nothing needs to.)

`src/hooks/useViewfinder.shutter.test.tsx` (the rulebook is the owner's scope cut, written out per kind; the table is typed over every kind, so a new kind is a compile error):

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import { useViewfinder } from '@/hooks/useViewfinder';
import { createFakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

type Kind = SessionState['kind'];

/** The owner’s scope cut: the shutter shows whenever the camera picture does, Paired and on air. */
const SHUTTER: Record<Kind, boolean> = {
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

const STATE: Record<Kind, SessionState> = {
  idle: { kind: 'idle' },
  pairing: { kind: 'pairing' },
  paired: { kind: 'paired' },
  arming: { kind: 'arming', cause: 'operator', retrying: false },
  armed: { kind: 'armed', cause: 'operator', notReady: null },
  connecting: { kind: 'connecting', transport: 'srt' },
  publishing: { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 },
  degraded: { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: 1 },
  reconnecting: {
    kind: 'reconnecting',
    cause: 'uplink-lost',
    holdRemainingSeconds: 30,
    holdWindowSeconds: 60,
    sinceEpochMs: 1,
  },
  ended: { kind: 'ended', reason: 'operator-stopped', durationMs: null },
};

describe('when the shutter is offered (spec §8, the owner’s scope cut)', () => {
  it('M17 is offered in exactly Paired and on air, over every kind', () => {
    let checked = 0;
    let offered = 0;
    for (const kind of Object.keys(SHUTTER) as Kind[]) {
      const fakes = createFakePorts();
      fakes.engine.forceState(STATE[kind]);
      const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
      expect({ kind, shutter: view.result.current.shutter }).toEqual({
        kind,
        shutter: SHUTTER[kind],
      });
      checked += 1;
      if (view.result.current.shutter) offered += 1;
      view.unmount();
    }
    expect(checked).toBe(10);
    expect(offered).toBe(7);
  });

  it('follows one session through: offered paired and on air, gone when it ends', () => {
    const fakes = createFakePorts();
    fakes.engine.forceState(STATE.paired);
    const view = renderHook(() => useViewfinder(), { wrapper: wrapperFor(fakes) });
    const seen: boolean[] = [view.result.current.shutter];
    for (const kind of ['publishing', 'reconnecting', 'ended'] as const) {
      act(() => fakes.engine.forceState(STATE[kind]));
      seen.push(view.result.current.shutter);
    }
    expect(seen).toEqual([true, true, true, false]);
  });
});
```

`src/ui/screens/StreamScreen.photo.test.tsx` (copy is read from the dictionaries; the screen is driven through `renderViewfinder`):

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { PHOTO_NOTICE_MS } from '@/hooks/usePhoto';
import { PHOTO_DEADLINE_MS, createPhotoPort } from '@/services/photoPort';
import { colour } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';
import { renderViewfinder } from '../../../test/renderViewfinder';

const shutter = () => screen.getByRole('button', { name: en['stream.photo.label'] });

describe('Take photo in the icon row (spec §8, R3)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('M18 a tap saves, says so in the gap above the row for 3 s, and sits nowhere over the camera', async () => {
    const view = await renderViewfinder();
    await act(async () => fireEvent.click(shutter()));
    expect(view.photo.calls).toBe(1);
    const note = screen.getByTestId('photo-notice');
    expect(note.textContent).toBe(en['stream.photo.saved']);
    expect(within(screen.getByTestId('controls-gap')).getByTestId('photo-notice')).toBe(note);
    expect(within(screen.getByTestId('camera-box')).queryByTestId('photo-notice')).toBeNull();
    act(() => vi.advanceTimersByTime(PHOTO_NOTICE_MS));
    expect(screen.queryByTestId('photo-notice')).toBeNull();
  });

  it('M20 a failure is said in caution, not lime', async () => {
    const view = await renderViewfinder();
    view.photo.answerWith('failed');
    await act(async () => fireEvent.click(shutter()));
    const note = screen.getByTestId('photo-notice');
    expect(note.textContent).toBe(en['stream.photo.failed']);
    expect(getComputedStyle(note).color).toBe(cssColour(colour.caution));
    expect(colour.caution).not.toBe(colour.lime);
  });

  it('a tap while a photo is saving does nothing, on the screen too', async () => {
    const view = await renderViewfinder();
    view.photo.hold();
    await act(async () => fireEvent.click(shutter()));
    await act(async () => fireEvent.click(shutter()));
    expect(view.photo.calls).toBe(1);
    expect(screen.queryByTestId('photo-notice')).toBeNull();
    await act(async () => view.photo.release('saved'));
    expect(screen.getByTestId('photo-notice').textContent).toBe(en['stream.photo.saved']);
  });

  it('native never answering is a failed photo at 4 s, through the real port, hook and screen', async () => {
    // The seam, driven through its real producer and consumer: the port is the production one over a call that never settles.
    await renderViewfinder({ photo: createPhotoPort(() => new Promise(() => undefined)) });
    await act(async () => fireEvent.click(shutter()));
    await act(() => vi.advanceTimersByTimeAsync(PHOTO_DEADLINE_MS - 1));
    expect(screen.queryByTestId('photo-notice')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByTestId('photo-notice').textContent).toBe(en['stream.photo.failed']);
  });

  it('M19 the gap keeps a line of height for the line, at the bottom, in a live region (production style)', async () => {
    await renderViewfinder();
    const gap = screen.getByTestId('controls-gap');
    // The production style, read from the rendered gap: deleting it from StreamColumn reds this, not a test constant.
    expect(getComputedStyle(gap).minHeight).toBe(`${typeScale.metricUnit.lineHeight}px`);
    expect(getComputedStyle(gap).justifyContent).toBe('flex-end');
    expect(gap.getAttribute('aria-live')).toBe('polite');
    expect(typeScale.metricUnit.lineHeight).toBe(16);
  });

  it.each([
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('reads in %s', async (code, dictionary) => {
    const view = await renderViewfinder({ deviceLanguages: [code] });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: dictionary['stream.photo.label'] })),
    );
    expect(view.photo.calls).toBe(1);
    expect(screen.getByTestId('photo-notice').textContent).toBe(dictionary['stream.photo.saved']);
  });
});

/** react-native-web writes colours as rgb(); the token is hex. */
function cssColour(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
```

`StreamScreen.layout.test.tsx` (F1). Three tests pin the icon row's names, `:350-393`. Their expected arrays change, and **only** what the owner's R4 names changes:

- `keeps the icon row: Settings, then Home before air, …` (`:351`): the title becomes `…Settings, Home, then Take photo before air…`; `buttonNames(...)` is `[en['stream.link.settings'], en['stream.home'], en['stream.photo.label']]`; the 48 dp loop's names gain `en['stream.photo.label']`.
- `on air: What viewers see sits in the icon row after Settings, …` (`:367`): the title becomes `on air: Take photo, then What viewers see, sit in the icon row after Settings, …`; the array is `[en['stream.link.settings'], en['stream.photo.label'], en['stream.peek.label']]`. Its `peek()` and `flexGrow` assertions stay.
- `follows the broadcast through the icon row: …` (`:382`): before air `[settings, home, photo]`; live `[settings, photo, peek]`; and **Ended stays `[settings, home]`**, with the comment `// Ended: the camera picture is gone, so the shutter goes with it`. That last array is the absence witness (R4's other half) and must not gain the photo.

Add the shutter to `IconButton.test.tsx`'s `BUTTONS` (`['shutter', 'Take photo']`) and move its two anti-vacuity counts from 2 to 3. Add `['shutter', [], ['12,12,9', '12,12,4'], 0]` to `Glyph.test.tsx`'s `DRAWN` and move its counts from 5 to 6, with the comment `// the shutter is the plan's drawing (D9), not the canvas's`. Run all of it red.

- [ ] **Step 3: Implement.**

`modules/capture-engine/src/nativeModule.ts`: in `CaptureEngineNative`, after `tail()`, and amend the type's doc (_"Every call returns void or a value read at once"_ becomes _"…except `takePhoto`"_):

```ts
  /**
   * Spec §8: one still to the gallery. The one call that answers (AGENTS §2, recorded): native resolves `'saved'` or
   * `'failed'` within its bound, and the port reads anything else as failed. Required, not optional: an absent
   * member would be a photo that quietly never happens.
   */
  takePhoto(): Promise<unknown>;
```

`FakeNativeModule.ts` (F2), inside the class:

```ts
  /** What `takePhoto` answers, and how often it was asked. Tests set the first and read the second. */
  photoAnswer: unknown = 'saved';
  photoCalls = 0;
  takePhoto(): Promise<unknown> {
    this.photoCalls += 1;
    return Promise.resolve(this.photoAnswer);
  }
```

`test/hostEngine.ts` (F2), in `HostModule`:

```ts
  /** The JVM host has no camera and no gallery: a photo is never taken through it, so asking is loud. */
  takePhoto(): Promise<unknown> {
    return Promise.reject(new Error('the host has no camera'));
  }
```

`src/services/photoPort.ts`:

```ts
/**
 * Spec §8 and Q2: a still to the gallery. One bounded request whose answer is one of two words. It carries no
 * session state and is never read by the engine. The one call that answers (AGENTS §2, recorded).
 */
export type PhotoOutcome = 'saved' | 'failed';

/** The last resort. Native cuts its own call off at 2 000 ms, so this is normally never heard. */
export const PHOTO_DEADLINE_MS = 4_000;

export interface PhotoPort {
  /** Never rejects and never takes longer than the deadline. */
  take(): Promise<PhotoOutcome>;
}

/** Anything native did not say, in the word it says, is a failure. */
export function readOutcome(value: unknown): PhotoOutcome {
  return value === 'saved' ? 'saved' : 'failed';
}

export function createPhotoPort(
  call: (() => Promise<unknown>) | null,
  deadlineMs: number = PHOTO_DEADLINE_MS,
): PhotoPort {
  if (call === null) return { take: () => Promise.resolve('failed') };
  return {
    take: () =>
      new Promise<PhotoOutcome>((resolve) => {
        const timer = setTimeout(() => resolve('failed'), deadlineMs);
        const done = (outcome: PhotoOutcome) => {
          clearTimeout(timer);
          resolve(outcome);
        };
        try {
          call().then(
            (value) => done(readOutcome(value)),
            () => done('failed'),
          );
        } catch {
          done('failed');
        }
      }),
  };
}
```

`test/fakePhotoPort.ts` (test code):

```ts
import type { PhotoOutcome, PhotoPort } from '@/services/photoPort';

export type FakePhotoPort = PhotoPort & {
  readonly calls: number;
  /** Every later take answers with this, until changed. Default `saved`. */
  answerWith(outcome: PhotoOutcome): void;
  /** The next take stays pending until `release`. */
  hold(): void;
  release(outcome?: PhotoOutcome): void;
};

export function createFakePhotoPort(): FakePhotoPort {
  let calls = 0;
  let next: PhotoOutcome = 'saved';
  let holdNext = false;
  let held: ((outcome: PhotoOutcome) => void) | null = null;
  return {
    get calls() {
      return calls;
    },
    answerWith: (outcome) => {
      next = outcome;
    },
    hold: () => {
      holdNext = true;
    },
    release: (outcome) => {
      const resolve = held;
      held = null;
      resolve?.(outcome ?? next);
    },
    take: () => {
      calls += 1;
      if (!holdNext) return Promise.resolve(next);
      holdNext = false;
      return new Promise<PhotoOutcome>((resolve) => {
        held = resolve;
      });
    },
  };
}
```

`src/hooks/usePhoto.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';
import type { PhotoOutcome } from '@/services/photoPort';

/** R3: the line stays this long. */
export const PHOTO_NOTICE_MS = 3_000;

export type Photo = {
  /** The line to show: the last photo's word, for [PHOTO_NOTICE_MS]; null otherwise. */
  readonly notice: PhotoOutcome | null;
  /** A tap while a photo is saving does nothing. */
  take(): void;
};

export function usePhoto(): Photo {
  const { photo, logger, clock } = usePorts();
  const [notice, setNotice] = useState<PhotoOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const take = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = clock().getTime();
    void photo.take().then((outcome) => {
      inFlight.current = false;
      logger.info('photo.result', { result: outcome, ms: clock().getTime() - startedAt });
      if (timer.current !== null) clearTimeout(timer.current);
      setNotice(outcome);
      timer.current = setTimeout(() => {
        timer.current = null;
        setNotice(null);
      }, PHOTO_NOTICE_MS);
    });
  }, [photo, logger, clock]);
  return useMemo(() => ({ notice, take }), [notice, take]);
}
```

The port never rejects (tested above), so there is no `catch` here.

`src/hooks/usePorts.tsx`: `import type { PhotoPort } from '@/services/photoPort';` and, in `Ports`, after `share`: `/** Spec §8: a still to the gallery (the one call that answers, Q2). */ readonly photo: PhotoPort;`.

`src/hooks/nativePorts.ts`: take the module once, `const native = loadCaptureEngineNative();`, pass `native` to `chooseEngine` (replacing the inline call at `:41`), and add to the returned object `photo: createPhotoPort(native === null ? null : () => native.takePhoto()),` with the import. (A development build with the fake engine and a native module still calls the real `takePhoto`, which fails with no camera open: the line says so, truthfully. There is no second gate to keep.)

`test/fakePorts.ts`: import `createFakePhotoPort, type FakePhotoPort` from `./fakePhotoPort`; add `readonly photo: FakePhotoPort;` to `FakePorts` (doc: "`hold()`/`release()` pend a take; `calls` counts"); add `photo: createFakePhotoPort(),` to the `fakes` object (it then spreads into `ports`, as `share` does). `useEngineProbe.test.tsx` builds `Ports` by spreading `base.ports`, so it needs no edit; confirm by running it.

`src/hooks/useViewfinder.ts`: add to `Viewfinder` (after `onAir`):

```ts
  /** The camera picture shows, so Take photo is offered: Paired and on air (design follow-up §8, the owner's scope cut). */
  readonly shutter: boolean;
```

and to `project`'s result, after `onAir`: `shutter: kind === 'paired' || action === 'stop',`.

`src/ui/components/Glyph.tsx`: `GlyphName` gains `'shutter'`; the chain's last branch becomes `name === 'home' ? <HomeGlyph /> : <ShutterGlyph />`; add (D9, the plan's drawing):

```tsx
function ShutterGlyph() {
  return (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Circle cx={12} cy={12} r={4} />
    </>
  );
}
```

`src/ui/components/StreamColumn.tsx`: call `const photo = usePhoto();` once in `StreamColumn`. The gap (R3, F6, F9) becomes a live region that holds the line:

```tsx
      {/* R3: the photo's one line sits here, never over the camera box. Always mounted, so a screen reader hears it arrive. */}
      <View testID="controls-gap" style={styles.gap} accessibilityLiveRegion="polite">
        <PhotoNotice notice={photo.notice} />
      </View>
      <IconRow
        onAir={view.onAir}
        peekable={view.peekable}
        peek={peek}
        shutter={view.shutter}
        onShutter={photo.take}
        canLeave={props.canLeave}
        onHome={props.onHome}
        onSettings={props.onSettings}
      />
```

`IconRow` keeps PR A's relative order of Settings, What viewers see and Home, and places the shutter by R4 (after Home before air, after Settings on air):

```tsx
const IconRow = memo(function IconRow(props: IconRowProps) {
  const { t } = useT();
  const shutter = props.shutter ? (
    <IconButton glyph="shutter" label={t('stream.photo.label')} onPress={props.onShutter} />
  ) : null;
  return (
    <View testID="icon-row" style={styles.iconRow}>
      <IconButton glyph="settings" label={t('stream.link.settings')} onPress={props.onSettings} />
      {props.onAir ? shutter : null}
      <ColumnPeek onAir={props.onAir} peekable={props.peekable} peek={props.peek} />
      {props.canLeave ? (
        <IconButton glyph="home" label={t('stream.home')} onPress={props.onHome} />
      ) : null}
      {props.onAir ? null : shutter}
    </View>
  );
});
```

(`IconRowProps` gains `readonly shutter: boolean; readonly onShutter: () => void;`; the doc comment gains "and Take photo (§8)".) The line and its styles:

```tsx
/** The keys by literal, never a template string, so each one type-checks. */
const NOTICE_KEY = { saved: 'stream.photo.saved', failed: 'stream.photo.failed' } as const;

const PhotoNotice = memo(function PhotoNotice({ notice }: { readonly notice: PhotoOutcome | null }) {
  const { t } = useT();
  if (notice === null) return null;
  return (
    <Text
      variant="metricUnit"
      testID="photo-notice"
      numberOfLines={1}
      style={notice === 'saved' ? styles.saved : styles.problem}
    >
      {t(NOTICE_KEY[notice])}
    </Text>
  );
});

// in styles:
  // R3, F6, F9: a line of height always, so the line has a place to sit; at the bottom, beside the icon row it belongs to.
  gap: { flex: 1, minHeight: typeScale.metricUnit.lineHeight, justifyContent: 'flex-end' },
  saved: { color: colour.lime },
  problem: { color: colour.caution },
```

Imports: `Text` from `@/ui/components/Text`, `typeScale` from `@/ui/theme/type`, `usePhoto` from `@/hooks/usePhoto`, `type PhotoOutcome` from `@/services/photoPort`. The `IconButton` "names" of the shutter (`Take photo`) come from the dictionary; nothing draws a word.

- [ ] **Step 4: The fit, failing first** (`viewfinderFit.test.ts`; PR A's two controls-half cases have a `0` for the flexible gap). Replace that `0` in both with `typeScale.metricUnit.lineHeight`, with the comment `// R3 (PR B): the photo line's place in the gap.`, and keep `expect(items).toHaveLength(5)`. Before air that is 340 + 16 = 356 of 360 (written out from the tokens: plate 56, chip row 44 + 4 + 16, gap 16, icons 48, hold 72 + 4 + 16, four gaps of 12, padding 2 × 16); on air stays far under. **If the sum exceeds 360 in the merged tree, stop**: R3's fallback is the status strip's caption slot, and that is a decision to put to the owner, not to improvise.

- [ ] **Step 5: Run green, then the mutations.**

```bash
cd "$WT" && pnpm vitest run --project domain --project ui src/services/photoPort.test.ts src/hooks/usePhoto.test.tsx src/hooks/useViewfinder.shutter.test.tsx src/ui/screens/StreamScreen. src/ui/components/Glyph.test.tsx src/ui/components/IconButton.test.tsx src/ui/components/StreamColumn.test.tsx src/ui/components/hookOrder.test.tsx src/ui/theme/viewfinderFit.test.ts src/i18n/ test/fakePorts.test.ts test/hostEngine.test.ts src/hooks/engineWiring.test.ts src/hooks/useEngineProbe.test.tsx modules/capture-engine/src/nativeCaptureEngine.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

`src/ui/screens/StreamScreen.` is a deliberate substring: confirm the printed names are PR A's screen suites plus `StreamScreen.photo.test.tsx`, and that `StreamScreen.memo.test.tsx` is among them (adding `usePhoto` to the column must not make a telemetry tick re-render it). Then `pnpm typecheck` (the `implements CaptureEngineNative` errors surface here), `rtk proxy pnpm lint`, `pnpm format:check`.

| #    | Mutation                                                                                 | Test that must fail                                 |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| M12  | `readOutcome` returns `value as PhotoOutcome`                                            | `M12 reads saved as saved …`                        |
| M13  | delete the `setTimeout(...)` line in `createPhotoPort`                                   | `M13 gives up at the deadline exactly …`            |
| M14  | delete `clearTimeout(timer)` in `done`                                                   | `asks the module each time, and clears its timer …` |
| M15  | delete `if (inFlight.current) return;`                                                   | `M15 a tap while a photo is saving …`               |
| M16  | delete `if (timer.current !== null) clearTimeout(timer.current);`                        | `M16 a second photo inside the 3 s …`               |
| M17  | `shutter: kind === 'paired' \|\| action === 'stop'` becomes `shutter: action === 'stop'` | `M17 is offered in exactly Paired and on air …`     |
| M17b | `shutter: true`                                                                          | `M17 …` (the idle, pairing and ended rows)          |
| M18  | render `<PhotoNotice>` inside `camera-box` instead of `controls-gap`                     | `M18 a tap saves …`                                 |
| M19  | delete `minHeight` and `justifyContent` from `styles.gap`                                | `M19 the gap keeps a line of height …`              |
| M20  | `styles.problem` becomes `{ color: colour.lime }`                                        | `M20 a failure is said in caution …`                |
| M21  | in `viewfinderFit.test.ts`, set the line's reservation to `24`                           | the before-air controls case (364 > 360)            |

M17 and M17b also red the `follows the broadcast …` layout test (its Ended array). M19 deletes the **production** style in `StreamColumn.tsx`, not a constant in a test (F6).

- [ ] **Step 6: Commit** `feat(viewfinder): Take photo, the shutter, its line and the port (spec §8)`.

---

## Task 3: Orientation gate retries (carried from PR A)

Two findings PR A's final review parked in files PR B does not otherwise touch. Both are JS-only and independent of Tasks 1 and 2, so this task can run in its own worktree beside the photo (the ledger's Lane O). Pins are against `adb7f5f`; re-read both files before editing.

**Files:**

- Modify: `src/hooks/useOrientationGate.ts`, `src/domain/orientation/orientation.ts`.
- Test (modify): `src/hooks/useOrientationGate.test.tsx`, `src/domain/orientation/orientation.test.ts`.
- Run beside them, unchanged (they consume `GateView`): `src/ui/components/OrientationGate.test.tsx`, `src/ui/turnPose.test.ts`.

**The two defects, read from the code:**

- **(a) The retry dies on a `keep`.** `useOrientationGate`'s `useEffect` returns `lockWithRetry`'s cleanup, and React runs that cleanup on **every** dependency change (`view.lock`, `evaluation`, the ports), not only when a different lock is wanted. So when a lock is sent with nothing locked (R37) and refused, an on-air tilt (`view.lock` becomes `keep`, which is no lock at all) cancels the pending 500 ms retry and forgets the lock. Nothing is applied until the phone is next turned sideways. Cancel only when a newer, different lock supersedes the attempt in flight, and on unmount.
- **(b) A tilt under a hold, with nothing locked, sends nothing.** `orientationGate` (`orientation.ts`, the last line of the function) returns `keep` for a held phone whose reading disagrees with the target, whatever `current` is. After a lock is refused twice (R26 forgets it, so `current` is `null`), a tilt gives `{ lock: 'keep' }`: there is no lock to keep, so the activity follows the phone under the camera. R37 already says what to do when nothing is locked and the reading is `unknown`: lock the target. A reading that disagrees is the same case with a card to show.

**Decision (the card).** Under a hold with nothing locked and a disagreeing reading, the gate locks the **target** and keeps the target's card (`cardFor(target)`): the phone is held the wrong way for the lock just applied, which is what the card tells the operator. It is not `physical` (that would turn the activity under a broadcast, AGENTS §8 and P4) and not `none` (the phone is still the wrong way). Not derivable from the code; a reviewer who disagrees changes one value in the oracle below.

- [ ] **Step 1: Failing tests, `orientation.test.ts`.** Three edits, the third new.

The table row comment and two rows (a held phone, the other way, nothing locked), which today pin `keep`:

```ts
    // Held the other way: the target's card; off air lock to the hands (R24); on air keep a lock that is held
    // (R35) and lock the target when none is (R37).
    ['portrait', 'landscape', false, null, { lock: 'landscape', ...UP }],
    ['portrait', 'landscape', false, 'portrait', { lock: 'landscape', ...UP }],
    ['portrait', 'landscape', true, null, { lock: 'portrait', ...UP }],
    ['portrait', 'landscape', true, 'landscape', { lock: 'keep', ...UP }],
    ['landscape', 'portrait', false, null, { lock: 'portrait', ...SIDE }],
    ['landscape', 'portrait', false, 'landscape', { lock: 'portrait', ...SIDE }],
    ['landscape', 'portrait', true, null, { lock: 'landscape', ...SIDE }],
    ['landscape', 'portrait', true, 'portrait', { lock: 'keep', ...SIDE }],
```

The test `touches \`free\` only: a null lock held upright on air still keeps (R35 / R37 unchanged)`(it pins the old behaviour): rename it`a held tilt with nothing locked locks the target, and a lock that is held is kept (R35 / R37)` and assert:

```ts
expect(orientationGate('landscape', 'portrait', true, null)).toEqual({
  lock: 'landscape',
  card: 'turnSideways',
});
expect(orientationGate('landscape', 'portrait', true, 'landscape')).toEqual({
  lock: 'keep',
  card: 'turnSideways',
});
expect(orientationGate('landscape', 'unknown', true, null)).toEqual({
  lock: 'landscape',
  card: 'none',
});
```

New, after the `orientationGate` table, an oracle over the whole disagreeing space, written from R24, R35 and R37 and never from `orientationGate`:

```ts
describe('orientationGate: held the other way, by what is locked (R24, R35, R37)', () => {
  const OTHER = { portrait: 'landscape', landscape: 'portrait' } as const;
  const CARD = { landscape: 'turnSideways', portrait: 'turnUpright' } as const;
  /** Off air the hands lock (R24); on air a lock that is held stays (R35) and none held locks the target (R37). The card is the target's. */
  function oracle(
    target: 'portrait' | 'landscape',
    holding: boolean,
    current: Target | null,
  ): GateView {
    const lock = !holding ? OTHER[target] : current === null ? target : 'keep';
    return { lock, card: CARD[target] };
  }

  it('answers the oracle for every target, holding and lock (12 cases)', () => {
    let checked = 0;
    let locksTarget = 0;
    for (const target of ['portrait', 'landscape'] as const) {
      for (const holding of HOLDINGS) {
        for (const current of [null, 'portrait', 'landscape'] as const) {
          const view = orientationGate(target, OTHER[target], holding, current);
          expect({ target, holding, current, view }).toEqual({
            target,
            holding,
            current,
            view: oracle(target, holding, current),
          });
          checked += 1;
          if (holding && current === null) locksTarget += 1;
        }
      }
    }
    expect(checked).toBe(12);
    expect(locksTarget).toBe(2); // the new case is in the sweep, once per target
  });
});
```

(`HOLDINGS` is defined above this block in the file. `Target` is already imported.)

- [ ] **Step 2: Failing tests, `useOrientationGate.test.tsx`.** Helpers are the file's own (`gate`, `hold`, `UPRIGHT`, `SIDEWAYS`, `readRecord`). **Predicted** red and amended tests, from reading the file at `adb7f5f`; the implementer confirms each by running it and lists any further red in the commit body.

Amend the test at `:170` (it passes today only because the later `SIDEWAYS` re-sends). It becomes:

```tsx
it('forgets a lock refused twice, so the next evaluation sends it again, even under a held tilt (R26, R37)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  const lock = fakes.orientationLock.lock;
  let refusals = 2;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  const { hook } = await gate('landscape', fakes);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(fakes.orientationLock.locks).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(500)); // no third attempt
  expect(fakes.orientationLock.locks).toEqual([]);
  hold(fakes, UPRIGHT, 1000); // on air, nothing locked (it was forgotten): the target, with its card (finding b)
  await act(async () => undefined);
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
  expect(hook.result.current).toEqual({ lock: 'landscape', card: 'turnSideways' });
  hold(fakes, SIDEWAYS, 2000);
  await act(async () => undefined);
  expect(fakes.orientationLock.locks).toEqual(['landscape']); // applied once, not sent again
  const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
  expect(refused.map((e) => e.fields.attempt)).toEqual([1, 2]);
});
```

Replace the test at `:232` (`forgets a refused lock whose retry an on-air keep cancelled …`; it asserts the defect) with:

```tsx
// Finding (a): the effect's cleanup ran on every dependency change, so an on-air keep, which is no lock at all,
// cancelled the retry of a lock sent with nothing locked, and nothing was applied until the next sideways turn.
it('keeps a refused lock’s retry alive across an on-air keep, and applies it (R26)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  const lock = fakes.orientationLock.lock;
  let refusals = 1;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  await gate('landscape', fakes); // on air, nothing locked: landscape at once (R37), refused; the retry waits
  hold(fakes, UPRIGHT, 0); // the operator tilts up: keep, which is no newer lock
  expect(fakes.orientationLock.locks).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(499));
  expect(fakes.orientationLock.locks).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
  hold(fakes, SIDEWAYS, 1000); // already applied: not sent again
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
});
```

Rewrite the test at `:249` (`forgets a lock refused after a newer view cancelled it …`; its "newer view" is a keep, which supersedes nothing) as:

```tsx
it('retries a lock whose refusal lands after an on-air keep, since a keep supersedes nothing (R26)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  let refuse: (reason: Error) => void = () => undefined;
  const lock = fakes.orientationLock.lock;
  let first = true;
  fakes.orientationLock.lock = (target) => {
    if (!first) return lock(target);
    first = false;
    return new Promise((_, reject) => {
      refuse = reject;
    });
  };
  await gate('landscape', fakes); // landscape asked for; the platform has not answered
  hold(fakes, UPRIGHT, 0); // on air: keep, which cancels nothing
  await act(async () => refuse(new Error('refused'))); // then the refusal lands: one retry is owed
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(fakes.orientationLock.locks).toEqual(['landscape']);
  hold(fakes, SIDEWAYS, 1000);
  await act(async () => undefined);
  expect(fakes.orientationLock.locks).toEqual(['landscape']); // applied once
  const refused = readRecord(fakes.record).filter((e) => e.event === 'orientation.lock-refused');
  expect(refused.map((e) => e.fields.attempt)).toEqual([1]);
});
```

Two new tests, the supersession and the unmount (what the old cleanup did, now written down):

```tsx
it('cancels an older lock’s pending retry when a newer, different lock is sent (R26)', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  const lock = fakes.orientationLock.lock;
  let refusals = 1;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  await gate('landscape', fakes); // idle, no reading: landscape (R34), refused; the retry waits
  hold(fakes, UPRIGHT, 0); // off air: lock to the hands, portrait, a newer lock
  expect(fakes.orientationLock.locks).toEqual(['portrait']);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(fakes.orientationLock.locks).toEqual(['portrait']); // the old landscape retry never ran
});

it('cancels the pending retry on unmount, so no lock is sent after the screen is gone', async () => {
  vi.useFakeTimers();
  const fakes = createFakePorts();
  fakes.engine.forceState({ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 });
  const lock = fakes.orientationLock.lock;
  let refusals = 1;
  fakes.orientationLock.lock = (target) =>
    refusals-- > 0 ? Promise.reject(new Error('refused')) : lock(target);
  const { hook } = await gate('landscape', fakes); // refused; the retry waits
  hook.unmount();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(fakes.orientationLock.locks).toEqual([]);
});
```

Run both files red. Predicted: the three amended rows and the renamed test (3 + 1 assertions) and the oracle sweep in `orientation.test.ts`; the amended `:170` test, the replacement for `:232` and the rewrite of `:249` in the hook file. The supersession and unmount tests are green already (the old cleanup did both); they are **guards for the change below**, and are proven by their mutants, not by a red.

- [ ] **Step 3: Implement.**

`orientation.ts`: the last two lines of `orientationGate`, and the doc above it. Replace

```ts
return { lock: holding && !fromFree ? 'keep' : physical, card: cardFor(target) };
```

with

```ts
if (!holding || fromFree) return { lock: physical, card: cardFor(target) };
// Held: a lock that is held stays (R35). Nothing locked has none to keep, so the target is locked, as R37 does.
return { lock: current === null ? target : 'keep', card: cardFor(target) };
```

In the doc's second refinement list, add a third bullet: _"- a reading that disagrees with the target, with nothing locked yet, locks the target and shows its card: there is no lock to keep, and locking the hands would turn the activity under the camera (R37)."_

`useOrientationGate.ts`: keep the attempt in flight in a ref, and cancel it only when a different lock supersedes it and on unmount. Replace the effect (the one that returns `lockWithRetry(...)`) and add the ref:

```ts
const locked = useRef<Target | null>(null);
// Cancels the lock attempt in flight (its pending retry). Run by a newer, different lock and on unmount, never by
// a `keep`: a keep is no lock, so it supersedes nothing.
const inFlight = useRef<(() => void) | null>(null);
```

```ts
useEffect(() => {
  if (view.lock === 'keep' || view.lock === locked.current) return;
  const wanted = view.lock;
  inFlight.current?.(); // a newer, different lock supersedes the attempt in flight
  locked.current = wanted;
  inFlight.current = lockWithRetry(orientationLock, logger, wanted, () => {
    // R26: forget it, so the next differing lock retries.
    if (locked.current === wanted) locked.current = null;
  });
}, [view.lock, evaluation, orientationLock, logger]);

// The screen going away ends the attempt too. (The rule that reads refs in a cleanup only objects to a ref the
// component never assigns; this one is assigned above.)
useEffect(() => () => inFlight.current?.(), []);
```

Update the doc above `lockWithRetry`: _"Returns a cancel, which cancels a pending retry. The caller runs it when a newer, different lock supersedes this one and on unmount, never for a `keep`, which is no lock at all. A refused lock whose retry never ran is not applied, so it is forgotten either way (R26)."_ And in `useOrientationGate`'s own doc, after _"…with nothing locked yet the target is locked (R37)"_ add _"; so does a reading that disagrees under a hold, with the target's card"_.

- [ ] **Step 4: Run green, then the mutations.**

```bash
cd "$WT" && pnpm vitest run --project domain --project ui src/hooks/useOrientationGate.test.tsx src/domain/orientation/orientation.test.ts src/ui/components/OrientationGate.test.tsx src/ui/turnPose.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
cd "$WT" && node -e 'const r=require(process.argv[1]);console.log("total",r.numTotalTests,"failed",r.numFailedTests);for(const t of r.testResults)console.log(t.status,t.name)' "$TMPDIR/v.json"
```

Confirm the four printed names are the four files, and that `total` is the red-run total plus the new tests (the pin on `numTotalTests`: a mutant that fails to parse shrinks it and reads as a survivor). Then `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm format:check`.

| #    | Mutation                                                                                            | Test that must fail                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M22  | in the send effect, call `inFlight.current?.()` **before** the `if (view.lock === 'keep' …) return` | `keeps a refused lock’s retry alive across an on-air keep …` and `retries a lock whose refusal lands after an on-air keep …` |
| M22b | delete the `inFlight.current?.();` line in the send effect                                          | `cancels an older lock’s pending retry when a newer, different lock …`                                                       |
| M22c | delete the unmount effect (`useEffect(() => () => inFlight.current?.(), [])`)                       | `cancels the pending retry on unmount …`                                                                                     |
| M23  | in `orientationGate`, `current === null ? target : 'keep'` becomes `'keep'`                         | the two amended table rows, the oracle sweep, the renamed test, and the amended `:170` hook test                             |

M22 is the finding-(a) guard and M23 the finding-(b) guard; M22b and M22c pin the two cancellations that must **survive** the change. Back each file up with `cp` first and restore from the copy.

- [ ] **Step 5: Commit** `fix(orientation): a refused lock's retry survives an on-air keep, and a held tilt with nothing locked locks the target`.

---

## Task 4: The viewer feed rule (§9)

**Files:**

- Create: `src/domain/session/viewerFeed.ts`, `src/domain/session/viewerFeed.test.ts`

**Interfaces:**

- Produces:

```ts
export type DeliveryWord = 'ok' | 'stalled' | 'unknown'; // = Telemetry['delivery'], pinned by a type test in Task 5
export type Feed = 'none' | 'waiting' | 'playing' | 'unavailable';
export type FeedInput = {
  readonly kind: SessionState['kind'];
  readonly hasUrl: boolean;
  readonly delivery: DeliveryWord;
  /** A window has been delivered in this stretch of the broadcast (latched by the hook; cleared by a hold). */
  readonly everDelivered: boolean;
  /** The first window did not come within the patience (set by the hook's timer). */
  readonly patienceOver: boolean;
  /** The player failed and its retries are spent. */
  readonly playerFailed: boolean;
};
export const FIRST_WINDOW_PATIENCE_MS = 60_000;
export function viewerFeed(input: FeedInput): Feed;
```

- [ ] **Step 1: Failing tests.** The rulebook is written as explicit rows plus invariants over the whole input space; none of it calls `viewerFeed` to compute an expectation.

```ts
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import {
  FIRST_WINDOW_PATIENCE_MS,
  viewerFeed,
  type DeliveryWord,
  type Feed,
  type FeedInput,
} from '@/domain/session/viewerFeed';

type Kind = SessionState['kind'];
const KINDS: Record<Kind, true> = {
  idle: true,
  pairing: true,
  paired: true,
  arming: true,
  armed: true,
  connecting: true,
  publishing: true,
  degraded: true,
  reconnecting: true,
  ended: true,
};
const DELIVERIES: readonly DeliveryWord[] = ['ok', 'stalled', 'unknown'];

const base: FeedInput = {
  kind: 'publishing',
  hasUrl: true,
  delivery: 'unknown',
  everDelivered: false,
  patienceOver: false,
  playerFailed: false,
};
const row = (change: Partial<FeedInput>): Feed => viewerFeed({ ...base, ...change });

describe('what the viewer layer shows (spec §9, D6 to D8)', () => {
  it('has a fixed 60 s patience (D8)', () => {
    expect(FIRST_WINDOW_PATIENCE_MS).toBe(60_000);
  });

  it('the rulebook, row by row', () => {
    const rows: [string, Feed, Feed][] = [
      ['no url, publishing, ok', row({ hasUrl: false, delivery: 'ok' }), 'none'],
      ['paired, ok', row({ kind: 'paired', delivery: 'ok' }), 'none'],
      ['ended, ok', row({ kind: 'ended', delivery: 'ok', everDelivered: true }), 'none'],
      ['arming', row({ kind: 'arming' }), 'waiting'],
      ['armed', row({ kind: 'armed' }), 'waiting'],
      ['connecting', row({ kind: 'connecting' }), 'waiting'],
      ['publishing, no window yet', row({}), 'waiting'],
      ['publishing, first window now', row({ delivery: 'ok' }), 'playing'],
      [
        'publishing, latched, one poll failed',
        row({ delivery: 'unknown', everDelivered: true }),
        'playing',
      ],
      ['publishing, patience over, no window', row({ patienceOver: true }), 'unavailable'],
      [
        'publishing, patience over, window now',
        row({ patienceOver: true, delivery: 'ok' }),
        'playing',
      ],
      ['publishing, stalled', row({ delivery: 'stalled', everDelivered: true }), 'unavailable'],
      ['degraded, window', row({ kind: 'degraded', delivery: 'ok' }), 'playing'],
      [
        'reconnecting (a hold), latched',
        row({ kind: 'reconnecting', delivery: 'unknown', everDelivered: true }),
        'unavailable',
      ],
      ['reconnecting, never delivered', row({ kind: 'reconnecting' }), 'unavailable'],
      [
        'playing but the player gave up',
        row({ delivery: 'ok', playerFailed: true }),
        'unavailable',
      ],
    ];
    expect(rows).toHaveLength(16);
    for (const [name, got, want] of rows) expect({ name, got }).toEqual({ name, got: want });
  });

  it('M24 never plays unless a window was seen, over the whole input space', () => {
    let checked = 0;
    let played = 0;
    for (const kind of Object.keys(KINDS) as Kind[])
      for (const delivery of DELIVERIES)
        for (const everDelivered of [false, true])
          for (const hasUrl of [false, true])
            for (const patienceOver of [false, true])
              for (const playerFailed of [false, true]) {
                const feed = row({
                  kind,
                  delivery,
                  everDelivered,
                  hasUrl,
                  patienceOver,
                  playerFailed,
                });
                checked += 1;
                if (!hasUrl) expect(feed).toBe('none');
                if (feed === 'playing') {
                  played += 1;
                  expect(['publishing', 'degraded']).toContain(kind);
                  expect(everDelivered || delivery === 'ok').toBe(true);
                  expect(delivery).not.toBe('stalled');
                  expect(playerFailed).toBe(false);
                }
              }
    expect(checked).toBe(10 * 3 * 2 * 2 * 2 * 2);
    expect(played).toBeGreaterThan(0);
  });
});
```

Run red (module missing).

- [ ] **Step 2: Implement** (`viewerFeed.ts`):

```ts
import type { SessionState } from '@/domain/session/SessionState';

type Kind = SessionState['kind'];

/** Native's delivery word (`Telemetry['delivery']`). A type test in `useViewerFeed.test.tsx` keeps the two equal. */
export type DeliveryWord = 'ok' | 'stalled' | 'unknown';

/** What the viewer layer shows. `none`: nothing to show. */
export type Feed = 'none' | 'waiting' | 'playing' | 'unavailable';

/**
 * D8: about three times the hypothesised 18–23 s for Cloudflare's first window (spec §9; unmeasured, SB2). After
 * it the layer says so; a later window still recovers it. A timeout, not a clock.
 */
export const FIRST_WINDOW_PATIENCE_MS = 60_000;

export type FeedInput = {
  readonly kind: Kind;
  readonly hasUrl: boolean;
  readonly delivery: DeliveryWord;
  readonly everDelivered: boolean;
  readonly patienceOver: boolean;
  readonly playerFailed: boolean;
};

const HELD_NOT_LIVE: ReadonlySet<Kind> = new Set(['arming', 'armed', 'connecting']);
const LIVE: ReadonlySet<Kind> = new Set(['publishing', 'degraded']);

/**
 * A display rule over the engine's word, not a second state machine (AGENTS §2). The player is mounted only in
 * `playing`: never against a manifest nobody has seen (the cause of a blank layer), and never across a hold,
 * whose playlist is stale (D6, D7).
 */
export function viewerFeed(input: FeedInput): Feed {
  const { kind } = input;
  if (!input.hasUrl) return 'none';
  if (HELD_NOT_LIVE.has(kind)) return 'waiting';
  if (kind === 'reconnecting') return 'unavailable';
  if (!LIVE.has(kind)) return 'none';
  if (input.delivery === 'stalled') return 'unavailable';
  if (input.everDelivered || input.delivery === 'ok')
    return input.playerFailed ? 'unavailable' : 'playing';
  return input.patienceOver ? 'unavailable' : 'waiting';
}
```

- [ ] **Step 3: Run green, mutations.** Run `viewerFeed.test.ts`; typecheck; lint; format.

| #    | Mutation                                                                                                | Test that must fail                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M24  | delete the `input.everDelivered \|\| input.delivery === 'ok'` test (return `playing` for any live kind) | `M24 never plays unless a window was seen …` and the row `publishing, no window yet` |
| M25  | delete the `kind === 'reconnecting'` line                                                               | the rows `reconnecting …`                                                            |
| M25b | delete the `delivery === 'stalled'` line                                                                | the row `publishing, stalled`                                                        |
| M25c | delete `input.playerFailed ?` (always `playing`)                                                        | the row `playing but the player gave up`                                             |

- [ ] **Step 4: Commit** `feat(viewfinder): the viewer feed rule, waiting, playing or unavailable (spec §9)`.

---

## Task 5: The viewer layer says what it is doing, and the player starts by rule (§9)

**Files (PR A names; re-pin):**

- Create: `src/hooks/useViewerFeed.ts`, `src/hooks/useViewerFeed.test.tsx`
- Modify:
  - `src/hooks/engineSelectors.ts` (+ `engineSelectors.test.ts`): `selectDelivery`.
  - `src/services/surfaces.ts`: `VideoStatus`, `VideoProps.onStatus`.
  - `src/services/native/nativeSurfaces.tsx` and `nativeSurfaces.test.tsx`: the status wiring.
  - `src/ui/components/StageVideo.tsx`: the layer.
  - `src/ui/components/StreamStage.tsx`: mounts it by feed.
  - `test/fakeSurfaces.ts` (+ `fakeSurfaces.test.ts`): `videoStatus`, `videoMounts`.
  - `src/i18n/{en,es,fr,nl}.json`, `src/i18n/budgets.test.ts`: `stream.peek.loading`.

**Interfaces:**

- Consumes: `viewerFeed`, `FIRST_WINDOW_PATIENCE_MS` (Task 4); `selectStateKind`, `selectPlaybackUrl`; `Ports.logger`, `Ports.clock`.
- Produces:

```ts
// surfaces.ts
export type VideoStatus = 'loading' | 'ready' | 'failed';
export type VideoProps = {
  readonly url: string;
  readonly playing: boolean;
  readonly onStatus?: (status: VideoStatus) => void;
};
// engineSelectors.ts
export const selectDelivery = (snapshot: EngineSnapshot) => snapshot.telemetry.delivery;
// useViewerFeed.ts
export const PLAYER_RETRY_MS: readonly number[] = [2_000, 4_000, 8_000];
export type ViewerFeed = {
  readonly feed: Feed;
  readonly attempt: number; // the player's remount key
  readonly starting: boolean; // playing, but the player has not shown a picture yet
  onStatus(status: VideoStatus): void;
};
export function useViewerFeed(): ViewerFeed;
```

- [ ] **Step 1: Copy.** Add `stream.peek.loading` to the four dictionaries (the _Copy_ table), make sure es, fr and nl carry `"_review": "pending translation review"` (Task 2 adds it; add it if absent, and never to en), add `[/^stream\.peek\.loading$/, 44],` to `BUDGETS`. Run `src/i18n/` green.

- [ ] **Step 2: Failing tests.**

`fakeSurfaces.ts` first gains the controls the tests need (it is test code; its own `fakeSurfaces.test.ts` gets a case that `videoStatus('ready')` reaches the mounted `Video`'s `onStatus`, and one that `videoMounts()` counts a remount):

```ts
// FakeSurfaces gains:
//   videoStatus(status: VideoStatus): void   // the Video on screen reports a player status
//   videoMounts(): number                    // how many Video elements have mounted, retries included
function Video({ url, playing, onStatus }: VideoProps) {
  useEffect(() => {
    mounts += 1;
  }, []);
  useEffect(() => {
    reportStatus = onStatus ?? null;
    return () => {
      if (reportStatus === onStatus) reportStatus = null;
    };
  }, [onStatus]);
  return createElement('div', {
    'data-testid': 'viewer-video',
    'data-url': url,
    'data-playing': String(playing),
  });
}
```

`src/hooks/useViewerFeed.test.tsx` (through `renderViewfinder`, so the real hook runs inside the real stage; `engine.patch` moves the delivery word; `fakes.setNow` moves the clock the hook reads). Keep the `pressIn`/`peek` helpers of `StreamScreen.onAir.test.tsx`.

```tsx
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Telemetry } from '@/engine/CaptureEnginePort';
import type { DeliveryWord } from '@/domain/session/viewerFeed';
import { FIRST_WINDOW_PATIENCE_MS } from '@/domain/session/viewerFeed';
import en from '@/i18n/en.json';
import { PLAYER_RETRY_MS } from '@/hooks/useViewerFeed';
import { readRecord, TEST_NOW } from '../../test/fakePorts';
import { pressIn } from '../../test/press';
import { renderViewfinder } from '../../test/renderViewfinder';

const peek = () => screen.getByRole('button', { name: 'What viewers see' });
const note = () => screen.queryByTestId('viewer-note')?.textContent ?? null;
const WAITING = en['stream.peek.loading'];
const NONE = en['stream.peek.unavailable'];

/** On air, the native word saying no window has been seen yet. */
async function liveWithoutWindow() {
  const view = await renderViewfinder();
  act(() => view.engine.scene('live'));
  act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
  return view;
}
const advance = (view: Awaited<ReturnType<typeof liveWithoutWindow>>, ms: number) => {
  view.setNow(new Date(view.ports.clock().getTime() + ms));
  act(() => vi.advanceTimersByTime(ms));
};

describe('the viewer layer (spec §9, D6 to D8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the type matches native’s delivery word', () => {
    expectTypeOf<DeliveryWord>().toEqualTypeOf<Telemetry['delivery']>();
  });

  it('M26a before the first window it says so and mounts no player, so nothing is blank', async () => {
    await liveWithoutWindow();
    pressIn(peek());
    expect(note()).toBe(WAITING);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });

  it('plays the moment the first window lands, loading until the player says ready, and records the time', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, 19_000);
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    expect(screen.getByTestId('viewer-video').dataset.playing).toBe('true');
    expect(note()).toBe(WAITING);
    act(() => view.surfaces.videoStatus('ready'));
    expect(note()).toBeNull();
    const lines = readRecord(view.record).filter((line) => line.event === 'peek.firstWindow');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ ms: 19_000 });
  });

  it('M27 the patience is 60 s exactly, then says no picture, and a later window still recovers', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    advance(view, FIRST_WINDOW_PATIENCE_MS - 1);
    expect(note()).toBe(WAITING);
    advance(view, 1);
    expect(note()).toBe(NONE);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    expect(screen.getByTestId('viewer-video')).toBeTruthy();
  });

  it('M28 one failed poll after the first window keeps playing', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
    expect(screen.getByTestId('viewer-video')).toBeTruthy();
  });

  it('M29 a hold unmounts the player, and the way back waits for a fresh window', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    expect(view.surfaces.videoMounts()).toBe(1);
    act(() => view.engine.scene('holding'));
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    expect(note()).toBe(NONE);
    act(() => view.engine.scene('live'));
    act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
    expect(note()).toBe(WAITING);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    expect(view.surfaces.videoMounts()).toBe(2);
  });

  it('native’s stalled word is no picture, with no player', async () => {
    const view = await renderViewfinder();
    act(() => view.engine.scene('not-delivered'));
    pressIn(peek());
    expect(note()).toBe(NONE);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });

  it('M30 a failing player is retried on the schedule with a fresh player, then given up on', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    for (const [index, wait] of PLAYER_RETRY_MS.entries()) {
      act(() => view.surfaces.videoStatus('failed'));
      act(() => vi.advanceTimersByTime(wait - 1));
      expect(view.surfaces.videoMounts()).toBe(index + 1);
      act(() => vi.advanceTimersByTime(1));
      expect(view.surfaces.videoMounts()).toBe(index + 2);
    }
    act(() => view.surfaces.videoStatus('failed'));
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    expect(note()).toBe(NONE);
    expect(PLAYER_RETRY_MS).toHaveLength(3);
  });

  it('M31 the next broadcast starts from waiting, not from the last one’s window', async () => {
    const view = await liveWithoutWindow();
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    act(() => view.engine.scene('stopped'));
    act(() => view.engine.scene('paired-ready'));
    act(() => view.engine.scene('live'));
    act(() => view.engine.patch({ delivery: 'unknown', deliveredLagMs: null }));
    pressIn(peek());
    expect(note()).toBe(WAITING);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
  });

  it('M32 the record names states and numbers only: no url, no host, no manifest', async () => {
    const view = await liveWithoutWindow();
    pressIn(peek());
    act(() => view.engine.patch({ delivery: 'ok', deliveredLagMs: 9_200 }));
    act(() => view.surfaces.videoStatus('failed'));
    act(() => vi.advanceTimersByTime(PLAYER_RETRY_MS[0] ?? 0));
    const lines = readRecord(view.record).filter((line) => line.event.startsWith('peek.'));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const allowedKeys = new Set(['state', 'delivery', 'ms', 'attempt', 'status']);
    for (const line of lines)
      for (const key of Object.keys(line.fields)) expect(allowedKeys.has(key)).toBe(true);
    const text = view.record.lines().join('\n');
    for (const secret of ['video.example', 'm3u8', 'manifest', 'http'])
      expect(text).not.toContain(secret);
    expect(TEST_NOW.getTime()).toBeGreaterThan(0);
  });
});
```

(`view.engine.patch` is `FakeCaptureEngine.patch(telemetry)`; the fake's playback URL is `https://video.example/fake/manifest/video.m3u8`, which is the sentinel the last test sweeps for.) Add the `nativeSurfaces.test.tsx` cases and an `engineSelectors.test.ts` case for `selectDelivery`.

`nativeSurfaces.test.tsx` (extend `fakeVideo()`; the existing cases keep passing because the new fields are additive):

```ts
function fakeVideo() {
  const listeners: ((payload: { status: string }) => void)[] = [];
  const player = {
    muted: false,
    loop: true,
    status: 'loading',
    play: vi.fn(),
    pause: vi.fn(),
    addListener: vi.fn((_event: string, listener: (payload: { status: string }) => void) => {
      listeners.push(listener);
      return { remove: vi.fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
    }),
  };
  const emit = (status: string) => {
    player.status = status;
    for (const l of [...listeners]) l({ status });
  };
  /* useVideoPlayer, VideoView and pkg as before; return { player, emit, listeners, useVideoPlayer, pkg } */
}
```

New cases (inside `describe('the native viewer video')`): (1) the status table `readyToPlay→ready`, `loading→loading`, `idle→loading`, `error→failed` (4 rows, `expect(rows).toBe(4)`), (2) the initial `player.status` is reported once on mount, (3) `play()` is called when the status becomes `readyToPlay` while `playing` is true, and not when it is false, (4) the listener is removed on unmount (`listeners.length` 0).

- [ ] **Step 3: Run red.** Record the counts: the hook and surface suites fail (no hook, no `onStatus`).

- [ ] **Step 4: Implement.**

`surfaces.ts`: add `export type VideoStatus = 'loading' | 'ready' | 'failed';` and `readonly onStatus?: (status: VideoStatus) => void` to `VideoProps`.

`engineSelectors.ts`: `export const selectDelivery = (snapshot: EngineSnapshot) => snapshot.telemetry.delivery;`

`nativeSurfaces.tsx` (`MutedVideo`, `:155-171`):

```tsx
const STATUS: Readonly<Record<string, VideoStatus>> = {
  readyToPlay: 'ready',
  error: 'failed',
  loading: 'loading',
  idle: 'loading',
};

function MutedVideo({
  url,
  playing,
  onStatus,
  expoVideo,
}: VideoProps & { readonly expoVideo: VideoPackage }) {
  const source = useMemo(() => ({ uri: url, useCaching: false }), [url]);
  const player = expoVideo.useVideoPlayer(source, muted);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const report = (status: string) => {
      const mapped = STATUS[status] ?? 'loading';
      onStatus?.(mapped);
      // The start fix (D6): a player that became ready while it is wanted plays at once.
      if (mapped === 'ready' && playingRef.current) player.play();
    };
    const subscription = player.addListener('statusChange', ({ status }) => report(status));
    report(player.status); // it may be ready before the listener was attached
    return () => subscription.remove();
  }, [player, onStatus]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  const { VideoView } = expoVideo;
  return (
    <VideoView player={player} style={styles.fill} nativeControls={false} contentFit="contain" />
  );
}
```

Add `useRef` to the React import and `VideoStatus` to the surfaces import; `NativeVideo` passes `props` through unchanged. (`player.addListener`, `player.status` and the `statusChange` payload are `expo-video` 57.0.3's own types, read from `build/VideoPlayer.types.d.ts` and `VideoPlayerEvents.types.d.ts`.)

`useViewerFeed.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIRST_WINDOW_PATIENCE_MS, viewerFeed, type Feed } from '@/domain/session/viewerFeed';
import { selectDelivery, selectPlaybackUrl, selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { VideoStatus } from '@/services/surfaces';

/** D6: a failing player is retried with a fresh one after each wait, then given up on. */
export const PLAYER_RETRY_MS: readonly number[] = [2_000, 4_000, 8_000];

export type ViewerFeed = {
  readonly feed: Feed;
  readonly attempt: number;
  readonly starting: boolean;
  onStatus(status: VideoStatus): void;
};

const LIVE = new Set(['publishing', 'degraded']);
/** D7 and the next broadcast: nothing is held, so nothing carries over. */
const OVER = new Set(['idle', 'pairing', 'paired', 'ended']);

export function useViewerFeed(): ViewerFeed {
  const { logger, clock } = usePorts();
  const kind = useEngineSelector(selectStateKind);
  const hasUrl = useEngineSelector(selectPlaybackUrl) !== null;
  const delivery = useEngineSelector(selectDelivery);
  const window = useFirstWindow(kind, delivery, hasUrl);
  const player = usePlayer();
  const feed = viewerFeed({ kind, hasUrl, delivery, ...window, playerFailed: player.failed });
  useFeedLines(feed, delivery);
  useResetPlayer(feed, player.reset);
  return useMemo(
    () => ({
      feed,
      attempt: player.attempt,
      starting: feed === 'playing' && player.status !== 'ready',
      onStatus: player.onStatus,
    }),
    [feed, player.attempt, player.status, player.onStatus],
  );
}
```

with these sub-hooks in the same file (each 10 to 25 lines; the full bodies are written by the implementer from this contract, and the tests above pin them):

- `useFirstWindow(kind, delivery, hasUrl)` returns `{ everDelivered, patienceOver }` and owns `liveSince` (a ref of epoch ms, from `clock().getTime()`):
  - `LIVE.has(kind)` and `liveSince === null` → `liveSince = now`.
  - `!LIVE.has(kind)` → `liveSince = null`, `patienceOver = false`; and when `kind === 'reconnecting'` or `OVER.has(kind)` → `everDelivered = false` (D7).
  - `delivery === 'ok' && !everDelivered && hasUrl && LIVE.has(kind)` → `everDelivered = true` and `logger.info('peek.firstWindow', { ms: now - liveSince })` (once per stretch).
  - A timer, set when `LIVE.has(kind) && !everDelivered`: `setTimeout(() => setPatienceOver(true), FIRST_WINDOW_PATIENCE_MS - (now - liveSince))`, cleared by the effect's cleanup. No interval.
- `usePlayer()` returns `{ attempt, failed, status, onStatus, reset }`:
  - `onStatus('ready'|'loading')` sets `status`. `onStatus('failed')` with `attempt < PLAYER_RETRY_MS.length` logs `peek.retry` `{ attempt }` and sets a timer of `PLAYER_RETRY_MS[attempt]` that increments `attempt`; with the retries spent it sets `failed`.
  - `reset()` clears the timer and sets `attempt = 0`, `failed = false`, `status = 'loading'`.
- `useFeedLines(feed, delivery)`: an effect on `feed` that logs `logger.info('peek.state', { state: feed, delivery })`.
- `useResetPlayer(feed, reset)`: an effect that calls `reset()` whenever `feed !== 'playing'`.

Every `logger` call here uses only the keys `ms`, `attempt`, `state`, `delivery`, `status`: no `url`, no `playbackUrl`, no message (M32).

`StageVideo.tsx`: replace the body with the layer of Plan decisions D6:

```tsx
type StageVideoProps = {
  readonly url: string;
  readonly showing: boolean;
  readonly feed: Feed; // 'waiting' | 'playing' | 'unavailable' (never 'none': the stage does not mount it)
  readonly attempt: number;
  readonly starting: boolean;
  readonly onStatus: (status: VideoStatus) => void;
};

const NOTE: Readonly<
  Record<'waiting' | 'unavailable', 'stream.peek.loading' | 'stream.peek.unavailable'>
> = {
  waiting: 'stream.peek.loading',
  unavailable: 'stream.peek.unavailable',
};

export const StageVideo = memo(function StageVideo(props: StageVideoProps) {
  const { surfaces } = usePorts();
  const { t } = useT();
  const { Video } = surfaces;
  const key =
    props.feed === 'playing'
      ? props.starting
        ? 'stream.peek.loading'
        : null
      : NOTE[props.feed === 'waiting' ? 'waiting' : 'unavailable'];
  return (
    <View
      pointerEvents="none"
      style={props.showing ? styles.shown : styles.hidden}
      aria-hidden={!props.showing}
    >
      {props.feed === 'playing' ? (
        <Video
          key={props.attempt}
          url={peekPlaybackUrl(props.url)}
          playing={props.showing}
          onStatus={props.onStatus}
        />
      ) : null}
      {key === null ? null : (
        <View testID="viewer-note" style={styles.note}>
          <Text variant="body">{t(key)}</Text>
        </View>
      )}
    </View>
  );
});
```

`styles.note`: `{ ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colour.ground, padding: space.sm }`. (`Text variant="body"` exists since PR A's strip uses it.)

`StreamStage.tsx` (PR A: the camera half): `const feed = useViewerFeed();` and the mount (was `:47-49`) becomes

```tsx
{
  props.peek.mounted && playbackUrl !== null && feed.feed !== 'none' ? (
    <StageVideo
      url={playbackUrl}
      showing={props.peek.showing}
      feed={feed.feed}
      attempt={feed.attempt}
      starting={feed.starting}
      onStatus={feed.onStatus}
    />
  ) : null;
}
```

The URL goes to the player only. It is never given to a logger, a note or a test id.

- [ ] **Step 5: Existing suites.** `StreamScreen.onAir.test.tsx` (_plays what viewers see the moment the finger lands_) still holds: scene `live` has `delivery: ok`, so the first press mounts the player. `ViewerPeek.test.tsx` is unchanged. Fix any suite that read the old always-mounted player only where it read structure, never weakening a behaviour assertion; list every changed test in the commit body.

- [ ] **Step 6: Run green, mutations.**

```bash
cd "$WT" && pnpm vitest run --project domain --project ui src/domain/session/viewerFeed.test.ts src/hooks/useViewerFeed.test.tsx src/hooks/engineSelectors.test.ts src/services/native/nativeSurfaces.test.tsx test/fakeSurfaces.test.ts src/ui/components/ViewerPeek.test.tsx src/ui/components/hookOrder.test.tsx src/ui/screens/StreamScreen. src/i18n/ --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

Then typecheck (the `expectTypeOf` case needs it), lint, format.

| #    | Mutation                                                                                                                         | Test that must fail                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| M26  | `StreamStage`: mount `StageVideo` and render `<Video>` whenever `feed !== 'none'` (drop the `playing` condition in `StageVideo`) | `M26a before the first window …`                 |
| M27  | patience timer `FIRST_WINDOW_PATIENCE_MS - elapsed` becomes `FIRST_WINDOW_PATIENCE_MS + 1 - elapsed`                             | `M27 the patience is 60 s exactly …`             |
| M28  | `everDelivered` set false whenever `delivery !== 'ok'`                                                                           | `M28 one failed poll …`                          |
| M29  | do not clear `everDelivered` on `reconnecting`                                                                                   | `M29 a hold unmounts …`                          |
| M30  | drop `key={props.attempt}` from `<Video>`                                                                                        | `M30 a failing player is retried …`              |
| M30b | retries unbounded (`attempt < PLAYER_RETRY_MS.length` becomes `true`)                                                            | `M30 …` (the give-up half)                       |
| M31  | do not reset on `OVER` kinds                                                                                                     | `M31 the next broadcast starts from waiting …`   |
| M32  | add `url` to the `peek.state` line                                                                                               | `M32 the record names states and numbers only …` |
| M33  | `STATUS.error` becomes `'loading'`                                                                                               | the `nativeSurfaces` status-table case           |

- [ ] **Step 7: Commit** `fix(viewfinder): what viewers see waits for the first window, says what it is doing, and restarts by rule (spec §9)`.

---

## Task 6: AGENTS.md, the settled §8 section, the PR A plan amendment, the translation review, and the PR's scoped gate

**Files:**

- Modify: `AGENTS.md`; `docs/specs/2026-10-06-s1-design-followup-design.md`; `docs/i18n-glossary.md`; `src/i18n/{es,fr,nl}.json` (remove the `_review` markers).
- Modify: `docs/superpowers/plans/2026-10-06-s1-design-pr-a.md` (PR A's merged plan; section I of its Task 9, and one table row).

- [ ] **Step 1: The AI review pass** (`docs/i18n-glossary.md`, _Clearing the marker_). For the four keys of _Copy_ (`stream.photo.label`, `.saved`, `.failed`, `stream.peek.loading`): check each against en, where it renders (`grep -a` the key in `src`), the glossary and the budgets; correct it if needed and record any correction in the commit body; remove `_review` from es, fr and nl. Add a glossary row for _photo_ (es foto, fr photo, nl foto) if absent; there is no _gallery_ row to add, because no string says it. Then `cd "$WT" && pnpm i18n:release-check; echo "EXIT=$?"` must exit 0.

- [ ] **Step 2: AGENTS.md.** Edit only these two passages; re-pin the line numbers first (at `adb7f5f`: §2 is `AGENTS.md:78`, the intents bullet `:87-90`; §6's viewfinder bullet `:232-235`). **There is no §8 edit**: the photo has no shedding rule.
  - **§2, after the intents bullet.** Add: _"One recorded exception (design follow-up §8; owner, 2026-10-08): `takePhoto` is a request with an answer, one call that resolves `saved` or `failed` within native's bound. It carries no session state, runs on a scope of its own with no path to the session's failure path, and is never read by the machine, the snapshot or the heartbeat. It is the only such call."_
  - **§6, the viewfinder bullet.** Append: _"The icon row also holds Take photo (design follow-up §8); its confirmation is one line in the controls half's gap, never over the camera box. The viewer video's Waiting and No-viewer-picture notes are the viewer video's own layer: nothing else is drawn over the camera box."_
  - Then `pnpm prettier --check AGENTS.md docs/i18n-glossary.md docs/specs/2026-10-06-s1-design-followup-design.md`. **`AGENTS.md` may already be prettier-dirty; never `--write` it.** If `--check` fails on it, prove the failure is not in your lines: save `git show HEAD:AGENTS.md` to the scratchpad, run `pnpm prettier --check` on that copy, and show the failure is the same one.

- [ ] **Step 3: The spec section PR B owes.** Spec §8 says _"Gallery permission and the confirmation copy are settled in PR B's own spec section."_ Insert into `docs/specs/2026-10-06-s1-design-followup-design.md` directly under §9 and **above** `## §10 Scorer code (PR C)`:

```markdown
## §8 and §9 as settled in PR B (UNVERIFIED-ON-DEVICE)

- **Take photo is one tap, one still, one line** (owner, 2026-10-08: _"a simply feature, where user can click to
  photo, nothing make complex"_). A shutter in the icon row whenever the camera picture is showing, Paired and on air.
  Native saves a JPEG of the camera picture, no scorebug, and answers `saved` or `failed`; the app says so for 3 s. A
  tap while a photo is saving does nothing.
- **Gallery permission: none.** The still is written with `MediaStore.Images` to `Pictures/Seazn Capture`. minSdk is 31,
  so the app writes its own image with no storage permission, no prompt, no library and no config plugin.
- **Confirmation copy:** _Photo saved_ (lime) or _Couldn't save the photo_ (caution), one line for 3 s in the controls
  half above the icon row, never over the camera box.
- **File name:** `Seazn_yyyyMMdd_HHmmss.jpg`; never a match, a side or a name.
- **What bounds it:** a scope of its own with no path to the session's failure path; native answers within 2 s whatever
  happens, and the app gives up at 4 s. There is no single-flight lock, no refusal beside a capture command and no
  pre-emption in native: a snapshot holds StreamPack's source lock, so a Stop or a Go live tapped inside that window
  waits for it, at most 2 s. The device spike times it (PR B plan, Task 7, item 1).
- **Follow-up, not in PR B (owner, 2026-10-08): a photo with the scorebug.** The candidate is an on-screen copy of the
  camera box (Android `PixelCopy`, cropped to the box), spiked on the device first. Its known costs: screen resolution,
  not camera resolution; it captures whatever sits over the box; rotation and the mirror; and the on-screen score runs
  ahead of viewers. The score is never redrawn in the app.
- **What viewers see:** the player is created only once native reports `delivery: ok` (the first Cloudflare window),
  shows _Waiting for the first picture_ until then and until the player is ready, and _No viewer picture_ after 60 s
  without a window, on a stalled word, and during a hold. A failing player is replaced up to three times (2, 4, 8 s).
  The first-window time is one record line, `peek.firstWindow`, so the 18–23 s hypothesis is a number.
- **Premises not confirmed:** the peek plays standard HLS, not LL-HLS (S1 spec, _Low-latency HLS is off_); the 18–23 s
  figure has no evidence in the repo.
```

- [ ] **Step 4: Amend PR A's merged plan (the ping steps).** The web lane's owner runs the forced-RTMPS test themselves (ledger, 2026-10-08), so **no SRT flip and no ping to the web lane, before or after**. What remains is to send the web lane any session id from an RTMPS device pass. In `docs/superpowers/plans/2026-10-06-s1-design-pr-a.md`, Task 9, section **I. One forced RTMPS session against staging** (`:2032-2042` at `adb7f5f`; re-pin) and the table row at `:2069`:
  - Replace the paragraph under the heading with: _"Any time after the merge. It needs no PR C code, and the orchestrator flips no flag and pings no one: the web lane's owner runs the forced-RTMPS test on their side (2026-10-08). What is owed here is a device pass that reaches RTMPS (items 88 to 90), and the session id of any such pass, sent to the web lane."_
  - Item **87**: replace with `- [ ] **87. (Withdrawn, 2026-10-08.)** No SRT flip and no ping. Start items 88 to 90 once the web lane's owner says the forced RTMPS is in place on their side.`
  - Items **88, 89, 90, 92**: unchanged (numbers kept, so nothing after them moves).
  - Item **91**: replace with `- [ ] **91. (Withdrawn, 2026-10-08.)** Hold Stop. No ping and no flag to restore.`
  - The row `The forced RTMPS session, for the web lane | 87 to 92` becomes `… | 88 to 90, 92`.
  - `pnpm prettier --check docs/superpowers/plans/2026-10-06-s1-design-pr-a.md` (compare with the file at `HEAD` if it was dirty before the edit).

- [ ] **Step 5: The PR's scoped gate.** Run every vitest file named in Tasks 2 to 5 in one command with the JSON reporter, and paste the counts: total, failed, the file list:

```bash
cd "$WT" && pnpm vitest run --project domain --project ui src/services/photoPort.test.ts src/hooks/usePhoto.test.tsx src/hooks/useViewfinder.shutter.test.tsx src/ui/screens/StreamScreen. src/ui/components/Glyph.test.tsx src/ui/components/IconButton.test.tsx src/ui/components/StreamColumn.test.tsx src/ui/components/hookOrder.test.tsx src/ui/components/ViewerPeek.test.tsx src/ui/theme/viewfinderFit.test.ts src/i18n/ test/fakePorts.test.ts test/hostEngine.test.ts test/fakeSurfaces.test.ts src/hooks/engineWiring.test.ts src/hooks/useEngineProbe.test.tsx src/hooks/engineSelectors.test.ts src/hooks/useViewerFeed.test.tsx src/domain/session/viewerFeed.test.ts src/services/native/nativeSurfaces.test.tsx src/hooks/useOrientationGate.test.tsx src/domain/orientation/orientation.test.ts src/ui/components/OrientationGate.test.tsx src/ui/turnPose.test.ts modules/capture-engine/src/nativeCaptureEngine.test.ts --reporter=json --outputFile="$TMPDIR/v.json" > "$TMPDIR/v.log" 2>&1; echo "EXIT=$?"
```

Read the printed `name`s: a typo in a positional silently runs fewer files, so count them against this list. Then the Gradle filters of Task 1 plus the neighbours that share the touched files:

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :test --tests 'com.seazn.capture.engine.capture.photo.*' --tests 'com.seazn.capture.engine.capture.run.*' --tests 'com.seazn.capture.engine.adapter.GlueRulesTest' > "$TMPDIR/g.log" 2>&1; echo "EXIT=$?"
```

Run `pnpm typecheck`, `rtk proxy pnpm lint`, `pnpm format:check`, `pnpm i18n:release-check`. **Never** `pnpm check` or `pnpm test`; CI runs them. Run each command three times if any one was ever red in this branch. The `bridge` project is not run: PR B changes neither the host's behaviour nor the intent wire (the host gains a stub `takePhoto`, covered by `test/hostEngine.test.ts` above).

- [ ] **Step 6: The PR body** (the orchestrator opens the PR after this task; implementers do not push). Title `feat(capture): Take photo, and what viewers see waits for the first picture [UNVERIFIED-ON-DEVICE]`. **The body labels what a source-text pin is** (F14), so no reader takes it for behaviour:

```markdown
UNVERIFIED-ON-DEVICE. No phone session was run while this was built (owner constraint). Nothing in the Android module
was compiled: the first compile is the owner's local release build. The owner tests PRs A, B and C together on the
device; the checklist is Task 7 of docs/superpowers/plans/2026-10-07-s1-design-pr-b.md.

Proven by running code: the photo's two-second bound, its class-name-only failure line and its file name (JVM, PhotoRun
and PhotoName); the JS port with its four-second deadline, the hook, the shutter, the line and the four languages
(vitest); the viewer-feed rule and hook (vitest); the two orientation-gate retry fixes (vitest).

Only a source-text pin, NOT behaviour: the Kotlin glue. GalleryPhoto.kt, the StreamerAdapter.kt and
CaptureEngineModule.kt edits and the SoundMeter.kt release are read as text by GlueRulesTest. A pin proves a line is
there, not that it works; core's JVM cannot compile AudioRecord, MediaStore or StreamPack. The device checklist is the
real witness for all of them.

Not proven: that a snapshot on air leaves the stream undisturbed, the rotation of the saved picture, the gallery write
on the owner's phone, and the Cloudflare first-window time. Known cost of the owner's scope cut: no single-flight or
pre-emption in native, so a Stop tapped inside a stalled snapshot can wait up to 2 s. A photo with the scorebug is a
recorded follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 7: Commit** `docs: AGENTS.md, the settled §8 and §9, the PR A plan amendment and the translation review (spec §8, §9)`.

---

## Task 7: Device checklist (the owner's hands)

This task is a checklist for the owner. An agent never simulates it, infers it, ticks it or runs it on an emulator. The orchestrator hands it over after PRs A, B and C are merged, and records the owner's results beside each line, with a screenshot of the app only. A line that fails is a finding for the orchestrator, never a change made on the device run.

**The build:** the owner's local release build of the merged tree, with Gradle, as AGENTS §11 has it. **Never EAS.**

- [ ] **0. It compiles.** The first build compiles `GalleryPhoto.kt`, the `StreamerAdapter.kt`, `CaptureEngineModule.kt` and `SoundMeter.kt` edits, and `Capture.takePhoto`. If Gradle names an error there, that is a finding (the Kotlin was written against `javap`, not a compiler). Do not hand-fix it on the device run.
- [ ] **1. The spike (spec §8): a snapshot on air does not disturb the stream.** On a staging match, go live, and on the console or a second phone watch the playback.
  - Tap _Take photo_ ten times over two minutes, five seconds apart. After each tap: the viewers' picture does not freeze or stutter; the phone's meter and timer keep moving; the Diagnostics card's Bitrate and Round trip rows stay in their usual range.
  - Share the record afterwards and look for these, which must be absent: `frames-gap`, `video-stalled`, `capture-call-failed` with `action` `photo`, any transition to Degraded or Reconnecting. Count the `photo.result` lines: ten, all `saved`.
  - A burst: five taps inside two seconds. A tap while a photo is saving does nothing, so record how many photos were saved (fewer than five if saves overlap) and that the stream is unaffected.
  - **Stop on time.** Tap _Take photo_, then at once hold Stop. It ends the broadcast in the same time as a Stop with no photo (time both, three times each). There is no pre-emption in native (the owner's scope cut), so a snapshot that stalls could hold Stop for up to 2 s: if Stop is more than a second later with a photo than without, that is the finding that decides whether the cut pre-emption rule comes back. Report it.
  - **Go live.** Tap _Take photo_ and, within a second, hold Go live. It goes live as usual.
  - If any of these fail, the pre-air-only fallback is `shutter: kind === 'paired'` in `useViewfinder.ts`; report it and do not ship Take photo on air.
- [ ] **2. The picture.**
  - The photo is in the gallery (Photos or Gallery app) in an album named _Seazn Capture_, named `Seazn_yyyyMMdd_HHmmss.jpg`, with nothing about the match in its name.
  - It opens, is the camera picture with **no scorebug**, and is **upright** with the phone held sideways to the left and to the right, before air and on air. Record its resolution.
  - If it is sideways or upside down, record which side: the fix is the one `rotationDegrees` argument in `GalleryPhoto.shoot` (D5).
- [ ] **3. Before air.** In Paired with the camera ready, tap _Take photo_: it saves, **and the preview keeps running afterwards** (a snapshot before air starts the source for the duration, SB5; if the preview freezes or the camera light drops, that is a finding).
- [ ] **4. No prompt, ever.** The first photo on a fresh install shows no permission dialog. If one appears, or the first photo says _Couldn't save the photo_, R1 is wrong on this phone: report it.
- [ ] **5. Where the shutter is, and what it says when it cannot.**
  - The shutter is in the icon row in Paired and on air (including Arming, Armed, Connecting, Degraded and Reconnecting), and **absent** in Pairing, Idle and after the broadcast has ended (Ended). It is never dimmed.
  - With the slate up (a hold, or the camera taken by another app), tap it: the line says _Couldn't save the photo_, nothing else on the screen changes, and the broadcast is unaffected. This is the honest answer to a snapshot of a slate, not a defect.
- [ ] **6. The line and the glyph.**
  - The line is one line, fits at 640 × 360 and at the phone's own size without moving the hold button, shows for about 3 s, and is lime when saved and orange when not. Check it in en, es, fr and nl.
  - **Where it sits (F9).** The line is at the bottom of the gap, beside the icon row it belongs to (`justifyContent: 'flex-end'`). Judge it: does it read as the row's confirmation, or as floating? If it floats, the alternative is the top of the gap; report which looks right.
  - The shutter glyph matches the canvas, version 23 (D9 is the plan's drawing). The icon row reads Settings, Home, Take photo before air, and Settings, Take photo, _What viewers see_ on air (R4), with the row not clipped.
  - **The peek label with the shutter beside it.** On air the _What viewers see_ cell is about 56 dp narrower. In en, es, fr and nl: does its label wrap, and does the row's height change? Report each.
- [ ] **7. Owner's question, answered.** Q1 was answered **(a)** on 2026-10-08: _"a — the What viewers see is blank"_. Record whether the layer is still blank with this build. Item 8 is the evidence.
- [ ] **8. What viewers see (spec §9).** The evidence the hypotheses wait for.
  - Go live. Within ten seconds, hold _What viewers see_: it shows _Waiting for the first picture_ on a dark layer, never a blank one. Keep holding or hold again until the picture appears.
  - **The number.** Share the record and read `peek.firstWindow`: its `ms` is the time from Publishing to the first Cloudflare window. Report it. The spec's guess is 18 000 to 23 000; the patience is 60 000. If it is over 40 000, report it before the owner relies on the 60 s.
  - Time, with a stopwatch, from that line's moment to the first picture on the phone. Report it as T_start. **It is a measurement, not a pass or fail**; if it is over ten seconds, that is the finding for a player-buffer follow-up (SB1: the stream is standard HLS, not LL-HLS).
  - Once the picture is playing, hold and release a few times: it plays at once each time. Let go for over 30 s and hold again: it plays.
  - **A hold.** Switch the phone to airplane mode for ten seconds on air, then back. During the hold, holding the button shows _No viewer picture_ (not a frozen frame). After it recovers, the layer shows _Waiting for the first picture_ and then the picture again, with a fresh player.
  - **A fall-back.** If a fall-back to RTMPS can be forced, hold the button across it and report whether the picture survives or the layer retries (`peek.retry` lines).
  - **The next broadcast.** Stop, go live again, hold within ten seconds: it starts from _Waiting_ again, not from the last broadcast's picture.
  - Look at the record for `peek.state`, `peek.firstWindow` and `peek.retry` lines, and confirm **none carries a link or a host**.
- [ ] **9. Locales.** Repeat 6 and 8 in es, fr and nl: screenshots of each.
- [ ] **10. PR A and C's items on the screens PR B touched.** Re-run PR A's plan, Task 9, items 1 and 3, which cover the fit and the camera box, with the shutter in the row.
- [ ] **11. The orientation gate (Task 3).** A refused lock is rare, so this is a regression check and not a proof. On air at `/stream`, turn the phone upright and back sideways a few times, then send the app to the background and bring it back once: the viewfinder stays landscape-locked, the turn card shows while the phone is upright and clears when it is sideways, and the broadcast never rotates under the camera. If the shared record holds an `orientation.lock-refused` line, write down its `attempt` values.
- [ ] **12. The microphone is released (Task 1, the `SoundMeter` leak).** This is the **only** witness for that fix: core's JVM cannot compile `AudioRecord`. Start a recording in another app so the microphone is busy, open Seazn Capture and pair: the sound reading says the microphone is not usable. End the other recording, then record in the other app again while Seazn Capture sits on the same screen: it can. If you cannot make the microphone busy, write _could not make_.

---

## Self-review

- **Spec coverage.**
  - §8, _a shutter icon in the icon row, before air and on air_: Task 2 (R4, `Viewfinder.shutter`). _Saves a still … no scorebug … to the gallery_: Task 1 (`GalleryPhoto`, `MediaStore`; the score is a WebView, not in the frames). _Feasibility: `takeSnapshot` / `takeJpegSnapshot`_: Code facts and SB5, with the signatures in Task 1. _PR B starts with a device spike_: SB3 and Task 7, item 1. _Gallery permission and the confirmation copy are settled in PR B's own spec section_: R1 to R3, Task 6 Step 3.
  - §9, _Owner symptom: mostly nothing_: Task 4 and Task 5 (the player is never created against a manifest nobody has seen, and the layer always says something). _Hypothesis: first window 18–23 s_: Task 5 (gate on native's `ok`, 60 s patience, `peek.firstWindow`), SB2. _Hypothesis: slow LL-HLS inside a hold_: SB1, Task 4 (`reconnecting` is `unavailable`) and Task 5 (M29). _The parked question is asked again_: the Owner question at the top, answered (a).
  - The carried PR A findings: the `SoundMeter` leak (Task 1, M10, Task 7 item 12) and the two orientation retries (Task 3, M22 to M23, Task 7 item 11).
  - The owner's constraints: Global Constraints, verbatim, seven bullets. The device checklist is Task 7, last.
- **Placeholder scan.** No `TBD` or `TODO`. Two honest gaps are named, not hidden: the shutter glyph is the plan's drawing (D9, Task 7 item 6) and the snapshot rotation is device-only (D5, Task 7 item 2). Task 5's three sub-hooks are specified by contract and pinned by the tests above them, with the full hook skeleton given; an implementer writes their bodies. PR A names are marked as re-pin notes.
- **Type consistency.**
  - `PhotoResult.wire` strings (`saved`, `failed`) equal `PhotoOutcome` (Task 2) and the `NOTICE_KEY` map's keys (Task 2).
  - `PhotoRun.SHOT_MS = 2_000`; `PHOTO_DEADLINE_MS = 4_000` is twice it (asserted in Task 2); native's answer reaches JS only as `'saved'` or `'failed'`, and `readOutcome` treats everything else as failed.
  - `Photo` (usePhoto) is what `StreamColumn` reads; `Viewfinder.shutter` is what the icon row reads.
  - `Feed` and `FeedInput` (Task 4) are what `useViewerFeed` fills (Task 5); `DeliveryWord` equals `Telemetry['delivery']` (a type test in Task 5).
  - `VideoStatus` is in `surfaces.ts` and used by `nativeSurfaces.tsx`, `fakeSurfaces.ts`, `StageVideo.tsx` and the hook.
  - Mutation numbers run M1 to M33 with no reuse. A letter suffix means a second guard in the same area.
- **Review Focus coverage.** (1) Task 1 (the source-text pin M5, the bound M2), Task 7 item 1. (2) Task 1 (M1, M2, M3, M5). (3) Task 2 (M15). (4) Tasks 4 and 5 (M24 to M31). (5) Task 1 (the OOM message, M6), Task 2 (the line's keys), Task 5 (M32).
- **Unresolved, by design.**
  - Q1 is answered (a). Q2 and the scope are the owner's direction of 2026-10-08.
  - Whether a snapshot disturbs the stream, the rotation of the saved picture, and that the Kotlin compiles are device or release-build facts: Task 7, items 0 to 3. The `SoundMeter` leak has no local behavioural witness: Task 7, item 12.
  - The 18–23 s hypothesis and the player's start time are measured, not assumed: Task 7, item 8.
  - The fit still has to hold after PR A merges; if the sum exceeds 360, R3's fallback is an owner decision (Task 2, Step 4).
