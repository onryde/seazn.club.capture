# S1 Plan C — the Android platform and the Expo bridge

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, batch by batch (owner ruling, 2026-10-01). Steps use checkbox (`- [ ]`) syntax for tracking. Tasks are dispatched in the batches listed under **Dispatch batches**, one implementer per batch.

**Goal:** Put plan B's merged pure-Kotlin session core on a real Android phone. That means StreamPack capture and encode, our own SRT sink, RTMPS with a scoped TLS guard, the foreground service, the camera, microphone, network, battery and thermal adapters, the HTTP client, and an Expo Module bridge with a native preview view. The bridge replaces the fake engine that `createNativePorts` wires in production today (plan A's D25). This is spec §7 phase 4, and every plan A and plan B carry that belongs to it.

**Architecture:** Three layers, and only the last one needs a phone.

1. **`core/`** (plan B, pure Kotlin) stays the only authority. Plan C adds the session's name to its snapshot, reconciles its record scrub with JavaScript's, and makes one helper public.
2. **`adapter/`** is new pure Kotlin in the same Gradle build, unit-tested on the JVM in the existing `kotlin-core` CI job. It holds every rule the platform needs: mapping intents and snapshots to and from the bridge, the guarded scheduler, sticky permanent failures, the attempt pollers, HTTP answers, SRT socket options, the TLS-guard predicate, device readings and the watch logic. `BridgeCore` joins them around plan B's `Engine`. A JVM host process runs `BridgeCore` with a scripted platform, so the JavaScript engine contract (`test/engineContract.ts`) runs against the real core through the real bridge mapping.
3. **The Android glue** under `modules/capture-engine/android/src/main/java/` turns Android facts into `Input`s and carries out `Command`s. It holds no rule. It is compile-checked in CI, and device-checked by the owner.

On the JavaScript side, `createNativeCaptureEngine` maps native's snapshot event onto plan A's `EngineSnapshot`, sends intents as void calls, and routes the logger's lines into the native session record while a session exists.

**Tech Stack:**

- Expo SDK 57 (expo-modules-core 57.0.17), React Native 0.86.3, TypeScript 6 strict, vitest 5;
- Kotlin 2.1.20, AGP 8.12.0, Gradle 9.3.1, JDK 17, compileSdk/targetSdk 36, **minSdk 31** (Android 12+, owner ruling of 2026-10-01, CD34);
- StreamPack 3.2.0 (`core`, `ui`, `srt`, `rtmp`), srtdroid-ktx 1.10.1 (libsrt 1.5.7, read from the AAR's `libsrtdroid.so`), komuxer rtmp 0.4.0 (Ktor 3.3.3); every version checked on Maven Central on 2026-10-01 (CD35);
- OkHttp 4.9.2 as `compileOnly`, the version `react-android` 0.86.3 declares (`node_modules/react-native/gradle/libs.versions.toml`), so the app's own copy is the one that runs and Task 20 records what the app resolves; `org.json` on the JVM test classpath only.

**Spec:** `docs/specs/2026-09-30-s1-live-stream-design.md` (owner-approved; binding; do not edit). It covers §3 (`platform/` and _Bridge_), §5, §6 (_CI_, _Device checks_) and §7 phase 4.

**Sources, in authority order:**

1. the spec;
2. the owner's rulings of 2026-10-01: the crash-screen copy is approved as built; plan C builds a viewfinder-only error boundary around the native preview; an AI translation review against `docs/i18n-glossary.md` replaces the native-speaker review (PR #9), which CI enforces with `pnpm i18n:release-check` (PR #10); and, given later that day, P1–P3 decided, Android 12+ (minSdk 31), subagent-driven execution batch by batch, and the latest stable StreamPack and srtdroid (all under _Owner rulings of 2026-10-01_);
3. the carries in `docs/specs/2026-09-30-s1-plan-a-results.md`, _Carried to plan C_ (all 28 are traced below);
4. the research in `docs/superpowers/plans/2026-09-30-s1-plan-c-research.md`;
5. this plan's own judgment, recorded under **Plan decisions**. The three the independent review put to the owner are now ruled, and are built as ruled (see _Owner rulings of 2026-10-01_).

Plans A and B are merged: `docs/superpowers/plans/2026-09-30-s1-plan-a-js-domain-and-screens.md` and `docs/superpowers/plans/2026-09-30-s1-plan-b-kotlin-core.md`. P5 findings are cited by ID from `docs/specs/2026-09-11-p5-android-results.md`.

## Global Constraints

- **Worktree.** Execute in a worktree of `main` (at or after `d6931c1`) on branch `feat/s1-plan-c`. Run `pnpm install --frozen-lockfile` once. Put `cd <absolute worktree path> &&` in every command you judge, because the shell cwd resets to the main checkout between calls (AGENTS §13).
- **Never EAS.** No `eas build`, `eas submit` or `eas update`, ever. Native builds are local: `pnpm expo prebuild -p android --no-install`, then Gradle and `adb` (AGENTS §11).
- **Prebuild rewrites `package.json`.** Before every prebuild, `cp package.json "$TMPDIR/package.json.bak"`. After it, `cp "$TMPDIR/package.json.bak" package.json`, then `git diff --exit-code package.json`. Never commit the rewrite. The root `android/` is gitignored prebuild output and is never committed.
- **`expo-camera` is never installed.** StreamPack owns the capture session. `streampack-services` is never added, and `StreamerLifeCycleObserver` is never attached (research, boilerplate §8).
- **Pins** are copied verbatim into `modules/capture-engine/android/build.gradle` (Task 20) with Gradle `strictly`:
  - `io.github.thibaultbee.streampack:streampack-{core,ui,srt,rtmp}:3.2.0`;
  - `io.github.thibaultbee.srtdroid:srtdroid-ktx:1.10.1`;
  - `io.github.komedia.komuxer:rtmp:0.4.0`.
    Nothing newer may be adopted without a real `assembleDebug` first: Kotlin 2.1.20 cannot read 2.3+ metadata (research §Toolchain). StreamPack 3.2.0 and srtdroid 1.10.1 are the latest stable releases (Maven Central, 2026-10-01); komuxer stays at 0.4.0 for the reason in CD35.
- **Android 12+ (CD34).** The app's `minSdkVersion` is 31, set through `expo-build-properties` (Task 20) and checked in the merged manifest by CI. No code branches on an API level below 31, and no test exercises one. `POST_NOTIFICATIONS` is asked on API 33+ only; on 31 and 32 notifications are allowed by default.
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
  JS: `pnpm vitest run --reporter=json --outputFile="$TMPDIR/r.json"`, then read `numTotalTests` and `numFailedTests`. Capture exit codes with `cmd > out 2>&1; echo "EXIT=$?"`, never through a pipe. Baselines at `d6931c1`: **452** Kotlin tests and **1928** JS tests, 0 failed. Re-count both at the worktree's base before Task 1 and use those numbers: every "rises by" in this plan is relative to them.
- **Checks.** `pnpm check` covers typecheck, lint, Prettier on `src app modules test`, and vitest. Also run `pnpm prettier --check` on every other file you touch (docs, `app.json`, workflows).
- **Kotlin style.** `allWarningsAsErrors` stays on in the core build. Pure units take time as arguments or through `Clock`, and never read a system clock.
- **Copy.** Every operator-visible string is in all four dictionaries, and every new key is in the same task's commit **with its es, fr and nl translation already reviewed against `docs/i18n-glossary.md`**: CI's `pnpm i18n:release-check` (`scripts/check-i18n-release.mjs`) fails on any `_review` key, so no `"_review": "pending translation review"` marker may be left in a commit. The glossary's rules bind: es tú, fr vous, nl je; es, fr and nl status lines split on a colon, never an em dash; French puts U+00A0 (written `\u00a0` in the JSON) before `:` `;` `?` `!`, which `dictionaries.test.ts` enforces; straight apostrophes; sentence case. A term the glossary lacks is added to it in the same commit (this plan adds **engine**: motor / moteur / engine). Lengths fit the patterns in `src/i18n/budgets.test.ts` (status lines 48, advisories 56), counted with `s.length` as `budgets.test.ts` counts, never by eye.
- **Device claims.** A claim about what the operator sees, or about Android behaviour, is settled only on a phone, and the report says so. Steps that need the owner's hands are listed for the owner, never simulated (AGENTS §13). Every device check names **what to read** — a record line, a Diagnostics row, a `dumpsys` or `ffprobe` field — never "it works".
- **Files.** Config files are `vitest.config.mts` and `eslint.config.mjs`. A `git add` of a path that does not exist aborts the whole add.
- **Commits.** Use `git commit -F -` with a heredoc, staging files by explicit path, never `git add -A`. Messages are conventional and end with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
  ```

## Review Focus

These are the inputs the spec implies that ordinary happy-path tests would miss, most likely first. Each has a test in the task named.

1. **An adapter blocks the scheduler thread**: a StreamPack suspend call under `runBlocking`, a DNS lookup in `connect`, or a slow HTTP answer read inline. Snapshots stop, and the HUD would keep claiming LIVE. Expected: nothing in the glue blocks. If native goes quiet anyway, the column says so within 3 s and the plate stops claiming LIVE. Pinned in Task 11 (`GlueRulesTest` forbids `runBlocking` and `InetAddress` in the glue outside the resolver) and in Task 18 (the silence line and plate, with a mutation).
2. **JavaScript restarts while native is live**: Try again after a crash, or a dev reload. Expected: the first `getSnapshot()` already says publishing, names the session, and the record shows the lines from before the restart. Pinned in Task 12 (`current()` before any tick) and Task 15 (the engine built over a native that already reports publishing, and the record seeded from `tail()`). The new module instance takes over the event listener and the `AppContext` from the old one, and the old one's `OnDestroy` clears only what is still its own, whichever runs first (Task 12's `OwnedSlot`, which Task 20's `EngineHost` uses; the device check is Task 26's JS reload while live).
3. **A permanent failure before the first connect**: camera permission refused, or libsrt failing to load. Expected: the session ends fatal-error and still names its code, Go live never spins, the Ended block says to allow the permission, and the code is kept. Pinned in Task 6 (sticky failure, attempt in hand), Task 12 (named ended, including a throw from `platform.armed` itself, which must never be swallowed by the snapshot sink) and Task 18 (the permission line). On Android 14+ the permissions are asked **before** the camera-and-microphone foreground service starts, or `startForeground` throws `SecurityException` and the first arm on a fresh install kills the process (Task 24, with a fresh-install device step in Task 26).
4. **A secret inside a library's message or a forwarded JS line**, in raw, form-encoded or component-encoded form. Expected: `***` in the native record, never the value. Pinned in Task 3 (the shared vectors, run on both sides, with mutations). StreamPack's own logger is replaced, so no vendor message reaches logcat unscrubbed (Task 20; `GlueRulesTest` checks the replacement is installed).
5. **A drop reported twice for one attempt, or a second `Connected` for it.** StreamPack's `throwableFlow` is a conflated `StateFlow` that replays (research, boilerplate §5). Expected: one drop counted, and one Frames poller and one Link poller per attempt. Pinned in Task 7 (pollers) and Task 11 (`AttemptSignals`).

## Dispatch batches

Execution is **subagent-driven, batch by batch** (owner ruling, 2026-10-01). Each batch goes to **one implementer** as a single brief. Every task commits on its own. A batch ends with its suite green, the raw counts reported, and every task's commit present. The reviewer then reviews the batch diff before the next batch starts.

| Batch   | Tasks | Unit                                                                                                                                                                       | Files it owns, beyond its new files                                                                                                                                                                                                                                                                                                                                                               | Ends with                                                                                        |
| ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **C1**  | 1–3   | Core carries: RR-12 and RR-13; the session's name with the token-tag vectors; the shared scrub on both sides                                                               | `core/**` (Engine, SessionConfig, Phase, Snapshot, Projection, SessionMachine, SessionRecord, build.gradle.kts, and the tests Task 3 lists), `src/services/{scrub,sessionRecord,logger}.ts(+tests)`, `src/hooks/useStreamArm.ts` (`useProtect` releases, N7), the JS tests Task 3 lists, `modules/capture-engine/src/{wire,scrub}/**`, `test/fakePorts.ts` (`readRecord`), the plan A results doc | `./gradlew test`, `pnpm check`                                                                   |
| **C2**  | 4–8   | Adapter logic I: arm and intent mapping, the snapshot wire, the guarded scheduler and sticky failures, the attempt pollers, HTTP                                           | `core/src/main/kotlin/com/seazn/capture/engine/adapter/**`, `core/.../core/{Json,Phase,SessionMachine}.kt`, `modules/capture-engine/src/wire/**`                                                                                                                                                                                                                                                  | `./gradlew test`                                                                                 |
| **C3**  | 9–11  | Adapter logic II: device readings, lateness and exit reasons; the mic, camera and notification logic; SRT options, the TLS guard, drop signal and glue rules               | `core/.../adapter/**` (new files only), `core/build.gradle.kts` (system properties)                                                                                                                                                                                                                                                                                                               | `./gradlew test`                                                                                 |
| **C4a** | 12–13 | `BridgeCore`, `OwnedSlot` and the JVM host                                                                                                                                 | `core/.../adapter/{Platform,BridgeCore,OwnedSlot}.kt(+tests)`, `core/settings.gradle.kts`, `core/host/**`                                                                                                                                                                                                                                                                                         | `./gradlew test`, host smoke                                                                     |
| **C4b** | 14–16 | The JS bridge, the routed record, and the contract kit run against the host                                                                                                | `modules/capture-engine/src/**`, `src/hooks/useStreamArm.ts` (the arm's language, CD16 and P3), `src/services/sessionRecord.ts`, `test/engineContract.ts`, `test/hostEngine.ts`, `vitest.config.mts`, `.github/workflows/bridge-contract.yml` (new)                                                                                                                                               | `pnpm check`, plus `CAPTURE_BRIDGE=1 pnpm vitest run --project bridge`                           |
| **C5**  | 17–19 | JS product changes: the disarm bound, silence, the keep-open advisory, the permission line and record counters, the composition root, and (P1) the crash screen's language | `src/hooks/**`, `src/ui/**`, `src/i18n/*.json`, `src/i18n/budgets.test.ts`, `docs/i18n-glossary.md`, `src/hooks/nativePorts.ts`, `test/fakePorts.ts` (`nativeEngine`), `modules/capture-engine/src/FakeCaptureEngine.ts`                                                                                                                                                                          | `pnpm check`, `pnpm i18n:release-check`                                                          |
| **C6**  | 20–22 | Android glue I: the module scaffold, the vendor logger and the compile job, the SRT sink and endpoints, the streamer adapter                                               | `modules/capture-engine/{expo-module.config.json,android/build.gradle,android/.gitignore,android/src/**}`, `app.json`, `package.json` and `pnpm-lock.yaml` (`expo-build-properties`, minSdk 31, CD34), `core/src/test/.../adapter/{GlueRulesTest,SlateColoursTest}.kt`, `core/build.gradle.kts` (`capture.tokens`), `.github/workflows/android-compile.yml`                                       | `assembleDebug` green, core suite green; no device check (those wait for C5, see Task 23 Step 1) |
| **C7**  | 23–25 | The device checks C6 could not run; Android glue II: the watchers and HTTP, the foreground service, the preview view and its boundary                                      | `modules/capture-engine/android/src/**`, `core/.../adapter/ArmTurns{,Test}.kt` (new, N2), `modules/capture-engine/src/nativeCaptureEngine{,.test}.ts` (`pauseReports`), `src/services/native/nativeSurfaces.tsx`, `src/ui/components/{StreamStage,PreviewBoundary,DevScenes}.tsx`, `test/fakeSurfaces.ts`, `src/i18n/*.json`                                                                      | `assembleDebug`, the core suite (`ArmTurnsTest`), `pnpm check`, `pnpm i18n:release-check`        |
| **C8**  | 26    | The device gate: a local release build, the owner's checklist, and the plan C results document                                                                             | `docs/specs/2026-10-0x-s1-plan-c-results.md` (new)                                                                                                                                                                                                                                                                                                                                                | the owner's ticks                                                                                |

**Sequencing.**

- C1 → C2 → C3 → C4a → C4b → C5, in one worktree. Each later batch compiles against the one before it.
- C6 may start once C4a has merged into the branch, because the glue implements `Platform` and calls `BridgeCore`. It needs nothing from C4b or C5 to compile.
- **The one parallel lane:** C6 may run beside C4b and C5 (which stay sequential with each other) in a second worktree. The file sets are disjoint: C4b and C5 touch `src/**`, `test/**`, `modules/capture-engine/src/**`, `vitest.config.mts`, `docs/i18n-glossary.md` and `bridge-contract.yml`; C6 touches only `modules/capture-engine/android/**`, `modules/capture-engine/expo-module.config.json`, `android-compile.yml`, and `app.json`, `package.json` and `pnpm-lock.yaml` for one dependency (`expo-build-properties`, Task 20), which C4b and C5 never touch. Confirm with `git diff --name-only` before merging. If either touched the other's set, merge sequentially and rerun both suites.
- **C6 runs no device check.** Its glue only reaches the screen once Task 19 wires JS to the native engine and Task 18 adds the Diagnostics rows, both in C5. The device checks C6's tasks would run are Task 23 Step 1, the first step of C7.
- C7 follows both C5 and C6. Task 25 edits `StreamStage.tsx` and the dictionaries, which C5 also edits.
- C8 is last.
- **No JS file may be edited while Metro serves a device check** (AGENTS §13).

## Plan decisions

The spec was silent, or a carry asked for a decision, on each of these points. **OWNER-VISIBLE** marks a decision the owner sees on screen. Those are built as stated and listed in the results for the owner's review, as plan A did. Five of these decisions (CD16's language, CD17, CD18, CD19 and CD21) were put to the owner as P1–P3 and are ruled; CD34 and CD35 record rulings given the same day. Each ruling is under _Owner rulings of 2026-10-01_.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CD1  | **Android only.** The spec makes iOS M3 (HaishinKit, P1, VoiceOver). `expo-module.config.json` lists `android` alone. On iOS, Expo Go and the web export, `requireOptionalNativeModule('CaptureEngine')` is null, so the composition root wires the absent engine (CD23). An arm there ends fatal-error at once, which is the spec §5 row "the native module missing". Android goes first for features and iOS first for lifecycle (AGENTS §9), and S1's lifecycle work is Android's foreground service, so nothing here waits on iOS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CD2  | **The Android library compiles the core's sources itself.** `sourceSets.main.java.srcDirs += 'core/src/main/kotlin'`. This **reverses plan B's decision 1** (`includeBuild`). An included build would need a line in the prebuilt `android/settings.gradle`, which is gitignored output, so it would need a config plugin, and its `kotlin("jvm")` plugin would meet AGP's in one composite. The same Kotlin 2.1.20 compiles both ways. The core's standalone build, wrapper and CI job are unchanged, and keep running every pure test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CD3  | **The adapter logic is pure Kotlin, beside the core.** It lives in package `com.seazn.capture.engine.adapter` under `core/src/main/kotlin`, in the same Gradle build, so `kotlin-core` CI runs its tests on every push. The Android glue (`com.seazn.capture.engine`, under `modules/capture-engine/android/src/main/java`) turns Android facts into calls on these units and holds no rule. A glue class longer than about 150 lines is a sign a rule leaked into it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CD4  | **`org.json` on test classpaths only.** The core's `testImplementation` and the host subproject read the shared vector files with `org.json:json:20240303`. `main` stays dependency-free, as plan B ruled. On Android, `org.json` is the platform's own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CD5  | **The session's name (carry 2).** `SessionConfig` gains `slot`, `descriptorUrl` and `descriptorJson`, each with a default so plan B's tests still compile (and `language`, under CD16 and ruling P3). `SessionName(sid, slot, tokenTag, descriptorJson)` is derived from the config. `Phase.Ended` keeps the name of the session it ended in a new field **`sessionName`**, **including an arm refused straight to Ended**, and the snapshot carries `session`. The field is not `name`, which `Phase` already declares as the phase's word, and not `session`, which would shadow the existing extension `Phase.session: Session?` with a different type. `TokenTag` is FNV-1a 32-bit over UTF-16 code units, the same function as `src/domain/credentials/tokenTag.ts`, pinned by one vector file read on both sides. The descriptor travels to native as the opaque JSON of `descriptorToWire` and comes back unchanged. JS re-hydrates it with `parseDescriptor`, which rebuilds its `Date` fields (carry 4). Native never reads it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CD6  | **One scrub, both sides (carry 11).** `modules/capture-engine/src/scrub/allow-list.json` is the source of record, decided key by key, with each key's reason in the file. The marker is **`***`** everywhere: JavaScript's `SCRUBBED` changes from `[scrubbed]`, and every JS test already uses the constant. A string survives only under an allow-listed key. A finite number, boolean or null passes under any key, as native already did; no secret is a number. A non-finite number is masked on both sides (native wrote NaN as `null` before). Each class of key has one rule: **plain** keys pass a short plain word, or else the whole value is masked; **public-url** keys pass a public https URL with no query, fragment or userinfo and no held secret (the stream id is allowed), or else the whole value is masked; **text** keys mask each held secret in place, then mask the whole value if decoding what is left still reveals one; **never** keys are always masked. JS keeps `kind` as a plain key (it logs failure kinds such as `descriptor.error {kind}`), written to the line as `field_kind`. **One JS-only rule (I12, N7):** a text key is masked whole unless a session is **in hand**: from `logger.protect()`, which `useProtect` calls when the viewfinder holds a session (`useStreamArm.ts:66`, before the arm), until `logger.release()`, which that effect's cleanup calls when the viewfinder lets the session go. JS holds a code from the scan, before the viewfinder protects it, and `protect` only ever adds, so the rule is keyed on the session in hand, never on whether anything was ever held: a second code scanned in the same process is covered exactly as the first. Secrets once protected stay masked after `release()`. Native holds nothing before an arm, so it needs no such rule. Native's plain and URL keys change from in-place to whole-value masking. That changes the point of eight `SessionRecordTest` tests, each listed in Task 3 with its restated point. Both sides check their key sets against the file and run one shared vector file. |
| CD7  | **OWNER-VISIBLE — one record (carry 11, spec §5).** While a session exists (the snapshot is not `idle`), each JS log entry goes to the native record through `BridgeCore.log`, which posts it through the scheduler (carry 12) and rounds a fractional number to tenths, as every native number is. Native writes every line to an NDJSON file and echoes it up as an `onRecord` event. Otherwise, JS entries go to the JS ring. Diagnostics and Share read the JS ring, which holds both. **The line format is unified on native's flat shape**: `{"at","kind",…fields}`, with `"level"` after `kind` only when it is not `info`, so every line native writes today is unchanged. A field named `at`, `kind` or `level` is written `field_<key>`. JS's `toRecordLine` changes to it; `parseRecordLine` reads a line back to `{atMs, level, event, fields}`, defaulting the level to `info` and undoing the `field_` renames, so `readRecord` users read `fields.kind` as before. Tests that parse a line themselves change, and Task 3 lists each. The owner sees the change in Diagnostics and in a shared record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CD8  | **The contract kit against the bridge (carry 1).** The kit's scenarios move to `modules/capture-engine/src/contract/engineScenarios.ts`, which imports no vitest. `test/engineContract.ts` wraps each scenario in an `it`, and `make` may now return a promise. The bridge runs them in vitest over a **JVM host process** (`core/host`): the real `Engine` and `BridgeCore` with a scripted platform, speaking NDJSON on stdin and stdout. **Settling is an acknowledgement, not a timeout:** the JS bridge numbers each intent with a `seq`, and `BridgeCore.send` posts `platform.acked(seq)` after the input's own tasks, so the ack lands after every snapshot that input caused and before any later tick's. The host writes it as `{"ev":"ack","seq":n}` and Android emits it as `onAck`; `NativeCaptureEngine.settled()` resolves on the ack of the last intent sent, and `settle` is that. A `bridge` vitest project runs it, kept out of `pnpm test` by two guards (an exclude in the `domain` project and the `CAPTURE_BRIDGE` gate), each mutated on its own. It runs in its own workflow, `bridge-contract.yml`, so `kotlin-core.yml` stays JDK and Gradle only, as spec §6 says. The **device run** is a development-build button that runs the same scenarios against the real native engine, settling on the same `onAck`, and writes `probe.pass` or `probe.fail` lines into the record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CD9  | **The thread model (carry 15).** One `HandlerThread` named `capture-engine` backs `Scheduler`, wrapped in `GuardedScheduler`. The wrapper catches any `Throwable` at the task boundary, so the thread never dies, and hands it to `BridgeCore.failed`, which records it and classifies it (CD11). `Engine.start` is posted onto the thread. StreamPack's suspend calls run on the adapter's own coroutine scope, and their outcomes come back as inputs. **Work that needs the main thread or does IO is posted off the scheduler thread**: the `SessionKeeper` (marker file, wake lock, permission request, `startForegroundService`) runs on the main looper, and reports back through `BridgeCore`. Every coroutine scope in the glue has a `CoroutineExceptionHandler` that reports to `BridgeCore`, so a vendor throw never reaches the thread's uncaught-exception handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CD10 | **Deep sleep (carry 14).** A `PARTIAL_WAKE_LOCK` is held from the arm the machine accepts until `Command.End`. While it is held, `Handler.postDelayed` (`uptimeMillis`) and the clock (`elapsedRealtime`) cannot drift apart. Without a session the tick may pause in deep sleep, which is harmless. The lock is tagged `seazn:capture`, and its holding is a record line. **The evidence is a line:** `BridgeCore` writes `tick-late {gapMs}` whenever two ticks are more than 1000 ms apart on the monotonic clock (`Lateness`, Task 9), so a phone that slept through a session says so in its record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CD11 | **Permanent failures are sticky (carry 18).** A failure is permanent when it is a `LinkageError` (`UnsatisfiedLinkError`, `NoClassDefFoundError`) or a `PermanentPlatformFailure`. The glue wraps a codec that cannot be configured, and a refused camera or microphone permission, in the latter. Once one is seen, `StickyFailure` answers every later `Connect`, `Rebuild.next` and `StartNewSession.next` with `PlatformFailed(thatAttemptId, message)` and executes none of them. **A failure before a session's first Connect** is reported at once with the attempt in hand (`Phase.attemptInHand`, made public), so an armed session ends fatal-error and still names its code. There is one `BridgeCore`, and so one `Engine`, per process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CD12 | **Pollers (carries 16 and 19).** `AttemptPollers` runs one Frames reader every 500 ms and one Link reader every 1000 ms **per attempt**. A second `begin` for the same attempt changes nothing, and a new attempt cancels the old one's. They keep running through a camera switch, so the switch's LIVE bound stays at 3.5 s or less. They stop on a drop, `Disconnect`, `Rebuild`, `StartNewSession` and `End`. While publishing, a Frames read whose video count has not moved for more than 500 ms writes `frames-gap {gapMs}` once per gap (`Lateness`, Task 9), which is what research Open 11's resize check reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CD13 | **HTTP (carries 17 and 20, F-P5-13).** OkHttp is built with no cache, and every playlist fetch sends `Cache-Control: no-cache`. Heartbeat and descriptor requests send `no-store`. The timeouts are 8 s. **A 204 maps to `NoContent` before any test of success**, because OkHttp's `isSuccessful` is true for it. The descriptor answer always echoes its request id and calls the core's `DescriptorCheck.answered`. The User-Agent is OkHttp's default: P5 found U1-S6's 403 did not reproduce, and a 403 reads as no evidence, never as a stall (`withoutEvidence`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CD14 | **Our own SRT sink (F-P5-11, F-P5-1, R3).** `SeaznSrtSink`, adapted from StreamPack 3.2.0's `SrtSink` under Apache-2.0 with attribution, composed with StreamPack's `TsMuxer` through `CompositeEndpointWithMetricsFactory`. It resolves the host first, off the scheduler thread, and reports `UnknownHostException` as `UNRESOLVED`. It sets `STREAMID`, `PASSPHRASE` and `LATENCY` as socket flags, so **no SRT URL string carrying a secret is ever built**. That makes carry 13's `URLEncoder` proposal moot for SRT. It sets `MAXBW` in bytes per second after connect and on every `SetMaxBw`, with `INPUTBW` 0 so libsrt never derives its own. It exposes its completion cause, so a drop is known at once and once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CD15 | **RTMPS (F-P5-12, carry 13).** StreamPack's `RtmpEndpointFactory` gets an RTMP-only IO dispatcher: two threads whose uncaught-exception handler applies `TlsCloserGuard`. The spike's global handler is kept behind `TlsGuard.MODE`, and the device decides between them (Task 26). The publish URL is the code's `url` plus the stream key encoded with `URLEncoder` as defence in depth (carry 13), and the record masks that form too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CD16 | **The foreground service.** It is started when the machine accepts an arm, which is always in answer to an intent from the visible viewfinder, and **only after `CAMERA` and `RECORD_AUDIO` are granted**: on Android 14+ a `camera\|microphone` service started without them throws `SecurityException` from `startForeground` (research §4). It is never started from a reconnect, a reopen or the background. It is `START_NOT_STICKY`, with types `camera\|microphone`, and stops at `Command.End`. `survivesBackground` is true from the accepted arm until the service's start fails or the session ends. It is optimistic so the keep-open caption never flashes while the permission dialog is up or at every arm (CD18), and a refused start sets it false at once. The notification reads `LIVE · 3000k · 47 min`, with the state word taken from the dictionaries' `stream.tally.*` in upper case. **Its language (ruling P3, 2026-10-01):** the arm intent carries the operator's language (`language`, one field in `armWire` and `ArmMapping`), and native picks `NotificationText.WORDS[language]`, then the phone's language, then `en`, so the shade and the HUD agree. A language changed mid-session keeps the arm's until the next arm. Tasks 2, 4, 10, 14 and 24 build it, each step marked **(P3)**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CD17 | **OWNER-VISIBLE, accepted by the owner (P2, 2026-10-01). Stale snapshots (carry 8).** When the session is armed or on air and native has not reported for 3 s (six ticks), the status line reads "Engine not responding — check the phone", and the plate shows TROUBLE in orange instead of claiming READY or LIVE. TROUBLE then means either "broadcast degraded" or "engine silent", and the status line tells them apart. Diagnostics shows "Last report … s ago". This is a display rule over `reportedAtMs` and the clock. It moves no session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD18 | **OWNER-VISIBLE, accepted by the owner (P2, 2026-10-01). Keep-open advisory (carry 7).** While armed or on air with `survivesBackground` false, the top strip reads "Keep the app open — capture stops in the background". It outranks every other advisory. On Android it shows only if the foreground service failed to start, which a stock phone cannot be made to do, so it is proved in jsdom only and labelled unproved on a device. It is the iOS P1 warning's home for M3, driven by `selectSurvivesBackground` and never by a platform check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CD19 | **OWNER-VISIBLE, accepted by the owner (P2, 2026-10-01). The viewfinder boundary (owner ruling 2).** `PreviewBoundary` wraps only the native preview. Its fallback is a stage caption, "Camera preview stopped — the session carries on", with a **Show preview** ghost button that remounts the preview: the button bumps a `generation` used as the **`ErrorBoundary`'s own `key`**, because `ErrorBoundary` keeps returning its fallback while it holds an error, whatever its children. The column, its plate and the Stop hold are outside the boundary and stay. The crash is logged as `preview.crashed`. AGENTS §7's boundary around the overlay is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CD20 | **Shedding.** The platform computes `shed` from the thermal status: `moderate` is `overlay-preview`, `severe` is `preview-framerate`, and `critical` or worse is `encode`. In S1 only the overlay step acts, in JS, as plan A built it. The other two are reported and recorded but not acted on natively: lowering the preview's rate apart from the encoder's needs a second camera stream. This is deferred to the soak, with the reason recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CD21 | **OWNER-VISIBLE, accepted by the owner (P2, 2026-10-01). Permission refused.** Native asks for `CAMERA` and `RECORD_AUDIO` when it accepts an arm, through Expo's permissions manager, before the foreground service starts (CD16), and asks for `POST_NOTIFICATIONS` on API 33+ without waiting on it; on API 31 and 32 notifications are allowed by default, so nothing more is asked (CD34). A refusal of camera or microphone is a permanent failure (CD11). The telemetry fact `permissionsRefused` is set, and the Ended block for fatal-error adds one string, `stream.ended.permissions`: "Allow the camera and microphone in Android Settings, then try again" (this is the one string; the batch C5 table holds it in all four languages. The app's name is left out: the system's permission dialog the operator just refused named it. M3's iOS needs its own string, since "Android Settings" is Android's). A refused notification permission blocks nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CD22 | **The previous exit (F-P5-3).** At module creation, the glue reads `ApplicationExitInfo` (always available at minSdk 31, CD34) and a session marker file. The marker is written at arm and deleted at End. When the marker is present, the record gains `previous-session-lost` with the exit reason's wire name, so "the app died mid-match" is evidence, not a guess. A stop from the system's Task Manager reads `user-requested`; what a swipe from Recents does to a process holding a foreground service is recorded separately on the device, not assumed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CD23 | **The absent engine.** With no native module, `createAbsentCaptureEngine` reports idle, answers an arm with `ended{fatal-error}` naming that session, and answers a reset of that with idle. It ignores everything else. This is the one TypeScript engine with a rule of its own, and it holds no session to disagree about. It is exempt from the contract kit, and pinned by its own tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CD24 | **Development switches.** `EXPO_PUBLIC_FAKE_ENGINE=1` keeps the fake in a `__DEV__` build, for UI work on a device. Without it, a dev build runs the native engine with `devEngine: null`. `EXPO_PUBLIC_FAKE_PLAYBACK_URL` (dev only) puts a real staging live input's **public** playback URL into the fake descriptor, so phase 4's delivery watch has a manifest to poll. Neither is readable in a release build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CD25 | **The Android compile job.** `.github/workflows/android-compile.yml` runs on PRs touching `modules/**`, `app.json`, `plugins/**` or `pnpm-lock.yaml` (spec §6), on temurin 17 with the Android SDK the runner image carries. It runs prebuild then `./gradlew assembleDebug`. Gradle, not EAS. It is **not** a required check, because a path-filtered workflow never reports on a PR it skips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CD26 | **A stop native never answers (carry 27).** Native answers every stop within one tick (Task 12 pins that). The JS clearing is bounded anyway: `useDisarm` gives up after 5 s, logs `disarm.gave-up`, and frees the engine for the next caller. Covering a native that never answers is cheap, and a lock on every caller is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CD27 | **StreamPack use.** One `SingleStreamer` per armed session, built at the accepted arm and released at `End` (reconnects reuse it), with our own `IEndpointInternal.Factory` (CD14, CD15), which routes SRT to `TsMuxer` plus our sink and RTMPS to `RtmpEndpointFactory`. `defaultRotation` is passed explicitly at arm, from the landscape side held (P4). **`setTargetRotation` is never called** (F-P5-6; enforced by `GlueRulesTest`). `KEY_MAX_B_FRAMES = 0` is set through `customize` on every supported phone (API 29+ honours it, and minSdk is 31, CD34). The encode is 720p30 with a 2 s GOP, starting at 1500k, and AAC-LC 128k at 48 kHz stereo with `byteFormat = ENCODING_PCM_16BIT` set explicitly, because `PcmPeak` reads 16-bit samples. The preview is `PreviewView` in FIT, with pinch-zoom and tap-to-focus off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CD28 | **The audio level.** An `IConsumerAudioEffect` on `audioInput.processor` hands each PCM frame to `PcmPeak`. `PeakMeter` keeps the highest peak between snapshots, and each snapshot takes it. Nothing is normalised (AGENTS §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CD29 | **`switchCamera` (carry 10).** It is mapped through to `Input.SwitchCamera`, and the glue swaps to the camera facing the other way. S1 has no control for it. It is reserved, not a defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| CD30 | **StreamPack's logger is ours (I14).** Task 20 sets `io.github.thibaultbee.streampack.core.logger.Logger.logger` to a `VendorLogger` in `EngineHost`'s first use, before any streamer exists. It forwards warnings and errors to `BridgeCore.log` as `vendor-log {tag, message, error}` at level `warn` or `error`, where `message` is a text key and so masked by value, and `error` is the throwable's class name only (never its message, which can quote a URL with a key). Info, debug and verbose are dropped. It writes nothing to logcat in any build: the glue may not import `android.util.Log` (`GlueRulesTest`), and the record is the one place a line goes. `GlueRulesTest` checks the assignment exists, once, in `EngineHost.kt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CD31 | **The accepted arm is noticed outside the snapshot sink (I1).** `Engine.publish` catches every `Exception` from the snapshot sink and only counts it, so nothing that must fail visibly may run there. `BridgeCore.report` posts, after each input, a task that compares the session held with the last one it acted on (by identity). On a new one it calls `platform.armed(config)` in that task; an `Exception` becomes a sticky failure with the attempt in hand (permanent or not, as CD11 classifies it), and an `Error` reaches `GuardedScheduler`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CD32 | **One process core, many module instances (I2).** `BridgeCore.shared` is per process and is built on `context.applicationContext`, never a React context. `EngineHost` holds the current snapshot listener and the current `AppContext` (for permission requests) in two `OwnedSlot`s: a module's `OnCreate` takes both, and its `OnDestroy` releases each only if it still owns it. A dev reload or an Expo Updates reload therefore never leaves the core talking to a destroyed context, whichever of the old `OnDestroy` and the new `OnCreate` runs first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CD33 | **Lateness is recorded.** `Lateness` (Task 9) is pure: `TickLateness` writes `tick-late {gapMs}` when two ticks are more than 1000 ms apart, and `FrameGaps` writes `frames-gap {gapMs}` once per stall when the video count has not moved for more than 500 ms while publishing. They are the evidence for CD10's wake lock and research Open 11, and production evidence of deep sleep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CD34 | **Android 12+ (owner ruling, 2026-10-01).** `minSdkVersion` is **31**, set with `expo-build-properties` (`android.minSdkVersion: 31` in `app.json`'s plugins, pinned to Expo 57's `~57.0.22`; it is a config plugin with no native code, so nothing autolinks). Task 20 checks the merged manifest says 31, and `android-compile.yml` fails if it does not. Every branch for an older API is deleted, with its test: `MicSilenceWatch` takes no SDK and always reads the silencing signal (API 29+); `EncoderKeys.VIDEO` always sets B-frames off (API 29+); `ApplicationExitInfo` (30+), the thermal status (29) and headroom (30), the notification channel (26+) and the service types (29+) are read with no version check. `POST_NOTIFICATIONS` is asked on API 33+ only, since 31 and 32 allow notifications by default. **Carry 23 (API 24–28 has no silencing signal) is closed by this ruling**, not deferred. The Redmi Note 7 Pro (Android 10) is no longer supported: the device gate's second geometry is the OnePlus under `adb shell wm size` and `wm density` overrides, reset afterwards, plus an Android 12 or 13 phone if the owner has one (Task 26).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CD35 | **Versions, checked on Maven Central on 2026-10-01 (owner ruling: the latest stable releases).** StreamPack **3.2.0** and srtdroid **1.10.1** are the latest stable releases, and are pinned. srtdroid 1.10.1's public API is 1.9.5's plus `trySend` and nothing removed (a `javap` diff of both AARs' `classes.jar`), so StreamPack 3.2.0's `srt` module, built against 1.9.5, links against it unchanged; its `libsrtdroid.so` carries libsrt **1.5.7**. Every srtdroid call Task 21 makes was read from the 1.10.1 jar. **komuxer stays at 0.4.0, and Ktor at 3.3.3**, although komuxer 0.4.4 and Ktor 3.6.0 are newer: StreamPack 3.2.0's `streampack-rtmp` POM depends on komuxer 0.4.0 (built against Ktor 3.3.3), and every komuxer from 0.4.1 depends on `kotlin-stdlib` 2.4.0, whose metadata Kotlin 2.1.20 cannot read (research §Toolchain). A newer Ktor under komuxer 0.4.0 would be a pairing neither library was built or tested with. **OkHttp stays at 4.9.2, `compileOnly`**, though 5.5.0 is current: it is compiled against, never shipped by us, and the copy that runs is the one `react-android` 0.86.3 brings (M14); compiling against another major than the one that runs would be the defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Owner rulings of 2026-10-01

The independent review raised three questions only the owner could settle (P1–P3). The owner ruled on them on 2026-10-01, given to the coordinator directly, and gave three more rulings the same day. Each is built as ruled; Task 1 records them in the plan A results, and Task 26's results repeat them.

| #         | Ruling                                                                                                                                                                                                                                                                                  | Where it is built                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| P1        | **The crash screen uses the app's last resolved language, falling back to the phone's.** The root boundary reads a module-level holder the language provider sets synchronously when the language resolves (no storage read on the crash path), with its strings from the dictionaries. | Task 19, Step 6                                      |
| P2        | **CD17, CD18, CD19 and CD21 are accepted, with glossary-checked copy** (the table under Batch C5). TROUBLE means "broadcast degraded" or "engine silent", and the status line tells them apart. CD18 is proved in jsdom only. CD21 is one string.                                       | Tasks 18 and 25                                      |
| P3        | **The operator's language is passed in the arm intent, and the foreground notification uses it** (CD16): one `language` field in `armWire` and `ArmMapping`; native picks `NotificationText.WORDS[language]`, then the phone's language, then `en`.                                     | Tasks 2, 4, 10, 14 and 24, each step marked **(P3)** |
| minSdk    | **Android 12+ (API 31).** Below-31 branches and their tests are deleted; `POST_NOTIFICATIONS` is asked on 33+ only; carry 23 is closed; the Redmi Note 7 Pro (Android 10) leaves the device gate.                                                                                       | CD34; Tasks 10, 11, 20, 22, 23, 24 and 26            |
| Execution | **Subagent-driven, batch by batch**: one implementer per batch, then the reviewer on the batch diff, as _Dispatch batches_ says.                                                                                                                                                        | Dispatch batches                                     |
| Versions  | **The latest stable releases**: StreamPack 3.2.0 and srtdroid 1.10.1 (Maven Central, 2026-10-01). srtdroid's calls are read from the 1.10.1 jar, not marked for later. komuxer, Ktor and OkHttp stay where they are, for the reasons in CD35.                                           | Global Constraints (Pins), CD35, Task 21             |

## Carry traceability

Every item of `docs/specs/2026-09-30-s1-plan-a-results.md` § _Carried to plan C_. **25 are fully mapped here, 2 are partly deferred to plan D**, with the reason given, and **1 (carry 23) is closed by the owner's minSdk ruling** (CD34).

| Carry | Subject                                                                                               | Where                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Replace the fake; run the contract kit (real settle, 500 ms tick, native state at construction)       | Tasks 12, 13, 15, 16 (ack-settled, CD8), 19                                                                                                                                                                                                       |
| 2     | sid, slot and tokenTag in the snapshot; refused arm still named; cross-language FNV-1a with non-ASCII | Tasks 2, 5, 14; CD5                                                                                                                                                                                                                               |
| 3     | Map `Snapshot.camera`; a null camera keeps Go live off                                                | Task 5 (wire vectors), Task 14 (JS mapping test)                                                                                                                                                                                                  |
| 4     | Re-hydrate the descriptor with its Dates                                                              | Task 14; CD5                                                                                                                                                                                                                                      |
| 5     | Platform telemetry, `reasons.first()`, null rates stay null                                           | Tasks 5, 9, 14, 22, 23                                                                                                                                                                                                                            |
| 6     | Pin `ConnectFailure` and `HeartbeatResult` wires and the snapshot shape (no `shed` in the state)      | Task 5 (vocabulary in the vectors file), Task 14                                                                                                                                                                                                  |
| 7     | `survivesBackground` drives the P1 warning                                                            | Task 18 (CD18), Task 24 (native fact, optimistic from the accepted arm; permissions before the service, C3)                                                                                                                                       |
| 8     | Stale snapshots                                                                                       | Task 18 (CD17)                                                                                                                                                                                                                                    |
| 9     | The native preview replaces the empty stage                                                           | Task 25                                                                                                                                                                                                                                           |
| 10    | `switchCamera` reserved                                                                               | Task 4; CD29                                                                                                                                                                                                                                      |
| 11    | One record, one allow-list, drift tests both sides, mask marker, one vector                           | Task 3, Task 15; CD6, CD7                                                                                                                                                                                                                         |
| 12    | Logger feed posted through the Scheduler; `reentrantDropped` beside `sinkFailures`                    | Task 12 (`log` posts through `Engine.log`), Task 18 (Diagnostics rows)                                                                                                                                                                            |
| 13    | The SRT URL built with `URLEncoder`                                                                   | CD14 (no SRT URL string exists), CD15 (RTMPS key encoded), Tasks 21–22                                                                                                                                                                            |
| 14    | Deep sleep: wake lock or documented lateness                                                          | Task 9 (`tick-late`, CD33), Task 24 (the wake lock); CD10. Device evidence: Task 26 reads `tick-late` lines across a screen lock                                                                                                                  |
| 15    | Report any `Throwable` at the task boundary; start and stop on the scheduler                          | Tasks 6, 12 (`armed` outside the sink, CD31), 20; CD9                                                                                                                                                                                             |
| 16    | One poller per link, or a minimum interval                                                            | Task 7; CD12                                                                                                                                                                                                                                      |
| 17    | Descriptor adapter: echo the id; call the pure rule                                                   | Task 8; CD13                                                                                                                                                                                                                                      |
| 18    | Sticky permanent failures; one Engine per process; failure before first Connect                       | Tasks 6, 12 (including a throw from `platform.armed`); CD11, CD31                                                                                                                                                                                 |
| 19    | Frames every 500 ms through a switch                                                                  | Task 7; CD12; `frames-gap` (Task 9, CD33)                                                                                                                                                                                                         |
| 20    | 204 → NoContent; no-cache; staging hint and window                                                    | Task 8, Task 23. **Partly deferred to plan D:** "hint 0.1 returns one variant" and "Cloudflare's listed window" need the real stg fixture and descriptor (spec phase 5). Task 26 records the playlist evidence on the raw input, where it exists. |
| 21    | RR-12 table test; RR-13 KDoc                                                                          | Task 1                                                                                                                                                                                                                                            |
| 22    | Mic at a call: order of events; audio at hang-up                                                      | Task 26 (device checklist, owner's hands)                                                                                                                                                                                                         |
| 23    | API 24–28: no silencing signal; the 25 s reset against a link collapsing every 25–30 s                | **Closed by the owner's ruling of 2026-10-01 (minSdk 31, CD34).** No supported phone lacks the silencing signal, so neither half applies. Task 10's below-29 branch and its test, and Task 26's API 28 step, are removed.                         |
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
| B-frames | `P5 B-frames are off on every supported phone`                                                                      | 11   |

## Device-only claims

No test in this plan can prove the following. Each is on the owner's checklist in Task 26, with what to read:

- the preview, its framing against the encoded stream (#288), FIT letterboxing and both landscape sides — P4's three assertions, each read separately: the preview upright on screen (a screenshot), the encoded picture upright (a frame grabbed with `ffmpeg -ss 5 -frames:v 1`, opened and looked at), and the rotation metadata (`ffprobe -show_streams`: no `rotation` side data, `width` 1280 and `height` 720);
- B-frames off on each handset the run uses: `ffprobe -show_frames` counts zero `pict_type=B` frames, with `has_b_frames=0` beside it;
- the capture clock: `CaptureClock` assumes StreamPack's frame timestamps use the clock `monoNowUs` reads (`TimeUtils.currentTime()`, uptime). Read on the device as the `capture-clock {lagMs}` line Task 22 writes at each attempt's first video frame (`lagMs` = wall now minus `CaptureClock.epochMs` of that frame): between 0 and a few hundred ms, never negative and never in the thousands;
- `MAXBW` pacing on a thin link (F-P5-11's 1.5 Mbit/s cell), and what a paced `send` does to the encoder (#302);
- srtdroid 1.10.1 publishing to Cloudflare for at least 10 minutes with a reconnect;
- the TLS guard: at least 10 RTMPS cuts against Cloudflare with no crash, and a mutation run where the crash returns;
- the foreground service on Android 14 and 16: on a **fresh install**, the permission dialog comes first, both grants lead to the service and no `SecurityException`, and the notification text (`adb shell dumpsys activity services com.seazn.capture` shows the service with `types=camera|microphone`);
- the wake lock across a 5-minute screen lock: no `tick-late` line in the record for that span (CD33);
- a JS reload while armed and while live: snapshots keep arriving, and a re-arm's permission flow works (CD32);
- the preview after a Settings round trip while armed, then End, then a re-arm: the preview shows each time (Task 25);
- the audio level floor on the OnePlus (and an Android 12/13 phone if the owner has one): Go live stays off with the mic covered in a quiet room, and enables with a voice;
- mic silencing at a real call; camera contention from a second app; the slate on air; the reopen;
- the charge-counter drain, on the OnePlus and on an Android 12 or 13 phone if the owner has one; thermal readings;
- memory after 20 forced reconnects (#306);
- a `PreviewView` resize while live causing no `frames-gap` line (research, Open 11);
- what a swipe from Recents does to a process holding the foreground service, recorded as seen (the `user-requested` exit reason is read from a Task Manager stop);
- a permission granted after its session ended starts no service and opens no camera (N2): `dumpsys` lists no service, and the record has `permissions-late`;
- whether `stopSelf()` after a refused `startForeground` itself raises the "did not then call startForeground" crash (N10): it cannot be forced on a stock phone, so it is listed **unproved** unless it occurs;
- what the operator sees: every colour, plate, line and the boundary's fallback.

## File map

`K` is `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine`, `T` the same under `src/test`, and `G` is `modules/capture-engine/android/src/main/java/com/seazn/capture/engine`.

| Path                                                                                                                                                                                                                                                                                                                                                                                            | Responsibility                                                                                                                                                                                   | Task |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `T/core/EndPathsTest.kt`                                                                                                                                                                                                                                                                                                                                                                        | RR-12: every end path keeps the duration and the network fact                                                                                                                                    | 1    |
| `K/core/TokenTag.kt`, `SessionConfig.kt` (`language`, P3), `Phase.kt` (`Ended.sessionName`), `Snapshot.kt`, `Projection.kt`, `SessionMachine.kt`                                                                                                                                                                                                                                                | The session's name                                                                                                                                                                               | 2    |
| `modules/capture-engine/src/wire/token-tag-vectors.json`                                                                                                                                                                                                                                                                                                                                        | The FNV-1a vectors both sides read                                                                                                                                                               | 2    |
| `modules/capture-engine/src/scrub/{allow-list,vectors}.json`                                                                                                                                                                                                                                                                                                                                    | The shared scrub, and its cross-language vectors                                                                                                                                                 | 3    |
| `K/core/SessionRecord.kt`, `src/services/scrub.ts`, `src/services/logger.ts` (`release`, N7), `src/hooks/useStreamArm.ts` (`useProtect`), `src/services/sessionRecord.ts` (`parseRecordLine`), `test/fakePorts.ts`                                                                                                                                                                              | The scrub reconciled, free text masked whole with no session in hand; the flat line format, `level` only when not info                                                                           | 3    |
| `K/adapter/ArmMapping.kt`, `IntentMapping.kt`                                                                                                                                                                                                                                                                                                                                                   | Bridge maps → `SessionConfig`, `Input`                                                                                                                                                           | 4    |
| `K/adapter/PlatformFacts.kt`, `SnapshotWire.kt`; `modules/capture-engine/src/wire/snapshot-vectors.json`                                                                                                                                                                                                                                                                                        | Snapshot → the wire map; the shared vectors                                                                                                                                                      | 5    |
| `K/adapter/GuardedScheduler.kt`, `Failures.kt`                                                                                                                                                                                                                                                                                                                                                  | The task boundary; permanent and sticky failures                                                                                                                                                 | 6    |
| `K/adapter/AttemptPollers.kt`                                                                                                                                                                                                                                                                                                                                                                   | Frames every 500 ms and Link every 1000 ms, one per attempt                                                                                                                                      | 7    |
| `K/adapter/Http.kt`                                                                                                                                                                                                                                                                                                                                                                             | Request specs and answer mapping                                                                                                                                                                 | 8    |
| `K/adapter/DeviceReadings.kt`, `PreviousExit.kt`, `FrameTally.kt`, `Lateness.kt`                                                                                                                                                                                                                                                                                                                | PCM peak, drain, thermal, shed, capture time, exit reasons, frame counting; `tick-late` and `frames-gap` (CD33)                                                                                  | 9    |
| `K/adapter/MicSilenceWatch.kt`, `CameraAvailability.kt`, `NotificationText.kt`                                                                                                                                                                                                                                                                                                                  | The watch logic and the notification copy, channel and language                                                                                                                                  | 10   |
| `K/adapter/SrtOptions.kt`, `TlsCloserGuard.kt`, `AttemptSignals.kt`, `EncoderKeys.kt`; `T/adapter/GlueRulesTest.kt`                                                                                                                                                                                                                                                                             | SRT socket options and the host resolution; the TLS guard; one drop per attempt; B-frames and rotation; source rules for the glue                                                                | 11   |
| `K/adapter/BridgeCore.kt`, `Platform.kt`, `OwnedSlot.kt`; `T/adapter/{BridgeCoreTest,OwnedSlotTest,RecordingPlatform,ArmWire}.kt`                                                                                                                                                                                                                                                               | The engine host every platform uses; the arm noticed outside the sink (CD31), and a failure in work posted for it ending that session (`armFailed`, N1); slots owned by a module instance (CD32) | 12   |
| `modules/capture-engine/android/core/host/**` (`Main.kt`, `Host.kt`, `Protocol.kt`, `ScriptedPlatform.kt`)                                                                                                                                                                                                                                                                                      | The JVM host process for the contract kit, with the ack                                                                                                                                          | 13   |
| `modules/capture-engine/src/snapshotWire.ts`, `armWire.ts`; `CaptureEnginePort.ts`; `src/hooks/useStreamArm.ts`                                                                                                                                                                                                                                                                                 | Wire ↔ `EngineSnapshot`; arm intent → wire, with the language (P3)                                                                                                                               | 14   |
| `modules/capture-engine/src/{nativeModule,nativeCaptureEngine,absentCaptureEngine}.ts`                                                                                                                                                                                                                                                                                                          | The JS bridge (`settled()`), and the absent engine                                                                                                                                               | 15   |
| `src/services/sessionRecord.ts` (`createRoutedRecord`, `recordGoesNative`)                                                                                                                                                                                                                                                                                                                      | The record routed by session                                                                                                                                                                     | 15   |
| `modules/capture-engine/src/contract/engineScenarios.ts`, `test/engineContract.ts`, `test/hostEngine.ts`, `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts`, `vitest.config.mts`, `.github/workflows/bridge-contract.yml`                                                                                                                                                         | The contract kit, its host harness, its run and its workflow                                                                                                                                     | 16   |
| `src/hooks/useDisarm.ts`                                                                                                                                                                                                                                                                                                                                                                        | The 5 s bound                                                                                                                                                                                    | 17   |
| `src/hooks/engineSilence.ts`, `advisory.ts`, `useViewfinder.ts`, `diagnostics.ts`, `src/ui/components/{EndedBlock,StreamStage}.tsx`, `src/i18n/*.json`, `src/i18n/budgets.test.ts`, `docs/i18n-glossary.md`                                                                                                                                                                                     | Silence, keep-open, permission line, record counters, and their reviewed copy                                                                                                                    | 18   |
| `src/hooks/{nativePorts,engineWiring,useEngineProbe,probeSessions,usePorts}.ts(x)`, `src/ui/components/DevProbe.tsx`; (P1) `src/hooks/lastLanguage.ts`, `src/ui/components/RootBoundary.tsx`, `src/hooks/useLanguage.tsx`                                                                                                                                                                       | The composition root; the device probe; (P1) the crash screen's language                                                                                                                         | 19   |
| `app.json` (`expo-build-properties`, minSdk 31), `modules/capture-engine/expo-module.config.json`, `android/build.gradle`, `android/.gitignore`, `android/src/main/AndroidManifest.xml`, `G/{CaptureEngineModule,EngineHost,VendorLogger,HandlerScheduler,AndroidClock,RecordFile,AndroidPlatform,HttpAdapter}.kt`, `G/capture/{Capture,NoCapture}.kt`; `.github/workflows/android-compile.yml` | The module scaffold, StreamPack's logger replaced                                                                                                                                                | 20   |
| `G/srt/{SeaznSrtSink.kt,NOTICE.md}`, `G/endpoints/{CaptureEndpointFactory,RoutingEndpoint,CountingEndpoint,CaptureClockLine,RtmpDispatcher,RtmpDispatcherProvider,TlsGuard}.kt`                                                                                                                                                                                                                 | Endpoints                                                                                                                                                                                        | 21   |
| `G/capture/{StreamerAdapter,AudioSessionIds,SlateSource,AudioLevelEffect}.kt`, `android/src/main/res/{drawable/slate.xml,values/colors.xml}`, `T/adapter/SlateColoursTest.kt`                                                                                                                                                                                                                   | Capture, encode, publish; the slate and its colours                                                                                                                                              | 22   |
| `G/watch/{CameraWatch,MicWatch,NetworkWatch,DeviceSampler}.kt`                                                                                                                                                                                                                                                                                                                                  | Android facts → inputs; the first phone run                                                                                                                                                      | 23   |
| `G/{CaptureForegroundService,SessionKeeper,Permissions,ExitReader}.kt`; `K/adapter/ArmTurns.kt`, `T/adapter/ArmTurnsTest.kt`                                                                                                                                                                                                                                                                    | Permissions, then the foreground service, for the current arm only (N2); the wake lock; the notification; the previous exit                                                                      | 24   |
| `G/CapturePreviewView.kt`, `src/services/native/nativeSurfaces.tsx`, `src/ui/components/{PreviewBoundary,StreamStage,DevScenes}.tsx`, `test/fakeSurfaces.ts`, `modules/capture-engine/src/nativeCaptureEngine.ts` (`pauseReports`)                                                                                                                                                              | The preview, its boundary, and the dev controls                                                                                                                                                  | 25   |
| `docs/specs/2026-10-0x-s1-plan-c-results.md`                                                                                                                                                                                                                                                                                                                                                    | The results and the owner's checklist                                                                                                                                                            | 26   |

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

- [ ] **Step 5: Record the owner's rulings of 2026-10-01** in `docs/specs/2026-09-30-s1-plan-a-results.md`. Change the heading "**Also visible, not yet ruled by the owner:**" to "**Also visible — ruled by the owner on 2026-10-01:**". Then rewrite the three bullets, and add the block that follows them:

```markdown
- **The M4 crash screen's copy — approved as built** (owner, 2026-10-01):
  "Something broke" / "The broadcast may still be live. Try again to get
  back to Stop.", with a Try again button.
- **The language of the crash screen — the app's last resolved language,
  falling back to the phone's** (owner, 2026-10-01; plan C's P1, built in
  plan C Task 19).
- **A boundary for the viewfinder alone — decided** (owner, 2026-10-01): plan
  C builds one around the native preview only, so a preview crash keeps the
  HUD column and Stop without a full restart (plan C, CD19 and Task 25).

**Rulings for plan C (owner, 2026-10-01):**

- **P2 — four owner-visible behaviours accepted, with glossary-checked
  copy:** the engine-silent status line and TROUBLE plate (CD17), the
  keep-open advisory (CD18), the viewfinder boundary's caption and Show
  preview button (CD19), and the permissions line on the Ended block (CD21).
- **P3 — the notification speaks the operator's language:** the arm intent
  carries it, and the foreground notification uses it, then the phone's,
  then English (CD16).
- **Android 12+ (minSdk 31).** Code and tests for older APIs are removed;
  `POST_NOTIFICATIONS` is asked on Android 13+ only. Carry 23 (no silencing
  signal on API 24–28) is closed by this ruling. The Redmi Note 7 Pro
  (Android 10) is no longer supported; the second geometry is the OnePlus
  under `adb shell wm size` / `wm density` overrides, reset afterwards, plus
  an Android 12 or 13 phone if the owner has one.
- **Execution:** subagent-driven, batch by batch.
- **Versions:** the latest stable releases, StreamPack 3.2.0 and srtdroid
  1.10.1 (Maven Central, 2026-10-01). komuxer stays at 0.4.0 and OkHttp at
  4.9.2, for the reasons in plan C's CD35.
```

- [ ] **Step 6: Verify and commit.** Run the core suite (EXIT=0; count 452 + 2). Run `pnpm prettier --check docs/specs/2026-09-30-s1-plan-a-results.md`. Then commit:

```bash
cd "$WT" && git add modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/EndPathsTest.kt modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Engine.kt docs/specs/2026-09-30-s1-plan-a-results.md && git commit -F - <<'EOF'
test(core): every end path keeps its duration and network fact (RR-12)

Carry 21. Mutations: a bogus Now in the heartbeat's and the descriptor's
end both fail the table. RR-13: Engine.log's KDoc says the line is stamped
when it runs. Records the owner's rulings of 2026-10-01.

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
  - **(P3)** `SessionConfig.language: String`, default `""`, which the machine never reads;
  - `Phase.Ended.sessionName: SessionName?`. Not `name`: `Phase` already declares `val name: String`, the phase's word, which `Ended` overrides as `"ended"` (`Phase.kt:80`, `:119`), so a second `name` does not compile. Not `session` either: the extension `val Phase.session: Session?` (`Phase.kt:123`) already answers "the session held", with a different type;
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
  /** (P3) The operator's language at arm, for the notification only (CD16); blank when JS sent none. */
  val language: String = "",
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
    val sessionName: SessionName? = null,
  ) : Phase {
```

and in `Phase.ended`:

```kotlin
  return Phase.Ended(reason, ids, durationMs, networkValidated, session?.config?.name)
```

In `SessionMachine.arm`'s refused branch:

```kotlin
      return Step(phase.ended(EndReason.FATAL_ERROR, now).copy(sessionName = config.name), listOf(refused, Command.End(EndReason.FATAL_ERROR)))
```

In `Snapshot.kt`, add last, defaulted:

```kotlin
  /** Which session this is about (carry 2): from the session held, or the one that ended. */
  val session: SessionName? = null,
```

In `Projection.snapshot`:

```kotlin
      session = session?.config?.name ?: (phase as? Phase.Ended)?.sessionName,
```

- [ ] **Step 6: Run the core suite.** Expected: green, except `EngineTest` line 147 and `SessionMachineLifecycleTest` line 773 if they compare an `Ended` built without a name against one that now has one. Update only those expectations, adding `sessionName = Configs.valid().name` where a session existed. Never change the machine to fit an old expectation.

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
  2. Drop `.copy(sessionName = config.name)`. The refused-arm test fails.
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
- Modify: `core/.../SessionRecord.kt` (`RecordEntry` gains its level with a default, so `Engine.kt` and every caller are unchanged)
- Modify: `core/src/test/.../SessionRecordTest.kt`. **Eight tests change their point**, each listed in Step 6 with its old point, its new point and its new expectation. Every other literal line in the file is unchanged, because a line whose level is `info` writes no `level` key (CD7).
- Modify: `src/services/scrub.ts`, `src/services/scrub.test.ts` (two added tests, Step 7), `src/services/sessionRecord.ts`, `test/fakePorts.ts` (`readRecord`)
- Modify (N7): `src/services/logger.ts` (`release`), `src/services/logger.test.ts` (one added test), `src/hooks/useStreamArm.ts` (`useProtect`'s cleanup), `src/ui/screens/StreamScreen.newCode.test.tsx` (one added test)
- Modify: the JS tests that read a line's raw JSON themselves, which change to `parseRecordLine` or to the flat keys. Each keeps its point:
  - `src/services/sessionRecord.test.ts:12, 23, 45-46` — the line's own shape, now flat;
  - `src/services/logger.test.ts:6` — `parsed` becomes `lines.map(parseRecordLine)`;
  - `src/services/kvTimeout.test.ts:12`, `src/services/overlayGuard.test.ts:24`, `src/services/streamSettingsStore.test.ts:14` — `JSON.parse(line)` becomes `parseRecordLine(line)`;
  - `src/services/native/nativeSurfaces.test.tsx:65, 229` — the same; line 229 reads `fields.kind`, which `parseRecordLine` restores from `field_kind`;
  - `src/services/fetchDescriptorPort.test.ts:53, 237, 312, 354` — these match `'"event":"descriptor.error"'` in the raw text, which becomes `'"kind":"descriptor.error"'`.
- Unchanged, and run to prove it: `src/ui/screens/HomeScreen.test.tsx` (15 files use `readRecord`, which keeps returning `{ level, event, fields }` with `fields.kind` restored) and `src/services/scrub.test.ts`'s existing tests (`kind` stays a plain key, so lines 37, 136, 140 and 189 hold).

**Interfaces:**

- Produces, in Kotlin:
  - `RecordEntry(kind, fields, level = "info")`;
  - the class sets `SessionRecord.PLAIN_KEYS`, `PUBLIC_URL_KEYS`, `TEXT_KEYS`, `NEVER` and `RESERVED_KEYS`, with `MASK = "***"`.
- Produces, in JS:
  - `SCRUBBED === '***'`;
  - `scrubFields(fields, held = NOTHING_HELD, inHand = held holds anything)`, and `Logger.release()` (N7);
  - the sets `PLAIN_KEYS`, `PUBLIC_URL_KEYS`, `TEXT_KEYS` and `NEVER_KEYS`, exported for the drift test;
  - `toRecordLine(entry)`, which writes `{"at","kind",…fields}`, with `"level"` after `kind` only when it is not `info`;
  - `parseRecordLine(line): RecordedEntry`, which reads back `{ atMs, level, event, fields }`, the level defaulting to `info` and each `field_<reserved>` key restored to `<reserved>`.

- [ ] **Step 1: The allow-list file**, decided key by key. Both sides keep exactly these sets as code; the file is the source of record, and each key's reason names the side that writes it:

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
    "error",
    "exit",
    "failure",
    "from",
    "host",
    "intent",
    "key",
    "kind",
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
    "tag",
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
    "error": "plan C: a throwable's class name only, never its message (CD30)",
    "exit": "plan C: ApplicationExitInfo reason wire (CD22)",
    "failure": "native: ConnectFailure wire",
    "from": "native: a state or phase name",
    "host": "both: a bare host, never a path or query (plan A I1)",
    "intent": "native: an intent name",
    "key": "JS: a dictionary or store key name, never a value",
    "kind": "JS: a failure kind word (descriptor.error, surface.unavailable), written to the line as field_kind; native: a Wire",
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
    "tag": "plan C: a vendor log's tag, a class name (CD30)",
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
    {
      "why": "a failure kind passes as a plain word, under the reserved name",
      "key": "kind",
      "value": "offline",
      "expected": "offline"
    },
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
      val key = case.getString("key")
      val line = JSONObject(written(RecordEntry("probe", listOf(key to value(case, "value")))))
      // A field named like a line key is written field_<key> (CD7); the value is what the vectors pin.
      val writtenAs = if (key in SessionRecord.RESERVED_KEYS) "field_$key" else key
      assertEquals(value(case, "expected"), value(line, writtenAs), case.getString("why"))
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

Relative imports reach the JSON from `src/services`. The boundaries rule is off for test files, so a test may import it; confirm with `pnpm lint`, and change `eslint.config.mjs` only if it refuses, by adding `modules/capture-engine/src/scrub/*.json` to the `contracts` element type. Do not widen services any further.

- [ ] **Step 4: Run both.** Expected: both fail. The key sets differ, the marker differs, and native masks URLs in place.

- [ ] **Step 5: Reconcile the Kotlin side.** In `SessionRecord.kt`:
  - Replace the companion's sets with the file's (`PLAIN_KEYS`, `PUBLIC_URL_KEYS` adds `url`, `RESERVED_KEYS` becomes public and adds `level`).
  - Add a level: `data class RecordEntry(val kind: String, val fields: List<Pair<String, Any?>> = emptyList(), val level: String = "info")`.
  - Write the head as `listOf("at" to …, "kind" to kindWord(entry.kind))`, then `"level" to entry.level` only when it is not `"info"`, so every line the core writes today keeps its exact shape (CD7). `BridgeCore.log` (Task 12) only ever passes `debug`, `info`, `warn` or `error`.
  - Rewrite the scrub to the four rules. A non-finite `Double` is now masked, as JS masks it, where it was written as `null`:

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

- [ ] **Step 6: Restate the eight `SessionRecordTest` tests whose point changes.** Read each before you change it. Never weaken one silently: rename it to its new point, and list every change in the commit body. Line numbers are at `d6931c1`.

| Line | Test today                                                                                                | Its new point and name                                                                                                                                                                         | New expectation                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 35   | the token is masked even inside a public URL (in place, `STREAM_ID in line`)                              | **a public URL with a query is masked whole, so nothing in it reaches the line**                                                                                                               | `"playbackUrl":"***"`; drop `assertTrue(STREAM_ID in line)` (line 30's test still pins the stream id passing in a clean URL); keep `assertFalse(TOKEN in line)` |
| 154  | a long, a null and a Decimal pass under any key, and a NaN is written as null                             | **… and a NaN is masked, as JS masks it**                                                                                                                                                      | `"drain":"***"`                                                                                                                                                 |
| 163  | a plain key passes its text, with a secret in it masked                                                   | **a plain key passes a plain word, and masks anything else whole**                                                                                                                             | `"host":"live.cloudflare.com","reason":"***"`                                                                                                                   |
| 169  | every key on the allow-lists passes plain text (`"plain words"`)                                          | **every key passes what its class allows**: each `PLAIN_KEYS` key passes `"plain-word"`, each `PUBLIC_URL_KEYS` key passes `Configs.PLAYBACK_URL`, each `TEXT_KEYS` key passes `"plain words"` | three loops over the class sets, each expecting its input back                                                                                                  |
| 180  | RTMPS preferred — the SRT fallback's stream id passes inside the public URL (`?tok=***`) and nowhere else | unchanged point, a clean URL: `"playbackUrl" to Configs.PLAYBACK_URL`                                                                                                                          | the URL verbatim, the stream id in its path; the message line unchanged, `streamid=***`                                                                         |
| 195  | RTMPS only — the stream key and the token are masked in text and inside a public URL                      | **… masked in text, and a public URL carrying them is masked whole**                                                                                                                           | `"playbackUrl":"***"`; the message unchanged                                                                                                                    |
| 209  | secrets from an earlier arm stay masked after a second arm (URL `?tok=***`)                               | unchanged point                                                                                                                                                                                | `"playbackUrl":"***"`; the message `"first *** second ***"` unchanged                                                                                           |
| 385  | the kind is masked by value like a field (`connect ***`)                                                  | **the kind is a plain word, or masked whole**                                                                                                                                                  | the token kind stays `"***"`; `"connect $STREAM_ID"` becomes `"kind":"***"`                                                                                     |

Line 379 (`field_kind`, `field_at`) is unchanged: `kind` is now a plain key on both sides, and `Transport.SRT` is a `Wire`. Run the whole core suite: any other literal line that changes is a finding, so stop and report it rather than edit it.

- [ ] **Step 7: Reconcile the JS side.** In `src/services/scrub.ts`:
  - `export const SCRUBBED = '***';`
  - Export `PLAIN_KEYS` with the file's list.
  - Add `PUBLIC_URL_KEYS = new Set(['url', 'playbackUrl', 'overlayUrl'])`, `TEXT_KEYS = new Set(['message', 'problems'])` and `NEVER_KEYS`.
  - Rewrite `scrubValue`. **One JS-only rule (CD6, I12, N7):** a text key is masked whole unless a session is in hand. JS holds a code's `tok` from the scan, before `useProtect` calls `logger.protect()` when the viewfinder holds the session (`useStreamArm.ts:66`), so a `message` logged in between would otherwise pass with only the shape check between it and the record. `protect` only ever adds (`logger.ts:16`), so the rule cannot be "nothing was ever protected": after the first viewfinder visit of a process that would stop holding, and a second code would be masked only by older secrets. It is keyed instead on the session in hand: `protect` sets it, and `release`, called by `useProtect`'s cleanup when the viewfinder lets the session go, clears it. Native holds nothing before an arm, so it needs no such rule, and the shared vectors (which always hold secrets, so `inHand` defaults to true) are unaffected.

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
  if (TEXT_KEYS.has(key)) return mask.inHand ? maskedText(value, mask.anywhere) : SCRUBBED;
  return SCRUBBED;
}

/** Replaces today's `Mask` (`scrub.ts:63-64`): which values no line may show (`anywhere`), which not even a public URL (`inUrls`), and whether a session is in hand (N7). */
type Mask = {
  readonly anywhere: readonly string[];
  readonly inUrls: readonly string[];
  readonly inHand: boolean;
};

/** `inHand` defaults to "something is held", so every caller that passes no flag, and the shared vectors, keep today's answer. */
export function scrubFields(
  fields: LogFields,
  held: SessionSecrets = NOTHING_HELD,
  inHand: boolean = held.secrets.length + held.streamIds.length > 0,
): LogFields {
  // as today, with maskOf(held, inHand) building the Mask
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

Add to `scrub.test.ts`:

```ts
it('I12 masks free text whole while nothing is protected: JS holds the code before the arm', () => {
  expect(scrubFields({ message: 'Connection refused (errno 111)' })).toEqual({ message: SCRUBBED });
  expect(scrubFields({ message: 'Connection refused (errno 111)' }, HELD)).toEqual({
    message: 'Connection refused (errno 111)',
  });
});

it('N7 masks free text whole when secrets are held but no session is in hand', () => {
  expect(scrubFields({ message: 'Connection refused (errno 111)' }, HELD, false)).toEqual({
    message: SCRUBBED,
  });
});
```

In `src/services/logger.ts`, `createLogger` keeps `let inHand = false`; `protect` sets it true after adding the secrets, a new `release()` sets it false, and `at` calls `scrubFields(fields, held, inHand)`. The interface gains:

```ts
  /**
   * N7: the viewfinder has let its session go. What was protected stays
   * masked; free text is masked whole until the next `protect` (CD6).
   */
  release(): void;
```

`useProtect` (`src/hooks/useStreamArm.ts:63-68`) returns the release as its cleanup, so a session change releases the old one before the new one is protected, and leaving the viewfinder releases it:

```ts
useEffect(() => {
  if (!session?.ok) return undefined;
  logger.protect(sessionSecrets(session.value));
  return () => logger.release();
}, [session, logger]);
```

`pnpm typecheck` lists any other object typed `Logger`; give each `release` (at `d6931c1`, `createLogger` is the only one). Add to `src/services/logger.test.ts`:

```ts
// N7: keyed on the session in hand, so a second code in the same process is covered as the first was.
it('N7 masks free text whole between one session and the next, and keeps the first masked', () => {
  const record = createRingRecord();
  const logger = createLogger({ record, now: () => 0 });
  logger.protect({ secrets: ['fake-token-000a'], streamIds: ['fake-stream-id-000a'] });
  logger.warn('first.held', { message: 'Connection refused (errno 111)' });
  logger.release();
  logger.warn('second.scanned', { message: 'GET /c?tok=fake-token-000b failed' });
  logger.protect({ secrets: ['fake-token-000b'], streamIds: ['fake-stream-id-000b'] });
  logger.warn('second.held', { message: 'retry fake-token-000a then fake-token-000b' });
  expect(record.lines().map((line) => parseRecordLine(line).fields.message)).toEqual([
    'Connection refused (errno 111)',
    SCRUBBED,
    `retry ${SCRUBBED} then ${SCRUBBED}`,
  ]);
});
```

And to `src/ui/screens/StreamScreen.newCode.test.tsx`, with the file's own saved-code setup: render the viewfinder, log `view.ports.logger.warn('in.view', { message: 'Connection refused (errno 111)' })`, then `view.unmount()` and log the same line as `after.leave`. `readRecord(view.record)` reads the message unchanged for `in.view` and `SCRUBBED` for `after.leave`.

- [ ] **Step 8: Unify the line format (CD7).** In `src/services/sessionRecord.ts`:

```ts
/** Fields named like the line's own keys are written as `field_<key>`, as native does. */
const RESERVED = new Set(['at', 'kind', 'level']);

/**
 * One flat NDJSON line, the same shape native writes: `{at, kind, …fields}`,
 * with `level` after `kind` only when it is not `info` (CD7).
 */
export function toRecordLine({ atMs, level, event, fields }: LogEntry): string {
  const line: Record<string, unknown> = { at: new Date(atMs).toISOString(), kind: event };
  if (level !== 'info') line.level = level;
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

/**
 * A line back into its parts, either side's. No `level` means `info`, which
 * neither side writes. A `field_<key>` rename is undone, so a reader sees the
 * fields as they were logged.
 */
export function parseRecordLine(line: string): RecordedEntry {
  const { at, kind, level, ...written } = JSON.parse(line) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(written)) {
    const original = key.startsWith('field_') ? key.slice('field_'.length) : key;
    fields[RESERVED.has(original) ? original : key] = value;
  }
  return {
    atMs: Date.parse(String(at)),
    level: typeof level === 'string' ? level : 'info',
    event: String(kind),
    fields,
  };
}
```

In `test/fakePorts.ts`, keep `RecordedEntry` as `{ level, event, fields }` and change `readRecord` to `record.lines().map((line) => { const { level, event, fields } = parseRecordLine(line); return { level, event, fields }; })`, so a test comparing whole entries is unchanged. Screen tests that read `entry.event`, `entry.fields` and `entry.level` then need no change. Change each JS test listed under Files as it says there. Add to `sessionRecord.test.ts`:

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
    fields: { kind: 'x', ms: 3 },
  });
});

it('CD7 writes no level for info, as native does, and reads a missing level back as info', () => {
  const line = toRecordLine({ atMs: 0, level: 'info', event: 'probe', fields: {} });
  expect(line).toBe('{"at":"1970-01-01T00:00:00.000Z","kind":"probe"}');
  expect(parseRecordLine(line).level).toBe('info');
});
```

- [ ] **Step 9: Run both suites.** Expected: green. JS tests asserting `'[scrubbed]'` used the constant (confirm with `grep -rn "\[scrubbed\]" src test` → no matches). If a JS test expected a number under an unknown key to be masked, it encoded the old rule: change its expectation to the number, restate its name, and note it in the commit. Run `pnpm vitest run src/ui/screens/HomeScreen.test.tsx` on its own and record its count: it must pass unchanged.

- [ ] **Step 10: Mutate, one at a time:**
  1. Native `isPublicUrl` returning true. The query, path-token and userinfo rows fail.
  2. JS `maskedText` returning `text`. The text rows fail.
  3. Drop `formsOf`'s `form`. The form-encoded row fails on the JS side.
  4. Add a key to `PLAIN_KEYS` on one side only. The drift test fails.
  5. Write `level` for `info` lines on the native side. The unchanged literal lines in `SessionRecordTest` fail.
  6. In `parseRecordLine`, keep `field_kind` as written. `nativeSurfaces.test.tsx:229` and the CD7 test fail.
  7. In JS `scrubValue`, return `maskedText` whatever `inHand` says. The I12 and N7 scrub tests fail.
  8. In `useProtect`, drop the cleanup's `release()`. The `StreamScreen.newCode` N7 test fails.
  9. In `logger.ts`, make `release` do nothing. The logger's N7 test fails on its second line.

- [ ] **Step 11: Verify and commit** both suites' raw counts and `pnpm check` EXIT=0. Then commit:

```bash
cd "$WT" && git add modules/capture-engine/src/scrub modules/capture-engine/android/core/src src/services src/hooks/useStreamArm.ts src/ui/screens/StreamScreen.newCode.test.tsx test/fakePorts.ts && git commit -F - <<'EOF'
feat(record): one scrub and one line format on both sides

Carry 11. allow-list.json is the source of record, decided key by key;
both sides test their sets against it and run one vector file. Marker
*** both sides; finite scalars pass under any key; plain and URL keys
mask the whole value; text masks in place (JS: whole until protected).
Lines are flat {at, kind, [level unless info], ...}.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PDXw352Q1KB2MG9qCcG8Pu
EOF
```

Stage only the files you changed. Confirm `git status --short` shows nothing else, and add `eslint.config.mjs` to the list only if Step 3 needed it.

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
  playbackUrl, heartbeatUrl, descriptorUrl, descriptorJson, appVersion,
  language }            // (P3) optional; "" when absent
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
      "language" to "fr",
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
    assertEquals("fr", config.language, "(P3) the notification's language")
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
      // (P3) The operator's language, for the notification only (CD16).
      language = WireValues.text(wire["language"]),
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
  /** True from the accepted arm until the foreground service's start fails or the session ends (CD16): optimistic, so the caption never flashes. */
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

### Task 9: Device readings, frame tally, lateness and the previous exit

Carry 5, carry 14's evidence, F-P5-3, F-P5-4, CD20, CD22, CD28 and CD33. Every rule the device sampler, the audio effect, the counting endpoint and the exit reader follow is pure and tested here, and so are the two lateness lines the device checks read. The glue only reads Android's values and hands them in.

**Files:**

- Create: `adapter/DeviceReadings.kt`, `adapter/FrameTally.kt`, `adapter/PreviousExit.kt`, `adapter/Lateness.kt`
- Test: `adapter/DeviceReadingsTest.kt`, `adapter/FrameTallyTest.kt`, `adapter/PreviousExitTest.kt`, `adapter/LatenessTest.kt`

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
  - `PreviousExit.reason(code: Int): String`, `PreviousExit.entry(markerPresent: Boolean, code: Int?, exitAtMs: Long?): RecordEntry?`;
  - `class TickLateness { fun observe(monoMs: Long, sessionHeld: Boolean): RecordEntry? }` (CD33, `tick-late {gapMs}`);
  - `class FrameGaps { fun read(attemptId: Int, video: Long, monoMs: Long, publishing: Boolean): RecordEntry? }` (CD33, `frames-gap {attempt, gapMs}`).

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

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** CD33: the two lines the device checks read for deep sleep (carry 14) and a preview resize (Open 11). */
class LatenessTest {
  @Test
  fun `carry 14 ticks more than 1000 ms apart while a session is held are recorded with the gap`() {
    val ticks = TickLateness()
    assertNull(ticks.observe(0, sessionHeld = true), "the first tick has nothing to be late against")
    assertNull(ticks.observe(500, true))
    assertNull(ticks.observe(1_500, true), "exactly 1000 ms is not late")
    // 1 500 → 4 000: a 2 500 ms gap, the shape of a phone that slept.
    assertEquals(RecordEntry("tick-late", listOf("gapMs" to 2_500L)), ticks.observe(4_000, true))
  }

  @Test
  fun `without a session a slow tick is harmless, and the next session starts a fresh baseline`() {
    val ticks = TickLateness()
    ticks.observe(0, sessionHeld = false)
    assertNull(ticks.observe(60_000, sessionHeld = false), "deep sleep with no session is allowed (CD10)")
    assertNull(ticks.observe(120_000, sessionHeld = true), "the first tick of a session is its baseline, however long the sleep before it")
    assertNull(ticks.observe(120_500, true))
  }

  @Test
  fun `Open 11 video that stops moving while publishing is one gap, recorded with its length when it moves again`() {
    val gaps = FrameGaps()
    assertNull(gaps.read(attemptId = 3, video = 0, monoMs = 0, publishing = true))
    assertNull(gaps.read(3, 15, 500, true))
    assertNull(gaps.read(3, 15, 1_000, true), "still stalled: nothing yet")
    assertNull(gaps.read(3, 15, 1_500, true))
    // Last moved at 500, moved again at 2 000: a 1 500 ms gap, written once.
    assertEquals(RecordEntry("frames-gap", listOf("attempt" to 3, "gapMs" to 1_500L)), gaps.read(3, 20, 2_000, true))
    assertNull(gaps.read(3, 35, 2_500, true))
  }

  @Test
  fun `exactly 500 ms between moves is not a gap, and nothing counts while not publishing or across attempts`() {
    val gaps = FrameGaps()
    gaps.read(3, 10, 0, true)
    assertNull(gaps.read(3, 11, 500, true), "moved again after exactly 500 ms is not more than 500 ms")
    assertNull(gaps.read(3, 11, 9_000, publishing = false), "a stall while not publishing is the machine's business, not a gap")
    assertNull(gaps.read(3, 12, 9_500, true), "publishing again starts a fresh baseline")
    assertNull(gaps.read(4, 0, 20_000, true), "a new attempt starts a fresh baseline")
    assertNull(gaps.read(4, 1, 20_500, true))
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
    /** Judgment: a shorter window reads the counter's own steps as drain. Measured on the device gate's phones (Task 26). */
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

`Lateness.kt`:

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.RecordEntry

/**
 * CD33, carry 14's evidence. Ticks are 500 ms apart; two more than [LATE_MS] apart while a session is
 * held mean the thread stalled or the phone slept through the wake lock. Without a session the tick
 * may pause in deep sleep, which is harmless (CD10), so it is not recorded and the baseline restarts.
 */
class TickLateness {
  private var lastMs: Long? = null

  fun observe(monoMs: Long, sessionHeld: Boolean): RecordEntry? {
    val last = lastMs
    lastMs = if (sessionHeld) monoMs else null
    if (!sessionHeld || last == null) return null
    val gap = monoMs - last
    return if (gap > LATE_MS) RecordEntry("tick-late", listOf("gapMs" to gap)) else null
  }

  companion object {
    const val LATE_MS = 1_000L
  }
}

/**
 * CD33, research Open 11. Read with each Frames poll (500 ms). The video count not moving for more
 * than [GAP_MS] while publishing is one gap, written once, with its length, when video moves again.
 * A stall that never ends is the machine's own business: it becomes a drop or a stall there.
 */
class FrameGaps {
  private var attempt: Int? = null
  private var lastVideo = 0L
  private var movedAtMs = 0L

  fun read(attemptId: Int, video: Long, monoMs: Long, publishing: Boolean): RecordEntry? {
    if (!publishing || attemptId != attempt) {
      attempt = if (publishing) attemptId else null
      lastVideo = video
      movedAtMs = monoMs
      return null
    }
    if (video == lastVideo) return null
    val gap = monoMs - movedAtMs
    lastVideo = video
    movedAtMs = monoMs
    return if (gap > GAP_MS) RecordEntry("frames-gap", listOf("attempt" to attemptId, "gapMs" to gap)) else null
  }

  companion object {
    const val GAP_MS = 500L
  }
}
```

`gapMs` and `attempt` are numbers, so the scrub passes them under any key (CD6). Both classes run only on the scheduler thread (`BridgeCore`, Task 12), so they need no lock.

`DeviceSample`'s constructor order is `(thermalStatus, thermalHeadroom, batteryPercent, charging, drainPctPerHour, shed)`. Check it in `Vocabulary.kt` before compiling.

`FrameTally` keeps an `AtomicLong` each for video, audio and bytes, and a `@Volatile` current attempt id. `begin` swaps in fresh counters, so a frame racing the swap counts toward one attempt or the other, never toward a third. `counted` classifies by `mime?.startsWith("video/")` or `"audio/"`, and adds bytes in either case. `PreviousExit.reason` indexes the word list from the test, or returns `"unknown"`. `entry` returns `RecordEntry("previous-session-lost", listOf("exit" to (code?.let(::reason) ?: "unknown"), "exitAtMs" to exitAtMs))` when the marker is present, and null otherwise.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Read the PCM samples big-endian. The peak test fails.
  2. Drop the `c1 > c0` guard. The rising-charge test fails.
  3. Count audio as video. The F-P5-4 test fails.
  4. Change `gap > LATE_MS` to `gap >= LATE_MS`. The "exactly 1000 ms" assertion fails.
  5. In `TickLateness.observe`, keep `lastMs` when no session is held. The fresh-baseline test fails.
  6. In `FrameGaps.read`, drop the `attemptId != attempt` reset. The new-attempt assertion fails.
  7. Change `gap > GAP_MS` to `gap >= GAP_MS`. The "exactly 500 ms" assertion fails.

  Then commit: `feat(adapter): device readings, frame tally, lateness and the previous exit`, with the trailer lines.

### Task 10: Mic silencing, camera availability, and the notification's words

F-P5-8, F-P5-9, F-P5-10 and CD16 (carry 23 is closed by CD34: every supported phone has the silencing signal). The spike proved each rule on a device. Here they become pure and tested, and the glue (Task 23) only forwards Android's callbacks.

**Files:**

- Create: `adapter/MicSilenceWatch.kt`, `adapter/CameraAvailability.kt`, `adapter/NotificationText.kt`
- Test: `adapter/MicSilenceWatchTest.kt`, `adapter/CameraAvailabilityTest.kt`, `adapter/NotificationTextTest.kt`
- Modify: `core/build.gradle.kts`: add `systemProperty("capture.i18n", layout.projectDirectory.dir("../../../../src/i18n").asFile.absolutePath)`

**Interfaces:**

- Produces:
  - `data class RecordingConfig(sessionId: Int, silenced: Boolean)`;
  - `class MicSilenceWatch { fun update(ours: Int?, configs: List<RecordingConfig>): Boolean? }`, where non-null means changed (no SDK argument: minSdk 31, CD34);
  - `class CameraAvailability(selfWindowMs = 1_500)`, with `held(id: String?, monoMs)`, `selfChange(monoMs)`, `unavailable(id, monoMs): Input?`, `available(id, monoMs): Input?`, `sessionStarted(): Input?` and `sessionEnded()`;
  - `NotificationText.line(word, targetKbps: Int?, liveSinceEpochMs: Long?, nowEpochMs: Long, locale: Locale): String`;
  - `NotificationText.WORDS: Map<String, Map<String, String>>`, keyed by language and then by tally key;
  - `NotificationText.CHANNEL: Map<String, String>`, the channel's name per language: the `mode.stream` word (M18, owner-visible in Android's notification settings);
  - **(P3)** `NotificationText.language(armLanguage: String, phoneLanguage: String): String`, the first of the two that `WORDS` holds, else `"en"`.

- [ ] **Step 1: Write the failing tests.**

```kotlin
class MicSilenceWatchTest {
  @Test
  fun `F-P5-8 a call silences our recording only, matched by session id`() {
    val watch = MicSilenceWatch()
    assertEquals(null, watch.update(ours = 41, configs = listOf(RecordingConfig(41, false))), "the first reading sets the baseline: not silenced is no change")
    assertEquals(true, watch.update(41, listOf(RecordingConfig(41, true), RecordingConfig(7, false))))
    assertEquals(null, watch.update(41, listOf(RecordingConfig(41, true))), "unchanged")
    assertEquals(null, watch.update(41, listOf(RecordingConfig(7, true))), "another app's silencing is not ours, and our absence is no change")
    assertEquals(false, watch.update(41, listOf(RecordingConfig(41, false))))
  }

  @Test
  fun `no session id of ours is no reading`() {
    assertEquals(null, MicSilenceWatch().update(null, listOf(RecordingConfig(41, true))))
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

  /** Spec §4's plate table, less not-ready, which has no meaning in a notification. Written out, not read from the code. */
  private val tallyKeys = setOf("starting", "ready", "connecting", "live", "trouble", "ended")

  @Test
  fun `the words are the app's own dictionary words, exactly the six tally keys in each of the four languages`() {
    val root = System.getProperty("capture.i18n")
    assertEquals(setOf("en", "es", "fr", "nl"), NotificationText.WORDS.keys)
    for ((language, words) in NotificationText.WORDS) {
      assertEquals(tallyKeys, words.keys, "$language holds every key and no other")
      val dictionary = JSONObject(File(root, "$language.json").readText())
      for ((key, word) in words) assertEquals(dictionary.getString("stream.tally.$key"), word, "$language $key")
    }
  }

  @Test
  fun `M18 the channel is named for the mode, in every language`() {
    val root = System.getProperty("capture.i18n")
    assertEquals(setOf("en", "es", "fr", "nl"), NotificationText.CHANNEL.keys)
    for ((language, name) in NotificationText.CHANNEL) {
      assertEquals(JSONObject(File(root, "$language.json").readText()).getString("mode.stream"), name, language)
    }
  }

  @Test
  fun `CD16 the notification is read from the wire the bridge publishes, so the glue holds no rule`() {
    val live = mapOf(
      "state" to mapOf("kind" to "publishing", "sinceEpochMs" to 1_790_000_000_000.0),
      "telemetry" to mapOf("targetBitrateKbps" to 3_000.0),
    )
    assertEquals("EN DIRECT · 3000k · 47 min", NotificationText.content(live, 1_790_002_850_000, "fr"))
    val armed = mapOf("state" to mapOf("kind" to "armed", "sinceEpochMs" to 0.0))
    assertEquals("PRÊT", NotificationText.content(armed, 1_790_002_850_000, "fr"), "minutes only while live")
    assertEquals("STARTING", NotificationText.content(mapOf("state" to mapOf("kind" to "exploded")), 0, "en"), "an unknown kind")
    assertEquals("STARTING", NotificationText.content(emptyMap(), 0, "en"), "no state at all")
  }

  // (P3, ruled 2026-10-01) The notification speaks the operator's language.
  @Test
  fun `P3 the arm's language wins, then the phone's, then English`() {
    assertEquals("fr", NotificationText.language(armLanguage = "fr", phoneLanguage = "es"))
    assertEquals("es", NotificationText.language(armLanguage = "", phoneLanguage = "es"))
    assertEquals("es", NotificationText.language(armLanguage = "de", phoneLanguage = "es"))
    assertEquals("en", NotificationText.language(armLanguage = "de", phoneLanguage = "pt"))
  }
}
```

The imports are `kotlin.test.*`, `java.util.Locale`, `java.io.File`, `org.json.JSONObject` and `com.seazn.capture.engine.core.Input`.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement.**
  - **`MicSilenceWatch`** keeps `last: Boolean?`. With no id of ours, `update` returns null. With our config absent it also returns null and keeps `last`. Otherwise it compares with `last`, which starts as `false`, so the first silenced reading is a change and the first unsilenced one is not. On a change it stores and returns the new value.
  - **`CameraAvailability`**:
    - It keeps `ours: String?`, `selfUntil: Long`, `contended: MutableSet<String>` and `inSession: Boolean`.
    - `unavailable` ignores our id and anything inside the self window. Otherwise it adds the id, and returns `CameraContended` when the set goes from empty to not empty while `inSession`.
    - `available` removes the id, and returns `CameraReleased` when the set empties while `inSession`.
    - `sessionStarted` sets `inSession` and returns `CameraContended` if the set is not empty.
    - `sessionEnded` clears `inSession`, and keeps the set: it is the device's truth, needed for the next session.
    - Every public method is `@Synchronized`: the camera callback (main looper, Task 23) and the capture scope (Task 22) both call it.
    - `held(id)` also drops `id` from `contended`.
  - **`NotificationText.WORDS`** holds the six `stream.tally.*` words (`starting`, `ready`, `connecting`, `live`, `trouble`, `ended`) for en, es, fr and nl, copied from the dictionaries. The test keeps them equal, and fails on a language missing a key or holding an extra one.
  - **`NotificationText.CHANNEL`** holds `mode.stream` for each language: "Live Stream", "Emisión en directo", "Diffusion en direct", "Livestream". The channel's name is fixed when the channel is first created, in the language of that moment, and Android shows it in the app's notification settings.
  - **(P3) `NotificationText.language`** returns `armLanguage` if `WORDS` has it, else `phoneLanguage` if `WORDS` has it, else `"en"`.
  - **`NotificationText.line`** upper-cases the word in `locale`. It adds `"${kbps}k"` when the target is known, and `"${minutes} min"` when the session is live, with minutes as `(now − since) / 60 000`.
  - **`NotificationText.tallyKey(state: SnapshotState): String`**, also tested, maps publishing to `live`, degraded and reconnecting to `trouble`, connecting to `connecting`, armed to `ready`, ended to `ended`, and idle to `starting`. That is plan A's plate table, without the not-ready case, which has no meaning in a notification.
  - **`NotificationText.content(wire: Map<String, Any?>, nowEpochMs: Long, language: String): String`** is what the service shows. It reads `state.kind` and looks it up in a `kind → tally key` map built once from `tallyKey` over every `SnapshotState`'s `wire` name (so the two cannot drift; an unknown or missing kind is `starting`), reads `state.sinceEpochMs` only when the key is `live`, and `telemetry.targetBitrateKbps`, each a `Double` on the wire (`.toLong()`/`.toInt()`), then returns `line(WORDS[language][key], kbps, since, now, Locale(language))`. `language` is already resolved by `language(…)`. The glue calls only this (Task 24).

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Drop the self-window check. The switch test fails.
  2. In `MicSilenceWatch`, treat our config's absence as not silenced. The F-P5-8 "our absence is no change" assertion fails.
  3. Change one Dutch word. The dictionary test fails.
  4. Drop `ended` from the Spanish words. The exact-keys assertion fails (a value-only comparison would have passed).
  5. (P3) Return `phoneLanguage` first. The arm-language assertion fails.
  6. In `content`, pass `sinceEpochMs` whatever the key. The `PRÊT` assertion fails.

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
  - `EncoderKeys.VIDEO: Map<String, Int>` and `EncoderKeys.rotationAtArm(displayRotation: Int): Int`.

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
  fun `P5 B-frames are off on every supported phone`() {
    // MediaFormat.KEY_MAX_B_FRAMES is "max-bframes" (API 29+); minSdk is 31 (CD34), so it is always asked for.
    assertEquals(mapOf("max-bframes" to 0), EncoderKeys.VIDEO)
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

  /**
   * The glue's Kotlin files. Until Task 20 the folder does not exist, and every rule here reports
   * SKIPPED, never a vacuous pass; Task 20 deletes the assumption. A folder that exists but holds no
   * Kotlin is a wrong path, and fails.
   */
  private fun sources(): List<File> {
    assumeTrue(root.exists(), "the glue arrives in Task 20") // Task 20 deletes this line.
    return root.walkTopDown().filter { it.extension == "kt" }.toList().also { assertTrue(it.isNotEmpty(), "no Kotlin under ${root.path}") }
  }

  @Test
  fun `F-P5-6 no glue code calls setTargetRotation`() {
    for (file in sources()) assertFalse("setTargetRotation(" in file.readText(), file.path)
  }

  @Test
  fun `CD30 StreamPack's logger is replaced before any streamer exists`() {
    val assigned = sources().filter { "Logger.logger = VendorLogger" in it.readText() }
    assertEquals(listOf("EngineHost.kt"), assigned.map { it.name }, "one assignment, in EngineHost's first use")
  }

  @Test
  fun `Review Focus 1 nothing in the glue blocks the scheduler thread`() {
    for (file in sources()) {
      val text = file.readText()
      assertFalse("runBlocking" in text, "${file.path}: runBlocking")
      if (!file.path.endsWith("srt/SeaznSrtSink.kt")) assertFalse("InetAddress" in text, "${file.path}: a DNS lookup outside the sink's IO dispatcher")
    }
  }

  @Test
  fun `the glue never attaches StreamPack's lifecycle observer, logs to the console, or names a service`() {
    for (file in sources()) {
      val text = file.readText()
      for (banned in listOf("StreamerLifeCycleObserver", "android.util.Log", "println(", "streampack.services")) assertFalse(banned in text, "${file.path}: $banned")
    }
  }
}
```

The `MediaFormat.KEY_MAX_B_FRAMES` constant is the string `"max-bframes"`. The glue uses the constant, and Task 22 checks it with `javap`.

- [ ] **Step 2: Run them.** Expected: compile failure. Once they compile, `GlueRulesTest`'s four tests report **skipped** (`assumeTrue` from `org.junit.jupiter.api.Assumptions`: `core/build.gradle.kts` uses `kotlin("test")` on `useJUnitPlatform()`, which brings JUnit 5's API) until Task 20. Read the skipped count in the Gradle report: a skip is honest, a pass would not be.

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

`EncoderKeys.VIDEO` is `mapOf("max-bframes" to 0)`: every supported phone honours the key (CD34). `rotationAtArm(r)` returns 3 for 3, and 1 for everything else.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Allow the main thread in the guard. The F-P5-12 test fails.
  2. Put `MAXBW` in `before`. The F-P5-11 test fails.
  3. Drop the `UnknownHostException` branch. The F-P5-1 test fails.
  4. Report every drop. The R3 test fails.

  Then commit: `feat(adapter): SRT options, the TLS guard, attempt signals and the glue's rules`, with the trailer lines.

## Batch C4a — the bridge core and the JVM host

The suite is the core's (`./gradlew test`), plus the host's smoke run in Task 13.

### Task 12: `BridgeCore` — the engine host every platform uses

Carries 1, 12, 14, 15, 17, 18 and 27, and CD7, CD9, CD11, CD31, CD32 and CD33. `BridgeCore` joins plan B's `Engine` to a `Platform`, and this is the one place where the rules from Tasks 4–11 meet. The Android glue (Task 20) and the JVM host (Task 13) are both thin `Platform`s around it, so every rule here is JVM-tested once and runs unchanged on the phone.

**Files:**

- Create: `adapter/BridgeCore.kt`, `adapter/Platform.kt`, `adapter/OwnedSlot.kt`
- Test: `adapter/BridgeCoreTest.kt`, with a `RecordingPlatform` test double in `adapter/RecordingPlatform.kt`; `adapter/OwnedSlotTest.kt`; `adapter/ArmWire.kt` (the shared test arm map)

**Interfaces:**

- Consumes everything from Tasks 4–11, plus `Engine`, `SessionRecord`, `Projection`, `Phase.attemptInHand`, `Phase.session` and `Clock`.
- Produces `Platform`, `BridgeCore` (with `armFailed(config, t)`, N1) and `OwnedSlot<T>` (`take(by, value)`, `release(by)`, `value`), all below.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.SessionConfig

/** What a platform gives `BridgeCore`. Android's is the glue (Task 20); the JVM host's is scripted (Task 13). */
interface Platform {
  /** Carry out one command. Never blocks the calling (scheduler) thread; outcomes come back through BridgeCore. */
  fun execute(command: Command)

  /** One HTTP request, answered once on any thread. */
  fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit)

  /**
   * The machine accepted an arm (CD31). Called once per accepted session, on the scheduler thread,
   * outside the snapshot sink. Must return at once: post anything slow or main-thread-bound (the
   * permission request, then the foreground service, CD16) and report back through BridgeCore. A
   * throw ends the session fatal-error and named, sticky for the process when it is permanent.
   */
  fun armed(config: SessionConfig)

  /** Cumulative counts for the attempt, or null when it is not the attempt the endpoint holds. */
  fun frames(attemptId: Int): FrameCount?

  fun link(attemptId: Int): LinkCounters?

  /** Read at every publish, on the scheduler thread. Volatile reads only. */
  fun facts(): PlatformFacts

  fun snapshot(wire: Map<String, Any?>)

  fun recordLine(line: String)

  /** CD8: the intent numbered [seq] has run, with every snapshot and line it caused. Emitted as an event. */
  fun acked(seq: Int)
}
```

```kotlin
package com.seazn.capture.engine.adapter

/**
 * CD32: one value, owned by whoever took it last. A module instance takes the slot in `OnCreate` and
 * releases it in `OnDestroy`. A release by an owner that has since been replaced changes nothing, so
 * a JS reload never clears the new instance's listener, whichever of the two runs first.
 */
class OwnedSlot<T : Any> {
  private var owner: Any? = null

  @Volatile
  var value: T? = null
    private set

  @Synchronized
  fun take(by: Any, value: T) {
    owner = by
    this.value = value
  }

  @Synchronized
  fun release(by: Any) {
    if (owner !== by) return
    owner = null
    value = null
  }
}
```

**`BridgeCore`**, in full. Each function stays within 10–25 lines (AGENTS §12).

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Clock
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.CommandSink
import com.seazn.capture.engine.core.DescriptorCheck
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Phase
import com.seazn.capture.engine.core.Projection
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.Scheduler
import com.seazn.capture.engine.core.SessionConfig
import com.seazn.capture.engine.core.SessionRecord
import com.seazn.capture.engine.core.Snapshot
import com.seazn.capture.engine.core.SnapshotSink
import com.seazn.capture.engine.core.attemptInHand
import com.seazn.capture.engine.core.now
import com.seazn.capture.engine.core.session
import kotlin.math.abs

/**
 * The engine host every platform uses (CD3). Intents in, commands out, snapshots and record lines
 * up. Every rule from Tasks 4–11 meets here, so the Android glue and the JVM host are both thin.
 * Every input is posted, so the poller, the machine and the arm notice see inputs in one order.
 */
class BridgeCore(
  private val clock: Clock,
  scheduler: Scheduler,
  private val platform: Platform,
  private val readBody: (String) -> BodyFields,
) {
  private val guarded = GuardedScheduler(scheduler, ::failed)
  private val record = SessionRecord { line -> platform.recordLine(line) }
  private val sticky = StickyFailure(CommandSink(::route), ::report)
  private val pollers = AttemptPollers(guarded, ::frames, platform::link, ::report)
  private val ticks = TickLateness()
  private val gaps = FrameGaps()
  private val engine = Engine(clock, guarded, sticky, SnapshotSink(::published), record)

  /** The config `platform.armed` last saw, compared by identity (CD31). Scheduler thread only. */
  private var lastArmed: SessionConfig? = null

  @Volatile private var checkedAtMs: Long? = null

  /** Review Focus 2: an answer before the first tick, so a restarted JS never reads nothing. */
  @Volatile private var current: Map<String, Any?> = wire(Projection.snapshot(Phase.Idle(), clock.now()), PlatformFacts())

  /** Carry 15: the tick starts on the scheduler thread. */
  fun start() {
    guarded.schedule(0) { engine.start() }
  }

  /**
   * An intent from JS. When it carries a `seq`, an ack is posted after the input's own tasks, so it
   * reaches JS after everything the input caused and before any later tick's snapshot (CD8).
   */
  fun send(intent: Map<String, Any?>) {
    val input = IntentMapping.input(intent)
    if (input != null) report(input) else engine.log(RecordEntry("intent-unknown", listOf("intent" to intent["kind"] as? String)))
    WireValues.int(intent["seq"])?.let { seq -> guarded.schedule(0) { platform.acked(seq) } }
  }

  /** From any thread. The arm is noticed after the machine has run the input, never inside the snapshot sink (CD31). */
  fun report(input: Input) {
    guarded.schedule(0) { pollers.onInput(input) }
    engine.send(input)
    guarded.schedule(0) { noticeArm() }
  }

  /** From any thread: a failure the glue caught on its own scope (CD9). */
  fun failure(t: Throwable) {
    guarded.schedule(0) { failed(t) }
  }

  /** From any thread: a refusal before or during a session (CD21), against the attempt in hand (CD11). */
  fun refused(message: String, scope: Scope) {
    guarded.schedule(0) { sticky.fail(message, engine.phase.attemptInHand, scope) }
  }

  /**
   * From any thread (N1): work the platform posted for the arm of [config] failed, such as the keeper's
   * permission step or the capture build on the main looper. It ends that session fatal-error and named,
   * like a throw from `armed` itself, sticky for the process when permanent (CD11). A failure for a
   * session no longer held, by identity, is only recorded: it must never end a newer one.
   */
  fun armFailed(config: SessionConfig, t: Throwable) {
    guarded.schedule(0) {
      if (engine.phase.session?.config !== config) {
        engine.log(RecordEntry("arm-step-late", listOf("error" to t.javaClass.simpleName)))
      } else {
        val scope = if (Failures.permanent(t)) Scope.PROCESS else Scope.SESSION
        sticky.fail(Failures.describe(t), engine.phase.attemptInHand, scope)
      }
    }
  }

  /**
   * Carry 12: a JS line, posted. A whole JS number prints as `3`, not `3.0`; a fraction is kept and
   * written to tenths like every native number. An unknown level is `info`.
   */
  fun log(level: String, kind: String, fields: Map<String, Any?>) {
    val kept = if (level in LEVELS) level else "info"
    engine.log(RecordEntry(kind, fields.map { (key, value) -> key to whole(value) }, kept))
  }

  fun current(): Map<String, Any?> = current

  fun tail(): List<String> = record.lastLines()

  private fun noticeArm() {
    val config = engine.phase.session?.config ?: return
    if (config === lastArmed) return
    lastArmed = config
    sticky.armAccepted()
    try {
      platform.armed(config)
    } catch (failure: Throwable) {
      val scope = if (Failures.permanent(failure)) Scope.PROCESS else Scope.SESSION
      sticky.fail(Failures.describe(failure), engine.phase.attemptInHand, scope)
      if (failure !is Exception) throw failure
    }
  }

  private fun route(command: Command) {
    pollers.onCommand(command)
    when (command) {
      is Command.FetchPlaylist ->
        platform.http(HttpRequests.playlist(command)) { outcome ->
          checkedAtMs = clock.wallMs()
          report(HttpAnswers.playlist(command.requestId, outcome))
        }
      is Command.PostHeartbeat -> platform.http(HttpRequests.heartbeat(command)) { report(HttpAnswers.heartbeat(command.beatId, it, readBody)) }
      is Command.FetchDescriptor -> descriptor(command.requestId)
      else -> executed(command)
    }
  }

  /** Carry 17: the id is echoed even when there is nothing to fetch. */
  private fun descriptor(requestId: Int) {
    val request = engine.phase.session?.config?.let(HttpRequests::descriptor)
    if (request == null) return report(Input.DescriptorChecked(requestId, DescriptorCheck.Unreachable("no descriptor url")))
    platform.http(request) { report(HttpAnswers.descriptor(requestId, it, readBody)) }
  }

  /** CD11: a permanent failure is sticky, never retried; anything else is plan B's `command-failed`. */
  private fun executed(command: Command) {
    try {
      platform.execute(command)
    } catch (failure: Throwable) {
      if (!Failures.permanent(failure)) throw failure
      sticky.fail(Failures.describe(failure), engine.phase.attemptInHand, Scope.PROCESS)
    }
  }

  private fun published(snapshot: Snapshot) {
    ticks.observe(clock.monotonicMs(), engine.phase.session != null)?.let(engine::log)
    val wire = wire(snapshot, platform.facts().copy(deliveryCheckedAtMs = checkedAtMs))
    current = wire
    platform.snapshot(wire)
  }

  private fun wire(snapshot: Snapshot, facts: PlatformFacts): Map<String, Any?> =
    SnapshotWire.of(snapshot, facts, RecordCounters(record.sinkFailures, record.reentrantDropped))

  /** The Frames poller's read, with CD33's gap line. Scheduler thread. */
  private fun frames(attemptId: Int): FrameCount? {
    val count = platform.frames(attemptId) ?: return null
    gaps.read(attemptId, count.video, clock.monotonicMs(), engine.phase is Phase.OnAir)?.let(engine::log)
    return count
  }

  /** Whatever reached the task boundary (carry 15): recorded, and sticky when permanent (CD11). */
  private fun failed(t: Throwable) {
    engine.log(RecordEntry("engine-error", listOf("message" to Failures.describe(t))))
    if (Failures.permanent(t)) sticky.fail(Failures.describe(t), engine.phase.attemptInHand, Scope.PROCESS)
  }

  private fun whole(value: Any?): Any? = if (value is Double && value % 1.0 == 0.0 && abs(value) <= MAX_EXACT) value.toLong() else value

  companion object {
    private val LEVELS = setOf("debug", "info", "warn", "error")

    /** 2^53: every whole Double up to it is exact. */
    private const val MAX_EXACT = 9_007_199_254_740_992.0

    @Volatile private var instance: BridgeCore? = null

    /** One engine per process (carry 18). A JS reload makes a new module over this same core (CD32). */
    fun shared(factory: () -> BridgeCore): BridgeCore = instance ?: synchronized(this) { instance ?: factory().also { instance = it } }

    /** Tests only: the next [shared] builds afresh. */
    internal fun resetShared() {
      synchronized(this) { instance = null }
    }
  }
}
```

Check before compiling, and fix the call, never the rule: `Phase.session` is the existing extension in `Phase.kt`; `Phase.Idle()` takes no argument; `DescriptorCheck.Unreachable` takes the message; `RecordEntry` has its `level` from Task 3. `NaN % 1.0` is `NaN`, so a non-finite number stays a `Double` and the record masks it (CD6). The test double, `RecordingPlatform`, records every call:

- It keeps `lines` (every record line), `snapshots` (every wire), `armed` (every config), `http` (every request) and `events` (`"snapshot"` and `"ack:<seq>"`, in the order they happened), and answers HTTP from a queue the test fills.
- It answers `Connect` by reporting `Connected` through `core`. When `throwOnConnect` holds a `Throwable`, `execute` throws it for a `Connect` instead.
- When `throwOnArmed` holds a `Throwable`, `armed` records the config and then throws it.
- When `throwOnFactsOnce` holds one, the next `facts()` throws it and clears it.
- It returns frames that advance 15 video and 23 audio every read after `Connected`, and holds the count still while `frozen` is true.
- Its facts are ready, reachable, with a level of 0.5.
- `dropCurrent()` reports `Dropped(attemptInHand, ENDPOINT_CLOSED, "cut")` through `core`.

`ArmWire.valid()` is the map from `ArmMappingTest.wire()`, moved into `adapter/ArmWire.kt` and used by both tests.

- [ ] **Step 1: Write the failing tests.** Drive them with the core's `FakeClock` and `FakeScheduler`, and advance with `scheduler.advanceBy`.

```kotlin
package com.seazn.capture.engine.adapter

import com.seazn.capture.engine.core.Cancellable
import com.seazn.capture.engine.core.Engine
import com.seazn.capture.engine.core.FakeClock
import com.seazn.capture.engine.core.FakeScheduler
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.Scheduler
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue
import org.json.JSONObject

class BridgeCoreTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val platform = RecordingPlatform()
  private val core = BridgeCore(clock, scheduler, platform) { BodyFields(null, null) }.also { platform.core = it }

  private fun state(of: BridgeCore = core) = (of.current()["state"] as Map<*, *>)["kind"]

  private fun lines(of: RecordingPlatform = platform) = of.lines.map(::JSONObject)

  private fun arm(config: Map<String, Any?> = ArmWire.valid()) {
    core.send(config)
    scheduler.advanceBy(0)
  }

  private fun live() {
    core.start()
    core.report(Input.Network(true))
    arm()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
  }

  @AfterTest
  fun forgetShared() = BridgeCore.resetShared()

  @Test
  fun `Review Focus 2 the current snapshot is idle before any tick, and live once live`() {
    assertEquals("idle", state())
    live()
    assertEquals("publishing", state())
    assertEquals("sess_42", (core.current()["session"] as Map<*, *>)["sid"])
  }

  @Test
  fun `CD8 an intent's ack comes after the snapshot it caused, and an unknown intent is acked too`() {
    core.start()
    core.send(ArmWire.valid() + ("seq" to 1.0))
    core.send(mapOf("kind" to "explode", "seq" to 2.0))
    scheduler.advanceBy(0)
    val armed = platform.events.indexOf("ack:1")
    assertTrue(platform.events.indexOf("snapshot") in 0 until armed, "the armed snapshot is out before its ack")
    assertEquals("ack:2", platform.events.last())
  }

  @Test
  fun `carry 27 native answers a stop within one tick`() {
    live()
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
    val refusing = RecordingPlatform()
    val other = BridgeCore(clock, scheduler, refusing) { BodyFields(null, null) }.also { refusing.core = it }
    other.start()
    other.send(mapOf("kind" to "arm"))
    scheduler.advanceBy(0)
    assertEquals("ended", state(other))
    assertEquals(emptyList(), refusing.armed, "a refused arm never reaches the platform")
  }

  @Test
  fun `CD31 the same code armed again after a reset reaches the platform again`() {
    core.start()
    arm()
    core.send(mapOf("kind" to "stop"))
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    arm()
    assertEquals(2, platform.armed.size, "an equal config is a new session: compared by identity")
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
  fun `CD21 after a refused permission the next arm can connect`() {
    core.start()
    core.report(Input.Network(true))
    arm()
    core.refused("camera permission refused", Scope.SESSION)
    scheduler.advanceBy(0)
    assertEquals("ended", state())
    core.send(mapOf("kind" to "reset"))
    scheduler.advanceBy(0)
    arm()
    core.send(mapOf("kind" to "start"))
    scheduler.advanceBy(1_500)
    assertEquals("publishing", state())
  }

  @Test
  fun `I1 a permanent throw from platform armed ends the session fatal-error, named, never swallowed`() {
    platform.throwOnArmed = PermanentPlatformFailure("capture not built")
    core.start()
    arm()
    scheduler.advanceBy(0)
    val state = core.current()["state"] as Map<*, *>
    assertEquals(listOf("ended", "fatal-error"), listOf(state["kind"], state["reason"]))
    assertEquals("sess_42", (core.current()["session"] as Map<*, *>)["sid"])
    val ended = lines().single { it.getString("kind") == "ended" }
    assertEquals("PermanentPlatformFailure: capture not built", ended.getString("message"))
  }

  @Test
  fun `I1 an Error from platform armed ends the session and is recorded at the task boundary`() {
    platform.throwOnArmed = UnsatisfiedLinkError("libsrt.so not found")
    core.start()
    arm()
    assertEquals("ended", state())
    assertTrue(lines().any { it.getString("kind") == "engine-error" && "UnsatisfiedLinkError" in it.getString("message") })
  }

  @Test
  fun `N1 a failure in work posted for the arm ends that session fatal-error and named`() {
    core.start()
    arm()
    scheduler.advanceBy(0)
    core.armFailed(platform.armed.single(), IllegalStateException("wake lock"))
    scheduler.advanceBy(0)
    val state = core.current()["state"] as Map<*, *>
    assertEquals(listOf("ended", "fatal-error"), listOf(state["kind"], state["reason"]))
    assertEquals("sess_42", (core.current()["session"] as Map<*, *>)["sid"])
  }

  @Test
  fun `N1 a late failure for a session no longer held is recorded and ends nothing`() {
    core.start()
    arm()
    scheduler.advanceBy(0)
    core.armFailed(com.seazn.capture.engine.core.Configs.valid(), IllegalStateException("late")) // another config object: not the session held
    scheduler.advanceBy(0)
    assertEquals("armed", state())
    assertTrue(lines().any { it.getString("kind") == "arm-step-late" })
  }

  @Test
  fun `I1 a throwing facts read on the arming publish still reaches the platform's armed exactly once`() {
    core.start()
    platform.throwOnFactsOnce = IllegalStateException("facts")
    arm()
    scheduler.advanceBy(Engine.TICK_MS * 2)
    assertEquals(1, platform.armed.size)
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
    val ended = lines().single { it.getString("kind") == "ended" }
    assertEquals("UnsatisfiedLinkError: libsrt.so not found", ended.getString("message"))
  }

  @Test
  fun `carry 15 an Error at the task boundary is recorded and the scheduler lives on`() {
    core.start()
    platform.throwOnFactsOnce = StackOverflowError("facts")
    scheduler.advanceBy(Engine.TICK_MS)
    assertTrue(lines().any { it.getString("kind") == "engine-error" && "StackOverflowError" in it.getString("message") })
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
    val answered = lines().single { it.getString("kind") == "descriptor" }
    assertEquals("unreachable", answered.getString("result"))
    assertEquals("no descriptor url", answered.getString("message"))
    assertTrue(platform.http.none { "descriptor" in it.url }, "nothing was fetched")
  }

  @Test
  fun `carry 12 a forwarded JS line is written through the scheduler, its level kept and a level field renamed`() {
    core.start()
    core.log("warn", "intent.stop", mapOf("level" to "x", "count" to 3.0, "ms" to 2.25))
    assertTrue(platform.lines.none { "intent.stop" in it }, "not written before the scheduler runs it")
    scheduler.advanceBy(0)
    val line = JSONObject(platform.lines.single { "intent.stop" in it })
    assertEquals("warn", line.getString("level"))
    // Renamed, and masked: a field called `level` is on no allow-list (Task 3).
    assertEquals("***", line.getString("field_level"))
    assertEquals(3, line.getInt("count"))
    // Decimal.tenths: Math.round(2.25 × 10) = Math.round(22.5) = 23, so 2.3.
    assertEquals(2.3, line.getDouble("ms"), "a fraction is written to tenths, like every native number")
  }

  @Test
  fun `CD33 a tick that comes late while a session is held is recorded with its gap`() {
    var stall = false
    val slow =
      object : Scheduler {
        override fun schedule(delayMs: Long, task: () -> Unit): Cancellable =
          scheduler.schedule(if (stall && delayMs == Engine.TICK_MS) 2_000 else delayMs, task)
      }
    val late = RecordingPlatform()
    val stalled = BridgeCore(clock, slow, late) { BodyFields(null, null) }.also { late.core = it }
    stalled.start()
    stalled.send(ArmWire.valid())
    scheduler.advanceBy(Engine.TICK_MS)
    stall = true
    // The tick already due runs on time and schedules the next 2 000 ms out: one gap of 2 000 ms.
    scheduler.advanceBy(Engine.TICK_MS + 2_000)
    assertEquals(listOf(2_000L), lines(late).filter { it.getString("kind") == "tick-late" }.map { it.getLong("gapMs") })
  }

  @Test
  fun `CD33 video that stops moving while live is one frames-gap line with its length`() {
    live()
    // Reads run every 500 ms from the Connected at 0; the last one at 1 500 moved the count.
    platform.frozen = true
    scheduler.advanceBy(1_500)
    platform.frozen = false
    scheduler.advanceBy(500)
    // Last moved at 1 500, moved again at 3 500: 2 000 ms.
    val gap = lines().single { it.getString("kind") == "frames-gap" }
    assertEquals(2_000L, gap.getLong("gapMs"))
  }

  @Test
  fun `carry 18 one engine per process`() {
    BridgeCore.resetShared()
    var built = 0
    val first = BridgeCore.shared { built += 1; core }
    val second = BridgeCore.shared { built += 1; core }
    assertSame(first, second)
    assertEquals(1, built)
  }
}

class OwnedSlotTest {
  @Test
  fun `CD32 the newer owner keeps the slot when the older one releases late`() {
    val slot = OwnedSlot<String>()
    val old = Any()
    val new = Any()
    slot.take(old, "old listener")
    slot.take(new, "new listener")
    slot.release(old)
    assertEquals("new listener", slot.value)
  }

  @Test
  fun `an owner's release clears its own value, and a release of an empty slot is harmless`() {
    val slot = OwnedSlot<String>()
    val only = Any()
    slot.release(only)
    assertEquals(null, slot.value)
    slot.take(only, "x")
    slot.release(only)
    assertEquals(null, slot.value)
  }
}
```

The two timing tests are worked by hand in their comments. If `Connected` lands later than time 0 in `live()`, shift the times by the same amount and rework the comment. If the frames-gap test finds the session no longer `OnAir` during a 1.5 s freeze, read the stall rule in `Timers` and shorten the freeze; never change the rule. The frames-gap baseline is the first read made while `OnAir` (1 000), so the read at 1 500 is the last move.

- [ ] **Step 2: Run them.** Expected: compile failure.

- [ ] **Step 3: Implement `Platform.kt`, `OwnedSlot.kt` and `BridgeCore.kt`** as written above, and `RecordingPlatform` to its list.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Call `engine.start()` directly in `start()`, not posted. No test may depend on that, but `GlueRulesTest` will not catch it either, so this mutation is recorded as **survived by design**: thread identity is a device and code-review fact. Record it in the commit body.
  2. Drop `sticky.armAccepted()`. The `CD21 after a refused permission` test fails.
  3. Initialise `current` lazily, on the first publish. Review Focus 2 fails.
  4. Call `platform.armed` from `published` when the state moves to armed, as the first draft did, and delete `noticeArm`. Both I1 tests fail.
  5. Compare `config == lastArmed` instead of `===`. The re-arm test fails.
  6. In `noticeArm`, delete the `sticky.fail` call. The permanent `I1` test fails: the session stays armed. Restore, then delete the `if (failure !is Exception) throw failure`: the `Error` test fails on its missing `engine-error` line.
  7. In `OwnedSlot.release`, drop the owner check. The CD32 test fails.
  8. In `log`, keep every `Double`. The `count` assertion fails.
  9. Post the ack before `report(input)`. The CD8 ack test fails.
  10. In `armFailed`, drop the identity check. The late-failure N1 test fails: the session ends.
  11. In `armFailed`, drop the `sticky.fail` call. The first N1 test fails: the session stays armed.

  Then commit: `feat(adapter): BridgeCore hosts the engine for every platform`, with the trailer lines.

### Task 13: The JVM host

Carry 1 and CD8. A small program runs `BridgeCore` with a scripted platform, and speaks NDJSON on stdin and stdout. This is how the JS contract kit reaches the real core through the real mapping, with no phone.

**Files:**

- Modify: `modules/capture-engine/android/core/settings.gradle.kts`: add `include("host")`, and update the header comment, which says the core is consumed through `includeBuild` (CD2 reverses that)
- Create: `core/host/build.gradle.kts`, `core/host/src/main/kotlin/com/seazn/capture/engine/host/{Main.kt,Host.kt,ScriptedPlatform.kt,Protocol.kt,ExecutorScheduler.kt}`
- Create: `core/host/src/test/kotlin/com/seazn/capture/engine/host/ProtocolTest.kt`

**Interfaces:**

- **stdin**, one JSON object a line:
  - `{"op":"send","seq":n,"intent":{…}}`;
  - `{"op":"log","level":"info","kind":"x","fields":{…}}`;
  - `{"op":"exit"}`.
- **stdout**, one JSON object a line:
  - `{"ev":"ready","current":{…},"tail":[…]}`, first;
  - then `{"ev":"snapshot","body":{…}}`, `{"ev":"record","line":"…"}` and `{"ev":"ack","seq":n}`.
- **The ack (CD8).** `BridgeCore.send` posts `platform.acked(seq)` after the input's own tasks (Task 12), and the host's platform writes it as `{"ev":"ack","seq":n}`. The scheduler runs equal delays in the order they were posted (a `ScheduledThreadPoolExecutor` breaks ties by submission order), so the ack is written after every snapshot and record line that input caused, and before any later tick's. An intent the machine ignores is acked too, so the kit never waits on a timeout.
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

  @Test
  fun `CD8 the ack for an intent is written after the snapshot that intent caused`() {
    val out = mutableListOf<String>()
    val executor = ExecutorScheduler()
    val host = Host(executor) { synchronized(out) { out += it } }
    host.handle("""{"op":"send","seq":1,"intent":{"kind":"arm"}}""")
    executor.drain()
    val events = synchronized(out) { out.map { JSONObject(it).getString("ev") } }
    assertEquals("ack", events.last(), "nothing that input caused comes after its ack")
    assertTrue("snapshot" in events.dropLast(1), "the refused arm's snapshot comes before the ack")
    executor.shutdown()
  }
}
```

`Host(scheduler, write)` is `Main`'s logic without stdin and stdout, so it is testable. `ExecutorScheduler.drain()` is a test helper: it schedules a marker task with delay 0 and waits for it, repeating until no task was posted meanwhile. A refused arm (no fields) ends at once, so its snapshot is certain. The JVM scheduler's tie order is what this test adds over Task 12's, which ran on `FakeScheduler`.

- [ ] **Step 3: Implement.**
  - **`ExecutorScheduler`** wraps one `ScheduledExecutorService` thread named `capture-engine`. Its `Cancellable` cancels the future.
  - **The clock** is `System.nanoTime() / 1_000_000` for monotonic time and `System.currentTimeMillis()` for wall time.
  - **`ScriptedPlatform`**:
    - It answers `Connect` with `core.report(signals.connected(id))` 100 ms later, on its own single-thread executor. From then on, `frames(id)` returns counts that grow by 15 video and 23 audio every 500 ms.
    - `Disconnect`, `Rebuild`, `StartNewSession` and `End` stop the counting, and a `Rebuild` or `StartNewSession` connects its `next` the same way.
    - Every HTTP request is answered `Failed("scripted host: no network")`. That is no evidence (CD13), so delivery stays unknown and the heartbeat counts failures, which never degrade a stream (ruling 5).
    - Its facts are `PlatformFacts(audioLevel = 0.5, cameraReady = true, networkReachable = true, survivesBackground = true)`.
    - `snapshot` and `recordLine` write events to stdout, under a lock.
  - **`Host(scheduler, write: (String) -> Unit)`** builds the core over the scheduler and a `ScriptedPlatform` that writes through `write`, reports `Network(true)` and calls `start()`. `handle(line)` parses one stdin line: `send` calls `core.send(Protocol.toWire(intent))` with the line's `seq` put into the intent map; `log` calls `core.log`; a line that does not parse goes to stderr and is skipped. `ScriptedPlatform.acked(seq)` writes `Protocol.encode("ack", mapOf("seq" to seq))`.
  - **`Main`** builds a `Host` over an `ExecutorScheduler`, writing to stdout under a lock. It writes `ready` with `current()` and `tail()`, then feeds stdin to `handle` line by line until `exit` or EOF. On exit it shuts the executors down and exits 0.

- [ ] **Step 4: Build and smoke it.**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew :host:test :host:installDist --console=plain > "$TMPDIR/host.txt" 2>&1; echo "EXIT=$?"
printf '%s\n' '{"op":"send","seq":1,"intent":{"kind":"start"}}' '{"op":"exit"}' | host/build/install/host/bin/host > "$TMPDIR/host-out.txt"; echo "EXIT=$?"
head -1 "$TMPDIR/host-out.txt"
```

Expected: EXIT=0 twice, and a first line starting `{"ev":"ready","current":{"state":{"kind":"idle"}`. The start is ignored from idle, the record shows `intent-ignored`, and an `{"ev":"ack","seq":1}` line follows it.

- [ ] **Step 5: Commit.** Use `feat(host): a JVM host for the engine contract kit`, with the trailer lines. Stage `settings.gradle.kts` and `host/` by path. `host/build/` is ignored by the core's existing `.gitignore`; check it.

## Batch C4b — the JS bridge, the routed record and the contract kit

The suite is `pnpm check`, plus the bridge project (`CAPTURE_BRIDGE=1 pnpm vitest run --project bridge`), which needs JDK 17 and the host built in C4a.

### Task 14: The JS snapshot wire and arm wire

Carries 2–6 and CD5. These are pure functions in the engine module. They need no React Native, so they run in the `domain` vitest project.

**Files:**

- Create: `modules/capture-engine/src/snapshotWire.ts`, `modules/capture-engine/src/armWire.ts`
- Test: `modules/capture-engine/src/snapshotWire.test.ts`, `modules/capture-engine/src/armWire.test.ts`
- Modify: `modules/capture-engine/src/CaptureEnginePort.ts`: `Telemetry` gains `permissionsRefused: boolean`, `recordSinkFailures: number` and `recordReentrantDropped: number`. Then `FakeCaptureEngine.ts`'s `IDLE_TELEMETRY` gains `false, 0, 0`, as do any telemetry fixtures (`grep -rn "thermalHeadroom:" src test modules`).
- Modify **(P3)**: `CaptureEnginePort.ts`, where the arm intent gains `readonly language?: string` (a two-letter code; `engine` may not import `@/i18n`, so it is a string here), and `src/hooks/useStreamArm.ts`, where `useReconcile` reads `lang` from `useLanguage()` into a ref updated each render and sends `language: langRef.current` with the arm. A ref keeps the effect's dependencies unchanged, so a language pick never re-runs the reconcile. Tests that assert the whole arm intent with `toEqual` gain `language: 'en'` (the test provider's language); find them with `grep -rn "kind: 'arm'" src test` and list each in the commit body.

**Interfaces:**

- `toEngineSnapshot(wire: unknown, cache?: DescriptorCache): EngineSnapshot | null`, where null means malformed;
- `createDescriptorCache(): DescriptorCache`;
- `WIRE_VOCABULARY`, an object of `ReadonlySet`s, one per vocabulary key;
- `armWire(intent: Extract<EngineIntent, { kind: 'arm' }>, deps: { appVersion: string; descriptorUrl: (sid: string) => string }): Record<string, unknown>`, which writes `language` as the intent's or `''` (P3).

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

  it('M4 a descriptor that does not parse is no descriptor: named by slot and tag, but not by sid', () => {
    const wire = merged(vectors.cases.find((c) => c.name === 'ended-refused')!.wire);
    const snapshot = toEngineSnapshot(wire)!;
    expect(snapshot.descriptor).toBeNull();
    expect([snapshot.slot, snapshot.tokenTag]).toEqual([2, 'c980ff38']);
    // The kit names a session by descriptor?.sid, so this one reads unnamed by sid. Pinned, not hidden.
    expect(snapshot.descriptor?.sid ?? null).toBeNull();
  });
});
```

The contract kit names a session by `descriptor?.sid`. A refused arm with an unparseable descriptor therefore reads sid null, which the M4 test pins. JS always sends the descriptor it parsed, so this needs a hand-made wire and cannot come from JS. Add a `sid` field to `EngineSnapshot` only if Task 16's kit run shows otherwise, and record the reason.

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

  // (P3, ruled 2026-10-01)
  it("P3 carries the operator's language for the notification, and nothing when there is none", () => {
    const deps = { appVersion: '1.0.0', descriptorUrl: () => 'https://stg.seazn.club/d' };
    const heartbeat = { url: session.descriptor.heartbeatUrl, token: session.token };
    expect(armWire({ kind: 'arm', session, heartbeat, language: 'fr' }, deps).language).toBe('fr');
    expect(armWire({ kind: 'arm', session, heartbeat }, deps).language).toBe('');
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
  { session, heartbeat, language }: Arm,
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
    // P3: the notification's language; native falls back to the phone's, then English.
    language: language ?? '',
  };
}
```

**(P3)** Native reads it in Task 4's `ArmMapping` into `SessionConfig.language` (Task 2), and nothing reads it but the notification (Task 24).

`heartbeat.token` is not sent separately. Plan A's arm builds it from `session.token` (confirm in `useStreamArm`), and native uses the one token for both the heartbeat and the descriptor (decision 4). If the two can differ, stop and raise it: that is a spec question, not an implementation detail.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Skip the cache. The identity test fails.
  2. Accept any camera word. The malformed test fails.
  3. Drop `descriptorJson`. The re-hydration test fails.
  4. (P3) Write `language: 'en'` always. The language test fails.

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
  addListener(event: 'onAck', listener: (body: { seq: number }) => void): Subscription;
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
  /**
   * CD8: resolves once native has acked the last intent sent, so every snapshot that intent
   * caused has arrived. Resolves at once when nothing is outstanding. Test and probe use only;
   * the product never waits on native (AGENTS §2).
   */
  settled(): Promise<void>;
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
/** M16: JS lines go to native's record only while native holds a session. Pure, so it is tested. */
export function recordGoesNative(nativeWired: boolean, kind: SessionState['kind']): boolean;
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
    expect(native.sent[0]).toEqual({ ...armWire(armIntent, deps), seq: 1 });
    expect(native.sent[1]).toEqual({ kind: 'stop', seq: 2 });
  });

  it('CD8 settled() waits for the ack of the last intent sent, not for any snapshot', async () => {
    const native = new FakeNativeModule();
    const engine = createNativeCaptureEngine(native, deps);
    await engine.settled(); // nothing outstanding: resolves at once
    engine.send({ kind: 'stop' });
    engine.send({ kind: 'reset' });
    let done = false;
    void engine.settled().then(() => (done = true));
    native.emit('onSnapshot', armedWire); // a tick's snapshot is not an answer
    native.emit('onAck', { seq: 1 });
    await Promise.resolve();
    expect(done).toBe(false);
    native.emit('onAck', { seq: 2 });
    await Promise.resolve();
    expect(done).toBe(true);
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

  it('M5 an arm while ended is ignored: it stays ended, still naming the first session', () => {
    const engine = createAbsentCaptureEngine(() => 1_790_000_000_000);
    const heartbeat = { url: session.descriptor.heartbeatUrl, token: session.token };
    engine.send({ kind: 'arm', session, heartbeat });
    engine.send({ kind: 'arm', session: otherSession, heartbeat });
    expect(engine.getSnapshot().state.kind).toBe('ended');
    expect(engine.getSnapshot().tokenTag).toBe(tokenTag(session.token));
  });
});
```

`otherSession` is a second made-up session with a different `tok`, built as `session` is.

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

it.each([
  [true, 'idle', false],
  [true, 'armed', true],
  [true, 'publishing', true],
  [true, 'ended', true],
  [false, 'publishing', false],
] as const)('M16 native wired %s, engine %s: JS lines go to native %s', (wired, kind, native) => {
  expect(recordGoesNative(wired, kind)).toBe(native);
});
```

Ended goes to native because native still holds the ended session's record until the reset; idle stays in JS, because native has no session to file the line under.

- [ ] **Step 2: Run them.** Expected: they fail.

- [ ] **Step 3: Implement.** `createNativeCaptureEngine` works as follows:
  - It keeps `snapshot`, which starts as `toEngineSnapshot(native.current(), cache) ?? UNREPORTED`, where `UNREPORTED` is the idle snapshot with `reportedAtMs: 0`.
  - It seeds the record with `native.tail().forEach(deps.onRecordLine)`.
  - It adds the two listeners.
  - On each `onSnapshot` it parses. When the result is non-null, it stores it and notifies the subscribers.
  - `send` numbers the intent (`seq`, from 1) and calls `native.send({ ...(intent.kind === 'arm' ? armWire(intent, deps) : { kind: intent.kind }), seq })`. It returns void, as every intent does.
  - On each `onAck` it records the highest `seq` acked, and resolves every `settled()` waiter whose target is at or below it. `settled()` targets the last `seq` sent.
  - `forward` is `native.log(entry.level, entry.event, entry.fields)`.
  - `dispose` removes all three subscriptions, and resolves any waiter, so a disposed engine never leaves a test hanging.

  `createAbsentCaptureEngine` has three snapshots (idle, ended-named, idle) and no timers. `createRingRecord` gains `appendLine`, which pushes a pre-formatted line with the same capacity rule. `createRoutedRecord` delegates `lines` and `subscribe` to the ring.

- [ ] **Step 4: Run, mutate, commit.** Mutate one at a time:
  1. Seed from `tail()` after the listeners are added, and emit a line in between. Assert the order. The seed test must fail if a line can be lost or doubled. If it cannot fail, record why.
  2. Forward while idle. The routed test fails.
  3. Resolve `settled()` on any snapshot. The CD8 test fails.
  4. In `recordGoesNative`, return true for idle. The M16 table fails.
  5. Let the absent engine take an arm while ended. The M5 test fails.

  Run `pnpm check`. Then commit: `feat(engine): the native engine, the absent engine and the routed record`, with the trailer lines.

### Task 16: The contract kit, run against the bridge

Carries 1, 27 and 28, and CD8. Plan A wrote the kit to run "against the bridge". This task makes that true, and adds the two scenarios plan A's final review asked for.

**Files:**

- Create: `modules/capture-engine/src/contract/engineScenarios.ts`; this is the scenarios as data, with no vitest
- Modify: `test/engineContract.ts`, which becomes the vitest wrapper (`make` may return a promise)
- Create: `test/hostEngine.ts`, which spawns the host and returns an `EngineUnderTest` and a `Settle`
- Create: `modules/capture-engine/src/NativeCaptureEngine.bridge.test.ts`
- Modify: `vitest.config.mts`, adding a `bridge` project behind `CAPTURE_BRIDGE=1` and excluding `**/*.bridge.test.ts` from `domain`
- Create: `.github/workflows/bridge-contract.yml`. `kotlin-core.yml` is untouched: its header and spec §6 say JDK 17 and Gradle and nothing else (I11)

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

`expect` is injected so that the device probe (Task 19) can run the same scenarios with no vitest. Its version records `probe.fail` with `{ scene, check, reason: 'mismatch' }`: the scenario's index and the failed expectation's ordinal within it, both numbers, which pass under any key. The `what` phrase stays out of the record: under a plain key a phrase is masked whole (CD6), so it would read `***`.

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
  - It wraps the adapter in `createNativeCaptureEngine`, so the kit runs the real JS bridge too: each intent goes out with its `seq`, and the host's `ack` lines are dispatched as `onAck`.
  - **`settle`** is `engine.settled()` (CD8): it resolves on the ack of the last intent sent, which the host writes after every snapshot that intent caused. It never resolves on a tick's snapshot, so the tick race (I10) is gone. A 5 s guard rejects with "no ack for seq n", so a lost ack fails the scenario rather than hanging the run.
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

- [ ] **Step 6: CI.** Create `.github/workflows/bridge-contract.yml`. Copy the `on:` triggers and `paths:` filter from `kotlin-core.yml`, and add `src/**`, `modules/capture-engine/src/**`, `test/**` and `vitest.config.mts` to the paths, since the JS bridge is half of what it tests:

```yaml
name: bridge-contract
# The engine contract over the real Kotlin core: a JVM host and the JS bridge (plan C, CD8).
# Separate from kotlin-core, which stays JDK and Gradle only (spec §6).
on:
  # copy kotlin-core.yml's triggers here, with the extra paths above
jobs:
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

Indent the steps under `jobs.bridge-contract` as `check.yml` does. Copy the `pnpm/action-setup` and `setup-node` steps from `check.yml` exactly, so their pins match. Run `pnpm prettier --check .github/workflows/bridge-contract.yml`.

- [ ] **Step 7: Mutate.** One at a time, restoring each from its `cp` backup:
  1. Make the host's platform skip `Connected`. The start scenarios fail through the bridge and still pass against the fake. That shows the bridge run tests something the fake run does not.
  2. **The exclude alone (I11).** Delete `**/*.bridge.test.ts` from the `domain` project's exclude, and run `pnpm test` without `CAPTURE_BRIDGE`. Expected: the domain project collects `NativeCaptureEngine.bridge.test.ts` and fails on the missing host or the jsdom environment. Record what it printed.
  3. **The gate alone (I11).** Restore the exclude, then make the `bridge` project unconditional. Run `pnpm test`: the bridge project now runs as part of the default suite (its count appears in `--reporter=json`'s `numTotalTests`). The two guards keep it out of different projects, so neither covers for the other, and each was seen to matter.

  Then commit: `test(engine): run the engine contract against the real core over the bridge`, with the trailer lines. Stage `.github/workflows/bridge-contract.yml` by path.

## Batch C5 — JS product changes

`pnpm check` and `pnpm i18n:release-check` are the suite for every task in this batch. Each new string goes into all four dictionaries in the task that first renders it, already reviewed against `docs/i18n-glossary.md` (Global Constraints, Copy), so no `_review` marker is ever committed. The review was done when this plan was written, and is recorded here so the implementer copies it rather than re-translating:

- **Glossary terms used:** móvil (es phone), vista previa / aperçu / voorbeeld (preview), sesión / session / sessie, registro de la sesión / journal de session / sessielogboek (the record, so nl says _logboek_, never _log_), Inténtalo de nuevo / Réessayez / Probeer het opnieuw (Try again in a sentence), Ajustes / Paramètres / Instellingen (Settings), cámara, micro / caméra, micro / camera, microfoon.
- **New term, added to the glossary's Terms table in Task 18's commit:** `engine (the capture engine, Diagnostics and status) | motor | moteur | engine | nl keeps the loanword, as the Dutch Android and dev vocabulary does; es and fr take the plain word.`
- **Typography:** es, fr and nl split each status line and advisory on a colon, never the English em dash; fr writes `\u00a0` before the colon in the JSON; straight apostrophes.
- **Budgets**, counted with `s.length` as `budgets.test.ts` counts (en / es / fr / nl):
  - `stream.status.engineSilent` 39 / 37 / 48 / 44, under the existing `stream.status.` row (48). French is exactly at the limit, so any change to it is re-counted before commit.
  - `stream.advisory.keepOpen` 51 / 51 / 56 / 51, under the existing `stream.advisory.` row (56).
  - `stream.preview.stopped` 47 / 41 / 39 / 49, under a new row `[/^stream\.preview\.stopped$/, 56]`: it is drawn in the advisory strip's place (Task 25), so it takes the advisory's budget.
  - `stream.preview.show` 12 / 16 / 13 / 15, under a new row `[/^stream\.preview\.show$/, 16]`, the Go live button's budget, since it is a button in the same type.
  - `stream.ended.permissions` 67 / 71 / 75 / 74: **no budget row**. `EndedBlock` renders it as a `status` Text with no `numberOfLines`, so it wraps rather than truncates; Task 26's copy-fit check reads it under the narrow `wm size` override in fr.
  - The Diagnostics and dev keys have no budget: Diagnostics rows wrap, and dev keys never ship.

| Key                          | en                                                                  | es                                                                      | fr                                                                          | nl                                                                         |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `stream.status.engineSilent` | Engine not responding — check the phone                             | El motor no responde: revisa el móvil                                   | Le moteur ne répond plus\u00a0: vérifiez le téléphone                       | Engine reageert niet: controleer de telefoon                               |
| `stream.advisory.keepOpen`   | Keep the app open — capture stops in the background                 | Mantén la app abierta: en segundo plano no se graba                     | Gardez l'app ouverte\u00a0: en arrière-plan, rien n'est filmé               | Houd de app open: op de achtergrond stopt de opname                        |
| `stream.ended.permissions`   | Allow the camera and microphone in Android Settings, then try again | Permite la cámara y el micro en Ajustes de Android e inténtalo de nuevo | Autorisez la caméra et le micro dans les Paramètres Android, puis réessayez | Sta camera en microfoon toe in Android-instellingen en probeer het opnieuw |
| `stream.preview.stopped`     | Camera preview stopped — the session carries on                     | La vista previa se cerró: la sesión sigue                               | Aperçu interrompu\u00a0: la session continue                                | Cameravoorbeeld onderbroken: de sessie loopt door                          |
| `stream.preview.show`        | Show preview                                                        | Ver vista previa                                                        | Voir l'aperçu                                                               | Voorbeeld tonen                                                            |
| `diag.section.engine`        | Engine                                                              | Motor                                                                   | Moteur                                                                      | Engine                                                                     |
| `diag.lastReport`            | Last report                                                         | Último informe                                                          | Dernier rapport                                                             | Laatste melding                                                            |
| `diag.recordRefused`         | Record lines refused                                                | Líneas del registro rechazadas                                          | Lignes du journal refusées                                                  | Logboekregels geweigerd                                                    |
| `diag.recordDropped`         | Record lines dropped                                                | Líneas del registro descartadas                                         | Lignes du journal abandonnées                                               | Logboekregels overgeslagen                                                 |
| `stream.dev.probe`           | Run engine contract                                                 | Ejecutar contrato del motor                                             | Lancer le contrat du moteur                                                 | Enginecontract uitvoeren                                                   |

`\u00a0` in the fr column is the JSON escape, written literally into `fr.json`. The `stream.preview.*` keys are rendered by Task 25 (C7) but land here, with Task 18, so the C5 copy is reviewed in one commit; `budgets.test.ts`'s `keys.length > 0` check passes for their rows from this commit on. Task 25 adds the two dev keys it needs, reviewed the same way, in its own commit.

**This copy is accepted by the owner (P2, 2026-10-01).** The nl button reads "Voorbeeld tonen", an infinitive like every nl button in `nl.json` (Live gaan, Stoppen, Doorgaan) (N5). A later change to a line is one dictionary edit per language, re-reviewed against the glossary, with the budget re-counted.

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

Carries 7, 8 and 12, CD17, CD18 and CD21. **The copy is accepted by the owner (P2, 2026-10-01)**; build it as written, from the reviewed table in the batch intro.

**Files:**

- Create: `src/hooks/engineSilence.ts`, `src/hooks/engineSilence.test.ts`
- Modify: `src/hooks/useViewfinder.ts` (the plate and line when silent), `src/hooks/advisory.ts`, `src/hooks/advisory.test.ts`, `src/ui/components/StreamStage.tsx` (passes `keepOpen` to `topAdvisory`), `src/ui/components/EndedBlock.tsx`, `src/hooks/engineSelectors.ts`, `src/hooks/diagnostics.ts`, `src/hooks/diagnostics.test.ts`, `modules/capture-engine/src/FakeCaptureEngine.ts` (`survivesBackground` is true while a session is armed or on air, as on Android with the service running), the four dictionaries (the batch intro's table, all ten keys, already reviewed), `src/i18n/budgets.test.ts` (the two `stream.preview.` rows) and `docs/i18n-glossary.md` (the **engine** row)
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

`renderStream` is a helper local to this file, over the house helper `test/renderViewfinder.tsx` (the viewfinder as the operator reaches it): its `prepare` sets the fake engine's scene and applies the given telemetry overrides through the fake's `publish` hook (read `FakeCaptureEngine.ts` for its name), and `language` becomes `{ deviceLanguages: [language] }`. Task 25 does not reuse it; it uses `renderViewfinder` directly. `publishNow()` is the fake's own report: the fake reports every `REPORT_MS` and stamps `reportedAtMs` with the ports' clock. Check how the fake's timer runs under vitest fake timers, and advance it rather than calling a private method if it is not exposed. The plate is upper-cased by the component; assert the text as the component renders it.

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

  5. Write the fr `engineSilent` with a plain space before its colon. `dictionaries.test.ts`'s French spacing test fails.
  6. Add `"_review": "pending translation review"` to `es.json`. `pnpm i18n:release-check` exits non-zero; remove it.

  Run `pnpm check`, `pnpm i18n:release-check` (EXIT=0) and `pnpm prettier --check src/i18n/*.json docs/i18n-glossary.md`. Then commit: `feat(stream): say when the engine is silent, when to keep the app open, and how to allow permissions`, with the trailer lines.

### Task 19: The composition root, and the device probe

Carry 1 and CD24. This is the one line plan A left for plan C: `createNativePorts` wires the native engine.

**Files:**

- Modify: `src/hooks/nativePorts.ts`, `src/hooks/usePorts.tsx` (`devEngine` stays a `FakeCaptureEngine | null`; a new `nativeEngine: NativeCaptureEngine | null`, read only by the dev probe for `settled()`), `test/fakePorts.ts` (`nativeEngine: null`)
- Create: `src/hooks/engineWiring.ts`, the pure choice of engine, tested; `src/hooks/engineWiring.test.ts`
- Create: `src/hooks/useEngineProbe.ts`, `src/hooks/probeSessions.ts`, and `src/ui/components/DevProbe.tsx`, placed in `DiagnosticsScreen` beside `DevScenes`
- **(P1, ruled 2026-10-01; Step 6)** Create: `src/hooks/lastLanguage.ts`, `src/hooks/lastLanguage.test.ts`. Modify: `src/hooks/useLanguage.tsx`, `src/ui/components/RootBoundary.tsx`, `src/ui/components/RootBoundary.test.tsx`

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
    // M16: the predicate is pure and tested in Task 15; only its inputs are read here.
    active: () => recordGoesNative(wired.native !== null, wired.engine.getSnapshot().state.kind),
    forward: (entry) => wired.native?.forward(entry),
  });
  const logger = createLogger({ record, now: Date.now, minLevel: __DEV__ ? 'debug' : 'info' });
  // … the rest as today, with `engine: wired.engine`, `devEngine: wired.devEngine`
  // and `nativeEngine: wired.native`.
}
```

`createNativePorts` is the place AGENTS §3 names for this choice. `chooseEngine` is pure apart from constructing engines, so it is unit-tested above, and `createNativePorts` stays the thin composition it is. Recurring failure class 1 (the inert seam) is answered by Step 5's device check, which confirms the native engine is the one running. Add `EXPO_PUBLIC_FAKE_PLAYBACK_URL` to `createFakeDescriptorPort`: in a dev build, when set and https, it replaces the sample playback URL. It is a **public** URL, the one every viewer of the stg input already has.

- [ ] **Step 4: The device probe.**
  - `useEngineProbe` runs each scenario of `ENGINE_SCENARIOS` in turn against `ports.engine`, with `PROBE_SESSIONS`.
  - Its `settle` is `ports.nativeEngine.settled()` (CD8): the ack of the last intent sent, never a tick's snapshot, so the probe has no tick race (I10). A 5 s guard logs `probe.fail` with `{ scene, reason: 'no-ack' }` and stops the run.
  - Its `expect` logs `probe.fail` with `{ scene: <scenario index>, check: <the expectation's ordinal in the scene, from 1>, reason: 'mismatch' }` on a mismatch; the `what` phrase is not logged, because a phrase under a plain key is masked whole (CD6). Scenarios compare only states, names and tags, so nothing secret can be logged. A pass logs `probe.pass` with `{ scene }`.
  - Between scenarios it sends `stop` and then `reset`, and waits for idle, so each scenario starts as the kit does.
  - It is offered only in a dev build, with `native` wired and the engine idle.
  - `DevProbe` is one `GhostButton` labelled `t('stream.dev.probe')` and a line with the state.

Test `useEngineProbe` against the fake: wire the fake as `engine` with `devEngine: null`, and a `nativeEngine` stub whose `settled()` resolves at once (the fake is synchronous). Run it, and assert eight `probe.pass` lines, one for each scenario, with no `probe.fail`. A second test gives a `settled()` that never resolves, advances fake timers 5 s, and asserts one `probe.fail` with `reason: 'no-ack'` and the run stopped.

- [ ] **Step 5: Run, mutate, commit.** Mutate one at a time:
  1. Return the fake in `chooseEngine` when `dev` is true, whatever the flag. The second test fails.
  2. Make `active` always true in `createNativePorts`. No unit test can see the wiring itself: `createNativePorts` imports `expo-*`, and plan A never unit-tested it. The rule is Task 15's `recordGoesNative`, tested there (M16); the wiring is **covered by Task 26's device check**, where Diagnostics must show JS lines while idle. Record it so.
  3. (P1) In `RootBoundary`, ignore `lastLanguage()`. The Step 6 French test fails.

  Run `pnpm check` and `pnpm i18n:release-check`. Then commit: `feat(ports): wire the native engine; a dev probe runs the contract on the phone`, with the trailer lines. Step 6 is a separate commit.

- [ ] **Step 6 (P1, ruled 2026-10-01): the crash screen reads the app's last resolved language, falling back to the phone's.** The boundary sits outside the language provider, which may be what crashed, so it cannot read the context. It reads a module-level holder the provider sets when the language resolves. There is no storage read on the crash path.

```ts
// src/hooks/lastLanguage.ts
import type { Lang } from '@/i18n/language';

let last: Lang | null = null;

/** Set by LanguageProvider each time it resolves a language. An idempotent write, safe in render. */
export function noteLanguage(lang: Lang): void {
  last = lang;
}

/** The language the provider last resolved, or null before it first did (a crash at launch). */
export function lastLanguage(): Lang | null {
  return last;
}

/** Tests only: forget the last language, so each test starts as a cold launch. */
export function resetLastLanguage(): void {
  last = null;
}
```

In `LanguageProvider`, call `noteLanguage(lang)` inside the `useMemo` that builds the value, so it is set before any child renders. In `RootBoundary`, keep the translator in state and refresh it in `onCatch`, before the fallback renders:

```tsx
const phone = useCallback(() => pickLanguage(null, ports.deviceLanguages), [ports.deviceLanguages]);
const [lang, setLang] = useState<Lang>(phone);
const { t } = useMemo(() => createTranslator(lang), [lang]);
const onCatch = useCallback(() => {
  ports.splash.hide();
  ports.logger.error('ui.crash');
  // P1: the operator's language, else the phone's. Read now, not at mount: it may have changed since.
  setLang(lastLanguage() ?? phone());
}, [ports, phone]);
```

Update the component's comment: it reads the operator's last language, falling back to the phone's. Tests, in `RootBoundary.test.tsx`, each calling `resetLastLanguage()` in `beforeEach`:

```tsx
it('P1 a crash after the operator picked French reads in French, though the phone is English', () => {
  noteLanguage('fr');
  renderCrashing({ deviceLanguages: ['en'] });
  expect(screen.getByText(fr['crash.heading'])).toBeTruthy();
});

it('P1 a crash before any language resolved reads in the phone language', () => {
  renderCrashing({ deviceLanguages: ['nl'] });
  expect(screen.getByText(nl['crash.heading'])).toBeTruthy();
});
```

`renderCrashing` is the file's existing way to render a child that throws (read the file; it spies on `console.error` at line 58). Mutate: `setLang(phone())` in `onCatch`; the French test fails. Run `pnpm check`. Commit: `feat(ui): the crash screen reads the operator's last language (P1)`, with the trailer lines.

## Batch C6 — Android glue I

The glue lives under `G` (`modules/capture-engine/android/src/main/java/com/seazn/capture/engine/`), in package `com.seazn.capture.engine` and its subpackages. It holds no rule (CD3). Every decision it would otherwise make is a call into `adapter/`. The suite for this batch is a compile, a local build, and the core suite (`GlueRulesTest` now reads real files).

The build commands, which are local only and never EAS:

```bash
cd "$WT" && cp package.json "$TMPDIR/package.json.bak" && pnpm expo prebuild -p android --no-install > "$TMPDIR/prebuild.txt" 2>&1; echo "EXIT=$?"; cp "$TMPDIR/package.json.bak" package.json && git diff --exit-code package.json
cd "$WT/android" && ./gradlew assembleDebug --console=plain > "$TMPDIR/assemble.txt" 2>&1; echo "EXIT=$?"
adb install -r "$WT/android/app/build/outputs/apk/debug/app-debug.apk"
```

### Task 20: The module scaffold, the scheduler thread, and the compile job

Carry 15, CD1, CD2, CD9, CD25 and CD34.

**Files:**

- Modify: `app.json` (the `expo-build-properties` plugin, minSdk 31), `package.json` and `pnpm-lock.yaml` (that one dependency)
- Create: `modules/capture-engine/expo-module.config.json`, `modules/capture-engine/android/build.gradle`, `modules/capture-engine/android/.gitignore` (`build/`, `.gradle/`, `.cxx/`), `modules/capture-engine/android/src/main/AndroidManifest.xml`
- Create in `G`: `CaptureEngineModule.kt`, `EngineHost.kt`, `VendorLogger.kt`, `HandlerScheduler.kt`, `AndroidClock.kt`, `RecordFile.kt`, `AndroidPlatform.kt`, `HttpAdapter.kt`, `capture/Capture.kt` (the interface Task 22 implements), `capture/NoCapture.kt`
- Create: `.github/workflows/android-compile.yml`
- Modify: `core/src/test/.../adapter/GlueRulesTest.kt`, deleting the `assumeTrue` line in `sources()`

**Interfaces:**

- **JS-visible (`Name("CaptureEngine")`)**:
  - `Function("send") { intent: Map<String, Any?> -> }`;
  - `Function("log") { level: String, kind: String, fields: Map<String, Any?> -> }`;
  - `Function("current")`;
  - `Function("tail")`;
  - `Events("onSnapshot", "onRecord", "onAck")`;
  - in Task 25, `View(CapturePreviewView::class)`.
- **`interface Capture`**: `streamer: StateFlow<SingleStreamer?>`, `prepare(config, rotation)`, `execute(command)`, `frames(attemptId)`, `link(attemptId)` and `facts(): CaptureFacts`. Its session ends with `Command.End`; there is no separate `release`.
- **`EngineHost`**: `listener` and `appContext` (`OwnedSlot`s, CD32), `core(context)`, `capture(context)` and `line(entry)`.

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
  // M14: compiled against, never shipped by us. react-android 0.86.3 brings OkHttp 4.9.2 at runtime
  // (node_modules/react-native/gradle/libs.versions.toml), so the app has exactly one.
  compileOnly 'com.squareup.okhttp3:okhttp:4.9.2'
}
```

Prebuild's `settings.gradle` names the project after its directory. Confirm that it is `:capture-engine` with `./gradlew projects` and use the real name. Confirm with `./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep okhttp3:okhttp` that the app resolves one OkHttp, at 4.9.2, and record the line in the commit. Replace the komuxer comment with the two pinned lines once you have read the coordinates: the comment is an instruction for this step, and must not survive into the commit.

**The app's minSdk (CD34, the owner's Android 12+ ruling).** Install the config plugin at Expo 57's version with `pnpm expo install expo-build-properties` (Expo's `bundledNativeModules.json` names `~57.0.22`). It is a config plugin with no native code, so nothing autolinks: confirm that `node_modules/expo-build-properties` holds no `android/` folder and no `expo-module.config.json`, and that `pnpm-lock.yaml` gained only it and its three JS dependencies (`semver`, `resolve-from`, `@expo/schema-utils`) (failure class 4). Then add it to `app.json`'s `plugins`, last:

```json
["expo-build-properties", { "android": { "minSdkVersion": 31 } }]
```

Run `pnpm prettier --check app.json`. Take the `package.json` backup the Global Constraints ask for **after** this install, so the restore keeps the new dependency and drops only prebuild's rewrite.

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

- [ ] **Step 4: `EngineHost`, `VendorLogger`, `AndroidPlatform`, `HttpAdapter`, `RecordFile`, `NoCapture` and the module.** Every class below holds no rule (CD3): each decision is a call into `adapter/`.

**`capture/Capture.kt`** and **`capture/NoCapture.kt`**:

```kotlin
package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.FrameCount
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.LinkCounters
import com.seazn.capture.engine.core.SessionConfig
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.flow.StateFlow

data class CaptureFacts(val audioLevel: Double, val cameraReady: Boolean, val captureTimestampMs: Long?)

/** What the platform asks of the camera, microphone and endpoints. Task 22's `StreamerAdapter` is the real one. */
interface Capture {
  /** The session's streamer while one exists; the preview view binds to it (Task 25). */
  val streamer: StateFlow<SingleStreamer?>

  /** Build the session's streamer, after CAMERA and RECORD_AUDIO are granted (CD16). Returns at once. */
  fun prepare(config: SessionConfig, rotation: Int)

  /** Carry out one command. Returns at once; outcomes are reported, never returned. */
  fun execute(command: Command)

  fun frames(attemptId: Int): FrameCount?

  fun link(attemptId: Int): LinkCounters?

  /** Volatile reads only: called on the scheduler thread at every publish. */
  fun facts(): CaptureFacts
}
```

```kotlin
package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.SessionConfig
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Task 20 only, deleted by Task 22. `prepare` refuses permanently, so the first device run proves the
 * bridge, the arm noticed outside the sink (CD31) and the named fatal end, with no camera at all.
 */
object NoCapture : Capture {
  override val streamer = MutableStateFlow<SingleStreamer?>(null)

  override fun prepare(config: SessionConfig, rotation: Int): Unit = throw PermanentPlatformFailure("capture not built")

  override fun execute(command: Command) = Unit

  override fun frames(attemptId: Int) = null

  override fun link(attemptId: Int) = null

  override fun facts() = CaptureFacts(0.0, cameraReady = false, captureTimestampMs = null)
}
```

`prepare` throws inside `BridgeCore.noticeArm`, which is its own scheduler task (Task 12), so the throw reaches `sticky.fail` and the session ends fatal-error and named. Before CD31 this throw was swallowed by `Engine.publish` (I1). That holds while `AndroidPlatform.armed` calls `prepare` directly (Tasks 20–23). From Task 24 on, `prepare` runs inside the keeper's task on the main looper, after the permission answer, and a throw there reaches the core through the keeper's arm guard and `BridgeCore.armFailed` (N1), with the same ended state.

**`VendorLogger.kt`** (CD30):

```kotlin
package com.seazn.capture.engine

import io.github.thibaultbee.streampack.core.logger.ILogger

/**
 * StreamPack's logger, replaced (CD30). Warnings and errors go to the session record, where
 * `message` is a text key and so masked by value; the throwable is its class name only, because a
 * vendor message can quote a URL holding a stream key. Nothing reaches logcat, in any build.
 */
class VendorLogger(private val line: (level: String, fields: Map<String, Any?>) -> Unit) : ILogger {
  override fun e(tag: String, message: String, tr: Throwable?) = forward("error", tag, message, tr)

  override fun w(tag: String, message: String, tr: Throwable?) = forward("warn", tag, message, tr)

  override fun i(tag: String, message: String, tr: Throwable?) = Unit

  override fun v(tag: String, message: String, tr: Throwable?) = Unit

  override fun d(tag: String, message: String, tr: Throwable?) = Unit

  private fun forward(level: String, tag: String, message: String, tr: Throwable?) =
    line(level, mapOf("tag" to tag, "message" to message, "error" to tr?.javaClass?.name))
}
```

`ILogger`'s five functions are `(tag: String, message: String, tr: Throwable? = null)` (StreamPack 3.2.0 `core/logger/ILogger.kt`); an override may not restate the default.

**`EngineHost.kt`** (CD9, CD30, CD32, carry 18). Tasks 22–24 replace `build` as they add parts; each shows its whole new `build`.

```kotlin
package com.seazn.capture.engine

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import com.seazn.capture.engine.adapter.BridgeCore
import com.seazn.capture.engine.adapter.OwnedSlot
import com.seazn.capture.engine.capture.Capture
import com.seazn.capture.engine.capture.NoCapture
import com.seazn.capture.engine.core.RecordEntry
import expo.modules.kotlin.AppContext
import io.github.thibaultbee.streampack.core.logger.Logger
import java.io.File

/**
 * One engine per process (carry 18), built on the application context so a JS reload never leaves
 * it holding a dead React context (CD32). Module instances come and go; each takes the listener and
 * the AppContext slots in OnCreate and releases them in OnDestroy, and a stale release is a no-op.
 */
object EngineHost {
  val listener = OwnedSlot<(String, Map<String, Any?>) -> Unit>()
  val appContext = OwnedSlot<AppContext>()

  private class Parts(val core: BridgeCore, val capture: Capture)

  @Volatile private var parts: Parts? = null

  fun core(context: Context): BridgeCore = parts(context).core

  fun capture(context: Context): Capture = parts(context).capture

  /** A glue line into the record, from any thread; dropped before the core exists. */
  fun line(entry: RecordEntry) {
    parts?.core?.log(entry.level, entry.kind, entry.fields.toMap())
  }

  @Synchronized
  private fun parts(context: Context): Parts = parts ?: build(context.applicationContext).also { parts = it }

  private fun build(app: Context): Parts {
    Logger.logger = VendorLogger { level, fields -> parts?.core?.log(level, "vendor-log", fields) }
    val thread = HandlerThread("capture-engine").apply { start() }
    val platform = AndroidPlatform(app, NoCapture, HttpAdapter(), RecordFile(File(app.filesDir, "record")), ::emit)
    val core = BridgeCore.shared { BridgeCore(AndroidClock, HandlerScheduler(Handler(thread.looper)), platform, HttpAdapter::readBody) }
    core.start()
    return Parts(core, NoCapture)
  }

  private fun emit(event: String, body: Map<String, Any?>) {
    listener.value?.invoke(event, body)
  }
}
```

**`AndroidPlatform.kt`**:

```kotlin
package com.seazn.capture.engine

import android.content.Context
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.Surface
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.Platform
import com.seazn.capture.engine.adapter.PlatformFacts
import com.seazn.capture.engine.capture.Capture
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.SessionConfig

/** The Android `Platform` (CD3): every call passes through to a part. `app` is the application context (CD32). */
class AndroidPlatform(
  private val app: Context,
  private val capture: Capture,
  private val http: HttpAdapter,
  private val file: RecordFile,
  private val emit: (String, Map<String, Any?>) -> Unit,
) : Platform {
  override fun execute(command: Command) = capture.execute(command)

  override fun http(request: HttpRequest, answer: (HttpOutcome) -> Unit) = http.send(request, answer)

  /** P4: the side held is read once, here, at the accepted arm, and never again for the session. */
  override fun armed(config: SessionConfig) = capture.prepare(config, EncoderKeys.rotationAtArm(displayRotation()))

  override fun frames(attemptId: Int) = capture.frames(attemptId)

  override fun link(attemptId: Int) = capture.link(attemptId)

  override fun facts(): PlatformFacts {
    val read = capture.facts()
    // networkReachable arrives with Task 23's NetworkWatch; survivesBackground and permissionsRefused with Task 24's keeper.
    return PlatformFacts(read.audioLevel, read.cameraReady, networkReachable = true, deliveryCheckedAtMs = null,
      captureTimestampMs = read.captureTimestampMs, survivesBackground = false, permissionsRefused = false)
  }

  override fun snapshot(wire: Map<String, Any?>) = emit("onSnapshot", wire)

  override fun recordLine(line: String) {
    file.append(line)
    emit("onRecord", mapOf("line" to line))
  }

  override fun acked(seq: Int) = emit("onAck", mapOf("seq" to seq.toDouble()))

  /** DisplayManager, not `context.display`: the application context has no display of its own on API 30+. */
  private fun displayRotation(): Int =
    app.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)?.rotation ?: Surface.ROTATION_0
}
```

Check `PlatformFacts`' parameter names against Task 5 before compiling; fix the call, never the type.

**`HttpAdapter.kt`**:

```kotlin
package com.seazn.capture.engine

import com.seazn.capture.engine.adapter.BodyFields
import com.seazn.capture.engine.adapter.HttpOutcome
import com.seazn.capture.engine.adapter.HttpRequest
import com.seazn.capture.engine.adapter.HttpRequests
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

/** One request, answered once, on OkHttp's threads (Task 8's rules). A failure is its class name only: OkHttp's messages can quote the URL. */
class HttpAdapter(private val client: OkHttpClient = client()) {
  fun send(request: HttpRequest, answer: (HttpOutcome) -> Unit) {
    val built = try {
      build(request)
    } catch (e: IllegalArgumentException) {
      return answer(HttpOutcome.Failed(e.javaClass.simpleName))
    }
    client.newCall(built).enqueue(Answer(answer))
  }

  private class Answer(private val answer: (HttpOutcome) -> Unit) : Callback {
    override fun onFailure(call: Call, e: IOException) = answer(HttpOutcome.Failed(e.javaClass.simpleName))

    override fun onResponse(call: Call, response: Response) {
      val outcome = try {
        response.use { HttpOutcome.Answered(it.code, it.body?.string().orEmpty()) }
      } catch (e: IOException) {
        HttpOutcome.Failed(e.javaClass.simpleName)
      }
      answer(outcome)
    }
  }

  private fun build(request: HttpRequest): Request {
    val builder = Request.Builder().url(request.url)
    for ((name, value) in request.headers) builder.header(name, value)
    return builder.method(request.method, request.body?.toRequestBody(JSON)).build()
  }

  companion object {
    private val JSON = "application/json; charset=utf-8".toMediaType()

    private fun client() = OkHttpClient.Builder().cache(null)
      .connectTimeout(HttpRequests.TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .readTimeout(HttpRequests.TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .callTimeout(HttpRequests.TIMEOUT_MS, TimeUnit.MILLISECONDS)
      .build()

    /** Task 8's body reader: the two fields, or none on anything that is not a JSON object. */
    fun readBody(text: String): BodyFields = try {
      val json = JSONObject(text)
      BodyFields(json.optString("state").ifBlank { null }, json.optString("endReason").ifBlank { null })
    } catch (e: Exception) {
      BodyFields(null, null)
    }
  }
}
```

OkHttp is `compileOnly` 4.9.2, the version react-android 0.86.3 brings at runtime; its Kotlin API (`code`, `body`, `toMediaType`, `toRequestBody`) is 4.x's.

**`RecordFile.kt`**:

```kotlin
package com.seazn.capture.engine

import java.io.File
import java.io.IOException
import java.util.concurrent.Executors

/** The record on disk, for Share after a crash (CD7). Its own thread: no file IO on the scheduler thread (CD9). */
class RecordFile(private val dir: File) {
  private val io = Executors.newSingleThreadExecutor { task -> Thread(task, "capture-record") }

  /** Lines the disk refused, counted and never thrown. Written on the record thread only. */
  @Volatile var failures = 0
    private set

  fun append(line: String) {
    io.execute { write(line) }
  }

  private fun write(line: String) {
    try {
      dir.mkdirs()
      val file = File(dir, NAME)
      if (file.length() >= MAX_BYTES) file.renameTo(File(dir, ROTATED)) // replaces the old rotation
      file.appendText(line + "\n")
    } catch (e: IOException) {
      failures += 1
    }
  }

  companion object {
    const val NAME = "session-record.ndjson"
    const val ROTATED = "session-record.1.ndjson"
    const val MAX_BYTES = 5L * 1024 * 1024
  }
}
```

**`CaptureEngineModule.kt`**:

```kotlin
package com.seazn.capture.engine

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The Expo bridge (spec §3 _Bridge_): intents in, snapshots, record lines and acks out. Holds no rule. */
class CaptureEngineModule : Module() {
  private fun app(): Context = appContext.reactContext?.applicationContext ?: error("no React context")

  private val core get() = EngineHost.core(app())

  override fun definition() = ModuleDefinition {
    Name("CaptureEngine")
    Events("onSnapshot", "onRecord", "onAck")

    // CD32: this instance takes both slots; a later instance's take replaces it, and only the owner's release clears.
    OnCreate {
      EngineHost.listener.take(this@CaptureEngineModule) { event, body -> sendEvent(event, body) }
      EngineHost.appContext.take(this@CaptureEngineModule, appContext)
    }
    OnDestroy {
      EngineHost.listener.release(this@CaptureEngineModule)
      EngineHost.appContext.release(this@CaptureEngineModule)
    }

    // Intents, not RPC (AGENTS §2): every one returns nothing.
    Function("send") { intent: Map<String, Any?> -> core.send(intent) }
    Function("log") { level: String, kind: String, fields: Map<String, Any?> -> core.log(level, kind, fields) }
    Function("current") { core.current() }
    Function("tail") { core.tail() }
  }
}
```

`sendEvent` drops events while JS has no listener. That is the research's `OnStartObserving` gate, and it is harmless here: `current()` answers the first read (Review Focus 2), `tail()` seeds the record, and JS subscribes at construction.

- [ ] **Step 5: Remove the skip in `GlueRulesTest`.** Run the core suite: the four glue rules now read real files and pass, with zero skipped. Mutate by deleting `Logger.logger = VendorLogger` from `EngineHost.kt`: the CD30 rule fails. Mutate by adding a scratch line `// setTargetRotation(` to `HandlerScheduler.kt`: the F-P5-6 rule fails. The rule reads text, so a comment counts, which is deliberate. Restore from the `cp` backup.

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
      # CD34, the owner's Android 12+ ruling: the app's merged manifest must say minSdk 31.
      - run: grep -q 'android:minSdkVersion="31"' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml
        working-directory: android
```

Copy the pnpm and node steps from `check.yml`, so the pins match. The runner image carries an Android SDK; if `sdkmanager` licences block the build, add `android-actions/setup-android@v3` before prebuild, and record why.

- [ ] **Step 7: Build locally.** Run prebuild (reverting `package.json`), then `assembleDebug`. Expected: EXIT=0. Then confirm the merged manifest:

```bash
cd "$WT/android" && grep -c 'FOREGROUND_SERVICE_CAMERA\|CaptureForegroundService' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml
```

Expected: 2 or more. Then the minSdk (CD34):

```bash
cd "$WT/android" && grep -o 'android:minSdkVersion="[0-9]*"' app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml
```

Expected: `android:minSdkVersion="31"`. If AGP 8.12 writes the merged manifest elsewhere, find it with `find app/build/intermediates -name AndroidManifest.xml -path '*merged*'`, and use that path here and in the workflow. Mutate once: set the plugin's `minSdkVersion` to 30, prebuild and build again, and see the grep print 30 and the workflow's `grep -q` fail; restore from a `cp` backup.

**No device check here (I6):** JS still wires the fake engine until Task 19 (C5), so a phone run would prove nothing about the bridge. `NoCapture`'s refusal is JVM-proved by the three I1 tests (Task 12), and is **not reached on a phone**: by the time C5 wires the native engine, Task 22 (C6) has replaced `NoCapture`. A refused permission on a phone takes a different path, `refused` → `BridgeCore.refused`, not `noticeArm`'s catch. The bridge's first phone run is Task 23 Step 1, after C5 has merged, with Task 22's real capture.

- [ ] **Step 8: Commit** with the message `feat(engine): the Expo module, its scheduler thread and the compile job`, and the trailer lines. Stage by path: `modules/capture-engine/expo-module.config.json`, `modules/capture-engine/android/{build.gradle,.gitignore,src}`, `.github/workflows/android-compile.yml` and the `GlueRulesTest` change. Stage `app.json`, `package.json` and `pnpm-lock.yaml` too, after `git diff package.json` shows only the `expo-build-properties` line (prebuild's rewrite reverted). Never stage `android/`, the root prebuild output.

### Task 21: Our SRT sink, the endpoints, and the RTMP guard

F-P5-1, F-P5-4, F-P5-11, F-P5-12, R3, carry 5, CD14 and CD15.

**Files:**

- Create in `G`: `srt/SeaznSrtSink.kt`, `srt/NOTICE.md` (the Apache-2.0 attribution for the adapted `SrtSink`), `endpoints/CaptureEndpointFactory.kt`, `endpoints/RoutingEndpoint.kt`, `endpoints/CountingEndpoint.kt`, `endpoints/CaptureClockLine.kt`, `endpoints/RtmpDispatcher.kt`, `endpoints/RtmpDispatcherProvider.kt`, `endpoints/TlsGuard.kt`

**Interfaces:**

- `SeaznSrtSink(dispatcher, signals: AttemptSignals, report: (Input) -> Unit) : AbstractSink`, with `next(plan: SrtPlan, attemptId: Int)`, `setMaxBw(attemptId: Int, bytesPerSecond: Long)` and `counters(attemptId: Int): LinkCounters?`;
- `CaptureEndpointFactory(tally: FrameTally, sink: SeaznSrtSink, rtmpIo: CoroutineDispatcher, clock: CaptureClockLine) : IEndpointInternal.Factory`;
- `RoutingEndpoint(srt, rtmp) : IEndpointInternal`;
- `CountingEndpoint(inner, tally, clock) : IEndpointInternal by inner`;
- `CaptureClockLine(line: (RecordEntry) -> Unit)`, with `newAttempt()`, `videoFrame(ptsUs)` and `lastVideoEpochMs`;
- `RtmpDispatcher.create(): CoroutineDispatcher`, `RtmpDispatcherProvider(base, io) : IDispatcherProvider by base`;
- `TlsGuard`, with `Mode { SCOPED, GLOBAL }`, `MODE`, `handler(previous)`, `install(mode)` and `record: (RecordEntry) -> Unit`.

The shapes below were read from StreamPack 3.2.0's source (`AbstractSink`, `SrtSink`, `CompositeEndpoint`, `IEndpointInternal`, `RtmpEndpointFactory`, `SrtMediaDescriptor(host, port, …)`, `IDispatcherProvider`). Every srtdroid call was read with `javap` from srtdroid-ktx and srtdroid-core **1.10.1**'s `classes.jar`, downloaded from Maven Central on 2026-10-01, and is marked `// 1.10.1:` with the signature it uses. Two facts the sink depends on were read from the bytecode too: `Stats.pktRetransTotal`, `pktSndDropTotal`, `pktSndLossTotal` and `msSndBuf` are `Int`, `pktSentTotal` and `byteSentTotal` are `Long`, and `msRTT` and `mbpsBandwidth` are `Double` (N4); and `CoroutineSrtSocket.close()` calls `SrtSocket.close()` and then completes `socketContext` with a null cause **synchronously**, or with the throwable if the native close throws. So a requested close reports `Dropped(REQUESTED)` through `invokeOnCompletion` before the next `openImpl` resets `completion`. 1.10.1's public API is 1.9.5's plus `trySend`, with nothing removed.

- [ ] **Step 1: Check the resolved jar is the one read.** Resolve the dependency, then re-read the classes the sink calls, so a different artifact in the build cannot pass unseen:

```bash
cd "$WT/android" && ./gradlew :capture-engine:dependencies --configuration debugRuntimeClasspath > "$TMPDIR/deps.txt"; grep -n 'streampack\|srtdroid\|komuxer\|ktor' "$TMPDIR/deps.txt" | head -40
AAR=$(find ~/.gradle/caches/modules-2 -name 'srtdroid-ktx-1.10.1.aar' | head -1); mkdir -p "$TMPDIR/srt" && unzip -o -q "$AAR" classes.jar -d "$TMPDIR/srt"
javap -cp "$TMPDIR/srt/classes.jar" io.github.thibaultbee.srtdroid.ktx.CoroutineSrtSocket | grep -E 'connect|send|setSockFlag|bistats|isConnected|connectionTime|socketContext|close'
```

Expected, among the lines (read from 1.10.1 when this plan was written):

```text
public io.github.thibaultbee.srtdroid.ktx.CoroutineSrtSocket(kotlinx.coroutines.CoroutineDispatcher);
public final kotlinx.coroutines.CompletableJob getSocketContext();
public final void close();
public final java.lang.Object connect(java.net.InetSocketAddress, kotlin.coroutines.Continuation<? super kotlin.Unit>);
public void setSockFlag(io.github.thibaultbee.srtdroid.core.enums.SockOpt, java.lang.Object);
public final java.lang.Object send(java.nio.ByteBuffer, io.github.thibaultbee.srtdroid.core.models.MsgCtrl, kotlin.coroutines.Continuation<? super java.lang.Integer>);
public final io.github.thibaultbee.srtdroid.core.models.Stats bistats(boolean, boolean);
public final long getConnectionTime();
public final boolean isConnected();
```

A difference means the build resolved another artifact than the one read: stop and report it. Write the printed signatures into the commit body.

- [ ] **Step 2: `SeaznSrtSink`.** It is adapted from StreamPack's `SrtSink` (Apache-2.0; keep its header and add ours, and say so in `srt/NOTICE.md`). Its differences are this plan's rules.

```kotlin
package com.seazn.capture.engine.srt

import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.SrtOpt
import com.seazn.capture.engine.adapter.SrtPlan
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.LinkCounters
import io.github.thibaultbee.srtdroid.core.enums.Boundary
import io.github.thibaultbee.srtdroid.core.enums.SockOpt
import io.github.thibaultbee.srtdroid.core.enums.Transtype
import io.github.thibaultbee.srtdroid.core.models.MsgCtrl
import io.github.thibaultbee.srtdroid.ktx.CoroutineSrtSocket
import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.endpoints.ClosedException
import io.github.thibaultbee.streampack.core.elements.endpoints.MediaSinkType
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.data.Packet
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.data.SrtPacket
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.sinks.AbstractSink
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.sinks.SinkConfiguration
import java.net.InetAddress
import java.net.InetSocketAddress
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * Our SRT sink (CD14). StreamPack's SrtSink sets MAXBW 0 and INPUTBW in bits, where libsrt reads
 * bytes (F-P5-11). This one sets every option from [SrtPlan], resolves the host first on its IO
 * dispatcher (F-P5-1), takes its secrets as socket options and never in a URL, and reports one drop
 * per attempt from the socket's completion (R3).
 */
class SeaznSrtSink(
  private val dispatcher: CoroutineDispatcher,
  private val signals: AttemptSignals,
  private val report: (Input) -> Unit,
) : AbstractSink() {
  override val supportedSinkTypes: List<MediaSinkType> = listOf(MediaSinkType.SRT)

  private val open = MutableStateFlow(false)
  override val isOpenFlow = open.asStateFlow()

  @Volatile private var socket: CoroutineSrtSocket? = null
  @Volatile private var pending: Pair<SrtPlan, Int>? = null
  @Volatile private var attemptId: Int? = null
  @Volatile private var completion: Throwable? = null

  /** Set by the streamer adapter before `startStream`; the descriptor it passes carries host and port only. */
  fun next(plan: SrtPlan, attemptId: Int) {
    pending = plan to attemptId
  }

  /** INPUTBW and MAXBW come from the plan, never from the encoder's bitrate (F-P5-11). */
  override fun configure(config: SinkConfiguration) = Unit

  override suspend fun openImpl(mediaDescriptor: MediaDescriptor) = withContext(dispatcher) {
    val (plan, id) = pending ?: throw IllegalStateException("no SRT plan for this connect")
    val address = InetAddress.getByName(plan.host) // F-P5-1: UnknownHostException → UNRESOLVED, on IO
    val opened = CoroutineSrtSocket(dispatcher) // 1.10.1: CoroutineSrtSocket(CoroutineDispatcher)
    opened.setSockFlag(SockOpt.PAYLOADSIZE, PAYLOAD_SIZE)
    for ((option, value) in plan.before) opened.setSockFlag(sockOpt(option), flagValue(option, value)) // 1.10.1: setSockFlag(SockOpt, Any)
    completion = null
    opened.socketContext.invokeOnCompletion { cause -> closed(id, cause) } // 1.10.1: socketContext: CompletableJob; close() completes it synchronously
    opened.connect(InetSocketAddress(address, plan.port)) // 1.10.1: suspend connect(InetSocketAddress)
    opened.setSockFlag(SockOpt.MAXBW, plan.maxBwBytesPerSecond) // F-P5-11: after connect, in bytes per second
    socket = opened
    attemptId = id
    open.value = true
  }

  override suspend fun startStream() {
    val held = socket ?: throw ClosedException("SRT socket not open")
    if (!held.isConnected) throw ClosedException("SRT socket not connected") // 1.10.1: isConnected: Boolean
  }

  override suspend fun write(packet: Packet): Int {
    completion?.let { throw ClosedException(it) }
    val held = socket ?: throw ClosedException("SRT socket not open")
    if (packet.ts != 0L && held.connectionTime > packet.ts) return -1 // as SrtSink: older than the connection
    return held.send(packet.buffer, msgCtrl(packet)) // 1.10.1: suspend send(ByteBuffer, MsgCtrl): Int
  }

  override suspend fun stopStream() = Unit

  override suspend fun close() {
    socket?.close()
    socket = null
    attemptId = null
    open.value = false
  }

  fun setMaxBw(forAttempt: Int, bytesPerSecond: Long) {
    if (attemptId == forAttempt) socket?.setSockFlag(SockOpt.MAXBW, bytesPerSecond)
  }

  /** One reading for the Link poller (CD12): a quick JNI call, allowed on the scheduler thread. */
  fun counters(forAttempt: Int): LinkCounters? {
    if (attemptId != forAttempt) return null
    val stats = socket?.bistats(clear = false, instantaneous = true) ?: return null // 1.10.1: bistats(Boolean, Boolean): Stats
    // 1.10.1 Stats: byteSentTotal and pktSentTotal Long; pktRetransTotal, pktSndDropTotal, pktSndLossTotal, msSndBuf Int; msRTT, mbpsBandwidth Double (N4).
    return LinkCounters(stats.byteSentTotal, stats.pktSentTotal, stats.pktRetransTotal.toLong(), stats.pktSndDropTotal.toLong(),
      stats.pktSndLossTotal.toLong(), stats.msRTT.toInt(), stats.msSndBuf.takeIf { it >= 0 }, (stats.mbpsBandwidth * 1_000_000).toLong())
  }

  private fun closed(id: Int, cause: Throwable?) {
    completion = cause
    open.value = false
    signals.dropped(id, cause)?.let(report)
  }

  private fun sockOpt(option: SrtOpt): SockOpt = if (option == SrtOpt.TRANSTYPE_LIVE) SockOpt.TRANSTYPE else SockOpt.valueOf(option.name)

  private fun flagValue(option: SrtOpt, value: Any): Any = if (option == SrtOpt.TRANSTYPE_LIVE) Transtype.LIVE else value

  /** Copied from StreamPack's SrtSink.buildMsgCtrl. */
  private fun msgCtrl(packet: Packet): MsgCtrl {
    val boundary = (packet as? SrtPacket)?.let {
      when {
        it.isFirstPacketFrame && it.isLastPacketFrame -> Boundary.SOLO
        it.isFirstPacketFrame -> Boundary.FIRST
        it.isLastPacketFrame -> Boundary.LAST
        else -> Boundary.SUBSEQUENT
      }
    }
    return when {
      packet.ts == 0L && boundary == null -> MsgCtrl()
      packet.ts == 0L -> MsgCtrl(boundary = boundary!!)
      boundary == null -> MsgCtrl(srcTime = packet.ts)
      else -> MsgCtrl(srcTime = packet.ts, boundary = boundary)
    }
  }

  companion object {
    private const val PAYLOAD_SIZE = 1316
  }
}
```

The `LinkCounters` field order is plan B's (8 parameters, `Link.kt`). `bistats`' field names and types are 1.10.1's, read with `javap -p` on `io.github.thibaultbee.srtdroid.core.models.Stats`. `MsgCtrl`'s named arguments `boundary` and `srcTime` are its constructor properties (`getBoundary`, `getSrcTime`), and `Boundary`, `SockOpt` (with `PAYLOADSIZE`, `TRANSTYPE`, `STREAMID`, `PASSPHRASE`, `LATENCY`, `INPUTBW`, `OHEADBW`, `MAXBW`, `CONNTIMEO`) and `Transtype.LIVE` are its enums, all read from the same jar. The `report` path posts through `BridgeCore.report`, so a drop reaches the machine on its thread.

- [ ] **Step 3: The endpoints.**

```kotlin
package com.seazn.capture.engine.endpoints

import android.content.Context
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.srt.SeaznSrtSink
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.CompositeEndpoint
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.TsMuxer
import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import io.github.thibaultbee.streampack.ext.rtmp.elements.endpoints.RtmpEndpointFactory
import kotlinx.coroutines.CoroutineDispatcher

/** CD14 and CD15: SRT through TsMuxer and our sink, RTMPS through StreamPack's endpoint on our IO threads; both counted. */
class CaptureEndpointFactory(
  private val tally: FrameTally,
  private val sink: SeaznSrtSink,
  private val rtmpIo: CoroutineDispatcher,
  private val clock: CaptureClockLine,
) : IEndpointInternal.Factory {
  override fun create(context: Context, dispatcherProvider: IDispatcherProvider): IEndpointInternal {
    val srt = CompositeEndpoint(TsMuxer(), sink)
    val rtmp = RtmpEndpointFactory().create(context, RtmpDispatcherProvider(dispatcherProvider, rtmpIo))
    return CountingEndpoint(RoutingEndpoint(srt, rtmp), tally, clock)
  }
}
```

```kotlin
package com.seazn.capture.engine.endpoints

import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.encoders.CodecConfig
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal
import io.github.thibaultbee.streampack.core.elements.endpoints.MediaSinkType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * SRT or RTMPS, chosen at each open by the descriptor's sink type. The open state is copied
 * synchronously after open and close, so StreamPack never reads a stale value, and mirrored after.
 */
class RoutingEndpoint(private val srt: IEndpointInternal, private val rtmp: IEndpointInternal) : IEndpointInternal {
  @Volatile private var chosen: IEndpointInternal = srt
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var mirror: Job? = null
  private val open = MutableStateFlow(false)
  private val thrown = MutableStateFlow<Throwable?>(null)

  override val isOpenFlow = open.asStateFlow()
  override val throwableFlow = thrown.asStateFlow()
  override val info get() = chosen.info

  override fun getInfo(type: MediaDescriptor.Type) = pick(type.sinkType).getInfo(type)

  override suspend fun open(descriptor: MediaDescriptor) {
    chosen = pick(descriptor.type.sinkType)
    chosen.open(descriptor)
    open.value = chosen.isOpenFlow.value
    mirror?.cancel()
    mirror = scope.launch {
      launch { chosen.isOpenFlow.collect { open.value = it } }
      launch { chosen.throwableFlow.collect { thrown.value = it } }
    }
  }

  override suspend fun close() {
    mirror?.cancel()
    chosen.close()
    open.value = false
  }

  override suspend fun write(frame: Frame, streamPid: Int) = chosen.write(frame, streamPid)

  override suspend fun addStreams(streamConfigs: List<CodecConfig>) = chosen.addStreams(streamConfigs)

  override suspend fun addStream(streamConfig: CodecConfig) = chosen.addStream(streamConfig)

  override suspend fun startStream() = chosen.startStream()

  override suspend fun stopStream() = chosen.stopStream()

  override suspend fun release() {
    srt.release()
    rtmp.release()
    scope.cancel()
  }

  private fun pick(type: MediaSinkType) = if (type == MediaSinkType.SRT) srt else rtmp
}
```

```kotlin
package com.seazn.capture.engine.endpoints

import android.media.MediaFormat
import com.seazn.capture.engine.adapter.FrameTally
import io.github.thibaultbee.streampack.core.elements.data.Frame
import io.github.thibaultbee.streampack.core.elements.endpoints.IEndpointInternal

/** F-P5-4: counts the encoded frames that reached the endpoint, video apart from audio, then writes them. */
class CountingEndpoint(
  private val inner: IEndpointInternal,
  private val tally: FrameTally,
  private val clock: CaptureClockLine,
) : IEndpointInternal by inner {
  override suspend fun write(frame: Frame, streamPid: Int) {
    val mime = frame.format.getString(MediaFormat.KEY_MIME)
    tally.counted(mime, frame.rawBuffer.remaining())
    if (mime?.startsWith("video/") == true) clock.videoFrame(frame.ptsInUs)
    inner.write(frame, streamPid)
  }
}
```

```kotlin
package com.seazn.capture.engine.endpoints

import com.seazn.capture.engine.adapter.CaptureClock
import com.seazn.capture.engine.core.RecordEntry
import io.github.thibaultbee.streampack.core.elements.utils.time.TimeUtils

/**
 * Carry 5: the last video frame's capture time on the wall clock. StreamPack stamps frames with
 * `TimeUtils.currentTime()` (uptime, in µs), so that is the clock read here. The first frame of each
 * attempt writes `capture-clock {lagMs}`: the device check reads it (Device-only claims).
 */
class CaptureClockLine(private val line: (RecordEntry) -> Unit) {
  @Volatile var lastVideoEpochMs: Long? = null
    private set

  @Volatile private var firstPending = false

  fun newAttempt() {
    firstPending = true
  }

  fun videoFrame(ptsUs: Long) {
    val wallNowMs = System.currentTimeMillis()
    val epochMs = CaptureClock.epochMs(ptsUs, TimeUtils.currentTime(), wallNowMs)
    lastVideoEpochMs = epochMs
    if (!firstPending) return
    firstPending = false
    line(RecordEntry("capture-clock", listOf("lagMs" to wallNowMs - epochMs)))
  }
}
```

```kotlin
package com.seazn.capture.engine.endpoints

import io.github.thibaultbee.streampack.core.pipelines.IDispatcherProvider
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher

/** RTMP's IO runs on our two threads, each with the TLS guard as its handler (F-P5-12, CD15). */
object RtmpDispatcher {
  fun create(): CoroutineDispatcher =
    Executors.newFixedThreadPool(2) { task -> Thread(task, "rtmp-io").apply { uncaughtExceptionHandler = TlsGuard.handler(previous = null) } }
      .asCoroutineDispatcher()
}

/** StreamPack's provider with `io` replaced; `RtmpEndpointFactory` reads `default` and `io` only. */
class RtmpDispatcherProvider(base: IDispatcherProvider, override val io: CoroutineDispatcher) : IDispatcherProvider by base
```

```kotlin
package com.seazn.capture.engine.endpoints

import android.os.Looper
import com.seazn.capture.engine.adapter.TlsCloserGuard
import com.seazn.capture.engine.core.RecordEntry

/**
 * F-P5-12: Ktor's TLS closer can throw an IOException on an IO thread after a cut. SCOPED guards our
 * RTMP threads only; GLOBAL wraps the process default, the spike's fallback. Task 26's ten cuts decide.
 */
object TlsGuard {
  enum class Mode { SCOPED, GLOBAL }

  val MODE = Mode.SCOPED

  /** Where a swallowed throw is recorded. EngineHost sets it to `EngineHost::line`. */
  @Volatile var record: (RecordEntry) -> Unit = {}

  private var installed = false

  fun handler(previous: Thread.UncaughtExceptionHandler?) = Thread.UncaughtExceptionHandler { thread, failure ->
    if (TlsCloserGuard.swallows(failure, Looper.getMainLooper().isCurrentThread)) {
      record(RecordEntry("tls-closer-swallowed", listOf("error" to failure.javaClass.simpleName)))
    } else {
      (previous ?: Thread.getDefaultUncaughtExceptionHandler())?.uncaughtException(thread, failure)
    }
  }

  @Synchronized
  fun install(mode: Mode) {
    if (mode != Mode.GLOBAL || installed) return
    installed = true
    Thread.setDefaultUncaughtExceptionHandler(handler(Thread.getDefaultUncaughtExceptionHandler()))
  }
}
```

A coroutine's uncaught throw on a dispatcher thread goes to that thread's handler, which is how the scoped guard sees it. Ktor may run its TLS closer on `Dispatchers.IO` rather than on the endpoint's `io`, in which case the scoped handler never sees it. That is exactly what Task 26's ten-cut test proves or disproves. Write `SCOPED` here, and switch `MODE` only on that evidence. `EngineHost.build` sets `TlsGuard.record = ::line` and calls `TlsGuard.install(TlsGuard.MODE)` (Task 22's `build`).

- [ ] **Step 4: Build.** Run `assembleDebug` (EXIT=0) and the core suite (`GlueRulesTest`: `InetAddress` only in `srt/SeaznSrtSink.kt`; no `runBlocking` in our files, although StreamPack's `CompositeEndpoint` uses one around `sink.write` on the muxer's thread, never ours).

- [ ] **Step 5: Commit** with the message `feat(engine): our SRT sink, the routed endpoint, and a scoped TLS guard`, and the trailer lines. The body lists the srtdroid signatures Step 1 printed.

### Task 22: The streamer adapter, the slate, and the audio level

P4, F-P5-6, the B-frames finding, carry 5, CD9, CD27 and CD28. This replaces `NoCapture`.

**Files:**

- Create in `G`: `capture/StreamerAdapter.kt`, `capture/AudioSessionIds.kt`, `capture/SlateSource.kt`, `capture/AudioLevelEffect.kt`
- Create: `modules/capture-engine/android/src/main/res/drawable/slate.xml` (the card's glyph: the camera and the Seazn mark, with no words), `modules/capture-engine/android/src/main/res/values/colors.xml`
- Create: `core/src/test/kotlin/com/seazn/capture/engine/adapter/SlateColoursTest.kt` (M11)
- Delete: `capture/NoCapture.kt`
- Modify: `EngineHost.kt` (`build` wires `StreamerAdapter`, the TLS guard's record, and the capture clock line)

**Interfaces:** `StreamerAdapter(context, tally: FrameTally, signals: AttemptSignals, cameras: CameraAvailability, meter: PeakMeter, report: (Input) -> Unit, failure: (Throwable) -> Unit, line: (RecordEntry) -> Unit) : Capture`, plus `audioSessionId(): Int?` for Task 23's `MicWatch`.

**What it does.** Every command runs on one scope (`Dispatchers.Default`, a `SupervisorJob`, and a `CoroutineExceptionHandler` that hands any escaped throw to `BridgeCore.failure`, I5), under one `Mutex`, so no two StreamPack calls interleave. Nothing blocks the scheduler thread: `prepare` and `execute` launch and return.

| Command                       | StreamPack calls                                                                                                                                                            | Reports                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `prepare(config, rotation)`   | `cameraSingleStreamer(context, back camera, endpointFactory = ours, defaultRotation = rotation)`; `setAudioConfig`; `setVideoConfig`; the level effect                      | `cameras.sessionStarted()`'s input, if any. A failure is `PermanentPlatformFailure` (CD11)                 |
| `Connect`                     | `tally.begin(id)`; `clock.newAttempt()`; `videoEncoder.bitrate = bps`; SRT: `sink.next(plan, id)`, `startStream(SrtMediaDescriptor(host, port))`; RTMPS: `startStream(url)` | `signals.connected(id)`, or `signals.connectFailed(id, t)`; an SRT URL that does not plan: `ConnectFailed` |
| `Disconnect(id)`              | `stopStream()`, `close()`                                                                                                                                                   | none (the machine asked)                                                                                   |
| `Rebuild` / `StartNewSession` | `stopStream()`, `close()`, then `Connect(next)`. These are the calls of the manual reconnect that healed F-P5-6 in P5                                                       | as Connect                                                                                                 |
| `SetBitrate(id, bps)`         | `videoEncoder?.bitrate = bps`                                                                                                                                               | none                                                                                                       |
| `SetMaxBw(id, b)`             | `sink.setMaxBw(id, b)` (F-P5-11)                                                                                                                                            | none                                                                                                       |
| `SwitchCamera`                | `cameras.selfChange(now)`; `setVideoSource(CameraSourceFactory(other))`; `cameras.held(other, now)`                                                                         | none; frames keep coming (carry 19)                                                                        |
| `ReopenCamera`                | `cameras.selfChange(now)`; `setVideoSource(CameraSourceFactory(id))`                                                                                                        | `CameraReopened(ok)`                                                                                       |
| `Slate(on)`                   | on: `setVideoSource(SlateSource.factory(context))`, `audioInput.isMuted = true`; off: the camera back, `isMuted = false`                                                    | none                                                                                                       |
| `End`                         | `streamer.value = null` first (the preview unbinds), then `stopStream()`, `close()`, `release()`; `cameras.sessionEnded()`; `tally.begin(-1)`                               | none                                                                                                       |

**Rules:**

- An endpoint closing without our asking is a drop. After each successful connect, a job waits for the endpoint's `isOpenFlow` to go false and calls `signals.dropped(id, IOException("endpoint closed"))` unless that attempt's stop was requested. For SRT the sink's completion usually reports first; `AttemptSignals` keeps one drop per attempt (R3).
- **`setTargetRotation` is never called** (F-P5-6, CD27). `GlueRulesTest` enforces it.
- The streamer is built once per accepted arm, with that arm's rotation, and released at `End`. Reconnects reuse it. A build that finds a streamer still held (an `End` that never came) ends and releases it first, and records `capture-replaced`, so two streamers never hold the camera (N2).
- At the first connect of each session, a null `audioSessionId()` is recorded once as `watch-failed {action: "mic-session"}` (N8): MicWatch would otherwise read nothing, silently. That bounds #306's per-streamer surface leak to one per session. Task 26 measures RSS across 20 reconnects to see whether the leak follows `startStream` instead.
- `SERVICE` is a `TSServiceInfo(DIGITAL_TV, 0x4698, "Seazn", "Seazn Capture")`. It carries no session data.
- `KEY_MAX_B_FRAMES` is the constant `MediaFormat.KEY_MAX_B_FRAMES`, and its value must equal `EncoderKeys`' `"max-bframes"`: `javap -constants -cp "$ANDROID_HOME/platforms/android-36/android.jar" android.media.MediaFormat | grep MAX_B_FRAMES`. Record the output.
- `cameraReady` is read, never kept: the current video source is a camera (`ICameraSource`, so never the slate), and either the source is previewing (`IPreviewableSource.isPreviewingFlow`) or the video input is streaming (`IVideoInput.isStreamingFlow`; `ICameraSource` has none of its own, N3). Both are `StateFlow` values, safe to read on the scheduler thread.

- [ ] **Step 1: Write the adapter, the slate and the effect.**

```kotlin
package com.seazn.capture.engine.capture

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
import android.os.SystemClock
import android.util.Size
import com.seazn.capture.engine.adapter.AttemptSignals
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.adapter.EncoderKeys
import com.seazn.capture.engine.adapter.FrameTally
import com.seazn.capture.engine.adapter.PeakMeter
import com.seazn.capture.engine.adapter.PermanentPlatformFailure
import com.seazn.capture.engine.adapter.SrtOptions
import com.seazn.capture.engine.core.Command
import com.seazn.capture.engine.core.ConnectFailure
import com.seazn.capture.engine.core.Encode
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.RtmpsTarget
import com.seazn.capture.engine.core.SessionConfig
import com.seazn.capture.engine.core.SrtTarget
import com.seazn.capture.engine.endpoints.CaptureClockLine
import com.seazn.capture.engine.endpoints.CaptureEndpointFactory
import com.seazn.capture.engine.endpoints.RtmpDispatcher
import com.seazn.capture.engine.srt.SeaznSrtSink
import io.github.thibaultbee.streampack.core.configuration.mediadescriptor.MediaDescriptor
import io.github.thibaultbee.streampack.core.elements.encoders.AudioCodecConfig
import io.github.thibaultbee.streampack.core.elements.encoders.VideoCodecConfig
import io.github.thibaultbee.streampack.core.elements.endpoints.composites.muxers.ts.data.TSServiceInfo
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.CameraSourceFactory
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.ICameraSource
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.backCameras
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.cameraManager
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.defaultCameraId
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.frontCameras
import io.github.thibaultbee.streampack.core.elements.sources.video.camera.extensions.isBackCamera
import io.github.thibaultbee.streampack.core.interfaces.startStream
import io.github.thibaultbee.streampack.core.streamers.single.SingleStreamer
import io.github.thibaultbee.streampack.core.streamers.single.cameraSingleStreamer
import io.github.thibaultbee.streampack.ext.srt.configuration.mediadescriptor.SrtMediaDescriptor
import java.io.IOException
import java.net.URLEncoder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Capture and publish with StreamPack (CD27). Holds no rule: each decision is an adapter call. */
@SuppressLint("MissingPermission") // CD16: prepare runs only after CAMERA and RECORD_AUDIO are granted
class StreamerAdapter(
  private val context: Context,
  private val tally: FrameTally,
  private val signals: AttemptSignals,
  private val cameras: CameraAvailability,
  private val meter: PeakMeter,
  private val report: (Input) -> Unit,
  private val failure: (Throwable) -> Unit,
  private val line: (RecordEntry) -> Unit,
) : Capture {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, t -> failure(t) })
  private val mutex = Mutex()
  private val sink = SeaznSrtSink(Dispatchers.IO.limitedParallelism(2), signals, report)
  private val clock = CaptureClockLine(line)
  private val endpoints = CaptureEndpointFactory(tally, sink, RtmpDispatcher.create(), clock)
  private val current = MutableStateFlow<SingleStreamer?>(null)
  override val streamer: StateFlow<SingleStreamer?> = current

  @Volatile private var cameraId: String? = null
  @Volatile private var stopAsked: Int? = null
  @Volatile private var micNoted = false
  private var closeWatch: Job? = null

  override fun prepare(config: SessionConfig, rotation: Int) = serial { build(rotation) }

  override fun execute(command: Command) = serial { run(command) }

  override fun frames(attemptId: Int) = tally.read(attemptId)

  override fun link(attemptId: Int) = sink.counters(attemptId)

  override fun facts() = CaptureFacts(meter.take(), current.value?.let(::cameraOpened) ?: false, clock.lastVideoEpochMs)

  /** Task 23's MicWatch: our AudioRecord's session id, by reflection (StreamPack keeps it private). */
  fun audioSessionId(): Int? = current.value?.audioInput?.sourceFlow?.value?.let(AudioSessionIds::of)

  private fun serial(block: suspend () -> Unit) {
    scope.launch { mutex.withLock { block() } }
  }

  private suspend fun build(rotation: Int) {
    // N2: never two streamers. One still held (an End that never came) is ended and released first.
    if (current.value != null) {
      line(RecordEntry("capture-replaced", emptyList()))
      end()
    }
    micNoted = false
    val manager = context.cameraManager
    val id = manager.backCameras.firstOrNull() ?: context.defaultCameraId
    val made = try {
      cameraSingleStreamer(context, cameraId = id, endpointFactory = endpoints, defaultRotation = rotation)
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      throw PermanentPlatformFailure("camera: ${e.javaClass.simpleName}", e)
    }
    configure(made)
    cameraId = id
    cameras.held(id, SystemClock.elapsedRealtime())
    cameras.sessionStarted()?.let(report)
    current.value = made
  }

  private suspend fun configure(made: SingleStreamer) {
    try {
      made.setAudioConfig(AUDIO)
      made.setVideoConfig(video())
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      made.release()
      throw PermanentPlatformFailure("encoder: ${e.javaClass.simpleName}", e)
    }
    made.audioInput.processor.add(AudioLevelEffect(meter))
  }

  private suspend fun run(command: Command) {
    if (command is Command.End) return end()
    val held = current.value ?: return // nothing armed: nothing to carry out
    when (command) {
      is Command.Connect -> connect(held, command)
      is Command.Disconnect -> disconnect(held, command.attemptId)
      is Command.Rebuild -> reconnect(held, command.previousAttemptId, command.next)
      is Command.StartNewSession -> reconnect(held, command.previousAttemptId, command.next)
      is Command.SetBitrate -> held.videoEncoder?.bitrate = command.bps
      is Command.SetMaxBw -> sink.setMaxBw(command.attemptId, command.bytesPerSecond)
      Command.SwitchCamera -> switchCamera(held)
      Command.ReopenCamera -> reopenCamera(held)
      is Command.Slate -> slate(held, command.on)
      else -> Unit // HTTP, the descriptor and record lines are BridgeCore's
    }
  }

  private suspend fun connect(held: SingleStreamer, command: Command.Connect) {
    val id = command.attemptId
    tally.begin(id)
    clock.newAttempt()
    stopAsked = null
    held.videoEncoder?.bitrate = command.startBitrateBps
    try {
      when (val target = command.target) {
        is SrtTarget -> held.startStream(srt(target, command) ?: return report(Input.ConnectFailed(id, ConnectFailure.OTHER, "srt url does not parse")))
        is RtmpsTarget -> held.startStream(target.url.trimEnd('/') + "/" + URLEncoder.encode(target.streamKey, "UTF-8"))
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      return signals.connectFailed(id, e)?.let(report) ?: Unit
    }
    signals.connected(id)?.let(report)
    noteMicSession()
    watchClose(held, id)
  }

  /**
   * N8: MicWatch reads nothing without our AudioRecord's session id, so a failed read is evidence, not
   * silence. Checked once per session, at its first connect, when the AudioRecord is recording.
   */
  private fun noteMicSession() {
    if (micNoted) return
    micNoted = true
    if (audioSessionId() == null) line(RecordEntry("watch-failed", listOf("action" to "mic-session")))
  }

  private fun srt(target: SrtTarget, command: Command.Connect): MediaDescriptor? {
    val plan = SrtOptions.plan(target, command.maxBwBytesPerSecond) ?: return null
    sink.next(plan, command.attemptId)
    return SrtMediaDescriptor(plan.host, plan.port, serviceInfo = SERVICE)
  }

  private fun watchClose(held: SingleStreamer, id: Int) {
    closeWatch?.cancel()
    closeWatch = scope.launch {
      held.endpoint.isOpenFlow.first { open -> !open }
      if (stopAsked != id) signals.dropped(id, IOException("endpoint closed"))?.let(report)
    }
  }

  private suspend fun disconnect(held: SingleStreamer, id: Int) {
    stopAsked = id
    closeWatch?.cancel()
    quietly("stop") { held.stopStream() }
    quietly("close") { held.close() }
  }

  private suspend fun reconnect(held: SingleStreamer, previous: Int, next: Command.Connect) {
    disconnect(held, previous)
    connect(held, next)
  }

  private suspend fun switchCamera(held: SingleStreamer) {
    val manager = context.cameraManager
    val onBack = cameraId?.let(manager::isBackCamera) ?: true
    val other = (if (onBack) manager.frontCameras else manager.backCameras).firstOrNull() ?: return
    cameras.selfChange(SystemClock.elapsedRealtime())
    held.setVideoSource(CameraSourceFactory(other))
    cameraId = other
    cameras.held(other, SystemClock.elapsedRealtime())
  }

  private suspend fun reopenCamera(held: SingleStreamer) {
    val id = cameraId ?: return report(Input.CameraReopened(false))
    cameras.selfChange(SystemClock.elapsedRealtime())
    val ok = quietly("reopen") { held.setVideoSource(CameraSourceFactory(id)) }
    report(Input.CameraReopened(ok))
  }

  private suspend fun slate(held: SingleStreamer, on: Boolean) {
    if (on) held.setVideoSource(SlateSource.factory(context)) else cameraId?.let { held.setVideoSource(CameraSourceFactory(it)) }
    held.audioInput.isMuted = on
  }

  private suspend fun end() {
    val held = current.value
    current.value = null // the preview unbinds first (Task 25)
    closeWatch?.cancel()
    if (held != null) {
      quietly("stop") { held.stopStream() }
      quietly("close") { held.close() }
      quietly("release") { held.release() }
    }
    cameras.sessionEnded()
    tally.begin(-1)
  }

  /** A teardown call whose failure is recorded and does not stop the next one. Never swallows cancellation. */
  private suspend fun quietly(action: String, block: suspend () -> Unit): Boolean = try {
    block()
    true
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    line(RecordEntry("capture-call-failed", listOf("action" to action, "error" to e.javaClass.simpleName)))
    false
  }

  /** N3: `ICameraSource` has no `isStreamingFlow` (it extends `IVideoSource` and `IPreviewableSource`); the input has. */
  private fun cameraOpened(held: SingleStreamer): Boolean {
    val source = held.videoInput.sourceFlow.value as? ICameraSource ?: return false
    return held.videoInput.isStreamingFlow.value || source.isPreviewingFlow.value
  }

  private fun video() = VideoCodecConfig(
    mimeType = MediaFormat.MIMETYPE_VIDEO_AVC,
    startBitrate = Encode.START_BPS,
    resolution = Size(1280, 720),
    fps = 30,
    gopDurationInS = 2f,
    customize = { _ -> EncoderKeys.VIDEO.forEach { (key, value) -> setInteger(key, value) } },
  )

  companion object {
    private val SERVICE = TSServiceInfo(TSServiceInfo.ServiceType.DIGITAL_TV, 0x4698, "Seazn", "Seazn Capture")

    /** M10: PcmPeak reads 16-bit samples, so the byte format is set, never left to a default. */
    private val AUDIO = AudioCodecConfig(
      mimeType = MediaFormat.MIMETYPE_AUDIO_AAC,
      startBitrate = 128_000,
      sampleRate = 48_000,
      channelConfig = AudioFormat.CHANNEL_IN_STEREO,
      byteFormat = AudioFormat.ENCODING_PCM_16BIT,
    )
  }
}
```

`AudioConfig` and `VideoConfig` are StreamPack's type aliases of `AudioCodecConfig` and `VideoCodecConfig`; use whichever name the jar exports. `SingleStreamer.endpoint`, `videoEncoder`, `audioInput`, `videoInput`, `setVideoSource` and the `startStream(descriptor | uriString)` extensions are StreamPack 3.2.0's (`streamers/single/SingleStreamer.kt`, `interfaces/IStreamer.kt:128-170`, `interfaces/ISource.kt:74`). Each `when` branch is one call into a private function, and every function stays within 25 lines.

```kotlin
package com.seazn.capture.engine.capture

import io.github.thibaultbee.streampack.core.elements.sources.audio.IAudioSource

/**
 * Task 23's MicWatch needs our AudioRecord's session id. StreamPack keeps the AudioRecord in a private
 * field, `audioRecord`, of its internal `AudioRecordSource` (3.2.0 `AudioRecordSource.kt:44`), which
 * `MicrophoneSource` extends. A failure is null: MicWatch then reports nothing, and the adapter records it once per
 * session as `watch-failed {action: "mic-session"}` (N8).
 */
object AudioSessionIds {
  fun of(source: IAudioSource): Int? = try {
    val field = generateSequence(source.javaClass as Class<*>) { it.superclass }.firstNotNullOfOrNull { type ->
      type.declaredFields.firstOrNull { it.name == "audioRecord" }
    } ?: return null
    field.isAccessible = true
    (field.get(source) as? android.media.AudioRecord)?.audioSessionId
  } catch (e: ReflectiveOperationException) {
    null
  } catch (e: SecurityException) {
    null
  }
}
```

```kotlin
package com.seazn.capture.engine.capture

import com.seazn.capture.engine.adapter.PcmPeak
import com.seazn.capture.engine.adapter.PeakMeter
import io.github.thibaultbee.streampack.core.elements.data.RawFrame
import io.github.thibaultbee.streampack.core.elements.processing.audio.IConsumerAudioEffect

/** The permanent meter's source (AGENTS §6): the peak of each raw 16-bit frame, before the encoder. */
class AudioLevelEffect(private val meter: PeakMeter) : IConsumerAudioEffect {
  override fun consume(isMuted: Boolean, data: RawFrame) = meter.offer(if (isMuted) 0.0 else PcmPeak.of(data.rawBuffer))

  override fun close() = Unit
}
```

```kotlin
package com.seazn.capture.engine.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.ContextCompat
import com.seazn.capture.engine.R
import io.github.thibaultbee.streampack.core.elements.sources.video.bitmap.BitmapSourceFactory

/** The phone-made still on air while the camera is someone else's (spec §3): no words, so no language. */
object SlateSource {
  @Volatile private var card: Bitmap? = null

  fun factory(context: Context) = BitmapSourceFactory(card ?: draw(context).also { card = it })

  private fun draw(context: Context): Bitmap {
    val bitmap = Bitmap.createBitmap(1280, 720, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(ContextCompat.getColor(context, R.color.seazn_ground))
    val glyph = ContextCompat.getDrawable(context, R.drawable.slate) ?: return bitmap
    glyph.setBounds(520, 240, 760, 480) // 240 px square, centred
    glyph.draw(canvas)
    return bitmap
  }
}
```

`res/values/colors.xml`:

```xml
<resources>
  <!-- Copied from src/ui/theme/tokens.ts; SlateColoursTest keeps them equal (M11). -->
  <color name="seazn_ground">#150b36</color>
  <color name="seazn_ink">#f5f0e8</color>
</resources>
```

`res/drawable/slate.xml` is a vector drawable, 240 dp square, filled with `@color/seazn_ink`: the camera outline and the Seazn mark. Copy the mark's path from the web repo's own SVG (read-only; copy, never edit there) or draw the camera alone if the mark's licence or path is unclear, and say which in the commit.

- [ ] **Step 2: The slate colours test (M11).**

```kotlin
package com.seazn.capture.engine.adapter

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

class SlateColoursTest {
  private fun tokens(): String = File(System.getProperty("capture.tokens")).readText()

  private fun colours(): String = File(System.getProperty("capture.glue"), "../res/values/colors.xml").readText()

  @Test
  fun `M11 the slate's colours are the app's theme tokens, copied exactly`() {
    for ((token, resource) in listOf("ground" to "seazn_ground", "ink" to "seazn_ink")) {
      val theme = Regex("""$token:\s*'(#[0-9a-fA-F]{6})'""").find(tokens())?.groupValues?.get(1)
      val android = Regex("""name="$resource">(#[0-9a-fA-F]{6})<""").find(colours())?.groupValues?.get(1)
      assertEquals(theme?.lowercase(), android?.lowercase(), token)
    }
  }
}
```

Add `systemProperty("capture.tokens", layout.projectDirectory.file("../../../../src/ui/theme/tokens.ts").asFile.absolutePath)` to `core/build.gradle.kts`'s test task beside `capture.glue` (Task 11) and `capture.i18n` (Task 10). `tokens.ts` writes `ground: '#150b36',` and `ink: '#f5f0e8',` (lines 23 and 30), which the regex reads. `capture.glue` is `android/src/main/java`, so `../res/values/colors.xml` is `android/src/main/res/values/colors.xml`. Mutate: change `seazn_ground` to `#150b37`. The test fails.

- [ ] **Step 3: `EngineHost.build`, with the real capture.**

```kotlin
  private fun build(app: Context): Parts {
    Logger.logger = VendorLogger { level, fields -> parts?.core?.log(level, "vendor-log", fields) }
    TlsGuard.record = ::line
    TlsGuard.install(TlsGuard.MODE)
    val thread = HandlerThread("capture-engine").apply { start() }
    lateinit var core: BridgeCore
    val capture = StreamerAdapter(app, FrameTally(), AttemptSignals(), CameraAvailability(), PeakMeter(),
      report = { core.report(it) }, failure = { core.failure(it) }, line = ::line)
    val platform = AndroidPlatform(app, capture, HttpAdapter(), RecordFile(File(app.filesDir, "record")), ::emit)
    core = BridgeCore.shared { BridgeCore(AndroidClock, HandlerScheduler(Handler(thread.looper)), platform, HttpAdapter::readBody) }
    core.start()
    return Parts(core, capture)
  }
```

`report` and `failure` close over `core`, assigned before anything can call them: nothing reaches the capture until `core.start()` has run and an intent arrives. Delete `capture/NoCapture.kt`.

- [ ] **Step 4: Build.** Run `assembleDebug` (EXIT=0) and the core suite (`SlateColoursTest` green; `GlueRulesTest` green). The first live device check is Task 23 Step 1 (I6).

- [ ] **Step 5: Commit** with the message `feat(engine): capture and publish with StreamPack, never rotating the encode`, and the trailer lines. Stage `core/build.gradle.kts` and `SlateColoursTest.kt` by path with the glue.

## Batch C7 — Android glue II and the preview

### Task 23: The bridge's first phone run, and the watchers — camera, microphone, network and device

F-P5-8, F-P5-9, F-P5-10, carry 5, CD20, CD34, I6, N8 and N9. Step 1 runs the device checks C6 could not (Tasks 20–22): by now C5 has merged, so JS wires the native engine and Diagnostics has its engine rows. Each watcher turns an Android callback into a call on its pure rule (Tasks 9–10), and reports through `BridgeCore.report`.

**Files:**

- Create in `G`: `watch/CameraWatch.kt`, `watch/MicWatch.kt`, `watch/NetworkWatch.kt`, `watch/DeviceSampler.kt`
- Modify: `EngineHost.kt` (`build` starts them), `AndroidPlatform.kt` (`facts()` reads `NetworkWatch.reachable`; `armed` tells `DeviceSampler`)

**Interfaces:**

- `CameraWatch(context, rule: CameraAvailability, report, line)`, with `start()`;
- `MicWatch(context, sessionId: () -> Int?, rule: MicSilenceWatch, report, line)`, with `start()`;
- `NetworkWatch(context, report)`, with `start()` and `@Volatile var reachable: Boolean`;
- `DeviceSampler(context, report, line)`, with `start()` and `armed()`, which starts a new `ChargeDrain` (drain is per session).

All four live for the process, by design: the contended camera set and the network must be true before the first arm.

- [ ] **Step 1: The bridge's first phone run (Tasks 20–22's device checks, I6).** Prerequisites: C5 merged into this branch, a local `assembleDebug` installed with `adb`, and Task 26's hand-made v2 code and local descriptor. The owner's hands: scan the code, hold Go live, then hold Stop. Read, and record in the commit body:
  - **The bridge (Task 20):** Diagnostics' record shows the `intent.arm` JS line and native's `armed` line in one list, in order, with `kind` keys. `adb shell run-as com.seazn.capture cat files/record/session-record.ndjson | tail -5` shows the same lines on disk (a debug build; never paste a line that holds a URL into the results).
  - **Publishing (Task 22):** the state reaches publishing; Diagnostics reads about 30 fps and the `srt` counters move; the stg player shows the picture.
  - **The capture clock (Device-only claims):** `capture-clock` has a `lagMs` between 0 and a few hundred, never negative and never in the thousands.
  - **The vendor logger (CD30):** `adb logcat -d --pid="$(adb shell pidof com.seazn.capture)" | grep -cE 'SrtSink|RtmpEndpoint|AbstractSink|CameraSource|StreamPack'` prints 0, and Diagnostics' record has any `vendor-log` lines instead.
  - Then the owner deletes the recording (`DELETE /stream/{video_uid}`).

- [ ] **Step 2: Write the four watchers.**

```kotlin
package com.seazn.capture.engine.watch

import android.content.Context
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.seazn.capture.engine.adapter.CameraAvailability
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry

/** F-P5-9 and F-P5-10: another app's camera use, from the availability callback. Registered at process start. */
class CameraWatch(
  private val context: Context,
  private val rule: CameraAvailability,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  fun start() {
    val manager = context.getSystemService(CameraManager::class.java) ?: return
    manager.registerAvailabilityCallback(Callback(), Handler(Looper.getMainLooper()))
  }

  private inner class Callback : CameraManager.AvailabilityCallback() {
    override fun onCameraUnavailable(cameraId: String) = guarded { rule.unavailable(cameraId, SystemClock.elapsedRealtime()) }

    override fun onCameraAvailable(cameraId: String) = guarded { rule.available(cameraId, SystemClock.elapsedRealtime()) }
  }

  /** A callback that throws on the main thread kills the app: record it instead (the spike's guarded callbacks). */
  private fun guarded(read: () -> Input?) {
    try {
      read()?.let(report)
    } catch (e: Exception) {
      line(RecordEntry("watch-failed", listOf("action" to "camera", "error" to e.javaClass.simpleName)))
    }
  }
}
```

```kotlin
package com.seazn.capture.engine.watch

import android.content.Context
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Handler
import android.os.Looper
import com.seazn.capture.engine.adapter.MicSilenceWatch
import com.seazn.capture.engine.adapter.RecordingConfig
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry

/** F-P5-8: a call silencing our recording, matched by our AudioRecord's session id. `isClientSilenced` is API 29; minSdk is 31 (CD34). */
class MicWatch(
  private val context: Context,
  private val sessionId: () -> Int?,
  private val rule: MicSilenceWatch,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  fun start() {
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    audio.registerAudioRecordingCallback(Callback(), Handler(Looper.getMainLooper()))
  }

  private inner class Callback : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>) {
      try {
        val read = configs.map { RecordingConfig(it.clientAudioSessionId, it.isClientSilenced) }
        rule.update(sessionId(), read)?.let { report(Input.MicSilenced(it)) }
      } catch (e: Exception) {
        line(RecordEntry("watch-failed", listOf("action" to "mic", "error" to e.javaClass.simpleName)))
      }
    }
  }
}
```

`sessionId` is `StreamerAdapter::audioSessionId` (Task 22's `AudioSessionIds`, the field `audioRecord`). When it returns null, the rule reads nothing. That is recorded, not left silent: `StreamerAdapter.noteMicSession` (Task 22) writes `watch-failed {action: "mic-session"}` once per session, at its first connect, when the id is null (N8). MicWatch itself holds no session state.

```kotlin
package com.seazn.capture.engine.watch

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.seazn.capture.engine.core.Input

/** The network pre-flight (AGENTS §6): the default network's VALIDATED capability. */
class NetworkWatch(private val context: Context, private val report: (Input) -> Unit) {
  @Volatile var reachable = false
    private set

  fun start() {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
    manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = changed(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))

      override fun onLost(network: Network) = changed(false)
    })
  }

  private fun changed(validated: Boolean) {
    if (validated == reachable) return
    reachable = validated
    report(Input.Network(validated))
  }
}
```

```kotlin
package com.seazn.capture.engine.watch

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager
import android.os.SystemClock
import com.seazn.capture.engine.adapter.ChargeDrain
import com.seazn.capture.engine.adapter.DeviceReadings
import com.seazn.capture.engine.adapter.RawDevice
import com.seazn.capture.engine.core.Input
import com.seazn.capture.engine.core.RecordEntry
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Thermal and battery every 10 s, on its own thread: binder calls never run on the scheduler thread (CD9). */
class DeviceSampler(
  private val context: Context,
  private val report: (Input) -> Unit,
  private val line: (RecordEntry) -> Unit,
) {
  private val io = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "capture-device") }

  @Volatile private var drain = ChargeDrain()

  /** N9: the first failure in the process is recorded; later ones are not, so a sampler that always fails cannot flood. */
  private var failureNoted = false

  fun start() {
    io.scheduleWithFixedDelay({ sample() }, 0, 10, TimeUnit.SECONDS)
  }

  /** A new drain at each accepted arm: drain is per session. */
  fun armed() {
    drain = ChargeDrain()
  }

  private fun sample() {
    try {
      report(Input.Device(DeviceReadings.sample(read(), drain)))
    } catch (e: Exception) {
      // A failed reading skips one sample; the next comes in 10 s. Never stops the executor.
      if (!failureNoted) {
        failureNoted = true
        line(RecordEntry("watch-failed", listOf("action" to "device", "error" to e.javaClass.simpleName)))
      }
    }
  }

  private fun read(): RawDevice {
    val power = context.getSystemService(PowerManager::class.java)
    val battery = context.getSystemService(BatteryManager::class.java)
    val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val raw = RawDevice(
      thermalStatus = power?.currentThermalStatus, // API 29; minSdk 31 (CD34)
      thermalHeadroom = power?.getThermalHeadroom(10), // API 30
      batteryPercent = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 },
      chargeUah = battery?.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)?.takeIf { it > 0 },
      plugged = sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)?.takeIf { it >= 0 }?.let { it != 0 },
    )
    drain.add(SystemClock.elapsedRealtime(), raw.chargeUah, raw.batteryPercent)
    return raw
  }
}
```

A skipped sample is recorded once per process, as `watch-failed {action: "device", error}` (N9): a sampler that fails every time, such as a `SecurityException` on one OEM, would otherwise leave thermal and battery silently empty for three hours. Later failures are not recorded, because at 10 s for three hours they would flood the record. `failureNoted` is touched only on the sampler's own thread. `DeviceReadings.sample` only reads `drain.pctPerHour()` (Task 9), so the `add` here is the one place a sample is counted.

- [ ] **Step 3: Wire them.** In `AndroidPlatform`, take `network: NetworkWatch` and `device: DeviceSampler`; `facts()` passes `networkReachable = network.reachable`, and `armed` calls `device.armed()` before `capture.prepare`. `EngineHost.build`, whole:

```kotlin
  private fun build(app: Context): Parts {
    Logger.logger = VendorLogger { level, fields -> parts?.core?.log(level, "vendor-log", fields) }
    TlsGuard.record = ::line
    TlsGuard.install(TlsGuard.MODE)
    val thread = HandlerThread("capture-engine").apply { start() }
    lateinit var core: BridgeCore
    val report: (Input) -> Unit = { core.report(it) }
    val cameras = CameraAvailability()
    val capture = StreamerAdapter(app, FrameTally(), AttemptSignals(), cameras, PeakMeter(), report, { core.failure(it) }, ::line)
    val network = NetworkWatch(app, report)
    val device = DeviceSampler(app, report, ::line)
    val platform = AndroidPlatform(app, capture, HttpAdapter(), RecordFile(File(app.filesDir, "record")), network, device, ::emit)
    core = BridgeCore.shared { BridgeCore(AndroidClock, HandlerScheduler(Handler(thread.looper)), platform, HttpAdapter::readBody) }
    core.start()
    CameraWatch(app, cameras, report, ::line).start()
    MicWatch(app, capture::audioSessionId, MicSilenceWatch(), report, ::line).start()
    network.start()
    device.start()
    return Parts(core, capture)
  }
```

The watchers start after `core.start()`, so their first reports are posted to a running engine.

- [ ] **Step 4: Build.** Run `assembleDebug` (EXIT=0) and the core suite.

- [ ] **Step 5: Make a device check** (the owner's hands). Read each on the screen, and record what it showed:
  - Toggle aeroplane mode: Diagnostics' network chip follows within seconds, and the record has the `Network` transitions.
  - Open another camera app while armed: the status line reads the camera-in-use line. Close it: the line clears.
  - Plug and unplug the charger: the not-charging caption follows, and Diagnostics' battery row changes.
  - Place a phone call to the handset while live: the status line reads the mic-silenced line; end the call: it clears. If nothing happens, read the record for `watch-failed {action: "mic-session"}` before calling it a defect.

- [ ] **Step 6: Commit** with the message `feat(engine): the first phone run; camera, microphone, network and device watchers`, and the trailer lines.

### Task 24: The foreground service, the wake lock, permissions, and the previous exit

AGENTS §9, carries 7 and 14, F-P5-3, CD10, CD16 (P3), CD21, CD22, CD34, M8, M9, N1, N2 and N10.

**Files:**

- Create in `G`: `CaptureForegroundService.kt`, `SessionKeeper.kt`, `Permissions.kt`, `ExitReader.kt`
- Create (pure, beside the core, N2): `core/src/main/kotlin/com/seazn/capture/engine/adapter/ArmTurns.kt`; test `core/src/test/kotlin/com/seazn/capture/engine/adapter/ArmTurnsTest.kt`
- Modify: `AndroidPlatform.kt` (`armed` goes through the keeper; `End` tells it; `snapshot` updates the notification; `facts()` reads its two facts), `EngineHost.kt` (`keeper`, and the previous exit at first build)

**Interfaces:**

- `ArmTurns`, with `armed(): Int`, `ended()` and `current(turn): Boolean` (N2);
- `SessionKeeper(context, permissions: Permissions, line: (RecordEntry) -> Unit, refused: (String, Scope) -> Unit, armFailed: (SessionConfig, Throwable) -> Unit)`, with `armed(config, then: () -> Unit)`, `ended()`, `fgsRefused(e)`, `notify(wire)`, `notification(): Notification`, and `@Volatile` `survivesBackground` and `permissionsRefused`;
- `Permissions(appContext: () -> AppContext?)`, with `request(onResult: (Grant) -> Unit)`, where `enum class Grant { GRANTED, REFUSED, UNAVAILABLE }`;
- `ExitReader.previousLoss(context): RecordEntry?`.

**The order is the fix for C3.** On Android 14+, a `camera|microphone` foreground service started before `CAMERA` and `RECORD_AUDIO` are granted throws `SecurityException` from `startForeground` (research §4). So the permissions come first, and the service starts only on a grant.

**`SessionKeeper`**, which runs its work on the main looper (M8: the marker write, the wake lock, the permission request and the service start are file IO and binder calls, which never run on the scheduler thread; the permission request wants the main thread anyway):

```kotlin
package com.seazn.capture.engine

import android.annotation.SuppressLint
import android.app.Notification
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.seazn.capture.engine.adapter.ArmTurns
import com.seazn.capture.engine.adapter.Scope
import com.seazn.capture.engine.core.RecordEntry
import com.seazn.capture.engine.core.SessionConfig
import java.io.File

/** CD10, CD16 and CD21: what keeps an armed session alive in the background, and who may start it. */
class SessionKeeper(
  private val context: Context,
  private val permissions: Permissions,
  private val line: (RecordEntry) -> Unit,
  private val refused: (String, Scope) -> Unit,
  private val armFailed: (SessionConfig, Throwable) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val marker = File(context.filesDir, MARKER)
  private val wakeLock = context.getSystemService(PowerManager::class.java)
    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "seazn:capture").apply { setReferenceCounted(false) }
  private val notes = CaptureNotification(context)
  private val turns = ArmTurns()

  /** CD16: optimistic from the accepted arm, so the keep-open caption never flashes; false once the start fails or the session ends. */
  @Volatile var survivesBackground = false
    private set

  /** CD21: kept after the end, so the Ended block can say it; cleared at the next arm. */
  @Volatile var permissionsRefused = false
    private set

  /** On the scheduler thread; returns at once. [then] builds the capture, once camera and microphone are granted. */
  fun armed(config: SessionConfig, then: () -> Unit) {
    survivesBackground = true
    permissionsRefused = false
    notes.language(config.language) // (P3)
    val turn = turns.armed()
    main.post { forArm(turn, config) { begin(turn, config, then) } }
  }

  /** On the scheduler thread, at `Command.End`. Closes the turn first, so an answer still on its way starts nothing (N2). */
  fun ended() {
    turns.ended()
    survivesBackground = false
    main.post { recordOnly("end") { finish() } }
  }

  /** The service could not go foreground (C3's catch): the session carries on, and says to keep the app open. */
  fun fgsRefused(e: Throwable) {
    survivesBackground = false
    line(RecordEntry("fgs-refused", listOf("error" to e.javaClass.simpleName)))
  }

  fun notify(wire: Map<String, Any?>) = notes.update(wire)

  fun notification(): Notification = notes.current()

  /** N1: a lost marker or wake lock costs a line, never the broadcast. */
  private fun begin(turn: Int, config: SessionConfig, then: () -> Unit) {
    recordOnly("marker") { marker.writeText("1") }
    recordOnly("wake-lock") { hold() }
    permissions.request { grant -> main.post { forArm(turn, config) { answered(turn, grant, then) } } }
  }

  @SuppressLint("WakelockTimeout") // CD10: held for the session, released at End, never on a timer
  private fun hold() {
    wakeLock.acquire()
    line(RecordEntry("wake-lock", listOf("state" to "held")))
  }

  /** N2: an answer for a turn that is no longer open (the session ended while the dialog was up) starts nothing. */
  private fun answered(turn: Int, grant: Grant, then: () -> Unit) {
    if (!turns.current(turn)) return line(RecordEntry("permissions-late", listOf("state" to grant.name.lowercase())))
    when (grant) {
      Grant.GRANTED -> {
        startService()
        then()
      }
      Grant.REFUSED -> {
        permissionsRefused = true
        survivesBackground = false
        refused("camera or microphone permission refused", Scope.SESSION)
      }
      Grant.UNAVAILABLE -> {
        survivesBackground = false
        refused("permission request unavailable", Scope.SESSION)
      }
    }
  }

  private fun startService() {
    try {
      ContextCompat.startForegroundService(context, Intent(context, CaptureForegroundService::class.java))
    } catch (e: IllegalStateException) { // ForegroundServiceStartNotAllowedException (API 31+)
      fgsRefused(e)
    } catch (e: SecurityException) {
      fgsRefused(e)
    }
  }

  private fun finish() {
    context.stopService(Intent(context, CaptureForegroundService::class.java))
    if (wakeLock.isHeld) {
      wakeLock.release()
      line(RecordEntry("wake-lock", listOf("state" to "released")))
    }
    marker.delete()
  }

  /**
   * N1: the arm path. A failure here (the permission request, the service start, or the capture build in
   * `then`) ends that session fatal-error and named through the core, never only a line: otherwise the
   * session would sit armed with no camera and the keep-open caption suppressed. A late failure (the turn
   * already closed) is still handed over: `BridgeCore.armFailed` records it and ends nothing (Task 12).
   */
  private fun forArm(turn: Int, config: SessionConfig, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      if (turns.current(turn)) survivesBackground = false
      line(RecordEntry("keeper-failed", listOf("action" to "arm", "error" to e.javaClass.simpleName)))
      armFailed(config, e)
    }
  }

  /** Teardown, the marker and the wake lock: recorded, and never allowed to stop the next step. */
  private fun recordOnly(action: String, block: () -> Unit) {
    try {
      block()
    } catch (e: Exception) {
      line(RecordEntry("keeper-failed", listOf("action" to action, "error" to e.javaClass.simpleName)))
    }
  }

  companion object {
    const val MARKER = "session.marker"
  }
}
```

A refusal ends the session fatal-error and named (CD21), with the wake lock and marker released by the `End` that follows, through `ended()`. **A failure on the arm path ends the session too (N1):** `forArm` hands it to `BridgeCore.armFailed`, so the session never sits armed with no camera, and `survivesBackground` drops so the caption is not suppressed meanwhile. The marker and the wake lock are each record-only: losing either costs a line, never the broadcast. **A late answer starts nothing (N2):** `ended()` closes the turn before the permission dialog can answer, so a grant that lands after the session ended (the descriptor check ending a stale code while the dialog is up, C3's fresh-install path) records `permissions-late` and neither starts the service nor builds a camera. `StreamerAdapter.build` also ends any streamer it still holds before replacing it (Task 22), so even a missed `End` cannot leave the camera taken. `UNAVAILABLE` (no activity to ask from, or another request in flight) is not "refused": it does not set `permissionsRefused`, so the Ended block never tells the operator to change a setting they never saw.

**`Permissions`**:

```kotlin
package com.seazn.capture.engine

import android.Manifest
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.AppContext

enum class Grant { GRANTED, REFUSED, UNAVAILABLE }

/** CD21: camera and microphone through Expo's permissions manager, on the current module's AppContext (CD32). */
class Permissions(private val appContext: () -> AppContext?) {
  fun request(onResult: (Grant) -> Unit) {
    val manager = appContext()?.permissions ?: return onResult(Grant.UNAVAILABLE)
    try {
      manager.askForPermissions({ answers ->
        val granted = NEEDED.all { answers[it]?.status == PermissionsStatus.GRANTED }
        onResult(if (granted) Grant.GRANTED else Grant.REFUSED)
      }, *(NEEDED + optional()))
    } catch (e: IllegalStateException) { // "Another permissions request is in progress", or no activity
      onResult(Grant.UNAVAILABLE)
    }
  }

  /** POST_NOTIFICATIONS is asked with them on API 33+, and blocks nothing: a refusal only hides the notification. API 31–32 allow notifications by default (CD34). */
  private fun optional(): Array<String> =
    if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()

  companion object {
    private val NEEDED = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
  }
}
```

`AppContext.permissions` is `Permissions?` (expo-modules-core 57 `AppContext.kt:215`), and `askForPermissions(PermissionsResponseListener, String...)` throws `IllegalStateException` when another request is in flight (`PermissionsService.kt:182`) or when there is no activity provider (`:94`).

**`CaptureNotification`** (in `SessionKeeper.kt`, beside the keeper), which holds no rule: `NotificationText.content` decides the words (Task 10).

```kotlin
/** The persistent notification (AGENTS §9): `LIVE · 3000k · 47 min`, in the operator's language (P3), else the phone's. */
class CaptureNotification(private val context: Context) {
  @Volatile private var lang = "en"
  @Volatile private var text = ""
  private var shownAtMs = 0L
  private var shownKind: Any? = null

  fun language(armLanguage: String) {
    lang = NotificationText.language(armLanguage, Locale.getDefault().language)
  }

  /** At most once every 5 s, or on a change of state word: notifications are rate-limited. Main looper. */
  fun update(wire: Map<String, Any?>) {
    val kind = (wire["state"] as? Map<*, *>)?.get("kind")
    val now = SystemClock.elapsedRealtime()
    text = NotificationText.content(wire, System.currentTimeMillis(), lang)
    if (kind == shownKind && now - shownAtMs < 5_000) return
    shownKind = kind
    shownAtMs = now
    NotificationManagerCompat.from(context).takeIf { it.areNotificationsEnabled() }?.notify(ID, current())
  }

  fun current(): Notification {
    channel()
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, CHANNEL_ID).setSmallIcon(R.drawable.slate).setContentText(text)
      .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(tap).build()
  }

  private fun channel() {
    val name = NotificationText.CHANNEL[lang] ?: NotificationText.CHANNEL.getValue("en")
    context.getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW))
  }

  companion object {
    const val ID = 7_301
    const val CHANNEL_ID = "capture"
  }
}
```

`AndroidPlatform.snapshot` calls `keeper.notify(wire)` on the main looper (`main.post`), and only while `survivesBackground` is true, so an idle phone posts nothing. The channel's name is fixed when it is first created (M18); `createNotificationChannel` with the same id later changes nothing but the name, which Android allows. Add the imports (`NotificationChannel`, `NotificationManager`, `PendingIntent`, `SystemClock`, `Locale`, `NotificationCompat`, `NotificationManagerCompat`, `NotificationText`). Channels exist on every supported API (26+; minSdk 31, CD34), so there is no version check.

**`CaptureForegroundService`** (the C3 catch):

```kotlin
package com.seazn.capture.engine

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.ServiceCompat

/** AGENTS §9: camera + microphone, started only after both are granted (CD16). START_NOT_STICKY: never restarted by the system. */
class CaptureForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val keeper = EngineHost.keeper(this)
    try {
      ServiceCompat.startForeground(this, CaptureNotification.ID, keeper.notification(), TYPES)
    } catch (e: RuntimeException) { // SecurityException, ForegroundServiceStartNotAllowedException
      keeper.fgsRefused(e)
      stopSelf() // N10: whether this itself raises "did not then call startForeground" is unproved (Task 26)
    }
    return START_NOT_STICKY
  }

  companion object {
    /** Both types exist from API 29 (CD34: minSdk 31), and API 34+ requires them to match the manifest. */
    private const val TYPES = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
  }
}
```

**`ExitReader`** (CD22):

```kotlin
package com.seazn.capture.engine

import android.app.ActivityManager
import android.content.Context
import com.seazn.capture.engine.adapter.PreviousExit
import com.seazn.capture.engine.core.RecordEntry
import java.io.File

/** F-P5-3: was the last session lost with its process? Read once, at the engine's first build. */
object ExitReader {
  fun previousLoss(context: Context): RecordEntry? {
    val marker = File(context.filesDir, SessionKeeper.MARKER)
    val present = marker.exists()
    // API 30; minSdk 31 (CD34).
    val info = context.getSystemService(ActivityManager::class.java)?.getHistoricalProcessExitReasons(context.packageName, 0, 1)?.firstOrNull()
    marker.delete()
    return PreviousExit.entry(present, info?.reason, info?.timestamp)
  }
}
```

Before using the ints, check that `PreviousExit`'s word table matches `android.jar`:

```bash
javap -constants -cp "$ANDROID_HOME/platforms/android-36/android.jar" android.app.ApplicationExitInfo | grep 'REASON_'
```

Record the output in the commit body. A difference changes `PreviousExit`'s table and test, never the glue.

**`ArmTurns`** (N2), pure, beside the core, so the keeper's one rule is JVM-tested. Its test first:

```kotlin
package com.seazn.capture.engine.adapter

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ArmTurnsTest {
  @Test
  fun `N2 an answer for the open arm is current`() {
    val turns = ArmTurns()
    assertTrue(turns.current(turns.armed()))
  }

  @Test
  fun `N2 an answer after the session ended is late, and starts nothing`() {
    val turns = ArmTurns()
    val first = turns.armed()
    turns.ended()
    assertFalse(turns.current(first))
  }

  @Test
  fun `N2 an answer for an earlier arm is late once another arm is open`() {
    val turns = ArmTurns()
    val first = turns.armed()
    turns.ended()
    val second = turns.armed()
    assertFalse(turns.current(first))
    assertTrue(turns.current(second))
  }

  @Test
  fun `nothing armed, nothing current`() {
    assertFalse(ArmTurns().current(0))
  }
}
```

```kotlin
package com.seazn.capture.engine.adapter

/**
 * N2: which arm a late answer belongs to. The keeper takes a turn at each accepted arm and closes it at
 * the end. An answer for a turn that is not the open one starts nothing. Two threads: the scheduler
 * thread arms and ends, the main looper asks.
 */
class ArmTurns {
  private var turn = 0
  private var open = false

  @Synchronized
  fun armed(): Int {
    turn += 1
    open = true
    return turn
  }

  @Synchronized
  fun ended() {
    open = false
  }

  @Synchronized
  fun current(turn: Int): Boolean = open && turn == this.turn
}
```

Run `cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*ArmTurnsTest'` before writing the class (compile failure), then after (green). Mutate one at a time: drop `open &&`, and the "after the session ended" test fails; drop `turn == this.turn`, and the "earlier arm" test fails. Each guard is killed by its own test.

- [ ] **Step 1: Write the four files**, and wire them. `AndroidPlatform` takes `keeper: SessionKeeper`:
  - `armed(config)` is `device.armed(); val rotation = EncoderKeys.rotationAtArm(displayRotation()); keeper.armed(config) { capture.prepare(config, rotation) }`. The rotation is read at the accepted arm, before the permission dialog, as P4 requires;
  - `execute(command)` calls `keeper.ended()` for `Command.End`, then `capture.execute(command)`;
  - `snapshot(wire)` also posts `keeper.notify(wire)` to the main looper while `keeper.survivesBackground`;
  - `facts()` passes `survivesBackground = keeper.survivesBackground` and `permissionsRefused = keeper.permissionsRefused`.

  `EngineHost` gains `fun keeper(context: Context): SessionKeeper = parts(context).keeper`, with `keeper` added to `Parts`. Its `build`, whole and final:

```kotlin
  private fun build(app: Context): Parts {
    Logger.logger = VendorLogger { level, fields -> parts?.core?.log(level, "vendor-log", fields) }
    TlsGuard.record = ::line
    TlsGuard.install(TlsGuard.MODE)
    val thread = HandlerThread("capture-engine").apply { start() }
    lateinit var core: BridgeCore
    val report: (Input) -> Unit = { core.report(it) }
    val cameras = CameraAvailability()
    val capture = StreamerAdapter(app, FrameTally(), AttemptSignals(), cameras, PeakMeter(), report, { core.failure(it) }, ::line)
    val network = NetworkWatch(app, report)
    val device = DeviceSampler(app, report, ::line)
    // CD32, I2: the AppContext is read at request time, so a JS reload's new module is the one asked.
    val keeper = SessionKeeper(app, Permissions { appContext.value }, ::line, { message, scope -> core.refused(message, scope) }) { config, t -> core.armFailed(config, t) }
    val platform = AndroidPlatform(app, capture, HttpAdapter(), RecordFile(File(app.filesDir, "record")), network, device, keeper, ::emit)
    core = BridgeCore.shared { BridgeCore(AndroidClock, HandlerScheduler(Handler(thread.looper)), platform, HttpAdapter::readBody) }
    core.start()
    ExitReader.previousLoss(app)?.let { core.log("warn", it.kind, it.fields.toMap()) }
    CameraWatch(app, cameras, report, ::line).start()
    MicWatch(app, capture::audioSessionId, MicSilenceWatch(), report, ::line).start()
    network.start()
    device.start()
    return Parts(core, capture, keeper)
  }
```

`build` is now 22 lines, inside AGENTS §12's bound; if a later change pushes it past 25, move the watchers' four lines into a `startWatchers` function.

- [ ] **Step 2: Build and check the merged manifest** (Task 20, Step 7). Run `assembleDebug` (EXIT=0) and the core suite.

- [ ] **Step 3: Make the device checks** (the owner's hands). Each names what to read:
  - **Fresh install on Android 14+ (C3).** `adb uninstall com.seazn.capture`, install, scan, and grant both permissions when asked. Expected: no crash; `adb shell dumpsys activity services com.seazn.capture | grep -c 'isForeground=true'` prints 1 while armed; the record has no `fgs-refused`. Repeat with the camera **refused**: the session ends with the permissions line (`stream.ended.permissions`), the code is kept, and `dumpsys` shows no service.
  - **The arm's AppState cycle (M9).** The permission dialog takes the activity to the background and back. Expected: the viewfinder stays on the armed session, the hold is not left half-filled, and the reopen gate does not navigate away. Record what the screen showed.
  - **The notification (CD16, P3).** Armed with the app in French: the shade reads `PRÊT`. Go live: within 5 s it reads `EN DIRECT · 1500k · 0 min`. Android's app notification settings list the channel as "Diffusion en direct".
  - **The wake lock (CD10, carry 14).** Lock the screen for 5 minutes while live, then unlock. Expected: still publishing, and the record has **no `tick-late` line** (CD33 writes one for any tick gap over 1000 ms). One `tick-late` is a finding: record its `gapMs`.
  - **The previous exit (CD22).** While live, stop the app from Android's **Task Manager** (Settings → Apps → Seazn Capture → Force stop, or the notification shade's active-apps list on Android 13+), then reopen it. Expected: the record's first lines include `previous-session-lost` with `exit` `user-requested` (Android 11+). Then, separately, swipe the app from Recents while live, and **record what happens**: whether the process survives (the foreground service usually keeps it), and what `exit` the next launch reads. Do not assume either.
  - **A grant after the session ended (N2).** Use a code whose descriptor check fails (an ended stg session's code, held by the owner), on a fresh install so the dialog shows: scan, wait for the Ended screen behind the dialog, then grant. Expected: `adb shell dumpsys activity services com.seazn.capture | grep -c 'isForeground=true'` prints 0, the record has `permissions-late` and no `wake-lock {state: held}` after the `ended` line, and another camera app opens the camera at once (it is free).
  - Then the owner deletes the recordings.

- [ ] **Step 4: Commit** with the message `feat(engine): foreground service after permissions, wake lock, and the previous exit`, and the trailer lines. Stage `ArmTurns.kt` and `ArmTurnsTest.kt` by path with the glue, and give the core suite's raw count (it rises by 4).

### Task 25: The native preview, and the viewfinder's own boundary

Carry 9, owner ruling 2 (2026-10-01), CD19 (copy accepted, P2), CD27, CD33, research Open 11, #288, I4 and I5.

**Files:**

- Create in `G`: `CapturePreviewView.kt`
- Modify: `CaptureEngineModule.kt` (`View(CapturePreviewView::class) {}`)
- Modify: `src/services/native/nativeSurfaces.tsx` (`NativePreview` renders the native view when the module is present, and an empty `View` otherwise)
- Create: `src/ui/components/PreviewBoundary.tsx`, `src/ui/components/PreviewBoundary.test.tsx`
- Modify: `src/ui/components/StreamStage.tsx` (wraps `<Preview />` only)
- Modify: `test/fakeSurfaces.ts` (`crashPreview()` and `restorePreview()`, beside `crashOverlay()`)
- Modify: `modules/capture-engine/src/nativeCaptureEngine.ts` (the dev-only `pauseReports(ms)`), `src/ui/components/DevScenes.tsx` (two dev buttons), the four dictionaries (two dev keys)

**Interfaces:**

- `PreviewBoundary({ children })`. Its fallback is the caption plus a Show preview ghost button. The button bumps a `generation` used as the **`ErrorBoundary`'s own `key`** (I4): `ErrorBoundary` returns its `fallback` for as long as it holds an error (`ErrorBoundary.tsx:58-62`), so only a new boundary instance clears it. Each catch logs `preview.crashed` with `{ count }`.
- `FakeSurfaces.crashPreview()` makes `Preview` throw on every render until `restorePreview()`.
- `NativeCaptureEngine.pauseReports(ms: number): void`, dev only: snapshots are ignored for `ms`, so CD17's silence can be seen on a phone.
- `CapturePreviewView(context, appContext) : ExpoView`, with `shouldUseAndroidLayout = true`.

- [ ] **Step 1: The fake.** In `test/fakeSurfaces.ts`, add `crashPreview` and `restorePreview` to `FakeSurfaces`, a `previewCrashing` flag, and `if (previewCrashing) throw new Error('preview crashed');` at the top of `Preview`, as `Overlay` does for `crashOverlay`.

- [ ] **Step 2: Write the failing boundary tests**, in `PreviewBoundary.test.tsx`, over the house helper `test/renderViewfinder.tsx` (as `StreamScreen.onAir.test.tsx:273` does for the overlay). Each spies on `console.error` locally, as `ErrorBoundary.test.tsx:22` does: `test/setup-ui.ts` does not silence React's error log.

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { readRecord } from '../../../test/fakePorts';
import { renderViewfinder } from '../../../test/renderViewfinder';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errors.mockRestore());

const live = (lang?: 'es' | 'fr' | 'nl') =>
  renderViewfinder(lang ? { deviceLanguages: [lang] } : {}, {
    prepare: (fakes) => {
      fakes.engine.scene('live');
      fakes.surfaces.crashPreview();
    },
  });

it('CD19 a preview crash shows the caption and keeps the column: plate, line and Stop', async () => {
  const view = await live();
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(screen.getByTestId('tally-plate')).toBeTruthy();
  expect(screen.getByRole('button', { name: en['stream.action.stop'] })).toBeTruthy();
  expect(screen.queryByText('Something broke')).toBeNull();
  expect(readRecord(view.record)).toContainEqual(
    expect.objectContaining({ event: 'preview.crashed', fields: { count: 1 } }),
  );
});

it('I4 Show preview brings the preview back; a second crash shows the caption again, counted', async () => {
  const view = await live();
  act(() => view.surfaces.restorePreview());
  fireEvent.click(screen.getByText(en['stream.preview.show']));
  expect(screen.getByTestId('preview')).toBeTruthy();
  expect(screen.queryByText(en['stream.preview.stopped'])).toBeNull();
  act(() => view.surfaces.crashPreview());
  act(() => view.engine.scene('live')); // any re-render reaches the throwing preview
  expect(screen.getByText(en['stream.preview.stopped'])).toBeTruthy();
  expect(readRecord(view.record)).toContainEqual(
    expect.objectContaining({ event: 'preview.crashed', fields: { count: 2 } }),
  );
});

it.each([
  ['es', es],
  ['fr', fr],
  ['nl', nl],
] as const)('the caption and the button read in %s', async (lang, dictionary) => {
  await live(lang);
  expect(screen.getByText(dictionary['stream.preview.stopped'])).toBeTruthy();
  expect(screen.getByText(dictionary['stream.preview.show'])).toBeTruthy();
});
```

The language comes from `deviceLanguages`: `createFakePorts(overrides: Partial<Ports> & { kvSeed? })` spreads the overrides over its defaults (`test/fakePorts.ts:59-99`, `['en']` by default), and no language is saved, so the provider picks the phone's. Press the `GhostButton` the way the existing tests do (`fireEvent.click` or the `press` helper). The tally plate's test id and the Stop button's role are what `StreamScreen.onAir.test.tsx` already finds. If a re-render through `engine.scene('live')` does not reach `Preview` (memoised), drive one through the fake's next report instead, and say which in the test's comment.

- [ ] **Step 3: Run them.** Expected: they fail, because the crash currently reaches the root boundary.

- [ ] **Step 4: Implement `PreviewBoundary`.**

```tsx
import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePorts } from '@/hooks/usePorts';
import { useT } from '@/hooks/useLanguage';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';

/**
 * The viewfinder's own boundary (owner ruling 2, CD19): a preview crash leaves the column, its
 * plate and the Stop hold standing. The key is on the boundary itself (I4): it keeps its fallback
 * while it holds an error, so Show preview mounts a new one.
 */
export const PreviewBoundary = memo(function PreviewBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const t = useT();
  const { logger } = usePorts();
  const [generation, setGeneration] = useState(0);
  const crashes = useRef(0);
  const onCatch = useCallback(() => {
    crashes.current += 1;
    logger.warn('preview.crashed', { count: crashes.current });
  }, [logger]);
  const show = useCallback(() => setGeneration((n) => n + 1), []);
  const fallback = (
    <View style={styles.fallback}>
      <Text variant="status" style={styles.caption}>
        {t('stream.preview.stopped')}
      </Text>
      <GhostButton label={t('stream.preview.show')} onPress={show} />
    </View>
  );
  return (
    <ErrorBoundary key={generation} label="preview" onCatch={onCatch} fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
});

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  caption: { color: colour.caution },
});
```

Import `colour` from `@/ui/theme/tokens` (`caution` is `#fb923c`, AGENTS §5). `Text` takes `variant` and a style; `GhostButton` takes `label` and `onPress`. Use a spacing token for `gap` if the theme has one. `count` is a plain number (CD6). The fallback is the stage's middle, which is the preview's own area: a caption there covers nothing the operator frames, because there is no picture. `StreamStage` wraps `<Preview />` in it, and nothing else on the stage. The overlay keeps its own boundary (AGENTS §7).

- [ ] **Step 5: Implement the native view** (I5: collect while attached, unbind on a null streamer, never crash the app).

```kotlin
package com.seazn.capture.engine

import android.content.Context
import com.seazn.capture.engine.core.RecordEntry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.thibaultbee.streampack.ui.views.PreviewView
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The full-bleed native preview (AGENTS §6, carry 9). Frames never cross the bridge. FIT, so the
 * operator frames exactly what is encoded (#288). No pinch-zoom or tap-to-focus: a tap on a tripod
 * is a mis-tap. It follows the session's streamer while attached, and only then: a screen pushed
 * over the viewfinder may detach it and attach it again without a rebuild.
 */
class CapturePreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val failed = CoroutineExceptionHandler { _, t ->
    EngineHost.line(RecordEntry("preview-failed", listOf("error" to t.javaClass.simpleName)))
  }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main + failed)
  private var following: Job? = null
  private val preview = PreviewView(context).apply {
    scaleMode = PreviewView.ScaleMode.FIT
    enableZoomOnPinch = false
    enableTapToFocus = false
  }

  init {
    addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    following?.cancel()
    following = scope.launch {
      EngineHost.capture(context).streamer.collect { streamer -> preview.setVideoSourceProvider(streamer) }
    }
  }

  override fun onDetachedFromWindow() {
    following?.cancel()
    following = null
    super.onDetachedFromWindow()
  }
}
```

`setVideoSourceProvider(newStreamer: IWithVideoSource? = null)` is a suspend function (`PreviewView.kt:242`), so a null streamer unbinds. A throw there is recorded as `preview-failed` and goes no further: a native crash is beyond the JS boundary's reach. In `nativeSurfaces.tsx`, `NativePreview` is `requireNativeView('CaptureEngine')`, behind the same optional-module check plan A's lazy surfaces use, so the web and jsdom builds still render an empty stage.

- [ ] **Step 6: The dev controls (C7 owns these files).** In `nativeCaptureEngine.ts`, `pauseReports(ms)` sets a `pausedUntil` that the `onSnapshot` listener checks; it is on `NativeCaptureEngine` only, which a release build reaches only through `ports.nativeEngine` in a dev build. Add a test in `nativeCaptureEngine.test.ts`: after `pauseReports(5_000)`, an emitted snapshot does not notify, and after 5 s one does (fake timers). In `PreviewBoundary.tsx`, the dev crash, rendered beside `{children}` inside the boundary only when `__DEV__`:

```tsx
const devCrash = { armed: false, listeners: new Set<() => void>() };

/** Dev only: the boundary's next render throws, as a native preview crash would reach it. */
export function crashPreviewOnce(): void {
  devCrash.armed = true;
  devCrash.listeners.forEach((listener) => listener());
}

function DevCrash(): null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    devCrash.listeners.add(bump);
    return () => {
      devCrash.listeners.delete(bump);
    };
  }, []);
  if (!devCrash.armed) return null;
  devCrash.armed = false;
  throw new Error('dev preview crash');
}
```

In `DevScenes.tsx`, beside the probe, two `__DEV__`-only `GhostButton`s: **Crash preview** (`stream.dev.crashPreview`), which calls `crashPreviewOnce()`, and **Pause engine reports** (`stream.dev.pauseReports`), which calls `ports.nativeEngine?.pauseReports(5_000)` and is hidden when `nativeEngine` is null. Add a jsdom test: with `__DEV__` true, `crashPreviewOnce()` shows the caption. Their copy, reviewed against the glossary as the batch C5 intro says, and committed with no `_review` marker:

| Key                       | en                   | es                        | fr                               | nl                        |
| ------------------------- | -------------------- | ------------------------- | -------------------------------- | ------------------------- |
| `stream.dev.crashPreview` | Crash preview        | Romper vista previa       | Planter l'aperçu                 | Voorbeeld laten crashen   |
| `stream.dev.pauseReports` | Pause engine reports | Pausar informes del motor | Suspendre les rapports du moteur | Engine-meldingen pauzeren |

They use the glossary's preview (vista previa, aperçu, voorbeeld) and the **engine** row Task 18 added. Dev keys have no budget.

- [ ] **Step 7: Run, mutate, build, and make the device checks.** Run `pnpm check` and `pnpm i18n:release-check`. Mutate one at a time:
  1. Put `key={generation}` on the children instead of the `ErrorBoundary`. The I4 test fails: the caption stays (the review's finding, now pinned).
  2. Drop `crashes.current += 1`. The count assertion fails.

  Then `assembleDebug`, install, and the owner's hands. Read each, and record what the screen showed:
  - Armed, the preview shows the camera full-bleed with letterbox bars (FIT).
  - **The Settings round trip (I5).** Armed, open Settings, come back: the preview shows. Then End, scan again and re-arm: the preview shows the new session.
  - **The resize (Open 11, CD33).** Live, pull down the notification shade so the view resizes, and push it back. Expected: the record has **no `frames-gap` line** (CD33 writes one for any video stall over 500 ms while publishing). One `frames-gap` is a finding: record its `gapMs`.
  - **The boundary (CD19).** Tap **Crash preview**: the caption shows, the plate and Stop are still there, and Show preview brings the picture back. Tap it twice: the record has `preview.crashed` with `count` 1, then 2.
  - **Silence on a phone (CD17).** Live, tap **Pause engine reports**: within 3 s the plate reads TROUBLE and the line reads the silent line; after 5 s it reads LIVE again.

- [ ] **Step 8: Commit** with the message `feat(stream): the native preview, with a boundary of its own`, and the trailer lines.

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

**The checklist.** Android 12+ only (CD34, the owner's ruling of 2026-10-01): the Redmi Note 7 Pro (Android 10) is no longer supported. The handset is the **OnePlus NE2211** (Android 14+). **The second geometry** is the same OnePlus under a display override: record the physical values first with `adb shell wm size` and `adb shell wm density`, then set `adb shell wm size 720x1600` and `adb shell wm density 320` (360 dp wide, the narrowest common Android width), run the steps marked _both geometries_, and **reset afterwards** with `adb shell wm size reset` and `adb shell wm density reset`, confirmed by `wm size` printing only the physical size. **Owner step, optional:** an Android 12 or 13 phone, if the owner has one, for the API 31–33 paths and a second SoC and OEM. Both orientations the mode allows, and en and fr where the copy changed. Crop screenshots to the app, and delete anything personal.

- [ ] **The contract on the phone.** Dev build, Diagnostics → Run engine contract: eight `probe.pass`, no `probe.fail` (carry 1). The probe settles on each intent's ack (CD8).
- [ ] **A fresh install on Android 14+ (C3).** On the OnePlus: `adb uninstall com.seazn.capture`, install the release build, scan, grant both permissions. Expected: no crash, `adb shell dumpsys activity services com.seazn.capture | grep -c 'isForeground=true'` prints 1 while armed, and the record has no `fgs-refused`. Then uninstall, install, and **refuse** the camera: the permissions line shows, the code is kept, and `dumpsys` lists no service.
- [ ] **P4, three independent assertions** for each landscape side, each read with its own tool, so they fail separately:
  1. **the preview is upright:** a screenshot of the viewfinder, cropped to the app;
  2. **the encoded picture is upright:** download the stg recording, grab one frame with `ffmpeg -ss 5 -i rec.mp4 -frames:v 1 frame.png`, and open it (`ffprobe` cannot see uprightness);
  3. **the rotation metadata is absent or 0:** `ffprobe -v error -show_streams -show_entries stream_side_data=rotation rec.mp4`, and the stream's `width` is greater than its `height`.
- [ ] **B-frames off (M12)** on the OnePlus, and on the Android 12/13 phone's SoC if there is one: `ffprobe -v error -select_streams v -show_frames -show_entries frame=pict_type -of csv rec.mp4 | grep -c ',B'` prints 0, and `-show_streams` gives `has_b_frames=0`.
- [ ] **F-P5-11:** throttle the laptop hotspot to 1.5 Mbit/s. The SRT `msSndBuf` stays bounded and the egress follows the target. Record the encoder's frame rate under paced `send` (#302).
- [ ] **srtdroid 1.10.1:** 10 minutes on air over SRT to Cloudflare, with one forced reconnect (aeroplane mode for 5 s). The stg player shows the stream after the reconnect.
- [ ] **F-P5-12:** 10 RTMPS cuts (aeroplane mode for 3 s each) with `MODE = SCOPED`. If any crashes, switch to `GLOBAL` and repeat. Then mutate the guard to swallow nothing, and see the crash return at least once. Record which mode shipped.
- [ ] **The foreground service on Android 14 and 16** (or the newest the owner has): no `SecurityException` at arm (`adb logcat -d | grep -c SecurityException` is 0 for the app's pid), and the notification text in the operator's language (P3). On an Android 12 phone (API 31–32), if the owner has one: no notification prompt at arm, and the notification shows (CD34); on API 33+, the prompt shows with the camera and microphone ones.
- [ ] **Wake lock (CD10, CD33):** the screen locked for 5 minutes on air, on the OnePlus (and the Android 12/13 phone if there is one). Expected: the record holds **no `tick-late` line**; any one is recorded with its `gapMs`.
- [ ] **The previous exit (CD22):** a Task Manager stop while live, then reopen: `previous-session-lost {exit: user-requested}`. Then a swipe from Recents while live: record whether the process survived and what the next launch read. A swipe is not assumed to be `user-requested`.
- [ ] **The audio floor (AGENTS §10, T1), on the OnePlus (and the Android 12/13 phone if there is one):** armed, the microphone covered or the room silent: Go live stays disabled and the sound chip reads not ready. A voice at arm's length: Go live enables. Assert the level floor, never the stream's presence.
- [ ] **A JS reload while live (Review Focus 2, CD32):** dev build, live, then reload from the dev menu. Expected: the viewfinder comes back on air without a re-arm, snapshots arrive (the plate stays LIVE past 3 s), and Diagnostics shows the lines from before the reload. Then stop, scan again, and arm: the permission flow (if asked) and the arm work on the new instance.
- [ ] **Carry 22:** take a phone call while live. Record the order of `mic-silenced`, `degraded` and the call's end, and what the audio is at hang-up (stg player).
- [ ] **Carry 24:** another app takes the camera with no slate frames. Measure how long Degraded reads, and the switch-camera time (dev only).
- [ ] **Carry 25:** read the record of an uplink drop reported after the 3 s stall window. Confirm it never counted toward fallback (N4).
- [ ] **Carry 26:** keep this run's session records, whose delivery lines carry the delivered lag. Plan D measures the 20 s-per-60 s rule from them at the staging match (deferred, as traced).
- [ ] **Carry 20:** record the 204s seen on the raw input before first frame, and the playlist variants Cloudflare served. Hint 0.1 against one variant is plan D's, with the real descriptor.
- [ ] **#306:** RSS (`adb shell dumpsys meminfo <pkg>`) after 20 forced reconnects. Compare per reconnect and per session.
- [ ] **Open 11 (CD33):** a preview resize while live (the shade pulled down and back, and a Settings round trip): the record holds **no `frames-gap` line**; any one is recorded with its `gapMs`.
- [ ] **The capture clock (carry 5):** every attempt's `capture-clock {lagMs}` is between 0 and a few hundred, never negative and never in the thousands.
- [ ] **Battery drain** on the OnePlus, and on the Android 12/13 phone (a second OEM) if there is one: `drainPctPerHour` after 30 minutes live. Compare with a reading from the Settings battery screen.
- [ ] **The Kotlin window:** record `./gradlew --version` and the Kotlin plugin version the build used; confirm that no 2.3+ metadata error appeared.
- [ ] **What the operator sees**, in both geometries, en and fr:
  - the silence line, using the dev menu's "Pause engine reports" (Task 25, Step 6);
  - the permissions line, the preview boundary, every plate colour, and the notification.
- [ ] **The copy-fit check (plan A's results, the three-line check), extended with this plan's lines:** under the narrow `wm size` override, in fr (the longest), read `stream.status.engineSilent` (48 characters, at its budget), `stream.advisory.keepOpen` (56) in the top strip (forced with the fake engine's scene in a dev build), `stream.preview.stopped` and `stream.preview.show` on the stage, and `stream.ended.permissions` in the Ended block. Each is whole: no clipped word, and the status line within its three lines.

  The keep-open caption shows only on a real refusal of the service's start, which cannot be forced on a stock phone. It is proved in jsdom, and listed as **unproved on a device** unless one occurs.

- [ ] **A grant after the session ended (N2):** Task 24 Step 3's check, on the release build: no service, `permissions-late` in the record, and the camera free.
- [ ] **`stopSelf()` after a refused `startForeground` (N10):** listed as **unproved**. AOSP may bring down a service still owing `startForeground` with "did not then call startForeground"; a stock phone cannot be made to refuse the start, so this is recorded as unverified unless a refusal occurs during the run, in which case the logcat and the record are kept.
- [ ] **The geometry overrides are reset:** `adb shell wm size` and `adb shell wm density` print only the physical values recorded at the start.

- [ ] **Step 1: Write the results document** with each tick and its evidence. Every claim names the handset, build and screenshot, and says which claims are device-only. Include:
  - the **owner's rulings of 2026-10-01** (P1, P2, P3, Android 12+, the execution method, the versions), each with where it was built and what the device showed for it;
  - the owner-visible decisions CD7 (the line format), CD17, CD18, CD19 and CD21, with their copy in four languages;
  - deviations, each with its reason.

- [ ] **Step 2: Write the plan D section,** _Prerequisites left for plan D_:
  - the real descriptor and heartbeat endpoints on the web side;
  - vendoring `contracts/capture-qr.v1.json`, with the drift job against the main repo's copy (spec §6);
  - the staging match: the spec's exit bar, carry 26's lag rule measured, and carry 20's hint and window;
  - recording deletion as a step of every run;
  - whatever this run left red, with its reason.

- [ ] **Step 3: Verify and commit.** Run `pnpm prettier --check docs/specs/2026-10-0x-s1-plan-c-results.md`. Then commit with the message `docs(s1): plan C device gate and results`, and the trailer lines. No screenshot holding a code, token, key or face is ever committed. Screenshots stay in the gitignored `.s0/`-style local folder the owner names.

## The four questions (AGENTS §10)

| Question                                  | Where this plan answers it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A second call**                         | One poller per attempt (Task 7); one drop and one connect per attempt (Task 11); a second arm ignored, and `armed` noticed once per session by identity (Task 12, CD31); one engine per process (Task 12); a second module instance after a JS reload, whichever of `OnCreate` and `OnDestroy` runs first (Task 12's `OwnedSlot`, CD32); an absent engine armed while ended (Task 15, M5); a clearing under way drops a second call (Task 17); stop and arm unsettled, settled by ack (Task 16); Show preview pressed twice, counted (Task 25); a second permission request in flight is `UNAVAILABLE`, not refused (Task 24); a permission answer that lands after its session ended starts nothing (Task 24, `ArmTurns`, N2); a build that finds a streamer still held ends it first (Task 22, N2); a late arm-step failure ends no newer session (Task 12, `armFailed`, N1) |
| **An empty input**                        | An empty arm refused by name (Task 4); no native module gives the absent engine (Tasks 15, 19); a malformed snapshot is kept out (Task 14); an unparseable descriptor pinned unnamed by sid (Task 14, M4); no descriptor URL (Task 12); no PCM, no charge counter, NaN headroom (Task 9); a permission refused, or no activity to ask from (Tasks 12, 24); free text logged before anything is protected, and between one session and the next (Task 3, I12, N7); a mic session id that cannot be read, recorded once per session (Task 22, N8); a device read that always fails, recorded once (Task 23, N9); no glue files yet, reported skipped, never a vacuous pass (Task 11); no language in the arm (Tasks 10, 14, P3); no ack (Tasks 16, 19: a 5 s guard)                                                                                                              |
| **After an interruption**                 | JS restarting under a live native (Tasks 12, 15, 26); a permanent failure mid-session, or thrown by `armed` itself (Tasks 6, 12); a failure on the keeper's arm path on the main looper (Tasks 12, 24, N1); the session ending while the permission dialog is up (Task 24, N2); a stop never answered (Task 17); deep sleep, recorded as `tick-late` (Tasks 9, 12, 24, 26); a video stall, recorded as `frames-gap` (Tasks 9, 12, 25, 26); the process lost mid-match (Tasks 9, 24); the permission dialog's AppState cycle (Task 24, M9); a preview crash, and the preview detached and attached again (Task 25); a vendor log during a cut (Task 20, CD30)                                                                                                                                                                                                                   |
| **Another mode, orientation or language** | Either landscape side fixed at arm (Tasks 11, 22, 26); four languages for every new line, reviewed against the glossary (Tasks 18, 25), for the notification and its channel (Tasks 10, 24, P3), and for the crash screen (Task 19, P1); nl buttons in the infinitive (C5 table, N5); the copy-fit check in fr under the narrow `wm size` override (Task 26); Scoring and Dashboard never touch the engine, and S2–S4 own them                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Self-review

Re-run after the 2026-10-01 re-review's fixes and the owner's rulings of the same day.

**Spec coverage.** Spec §3 lists the platform's pieces. Each maps to a task:

| Spec §3 item                                                   | Task                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| StreamPack, max B-frames 0                                     | 11 (rule), 22 (glue), 26 (`pict_type=B` count)                                                     |
| No `setTargetRotation`; orientation fixed at arm               | 11 (rule + `GlueRulesTest`), 20 (`displayRotation` at arm), 22, 26 (P4 ×3, each with its own tool) |
| Ktor guard, proven by cuts against Cloudflare                  | 11, 21, 26                                                                                         |
| Foreground service, wake lock, heartbeat                       | 24 (permissions, then the service; the lock); 8, 12, 20 (heartbeat HTTP)                           |
| MicSilence                                                     | 10, 22 (`AudioSessionIds`), 23, 26                                                                 |
| Camera contention and reopen                                   | 10, 22, 23, 26                                                                                     |
| SlateSource: the card, no words, silent audio                  | 22 (with `SlateColoursTest`)                                                                       |
| HTTP playlist and heartbeat clients                            | 8, 12, 20                                                                                          |
| Battery charge counter; thermal with headroom                  | 9, 23, 26                                                                                          |
| Bridge: intents void, snapshot ≥ 1 Hz, native preview          | 12, 13 (ack), 14, 15, 20, 25                                                                       |
| §6 CI: the Android compile job; the bridge contract            | 20; 16 (its own workflow)                                                                          |
| §6 device checks                                               | 23 Step 1, 24, 25, 26                                                                              |
| §7 phase 4: raw stg input, hand-made v2 code, local descriptor | 19 (CD24), 23 Step 1, 26                                                                           |

Owner ruling 1 (the crash copy) and ruling 2 (the viewfinder boundary) are recorded in Task 1 and built in Task 25. All 28 carries are traced (the carry table): 25 are fully mapped, 20 and 26 are partly deferred to plan D for the staging match, with their reasons, and 23 is closed by the owner's minSdk ruling (CD34). iOS is out of scope (CD1) and gets the absent engine. The owner's rulings of 2026-10-01 are each built where _Owner rulings of 2026-10-01_ says: P1 in Task 19, P2 in Tasks 18 and 25, P3 in Tasks 2, 4, 10, 14 and 24, Android 12+ in Tasks 10, 11, 20, 22, 23, 24 and 26 (no `SDK_INT` check below 31 is left: `grep -n 'SDK_INT' ` on this plan finds only `Permissions`' `>= 33`), the execution method in _Dispatch batches_, and the versions in CD35 and Task 21. No "PROPOSED" or "awaiting owner" marker is left.

**Placeholder scan.** A search of this file for `TBD`, `TODO`, `fill in`, `similar to Task` and `implement later` finds none. Every Android glue step is now code (I7): Tasks 20–25 each show their classes, and `EngineHost.build` is shown whole at each change. Five places name a value this plan cannot know before the implementer reads a jar or a file, and each says exactly how to read it, and that a mismatch changes the call, never the rule:

- komuxer's Maven coordinates (Task 20, Step 1);
- `KEY_MAX_B_FRAMES`' constant and `ApplicationExitInfo`'s `REASON_` ints (`javap`, Tasks 22 and 24);
- the merged manifest's path, if AGP 8.12 writes it elsewhere than Task 20 names (Task 20, Step 7).

srtdroid 1.10.1 is no longer among them: every call Task 21 makes was read from its jar (CD35).

- StreamPack's `AudioConfig`/`VideoConfig` alias names (Task 22);
- `test/fixtures/wire.ts`'s descriptor JSON (Task 5, Step 1).

**Type consistency.** These names are spelled the same in every task that uses them:

- `SessionName(sid, slot, tokenTag, descriptorJson)`; `Phase.Ended.sessionName` (Tasks 2, 5); `Snapshot.session`; `SessionConfig.language` (P3: Tasks 2, 4, 14, 24);
- `PlatformFacts` (seven fields) and `RecordCounters`;
- `FrameCount(video, audio)`;
- `HttpOutcome.Answered` and `.Failed`, `BodyFields`, `HttpAdapter.readBody`;
- `Scope.PROCESS` and `.SESSION`; `BridgeCore.report`, `failure`, `refused`, `armFailed` (N1, Tasks 12 and 24), `log`, `send` (with `seq`), `current`, `tail`;
- `Platform.armed` (outside the sink, CD31) and `Platform.acked(seq)` (CD8); the wire event `onAck {seq}` (Tasks 12, 13, 15, 20); `NativeCaptureEngine.settled()` (Tasks 15, 16, 19);
- `TickLateness` → `tick-late {gapMs}` and `FrameGaps` → `frames-gap {attempt, gapMs}` (Tasks 9, 12, 24, 25, 26);
- `OwnedSlot.take(by, value)` / `release(by)` (Tasks 12, 20);
- `VendorLogger` → `vendor-log {tag, message, error}` (CD30; `tag` and `error` are plain keys in Task 3's allow-list);
- `SrtPlan`, `SrtOpt`, `AttemptSignals`; `SeaznSrtSink.counters(attemptId)` and `setMaxBw(attemptId, b)` (Tasks 21, 22);
- `Capture` (with `streamer`) and `CaptureFacts`; `EngineHost.core(context)`, `capture(context)`, `keeper(context)`, `line(entry)`;
- `Grant.GRANTED`, `REFUSED`, `UNAVAILABLE`, and `ArmTurns.armed`, `ended`, `current` (Task 24);
- `EncoderKeys.VIDEO` and `MicSilenceWatch()` (Tasks 11, 10, 22, 23, 24), with no SDK argument (CD34);
- `Logger.release()` and `scrubFields(fields, held, inHand)` (Task 3);
- `NotificationText.content`, `language`, `CHANNEL`, `WORDS` (Tasks 10, 24);
- `NativeCaptureEngine.forward`, `pauseReports` and `ForwardedEntry`; `RingRecord.appendLine`, `createRoutedRecord` and `recordGoesNative`;
- `ENGINE_SCENARIOS` and `ScenarioKit`.

The wire's telemetry field names equal plan A's `Telemetry`, plus the three Task 14 adds.

**Review Focus.** Each of the five lines has a named test:

1. `GlueRulesTest` (Task 11), and the silence screen test with its mutation (Task 18);
2. `BridgeCoreTest` Review Focus 2 (Task 12), `OwnedSlotTest` (Task 12), and the native-engine construction test (Task 15);
3. `BridgeCoreTest` Review Focus 3 and the I1 tests (Task 12), with sticky failure (Task 6) and the permissions line (Task 18); the fresh-install step (Tasks 24, 26);
4. the shared scrub vectors with mutations (Task 3), and `GlueRulesTest`'s CD30 rule (Task 11);
5. `AttemptPollersTest` (Task 7) and `AttemptSignalsTest` R3 (Task 11).

**Counts.** 26 tasks in 9 batches (C1, C2, C3, C4a, C4b, C5, C6, C7, C8).

## Review dispositions

The independent review of 2026-10-01 (`.superpowers/plan-c-review.md`) found 3 Critical, 14 Important, 18 Minor and 19 wrong claims. Each was re-verified against `main` at `d6931c1` before it was acted on. Where this plan departs from the review's proposed fix, the reason is here.

**Critical.**

| Finding                               | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 `Ended.name` does not compile      | Fixed, **with a different name than proposed.** The review proposed `session`. `Phase.kt:123` already declares the extension `val Phase.session: Session?` ("the session held"), which `BridgeCore`, `Projection` and the machine read; a member `Ended.session: SessionName?` would shadow it for `Ended` with a different type and meaning. The field is `sessionName` (Task 2), used in every place the review listed.                                                  |
| C2 Task 3's churn, and `kind`         | Fixed by the review's first option: **`level` is omitted when it is `info`** (CD7), so the ~26 literal lines keep their shape. The eight tests whose point changes are listed with old point, new point and new expectation (Task 3, Step 6). `kind` stays a plain key on both sides, written `field_kind` and restored by `parseRecordLine`. Every JS test the review named is in Task 3's Files with its change, and `HomeScreen.test.tsx` is run to prove it unchanged. |
| C3 the service before the permissions | Fixed as proposed (Task 24): permissions first, the service on a grant, `survivesBackground` optimistic from the arm, the service's own catch, and a fresh-install Android 14+ step in Tasks 24 and 26.                                                                                                                                                                                                                                                                    |

**Important.**

| Finding                                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1 a throw from `armed` swallowed          | Fixed as proposed (CD31): the arm is noticed in its own posted task after each input, `armed` runs outside the sink under the guarded scheduler, by config identity, so a throwing `facts()` cannot skip it. Three tests (permanent, `Error`, `throwOnFactsOnce`), each with a mutation.                                                                                                                                             |
| I2 the core bound to the first JS instance | Fixed as proposed (CD32): the platform on the application context; `OwnedSlot`s for the listener and the `AppContext`; `Permissions` reads the slot at request time. Device check in Task 26.                                                                                                                                                                                                                                        |
| I3 the pre-PR-#9 i18n base                 | Fixed: rebased onto `d6931c1`; the copy table rewritten to the glossary and reviewed in this plan, so no `_review` marker is ever committed; **engine** added to the glossary; baselines re-counted at the base; the new lines in Task 26's copy-fit check.                                                                                                                                                                          |
| I4 the boundary cannot remount             | Fixed as proposed: `key` on the `ErrorBoundary`; `crashPreview()` in `test/fakeSurfaces.ts`; tests spy on `console.error` locally; the second-crash test asserts the caption and the count; mutation 1 is the review's defect.                                                                                                                                                                                                       |
| I5 the preview scope                       | Fixed as proposed: collect on attach, cancel on detach, a null streamer unbinds, and both scopes have a `CoroutineExceptionHandler` (Tasks 22, 25).                                                                                                                                                                                                                                                                                  |
| I6 C5 ∥ C6 device checks                   | Fixed: C6 runs no device check; Task 23 Step 1 runs them after C5. `NoCapture`'s phone check is dropped: its path is JVM-proved by the three I1 tests (Task 12), and not reached on a phone (Task 22 replaces `NoCapture` before C5 wires the native engine; a refused permission goes through `BridgeCore.refused`, not `noticeArm`'s catch). Corrected after the re-review (N6).                                                   |
| I7 glue as prose                           | Fixed: Tasks 20–25 are code; every undefined reference the review listed is now defined (`EngineHost.capture`, `EngineHost.line`, `cameraOpened`, `RtmpDispatcherProvider`, `TlsGuard.handler`/`record`, `DeviceSampler.armed`, `pauseReports`).                                                                                                                                                                                     |
| I8 device claims with nothing to read      | Fixed: `tick-late` and `frames-gap` (CD33, Task 9, wired in Task 12); `ffmpeg -frames:v 1` for uprightness; Task Manager for `user-requested`, the swipe recorded as seen; the audio floor on each phone the gate uses; the `capture-clock` line.                                                                                                                                                                                    |
| I9 config file names                       | Fixed: `vitest.config.mts`, `eslint.config.mjs` (and no eslint change unless lint refuses).                                                                                                                                                                                                                                                                                                                                          |
| I10 the settle/tick race                   | Fixed as proposed (CD8): `seq` and `ack`, posted after the input's own tasks; `settle` and the device probe wait for the ack, with a 5 s guard.                                                                                                                                                                                                                                                                                      |
| I11 two guards; the CI shape               | Fixed: each guard mutated on its own; `bridge-contract.yml` is its own workflow, so `kotlin-core.yml` stays JDK and Gradle only.                                                                                                                                                                                                                                                                                                     |
| I12 JS text keys before `protect()`        | Fixed with the review's second option, keyed on the session in hand after the re-review (N7): JS masks a text key whole unless the viewfinder holds a protected session, from `protect` to `release` (CD6). The first option (protect at scan) would move `protect()` into the scan flow, which plan A owns; this keeps the change inside the scrub, the logger and `useProtect`'s cleanup, with a test of two codes in one process. |
| I13 tests promising more                   | Fixed: the CD16 test asserts the refusing platform's `armed` is empty; `GlueRulesTest` skips (never passes) with no glue and fails on an empty folder; the notification test asserts exactly six keys per language.                                                                                                                                                                                                                  |
| I14 StreamPack's logger                    | Fixed as proposed (CD30), stricter: nothing reaches logcat in **any** build, since the glue may not import `android.util.Log`.                                                                                                                                                                                                                                                                                                       |

**Minor.** All fixed: M1 (CD7 is owner-visible), M2 (device-only list and the `capture-clock` line), M3 (`resetShared` in `@AfterTest`), M4 (pinned), M5 (tested), M6 (CD7 and `BridgeCore.log` say JS fractions are written to tenths), M7 (the reason text), M8 (the keeper on the main looper), M9 (Task 24's device step), M10 (`byteFormat`), M11 (`SlateColoursTest`), M12 (`pict_type=B` count), M13 (the file map rewritten), M14 (OkHttp `compileOnly` 4.9.2), M15 (C4a and C4b), M16 (`recordGoesNative`), M17 (one CD21 string), M18 (the channel is `mode.stream`, per language).

**Wrong claims.** All 19 corrected in place; each was a fact the review checked against `main` and this revision re-checked: 1 and 2 (I9); 3, 4 and 5 (C2); 6 (C1); 7 (I3, the marker); 8 (baselines at `d6931c1`); 9, 10 and 11 (I4); 12 and 13 (I8a, I8b); 14 (I8c); 15 (I8d); 16 (I6, I1); 17 (this self-review, I7); 18 (`EngineHost.line`); 19 (CD16: the arm intent is the channel, P3).

**Owner questions.** P1–P3 were ruled by the owner on 2026-10-01, with three further rulings that day (Android 12+, subagent-driven execution batch by batch, the latest stable versions). They are written as decided under _Owner rulings of 2026-10-01_; no step is conditional on them any more.

### Re-review (2026-10-01, plan at `4c69b2d`)

The re-review (`.superpowers/plan-c-review.md`, _Re-review_) found two Important and eight Minor findings, and two carried Minors. Each was re-checked against the plan before it was acted on.

| Finding                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1 the keeper swallows arm-path failures    | Fixed as proposed (Task 24): `forArm` hands any failure on the arm path to the new `BridgeCore.armFailed(config, t)` (Task 12), which ends that session fatal-error and named, or only records `arm-step-late` when the session is no longer held; `survivesBackground` drops with it. The marker and the wake lock are record-only, each on its own. `end` stays record-only. The core half is JVM-proved (two tests, two mutations); the keeper is glue, and an arm-path throw cannot be forced on a stock phone, so its wiring is a code-review fact. The stale `noticeArm` sentence in Task 20 now says where the claim stops holding. |
| N2 a late grant starts a session that ended | Fixed as proposed: `ArmTurns` (pure, Task 24, four tests and two mutations) closes the turn at `ended()`, and `answered` drops a late answer as `permissions-late`. `StreamerAdapter.build` ends and releases a streamer it still holds before building another (Task 22). Device step in Tasks 24 and 26.                                                                                                                                                                                                                                                                                                                                 |
| N3 `ICameraSource.isStreamingFlow`          | Fixed as proposed: `held.videoInput.isStreamingFlow.value \|\| source.isPreviewingFlow.value` (Task 22).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N4 `Stats` `Int` fields                     | Fixed, and re-read from 1.10.1: `pktRetransTotal` and `pktSndDropTotal` take `.toLong()`; every `Stats` field type is written beside the call (Task 21).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N5 nl "Toon voorbeeld"                      | Fixed: "Voorbeeld tonen" (15, within 16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N6 the I6 reason                            | Corrected in Task 20 Step 7 and the I6 row above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| N7 I12 lapses after the first `protect()`   | Fixed rather than stated: the rule is keyed on the session in hand (`protect`/`release`), with a two-code logger test, a viewfinder test, and three mutations (Task 3). CD6's citation now says `useProtect`, at the viewfinder, not "at arm".                                                                                                                                                                                                                                                                                                                                                                                             |
| N8 the mic-session line                     | Fixed with code: `StreamerAdapter.noteMicSession` records it once per session at the first connect (Task 22); Task 23's prose points there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| N9 the sampler's failures                   | Fixed: the first failure in the process is a `watch-failed {action: "device"}` line (Task 23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| N10 `stopSelf()` after a refused start      | Listed as unproved in the device-only claims and Task 26.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `javaClass.name` under a plain key          | Fixed: every `error` field records `javaClass.simpleName`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `probe.fail {reason}` as a phrase           | Fixed: `probe.fail` records `{ scene, check, reason: 'mismatch' }`, numbers and one plain word (Tasks 16, 19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| srtdroid `// confirm:` lines                | Replaced by the verified 1.10.1 signatures, the `Stats` field types and `close()`'s synchronous completion, all read from the jar (Task 21, CD35).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
