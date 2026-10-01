# S1 Plan C — the Android platform and the Expo bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are dispatched in the batches listed under **Dispatch batches**, one implementer per batch.

**Goal:** Put plan B's merged pure-Kotlin session core on a real Android phone. That means StreamPack capture and encode, our own SRT sink, RTMPS with a scoped TLS guard, the foreground service, the camera, microphone, network, battery and thermal adapters, the HTTP client, and an Expo Module bridge with a native preview view. The bridge replaces the fake engine that `createNativePorts` wires in production today (plan A's D25). This is spec §7 phase 4, and every plan A and plan B carry that belongs to it.

**Architecture:** Three layers, and only the last one needs a phone.

1. **`core/`** (plan B, pure Kotlin) stays the only authority. Plan C adds the session's name to its snapshot, reconciles its record scrub with JavaScript's, and makes one helper public.
2. **`adapter/`** is new pure Kotlin in the same Gradle build, unit-tested on the JVM in the existing `kotlin-core` CI job. It holds every rule the platform needs: mapping intents and snapshots to and from the bridge, the guarded scheduler, sticky permanent failures, the attempt pollers, HTTP answers, SRT socket options, the TLS-guard predicate, device readings and the watch logic. `BridgeCore` joins them around plan B's `Engine`. A JVM host process runs `BridgeCore` with a scripted platform, so the JavaScript engine contract (`test/engineContract.ts`) runs against the real core through the real bridge mapping.
3. **The Android glue** under `modules/capture-engine/android/src/main/java/` turns Android facts into `Input`s and carries out `Command`s. It holds no rule. It is compile-checked in CI, and device-checked by the owner.

On the JavaScript side, `createNativeCaptureEngine` maps native's snapshot event onto plan A's `EngineSnapshot`, sends intents as void calls, and routes the logger's lines into the native session record while a session exists.

**Tech Stack:**

- Expo SDK 57 (expo-modules-core 57.0.17), React Native 0.86.3, TypeScript 6 strict, vitest 5;
- Kotlin 2.1.20, AGP 8.12.0, Gradle 9.3.1, JDK 17, compileSdk/targetSdk 36, minSdk 24;
- StreamPack 3.2.0 (`core`, `ui`, `srt`, `rtmp`), srtdroid-ktx 1.10.1 (libsrt 1.5.7), komuxer rtmp 0.4.0 (Ktor 3.3.3);
- OkHttp at the version React Native already resolves (Task 23 checks it), and `org.json` on the JVM test classpath only.

**Spec:** `docs/specs/2026-09-30-s1-live-stream-design.md` (owner-approved; binding; do not edit). It covers §3 (`platform/` and _Bridge_), §5, §6 (_CI_, _Device checks_) and §7 phase 4.

**Sources, in authority order:**

1. the spec;
2. the owner's rulings of 2026-10-01: the crash-screen copy is approved as built, and plan C builds a viewfinder-only error boundary around the native preview;
3. the carries in `docs/specs/2026-09-30-s1-plan-a-results.md`, _Carried to plan C_ (all 28 are traced below);
4. the research in `docs/superpowers/plans/2026-09-30-s1-plan-c-research.md`;
5. this plan's own judgment, recorded under **Plan decisions**.

Plans A and B are merged: `docs/superpowers/plans/2026-09-30-s1-plan-a-js-domain-and-screens.md` and `docs/superpowers/plans/2026-09-30-s1-plan-b-kotlin-core.md`. P5 findings are cited by ID from `docs/specs/2026-09-11-p5-android-results.md`.

## Global Constraints

- **Worktree.** Execute in a worktree of `main` (at or after `a65bede`) on branch `feat/s1-plan-c`. Run `pnpm install --frozen-lockfile` once. Put `cd <absolute worktree path> &&` in every command you judge, because the shell cwd resets to the main checkout between calls (AGENTS §13).
- **Never EAS.** No `eas build`, `eas submit` or `eas update`, ever. Native builds are local: `pnpm expo prebuild -p android --no-install`, then Gradle and `adb` (AGENTS §11).
- **Prebuild rewrites `package.json`.** Before every prebuild, `cp package.json "$TMPDIR/package.json.bak"`. After it, `cp "$TMPDIR/package.json.bak" package.json`, then `git diff --exit-code package.json`. Never commit the rewrite. The root `android/` is gitignored prebuild output and is never committed.
- **`expo-camera` is never installed.** StreamPack owns the capture session. `streampack-services` is never added, and `StreamerLifeCycleObserver` is never attached (research, boilerplate §8).
- **Pins** are copied verbatim into `modules/capture-engine/android/build.gradle` (Task 20) with Gradle `strictly`:
  - `io.github.thibaultbee.streampack:streampack-{core,ui,srt,rtmp}:3.2.0`;
  - `io.github.thibaultbee.srtdroid:srtdroid-ktx:1.10.1`;
  - `io.github.komedia.komuxer:rtmp:0.4.0`.
    Nothing newer may be adopted without a real `assembleDebug` first: Kotlin 2.1.20 cannot read 2.3+ metadata (research §Toolchain).
- **The native/JS line (AGENTS §2).**
  - Native owns the session. JS receives a snapshot event at least once a second.
  - Every intent returns void.
  - No TypeScript state machine, apart from the absent engine (CD23).
  - Frames never cross the bridge; the preview is a native view.
- **Threads (CD9).** One `HandlerThread` named `capture-engine` backs the `Scheduler`. `Engine.start` and `Engine.stop` run only on it, and every adapter reports through `PlatformEvents`, which posts. **No adapter blocks the scheduler thread**: no `runBlocking` in the glue (the `GlueRulesTest` in Task 11 enforces it), and no DNS lookup or socket call on it.
- **Layering.** `src/domain` stays pure. `ui/` reaches native only through `Ports`. `engine` (`modules/capture-engine/src`) may import `engine` and `domain` only, so the bridge takes its logger and descriptor URL as injected functions. Lint enforces all of it.
- **Secrets.** Never log, print, screenshot or commit a code's raw value, `tok`, an SRT passphrase or stream id, or an RTMPS stream key. Test fixtures are made up. Real staging credentials come from the owner in person, never over a session channel, and live only on the owner's laptop. The Cloudflare token likewise comes from the owner directly.
- **Cloudflare.** The account is shared and prepaid. Every device publish ends with the owner deleting the recording (`DELETE /stream/{video_uid}`): recordings outlive their inputs.
- **Tests.**
  - A test that exists because of a P5 finding starts its name with the finding's ID, and is written to fail first.
  - No expected value is derived from the code under test. Copy comes from the dictionaries, states from the spec's tables, and numbers are worked by hand in a comment.
  - No snapshot tests.
  - Every guard named in a task is mutated once and a test must fail. Restore it from a `cp` backup, never with `git checkout` or `git stash`.
- **Counts.** Kotlin: count from the XML, never from a summary:
  ```bash
  cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"' build/test-results/test/*.xml host/build/test-results/test/*.xml 2>/dev/null | tr -dc '0-9\n' | paste -sd+ - | bc
  ```
  JS: `pnpm vitest run --reporter=json --outputFile="$TMPDIR/r.json"`, then read `numTotalTests` and `numFailedTests`. Capture exit codes with `cmd > out 2>&1; echo "EXIT=$?"`, never through a pipe. Baselines at `a65bede`: **452** Kotlin tests and **1919** JS tests, 0 failed.
- **Checks.** `pnpm check` covers typecheck, lint, Prettier on `src app modules test`, and vitest. Also run `pnpm prettier --check` on every other file you touch (docs, `app.json`, workflows).
- **Kotlin style.** `allWarningsAsErrors` stays on in the core build. Pure units take time as arguments or through `Clock`, and never read a system clock.
- **Copy.** Every operator-visible string is in all four dictionaries. Non-English entries keep `"_review": "pending native speaker"`. Status lines fit `STATUS_LINE_BUDGET` (48), which `src/i18n/budgets.test.ts` enforces.
- **Device claims.** A claim about what the operator sees, or about Android behaviour, is settled only on a phone, and the report says so. Steps that need the owner's hands are listed for the owner, never simulated (AGENTS §13).
- **Commits.** Use `git commit -F -` with a heredoc, staging files by explicit path, never `git add -A`. Messages are conventional and end with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
  ```

## Review Focus

These are the inputs the spec implies that ordinary happy-path tests would miss, most likely first. Each has a test in the task named.

1. **An adapter blocks the scheduler thread**: a StreamPack suspend call under `runBlocking`, a DNS lookup in `connect`, or a slow HTTP answer read inline. Snapshots stop, and the HUD would keep claiming LIVE. Expected: nothing in the glue blocks. If native goes quiet anyway, the column says so within 3 s and the plate stops claiming LIVE. Pinned in Task 11 (`GlueRulesTest` forbids `runBlocking` and `InetAddress` in the glue outside the resolver) and in Task 18 (the silence line and plate, with a mutation).
2. **JavaScript restarts while native is live**: Try again after a crash, or a dev reload. Expected: the first `getSnapshot()` already says publishing, names the session, and the record shows the lines from before the restart. Pinned in Task 12 (`current()` before any tick) and Task 15 (the engine built over a native that already reports publishing, and the record seeded from `tail()`).
3. **A permanent failure before the first connect**: camera permission refused, or libsrt failing to load. Expected: the session ends fatal-error and still names its code, Go live never spins, the Ended block says to allow the permission, and the code is kept. Pinned in Task 6 (sticky failure, attempt in hand), Task 12 (named ended) and Task 18 (the permission line).
4. **A secret inside a library's message or a forwarded JS line**, in raw, form-encoded or component-encoded form. Expected: `***` in the native record, never the value. Pinned in Task 3 (the shared vectors, run on both sides, with mutations).
5. **A drop reported twice for one attempt, or a second `Connected` for it.** StreamPack's `throwableFlow` is a conflated `StateFlow` that replays (research, boilerplate §5). Expected: one drop counted, and one Frames poller and one Link poller per attempt. Pinned in Task 7 (pollers) and Task 11 (`AttemptSignals`).

## Dispatch batches

Each batch goes to **one implementer** as a single brief. Every task commits on its own. A batch ends with its suite green, the raw counts reported, and every task's commit present. The reviewer then reviews the batch diff before the next batch starts.

| Batch  | Tasks | Unit                                                                                                                                               | Files it owns, beyond its new files                                                                                                                                                                                                                                 | Ends with                                            |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **C1** | 1–3   | Core carries: RR-12 and RR-13; the session's name with the token-tag vectors; the shared scrub on both sides                                       | `core/**` (Engine, SessionConfig, Phase, Snapshot, Projection, SessionMachine, SessionRecord, build.gradle.kts), `src/services/{scrub,sessionRecord}.ts(+tests)`, `modules/capture-engine/src/{wire,scrub}/**`, `test/fakePorts.ts` (`readRecord`), the results doc | `./gradlew test`, `pnpm check`                       |
| **C2** | 4–8   | Adapter logic I: arm and intent mapping, the snapshot wire, the guarded scheduler and sticky failures, the attempt pollers, HTTP                   | `core/src/main/kotlin/com/seazn/capture/engine/adapter/**`, `core/.../core/{Json,Phase,SessionMachine}.kt`, `modules/capture-engine/src/wire/**`                                                                                                                    | `./gradlew test`                                     |
| **C3** | 9–11  | Adapter logic II: device readings and exit reasons; the mic, camera and notification logic; SRT options, the TLS guard, drop signal and glue rules | `core/.../adapter/**` (new files only), `core/build.gradle.kts` (system properties)                                                                                                                                                                                 | `./gradlew test`                                     |
| **C4** | 12–16 | `BridgeCore`, the JVM host, the JS bridge, the routed record, and the contract kit run against the host                                            | `core/settings.gradle.kts`, `core/host/**`, `modules/capture-engine/src/**`, `src/services/sessionRecord.ts`, `test/engineContract.ts`, `vitest.config.ts`, `.github/workflows/kotlin-core.yml`                                                                     | both suites, plus `pnpm vitest run --project bridge` |
| **C5** | 17–19 | JS product changes: the disarm bound, silence, the keep-open advisory, the permission line and record counters, and the composition root           | `src/hooks/**`, `src/ui/**`, i18n, `src/hooks/nativePorts.ts`, `modules/capture-engine/src/FakeCaptureEngine.ts`                                                                                                                                                    | `pnpm check`                                         |
| **C6** | 20–22 | Android glue I: the module scaffold and compile job, the SRT sink and endpoints, the streamer adapter                                              | `modules/capture-engine/{expo-module.config.json,android/build.gradle,android/src/**}`, `.github/workflows/android-compile.yml`                                                                                                                                     | `assembleDebug` green, local build installed         |
| **C7** | 23–25 | Android glue II: the watchers and HTTP, the foreground service, the preview view and its boundary                                                  | `modules/capture-engine/android/src/**`, `src/services/native/nativeSurfaces.tsx`, `src/ui/components/{StreamStage,PreviewBoundary}.tsx`, i18n                                                                                                                      | `assembleDebug`, `pnpm check`                        |
| **C8** | 26    | The device gate: a local release build, the owner's checklist, and the plan C results document                                                     | `docs/specs/2026-10-0x-s1-plan-c-results.md` (new)                                                                                                                                                                                                                  | the owner's ticks                                    |

**Sequencing.**

- C1 → C2 → C3 → C4 → C5, in one worktree. Each later batch compiles against the one before it.
- C6 may start once C4 has merged into the branch, because the glue implements `PlatformEvents` and calls `BridgeCore`.
- **The one parallel lane:** C5 and C6 may run at the same time in two worktrees. Their file sets are disjoint: C5 touches only `src/**` and `modules/capture-engine/src/FakeCaptureEngine.ts`, and C6 only `modules/capture-engine/android/**`, `modules/capture-engine/expo-module.config.json` and one new workflow. Confirm with `git diff --name-only` before merging. If either touched the other's set, merge sequentially and rerun both suites.
- C7 follows both C5 and C6. Task 25 edits `StreamStage.tsx` and the dictionaries, which C5 also edits.
- C8 is last.
- **No JS file may be edited while Metro serves a device check** (AGENTS §13).

## Plan decisions

The spec was silent, or a carry asked for a decision, on each of these points. **OWNER-VISIBLE** marks a decision the owner sees on screen. Those are built as stated and listed in the results for the owner's review, as plan A did.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CD1  | **Android only.** The spec makes iOS M3 (HaishinKit, P1, VoiceOver). `expo-module.config.json` lists `android` alone. On iOS, Expo Go and the web export, `requireOptionalNativeModule('CaptureEngine')` is null, so the composition root wires the absent engine (CD23). An arm there ends fatal-error at once, which is the spec §5 row "the native module missing". Android goes first for features and iOS first for lifecycle (AGENTS §9), and S1's lifecycle work is Android's foreground service, so nothing here waits on iOS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CD2  | **The Android library compiles the core's sources itself.** `sourceSets.main.java.srcDirs += 'core/src/main/kotlin'`. This **reverses plan B's decision 1** (`includeBuild`). An included build would need a line in the prebuilt `android/settings.gradle`, which is gitignored output, so it would need a config plugin, and its `kotlin("jvm")` plugin would meet AGP's in one composite. The same Kotlin 2.1.20 compiles both ways. The core's standalone build, wrapper and CI job are unchanged, and keep running every pure test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD3  | **The adapter logic is pure Kotlin, beside the core.** It lives in package `com.seazn.capture.engine.adapter` under `core/src/main/kotlin`, in the same Gradle build, so `kotlin-core` CI runs its tests on every push. The Android glue (`com.seazn.capture.engine`, under `modules/capture-engine/android/src/main/java`) turns Android facts into calls on these units and holds no rule. A glue class longer than about 150 lines is a sign a rule leaked into it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CD4  | **`org.json` on test classpaths only.** The core's `testImplementation` and the host subproject read the shared vector files with `org.json:json:20240303`. `main` stays dependency-free, as plan B ruled. On Android, `org.json` is the platform's own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD5  | **The session's name (carry 2).** `SessionConfig` gains `slot`, `descriptorUrl` and `descriptorJson`, each with a default so plan B's tests still compile. `SessionName(sid, slot, tokenTag, descriptorJson)` is derived from the config. `Phase.Ended` keeps the name of the session it ended, **including an arm refused straight to Ended**, and the snapshot carries `session`. `TokenTag` is FNV-1a 32-bit over UTF-16 code units, the same function as `src/domain/credentials/tokenTag.ts`, pinned by one vector file read on both sides. The descriptor travels to native as the opaque JSON of `descriptorToWire` and comes back unchanged. JS re-hydrates it with `parseDescriptor`, which rebuilds its `Date` fields (carry 4). Native never reads it.                                                                                                                                                                                                                                                                                                                                                  |
| CD6  | **One scrub, both sides (carry 11).** `modules/capture-engine/src/scrub/allow-list.json` is the source of record, decided key by key, with each key's reason in the file. The marker is **`***`** everywhere: JavaScript's `SCRUBBED` changes from `[scrubbed]`, and every JS test already uses the constant. A string survives only under an allow-listed key. A number, boolean or null passes under any key, as native already did; no secret is a number. Each class of key has one rule: **plain** keys pass a short plain word, or else the whole value is masked; **public-url** keys pass a public https URL with no query, fragment or userinfo and no held secret (the stream id is allowed), or else the whole value is masked; **text** keys mask each held secret in place, then mask the whole value if decoding what is left still reveals one; **never** keys are always masked. Native's URL keys change from in-place to whole-value masking, so four `SessionRecordTest` expectations change, as Task 3 lists. Both sides check their key sets against the file and run one shared vector file. |
| CD7  | **One record (carry 11, spec §5).** While a session exists (the snapshot is not `idle`), each JS log entry goes to the native record through `BridgeCore.log`, which posts it through the scheduler (carry 12). Native writes every line to an NDJSON file and echoes it up as an `onRecord` event. Otherwise, JS entries go to the JS ring. Diagnostics and Share read the JS ring, which holds both. **The line format is unified on native's flat shape**: `{"at","kind","level",…fields}`, where a field named `at`, `kind` or `level` is renamed `field_<key>`. JS's `toRecordLine` changes to it, and `test/fakePorts.ts`'s `readRecord` parses it back to `{event, level, fields}`, so no screen test changes.                                                                                                                                                                                                                                                                                                                                                                                              |
| CD8  | **The contract kit against the bridge (carry 1).** The kit's scenarios move to `modules/capture-engine/src/contract/engineScenarios.ts`, which imports no vitest. `test/engineContract.ts` wraps each scenario in an `it`, and `make` may now return a promise. The bridge runs them in vitest over a **JVM host process** (`core/host`): the real `Engine` and `BridgeCore` with a scripted platform, speaking NDJSON on stdin and stdout. Its `settle` waits for the next snapshot event or 700 ms, whichever comes first, because an ignored intent emits nothing and the tick is 500 ms. A `bridge` vitest project runs it, kept out of `pnpm test` so `check.yml` needs no JDK. The `kotlin-core` workflow runs it. The **device run** is a development-build button that runs the same scenarios against the real native engine and writes `probe.pass` or `probe.fail` lines into the record.                                                                                                                                                                                                               |
| CD9  | **The thread model (carry 15).** One `HandlerThread` named `capture-engine` backs `Scheduler`, wrapped in `GuardedScheduler`. The wrapper catches any `Throwable` at the task boundary, so the thread never dies, and hands it to `BridgeCore.failed`, which records it and classifies it (CD11). `Engine.start` is posted onto the thread. StreamPack's suspend calls run on the adapter's own coroutine scope, and their outcomes come back as inputs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD10 | **Deep sleep (carry 14).** A `PARTIAL_WAKE_LOCK` is held from the arm the machine accepts until `Command.End`. While it is held, `Handler.postDelayed` (`uptimeMillis`) and the clock (`elapsedRealtime`) cannot drift apart. Without a session the tick may pause in deep sleep, which is harmless. The lock is tagged `seazn:capture`, and its holding is a record line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CD11 | **Permanent failures are sticky (carry 18).** A failure is permanent when it is a `LinkageError` (`UnsatisfiedLinkError`, `NoClassDefFoundError`) or a `PermanentPlatformFailure`. The glue wraps a codec that cannot be configured, and a refused camera or microphone permission, in the latter. Once one is seen, `StickyFailure` answers every later `Connect`, `Rebuild.next` and `StartNewSession.next` with `PlatformFailed(thatAttemptId, message)` and executes none of them. **A failure before a session's first Connect** is reported at once with the attempt in hand (`Phase.attemptInHand`, made public), so an armed session ends fatal-error and still names its code. There is one `BridgeCore`, and so one `Engine`, per process.                                                                                                                                                                                                                                                                                                                                                               |
| CD12 | **Pollers (carries 16 and 19).** `AttemptPollers` runs one Frames reader every 500 ms and one Link reader every 1000 ms **per attempt**. A second `begin` for the same attempt changes nothing, and a new attempt cancels the old one's. They keep running through a camera switch, so the switch's LIVE bound stays at 3.5 s or less. They stop on a drop, `Disconnect`, `Rebuild`, `StartNewSession` and `End`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CD13 | **HTTP (carries 17 and 20, F-P5-13).** OkHttp is built with no cache, and every playlist fetch sends `Cache-Control: no-cache`. Heartbeat and descriptor requests send `no-store`. The timeouts are 8 s. **A 204 maps to `NoContent` before any test of success**, because OkHttp's `isSuccessful` is true for it. The descriptor answer always echoes its request id and calls the core's `DescriptorCheck.answered`. The User-Agent is OkHttp's default: P5 found U1-S6's 403 did not reproduce, and a 403 reads as no evidence, never as a stall (`withoutEvidence`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD14 | **Our own SRT sink (F-P5-11, F-P5-1, R3).** `SeaznSrtSink`, adapted from StreamPack 3.2.0's `SrtSink` under Apache-2.0 with attribution, composed with StreamPack's `TsMuxer` through `CompositeEndpointWithMetricsFactory`. It resolves the host first, off the scheduler thread, and reports `UnknownHostException` as `UNRESOLVED`. It sets `STREAMID`, `PASSPHRASE` and `LATENCY` as socket flags, so **no SRT URL string carrying a secret is ever built**. That makes carry 13's `URLEncoder` proposal moot for SRT. It sets `MAXBW` in bytes per second after connect and on every `SetMaxBw`, with `INPUTBW` 0 so libsrt never derives its own. It exposes its completion cause, so a drop is known at once and once.                                                                                                                                                                                                                                                                                                                                                                                      |
| CD15 | **RTMPS (F-P5-12, carry 13).** StreamPack's `RtmpEndpointFactory` gets an RTMP-only IO dispatcher: two threads whose uncaught-exception handler applies `TlsCloserGuard`. The spike's global handler is kept behind `TlsGuard.MODE`, and the device decides between them (Task 26). The publish URL is the code's `url` plus the stream key encoded with `URLEncoder` as defence in depth (carry 13), and the record masks that form too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CD16 | **The foreground service.** It is started when the machine accepts an arm, which is always in answer to an intent from the visible viewfinder. It is never started from a reconnect, a reopen or the background (research §4). It is `START_NOT_STICKY`, with types `camera\|microphone`, and stops at `Command.End`. `survivesBackground` is true from the service's start request at arm until that start fails or the session ends. It is optimistic so the keep-open caption never flashes at every arm (CD18), and a refused start sets it false at once. The notification reads `LIVE · 3000k · 47 min`, with the state word taken from the dictionaries' `stream.tally.*` in upper case, **in the phone's language**: native has no channel to the operator's pick, and the notification is OS chrome, as the crash screen is.                                                                                                                                                                                                                                                                              |
| CD17 | **OWNER-VISIBLE — stale snapshots (carry 8).** When the session is armed or on air and native has not reported for 3 s (six ticks), the status line reads "Engine not responding — check the phone", and the plate shows TROUBLE in orange instead of claiming READY or LIVE. Diagnostics shows "Last report … s ago". This is a display rule over `reportedAtMs` and the clock. It moves no session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CD18 | **OWNER-VISIBLE — keep-open advisory (carry 7).** While armed or on air with `survivesBackground` false, the top strip reads "Keep the app open — capture stops in the background". It outranks every other advisory. On Android it shows only if the foreground service failed to start. It is the iOS P1 warning's home for M3, driven by `selectSurvivesBackground` and never by a platform check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CD19 | **OWNER-VISIBLE — the viewfinder boundary (owner ruling 2).** `PreviewBoundary` wraps only the native preview. Its fallback is a stage caption, "Camera preview stopped — the session carries on", with a **Show preview** ghost button that remounts the preview. The column, its plate and the Stop hold are outside the boundary and stay. The crash is logged as `preview.crashed`. AGENTS §7's boundary around the overlay is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CD20 | **Shedding.** The platform computes `shed` from the thermal status: `moderate` is `overlay-preview`, `severe` is `preview-framerate`, and `critical` or worse is `encode`. In S1 only the overlay step acts, in JS, as plan A built it. The other two are reported and recorded but not acted on natively: lowering the preview's rate apart from the encoder's needs a second camera stream. This is deferred to the soak, with the reason recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CD21 | **OWNER-VISIBLE — permission refused.** Native asks for `CAMERA` and `RECORD_AUDIO` when it accepts an arm, through Expo's permissions manager, and asks for `POST_NOTIFICATIONS` on API 33+ without waiting on it. A refusal of camera or microphone is a permanent failure (CD11). The telemetry fact `permissionsRefused` is set, and the Ended block for fatal-error adds "Allow the camera and microphone for Seazn Capture in Android Settings, then try again". A refused notification permission blocks nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD22 | **The previous exit (F-P5-3).** At module creation, the glue reads `ApplicationExitInfo` (API 30+) and a session marker file. The marker is written at arm and deleted at End. When the marker is present, the record gains `previous-session-lost` with the exit reason's wire name, so "the app died mid-match" is evidence, not a guess. A user stop from Task Manager reads `user-requested`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CD23 | **The absent engine.** With no native module, `createAbsentCaptureEngine` reports idle, answers an arm with `ended{fatal-error}` naming that session, and answers a reset of that with idle. It ignores everything else. This is the one TypeScript engine with a rule of its own, and it holds no session to disagree about. It is exempt from the contract kit, and pinned by its own tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CD24 | **Development switches.** `EXPO_PUBLIC_FAKE_ENGINE=1` keeps the fake in a `__DEV__` build, for UI work on a device. Without it, a dev build runs the native engine with `devEngine: null`. `EXPO_PUBLIC_FAKE_PLAYBACK_URL` (dev only) puts a real staging live input's **public** playback URL into the fake descriptor, so phase 4's delivery watch has a manifest to poll. Neither is readable in a release build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CD25 | **The Android compile job.** `.github/workflows/android-compile.yml` runs on PRs touching `modules/**`, `app.json`, `plugins/**` or `pnpm-lock.yaml` (spec §6), on temurin 17 with the Android SDK the runner image carries. It runs prebuild then `./gradlew assembleDebug`. Gradle, not EAS. It is **not** a required check, because a path-filtered workflow never reports on a PR it skips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CD26 | **A stop native never answers (carry 27).** Native answers every stop within one tick (Task 12 pins that). The JS clearing is bounded anyway: `useDisarm` gives up after 5 s, logs `disarm.gave-up`, and frees the engine for the next caller. Covering a native that never answers is cheap, and a lock on every caller is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CD27 | **StreamPack use.** One `SingleStreamer` per armed session, built at the accepted arm and released at `End` (reconnects reuse it), with our own `IEndpointInternal.Factory` (CD14, CD15), which routes SRT to `TsMuxer` plus our sink and RTMPS to `RtmpEndpointFactory`. `defaultRotation` is passed explicitly at arm, from the landscape side held (P4). **`setTargetRotation` is never called** (F-P5-6; enforced by `GlueRulesTest`). `KEY_MAX_B_FRAMES = 0` is set on API 29+ through `customize`. The encode is 720p30 with a 2 s GOP, starting at 1500k, and AAC-LC 128k at 48 kHz stereo. The preview is `PreviewView` in FIT, with pinch-zoom and tap-to-focus off.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CD28 | **The audio level.** An `IConsumerAudioEffect` on `audioInput.processor` hands each PCM frame to `PcmPeak`. `PeakMeter` keeps the highest peak between snapshots, and each snapshot takes it. Nothing is normalised (AGENTS §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CD29 | **`switchCamera` (carry 10).** It is mapped through to `Input.SwitchCamera`, and the glue swaps to the camera facing the other way. S1 has no control for it. It is reserved, not a defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Carry traceability

Every item of `docs/specs/2026-09-30-s1-plan-a-results.md` § _Carried to plan C_. **26 are fully mapped here, and 2 are partly deferred to plan D**, with the reason given.

| Carry | Subject                                                                                               | Where                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Replace the fake; run the contract kit (real settle, 500 ms tick, native state at construction)       | Tasks 12, 15, 16, 19; CD8                                                                                                                                                                                                                         |
| 2     | sid, slot and tokenTag in the snapshot; refused arm still named; cross-language FNV-1a with non-ASCII | Tasks 2, 5, 14; CD5                                                                                                                                                                                                                               |
| 3     | Map `Snapshot.camera`; a null camera keeps Go live off                                                | Task 5 (wire vectors), Task 14 (JS mapping test)                                                                                                                                                                                                  |
| 4     | Re-hydrate the descriptor with its Dates                                                              | Task 14; CD5                                                                                                                                                                                                                                      |
| 5     | Platform telemetry, `reasons.first()`, null rates stay null                                           | Tasks 5, 9, 14, 22, 23                                                                                                                                                                                                                            |
| 6     | Pin `ConnectFailure` and `HeartbeatResult` wires and the snapshot shape (no `shed` in the state)      | Task 5 (vocabulary in the vectors file), Task 14                                                                                                                                                                                                  |
| 7     | `survivesBackground` drives the P1 warning                                                            | Task 18 (CD18), Task 24 (native fact)                                                                                                                                                                                                             |
| 8     | Stale snapshots                                                                                       | Task 18 (CD17)                                                                                                                                                                                                                                    |
| 9     | The native preview replaces the empty stage                                                           | Task 25                                                                                                                                                                                                                                           |
| 10    | `switchCamera` reserved                                                                               | Task 4; CD29                                                                                                                                                                                                                                      |
| 11    | One record, one allow-list, drift tests both sides, mask marker, one vector                           | Task 3, Task 15; CD6, CD7                                                                                                                                                                                                                         |
| 12    | Logger feed posted through the Scheduler; `reentrantDropped` beside `sinkFailures`                    | Task 12 (`log` posts through `Engine.log`), Task 18 (Diagnostics rows)                                                                                                                                                                            |
| 13    | The SRT URL built with `URLEncoder`                                                                   | CD14 (no SRT URL string exists), CD15 (RTMPS key encoded), Tasks 21–22                                                                                                                                                                            |
| 14    | Deep sleep: wake lock or documented lateness                                                          | Task 24; CD10                                                                                                                                                                                                                                     |
| 15    | Report any `Throwable` at the task boundary; start and stop on the scheduler                          | Tasks 6, 12, 20; CD9                                                                                                                                                                                                                              |
| 16    | One poller per link, or a minimum interval                                                            | Task 7; CD12                                                                                                                                                                                                                                      |
| 17    | Descriptor adapter: echo the id; call the pure rule                                                   | Task 8; CD13                                                                                                                                                                                                                                      |
| 18    | Sticky permanent failures; one Engine per process; failure before first Connect                       | Tasks 6, 12; CD11                                                                                                                                                                                                                                 |
| 19    | Frames every 500 ms through a switch                                                                  | Task 7; CD12                                                                                                                                                                                                                                      |
| 20    | 204 → NoContent; no-cache; staging hint and window                                                    | Task 8, Task 23. **Partly deferred to plan D:** "hint 0.1 returns one variant" and "Cloudflare's listed window" need the real stg fixture and descriptor (spec phase 5). Task 26 records the playlist evidence on the raw input, where it exists. |
| 21    | RR-12 table test; RR-13 KDoc                                                                          | Task 1                                                                                                                                                                                                                                            |
| 22    | Mic at a call: order of events; audio at hang-up                                                      | Task 26 (device checklist, owner's hands)                                                                                                                                                                                                         |
| 23    | API 24–28: no silencing signal; the 25 s reset against a link collapsing every 25–30 s                | Task 10 (never reports below 29), Task 26 (device)                                                                                                                                                                                                |
| 24    | A taken camera with no slate frames; the camera-switch time                                           | Task 26 (device)                                                                                                                                                                                                                                  |
| 25    | An uplink drop after the 3 s stall window never counts toward fallback                                | Task 26 (device: read the record for the order)                                                                                                                                                                                                   |
| 26    | The 20 s-per-60 s lag rule                                                                            | **Deferred to plan D:** it is measured at the staging match that the spec's exit bar requires. Task 26 keeps the device runs' records, whose delivery lines carry the lag, so evidence is collected from the first run.                           |
| 27    | A stop native never answers                                                                           | Task 12 (native answers within a tick), Task 16 (kit scenario), Task 17 (JS bound); CD26                                                                                                                                                          |
| 28    | Forget, then a re-scan of the same code, while native holds the stop                                  | Task 16 (kit scenario: a stop then an arm, unsettled, is ordered)                                                                                                                                                                                 |

## P5 findings, as named failing tests

The spec maps these to `platform/`. Each one enters as a named failing test before its code exists.

| Finding  | Named test                                                                                                          | Task |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| F-P5-1   | `F-P5-1 a host that does not resolve is reported as unresolved, never as bad parameters`                            | 11   |
| F-P5-3   | `F-P5-3 a session lost with the process is recorded with the exit reason`                                           | 9    |
| F-P5-4   | `F-P5-4 only encoded frames that reached the endpoint count, video apart from audio`                                | 9    |
| F-P5-6   | `F-P5-6 no glue code calls setTargetRotation` and `F-P5-6 the encoded rotation is fixed at arm from the side held`  | 11   |
| F-P5-8   | `F-P5-8 a call silences our recording only, matched by session id`                                                  | 10   |
| F-P5-9   | `F-P5-9 another app opening another camera while we hold ours is contention`                                        | 10   |
| F-P5-10  | `F-P5-10 the last camera released while contended is a release, and our own reopen is not another app`              | 10   |
| F-P5-11  | `F-P5-11 MAXBW is set in bytes per second, and a target change reaches the socket`                                  | 11   |
| F-P5-12  | `F-P5-12 the TLS closer's IOException off the main thread is swallowed, and nothing else is`                        | 11   |
| F-P5-13  | `F-P5-13 every playlist fetch is fresh` and `carry 20 a 204 maps to NoContent although OkHttp counts it successful` | 8    |
| R3       | `R3 one drop per attempt, from the sink's completion, however often it is reported`                                 | 11   |
| B-frames | `P5 B-frames are off on API 29 and above, and not asked for below`                                                  | 11   |

## Device-only claims

No test in this plan can prove the following. Each is on the owner's checklist in Task 26:

- the preview, its framing against the encoded stream (#288), FIT letterboxing and both landscape sides (P4's three assertions);
- B-frames off on two SoCs, by `ffprobe` `has_b_frames=0`;
- `MAXBW` pacing on a thin link (F-P5-11's 1.5 Mbit/s cell), and what a paced `send` does to the encoder (#302);
- srtdroid 1.10.1 publishing to Cloudflare for at least 10 minutes with a reconnect;
- the TLS guard: at least 10 RTMPS cuts against Cloudflare with no crash, and a mutation run where the crash returns;
- the foreground service's start points on Android 14 and 16: no `SecurityException`, and the notification text;
- the wake lock across a 5-minute screen lock;
- mic silencing at a real call; camera contention from a second app; the slate on air; the reopen;
- the charge-counter drain on a second OEM; thermal readings;
- memory after 20 forced reconnects (#306);
- a `PreviewView` resize while live causing no encoded-frame gap (research, Open 11);
- what the operator sees: every colour, plate, line and the boundary's fallback.

## File map

`K` is `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine`, `T` the same under `src/test`, and `G` is `modules/capture-engine/android/src/main/java/com/seazn/capture/engine`.

| Path                                                                                                                                                                                                                                                                                            | Responsibility                                                                                                                    | Task |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `T/core/EndPathsTest.kt`                                                                                                                                                                                                                                                                        | RR-12: every end path keeps the duration and the network fact                                                                     | 1    |
| `K/core/TokenTag.kt`, `SessionConfig.kt`, `Phase.kt`, `Snapshot.kt`, `Projection.kt`, `SessionMachine.kt`                                                                                                                                                                                       | The session's name                                                                                                                | 2    |
| `modules/capture-engine/src/wire/token-tag-vectors.json`                                                                                                                                                                                                                                        | The FNV-1a vectors both sides read                                                                                                | 2    |
| `modules/capture-engine/src/scrub/{allow-list,vectors}.json`                                                                                                                                                                                                                                    | The shared scrub, and its cross-language vectors                                                                                  | 3    |
| `K/core/SessionRecord.kt`, `src/services/scrub.ts`, `src/services/sessionRecord.ts`                                                                                                                                                                                                             | The scrub reconciled; the flat line format                                                                                        | 3    |
| `K/adapter/ArmMapping.kt`, `IntentMapping.kt`                                                                                                                                                                                                                                                   | Bridge maps → `SessionConfig`, `Input`                                                                                            | 4    |
| `K/adapter/PlatformFacts.kt`, `SnapshotWire.kt`; `modules/capture-engine/src/wire/snapshot-vectors.json`                                                                                                                                                                                        | Snapshot → the wire map; the shared vectors                                                                                       | 5    |
| `K/adapter/GuardedScheduler.kt`, `Failures.kt`                                                                                                                                                                                                                                                  | The task boundary; permanent and sticky failures                                                                                  | 6    |
| `K/adapter/AttemptPollers.kt`                                                                                                                                                                                                                                                                   | Frames every 500 ms and Link every 1000 ms, one per attempt                                                                       | 7    |
| `K/adapter/Http.kt`                                                                                                                                                                                                                                                                             | Request specs and answer mapping                                                                                                  | 8    |
| `K/adapter/DeviceReadings.kt`, `PreviousExit.kt`, `FrameTally.kt`                                                                                                                                                                                                                               | PCM peak, drain, thermal, shed, capture time, exit reasons, frame counting                                                        | 9    |
| `K/adapter/MicSilenceWatch.kt`, `CameraAvailability.kt`, `NotificationText.kt`                                                                                                                                                                                                                  | The watch logic and the notification copy                                                                                         | 10   |
| `K/adapter/SrtOptions.kt`, `TlsCloserGuard.kt`, `AttemptSignals.kt`, `EncoderKeys.kt`; `T/adapter/GlueRulesTest.kt`                                                                                                                                                                             | SRT socket options and the host resolution; the TLS guard; one drop per attempt; B-frames and rotation; source rules for the glue | 11   |
| `K/adapter/BridgeCore.kt`                                                                                                                                                                                                                                                                       | The engine host every platform uses                                                                                               | 12   |
| `modules/capture-engine/android/core/host/**`                                                                                                                                                                                                                                                   | The JVM host process for the contract kit                                                                                         | 13   |
| `modules/capture-engine/src/snapshotWire.ts`, `armWire.ts`                                                                                                                                                                                                                                      | Wire ↔ `EngineSnapshot`; arm intent → wire                                                                                        | 14   |
| `modules/capture-engine/src/{nativeModule,nativeCaptureEngine,absentCaptureEngine}.ts`                                                                                                                                                                                                          | The JS bridge and the absent engine                                                                                               | 15   |
| `src/services/sessionRecord.ts` (`createRoutedRecord`)                                                                                                                                                                                                                                          | The record routed by session                                                                                                      | 15   |
| `modules/capture-engine/src/contract/engineScenarios.ts`, `test/engineContract.ts`, `test/hostEngine.ts`, `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts`                                                                                                                       | The contract kit, its host harness and its run                                                                                    | 16   |
| `src/hooks/useDisarm.ts`                                                                                                                                                                                                                                                                        | The 5 s bound                                                                                                                     | 17   |
| `src/hooks/engineSilence.ts`, `advisory.ts`, `preflight.ts`, `useViewfinder.ts`, `diagnostics.ts`, `src/ui/components/EndedBlock.tsx`, i18n                                                                                                                                                     | Silence, keep-open, permission line, record counters                                                                              | 18   |
| `src/hooks/nativePorts.ts`, `src/hooks/useEngineProbe.ts`, `src/ui/components/DevScenes.tsx`                                                                                                                                                                                                    | The composition root; the device probe                                                                                            | 19   |
| `modules/capture-engine/expo-module.config.json`, `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `G/{CaptureEngineModule,EngineHost,HandlerScheduler,AndroidClock,RecordFile,AndroidPlatform,HttpAdapter}.kt`, `G/capture/Capture.kt`; `.github/workflows/android-compile.yml` | The module scaffold                                                                                                               | 20   |
| `G/srt/SeaznSrtSink.kt`, `G/endpoints/{CaptureEndpointFactory,CountingEndpoint,RtmpDispatcher,TlsGuard}.kt`                                                                                                                                                                                     | Endpoints                                                                                                                         | 21   |
| `G/StreamerAdapter.kt`, `G/SlateSource.kt`, `G/AudioLevelEffect.kt`                                                                                                                                                                                                                             | Capture, encode, publish                                                                                                          | 22   |
| `G/watch/{CameraWatch,MicWatch,NetworkWatch,DeviceSampler}.kt`                                                                                                                                                                                                                                  | Android facts → inputs                                                                                                            | 23   |
| `G/CaptureForegroundService.kt`, `G/SessionKeeper.kt`, `G/Permissions.kt`, `G/ExitReader.kt`                                                                                                                                                                                                    | The foreground service, the wake lock, the permissions, the previous exit                                                         | 24   |
| `G/CapturePreviewView.kt`, `src/services/native/nativeSurfaces.tsx`, `src/ui/components/PreviewBoundary.tsx`, `StreamStage.tsx`                                                                                                                                                                 | The preview and its boundary                                                                                                      | 25   |
| `docs/specs/2026-10-0x-s1-plan-c-results.md`                                                                                                                                                                                                                                                    | The results and the owner's checklist                                                                                             | 26   |

---

## Batch C1 — core carries

Set `WT` to the worktree once per shell call: `export WT=<absolute worktree path>`. The core's suite: `cd "$WT/modules/capture-engine/android/core" && ./gradlew test --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"`, then the count command from Global Constraints.

### Task 1: RR-12's end-path table, RR-13's KDoc, and the owner's rulings recorded

Carry 21. Plan B's re-review found that one mutant survived: a `STOPPED_BY_ORGANISER` end built with a bogus `Now`. No test covered every way a session ends at once. RR-13 found that `Engine.log`'s KDoc implied the call time is stamped.

**Files:**

- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/EndPathsTest.kt`
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Engine.kt` (the KDoc of `log` only)
- Modify: `docs/specs/2026-09-30-s1-plan-a-results.md` (the "Also visible, not yet ruled" block)

**Interfaces:** Consumes `MachineRig` and `Configs`. Produces nothing new.

- [ ] **Step 1: Write the table test.** Each row drives a live session to one end and asserts the ended phase whole, so a wrong `Now`, a lost network fact or a lost duration all fail. Every expected duration is worked by hand in the row's comment. `live()` goes live at mono 1 000 (its first advancing frame), and the wall clock moves with mono.

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * Carry 21 (plan B re-review RR-12): every way a session ends keeps how long it was live and the
 * last network fact. One table, so a path that builds its end from a wrong `Now` cannot hide.
 */
class EndPathsTest {
  private class Path(val name: String, val reason: EndReason, val durationMs: Long?, val drive: (MachineRig) -> Unit)

  private val sevenSecondHolds = Configs.valid(holdWindowSeconds = mapOf(Transport.SRT to 7, Transport.RTMPS to 7))

  private val paths =
    listOf(
      // Live at 1 000, stopped at 3 000: 2 000 ms.
      Path("the operator's stop", EndReason.OPERATOR_STOPPED, 2_000) { rig ->
        rig.advance(2_000)
        rig.send(Input.Stop)
      },
      // Live at 1 000; dropped and told over at 3 000: 2 000 ms.
      Path("the descriptor says over", EndReason.STOPPED_BY_ORGANISER, 2_000) { rig ->
        rig.advance(2_000)
        rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
        val asked = rig.sent<Command.FetchDescriptor>().last().requestId
        rig.send(Input.DescriptorChecked(asked, DescriptorCheck.Over("stopped")))
      },
      // Live at 1 000; a 410 to the beat in flight at 3 000: 2 000 ms. This is RR-12's surviving mutant.
      Path("the heartbeat says over", EndReason.STOPPED_BY_ORGANISER, 2_000) { rig ->
        rig.advance(2_000)
        val beat = rig.sent<Command.PostHeartbeat>().last().beatId
        rig.send(Input.HeartbeatAnswered(beat, HeartbeatResponse.Answered(410, null, "stopped")))
      },
      // Live at 1 000, dropped at once; the 7 s hold runs out at 8 000: 7 000 ms.
      Path("the hold runs out", EndReason.HOLD_WINDOW_EXPIRED, 7_000) { rig ->
        rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
        rig.advance(7_000, feeding = false)
      },
      // Live at 1 000; the platform's permanent failure at 3 000: 2 000 ms.
      Path("a permanent platform failure", EndReason.FATAL_ERROR, 2_000) { rig ->
        rig.advance(2_000)
        rig.send(Input.PlatformFailed(1, "codec gone"))
      },
    )

  @Test
  fun `carry 21 every end path keeps the duration and the network fact`() {
    for (path in paths) {
      val rig = MachineRig(if (path.reason == EndReason.HOLD_WINDOW_EXPIRED) sevenSecondHolds else Configs.valid()).live()
      path.drive(rig)
      val ended = assertIs<Phase.Ended>(rig.phase, path.name)
      assertEquals(path.reason, ended.reason, path.name)
      assertEquals(path.durationMs, ended.durationMs, path.name)
      assertEquals(true, ended.networkValidated, path.name)
    }
  }

  @Test
  fun `carry 21 an arm refused straight to ended keeps the network fact and has no duration`() {
    val rig = MachineRig(Configs.valid(holdWindowSeconds = emptyMap()))
    rig.send(Input.Network(validated = true))
    rig.send(Input.Arm(rig.config))
    val ended = assertIs<Phase.Ended>(rig.phase)
    assertEquals(EndReason.FATAL_ERROR, ended.reason)
    assertEquals(null, ended.durationMs)
    assertEquals(true, ended.networkValidated)
  }
}
```

- [ ] **Step 2: Run it.** Expected: green. These paths already work, and the table is the coverage RR-12 asked for. If the heartbeat row finds no `PostHeartbeat`, the first beat was not sent before 3 000. Read `HeartbeatState.nextDueAtMs` (it is due at arm), and fix the row's drive, not the machine.

- [ ] **Step 3: Mutate the guard RR-12 found.** `cp SessionMachine.kt "$TMPDIR/sm.bak"`. In `Heartbeats.answered`'s call to `SessionMachine.end`, pass `Now(0, 0)` in place of `now`. Run the suite: the heartbeat row must fail on its duration. Restore with `cp "$TMPDIR/sm.bak" SessionMachine.kt`. Repeat for the descriptor's `end` call. Record both mutations in the commit body.

- [ ] **Step 4: Fix RR-13's KDoc.** Replace the KDoc above `Engine.log` with:

```kotlin
  /**
   * Appends [entry] to the record, posted through the scheduler like every input, so the record has
   * one writer (carry 12). The line is stamped when the scheduler runs it, not when [log] was called:
   * a line logged just before an input that is already queued is written, and timed, after it.
   */
```

- [ ] **Step 5: Record the owner's rulings of 2026-10-01** in `docs/specs/2026-09-30-s1-plan-a-results.md`. Change the heading "**Also visible, not yet ruled by the owner:**" to "**Also visible — ruled by the owner on 2026-10-01 unless marked:**". Then rewrite the three bullets:

```markdown
- **The M4 crash screen's copy — approved as built** (owner, 2026-10-01):
  "Something broke" / "The broadcast may still be live. Try again to get
  back to Stop.", with a Try again button.
- **The language of the crash screen — not yet ruled.** It sits outside the
  language provider, so it reads in the phone's language, not the
  operator's pick.
- **A boundary for the viewfinder alone — decided** (owner, 2026-10-01): plan
  C builds one around the native preview only, so a preview crash keeps the
  HUD column and Stop without a full restart (plan C, CD19 and Task 25).
```

- [ ] **Step 6: Verify and commit.** Run the core suite (EXIT=0; count 452 + 2). Run `pnpm prettier --check docs/specs/2026-09-30-s1-plan-a-results.md`. Then commit:

```bash
cd "$WT" && git add modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/EndPathsTest.kt modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Engine.kt docs/specs/2026-09-30-s1-plan-a-results.md && git commit -F - <<'EOF'
test(core): every end path keeps its duration and network fact (RR-12)

Carry 21. Mutations: a bogus Now in the heartbeat's and the descriptor's
end both fail the table. RR-13: Engine.log's KDoc says the line is stamped
when it runs. Records the owner's two rulings of 2026-10-01.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
EOF
```

### Task 2: The session's name, and one token tag in two languages

Carry 2 and CD5. Today native's snapshot cannot say which session it holds. Plan A's fake reports `slot` and `tokenTag` from the arm, and the reopen and replace rules (N2, N3) read them. An arm refused straight to Ended must still name its session, or Home's Continue and the orphan rule lose it.

**Files:**

- Create: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/TokenTag.kt`
- Create: `modules/capture-engine/src/wire/token-tag-vectors.json`
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/TokenTagTest.kt`, `SessionNameTest.kt`
- Create: `modules/capture-engine/src/tokenTagVectors.test.ts`
- Modify: `core/.../SessionConfig.kt`, `Phase.kt`, `Snapshot.kt`, `Projection.kt`, `SessionMachine.kt` (the arm-refused path)
- Modify: `modules/capture-engine/android/core/build.gradle.kts` (`org.json` for tests; the vector directory as a system property)

**Interfaces:**

- Consumes `src/domain/credentials/tokenTag.ts`.
- Produces:
  - `TokenTag.of(token: String): String`;
  - `data class SessionName(val sid: String, val slot: Int, val tokenTag: String, val descriptorJson: String)`;
  - `SessionConfig.slot: Int`, `.descriptorUrl: String`, `.descriptorJson: String` and `.name: SessionName`;
  - `Phase.Ended.name: SessionName?`;
  - `Snapshot.session: SessionName?`.

- [ ] **Step 1: The vector file.** Every value was computed in Node with `tokenTag` and checked independently with a Python FNV-1a over UTF-16 code units:

```json
{
  "about": "FNV-1a 32-bit over UTF-16 code units, eight lowercase hex digits. Read by tokenTag.ts's test and by TokenTag.kt's. Change only with both.",
  "vectors": [
    { "token": "", "tag": "811c9dc5" },
    { "token": "a", "tag": "e40c292c" },
    { "token": "foobar", "tag": "bf9cf968" },
    { "token": "cfx", "tag": "0076912c" },
    { "token": "tok-9f3c2a7e5b1d4680", "tag": "c980ff38" },
    { "token": "fake-token-b0000000000000000000", "tag": "2cc4e08d" },
    { "token": "tök-ñ-日本", "tag": "fca8f070" },
    { "token": "🏏-tok", "tag": "a44d061f" }
  ]
}
```

- [ ] **Step 2: Tell the core's tests where the shared files are.** In `build.gradle.kts`:

```kotlin
dependencies {
  testImplementation(kotlin("test"))
  // Reads the vector files shared with the JS side (CD4). Tests only: `main` stays dependency-free.
  testImplementation("org.json:json:20240303")
}

tasks.test {
  useJUnitPlatform()
  // The vector files both languages read (CD5, CD6), relative to this build.
  systemProperty("capture.shared", layout.projectDirectory.dir("../../src").asFile.absolutePath)
  testLogging {
    events("failed")
    exceptionFormat = TestExceptionFormat.FULL
  }
}
```

Add a test helper, `src/test/kotlin/com/seazn/capture/engine/core/Shared.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.io.File
import org.json.JSONObject

/** A vector file shared with the JS side, under `modules/capture-engine/src/`. */
object Shared {
  fun read(path: String): JSONObject {
    val root = System.getProperty("capture.shared") ?: error("capture.shared is not set: run through Gradle")
    return JSONObject(File(root, path).readText(Charsets.UTF_8))
  }
}
```

- [ ] **Step 3: Write the failing Kotlin tests.**

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

class TokenTagTest {
  @Test
  fun `carry 2 the token tag matches the JS one on every shared vector, non-ASCII included`() {
    val vectors = Shared.read("wire/token-tag-vectors.json").getJSONArray("vectors")
    for (i in 0 until vectors.length()) {
      val row = vectors.getJSONObject(i)
      assertEquals(row.getString("tag"), TokenTag.of(row.getString("token")), row.getString("token"))
    }
  }
}
```

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionNameTest {
  private val named = Configs.valid(slot = 2, descriptorJson = """{"sid":"sess_42"}""")

  @Test
  fun `carry 2 an armed session is named by sid, slot and the token's tag, never the token`() {
    val rig = MachineRig(named).armed()
    assertEquals(SessionName("sess_42", 2, "c980ff38", """{"sid":"sess_42"}"""), rig.snapshot.session)
  }

  @Test
  fun `carry 2 an ended session still names the session it ended`() {
    val rig = MachineRig(named).live()
    rig.send(Input.Stop)
    assertEquals("sess_42", rig.snapshot.session?.sid)
  }

  @Test
  fun `carry 2 an arm refused straight to ended is named from that arm`() {
    val refused = Configs.valid(slot = 2, holdWindowSeconds = emptyMap())
    val rig = MachineRig(refused)
    rig.send(Input.Arm(refused))
    assertEquals(SessionName("sess_42", 2, "c980ff38", "{}"), rig.snapshot.session)
  }

  @Test
  fun `idle names no session, before an arm and after a reset`() {
    val rig = MachineRig(named)
    assertNull(rig.snapshot.session)
    rig.armed()
    rig.send(Input.Stop)
    rig.send(Input.Reset)
    assertNull(rig.snapshot.session)
  }

  @Test
  fun `a slot below 1 and a descriptor URL that is not https are problems`() {
    val problems = Configs.valid(slot = 0, descriptorUrl = "http://stg.seazn.club/x").problems()
    assertEquals(listOf("slot is below 1", "descriptorUrl is not https"), problems)
  }
}
```

Extend `Configs.valid` with `slot: Int = 1`, `descriptorUrl: String = "https://stg.seazn.club/api/capture/sessions/sess_42"` and `descriptorJson: String = "{}"`, passed by name.

- [ ] **Step 4: Run them.** Expected: they fail to compile (`TokenTag`, `SessionName` and the new parameters do not exist).

- [ ] **Step 5: Implement.**

`TokenTag.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * Which issue of a code a session was armed with, without the token (plan A's N2). FNV-1a 32-bit
 * over the token's UTF-16 code units, as eight lowercase hex digits: the same function as
 * `src/domain/credentials/tokenTag.ts`, pinned by `modules/capture-engine/src/wire/token-tag-vectors.json`.
 */
object TokenTag {
  private const val OFFSET = 0x811c9dc5L
  private const val PRIME = 0x01000193

  fun of(token: String): String {
    var hash = OFFSET.toInt()
    for (unit in token) {
      hash = hash xor unit.code
      hash *= PRIME
    }
    return (hash.toLong() and 0xffff_ffffL).toString(16).padStart(8, '0')
  }
}
```

In `SessionConfig.kt`, add after `SessionConfig`:

```kotlin
/**
 * What names a session to the JS side (carry 2): enough to tell this session from another, and
 * never the token. [descriptorJson] is opaque here: JS sent it at arm and re-reads it (CD5).
 */
data class SessionName(val sid: String, val slot: Int, val tokenTag: String, val descriptorJson: String)
```

Add three constructor parameters at the end, with defaults (Kotlin's positional callers in plan B's tests pass eight arguments, which still bind):

```kotlin
  val appVersion: String,
  /** The camera's slot on the match (plan A's D7); 1 when the code has none. */
  val slot: Int = 1,
  /** Where the descriptor is re-fetched (spec §2); blank in tests that never fetch it. */
  val descriptorUrl: String = "",
  /** The descriptor as JS parsed it, as JSON; echoed in the snapshot, never read here. */
  val descriptorJson: String = "{}",
) {
  val name: SessionName
    get() = SessionName(sid, slot, TokenTag.of(token), descriptorJson)
```

In `problems()`, after the heartbeat check:

```kotlin
    if (slot < 1) add("slot is below 1")
    if (descriptorUrl.isNotBlank() && !descriptorUrl.startsWith("https://")) add("descriptorUrl is not https")
```

In `Phase.kt`, give `Ended` its name, last and defaulted, so plan B's positional constructions still compile:

```kotlin
  data class Ended(
    val reason: EndReason,
    val ids: Ids,
    val durationMs: Long?,
    val networkValidated: Boolean,
    /** The session that ended, so the snapshot still names it (carry 2); null only for a phase that never had one. */
    val name: SessionName? = null,
  ) : Phase {
```

and in `Phase.ended`:

```kotlin
  return Phase.Ended(reason, ids, durationMs, networkValidated, session?.config?.name)
```

In `SessionMachine.arm`'s refused branch:

```kotlin
      return Step(phase.ended(EndReason.FATAL_ERROR, now).copy(name = config.name), listOf(refused, Command.End(EndReason.FATAL_ERROR)))
```

In `Snapshot.kt`, add last, defaulted:

```kotlin
  /** Which session this is about (carry 2): from the session held, or the one that ended. */
  val session: SessionName? = null,
```

In `Projection.snapshot`:

```kotlin
      session = session?.config?.name ?: (phase as? Phase.Ended)?.name,
```

- [ ] **Step 6: Run the core suite.** Expected: green, except `EngineTest` line 147 and `SessionMachineLifecycleTest` line 773 if they compare an `Ended` built without a name against one that now has one. Update only those expectations, adding `name = Configs.valid().name` where a session existed. Never change the machine to fit an old expectation.

- [ ] **Step 7: The JS side reads the same file.** `modules/capture-engine/src/tokenTagVectors.test.ts`: the engine may import the domain, and the domain must not import a file under `modules/`, so the test lives here.

```ts
import { describe, expect, it } from 'vitest';
import { tokenTag } from '@/domain/credentials/tokenTag';
import vectors from './wire/token-tag-vectors.json';

describe('carry 2: one token tag in two languages', () => {
  it.each(vectors.vectors.map((row) => [row.token, row.tag] as const))(
    'tags %j as %s, as TokenTag.kt does',
    (token, tag) => {
      expect(tokenTag(token)).toBe(tag);
    },
  );
});
```

- [ ] **Step 8: Mutate.** Mutate one thing at a time, from a `cp` backup, and confirm a test fails each time:
  1. In `TokenTag.of`, change `unit.code` to `unit.code and 0xff`. The non-ASCII rows fail.
  2. Drop `.copy(name = config.name)`. The refused-arm test fails.
  3. In `Phase.ended`, pass `null`. The ended test fails.

- [ ] **Step 9: Verify and commit.** The core suite: EXIT=0, and the count rises by the number of new tests. Run `pnpm check`: EXIT=0, with `numTotalTests` rising by 8. Then commit:

```bash
cd "$WT" && git add modules/capture-engine/android/core modules/capture-engine/src/wire/token-tag-vectors.json modules/capture-engine/src/tokenTagVectors.test.ts && git commit -F - <<'EOF'
feat(core): the snapshot names its session, refused arms included

Carry 2. SessionName(sid, slot, tokenTag, descriptorJson) from the
config; Ended keeps it. TokenTag is FNV-1a over UTF-16 units, pinned by
one vector file both languages read, non-ASCII included.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
EOF
```

`git add modules/capture-engine/android/core` stages only that directory, and `build/` is gitignored there. Check `git status --short` before committing.

### Task 3: One scrub and one line format, on both sides

Carry 11, CD6 and CD7. Today the two scrubs disagree on the following, and one record will hold both sides' lines:

- the marker (`***` against `[scrubbed]`);
- whole-value against in-place masking;
- numbers under unknown keys;
- the key lists;
- the line's shape.

**Files:**

- Create: `modules/capture-engine/src/scrub/allow-list.json`, `modules/capture-engine/src/scrub/vectors.json`
- Create: `core/src/test/kotlin/com/seazn/capture/engine/core/ScrubParityTest.kt`, `src/services/scrubParity.test.ts`
- Modify: `core/.../SessionRecord.kt`, `core/.../Engine.kt` (none, if `RecordEntry` gains its level with a default), `core/src/test/.../SessionRecordTest.kt` (four expectations, listed in Step 6)
- Modify: `src/services/scrub.ts`, `src/services/sessionRecord.ts`, `test/fakePorts.ts` (`readRecord`)
- Modify: the JS tests that parse a line themselves, which change to the new `parseRecordLine`: `src/services/{sessionRecord,logger,kvTimeout,overlayGuard,streamSettingsStore}.test.ts` and `src/services/native/nativeSurfaces.test.tsx`

**Interfaces:**

- Produces, in Kotlin:
  - `RecordEntry(kind, fields, level = "info")`;
  - the class sets `SessionRecord.PLAIN_KEYS`, `PUBLIC_URL_KEYS`, `TEXT_KEYS`, `NEVER` and `RESERVED_KEYS`, with `MASK = "***"`.
- Produces, in JS:
  - `SCRUBBED === '***'`;
  - the sets `PLAIN_KEYS`, `PUBLIC_URL_KEYS`, `TEXT_KEYS` and `NEVER_KEYS`, exported for the drift test;
  - `toRecordLine(entry)`, which writes `{"at","kind","level",…fields}`;
  - `parseRecordLine(line): RecordedEntry`, which reads back `{ atMs, level, event, fields }`.

- [ ] **Step 1: The allow-list file**, decided key by key. The union of both lists is shown, with each key's reason:

```json
{
  "about": "The record's allow-list (CD6). SessionRecord.kt and scrub.ts each keep their sets as code and test them against this file. Add a key here and on both sides, with its reason.",
  "mask": "***",
  "plainWord": "^[\\w.:-]{1,64}$",
  "reserved": ["at", "kind", "level"],
  "plain": [
    "action",
    "appVersion",
    "attempt",
    "cause",
    "count",
    "delivery",
    "endReason",
    "exit",
    "failure",
    "from",
    "host",
    "intent",
    "key",
    "lock",
    "mode",
    "ms",
    "op",
    "phase",
    "problem",
    "reason",
    "result",
    "retryAfterS",
    "route",
    "scene",
    "shed",
    "sid",
    "slot",
    "state",
    "status",
    "to",
    "transport"
  ],
  "publicUrl": ["url", "playbackUrl", "overlayUrl"],
  "text": ["message", "problems"],
  "never": ["tok", "token", "passphrase", "streamKey", "streamId", "bearer", "authorization"],
  "reasons": {
    "action": "JS: a UI action word",
    "appVersion": "native: the build's version",
    "attempt": "both: an attempt id is a number; a word here is a label",
    "cause": "native: ReconnectCause wire",
    "count": "JS: a count",
    "delivery": "native: Delivery wire",
    "endReason": "both: EndReason wire, or the server's reason word",
    "exit": "plan C: ApplicationExitInfo reason wire (CD22)",
    "failure": "native: ConnectFailure wire",
    "from": "native: a state or phase name",
    "host": "both: a bare host, never a path or query (plan A I1)",
    "intent": "native: an intent name",
    "key": "JS: a dictionary or store key name, never a value",
    "lock": "JS: an orientation lock name",
    "mode": "JS: a mode name",
    "ms": "JS: a duration",
    "op": "JS: a store operation name",
    "phase": "native: a phase name",
    "problem": "JS: a code-parse problem word",
    "reason": "both: a reason word",
    "result": "native: HeartbeatResult wire",
    "retryAfterS": "JS: seconds",
    "route": "JS: a route name",
    "scene": "JS: a dev scene name",
    "shed": "native: ShedStep wire",
    "sid": "native: the session id, a uuid; no secret (decision 4)",
    "slot": "JS: a camera position on the match",
    "state": "both: a state word",
    "status": "JS: an HTTP status or a check word",
    "to": "native: a state or phase name",
    "transport": "both: srt or rtmps"
  }
}
```

- [ ] **Step 2: The shared vectors.** Each case gives `held` (secrets and stream ids), a `key`, a `value`, and the `expected` value written. Every value is made up. The first rows pin each rule; the last pin encodings. `pass+phrase/6d1e8b0c` form-encodes to `pass%2Bphrase%2F6d1e8b0c`, worked by hand.

```json
{
  "about": "Run by ScrubParityTest.kt and scrubParity.test.ts. expected is what the line carries under key.",
  "held": {
    "secrets": ["tok-9f3c2a7e5b1d4680", "pass+phrase/6d1e8b0c", "key-4c7a0e2b9d5f1386"],
    "streamIds": ["a1b2c3d4e5f60718293a4b5c6d7e8f90"]
  },
  "cases": [
    {
      "why": "a never key is masked whatever it holds",
      "key": "token",
      "value": "anything",
      "expected": "***"
    },
    {
      "why": "a never key masks a number too",
      "key": "passphrase",
      "value": 12345,
      "expected": "***"
    },
    { "why": "an unknown key masks a string", "key": "note", "value": "hello", "expected": "***" },
    { "why": "a number passes under any key", "key": "bytes", "value": 1410, "expected": 1410 },
    { "why": "a boolean passes under any key", "key": "wasLive", "value": true, "expected": true },
    { "why": "null passes under any key", "key": "status", "value": null, "expected": null },
    {
      "why": "a plain word passes a plain key",
      "key": "transport",
      "value": "srt",
      "expected": "srt"
    },
    {
      "why": "a sentence under a plain key is masked whole",
      "key": "reason",
      "value": "two words",
      "expected": "***"
    },
    {
      "why": "a secret under a plain key is masked whole",
      "key": "reason",
      "value": "tok-9f3c2a7e5b1d4680",
      "expected": "***"
    },
    {
      "why": "a stream id under a plain key is masked whole",
      "key": "state",
      "value": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "expected": "***"
    },
    {
      "why": "a public playback URL passes, the stream id in its path allowed",
      "key": "playbackUrl",
      "value": "https://customer-x.cloudflarestream.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8",
      "expected": "https://customer-x.cloudflarestream.com/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8"
    },
    {
      "why": "a URL with a query is masked whole",
      "key": "overlayUrl",
      "value": "https://stg.seazn.club/overlay/fixtures/f1?tok=tok-9f3c2a7e5b1d4680",
      "expected": "***"
    },
    {
      "why": "a URL with a harmless query is masked whole too",
      "key": "url",
      "value": "https://stg.seazn.club/a?b=c",
      "expected": "***"
    },
    {
      "why": "a URL with a token in its path is masked whole",
      "key": "url",
      "value": "https://stg.seazn.club/tok-9f3c2a7e5b1d4680/x",
      "expected": "***"
    },
    {
      "why": "an http URL is masked whole",
      "key": "url",
      "value": "http://stg.seazn.club/a",
      "expected": "***"
    },
    {
      "why": "a URL with userinfo is masked whole",
      "key": "url",
      "value": "https://u:p@stg.seazn.club/a",
      "expected": "***"
    },
    {
      "why": "text masks a raw secret in place",
      "key": "message",
      "value": "connect failed tok=tok-9f3c2a7e5b1d4680 at x",
      "expected": "connect failed tok=*** at x"
    },
    {
      "why": "text masks a form-encoded secret in place",
      "key": "message",
      "value": "srt://h:1?passphrase=pass%2Bphrase%2F6d1e8b0c&x=1",
      "expected": "srt://h:1?passphrase=***&x=1"
    },
    {
      "why": "text masks a component-encoded secret in place",
      "key": "message",
      "value": "pass%2Bphrase%2F6d1e8b0c",
      "expected": "***"
    },
    {
      "why": "text masks the stream id in place",
      "key": "problems",
      "value": "streamid a1b2c3d4e5f60718293a4b5c6d7e8f90 refused",
      "expected": "streamid *** refused"
    },
    {
      "why": "text whose lowercase escapes still reveal a secret is masked whole",
      "key": "message",
      "value": "k=key%2d4c7a0e2b9d5f1386",
      "expected": "***"
    },
    {
      "why": "text with no secret passes as written",
      "key": "message",
      "value": "Connection refused (errno 111)",
      "expected": "Connection refused (errno 111)"
    },
    {
      "why": "a secret beside non-ASCII text is masked, the rest kept",
      "key": "message",
      "value": "bad tok-9f3c2a7e5b1d4680 ñ",
      "expected": "bad *** ñ"
    }
  ],
  "kinds": [
    { "why": "a plain kind passes", "value": "armed", "expected": "armed" },
    {
      "why": "a kind that holds a secret is masked",
      "value": "tok-9f3c2a7e5b1d4680",
      "expected": "***"
    },
    { "why": "a kind that is not a word is masked", "value": "two words", "expected": "***" }
  ]
}
```

The component form of `pass+phrase/6d1e8b0c` (from `Uri.encode`) is also `pass%2Bphrase%2F6d1e8b0c`: neither `+` nor `/` is in `~ ! ' ( )`. Keep that row anyway, because it pins the whole-match case. The `key%2d…` row works because `%2d` is a lowercase escape for `-` that no encoder emits, so only the decode catches it.

- [ ] **Step 3: Write the failing parity tests.** Kotlin:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import org.json.JSONArray
import org.json.JSONObject

/** Carry 11: the record's scrub is one rule set, pinned by files the JS scrub reads too. */
class ScrubParityTest {
  private val list = Shared.read("scrub/allow-list.json")
  private val vectors = Shared.read("scrub/vectors.json")

  private fun JSONArray.strings(): Set<String> = (0 until length()).map { getString(it) }.toSet()

  @Test
  fun `carry 11 the key sets are the shared file's`() {
    assertEquals(list.getJSONArray("plain").strings(), SessionRecord.PLAIN_KEYS)
    assertEquals(list.getJSONArray("publicUrl").strings(), SessionRecord.PUBLIC_URL_KEYS)
    assertEquals(list.getJSONArray("text").strings(), SessionRecord.TEXT_KEYS)
    assertEquals(list.getJSONArray("never").strings(), SessionRecord.NEVER)
    assertEquals(list.getJSONArray("reserved").strings(), SessionRecord.RESERVED_KEYS)
    assertEquals(list.getString("mask"), SessionRecord.MASK)
    assertEquals(list.getJSONObject("reasons").keySet(), SessionRecord.PLAIN_KEYS, "every plain key has its reason")
  }

  @Test
  fun `carry 11 every shared case writes what the vectors say`() {
    val cases = vectors.getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val line = JSONObject(written(RecordEntry("probe", listOf(case.getString("key") to value(case, "value")))))
      assertEquals(value(case, "expected"), value(line, case.getString("key")), case.getString("why"))
    }
  }

  @Test
  fun `carry 11 every shared kind case writes what the vectors say`() {
    val kinds = vectors.getJSONArray("kinds")
    for (i in 0 until kinds.length()) {
      val case = kinds.getJSONObject(i)
      assertEquals(case.getString("expected"), JSONObject(written(RecordEntry(case.getString("value")))).getString("kind"), case.getString("why"))
    }
  }

  @Test
  fun `the shared held block is the test config's secrets`() {
    val held = vectors.getJSONObject("held")
    val shared = held.getJSONArray("secrets").strings() + held.getJSONArray("streamIds").strings()
    assertEquals(shared, Configs.valid().secrets().toSet())
  }

  private fun written(entry: RecordEntry): String {
    val lines = mutableListOf<String>()
    val record = SessionRecord { lines += it }
    record.protect(Configs.valid())
    record.append(0, entry)
    return lines.single()
  }

  private fun value(obj: JSONObject, key: String): Any? = if (obj.isNull(key)) null else obj.get(key)
}
```

`Configs.valid()` holds exactly the shared `held` block's values, and the first test keeps the two from drifting apart.

JS, `src/services/scrubParity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import list from '../../modules/capture-engine/src/scrub/allow-list.json';
import vectors from '../../modules/capture-engine/src/scrub/vectors.json';
import {
  NEVER_KEYS,
  PLAIN_KEYS,
  PUBLIC_URL_KEYS,
  SCRUBBED,
  TEXT_KEYS,
  scrubEvent,
  scrubFields,
  type LogFields,
} from '@/services/scrub';

describe('carry 11: one scrub, pinned by the file native reads too', () => {
  it('keeps the shared key sets and marker', () => {
    expect([...PLAIN_KEYS].sort()).toEqual([...list.plain].sort());
    expect([...PUBLIC_URL_KEYS].sort()).toEqual([...list.publicUrl].sort());
    expect([...TEXT_KEYS].sort()).toEqual([...list.text].sort());
    expect([...NEVER_KEYS].sort()).toEqual([...list.never].sort());
    expect(SCRUBBED).toBe(list.mask);
  });

  it.each(vectors.cases.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const fields = { [c.key]: c.value } as LogFields;
    expect(scrubFields(fields, vectors.held)[c.key]).toEqual(c.expected);
  });

  it.each(vectors.kinds.map((c) => [c.why, c] as const))('event: %s', (_why, c) => {
    expect(scrubEvent(c.value, vectors.held)).toBe(c.expected);
  });
});
```

Relative imports reach the JSON from `src/services`. If the boundaries lint refuses a services import of a file under `modules/`, add `modules/capture-engine/src/scrub/*.json` to the `contracts` element type in `eslint.config.js`: services may import contracts. Do not widen services any further.

- [ ] **Step 4: Run both.** Expected: both fail. The key sets differ, the marker differs, and native masks URLs in place.

- [ ] **Step 5: Reconcile the Kotlin side.** In `SessionRecord.kt`:
  - Replace the companion's sets with the file's (`PLAIN_KEYS`, `PUBLIC_URL_KEYS` adds `url`, `RESERVED_KEYS` becomes public and adds `level`).
  - Add a level: `data class RecordEntry(val kind: String, val fields: List<Pair<String, Any?>> = emptyList(), val level: String = "info")`.
  - Write the head as `listOf("at" to …, "kind" to kindWord(entry.kind), "level" to entry.level)`.
  - Rewrite the scrub to the four rules:

```kotlin
  private fun scrub(key: String, value: Any?): Any? =
    when {
      key in NEVER -> MASK
      value == null || value is Boolean || value is Int || value is Long || value is Wire || value is Decimal -> value
      value is Double -> if (value.isFinite()) Decimal.tenths(value) else MASK
      value !is String -> MASK
      key in PUBLIC_URL_KEYS -> if (isPublicUrl(value)) value else MASK
      key in PLAIN_KEYS -> if (PLAIN_WORD.matches(value) && !revealed(value, secrets)) value else MASK
      key in TEXT_KEYS -> masked(value, secrets)
      else -> MASK
    }

  private fun kindWord(kind: String): String = if (PLAIN_WORD.matches(kind) && !revealed(kind, secrets)) kind else MASK

  /** https, a host, an optional port and path; no query, fragment or userinfo, and no secret but the stream id. */
  private fun isPublicUrl(value: String): Boolean = PUBLIC_URL.matches(value) && !revealed(value, urlSecrets)

  /** Whether [text] shows any of [values], raw or once decoded (the same readings `masked` uses). */
  private fun revealed(text: String, values: List<String>): Boolean {
    val decoded = percentDecoded(text)
    val readings = listOf(text, decoded, decoded.replace('+', ' '), percentDecoded(text.replace('+', ' ')))
    return values.any { secret -> readings.any { secret in it } }
  }
```

with these in the companion:

```kotlin
    /** A word, not a sentence: no spaces, slashes, `?`, `=` or `@`, so no URL or message fits. */
    private val PLAIN_WORD = Regex("^[\\w.:-]{1,64}$")
    private val PUBLIC_URL = Regex("^https://[^/?#@\\s:]+(:\\d+)?(/[^?#\\s]*)?$", RegexOption.IGNORE_CASE)
```

`masked()` stays as it is for text keys: in place, then whole when a decode still reveals a secret. Update the class KDoc to describe the four rules, and point to `allow-list.json` as the source of record.

- [ ] **Step 6: Update the Kotlin expectations that encoded in-place URL masking.** Read each line before you change it. In `SessionRecordTest.kt`, the assertions at about lines 37–42, 185–189, 199–203 and 222–224 expect `?tok=***` inside a URL; each now expects the whole value `"***"`. Any test that asserts a plain key's in-place masking (`"sid"` holding a secret, for example) now expects `"***"`. Each changed assertion keeps its test's name and point: the secret never reaches the line. List every changed line in the commit body.

- [ ] **Step 7: Reconcile the JS side.** In `src/services/scrub.ts`:
  - `export const SCRUBBED = '***';`
  - Export `PLAIN_KEYS` with the file's list.
  - Add `PUBLIC_URL_KEYS = new Set(['url', 'playbackUrl', 'overlayUrl'])`, `TEXT_KEYS = new Set(['message', 'problems'])` and `NEVER_KEYS`.
  - Rewrite `scrubValue`:

```ts
function scrubValue(key: string, value: unknown, mask: Mask): LogValue {
  if (NEVER_KEYS.has(key)) return SCRUBBED;
  if (typeof value === 'number') return Number.isFinite(value) ? value : SCRUBBED;
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value !== 'string') return SCRUBBED;
  if (PUBLIC_URL_KEYS.has(key)) return isPublicUrl(value, mask) ? value : SCRUBBED;
  if (PLAIN_KEYS.has(key)) {
    return PLAIN_WORD.test(value) && !reveals(value, mask.anywhere) ? value : SCRUBBED;
  }
  if (TEXT_KEYS.has(key)) return maskedText(value, mask.anywhere);
  return SCRUBBED;
}

/**
 * Text from a library or the platform (CD6): each known form of a secret is
 * masked where it stands, then the whole value if a decode still reveals one —
 * native's `masked`, rule for rule.
 */
function maskedText(text: string, secrets: readonly string[]): string {
  const forms = secrets
    .flatMap(formsOf)
    .filter((form) => form !== '')
    .sort((a, b) => b.length - a.length);
  const replaced = forms.reduce((acc, form) => acc.split(form).join(SCRUBBED), text);
  return reveals(replaced, secrets) ? SCRUBBED : replaced;
}

/** Raw; URLEncoder's form (space as `+`); the component form `Uri.encode` writes. */
function formsOf(secret: string): readonly string[] {
  const component = encodeURIComponent(secret);
  const form = encodeURIComponent(secret)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return [secret, form, component];
}
```

`encodeURIComponent` leaves `- _ . ! ~ * ' ( )` raw, and `Uri.encode` leaves the same set. `URLEncoder` leaves `- _ . *` raw and escapes `! ~ ' ( )`, with space as `+`, so `form` re-escapes those four. Work the `pass+phrase/6d1e8b0c` row by hand in a comment: both forms are `pass%2Bphrase%2F6d1e8b0c`.

`reveals` must read the replaced text: the `***` it inserts is not a secret, so it reveals nothing.

- [ ] **Step 8: Unify the line format (CD7).** In `src/services/sessionRecord.ts`:

```ts
/** Fields named like the line's own keys are written as `field_<key>`, as native does. */
const RESERVED = new Set(['at', 'kind', 'level']);

/** One flat NDJSON line, the same shape native writes: `{at, kind, level, …fields}`. */
export function toRecordLine({ atMs, level, event, fields }: LogEntry): string {
  const line: Record<string, unknown> = { at: new Date(atMs).toISOString(), kind: event, level };
  for (const [key, value] of Object.entries(fields))
    line[RESERVED.has(key) ? `field_${key}` : key] = value;
  return JSON.stringify(line);
}

export type RecordedEntry = {
  readonly atMs: number;
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** A line back into its parts, either side's. A line with no level is native's core, which writes info. */
export function parseRecordLine(line: string): RecordedEntry {
  const { at, kind, level, ...fields } = JSON.parse(line) as Record<string, unknown>;
  return {
    atMs: Date.parse(String(at)),
    level: typeof level === 'string' ? level : 'info',
    event: String(kind),
    fields,
  };
}
```

In `test/fakePorts.ts`, make `RecordedEntry` re-export the services type, and change `readRecord` to `record.lines().map(parseRecordLine)`. Screen tests that read `entry.event`, `entry.fields` and `entry.level` then need no change. In the six tests that parse a line themselves (listed under Files), replace `JSON.parse(line)` with `parseRecordLine(line)`, and expectations of `{ at, level, event, fields }` with the parsed parts. Add to `sessionRecord.test.ts`:

```ts
it('CD7 writes the flat line native writes, renaming a field that reuses a line key', () => {
  const line = toRecordLine({
    atMs: 0,
    level: 'warn',
    event: 'probe',
    fields: { kind: 'x', ms: 3 },
  });
  expect(JSON.parse(line)).toEqual({
    at: '1970-01-01T00:00:00.000Z',
    kind: 'probe',
    level: 'warn',
    field_kind: 'x',
    ms: 3,
  });
  expect(parseRecordLine(line)).toEqual({
    atMs: 0,
    level: 'warn',
    event: 'probe',
    fields: { field_kind: 'x', ms: 3 },
  });
});
```

- [ ] **Step 9: Run both suites.** Expected: green. JS tests asserting `'[scrubbed]'` used the constant (all 20 uses do; confirm with `grep -rn "\[scrubbed\]" src test` → no matches). A JS test that expected a number under an unknown key to be masked now fails. It encoded the old rule, so change its expectation to the number, and note it in the commit.

- [ ] **Step 10: Mutate, one at a time:**
  1. Native `isPublicUrl` returning true. The query, path-token and userinfo rows fail.
  2. JS `maskedText` returning `text`. The text rows fail.
  3. Drop `formsOf`'s `form`. The form-encoded row fails on the JS side.
  4. Add a key to `PLAIN_KEYS` on one side only. The drift test fails.

- [ ] **Step 11: Verify and commit** both suites' raw counts and `pnpm check` EXIT=0. Then commit:

```bash
cd "$WT" && git add modules/capture-engine/src/scrub modules/capture-engine/android/core/src src/services test/fakePorts.ts eslint.config.js && git commit -F - <<'EOF'
feat(record): one scrub and one line format on both sides

Carry 11. allow-list.json is the source of record, decided key by key;
both sides test their sets against it and run one vector file. Marker
*** both sides; scalars pass under any key; plain and URL keys mask the
whole value; text masks in place. Lines are flat {at, kind, level, ...}.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
EOF
```

Stage only the files you changed. Confirm `git status --short` shows nothing else, and drop `eslint.config.js` from the list if Step 3 did not need it.

## Batch C2 — adapter logic I (pure Kotlin, JVM-tested)

Every file in this batch and the next sits under `modules/capture-engine/android/core/src/{main,test}/kotlin/com/seazn/capture/engine/adapter/` (CD3), in package `com.seazn.capture.engine.adapter`. Nothing here imports `android.*`, StreamPack, OkHttp or `org.json` in `main`. The core suite runs them.

### Task 4: Arm and intent mapping

Carries 1 and 10. The bridge receives each intent as a `Map<String, Any?>`, in which Expo hands every JS number over as `Double`. The mapping must never throw. A malformed arm becomes a `SessionConfig` whose `problems()` name what is wrong, so the machine refuses it, records the problems, and ends the session fatal-error and named, as spec §5 says.

**Files:**

- Create: `adapter/ArmMapping.kt`, `adapter/IntentMapping.kt`, `adapter/WireValues.kt`
- Test: `adapter/ArmMappingTest.kt`, `adapter/IntentMappingTest.kt`

**Interfaces:**

- Consumes `SessionConfig`, `SrtTarget`, `RtmpsTarget`, `Transport` and `Input`.
- Produces:
  - `ArmMapping.config(wire: Map<String, Any?>): SessionConfig`;
  - `IntentMapping.input(wire: Map<String, Any?>): Input?`, where null means an unknown kind;
  - `WireValues.int(value: Any?): Int?` and `WireValues.text(value: Any?): String`.

The arm wire (Task 14 writes it) is:

```text
{ kind: "arm", sid, slot, token,
  primary:  { transport: "srt", url, streamId, passphrase, latencyMs } | { transport: "rtmps", url, streamKey },
  fallback: same shape | null,
  holdWindowSeconds: { srt: n, rtmps: n },
  playbackUrl, heartbeatUrl, descriptorUrl, descriptorJson, appVersion }
```

- [ ] **Step 1: Write the failing tests.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.core.Transport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ArmMappingTest {
  /** As Expo hands it over: every number a Double. The values are Configs' made-up ones. */
  private fun wire(): MutableMap<String, Any?> =
    mutableMapOf(
      "kind" to "arm",
      "sid" to "sess_42",
      "slot" to 2.0,
      "token" to Configs.TOKEN,
      "primary" to mapOf("transport" to "srt", "url" to "srt://live.cloudflare.com:778", "streamId" to Configs.STREAM_ID, "passphrase" to Configs.PASSPHRASE, "latencyMs" to 2000.0),
      "fallback" to mapOf("transport" to "rtmps", "url" to "rtmps://live.cloudflare.com:443/live/", "streamKey" to Configs.STREAM_KEY),
      "holdWindowSeconds" to mapOf("srt" to 183.0, "rtmps" to 180.0),
      "playbackUrl" to Configs.PLAYBACK_URL,
      "heartbeatUrl" to "https://stg.seazn.club/api/capture/heartbeat",
      "descriptorUrl" to "https://stg.seazn.club/api/capture/sessions/sess_42/descriptor",
      "descriptorJson" to """{"sid":"sess_42"}""",
      "appVersion" to "1.0.0",
    )

  @Test
  fun `a whole arm maps to a config with no problems`() {
    val config = ArmMapping.config(wire())
    assertEquals(emptyList(), config.problems())
    assertEquals(2, config.slot)
    assertEquals(2_000, (config.primary as SrtTarget).latencyMs)
    assertEquals(Configs.STREAM_KEY, (config.fallback as RtmpsTarget).streamKey)
    assertEquals(mapOf(Transport.SRT to 183, Transport.RTMPS to 180), config.holdWindowSeconds)
    assertEquals("""{"sid":"sess_42"}""", config.descriptorJson)
  }

  @Test
  fun `an empty arm is never thrown, it is refused by name`() {
    val problems = ArmMapping.config(mapOf("kind" to "arm")).problems()
    for (named in listOf("sid is blank", "token is blank", "slot is below 1", "playbackUrl is not https", "srt url is blank")) {
      assertTrue(named in problems, "missing '$named' in $problems")
    }
  }

  @Test
  fun `a fractional or out-of-range number is no number`() {
    val bad = wire().apply { put("slot", 1.5) }
    assertTrue("slot is below 1" in ArmMapping.config(bad).problems())
    assertEquals(null, WireValues.int(3.0e10))
    assertEquals(null, WireValues.int(Double.NaN))
    assertEquals(7, WireValues.int(7.0))
  }

  @Test
  fun `an unknown transport is no target, and the fallback may be absent`() {
    val config = ArmMapping.config(wire().apply { put("fallback", null) })
    assertEquals(null, config.fallback)
    val unknown = ArmMapping.config(wire().apply { put("primary", mapOf("transport" to "webrtc")) })
    assertTrue("srt url is blank" in unknown.problems())
  }

  @Test
  fun `the mapped config never prints a secret`() {
    val printed = ArmMapping.config(wire()).toString()
    for (secret in Configs.valid().secrets()) assertTrue(secret !in printed, "printed a secret")
  }
}

class IntentMappingTest {
  @Test
  fun `each intent kind maps to its input`() {
    assertEquals(Input.Start, IntentMapping.input(mapOf("kind" to "start")))
    assertEquals(Input.Stop, IntentMapping.input(mapOf("kind" to "stop")))
    assertEquals(Input.Reset, IntentMapping.input(mapOf("kind" to "reset")))
    assertIs<Input.Arm>(IntentMapping.input(mapOf("kind" to "arm")))
  }

  @Test
  fun `carry 10 switchCamera is mapped through, reserved with no control in S1`() {
    assertEquals(Input.SwitchCamera, IntentMapping.input(mapOf("kind" to "switchCamera")))
  }

  @Test
  fun `an unknown or missing kind is no input`() {
    assertEquals(null, IntentMapping.input(mapOf("kind" to "explode")))
    assertEquals(null, IntentMapping.input(emptyMap()))
  }
}
```

- [ ] **Step 2: Run them.** Expected: compile failure; nothing exists yet.

- [ ] **Step 3: Implement.**

```kotlin
package com.seazn.capture.engine.adapter

/** Reading a bridge value that may be missing or of the wrong type. Never throws. */
object WireValues {
  /** Expo hands JS numbers over as Double. Only a whole number that fits an Int is one. */
  fun int(value: Any?): Int? =
    when (value) {
      is Int -> value
      is Long -> if (value in Int.MIN_VALUE..Int.MAX_VALUE) value.toInt() else null
      is Double -> if (value.isFinite() && value % 1.0 == 0.0 && value >= Int.MIN_VALUE && value <= Int.MAX_VALUE) value.toInt() else null
      else -> null
    }

  fun text(value: Any?): String = value as? String ?: ""
}
```

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.IngestTarget
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SessionConfig
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.core.Transport

/**
 * The arm intent's wire → [SessionConfig]. Lenient on purpose: a missing or mistyped field becomes
 * a blank or zero that [SessionConfig.problems] names, so a bad arm is refused, recorded and named,
 * never thrown at the bridge (spec §5).
 */
object ArmMapping {
  fun config(wire: Map<String, Any?>): SessionConfig =
    SessionConfig(
      sid = WireValues.text(wire["sid"]),
      token = WireValues.text(wire["token"]),
      primary = target(wire["primary"]) ?: SrtTarget("", "", "", 0),
      fallback = target(wire["fallback"]),
      holdWindowSeconds = holds(wire["holdWindowSeconds"]),
      playbackUrl = WireValues.text(wire["playbackUrl"]),
      heartbeatUrl = WireValues.text(wire["heartbeatUrl"]),
      appVersion = WireValues.text(wire["appVersion"]),
      slot = WireValues.int(wire["slot"]) ?: 0,
      descriptorUrl = WireValues.text(wire["descriptorUrl"]),
      descriptorJson = wire["descriptorJson"] as? String ?: "{}",
    )

  private fun target(value: Any?): IngestTarget? {
    val map = value as? Map<*, *> ?: return null
    return when (map["transport"]) {
      Transport.SRT.wire ->
        SrtTarget(WireValues.text(map["url"]), WireValues.text(map["streamId"]), WireValues.text(map["passphrase"]), WireValues.int(map["latencyMs"]) ?: 0)
      Transport.RTMPS.wire -> RtmpsTarget(WireValues.text(map["url"]), WireValues.text(map["streamKey"]))
      else -> null
    }
  }

  private fun holds(value: Any?): Map<Transport, Int> {
    val map = value as? Map<*, *> ?: return emptyMap()
    return Transport.entries.mapNotNull { transport -> WireValues.int(map[transport.wire])?.let { transport to it } }.toMap()
  }
}
```

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Input

/** An intent from JS → the core's input (AGENTS §2: intents, not RPC). Null: a kind this build does not know. */
object IntentMapping {
  fun input(wire: Map<String, Any?>): Input? =
    when (wire["kind"]) {
      "arm" -> Input.Arm(ArmMapping.config(wire))
      "start" -> Input.Start
      "stop" -> Input.Stop
      "reset" -> Input.Reset
      // Carry 10: reserved. S1 has no control for it; the platform swaps to the other facing camera.
      "switchCamera" -> Input.SwitchCamera
      else -> null
    }
}
```

- [ ] **Step 4: Run, then mutate.** Make `WireValues.int` accept fractions (`value.toInt()` for any `Double`): the fractional test fails. Restore it from a `cp` backup. Then commit: `feat(adapter): map arm and intents from the bridge, never throwing`, with the trailer lines.

### Task 5: The snapshot wire, platform facts, and the shared vectors

Carries 3, 5 and 6, and CD5. Native's `Snapshot` plus the facts only the platform knows become the map Expo sends as the `onSnapshot` event. One vector file pins both directions: Kotlin must produce each case's `wire`, and JS must turn that `wire` into the case's `engine` object.

**Files:**

- Create: `adapter/PlatformFacts.kt`, `adapter/SnapshotWire.kt`, `adapter/WireJson.kt`
- Create: `modules/capture-engine/src/wire/snapshot-vectors.json`
- Test: `adapter/SnapshotWireTest.kt`, `adapter/WireJsonTest.kt`

**Interfaces:**

- Consumes `Snapshot`, `SessionName` and every `Wire` enum.
- Produces:
  - `data class PlatformFacts(audioLevel: Double, cameraReady: Boolean, networkReachable: Boolean, deliveryCheckedAtMs: Long?, captureTimestampMs: Long?, survivesBackground: Boolean, permissionsRefused: Boolean)`;
  - `data class RecordCounters(sinkFailures: Int, reentrantDropped: Int)`;
  - `SnapshotWire.of(snapshot, facts, record): Map<String, Any?>`;
  - `SnapshotWire.THERMAL: List<String>`;
  - `WireJson.encode(value: Any?): String`.

**The wire shape.** Every number is a `Double`, because JS has one number type and integers up to 2^53 are exact, so Expo's conversion is never asked to carry a `Long`. Absent facts stay `null`.

```text
{ state: { kind, transport?, sinceEpochMs?, reason?, cause?, holdRemainingSeconds?, holdWindowSeconds?, durationMs? },
  session: { sid, slot, tokenTag, descriptorJson } | null,
  camera: "own" | "taken" | "reopening" | "resuming" | "switching" | null,
  reportedAtMs, survivesBackground,
  telemetry: { bitrateKbps, targetBitrateKbps, audioLevel, cameraReady, networkReachable, encodedVideoFps,
               audioPacketsPerSecond, srt: { sent, retransmitted, dropped, rttMs } | null, delivery,
               deliveredLagMs, deliveryCheckedAtMs, dataUsedBytes, charging, batteryPercent,
               drainPctPerHour, thermalStatus, thermalHeadroom, captureTimestampMs, shed,
               heartbeat: { lastSentAtEpochMs, lastResult, consecutiveFailures, failures },
               permissionsRefused, recordSinkFailures, recordReentrantDropped } }
```

The `degraded` state carries `reason: reasons.first()`. The order is `DegradeReason`'s declared order, which is the core's, and the record keeps the whole list. `shed` is a telemetry field and never part of the state (carry 6). `thermalStatus` is `PowerManager`'s int, named by `THERMAL`. An int outside 0–6 is `null`.

- [ ] **Step 1: The vector file.** It holds three things:
  - a `vocabulary` block that pins every wire string (carry 6);
  - `telemetryBase`, the idle telemetry;
  - seven cases.

  Each case's `wire.telemetry` is written as **overrides only**. Both tests read it as `{ ...telemetryBase, ...overrides }`, a shallow merge, which is the one rule both sides apply. A case's `engine` is what JS must produce, apart from `telemetry`: JS hands the merged wire telemetry through unchanged, field for field (carry 5's names were chosen to match). `engine.descriptor` is null in every case except `armed-named-with-descriptor`.

```json
{
  "about": "Native Snapshot → wire (SnapshotWireTest.kt) and wire → EngineSnapshot (snapshotWire.test.ts). A case's telemetry is { ...telemetryBase, ...case.wire.telemetry }. Change only with both.",
  "vocabulary": {
    "state": ["idle", "armed", "connecting", "publishing", "degraded", "reconnecting", "ended"],
    "transport": ["srt", "rtmps"],
    "reconnectCause": ["uplink-lost", "video-stalled", "not-delivered"],
    "degradeReason": [
      "not-delivered",
      "camera-taken",
      "mic-silenced",
      "poor-uplink",
      "fell-back-to-rtmps"
    ],
    "endReason": ["operator-stopped", "stopped-by-organiser", "hold-window-expired", "fatal-error"],
    "delivery": ["ok", "stalled", "unknown"],
    "shed": ["overlay-preview", "preview-framerate", "encode"],
    "heartbeatResult": ["ok", "failed", "session-over"],
    "connectFailure": ["unresolved", "refused", "timeout", "other"],
    "camera": ["own", "taken", "reopening", "resuming", "switching"],
    "thermal": ["none", "light", "moderate", "severe", "critical", "emergency", "shutdown"]
  },
  "telemetryBase": {
    "bitrateKbps": null,
    "targetBitrateKbps": null,
    "audioLevel": 0,
    "cameraReady": false,
    "networkReachable": false,
    "encodedVideoFps": null,
    "audioPacketsPerSecond": null,
    "srt": null,
    "delivery": "unknown",
    "deliveredLagMs": null,
    "deliveryCheckedAtMs": null,
    "dataUsedBytes": 0,
    "charging": null,
    "batteryPercent": null,
    "drainPctPerHour": null,
    "thermalStatus": null,
    "thermalHeadroom": null,
    "captureTimestampMs": null,
    "shed": null,
    "heartbeat": {
      "lastSentAtEpochMs": null,
      "lastResult": null,
      "consecutiveFailures": 0,
      "failures": 0
    },
    "permissionsRefused": false,
    "recordSinkFailures": 0,
    "recordReentrantDropped": 0
  },
  "fixtureDescriptor": {
    "about": "test/fixtures/wire.ts's descriptor wire, copied as JSON when this file is written. Made-up data; no secret."
  },
  "cases": [
    {
      "name": "idle",
      "wire": {
        "state": { "kind": "idle" },
        "session": null,
        "camera": null,
        "reportedAtMs": 1790000000000,
        "survivesBackground": false,
        "telemetry": {}
      },
      "engine": {
        "state": { "kind": "idle" },
        "descriptor": null,
        "slot": null,
        "tokenTag": null,
        "camera": null,
        "reportedAtMs": 1790000000000,
        "survivesBackground": false
      }
    },
    {
      "name": "armed-named-with-descriptor",
      "wire": {
        "state": { "kind": "armed" },
        "session": {
          "sid": "sess_42",
          "slot": 2,
          "tokenTag": "c980ff38",
          "descriptorJson": "FIXTURE"
        },
        "camera": "own",
        "reportedAtMs": 1790000000500,
        "survivesBackground": true,
        "telemetry": { "cameraReady": true, "networkReachable": true, "audioLevel": 0.42 }
      },
      "engine": {
        "state": { "kind": "armed" },
        "descriptor": "FIXTURE",
        "slot": 2,
        "tokenTag": "c980ff38",
        "camera": "own",
        "reportedAtMs": 1790000000500,
        "survivesBackground": true
      }
    },
    {
      "name": "connecting-null-rates",
      "wire": {
        "state": { "kind": "connecting", "transport": "srt" },
        "session": { "sid": "sess_42", "slot": 1, "tokenTag": "c980ff38", "descriptorJson": "{}" },
        "camera": "own",
        "reportedAtMs": 1790000001000,
        "survivesBackground": true,
        "telemetry": { "cameraReady": true, "networkReachable": true }
      },
      "engine": {
        "state": { "kind": "connecting", "transport": "srt" },
        "descriptor": null,
        "slot": 1,
        "tokenTag": "c980ff38",
        "camera": "own",
        "reportedAtMs": 1790000001000,
        "survivesBackground": true
      }
    },
    {
      "name": "degraded-two-reasons",
      "wire": {
        "state": {
          "kind": "degraded",
          "transport": "srt",
          "reason": "not-delivered",
          "sinceEpochMs": 1790000001000
        },
        "session": { "sid": "sess_42", "slot": 1, "tokenTag": "c980ff38", "descriptorJson": "{}" },
        "camera": "own",
        "reportedAtMs": 1790000060000,
        "survivesBackground": true,
        "telemetry": { "cameraReady": true, "networkReachable": true }
      },
      "engine": {
        "state": {
          "kind": "degraded",
          "transport": "srt",
          "reason": "not-delivered",
          "sinceEpochMs": 1790000001000
        },
        "descriptor": null,
        "slot": 1,
        "tokenTag": "c980ff38",
        "camera": "own",
        "reportedAtMs": 1790000060000,
        "survivesBackground": true
      }
    },
    {
      "name": "reconnecting",
      "wire": {
        "state": {
          "kind": "reconnecting",
          "cause": "uplink-lost",
          "holdRemainingSeconds": 38,
          "holdWindowSeconds": 183,
          "sinceEpochMs": 1790000001000
        },
        "session": { "sid": "sess_42", "slot": 1, "tokenTag": "c980ff38", "descriptorJson": "{}" },
        "camera": "own",
        "reportedAtMs": 1790000146000,
        "survivesBackground": true,
        "telemetry": { "cameraReady": true }
      },
      "engine": {
        "state": {
          "kind": "reconnecting",
          "cause": "uplink-lost",
          "holdRemainingSeconds": 38,
          "holdWindowSeconds": 183,
          "sinceEpochMs": 1790000001000
        },
        "descriptor": null,
        "slot": 1,
        "tokenTag": "c980ff38",
        "camera": "own",
        "reportedAtMs": 1790000146000,
        "survivesBackground": true
      }
    },
    {
      "name": "ended-refused",
      "wire": {
        "state": { "kind": "ended", "reason": "fatal-error", "durationMs": null },
        "session": { "sid": "sess_42", "slot": 2, "tokenTag": "c980ff38", "descriptorJson": "{}" },
        "camera": null,
        "reportedAtMs": 1790000000000,
        "survivesBackground": false,
        "telemetry": { "permissionsRefused": true }
      },
      "engine": {
        "state": { "kind": "ended", "reason": "fatal-error", "durationMs": null },
        "descriptor": null,
        "slot": 2,
        "tokenTag": "c980ff38",
        "camera": null,
        "reportedAtMs": 1790000000000,
        "survivesBackground": false
      }
    },
    {
      "name": "live-telemetry",
      "wire": {
        "state": { "kind": "publishing", "transport": "srt", "sinceEpochMs": 1790000001000 },
        "session": { "sid": "sess_42", "slot": 1, "tokenTag": "c980ff38", "descriptorJson": "{}" },
        "camera": "own",
        "reportedAtMs": 1790000061000,
        "survivesBackground": true,
        "telemetry": {
          "bitrateKbps": 2950,
          "targetBitrateKbps": 3000,
          "audioLevel": 0.5,
          "cameraReady": true,
          "networkReachable": true,
          "encodedVideoFps": 29.5,
          "audioPacketsPerSecond": 46,
          "srt": { "sent": 1200, "retransmitted": 4, "dropped": 0, "rttMs": 38 },
          "delivery": "ok",
          "deliveredLagMs": 9000,
          "deliveryCheckedAtMs": 1790000060000,
          "dataUsedBytes": 22000000,
          "charging": true,
          "batteryPercent": 81,
          "drainPctPerHour": 7.5,
          "thermalStatus": "moderate",
          "thermalHeadroom": 0.6,
          "captureTimestampMs": 1790000060900,
          "shed": "overlay-preview",
          "heartbeat": {
            "lastSentAtEpochMs": 1790000060000,
            "lastResult": "ok",
            "consecutiveFailures": 0,
            "failures": 1
          },
          "recordSinkFailures": 2,
          "recordReentrantDropped": 1
        }
      },
      "engine": {
        "state": { "kind": "publishing", "transport": "srt", "sinceEpochMs": 1790000001000 },
        "descriptor": null,
        "slot": 1,
        "tokenTag": "c980ff38",
        "camera": "own",
        "reportedAtMs": 1790000061000,
        "survivesBackground": true
      }
    }
  ]
}
```

**The one copied value.** Before you commit, make three edits:

1. Replace `fixtureDescriptor` with `descriptorToWire(...)` of the descriptor in `test/fixtures/wire.ts`, as a JSON object.
2. Replace the armed case's `wire.session.descriptorJson`, `"FIXTURE"`, with that object's `JSON.stringify`, as a string.
3. Replace its `engine.descriptor`, `"FIXTURE"`, with the same object.

This is fixture data, made up, with no secret in it. Every other value is printed above. The JS test compares `descriptorToWire(result.descriptor)` with `engine.descriptor`, so the `Date` fields are proved re-hydrated (carry 4). Without that, the warming deadline would read `NaN`.

- [ ] **Step 2: Write the failing Kotlin test.** One builder per case name: the native `Snapshot`, facts and counters that should produce it. Each is written out, not derived from `SnapshotWire`.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.*
import kotlin.test.Test
import kotlin.test.assertEquals
import org.json.JSONObject

class SnapshotWireTest {
  private val file = Shared.read("wire/snapshot-vectors.json")
  private val noBeat = HeartbeatStatus(null, null, 0, 0)
  private val idleFacts = PlatformFacts()
  private val clean = RecordCounters(0, 0)

  private fun bare(state: SnapshotState, at: Long) =
    Snapshot(state, at, Delivery.UNKNOWN, null, null, null, null, null, null, 0, null, noBeat, null, null, null)

  /**
   * Each case's native side, written out by hand from its JSON case. Every value here is a literal,
   * and none is read back from SnapshotWire.
   */
  private val named = Configs.valid().name
  private val onAirFacts = idleFacts.copy(cameraReady = true, networkReachable = true, survivesBackground = true)

  private val builders: Map<String, () -> Map<String, Any?>> =
    mapOf(
      "idle" to { SnapshotWire.of(bare(SnapshotState.Idle, 1_790_000_000_000), idleFacts, clean) },
      "armed-named-with-descriptor" to {
        val session = SessionName("sess_42", 2, "c980ff38", FIXTURE_DESCRIPTOR_JSON)
        val snapshot = bare(SnapshotState.Armed, 1_790_000_000_500).copy(camera = CameraState.OWN, session = session)
        SnapshotWire.of(snapshot, onAirFacts.copy(audioLevel = 0.42), clean)
      },
      "connecting-null-rates" to {
        val snapshot = bare(SnapshotState.Connecting(Transport.SRT), 1_790_000_001_000).copy(camera = CameraState.OWN, session = named)
        SnapshotWire.of(snapshot, onAirFacts, clean)
      },
      "degraded-two-reasons" to {
        val state = SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.NOT_DELIVERED, DegradeReason.MIC_SILENCED), 1_790_000_001_000)
        SnapshotWire.of(bare(state, 1_790_000_060_000).copy(camera = CameraState.OWN, session = named), onAirFacts, clean)
      },
      "reconnecting" to {
        val state = SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, 1_790_000_001_000)
        val facts = idleFacts.copy(cameraReady = true, survivesBackground = true)
        SnapshotWire.of(bare(state, 1_790_000_146_000).copy(camera = CameraState.OWN, session = named), facts, clean)
      },
      "ended-refused" to {
        val state = SnapshotState.Ended(EndReason.FATAL_ERROR, null)
        val session = SessionName("sess_42", 2, "c980ff38", "{}")
        SnapshotWire.of(bare(state, 1_790_000_000_000).copy(session = session), idleFacts.copy(permissionsRefused = true), clean)
      },
      "live-telemetry" to {
        val snapshot =
          Snapshot(
            state = SnapshotState.Publishing(Transport.SRT, 1_790_000_001_000),
            reportedAtMs = 1_790_000_061_000,
            delivery = Delivery.OK,
            deliveredLagMs = 9_000,
            encodedVideoFps = 29.5,
            audioPacketsPerSecond = 46.0,
            srt = SrtTelemetry(1_200, 4, 0, 38),
            bitrateKbps = 2_950,
            targetBitrateKbps = 3_000,
            dataUsedBytes = 22_000_000,
            charging = true,
            heartbeat = HeartbeatStatus(1_790_000_060_000, HeartbeatResult.OK, 0, 1),
            shed = ShedStep.OVERLAY_PREVIEW,
            device = DeviceSample(2, 0.6, 81, true, 7.5, ShedStep.OVERLAY_PREVIEW),
            camera = CameraState.OWN,
            session = named,
          )
        val facts = onAirFacts.copy(audioLevel = 0.5, deliveryCheckedAtMs = 1_790_000_060_000, captureTimestampMs = 1_790_000_060_900)
        SnapshotWire.of(snapshot, facts, RecordCounters(2, 1))
      },
    )

  /** The descriptorJson the armed case carries: the file's own value, read once, so the two never differ. */
  private val FIXTURE_DESCRIPTOR_JSON: String
    get() = file.getJSONArray("cases").getJSONObject(1).getJSONObject("wire").getJSONObject("session").getString("descriptorJson")

  @Test
  fun `carries 3, 5, 6 each native snapshot becomes the shared wire`() {
    val cases = file.getJSONArray("cases")
    assertEquals(cases.length(), builders.size, "one builder per case")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val name = case.getString("name")
      val expected = case.getJSONObject("wire").also { wire ->
        val merged = JSONObject(file.getJSONObject("telemetryBase").toString())
        val overrides = wire.getJSONObject("telemetry")
        for (key in overrides.keySet()) merged.put(key, overrides.get(key))
        wire.put("telemetry", merged)
      }
      assertJsonEquals(expected, JSONObject(WireJson.encode(builders.getValue(name)())), name)
    }
  }

  @Test
  fun `carry 6 every wire string is the shared vocabulary's`() {
    val vocabulary = file.getJSONObject("vocabulary")
    fun list(key: String) = vocabulary.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }
    assertEquals(list("reconnectCause"), ReconnectCause.entries.map { it.wire })
    assertEquals(list("degradeReason"), DegradeReason.entries.map { it.wire })
    assertEquals(list("endReason"), EndReason.entries.map { it.wire })
    assertEquals(list("delivery"), Delivery.entries.map { it.wire })
    assertEquals(list("shed"), ShedStep.entries.map { it.wire })
    assertEquals(list("heartbeatResult"), HeartbeatResult.entries.map { it.wire })
    assertEquals(list("connectFailure"), ConnectFailure.entries.map { it.wire })
    assertEquals(list("camera"), CameraState.entries.map { it.wire })
    assertEquals(list("transport"), Transport.entries.map { it.wire })
    assertEquals(list("thermal"), SnapshotWire.THERMAL)
  }

  @Test
  fun `a thermal status outside the platform's range is no reading`() {
    val sample = DeviceSample(9, null, null, null, null, null)
    val wire = SnapshotWire.of(bare(SnapshotState.Armed, 0).copy(device = sample), idleFacts, clean)
    assertEquals(null, (wire["telemetry"] as Map<*, *>)["thermalStatus"])
  }
}
```

Compare with a helper `assertJsonEquals(expected: Any?, actual: Any?, path: String)` in the test file: it walks objects key by key and compares numbers as `Double`. It must be exact, with no tolerance.

`Shared` is the helper from Task 2, in package `core`'s test sources. The adapter tests are in the same Gradle source set, so they import it.

- [ ] **Step 3: Implement `PlatformFacts`, `SnapshotWire` and `WireJson`.**

```kotlin
package com.seazn.capture.engine.adapter

/**
 * What only the platform knows, read on the scheduler thread at every publish. Never blocking:
 * each field is a volatile the adapters keep current. Defaults are "no reading".
 */
data class PlatformFacts(
  /** Peak level 0–1 since the last snapshot (CD28); 0 with no microphone. */
  val audioLevel: Double = 0.0,
  /** The camera is ours and has delivered a frame since it opened. */
  val cameraReady: Boolean = false,
  /** `NET_CAPABILITY_VALIDATED` on the default network. */
  val networkReachable: Boolean = false,
  /** Wall time of the last playlist answer of any kind (carry 5). */
  val deliveryCheckedAtMs: Long? = null,
  /** Capture time of the last encoded video frame, epoch ms (spec §2). */
  val captureTimestampMs: Long? = null,
  /** True only once `startForeground` returned for this session (CD16). */
  val survivesBackground: Boolean = false,
  /** Camera or microphone refused at this session's arm (CD21). */
  val permissionsRefused: Boolean = false,
)

data class RecordCounters(val sinkFailures: Int, val reentrantDropped: Int)
```

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Snapshot
import com.seazn.capture.engine.core.SnapshotState

/** Native's snapshot → the `onSnapshot` event's body (spec §2's ~1 Hz contract). Pure. */
object SnapshotWire {
  /** `PowerManager.THERMAL_STATUS_*`, 0 to 6, by index. */
  val THERMAL = listOf("none", "light", "moderate", "severe", "critical", "emergency", "shutdown")

  fun of(snapshot: Snapshot, facts: PlatformFacts, record: RecordCounters): Map<String, Any?> =
    linkedMapOf(
      "state" to state(snapshot.state),
      "session" to snapshot.session?.let { linkedMapOf("sid" to it.sid, "slot" to num(it.slot), "tokenTag" to it.tokenTag, "descriptorJson" to it.descriptorJson) },
      "camera" to snapshot.camera?.wire,
      "reportedAtMs" to num(snapshot.reportedAtMs),
      "survivesBackground" to facts.survivesBackground,
      "telemetry" to telemetry(snapshot, facts, record),
    )

  private fun state(state: SnapshotState): Map<String, Any?> =
    when (state) {
      SnapshotState.Idle, SnapshotState.Armed -> linkedMapOf("kind" to state.wire)
      is SnapshotState.Connecting -> linkedMapOf("kind" to state.wire, "transport" to state.transport.wire)
      is SnapshotState.Publishing -> linkedMapOf("kind" to state.wire, "transport" to state.transport.wire, "sinceEpochMs" to num(state.sinceEpochMs))
      is SnapshotState.Degraded ->
        linkedMapOf("kind" to state.wire, "transport" to state.transport.wire, "reason" to state.reasons.first().wire, "sinceEpochMs" to num(state.sinceEpochMs))
      is SnapshotState.Reconnecting ->
        linkedMapOf(
          "kind" to state.wire,
          "cause" to state.cause.wire,
          "holdRemainingSeconds" to num(state.holdRemainingSeconds),
          "holdWindowSeconds" to num(state.holdWindowSeconds),
          "sinceEpochMs" to num(state.sinceEpochMs),
        )
      is SnapshotState.Ended -> linkedMapOf("kind" to state.wire, "reason" to state.reason.wire, "durationMs" to state.durationMs?.let(::num))
    }

  private fun telemetry(s: Snapshot, facts: PlatformFacts, record: RecordCounters): Map<String, Any?> =
    linkedMapOf(
      "bitrateKbps" to s.bitrateKbps?.let(::num),
      "targetBitrateKbps" to s.targetBitrateKbps?.let(::num),
      "audioLevel" to facts.audioLevel,
      "cameraReady" to facts.cameraReady,
      "networkReachable" to facts.networkReachable,
      "encodedVideoFps" to s.encodedVideoFps,
      "audioPacketsPerSecond" to s.audioPacketsPerSecond,
      "srt" to s.srt?.let { linkedMapOf("sent" to num(it.sent), "retransmitted" to num(it.retransmitted), "dropped" to num(it.dropped), "rttMs" to it.rttMs?.let(::num)) },
      "delivery" to s.delivery.wire,
      "deliveredLagMs" to s.deliveredLagMs?.let(::num),
      "deliveryCheckedAtMs" to facts.deliveryCheckedAtMs?.let(::num),
      "dataUsedBytes" to num(s.dataUsedBytes),
      "charging" to s.charging,
      "batteryPercent" to s.device?.batteryPercent?.let(::num),
      "drainPctPerHour" to s.device?.drainPctPerHour,
      "thermalStatus" to s.device?.thermalStatus?.let { THERMAL.getOrNull(it) },
      "thermalHeadroom" to s.device?.thermalHeadroom,
      "captureTimestampMs" to facts.captureTimestampMs?.let(::num),
      "shed" to s.shed?.wire,
      "heartbeat" to s.heartbeat.let { linkedMapOf("lastSentAtEpochMs" to it.lastSentAtEpochMs?.let(::num), "lastResult" to it.lastResult?.wire, "consecutiveFailures" to num(it.consecutiveFailures), "failures" to num(it.failures)) },
      "permissionsRefused" to facts.permissionsRefused,
      "recordSinkFailures" to num(record.sinkFailures),
      "recordReentrantDropped" to num(record.reentrantDropped),
    )

  private fun num(value: Number): Double = value.toDouble()
}
```

`WireJson.encode` writes `Map`, `List`, `String` (through the core's `Json.string`), `Boolean`, `null` and `Double`. A whole double is written without `.0` (`1790000000000`), and a non-finite one as `null`. Its test pins those three cases, plus key order and escaping.

- [ ] **Step 4: Run, then mutate.** Mutate one at a time, from a `cp` backup:
  1. Change `reasons.first()` to `reasons.last()`. The degraded case fails.
  2. Drop `session`. Every named case fails.
  3. Swap `"moderate"` and `"severe"` in `THERMAL`. The vocabulary test fails.

  Then commit: `feat(adapter): the snapshot wire and its shared vectors`, with the trailer lines.

### Task 6: The guarded scheduler, and sticky permanent failures

Carries 15 and 18, CD9 and CD11. Plan B's `Engine.process` rethrows an `Error` after it has written the snapshot. On a bare `Handler`, that kills the `capture-engine` thread, and the HUD freezes on its last word. A permanent failure must answer every later connect, or the machine will retry a missing library for the whole hold window.

**Files:**

- Create: `adapter/GuardedScheduler.kt`, `adapter/Failures.kt`
- Modify: `core/.../SessionMachine.kt`: make `attemptInHand` a public extension, `val Phase.attemptInHand: Int`, moved to `Phase.kt` unchanged. `StickyFailure` reports with it (CD11).
- Test: `adapter/GuardedSchedulerTest.kt`, `adapter/StickyFailureTest.kt`

**Interfaces:**

- Consumes `Scheduler`, `Cancellable`, `CommandSink`, `Command`, `Input` and `Phase.attemptInHand`.
- Produces:
  - `GuardedScheduler(inner: Scheduler, onFailure: (Throwable) -> Unit) : Scheduler`, with `caught: Int`;
  - `object Failures { fun permanent(t: Throwable): Boolean; fun describe(t: Throwable): String }`;
  - `class PermanentPlatformFailure(message: String, cause: Throwable? = null) : Exception`;
  - `class StickyFailure(inner: CommandSink, report: (Input) -> Unit) : CommandSink`, with `fail(message: String, attemptInHand: Int, scope: Scope)`, `armAccepted()` and `failed: Boolean`;
  - `enum class Scope { PROCESS, SESSION }`.

- [ ] **Step 1: Write the failing tests.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GuardedSchedulerTest {
  /** Runs each task when told, as a Handler would, and lets a thrown Throwable escape as a Looper would. */
  private class Direct : Scheduler {
    val tasks = ArrayDeque<() -> Unit>()

    override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
      tasks.addLast(task)
      return Cancellable { tasks.remove(task) }
    }

    fun runAll() {
      while (tasks.isNotEmpty()) tasks.removeFirst()()
    }
  }

  @Test
  fun `carry 15 an Error at the task boundary is reported and the thread lives on`() {
    val inner = Direct()
    val seen = mutableListOf<Throwable>()
    val guarded = GuardedScheduler(inner) { seen += it }
    var later = false
    guarded.schedule(0) { throw StackOverflowError("deep") }
    guarded.schedule(0) { later = true }
    inner.runAll()
    assertTrue(later, "the next task still ran")
    assertEquals(listOf("deep"), seen.map { it.message })
    assertEquals(1, guarded.caught)
  }

  @Test
  fun `a reporter that throws is swallowed too`() {
    val inner = Direct()
    val guarded = GuardedScheduler(inner) { throw IllegalStateException("reporter") }
    guarded.schedule(0) { throw RuntimeException("task") }
    inner.runAll()
    assertEquals(1, guarded.caught)
  }
}
```

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.Input
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class StickyFailureTest {
  private val executed = mutableListOf<Command>()
  private val reported = mutableListOf<Input>()
  private val sticky = StickyFailure({ executed += it }) { reported += it }
  private val connect = Command.Connect(4, Configs.srt, 1_500_000, null)

  @Test
  fun `carry 18 after a permanent failure every later connect is answered PlatformFailed for its own attempt`() {
    sticky.fail("UnsatisfiedLinkError: libsrt", attemptInHand = 3, scope = Scope.PROCESS)
    sticky.execute(connect)
    sticky.execute(Command.Rebuild(4, connect.copy(attemptId = 5)))
    sticky.execute(Command.StartNewSession(5, connect.copy(attemptId = 6)))
    assertEquals(
      listOf(3, 4, 5, 6).map { Input.PlatformFailed(it, "UnsatisfiedLinkError: libsrt") },
      reported,
    )
    assertTrue(executed.none { it is Command.Connect || it is Command.Rebuild || it is Command.StartNewSession })
  }

  @Test
  fun `carry 18 a failure before the first connect is reported at once with the attempt in hand`() {
    sticky.fail("camera permission refused", attemptInHand = 1, scope = Scope.SESSION)
    assertEquals(listOf<Input>(Input.PlatformFailed(1, "camera permission refused")), reported)
  }

  @Test
  fun `the second failure is not reported again, and End still reaches the platform`() {
    sticky.fail("a", 1, Scope.PROCESS)
    sticky.fail("b", 1, Scope.PROCESS)
    sticky.execute(Command.End(com.seazn.capture.engine.core.EndReason.FATAL_ERROR))
    assertEquals(1, reported.size)
    assertTrue(executed.single() is Command.End)
  }

  @Test
  fun `a session failure clears at the next accepted arm, a process failure never does`() {
    sticky.fail("mic refused", 1, Scope.SESSION)
    sticky.armAccepted()
    sticky.execute(connect)
    assertEquals(connect, executed.single())
    sticky.fail("libsrt", 4, Scope.PROCESS)
    sticky.armAccepted()
    sticky.execute(connect.copy(attemptId = 9))
    assertEquals(Input.PlatformFailed(9, "libsrt"), reported.last())
  }

  @Test
  fun `linkage errors and wrapped permanent failures are permanent, a timeout is not`() {
    assertTrue(Failures.permanent(UnsatisfiedLinkError("x")))
    assertTrue(Failures.permanent(NoClassDefFoundError("x")))
    assertTrue(Failures.permanent(RuntimeException(PermanentPlatformFailure("codec"))))
    assertTrue(!Failures.permanent(java.net.SocketTimeoutException("t")))
  }
}
```

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler

/**
 * Carry 15: whatever a task throws, `Error` included, stops at the task boundary. It is handed to
 * [onFailure] (which records it and classifies it) and the thread lives on. Plan B's engine rethrows
 * an `Error` after publishing; on a bare Handler that would end the scheduler and freeze the HUD.
 */
class GuardedScheduler(private val inner: Scheduler, private val onFailure: (Throwable) -> Unit) : Scheduler {
  @Volatile
  var caught: Int = 0
    private set

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable =
    inner.schedule(delayMs) {
      try {
        task()
      } catch (failure: Throwable) {
        caught += 1
        try {
          onFailure(failure)
        } catch (_: Throwable) {
          // The reporter failing must not end the thread either; the count still says something broke.
        }
      }
    }
}
```

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.CommandSink
import com.seazn.capture.engine.core.Input

/** A failure the glue knows no retry can heal: a codec that cannot be configured, a refused permission. */
class PermanentPlatformFailure(message: String, cause: Throwable? = null) : Exception(message, cause)

enum class Scope {
  /** Lasts the process: a missing native library does not come back. */
  PROCESS,

  /** Lasts the session: a permission refused can be granted before the next arm. */
  SESSION,
}

object Failures {
  private const val MAX_CAUSES = 8

  fun permanent(failure: Throwable): Boolean =
    generateSequence(failure) { it.cause }.take(MAX_CAUSES).any { it is LinkageError || it is PermanentPlatformFailure }

  /** The class and message, for the record, which scrubs the message as text (CD6). */
  fun describe(failure: Throwable): String = failure.javaClass.simpleName + (failure.message?.let { ": $it" } ?: "")
}

/**
 * Carry 18. Once a permanent failure is known, every later attempt is answered at once with
 * `PlatformFailed(thatAttemptId)`, and no connect reaches the platform. Every other command passes:
 * End and Disconnect must still clean up, and HTTP still answers.
 */
class StickyFailure(private val inner: CommandSink, private val report: (Input) -> Unit) : CommandSink {
  private var failure: Pair<String, Scope>? = null

  val failed: Boolean
    get() = failure != null

  /** Reported once, at once, against the attempt in hand: an armed session ends fatal-error, named. */
  fun fail(message: String, attemptInHand: Int, scope: Scope) {
    if (failure != null) return
    failure = message to scope
    report(Input.PlatformFailed(attemptInHand, message))
  }

  /** A new session may succeed where the last one's permission was refused. */
  fun armAccepted() {
    if (failure?.second == Scope.SESSION) failure = null
  }

  override fun execute(command: Command) {
    val held = failure
    val attempt = attemptOf(command)
    if (held != null && attempt != null) report(Input.PlatformFailed(attempt, held.first)) else inner.execute(command)
  }

  private fun attemptOf(command: Command): Int? =
    when (command) {
      is Command.Connect -> command.attemptId
      is Command.Rebuild -> command.next.attemptId
      is Command.StartNewSession -> command.next.attemptId
      else -> null
    }
}
```

`StickyFailure` runs only on the scheduler thread, and `BridgeCore` (Task 12) guarantees that, so it needs no lock. Move `attemptInHand` from `SessionMachine` to `Phase.kt` as a public extension with its KDoc unchanged, and run the core suite to prove the move changed nothing.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Remove the `Error` catch by catching `Exception`. The first test fails.
  2. Skip `Rebuild` in `attemptOf`. The carry 18 test fails.
  3. Clear PROCESS failures in `armAccepted`. The scope test fails.

  Then commit: `feat(adapter): guard the task boundary and keep permanent failures sticky`, with the trailer lines.

### Task 7: Attempt pollers

Carries 16 and 19, and CD12. The machine needs cumulative encoded frames every 500 ms, so the stall watchdog sees every tick, and link counters every second. A second poller per attempt would double every reading. A poller stopped at a camera switch would let the LIVE gate drop for the length of the switch.

**Files:**

- Create: `adapter/AttemptPollers.kt`
- Test: `adapter/AttemptPollersTest.kt`

**Interfaces:**

- Consumes `Scheduler`, `Command`, `Input` and `LinkCounters`.
- Produces:
  - `data class FrameCount(video: Long, audio: Long)`;
  - `class AttemptPollers(scheduler, frames: (Int) -> FrameCount?, link: (Int) -> LinkCounters?, send: (Input) -> Unit)`, with `onInput(input: Input)`, `onCommand(command: Command)`, `running: Int?`, and the constants `FRAMES_MS = 500` and `LINK_MS = 1_000`.

- [ ] **Step 1: Write the failing tests.** Use the core's `FakeScheduler` from its test sources.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.DropReason
import com.seazn.capture.engine.core.EndReason
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import kotlin.test.Test
import kotlin.test.assertEquals

class AttemptPollersTest {
  private val scheduler = FakeScheduler(FakeClock())
  private val sent = mutableListOf<Input>()
  private var video = 0L
  private val counters = LinkCounters(1_000, 10, 0, 0, 0, 40, 120, 3_000_000)
  private val pollers = AttemptPollers(scheduler, frames = { FrameCount(video, video) }, link = { counters }, send = { sent += it })

  private fun frames() = sent.filterIsInstance<Input.Frames>()

  private fun links() = sent.filterIsInstance<Input.Link>()

  @Test
  fun `carry 16 one poller per attempt, however often it is begun`() {
    pollers.onInput(Input.Connected(1))
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(1_000)
    assertEquals(2, frames().size, "500 ms for 1 s, once")
    assertEquals(1, links().size, "1000 ms for 1 s, once")
  }

  @Test
  fun `carry 19 frames keep coming every 500 ms through a camera switch`() {
    pollers.onInput(Input.Connected(1))
    scheduler.advanceBy(500)
    pollers.onCommand(Command.SwitchCamera)
    scheduler.advanceBy(3_000)
    assertEquals(7, frames().size, "every 500 ms from 500 to 3500, the switch included")
  }

  @Test
  fun `a new attempt replaces the old one's pollers, and readings name their attempt`() {
    pollers.onInput(Input.Connected(1))
    pollers.onCommand(Command.Rebuild(1, Command.Connect(2, Configs.srt, 1_500_000, null)))
    pollers.onInput(Input.Connected(2))
    scheduler.advanceBy(1_000)
    assertEquals(setOf(2), frames().map { it.attemptId }.toSet())
  }

  @Test
  fun `a drop, a disconnect, a new session and the end each stop the pollers`() {
    val stops =
      listOf<(AttemptPollers) -> Unit>(
        { it.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null)) },
        { it.onCommand(Command.Disconnect(1)) },
        { it.onCommand(Command.StartNewSession(1, Command.Connect(2, Configs.srt, 1_500_000, null))) },
        { it.onCommand(Command.End(EndReason.OPERATOR_STOPPED)) },
      )
    for (stop in stops) {
      sent.clear()
      pollers.onInput(Input.Connected(1))
      stop(pollers)
      scheduler.advanceBy(2_000)
      assertEquals(0, frames().size)
      assertEquals(null, pollers.running)
    }
  }

  @Test
  fun `a drop of an older attempt does not stop the current one`() {
    pollers.onInput(Input.Connected(2))
    pollers.onInput(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    scheduler.advanceBy(500)
    assertEquals(1, frames().size)
  }

  @Test
  fun `no reading sends nothing`() {
    val quiet = AttemptPollers(scheduler, frames = { null }, link = { null }, send = { sent += it })
    quiet.onInput(Input.Connected(1))
    scheduler.advanceBy(2_000)
    assertEquals(emptyList(), sent)
  }
}
```

Check `Command.Disconnect`'s fields in `Command.kt` before writing the line that builds one. The test above assumes `Disconnect(attemptId)`.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.Scheduler

data class FrameCount(val video: Long, val audio: Long)

/**
 * Carries 16 and 19 (CD12): one Frames reader every 500 ms and one Link reader every second, for the
 * attempt that connected last. Begun by its `Connected`, and kept through a camera switch so the LIVE
 * gate's bound holds. Ended by its drop, or by a command that ends the attempt. Scheduler thread only.
 */
class AttemptPollers(
  private val scheduler: Scheduler,
  private val frames: (Int) -> FrameCount?,
  private val link: (Int) -> LinkCounters?,
  private val send: (Input) -> Unit,
) {
  var running: Int? = null
    private set

  private var loops: List<Repeating> = emptyList()

  fun onInput(input: Input) {
    when (input) {
      is Input.Connected -> begin(input.attemptId)
      is Input.Dropped -> if (input.attemptId == running) stop()
      is Input.ConnectFailed -> if (input.attemptId == running) stop()
      else -> Unit
    }
  }

  fun onCommand(command: Command) {
    when (command) {
      is Command.Disconnect, is Command.Rebuild, is Command.StartNewSession, is Command.End -> stop()
      else -> Unit
    }
  }

  private fun begin(attemptId: Int) {
    if (running == attemptId) return
    stop()
    running = attemptId
    loops =
      listOf(
        Repeating(scheduler, FRAMES_MS) { frames(attemptId)?.let { send(Input.Frames(attemptId, it.video, it.audio)) } },
        Repeating(scheduler, LINK_MS) { link(attemptId)?.let { send(Input.Link(attemptId, it)) } },
      )
  }

  private fun stop() {
    loops.forEach(Repeating::cancel)
    loops = emptyList()
    running = null
  }

  companion object {
    const val FRAMES_MS = 500L
    const val LINK_MS = 1_000L
  }
}

/** Runs [read] every [periodMs] until cancelled. A cancel between runs stops the next one. */
private class Repeating(private val scheduler: Scheduler, private val periodMs: Long, private val read: () -> Unit) {
  private var next: Cancellable? = null
  private var cancelled = false

  init {
    schedule()
  }

  private fun schedule() {
    next =
      scheduler.schedule(periodMs) {
        if (cancelled) return@schedule
        try {
          read()
        } finally {
          if (!cancelled) schedule()
        }
      }
  }

  fun cancel() {
    cancelled = true
    next?.cancel()
  }
}
```

`send` posts through the engine. A reading taken on the scheduler thread therefore reaches the machine on its next turn, never inside the current input.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Remove the `running == attemptId` early return. The one-poller test fails.
  2. Add `is Command.SwitchCamera` to the stop list. The carry 19 test fails.

  Then commit: `feat(adapter): one frame and link poller per attempt`, with the trailer lines.

### Task 8: HTTP requests and answers

Carries 17 and 20, F-P5-13 and CD13. Five rules apply:

- A playlist fetch must never be served from a cache: P5 saw a cached manifest read as delivery.
- A 204 is "no variant live", not a body, although OkHttp's `isSuccessful` is true for it.
- A 403 is no evidence.
- The descriptor's answer must carry the id it was asked with.
- No request's `toString` may print the bearer.

**Files:**

- Create: `adapter/Http.kt`
- Test: `adapter/HttpTest.kt`

**Interfaces:**

- Consumes `Command.FetchPlaylist(requestId, url)`, `Command.PostHeartbeat(beatId, url, bearer, body)`, `FetchResult`, `HeartbeatResponse`, `DescriptorCheck.answered` and `SessionConfig`.
- Produces:
  - `data class HttpRequest(method, url, headers: List<Pair<String,String>>, body: String?)`;
  - `sealed interface HttpOutcome { Answered(status: Int, body: String); Failed(message: String) }`;
  - `data class BodyFields(state: String?, endReason: String?)`;
  - `HttpRequests.playlist(command)`, `.heartbeat(command)`, `.descriptor(config): HttpRequest?`;
  - `HttpAnswers.playlist(requestId, outcome)`, `.heartbeat(beatId, outcome, read: (String) -> BodyFields)`, `.descriptor(requestId, outcome, read)`;
  - `HttpRequests.TIMEOUT_MS = 8_000`.

- [ ] **Step 1: Write the failing tests.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.Configs
import com.seazn.capture.engine.core.DescriptorCheck
import com.seazn.capture.engine.core.FetchResult
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Input
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class HttpTest {
  /** A stand-in for org.json in the glue: reads `"state":"x"` and `"endReason":"y"` from a flat body. */
  private val read: (String) -> BodyFields = { body ->
    fun field(key: String) = Regex("\"$key\":\"([^\"]*)\"").find(body)?.groupValues?.get(1)
    BodyFields(field("state"), field("endReason"))
  }

  @Test
  fun `F-P5-13 every playlist fetch is fresh`() {
    val request = HttpRequests.playlist(Command.FetchPlaylist(3, Configs.PLAYBACK_URL))
    assertEquals("GET", request.method)
    assertTrue("Cache-Control" to "no-cache" in request.headers)
    assertTrue("Pragma" to "no-cache" in request.headers)
  }

  @Test
  fun `carry 20 a 204 maps to NoContent although OkHttp counts it successful`() {
    assertEquals(Input.PlaylistFetched(3, FetchResult.NoContent), HttpAnswers.playlist(3, HttpOutcome.Answered(204, "")))
  }

  @Test
  fun `a 2xx with a body is the body, any other status is an HTTP error, and IO is a failure`() {
    assertEquals(FetchResult.Body("#EXTM3U"), HttpAnswers.playlist(1, HttpOutcome.Answered(200, "#EXTM3U")).result)
    assertEquals(FetchResult.HttpError(403), HttpAnswers.playlist(1, HttpOutcome.Answered(403, "denied")).result)
    assertEquals(FetchResult.Failed("timeout"), HttpAnswers.playlist(1, HttpOutcome.Failed("timeout")).result)
  }

  @Test
  fun `the heartbeat carries the bearer and its body, and its toString never prints the bearer`() {
    val request = HttpRequests.heartbeat(Command.PostHeartbeat(7, "https://stg.seazn.club/hb", Configs.TOKEN, """{"sid":"sess_42"}"""))
    assertTrue("Authorization" to "Bearer ${Configs.TOKEN}" in request.headers)
    assertEquals("""{"sid":"sess_42"}""", request.body)
    assertTrue(Configs.TOKEN !in request.toString())
  }

  @Test
  fun `a heartbeat answer reads the server's state and reason`() {
    val answered = HttpAnswers.heartbeat(7, HttpOutcome.Answered(200, """{"state":"completed","endReason":"stopped"}"""), read)
    assertEquals(Input.HeartbeatAnswered(7, HeartbeatResponse.Answered(200, "completed", "stopped")), answered)
    assertEquals(Input.HeartbeatAnswered(7, HeartbeatResponse.Failed("reset")), HttpAnswers.heartbeat(7, HttpOutcome.Failed("reset"), read))
  }

  @Test
  fun `carry 17 the descriptor answer echoes its request id and uses the core's rule`() {
    val over = HttpAnswers.descriptor(12, HttpOutcome.Answered(410, ""), read)
    assertEquals(Input.DescriptorChecked(12, DescriptorCheck.Over(null)), over)
    val live = HttpAnswers.descriptor(13, HttpOutcome.Answered(200, """{"state":"live"}"""), read)
    assertEquals(Input.DescriptorChecked(13, DescriptorCheck.Live), live)
    assertIs<DescriptorCheck.Unreachable>(HttpAnswers.descriptor(14, HttpOutcome.Failed("dns"), read).result)
  }

  @Test
  fun `the descriptor is asked with the session's bearer, and not at all with no URL`() {
    val config = Configs.valid(descriptorUrl = "https://stg.seazn.club/api/capture/sessions/sess_42/descriptor")
    val request = HttpRequests.descriptor(config)!!
    assertTrue("Authorization" to "Bearer ${Configs.TOKEN}" in request.headers)
    assertEquals(null, HttpRequests.descriptor(Configs.valid(descriptorUrl = "")))
  }
}
```

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.DescriptorCheck
import com.seazn.capture.engine.core.FetchResult
import com.seazn.capture.engine.core.HeartbeatResponse
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.SessionConfig

/** One request the glue's HTTP client sends as given. `toString` never prints a header's value. */
data class HttpRequest(val method: String, val url: String, val headers: List<Pair<String, String>>, val body: String?) {
  override fun toString(): String = "HttpRequest($method, headers=${headers.map { it.first }}, body=${body?.length ?: 0} chars)"
}

sealed interface HttpOutcome {
  data class Answered(val status: Int, val body: String) : HttpOutcome

  data class Failed(val message: String) : HttpOutcome
}

data class BodyFields(val state: String?, val endReason: String?)

/** CD13: the requests, as the rules want them. */
object HttpRequests {
  const val TIMEOUT_MS = 8_000L

  /** F-P5-13: never a cached manifest. */
  fun playlist(command: Command.FetchPlaylist) =
    HttpRequest("GET", command.url, listOf("Cache-Control" to "no-cache", "Pragma" to "no-cache"), null)

  fun heartbeat(command: Command.PostHeartbeat) =
    HttpRequest(
      "POST",
      command.url,
      listOf("Authorization" to "Bearer ${command.bearer}", "Content-Type" to "application/json", "Cache-Control" to "no-store"),
      command.body,
    )

  /** Null when the session has no descriptor URL: the glue answers Unreachable at once. */
  fun descriptor(config: SessionConfig): HttpRequest? =
    config.descriptorUrl.takeIf { it.isNotBlank() }?.let {
      HttpRequest("GET", it, listOf("Authorization" to "Bearer ${config.token}", "Accept" to "application/json", "Cache-Control" to "no-store"), null)
    }
}

/** CD13: the answers, as the core's inputs. */
object HttpAnswers {
  private const val NO_CONTENT = 204

  /** Carry 20: 204 first, because OkHttp's `isSuccessful` is true for it. */
  fun playlist(requestId: Int, outcome: HttpOutcome): Input.PlaylistFetched =
    Input.PlaylistFetched(
      requestId,
      when (outcome) {
        is HttpOutcome.Failed -> FetchResult.Failed(outcome.message)
        is HttpOutcome.Answered ->
          when (outcome.status) {
            NO_CONTENT -> FetchResult.NoContent
            in 200..299 -> FetchResult.Body(outcome.body)
            else -> FetchResult.HttpError(outcome.status)
          }
      },
    )

  fun heartbeat(beatId: Int, outcome: HttpOutcome, read: (String) -> BodyFields): Input.HeartbeatAnswered =
    Input.HeartbeatAnswered(
      beatId,
      when (outcome) {
        is HttpOutcome.Failed -> HeartbeatResponse.Failed(outcome.message)
        is HttpOutcome.Answered -> read(outcome.body).let { HeartbeatResponse.Answered(outcome.status, it.state, it.endReason) }
      },
    )

  /** Carry 17: the id asked with, and the core's one rule for what an answer means. */
  fun descriptor(requestId: Int, outcome: HttpOutcome, read: (String) -> BodyFields): Input.DescriptorChecked =
    Input.DescriptorChecked(
      requestId,
      when (outcome) {
        is HttpOutcome.Failed -> DescriptorCheck.Unreachable(outcome.message)
        is HttpOutcome.Answered -> read(outcome.body).let { DescriptorCheck.answered(outcome.status, it.state, it.endReason) }
      },
    )
}
```

`read` must never throw. The glue's version (Task 23) catches any parse failure and returns `BodyFields(null, null)`. An unreadable body therefore means "answered, no state", which the core treats by its status alone.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Move the `in 200..299` branch above `NO_CONTENT`. The carry 20 test fails.
  2. Drop `Pragma`. The F-P5-13 test fails.
  3. Pass `requestId + 1` in `descriptor`. The carry 17 test fails.

  Then commit: `feat(adapter): HTTP requests and answers, 204 and no-cache pinned`, with the trailer lines.

## Batch C3 — adapter logic II (pure Kotlin, JVM-tested)

### Task 9: Device readings, frame tally and the previous exit

Carry 5, F-P5-3, F-P5-4, CD20, CD22 and CD28. Every rule the device sampler, the audio effect, the counting endpoint and the exit reader follow is pure and tested here. The glue only reads Android's values and hands them in.

**Files:**

- Create: `adapter/DeviceReadings.kt`, `adapter/FrameTally.kt`, `adapter/PreviousExit.kt`
- Test: `adapter/DeviceReadingsTest.kt`, `adapter/FrameTallyTest.kt`, `adapter/PreviousExitTest.kt`

**Interfaces:**

- Consumes `DeviceSample`, `ShedStep` and `RecordEntry`.
- Produces:
  - `PcmPeak.of(buffer: ByteBuffer): Double`;
  - `class PeakMeter { offer(level); take(): Double }`;
  - `class ChargeDrain { add(monoMs, chargeUah: Long?, percent: Int?); pctPerHour(): Double? }`;
  - `Thermal.status(raw: Int?): Int?`, `Thermal.headroom(raw: Float?): Double?` and `Thermal.shed(status: Int?): ShedStep?`;
  - `data class RawDevice(thermalStatus: Int?, thermalHeadroom: Float?, batteryPercent: Int?, chargeUah: Long?, plugged: Boolean?)`;
  - `DeviceReadings.sample(raw, drain): DeviceSample`;
  - `CaptureClock.epochMs(ptsUs, monoNowUs, wallNowMs): Long`;
  - `class FrameTally { begin(attemptId); counted(mime: String?, bytes: Int); read(attemptId): FrameCount?; bytes(attemptId): Long? }`;
  - `PreviousExit.reason(code: Int): String`, `PreviousExit.entry(markerPresent: Boolean, code: Int?, exitAtMs: Long?): RecordEntry?`.

- [ ] **Step 1: Write the failing tests.** Every expected number is worked in a comment.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.ShedStep
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.Test
import kotlin.test.assertEquals

class DeviceReadingsTest {
  private fun pcm(vararg samples: Short): ByteBuffer =
    ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN).apply { samples.forEach { putShort(it) }; flip() }

  @Test
  fun `the PCM peak is the largest magnitude over full scale, and reading it moves nothing`() {
    val buffer = pcm(100, -16_384, 8_000)
    assertEquals(0.5, PcmPeak.of(buffer)) // 16384 / 32768
    assertEquals(0, buffer.position())
    assertEquals(1.0, PcmPeak.of(pcm(Short.MIN_VALUE))) // -32768 clamps to full scale
    assertEquals(0.0, PcmPeak.of(pcm()))
  }

  @Test
  fun `the meter keeps the highest peak until it is taken`() {
    val meter = PeakMeter()
    meter.offer(0.2)
    meter.offer(0.7)
    meter.offer(0.1)
    assertEquals(0.7, meter.take())
    assertEquals(0.0, meter.take())
  }

  @Test
  fun `drain is charge used over the full charge, per hour, from 5 minutes on`() {
    val drain = ChargeDrain()
    // 2 000 000 µAh at 50 %: full is 4 000 000 µAh.
    drain.add(0, 2_000_000, 50)
    drain.add(240_000, 1_990_000, 50)
    assertEquals(null, drain.pctPerHour(), "under 5 minutes is no reading")
    // 600 000 ms is 1/6 h; 20 000 µAh used is 0.5 % of full; 0.5 × 6 = 3.0 % an hour.
    drain.add(600_000, 1_980_000, 50)
    assertEquals(3.0, drain.pctPerHour())
  }

  @Test
  fun `a rising charge or a missing counter is no drain reading`() {
    val rising = ChargeDrain().apply { add(0, 1_000_000, 50); add(600_000, 1_100_000, 52) }
    assertEquals(null, rising.pctPerHour())
    val missing = ChargeDrain().apply { add(0, null, 50); add(600_000, null, 49) }
    assertEquals(null, missing.pctPerHour())
  }

  @Test
  fun `thermal readings - NaN and negative headroom are none, and shedding follows the status`() {
    assertEquals(null, Thermal.headroom(Float.NaN))
    assertEquals(null, Thermal.headroom(-1f))
    assertEquals(0.75, Thermal.headroom(0.75f))
    assertEquals(null, Thermal.status(7))
    assertEquals(listOf(null, null, ShedStep.OVERLAY_PREVIEW, ShedStep.PREVIEW_FRAMERATE, ShedStep.ENCODE, ShedStep.ENCODE, ShedStep.ENCODE), (0..6).map { Thermal.shed(it) })
  }

  @Test
  fun `carry 5 the capture time is the frame's pts placed on the wall clock`() {
    // The frame was captured 40 ms before now (now 10 000 000 µs, pts 9 960 000 µs): wall 1 790 000 000 000 − 40.
    assertEquals(1_789_999_999_960, CaptureClock.epochMs(ptsUs = 9_960_000, monoNowUs = 10_000_000, wallNowMs = 1_790_000_000_000))
  }

  @Test
  fun `charging is the plug, not the battery's own flag`() {
    val sample = DeviceReadings.sample(RawDevice(1, 0.5f, 81, 2_000_000, plugged = true), ChargeDrain())
    assertEquals(true, sample.charging)
    assertEquals(81, sample.batteryPercent)
    assertEquals(null, sample.shed)
  }
}
```

```kotlin
package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class FrameTallyTest {
  @Test
  fun `F-P5-4 only encoded frames that reached the endpoint count, video apart from audio`() {
    val tally = FrameTally()
    tally.begin(3)
    repeat(30) { tally.counted("video/avc", 4_000) }
    repeat(47) { tally.counted("audio/mp4a-latm", 300) }
    tally.counted(null, 10)
    assertEquals(FrameCount(30, 47), tally.read(3))
    assertEquals(30L * 4_000 + 47 * 300 + 10, tally.bytes(3))
  }

  @Test
  fun `a new attempt starts from zero, and an old attempt reads nothing`() {
    val tally = FrameTally()
    tally.begin(1)
    tally.counted("video/avc", 1)
    tally.begin(2)
    assertEquals(FrameCount(0, 0), tally.read(2))
    assertEquals(null, tally.read(1))
  }
}
```

```kotlin
package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertEquals

class PreviousExitTest {
  @Test
  fun `F-P5-3 a session lost with the process is recorded with the exit reason`() {
    val entry = PreviousExit.entry(markerPresent = true, code = 10, exitAtMs = 1_790_000_000_000)!!
    assertEquals("previous-session-lost", entry.kind)
    assertEquals(listOf("exit" to "user-requested", "exitAtMs" to 1_790_000_000_000L), entry.fields)
  }

  @Test
  fun `no marker is no loss, and an unread reason says so`() {
    assertEquals(null, PreviousExit.entry(markerPresent = false, code = 4, exitAtMs = 0))
    assertEquals(listOf("exit" to "unknown", "exitAtMs" to null), PreviousExit.entry(true, null, null)!!.fields)
  }

  @Test
  fun `every ApplicationExitInfo reason has its own word`() {
    // AOSP's REASON_* constants, 0 to 16, in order.
    val words =
      listOf("unknown", "exit-self", "signaled", "low-memory", "crash", "crash-native", "anr", "initialization-failure", "permission-change",
        "excessive-resource-usage", "user-requested", "user-stopped", "dependency-died", "other", "freezer", "package-state-change", "package-updated")
    assertEquals(words, (0..16).map(PreviousExit::reason))
    assertEquals("unknown", PreviousExit.reason(99))
  }
}
```

The JVM test pins the words. The ints are Android's, and Task 24 checks them against `android.jar` with `javap -constants android.app.ApplicationExitInfo` before it uses them, recording the output in the commit body.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.** The shapes follow; each body is the rule its test states.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.DeviceSample
import com.seazn.capture.engine.core.ShedStep
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/** CD28: 16-bit little-endian PCM, StreamPack's default capture format. Reads a duplicate: the encoder's buffer is never moved. */
object PcmPeak {
  private const val FULL_SCALE = 32_768.0

  fun of(buffer: ByteBuffer): Double {
    val view = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    var peak = 0
    while (view.remaining() >= 2) peak = maxOf(peak, abs(view.short.toInt()))
    return (peak / FULL_SCALE).coerceAtMost(1.0)
  }
}

/** Written on the audio thread, taken on the scheduler thread at each snapshot. */
class PeakMeter {
  private var peak = 0.0

  @Synchronized fun offer(level: Double) {
    if (level > peak) peak = level
  }

  @Synchronized fun take(): Double = peak.also { peak = 0.0 }
}

/**
 * P5: the battery percentage is too coarse for drain, and the charge counter (µAh) is not. The full
 * charge is estimated from the first sample's counter and percentage.
 */
class ChargeDrain {
  private var first: Pair<Long, Long>? = null
  private var latest: Pair<Long, Long>? = null
  private var fullUah: Double? = null

  fun add(monoMs: Long, chargeUah: Long?, percent: Int?) {
    if (chargeUah == null || chargeUah <= 0) return
    if (first == null) {
      first = monoMs to chargeUah
      if (percent != null && percent > 0) fullUah = chargeUah * 100.0 / percent
    }
    latest = monoMs to chargeUah
  }

  fun pctPerHour(): Double? {
    val (t0, c0) = first ?: return null
    val (t1, c1) = latest ?: return null
    val full = fullUah ?: return null
    val elapsed = t1 - t0
    if (elapsed < MIN_WINDOW_MS || c1 > c0) return null
    return (c0 - c1) / full * 100.0 * (3_600_000.0 / elapsed)
  }

  companion object {
    /** Judgment: a shorter window reads the counter's own steps as drain. Measured on the second OEM (Task 26). */
    const val MIN_WINDOW_MS = 300_000L
  }
}

object Thermal {
  /** `PowerManager.THERMAL_STATUS_*` is 0–6; anything else is no reading. */
  fun status(raw: Int?): Int? = raw?.takeIf { it in 0..6 }

  /** API 30's `getThermalHeadroom` returns NaN when it has no forecast; P5's Redmi read −1. */
  fun headroom(raw: Float?): Double? = raw?.takeIf { !it.isNaN() && it >= 0f }?.toDouble()

  /** CD20: moderate sheds the overlay preview, severe the preview frame rate, critical and worse the encode. */
  fun shed(status: Int?): ShedStep? =
    when (status) {
      2 -> ShedStep.OVERLAY_PREVIEW
      3 -> ShedStep.PREVIEW_FRAMERATE
      4, 5, 6 -> ShedStep.ENCODE
      else -> null
    }
}

data class RawDevice(val thermalStatus: Int?, val thermalHeadroom: Float?, val batteryPercent: Int?, val chargeUah: Long?, val plugged: Boolean?)

object DeviceReadings {
  fun sample(raw: RawDevice, drain: ChargeDrain): DeviceSample {
    val status = Thermal.status(raw.thermalStatus)
    return DeviceSample(status, Thermal.headroom(raw.thermalHeadroom), raw.batteryPercent, raw.plugged, drain.pctPerHour()?.let { Math.round(it * 10) / 10.0 }, Thermal.shed(status))
  }
}

/** Spec §2's capture timestamp: a frame's pts (the monotonic capture clock, µs) placed on the wall clock. */
object CaptureClock {
  fun epochMs(ptsUs: Long, monoNowUs: Long, wallNowMs: Long): Long = wallNowMs - (monoNowUs - ptsUs) / 1_000
}
```

`DeviceSample`'s constructor order is `(thermalStatus, thermalHeadroom, batteryPercent, charging, drainPctPerHour, shed)`. Check it in `Vocabulary.kt` before compiling.

`FrameTally` keeps an `AtomicLong` each for video, audio and bytes, and a `@Volatile` current attempt id. `begin` swaps in fresh counters, so a frame racing the swap counts toward one attempt or the other, never toward a third. `counted` classifies by `mime?.startsWith("video/")` or `"audio/"`, and adds bytes in either case. `PreviousExit.reason` indexes the word list from the test, or returns `"unknown"`. `entry` returns `RecordEntry("previous-session-lost", listOf("exit" to (code?.let(::reason) ?: "unknown"), "exitAtMs" to exitAtMs))` when the marker is present, and null otherwise.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Read the PCM samples big-endian. The peak test fails.
  2. Drop the `c1 > c0` guard. The rising-charge test fails.
  3. Count audio as video. The F-P5-4 test fails.

  Then commit: `feat(adapter): device readings, frame tally and the previous exit`, with the trailer lines.

### Task 10: Mic silencing, camera availability, and the notification's words

F-P5-8, F-P5-9, F-P5-10, carry 23 and CD16. The spike proved each rule on a device. Here they become pure and tested, and the glue (Task 23) only forwards Android's callbacks.

**Files:**

- Create: `adapter/MicSilenceWatch.kt`, `adapter/CameraAvailability.kt`, `adapter/NotificationText.kt`
- Test: `adapter/MicSilenceWatchTest.kt`, `adapter/CameraAvailabilityTest.kt`, `adapter/NotificationTextTest.kt`
- Modify: `core/build.gradle.kts`: add `systemProperty("capture.i18n", layout.projectDirectory.dir("../../../../src/i18n").asFile.absolutePath)`

**Interfaces:**

- Produces:
  - `data class RecordingConfig(sessionId: Int, silenced: Boolean)`;
  - `class MicSilenceWatch(sdk: Int) { fun update(ours: Int?, configs: List<RecordingConfig>): Boolean? }`, where non-null means changed;
  - `class CameraAvailability(selfWindowMs = 1_500)`, with `held(id: String?, monoMs)`, `selfChange(monoMs)`, `unavailable(id, monoMs): Input?`, `available(id, monoMs): Input?`, `sessionStarted(): Input?` and `sessionEnded()`;
  - `NotificationText.line(word, targetKbps: Int?, liveSinceEpochMs: Long?, nowEpochMs: Long, locale: Locale): String`;
  - `NotificationText.WORDS: Map<String, Map<String, String>>`, keyed by language and then by tally key.

- [ ] **Step 1: Write the failing tests.**

```kotlin
class MicSilenceWatchTest {
  @Test
  fun `F-P5-8 a call silences our recording only, matched by session id`() {
    val watch = MicSilenceWatch(sdk = 29)
    assertEquals(null, watch.update(ours = 41, configs = listOf(RecordingConfig(41, false))), "the first reading sets the baseline: not silenced is no change")
    assertEquals(true, watch.update(41, listOf(RecordingConfig(41, true), RecordingConfig(7, false))))
    assertEquals(null, watch.update(41, listOf(RecordingConfig(41, true))), "unchanged")
    assertEquals(null, watch.update(41, listOf(RecordingConfig(7, true))), "another app's silencing is not ours, and our absence is no change")
    assertEquals(false, watch.update(41, listOf(RecordingConfig(41, false))))
  }

  @Test
  fun `carry 23 below API 29 there is no silencing signal, so nothing is ever reported`() {
    val watch = MicSilenceWatch(sdk = 28)
    assertEquals(null, watch.update(41, listOf(RecordingConfig(41, true))))
  }

  @Test
  fun `no session id of ours is no reading`() {
    assertEquals(null, MicSilenceWatch(sdk = 33).update(null, listOf(RecordingConfig(41, true))))
  }
}
```

```kotlin
class CameraAvailabilityTest {
  private val cameras = CameraAvailability().apply { held("0", 0); sessionStarted() }

  @Test
  fun `F-P5-9 another app opening another camera while we hold ours is contention`() {
    assertEquals(Input.CameraContended, cameras.unavailable("1", 5_000))
    assertEquals(null, cameras.unavailable("2", 5_100), "already contended: one report")
  }

  @Test
  fun `F-P5-10 the last camera released while contended is a release, and our own reopen is not another app`() {
    cameras.unavailable("1", 5_000)
    cameras.unavailable("2", 5_000)
    assertEquals(null, cameras.available("1", 6_000))
    assertEquals(Input.CameraReleased, cameras.available("2", 6_100))
    assertEquals(null, cameras.unavailable("0", 7_000), "our own id is never another app")
  }

  @Test
  fun `our own switch's events inside its window are ignored`() {
    cameras.selfChange(10_000)
    assertEquals(null, cameras.unavailable("1", 10_400))
    cameras.held("1", 10_400)
    assertEquals(Input.CameraContended, cameras.unavailable("0", 12_000), "after the window, the old camera taken by another app is contention")
  }

  @Test
  fun `no session, no report, and a session starting while contended is told so`() {
    val idle = CameraAvailability().apply { held("0", 0) }
    assertEquals(null, idle.unavailable("1", 1_000))
    assertEquals(Input.CameraContended, idle.sessionStarted())
    idle.sessionEnded()
    assertEquals(null, idle.available("1", 2_000))
  }
}
```

```kotlin
class NotificationTextTest {
  @Test
  fun `CD16 the notification reads state, target and minutes on air`() {
    // Live since 47 min 30 s ago: minutes are floored.
    assertEquals("LIVE · 3000k · 47 min", NotificationText.line("Live", 3_000, 1_790_000_000_000, 1_790_002_850_000, Locale.ENGLISH))
    assertEquals("CONNECTING", NotificationText.line("Connecting", null, null, 0, Locale.ENGLISH))
    assertEquals("EN DIRECTO · 1500k · 0 min", NotificationText.line("En directo", 1_500, 0, 59_000, Locale("es")))
  }

  @Test
  fun `the words are the app's own dictionary words, in every language`() {
    val root = System.getProperty("capture.i18n")
    for ((language, words) in NotificationText.WORDS) {
      val dictionary = JSONObject(File(root, "$language.json").readText())
      for ((key, word) in words) assertEquals(dictionary.getString("stream.tally.$key"), word, "$language $key")
    }
    assertEquals(setOf("en", "es", "fr", "nl"), NotificationText.WORDS.keys)
  }
}
```

The imports are `kotlin.test.*`, `java.util.Locale`, `java.io.File`, `org.json.JSONObject` and `com.seazn.capture.engine.core.Input`.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.**
  - **`MicSilenceWatch`** keeps `last: Boolean?`. Below 29, or with no id of ours, `update` returns null. With our config absent it also returns null and keeps `last`. Otherwise it compares with `last`, which starts as `false`, so the first silenced reading is a change and the first unsilenced one is not. On a change it stores and returns the new value.
  - **`CameraAvailability`**:
    - It keeps `ours: String?`, `selfUntil: Long`, `contended: MutableSet<String>` and `inSession: Boolean`.
    - `unavailable` ignores our id and anything inside the self window. Otherwise it adds the id, and returns `CameraContended` when the set goes from empty to not empty while `inSession`.
    - `available` removes the id, and returns `CameraReleased` when the set empties while `inSession`.
    - `sessionStarted` sets `inSession` and returns `CameraContended` if the set is not empty.
    - `sessionEnded` clears `inSession`, and keeps the set: it is the device's truth, needed for the next session.
    - `held(id)` also drops `id` from `contended`.
  - **`NotificationText.WORDS`** holds the six `stream.tally.*` words (`starting`, `ready`, `connecting`, `live`, `trouble`, `ended`) for en, es, fr and nl, copied from the dictionaries. The test keeps them equal.
  - **`NotificationText.line`** upper-cases the word in `locale`. It adds `"${kbps}k"` when the target is known, and `"${minutes} min"` when the session is live, with minutes as `(now − since) / 60 000`.
  - **`NotificationText.tallyKey(state: SnapshotState): String`**, also tested, maps publishing to `live`, degraded and reconnecting to `trouble`, connecting to `connecting`, armed to `ready`, ended to `ended`, and idle to `starting`. That is plan A's plate table, without the not-ready case, which has no meaning in a notification.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Drop the self-window check. The switch test fails.
  2. Report silencing below 29. The carry 23 test fails.
  3. Change one Dutch word. The dictionary test fails.

  Then commit: `feat(adapter): mic silencing, camera availability and the notification's words`, with the trailer lines.

### Task 11: SRT options, the TLS guard, attempt signals, encoder keys and the glue's rules

F-P5-1, F-P5-6, F-P5-11, F-P5-12, R3, the B-frames finding, CD14, CD15 and CD27. These are the rules the endpoint and streamer glue would otherwise hold. `GlueRulesTest` reads the glue's source and fails on the calls this programme has paid to learn are wrong.

**Files:**

- Create: `adapter/SrtOptions.kt`, `adapter/TlsCloserGuard.kt`, `adapter/AttemptSignals.kt`, `adapter/EncoderKeys.kt`
- Test: `adapter/SrtOptionsTest.kt`, `adapter/TlsCloserGuardTest.kt`, `adapter/AttemptSignalsTest.kt`, `adapter/EncoderKeysTest.kt`, `adapter/GlueRulesTest.kt`
- Modify: `core/build.gradle.kts`: add `systemProperty("capture.glue", layout.projectDirectory.dir("../src/main/java").asFile.absolutePath)`

**Interfaces:**

- Produces:
  - `enum class SrtOpt { TRANSTYPE_LIVE, STREAMID, PASSPHRASE, LATENCY, INPUTBW, OHEADBW, MAXBW, CONNTIMEO }`, with the glue mapping each to srtdroid's `SockOpt` by name;
  - `data class SrtPlan(host: String, port: Int, before: List<Pair<SrtOpt, Any>>, maxBwBytesPerSecond: Long)`;
  - `SrtOptions.plan(target: SrtTarget, maxBw: Long?): SrtPlan?`, where null means the URL does not parse;
  - `SrtOptions.failure(t: Throwable): ConnectFailure`;
  - `TlsCloserGuard.swallows(failure: Throwable, onMainThread: Boolean): Boolean`;
  - `class AttemptSignals`, with `connected(id): Input.Connected?`, `dropped(id, cause: Throwable?): Input.Dropped?` and `connectFailed(id, t: Throwable): Input.ConnectFailed?`;
  - `EncoderKeys.videoKeys(sdk: Int): Map<String, Int>` and `EncoderKeys.rotationAtArm(displayRotation: Int): Int`.

- [ ] **Step 1: Write the failing tests.**

```kotlin
class SrtOptionsTest {
  @Test
  fun `F-P5-11 MAXBW is set in bytes per second, and a target change reaches the socket`() {
    val plan = SrtOptions.plan(Configs.srt, maxBw = 375_000)!!
    assertEquals(375_000, plan.maxBwBytesPerSecond)
    assertTrue(SrtOpt.INPUTBW to 0L in plan.before, "libsrt never estimates its own input rate")
    assertTrue(plan.before.none { it.first == SrtOpt.MAXBW }, "MAXBW is set after connect, then on every SetMaxBw")
  }

  @Test
  fun `a connect with no cap is capped at the ceiling's`() {
    // SrtBandwidth at the 3 000 000 bps ceiling, worked in plan B's LinkTest; read from there, not recomputed.
    assertEquals(SrtBandwidth.maxBwBytesPerSecond(Encode.CEILING_BPS), SrtOptions.plan(Configs.srt, maxBw = null)!!.maxBwBytesPerSecond)
  }

  @Test
  fun `the secrets go in as socket options, never in a URL`() {
    val plan = SrtOptions.plan(Configs.srt, 375_000)!!
    assertEquals("live.cloudflare.com", plan.host)
    assertEquals(778, plan.port)
    assertTrue(SrtOpt.STREAMID to Configs.STREAM_ID in plan.before)
    assertTrue(SrtOpt.PASSPHRASE to Configs.PASSPHRASE in plan.before)
    assertTrue(SrtOpt.LATENCY to 2_000 in plan.before)
    assertTrue(Configs.PASSPHRASE !in plan.toString())
  }

  @Test
  fun `F-P5-1 a host that does not resolve is reported as unresolved, never as bad parameters`() {
    assertEquals(ConnectFailure.UNRESOLVED, SrtOptions.failure(java.net.UnknownHostException("live.cloudflare.com")))
    assertEquals(ConnectFailure.TIMEOUT, SrtOptions.failure(java.net.SocketException("Connection setup failure: connection timed out")))
    assertEquals(ConnectFailure.REFUSED, SrtOptions.failure(java.net.SocketException("Connection setup failure: connection rejected")))
    assertEquals(ConnectFailure.OTHER, SrtOptions.failure(IllegalStateException("bad parameters")))
  }

  @Test
  fun `a URL with no host or port does not plan`() {
    assertEquals(null, SrtOptions.plan(SrtTarget("srt://", "s", "pppppppppp", 2_000), 1))
    assertEquals(null, SrtOptions.plan(SrtTarget("rtmps://x:1", "s", "pppppppppp", 2_000), 1))
  }
}
```

The two socket-exception messages are libsrt's `SRT_ENOSERVER` and `SRT_ECONNREJ` texts, as srtdroid surfaces them. Task 26 records the real messages from a device, and changes this test if they differ.

```kotlin
class TlsCloserGuardTest {
  private fun ktorIo(): java.io.IOException =
    java.io.IOException("Broken pipe").apply { stackTrace = arrayOf(StackTraceElement("io.ktor.network.tls.TLSClientSessionJvmKt", "closeTls", "TLS.kt", 1)) }

  @Test
  fun `F-P5-12 the TLS closer's IOException off the main thread is swallowed, and nothing else is`() {
    assertTrue(TlsCloserGuard.swallows(ktorIo(), onMainThread = false))
    assertFalse(TlsCloserGuard.swallows(ktorIo(), onMainThread = true), "never on main")
    assertFalse(TlsCloserGuard.swallows(java.io.IOException("other"), false), "not Ktor's")
    val error = OutOfMemoryError().apply { stackTrace = ktorIo().stackTrace }
    assertFalse(TlsCloserGuard.swallows(error, false), "never an Error")
    assertTrue(TlsCloserGuard.swallows(RuntimeException(ktorIo()), false), "found in the cause chain")
  }
}
```

```kotlin
class AttemptSignalsTest {
  @Test
  fun `R3 one drop per attempt, from the sink's completion, however often it is reported`() {
    val signals = AttemptSignals()
    assertEquals(Input.Connected(1), signals.connected(1))
    assertEquals(null, signals.connected(1), "a replayed open is not a second connect")
    val first = signals.dropped(1, java.io.IOException("reset"))
    assertEquals(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "IOException: reset"), first)
    assertEquals(null, signals.dropped(1, java.io.IOException("reset")), "StateFlow replays; we report once")
    assertEquals(null, signals.connected(1), "a dropped attempt never connects again")
  }

  @Test
  fun `a failed connect is reported once, and never also as a drop`() {
    val signals = AttemptSignals()
    assertEquals(ConnectFailure.UNRESOLVED, signals.connectFailed(2, java.net.UnknownHostException("h"))!!.failure)
    assertEquals(null, signals.connectFailed(2, java.net.UnknownHostException("h")))
    assertEquals(null, signals.dropped(2, null))
  }

  @Test
  fun `a clean close with no cause is a requested drop`() {
    val signals = AttemptSignals().apply { connected(3) }
    assertEquals(Input.Dropped(3, DropReason.REQUESTED, null), signals.dropped(3, null))
  }
}
```

`AttemptSignals` is for the RTMPS path and the frame path. Our own SRT sink (Task 21) reports through it too. StreamPack's `throwableFlow` is constant null in 3.2.0 (research R3), so it is never the source.

```kotlin
class EncoderKeysTest {
  @Test
  fun `P5 B-frames are off on API 29 and above, and not asked for below`() {
    assertEquals(mapOf("max-bframes" to 0), EncoderKeys.videoKeys(29))
    assertEquals(emptyMap(), EncoderKeys.videoKeys(28))
  }

  @Test
  fun `F-P5-6 the encoded rotation is fixed at arm from the side held`() {
    // Surface.ROTATION_90 = 1, ROTATION_270 = 3. Live Stream is landscape either way (ruling 4).
    assertEquals(1, EncoderKeys.rotationAtArm(1))
    assertEquals(3, EncoderKeys.rotationAtArm(3))
    assertEquals(1, EncoderKeys.rotationAtArm(0), "portrait or unknown at arm: the usual landscape")
  }
}
```

```kotlin
class GlueRulesTest {
  private val root = File(System.getProperty("capture.glue"))

  private fun sources(): List<File> = root.walkTopDown().filter { it.extension == "kt" }.toList()

  @Test
  fun `F-P5-6 no glue code calls setTargetRotation`() {
    if (!root.exists()) return // Task 20 deletes this line once the glue exists.
    for (file in sources()) assertFalse("setTargetRotation(" in file.readText(), file.path)
  }

  @Test
  fun `Review Focus 1 nothing in the glue blocks the scheduler thread`() {
    if (!root.exists()) return // Task 20 deletes this line once the glue exists.
    for (file in sources()) {
      val text = file.readText()
      assertFalse("runBlocking" in text, "${file.path}: runBlocking")
      if (!file.path.endsWith("srt/SeaznSrtSink.kt")) assertFalse("InetAddress" in text, "${file.path}: a DNS lookup outside the sink's IO dispatcher")
    }
  }

  @Test
  fun `the glue never attaches StreamPack's lifecycle observer, logs to the console, or names a service`() {
    if (!root.exists()) return // Task 20 deletes this line once the glue exists.
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("StreamerLifeCycleObserver", "android.util.Log", "println(", "streampack.services")) assertFalse(banned in text, "${file.path}: $banned")
    }
  }
}
```

The `MediaFormat.KEY_MAX_B_FRAMES` constant is the string `"max-bframes"`. The glue uses the constant, and Task 22 checks it with `javap`.

- [ ] **Step 2: Run them.** Expected: compile failure. `GlueRulesTest` passes vacuously until Task 20.

- [ ] **Step 3: Implement.**

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.SrtBandwidth
import com.seazn.capture.engine.core.SrtTarget
import java.net.URI
import java.net.UnknownHostException

enum class SrtOpt { TRANSTYPE_LIVE, STREAMID, PASSPHRASE, LATENCY, INPUTBW, OHEADBW, MAXBW, CONNTIMEO }

/** `toString` names the options and never prints their values. */
data class SrtPlan(val host: String, val port: Int, val before: List<Pair<SrtOpt, Any>>, val maxBwBytesPerSecond: Long) {
  override fun toString(): String = "SrtPlan($host:$port, options=${before.map { it.first }}, maxBw=$maxBwBytesPerSecond)"
}

/** CD14. The options our own sink sets, so no secret is ever written into an SRT URL. */
object SrtOptions {
  /** A half-open network must not park a connect: P5's spike used 15 s. libsrt's own default is 3 s. */
  private const val CONNECT_TIMEOUT_MS = 6_000

  fun plan(target: SrtTarget, maxBw: Long?): SrtPlan? {
    val uri = runCatching { URI(target.url) }.getOrNull() ?: return null
    val host = uri.host?.takeIf { uri.scheme == "srt" && it.isNotBlank() } ?: return null
    if (uri.port <= 0) return null
    val before =
      listOf(
        SrtOpt.TRANSTYPE_LIVE to true,
        SrtOpt.STREAMID to target.streamId,
        SrtOpt.PASSPHRASE to target.passphrase,
        SrtOpt.LATENCY to target.latencyMs,
        SrtOpt.INPUTBW to 0L,
        SrtOpt.OHEADBW to 25,
        SrtOpt.CONNTIMEO to CONNECT_TIMEOUT_MS,
      )
    return SrtPlan(host, uri.port, before, maxBw ?: SrtBandwidth.maxBwBytesPerSecond(Encode.CEILING_BPS))
  }

  /** F-P5-1: resolve first, so a dead DNS is UNRESOLVED and never libsrt's "bad parameters". */
  fun failure(t: Throwable): ConnectFailure {
    val text = t.message.orEmpty().lowercase()
    return when {
      t is UnknownHostException -> ConnectFailure.UNRESOLVED
      "timed out" in text || "timeout" in text -> ConnectFailure.TIMEOUT
      "rejected" in text || "refused" in text -> ConnectFailure.REFUSED
      else -> ConnectFailure.OTHER
    }
  }
}
```

The constant 6 s is judgment. It is three times libsrt's default, and well under the hold window, and Task 26 records how long real connects took. `OHEADBW` 25 is libsrt's default, written out so the plan says what it relies on. Check the `ConnectFailure` entry names in `Vocabulary.kt`.

```kotlin
package com.seazn.capture.engine.adapter

import java.io.IOException

/**
 * F-P5-12: Ktor's TLS closer throws an IOException on its own IO thread after a cut, and Android
 * kills the process for an uncaught exception on any thread. Swallow exactly that: an IOException,
 * not an Error, off the main thread, with a frame in `io.ktor.network.` somewhere in its chain.
 */
object TlsCloserGuard {
  private const val MAX_CAUSES = 8

  fun swallows(failure: Throwable, onMainThread: Boolean): Boolean {
    if (onMainThread || failure is Error) return false
    val chain = generateSequence(failure) { it.cause }.take(MAX_CAUSES).toList()
    return chain.any { it is IOException } && chain.any { link -> link.stackTrace.any { it.className.startsWith("io.ktor.network.") } }
  }
}
```

`AttemptSignals` keeps one set of attempts that have `connected` and one that have `ended` (dropped or failed). Each method returns its input only on the first report for an attempt that has not ended. A drop with a `null` cause is `DropReason.REQUESTED`; any other is `ENDPOINT_CLOSED`, with the message `Failures.describe(cause)`. It is called from the endpoint's coroutines, so its methods are `@Synchronized`.

`EncoderKeys.videoKeys(sdk)` returns `mapOf("max-bframes" to 0)` for 29 and above, and an empty map below. `rotationAtArm(r)` returns 3 for 3, and 1 for everything else.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Allow the main thread in the guard. The F-P5-12 test fails.
  2. Put `MAXBW` in `before`. The F-P5-11 test fails.
  3. Drop the `UnknownHostException` branch. The F-P5-1 test fails.
  4. Report every drop. The R3 test fails.

  Then commit: `feat(adapter): SRT options, the TLS guard, attempt signals and the glue's rules`, with the trailer lines.

## Batch C4 — the bridge core, the JVM host, and the JS bridge

### Task 12: `BridgeCore` — the engine host every platform uses

Carries 1, 12, 15, 17, 18 and 27, and CD7, CD9 and CD11. `BridgeCore` joins plan B's `Engine` to a `Platform`, and this is the one place where the rules from Tasks 4–11 meet. The Android glue (Task 20) and the JVM host (Task 13) are both thin `Platform`s around it, so every rule here is JVM-tested once and runs unchanged on the phone.

**Files:**

- Create: `adapter/BridgeCore.kt`, `adapter/Platform.kt`
- Test: `adapter/BridgeCoreTest.kt`, with a `RecordingPlatform` test double in the same file

**Interfaces:**

- Consumes everything from Tasks 4–11, plus `Engine`, `SessionRecord`, `Projection`, `Phase.attemptInHand` and `Clock`.
- Produces:

```kotlin
interface Platform {
  /** Carry out one command. Never blocks the calling (scheduler) thread; outcomes come back through BridgeCore. */
  fun execute(command: Command)

  /** One HTTP request, answered once on any thread. */
  fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit)

  /** The machine accepted an arm: ask permissions, open the camera, start the foreground service, hold the wake lock. */
  fun armed(config: SessionConfig)

  /** Cumulative counts for the attempt, or null when it is not the attempt the endpoint holds. */
  fun frames(attemptId: Int): FrameCount?

  fun link(attemptId: Int): LinkCounters?

  /** Read at every publish, on the scheduler thread. Volatile reads only. */
  fun facts(): PlatformFacts

  fun snapshot(wire: Map<String, Any?>)

  fun recordLine(line: String)
}
```

`BridgeCore(clock: Clock, scheduler: Scheduler, platform: Platform, readBody: (String) -> BodyFields)` has these methods:

- `start()`;
- `send(intent: Map<String, Any?>)`;
- `report(input: Input)`, called by the platform from any thread;
- `failure(t: Throwable)`, from any thread;
- `refused(message: String, scope: Scope)`, from any thread;
- `log(level: String, kind: String, fields: Map<String, Any?>)`;
- `current(): Map<String, Any?>`;
- `tail(): List<String>`.

`BridgeCore.shared(factory: () -> BridgeCore): BridgeCore` makes one per process.

**What `BridgeCore` does, in order of the tests:**

1. **Construction.** `current()` is the idle wire before any tick (Review Focus 2). It builds a `GuardedScheduler` over the given one, whose failure handler is `failed(t)`.
2. **`start()`.** It posts `engine.start()` onto the scheduler (carry 15), and nothing else. The network fact comes from the platform's watcher, like any other input.
3. **`send(intent)`.** It maps the intent through `IntentMapping`. An unknown kind becomes a record line, `intent-unknown`, with `intent` set to the kind if it is a plain word. Otherwise it calls `report(input)`.
4. **`report(input)`.** It posts `pollers.onInput(input)` and then `engine.send(input)`. Both are posted, so the poller and the machine see inputs in one order.
5. **The command sink.** It is `StickyFailure` around `route`:
   - `FetchPlaylist`, `PostHeartbeat` and `FetchDescriptor` become `platform.http(...)`. Each answer becomes `report(HttpAnswers.…)`.
   - A playlist answer of any kind also sets `deliveryCheckedAtMs` to `clock.wallMs()` (carry 5).
   - `FetchDescriptor` reads the held config from `engine.phase.session?.config`. With no request (a blank URL), it reports `DescriptorChecked(id, Unreachable("no descriptor url"))` at once, so the id is still echoed (carry 17).
   - Every command passes through `pollers.onCommand` first. Every other command goes to `platform.execute`.
   - An exception from `platform.execute` that `Failures.permanent` recognises becomes `sticky.fail(describe, phase.attemptInHand, Scope.PROCESS)` and is not rethrown. Any other exception is rethrown, and plan B's engine records it as `command-failed`.
6. **The snapshot sink.**
   - It builds `SnapshotWire.of(snapshot, platform.facts().copy(deliveryCheckedAtMs = checkedAt), RecordCounters(record.sinkFailures, record.reentrantDropped))`, stores it as `current`, and calls `platform.snapshot(wire)`.
   - When the state moves from `idle` to `armed`, it calls `sticky.armAccepted()` and then `platform.armed(config)`, using the config of `engine.phase` (an accepted arm, CD16 and CD21).
   - When the state moves to `ended`, it does nothing more: `Command.End` already reached the platform.
7. **The record.** It is `SessionRecord { line -> platform.recordLine(line) }`, given to the `Engine`.
8. **`log(level, kind, fields)`.** It converts each JS number that is a whole `Double` to a `Long`, so a count prints as `3`, not `3.0`. It keeps the level only if it is one of `debug`, `info`, `warn` or `error`, and otherwise uses `info`. It calls `engine.log(RecordEntry(kind, fields, level))`, which is posted (carry 12). The record renames `at`, `kind` and `level` fields (Task 3).
9. **`failed(t)`, on the scheduler thread.** It records `engine-error`, with `message` set to `Failures.describe(t)`. If `Failures.permanent(t)`, it calls `sticky.fail(…, Scope.PROCESS)`.
10. **`failure(t)` and `refused(message, scope)`.** Both post onto the scheduler. `refused` calls `sticky.fail(message, engine.phase.attemptInHand, scope)`, which reports `PlatformFailed` against the attempt in hand: before the first Connect, that is the next attempt, so an armed session ends fatal-error and named (CD11, Review Focus 3).
11. **`tail()`.** It returns `record.lastLines()`.

- [ ] **Step 1: Write the failing tests.**
  - `RecordingPlatform` records every call.
  - It answers `Connect` by reporting `Connected` through the core it was given. When `throwOnConnect` holds a `Throwable`, `execute` throws it for a `Connect` instead.
  - When `throwOnFactsOnce` holds one, the next `facts()` throws it and clears it.
  - It keeps `lines` (every record line), `snapshots` (every wire), `armed` (every config) and `http` (every request).
  - It answers HTTP from a queue the test fills.
  - It returns frames that advance 15 and 23 every read after `Connected`.
  - Its facts are ready, reachable, with a level of 0.5.
  - Drive it with the core's `FakeClock` and `FakeScheduler`, and advance with `scheduler.advanceBy`.

```kotlin
class BridgeCoreTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val platform = RecordingPlatform()
  private val core = BridgeCore(clock, scheduler, platform) { BodyFields(null, null) }.also { platform.core = it }

  private fun state() = (core.current()["state"] as Map<*, *>)["kind"]

  private fun arm(config: Map<String, Any?> = ArmWire.valid()) {
    core.send(config)
    scheduler.advanceBy(0)
  }

  @Test
  fun `Review Focus 2 the current snapshot is idle before any tick, and live once live`() {
    assertEquals("idle", state())
    core.start()
    core.report(Input.Network(true))
    arm()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state())
    assertEquals("sess_42", (core.current()["session"] as Map<*, *>)["sid"])
  }

  @Test
  fun `carry 27 native answers a stop within one tick`() {
    core.start()
    core.report(Input.Network(true))
    arm()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    core.send(mapOf("kind" to "stop"))
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("ended", state())
  }

  @Test
  fun `CD16 an accepted arm reaches the platform once, and a refused arm never does`() {
    core.start()
    arm()
    arm()
    assertEquals(1, platform.armed.size, "the second arm is ignored by the machine")
    val other = BridgeCore(clock, scheduler, RecordingPlatform()) { BodyFields(null, null) }
    other.start()
    other.send(mapOf("kind" to "arm"))
    scheduler.advanceBy(0)
    assertEquals("ended", (other.current()["state"] as Map<*, *>)["kind"])
  }

  @Test
  fun `Review Focus 3 a permission refused before the first connect ends the session fatal-error, named`() {
    core.start()
    arm()
    core.refused("camera permission refused", Scope.SESSION)
    scheduler.advanceBy(0)
    val state = core.current()["state"] as Map<*, *>
    assertEquals(listOf("ended", "fatal-error"), listOf(state["kind"], state["reason"]))
    assertEquals("sess_42", (core.current()["session"] as Map<*, *>)["sid"])
  }

  @Test
  fun `carry 18 a linkage error from a connect ends the session fatal-error and stays sticky`() {
    core.start()
    core.report(Input.Network(true))
    arm()
    platform.throwOnConnect = UnsatisfiedLinkError("libsrt.so not found")
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(Engine.TICK_MS)
    assertEquals("ended", state())
    val ended = platform.lines.map(::JSONObject).single { it.getString("kind") == "ended" }
    assertEquals("UnsatisfiedLinkError: libsrt.so not found", ended.getString("message"))
  }

  @Test
  fun `carry 15 an Error at the task boundary is recorded and the scheduler lives on`() {
    core.start()
    platform.throwOnFactsOnce = StackOverflowError("facts")
    scheduler.advanceBy(Engine.TICK_MS)
    assertTrue(platform.lines.map(::JSONObject).any { it.getString("kind") == "engine-error" && "StackOverflowError" in it.getString("message") })
    val before = platform.snapshots.size
    scheduler.advanceBy(Engine.TICK_MS * 4)
    assertEquals(before + 4, platform.snapshots.size, "every later tick still publishes")
  }

  @Test
  fun `carry 17 a descriptor ask with no URL is answered at once with its own id`() {
    core.start()
    core.report(Input.Network(true))
    arm(ArmWire.valid() + ("descriptorUrl" to ""))
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    platform.dropCurrent()
    scheduler.advanceBy(0)
    // Plan B writes `descriptor` only for an answer whose id matches the ask (SessionMachine.descriptor).
    val answered = platform.lines.map(::JSONObject).single { it.getString("kind") == "descriptor" }
    assertEquals("unreachable", answered.getString("result"))
    assertEquals("no descriptor url", answered.getString("message"))
    assertTrue(platform.http.none { "descriptor" in it.url }, "nothing was fetched")
  }

  @Test
  fun `carry 12 a forwarded JS line is written through the scheduler, its level kept and a level field renamed`() {
    core.start()
    core.log("warn", "intent.stop", mapOf("level" to "x", "count" to 3.0))
    assertTrue(platform.lines.none { "intent.stop" in it }, "not written before the scheduler runs it")
    scheduler.advanceBy(0)
    val line = JSONObject(platform.lines.single { "intent.stop" in it })
    assertEquals("warn", line.getString("level"))
    // Renamed, and masked: a field called `level` is on no allow-list (Task 3).
    assertEquals("***", line.getString("field_level"))
    assertEquals(3, line.getInt("count"))
  }

  @Test
  fun `carry 18 one engine per process`() {
    var built = 0
    val first = BridgeCore.shared { built += 1; core }
    val second = BridgeCore.shared { built += 1; core }
    assertSame(first, second)
    assertEquals(1, built)
  }
}
```

`ArmWire.valid()` is the map from `ArmMappingTest.wire()`. Move it into a shared test object, `adapter/ArmWire.kt`, and use it in both tests. `RecordingPlatform.dropCurrent()` reports `Dropped(attemptInHand, ENDPOINT_CLOSED, "cut")` through the core.

`BridgeCore.shared` holds its instance in a companion `@Volatile` field, set under `synchronized`. The test resets it through an `internal fun resetShared()`, which is annotated `@VisibleForTesting` in the KDoc only: there is no Android annotation in the core.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement `Platform.kt` and `BridgeCore.kt`** to the numbered list above. Keep each function within 10–25 lines (AGENTS §12). The class will be around 150 lines; split the HTTP routing into a private `HttpRoutes` class in the same file if it grows past that.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Call `engine.start()` directly in `start()`, not posted. No test may depend on that, but `GlueRulesTest` will not catch it either, so this mutation is recorded as **survived by design**: thread identity is a device and code-review fact. Record it in the commit body.
  2. Drop `sticky.armAccepted()`. The scope test in Task 6 still passes, so add a `BridgeCoreTest` that refuses a permission, re-arms, and connects; it must fail under this mutation.
  3. Initialise `current` lazily. Review Focus 2 fails.

  Then commit: `feat(adapter): BridgeCore hosts the engine for every platform`, with the trailer lines.

### Task 13: The JVM host

Carry 1 and CD8. A small program runs `BridgeCore` with a scripted platform, and speaks NDJSON on stdin and stdout. This is how the JS contract kit reaches the real core through the real mapping, with no phone.

**Files:**

- Modify: `modules/capture-engine/android/core/settings.gradle.kts`: add `include("host")`, and update the header comment, which says the core is consumed through `includeBuild` (CD2 reverses that)
- Create: `core/host/build.gradle.kts`, `core/host/src/main/kotlin/com/seazn/capture/engine/host/{Main.kt,ScriptedPlatform.kt,Protocol.kt,ExecutorScheduler.kt}`
- Create: `core/host/src/test/kotlin/com/seazn/capture/engine/host/ProtocolTest.kt`

**Interfaces:**

- **stdin**, one JSON object a line:
  - `{"op":"send","intent":{…}}`;
  - `{"op":"log","level":"info","kind":"x","fields":{…}}`;
  - `{"op":"exit"}`.
- **stdout**, one JSON object a line:
  - `{"ev":"ready","current":{…},"tail":[…]}`, first;
  - then `{"ev":"snapshot","body":{…}}` and `{"ev":"record","line":"…"}`.
- Nothing else is written to stdout. Diagnostics go to stderr.

- [ ] **Step 1: The build.**

```kotlin
// core/host/build.gradle.kts — the JVM host for the JS contract kit (plan C, CD8). Never shipped.
plugins {
  kotlin("jvm")
  application
}

kotlin {
  jvmToolchain(17)
  compilerOptions { allWarningsAsErrors.set(true) }
}

dependencies {
  implementation(rootProject)
  implementation("org.json:json:20240303")
  testImplementation(kotlin("test"))
}

application { mainClass.set("com.seazn.capture.engine.host.MainKt") }

tasks.test { useJUnitPlatform() }
```

- [ ] **Step 2: Write the failing protocol test.** `Protocol.toWire(json: JSONObject): Map<String, Any?>` turns every number into a `Double`, as Expo does, and every nested object into a map. `Protocol.encode(event: String, body: Any?)` writes one line through `WireJson`.

```kotlin
class ProtocolTest {
  @Test
  fun `numbers cross as doubles, as they do through Expo`() {
    val wire = Protocol.toWire(JSONObject("""{"kind":"arm","slot":2,"primary":{"latencyMs":2000},"fallback":null}"""))
    assertEquals(2.0, wire["slot"])
    assertEquals(2000.0, (wire["primary"] as Map<*, *>)["latencyMs"])
    assertEquals(null, wire["fallback"])
    assertTrue(wire.containsKey("fallback"))
  }

  @Test
  fun `an event is one line`() {
    val line = Protocol.encode("record", mapOf("line" to "{\"a\":1}\n"))
    assertFalse('\n' in line)
    assertEquals("{\"a\":1}\n", JSONObject(line).getString("line"))
  }
}
```

- [ ] **Step 3: Implement.**
  - **`ExecutorScheduler`** wraps one `ScheduledExecutorService` thread named `capture-engine`. Its `Cancellable` cancels the future.
  - **The clock** is `System.nanoTime() / 1_000_000` for monotonic time and `System.currentTimeMillis()` for wall time.
  - **`ScriptedPlatform`**:
    - It answers `Connect` with `core.report(signals.connected(id))` 100 ms later, on its own single-thread executor. From then on, `frames(id)` returns counts that grow by 15 video and 23 audio every 500 ms.
    - `Disconnect`, `Rebuild`, `StartNewSession` and `End` stop the counting, and a `Rebuild` or `StartNewSession` connects its `next` the same way.
    - Every HTTP request is answered `Failed("scripted host: no network")`. That is no evidence (CD13), so delivery stays unknown and the heartbeat counts failures, which never degrade a stream (ruling 5).
    - Its facts are `PlatformFacts(audioLevel = 0.5, cameraReady = true, networkReachable = true, survivesBackground = true)`.
    - `snapshot` and `recordLine` write events to stdout, under a lock.
  - **`Main`**:
    - It builds the core.
    - It reports `Network(true)` and calls `start()`.
    - It writes `ready`, with `current()` and `tail()`.
    - It then reads stdin line by line until `exit` or EOF.
    - On exit it shuts the executors down and exits 0.
    - A line that does not parse is written to stderr and skipped.

- [ ] **Step 4: Build and smoke it.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :host:test :host:installDist --console=plain > "$TMPDIR/host.txt" 2>&1; echo "EXIT=$?"
printf '%s\n' '{"op":"send","intent":{"kind":"start"}}' '{"op":"exit"}' | host/build/install/host/bin/host > "$TMPDIR/host-out.txt"; echo "EXIT=$?"
head -1 "$TMPDIR/host-out.txt"
```

Expected: EXIT=0 twice, and a first line starting `{"ev":"ready","current":{"state":{"kind":"idle"}`. The start is ignored from idle, and the record shows `intent-ignored`.

- [ ] **Step 5: Commit.** Use `feat(host): a JVM host for the engine contract kit`, with the trailer lines. Stage `settings.gradle.kts` and `host/` by path. `host/build/` is ignored by the core's existing `.gitignore`; check it.

### Task 14: The JS snapshot wire and arm wire

Carries 2–6 and CD5. These are pure functions in the engine module. They need no React Native, so they run in the `domain` vitest project.

**Files:**

- Create: `modules/capture-engine/src/snapshotWire.ts`, `modules/capture-engine/src/armWire.ts`
- Test: `modules/capture-engine/src/snapshotWire.test.ts`, `modules/capture-engine/src/armWire.test.ts`
- Modify: `modules/capture-engine/src/CaptureEnginePort.ts`: `Telemetry` gains `permissionsRefused: boolean`, `recordSinkFailures: number` and `recordReentrantDropped: number`. Then `FakeCaptureEngine.ts`'s `IDLE_TELEMETRY` gains `false, 0, 0`, as do any telemetry fixtures (`grep -rn "thermalHeadroom:" src test modules`).

**Interfaces:**

- `toEngineSnapshot(wire: unknown, cache?: DescriptorCache): EngineSnapshot | null`, where null means malformed;
- `createDescriptorCache(): DescriptorCache`;
- `WIRE_VOCABULARY`, an object of `ReadonlySet`s, one per vocabulary key;
- `armWire(intent: Extract<EngineIntent, { kind: 'arm' }>, deps: { appVersion: string; descriptorUrl: (sid: string) => string }): Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { descriptorToWire } from '@/domain/credentials/parseDescriptor';
import vectors from './wire/snapshot-vectors.json';
import { WIRE_VOCABULARY, createDescriptorCache, toEngineSnapshot } from './snapshotWire';

const merged = (wire: (typeof vectors.cases)[number]['wire']) => ({
  ...wire,
  telemetry: { ...vectors.telemetryBase, ...wire.telemetry },
});

describe('carries 2-6: the snapshot wire, as native writes it', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const wire = merged(c.wire);
    const snapshot = toEngineSnapshot(wire);
    expect(snapshot).not.toBeNull();
    const { descriptor, telemetry, ...rest } = snapshot!;
    const { descriptor: expectedDescriptor, ...expectedRest } = c.engine;
    expect(rest).toEqual(expectedRest);
    expect(telemetry).toEqual(wire.telemetry);
    expect(descriptor === null ? null : descriptorToWire(descriptor)).toEqual(expectedDescriptor);
  });

  it('carry 4 re-hydrates the descriptor with real Dates', () => {
    const armed = vectors.cases.find((c) => c.name === 'armed-named-with-descriptor')!;
    const descriptor = toEngineSnapshot(merged(armed.wire))!.descriptor!;
    expect(descriptor.warmingDeadline).toBeInstanceOf(Date);
    expect(Number.isNaN(descriptor.warmingDeadline.getTime())).toBe(false);
  });

  it('carry 6 knows every wire word native knows, and no other', () => {
    for (const [key, words] of Object.entries(vectors.vocabulary)) {
      expect([...WIRE_VOCABULARY[key as keyof typeof WIRE_VOCABULARY]].sort()).toEqual(
        [...words].sort(),
      );
    }
  });

  it('the same descriptor JSON gives the same object, so selectors do not re-render', () => {
    const cache = createDescriptorCache();
    const armed = merged(vectors.cases.find((c) => c.name === 'armed-named-with-descriptor')!.wire);
    expect(toEngineSnapshot(armed, cache)!.descriptor).toBe(
      toEngineSnapshot(armed, cache)!.descriptor,
    );
  });

  it.each([
    ['an unknown state', { ...merged(vectors.cases[0].wire), state: { kind: 'exploded' } }],
    ['no telemetry', { ...merged(vectors.cases[0].wire), telemetry: undefined }],
    ['an unknown camera', { ...merged(vectors.cases[0].wire), camera: 'borrowed' }],
    ['not an object', 'idle'],
  ])('reads %s as malformed, never as a state', (_why, wire) => {
    expect(toEngineSnapshot(wire)).toBeNull();
  });

  it('a descriptor that does not parse is no descriptor, and the session is still named', () => {
    const wire = merged(vectors.cases.find((c) => c.name === 'ended-refused')!.wire);
    const snapshot = toEngineSnapshot(wire)!;
    expect(snapshot.descriptor).toBeNull();
    expect([snapshot.slot, snapshot.tokenTag]).toEqual([2, 'c980ff38']);
  });
});
```

The contract kit names a session by `descriptor?.sid`. A refused arm with an unparseable descriptor would then read sid null, but JS always sends the parsed descriptor, so that cannot happen from JS. Add a `sid` field to `EngineSnapshot` only if Task 16's kit run shows otherwise, and record the reason.

```ts
import { describe, expect, it } from 'vitest';
import { descriptorToWire } from '@/domain/credentials/parseDescriptor';
import { streamSession } from '../../../test/fixtures/session';
import { armWire } from './armWire';

describe('the arm intent as native reads it (Task 4)', () => {
  const session = streamSession();
  const wire = armWire(
    {
      kind: 'arm',
      session,
      heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
    },
    {
      appVersion: '1.0.0',
      descriptorUrl: (sid) => `https://stg.seazn.club/api/capture/sessions/${sid}/descriptor`,
    },
  );

  it('flattens the session, keeping both credentials whole (C1)', () => {
    expect(wire).toMatchObject({
      kind: 'arm',
      sid: session.sid,
      slot: session.slot,
      token: session.token,
      appVersion: '1.0.0',
    });
    expect(wire.primary).toEqual(session.primary);
    expect(wire.fallback).toEqual(session.fallback);
    expect(wire.holdWindowSeconds).toEqual(session.descriptor.holdWindowSeconds);
  });

  it('carries the descriptor as the JSON it re-reads, and where to fetch it again', () => {
    expect(JSON.parse(wire.descriptorJson as string)).toEqual(descriptorToWire(session.descriptor));
    expect(wire.descriptorUrl).toBe(
      `https://stg.seazn.club/api/capture/sessions/${session.sid}/descriptor`,
    );
  });

  it('sends the heartbeat target the intent names', () => {
    expect(wire.heartbeatUrl).toBe(session.descriptor.heartbeatUrl);
    expect(wire.playbackUrl).toBe(session.descriptor.playbackUrl);
  });
});
```

`modules/` may import `test/fixtures` only from a test file. Check that the lint's boundaries allow `test` imports in `modules/**/*.test.ts`, as plan A's `FakeCaptureEngine.contract.test.ts` already does.

- [ ] **Step 2: Run them.** Expected: they fail; the modules do not exist.

- [ ] **Step 3: Implement.** `snapshotWire.ts`:

```ts
import type { SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import { parseDescriptor } from '@/domain/credentials/parseDescriptor';
import type { SessionState } from '@/domain/session/SessionState';
import type { CameraState, EngineSnapshot, Telemetry } from './CaptureEnginePort';

/** Every wire word native writes (Task 5's vocabulary), checked against the shared file. */
export const WIRE_VOCABULARY = {
  state: new Set([
    'idle',
    'armed',
    'connecting',
    'publishing',
    'degraded',
    'reconnecting',
    'ended',
  ]),
  transport: new Set(['srt', 'rtmps']),
  reconnectCause: new Set(['uplink-lost', 'video-stalled', 'not-delivered']),
  degradeReason: new Set([
    'not-delivered',
    'camera-taken',
    'mic-silenced',
    'poor-uplink',
    'fell-back-to-rtmps',
  ]),
  endReason: new Set([
    'operator-stopped',
    'stopped-by-organiser',
    'hold-window-expired',
    'fatal-error',
  ]),
  delivery: new Set(['ok', 'stalled', 'unknown']),
  shed: new Set(['overlay-preview', 'preview-framerate', 'encode']),
  heartbeatResult: new Set(['ok', 'failed', 'session-over']),
  connectFailure: new Set(['unresolved', 'refused', 'timeout', 'other']),
  camera: new Set(['own', 'taken', 'reopening', 'resuming', 'switching']),
  thermal: new Set(['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown']),
} as const;

export type DescriptorCache = { json: string | null; value: SessionDescriptor | null };

export const createDescriptorCache = (): DescriptorCache => ({ json: null, value: null });

type Wire = Record<string, unknown>;
const isObject = (value: unknown): value is Wire =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Native's `onSnapshot` body → plan A's `EngineSnapshot`. A projection, no
 * state machine (AGENTS §2). Null for anything malformed: the bridge keeps the
 * last good snapshot and records the miss, never invents a state.
 */
export function toEngineSnapshot(
  wire: unknown,
  cache: DescriptorCache = createDescriptorCache(),
): EngineSnapshot | null {
  if (!isObject(wire) || !isObject(wire.telemetry)) return null;
  const state = toState(wire.state);
  const camera =
    wire.camera === null
      ? null
      : WIRE_VOCABULARY.camera.has(wire.camera as string)
        ? (wire.camera as CameraState)
        : undefined;
  if (state === null || camera === undefined || typeof wire.reportedAtMs !== 'number') return null;
  const session = isObject(wire.session) ? wire.session : null;
  return {
    state,
    telemetry: wire.telemetry as Telemetry,
    descriptor: session ? descriptorOf(session.descriptorJson, cache) : null,
    slot: session && typeof session.slot === 'number' ? session.slot : null,
    tokenTag: session && typeof session.tokenTag === 'string' ? session.tokenTag : null,
    camera,
    reportedAtMs: wire.reportedAtMs,
    survivesBackground: wire.survivesBackground === true,
  };
}
```

`toState` checks `kind` against `WIRE_VOCABULARY.state`, and each word field against its set. It returns the matching `SessionState` variant, and null for any miss. `descriptorOf` returns the cached value when `json === cache.json`. Otherwise it runs `parseDescriptor(JSON.parse(json))` inside `try`, stores the result (`ok` gives the value, an error gives `null`), and returns it.

Telemetry is passed through as native wrote it. The vector test pins every field, and the one rename the spec wanted (`reasons.first()` into `reason`) is done natively. Check `Result`'s shape in `src/domain/Result.ts` for `ok`.

`armWire.ts`:

```ts
import { descriptorToWire } from '@/domain/credentials/parseDescriptor';
import type { EngineIntent } from './CaptureEnginePort';

type Arm = Extract<EngineIntent, { kind: 'arm' }>;

/** The arm intent flattened for native (Task 4's wire). Credentials travel whole; native scrubs and never logs them. */
export function armWire(
  { session, heartbeat }: Arm,
  deps: { readonly appVersion: string; readonly descriptorUrl: (sid: string) => string },
): Record<string, unknown> {
  const { descriptor } = session;
  return {
    kind: 'arm',
    sid: session.sid,
    slot: session.slot,
    token: session.token,
    primary: session.primary,
    fallback: session.fallback,
    holdWindowSeconds: descriptor.holdWindowSeconds,
    playbackUrl: descriptor.playbackUrl,
    heartbeatUrl: heartbeat.url,
    descriptorUrl: deps.descriptorUrl(session.sid),
    descriptorJson: JSON.stringify(descriptorToWire(descriptor)),
    appVersion: deps.appVersion,
  };
}
```

`heartbeat.token` is not sent separately. Plan A's arm builds it from `session.token` (confirm in `useStreamArm`), and native uses the one token for both the heartbeat and the descriptor (decision 4). If the two can differ, stop and raise it: that is a spec question, not an implementation detail.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Skip the cache. The identity test fails.
  2. Accept any camera word. The malformed test fails.
  3. Drop `descriptorJson`. The re-hydration test fails.

  Run `pnpm check`. Then commit: `feat(engine): read native's snapshot and write its arm`, with the trailer lines.

### Task 15: The native engine, the absent engine and the routed record

Carries 1, 7, 11 and 12, CD7 and CD23. These are the JS objects the composition root wires.

**Files:**

- Create: `modules/capture-engine/src/nativeModule.ts`, `modules/capture-engine/src/nativeCaptureEngine.ts`, `modules/capture-engine/src/absentCaptureEngine.ts`
- Test: `modules/capture-engine/src/nativeCaptureEngine.test.ts` (against a hand-written `FakeNativeModule`), `modules/capture-engine/src/absentCaptureEngine.test.ts`
- Modify: `src/services/sessionRecord.ts` (`createRingRecord` returns `RingRecord`, with `appendLine(line)`; `createRoutedRecord`), `src/services/sessionRecord.test.ts`

**Interfaces:**

```ts
// nativeModule.ts
export type Subscription = { remove(): void };
export type CaptureEngineNative = {
  send(intent: Record<string, unknown>): void;
  log(level: string, kind: string, fields: Record<string, unknown>): void;
  current(): unknown;
  tail(): readonly string[];
  addListener(event: 'onSnapshot', listener: (body: unknown) => void): Subscription;
  addListener(event: 'onRecord', listener: (body: { line: string }) => void): Subscription;
};
export function loadCaptureEngineNative(): CaptureEngineNative | null; // requireOptionalNativeModule('CaptureEngine')

// nativeCaptureEngine.ts
export type ForwardedEntry = {
  readonly level: string;
  readonly event: string;
  readonly fields: Readonly<Record<string, unknown>>;
};
export type NativeCaptureEngine = CaptureEnginePort & {
  forward(entry: ForwardedEntry): void;
  dispose(): void;
};
export function createNativeCaptureEngine(
  native: CaptureEngineNative,
  deps: {
    appVersion: string;
    descriptorUrl: (sid: string) => string;
    onRecordLine: (line: string) => void;
  },
): NativeCaptureEngine;

// absentCaptureEngine.ts
export function createAbsentCaptureEngine(now: () => number): CaptureEnginePort;

// sessionRecord.ts
export type RingRecord = SessionRecord & { appendLine(line: string): void };
export function createRoutedRecord(
  ring: RingRecord,
  route: { active(): boolean; forward(entry: LogEntry): void },
): SessionRecord;
```

The engine module may not import `services`, so `ForwardedEntry` is structurally `LogEntry` without `atMs`. Native stamps the time when it runs the line (RR-13).

- [ ] **Step 1: Write the failing tests.** `FakeNativeModule` keeps:
  - `current` as a settable wire;
  - `tail` as a settable array;
  - `sent` and `logged` arrays;
  - `emit(event, body)`;
  - a listener count, so `dispose` is provable.

```ts
describe('the native engine (carry 1)', () => {
  it("Review Focus 2 reports native's state from construction, and seeds the record from its tail", () => {
    const native = new FakeNativeModule({
      current: liveWire,
      tail: ['{"at":"…","kind":"armed","level":"info"}'],
    });
    const lines: string[] = [];
    const engine = createNativeCaptureEngine(native, {
      ...deps,
      onRecordLine: (line) => lines.push(line),
    });
    expect(engine.getSnapshot().state.kind).toBe('publishing');
    expect(lines).toEqual(native.tail);
  });

  it('sends intents as void calls, the arm flattened, and never waits on native', () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, deps);
    engine.send({
      kind: 'arm',
      session,
      heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
    });
    engine.send({ kind: 'stop' });
    expect(native.sent.map((intent) => intent.kind)).toEqual(['arm', 'stop']);
    expect(native.sent[0]).toEqual(armWire(/* the same intent */ armIntent, deps));
  });

  it('notifies subscribers on each snapshot, and keeps the last good one through a malformed body', () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, deps);
    const seen: string[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().state.kind));
    native.emit('onSnapshot', armedWire);
    native.emit('onSnapshot', { state: { kind: 'exploded' } });
    expect(seen).toEqual(['armed']);
    expect(engine.getSnapshot().state.kind).toBe('armed');
  });

  it('echoes native record lines, and forwards JS entries as void calls', () => {
    const native = new FakeNativeModule();
    const lines: string[] = [];
    const engine = createNativeCaptureEngine(native, {
      ...deps,
      onRecordLine: (line) => lines.push(line),
    });
    native.emit('onRecord', { line: 'x' });
    engine.forward({ level: 'warn', event: 'intent.stop', fields: { count: 3 } });
    expect(lines).toEqual(['x']);
    expect(native.logged).toEqual([['warn', 'intent.stop', { count: 3 }]]);
  });

  it('dispose removes every listener: a second engine over the same module does not double the record', () => {
    const native = new FakeNativeModule();
    createNativeCaptureEngine(native, deps).dispose();
    expect(native.listenerCount()).toBe(0);
  });
});
```

`liveWire` and `armedWire` are the merged `live-telemetry` and `armed-named-with-descriptor` cases from the vectors file. `deps` is `{ appVersion: '1.0.0', descriptorUrl: (sid) => \`https://stg.seazn.club/api/capture/sessions/${sid}/descriptor\`, onRecordLine: () => {} }`.

```ts
describe('the absent engine (CD23: no native module, iOS in S1)', () => {
  it('is idle, ends an arm fatal-error naming that session, and resets to idle', () => {
    const engine = createAbsentCaptureEngine(() => 1_790_000_000_000);
    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
    engine.send({
      kind: 'arm',
      session,
      heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
    });
    expect(engine.getSnapshot().state).toEqual({
      kind: 'ended',
      reason: 'fatal-error',
      durationMs: null,
    });
    expect([engine.getSnapshot().descriptor?.sid, engine.getSnapshot().tokenTag]).toEqual([
      session.sid,
      tokenTag(session.token),
    ]);
    engine.send({ kind: 'start' });
    expect(engine.getSnapshot().state.kind).toBe('ended');
    engine.send({ kind: 'reset' });
    expect(engine.getSnapshot().state).toEqual({ kind: 'idle' });
  });
});
```

Routed record, in `sessionRecord.test.ts`:

```ts
it('CD7 sends entries to native while a session exists, to the ring otherwise; reads the ring', () => {
  const ring = createRingRecord();
  const forwarded: LogEntry[] = [];
  let active = false;
  const record = createRoutedRecord(ring, {
    active: () => active,
    forward: (entry) => forwarded.push(entry),
  });
  record.append(entry('before'));
  active = true;
  record.append(entry('during'));
  ring.appendLine('{"at":"1970-01-01T00:00:00.000Z","kind":"during","level":"info"}');
  expect(forwarded.map((e) => e.event)).toEqual(['during']);
  expect(record.lines().map((line) => parseRecordLine(line).event)).toEqual(['before', 'during']);
});
```

- [ ] **Step 2: Run them.** Expected: they fail.

- [ ] **Step 3: Implement.** `createNativeCaptureEngine` works as follows:
  - It keeps `snapshot`, which starts as `toEngineSnapshot(native.current(), cache) ?? UNREPORTED`, where `UNREPORTED` is the idle snapshot with `reportedAtMs: 0`.
  - It seeds the record with `native.tail().forEach(deps.onRecordLine)`.
  - It adds the two listeners.
  - On each `onSnapshot` it parses. When the result is non-null, it stores it and notifies the subscribers.
  - `send` is `native.send(intent.kind === 'arm' ? armWire(intent, deps) : { kind: intent.kind })`.
  - `forward` is `native.log(entry.level, entry.event, entry.fields)`.
  - `dispose` removes both subscriptions.

  `createAbsentCaptureEngine` has three snapshots (idle, ended-named, idle) and no timers. `createRingRecord` gains `appendLine`, which pushes a pre-formatted line with the same capacity rule. `createRoutedRecord` delegates `lines` and `subscribe` to the ring.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Seed from `tail()` after the listeners are added, and emit a line in between. Assert the order. The seed test must fail if a line can be lost or doubled. If it cannot fail, record why.
  2. Forward while idle. The routed test fails.

  Run `pnpm check`. Then commit: `feat(engine): the native engine, the absent engine and the routed record`, with the trailer lines.

### Task 16: The contract kit, run against the bridge

Carries 1, 27 and 28, and CD8. Plan A wrote the kit to run "against the bridge". This task makes that true, and adds the two scenarios plan A's final review asked for.

**Files:**

- Create: `modules/capture-engine/src/contract/engineScenarios.ts`; this is the scenarios as data, with no vitest
- Modify: `test/engineContract.ts`, which becomes the vitest wrapper (`make` may return a promise)
- Create: `test/hostEngine.ts`, which spawns the host and returns an `EngineUnderTest` and a `Settle`
- Create: `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts`
- Modify: `vitest.config.mts`, adding a `bridge` project behind `CAPTURE_BRIDGE=1` and excluding `**/*.bridge.test.ts` from `domain`
- Modify: `.github/workflows/kotlin-core.yml`, adding a `bridge-contract` job

**Interfaces:**

```ts
// engineScenarios.ts
export type ScenarioKit = {
  readonly snapshot: () => EngineSnapshot;
  readonly send: (intent: EngineIntent) => Promise<void>;
  readonly arm: (session: StreamSession) => Promise<void>;
  readonly sendUnsettled: (intent: EngineIntent) => void;
  readonly settle: () => Promise<void>;
  readonly sessions: { readonly A: StreamSession; readonly B: StreamSession };
  readonly expect: (actual: unknown, expected: unknown, what: string) => void;
};
export type Scenario = { readonly name: string; run(kit: ScenarioKit): Promise<void> };
export const ENGINE_SCENARIOS: readonly Scenario[];
```

`expect` is injected so that the device probe (Task 19) can run the same scenarios with no vitest. Its version records `probe.fail` with the `what` and the two values' wire words, never a secret, because scenarios compare states, names and tags.

- [ ] **Step 1: Move the six scenarios** from `test/engineContract.ts` into `ENGINE_SCENARIOS`, unchanged in substance. Each `expect(x).toBe(y)` becomes `kit.expect(x, y, '<what>')`, and each `toEqual` is compared with a structural equality helper in the same file. `test/engineContract.ts` keeps `describeEngineContract(name, make, settle)`. `make` returns `EngineUnderTest | Promise<EngineUnderTest>`. The wrapper builds a `ScenarioKit` over vitest's `expect(actual).toEqual(expected)`, and declares one `it` per scenario. Run `pnpm vitest run modules/capture-engine/src/FakeCaptureEngine.contract.test.ts`: the six scenarios pass against the fake, unchanged.

- [ ] **Step 2: Add the two new scenarios, red against nothing yet.**

```ts
{
  name: 'carry 27: a stop is answered — the session is ended once the engine has settled',
  async run(kit) {
    await kit.arm(kit.sessions.A);
    await kit.send({ kind: 'start' });
    await kit.send({ kind: 'stop' });
    kit.expect(kit.snapshot().state.kind, 'ended', 'stop answered within one settle');
  },
},
{
  name: 'carry 28: a stop and an arm sent together are taken in order — the arm is ignored, the stop ends A',
  async run(kit) {
    await kit.arm(kit.sessions.A);
    kit.sendUnsettled({ kind: 'stop' });
    kit.sendUnsettled({ kind: 'arm', session: kit.sessions.A, heartbeat: { url: kit.sessions.A.descriptor.heartbeatUrl, token: kit.sessions.A.token } });
    await kit.settle();
    kit.expect(kit.snapshot().state.kind, 'ended', 'the stop ended the session');
    kit.expect(kit.snapshot().tokenTag, tokenTag(kit.sessions.A.token), 'still A, named');
    await kit.send({ kind: 'reset' });
    await kit.arm(kit.sessions.A);
    kit.expect(kit.snapshot().state.kind, 'armed', 'the same code arms again after the reset (Forget, then a re-scan)');
  },
},
```

Run both against the fake: they pass, because the fake is synchronous and ordered. That is expected. The bridge run is the one that proves them.

- [ ] **Step 3: The host harness.** `test/hostEngine.ts`:
  - It spawns `modules/capture-engine/android/core/host/build/install/host/bin/host` with `child_process.spawn`. If the file is missing, it throws: "build the host first: (cd modules/capture-engine/android/core && ./gradlew :host:installDist)".
  - It reads stdout line by line, waits for `ready`, and builds a `FakeNativeModule`-shaped adapter:
    - `current()` returns the latest snapshot body;
    - `tail()` returns the `ready` tail;
    - `send` and `log` write stdin lines;
    - `addListener` dispatches the events.
  - It wraps the adapter in `createNativeCaptureEngine`, so the kit runs the real JS bridge too.
  - **`settle`** resolves on the next `snapshot` event, or after 700 ms. That is the 500 ms tick plus slack: an ignored intent emits nothing until the tick.
  - **`dispose`** writes `exit`, and waits for the process to close (2 s at most) before killing it.

- [ ] **Step 4: The bridge test and project.** `NativeCaptureEngine.bridge.test.ts`:

```ts
import { describeEngineContract } from '../../../test/engineContract';
import { startHostEngine } from '../../../test/hostEngine';

describeEngineContract(
  'the bridge over the real Kotlin core (JVM host)',
  () => startHostEngine(),
  undefined,
);
```

`startHostEngine()` returns `{ engine, dispose, settle }`. The wrapper uses the subject's own `settle` when present. In `vitest.config.mts`, exclude `**/*.bridge.test.ts` from `domain`, and append this project only when `process.env.CAPTURE_BRIDGE === '1'`:

```ts
{
  extends: true,
  test: {
    name: 'bridge',
    include: ['modules/**/*.bridge.test.ts'],
    environment: 'node',
    // One JVM per test, each started cold: allow it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
},
```

- [ ] **Step 5: Run it.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :host:installDist --console=plain > "$TMPDIR/host.txt" 2>&1; echo "EXIT=$?"
cd "$WT" && CAPTURE_BRIDGE=1 pnpm vitest run --project bridge --reporter=json --outputFile="$TMPDIR/bridge.json" > "$TMPDIR/bridge.txt" 2>&1; echo "EXIT=$?"
node -e 'const r=require(process.env.TMPDIR+"/bridge.json");console.log(r.numTotalTests,r.numFailedTests)'
```

Expected: EXIT=0 and `8 0`. A failure here is a disagreement between the fake and native. **Native is the authority** (AGENTS §2): fix the JS bridge, the mapping, or the fake, never the core to suit a test. Record each disagreement found, and how it was resolved, in the commit body.

- [ ] **Step 6: CI.** Add this job to `kotlin-core.yml`:

```yaml
bridge-contract:
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@v5
    - uses: gradle/actions/wrapper-validation@v6
    - uses: actions/setup-java@v6
      with:
        distribution: temurin
        java-version: '17'
        cache: gradle
        cache-dependency-path: |
          modules/capture-engine/android/core/**/*.gradle.kts
          modules/capture-engine/android/core/gradle/wrapper/gradle-wrapper.properties
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v5
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: ./gradlew :host:installDist --no-daemon --console=plain
      working-directory: modules/capture-engine/android/core
    - run: pnpm vitest run --project bridge
      env:
        CAPTURE_BRIDGE: '1'
```

Copy the `pnpm/action-setup` and `setup-node` steps from `check.yml` exactly, so their pins match. Run `pnpm prettier --check .github/workflows/kotlin-core.yml`.

- [ ] **Step 7: Mutate.** Make the host's platform skip `Connected`. The start scenarios fail through the bridge and still pass against the fake. That shows the bridge run tests something the fake run does not. Restore the platform, then commit: `test(engine): run the engine contract against the real core over the bridge`, with the trailer lines.

## Batch C5 — JS product changes

`pnpm check` is the suite for every task in this batch. Each owner-visible string goes into all four dictionaries, with `"_review": "pending native speaker"` on es, fr and nl (see the dictionaries' existing convention), and a budget row in `src/i18n/budgets.test.ts`. The copy below is the plan's. CD17–CD21 mark it for the owner's review.

| Key                          | en                                                              | es                                                             | fr                                                                    | nl                                                                     | Budget |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| `stream.status.engineSilent` | Engine not responding — check the phone                         | El motor no responde: revisa el teléfono                       | Le moteur ne répond plus — vérifiez le téléphone                      | Engine reageert niet — controleer de telefoon                          | 48     |
| `stream.advisory.keepOpen`   | Keep the app open — capture stops in the background             | Mantén la app abierta: en segundo plano no graba               | Gardez l’app ouverte — en arrière-plan, rien n’est filmé              | Houd de app open — op de achtergrond stopt de opname                   | 56     |
| `stream.ended.permissions`   | Allow camera and microphone in Android Settings, then try again | Permite cámara y micrófono en Ajustes de Android y reinténtalo | Autorisez caméra et micro dans les Paramètres Android, puis réessayez | Sta camera en microfoon toe in Android-instellingen en probeer opnieuw | 72     |
| `stream.preview.stopped`     | Camera preview stopped — the session carries on                 | Vista previa detenida: la sesión continúa                      | Aperçu arrêté — la session continue                                   | Voorbeeld gestopt — de sessie gaat door                                | 56     |
| `stream.preview.show`        | Show preview                                                    | Ver vista previa                                               | Voir l’aperçu                                                         | Toon voorbeeld                                                         | 16     |
| `diag.section.engine`        | Engine                                                          | Motor                                                          | Moteur                                                                | Engine                                                                 | —      |
| `diag.lastReport`            | Last report                                                     | Último informe                                                 | Dernier rapport                                                       | Laatste melding                                                        | —      |
| `diag.recordRefused`         | Record lines refused                                            | Líneas de registro rechazadas                                  | Lignes du journal refusées                                            | Logregels geweigerd                                                    | —      |
| `diag.recordDropped`         | Record lines dropped                                            | Líneas de registro descartadas                                 | Lignes du journal abandonnées                                         | Logregels overgeslagen                                                 | —      |
| `stream.dev.probe`           | Run engine contract                                             | Ejecutar contrato del motor                                    | Lancer le contrat moteur                                              | Enginecontract uitvoeren                                               | —      |

The lengths were counted with `String.prototype.length`, and the longest is the French `keepOpen` at 56. The `stream.preview.*` keys are used by Task 25, and are added here so that the copy lands in one commit.

### Task 17: Bound the clearing (carry 27)

CD26. `useDisarm`'s clearing today waits for native forever. If a stop is never answered, the engine stays locked against every later Forget and every orphan clearing.

**Files:**

- Modify: `src/hooks/useDisarm.ts`, `src/hooks/useDisarm.test.tsx`

**Interfaces:** `useDisarm` is unchanged. The new export is `DISARM_GIVE_UP_MS = 5_000`.

- [ ] **Step 1: Write the failing test** in `useDisarm.test.tsx`. Use the fake's `suspend()` so that the stop is never answered:

```tsx
it('carry 27 gives a clearing up after 5 s with no answer, logs it, and lets the next one start', () => {
  vi.useFakeTimers();
  const view = renderDisarm({ armed: true });
  view.engine.suspend();
  act(() => view.disarm('forget'));
  expect(view.intents()).toEqual(['stop']);
  act(() => vi.advanceTimersByTime(DISARM_GIVE_UP_MS - 1));
  act(() => view.disarm('orphan'));
  expect(view.intents()).toEqual(['stop'], 'still under way: the second call is dropped');
  act(() => vi.advanceTimersByTime(1));
  expect(readRecord(view.record).map((e) => e.event)).toContain('disarm.gave-up');
  act(() => view.disarm('orphan'));
  expect(view.intents()).toEqual(['stop', 'stop'], 'the engine is free for the next caller');
});
```

Adapt `renderDisarm`, `intents()` and `suspend()` to the helpers the file already has. Read them first, and keep the assertion's substance: a 5 s bound, a record line, and a freed engine.

- [ ] **Step 2: Run it.** Expected: it fails, because no timer exists.

- [ ] **Step 3: Implement.** In `clearSession`, start `const timer = setTimeout(giveUp, DISARM_GIVE_UP_MS)`, where `giveUp` logs `logger.warn('disarm.gave-up', { action: cause })` and calls `end()`. `end` clears the timer. An answer before the timer fires ends the clearing as today, with no warning.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Never clear the timer. A test that answers in time must then see no `disarm.gave-up`. Add that test if the file has none.
  2. Do not call `end()` in `giveUp`. The new test fails on the freed engine.

  Then commit: `fix(home): give up a clearing native never answers, after 5 s`, with the trailer lines.

### Task 18: Silence, keep open, refused permissions, and the record's counters

Carries 7, 8 and 12, CD17, CD18 and CD21.

**Files:**

- Create: `src/hooks/engineSilence.ts`, `src/hooks/engineSilence.test.ts`
- Modify: `src/hooks/useViewfinder.ts` (the plate and line when silent), `src/hooks/advisory.ts`, `src/hooks/advisory.test.ts`, `src/ui/components/StreamStage.tsx` (passes `keepOpen` to `topAdvisory`), `src/ui/components/EndedBlock.tsx`, `src/hooks/engineSelectors.ts`, `src/hooks/diagnostics.ts`, `src/hooks/diagnostics.test.ts`, `modules/capture-engine/src/FakeCaptureEngine.ts` (`survivesBackground` is true while a session is armed or on air, as on Android with the service running), the four dictionaries, and `src/i18n/budgets.test.ts`
- Test: `src/ui/screens/StreamScreen.native.test.tsx` (new), which holds the screen-level assertions below

**Interfaces:**

- `ENGINE_SILENT_MS = 3_000`;
- `selectReportedAtMs(snapshot): number`;
- `isEngineSilent(kind: SessionState['kind'], reportedAtMs: number, nowMs: number): boolean`;
- `useEngineSilent(): boolean`, which is true only while armed or on air, and is computed from `useClockTick(active)`;
- `Advisory` gains `'keepOpen'`, and `topAdvisory`'s input gains `keepOpen: boolean`;
- `selectPermissionsRefused(snapshot): boolean`.

- [ ] **Step 1: Write the failing tests.** All expectations are read from the dictionaries and from spec §4's plate table, never computed by the code under test.

```ts
describe('CD17: an engine that has stopped reporting says so', () => {
  it.each([
    ['armed', 3_001, true],
    ['publishing', 3_001, true],
    ['reconnecting', 3_001, true],
    ['publishing', 3_000, false],
    ['idle', 60_000, false],
    ['ended', 60_000, false],
  ] as const)('%s, %i ms since the last report: silent %s', (kind, age, silent) => {
    expect(isEngineSilent(kind, 1_790_000_000_000, 1_790_000_000_000 + age)).toBe(silent);
  });

  it('a report from the future (an NTP step) is not silence', () => {
    expect(isEngineSilent('publishing', 1_790_000_010_000, 1_790_000_000_000)).toBe(false);
  });
});
```

`advisory.test.ts`:

```ts
it('CD18 keep-open outranks every other caption', () => {
  expect(
    topAdvisory({
      shed: true,
      overlayFailed: true,
      armed: true,
      overlayOn: true,
      charging: false,
      keepOpen: true,
    }),
  ).toBe('keepOpen');
  expect(
    topAdvisory({
      shed: false,
      overlayFailed: false,
      armed: true,
      overlayOn: true,
      charging: null,
      keepOpen: false,
    }),
  ).toBe('scoreAhead');
});
```

The screen tests in `StreamScreen.native.test.tsx` render with the fake ports (`renderWithPorts`) and drive the fake engine's scenes:

```tsx
it('CD17 a live session whose engine goes quiet reads TROUBLE and says why, and recovers on the next report', () => {
  const view = renderStream({ scene: 'live' });
  act(() => view.setNow(new Date(view.now() + 3_001)));
  expect(view.getByText(en['stream.tally.trouble'].toUpperCase())).toBeTruthy();
  expect(view.getByText(en['stream.status.engineSilent'])).toBeTruthy();
  act(() => view.engine.publishNow());
  expect(view.getByText(en['stream.tally.live'].toUpperCase())).toBeTruthy();
});

it('CD18 an armed session that would not survive the background says keep the app open', () => {
  const view = renderStream({ scene: 'armed', survivesBackground: false });
  expect(view.getByText(en['stream.advisory.keepOpen'])).toBeTruthy();
});

it('CD21 a session ended because permissions were refused says how to allow them', () => {
  const view = renderStream({ scene: 'endedFatal', permissionsRefused: true });
  expect(view.getByText(en['stream.ended.permissions'])).toBeTruthy();
});

it.each(['es', 'fr', 'nl'] as const)('CD17 the silent line reads in %s', (lang) => {
  const view = renderStream({ scene: 'live', language: lang });
  act(() => view.setNow(new Date(view.now() + 3_001)));
  expect(view.getByText(dictionaries[lang]['stream.status.engineSilent'])).toBeTruthy();
});
```

`renderStream` is a local helper. It wraps plan A's `renderWithPorts(<StreamScreen />)` with the fake engine set to the named scene, and with the given telemetry overrides applied through the fake's `publish` hook (read `FakeCaptureEngine.ts` for its name). `publishNow()` is the fake's own report: the fake reports every `REPORT_MS` and stamps `reportedAtMs` with the ports' clock. Check how the fake's timer runs under vitest fake timers, and advance it rather than calling a private method if it is not exposed. The plate is upper-cased by the component; assert the text as the component renders it.

Diagnostics, in `diagnostics.test.ts`:

```ts
it('carry 12 shows when native last reported, and the record lines it refused and dropped', () => {
  const sections = diagnosticsSections(
    withTelemetry(
      { recordSinkFailures: 2, recordReentrantDropped: 1 },
      { reportedAtMs: NOW - 4_000 },
    ),
    NOW,
    translator('en'),
  );
  const engine = sections.find((s) => s.title === en['diag.section.engine'])!;
  expect(engine.rows).toEqual([
    { label: en['diag.lastReport'], value: '4 s ago' },
    { label: en['diag.recordRefused'], value: '2' },
    { label: en['diag.recordDropped'], value: '1' },
  ]);
});
```

`'4 s ago'` is `en['diag.unit.ago']` with `{value}` set to 4. Write the literal only after you have read that template; if the template differs, use its words, still as a literal.

- [ ] **Step 2: Run them.** Expected: they fail.

- [ ] **Step 3: Implement.**
  - **`engineSilence.ts`.** `isEngineSilent` is true when `kind` is not `idle` or `ended`, and `nowMs - reportedAtMs > ENGINE_SILENT_MS`. `useEngineSilent()` reads the kind and `reportedAtMs` through `useEngineSelector`, and calls `useClockTick(active)` with `active` set to armed or on air. That is a 1 Hz tick at the hook's leaf only: it ticks only while there is a session, and it is not context (AGENTS §8).
  - **`useViewfinder`.** It calls `useEngineSilent()`. When silent, `plate` is `'trouble'` and `statusKey` is `'stream.status.engineSilent'`. This is a display rule over the projection; native's state is untouched (AGENTS §2). Add `engineSilent` to `ProjectInput`, and apply it in `project()` after the plate and key are computed.
  - **`advisory.ts`.** Add `keepOpen` first in `topAdvisory`, with its key, and `export const selectKeepOpen = (s: EngineSnapshot) => s.state.kind !== 'idle' && s.state.kind !== 'ended' && !s.survivesBackground;`. `StreamStage` passes `keepOpen: useEngineSelector(selectKeepOpen)`.
  - **`EndedBlock`.** When `selectPermissionsRefused` is true, it renders `t('stream.ended.permissions')` as a second `Text variant="status"` under the summary.
  - **`diagnostics.ts`.** A new section, `diag.section.engine`, placed last, with rows from `secondsAgo(say, nowMs, snapshot.reportedAtMs)` and the two counts.
  - **`FakeCaptureEngine.ts`.** `survivesBackground` is true while armed or on air, and false otherwise. A scene may override it, for the CD18 test.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Use `>=` for the silence rule. The 3 000 row fails.
  2. Make silence active while ended. The ended row fails.
  3. Put `keepOpen` last in `topAdvisory`. The rank test fails.
  4. Leave the plate alone when silent. The screen test fails.

  Run `pnpm check`, then `pnpm prettier --check src/i18n/*.json`. Then commit: `feat(stream): say when the engine is silent, when to keep the app open, and how to allow permissions`, with the trailer lines.

### Task 19: The composition root, and the device probe

Carry 1 and CD24. This is the one line plan A left for plan C: `createNativePorts` wires the native engine.

**Files:**

- Modify: `src/hooks/nativePorts.ts`, `src/hooks/usePorts.tsx` (`devEngine` stays a `FakeCaptureEngine | null`)
- Create: `src/hooks/engineWiring.ts`, the pure choice of engine, tested; `src/hooks/engineWiring.test.ts`
- Create: `src/hooks/useEngineProbe.ts`, `src/hooks/probeSessions.ts`, and `src/ui/components/DevProbe.tsx`, placed in `DiagnosticsScreen` beside `DevScenes`

**Interfaces:**

- `chooseEngine({ dev, fakeFlag, native, now, deps }): { engine: CaptureEnginePort; devEngine: FakeCaptureEngine | null; native: NativeCaptureEngine | null }`;
- `useEngineProbe(): { run(): void; state: 'idle' | 'running' | 'passed' | 'failed' } | null`, which is null in a release build, with the fake wired, or while a session exists;
- `PROBE_SESSIONS: { A: StreamSession; B: StreamSession }`. These are made up: `.invalid` hosts (RFC 6761, never resolvable) and https URLs on `example.invalid`.

- [ ] **Step 1: Write the failing test for the choice.**

```ts
describe('CD24: which engine the composition root wires', () => {
  const native = new FakeNativeModule();
  const deps = {
    appVersion: '1.0.0',
    descriptorUrl: (sid: string) => sid,
    onRecordLine: () => undefined,
  };

  it('a release build always wires native when the module is there', () => {
    const wired = chooseEngine({ dev: false, fakeFlag: '1', native, now: Date.now, deps });
    expect(wired.native).not.toBeNull();
    expect(wired.devEngine).toBeNull();
  });

  it('a development build wires native unless EXPO_PUBLIC_FAKE_ENGINE=1', () => {
    expect(
      chooseEngine({ dev: true, fakeFlag: undefined, native, now: Date.now, deps }).devEngine,
    ).toBeNull();
    const fake = chooseEngine({ dev: true, fakeFlag: '1', native, now: Date.now, deps });
    expect(fake.devEngine).toBe(fake.engine);
  });

  it('no native module (iOS in S1, web) wires the absent engine, which ends an arm', () => {
    const wired = chooseEngine({
      dev: false,
      fakeFlag: undefined,
      native: null,
      now: Date.now,
      deps,
    });
    expect(wired.native).toBeNull();
    wired.engine.send({
      kind: 'arm',
      session,
      heartbeat: { url: session.descriptor.heartbeatUrl, token: session.token },
    });
    expect(wired.engine.getSnapshot().state.kind).toBe('ended');
  });
});
```

- [ ] **Step 2: Run it.** Expected: it fails.

- [ ] **Step 3: Implement `chooseEngine`, and wire `createNativePorts`.**

```ts
export function createNativePorts(): Ports {
  const ring = createRingRecord();
  const env = process.env.EXPO_PUBLIC_SEAZN_ENV;
  const appVersion = Constants.expoConfig?.version ?? '0.0.0';
  const wired = chooseEngine({
    dev: __DEV__,
    fakeFlag: process.env.EXPO_PUBLIC_FAKE_ENGINE,
    native: loadCaptureEngineNative(),
    now: Date.now,
    deps: {
      appVersion,
      descriptorUrl: (sid) => descriptorUrl(descriptorOrigin(env), sid),
      onRecordLine: ring.appendLine,
    },
  });
  const record = createRoutedRecord(ring, {
    active: () => wired.native !== null && wired.engine.getSnapshot().state.kind !== 'idle',
    forward: (entry) => wired.native?.forward(entry),
  });
  const logger = createLogger({ record, now: Date.now, minLevel: __DEV__ ? 'debug' : 'info' });
  // … the rest as today, with `engine: wired.engine` and `devEngine: wired.devEngine`.
}
```

`createNativePorts` is the place AGENTS §3 names for this choice. `chooseEngine` is pure apart from constructing engines, so it is unit-tested above, and `createNativePorts` stays the thin composition it is. Recurring failure class 1 (the inert seam) is answered by Step 5's device check, which confirms the native engine is the one running. Add `EXPO_PUBLIC_FAKE_PLAYBACK_URL` to `createFakeDescriptorPort`: in a dev build, when set and https, it replaces the sample playback URL. It is a **public** URL, the one every viewer of the stg input already has.

- [ ] **Step 4: The device probe.**
  - `useEngineProbe` runs each scenario of `ENGINE_SCENARIOS` in turn against `ports.engine`, with `PROBE_SESSIONS`.
  - Its `settle` resolves on the engine's next notification, or after 700 ms.
  - Its `expect` logs `probe.fail` with `{ scene: <scenario index>, reason: <what> }` on a mismatch. Scenarios compare only states, names and tags, so nothing secret can be logged. A pass logs `probe.pass` with `{ scene }`.
  - Between scenarios it sends `stop` and then `reset`, and waits for idle, so each scenario starts as the kit does.
  - It is offered only in a dev build, with `native` wired and the engine idle.
  - `DevProbe` is one `GhostButton` labelled `t('stream.dev.probe')` and a line with the state.

Test `useEngineProbe` against the fake: wire the fake as `engine` with `devEngine: null`, run it, and assert eight `probe.pass` lines, one for each scenario, with no `probe.fail`.

- [ ] **Step 5: Run, mutate, commit.** Mutate one at a time:
  1. Return the fake in `chooseEngine` when `dev` is true, whatever the flag. The second test fails.
  2. Make `active` always true. No unit test can see this: `createNativePorts` imports `expo-*`, and plan A never unit-tested it. Record the mutation as **covered by Task 26's device check**, where Diagnostics must show JS lines while idle.

  Run `pnpm check`. Then commit: `feat(ports): wire the native engine; a dev probe runs the contract on the phone`, with the trailer lines.

## Batch C6 — Android glue I

The glue lives under `G` (`modules/capture-engine/android/src/main/java/com/seazn/capture/engine/`), in package `com.seazn.capture.engine` and its subpackages. It holds no rule (CD3). Every decision it would otherwise make is a call into `adapter/`. The suite for this batch is a compile, a local build, and the core suite (`GlueRulesTest` now reads real files).

The build commands, which are local only and never EAS:

```bash
cd "$WT" && cp package.json "$TMPDIR/package.json.bak" && pnpm expo prebuild -p android --no-install > "$TMPDIR/prebuild.txt" 2>&1; echo "EXIT=$?"; cp "$TMPDIR/package.json.bak" package.json && git diff --exit-code package.json
cd "$WT/android" && ./gradlew assembleDebug --console=plain > "$TMPDIR/assemble.txt" 2>&1; echo "EXIT=$?"
adb install -r "$WT/android/app/build/outputs/apk/debug/app-debug.apk"
```

### Task 20: The module scaffold, the scheduler thread, and the compile job

Carry 15, CD1, CD2, CD9 and CD25.

**Files:**

- Create: `modules/capture-engine/expo-module.config.json`, `modules/capture-engine/android/build.gradle`, `modules/capture-engine/android/.gitignore` (`build/`, `.gradle/`, `.cxx/`), `modules/capture-engine/android/src/main/AndroidManifest.xml`
- Create in `G`: `CaptureEngineModule.kt`, `EngineHost.kt`, `HandlerScheduler.kt`, `AndroidClock.kt`, `RecordFile.kt`, `AndroidPlatform.kt`, `HttpAdapter.kt`, `capture/Capture.kt` (the interface Task 22 implements), `capture/NoCapture.kt`
- Create: `.github/workflows/android-compile.yml`
- Modify: `core/src/test/.../adapter/GlueRulesTest.kt`, deleting the three `if (!root.exists()) return` lines

**Interfaces:**

- **JS-visible (`Name("CaptureEngine")`)**:
  - `Function("send") { intent: Map<String, Any?> -> }`;
  - `Function("log") { level: String, kind: String, fields: Map<String, Any?> -> }`;
  - `Function("current")`;
  - `Function("tail")`;
  - `Events("onSnapshot", "onRecord")`;
  - in Task 25, `View(CapturePreviewView::class)`.
- **`interface Capture`**:
  - `prepare(config: SessionConfig, rotation: Int)`;
  - `execute(command: Command)`;
  - `frames(attemptId: Int): FrameCount?`;
  - `link(attemptId: Int): LinkCounters?`;
  - `facts(): CaptureFacts`, where `data class CaptureFacts(audioLevel: Double, cameraReady: Boolean, captureTimestampMs: Long?)`;
  - `release()`.

- [ ] **Step 1: Write the module config and build.**

```json
{
  "platforms": ["android"],
  "android": { "modules": ["com.seazn.capture.engine.CaptureEngineModule"] }
}
```

```groovy
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'com.seazn.capture.engine'
version = '0.1.0'

android {
  namespace "com.seazn.capture.engine"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
  }
  // CD2: the pure core and adapters compile into this library, so no settings.gradle edit and no
  // composite build. Their own Gradle build (core/) still runs every JVM test in CI.
  sourceSets {
    main.java.srcDirs += ['core/src/main/kotlin']
  }
  lintOptions {
    abortOnError false
  }
}

// Strict pins (Global Constraints). Kotlin 2.1.20 cannot read 2.3+ metadata: nothing newer without a real build.
dependencies {
  ['core', 'ui', 'srt', 'rtmp'].each { part ->
    implementation("io.github.thibaultbee.streampack:streampack-$part") { version { strictly '3.2.0' } }
  }
  implementation('io.github.thibaultbee.srtdroid:srtdroid-ktx') { version { strictly '1.10.1' } }
  // komuxer's RTMP client and the Ktor it brings (research §Toolchain): read their exact coordinates with
  // `./gradlew :capture-engine:dependencies --configuration releaseRuntimeClasspath`, then pin them here,
  // strictly, at komuxer 0.4.0 and Ktor 3.3.3.
  implementation 'com.squareup.okhttp3:okhttp'
}
```

Prebuild's `settings.gradle` names the project after its directory. Confirm that it is `:capture-engine` with `./gradlew projects` and use the real name. OkHttp's version comes from React Native's platform constraints. Confirm with `dependencies` that one OkHttp resolves, and record the version in the commit. Replace the komuxer comment with the two pinned lines once you have read the coordinates: the comment is an instruction for this step, and must not survive into the commit.

- [ ] **Step 2: Write the manifest.** It merges into the app; no config plugin is needed (CD25 checks the merge).

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <application>
    <!-- AGENTS §9: camera + microphone, started from the foreground at an accepted arm only (CD16). -->
    <service
      android:name="com.seazn.capture.engine.CaptureForegroundService"
      android:exported="false"
      android:foregroundServiceType="camera|microphone" />
  </application>
</manifest>
```

The service class arrives in Task 24. Until then the manifest names a class that does not exist, which compiles and is never started. Task 24's merged-manifest check covers it.

- [ ] **Step 3: The scheduler thread and clock.**

```kotlin
package com.seazn.capture.engine

import android.os.Handler
import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Scheduler

/** CD9: the engine's one serial thread. `postDelayed` runs on uptime; the wake lock (CD10) keeps uptime and the clock together. */
class HandlerScheduler(private val handler: Handler) : Scheduler {
  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    val runnable = Runnable(task)
    handler.postDelayed(runnable, delayMs)
    return Cancellable { handler.removeCallbacks(runnable) }
  }
}
```

```kotlin
package com.seazn.capture.engine

import android.os.SystemClock
import com.seazn.capture.engine.core.Clock

object AndroidClock : Clock {
  override fun monotonicMs(): Long = SystemClock.elapsedRealtime()

  override fun wallMs(): Long = System.currentTimeMillis()
}
```

- [ ] **Step 4: `EngineHost`, `AndroidPlatform`, `HttpAdapter`, `RecordFile` and the module.**
  - **`EngineHost`** is an `object`. `core(context)` returns `BridgeCore.shared { … }`, which builds the `HandlerThread("capture-engine")`, the `AndroidPlatform` and the core, then calls `core.start()`. It keeps a `@Volatile var listener: ((String, Map<String, Any?>) -> Unit)?`, which the module sets on create and clears on destroy. There is one core per process (carry 18). A JS reload makes a new module over the same core.
  - **`AndroidPlatform(context, capture: Capture, http: HttpAdapter, record: RecordFile)`** implements `Platform`. It holds no rule:
    - `execute` passes to `capture.execute`;
    - `http` passes to `HttpAdapter`;
    - `armed` calls `capture.prepare(config, EncoderKeys.rotationAtArm(displayRotation()))`;
    - `frames` and `link` pass to `capture`;
    - `facts` merges `capture.facts()` with the network fact and the keeper's fact, in Tasks 23 and 24;
    - `snapshot` calls the listener with `onSnapshot`;
    - `recordLine` calls `record.append(line)` and the listener with `onRecord` and `mapOf("line" to line)`.

    `displayRotation()` reads `context.display.rotation` on API 30+ and the window manager's default display below. It is read once, at the accepted arm, and never again for that session (P4).

  - **`HttpAdapter(client: OkHttpClient)`** builds the client with `cache(null)`, and connect, read and call timeouts of `HttpRequests.TIMEOUT_MS`. `http(request, answer)` makes an OkHttp `Request` from `HttpRequest` (method, url, headers, and a JSON body when present), and `enqueue`s it.
    - On a response, it answers `HttpOutcome.Answered(code, body.string())`, with the body read inside `use`.
    - On failure, it answers `HttpOutcome.Failed(e.javaClass.simpleName)`. That is the class name only, because OkHttp's messages can quote the URL. The scrub would mask a held secret anyway, but a playback URL is not held.

    `readBody(text)` parses with `org.json`, reads `optString("state")` and `optString("endReason")` (blank becomes null), and returns `BodyFields(null, null)` on any exception (Task 8).

  - **`RecordFile(dir: File)`** appends each line plus `\n` to `session-record.ndjson` on its own single-thread executor, so no file IO happens on the scheduler thread. At 5 MB it rotates to `session-record.1.ndjson`, replacing the old one. Its failures are counted, never thrown.
  - **`NoCapture`** implements `Capture` for this task only. `prepare` throws `PermanentPlatformFailure("capture not built")`, which `BridgeCore` turns into a sticky fatal end, so the first device run proves the bridge, the failure path and the named end with no camera at all. Every other method is a no-op or returns null. Task 22 replaces it and deletes the file.
  - **`CaptureEngineModule`**:

```kotlin
package com.seazn.capture.engine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The Expo bridge (spec §3 _Bridge_): intents in, snapshots and record lines out. Holds no rule. */
class CaptureEngineModule : Module() {
  private val core by lazy { EngineHost.core(appContext.reactContext ?: error("no React context")) }

  override fun definition() = ModuleDefinition {
    Name("CaptureEngine")
    Events("onSnapshot", "onRecord")

    OnCreate { EngineHost.listener = { event, body -> sendEvent(event, body) } }
    OnDestroy { EngineHost.listener = null }

    // Intents, not RPC (AGENTS §2): every one returns nothing.
    Function("send") { intent: Map<String, Any?> -> core.send(intent) }
    Function("log") { level: String, kind: String, fields: Map<String, Any?> -> core.log(level, kind, fields) }
    Function("current") { core.current() }
    Function("tail") { core.tail() }
  }
}
```

`sendEvent` drops events while JS has no listener. That is the research's `OnStartObserving` gate, and it is harmless here: `current()` answers the first read (Review Focus 2), and JS subscribes at construction.

- [ ] **Step 5: Remove the vacuous guard in `GlueRulesTest`.** Run the core suite: the three glue rules now read real files and pass. Mutate by adding a scratch line `// setTargetRotation(` to `HandlerScheduler.kt`: the F-P5-6 rule fails. The rule reads text, so a comment counts, which is deliberate. Restore from the `cp` backup.

- [ ] **Step 6: The compile job.** Create `.github/workflows/android-compile.yml`:

```yaml
# The Android library and app compile (S1 plan C, spec §6, CD25). Gradle, never EAS.
# Path-filtered, so it is not a required check: a filtered workflow never reports on a PR it skips.
name: android-compile

on:
  pull_request:
    paths:
      - 'modules/**'
      - 'app.json'
      - 'plugins/**'
      - 'pnpm-lock.yaml'

concurrency:
  group: android-compile-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  assemble-debug:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '17'
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm expo prebuild -p android --no-install
      - run: ./gradlew assembleDebug --no-daemon --console=plain
        working-directory: android
```

Copy the pnpm and node steps from `check.yml`, so the pins match. The runner image carries an Android SDK; if `sdkmanager` licences block the build, add `android-actions/setup-android@v3` before prebuild, and record why.

- [ ] **Step 7: Build locally, and run the first device check.** Run prebuild (reverting `package.json`), then `assembleDebug`. Expected: EXIT=0. Then confirm the merged manifest:

```bash
cd "$WT/android" && grep -c 'FOREGROUND_SERVICE_CAMERA\|CaptureForegroundService' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml
```

Expected: 2 or more. Install the APK with `adb`, open the app, scan a made-up test code (the owner's hands; list the step), and hold Go live. Expected: the viewfinder reads Ended with the fatal line, and Diagnostics' record shows `engine-error` or `platform-failed` naming "capture not built". The session is named, and its code is kept. This is the bridge's first proof on a phone. It is the absent-capture path, deliberately.

- [ ] **Step 8: Commit** with the message `feat(engine): the Expo module, its scheduler thread and the compile job`, and the trailer lines. Stage by path: `modules/capture-engine/expo-module.config.json`, `modules/capture-engine/android/{build.gradle,.gitignore,src}`, `.github/workflows/android-compile.yml` and the `GlueRulesTest` change. Never stage `android/` (the root prebuild output) or `package.json`.

### Task 21: Our SRT sink, the endpoints, and the RTMP guard

F-P5-1, F-P5-4, F-P5-11, F-P5-12, R3, CD14 and CD15.

**Files:**

- Create in `G`: `srt/SeaznSrtSink.kt`, `srt/NOTICE.md` (the Apache-2.0 attribution for the adapted `SrtSink`), `endpoints/CaptureEndpointFactory.kt`, `endpoints/RoutingEndpoint.kt`, `endpoints/CountingEndpoint.kt`, `endpoints/RtmpDispatcher.kt`, `endpoints/TlsGuard.kt`

**Interfaces:**

- `SeaznSrtSink(dispatcher, signals: AttemptSignals, report: (Input) -> Unit)`, with `next(plan: SrtPlan, attemptId: Int)`, `setMaxBw(bytesPerSecond: Long)` and `counters(): LinkCounters?`;
- `CaptureEndpointFactory(tally: FrameTally, srtSink: () -> SeaznSrtSink, rtmpDispatcher: CoroutineDispatcher) : IEndpointInternal.Factory`;
- `CountingEndpoint(inner: IEndpointInternal, tally: FrameTally) : IEndpointInternal by inner`;
- `RtmpDispatcher.create(): CoroutineDispatcher`;
- `TlsGuard.install(mode: TlsGuard.Mode)`, where `Mode` is `SCOPED` or `GLOBAL`, and `TlsGuard.MODE`.

- [ ] **Step 1: Read the shapes from the jar.** Read them before writing; the research doc lists them, and `javap` is authoritative:

```bash
cd "$WT/android" && ./gradlew :capture-engine:dependencies --configuration debugRuntimeClasspath > "$TMPDIR/deps.txt"; grep -n 'streampack\|srtdroid\|komuxer\|ktor' "$TMPDIR/deps.txt" | head -40
```

Unpack `streampack-core-3.2.0.aar`'s `classes.jar` from the Gradle cache, then run `javap` on these classes:

- `elements.endpoints.composites.sinks.AbstractSink`;
- `ISinkInternal`;
- `elements.endpoints.composites.CompositeEndpointWithMetricsFactory` (or `CompositeEndpoint`'s constructor);
- `elements.endpoints.composites.muxers.ts.TsMuxer`;
- `elements.data.Packet`;
- srtdroid-ktx 1.10.1's `CoroutineSrtSocket`. Its `send` consumes the buffer in 1.10.x, and `trySend` exists.

Write each signature you rely on into the commit body.

- [ ] **Step 2: `SeaznSrtSink`.** It is adapted from StreamPack's `SrtSink` (Apache-2.0; keep its header and add ours). Its differences are this plan's rules.

```kotlin
/**
 * Our SRT sink (CD14). StreamPack's SrtSink sets MAXBW 0 and INPUTBW in bits, where libsrt reads
 * bytes (F-P5-11). This one sets every option from [SrtOptions], resolves the host first on its IO
 * dispatcher (F-P5-1), never builds a URL that holds a secret, and reports one drop per attempt from
 * the socket's completion (R3).
 */
class SeaznSrtSink(
  private val dispatcher: CoroutineDispatcher,
  private val signals: AttemptSignals,
  private val report: (Input) -> Unit,
) : AbstractSink() {
  private var socket: CoroutineSrtSocket? = null
  @Volatile private var pending: Pair<SrtPlan, Int>? = null
  @Volatile private var attemptId: Int? = null

  /** Set by the streamer adapter before `startStream`; the descriptor it passes carries host and port only. */
  fun next(plan: SrtPlan, attemptId: Int) {
    pending = plan to attemptId
  }

  override suspend fun openImpl(mediaDescriptor: MediaDescriptor) =
    withContext(dispatcher) {
      val (plan, id) = pending ?: throw IllegalStateException("no SRT plan for this connect")
      val address = InetAddress.getByName(plan.host) // F-P5-1: UnknownHostException → UNRESOLVED
      val opened = CoroutineSrtSocket(dispatcher)
      for ((option, value) in plan.before) opened.setSockFlag(sockOpt(option), value)
      opened.connect(InetSocketAddress(address, plan.port))
      opened.setSockFlag(SockOpt.MAXBW, plan.maxBwBytesPerSecond) // F-P5-11: after connect, in bytes per second
      opened.socketContext.invokeOnCompletion { cause -> signals.dropped(id, cause)?.let(report) }
      socket = opened
      attemptId = id
    }

  override suspend fun write(packet: Packet): Int = socket?.send(packet.buffer) ?: throw IOException("SRT socket not open")

  fun setMaxBw(bytesPerSecond: Long) {
    socket?.setSockFlag(SockOpt.MAXBW, bytesPerSecond)
  }

  /** One reading for the Link poller (CD12). A JNI call, quick and non-blocking: allowed on the scheduler thread. */
  fun counters(): LinkCounters? =
    socket?.bistats(clear = false, instantaneous = true)?.let {
      LinkCounters(it.byteSentTotal, it.pktSentTotal, it.pktRetransTotal, it.pktSndDropTotal, it.pktSndLossTotal.toLong(), it.msRTT.toInt(), it.msSndBuf.takeIf { ms -> ms >= 0 }, (it.mbpsBandwidth * 1_000_000).toLong())
    }

  override suspend fun closeImpl() {
    socket?.close()
    socket = null
  }

  private fun sockOpt(option: SrtOpt): SockOpt =
    when (option) {
      SrtOpt.TRANSTYPE_LIVE -> SockOpt.TRANSTYPE
      else -> SockOpt.valueOf(option.name)
    }
}
```

`TRANSTYPE_LIVE`'s value is `Transtype.LIVE`. Map `true` to it in the `setSockFlag` loop, with an explicit `when` on the value's type rather than a cast. `AbstractSink`'s abstract members (`supportedSinkTypes`, `isOpenFlow`, `metrics` and the rest) are implemented as StreamPack's own `SrtSink` implements them, copied, with `supportedSinkTypes = listOf(MediaSinkType.SRT)`. The `report` path posts through `BridgeCore.report`, so a drop reaches the machine on its thread.

- [ ] **Step 3: The endpoints.**
  - **`CaptureEndpointFactory.create(context, dispatcherProvider)`** returns `CountingEndpoint(RoutingEndpoint(srt = CompositeEndpointWithMetrics(TsMuxer(), sink), rtmp = RtmpEndpointFactory().create(context, RtmpDispatcherProvider(dispatcherProvider, rtmpDispatcher))), tally)`. Use the composite's real constructor or factory, read in Step 1.
  - **`RoutingEndpoint`** implements `IEndpointInternal`. `open(descriptor)` chooses `srt` for a `SrtMediaDescriptor`, and `rtmp` otherwise, and records the choice. Every other member delegates to the chosen endpoint, or to `srt` before any choice. `isOpenFlow` and `throwableFlow` are its own `MutableStateFlow`s, mirrored from the chosen endpoint by one collector job per open.
  - **`CountingEndpoint`** overrides only `write`. It calls `tally.counted(frame.format.getString(MediaFormat.KEY_MIME), frame.rawBuffer.remaining())` and then `inner.write(frame, streamPid)` (F-P5-4: frames that reached the endpoint).
  - **`RtmpDispatcherProvider`** overrides `io` to return the RTMP dispatcher, and delegates everything else.
  - **`RtmpDispatcher.create()`** is `Executors.newFixedThreadPool(2) { r -> Thread(r, "rtmp-io").apply { uncaughtExceptionHandler = TlsGuard.handler(previous = null) } }.asCoroutineDispatcher()`.
  - **`TlsGuard.handler(previous)`** swallows when `TlsCloserGuard.swallows(e, Looper.getMainLooper().isCurrentThread)`, and records `tls-closer-swallowed` through `EngineHost.core.log` (the message masked by the scrub). Otherwise it calls `previous`, or rethrows on the thread.
  - **`TlsGuard.install(GLOBAL)`** wraps `Thread.getDefaultUncaughtExceptionHandler()` once (the spike's fallback). `MODE` is `SCOPED`, and Task 26 decides.

  Ktor may run its TLS closer on `Dispatchers.IO` rather than on the endpoint's `io`, in which case the scoped handler never sees it. That is exactly what Task 26's ten-cut test proves or disproves. Write `SCOPED` here, and switch `MODE` only on that evidence.

- [ ] **Step 4: Build.** Run `assembleDebug` (EXIT=0) and the core suite (`GlueRulesTest`: `InetAddress` only in `srt/SeaznSrtSink.kt`; no `runBlocking`).

- [ ] **Step 5: Commit** with the message `feat(engine): our SRT sink, the routed endpoint, and a scoped TLS guard`, and the trailer lines. The body lists every StreamPack and srtdroid signature read in Step 1.

### Task 22: The streamer adapter, the slate, and the audio level

P4, F-P5-6, the B-frames finding, CD27 and CD28. This replaces `NoCapture`.

**Files:**

- Create in `G`: `capture/StreamerAdapter.kt`, `capture/SlateSource.kt`, `capture/AudioLevelEffect.kt`, `res/drawable/slate.xml` (the card: the camera glyph and the Seazn mark on night, with no words)
- Delete: `capture/NoCapture.kt`
- Modify: `EngineHost.kt` (wires `StreamerAdapter`)

**Interfaces:** `StreamerAdapter(context, scope, tally: FrameTally, signals: AttemptSignals, cameras: CameraAvailability, meter: PeakMeter, report: (Input) -> Unit, failure: (Throwable) -> Unit) : Capture`, and `val streamer: StateFlow<SingleStreamer?>`, which the preview view reads in Task 25.

**What it does.** Every command runs on `scope` (`Dispatchers.Default` plus a `SupervisorJob`) under one `Mutex`, so no two StreamPack calls interleave. Nothing blocks the scheduler thread: `execute` launches and returns.

| Command                           | StreamPack calls                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reports                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prepare(config, rotation)`       | `cameraSingleStreamer(context, cameraId = back camera, audioSourceFactory = MicrophoneSourceFactory(), endpointFactory = CaptureEndpointFactory(…), defaultRotation = rotation)`; `setAudioConfig(AAC-LC 128k 48 kHz stereo)`; `setVideoConfig(H.264 1280×720 30 fps, gop 2 s, start Encode.START_BPS, customize = EncoderKeys.videoKeys(SDK_INT))`; add `AudioLevelEffect(meter)` to `audioInput.processor`; `cameras.held(id)`; `cameras.sessionStarted()` | `cameras.sessionStarted()`'s input, if any. A thrown codec error becomes `failure(PermanentPlatformFailure("encoder: …", e))`                                            |
| `Connect(id, target, bps, maxBw)` | `tally.begin(id)`; `videoEncoder.bitrate = bps`; SRT: `sink.next(SrtOptions.plan(target, maxBw), id)` then `startStream(SrtMediaDescriptor(SrtUrl(host, port), serviceInfo))`; RTMPS: `startStream(target.url.trimEnd('/') + "/" + URLEncoder.encode(target.streamKey, "UTF-8"))`                                                                                                                                                                            | success: `signals.connected(id)`; a throw: `signals.connectFailed(id, t)` (with `SrtOptions.failure`); a null plan: `ConnectFailed(id, OTHER, "srt url does not parse")` |
| `Disconnect(id)`                  | `stopStream()`, `close()`                                                                                                                                                                                                                                                                                                                                                                                                                                    | none (the machine asked)                                                                                                                                                 |
| `Rebuild` / `StartNewSession`     | `stopStream()`, `close()`, then `Connect(next)` as above. These are the same calls as the manual reconnect that healed F-P5-6 in P5                                                                                                                                                                                                                                                                                                                          | as Connect                                                                                                                                                               |
| `SetBitrate(id, bps)`             | `videoEncoder?.bitrate = bps`                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                                                     |
| `SetMaxBw(id, b)`                 | `sink.setMaxBw(b)` (F-P5-11)                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                     |
| `SwitchCamera`                    | `cameras.selfChange(now)`; `setVideoSource(CameraSourceFactory(other))`; `cameras.held(other)`                                                                                                                                                                                                                                                                                                                                                               | none; frames keep coming (carry 19)                                                                                                                                      |
| `ReopenCamera`                    | `cameras.selfChange(now)`; `setVideoSource(CameraSourceFactory(id))`                                                                                                                                                                                                                                                                                                                                                                                         | `CameraReopened(ok)`                                                                                                                                                     |
| `Slate(on)`                       | on: `setVideoSource(SlateSource.factory(context))`, `audioInput.isMuted = true`; off: camera source back, `isMuted = false`                                                                                                                                                                                                                                                                                                                                  | none                                                                                                                                                                     |
| `End`                             | `stopStream()`, `close()`, `release()`; `streamer.value = null`; `cameras.sessionEnded()`; `tally.begin(-1)`                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                     |

**Rules:**

- An RTMPS endpoint closing without our asking is a drop. Collect the endpoint's `isOpenFlow` and call `signals.dropped(id, IOException("endpoint closed"))` when it goes false and no stop was requested for that attempt.
- **`setTargetRotation` is never called** (F-P5-6, CD27). `GlueRulesTest` enforces it.
- The streamer is built once per accepted arm, with that arm's rotation, and released at `End`. Reconnects reuse it. That bounds #306's per-streamer surface leak to one per session. Task 26 measures RSS across 20 reconnects to see whether the leak follows `startStream` instead.
- `serviceInfo` is a `TSServiceInfo` named "Seazn" by provider "Seazn Capture". It carries no session data.
- `KEY_MAX_B_FRAMES` is the constant `MediaFormat.KEY_MAX_B_FRAMES`, and its value must equal `EncoderKeys`' `"max-bframes"`. Check with `javap -constants android.media.MediaFormat` against `android.jar`, and record the output.
- `facts()` returns `CaptureFacts(meter.take(), cameraReady = streamer != null && cameraOpened, captureTimestampMs = tally.lastVideoEpochMs())`, where the counting endpoint records each video frame's `CaptureClock.epochMs(frame.ptsInUs, nowUs, wallNowMs)`. StreamPack's pts clock must be the one `nowUs` reads. Read `TimeUtils` in the jar, and use the same source (`System.nanoTime() / 1000` or `SystemClock.elapsedRealtimeNanos() / 1000`).
- **`SlateSource`** is StreamPack's `BitmapSourceFactory` over a 1280×720 bitmap, drawn once from `res/drawable/slate.xml` onto `ground` (`#150b36`) with the camera glyph and the Seazn mark in `ink`. It has no words (spec §3), so it needs no translation. The colour literals live in `res/values/colors.xml` as named tokens copied from `src/ui/theme/tokens.ts`.

- [ ] **Step 1: Write the adapter, the slate and the effect** to the table and rules above. Keep each `when` branch to one call into a private function of 10–25 lines.

- [ ] **Step 2: Build.** Run `assembleDebug` (EXIT=0) and the core suite. Then make the first live device check (the owner's hands): arm a hand-made v2 code for the raw stg input (Task 26, prerequisites), hold Go live, and confirm in Diagnostics that the state reaches publishing, that the fps reads about 30, and that `srt` counters move. Stop. Then the owner deletes the recording (`DELETE /stream/{video_uid}`).

- [ ] **Step 3: Commit** with the message `feat(engine): capture and publish with StreamPack, never rotating the encode`, and the trailer lines.

## Batch C7 — Android glue II and the preview

### Task 23: The watchers — camera, microphone, network and device

F-P5-8, F-P5-9, F-P5-10, carry 5, carry 23 and CD20. Each watcher turns an Android callback into a call on its pure rule (Tasks 9–10), and reports through `BridgeCore.report`.

**Files:**

- Create in `G`: `watch/CameraWatch.kt`, `watch/MicWatch.kt`, `watch/NetworkWatch.kt`, `watch/DeviceSampler.kt`
- Modify: `EngineHost.kt` (starts them with the core), `AndroidPlatform.kt` (`facts()` includes `networkReachable`)

**Interfaces:**

- `CameraWatch(context, rule: CameraAvailability, report)`, with `start()` and `stop()`;
- `MicWatch(context, sessionId: () -> Int?, rule: MicSilenceWatch, report)`;
- `NetworkWatch(context, report)`, with `@Volatile val reachable: Boolean`;
- `DeviceSampler(context, scheduler, report)`, which samples every 10 s.

**What each does:**

- **`CameraWatch`.** It registers `CameraManager.AvailabilityCallback` on the main looper. `onCameraUnavailable(id)` and `onCameraAvailable(id)` call the rule with `SystemClock.elapsedRealtime()`, and report a non-null result. Each callback is wrapped in `runCatching`, with its failure recorded, because a callback that throws on the main thread kills the app (the spike's guarded callbacks). It is registered at process start, so the contended set is true before the first arm (`sessionStarted` re-reports it).
- **`MicWatch`.** On API 29+ it registers `AudioManager.AudioRecordingCallback`. Each `onRecordingConfigChanged(configs)` maps to `RecordingConfig(c.clientAudioSessionId, c.isClientSilenced)` and calls the rule. Our id is read the way the spike read it, by reflection on `MicrophoneSource`'s `AudioRecord` field. Name the field, with its `javap` evidence, in the commit body. A reflection failure is recorded once, and the watch stays off: no silencing is reported, which is carry 23's position below API 29 too. Below 29 it registers nothing.
- **`NetworkWatch`.** It calls `ConnectivityManager.registerDefaultNetworkCallback`. `onCapabilitiesChanged` reads `NET_CAPABILITY_VALIDATED`, and `onLost` is false. It reports `Input.Network(validated)` on each change, and keeps `reachable` for the facts.
- **`DeviceSampler`.** Every 10 s it reads, on its own executor (binder calls never run on the scheduler thread):
  - `PowerManager.currentThermalStatus` (API 29+);
  - `getThermalHeadroom(10)` (API 30+);
  - `BatteryManager.BATTERY_PROPERTY_CAPACITY` and `BATTERY_PROPERTY_CHARGE_COUNTER`;
  - the sticky `ACTION_BATTERY_CHANGED` intent's `EXTRA_PLUGGED != 0`.

  It builds `RawDevice`, feeds `ChargeDrain` with `SystemClock.elapsedRealtime()`, and reports `Input.Device(DeviceReadings.sample(raw, drain))`. A new `ChargeDrain` starts at each accepted arm, so drain is per session.

- [ ] **Step 1: Write the four watchers.**

- [ ] **Step 2: Build.** Run `assembleDebug` (EXIT=0) and the core suite.

- [ ] **Step 3: Make a device check** (the owner's hands). Toggle aeroplane mode: Diagnostics' network chip follows within seconds. Open another camera app while armed: the status line reads the camera-in-use line. Close it: the line clears. Plug and unplug the charger: the not-charging caption follows.

- [ ] **Step 4: Commit** with the message `feat(engine): camera, microphone, network and device watchers`, and the trailer lines.

### Task 24: The foreground service, the wake lock, permissions, and the previous exit

AGENTS §9, carries 7 and 14, F-P5-3, CD10, CD16, CD21 and CD22.

**Files:**

- Create in `G`: `CaptureForegroundService.kt`, `SessionKeeper.kt`, `Permissions.kt`, `ExitReader.kt`
- Modify: `AndroidPlatform.kt` (`armed` goes through `SessionKeeper`; `End` releases it; `snapshot` updates the notification), `EngineHost.kt`

**Interfaces:**

- `SessionKeeper(context, permissions: Permissions, report, refused: (String, Scope) -> Unit)`, with:
  - `armed(config, then: () -> Unit)`;
  - `ended()`;
  - `notify(wire: Map<String, Any?>)`;
  - `@Volatile val survivesBackground: Boolean`;
  - `@Volatile val permissionsRefused: Boolean`.
- `Permissions(appContext: expo AppContext)`, with `request(onResult: (cameraAndMic: Boolean) -> Unit)`.
- `ExitReader.previousLoss(context): RecordEntry?`.

**`SessionKeeper.armed`, in order:**

1. It writes the session marker file (`filesDir/session.marker`, holding nothing but `"1"`).
2. It acquires `PARTIAL_WAKE_LOCK`, tagged `"seazn:capture"`, with no timeout (CD10), and records `wake-lock` with `{ state: "held" }`.
3. It starts `CaptureForegroundService` with `ContextCompat.startForegroundService`. The arm is always an answer to an intent from the visible viewfinder, so this is a start from the foreground (research §4). It sets `survivesBackground = true` when the start is requested. A `ForegroundServiceStartNotAllowedException` or `SecurityException` sets it false, and is recorded as `fgs-refused` with the class name. Showing an armed session the keep-open caption before the service has started would flash the caption at every arm, so the fact is optimistic until the start fails (CD18).
4. It asks `Permissions` for `CAMERA` and `RECORD_AUDIO`, and on API 33+ for `POST_NOTIFICATIONS`, which blocks nothing.
5. When camera and microphone are granted, it calls `then()`, which is `capture.prepare(…)`. When refused, it sets `permissionsRefused` and calls `refused("camera or microphone permission refused", Scope.SESSION)`. That is CD21: the session ends fatal-error, named.

**The rest of the keeper and the service:**

- **`SessionKeeper.ended()`** stops the service, releases the wake lock (and records it), deletes the marker, and sets `survivesBackground = false`. `permissionsRefused` stays as it was until the next arm, so the Ended block can say it.
- **`CaptureForegroundService`** is `START_NOT_STICKY`. In `onStartCommand` it calls `ServiceCompat.startForeground(this, ID, notification, FOREGROUND_SERVICE_TYPE_CAMERA or FOREGROUND_SERVICE_TYPE_MICROPHONE)` on API 29+, and the two-argument form below.
  - Its notification channel is `"capture"`, at `IMPORTANCE_LOW`, so it never makes a sound. The channel's name is the `stream.tally.live` word.
  - The notification's text is `NotificationText.line(word, targetKbps, since, now, locale)`, where `word` is `NotificationText.WORDS[language][NotificationText.tallyKey(state)]`, falling back to `en`. The language is the phone's (CD16).
  - Tapping it opens the app's launcher activity.
  - It is updated from `notify(wire)` at most once every 5 s, and on a change of state word, because notifications are rate-limited.
  - A refused `POST_NOTIFICATIONS` hides the notification and nothing else: the service still runs (research: it appears only in Task Manager).
- **`ExitReader.previousLoss`**, at module creation on API 30+, reads `ActivityManager.getHistoricalProcessExitReasons(packageName, 0, 1)` and the marker. It returns `PreviousExit.entry(marker.exists(), info?.reason, info?.timestamp)`, and `EngineHost` logs it through `core.log` once. It then deletes the marker. Below API 30 it passes `null` for the reason. Before using the ints, check that `PreviousExit`'s word table matches `android.jar`:

```bash
javap -constants -cp "$ANDROID_HOME/platforms/android-36/android.jar" android.app.ApplicationExitInfo | grep 'REASON_'
```

Record the output in the commit body. A difference changes `PreviousExit`'s table and test, never the glue.

- [ ] **Step 1: Write the four files** to the order above.

- [ ] **Step 2: Build and check the merged manifest** (Task 20, Step 7). Run `assembleDebug` (EXIT=0).

- [ ] **Step 3: Make a device check** (the owner's hands).
  - Arm: the notification shows "READY".
  - Go live: within 5 s it reads `LIVE · 1500k · 0 min`, with the target in k.
  - Lock the screen for 5 minutes, then unlock: still publishing, and the record shows no gap in ticks longer than 1 s (CD10).
  - Refuse the camera permission on a fresh install: the session ends with the permissions line, and the code is kept.
  - Swipe the app away from Recents while live, then reopen it: the record's first lines include `previous-session-lost` with `exit` `user-requested` (on Android 11+).
  - Then the owner deletes the recording.

- [ ] **Step 4: Commit** with the message `feat(engine): foreground service, wake lock, permissions and the previous exit`, and the trailer lines.

### Task 25: The native preview, and the viewfinder's own boundary

Carry 9, owner ruling 2 (2026-10-01), CD19, CD27, research Open 11, and #288.

**Files:**

- Create in `G`: `CapturePreviewView.kt`
- Modify: `CaptureEngineModule.kt` (`View(CapturePreviewView::class) {}`)
- Modify: `src/services/native/nativeSurfaces.tsx` (`NativePreview` renders the native view when the module is present, and an empty `View` otherwise)
- Create: `src/ui/components/PreviewBoundary.tsx`, `src/ui/components/PreviewBoundary.test.tsx`
- Modify: `src/ui/components/StreamStage.tsx` (wraps `<Preview />` only)

**Interfaces:**

- `PreviewBoundary({ children })`. Its fallback is the caption, plus a Show preview ghost button that remounts the children under a new key. It logs `preview.crashed`, with `{ count }`.
- `CapturePreviewView(context, appContext) : ExpoView`, with `shouldUseAndroidLayout = true`.

- [ ] **Step 1: Write the failing boundary test.** It runs in jsdom: a child that throws stands in for the preview.

```tsx
function Boom(): never {
  throw new Error('preview gone');
}

it('CD19 a preview crash shows the caption and keeps the column: plate, line and Stop', () => {
  const view = renderStream({ scene: 'live', Preview: Boom });
  expect(view.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(view.getByText(en['stream.tally.live'].toUpperCase())).toBeTruthy();
  expect(view.getByRole('button', { name: en['stream.action.stop'] })).toBeTruthy();
  expect(readRecord(view.record).map((e) => e.event)).toContain('preview.crashed');
});

it('Show preview remounts the preview, and a second crash shows the caption again', () => {
  let throws = true;
  function Flaky() {
    if (throws) throw new Error('once');
    return <Text>preview back</Text>;
  }
  const view = renderStream({ scene: 'live', Preview: Flaky });
  throws = false;
  fireEvent.press(view.getByText(en['stream.preview.show']));
  expect(view.getByText('preview back')).toBeTruthy();
});

it.each(['es', 'fr', 'nl'] as const)('the caption reads in %s', (lang) => {
  const view = renderStream({ scene: 'live', Preview: Boom, language: lang });
  expect(view.getByText(dictionaries[lang]['stream.preview.stopped'])).toBeTruthy();
});
```

`renderStream` is Task 18's helper. Inject `Preview` through the fake `surfaces` port, the way plan A's stage tests inject surfaces. Check `test/fakePorts.ts`. Plan A's `test/setup-ui.ts` already silences React's error log for boundary tests; reuse it.

- [ ] **Step 2: Run it.** Expected: it fails, because the crash currently reaches the root boundary.

- [ ] **Step 3: Implement `PreviewBoundary`** over plan A's `ErrorBoundary`. It passes `label="preview"`, an `onCatch` that logs `preview.crashed`, and a `fallback` that renders the caption (`Text variant="status"`, tone caution) and a `GhostButton` for `stream.preview.show`, which bumps a `generation` state used as the children's `key`. `StreamStage` wraps `<Preview />` in it, and nothing else on the stage. The overlay keeps its own boundary (AGENTS §7).

- [ ] **Step 4: Implement the native view.**

```kotlin
package com.seazn.capture.engine

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The full-bleed native preview (AGENTS §6, carry 9). Frames never cross the bridge. FIT, so the
 * operator frames exactly what is encoded (#288). No pinch-zoom or tap-to-focus: a tap on a tripod
 * is a mis-tap (AGENTS §6). It binds to the session's streamer while one exists.
 */
class CapturePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val preview =
    PreviewView(context).apply {
      scaleMode = PreviewView.ScaleMode.FIT
      enableZoomOnPinch = false
      enableTapToFocus = false
    }

  init {
    addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    scope.launch { EngineHost.capture.streamer.collect { streamer -> streamer?.let { preview.setVideoSourceProvider(it) } } }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    scope.cancel()
  }
}
```

`setVideoSourceProvider` is a suspend function taking `IWithVideoSource` (javap, research). `EngineHost.capture` is the process's `StreamerAdapter`. In `nativeSurfaces.tsx`, `NativePreview` is `requireNativeView('CaptureEngine')`, behind the same optional-module check plan A's lazy surfaces use, so the web and jsdom builds still render an empty stage.

- [ ] **Step 5: Run `pnpm check`, build, and make a device check** (the owner's hands).
  - Armed, the preview shows the camera full-bleed with letterbox bars (FIT).
  - Hold the phone landscape-left, then landscape-right: the preview is upright both ways, and the encoded stream on the stg player is upright for the side held at arm (P4's three assertions, recorded in Task 26).
  - Live, pull down the notification shade so the view resizes: the record shows no frame gap over 500 ms (Open 11).
  - Kill the preview with the dev menu's "Crash preview" entry: the caption shows, Stop still works, and Show preview brings the picture back.

  Add two `__DEV__`-only `GhostButton`s with this step, shown in `DevScenes` beside the probe:
  - **"Crash preview"** makes the stage's preview throw on its next render;
  - **"Pause engine reports"** makes the native engine ignore `onSnapshot` for 5 s. It is a dev-only `pauseReports(ms)` on `NativeCaptureEngine`, which a release build never wires.

  Both labels are dev-only English, like plan A's dev scene labels (`stream.dev.*`). Add them to all four dictionaries as the dev keys are.

- [ ] **Step 6: Commit** with the message `feat(stream): the native preview, with a boundary of its own`, and the trailer lines.

## Batch C8 — the device gate

### Task 26: The owner's device gate, the results, and plan D's prerequisites

Spec §6 _Device checks_ and §7 phase 4's exit, carries 20, 22–26, research Open 1–11, and the device-only claims listed above. Nothing in this task is simulated. Each step that needs the owner's hands is listed for the owner, and the report says which were done.

**Files:**

- Create: `docs/specs/2026-10-0x-s1-plan-c-results.md`. Name it with the date of the run. Use plan A's results document's shape: rulings, the device list with ticks, deviations, and what carries to plan D.

**Prerequisites, all on the owner's laptop and never in a session channel:**

1. **The hand-made v2 code.** The owner builds the code's JSON from the raw stg live input's SRT and RTMPS credentials, using the Cloudflare token the owner holds, and renders it with `qrencode -l H -o code.png < code.json`. The code, its JSON and its PNG are never printed, pasted, screenshotted or committed. They are deleted after the run.
2. **The descriptor and heartbeat.** Phase 4 publishes "from a hand-made v2 code and a locally served descriptor" (spec §7). Run the dev build with `EXPO_PUBLIC_FAKE_DESCRIPTOR=1` and `EXPO_PUBLIC_FAKE_PLAYBACK_URL=<the stg input's public playback URL>`. The heartbeat URL then points nowhere real, so heartbeats fail and are counted. That is ruling 5's drill: a failing heartbeat never stops the stream.
3. **A release build**, local only: `./gradlew assembleRelease`, signed with the debug keystore for the device run, installed with `adb`. Device evidence comes from a release build (no Metro), plus the dev build for the probe.
4. **Afterwards:** the owner deletes every recording the run made (`DELETE /stream/{video_uid}`; recordings outlive their inputs).

**The checklist.** Two handsets: OnePlus NE2211 (Android 14+) and Redmi Note 7 Pro (Android 10). Both orientations the mode allows, and en and fr where the copy changed. Crop screenshots to the app, and delete anything personal.

- [ ] **The contract on the phone.** Dev build, Diagnostics → Run engine contract: eight `probe.pass`, no `probe.fail` (carry 1).
- [ ] **P4, three independent assertions** for each landscape side:
  1. the preview is upright;
  2. the encoded stream is upright, checked with `ffprobe -show_streams` on the stg recording's download;
  3. the rotation metadata is absent or 0.
- [ ] **B-frames off on both SoCs:** `ffprobe -show_streams` gives `has_b_frames=0`.
- [ ] **F-P5-11:** throttle the laptop hotspot to 1.5 Mbit/s. The SRT `msSndBuf` stays bounded and the egress follows the target. Record the encoder's frame rate under paced `send` (#302).
- [ ] **srtdroid 1.10.1:** 10 minutes on air over SRT to Cloudflare, with one forced reconnect (aeroplane mode for 5 s). The stg player shows the stream after the reconnect.
- [ ] **F-P5-12:** 10 RTMPS cuts (aeroplane mode for 3 s each) with `MODE = SCOPED`. If any crashes, switch to `GLOBAL` and repeat. Then mutate the guard to swallow nothing, and see the crash return at least once. Record which mode shipped.
- [ ] **The foreground service on Android 14 and 16** (or the newest the owner has): no `SecurityException` at arm, and the notification text in the phone's language.
- [ ] **Wake lock:** the screen locked for 5 minutes on air; the record shows ticks every 500 ms throughout.
- [ ] **Carry 22:** take a phone call while live. Record the order of `mic-silenced`, `degraded` and the call's end, and what the audio is at hang-up (stg player).
- [ ] **Carry 23:** on the API 28 handset or below, a call: no silencing line, as designed. Measure whether the link collapses every 25–30 s against the 25 s reset.
- [ ] **Carry 24:** another app takes the camera with no slate frames. Measure how long Degraded reads, and the switch-camera time (dev only).
- [ ] **Carry 25:** read the record of an uplink drop reported after the 3 s stall window. Confirm it never counted toward fallback (N4).
- [ ] **Carry 26:** keep this run's session records, whose delivery lines carry the delivered lag. Plan D measures the 20 s-per-60 s rule from them at the staging match (deferred, as traced).
- [ ] **Carry 20:** record the 204s seen on the raw input before first frame, and the playlist variants Cloudflare served. Hint 0.1 against one variant is plan D's, with the real descriptor.
- [ ] **#306:** RSS (`adb shell dumpsys meminfo <pkg>`) after 20 forced reconnects. Compare per reconnect and per session.
- [ ] **Open 11:** a preview resize while live; no encoded-frame gap over 500 ms in the record.
- [ ] **Battery drain** on the second OEM: `drainPctPerHour` after 30 minutes live. Compare with a reading from the Settings battery screen.
- [ ] **The Kotlin window:** record `./gradlew --version` and the Kotlin plugin version the build used; confirm that no 2.3+ metadata error appeared.
- [ ] **What the operator sees**, on both phones, en and fr:
  - the silence line, using the dev menu's "Pause engine reports" (Task 25, Step 5);
  - the permissions line, the preview boundary, every plate colour, and the notification.

  The keep-open caption shows only on a real refusal of the service's start, which cannot be forced on a stock phone. It is proved in jsdom, and listed as **unproved on a device** unless one occurs.

- [ ] **Step 1: Write the results document** with each tick and its evidence. Every claim names the handset, build and screenshot. Include:
  - the owner-visible decisions CD17, CD18, CD19 and CD21, for review, with their copy in four languages;
  - the open question carried from plan A (the crash screen's language);
  - deviations, each with its reason.

- [ ] **Step 2: Write the plan D section,** _Prerequisites left for plan D_:
  - the real descriptor and heartbeat endpoints on the web side;
  - vendoring `contracts/capture-qr.v1.json`, with the drift job against the main repo's copy (spec §6);
  - the staging match: the spec's exit bar, carry 26's lag rule measured, and carry 20's hint and window;
  - recording deletion as a step of every run;
  - whatever this run left red, with its reason.

- [ ] **Step 3: Verify and commit.** Run `pnpm prettier --check docs/specs/2026-10-0x-s1-plan-c-results.md`. Then commit with the message `docs(s1): plan C device gate and results`, and the trailer lines. No screenshot holding a code, token, key or face is ever committed. Screenshots stay in the gitignored `.s0/`-style local folder the owner names.

## The four questions (AGENTS §10)

| Question                                  | Where this plan answers it                                                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A second call**                         | One poller per attempt (Task 7); one drop and one connect per attempt (Task 11); a second arm ignored (Task 12); one engine per process (Task 12); a clearing under way drops a second call (Task 17); stop and arm unsettled (Task 16)                        |
| **An empty input**                        | An empty arm refused by name (Task 4); no native module gives the absent engine (Tasks 15, 19); a malformed snapshot is kept out (Task 14); no descriptor URL (Task 12); no PCM, no charge counter, NaN headroom (Task 9); a permission refused (Tasks 12, 24) |
| **After an interruption**                 | JS restarting under a live native (Tasks 12, 15); a permanent failure mid-session (Task 6); a stop never answered (Task 17); deep sleep (Task 24, CD10); the process lost mid-match (Tasks 9, 24); a preview crash (Task 25)                                   |
| **Another mode, orientation or language** | Either landscape side fixed at arm (Tasks 11, 22, 26); four languages for every new line (Tasks 18, 25) and for the notification (Task 10); Scoring and Dashboard never touch the engine, and S2–S4 own them                                                   |

## Self-review

**Spec coverage.** Spec §3 lists the platform's pieces. Each maps to a task:

| Spec §3 item                                                   | Task                                           |
| -------------------------------------------------------------- | ---------------------------------------------- |
| StreamPack, max B-frames 0                                     | 11 (rule), 22 (glue), 26 (`ffprobe`)           |
| No `setTargetRotation`; orientation fixed at arm               | 11 (rule + `GlueRulesTest`), 22, 26 (P4 ×3)    |
| Ktor guard, proven by cuts against Cloudflare                  | 11, 21, 26                                     |
| Foreground service, wake lock, heartbeat                       | 24 (service, lock); 8, 12, 20 (heartbeat HTTP) |
| MicSilence                                                     | 10, 23, 26                                     |
| Camera contention and reopen                                   | 10, 22, 23, 26                                 |
| SlateSource: the card, no words, silent audio                  | 22                                             |
| HTTP playlist and heartbeat clients                            | 8, 12, 20                                      |
| Battery charge counter; thermal with headroom                  | 9, 23, 26                                      |
| Bridge: intents void, snapshot ≥ 1 Hz, native preview          | 12, 14, 15, 20, 25                             |
| §6 CI: the Android compile job                                 | 20                                             |
| §6 device checks                                               | 26                                             |
| §7 phase 4: raw stg input, hand-made v2 code, local descriptor | 19 (CD24), 26                                  |

Owner ruling 1 (the crash copy) and ruling 2 (the viewfinder boundary) are recorded in Task 1 and built in Task 25. All 28 carries are traced; 26 are fully mapped, and 20 and 26 are partly deferred to plan D for the staging match, with their reasons. iOS is out of scope (CD1) and gets the absent engine.

**Placeholder scan.** A search of this file for `TBD`, `TODO`, `fill in`, `similar to Task` and `implement later` finds none. Four places name a value this plan cannot know before the implementer reads a jar, and each says exactly how to read it:

- komuxer's Maven coordinates (Task 20, Step 1);
- StreamPack 3.2.0's composite-endpoint constructor (Task 21, Step 1);
- the `MicrophoneSource` field (Task 23);
- `test/fixtures/wire.ts`'s descriptor JSON (Task 5, Step 1).

**Type consistency.** These names are spelled the same in every task that uses them:

- `SessionName(sid, slot, tokenTag, descriptorJson)`;
- `PlatformFacts` (seven fields) and `RecordCounters`;
- `FrameCount(video, audio)`;
- `HttpOutcome.Answered` and `.Failed`, `BodyFields`;
- `Scope.PROCESS` and `.SESSION`;
- `SrtPlan`, `SrtOpt`, `AttemptSignals`;
- `Capture` and `CaptureFacts`;
- `NativeCaptureEngine.forward` and `ForwardedEntry`;
- `RingRecord.appendLine` and `createRoutedRecord`;
- `ENGINE_SCENARIOS` and `ScenarioKit`.

The wire's telemetry field names equal plan A's `Telemetry`, plus the three Task 14 adds.

**Review Focus.** Each of the five lines has a named test:

1. `GlueRulesTest` (Task 11), and the silence screen test with its mutation (Task 18);
2. `BridgeCoreTest` Review Focus 2 (Task 12), and the native-engine construction test (Task 15);
3. `BridgeCoreTest` Review Focus 3 (Task 12), with sticky failure (Task 6) and the permissions line (Task 18);
4. the shared scrub vectors with mutations (Task 3);
5. `AttemptPollersTest` (Task 7) and `AttemptSignalsTest` R3 (Task 11).
