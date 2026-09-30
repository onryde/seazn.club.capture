# S1 Plan B — the engine's pure-Kotlin core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `modules/capture-engine/android/core/`, the pure-Kotlin half of the S1 capture engine, test first from P5. It holds the session machine and every rule P5 paid for: the LIVE gate, fallback, the bitrate regulator, SRT bandwidth, the stall watchdog, the delivery watch, the hold clock, the heartbeat and the scrubbed session record. Add the Kotlin core CI job. This is spec §7 phase 3 and nothing else.

**Architecture:** A standalone Kotlin/JVM Gradle build with its own wrapper. It has no Android import and no dependency beyond the Kotlin standard library, and time comes in only through an injected `Clock` and `Scheduler`. Every rule is a pure function over immutable data. `SessionMachine.reduce(phase, input, now)` returns the next `Phase` plus a list of `Command`s; it is the aggregate, and the only authority on the session (AGENTS §2). A thin `Engine` serialises inputs on the injected scheduler, ticks every 500 ms, sends `Record` commands to the scrubbed `SessionRecord` and everything else to the platform. It publishes a `Snapshot` on every tick and on every state change. Plan C's Android adapters (capture, encode, SRT/RTMPS, HTTP) implement `CommandSink` and feed `Input`s back. Plan C's Expo bridge maps `Snapshot` onto plan A's TypeScript `EngineSnapshot`.

**Tech Stack:**

- Kotlin 2.1.20: React Native 0.86.3's version catalog, which Expo 57 hands every module as `kotlinVersion`.
- Gradle 9.3.1 wrapper (the app's own), JDK 17 toolchain.
- kotlin.test on JUnit 5.
- GitHub Actions: `actions/checkout@v5`, `gradle/actions/wrapper-validation@v6`, `actions/setup-java@v6` (temurin 17).

**Spec:** `docs/specs/2026-09-30-s1-live-stream-design.md`. The sources are §3 (_`core/`: pure Kotlin_), §6 (_Tests_, _CI_), §7 phase 3, decisions 3–11 and _Ask_ (the heartbeat fields). P5 is `docs/specs/2026-09-11-p5-android-results.md`, and findings are cited by ID (F-P5-n, H-P5-n, C1, C2).

## Global Constraints

- **Paths.** This plan creates files only under `modules/capture-engine/android/core/**` and `.github/workflows/kotlin-core.yml`, and adds one line to `.prettierignore`. It does not touch:
  - `src/`, `app/`, `test/` or `modules/capture-engine/src/` (plan A);
  - `modules/capture-engine/android/` outside `core/` (plan C);
  - the root `android/` (prebuild output, gitignored);
  - the spec;
  - `package.json`.
- **No Android, no dependencies.** There is no `import android.*`, no Android Gradle plugin and no coroutines. The only dependencies are the Kotlin standard library and `testImplementation(kotlin("test"))`. JSON is hand-written: `org.json` is an Android stub on the JVM, and kotlinx.serialization would add a compiler plugin to the app's build.
- **No `java.time`.** The app's `minSdk` is 24 and `java.time` needs API 26, so `IsoTime` does the civil-date arithmetic itself.
- **The toolchain.**
  - `JAVA_HOME` is already JDK 17 (AGENTS §13), and must not be overridden with `/usr/libexec/java_home`.
  - The wrapper is Gradle 9.3.1, and `kotlin { jvmToolchain(17) }` applies.
  - `allWarningsAsErrors` is on, so a warning is a failed build.
- **Commands.** Every command runs from the core directory, and `cd` goes in the same call because the cwd resets (AGENTS §13):
  ```bash
  export WT=/absolute/path/of/your/worktree   # set once per shell call
  cd "$WT/modules/capture-engine/android/core" && ./gradlew test --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"
  ```
  Read failures with `grep -E '^e: |FAILED' "$TMPDIR/core.txt"`. Count tests from the XML, never from a summary (the `rtk` trap in AGENTS §13):
  ```bash
  cd "$WT/modules/capture-engine/android/core" && grep -ho ' tests="[0-9]*"' build/test-results/test/*.xml | tr -dc '0-9\n' | paste -sd+ - | bc
  ```
  Each XML is one test class, and its `testsuite` element carries the class's `tests=` count.
- **The code in each task is final.** Every file below was compiled and run green on a scratch copy on 2026-09-30:
  - 176 tests;
  - the task order replayed from an empty directory, so each test fails before its code exists and passes after;
  - each guard mutated and killed (Task 16).
    Type it as given. If a step's expected output differs, stop and report; do not "fix" the test.
- **Tests.**
  - A test name starts with the finding's ID when one applies (spec §3: "a named failing JVM test first").
  - No expected value is derived from the code under test (AGENTS §10). Every number is quoted from P5, or worked by hand in a comment beside it. ISO strings were produced by `date -u -r`.
  - No snapshot tests.
- **Vocabulary.**
  - Thermal is never a `DegradeReason`; it travels as `shed` (AGENTS §8).
  - `audio-below-floor` does not exist in Kotlin: the level floor stays a TypeScript display selector (spec §2).
  - Commands are intents (AGENTS §2).
- **Git.**
  - Never bare `git stash`, `git checkout <file>` on uncommitted work, or `git add -A` (AGENTS §13).
  - Stage the paths each task names.
  - Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The reviewer should spend its time here. Everything else is plumbing.

1. **The LIVE gate.** `Projection.onAir` and `StallWatchdog.advancing` decide LIVE only while encoded video frames advance, never from connected, egress or the streaming flag (F-P5-6, F-P5-3). It must also hold after a reconnect, when `liveSinceEpochMs` is already set.
2. **Fallback counting.** In `FallbackPolicy`, connect failures and short mid-session drops count toward the same three (F-P5-2). A network that is not validated counts nothing, and neither does `UNRESOLVED` (F-P5-1). An attempt that published for 25 s or more clears the count. **25 s is this plan's choice:** it sits between F-P5-2's collapses (6–22 s) and F-P5-13's healthy far-end closes (31–33 s).
3. **Regulator restart versus halve.** `BitrateRegulator.afterDrop` restarts at the last healthy target unless the link was failing within 10 s. "Failing" means loss on SRT and drops on RTMPS.
4. **The delivery watch.**
   - Only publishing time counts, and a variant change is not progress.
   - Thresholds come from the configured 2 s segment, never `targetDuration` or the LL part target.
   - LL-HLS parts count once.
   - `EXT-X-ENDLIST` means nothing.
   - The master is polled fresh with a low `clientBandwidthHint`.
5. **The heartbeat never blocks.** One beat is in flight at most, it is abandoned at 10 s, stale answers are ignored, and no answer ever touches the stream. Only a 410, or a 2xx whose `state` is ending, completed or failed, ends the session.
6. **The scrub allow-list.**
   - Unknown keys and types are masked.
   - `tok`, passphrases and stream keys are masked everywhere.
   - The stream id is masked everywhere except inside a public URL, where every viewer already has it.
   - Secrets from an earlier arm stay masked.
7. **Engine containment.** A throwing command sink, snapshot sink, record sink or reducer is recorded and contained, and never propagates to the platform.
8. **The unmeasured constants** in the self-review's list. Each is a choice, not a P5 measurement, and should be challenged.

## Dispatch batches

Tasks that go together go to one implementer as one batch. Every batch ends in a green `./gradlew test` with the count below, then its commits.

| Batch  | Tasks | What                                                                                | Files (under `modules/capture-engine/android/core/` unless shown)                                                                                                                                                   | Tests at end |
| ------ | ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **B1** | 1–3   | Gradle scaffold + `Clock`/`Scheduler`, JSON and UTC time, the CI job                | `settings.gradle.kts`, `build.gradle.kts`, `.gitignore`, `gradlew`, `gradlew.bat`, `gradle/wrapper/*`, `Time.kt`, `Json.kt`, `Fakes.kt`, 2 tests; `.github/workflows/kotlin-core.yml`; `.prettierignore` (one line) | 11           |
| **B2** | 4–5   | Vocabulary, `SessionConfig`, `Snapshot`; link meter + `SrtBandwidth`                | `Vocabulary.kt`, `SessionConfig.kt`, `Snapshot.kt`, `Link.kt`, `Configs.kt`, 3 tests                                                                                                                                | 28           |
| **B3** | 6–8   | The link rules: `BitrateRegulator`, `FallbackPolicy`, `StallWatchdog`               | `BitrateRegulator.kt`, `FallbackPolicy.kt`, `StallWatchdog.kt`, 3 tests                                                                                                                                             | 69           |
| **B4** | 9–12  | The server-facing rules: playlist parser, `DeliveryWatch`, `HoldClock`, `Heartbeat` | `PlaylistParser.kt`, `DeliveryWatch.kt`, `HoldClock.kt`, `Heartbeat.kt`, 4 tests                                                                                                                                    | 72           |
| **B5** | 13    | `SessionRecord`                                                                     | `SessionRecord.kt`, 1 test                                                                                                                                                                                          | 39           |
| **B6** | 14–15 | `SessionMachine` + `Projection`, then the `Engine` driver                           | `Input.kt`, `Command.kt`, `Phase.kt`, `SessionMachine.kt`, `Projection.kt`, `Engine.kt`, `MachineRig.kt`, 5 tests                                                                                                   | 176          |
| **B7** | 16    | Guard mutation check (changes nothing)                                              | none                                                                                                                                                                                                                | 176          |

The counts for B3, B4 and B5 are each measured on B1 + B2 alone, because those three batches may run in parallel. After all three merge, the count is 124.

**Order.**

- **Sequential:** B1 → B2 → {B3, B4, B5} → B6 → B7. Each later batch compiles against the one before it.
- **Parallel:** B3, B4 and B5 may run at once in separate worktrees, each branched from B2's commit. Their file sets are provably disjoint:
  - each only _creates_ new files, with the names above, and edits nothing;
  - each builds green on B1 + B2 alone (checked 2026-09-30: 69, 72 and 39 tests);
  - so merging them in any order is conflict-free and the union compiles.
    If only one implementer is available, run them in order B3, B4, B5.
- **Against the other plans:**
  - B1's one edit outside the core is `.prettierignore`. It runs sequentially with any plan A task that edits `.prettierignore`; nothing else in this plan overlaps plan A's files.
  - Plan C consumes B6's `Engine`, `Input` and `Command`, so its adapter work starts after B6.

## Plan decisions

1. **Gradle layout.**
   - The core is a standalone build at `modules/capture-engine/android/core`, with its own `settings.gradle.kts` (`rootProject.name = "capture-engine-core"`), its own Gradle 9.3.1 wrapper and group `com.seazn.capture`.
   - Plan C's Expo Android library consumes it with `includeBuild("…/core")`, and Gradle substitutes `com.seazn.capture:capture-engine-core`.
   - It never applies an Android plugin, so CI needs no Android SDK (spec §6).
   - A subproject of the prebuilt `android/` was rejected: that tree is gitignored prebuild output.
2. **Kotlin version.**
   - 2.1.20, the version React Native 0.86.3's catalog pins and Expo 57 hands every module.
   - The app and the core are compiled by the same Kotlin, so the library reads the jar's metadata. (Expo's own fallback is 2.0.21, which would read 2.1 metadata only by accident.)
   - `jvmToolchain(17)`; bytecode 17 is what AGP 8 desugars.
3. **Test library.** `kotlin("test")` on JUnit 5, with backtick names carrying the finding ID. Gradle's `--tests '*F-P5-2*'` filter works on them, and a filter that matches nothing fails with "No tests found". No mocking library: every collaborator is a fake or a value.
4. **Reducer, not actor.**
   - `SessionMachine.reduce(Phase, Input, Now): Step(phase, commands)` is a pure function over a sealed `Phase`.
   - `Engine` is the only mutable object. It serialises inputs by posting them to the injected `Scheduler`, ticks every 500 ms and routes commands.
   - An actor (a coroutine channel) was rejected: it needs `kotlinx.coroutines`, a test dispatcher and a thread model in the core. A reducer can be tested one input at a time with the time given explicitly, and there is still exactly one authority.
5. **CI shape.**
   - A separate workflow `.github/workflows/kotlin-core.yml`, so its file set is disjoint from `check.yml` and from any plan A change to it.
   - Same triggers as `check.yml` (pull requests and pushes to main) and no path filter, so a required check never goes missing on a PR it skipped.
   - The steps: wrapper validation, temurin 17 with the Gradle cache, then `./gradlew test`.
6. **The bridge.** Plan C maps Kotlin names onto plan A's TypeScript snapshot. The core's names follow spec §2's wording, and every enum carries its wire string (`Wire.wire`), which equals the TypeScript literal. The mapping plan C owns:

   | Kotlin (`core`)                                                                                                                                                                                                | TypeScript (plan A)                                                                                                                                              |
   | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SnapshotState.*.wire` (`idle`, `armed`, `connecting`, `publishing`, `degraded`, `reconnecting`, `ended`)                                                                                                      | `SessionState.kind`                                                                                                                                              |
   | `Connecting/Publishing/Degraded.transport`, `sinceEpochMs`                                                                                                                                                     | same names                                                                                                                                                       |
   | `Degraded.reasons: List<DegradeReason>`, most important first                                                                                                                                                  | `reason`: the bridge sends `reasons.first()` unless plan A widens the type to a list                                                                             |
   | `Reconnecting.holdRemainingSeconds`, `holdWindowSeconds`, `sinceEpochMs`                                                                                                                                       | same names                                                                                                                                                       |
   | `Reconnecting.cause` (`uplink-lost`, `video-stalled`, `not-delivered`)                                                                                                                                         | not yet in plan A: plan A adds `cause`, or the bridge drops it and the status line cannot say which                                                              |
   | `Ended.reason` (`operator-stopped`, `stopped-by-organiser`, `hold-window-expired`, `fatal-error`)                                                                                                              | `EndReason`                                                                                                                                                      |
   | `DegradeReason` wire strings                                                                                                                                                                                   | `DegradeReason`, minus the TypeScript-only `audio-below-floor`                                                                                                   |
   | `Snapshot.bitrateKbps`, `targetBitrateKbps`, `encodedVideoFps`, `audioPacketsPerSecond`, `srt.rttMs`, `delivery`, `deliveredLagMs`, `dataUsedBytes`, `heartbeat`, `shed`, `device`, `charging`, `reportedAtMs` | `EngineSnapshot.reportedAtMs` and the `Telemetry` fields plan A names; the audio level, the interruption and `survivesBackground` are platform facts plan C adds |

7. **One package.** Everything is in `com.seazn.capture.engine.core`. The machine's helpers (`Transports`, `Timers`, `Devices`, `Deliveries`, `Heartbeats`) are `internal` objects in `SessionMachine.kt`.

## File map

```
modules/capture-engine/android/core/
  settings.gradle.kts  build.gradle.kts  .gitignore  gradlew  gradlew.bat  gradle/wrapper/{gradle-wrapper.jar,gradle-wrapper.properties}
  src/main/kotlin/com/seazn/capture/engine/core/
    Time.kt            Clock, Now, Cancellable, Scheduler                         (Task 1)
    Json.kt            Wire, JsonObject, Decimal, Json, IsoTime                   (Task 2)
    Vocabulary.kt      Transport, DegradeReason, EndReason, Delivery, ShedStep, … (Task 4)
    SessionConfig.kt   IngestTarget, SrtTarget, RtmpsTarget, SessionConfig        (Task 4)
    Snapshot.kt        SnapshotState, SrtTelemetry, HeartbeatStatus, Snapshot     (Task 4)
    Link.kt            Encode, LinkCounters, LinkSample, LinkMeter, SrtBandwidth  (Task 5)
    BitrateRegulator.kt                                                           (Task 6)
    FallbackPolicy.kt                                                             (Task 7)
    StallWatchdog.kt                                                              (Task 8)
    PlaylistParser.kt  Playlist (plain HLS and LL-HLS)                            (Task 9)
    DeliveryWatch.kt   FetchResult, NotDelivered, DeliveryWatch                   (Task 10)
    HoldClock.kt                                                                  (Task 11)
    Heartbeat.kt                                                                  (Task 12)
    SessionRecord.kt                                                              (Task 13)
    Input.kt  Command.kt  Phase.kt  SessionMachine.kt  Projection.kt              (Task 14)
    Engine.kt          CommandSink, SnapshotSink, Engine                          (Task 15)
  src/test/kotlin/com/seazn/capture/engine/core/
    Fakes.kt (FakeClock, FakeScheduler)  Configs.kt  MachineRig.kt  and one *Test.kt per unit
.github/workflows/kotlin-core.yml                                                 (Task 3)
```

`K` below is `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core` and `T` is the same path under `src/test`.

---

## Task 1: Gradle scaffold, `Clock` and `Scheduler`

**Files:**

- Create `modules/capture-engine/android/core/settings.gradle.kts`, `build.gradle.kts` and `.gitignore`.
- Create `modules/capture-engine/android/core/gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar` and `gradle/wrapper/gradle-wrapper.properties`. These are generated, not typed.
- Create `K/Time.kt`, `T/Fakes.kt` and `T/FakeSchedulerTest.kt`.
- Modify `.prettierignore` (one line).

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface Clock { fun monotonicMs(): Long; fun wallMs(): Long }`;
  - `data class Now(val monoMs: Long, val wallMs: Long)` and `fun Clock.now(): Now`;
  - `fun interface Cancellable { fun cancel() }`;
  - `interface Scheduler { fun schedule(delayMs: Long, task: () -> Unit): Cancellable }`;
  - the test fakes: `FakeClock(mono = 0, wall = 1_790_000_000_000)` with `advance(ms)`, and `FakeScheduler(clock)` with `advanceBy(ms)` and `pending`.

  Plan C implements `Clock` with `SystemClock.elapsedRealtime()` and `System.currentTimeMillis()`. It implements `Scheduler` on **one** thread (a `HandlerThread`'s `Handler`), and that single thread is the whole of the engine's thread model. `schedule` must be callable from any thread (`Handler.postDelayed` is), because `Engine.send` is.

- [ ] **Step 1: Write the settings file**

`modules/capture-engine/android/core/settings.gradle.kts`:

```kotlin
// The engine's pure-Kotlin core (spec §3, decision 10). A standalone build with its own wrapper:
// its tests need JDK 17 and Gradle, and no Android SDK (spec §6). Plan C's Expo Android library
// consumes it through `includeBuild`, so this build must never apply an Android plugin.
rootProject.name = "capture-engine-core"

dependencyResolutionManagement {
  repositories { mavenCentral() }
}
```

- [ ] **Step 2: Generate the wrapper with Gradle 9.3.1**

The app's own Android build has already downloaded the 9.3.1 distribution into `~/.gradle`:

```bash
cd "$WT/modules/capture-engine/android/core" && "$(ls -d ~/.gradle/wrapper/dists/gradle-9.3.1-bin/*/gradle-9.3.1 | head -1)/bin/gradle" wrapper --gradle-version 9.3.1 > "$TMPDIR/wrap.txt" 2>&1; echo "EXIT=$?"; shasum -a 256 gradle/wrapper/gradle-wrapper.jar; ls -l gradlew | cut -c1-10
```

Expected:

- `EXIT=0`.
- The jar's SHA-256 is `b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13`.
- `gradlew` is `-rwxr-xr-x`.

If the `ls` finds no distribution, run the app's local Android build once (AGENTS §11) or download Gradle 9.3.1 from gradle.org. Never copy a wrapper jar from anywhere else: CI's wrapper validation refuses a jar Gradle did not publish. The generated `gradle-wrapper.properties` must read:

`modules/capture-engine/android/core/gradle/wrapper/gradle-wrapper.properties`:

```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-9.3.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

- [ ] **Step 3: Write the build file and the ignore file**

`modules/capture-engine/android/core/build.gradle.kts`:

```kotlin
import org.gradle.api.tasks.testing.logging.TestExceptionFormat

plugins {
  // The Kotlin that React Native 0.86.3's version catalog pins (`kotlin = "2.1.20"`), which
  // Expo 57's root-project plugin hands every module as `kotlinVersion`. The app and the core
  // are compiled by the same Kotlin, so the library that consumes this jar reads its metadata.
  kotlin("jvm") version "2.1.20"
}

group = "com.seazn.capture"
version = "0.1.0"

kotlin {
  jvmToolchain(17)
  compilerOptions { allWarningsAsErrors.set(true) }
}

dependencies {
  testImplementation(kotlin("test"))
}

tasks.test {
  useJUnitPlatform()
  testLogging {
    events("failed")
    exceptionFormat = TestExceptionFormat.FULL
  }
}
```

`modules/capture-engine/android/core/.gitignore`:

```gitignore
.gradle/
.kotlin/
build/
```

- [ ] **Step 4: Keep Gradle's reports out of the repo's Prettier check**

`pnpm check` runs `prettier --check src app modules test`. Prettier reads the root `.gitignore` but not this module's own `.gitignore`. Gradle's HTML test report under `core/build/` contains `.js` and `.css` files that Prettier would then check; this was verified on a scratch copy, where it failed. Append one line to the root `.prettierignore`, below its existing `modules/*/android/build/` line:

```
modules/*/android/core/build/
```

- [ ] **Step 5: Check the empty build runs**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep BUILD "$TMPDIR/core.txt"
```

Expected: `EXIT=0` and `BUILD SUCCESSFUL`. There are no sources yet, so `test` is `NO-SOURCE`.

- [ ] **Step 6: Write the fakes and their test**

`T/Fakes.kt`:

```kotlin
package com.seazn.capture.engine.core

/** A clock that moves only when a test moves it. Wall time starts on a fixed, readable instant. */
class FakeClock(var mono: Long = 0, var wall: Long = 1_790_000_000_000) : Clock {
  override fun monotonicMs(): Long = mono

  override fun wallMs(): Long = wall

  fun advance(ms: Long) {
    mono += ms
    wall += ms
  }
}

/** Runs scheduled work when the test advances time, each task at its own due time, in due order. */
class FakeScheduler(private val clock: FakeClock) : Scheduler {
  private class Job(val dueAt: Long, val order: Long, val task: () -> Unit) {
    var cancelled = false
  }

  private val jobs = mutableListOf<Job>()
  private var order = 0L

  val pending: Int
    get() = jobs.count { !it.cancelled }

  override fun schedule(delayMs: Long, task: () -> Unit): Cancellable {
    val job = Job(clock.mono + delayMs.coerceAtLeast(0), order++, task)
    jobs += job
    return Cancellable { job.cancelled = true }
  }

  fun advanceBy(ms: Long) {
    val end = clock.mono + ms
    while (true) {
      val next =
        jobs
          .filter { !it.cancelled && it.dueAt <= end }
          .minWithOrNull(compareBy<Job>({ it.dueAt }, { it.order })) ?: break
      jobs.remove(next)
      clock.advance(next.dueAt - clock.mono)
      next.task()
    }
    clock.advance(end - clock.mono)
    jobs.removeAll { it.cancelled }
  }
}
```

`T/FakeSchedulerTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals

class FakeSchedulerTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)

  @Test
  fun `tasks run at their own due time, in due order`() {
    val seen = mutableListOf<Pair<String, Long>>()
    scheduler.schedule(300) { seen += "b" to clock.mono }
    scheduler.schedule(100) { seen += "a" to clock.mono }
    scheduler.advanceBy(1_000)
    assertEquals(listOf("a" to 100L, "b" to 300L), seen)
    assertEquals(1_000L, clock.mono)
  }

  @Test
  fun `a cancelled task never runs`() {
    var ran = false
    scheduler.schedule(10) { ran = true }.cancel()
    scheduler.advanceBy(100)
    assertEquals(false, ran)
    assertEquals(0, scheduler.pending)
  }

  @Test
  fun `a task scheduled by a task runs within the same advance when it falls due`() {
    val seen = mutableListOf<Long>()
    scheduler.schedule(100) { scheduler.schedule(100) { seen += clock.mono } }
    scheduler.advanceBy(250)
    assertEquals(listOf(200L), seen)
  }

  @Test
  fun `wall time moves with monotonic time`() {
    val wallBefore = clock.wallMs()
    scheduler.advanceBy(1_500)
    assertEquals(wallBefore + 1_500, clock.wallMs())
    assertEquals(Now(1_500, wallBefore + 1_500), clock.now())
  }
}
```

- [ ] **Step 7: Run the test and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*FakeSchedulerTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`. `:compileTestKotlin` fails with `Unresolved reference` errors for `Clock`, `Scheduler` and `Cancellable`, for example `FakeSchedulerTest.kt:23:43 Unresolved reference 'cancel'.`

- [ ] **Step 8: Write `Time.kt`**

`K/Time.kt`:

```kotlin
package com.seazn.capture.engine.core

/** Time, injected (spec §3). Nothing in the core reads a system clock, so every rule runs on a fake. */
interface Clock {
  /** Milliseconds that only ever go forward. Every interval the core measures uses this. */
  fun monotonicMs(): Long

  /** Epoch milliseconds, only for what a person or the server reads: record lines and the heartbeat's `at`. */
  fun wallMs(): Long
}

/** The two readings of one instant, taken once per input so a step never sees time move under it. */
data class Now(val monoMs: Long, val wallMs: Long)

fun Clock.now(): Now = Now(monotonicMs(), wallMs())

fun interface Cancellable {
  fun cancel()
}

/** Deferred work, injected. Plan C backs it with one serial thread, which is what serialises the engine. */
interface Scheduler {
  fun schedule(delayMs: Long, task: () -> Unit): Cancellable
}
```

- [ ] **Step 9: Run the test and watch it pass**

Run the command from Step 7. Expected: `EXIT=0`, and the XML count is **4**.

- [ ] **Step 10: Commit**

```bash
cd "$WT" && git add .prettierignore modules/capture-engine/android/core/{settings.gradle.kts,build.gradle.kts,.gitignore,gradlew,gradlew.bat,gradle} modules/capture-engine/android/core/src && git commit -F - <<'EOF'
build(engine-core): scaffold the pure-Kotlin core with a clock and scheduler

A standalone Kotlin/JVM build (Kotlin 2.1.20, JDK 17, Gradle 9.3.1 wrapper)
so the core's tests need no Android SDK (spec §3, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git ls-files -s modules/capture-engine/android/core/gradlew
```

Expected: mode `100755`.

---

## Task 2: JSON and UTC time without `java.time`

**Files:** Create `K/Json.kt` and `T/JsonTest.kt`.

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface Wire { val wire: String }`, the wire spelling every enum carries;
  - `data class JsonObject(fields)`;
  - `Decimal` and `Decimal.tenths(Double): Decimal?`, which is locale-free, rounds half away from zero, and is null when the value is not finite;
  - `Json.obj(fields)`, `Json.value(any)` and `Json.string(text)`, which throw on a type JSON cannot hold;
  - `IsoTime.utc(epochMs)`, ISO-8601 UTC to the millisecond.

- [ ] **Step 1: Write the failing test**

`T/JsonTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class JsonTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  private enum class Colour(override val wire: String) : Wire {
    LIME("lime-led")
  }

  @Test
  fun `an object keeps field order and writes each JSON type`() {
    val text =
      Json.obj(
        listOf(
          "s" to "a",
          "n" to null,
          "b" to true,
          "i" to 7,
          "l" to 9_000_000_000L,
          "d" to Decimal.tenths(1.25),
          "w" to Colour.LIME,
          "o" to JsonObject(listOf("x" to 1)),
        )
      )
    assertEquals(
      """{"s":"a","n":null,"b":true,"i":7,"l":9000000000,"d":1.3,"w":"lime-led","o":{"x":1}}""",
      text,
    )
  }

  @Test
  fun `strings are escaped, control characters included`() {
    assertEquals("\"a\\\"b\\\\c\\nd\\u0001\"", Json.string("a\"b\\c\nd\u0001"))
  }

  @Test
  fun `decimals never follow the phone's locale`() {
    for (locale in listOf(Locale.FRANCE, Locale.GERMANY, Locale.forLanguageTag("nl-NL"), Locale.forLanguageTag("es-ES"))) {
      Locale.setDefault(locale)
      assertEquals("""{"v":1.5}""", Json.obj(listOf("v" to Decimal.tenths(1.5))))
    }
  }

  @Test
  fun `tenths round half away from zero and keep the sign`() {
    assertEquals("0.1", Decimal.tenths(0.05)?.text)
    assertEquals("-2.5", Decimal.tenths(-2.46)?.text)
    assertEquals("12.0", Decimal.tenths(12.0)?.text)
  }

  @Test
  fun `a number that is not finite has no decimal`() {
    assertNull(Decimal.tenths(Double.NaN))
    assertNull(Decimal.tenths(Double.POSITIVE_INFINITY))
  }

  @Test
  fun `a value JSON cannot hold is refused, not stringified`() {
    assertFailsWith<IllegalArgumentException> { Json.value(Any()) }
  }

  // Expected strings from `date -u -r <seconds>`, never from the code under test.
  @Test
  fun `epoch milliseconds become ISO-8601 UTC without java time`() {
    assertEquals("1970-01-01T00:00:00.000Z", IsoTime.utc(0))
    assertEquals("2026-09-21T14:13:20.000Z", IsoTime.utc(1_790_000_000_000))
    assertEquals("2026-09-30T14:32:05.123Z", IsoTime.utc(1_790_778_725_123))
    assertEquals("2000-03-01T00:00:00.000Z", IsoTime.utc(951_868_800_000))
    assertEquals("2028-02-29T23:59:59.999Z", IsoTime.utc(1_835_481_599_999))
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*JsonTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`. The first `e:` line reads `JsonTest.kt:16:29 'wire' overrides nothing.`, followed by `Unresolved reference` for `Wire`, `Json`, `Decimal` and `IsoTime`.

- [ ] **Step 3: Write `Json.kt`**

`K/Json.kt`:

```kotlin
package com.seazn.capture.engine.core

/** A value with the spelling the spec uses on the wire (spec §2). The bridge copies [wire] verbatim. */
interface Wire {
  val wire: String
}

/** A nested JSON object, fields in order. */
data class JsonObject(val fields: List<Pair<String, Any?>>)

/**
 * A number with one decimal, formatted by hand. `String.format` follows the phone's locale, and a
 * French, Dutch or Spanish phone would write `1,5` into a JSON body (AGENTS §10, question 4).
 */
class Decimal private constructor(val text: String) {
  override fun equals(other: Any?): Boolean = other is Decimal && other.text == text

  override fun hashCode(): Int = text.hashCode()

  override fun toString(): String = text

  companion object {
    /** Rounded half away from zero to one decimal; null for NaN or infinity, which JSON cannot hold. */
    fun tenths(value: Double): Decimal? {
      if (!value.isFinite()) return null
      val scaled = Math.round(Math.abs(value) * 10)
      val sign = if (value < 0 && scaled != 0L) "-" else ""
      return Decimal("$sign${scaled / 10}.${scaled % 10}")
    }
  }
}

/**
 * The only JSON the core writes: the heartbeat body and session-record lines. Hand-rolled so the
 * core has no dependency. It reads nothing: responses arrive already typed from the platform.
 */
object Json {
  fun obj(fields: List<Pair<String, Any?>>): String =
    fields.joinToString(",", "{", "}") { (key, value) -> "${string(key)}:${value(value)}" }

  fun value(value: Any?): String =
    when (value) {
      null -> "null"
      is String -> string(value)
      is Boolean, is Int, is Long -> value.toString()
      is Decimal -> value.text
      is Wire -> string(value.wire)
      is JsonObject -> obj(value.fields)
      else -> throw IllegalArgumentException("not a JSON value: ${value::class.simpleName}")
    }

  fun string(text: String): String {
    val out = StringBuilder(text.length + 2).append('"')
    for (char in text) {
      when {
        char == '"' -> out.append("\\\"")
        char == '\\' -> out.append("\\\\")
        char == '\n' -> out.append("\\n")
        char == '\r' -> out.append("\\r")
        char == '\t' -> out.append("\\t")
        char < ' ' -> out.append("\\u").append(char.code.toString(16).padStart(4, '0'))
        else -> out.append(char)
      }
    }
    return out.append('"').toString()
  }
}

/**
 * Epoch milliseconds as ISO-8601 UTC. Not `java.time`: the app's minSdk is 24 and `java.time`
 * arrives in API 26, without desugaring. The date arithmetic is Howard Hinnant's civil-from-days.
 */
object IsoTime {
  private const val DAY_MS = 86_400_000L

  fun utc(epochMs: Long): String {
    val days = epochMs.floorDiv(DAY_MS)
    val msOfDay = epochMs.mod(DAY_MS)
    val (year, month, day) = civil(days)
    return "${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T" +
      "${pad(msOfDay / 3_600_000, 2)}:${pad(msOfDay / 60_000 % 60, 2)}:" +
      "${pad(msOfDay / 1_000 % 60, 2)}.${pad(msOfDay % 1_000, 3)}Z"
  }

  private fun civil(daysSinceEpoch: Long): Triple<Long, Long, Long> {
    val z = daysSinceEpoch + 719_468
    val era = z.floorDiv(146_097L)
    val dayOfEra = z - era * 146_097
    val yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    val shiftedMonth = (5 * dayOfYear + 2) / 153
    val day = dayOfYear - (153 * shiftedMonth + 2) / 5 + 1
    val month = if (shiftedMonth < 10) shiftedMonth + 3 else shiftedMonth - 9
    val year = yearOfEra + era * 400 + if (month <= 2) 1 else 0
    return Triple(year, month, day)
  }

  private fun pad(value: Long, width: Int): String = value.toString().padStart(width, '0')
}
```

- [ ] **Step 4: Run it and watch it pass**

Run the Step 2 command. Expected: `EXIT=0`, and the XML count is **7**. The full suite (`./gradlew test`) gives **11**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): hand-written JSON and UTC time without java.time

minSdk 24 has no java.time, and org.json is an Android stub on the JVM.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The Kotlin core CI job

**Files:** Create `.github/workflows/kotlin-core.yml`.

**Interfaces:**

- Consumes: Task 1's `gradlew`, committed as `100755`.
- Produces: a `kotlin-core` check on every PR and on every push to main. Spec §6's CI table lists it as "Kotlin core: every push; every `core/` test; JDK 17 and Gradle, no Android SDK".

- [ ] **Step 1: Write the workflow**

`.github/workflows/kotlin-core.yml`:

```yaml
# The capture engine's pure-Kotlin core (S1 plan B; spec §6): the session
# machine and every rule P5 paid for. Its tests need JDK 17 and Gradle and
# nothing else — no Android SDK, no emulator, no device — so they run on every
# push like the domain tests in `check.yml`.
#
# A workflow of its own rather than a second job in `check.yml`: the two share
# no tools, and a red Kotlin build then names itself in the PR checks.
name: kotlin-core

# The same triggers as check.yml. No path filter: the run is short, and a
# filtered workflow that is a required check never reports on a PR it skips.
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: kotlin-core-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  kotlin-core:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: modules/capture-engine/android/core
    steps:
      - uses: actions/checkout@v5
      # The wrapper jar is a binary in the repo; refuse one Gradle did not publish.
      - uses: gradle/actions/wrapper-validation@v6
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: '17'
          cache: gradle
          cache-dependency-path: |
            modules/capture-engine/android/core/*.gradle.kts
            modules/capture-engine/android/core/gradle/wrapper/gradle-wrapper.properties
      - run: ./gradlew test --no-daemon --console=plain
```

- [ ] **Step 2: Check its format**

```bash
cd "$WT" && pnpm prettier --check .github/workflows/kotlin-core.yml > "$TMPDIR/p.txt" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. `pnpm check` does not cover `.github/` (AGENTS §13), so this step is the only check.

- [ ] **Step 3: Commit**

```bash
cd "$WT" && git add .github/workflows/kotlin-core.yml && git commit -F - <<'EOF'
ci: run the Kotlin core's tests on every push

JDK 17 and Gradle only, no Android SDK (spec §6). Wrapper validation first,
since the wrapper jar is a binary in the repo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 4: Verify on the first push**

A workflow cannot be run locally. On the batch's first push, open the PR's checks and confirm that `kotlin-core` ran and passed. Its log must show `wrapper-validation` passing and `BUILD SUCCESSFUL`. If `setup-java@v6` or `gradle/actions@v6` does not resolve, pin the newest tag of that action that does and note it; the tags were read from GitHub on 2026-09-30 (setup-java v6.0.1, gradle/actions v6.4.1).

---

## Task 4: Vocabulary, `SessionConfig` and `Snapshot`

**Files:**

- Create `K/Vocabulary.kt`, `K/SessionConfig.kt` and `K/Snapshot.kt`.
- Create `T/Configs.kt` (the test sessions), `T/VocabularyTest.kt` and `T/SessionConfigTest.kt`.

**Interfaces:**

- Consumes: `Wire`.
- Produces:
  - the enums, each a `Wire`: `ReconnectCause`, `Transport`, `DegradeReason` (most important first), `EndReason`, `Delivery`, `ShedStep`, `DropReason`, `ConnectFailure` and `HeartbeatResult`;
  - `DeviceSample`;
  - `IngestTarget = SrtTarget | RtmpsTarget`, whose `toString`s redact;
  - `SessionConfig(sid, token, primary, fallback, holdWindowSeconds: Map<Transport, Int>, playbackUrl, heartbeatUrl, appVersion)` with `target(t)`, `secrets()` and `problems()`;
  - `SnapshotState` (the TypeScript `SessionState` kinds), `SrtTelemetry`, `HeartbeatStatus` and `Snapshot`.

  Plan C builds `SessionConfig` from the parsed v2 code and the descriptor that plan A's JS hands down with the Arm intent.

- [ ] **Step 1: Write the failing tests and the test sessions**

`T/Configs.kt`:

```kotlin
package com.seazn.capture.engine.core

/** Test sessions. The secrets are made up and distinctive, so a leak is easy to search for. */
object Configs {
  const val TOKEN = "tok-9f3c2a7e5b1d4680"
  const val PASSPHRASE = "pass+phrase/6d1e8b0c"
  const val STREAM_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
  const val STREAM_KEY = "key-4c7a0e2b9d5f1386"
  const val PLAYBACK_URL = "https://customer-x.cloudflarestream.com/$STREAM_ID/manifest/video.m3u8"

  val srt = SrtTarget("srt://live.cloudflare.com:778", STREAM_ID, PASSPHRASE, latencyMs = 2_000)
  val rtmps = RtmpsTarget("rtmps://live.cloudflare.com:443/live/", STREAM_KEY)

  fun valid(
    primary: IngestTarget = srt,
    fallback: IngestTarget? = rtmps,
    holdWindowSeconds: Map<Transport, Int> = mapOf(Transport.SRT to 183, Transport.RTMPS to 180),
  ) =
    SessionConfig(
      sid = "sess_42",
      token = TOKEN,
      primary = primary,
      fallback = fallback,
      holdWindowSeconds = holdWindowSeconds,
      playbackUrl = PLAYBACK_URL,
      heartbeatUrl = "https://stg.seazn.club/api/capture/heartbeat",
      appVersion = "1.0.0",
    )
}
```

`T/VocabularyTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Expected spellings are copied from spec §2 and the existing TypeScript `SessionState.ts`. */
class VocabularyTest {
  @Test
  fun `degrade reasons are the spec's, and none is thermal`() {
    assertEquals(
      listOf("not-delivered", "camera-taken", "mic-silenced", "poor-uplink", "fell-back-to-rtmps"),
      DegradeReason.entries.map { it.wire },
    )
    assertFalse(DegradeReason.entries.any { "thermal" in it.wire })
  }

  @Test
  fun `end reasons include stopped-by-organiser`() {
    assertEquals(
      setOf("operator-stopped", "stopped-by-organiser", "hold-window-expired", "fatal-error"),
      EndReason.entries.map { it.wire }.toSet(),
    )
  }

  @Test
  fun `delivery, transports, drops and the shed ladder spell as the spec does`() {
    assertEquals(listOf("ok", "stalled", "unknown"), Delivery.entries.map { it.wire })
    assertEquals(listOf("srt", "rtmps"), Transport.entries.map { it.wire })
    assertEquals(listOf("endpoint-closed", "inputs-stopped", "requested"), DropReason.entries.map { it.wire })
    assertEquals(listOf("overlay-preview", "preview-framerate", "encode"), ShedStep.entries.map { it.wire })
    assertEquals(listOf("uplink-lost", "video-stalled", "not-delivered"), ReconnectCause.entries.map { it.wire })
  }

  @Test
  fun `snapshot states are the TypeScript SessionState kinds`() {
    val kinds =
      listOf(
        SnapshotState.Idle,
        SnapshotState.Armed,
        SnapshotState.Connecting(Transport.SRT),
        SnapshotState.Publishing(Transport.SRT, 0),
        SnapshotState.Degraded(Transport.SRT, listOf(DegradeReason.MIC_SILENCED), 0),
        SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, 0),
        SnapshotState.Ended(EndReason.OPERATOR_STOPPED),
      )
    assertEquals(
      listOf("idle", "armed", "connecting", "publishing", "degraded", "reconnecting", "ended"),
      kinds.map { it.wire },
    )
  }

  @Test
  fun `thermal travels as shed on the snapshot, outside the state`() {
    val names = Snapshot::class.java.declaredFields.map { it.name }.toSet()
    assertTrue("shed" in names)
    assertTrue("delivery" in names && "deliveredLagMs" in names && "dataUsedBytes" in names)
  }
}
```

`T/SessionConfigTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionConfigTest {
  @Test
  fun `a complete config has no problems`() {
    assertEquals(emptyList(), Configs.valid().problems())
  }

  @Test
  fun `an empty descriptor field is a problem, not a crash`() {
    val empty =
      SessionConfig(
        sid = "",
        token = "",
        primary = SrtTarget("", "", "", 0),
        fallback = RtmpsTarget("", ""),
        holdWindowSeconds = emptyMap(),
        playbackUrl = "",
        heartbeatUrl = "",
        appVersion = "",
      )
    assertEquals(
      listOf(
        "sid is blank",
        "token is blank",
        "playbackUrl is not https",
        "heartbeatUrl is not https",
        "no hold window for srt",
        "srt url is blank",
        "srt streamId is blank",
        "srt passphrase is not 10–79 characters",
        "srt latencyMs is not positive",
        "no hold window for rtmps",
        "rtmps url is blank",
        "rtmps streamKey is blank",
      ),
      empty.problems(),
    )
  }

  @Test
  fun `a fallback on the same transport as the primary is a problem`() {
    assertTrue("fallback repeats the primary transport" in Configs.valid(fallback = Configs.srt).problems())
  }

  @Test
  fun `no secret appears in any toString`() {
    val printed = listOf(Configs.valid().toString(), Configs.srt.toString(), Configs.rtmps.toString())
    for (secret in listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY)) {
      assertFalse(printed.any { secret in it }, "leaked $secret")
    }
  }

  @Test
  fun `secrets are the token, the SRT passphrase and stream id, and the RTMPS stream key`() {
    assertEquals(
      setOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY),
      Configs.valid().secrets().toSet(),
    )
  }
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*VocabularyTest' --tests '*SessionConfigTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `Configs.kt:11:13 Unresolved reference 'SrtTarget'.`

- [ ] **Step 3: Write the three files**

`K/Vocabulary.kt`:

```kotlin
package com.seazn.capture.engine.core

/** Why a live session is reconnecting. */
enum class ReconnectCause(override val wire: String) : Wire {
  UPLINK_LOST("uplink-lost"),
  VIDEO_STALLED("video-stalled"),
  NOT_DELIVERED("not-delivered"),
}

enum class Transport(override val wire: String) : Wire {
  SRT("srt"),
  RTMPS("rtmps"),
}

/**
 * Why the broadcast is impaired (spec §2). Declared most important first; the snapshot lists the
 * active ones in this order, so the first is the one the status line names.
 *
 * Deliberately absent: thermal. A hot phone is a device condition and travels as `shed` (AGENTS §8).
 * Also absent: `audio-below-floor`. The level floor stays a TypeScript display selector (spec §2,
 * "`audioFloor` stays"), so native never decides it.
 */
enum class DegradeReason(override val wire: String) : Wire {
  NOT_DELIVERED("not-delivered"),
  CAMERA_TAKEN("camera-taken"),
  MIC_SILENCED("mic-silenced"),
  POOR_UPLINK("poor-uplink"),
  FELL_BACK_TO_RTMPS("fell-back-to-rtmps"),
}

enum class EndReason(override val wire: String) : Wire {
  OPERATOR_STOPPED("operator-stopped"),
  STOPPED_BY_ORGANISER("stopped-by-organiser"),
  HOLD_WINDOW_EXPIRED("hold-window-expired"),
  FATAL_ERROR("fatal-error"),
}

/** What the delivered playlist says (F-P5-13): moving, not moving, or no evidence either way. */
enum class Delivery(override val wire: String) : Wire {
  OK("ok"),
  STALLED("stalled"),
  UNKNOWN("unknown"),
}

/** The degradation ladder (AGENTS §8), in order, never reordered. */
enum class ShedStep(override val wire: String) : Wire {
  OVERLAY_PREVIEW("overlay-preview"),
  PREVIEW_FRAMERATE("preview-framerate"),
  ENCODE("encode"),
}

/** Why an attempt stopped publishing, as the platform tells it apart (P5 rehearsal R3). */
enum class DropReason(override val wire: String) : Wire {
  ENDPOINT_CLOSED("endpoint-closed"),
  INPUTS_STOPPED("inputs-stopped"),
  REQUESTED("requested"),
}

enum class ConnectFailure(override val wire: String) : Wire {
  /** The host did not resolve. The platform resolves first and reports this (F-P5-1). */
  UNRESOLVED("unresolved"),
  /** The ingest refused the publish. Checked against the descriptor before it means anything. */
  REFUSED("refused"),
  TIMEOUT("timeout"),
  OTHER("other"),
}

enum class HeartbeatResult(override val wire: String) : Wire {
  OK("ok"),
  FAILED("failed"),
  SESSION_OVER("session-over"),
}

/** Device conditions the platform reads (thermal, battery). Relayed, never judged (AGENTS §8). */
data class DeviceSample(
  val thermalStatus: Int?,
  /** API 30+; the platform passes null where it reads −1 (P5, Redmi Note 7 Pro). */
  val thermalHeadroom: Double?,
  val batteryPercent: Int?,
  val charging: Boolean?,
  /** From the charge counter, computed by the platform: P5 found the percentage unreliable for drain. */
  val drainPctPerHour: Double?,
  val shed: ShedStep?,
)
```

`K/SessionConfig.kt`:

```kotlin
package com.seazn.capture.engine.core

/** Where one transport publishes. `toString` never prints a secret: these objects reach logs. */
sealed interface IngestTarget {
  val transport: Transport
}

/** The SRT fields stay separate and canonical (spec §2, lane D); the platform composes the query string. */
class SrtTarget(val url: String, val streamId: String, val passphrase: String, val latencyMs: Int) :
  IngestTarget {
  override val transport = Transport.SRT

  override fun toString(): String =
    "SrtTarget(streamId=<${streamId.length} chars>, passphrase=<${passphrase.length} chars>, latencyMs=$latencyMs)"
}

class RtmpsTarget(val url: String, val streamKey: String) : IngestTarget {
  override val transport = Transport.RTMPS

  override fun toString(): String = "RtmpsTarget(url=$url, streamKey=<${streamKey.length} chars>)"
}

/**
 * What `arm` hands the engine (spec §2: `{session, heartbeat}`), flattened by the bridge. [primary]
 * and [fallback] are already ordered by the code's `preferred`.
 */
class SessionConfig(
  val sid: String,
  /** The per-session `tok`: Bearer for the heartbeat and the descriptor (decision 4). A secret. */
  val token: String,
  val primary: IngestTarget,
  val fallback: IngestTarget?,
  val holdWindowSeconds: Map<Transport, Int>,
  val playbackUrl: String,
  val heartbeatUrl: String,
  val appVersion: String,
) {
  fun target(transport: Transport): IngestTarget? =
    listOfNotNull(primary, fallback).firstOrNull { it.transport == transport }

  /** Values the record must never carry, whatever key they arrive under. Blank ones are no secret. */
  fun secrets(): List<String> {
    val srt = listOfNotNull(primary, fallback).filterIsInstance<SrtTarget>()
    val rtmps = listOfNotNull(primary, fallback).filterIsInstance<RtmpsTarget>()
    return (listOf(token) + srt.flatMap { listOf(it.passphrase, it.streamId) } + rtmps.map { it.streamKey })
      .filter { it.isNotBlank() }
  }

  /** Every reason this config cannot run a session; empty when it can. Checked at arm. */
  fun problems(): List<String> = buildList {
    if (sid.isBlank()) add("sid is blank")
    if (token.isBlank()) add("token is blank")
    if (fallback?.transport == primary.transport) add("fallback repeats the primary transport")
    if (!playbackUrl.startsWith("https://")) add("playbackUrl is not https")
    if (!heartbeatUrl.startsWith("https://")) add("heartbeatUrl is not https")
    for (target in listOfNotNull(primary, fallback)) addAll(targetProblems(target))
  }

  private fun targetProblems(target: IngestTarget): List<String> = buildList {
    val window = holdWindowSeconds[target.transport]
    if (window == null || window <= 0) add("no hold window for ${target.transport.wire}")
    when (target) {
      is SrtTarget -> {
        if (target.url.isBlank()) add("srt url is blank")
        if (target.streamId.isBlank()) add("srt streamId is blank")
        // libsrt accepts a passphrase of 10–79 characters (P5, F-P5-1's ruled-out list).
        if (target.passphrase.length !in 10..79) add("srt passphrase is not 10–79 characters")
        if (target.latencyMs <= 0) add("srt latencyMs is not positive")
      }
      is RtmpsTarget -> {
        if (target.url.isBlank()) add("rtmps url is blank")
        if (target.streamKey.isBlank()) add("rtmps streamKey is blank")
      }
    }
  }

  override fun toString(): String =
    "SessionConfig(sid=$sid, token=<${token.length} chars>, primary=$primary, fallback=$fallback)"
}
```

`K/Snapshot.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * The session state as the snapshot carries it (spec §2: "the snapshot carries `state` directly").
 * One member per TypeScript `SessionState` kind; the bridge (plan C) maps [wire] and the fields.
 */
sealed interface SnapshotState : Wire {
  data object Idle : SnapshotState {
    override val wire = "idle"
  }

  data object Armed : SnapshotState {
    override val wire = "armed"
  }

  data class Connecting(val transport: Transport) : SnapshotState {
    override val wire = "connecting"
  }

  /** LIVE. Only while encoded video frames advance (F-P5-6). */
  data class Publishing(val transport: Transport, val sinceEpochMs: Long) : SnapshotState {
    override val wire = "publishing"
  }

  /** Frames advance, but something the operator must see is wrong. [reasons] is never empty. */
  data class Degraded(val transport: Transport, val reasons: List<DegradeReason>, val sinceEpochMs: Long) :
    SnapshotState {
    override val wire = "degraded"
  }

  /**
   * Not publishing since the session was live, while the platform holds the input: "Uplink lost —
   * holding, 38 s of 183". [cause] lets the status line say which: a lost uplink, a rebuild, or a
   * restart because viewers were not receiving.
   */
  data class Reconnecting(
    val cause: ReconnectCause,
    val holdRemainingSeconds: Int,
    val holdWindowSeconds: Int,
    val sinceEpochMs: Long,
  ) : SnapshotState {
    override val wire = "reconnecting"
  }

  data class Ended(val reason: EndReason) : SnapshotState {
    override val wire = "ended"
  }
}

/** SRT's own counters for the attempt (F-P5-4's retry requirement), cumulative since it connected. */
data class SrtTelemetry(val sent: Long, val retransmitted: Long, val dropped: Long, val rttMs: Int?)

data class HeartbeatStatus(
  val lastSentAtEpochMs: Long?,
  val lastResult: HeartbeatResult?,
  val consecutiveFailures: Int,
  val failures: Int,
)

/**
 * The ~1 Hz upward contract (AGENTS §2). Field names follow spec §2's wording; plan A defines the
 * TypeScript shape and plan C's bridge maps one to the other.
 */
data class Snapshot(
  val state: SnapshotState,
  val reportedAtMs: Long,
  val delivery: Delivery,
  val deliveredLagMs: Long?,
  val encodedVideoFps: Double?,
  val audioPacketsPerSecond: Double?,
  val srt: SrtTelemetry?,
  /** Measured egress, what actually left the phone. */
  val bitrateKbps: Int?,
  /** The regulator's video target. */
  val targetBitrateKbps: Int?,
  val dataUsedBytes: Long,
  val charging: Boolean?,
  val heartbeat: HeartbeatStatus,
  val shed: ShedStep?,
  val device: DeviceSample?,
)
```

- [ ] **Step 4: Run them and watch them pass**

Run the Step 2 command. Expected: `EXIT=0` and **10** tests (5 + 5). The full suite gives **21**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): session vocabulary, config and snapshot

Thermal is not a degrade reason (AGENTS §8); audio-below-floor stays in TS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Link meter and `SrtBandwidth` (F-P5-11)

**Files:** Create `K/Link.kt` and `T/LinkTest.kt`.

**Interfaces:**

- Consumes: nothing beyond Kotlin.
- Produces:
  - `Encode` (`CEILING_BPS` 3 000 000, `FLOOR_BPS` 500 000, `START_BPS` 1 500 000, `AUDIO_BPS` 128 000, `EGRESS_OVERHEAD_PERCENT` 115, `expectedEgressBps(target)`);
  - `LinkCounters`, the cumulative counters plan C reads from the SRT socket or the RTMPS client once a second;
  - `LinkSample`;
  - `LinkMeter.read(counters, nowMs): Pair<LinkMeter, LinkSample>`, where a counter that goes backwards is no reading;
  - `SrtBandwidth.maxBwBytesPerSecond(target)`.

- [ ] **Step 1: Write the failing test**

`T/LinkTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LinkTest {
  private fun counters(bytes: Long, dropped: Long = 0, lost: Long = 0, buffer: Int? = 50) =
    LinkCounters(bytes, 0, 0, dropped, lost, 20, buffer, null)

  @Test
  fun `the first reading has no interval, so no egress`() {
    val (_, sample) = LinkMeter().read(counters(1_000), nowMs = 1_000)
    assertNull(sample.egressBps)
    assertEquals(0, sample.bytes)
  }

  @Test
  fun `egress is bits per second over the real interval`() {
    val (meter, _) = LinkMeter().read(counters(0), nowMs = 1_000)
    val (_, sample) = meter.read(counters(250_000), nowMs = 3_000)
    assertEquals(1_000_000, sample.egressBps)
    assertEquals(250_000, sample.bytes)
  }

  @Test
  fun `drops and losses are deltas`() {
    val (meter, _) = LinkMeter().read(counters(0, dropped = 249, lost = 10), nowMs = 0)
    val (_, sample) = meter.read(counters(0, dropped = 528, lost = 10), nowMs = 1_000)
    assertEquals(279, sample.droppedPackets)
    assertEquals(0, sample.lostPackets)
  }

  @Test
  fun `a counter that went backwards is no reading, not a negative one`() {
    val (meter, _) = LinkMeter().read(counters(5_000, dropped = 10), nowMs = 0)
    val (_, sample) = meter.read(counters(1_000, dropped = 2), nowMs = 1_000)
    assertNull(sample.egressBps)
    assertEquals(0, sample.bytes)
    assertEquals(0, sample.droppedPackets)
  }

  // Expected bytes/s worked by hand from the rule: (target + 128k) × 115% × 2 / 8.
  @Test
  fun `F-P5-11 SRTO_MAXBW follows the target`() {
    assertEquals(180_550, SrtBandwidth.maxBwBytesPerSecond(500_000))
    assertEquals(468_050, SrtBandwidth.maxBwBytesPerSecond(1_500_000))
    assertEquals(899_300, SrtBandwidth.maxBwBytesPerSecond(3_000_000))
  }

  @Test
  fun `F-P5-11 the cap at the floor sits under the throttled link and over the encoder's measured overshoot`() {
    val capBps = SrtBandwidth.maxBwBytesPerSecond(Encode.FLOOR_BPS) * 8
    assertTrue(capBps < 1_500_000, "P5's thin link was 1.5 Mbps; the burst was 13.9–17 Mbps")
    assertTrue(capBps > 1_000_000, "a 500k target measured 0.95–1.0 Mbps on a busy picture")
  }

  @Test
  fun `a target outside the encode range is capped as the range`() {
    assertEquals(SrtBandwidth.maxBwBytesPerSecond(3_000_000), SrtBandwidth.maxBwBytesPerSecond(9_000_000))
    assertEquals(SrtBandwidth.maxBwBytesPerSecond(500_000), SrtBandwidth.maxBwBytesPerSecond(0))
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*LinkTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `LinkTest.kt:10:5 Unresolved reference 'LinkCounters'.`

- [ ] **Step 3: Write `Link.kt`**

`K/Link.kt`:

```kotlin
package com.seazn.capture.engine.core

/** The encode's fixed numbers (decision 3; AGENTS §8's ceiling). */
object Encode {
  const val CEILING_BPS = 3_000_000
  const val FLOOR_BPS = 500_000
  const val START_BPS = 1_500_000

  /** AAC at 128k, set at arm and never regulated. */
  const val AUDIO_BPS = 128_000

  /** Expected egress is (video + audio) × 115%: TS packaging and retransmits (F-P5-7). */
  const val EGRESS_OVERHEAD_PERCENT = 115L

  fun expectedEgressBps(videoTargetBps: Int): Long =
    (videoTargetBps + AUDIO_BPS).toLong() * EGRESS_OVERHEAD_PERCENT / 100
}

/**
 * Cumulative counters the platform reads about once a second: `srt_bistats` for SRT, StreamPack's
 * endpoint metrics for RTMPS. They restart at zero on every connect.
 */
data class LinkCounters(
  val bytesSent: Long,
  val packetsSent: Long,
  val packetsRetransmitted: Long,
  /** Sender drops: SRT's too-late packets, or StreamPack's RTMP queue overflowing. */
  val packetsDropped: Long,
  /** SRT's `pktSndLoss`. RTMPS reports none. */
  val packetsLost: Long,
  val rttMs: Int?,
  /** SRT's `msSndBuf`. Negative readings happen (P5: −336) and are no reading. */
  val sendBufferMs: Int?,
  /** SRT's bandwidth estimate. It sizes a cut and never triggers one (F-P5-5). */
  val bandwidthBps: Long?,
)

/** One reading of the link, as deltas since the last one. */
data class LinkSample(
  val droppedPackets: Long,
  val lostPackets: Long,
  val sendBufferMs: Int?,
  val bandwidthBps: Long?,
  /** Bits per second written since the last reading; null when there is no interval to judge. */
  val egressBps: Long?,
  /** Bytes written since the last reading, for data used. */
  val bytes: Long,
)

/** Turns cumulative counters into [LinkSample]s. A counter that went backwards counts as none. */
data class LinkMeter(val last: LinkCounters? = null, val lastAtMs: Long = 0) {
  fun read(counters: LinkCounters, nowMs: Long): Pair<LinkMeter, LinkSample> {
    val previous = last
    val elapsedMs = nowMs - lastAtMs
    val bytes = previous?.let { (counters.bytesSent - it.bytesSent).coerceAtLeast(0) } ?: 0
    val egress =
      if (previous == null || elapsedMs <= 0 || counters.bytesSent < previous.bytesSent) null
      else bytes * 8_000 / elapsedMs
    val sample =
      LinkSample(
        droppedPackets = delta(previous?.packetsDropped, counters.packetsDropped),
        lostPackets = delta(previous?.packetsLost, counters.packetsLost),
        sendBufferMs = counters.sendBufferMs,
        bandwidthBps = counters.bandwidthBps,
        egressBps = egress,
        bytes = bytes,
      )
    return LinkMeter(counters, nowMs) to sample
  }

  private fun delta(previous: Long?, now: Long): Long = previous?.let { (now - it).coerceAtLeast(0) } ?: 0
}

/**
 * F-P5-11: libsrt paces nothing in live mode unless told (`SRTO_MAXBW` defaults to −1), so a thin
 * link got its backlog dumped at 13.9–17 Mbps. The cap follows the regulator's target.
 */
object SrtBandwidth {
  /**
   * VBR overshoots its target: 0.95–1.0 Mbps at a 500k target on a busy picture (F-P5-7's thin-link
   * run), ~1.4× the expected egress. Twice the expected egress leaves that room plus retransmits,
   * and still bounds the burst to about the link P5 throttled to.
   */
  const val OVERSHOOT_FACTOR = 2L

  /** `SRTO_MAXBW`, in bytes per second, for a video target. */
  fun maxBwBytesPerSecond(videoTargetBps: Int): Long {
    val target = videoTargetBps.coerceIn(Encode.FLOOR_BPS, Encode.CEILING_BPS)
    return Encode.expectedEgressBps(target) * OVERSHOOT_FACTOR / 8
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **7** tests. The full suite gives **28**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): link meter and SRT max bandwidth (F-P5-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 6: `BitrateRegulator` (F-P5-5, F-P5-7, regulator restart)

**Files:** Create `K/BitrateRegulator.kt` and `T/BitrateRegulatorTest.kt`.

**Interfaces:**

- Consumes: `Encode`, `LinkSample`, `Transport`.
- Produces:
  - `Regulation`, the regulator's immutable state;
  - `FailedRate`;
  - the functions `BitrateRegulator.sessionStarted()`, `attemptStarted(state)`, `afterDrop(state, nowMs)`, `next(state, link, nowMs, transport, srtLatencyMs)` and `raiseCap(state, nowMs)`;
  - the constants `RAISE_STEP_BPS`, `RAISE_INTERVAL_MS`, `RAISE_AFTER_CUT_MS`, `TESTED_PERCENT`, `FAILED_RATE_MEMORY_MS`, `FAILED_RATE_PERCENT`, `FAILING_LOOKBACK_MS` and `RTMPS_DRAIN_MS`.

- [ ] **Step 1: Write the failing test**

`T/BitrateRegulatorTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Every number here is quoted from the P5 results or worked by hand from the rule it names. */
class BitrateRegulatorTest {
  private val latency = 2_000

  private fun reading(
    egress: Long? = 4_000_000,
    buffer: Int? = 50,
    dropped: Long = 0,
    lost: Long = 0,
    estimate: Long? = null,
  ) = LinkSample(dropped, lost, buffer, estimate, egress, bytes = 0)

  /** One reading a second from [fromMs] to [toMs] inclusive, SRT unless told otherwise. */
  private fun run(
    start: Regulation,
    fromMs: Long,
    toMs: Long,
    transport: Transport = Transport.SRT,
    sample: (Long) -> LinkSample = { reading() },
  ): Regulation {
    var state = start
    var t = fromMs
    while (t <= toMs) {
      state = BitrateRegulator.next(state, sample(t), t, transport, latency)
      t += 1_000
    }
    return state
  }

  @Test
  fun `F-P5-5 a session starts at 1500k`() {
    assertEquals(1_500_000, BitrateRegulator.sessionStarted().targetBps)
  }

  @Test
  fun `F-P5-7 a tested clean interval raises 100k per 10 s`() {
    val start = BitrateRegulator.sessionStarted()
    assertEquals(1_500_000, run(start, 1_000, 10_000).targetBps)
    assertEquals(1_600_000, run(start, 1_000, 11_000).targetBps)
    assertEquals(1_700_000, run(start, 1_000, 21_000).targetBps)
  }

  @Test
  fun `F-P5-7 a quiet picture does not raise in 80 s`() {
    // P5, 15:58:54Z: egress ~0.5 Mbps, 0.15–0.17 of expected at 2700k. No raise in 80 s.
    val quiet = run(Regulation(2_700_000), 1_000, 80_000) { reading(egress = 500_000, buffer = 43) }
    assertEquals(2_700_000, quiet.targetBps)
  }

  @Test
  fun `F-P5-7 the raise gate is 70 percent of (target + 128k) x 1_15`() {
    // (1_500_000 + 128_000) × 1.15 = 1_872_200; 70% of that is 1_310_540.
    val atGate = run(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 1_310_540) }
    val underGate = run(Regulation(1_500_000), 1_000, 11_000) { reading(egress = 1_310_539) }
    assertEquals(1_600_000, atGate.targetBps)
    assertEquals(1_500_000, underGate.targetBps)
  }

  @Test
  fun `the target never passes 3000k`() {
    val start = Regulation(2_950_000)
    assertEquals(3_000_000, run(start, 1_000, 11_000).targetBps)
    assertEquals(3_000_000, run(start, 1_000, 31_000).targetBps)
  }

  @Test
  fun `the target never falls under 500k`() {
    val state = run(Regulation(600_000), 1_000, 1_000) { reading(dropped = 40) }
    assertEquals(500_000, state.targetBps)
  }

  @Test
  fun `F-P5-5 sender drops halve the target`() {
    val state = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 10) }
    assertEquals(1_500_000, state.targetBps)
    assertEquals(FailedRate(3_000_000, 1_000), state.failed)
  }

  @Test
  fun `F-P5-5 a backlog of half the latency cuts by a quarter`() {
    val state = run(Regulation(3_000_000), 1_000, 1_000) { reading(buffer = 1_000) }
    assertEquals(2_250_000, state.targetBps)
  }

  @Test
  fun `F-P5-5 a cut is sized from what the link carried`() {
    // P5 retuned-regulator table: "3000k → 1552000 on a 1.1 s send buffer with no drops".
    // 2_415_000 × 80 / 115 − 128_000 = 1_552_000.
    val carried = run(Regulation(3_000_000), 1_000, 10_000) { reading(egress = 2_415_000) }
    val cut = run(carried, 11_000, 11_000) { reading(egress = 2_415_000, buffer = 1_100) }
    assertEquals(1_552_000, cut.targetBps)
  }

  @Test
  fun `F-P5-5 SRT's estimate sizes a cut and never triggers one`() {
    val clean = run(Regulation(2_000_000), 1_000, 1_000) { reading(estimate = 300_000) }
    assertEquals(2_000_000, clean.targetBps)
    // 1_000_000 × 80% − 128_000 = 672_000, under the halving's 1_500_000.
    val cut = run(Regulation(3_000_000), 1_000, 1_000) { reading(dropped = 5, estimate = 1_000_000) }
    assertEquals(672_000, cut.targetBps)
  }

  @Test
  fun `F-P5-7 a failed rate caps raises at 80 percent for 5 min`() {
    // P5 device table: "Caps at 1200000, 1401600 and 630720 (80% of 1500k, 1752k, 788.4k)".
    for ((failed, cap) in listOf(1_500_000 to 1_200_000, 1_752_000 to 1_401_600, 788_400 to 630_720)) {
      assertEquals(cap, BitrateRegulator.raiseCap(Regulation(500_000, failed = FailedRate(failed, 0)), 1_000))
    }
    val start = Regulation(1_300_000, lastCutAtMs = 0, failed = FailedRate(1_752_000, 0))
    assertEquals(1_401_600, run(start, 1_000, 299_000).targetBps)
    assertEquals(1_501_600, run(start, 1_000, 300_000).targetBps)
  }

  @Test
  fun `no raise within 30 s of a cut`() {
    val start = Regulation(1_000_000, lastCutAtMs = 0)
    assertEquals(1_000_000, run(start, 1_000, 29_000).targetBps)
    assertEquals(1_100_000, run(start, 1_000, 30_000).targetBps)
  }

  @Test
  fun `drops inside one latency of a cut are the old rate draining`() {
    val start = Regulation(3_000_000)
    assertEquals(1_500_000, run(start, 1_000, 2_000) { reading(dropped = 9) }.targetBps)
    assertEquals(750_000, run(start, 1_000, 3_000) { reading(dropped = 9) }.targetBps)
  }

  @Test
  fun `a negative send buffer is no reading`() {
    // P5: SRT reported −336 and −90; negatives must stay out of every threshold.
    val state = run(Regulation(2_000_000), 1_000, 20_000) { reading(buffer = -336) }
    assertEquals(2_000_000, state.targetBps)
    assertNull(state.cleanSinceMs)
  }

  @Test
  fun `regulator restart - a clean far-end drop restarts at the last healthy target`() {
    // P5 final soak: Cloudflare stopped acknowledging on a clean link (no loss), the buffer filled,
    // the sender dropped late packets, and the old build restarted at 1500k → 516k → 500k.
    val healthy = run(BitrateRegulator.sessionStarted(), 1_000, 5_000) { reading(egress = 1_900_000) }
    val filling = run(healthy, 6_000, 6_000) { reading(buffer = 1_200) }
    val dropping = run(filling, 9_000, 9_000) { reading(buffer = 2_000, dropped = 300) }
    assertEquals(1_125_000, filling.targetBps)
    assertEquals(562_500, dropping.targetBps)
    val restarted = BitrateRegulator.afterDrop(dropping, nowMs = 12_000)
    assertEquals(1_500_000, restarted.targetBps)
    assertNull(restarted.failed)
  }

  @Test
  fun `regulator restart - a link that was failing halves`() {
    val lossy = run(Regulation(1_500_000), 1_000, 1_000) { reading(lost = 5) }
    assertEquals(750_000, BitrateRegulator.afterDrop(lossy, nowMs = 5_000).targetBps)
    assertEquals(1_500_000, BitrateRegulator.afterDrop(lossy, nowMs = 12_000).targetBps)
  }

  @Test
  fun `on RTMPS the failing signal is sender drops, since RTMPS reports no loss`() {
    val dropped = run(Regulation(2_000_000), 1_000, 1_000, Transport.RTMPS) { reading(buffer = null, dropped = 3) }
    assertEquals(1_000_000, dropped.targetBps)
    assertEquals(500_000, BitrateRegulator.afterDrop(dropped, nowMs = 2_000).targetBps)
  }

  @Test
  fun `a requested reconnect keeps the target`() {
    // P5 device table: "Reconnect at the last target: 3000k after the stall recovery".
    val state = BitrateRegulator.attemptStarted(Regulation(3_000_000, cleanSinceMs = 4_000))
    assertEquals(3_000_000, state.targetBps)
    assertNull(state.cleanSinceMs)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*BitrateRegulatorTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `BitrateRegulatorTest.kt:21:12 Unresolved reference 'Regulation'.`

- [ ] **Step 3: Write `BitrateRegulator.kt`**

`K/BitrateRegulator.kt`:

```kotlin
package com.seazn.capture.engine.core

/** A target the link failed to carry, and when. */
data class FailedRate(val bps: Int, val atMs: Long)

/** What the regulator remembers between readings, and across the attempts of one session. */
data class Regulation(
  val targetBps: Int,
  val lastCutAtMs: Long? = null,
  val lastRaiseAtMs: Long? = null,
  /** Where the current clean interval began; null until the next clean reading. */
  val cleanSinceMs: Long? = null,
  val failed: FailedRate? = null,
  /** Egress of the most recent clean readings, oldest first, at most [BitrateRegulator.CLEAN_EGRESS_TICKS]. */
  val cleanEgressBps: List<Long> = emptyList(),
  /** How many of [cleanEgressBps]'s newest entries fall inside the current clean interval. */
  val intervalEgressTicks: Int = 0,
  /** The target at the last clean reading: what a far-end drop restarts at. */
  val healthyTargetBps: Int = targetBps,
  val healthyAtMs: Long? = null,
  /** The last reading where the link itself was failing: loss on SRT, sender drops on RTMPS. */
  val failingAtMs: Long? = null,
)

/**
 * F-P5-5: nothing regulated the encoder, so a VBR burst the uplink could not carry was delivered as
 * nothing. One reading in, the next video target out. Audio, resolution and frame rate are never
 * touched. The triggers are sender drops and the send buffer; SRT's bandwidth estimate only sizes a
 * cut, because in Soak A it was wrong in both directions.
 */
object BitrateRegulator {
  const val RAISE_STEP_BPS = 100_000
  const val RAISE_INTERVAL_MS = 10_000L

  /** A cut means the link just failed the old rate. Probing straight back would recreate the overload. */
  const val RAISE_AFTER_CUT_MS = 30_000L

  /** F-P5-7's raise gate: the interval's mean egress at 70% or more of the target's expected egress. */
  const val TESTED_PERCENT = 70L
  const val FAILED_RATE_MEMORY_MS = 300_000L
  const val FAILED_RATE_PERCENT = 80
  const val CLEAN_EGRESS_TICKS = 10

  /** A drop within this long of the link failing restarts at half; later, at the healthy target. */
  const val FAILING_LOOKBACK_MS = 10_000L

  /** RTMPS has no latency window. How long a cut waits before drops speak for the new rate. */
  const val RTMPS_DRAIN_MS = 2_000
  private const val CUT_ON_DROPS_PERCENT = 50L
  private const val CUT_ON_BACKLOG_PERCENT = 75L
  private const val ESTIMATE_HEADROOM_PERCENT = 80L
  private const val EGRESS_HEADROOM_PERCENT = 80L

  /** Clean means a send buffer under a tenth of the latency: drained, not merely draining. */
  private const val CLEAN_BUFFER_DIVISOR = 10

  fun sessionStarted(): Regulation = Regulation(Encode.START_BPS)

  /** A new attempt keeps the target, the cut and the failed rate. Only the clean interval restarts. */
  fun attemptStarted(state: Regulation): Regulation = state.cleanWaitRestarted(null)

  /**
   * The regulator restart (P5 final soak): a drop after a clean link was the far end's, and restarts
   * at the last healthy target. Only a link that was failing within [FAILING_LOOKBACK_MS] halves.
   */
  fun afterDrop(state: Regulation, nowMs: Long): Regulation {
    val failing = state.failingAtMs?.let { nowMs - it <= FAILING_LOOKBACK_MS } ?: false
    if (failing) {
      val halved = (state.targetBps / 2).coerceAtLeast(Encode.FLOOR_BPS)
      return state
        .copy(targetBps = halved, lastCutAtMs = nowMs, failed = FailedRate(state.targetBps, nowMs))
        .cleanWaitRestarted(null)
    }
    val healthySince = state.healthyAtMs ?: Long.MIN_VALUE
    val failedInEpisode = state.failed?.let { it.atMs > healthySince } ?: false
    return state
      .copy(targetBps = state.healthyTargetBps, failed = if (failedInEpisode) null else state.failed)
      .cleanWaitRestarted(null)
  }

  /** @param link null when nothing could be read, which holds like a negative send buffer. */
  fun next(state: Regulation, link: LinkSample?, nowMs: Long, transport: Transport, srtLatencyMs: Int): Regulation {
    val current = state.copy(targetBps = state.targetBps.coerceIn(Encode.FLOOR_BPS, Encode.CEILING_BPS))
    val reading = link?.sendBufferMs
    if (link == null || (reading != null && reading < 0)) {
      val lossy = link != null && (link.droppedPackets > 0 || link.lostPackets > 0)
      return if (lossy) current.cleanWaitRestarted(nowMs) else current
    }
    val windowMs = if (transport == Transport.SRT) srtLatencyMs else RTMPS_DRAIN_MS
    val marked = if (failing(link, transport)) current.copy(failingAtMs = nowMs) else current
    val sendBufferMs = reading ?: 0
    val dropping = link.droppedPackets > 0
    val backlogged = sendBufferMs >= windowMs / 2
    val draining = marked.lastCutAtMs?.let { nowMs - it < windowMs } ?: false
    val clean = !dropping && link.lostPackets <= 0 && sendBufferMs < windowMs / CLEAN_BUFFER_DIVISOR
    return when {
      (dropping || backlogged) && !draining ->
        cut(marked, link, nowMs, if (dropping) CUT_ON_DROPS_PERCENT else CUT_ON_BACKLOG_PERCENT)
      !clean -> marked.cleanWaitRestarted(nowMs)
      else -> raiseIfDue(carriedCleanly(marked, link, nowMs), nowMs)
    }
  }

  /** 80% of a rate that failed less than [FAILED_RATE_MEMORY_MS] ago; otherwise the ceiling. */
  fun raiseCap(state: Regulation, nowMs: Long): Int =
    state.failed
      ?.takeIf { nowMs - it.atMs < FAILED_RATE_MEMORY_MS }
      ?.let { it.bps / 100 * FAILED_RATE_PERCENT } ?: Encode.CEILING_BPS

  /** Loss is the SRT link failing; a far end that stops acknowledging drops packets but reports none. */
  private fun failing(link: LinkSample, transport: Transport): Boolean =
    if (transport == Transport.SRT) link.lostPackets > 0 else link.droppedPackets > 0

  private fun cut(state: Regulation, link: LinkSample, nowMs: Long, percent: Long): Regulation {
    val byFactor = state.targetBps.toLong() * percent / 100
    val byEstimate =
      link.bandwidthBps?.takeIf { it > 0 }?.let { it * ESTIMATE_HEADROOM_PERCENT / 100 - Encode.AUDIO_BPS }
        ?: Long.MAX_VALUE
    val byEgress =
      state.cleanEgressBps
        .takeIf { it.isNotEmpty() }
        ?.let { it.sum() / it.size * EGRESS_HEADROOM_PERCENT / Encode.EGRESS_OVERHEAD_PERCENT - Encode.AUDIO_BPS }
        ?: Long.MAX_VALUE
    val target = minOf(byFactor, byEstimate, byEgress).coerceIn(Encode.FLOOR_BPS.toLong(), state.targetBps.toLong())
    return state
      .copy(targetBps = target.toInt(), lastCutAtMs = nowMs, failed = FailedRate(state.targetBps, nowMs))
      .cleanWaitRestarted(nowMs)
  }

  private fun carriedCleanly(state: Regulation, link: LinkSample, nowMs: Long): Regulation {
    val interval =
      state.copy(
        cleanSinceMs = state.cleanSinceMs ?: nowMs,
        healthyTargetBps = state.targetBps,
        healthyAtMs = nowMs,
      )
    val egress = link.egressBps ?: return interval
    return interval.copy(
      cleanEgressBps = (state.cleanEgressBps + egress).takeLast(CLEAN_EGRESS_TICKS),
      intervalEgressTicks = (state.intervalEgressTicks + 1).coerceAtMost(CLEAN_EGRESS_TICKS),
    )
  }

  /** A due raise the interval did not test restarts the wait (F-P5-7): a quiet picture holds. */
  private fun raiseIfDue(state: Regulation, nowMs: Long): Regulation {
    val due =
      since(state.cleanSinceMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastRaiseAtMs, nowMs) >= RAISE_INTERVAL_MS &&
        since(state.lastCutAtMs, nowMs) >= RAISE_AFTER_CUT_MS
    val raised = minOf(state.targetBps + RAISE_STEP_BPS, Encode.CEILING_BPS, raiseCap(state, nowMs))
    return when {
      !due || raised <= state.targetBps -> state
      tested(state) -> state.copy(targetBps = raised, lastRaiseAtMs = nowMs).cleanWaitRestarted(nowMs)
      else -> state.cleanWaitRestarted(nowMs)
    }
  }

  private fun tested(state: Regulation): Boolean {
    val readings = state.cleanEgressBps.takeLast(state.intervalEgressTicks).ifEmpty { return false }
    return readings.sum() / readings.size * 100 >= Encode.expectedEgressBps(state.targetBps) * TESTED_PERCENT
  }

  private fun Regulation.cleanWaitRestarted(atMs: Long?): Regulation =
    copy(cleanSinceMs = atMs, intervalEgressTicks = 0)

  private fun since(atMs: Long?, nowMs: Long): Long = atMs?.let { nowMs - it } ?: Long.MAX_VALUE
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **18** tests. The full suite gives **46**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): bitrate regulator that restarts, not halves, after a clean drop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 7: `FallbackPolicy` (C1, F-P5-1, F-P5-2)

**Files:** Create `K/FallbackPolicy.kt` and `T/FallbackPolicyTest.kt`.

**Interfaces:**

- Consumes: `Transport`, `ConnectFailure`, `DropReason`.
- Produces:
  - `FallbackPolicy(primary, fallback, current, count)`, with `connectFailed(failure, networkValidated)`, `dropped(reason, networkValidated, publishedMs)` and `fellBack`;
  - `FallbackDecision(policy, counted, fellBack)`;
  - the constants `FAILURES_TO_FALL_BACK` 3 and `SHORT_ATTEMPT_MS` 25 000.

  Plan C must resolve the host before connecting, report `UNRESOLVED` for an `UnknownHostException`, and send `Input.Network(validated)` from `NetworkCapabilities` (F-P5-1).

- [ ] **Step 1: Write the failing test**

`T/FallbackPolicyTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FallbackPolicyTest {
  private val start = FallbackPolicy(Transport.SRT, Transport.RTMPS)

  private fun FallbackPolicy.failConnect(times: Int, failure: ConnectFailure = ConnectFailure.TIMEOUT, validated: Boolean = true) =
    (1..times).fold(this) { policy, _ -> policy.connectFailed(failure, validated).policy }

  @Test
  fun `C1 three validated connect failures fall back to RTMPS`() {
    val twice = start.failConnect(2)
    assertEquals(Transport.SRT, twice.current)
    val third = twice.connectFailed(ConnectFailure.TIMEOUT, networkValidated = true)
    assertTrue(third.fellBack)
    assertEquals(Transport.RTMPS, third.policy.current)
    assertTrue(third.policy.fellBack)
  }

  @Test
  fun `F-P5-1 a failure on a network that is not validated does not count`() {
    // The 20 s cut: "retries every 2 s failed on DNS with validated=false, so none counted".
    val policy = start.failConnect(9, validated = false)
    assertEquals(Transport.SRT, policy.current)
    assertEquals(0, policy.count)
  }

  @Test
  fun `F-P5-1 an unresolved host does not count even on a validated network`() {
    assertFalse(start.connectFailed(ConnectFailure.UNRESOLVED, networkValidated = true).counted)
    // Nine is past three: counted, they would have fallen back (and the count reset with it).
    val policy = start.failConnect(9, ConnectFailure.UNRESOLVED, validated = true)
    assertEquals(Transport.SRT, policy.current)
    assertEquals(0, policy.count)
  }

  @Test
  fun `F-P5-2 mid-session drops count toward fallback`() {
    // Redmi on weak wifi: 18 drops every 6–22 s, always endpoint-closed.
    var policy = start
    for (publishedMs in listOf(6_000L, 22_000L)) {
      val decision = policy.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = publishedMs)
      assertTrue(decision.counted)
      policy = decision.policy
    }
    val third = policy.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = 10_000)
    assertTrue(third.fellBack)
    assertEquals(Transport.RTMPS, third.policy.current)
  }

  @Test
  fun `connect failures and short drops count toward the same three`() {
    val policy = start.failConnect(2)
    assertTrue(policy.dropped(DropReason.ENDPOINT_CLOSED, true, publishedMs = 8_000).fellBack)
  }

  @Test
  fun `F-P5-13 a far-end close 31 s after connecting does not count, and clears the count`() {
    val two = start.failConnect(2)
    val decision = two.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = true, publishedMs = 31_000)
    assertFalse(decision.counted)
    assertEquals(0, decision.policy.count)
  }

  @Test
  fun `inputs-stopped and requested drops never count`() {
    for (reason in listOf(DropReason.INPUTS_STOPPED, DropReason.REQUESTED)) {
      assertFalse(start.dropped(reason, networkValidated = true, publishedMs = 1_000).counted)
    }
  }

  @Test
  fun `a drop while the network is not validated does not count`() {
    assertFalse(start.dropped(DropReason.ENDPOINT_CLOSED, networkValidated = false, publishedMs = 6_000).counted)
  }

  @Test
  fun `the fallback is final for the session`() {
    val fell = start.failConnect(3)
    val after = fell.failConnect(10)
    assertEquals(Transport.RTMPS, after.current)
    assertEquals(0, after.count)
  }

  @Test
  fun `with no fallback transport nothing counts`() {
    val alone = FallbackPolicy(Transport.SRT, fallback = null).failConnect(5)
    assertEquals(Transport.SRT, alone.current)
    assertEquals(0, alone.count)
  }

  @Test
  fun `a code that prefers RTMPS falls back to SRT by the same rule`() {
    val policy = FallbackPolicy(Transport.RTMPS, Transport.SRT).failConnect(3)
    assertEquals(Transport.SRT, policy.current)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*FallbackPolicyTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `FallbackPolicyTest.kt:9:23 Unresolved reference 'FallbackPolicy'.`

- [ ] **Step 3: Write `FallbackPolicy.kt`**

`K/FallbackPolicy.kt`:

```kotlin
package com.seazn.capture.engine.core

/** What one failure did to the policy: whether it counted, and whether it moved the session over. */
data class FallbackDecision(val policy: FallbackPolicy, val counted: Boolean, val fellBack: Boolean)

/**
 * C1: primary → fallback (SRT → RTMPS when SRT is preferred). Connect failures **and** repeated
 * mid-session drops count (F-P5-2); a network that is not validated counts nothing, and neither does
 * a host that did not resolve (F-P5-1). The fallback is final for the session.
 */
data class FallbackPolicy(
  val primary: Transport,
  val fallback: Transport?,
  val current: Transport = primary,
  val count: Int = 0,
) {
  val fellBack: Boolean
    get() = current != primary

  fun connectFailed(failure: ConnectFailure, networkValidated: Boolean): FallbackDecision =
    counted(countable && networkValidated && failure != ConnectFailure.UNRESOLVED)

  /**
   * A drop counts when the far end closed an attempt that published for less than
   * [SHORT_ATTEMPT_MS]. A longer attempt proves the link: it clears the count and does not count.
   */
  fun dropped(reason: DropReason, networkValidated: Boolean, publishedMs: Long): FallbackDecision {
    if (publishedMs >= SHORT_ATTEMPT_MS) return FallbackDecision(copy(count = 0), counted = false, fellBack = false)
    return counted(countable && networkValidated && reason == DropReason.ENDPOINT_CLOSED)
  }

  private val countable: Boolean
    get() = fallback != null && current == primary

  private fun counted(counts: Boolean): FallbackDecision {
    if (!counts) return FallbackDecision(this, counted = false, fellBack = false)
    val next = count + 1
    if (next < FAILURES_TO_FALL_BACK || fallback == null) {
      return FallbackDecision(copy(count = next), counted = true, fellBack = false)
    }
    return FallbackDecision(copy(current = fallback, count = 0), counted = true, fellBack = true)
  }

  companion object {
    /** C1's three failures. */
    const val FAILURES_TO_FALL_BACK = 3

    /**
     * F-P5-2's collapses came every 6–22 s. F-P5-13's far-end closes come 31–33 s after a reconnect
     * on a healthy link and must not push a good link off SRT. 25 s sits between the two.
     */
    const val SHORT_ATTEMPT_MS = 25_000L
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **11** tests. On the B3 branch the full suite gives **57**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): fallback policy that counts short drops, never DNS (F-P5-1, F-P5-2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 8: `StallWatchdog` (F-P5-4, F-P5-6, F-P5-9, F-P5-10)

**Files:** Create `K/StallWatchdog.kt` and `T/StallWatchdogTest.kt`.

**Interfaces:**

- Consumes: `Wire`.
- Produces:
  - `StallWatchdog(startedAtMs)`, with `frames(video, audio, nowMs, cameraTaken)`, `tick(nowMs, cameraTaken)`, `advancing(nowMs)` (the LIVE gate) and `rebaselined(nowMs)`;
  - `StallVerdict` (`None`, `Held`, `Rebuild(cause, msSinceAdvance, videoFps, audioFps)`);
  - `StallCause`;
  - the constants `WINDOW_MS` 3 000, `STALL_MS` 3 000, `FIRST_FRAME_GRACE_MS` 5 000, `VIDEO_FLOOR_FPS` 10 and `AUDIO_FLOOR_FPS` 20.

  Plan C sends the **encoder's output** frame counters (cumulative per attempt) in `Input.Frames`, never the camera's.

- [ ] **Step 1: Write the failing test**

`T/StallWatchdogTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class StallWatchdogTest {
  /** A reading every 500 ms with the given increments; ticks after each one. Returns the first rebuild or held verdict. */
  private class Drive(var dog: StallWatchdog = StallWatchdog(startedAtMs = 0)) {
    var video = 0L
    var audio = 0L
    var t = 0L
    val verdicts = mutableListOf<Pair<Long, StallVerdict>>()

    fun step(videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) {
      t += 500
      video += videoAdd
      audio += audioAdd
      val (afterFrames, frameVerdict) = dog.frames(video, audio, t, cameraTaken)
      val (afterTick, tickVerdict) = afterFrames.tick(t, cameraTaken)
      dog = afterTick
      for (verdict in listOf(frameVerdict, tickVerdict)) if (verdict != StallVerdict.None) verdicts += t to verdict
    }

    fun steps(count: Int, videoAdd: Long, audioAdd: Long, cameraTaken: Boolean = false) =
      repeat(count) { step(videoAdd, audioAdd, cameraTaken) }
  }

  private fun healthy(): Drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first; steps(10, 15, 23) }

  @Test
  fun `F-P5-6 no video frame for 3 s is a rebuild, while audio still flows`() {
    val drive = healthy()
    drive.steps(5, 0, 23)
    assertTrue(drive.verdicts.isEmpty(), "2.5 s without video is not yet a stall")
    drive.step(0, 23)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(8_000L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.NO_VIDEO, verdict.cause)
    assertEquals(3_000L, verdict.msSinceAdvance)
  }

  @Test
  fun `F-P5-6 the first frame gets a 5 s grace`() {
    val dog = StallWatchdog(startedAtMs = 0)
    assertEquals(StallVerdict.None, dog.tick(4_999, cameraTaken = false).second)
    val verdict = dog.tick(5_000, cameraTaken = false).second
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.NO_FIRST_FRAME, verdict.cause)
  }

  @Test
  fun `F-P5-9 a slideshow above zero is a rebuild - 8 fps`() {
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    drive.steps(7, 4, 23)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(3_500L, at, "the first full window after the first frame")
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(StallCause.BELOW_FLOOR, verdict.cause)
    assertEquals(8.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-4 audio at a seventh of its rate is a rebuild though video runs 30 fps`() {
    // F-P5-4: 6.36 audio packets/s against the full AAC rate of 46.88.
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    drive.steps(7, 15, 3)
    val (at, verdict) = drive.verdicts.single()
    assertEquals(3_500L, at)
    assertIs<StallVerdict.Rebuild>(verdict)
    assertEquals(6.0, verdict.audioFps)
    assertEquals(30.0, verdict.videoFps)
  }

  @Test
  fun `F-P5-9 a short dip that averages above the floors is not a rebuild`() {
    // P5: "the browser's single 12 fps second and the phone call's two 13 fps seconds average above".
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    val video = listOf(15L, 15, 15, 6, 6, 15, 15, 15, 15, 15, 15, 15)
    val audio = listOf(23L, 23, 24, 7, 8, 9, 9, 23, 24, 23, 24, 23)
    video.zip(audio).forEach { (v, a) -> drive.step(v, a) }
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
  }

  @Test
  fun `exactly 10 video fps and 20 audio frames a second is not starved`() {
    val drive = Drive().apply { dog = dog.frames(0, 0, 0, false).first }
    drive.steps(12, 5, 10)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
    assertEquals(10.0, drive.dog.videoFps)
    assertEquals(20.0, drive.dog.audioFps)
  }

  @Test
  fun `F-P5-10 while the camera is taken it holds and never rebuilds`() {
    val drive = healthy()
    drive.steps(20, 0, 23, cameraTaken = true)
    assertTrue(drive.verdicts.isNotEmpty())
    assertTrue(drive.verdicts.all { it.second == StallVerdict.Held }, "got ${drive.verdicts}")
  }

  @Test
  fun `F-P5-10 a slate at a low rate is not judged while the camera is taken`() {
    val drive = healthy()
    drive.steps(12, 1, 23, cameraTaken = true)
    assertTrue(drive.verdicts.isEmpty(), "got ${drive.verdicts}")
  }

  @Test
  fun `F-P5-10 after our reopen the camera gets a full stall window`() {
    val drive = healthy()
    drive.steps(20, 0, 23, cameraTaken = true)
    drive.verdicts.clear()
    drive.dog = drive.dog.rebaselined(drive.t)
    drive.steps(5, 0, 23)
    assertTrue(drive.verdicts.isEmpty(), "2.5 s after the reopen is inside the window")
    drive.steps(2, 15, 23)
    assertTrue(drive.verdicts.isEmpty())
  }

  @Test
  fun `a counter that goes backwards is a fresh baseline, not an advance`() {
    val drive = healthy()
    val (dog, verdict) = drive.dog.frames(3, 5, drive.t + 500, cameraTaken = false)
    assertEquals(StallVerdict.None, verdict)
    assertEquals(3L, dog.lastVideo)
    assertEquals(drive.dog.lastAdvanceAtMs, dog.lastAdvanceAtMs)
  }

  @Test
  fun `the LIVE gate - advancing only within 3 s of the last frame`() {
    val drive = healthy()
    val last = drive.dog.lastAdvanceAtMs!!
    assertTrue(drive.dog.advancing(last + 2_999))
    assertFalse(drive.dog.advancing(last + 3_000))
    assertFalse(StallWatchdog(startedAtMs = 0).advancing(0))
  }

  @Test
  fun `the rates shown are the window's, truncated to one decimal`() {
    val drive = healthy()
    assertEquals(30.0, drive.dog.videoFps)
    assertEquals(46.0, drive.dog.audioFps)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*StallWatchdogTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `StallWatchdogTest.kt:11:32 Unresolved reference 'StallWatchdog'.`

- [ ] **Step 3: Write `StallWatchdog.kt`**

`K/StallWatchdog.kt`:

```kotlin
package com.seazn.capture.engine.core

enum class StallCause(override val wire: String) : Wire {
  NO_FIRST_FRAME("no-first-frame"),
  NO_VIDEO("no-video"),
  BELOW_FLOOR("below-floor"),
}

sealed interface StallVerdict {
  data object None : StallVerdict

  /** The camera is taken (F-P5-10): video may stop, and nothing is rebuilt, because a rebuild buys nothing. */
  data object Held : StallVerdict

  data class Rebuild(val cause: StallCause, val msSinceAdvance: Long, val videoFps: Double?, val audioFps: Double?) :
    StallVerdict
}

data class FrameReading(val atMs: Long, val video: Long, val audio: Long)

/**
 * One attempt's view of the encoded frame counters (F-P5-4, F-P5-6, F-P5-9, F-P5-10). It decides two
 * things: whether video is advancing, which is the LIVE gate, and when the pipeline must be rebuilt.
 * It rebuilds nothing itself; the machine does, as a new attempt with a new watchdog.
 */
data class StallWatchdog(
  val startedAtMs: Long,
  val lastVideo: Long? = null,
  val lastAdvanceAtMs: Long? = null,
  /** Readings since the first frame, pruned to one window. */
  val readings: List<FrameReading> = emptyList(),
  val videoFps: Double? = null,
  val audioFps: Double? = null,
) {
  /** The LIVE gate: an encoded video frame arrived within the last [STALL_MS]. */
  fun advancing(nowMs: Long): Boolean = lastAdvanceAtMs?.let { nowMs - it < STALL_MS } ?: false

  /**
   * Cumulative counts for this attempt. The rate floor is judged here, on a reading where video
   * advanced, so a picture that stops dead reaches the zero test in [tick] rather than reading as
   * starved on its way there. A camera that is taken is never judged.
   */
  fun frames(video: Long, audio: Long, nowMs: Long, cameraTaken: Boolean): Pair<StallWatchdog, StallVerdict> {
    val previous = lastVideo
    if (previous == null || video < previous) return copy(lastVideo = video, readings = emptyList()) to StallVerdict.None
    if (video == previous) {
      val kept = if (lastAdvanceAtMs == null) readings else pruned(readings + FrameReading(nowMs, video, audio), nowMs)
      return copy(readings = kept) to StallVerdict.None
    }
    val advanced =
      copy(lastVideo = video, lastAdvanceAtMs = nowMs, readings = pruned(readings + FrameReading(nowMs, video, audio), nowMs))
    if (cameraTaken) return advanced.copy(readings = emptyList(), videoFps = null, audioFps = null) to StallVerdict.None
    return advanced.judgeRate(nowMs)
  }

  /** The time-based rules: the first-frame grace and the zero test. */
  fun tick(nowMs: Long, cameraTaken: Boolean): Pair<StallWatchdog, StallVerdict> {
    val lastAdvance = lastAdvanceAtMs
    val silentMs = nowMs - (lastAdvance ?: startedAtMs)
    val limit = if (lastAdvance == null) FIRST_FRAME_GRACE_MS else STALL_MS
    return when {
      silentMs < limit -> this to StallVerdict.None
      cameraTaken -> copy(readings = emptyList()) to StallVerdict.Held
      lastAdvance == null -> this to StallVerdict.Rebuild(StallCause.NO_FIRST_FRAME, silentMs, null, null)
      else -> this to StallVerdict.Rebuild(StallCause.NO_VIDEO, silentMs, videoFps, audioFps)
    }
  }

  /** Our own camera reopen finished: the window starts again and the reopened camera gets a full [STALL_MS]. */
  fun rebaselined(nowMs: Long): StallWatchdog =
    copy(lastVideo = null, lastAdvanceAtMs = nowMs, readings = emptyList(), videoFps = null, audioFps = null)

  private fun judgeRate(nowMs: Long): Pair<StallWatchdog, StallVerdict> {
    val base = readings.firstOrNull()?.takeIf { it.atMs <= nowMs - WINDOW_MS } ?: return this to StallVerdict.None
    val last = readings.last()
    val seconds = (last.atMs - base.atMs) / 1_000.0
    val video = oneDecimal((last.video - base.video) / seconds)
    val audio = oneDecimal((last.audio - base.audio) / seconds)
    val rated = copy(videoFps = video, audioFps = audio)
    if (video >= VIDEO_FLOOR_FPS && audio >= AUDIO_FLOOR_FPS) return rated to StallVerdict.None
    return rated to StallVerdict.Rebuild(StallCause.BELOW_FLOOR, 0, video, audio)
  }

  /** Keeps the newest reading and the latest one at least [WINDOW_MS] older, which a rate is taken over. */
  private fun pruned(all: List<FrameReading>, nowMs: Long): List<FrameReading> {
    val windowStart = nowMs - WINDOW_MS
    val baseIndex = all.indexOfLast { it.atMs <= windowStart }
    return if (baseIndex <= 0) all else all.drop(baseIndex)
  }

  /** Truncated, not rounded: a rate shown is under a floor exactly when the rate judged was. */
  private fun oneDecimal(value: Double): Double = Math.floor(value * 10) / 10.0

  companion object {
    /** 90 missing frames at 30 fps. F-P5-6's counter was flat for 11 minutes: no near miss. */
    const val STALL_MS = 3_000L

    /** The encoders start after the endpoint opens (P5: "video-stalled 5.0 s after publishing"). */
    const val FIRST_FRAME_GRACE_MS = 5_000L

    /** F-P5-9's rolling window. */
    const val WINDOW_MS = 3_000L

    /** F-P5-9: "fewer than 10 video frames/s or 20 audio frames/s over 3 s". */
    const val VIDEO_FLOOR_FPS = 10.0
    const val AUDIO_FLOOR_FPS = 20.0
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **12** tests. On the B3 branch the full suite gives **69**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): stall watchdog with a rate floor and a camera hold

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 9: Playlist parser, plain HLS and LL-HLS (F-P5-13, H-P5-1)

**Files:** Create `K/PlaylistParser.kt` and `T/PlaylistParserTest.kt`.

**Interfaces:**

- Consumes: nothing beyond Kotlin.
- Produces:
  - `Playlist` = `Master(variants)` | `Media(targetDurationS, mediaSequence, segmentDurationsMs, endList, lowLatency, partTargetMs, trailingPartsMs)` (with `head` and `partsMs`) | `Invalid(reason)`;
  - `PlaylistParser.parse(text)`;
  - `PlaylistParser.resolve(base, ref)`.

  **Cloudflare facts this reads, from its "use your own player" doc (owner, 2026-09-30):**

  - LL-HLS exists only on inputs created with low latency enabled, which is unknown for S1's inputs, so the form is detected from the playlist (`EXT-X-PART-INF` or `EXT-X-PART`). `EXT-X-SERVER-CONTROL` alone is not LL-HLS; plain HLS may carry it.
  - Parts listed before a segment's `EXTINF` belong to it, and parts after the last segment are "trailing".
  - A `GAP=YES` part is no media, and a preload hint is not a part.

- [ ] **Step 1: Write the failing test**

`T/PlaylistParserTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlaylistParserTest {
  @Test
  fun `a master lists its variants in order`() {
    val text =
      """
      #EXTM3U
      #EXT-X-VERSION:6
      #EXT-X-STREAM-INF:BANDWIDTH=3128000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
      stream_720/video.m3u8?p=1
      #EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360
      stream_360/video.m3u8?p=1
      """.trimIndent()
    assertEquals(Playlist.Master(listOf("stream_720/video.m3u8?p=1", "stream_360/video.m3u8?p=1")), PlaylistParser.parse(text))
  }

  @Test
  fun `a media playlist gives its sequence, segment durations and head`() {
    val text =
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:2
      #EXT-X-MEDIA-SEQUENCE:150
      #EXTINF:2.000,
      seg150.ts
      #EXTINF:2.000,
      seg151.ts
      #EXTINF:1.750,
      seg152.ts
      """.trimIndent()
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertEquals(2, media.targetDurationS)
    assertEquals(listOf(2_000L, 2_000L, 1_750L), media.segmentDurationsMs)
    assertEquals(152L, media.head)
    assertEquals(false, media.endList)
  }

  @Test
  fun `H-P5-1 EXT-X-ENDLIST is read and is still just a media playlist`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2.0,\na.ts\n#EXT-X-ENDLIST\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertEquals(true, media.endList)
    assertEquals(7L, media.head)
  }

  @Test
  fun `a plain HLS playlist is not low-latency, even with a server-control tag`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=12.0\n#EXTINF:2.0,\na.ts\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertFalse(media.lowLatency)
    assertNull(media.partTargetMs)
    assertEquals(0L, media.partsMs)
  }

  @Test
  fun `an LL-HLS playlist counts parts before a segment in its EXTINF, and parts after it as trailing`() {
    val text =
      """
      #EXTM3U
      #EXT-X-TARGETDURATION:4
      #EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.0
      #EXT-X-PART-INF:PART-TARGET=0.5
      #EXT-X-MEDIA-SEQUENCE:3
      #EXT-X-PROGRAM-DATE-TIME:2026-09-30T14:32:05.123Z
      #EXT-X-PART:DURATION=0.5,URI="p3.0.mp4",INDEPENDENT=YES
      #EXT-X-PART:DURATION=0.5,URI="p3.1.mp4"
      #EXTINF:2.002,
      s3.mp4
      #EXT-X-PART:DURATION=0.5006,URI="p4.0.mp4",INDEPENDENT=YES
      #EXT-X-PART:DURATION=0.4,URI="p4.1.mp4"
      #EXT-X-PART:DURATION=0.5,URI="p4.2.mp4",GAP=YES
      #EXT-X-PRELOAD-HINT:TYPE=PART,URI="p4.3.mp4"
      #EXT-X-RENDITION-REPORT:URI="../360/video.m3u8",LAST-MSN=4,LAST-PART=2
      """.trimIndent()
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertTrue(media.lowLatency)
    assertEquals(500L, media.partTargetMs)
    assertEquals(listOf(2_002L), media.segmentDurationsMs)
    assertEquals(3L, media.head)
    assertEquals(listOf(501L, 400L), media.trailingPartsMs, "a gap part carries no media; a preload hint is not a part")
    assertEquals(901L, media.partsMs)
  }

  @Test
  fun `parts with no part-info tag still make it LL-HLS`() {
    val text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=0.333,URI=\"a.mp4\"\n"
    val media = assertIs<Playlist.Media>(PlaylistParser.parse(text))
    assertTrue(media.lowLatency)
    assertEquals(listOf(333L), media.trailingPartsMs)
  }

  @Test
  fun `a malformed part is invalid, never a crash`() {
    assertEquals(Playlist.Invalid("bad EXT-X-PART"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=x,URI=\"a\"\n"))
    assertEquals(Playlist.Invalid("bad EXT-X-PART"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-PART:DURATION=0.5\n"))
  }

  @Test
  fun `a media playlist with no segments yet has its head before the sequence`() {
    val media = assertIs<Playlist.Media>(PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:40\n"))
    assertEquals(39L, media.head)
  }

  @Test
  fun `CRLF line endings parse`() {
    val media = PlaylistParser.parse("#EXTM3U\r\n#EXT-X-TARGETDURATION:2\r\n#EXTINF:2.0,\r\na.ts\r\n")
    assertEquals(listOf(2_000L), assertIs<Playlist.Media>(media).segmentDurationsMs)
  }

  @Test
  fun `empty, blank, foreign and malformed text is invalid, never a crash`() {
    assertEquals(Playlist.Invalid("empty"), PlaylistParser.parse(""))
    assertEquals(Playlist.Invalid("empty"), PlaylistParser.parse("  \n\t\n"))
    assertEquals(Playlist.Invalid("no #EXTM3U"), PlaylistParser.parse("<html>403 error code: 1010</html>"))
    assertEquals(Playlist.Invalid("neither a master nor a media playlist"), PlaylistParser.parse("#EXTM3U\n"))
    assertEquals(Playlist.Invalid("bad EXTINF"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:abc,\na.ts\n"))
    assertEquals(Playlist.Invalid("bad EXTINF"), PlaylistParser.parse("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\n"))
    assertEquals(Playlist.Invalid("master without variants"), PlaylistParser.parse("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n"))
  }

  @Test
  fun `variant URIs resolve against the master URL`() {
    val master = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8"
    assertEquals(
      "https://customer-x.cloudflarestream.com/abc/manifest/stream_720/video.m3u8?p=1",
      PlaylistParser.resolve(master, "stream_720/video.m3u8?p=1"),
    )
    assertEquals("https://other.example/v.m3u8", PlaylistParser.resolve(master, "https://other.example/v.m3u8"))
    assertEquals("https://customer-x.cloudflarestream.com/root.m3u8", PlaylistParser.resolve(master, "/root.m3u8"))
    assertNull(PlaylistParser.resolve(master, "has space.m3u8"))
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*PlaylistParserTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`. The first `e:` line is `PlaylistParserTest.kt:22:5 Cannot infer type for this parameter. Specify it explicitly.`, and `Unresolved reference 'Playlist'` follows.

- [ ] **Step 3: Write `PlaylistParser.kt`**

`K/PlaylistParser.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.net.URI

sealed interface Playlist {
  /** A master playlist: its variant URIs as written, in order. */
  data class Master(val variants: List<String>) : Playlist

  /**
   * A media playlist, plain HLS or LL-HLS. Which one is read from the playlist itself, never
   * assumed: LL-HLS exists only on inputs created with low latency enabled, which S1 does not know.
   *
   * [segmentDurationsMs] are the completed segments. [trailingPartsMs] are the LL-HLS parts
   * published after the last completed segment: media a player can already fetch, of a segment not
   * yet complete. Parts listed before a segment belong to it and are counted once, in its `EXTINF`.
   *
   * [endList] is parsed and reported, and means nothing about the session: Cloudflare never served
   * `EXT-X-ENDLIST` at a 180 s timeout (H-P5-1, P5 Run A).
   */
  data class Media(
    val targetDurationS: Int?,
    val mediaSequence: Long,
    val segmentDurationsMs: List<Long>,
    val endList: Boolean,
    val lowLatency: Boolean = false,
    val partTargetMs: Long? = null,
    val trailingPartsMs: List<Long> = emptyList(),
  ) : Playlist {
    /** The newest completed segment's sequence number; one before [mediaSequence] when there is none. */
    val head: Long
      get() = mediaSequence + segmentDurationsMs.size - 1

    /** Media past [head]: the trailing parts. Always 0 for plain HLS. */
    val partsMs: Long
      get() = trailingPartsMs.sum()
  }

  data class Invalid(val reason: String) : Playlist
}

/**
 * The HLS text the delivery watch reads (F-P5-13). Pure: the platform fetches, this only reads.
 * Handles plain HLS and LL-HLS (`EXT-X-PART`, `EXT-X-PART-INF`, `EXT-X-SERVER-CONTROL`); a preload
 * hint is a promise of a part, not a part, and is not delivered media.
 */
object PlaylistParser {
  private const val STREAM_INF = "#EXT-X-STREAM-INF"
  private const val TARGET_DURATION = "#EXT-X-TARGETDURATION:"
  private const val MEDIA_SEQUENCE = "#EXT-X-MEDIA-SEQUENCE:"
  private const val EXTINF = "#EXTINF:"
  private const val ENDLIST = "#EXT-X-ENDLIST"
  private const val PART = "#EXT-X-PART:"
  private const val PART_INF = "#EXT-X-PART-INF:"
  private val ATTRIBUTE = Regex("""([A-Z0-9-]+)=("[^"]*"|[^,]*)""")

  fun parse(text: String): Playlist {
    val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
    if (lines.isEmpty()) return Playlist.Invalid("empty")
    if (lines.first() != "#EXTM3U") return Playlist.Invalid("no #EXTM3U")
    return if (lines.any { it.startsWith(STREAM_INF) }) master(lines) else media(lines)
  }

  /** A variant URI against the master's URL. Null when either cannot be read as a URI. */
  fun resolve(baseUrl: String, reference: String): String? =
    runCatching { URI(baseUrl).resolve(URI(reference)).toString() }.getOrNull()

  private fun master(lines: List<String>): Playlist {
    val variants = lines.zipWithNext().filter { (tag, _) -> tag.startsWith(STREAM_INF) }.map { it.second }
    val uris = variants.filter { !it.startsWith("#") }
    return if (uris.isEmpty()) Playlist.Invalid("master without variants") else Playlist.Master(uris)
  }

  private fun media(lines: List<String>): Playlist {
    val target = lines.firstOrNull { it.startsWith(TARGET_DURATION) }?.removePrefix(TARGET_DURATION)?.toIntOrNull()
      ?: return Playlist.Invalid("neither a master nor a media playlist")
    val sequence = lines.firstOrNull { it.startsWith(MEDIA_SEQUENCE) }?.removePrefix(MEDIA_SEQUENCE)?.toLongOrNull() ?: 0
    val partTarget = lines.firstOrNull { it.startsWith(PART_INF) }?.let { seconds(attributes(it.removePrefix(PART_INF))["PART-TARGET"]) }
    val durations = mutableListOf<Long>()
    val parts = mutableListOf<Long>()
    for ((index, line) in lines.withIndex()) {
      when {
        line.startsWith(PART) -> parts += part(line) ?: return Playlist.Invalid("bad EXT-X-PART")
        line.startsWith(EXTINF) -> {
          durations += segment(line, lines.getOrNull(index + 1)) ?: return Playlist.Invalid("bad EXTINF")
          parts.clear()
        }
      }
    }
    val lowLatency = partTarget != null || lines.any { it.startsWith(PART) }
    return Playlist.Media(target, sequence, durations, lines.any { it == ENDLIST }, lowLatency, partTarget, parts.filter { it >= 0 })
  }

  /** A segment's duration, when its `EXTINF` is well formed and a URI follows it. */
  private fun segment(line: String, uri: String?): Long? {
    val seconds = line.removePrefix(EXTINF).substringBefore(',').toDoubleOrNull()
    if (seconds == null || seconds < 0 || uri == null || uri.startsWith("#")) return null
    return Math.round(seconds * 1_000)
  }

  /** A part's duration; -1 for a gap, which is listed but carries no media. Null when malformed. */
  private fun part(line: String): Long? {
    val attributes = attributes(line.removePrefix(PART))
    val duration = seconds(attributes["DURATION"]) ?: return null
    if (attributes["URI"] == null) return null
    return if (attributes["GAP"] == "YES") -1 else duration
  }

  private fun seconds(value: String?): Long? = value?.toDoubleOrNull()?.takeIf { it >= 0 && it.isFinite() }?.let { Math.round(it * 1_000) }

  private fun attributes(list: String): Map<String, String> =
    ATTRIBUTE.findAll(list).associate { it.groupValues[1] to it.groupValues[2] }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **11** tests. On the B4 branch the full suite gives **39**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): HLS and LL-HLS playlist parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 10: `DeliveryWatch` (F-P5-13, F-P5-4, F-P5-2, H-P5-1)

**Files:** Create `K/DeliveryWatch.kt` and `T/DeliveryWatchTest.kt`.

**Interfaces:**

- Consumes: `PlaylistParser`, `Delivery`, `Wire`.
- Produces:
  - `FetchResult` (`Body`, `NoContent`, `HttpError`, `Failed`), `PlaylistRequest(id, url)`, `NotDeliveredCause` (`stalled`, `lagging`), `NotDelivered` and `LagPoint`;
  - `DeliveryWatch(playbackUrl)`, with `pollUrl`, `tick(nowMs, onAirNow)`, `fetched(id, result, nowMs)`, `newSession()`, `delivery`, `deliveredLagMs` and `mediaMs`;
  - `DeliveryWatch.hinted(url)`;
  - the constants `POLL_MS` 2 000, `CONFIGURED_SEGMENT_MS` 2 000, `STALLED_AFTER_MS` 6 000, `NOT_DELIVERED_MS` 20 000, `LAG_GROWTH_LIMIT_MS` 20 000, `LAG_WINDOW_MS` 60 000, `REQUEST_TIMEOUT_MS` 10 000 and `BANDWIDTH_HINT_MBPS` `"0.1"`.

  **Plan C must** fetch every `FetchPlaylist` fresh: no HTTP cache, no proxy, `Cache-Control: no-cache`. Cloudflare: "Do not cache, proxy, or store manifests; always read them directly from Stream". It must also map a 204 to `NoContent`.

- [ ] **Step 1: Write the failing test**

`T/DeliveryWatchTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DeliveryWatchTest {
  private val master = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8"
  private val polled = "https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8?clientBandwidthHint=0.1"
  private val variant = "https://customer-x.cloudflarestream.com/abc/manifest/stream_720/video.m3u8"

  private fun masterText(path: String = "stream_720/video.m3u8") = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3128000\n$path\n"

  private fun mediaText(head: Long, target: Int = 2, endList: Boolean = false): String {
    val first = head - 2
    val segments = (first..head).joinToString("") { "#EXTINF:2.000,\nseg$it.ts\n" }
    return "#EXTM3U\n#EXT-X-TARGETDURATION:$target\n#EXT-X-MEDIA-SEQUENCE:$first\n$segments" +
      if (endList) "#EXT-X-ENDLIST\n" else ""
  }

  /**
   * An LL-HLS media playlist: completed segments [head] − 2 to [head], each listed with its four
   * 500 ms parts, then [trailingParts] 500 ms parts of the segment in progress and a preload hint.
   */
  private fun llText(head: Long, trailingParts: Long): String {
    val first = head - 2
    val parts = { segment: Long, count: Long -> (0 until count).joinToString("") { "#EXT-X-PART:DURATION=0.5,URI=\"p$segment.$it.mp4\"\n" } }
    val segments = (first..head).joinToString("") { parts(it, 4) + "#EXTINF:2.000,\ns$it.mp4\n" }
    return "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.5\n" +
      "#EXT-X-PART-INF:PART-TARGET=0.5\n#EXT-X-MEDIA-SEQUENCE:$first\n$segments${parts(head + 1, trailingParts)}" +
      "#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"p${head + 1}.$trailingParts.mp4\"\n"
  }

  /**
   * Ticks every 500 ms from [fromMs] to [toMs] and answers every request at once with [answer].
   * Returns the first not-delivered verdict and when it came.
   */
  private class Harness(var watch: DeliveryWatch) {
    val requests = mutableListOf<Pair<Long, PlaylistRequest>>()
    var verdict: Pair<Long, NotDelivered>? = null

    fun run(fromMs: Long, toMs: Long, onAir: (Long) -> Boolean = { true }, answer: (Long, String) -> FetchResult?) {
      var t = fromMs
      while (t <= toMs) {
        val (ticked, issued) = watch.tick(t, onAir(t))
        watch = ticked
        var queue = issued
        while (queue.isNotEmpty()) {
          val request = queue.first()
          requests += t to request
          val result = answer(t, request.url) ?: break
          val (next, more, found) = watch.fetched(request.id, result, t)
          watch = next
          if (found != null && verdict == null) verdict = t to found
          queue = more
        }
        t += 500
      }
    }
  }

  private fun respond(variantText: (Long) -> String): (Long, String) -> FetchResult = { t, url ->
    if (url == polled) FetchResult.Body(masterText()) else FetchResult.Body(variantText(t))
  }

  @Test
  fun `F-P5-13 a head frozen for 20 s of publishing is not-delivered`() {
    // The dark reconnect: the playlist gained one segment and then stalled; the master then 204s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 40_000) { t, url ->
      when {
        t > 10_000 && url == polled -> FetchResult.NoContent
        url == polled -> FetchResult.Body(masterText())
        else -> FetchResult.Body(mediaText(100 + t / 2_000))
      }
    }
    val (at, verdict) = harness.verdict!!
    assertEquals(30_000L, at, "20 s of publishing after the last advance at 10 s")
    assertEquals(NotDeliveredCause.STALLED, verdict.cause)
  }

  @Test
  fun `F-P5-13 a drip that never stalls 20 s is caught by growing lag`() {
    // Final soak: "from 07:16Z it gained about one segment a minute" — here one 2 s segment every 15 s.
    // Lag at a poll is t − 2000 × floor(t / 15000); it first reaches 20 000 at t = 22 000.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 60_000, answer = respond { t -> mediaText(100 + t / 15_000) })
    val (at, verdict) = harness.verdict!!
    assertEquals(22_000L, at)
    assertEquals(NotDeliveredCause.LAGGING, verdict.cause)
  }

  @Test
  fun `F-P5-4 the stall threshold is three configured segments, not three target durations`() {
    // Soak: targetDuration grew to 8, so the old rule needed 24 s. P5's own test: a 10 s frozen head is a stall.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000, target = 8) })
    harness.run(10_500, 14_000, answer = respond { mediaText(105, target = 8) })
    assertEquals(Delivery.OK, harness.watch.delivery, "4 s frozen is inside the margin")
    harness.run(14_500, 20_000, answer = respond { mediaText(105, target = 8) })
    assertEquals(Delivery.STALLED, harness.watch.delivery)
    assertNull(harness.verdict, "stalled is shown at 6 s; not-delivered waits for 20 s")
  }

  @Test
  fun `H-P5-1 EXT-X-ENDLIST never means ended`() {
    val moving = Harness(DeliveryWatch(master))
    moving.run(0, 30_000, answer = respond { t -> mediaText(100 + t / 2_000, endList = true) })
    assertEquals(Delivery.OK, moving.watch.delivery)
    assertNull(moving.verdict)

    val frozen = Harness(DeliveryWatch(master))
    frozen.run(0, 30_000, answer = respond { mediaText(100, endList = true) })
    assertEquals(NotDeliveredCause.STALLED, frozen.verdict!!.second.cause, "an ENDLIST that stops moving is a stall like any other")
  }

  @Test
  fun `F-P5-2 a variant change is not progress and does not reset the stall clock`() {
    // The Redmi's reconnect storm: almost every poll saw a new variant, and the old watcher called it advancing.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000) { t, url ->
      if (url == polled) FetchResult.Body(masterText("stream_$t/video.m3u8")) else FetchResult.Body(mediaText(500 + t))
    }
    assertEquals(20_000L, harness.verdict!!.first)
    assertEquals(NotDeliveredCause.STALLED, harness.verdict!!.second.cause)
  }

  @Test
  fun `only publishing time counts toward a stall`() {
    val harness = Harness(DeliveryWatch(master))
    val onAir = { t: Long -> t <= 10_000 || t >= 70_000 }
    harness.run(0, 100_000, onAir) { t, url ->
      if (url == polled) FetchResult.Body(masterText()) else FetchResult.Body(mediaText(if (t <= 10_000) 100 + t / 2_000 else 105))
    }
    assertEquals(90_000L, harness.verdict!!.first, "10 s on air, 60 s off, then 20 s on air frozen")
  }

  @Test
  fun `no polling while off air, and delivery claims nothing`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 20_000, onAir = { false }, answer = respond { mediaText(100) })
    assertTrue(harness.requests.isEmpty())
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `failed fetches are unknown, never not-delivered`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 60_000) { _, _ -> FetchResult.Failed("timeout") }
    assertNull(harness.verdict)
    assertEquals(Delivery.UNKNOWN, harness.watch.delivery)
  }

  @Test
  fun `an HTTP error or a garbled body is no evidence`() {
    val errors = Harness(DeliveryWatch(master))
    errors.run(0, 60_000) { _, _ -> FetchResult.HttpError(403) }
    assertNull(errors.verdict)
    val garbled = Harness(DeliveryWatch(master))
    garbled.run(0, 60_000) { _, _ -> FetchResult.Body("") }
    assertNull(garbled.verdict)
  }

  @Test
  fun `the master is re-resolved on every poll`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    assertEquals(listOf(0L, 2_000L, 4_000L, 6_000L, 8_000L, 10_000L), harness.requests.filter { it.second.url == polled }.map { it.first })
    assertTrue(harness.requests.any { it.second.url == variant })
  }

  @Test
  fun `a request in flight blocks the next poll until it is abandoned at 10 s`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000) { _, _ -> null }
    assertEquals(listOf(0L, 10_000L), harness.requests.map { it.first })
  }

  @Test
  fun `a stale answer is ignored`() {
    val (watch, issued) = DeliveryWatch(master).tick(0, onAirNow = true)
    val (abandoned, _) = watch.tick(10_000, onAirNow = true)
    val (after, more, verdict) = abandoned.fetched(issued.single().id, FetchResult.Body(masterText()), 10_500)
    assertEquals(abandoned, after)
    assertTrue(more.isEmpty())
    assertNull(verdict)
  }

  @Test
  fun `a moving playlist is OK with no lag`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { t -> mediaText(100 + t / 2_000) })
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(0L, harness.watch.deliveredLagMs)
    assertNull(harness.verdict)
  }

  @Test
  fun `the master is polled for one rendition, with a low bandwidth hint`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 0, answer = respond { mediaText(100) })
    assertEquals(listOf(polled, variant), harness.requests.map { it.second.url })
    assertEquals("$master?token=v&clientBandwidthHint=0.1", DeliveryWatch("$master?token=v").pollUrl, "an existing query is kept")
  }

  @Test
  fun `LL-HLS parts that advance while full segments lag are delivery`() {
    // Segment 100 never completes; a part of 500 ms arrives every 500 ms. Parts are playable media.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { t -> llText(100, trailingParts = t / 500) })
    assertNull(harness.verdict)
    assertEquals(Delivery.OK, harness.watch.delivery)
    assertEquals(30_000L, harness.watch.mediaMs, "0 to 60 parts of 500 ms between the first poll and the last")
    assertEquals(0L, harness.watch.deliveredLagMs)
  }

  @Test
  fun `LL-HLS parts that roll into a completed segment are counted once`() {
    // Delivered media is t + 1 s: at every 2 s poll one more 2 s segment completes, and the two
    // 500 ms parts of the next are always out. Polls at 0 … 20 s: 20 s of media, not 30 s.
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 20_000, answer = respond { t -> llText(100 + t / 2_000, trailingParts = 2) })
    assertEquals(20_000L, harness.watch.mediaMs)
    assertEquals(Delivery.OK, harness.watch.delivery)
  }

  @Test
  fun `F-P5-4 LL-HLS parts that stop are a stall on the configured segment, not the part target`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 10_000, answer = respond { t -> llText(100, trailingParts = t / 500) })
    harness.run(10_500, 14_000, answer = respond { llText(100, trailingParts = 20) })
    assertEquals(Delivery.OK, harness.watch.delivery, "4 s without a part is inside the margin")
    harness.run(14_500, 40_000, answer = respond { llText(100, trailingParts = 20) })
    assertEquals(Delivery.STALLED, harness.watch.delivery)
    assertEquals(30_000L, harness.verdict!!.first, "20 s of publishing after the last part at 10 s")
  }

  @Test
  fun `a new session proves itself from zero`() {
    val harness = Harness(DeliveryWatch(master))
    harness.run(0, 30_000, answer = respond { mediaText(100) })
    val fresh = harness.watch.newSession()
    assertEquals(0L, fresh.sinceAdvanceMs)
    assertEquals(Delivery.UNKNOWN, fresh.delivery)
    assertNull(fresh.pending)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*DeliveryWatchTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `DeliveryWatchTest.kt:39:36 Unresolved reference 'DeliveryWatch'.`

- [ ] **Step 3: Write `DeliveryWatch.kt`**

`K/DeliveryWatch.kt`:

```kotlin
package com.seazn.capture.engine.core

/** What the platform's HTTP client got for one playlist request. */
sealed interface FetchResult {
  data class Body(val text: String) : FetchResult

  /** 204: Cloudflare serves this when no variant is live (P5, F-P5-3's 11:05:55Z). */
  data object NoContent : FetchResult

  data class HttpError(val status: Int) : FetchResult

  data class Failed(val message: String) : FetchResult
}

data class PlaylistRequest(val id: Int, val url: String)

enum class NotDeliveredCause(override val wire: String) : Wire {
  /** The head has not moved for [DeliveryWatch.NOT_DELIVERED_MS] of publishing. */
  STALLED("stalled"),

  /** It moves, but delivered media falls behind publishing time (the final soak's drip). */
  LAGGING("lagging"),
}

data class NotDelivered(val cause: NotDeliveredCause, val stalledMs: Long, val lagGrowthMs: Long?)

data class LagPoint(val onAirMs: Long, val lagMs: Long)

/**
 * F-P5-13: an ingest session Cloudflare accepts can stop being delivered at any time, and neither
 * the phone's transport nor Cloudflare's status API sees it. This watches the delivered playlist,
 * polling the master every [POLL_MS] and re-resolving it on every poll, and compares delivered media
 * time with publishing time.
 *
 * - Manifests are dynamic: Cloudflare says never to cache, proxy or store them. Every poll is a fresh
 *   fetch of the master (plan C's HTTP client runs with its cache off), and a variant URL is only
 *   ever the one the latest master named.
 * - The master is asked for one rendition with a low `clientBandwidthHint`, so the watch follows
 *   the same rendition from poll to poll. It never downloads a segment, so the rendition's size
 *   costs nothing.
 * - Plain HLS and LL-HLS are both read. Delivered media time is completed segments plus the parts
 *   published after them; a part that rolls into a completed segment is counted once.
 *
 * - Only publishing time counts: an outage is the hold clock's, not a delivery stall.
 * - A variant change is not progress, and does not reset the stall clock (F-P5-2).
 * - The thresholds come from the segment we configure, never the playlist's `targetDuration`,
 *   which only grows as a stream goes wrong (F-P5-4).
 * - `EXT-X-ENDLIST` never means ended (H-P5-1).
 * - A failed fetch is no evidence either way: it never means not-delivered.
 */
data class DeliveryWatch(
  /** The session's playback URL: the master, as Cloudflare hands it to every viewer. */
  val playbackUrl: String,
  val nextPollAtMs: Long = 0,
  val pending: PlaylistRequest? = null,
  val pendingIsMaster: Boolean = true,
  val pendingSinceMs: Long = 0,
  val nextRequestId: Int = 1,
  val lastTickMs: Long? = null,
  val onAir: Boolean = false,
  /** Publishing time accumulated over the session. */
  val onAirMs: Long = 0,
  /** Publishing time since the head last moved. */
  val sinceAdvanceMs: Long = 0,
  val variantUrl: String? = null,
  val head: Long? = null,
  /** LL-HLS parts past [head] at the last observation; 0 for plain HLS. */
  val partsMs: Long = 0,
  val advancedInVariant: Boolean = false,
  val mediaMs: Long = 0,
  val baselineOnAirMs: Long = 0,
  val lags: List<LagPoint> = emptyList(),
  val minLagMs: Long? = null,
  val delivery: Delivery = Delivery.UNKNOWN,
  val deliveredLagMs: Long? = null,
) {
  /** What is polled: the master, restricted to one rendition. */
  val pollUrl: String = hinted(playbackUrl)

  fun tick(nowMs: Long, onAirNow: Boolean): Pair<DeliveryWatch, List<PlaylistRequest>> {
    val elapsed = lastTickMs?.let { if (onAir) nowMs - it else 0 } ?: 0
    var next =
      copy(lastTickMs = nowMs, onAir = onAirNow, onAirMs = onAirMs + elapsed, sinceAdvanceMs = sinceAdvanceMs + elapsed)
    if (!onAirNow) return next.copy(delivery = Delivery.UNKNOWN, deliveredLagMs = null) to emptyList()
    if (next.pending != null && nowMs - next.pendingSinceMs >= REQUEST_TIMEOUT_MS) next = next.copy(pending = null)
    if (next.pending != null || nowMs < next.nextPollAtMs) return next to emptyList()
    val request = PlaylistRequest(next.nextRequestId, pollUrl)
    return next.copy(
      pending = request,
      pendingIsMaster = true,
      pendingSinceMs = nowMs,
      nextRequestId = next.nextRequestId + 1,
      nextPollAtMs = nowMs + POLL_MS,
    ) to listOf(request)
  }

  /** The answer to a request. A stale id is ignored. The request list is the variant fetch, when there is one. */
  fun fetched(requestId: Int, result: FetchResult, nowMs: Long): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    if (pending?.id != requestId) return Triple(this, emptyList(), null)
    val cleared = copy(pending = null)
    val playlist = (result as? FetchResult.Body)?.let { PlaylistParser.parse(it.text) }
    return when {
      result == FetchResult.NoContent && pendingIsMaster -> cleared.nothingLive()
      playlist is Playlist.Master && pendingIsMaster -> cleared.fetchVariant(playlist, nowMs)
      playlist is Playlist.Media -> cleared.observed(pending.url, playlist)
      else -> Triple(cleared.copy(delivery = Delivery.UNKNOWN), emptyList(), null)
    }
  }

  /** After a forced new session: the new session proves itself from zero. */
  fun newSession(): DeliveryWatch =
    copy(
      pending = null,
      sinceAdvanceMs = 0,
      variantUrl = null,
      head = null,
      partsMs = 0,
      advancedInVariant = false,
      mediaMs = 0,
      lags = emptyList(),
      minLagMs = null,
      delivery = Delivery.UNKNOWN,
      deliveredLagMs = null,
    )

  private fun fetchVariant(master: Playlist.Master, nowMs: Long): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val url = PlaylistParser.resolve(pollUrl, master.variants.first())
      ?: return Triple(copy(delivery = Delivery.UNKNOWN), emptyList(), null)
    val request = PlaylistRequest(nextRequestId, url)
    val next = copy(pending = request, pendingIsMaster = false, pendingSinceMs = nowMs, nextRequestId = nextRequestId + 1)
    return Triple(next, listOf(request), null)
  }

  private fun nothingLive(): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val next = copy(delivery = stalledOr(Delivery.UNKNOWN), deliveredLagMs = null)
    val verdict = if (sinceAdvanceMs >= NOT_DELIVERED_MS) NotDelivered(NotDeliveredCause.STALLED, sinceAdvanceMs, null) else null
    return Triple(next, emptyList(), verdict)
  }

  private fun observed(url: String, media: Playlist.Media): Triple<DeliveryWatch, List<PlaylistRequest>, NotDelivered?> {
    val moved = advancedBy(url, media)
    val lagMs = moved.onAirMs - moved.baselineOnAirMs - moved.mediaMs
    val lags = (moved.lags + LagPoint(moved.onAirMs, lagMs)).filter { it.onAirMs >= moved.onAirMs - LAG_WINDOW_MS }
    val minLag = minOf(moved.minLagMs ?: lagMs, lagMs)
    val growth = lagMs - lags.minOf { it.lagMs }
    val delivery = if (moved.advancedInVariant) moved.stalledOr(Delivery.OK) else moved.stalledOr(Delivery.UNKNOWN)
    val next = moved.copy(lags = lags, minLagMs = minLag, delivery = delivery, deliveredLagMs = lagMs - minLag)
    val verdict =
      when {
        next.sinceAdvanceMs >= NOT_DELIVERED_MS -> NotDelivered(NotDeliveredCause.STALLED, next.sinceAdvanceMs, growth)
        growth >= LAG_GROWTH_LIMIT_MS -> NotDelivered(NotDeliveredCause.LAGGING, next.sinceAdvanceMs, growth)
        else -> null
      }
    return Triple(next, emptyList(), verdict)
  }

  /**
   * Positions compare only within one variant. A new variant is a new baseline and not progress.
   * The position is the head plus its trailing parts: a new part is progress, and when parts roll
   * into a completed segment, the parts already counted are taken off that segment's duration.
   */
  private fun advancedBy(url: String, media: Playlist.Media): DeliveryWatch {
    val previous = head
    if (url != variantUrl || previous == null || media.head < previous) {
      return copy(
        variantUrl = url,
        head = media.head,
        partsMs = media.partsMs,
        advancedInVariant = false,
        mediaMs = 0,
        baselineOnAirMs = onAirMs,
        lags = emptyList(),
        minLagMs = null,
      )
    }
    if (media.head == previous && media.partsMs <= partsMs) return this
    val firstNew = (previous + 1 - media.mediaSequence).coerceAtLeast(0).toInt()
    val added = (media.segmentDurationsMs.drop(firstNew).sum() - partsMs + media.partsMs).coerceAtLeast(0)
    return copy(head = media.head, partsMs = media.partsMs, mediaMs = mediaMs + added, sinceAdvanceMs = 0, advancedInVariant = true)
  }

  private fun stalledOr(otherwise: Delivery): Delivery = if (sinceAdvanceMs >= STALLED_AFTER_MS) Delivery.STALLED else otherwise

  companion object {
    /** "Polls the variant playlist every ~2 s" (spec §3). */
    const val POLL_MS = 2_000L

    /** The segment we configure: Cloudflare's ~2 s segments (P5 Run A: 996 of 998 at ~2 s). */
    const val CONFIGURED_SEGMENT_MS = 2_000L

    /**
     * Three configured segments (F-P5-4's fix, 6 s). Healthy cells never went 4.63 s between advances.
     * The same for LL-HLS: a part target (~0.3 s) would call every hiccup a stall.
     */
    const val STALLED_AFTER_MS = 3 * CONFIGURED_SEGMENT_MS

    /** "A stall of about 20 s … means not-delivered" (spec §3; F-P5-13's "~20 s"). */
    const val NOT_DELIVERED_MS = 10 * CONFIGURED_SEGMENT_MS

    /** Delivered media falling 20 s further behind publishing within one minute. */
    const val LAG_GROWTH_LIMIT_MS = 20_000L
    const val LAG_WINDOW_MS = 60_000L

    /** A request unanswered this long is abandoned, so a hung fetch never stops the watch. */
    const val REQUEST_TIMEOUT_MS = 10_000L

    /** Mbps. Low, so Cloudflare answers with its lowest rendition, the one every ladder has. */
    const val BANDWIDTH_HINT_MBPS = "0.1"

    /** [url] with `clientBandwidthHint` added to whatever query it already has. */
    fun hinted(url: String): String {
      val separator = if ('?' in url) '&' else '?'
      return "$url${separator}clientBandwidthHint=$BANDWIDTH_HINT_MBPS"
    }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **18** tests. On the B4 branch the full suite gives **57**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): delivery watch that catches a session nobody receives (F-P5-13)

Polls the master fresh with a low clientBandwidthHint, reads plain HLS and
LL-HLS, and judges on the configured segment, never targetDuration.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 11: `HoldClock` (C2, H-P5-1)

**Files:** Create `K/HoldClock.kt` and `T/HoldClockTest.kt`.

**Interfaces:**

- Consumes: `Transport`.
- Produces:
  - `Hold(transport, windowSeconds, startedAtMs)`, with `remainingSeconds(nowMs)` (rounded up) and `expired(nowMs)`;
  - `HoldClock.started(windows, transport, nowMs): Hold?`, which is null for a missing or non-positive window.

- [ ] **Step 1: Write the failing test**

`T/HoldClockTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HoldClockTest {
  private val windows = mapOf(Transport.SRT to 183, Transport.RTMPS to 180)

  @Test
  fun `C2 the status line's example - 38 s of 183`() {
    // Spec §4: "Uplink lost — holding, 38 s of 183".
    val hold = HoldClock.started(windows, Transport.SRT, nowMs = 10_000)!!
    assertEquals(183, hold.windowSeconds)
    assertEquals(38, hold.remainingSeconds(10_000 + 145_000))
    assertEquals(38, hold.remainingSeconds(10_000 + 145_999))
    assertEquals(37, hold.remainingSeconds(10_000 + 146_000))
  }

  @Test
  fun `C2 the window is the transport's`() {
    assertEquals(180, HoldClock.started(windows, Transport.RTMPS, 0)!!.windowSeconds)
  }

  @Test
  fun `the hold expires at the window, not a second before`() {
    val hold = HoldClock.started(windows, Transport.SRT, 0)!!
    assertFalse(hold.expired(182_999))
    assertEquals(1, hold.remainingSeconds(182_999))
    assertTrue(hold.expired(183_000))
    assertEquals(0, hold.remainingSeconds(200_000))
  }

  @Test
  fun `a missing or non-positive window gives no hold`() {
    assertNull(HoldClock.started(mapOf(Transport.SRT to 0), Transport.SRT, 0))
    assertNull(HoldClock.started(emptyMap(), Transport.RTMPS, 0))
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*HoldClockTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `HoldClockTest.kt:15:16 Unresolved reference 'HoldClock'.`

- [ ] **Step 3: Write `HoldClock.kt`**

`K/HoldClock.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * One outage's hold (C2): how long the platform keeps the input for a publisher that has gone. The
 * window is per transport, from the descriptor, and the clock starts at the phone's own drop.
 *
 * H-P5-1 measured the platform timing its hold from when it *notices* the publisher is gone, which is
 * at or after the phone's drop (~0.25 s for a clean close, ~30 s for a vanished one). So a count
 * from the drop never overstates the time left.
 */
data class Hold(val transport: Transport, val windowSeconds: Int, val startedAtMs: Long) {
  fun remainingSeconds(nowMs: Long): Int {
    val remainingMs = windowSeconds * 1_000L - (nowMs - startedAtMs)
    return if (remainingMs <= 0) 0 else ((remainingMs + 999) / 1_000).toInt()
  }

  fun expired(nowMs: Long): Boolean = nowMs - startedAtMs >= windowSeconds * 1_000L
}

object HoldClock {
  /** Null when the descriptor gave no window for [transport]; `SessionConfig.problems` refuses that at arm. */
  fun started(windows: Map<Transport, Int>, transport: Transport, nowMs: Long): Hold? =
    windows[transport]?.takeIf { it > 0 }?.let { Hold(transport, it, nowMs) }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **4** tests. On the B4 branch the full suite gives **61**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): hold clock per transport (C2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 12: `Heartbeat` (ruling 5)

**Files:** Create `K/Heartbeat.kt` and `T/HeartbeatTest.kt`.

**Interfaces:**

- Consumes: `SnapshotState`, `Transport`, `Delivery`, `HeartbeatResult`, `Json`, `Decimal`, `IsoTime`.
- Produces:
  - `HeartbeatResponse` (`Answered(status, state, endReason)`, `Failed(message)`);
  - `HeartbeatFacts`, the _Ask_'s payload fields;
  - `HeartbeatState`;
  - the functions `Heartbeat.due(state, nowMs, wallMs): Pair<HeartbeatState, Int?>`, `answered(state, id, response): Pair<HeartbeatState, Boolean>` (true means the session is over) and `payload(facts)`;
  - the constants `INTERVAL_MS` and `TIMEOUT_MS`, both 10 000.

  Plan C posts with a 10 s timeout and answers every beat with `Answered` or `Failed`. It never retries: the core already sends the next beat.

- [ ] **Step 1: Write the failing test**

`T/HeartbeatTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.util.Locale
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HeartbeatTest {
  private val saved = Locale.getDefault()

  @AfterTest
  fun restoreLocale() = Locale.setDefault(saved)

  private val facts =
    HeartbeatFacts(
      sid = "sess_42",
      atEpochMs = 1_790_778_725_123,
      state = SnapshotState.Degraded(Transport.RTMPS, listOf(DegradeReason.FELL_BACK_TO_RTMPS), 0),
      transport = Transport.RTMPS,
      bitrateKbps = 2_900,
      delivery = Delivery.OK,
      deliveredLagMs = 1_500,
      audioOk = true,
      batteryPercent = 64,
      charging = false,
      drainPctPerHour = 18.04,
      thermalStatus = 2,
      dataUsedBytes = 1_410_000_000,
      appVersion = "1.0.0",
    )

  // The expected body is written out from the spec's _Ask_ → Heartbeat, field by field.
  private val expected =
    """{"sid":"sess_42","at":"2026-09-30T14:32:05.123Z","state":"degraded","transport":"rtmps",""" +
      """"bitrateKbps":2900,"delivery":"ok","deliveredLagS":1.5,"audioOk":true,""" +
      """"battery":{"percent":64,"charging":false,"drainPctPerHour":18.0},"thermal":2,""" +
      """"dataUsedMB":1410.0,"appVersion":"1.0.0"}"""

  @Test
  fun `ruling 5 the payload carries the Ask's fields in its order`() {
    assertEquals(expected, Heartbeat.payload(facts))
  }

  @Test
  fun `the payload is the same on a French, Dutch or Spanish phone`() {
    for (tag in listOf("fr-FR", "nl-NL", "es-ES")) {
      Locale.setDefault(Locale.forLanguageTag(tag))
      assertEquals(expected, Heartbeat.payload(facts))
    }
  }

  @Test
  fun `an armed phone reports no transport, bitrate or lag`() {
    val armed = facts.copy(state = SnapshotState.Armed, transport = null, bitrateKbps = null, deliveredLagMs = null, delivery = Delivery.UNKNOWN)
    val body = Heartbeat.payload(armed)
    assertTrue(""""state":"armed","transport":null,"bitrateKbps":null,"delivery":"unknown","deliveredLagS":null""" in body)
  }

  @Test
  fun `the first beat is due at once, then every 10 s`() {
    var state = HeartbeatState()
    val sent = mutableListOf<Long>()
    for (t in 0L..30_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, wallMs = t)
      state = next
      if (id != null) {
        sent += t
        state = Heartbeat.answered(state, id, HeartbeatResponse.Answered(200, "live", null)).first
      }
    }
    assertEquals(listOf(0L, 10_000L, 20_000L, 30_000L), sent)
  }

  @Test
  fun `ruling 5 a 410 means the session is over`() {
    val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(410, null, "stopped"))
    assertTrue(over)
    assertEquals(HeartbeatResult.SESSION_OVER, after.lastResult)
  }

  @Test
  fun `ruling 5 a 200 with a finished state means the session is over`() {
    for (finished in listOf("ending", "completed", "failed")) {
      val (state, id) = Heartbeat.due(HeartbeatState(), 0, 0)
      assertTrue(Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, finished, "stopped")).second, finished)
    }
  }

  @Test
  fun `a 200 that is live or warming is ok and clears the run of failures`() {
    val failing = HeartbeatState(consecutiveFailures = 4, failures = 4)
    for (live in listOf("live", "warming")) {
      val (state, id) = Heartbeat.due(failing, 0, 0)
      val (after, over) = Heartbeat.answered(state, id!!, HeartbeatResponse.Answered(200, live, null))
      assertFalse(over)
      assertEquals(HeartbeatResult.OK, after.lastResult)
      assertEquals(0, after.consecutiveFailures)
      assertEquals(4, after.failures)
    }
  }

  @Test
  fun `a 401, a 500 and a network failure are counted and never over, and a bare 200 is ok`() {
    val responses =
      listOf(
        HeartbeatResponse.Answered(401, null, null),
        HeartbeatResponse.Answered(500, null, null),
        HeartbeatResponse.Failed("timeout"),
      )
    var state = HeartbeatState()
    var t = 0L
    for (response in responses) {
      val (sent, id) = Heartbeat.due(state, t, t)
      val (after, over) = Heartbeat.answered(sent, id!!, response)
      assertFalse(over)
      state = after
      t += Heartbeat.INTERVAL_MS
    }
    assertEquals(3, state.failures)
    assertEquals(3, state.consecutiveFailures)
    assertEquals(HeartbeatResult.FAILED, state.lastResult)
    val (sent, id) = Heartbeat.due(state, t, t)
    assertFalse(Heartbeat.answered(sent, id!!, HeartbeatResponse.Answered(200, null, null)).second)
  }

  @Test
  fun `ruling 5 a beat that never comes back is failed at 10 s and the next one goes`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    assertEquals(1, id)
    val (skipped, none) = Heartbeat.due(first, 5_000, 5_000)
    assertNull(none, "no second beat while one is in flight")
    val (second, next) = Heartbeat.due(skipped, 10_000, 10_000)
    assertEquals(2, next)
    assertEquals(1, second.failures)
  }

  @Test
  fun `a heartbeat that fails forever keeps beating every 10 s`() {
    var state = HeartbeatState()
    var sent = 0
    for (t in 0L until 1_000_000L step 500) {
      val (next, id) = Heartbeat.due(state, t, t)
      state = next
      if (id != null) sent += 1
    }
    assertEquals(100, sent)
    assertEquals(99, state.failures)
  }

  @Test
  fun `an answer to a beat already given up is ignored`() {
    val (first, id) = Heartbeat.due(HeartbeatState(), 0, 0)
    val (second, _) = Heartbeat.due(first, 10_000, 10_000)
    val (after, over) = Heartbeat.answered(second, id!!, HeartbeatResponse.Answered(410, null, null))
    assertFalse(over)
    assertEquals(second, after)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*HeartbeatTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `HeartbeatTest.kt:18:5 Unresolved reference 'HeartbeatFacts'.`

- [ ] **Step 3: Write `Heartbeat.kt`**

`K/Heartbeat.kt`:

```kotlin
package com.seazn.capture.engine.core

/** The heartbeat's answer, already typed by the platform's HTTP client. */
sealed interface HeartbeatResponse {
  /** [state] and [endReason] are the response body's `{state, endReason?}`; null when absent or unreadable. */
  data class Answered(val status: Int, val state: String?, val endReason: String?) : HeartbeatResponse

  data class Failed(val message: String) : HeartbeatResponse
}

/** What one beat reports (spec, _Ask_ → Heartbeat). Built from the snapshot; carries no secret. */
data class HeartbeatFacts(
  val sid: String,
  val atEpochMs: Long,
  val state: SnapshotState,
  val transport: Transport?,
  val bitrateKbps: Int?,
  val delivery: Delivery,
  val deliveredLagMs: Long?,
  val audioOk: Boolean,
  val batteryPercent: Int?,
  val charging: Boolean?,
  val drainPctPerHour: Double?,
  val thermalStatus: Int?,
  val dataUsedBytes: Long,
  val appVersion: String,
)

data class HeartbeatState(
  val nextDueAtMs: Long = 0,
  val inFlightId: Int? = null,
  val inFlightSinceMs: Long = 0,
  val nextId: Int = 1,
  val lastSentAtEpochMs: Long? = null,
  val lastResult: HeartbeatResult? = null,
  val consecutiveFailures: Int = 0,
  val failures: Int = 0,
) {
  val status: HeartbeatStatus
    get() = HeartbeatStatus(lastSentAtEpochMs, lastResult, consecutiveFailures, failures)

  internal fun failed(): HeartbeatState =
    copy(inFlightId = null, lastResult = HeartbeatResult.FAILED, consecutiveFailures = consecutiveFailures + 1, failures = failures + 1)
}

/**
 * Ruling 5: a heartbeat to the console every ~10 s while armed or live, sent natively (ruling 6). It
 * never blocks or degrades the stream: a failure is counted and dropped, and a beat that never comes
 * back is given up after [TIMEOUT_MS] so the next one still goes. Its answer is the phone's way to
 * learn of an organiser stop (decision 9).
 */
object Heartbeat {
  const val INTERVAL_MS = 10_000L
  const val TIMEOUT_MS = 10_000L

  /** Descriptor states that mean the session is over (spec, _Ask_ → Descriptor). */
  val OVER_STATES = setOf("ending", "completed", "failed")

  /** The id of the beat to send now, or null. */
  fun due(state: HeartbeatState, nowMs: Long, wallMs: Long): Pair<HeartbeatState, Int?> {
    var next = state
    if (next.inFlightId != null && nowMs - next.inFlightSinceMs >= TIMEOUT_MS) next = next.failed()
    if (next.inFlightId != null || nowMs < next.nextDueAtMs) return next to null
    val id = next.nextId
    return next.copy(
      inFlightId = id,
      inFlightSinceMs = nowMs,
      nextId = id + 1,
      nextDueAtMs = nowMs + INTERVAL_MS,
      lastSentAtEpochMs = wallMs,
    ) to id
  }

  /** The answer to beat [id]. The boolean is true when the server says the session is over. */
  fun answered(state: HeartbeatState, id: Int, response: HeartbeatResponse): Pair<HeartbeatState, Boolean> {
    if (state.inFlightId != id) return state to false
    val over =
      response is HeartbeatResponse.Answered &&
        (response.status == 410 || (response.status in 200..299 && response.state in OVER_STATES))
    return when {
      over -> state.copy(inFlightId = null, lastResult = HeartbeatResult.SESSION_OVER) to true
      response is HeartbeatResponse.Answered && response.status in 200..299 ->
        state.copy(inFlightId = null, lastResult = HeartbeatResult.OK, consecutiveFailures = 0) to false
      else -> state.failed() to false
    }
  }

  fun payload(facts: HeartbeatFacts): String =
    Json.obj(
      listOf(
        "sid" to facts.sid,
        "at" to IsoTime.utc(facts.atEpochMs),
        "state" to facts.state,
        "transport" to facts.transport,
        "bitrateKbps" to facts.bitrateKbps,
        "delivery" to facts.delivery,
        "deliveredLagS" to facts.deliveredLagMs?.let { Decimal.tenths(it / 1_000.0) },
        "audioOk" to facts.audioOk,
        "battery" to
          JsonObject(
            listOf(
              "percent" to facts.batteryPercent,
              "charging" to facts.charging,
              "drainPctPerHour" to facts.drainPctPerHour?.let { Decimal.tenths(it) },
            )
          ),
        "thermal" to facts.thermalStatus,
        "dataUsedMB" to Decimal.tenths(facts.dataUsedBytes / 1_000_000.0),
        "appVersion" to facts.appVersion,
      )
    )
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **11** tests. On the B4 branch the full suite gives **72**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): heartbeat that never blocks the stream (ruling 5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 13: `SessionRecord` (AGENTS §11, the P5 scrub rule)

**Files:** Create `K/SessionRecord.kt` and `T/SessionRecordTest.kt`.

**Interfaces:**

- Consumes: `Json`, `Decimal`, `IsoTime`, `Wire`, `SessionConfig.secrets()`.
- Produces:
  - `RecordEntry(kind, fields)`;
  - `SessionRecord(sink: (String) -> Unit)`, with `protect(config)`, `append(atEpochMs, entry)`, `lastLines()` (the last 20, for Diagnostics) and `sinkFailures`;
  - the key lists `PUBLIC_URL_KEYS`, `TEXT_KEYS`, `PLAIN_KEYS` and `NEVER`.

  Plan C's sink appends each NDJSON line to the session's file and feeds the levelled logger (AGENTS §11).

- [ ] **Step 1: Write the failing test**

`T/SessionRecordTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.net.URLEncoder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionRecordTest {
  private val lines = mutableListOf<String>()
  private val record = SessionRecord { lines += it }.apply { protect(Configs.valid()) }
  private val secrets = listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_ID, Configs.STREAM_KEY)

  private fun write(vararg fields: Pair<String, Any?>): String {
    record.append(1_790_778_725_123, RecordEntry("test", fields.toList()))
    return lines.last()
  }

  @Test
  fun `a line is one JSON object with at and kind first`() {
    val line = write("transport" to Transport.SRT, "attempt" to 3, "validated" to true, "fps" to 29.96)
    assertEquals("""{"at":"2026-09-30T14:32:05.123Z","kind":"test","transport":"srt","attempt":3,"validated":true,"fps":30.0}""", line)
  }

  @Test
  fun `P5 scrub rule - a public URL passes verbatim though the stream id is in it`() {
    assertTrue(Configs.PLAYBACK_URL in write("playbackUrl" to Configs.PLAYBACK_URL))
  }

  @Test
  fun `the token is masked even inside a public URL`() {
    val line = write("playbackUrl" to "${Configs.PLAYBACK_URL}?tok=${Configs.TOKEN}")
    assertFalse(Configs.TOKEN in line)
    assertTrue(Configs.STREAM_ID in line)
  }

  @Test
  fun `tok, passphrases, stream keys and stream ids never pass under their own names`() {
    val line =
      write("tok" to Configs.TOKEN, "passphrase" to Configs.PASSPHRASE, "streamKey" to Configs.STREAM_KEY, "streamId" to Configs.STREAM_ID)
    for (secret in secrets) assertFalse(secret in line, "leaked $secret")
  }

  @Test
  fun `a secret quoted in free text is masked, URL-encoded or not`() {
    val encoded = URLEncoder.encode(Configs.PASSPHRASE, "UTF-8")
    val quoted = "connect srt://live.cloudflare.com:778?streamid=${Configs.STREAM_ID}&passphrase=$encoded " +
      "rtmps://live.cloudflare.com:443/live/${Configs.STREAM_KEY} Bearer ${Configs.TOKEN}"
    val line = write("message" to quoted)
    for (secret in secrets + encoded) assertFalse(secret in line, "leaked $secret")
    assertTrue("live.cloudflare.com" in line)
  }

  @Test
  fun `a string under a key the record does not know is masked`() {
    assertTrue(""""surprise":"***"""" in write("surprise" to "anything"))
  }

  @Test
  fun `a value of a type the record does not know is masked, not stringified`() {
    assertTrue(""""transport":"***"""" in write("transport" to listOf(Configs.srt)))
  }

  @Test
  fun `no key on an allow-list is also on the never list`() {
    val allowed = SessionRecord.PUBLIC_URL_KEYS + SessionRecord.TEXT_KEYS + SessionRecord.PLAIN_KEYS
    assertTrue(allowed.intersect(SessionRecord.NEVER).isEmpty())
  }

  @Test
  fun `a newline in free text cannot split a line`() {
    val line = write("message" to "first\nsecond")
    assertEquals(1, line.lines().size)
  }

  @Test
  fun `the last 20 lines are kept for Diagnostics`() {
    repeat(25) { write("attempt" to it) }
    val last = record.lastLines()
    assertEquals(20, last.size)
    assertTrue(last.first().endsWith(""""attempt":5}"""))
    assertTrue(last.last().endsWith(""""attempt":24}"""))
  }

  @Test
  fun `a sink that throws is counted and never throws out`() {
    val broken = SessionRecord { throw IllegalStateException("disk full") }
    broken.append(0, RecordEntry("armed"))
    broken.append(0, RecordEntry("connecting"))
    assertEquals(2, broken.sinkFailures)
    assertEquals(2, broken.lastLines().size)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*SessionRecordTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `SessionRecordTest.kt:11:24 Unresolved reference 'SessionRecord'.`

- [ ] **Step 3: Write `SessionRecord.kt`**

`K/SessionRecord.kt`:

```kotlin
package com.seazn.capture.engine.core

import java.net.URLEncoder

/** One line of the session record, before the scrub. [kind] is the core's own vocabulary. */
data class RecordEntry(val kind: String, val fields: List<Pair<String, Any?>> = emptyList())

/**
 * The post-match session record (AGENTS §11): timestamped transitions, fallbacks, reconnects,
 * thermal readings and heartbeat results, one JSON object per line.
 *
 * Scrubbed at the sink, by allow-list (P5's scrub rule). A string passes only under a key this
 * object knows; public URLs pass verbatim, because every viewer already holds them. The same value
 * can be a secret in one role and public in another: the SRT stream id is a secret, and on
 * Cloudflare it is also a path segment of the public playback URL. So the stream id is masked
 * everywhere except inside a public URL, and `tok`, passphrases and stream keys are masked everywhere.
 */
class SessionRecord(private val sink: (String) -> Unit) {
  private var secrets: List<String> = emptyList()
  private var urlSecrets: List<String> = emptyList()
  private val recent = ArrayDeque<String>()

  /** How many lines the sink refused. Surfaced in Diagnostics by plan C; never thrown. */
  var sinkFailures: Int = 0
    private set

  /**
   * Called for every arm, before the machine sees it. From then on these values never reach a line.
   * It only ever adds: a value that was a secret in this process stays masked.
   */
  fun protect(config: SessionConfig) {
    val all = config.secrets()
    val streamIds = listOfNotNull(config.primary, config.fallback).filterIsInstance<SrtTarget>().map { it.streamId }
    secrets = withEncodings(secrets + all)
    urlSecrets = withEncodings(urlSecrets + (all - streamIds.toSet()))
  }

  fun append(atEpochMs: Long, entry: RecordEntry) {
    val fields = listOf("at" to IsoTime.utc(atEpochMs), "kind" to entry.kind) + entry.fields.map { (key, value) -> key to scrub(key, value) }
    val line = Json.obj(fields)
    recent.addLast(line)
    while (recent.size > LAST_LINES) recent.removeFirst()
    try {
      sink(line)
    } catch (_: Exception) {
      sinkFailures += 1
    }
  }

  /** The last [LAST_LINES] lines, oldest first, for Diagnostics (spec §4). */
  fun lastLines(): List<String> = recent.toList()

  private fun scrub(key: String, value: Any?): Any? =
    when {
      key in NEVER -> MASK
      value == null || value is Boolean || value is Int || value is Long || value is Wire || value is Decimal -> value
      value is Double -> Decimal.tenths(value)
      value !is String -> MASK
      key in PUBLIC_URL_KEYS -> masked(value, urlSecrets)
      key in PLAIN_KEYS || key in TEXT_KEYS -> masked(value, secrets)
      else -> MASK
    }

  private fun masked(text: String, values: List<String>): String = values.fold(text) { acc, secret -> acc.replace(secret, MASK) }

  /** Longest first, so a secret that contains another is masked whole; URL-encoded forms too. */
  private fun withEncodings(values: List<String>): List<String> =
    values.filter { it.isNotBlank() }.flatMap { listOf(it, URLEncoder.encode(it, "UTF-8")) }.distinct().sortedByDescending { it.length }

  companion object {
    const val LAST_LINES = 20
    const val MASK = "***"

    /** Public by construction: every viewer's player and every overlay browser source holds them. */
    val PUBLIC_URL_KEYS = setOf("playbackUrl", "overlayUrl")

    /** Free text from a library or the platform, which can quote a URL or a key. Masked by value. */
    val TEXT_KEYS = setOf("message", "problems")

    /** The core's own vocabulary and measurements' labels. Masked by value too, as defence in depth. */
    val PLAIN_KEYS =
      setOf("sid", "transport", "reason", "cause", "failure", "from", "to", "result", "state", "endReason", "delivery", "shed", "intent", "phase", "host", "appVersion")

    /** Never written, whatever the value, and never allowed onto the lists above. */
    val NEVER = setOf("tok", "token", "passphrase", "streamKey", "streamId", "bearer", "authorization")
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **11** tests. On the B5 branch the full suite gives **39**.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): session record scrubbed by allow-list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 14: `SessionMachine` and `Projection`

This is where the units meet. The machine is one reducer over a sealed `Phase` (decision 4). The four test files are written first, against a rig that drives the reducer the way plan C's adapters will.

**Files:**

- Create `K/Input.kt`, `K/Command.kt`, `K/Phase.kt`, `K/SessionMachine.kt` and `K/Projection.kt`.
- Create `T/MachineRig.kt`, `T/SessionMachineLifecycleTest.kt`, `T/SessionMachineOutageTest.kt`, `T/SessionMachineDeviceTest.kt` and `T/SessionMachineServerTest.kt`.

**Interfaces:**

- Consumes every earlier unit.
- Produces:
  - `Input`: the intents `Arm(config)`, `Start`, `Stop` and `Reset`; `Tick`; and the platform facts `Connected`, `ConnectFailed`, `Dropped`, `Frames`, `Link`, `Network`, `CameraContended`, `CameraReleased`, `CameraReopened`, `MicSilenced`, `Device`, `PlaylistFetched`, `HeartbeatAnswered` and `DescriptorChecked`. A fact carries its `attemptId`, and a fact about an old attempt is ignored.
  - `Command`:
    - connection: `Connect(attemptId, target, startBitrateBps, maxBwBytesPerSecond?)`, `Disconnect`, `Rebuild(previousAttemptId, next)` and `StartNewSession(previousAttemptId, next)`;
    - encode and camera: `SetBitrate`, `SetMaxBw`, `ReopenCamera` and `Slate(on)`;
    - server: `FetchPlaylist`, `PostHeartbeat(beatId, url, bearer, body)` (its `toString` redacts) and `FetchDescriptor`;
    - lifecycle: `End(reason)` and `Record(entry)`.
  - `Phase` (`Idle`, `Armed`, `Connecting`, `OnAir`, `Ended`), `Session` and `Outage`.
  - `SessionMachine.reduce(phase, input, now): Step(phase, commands)`, with the constants `RETRY_MS` 2 000, `CONNECT_TIMEOUT_MS` 15 000 and `POOR_UPLINK_MS` 30 000.
  - `Projection.snapshot(phase, now)`, `Projection.state(phase, now)` and `Projection.heartbeatFacts(phase, session, now)`.

  **Plan C's adapter contract:**

  - A `Connect` is answered by `Connected` or `ConnectFailed`, and later by `Dropped`.
  - `Rebuild` and `StartNewSession` tear the attempt down and connect `next` without leaving the foreground service.
  - Every `FetchPlaylist`, `PostHeartbeat` and `FetchDescriptor` is answered, with `Failed` or `Unreachable` on error.

- [ ] **Step 1: Write the rig and the four test files**

`T/MachineRig.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * Drives [SessionMachine] the way plan C's adapters will: intents, a tick every 500 ms, encoded
 * frames while on air, and — when a test sets them — link readings once a second and answers to
 * playlist fetches and heartbeats.
 */
class MachineRig(val config: SessionConfig = Configs.valid()) {
  var phase: Phase = Phase.Idle
  var mono = 0L
  var wall = 1_790_000_000_000L
  val commands = mutableListOf<Command>()

  /** Answers each playlist fetch at once; null leaves it unanswered. */
  var playlists: ((String) -> FetchResult?)? = null

  /** Answers each heartbeat at once; null leaves it unanswered. */
  var beats: ((Int) -> HeartbeatResponse?)? = null

  /** Link counters once a second while on air; null sends none. */
  var link: ((Long) -> LinkCounters)? = null

  private var video = 0L
  private var audio = 0L
  private var feedingAttempt: Int? = null

  val now: Now
    get() = Now(mono, wall)

  val state: SnapshotState
    get() = Projection.state(phase, now)

  val snapshot: Snapshot
    get() = Projection.snapshot(phase, now)

  /** The attempt the machine is connecting or publishing, if any. */
  val attempt: Int?
    get() = (phase as? Phase.OnAir)?.attemptId ?: ((phase as? Phase.Connecting)?.step as? ConnectStep.Requested)?.attemptId

  fun send(input: Input): List<Command> {
    val step = SessionMachine.reduce(phase, input, now)
    phase = step.phase
    commands += step.commands
    for (command in step.commands) answer(command)
    return step.commands
  }

  private fun answer(command: Command) {
    when (command) {
      is Command.FetchPlaylist -> playlists?.invoke(command.url)?.let { send(Input.PlaylistFetched(command.requestId, it)) }
      is Command.PostHeartbeat -> beats?.invoke(command.beatId)?.let { send(Input.HeartbeatAnswered(command.beatId, it)) }
      else -> Unit
    }
  }

  /** Moves time in 500 ms steps. On air and [videoPerStep] > 0 is 30 fps; [audioPerStep] 23 is ~46 a second. */
  fun advance(ms: Long, videoPerStep: Long = 15, audioPerStep: Long = 23, feeding: Boolean = true, onStep: () -> Unit = {}) {
    val end = mono + ms
    while (mono < end) {
      mono += 500
      wall += 500
      val onAir = phase as? Phase.OnAir
      if (onAir != null && feeding) feed(onAir.attemptId, videoPerStep, audioPerStep)
      if (onAir != null && mono % 1_000 == 0L) link?.let { send(Input.Link(onAir.attemptId, it(mono))) }
      send(Input.Tick)
      onStep()
    }
  }

  private fun feed(attemptId: Int, videoAdd: Long, audioAdd: Long) {
    if (feedingAttempt != attemptId) {
      feedingAttempt = attemptId
      video = 0
      audio = 0
    }
    video += videoAdd
    audio += audioAdd
    send(Input.Frames(attemptId, video, audio))
  }

  fun armed(validated: Boolean = true): MachineRig {
    send(Input.Arm(config))
    send(Input.Network(validated))
    return this
  }

  /** Armed, started, connected, and a second of encoded frames: LIVE. */
  fun live(): MachineRig {
    armed()
    send(Input.Start)
    send(Input.Connected(attempt!!))
    advance(1_000)
    return this
  }

  /** Every connect attempt in order, whether sent bare or inside a rebuild or a new session. */
  fun connects(): List<Command.Connect> =
    commands.mapNotNull {
      when (it) {
        is Command.Connect -> it
        is Command.Rebuild -> it.next
        is Command.StartNewSession -> it.next
        else -> null
      }
    }

  inline fun <reified T : Command> sent(): List<T> = commands.filterIsInstance<T>()

  fun records(kind: String): List<RecordEntry> = sent<Command.Record>().map { it.entry }.filter { it.kind == kind }
}
```

`T/SessionMachineLifecycleTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineLifecycleTest {
  @Test
  fun `arm, start, connect and advancing frames is LIVE`() {
    val rig = MachineRig().live()
    val state = assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(Transport.SRT, state.transport)
    assertEquals(1_790_000_001_000, state.sinceEpochMs, "live since the first encoded frame")
  }

  @Test
  fun `F-P5-6 connected without an encoded frame is not LIVE, whatever egress says`() {
    // F-P5-3: the spike's sampler said streaming=true, 4.4 Mbps, while nothing was delivered.
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    val attempt = rig.attempt!!
    rig.send(Input.Connected(attempt))
    rig.send(Input.Link(attempt, LinkCounters(0, 0, 0, 0, 0, 20, 50, null)))
    rig.advance(1_000, feeding = false)
    rig.send(Input.Link(attempt, LinkCounters(500_000, 0, 0, 0, 0, 20, 50, null)))
    assertEquals(4_000, rig.snapshot.bitrateKbps)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `F-P5-4 audio with video flat is never LIVE, and the first-frame grace ends in a rebuild`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(rig.attempt!!))
    val states = mutableListOf<SnapshotState>()
    rig.advance(5_000, videoPerStep = 0) { states += rig.state }
    assertTrue(states.none { it is SnapshotState.Publishing || it is SnapshotState.Degraded }, "got $states")
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `F-P5-6 video stopping for 3 s rebuilds the pipeline and leaves LIVE`() {
    val rig = MachineRig().live()
    rig.advance(2_500, videoPerStep = 0)
    assertIs<SnapshotState.Publishing>(rig.state, "2.5 s without a frame is still inside the window")
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
    rig.advance(500, videoPerStep = 0)
    val rebuild = rig.sent<Command.Rebuild>().single()
    assertEquals(1, rebuild.previousAttemptId)
    assertEquals(2, rebuild.next.attemptId)
    val state = assertIs<SnapshotState.Reconnecting>(rig.state)
    assertEquals(ReconnectCause.VIDEO_STALLED, state.cause)
    assertEquals(1, rig.records("video-stalled").size)
  }

  @Test
  fun `a double start is one attempt`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Start)
    assertEquals(1, rig.connects().size)
    assertEquals(listOf("start" to "connecting"), rig.records("intent-ignored").map { it.fields[0].second to it.fields[1].second })
  }

  @Test
  fun `stop ends operator-stopped, and a second stop does nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    assertEquals(SnapshotState.Ended(EndReason.OPERATOR_STOPPED), rig.state)
    rig.send(Input.Stop)
    assertEquals(listOf(Command.End(EndReason.OPERATOR_STOPPED)), rig.sent<Command.End>())
  }

  @Test
  fun `stop from armed ends, reset returns to idle, and a new arm works`() {
    val rig = MachineRig().armed()
    rig.send(Input.Stop)
    assertIs<Phase.Ended>(rig.phase)
    rig.send(Input.Reset)
    assertEquals(Phase.Idle, rig.phase)
    rig.send(Input.Arm(Configs.valid()))
    assertIs<Phase.Armed>(rig.phase)
  }

  @Test
  fun `an arm while live is ignored - the engine is the authority`() {
    val rig = MachineRig().live()
    val before = rig.phase
    rig.send(Input.Arm(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)))
    assertEquals(before, rig.phase)
    assertEquals(1, rig.records("intent-ignored").size)
  }

  @Test
  fun `a reset while live is refused`() {
    val rig = MachineRig().live()
    rig.send(Input.Reset)
    assertIs<Phase.OnAir>(rig.phase)
  }

  @Test
  fun `an arm with an empty descriptor field ends fatal-error and says why`() {
    val empty =
      SessionConfig("sess_42", Configs.TOKEN, Configs.srt, Configs.rtmps, mapOf(Transport.SRT to 183, Transport.RTMPS to 180), "", "https://h/", "1.0.0")
    val rig = MachineRig(empty)
    rig.send(Input.Arm(empty))
    assertEquals(SnapshotState.Ended(EndReason.FATAL_ERROR), rig.state)
    assertEquals("playbackUrl is not https", rig.records("arm-refused").single().fields.single().second)
  }

  @Test
  fun `a fact about an old attempt is ignored, and an old connect is closed`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    val waiting = rig.phase
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(waiting, rig.phase)
    rig.send(Input.Connected(1))
    assertEquals(Command.Disconnect(1), rig.sent<Command.Disconnect>().single())
    rig.send(Input.Connected(2))
    assertEquals(2, (rig.phase as Phase.OnAir).attemptId)
  }

  @Test
  fun `a drop mid-connect is a failed connect, retried 2 s later`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, "Connection was broken"))
    assertEquals(1, rig.records("connect-failed").size)
    rig.advance(1_500)
    assertEquals(1, rig.connects().size)
    rig.advance(500)
    assertEquals(listOf(1, 2), rig.connects().map { it.attemptId })
  }

  @Test
  fun `a connect that never answers fails at 15 s`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.advance(14_500)
    assertTrue(rig.sent<Command.Disconnect>().isEmpty())
    rig.advance(500)
    assertEquals(Command.Disconnect(1), rig.sent<Command.Disconnect>().single())
    assertEquals(ConnectFailure.TIMEOUT, rig.records("connect-failed").single().fields.first { it.first == "failure" }.second)
    rig.advance(2_000)
    assertEquals(2, rig.connects().size)
  }
}
```

`T/SessionMachineOutageTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionMachineOutageTest {
  /** Answers every connect with [failure] as soon as it is asked for. */
  private fun MachineRig.failingConnects(ms: Long, failure: ConnectFailure = ConnectFailure.UNRESOLVED) =
    advance(ms) {
      val step = (phase as? Phase.Connecting)?.step
      if (step is ConnectStep.Requested) send(Input.ConnectFailed(step.attemptId, failure, null))
    }

  @Test
  fun `C2 an uplink drop counts down the transport's hold - 38 s of 183`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Network(validated = false))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.failingConnects(145_000)
    assertEquals(SnapshotState.Reconnecting(ReconnectCause.UPLINK_LOST, 38, 183, since), rig.state)
    assertTrue(rig.connects().all { it.target is SrtTarget }, "a dead network never falls back (F-P5-1)")
  }

  @Test
  fun `the hold's expiry ends the session hold-window-expired`() {
    val rig = MachineRig().live()
    rig.send(Input.Network(validated = false))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.failingConnects(182_500)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.failingConnects(500)
    assertEquals(SnapshotState.Ended(EndReason.HOLD_WINDOW_EXPIRED), rig.state)
  }

  @Test
  fun `F-P5-6 connected again after an outage is not LIVE until a frame advances`() {
    // The LIVE gate after a reconnect: the session has a live-since time, and still is not on air.
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000, feeding = false)
    assertIs<SnapshotState.Reconnecting>(rig.state)
    rig.advance(500)
    assertIs<SnapshotState.Reconnecting>(rig.state, "one reading is a baseline, not an advance")
    rig.advance(500)
    assertIs<SnapshotState.Publishing>(rig.state)
  }

  @Test
  fun `frames after a reconnect clear the outage and keep the live-since time`() {
    val rig = MachineRig().live()
    val since = (rig.state as SnapshotState.Publishing).sinceEpochMs
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    rig.send(Input.Connected(2))
    rig.advance(1_000)
    assertEquals(SnapshotState.Publishing(Transport.SRT, since), rig.state)
    assertEquals(1, rig.records("resumed").size)
  }

  @Test
  fun `a drop before the first frame is a retry with no hold`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertNull((rig.phase as Phase.Connecting).outage)
    assertEquals(SnapshotState.Connecting(Transport.SRT), rig.state)
  }

  @Test
  fun `F-P5-2 short-lived SRT sessions fall back to RTMPS`() {
    val rig = MachineRig().live()
    repeat(3) {
      rig.advance(6_000)
      rig.send(Input.Dropped(rig.attempt!!, DropReason.ENDPOINT_CLOSED, "Connection was broken"))
      rig.advance(2_000)
      rig.send(Input.Connected(rig.attempt!!))
    }
    assertEquals(listOf(Transport.SRT, Transport.SRT, Transport.SRT, Transport.RTMPS), rig.connects().map { it.target.transport })
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.FELL_BACK_TO_RTMPS), (rig.state as SnapshotState.Degraded).reasons)
    assertEquals(1, rig.records("fell-back").size)
  }

  @Test
  fun `C1 three validated connect failures fall back, and a dead network never does`() {
    val validated = MachineRig().armed(validated = true)
    validated.send(Input.Start)
    validated.failingConnects(6_500, ConnectFailure.TIMEOUT)
    assertEquals(Transport.RTMPS, validated.connects()[3].target.transport)

    val dead = MachineRig().armed(validated = false)
    dead.send(Input.Start)
    dead.failingConnects(40_000, ConnectFailure.TIMEOUT)
    assertTrue(dead.connects().size >= 20)
    assertTrue(dead.connects().all { it.target.transport == Transport.SRT })
  }

  @Test
  fun `every reconnect fetches the descriptor again`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    assertEquals(listOf(Command.FetchDescriptor), rig.sent<Command.FetchDescriptor>())
  }

  @Test
  fun `a descriptor that says the session is over ends stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.send(Input.DescriptorChecked(DescriptorCheck.Over("stopped")))
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
    assertEquals(Command.End(EndReason.STOPPED_BY_ORGANISER), rig.sent<Command.End>().single())
  }

  @Test
  fun `refused ingest asks the descriptor, and a live answer keeps trying`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.ConnectFailed(1, ConnectFailure.REFUSED, "publish rejected"))
    assertEquals(1, rig.sent<Command.FetchDescriptor>().size)
    rig.send(Input.DescriptorChecked(DescriptorCheck.Live))
    rig.advance(2_000)
    assertEquals(2, rig.connects().size)
  }

  @Test
  fun `F-P5-11 an SRT connect carries SRTO_MAXBW from the target, and RTMPS none`() {
    val srt = MachineRig().armed()
    srt.send(Input.Start)
    assertEquals(468_050, srt.connects().single().maxBwBytesPerSecond)
    assertEquals(1_500_000, srt.connects().single().startBitrateBps)
    val rtmps = MachineRig(Configs.valid(primary = Configs.rtmps, fallback = Configs.srt)).armed()
    rtmps.send(Input.Start)
    assertNull(rtmps.connects().single().maxBwBytesPerSecond)
  }

  /** 4 Mbps on a clean link, with optional trouble from [troubleAtMs] on. */
  private fun cleanLink(troubleAtMs: Long = Long.MAX_VALUE, trouble: (LinkCounters) -> LinkCounters = { it }): (Long) -> LinkCounters {
    var bytes = 0L
    return { t ->
      bytes += 500_000
      val clean = LinkCounters(bytes, t, 0, 0, 0, 20, 50, null)
      if (t >= troubleAtMs) trouble(clean) else clean
    }
  }

  @Test
  fun `a raise sets the bitrate and SRTO_MAXBW together`() {
    val rig = MachineRig()
    rig.link = cleanLink()
    rig.live()
    rig.advance(12_000)
    assertEquals(listOf(Command.SetBitrate(1, 1_600_000)), rig.sent<Command.SetBitrate>())
    // (1_600_000 + 128_000) × 115% × 2 / 8 = 496_800.
    assertEquals(listOf(Command.SetMaxBw(1, 496_800)), rig.sent<Command.SetMaxBw>())
  }

  @Test
  fun `regulator restart - a clean far-end drop reconnects at the last healthy target`() {
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 15_000) { it.copy(sendBufferMs = 1_200) }
    rig.live()
    rig.advance(14_000)
    assertEquals(1_200_000, rig.sent<Command.SetBitrate>().last().bps, "the fill cut 1600k by a quarter")
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    assertEquals(1_600_000, rig.connects().last().startBitrateBps)
  }

  @Test
  fun `regulator restart - a link that was losing packets halves`() {
    val rig = MachineRig()
    rig.link = cleanLink(troubleAtMs = 14_000) { it.copy(packetsLost = 5) }
    rig.live()
    rig.advance(13_000)
    rig.send(Input.Dropped(1, DropReason.ENDPOINT_CLOSED, null))
    rig.advance(2_000)
    assertEquals(800_000, rig.connects().last().startBitrateBps)
  }
}
```

`T/SessionMachineDeviceTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineDeviceTest {
  @Test
  fun `F-P5-10 a taken camera puts the slate on air and holds, with no rebuild`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    assertEquals(listOf(Command.Slate(on = true)), rig.sent<Command.Slate>())
    rig.advance(10_000, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "a rebuild buys nothing while another app holds the camera")
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(rig.state).reasons)
  }

  @Test
  fun `F-P5-10 the slate's own frames keep the session degraded camera-taken`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(5_000, videoPerStep = 1)
    assertEquals(listOf(DegradeReason.CAMERA_TAKEN), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty())
  }

  @Test
  fun `F-P5-10 on release the camera is reopened, then the slate comes off with a fresh stall window`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.advance(10_000, videoPerStep = 0)
    rig.send(Input.CameraReleased)
    assertEquals(listOf(Command.ReopenCamera), rig.sent<Command.ReopenCamera>())
    rig.send(Input.CameraReopened(ok = true))
    assertEquals(listOf(Command.Slate(true), Command.Slate(false)), rig.sent<Command.Slate>())
    rig.advance(2_500, videoPerStep = 0)
    assertTrue(rig.sent<Command.Rebuild>().isEmpty(), "the reopened camera gets 3 s")
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
  }

  @Test
  fun `F-P5-10 a failed reopen rebuilds`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraContended)
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraReopened(ok = false))
    assertEquals(1, rig.sent<Command.Rebuild>().size)
  }

  @Test
  fun `a second contended is one slate, and a release without a take does nothing`() {
    val rig = MachineRig().live()
    rig.send(Input.CameraReleased)
    rig.send(Input.CameraContended)
    rig.send(Input.CameraContended)
    assertEquals(1, rig.sent<Command.Slate>().size)
    assertTrue(rig.sent<Command.ReopenCamera>().isEmpty())
  }

  @Test
  fun `F-P5-8 a silenced mic is degraded mic-silenced until it is restored`() {
    val rig = MachineRig().live()
    rig.send(Input.MicSilenced(true))
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.MIC_SILENCED), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    rig.send(Input.MicSilenced(false))
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(1, rig.records("mic-silenced").size)
    assertEquals(1, rig.records("mic-restored").size)
  }

  @Test
  fun `AGENTS 8 - thermal travels as shed and is never a degrade reason`() {
    val rig = MachineRig().live()
    rig.send(Input.Device(DeviceSample(3, 0.9, 51, true, 18.0, ShedStep.OVERLAY_PREVIEW)))
    rig.advance(1_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(ShedStep.OVERLAY_PREVIEW, rig.snapshot.shed)
    assertEquals(3, rig.records("thermal").single().fields.first { it.first == "status" }.second)
  }

  @Test
  fun `a thermal reading is recorded only when it changes`() {
    val rig = MachineRig().live()
    val sample = DeviceSample(2, null, 70, true, null, null)
    repeat(5) { rig.send(Input.Device(sample)) }
    rig.send(Input.Device(sample.copy(thermalStatus = 3)))
    assertEquals(2, rig.records("thermal").size)
  }
}
```

`T/SessionMachineServerTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SessionMachineServerTest {
  private val masterText = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3128000\nstream_720/video.m3u8\n"

  private fun media(head: Long) =
    "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${head - 2}\n" +
      (head - 2..head).joinToString("") { "#EXTINF:2.000,\ns$it.ts\n" }

  @Test
  fun `F-P5-13 not-delivered forces a new session and shows until the playlist moves again`() {
    var head = 100L
    var moving = false
    val rig = MachineRig()
    rig.playlists = { url -> FetchResult.Body(if (url == Configs.PLAYBACK_URL + "?clientBandwidthHint=0.1") masterText else media(if (moving) ++head else head)) }
    rig.live()
    // Live at 1 s; the first poll at 1 s is the baseline; 20 s of publishing with no movement.
    rig.advance(19_500)
    assertTrue(rig.sent<Command.StartNewSession>().isEmpty())
    rig.advance(500)
    val restart = rig.sent<Command.StartNewSession>().single()
    assertEquals(1, restart.previousAttemptId)
    assertEquals(ReconnectCause.NOT_DELIVERED, assertIs<SnapshotState.Reconnecting>(rig.state).cause)
    rig.send(Input.Connected(restart.next.attemptId))
    rig.advance(1_000)
    assertEquals(listOf(DegradeReason.NOT_DELIVERED), assertIs<SnapshotState.Degraded>(rig.state).reasons)
    moving = true
    rig.advance(6_000)
    assertIs<SnapshotState.Publishing>(rig.state)
    assertEquals(1, rig.records("delivered").size)
  }

  @Test
  fun `the playlist is polled only while LIVE`() {
    val rig = MachineRig().armed()
    rig.send(Input.Start)
    rig.send(Input.Connected(1))
    rig.advance(4_000, feeding = false)
    assertTrue(rig.sent<Command.FetchPlaylist>().isEmpty())
  }

  @Test
  fun `ruling 5 heartbeats go every 10 s while armed, carrying the token only as the Bearer`() {
    val rig = MachineRig()
    rig.beats = { HeartbeatResponse.Answered(200, "warming", null) }
    rig.armed()
    rig.advance(30_000)
    val beats = rig.sent<Command.PostHeartbeat>()
    assertEquals(3, beats.size)
    for (beat in beats) {
      assertEquals(Configs.TOKEN, beat.bearer)
      assertEquals(Configs.valid().heartbeatUrl, beat.url)
      assertFalse(Configs.TOKEN in beat.body)
      assertFalse(Configs.TOKEN in beat.toString())
      assertTrue(""""state":"armed"""" in beat.body)
    }
  }

  @Test
  fun `ruling 5 an organiser stop in the heartbeat's answer ends stopped-by-organiser`() {
    val rig = MachineRig().live()
    rig.beats = { HeartbeatResponse.Answered(200, "ending", "stopped") }
    rig.advance(10_000)
    assertEquals(SnapshotState.Ended(EndReason.STOPPED_BY_ORGANISER), rig.state)
  }

  @Test
  fun `ruling 5 a heartbeat that fails forever never touches the stream`() {
    val rig = MachineRig()
    rig.beats = { HeartbeatResponse.Failed("timeout") }
    rig.live()
    val states = mutableListOf<SnapshotState>()
    rig.advance(600_000) { states += rig.state }
    assertTrue(states.all { it is SnapshotState.Publishing }, "the stream never noticed")
    assertTrue(rig.sent<Command.Rebuild>().isEmpty() && rig.sent<Command.End>().isEmpty())
    assertEquals(61, rig.snapshot.heartbeat.failures)
  }

  @Test
  fun `a heartbeat never answered is failed at 10 s, recorded, and the next goes`() {
    val rig = MachineRig().live()
    rig.advance(20_000)
    assertEquals(3, rig.sent<Command.PostHeartbeat>().size)
    assertEquals(2, rig.snapshot.heartbeat.failures)
    assertEquals(2, rig.records("heartbeat").size)
  }

  @Test
  fun `no heartbeat after the session ends`() {
    val rig = MachineRig().live()
    rig.send(Input.Stop)
    val before = rig.sent<Command.PostHeartbeat>().size
    rig.advance(30_000)
    assertEquals(before, rig.sent<Command.PostHeartbeat>().size)
  }

  @Test
  fun `the snapshot carries spec 2's telemetry`() {
    val rig = MachineRig()
    var bytes = 0L
    rig.link = { t ->
      bytes += 500_000
      LinkCounters(bytes, t, 7, 2, 0, 31, 40, null)
    }
    rig.live()
    rig.advance(4_000)
    val snapshot = rig.snapshot
    assertEquals(SrtTelemetry(sent = 5_000, retransmitted = 7, dropped = 2, rttMs = 31), snapshot.srt)
    assertEquals(4_000, snapshot.bitrateKbps)
    assertEquals(1_500, snapshot.targetBitrateKbps)
    assertEquals(2_000_000, snapshot.dataUsedBytes)
    assertEquals(30.0, snapshot.encodedVideoFps)
    assertEquals(46.0, snapshot.audioPacketsPerSecond)
  }
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*SessionMachine*' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `MachineRig.kt:9:14 Unresolved reference 'Phase'.`

- [ ] **Step 3: Write the inputs, the commands and the phases**

`K/Input.kt`:

```kotlin
package com.seazn.capture.engine.core

/** The descriptor fetched again on a reconnect (spec §1), already typed by the platform. */
sealed interface DescriptorCheck {
  data object Live : DescriptorCheck

  /** 410, or a state that is over. [endReason] is the server's, for the record. */
  data class Over(val endReason: String?) : DescriptorCheck

  data class Unreachable(val message: String) : DescriptorCheck
}

/**
 * Everything that happens to the engine: operator intents, the engine's own tick, and platform
 * facts from plan C's adapters. Each adapter turns one Android fact into one of these and holds no
 * rule of its own (spec §3, `platform/`).
 */
sealed interface Input {
  /** Intents, not RPC (AGENTS §2): each returns nothing and is reconciled against the phase. */
  data class Arm(val config: SessionConfig) : Input

  data object Start : Input

  data object Stop : Input

  data object Reset : Input

  /** The engine's clock, every [Engine.TICK_MS]. Every time-based rule runs on it. */
  data object Tick : Input

  /** Every fact about an attempt names it. A fact about an attempt that is over is stale, and ignored. */
  data class Connected(val attemptId: Int) : Input

  data class ConnectFailed(val attemptId: Int, val failure: ConnectFailure, val message: String?) : Input

  data class Dropped(val attemptId: Int, val reason: DropReason, val message: String?) : Input

  /** Encoded frames that reached the endpoint, cumulative for the attempt (F-P5-4). At least twice a second. */
  data class Frames(val attemptId: Int, val videoFrames: Long, val audioFrames: Long) : Input

  /** The transport's counters, cumulative for the attempt. About once a second. */
  data class Link(val attemptId: Int, val counters: LinkCounters) : Input

  /** `NET_CAPABILITY_VALIDATED`, pushed at arm and on every change. Until the first, it is not validated. */
  data class Network(val validated: Boolean) : Input

  /** Another app opened a camera while ours is held (F-P5-9). */
  data object CameraContended : Input

  /** No other app holds a camera any more (F-P5-10). */
  data object CameraReleased : Input

  data class CameraReopened(val ok: Boolean) : Input

  /** `AudioRecordingConfiguration.isClientSilenced()` for our session id (F-P5-8). */
  data class MicSilenced(val silenced: Boolean) : Input

  data class Device(val sample: DeviceSample) : Input

  data class PlaylistFetched(val requestId: Int, val result: FetchResult) : Input

  data class HeartbeatAnswered(val beatId: Int, val response: HeartbeatResponse) : Input

  data class DescriptorChecked(val result: DescriptorCheck) : Input
}
```

`K/Command.kt`:

```kotlin
package com.seazn.capture.engine.core

/**
 * What the core asks of the platform. Plan C's adapters carry each one out and report back as an
 * [Input]; none of them decides anything.
 */
sealed interface Command {
  /** Open an ingest session. [maxBwBytesPerSecond] is `SRTO_MAXBW` for SRT, null for RTMPS (F-P5-11). */
  data class Connect(
    val attemptId: Int,
    val target: IngestTarget,
    val startBitrateBps: Int,
    val maxBwBytesPerSecond: Long?,
  ) : Command

  data class Disconnect(val attemptId: Int) : Command

  /** Stop the stream and start it again, video pipeline included (F-P5-6, F-P5-9). */
  data class Rebuild(val previousAttemptId: Int, val next: Connect) : Command

  /** Close this ingest session and open a fresh one, because viewers are not receiving it (F-P5-13). */
  data class StartNewSession(val previousAttemptId: Int, val next: Connect) : Command

  data class SetBitrate(val attemptId: Int, val bps: Int) : Command

  data class SetMaxBw(val attemptId: Int, val bytesPerSecond: Long) : Command

  /** Reopen our camera with an ID round trip (F-P5-10: ~1.2 s, one black frame). */
  data object ReopenCamera : Command

  /** The phone-made slate on air instead of the camera, with silent audio (decision 7). */
  data class Slate(val on: Boolean) : Command

  /**
   * `GET url`, answered as [Input.PlaylistFetched]. Always a fresh fetch: no HTTP cache, no proxy,
   * `Cache-Control: no-cache`. Cloudflare's manifests are dynamic and must never be cached or stored.
   */
  data class FetchPlaylist(val requestId: Int, val url: String) : Command

  /** `POST url` with `Authorization: Bearer <bearer>`. The bearer is the session's `tok`. */
  data class PostHeartbeat(val beatId: Int, val url: String, val bearer: String, val body: String) : Command {
    override fun toString(): String = "PostHeartbeat(beatId=$beatId, url=$url, bearer=<${bearer.length} chars>, body=$body)"
  }

  /** Fetch the descriptor again with the session's `tok` (spec §1: on every reconnect). */
  data object FetchDescriptor : Command

  /** Tear the capture session down: stream, camera, foreground service. */
  data class End(val reason: EndReason) : Command

  /** A line for the session record. The engine routes it to [SessionRecord]; the platform never sees it. */
  data class Record(val entry: RecordEntry) : Command
}
```

`K/Phase.kt`:

```kotlin
package com.seazn.capture.engine.core

enum class CameraState {
  OWN,
  TAKEN,
  REOPENING,
}

/** What one operator session carries from arm to its end. */
data class Session(
  val config: SessionConfig,
  val fallback: FallbackPolicy,
  val regulation: Regulation,
  val heartbeat: HeartbeatState,
  val delivery: DeliveryWatch,
  val nextAttemptId: Int = 1,
  val networkValidated: Boolean = false,
  /** Set by the first encoded frame, and kept across drops: the HUD's elapsed time never resets. */
  val liveSinceEpochMs: Long? = null,
  val notDelivered: Boolean = false,
  val camera: CameraState = CameraState.OWN,
  val micSilenced: Boolean = false,
  val device: DeviceSample? = null,
  val dataUsedBytes: Long = 0,
)

/** A live session that is not publishing now. It lasts until encoded frames advance again. */
data class Outage(val hold: Hold, val cause: ReconnectCause)

sealed interface ConnectStep {
  /** Between attempts: the next connect goes at [connectAtMs]. */
  data class Waiting(val connectAtMs: Long) : ConnectStep

  /** Attempt [attemptId] was asked for at [atMs] and has not answered. */
  data class Requested(val attemptId: Int, val atMs: Long) : ConnectStep
}

/**
 * The aggregate's phases: idle → armed → connecting → on air ⇄ connecting → ended (spec §3). Each
 * carries only what is true in it, so an attempt without a watchdog, or an ended session with a
 * transport, cannot be written down.
 */
sealed interface Phase {
  val name: String

  data object Idle : Phase {
    override val name = "idle"
  }

  data class Armed(val session: Session) : Phase {
    override val name = "armed"
  }

  data class Connecting(val session: Session, val transport: Transport, val step: ConnectStep, val outage: Outage?) : Phase {
    override val name = "connecting"
  }

  /** Connected. LIVE only while [watchdog] says frames advance. */
  data class OnAir(
    val session: Session,
    val attemptId: Int,
    val transport: Transport,
    val connectedAtMs: Long,
    val watchdog: StallWatchdog,
    val meter: LinkMeter = LinkMeter(),
    val srt: SrtTelemetry? = null,
    val egressBps: Long? = null,
    val outage: Outage?,
  ) : Phase {
    override val name = "on-air"
  }

  data class Ended(val reason: EndReason) : Phase {
    override val name = "ended"
  }
}

val Phase.session: Session?
  get() =
    when (this) {
      is Phase.Armed -> session
      is Phase.Connecting -> session
      is Phase.OnAir -> session
      Phase.Idle, is Phase.Ended -> null
    }

fun Phase.withSession(session: Session): Phase =
  when (this) {
    is Phase.Armed -> copy(session = session)
    is Phase.Connecting -> copy(session = session)
    is Phase.OnAir -> copy(session = session)
    Phase.Idle, is Phase.Ended -> this
  }
```

- [ ] **Step 4: Write the machine**

The file is long because it is a transition table (AGENTS §12 exempts those). Its internal objects group the transitions by what they react to.

`K/SessionMachine.kt`:

```kotlin
package com.seazn.capture.engine.core

/** One step of the machine: the next phase and what to ask of the platform. */
data class Step(val phase: Phase, val commands: List<Command> = emptyList())

private fun record(kind: String, vararg fields: Pair<String, Any?>): Command = Command.Record(RecordEntry(kind, fields.toList()))

/**
 * The aggregate (spec §3, `SessionMachine`), as a pure reducer: `(phase, input, now) → (phase,
 * commands)`. Native owns the session (AGENTS §2); this is that ownership, with every rule runnable
 * on the JVM. It holds no clock, thread or I/O — [Engine] drives it.
 */
object SessionMachine {
  /** Between attempts (P5 spike: every 2 s). */
  const val RETRY_MS = 2_000L

  /** A connect that answers nothing in this long has failed (the spike's half-open guard). */
  const val CONNECT_TIMEOUT_MS = 15_000L

  /** A regulator cut this recent shows as `poor-uplink`, the same span a raise waits after a cut. */
  const val POOR_UPLINK_MS = BitrateRegulator.RAISE_AFTER_CUT_MS

  fun reduce(phase: Phase, input: Input, now: Now): Step =
    when (input) {
      is Input.Arm -> arm(phase, input.config, now)
      Input.Start -> start(phase, now)
      Input.Stop -> if (phase.session == null) ignored(phase, "stop") else end(phase, EndReason.OPERATOR_STOPPED)
      Input.Reset -> if (phase is Phase.Ended) Step(Phase.Idle, listOf(record("reset"))) else ignored(phase, "reset")
      Input.Tick -> Heartbeats.tick(Timers.tick(phase, now), now)
      is Input.Connected -> Transports.connected(phase, input.attemptId, now)
      is Input.ConnectFailed -> Transports.connectFailed(phase, input, now)
      is Input.Dropped -> Transports.dropped(phase, input, now)
      is Input.Frames -> Transports.frames(phase, input, now)
      is Input.Link -> Transports.link(phase, input, now)
      is Input.Network -> network(phase, input.validated)
      Input.CameraContended -> Devices.contended(phase)
      Input.CameraReleased -> Devices.released(phase)
      is Input.CameraReopened -> Devices.reopened(phase, input.ok, now)
      is Input.MicSilenced -> Devices.mic(phase, input.silenced)
      is Input.Device -> Devices.sampled(phase, input.sample)
      is Input.PlaylistFetched -> Deliveries.fetched(phase, input, now)
      is Input.HeartbeatAnswered -> Heartbeats.answered(phase, input)
      is Input.DescriptorChecked -> descriptor(phase, input.result)
    }

  internal fun ignored(phase: Phase, intent: String): Step =
    Step(phase, listOf(record("intent-ignored", "intent" to intent, "phase" to phase.name)))

  internal fun end(phase: Phase, reason: EndReason, vararg fields: Pair<String, Any?>): Step {
    val liveMs = phase.session?.liveSinceEpochMs
    return Step(Phase.Ended(reason), listOf(record("ended", "reason" to reason, "wasLive" to (liveMs != null), *fields), Command.End(reason)))
  }

  private fun arm(phase: Phase, config: SessionConfig, now: Now): Step {
    if (phase !is Phase.Idle) return ignored(phase, "arm")
    val problems = config.problems()
    if (problems.isNotEmpty()) {
      val refused = record("arm-refused", "problems" to problems.joinToString("; "))
      return Step(Phase.Ended(EndReason.FATAL_ERROR), listOf(refused, Command.End(EndReason.FATAL_ERROR)))
    }
    val session =
      Session(
        config = config,
        fallback = FallbackPolicy(config.primary.transport, config.fallback?.transport),
        regulation = BitrateRegulator.sessionStarted(),
        heartbeat = HeartbeatState(nextDueAtMs = now.monoMs),
        delivery = DeliveryWatch(config.playbackUrl),
      )
    val armed = record("armed", "sid" to config.sid, "transport" to config.primary.transport, "playbackUrl" to config.playbackUrl)
    return Step(Phase.Armed(session), listOf(armed))
  }

  private fun start(phase: Phase, now: Now): Step {
    if (phase !is Phase.Armed) return ignored(phase, "start")
    return Transports.connect(phase.session, phase.session.fallback.current, outage = null, now = now)
  }

  private fun network(phase: Phase, validated: Boolean): Step {
    val session = phase.session ?: return Step(phase)
    if (session.networkValidated == validated) return Step(phase)
    return Step(phase.withSession(session.copy(networkValidated = validated)), listOf(record("network", "validated" to validated)))
  }

  /** A 410 or a finished state on a reconnect's descriptor fetch is an organiser stop (spec §1). */
  private fun descriptor(phase: Phase, result: DescriptorCheck): Step {
    if (phase.session == null) return Step(phase)
    return when (result) {
      is DescriptorCheck.Over -> end(phase, EndReason.STOPPED_BY_ORGANISER, "endReason" to result.endReason)
      DescriptorCheck.Live -> Step(phase, listOf(record("descriptor", "result" to "live")))
      is DescriptorCheck.Unreachable -> Step(phase, listOf(record("descriptor", "result" to "unreachable", "message" to result.message)))
    }
  }
}

/** Connects, drops, frames and link readings: the attempt's life. */
internal object Transports {
  fun connect(session: Session, transport: Transport, outage: Outage?, now: Now): Step {
    val (next, connect) = connectCommand(session, transport) ?: return missingTarget(session, transport)
    val phase = Phase.Connecting(next, transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    return Step(phase, listOf(connect, record("connecting", "transport" to transport, "attempt" to connect.attemptId)))
  }

  /** A new attempt that replaces a live one: a [Command.Rebuild] or a [Command.StartNewSession]. */
  fun replace(onAir: Phase.OnAir, session: Session, outage: Outage?, now: Now, wrap: (Command.Connect) -> Command): Step {
    val (next, connect) = connectCommand(session, onAir.transport) ?: return missingTarget(session, onAir.transport)
    val phase = Phase.Connecting(next, onAir.transport, ConnectStep.Requested(connect.attemptId, now.monoMs), outage)
    return Step(phase, listOf(wrap(connect), record("connecting", "transport" to onAir.transport, "attempt" to connect.attemptId)))
  }

  private fun connectCommand(session: Session, transport: Transport): Pair<Session, Command.Connect>? {
    val target = session.config.target(transport) ?: return null
    val bps = session.regulation.targetBps
    val maxBw = if (transport == Transport.SRT) SrtBandwidth.maxBwBytesPerSecond(bps) else null
    val id = session.nextAttemptId
    return session.copy(nextAttemptId = id + 1) to Command.Connect(id, target, bps, maxBw)
  }

  /** Unreachable after arm's checks; kept total so a bug ends the session visibly rather than throwing. */
  private fun missingTarget(session: Session, transport: Transport): Step =
    SessionMachine.end(Phase.Armed(session), EndReason.FATAL_ERROR, "transport" to transport)

  fun connected(phase: Phase, attemptId: Int, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase is Phase.Connecting && step is ConnectStep.Requested && step.attemptId == attemptId) {
      val session = phase.session.copy(regulation = BitrateRegulator.attemptStarted(phase.session.regulation))
      val onAir = Phase.OnAir(session, attemptId, phase.transport, now.monoMs, StallWatchdog(now.monoMs), outage = phase.outage)
      return Step(onAir, listOf(record("connected", "transport" to phase.transport, "attempt" to attemptId)))
    }
    if (phase is Phase.OnAir && phase.attemptId == attemptId) return Step(phase)
    // A stream this machine no longer wants: close it, so nothing publishes behind the session's back.
    return Step(phase, listOf(Command.Disconnect(attemptId), record("stale-connected", "attempt" to attemptId)))
  }

  fun connectFailed(phase: Phase, input: Input.ConnectFailed, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase !is Phase.Connecting || step !is ConnectStep.Requested || step.attemptId != input.attemptId) return Step(phase)
    return failed(phase, input.failure, input.message, now)
  }

  /** A failed connect: counted or not by the fallback policy, then a retry [SessionMachine.RETRY_MS] later. */
  fun failed(phase: Phase.Connecting, failure: ConnectFailure, message: String?, now: Now): Step {
    val session = phase.session
    val decision = session.fallback.connectFailed(failure, session.networkValidated)
    val commands =
      mutableListOf(
        record(
          "connect-failed",
          "transport" to phase.transport,
          "failure" to failure,
          "validated" to session.networkValidated,
          "counted" to decision.counted,
          "message" to message,
        )
      )
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    if (failure == ConnectFailure.REFUSED) commands += Command.FetchDescriptor
    val waiting = ConnectStep.Waiting(now.monoMs + SessionMachine.RETRY_MS)
    return Step(phase.copy(session = session.copy(fallback = decision.policy), transport = decision.policy.current, step = waiting), commands)
  }

  fun dropped(phase: Phase, input: Input.Dropped, now: Now): Step {
    val step = (phase as? Phase.Connecting)?.step
    if (phase is Phase.Connecting && step is ConnectStep.Requested && step.attemptId == input.attemptId) {
      return failed(phase, ConnectFailure.OTHER, input.message, now)
    }
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val session = phase.session
    val publishedMs = now.monoMs - phase.connectedAtMs
    val decision = session.fallback.dropped(input.reason, session.networkValidated, publishedMs)
    val outage = phase.outage ?: outageFor(session, phase.transport, now, ReconnectCause.UPLINK_LOST)
    val commands =
      mutableListOf(
        record(
          "dropped",
          "transport" to phase.transport,
          "reason" to input.reason,
          "validated" to session.networkValidated,
          "counted" to decision.counted,
          "publishedMs" to publishedMs,
          "message" to input.message,
        ),
        Command.FetchDescriptor,
      )
    if (decision.fellBack) commands += record("fell-back", "from" to phase.transport, "to" to decision.policy.current)
    val next = session.copy(fallback = decision.policy, regulation = BitrateRegulator.afterDrop(session.regulation, now.monoMs))
    val waiting = ConnectStep.Waiting(now.monoMs + SessionMachine.RETRY_MS)
    return Step(Phase.Connecting(next, decision.policy.current, waiting, outage), commands)
  }

  /** An outage only exists for a session that has been live: before that, there is nothing to hold. */
  fun outageFor(session: Session, transport: Transport, now: Now, cause: ReconnectCause): Outage? {
    if (session.liveSinceEpochMs == null) return null
    val hold = HoldClock.started(session.config.holdWindowSeconds, transport, now.monoMs) ?: Hold(transport, 0, now.monoMs)
    return Outage(hold, cause)
  }

  fun frames(phase: Phase, input: Input.Frames, now: Now): Step {
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val taken = phase.session.camera != CameraState.OWN
    val (watchdog, verdict) = phase.watchdog.frames(input.videoFrames, input.audioFrames, now.monoMs, taken)
    var next = phase.copy(watchdog = watchdog)
    val commands = mutableListOf<Command>()
    if (watchdog.advancing(now.monoMs)) {
      if (next.session.liveSinceEpochMs == null) {
        next = next.copy(session = next.session.copy(liveSinceEpochMs = now.wallMs))
        commands += record("live", "transport" to phase.transport)
      }
      next.outage?.let { outage ->
        commands += record("resumed", "transport" to phase.transport, "cause" to outage.cause, "outageMs" to now.monoMs - outage.hold.startedAtMs)
        next = next.copy(outage = null)
      }
    }
    if (verdict !is StallVerdict.Rebuild) return Step(next, commands)
    val rebuilt = Timers.rebuild(next, verdict, now)
    return rebuilt.copy(commands = commands + rebuilt.commands)
  }

  fun link(phase: Phase, input: Input.Link, now: Now): Step {
    if (phase !is Phase.OnAir || phase.attemptId != input.attemptId) return Step(phase)
    val session = phase.session
    val (meter, sample) = phase.meter.read(input.counters, now.monoMs)
    val latency = (session.config.target(Transport.SRT) as? SrtTarget)?.latencyMs ?: 0
    val regulation = BitrateRegulator.next(session.regulation, sample, now.monoMs, phase.transport, latency)
    val counters = input.counters
    val srt = if (phase.transport == Transport.SRT) SrtTelemetry(counters.packetsSent, counters.packetsRetransmitted, counters.packetsDropped, counters.rttMs) else null
    val next =
      phase.copy(
        session = session.copy(regulation = regulation, dataUsedBytes = session.dataUsedBytes + sample.bytes),
        meter = meter,
        srt = srt,
        egressBps = sample.egressBps ?: phase.egressBps,
      )
    val before = session.regulation.targetBps
    if (regulation.targetBps == before) return Step(next)
    val commands = mutableListOf<Command>(Command.SetBitrate(phase.attemptId, regulation.targetBps))
    if (phase.transport == Transport.SRT) commands += Command.SetMaxBw(phase.attemptId, SrtBandwidth.maxBwBytesPerSecond(regulation.targetBps))
    commands += record("bitrate", "from" to before, "to" to regulation.targetBps)
    return Step(next, commands)
  }
}

/** Everything the tick decides: retries, connect timeouts, hold expiry, the stall watchdog, playlist polls. */
internal object Timers {
  fun tick(phase: Phase, now: Now): Step =
    when (phase) {
      is Phase.Connecting -> connecting(phase, now)
      is Phase.OnAir -> onAir(phase, now)
      Phase.Idle, is Phase.Armed, is Phase.Ended -> Step(phase)
    }

  private fun connecting(connecting: Phase.Connecting, now: Now): Step {
    if (connecting.outage?.hold?.expired(now.monoMs) == true) return expired(connecting, connecting.outage)
    // Off air: the delivery watch must see it, or the gap would count as a delivery stall.
    val offAir = connecting.session.delivery.tick(now.monoMs, onAirNow = false).first
    val phase = connecting.copy(session = connecting.session.copy(delivery = offAir))
    return when (val step = phase.step) {
      is ConnectStep.Waiting ->
        if (now.monoMs >= step.connectAtMs) Transports.connect(phase.session, phase.transport, phase.outage, now) else Step(phase)
      is ConnectStep.Requested ->
        if (now.monoMs - step.atMs < SessionMachine.CONNECT_TIMEOUT_MS) Step(phase)
        else {
          val failed = Transports.failed(phase, ConnectFailure.TIMEOUT, "no answer in ${SessionMachine.CONNECT_TIMEOUT_MS} ms", now)
          failed.copy(commands = listOf(Command.Disconnect(step.attemptId)) + failed.commands)
        }
    }
  }

  private fun onAir(phase: Phase.OnAir, now: Now): Step {
    val outage = phase.outage
    if (outage != null && outage.hold.expired(now.monoMs)) return expired(phase, outage)
    val taken = phase.session.camera != CameraState.OWN
    val (watchdog, verdict) = phase.watchdog.tick(now.monoMs, taken)
    val watched = phase.copy(watchdog = watchdog)
    if (verdict is StallVerdict.Rebuild) return rebuild(watched, verdict, now)
    val (delivery, requests) = watched.session.delivery.tick(now.monoMs, watchdog.advancing(now.monoMs))
    val polled = watched.copy(session = watched.session.copy(delivery = delivery))
    return Step(polled, requests.map { Command.FetchPlaylist(it.id, it.url) })
  }

  private fun expired(phase: Phase, outage: Outage): Step =
    SessionMachine.end(phase, EndReason.HOLD_WINDOW_EXPIRED, "transport" to outage.hold.transport, "cause" to outage.cause)

  /** The stall watchdog asked for a rebuild (F-P5-6, F-P5-9). */
  fun rebuild(onAir: Phase.OnAir, verdict: StallVerdict.Rebuild, now: Now): Step {
    val outage = onAir.outage ?: Transports.outageFor(onAir.session, onAir.transport, now, ReconnectCause.VIDEO_STALLED)
    val stalled =
      record(
        "video-stalled",
        "cause" to verdict.cause,
        "msSinceAdvance" to verdict.msSinceAdvance,
        "videoFps" to verdict.videoFps,
        "audioFps" to verdict.audioFps,
      )
    val step = Transports.replace(onAir, onAir.session, outage, now) { Command.Rebuild(onAir.attemptId, it) }
    return step.copy(commands = listOf(stalled) + step.commands)
  }
}

/** Camera, microphone and device conditions. */
internal object Devices {
  fun contended(phase: Phase): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera == CameraState.TAKEN) return Step(phase)
    val next = phase.withSession(session.copy(camera = CameraState.TAKEN))
    return Step(next, listOf(Command.Slate(on = true), record("camera-taken")))
  }

  fun released(phase: Phase): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera != CameraState.TAKEN) return Step(phase)
    return Step(phase.withSession(session.copy(camera = CameraState.REOPENING)), listOf(Command.ReopenCamera, record("camera-released")))
  }

  fun reopened(phase: Phase, ok: Boolean, now: Now): Step {
    val session = phase.session ?: return Step(phase)
    if (session.camera != CameraState.REOPENING) return Step(phase)
    val own = phase.withSession(session.copy(camera = CameraState.OWN))
    val commands = listOf(Command.Slate(on = false), record("camera-reopened", "ok" to ok))
    if (own !is Phase.OnAir) return Step(own, commands)
    if (ok) return Step(own.copy(watchdog = own.watchdog.rebaselined(now.monoMs)), commands)
    // The spike's forced rebuild: a reopen that failed leaves the stream's own restart as the recovery.
    val rebuilt = Timers.rebuild(own, StallVerdict.Rebuild(StallCause.NO_VIDEO, 0, null, null), now)
    return rebuilt.copy(commands = commands + rebuilt.commands)
  }

  fun mic(phase: Phase, silenced: Boolean): Step {
    val session = phase.session ?: return Step(phase)
    if (session.micSilenced == silenced) return Step(phase)
    val kind = if (silenced) "mic-silenced" else "mic-restored"
    return Step(phase.withSession(session.copy(micSilenced = silenced)), listOf(record(kind)))
  }

  /** Relayed, and recorded when it changes (AGENTS §11). Never a session state (AGENTS §8). */
  fun sampled(phase: Phase, sample: DeviceSample): Step {
    val session = phase.session ?: return Step(phase)
    val previous = session.device
    val commands = mutableListOf<Command>()
    if (previous?.thermalStatus != sample.thermalStatus) {
      commands += record("thermal", "status" to sample.thermalStatus, "headroom" to sample.thermalHeadroom)
    }
    if (previous?.shed != sample.shed) commands += record("shed", "shed" to sample.shed)
    return Step(phase.withSession(session.copy(device = sample)), commands)
  }
}

/** The delivered-playlist watch (F-P5-13) wired to the session. */
internal object Deliveries {
  fun fetched(phase: Phase, input: Input.PlaylistFetched, now: Now): Step {
    val session = phase.session ?: return Step(phase)
    val (watch, requests, verdict) = session.delivery.fetched(input.requestId, input.result, now.monoMs)
    val commands = requests.map<PlaylistRequest, Command> { Command.FetchPlaylist(it.id, it.url) }.toMutableList()
    var next = session.copy(delivery = watch)
    if (next.notDelivered && watch.delivery == Delivery.OK) {
      next = next.copy(notDelivered = false)
      commands += record("delivered")
    }
    val updated = phase.withSession(next)
    if (verdict == null || updated !is Phase.OnAir || !updated.watchdog.advancing(now.monoMs)) return Step(updated, commands)
    val restarted = newSession(updated, verdict, now)
    return restarted.copy(commands = commands + restarted.commands)
  }

  /** Not delivered: force a new ingest session, and say so until the playlist moves again. */
  private fun newSession(onAir: Phase.OnAir, verdict: NotDelivered, now: Now): Step {
    val session = onAir.session.copy(notDelivered = true, delivery = onAir.session.delivery.newSession())
    val outage = onAir.outage ?: Transports.outageFor(session, onAir.transport, now, ReconnectCause.NOT_DELIVERED)
    val noted = record("not-delivered", "cause" to verdict.cause, "stalledMs" to verdict.stalledMs, "lagGrowthMs" to verdict.lagGrowthMs)
    val step = Transports.replace(onAir, session, outage, now) { Command.StartNewSession(onAir.attemptId, it) }
    return step.copy(commands = listOf(noted) + step.commands)
  }
}

/** The console heartbeat (ruling 5): due on the tick while armed or live, never gating anything. */
internal object Heartbeats {
  fun tick(step: Step, now: Now): Step {
    val phase = step.phase
    val session = phase.session ?: return step
    val (heartbeat, id) = Heartbeat.due(session.heartbeat, now.monoMs, now.wallMs)
    val commands = step.commands.toMutableList()
    if (heartbeat.failures > session.heartbeat.failures) commands += record("heartbeat", "result" to HeartbeatResult.FAILED, "message" to "no answer")
    val next = phase.withSession(session.copy(heartbeat = heartbeat))
    if (id == null) return Step(next, commands)
    val body = Heartbeat.payload(Projection.heartbeatFacts(next, session.copy(heartbeat = heartbeat), now))
    commands += Command.PostHeartbeat(id, session.config.heartbeatUrl, session.config.token, body)
    return Step(next, commands)
  }

  fun answered(phase: Phase, input: Input.HeartbeatAnswered): Step {
    val session = phase.session ?: return Step(phase)
    val (heartbeat, over) = Heartbeat.answered(session.heartbeat, input.beatId, input.response)
    if (heartbeat == session.heartbeat) return Step(phase)
    val status = (input.response as? HeartbeatResponse.Answered)?.status
    if (over) {
      val answered = (input.response as? HeartbeatResponse.Answered)?.endReason
      return SessionMachine.end(phase, EndReason.STOPPED_BY_ORGANISER, "status" to status, "endReason" to answered)
    }
    val noted = record("heartbeat", "result" to heartbeat.lastResult, "status" to status, "message" to (input.response as? HeartbeatResponse.Failed)?.message)
    return Step(phase.withSession(session.copy(heartbeat = heartbeat)), listOf(noted))
  }
}
```

- [ ] **Step 5: Write the projection**

`K/Projection.kt`:

```kotlin
package com.seazn.capture.engine.core

/** The phase as the snapshot and the heartbeat see it. Pure; runs after every input. */
object Projection {
  fun snapshot(phase: Phase, now: Now): Snapshot {
    val session = phase.session
    val onAir = phase as? Phase.OnAir
    return Snapshot(
      state = state(phase, now),
      reportedAtMs = now.wallMs,
      delivery = onAir?.session?.delivery?.delivery ?: Delivery.UNKNOWN,
      deliveredLagMs = onAir?.session?.delivery?.deliveredLagMs,
      encodedVideoFps = onAir?.watchdog?.videoFps,
      audioPacketsPerSecond = onAir?.watchdog?.audioFps,
      srt = onAir?.srt,
      bitrateKbps = onAir?.egressBps?.let { (it / 1_000).toInt() },
      targetBitrateKbps = onAir?.session?.regulation?.targetBps?.let { it / 1_000 },
      dataUsedBytes = session?.dataUsedBytes ?: 0,
      charging = session?.device?.charging,
      heartbeat = (session?.heartbeat ?: HeartbeatState()).status,
      shed = session?.device?.shed,
      device = session?.device,
    )
  }

  fun state(phase: Phase, now: Now): SnapshotState =
    when (phase) {
      Phase.Idle -> SnapshotState.Idle
      is Phase.Armed -> SnapshotState.Armed
      is Phase.Ended -> SnapshotState.Ended(phase.reason)
      is Phase.Connecting -> phase.outage?.let { reconnecting(phase.session, it, now) } ?: SnapshotState.Connecting(phase.transport)
      is Phase.OnAir -> onAir(phase, now)
    }

  /** The LIVE gate (F-P5-6): publishing or degraded only while encoded video frames advance. */
  private fun onAir(phase: Phase.OnAir, now: Now): SnapshotState {
    val session = phase.session
    val since = session.liveSinceEpochMs
    val reasons = reasons(session, now)
    val held = session.camera != CameraState.OWN && since != null && phase.outage == null
    return when {
      phase.watchdog.advancing(now.monoMs) && since != null ->
        if (reasons.isEmpty()) SnapshotState.Publishing(phase.transport, since) else SnapshotState.Degraded(phase.transport, reasons, since)
      held -> SnapshotState.Degraded(phase.transport, reasons, since!!)
      phase.outage != null -> reconnecting(session, phase.outage, now)
      else -> SnapshotState.Connecting(phase.transport)
    }
  }

  private fun reconnecting(session: Session, outage: Outage, now: Now): SnapshotState =
    SnapshotState.Reconnecting(
      cause = outage.cause,
      holdRemainingSeconds = outage.hold.remainingSeconds(now.monoMs),
      holdWindowSeconds = outage.hold.windowSeconds,
      sinceEpochMs = session.liveSinceEpochMs ?: now.wallMs,
    )

  /** In [DegradeReason]'s declared order. Thermal is never one (AGENTS §8). */
  fun reasons(session: Session, now: Now): List<DegradeReason> {
    val cutAt = session.regulation.lastCutAtMs
    return DegradeReason.entries.filter { reason ->
      when (reason) {
        DegradeReason.NOT_DELIVERED -> session.notDelivered
        DegradeReason.CAMERA_TAKEN -> session.camera != CameraState.OWN
        DegradeReason.MIC_SILENCED -> session.micSilenced
        DegradeReason.POOR_UPLINK -> cutAt != null && now.monoMs - cutAt < SessionMachine.POOR_UPLINK_MS
        DegradeReason.FELL_BACK_TO_RTMPS -> session.fallback.fellBack && session.fallback.current == Transport.RTMPS
      }
    }
  }

  /** The heartbeat body's facts. Only asked for in a phase with a session. */
  fun heartbeatFacts(phase: Phase, session: Session, now: Now): HeartbeatFacts {
    val snapshot = snapshot(phase, now)
    val onAir = phase as? Phase.OnAir
    val audioFps = onAir?.watchdog?.audioFps
    return HeartbeatFacts(
      sid = session.config.sid,
      atEpochMs = now.wallMs,
      state = snapshot.state,
      transport = onAir?.transport ?: (phase as? Phase.Connecting)?.transport,
      bitrateKbps = snapshot.bitrateKbps,
      delivery = snapshot.delivery,
      deliveredLagMs = snapshot.deliveredLagMs,
      audioOk = !session.micSilenced && (audioFps == null || audioFps >= StallWatchdog.AUDIO_FLOOR_FPS),
      batteryPercent = session.device?.batteryPercent,
      charging = session.device?.charging,
      drainPctPerHour = session.device?.drainPctPerHour,
      thermalStatus = session.device?.thermalStatus,
      dataUsedBytes = session.dataUsedBytes,
      appVersion = session.config.appVersion,
    )
  }
}
```

- [ ] **Step 6: Run them and watch them pass**

Run the Step 2 command. Expected: `EXIT=0` and **43** tests (13 + 14 + 8 + 8). The full suite gives **167**.

- [ ] **Step 7: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): session machine and snapshot projection

LIVE only while encoded frames advance (F-P5-6); one reducer is the
aggregate, and the snapshot is its projection (AGENTS §2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 15: The `Engine` driver

**Files:** Create `K/Engine.kt` and `T/EngineTest.kt`.

**Interfaces:**

- Consumes: `Clock`, `Scheduler`, `SessionMachine`, `Projection`, `SessionRecord`.
- Produces:
  - `fun interface CommandSink { fun execute(command: Command) }`;
  - `fun interface SnapshotSink { fun publish(snapshot: Snapshot) }`;
  - `Engine(clock, scheduler, commands, snapshots, record, reducer = SessionMachine::reduce)`, with `start()`, `stop()`, `send(input)`, `phase`, `commandFailures`, `snapshotFailures` and `TICK_MS` 500.

  `send` returns at once, because intents are not RPC. `Engine` calls `record.protect(config)` for every `Arm` before the machine sees it. Plan C constructs one `Engine` per process, calls `start()` once, and calls `send` from any thread; the scheduler's single thread is where everything runs.

- [ ] **Step 1: Write the failing test**

`T/EngineTest.kt`:

```kotlin
package com.seazn.capture.engine.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class EngineTest {
  private val clock = FakeClock()
  private val scheduler = FakeScheduler(clock)
  private val executed = mutableListOf<Command>()
  private val published = mutableListOf<Pair<Long, Snapshot>>()
  private val lines = mutableListOf<String>()
  private var onCommand: (Engine, Command) -> Unit = { _, _ -> }

  private fun engine(reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce): Engine {
    lateinit var engine: Engine
    engine =
      Engine(
        clock,
        scheduler,
        commands = { command ->
          executed += command
          onCommand(engine, command)
        },
        snapshots = { published += clock.mono to it },
        record = SessionRecord { lines += it },
        reducer = reducer,
      )
    return engine
  }

  @Test
  fun `the tick drives time-based rules with no platform answer - a connect times out`() {
    val engine = engine().apply { start() }
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Network(true))
    engine.send(Input.Start)
    scheduler.advanceBy(15_000)
    assertTrue(Command.Disconnect(1) in executed)
  }

  @Test
  fun `send returns before the input runs, and inputs run one at a time in order`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    assertEquals(Phase.Idle, engine.phase, "nothing runs until the scheduler does")
    // An adapter that answers synchronously: its answer is simply the next input.
    onCommand = { e, command -> if (command is Command.Connect) e.send(Input.Connected(command.attemptId)) }
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertIs<Phase.OnAir>(engine.phase)
  }

  @Test
  fun `a snapshot goes up on every tick, and at once when the state changes`() {
    val engine = engine().apply { start() }
    scheduler.advanceBy(2_000)
    assertEquals(listOf(500L, 1_000L, 1_500L, 2_000L), published.map { it.first })
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    assertEquals(SnapshotState.Armed, published.last().second.state)
    assertEquals(2_000L, published.last().first)
  }

  @Test
  fun `records go to the session record and never to the platform`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    scheduler.advanceBy(0)
    assertFalse(executed.any { it is Command.Record })
    assertTrue(lines.single().contains(""""kind":"armed""""))
  }

  @Test
  fun `a secret quoted by the platform never reaches the record`() {
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    engine.send(Input.ConnectFailed(1, ConnectFailure.OTHER, "srt://h?passphrase=${Configs.PASSPHRASE}&streamid=${Configs.STREAM_ID}"))
    scheduler.advanceBy(0)
    for (secret in listOf(Configs.TOKEN, Configs.PASSPHRASE, Configs.STREAM_KEY)) {
      assertFalse(lines.any { secret in it }, "leaked $secret")
    }
    // The stream id is public inside the playback URL (the armed line) and a secret everywhere else.
    val failure = lines.single { "connect-failed" in it }
    assertFalse(Configs.STREAM_ID in failure, failure)
  }

  @Test
  fun `a command the platform throws on is recorded, and the engine carries on`() {
    onCommand = { _, command -> if (command is Command.Connect) throw IllegalStateException("camera busy") }
    val engine = engine()
    engine.send(Input.Arm(Configs.valid()))
    engine.send(Input.Start)
    engine.send(Input.Stop)
    scheduler.advanceBy(0)
    assertEquals(1, engine.commandFailures)
    assertTrue(lines.any { "command-failed" in it && "camera busy" in it })
    assertEquals(Phase.Ended(EndReason.OPERATOR_STOPPED), engine.phase)
  }

  @Test
  fun `a snapshot the bridge throws on is counted, and the next tick still goes up`() {
    var throwing = true
    val engine =
      Engine(clock, scheduler, commands = { executed += it }, snapshots = {
        if (throwing) throw IllegalStateException("bridge gone")
        published += clock.mono to it
      }, record = SessionRecord { lines += it })
    engine.start()
    scheduler.advanceBy(500)
    assertEquals(1, engine.snapshotFailures)
    throwing = false
    scheduler.advanceBy(500)
    assertEquals(listOf(1_000L), published.map { it.first })
  }

  @Test
  fun `a failure inside the machine ends fatal-error instead of escaping`() {
    val engine = engine { _, _, _ -> throw IllegalStateException("bug") }
    engine.send(Input.Start)
    scheduler.advanceBy(0)
    assertEquals(Phase.Ended(EndReason.FATAL_ERROR), engine.phase)
    assertTrue(Command.End(EndReason.FATAL_ERROR) in executed)
    assertTrue(lines.any { "engine-error" in it })
  }

  @Test
  fun `stop cancels the tick, and start twice ticks once`() {
    val engine = engine()
    engine.start()
    engine.start()
    scheduler.advanceBy(1_000)
    assertEquals(2, published.size)
    engine.stop()
    scheduler.advanceBy(5_000)
    assertEquals(2, published.size)
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd "$WT/modules/capture-engine/android/core" && ./gradlew test --tests '*EngineTest' --console=plain > "$TMPDIR/core.txt" 2>&1; echo "EXIT=$?"; grep -m3 '^e: ' "$TMPDIR/core.txt"
```

Expected: `EXIT=1`, with a first `e:` line of `EngineTest.kt:15:27 Unresolved reference 'Engine'.`

- [ ] **Step 3: Write `Engine.kt`**

`K/Engine.kt`:

```kotlin
package com.seazn.capture.engine.core

/** Plan C's adapters: carry out one command. Called on the scheduler's thread; must not block. */
fun interface CommandSink {
  fun execute(command: Command)
}

/** Plan C's bridge: hand one snapshot up to JavaScript. */
fun interface SnapshotSink {
  fun publish(snapshot: Snapshot)
}

/**
 * The driver: the only stateful object in the core. Every input — an intent from the bridge, a fact
 * from an adapter, its own tick — is posted to the injected [Scheduler] and run there one at a time,
 * so the reducer never sees two inputs at once and a command that answers synchronously is simply
 * the next input. It holds no rule: those are all in [SessionMachine].
 */
class Engine(
  private val clock: Clock,
  private val scheduler: Scheduler,
  private val commands: CommandSink,
  private val snapshots: SnapshotSink,
  val record: SessionRecord,
  private val reducer: (Phase, Input, Now) -> Step = SessionMachine::reduce,
) {
  var phase: Phase = Phase.Idle
    private set

  /** Commands the platform threw on. Each is also a record line. */
  var commandFailures: Int = 0
    private set

  /** Snapshots the bridge threw on. Counted only: the next tick sends a fresh one. */
  var snapshotFailures: Int = 0
    private set

  private var lastPublished: SnapshotState? = null
  private var ticking: Cancellable? = null

  /** Starts the tick. Idempotent. */
  fun start() {
    if (ticking == null) scheduleTick()
  }

  fun stop() {
    ticking?.cancel()
    ticking = null
  }

  /** Thread-safe as far as the [Scheduler] is. Returns at once: intents, not RPC (AGENTS §2). */
  fun send(input: Input) {
    scheduler.schedule(0) { process(input) }
  }

  private fun scheduleTick() {
    ticking =
      scheduler.schedule(TICK_MS) {
        process(Input.Tick)
        if (ticking != null) scheduleTick()
      }
  }

  private fun process(input: Input) {
    val now = clock.now()
    if (input is Input.Arm) record.protect(input.config)
    val step =
      try {
        reducer(phase, input, now)
      } catch (failure: Exception) {
        val noted = Command.Record(RecordEntry("engine-error", listOf("message" to failure.toString())))
        Step(Phase.Ended(EndReason.FATAL_ERROR), listOf(noted, Command.End(EndReason.FATAL_ERROR)))
      }
    phase = step.phase
    for (command in step.commands) dispatch(command, now)
    val snapshot = Projection.snapshot(phase, now)
    if (input == Input.Tick || snapshot.state != lastPublished) {
      lastPublished = snapshot.state
      try {
        snapshots.publish(snapshot)
      } catch (_: Exception) {
        snapshotFailures += 1
      }
    }
  }

  private fun dispatch(command: Command, now: Now) {
    if (command is Command.Record) return record.append(now.wallMs, command.entry)
    try {
      commands.execute(command)
    } catch (failure: Exception) {
      commandFailures += 1
      record.append(now.wallMs, RecordEntry("command-failed", listOf("message" to "${command::class.simpleName}: $failure")))
    }
  }

  companion object {
    /** Twice a second: the watchdog's cadence in P5, and a snapshot at least once a second (AGENTS §2). */
    const val TICK_MS = 500L
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Expected: `EXIT=0` and **9** tests. Then run the full suite (`./gradlew test`) and count: **176**, 0 failures.

- [ ] **Step 5: Commit**

```bash
cd "$WT" && git add modules/capture-engine/android/core/src && git commit -F - <<'EOF'
feat(engine-core): engine driver that serialises inputs on the scheduler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 16: Mutate every guard once

AGENTS §10: "a guard nothing kills is decoration". The procedure for each row:

1. Back the file up: `cp K/<File>.kt "$TMPDIR/<File>.kt.bak"`. Never use `git checkout` or `git stash`.
2. Make the one edit shown.
3. Run the full suite.
4. Confirm `EXIT=1` and that the named test is among the failures (`grep 'FAILED' "$TMPDIR/core.txt"`).
5. Restore it: `cp "$TMPDIR/<File>.kt.bak" K/<File>.kt`.

Every row below was run on the scratch copy on 2026-09-30 and killed by the tests named.

| Guard                             | File                  | Replace                                                                                                    | With                                                                     | Killed by (at least)                                                                                                                                                                                    |
| --------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The LIVE gate                     | `Projection.kt`       | `phase.watchdog.advancing(now.monoMs) && since != null ->`                                                 | `since != null ->`                                                       | `SessionMachineOutageTest > F-P5-6 connected again after an outage is not LIVE until a frame advances`                                                                                                  |
| Fallback counting                 | `FallbackPolicy.kt`   | `const val FAILURES_TO_FALL_BACK = 3`                                                                      | `const val FAILURES_TO_FALL_BACK = 2`                                    | `FallbackPolicyTest > C1 three validated connect failures fall back to RTMPS`, `SessionMachineOutageTest > F-P5-2 short-lived SRT sessions fall back to RTMPS`                                          |
| DNS failures don't count          | `FallbackPolicy.kt`   | `countable && networkValidated && failure != ConnectFailure.UNRESOLVED`                                    | `countable && networkValidated`                                          | `FallbackPolicyTest > F-P5-1 an unresolved host does not count even on a validated network`                                                                                                             |
| Regulator restart vs halve        | `BitrateRegulator.kt` | `nowMs - it <= FAILING_LOOKBACK_MS } ?: false`                                                             | `true } ?: true`                                                         | `BitrateRegulatorTest > regulator restart - a clean far-end drop restarts at the last healthy target`                                                                                                   |
| The stall floor (audio)           | `StallWatchdog.kt`    | `if (video >= VIDEO_FLOOR_FPS && audio >= AUDIO_FLOOR_FPS) return`                                         | `if (video >= VIDEO_FLOOR_FPS) return`                                   | `StallWatchdogTest > F-P5-4 audio at a seventh of its rate is a rebuild though video runs 30 fps`                                                                                                       |
| The stall floor (video)           | `StallWatchdog.kt`    | `if (video >= VIDEO_FLOOR_FPS && audio >= AUDIO_FLOOR_FPS) return`                                         | `if (audio >= AUDIO_FLOOR_FPS) return`                                   | `StallWatchdogTest > F-P5-9 a slideshow above zero is a rebuild - 8 fps`                                                                                                                                |
| Hold while the camera is taken    | `StallWatchdog.kt`    | the line `cameraTaken -> copy(readings = emptyList()) to StallVerdict.Held`                                | (delete it)                                                              | `StallWatchdogTest > F-P5-10 while the camera is taken it holds and never rebuilds`, two `SessionMachineDeviceTest` F-P5-10 tests                                                                       |
| The ENDLIST rule                  | `DeliveryWatch.kt`    | `    val moved = advancedBy(url, media)` (first line of `observed`)                                        | `    if (media.endList) return Triple(this, emptyList(), null)` above it | `DeliveryWatchTest > H-P5-1 EXT-X-ENDLIST never means ended`                                                                                                                                            |
| LL-HLS parts are delivery         | `DeliveryWatch.kt`    | `if (media.head == previous && media.partsMs <= partsMs) return this`                                      | `if (media.head == previous) return this`                                | `DeliveryWatchTest > LL-HLS parts that advance while full segments lag are delivery`                                                                                                                    |
| LL-HLS parts count once           | `DeliveryWatch.kt`    | `.sum() - partsMs + media.partsMs)`                                                                        | `.sum() + media.partsMs)`                                                | `DeliveryWatchTest > LL-HLS parts that roll into a completed segment are counted once`                                                                                                                  |
| The bandwidth hint                | `DeliveryWatch.kt`    | `val pollUrl: String = hinted(playbackUrl)`                                                                | `val pollUrl: String = playbackUrl`                                      | `DeliveryWatchTest > the master is polled for one rendition, with a low bandwidth hint`                                                                                                                 |
| Trailing parts reset at a segment | `PlaylistParser.kt`   | the line `parts.clear()`                                                                                   | (delete it)                                                              | `PlaylistParserTest > an LL-HLS playlist counts parts before a segment in its EXTINF, and parts after it as trailing`                                                                                   |
| The heartbeat never blocks        | `Heartbeat.kt`        | the line `if (next.inFlightId != null && nowMs - next.inFlightSinceMs >= TIMEOUT_MS) next = next.failed()` | (delete it)                                                              | `HeartbeatTest > ruling 5 a beat that never comes back is failed at 10 s and the next one goes`, `SessionMachineServerTest > a heartbeat never answered is failed at 10 s, recorded, and the next goes` |
| The scrub allow-list              | `SessionRecord.kt`    | `      else -> MASK`                                                                                       | `      else -> value`                                                    | `SessionRecordTest > a string under a key the record does not know is masked`                                                                                                                           |
| Engine containment (commands)     | `Engine.kt`           | `} catch (failure: Exception) {` above `commandFailures += 1`                                              | `} catch (failure: Error) {`                                             | `EngineTest > a command the platform throws on is recorded, and the engine carries on`                                                                                                                  |
| Engine containment (snapshots)    | `Engine.kt`           | `} catch (_: Exception) {` above `snapshotFailures += 1`                                                   | `} catch (_: Error) {`                                                   | `EngineTest > a snapshot the bridge throws on is counted, and the next tick still goes up`                                                                                                              |

- [ ] **Step 1: Run each row as above.** A row whose named test does not fail is a finding: stop and report it. Do not weaken the mutation.
- [ ] **Step 2: Confirm the tree is clean.** Run `cd "$WT" && git status --short`; the expected output is empty. Then run the full suite: `EXIT=0` and 176 tests.
- [ ] **Step 3: No commit.** This task changes nothing. Paste the table, with the observed failures, into the PR description.

---

## The four questions (AGENTS §10)

| Question                                     | Where it is answered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. A second call**                         | `a double start is one attempt`; `stop ends operator-stopped, and a second stop does nothing`; `an arm while live is ignored - the engine is the authority`; `a reset while live is refused`; `a second contended is one slate, and a release without a take does nothing`; `a fact about an old attempt is ignored, and an old connect is closed`; `a stale answer is ignored` (delivery) and `an answer to a beat already given up is ignored` (heartbeat); `a request in flight blocks the next poll…`; `stop cancels the tick, and start twice ticks once` (engine).                                                                                                                       |
| **2. An empty input**                        | `an arm with an empty descriptor field ends fatal-error and says why`; `an empty descriptor field is a problem, not a crash`; `empty, blank, foreign and malformed text is invalid, never a crash` and `a malformed part is invalid…` (parser); `failed fetches are unknown…` and `an HTTP error or a garbled body is no evidence`; `a missing or non-positive window gives no hold`; `the first reading has no interval, so no egress`; `a negative send buffer is no reading`; `a value JSON cannot hold is refused, not stringified`; `with no fallback transport nothing counts`. A missing native module is plan C's question: the core has none.                                         |
| **3. After an interruption**                 | Uplink loss: `C2 an uplink drop counts down the transport's hold…`, `the hold's expiry ends the session…`, `F-P5-6 connected again after an outage is not LIVE until a frame advances`. The camera taken: the four `F-P5-10` tests. A far-end stop: `a descriptor that says the session is over ends stopped-by-organiser`. Refusal: `refused ingest asks the descriptor…`. A refused write: `a sink that throws is counted and never throws out`. The engine failing mid-flow: `a command the platform throws on…` and `a failure inside the machine ends fatal-error…`. Process death and cold start belong to plan C and the spec's reopen rules: the core keeps no state across a process. |
| **4. Another mode, orientation or language** | **Language:** `decimals never follow the phone's locale` and `the payload is the same on a French, Dutch or Spanish phone`, because JSON must not follow the locale. **Mode:** the core exists only in Live Stream, and scoring and dashboard never construct an `Engine`. **Orientation: not applicable.** The core never sees orientation: encoded orientation is the platform's (P4, plan C), and the three P4 assertions are device checks (spec §6).                                                                                                                                                                                                                                      |

---

## Self-review

**Spec coverage (§3 core table → task):**

| Unit               | Task                          | Unit                | Task |
| ------------------ | ----------------------------- | ------------------- | ---- |
| `SessionMachine`   | 14 (Projection 14, Engine 15) | `DeliveryWatch`     | 9–10 |
| `FallbackPolicy`   | 7                             | `HoldClock`         | 11   |
| `BitrateRegulator` | 6                             | `Heartbeat`         | 12   |
| `SrtBandwidth`     | 5                             | `SessionRecord`     | 13   |
| `StallWatchdog`    | 8                             | Kotlin core CI (§6) | 3    |

Every P5 row enters as a named failing test first, as §3 requires.

Spec §6's mutation list covers "the LIVE gate, fallback counting, the regulator restart, … the heartbeat never blocking". The warming gate and the leave rule are TypeScript (plan A). Task 16 covers the core's share and adds:

- the stall floor, both halves;
- the camera hold;
- ENDLIST;
- DNS;
- the LL-HLS rules;
- the hint;
- the scrub;
- engine containment.

**Placeholder scan:** every step has its full code or command and an expected result. `$WT` and `$TMPDIR` are the executor's environment, defined in Global Constraints. They are not placeholders.

**Type consistency:** names were checked by compiling. The task order was replayed from an empty directory on 2026-09-30:

- each task's test failed to compile before its code and passed after;
- the per-task counts were 4, 7, 10, 7, 18, 11, 12, 11, 18, 4, 11, 11, 43 and 9, for 176 in total;
- B3, B4 and B5 were each built alone on B1 + B2.

**Where this plan departs from the spec, deliberately:**

1. **`DeliveryWatch` compares delivered media with _publishing_ time, not wall time.** An outage is the hold clock's, and counting it as a delivery stall would force a new session on every reconnect.
2. **`Degraded.reasons` is a list**, most important first, where plan A's type has one `reason`. The bridge sends the first (see decision 6).
3. **`Reconnecting.cause` is new.** Plan A needs to add it, or the status line cannot tell a lost uplink from a restart for not-delivered.
4. **`audio-below-floor` does not exist in Kotlin.** It is a TypeScript selector (spec §2).
5. **The watch follows one rendition** chosen by `clientBandwidthHint=0.1`, and reads LL-HLS if Cloudflare serves it. Both come from Cloudflare's player doc (owner, 2026-09-30), not from the spec's text.

**Constants that are this plan's choice, not a P5 measurement.** Challenge each one in review:

- **`SrtBandwidth` overshoot factor of 2** over the expected egress. P5 measured 0.95–1.0 Mbps at a 500k target, and 13.9–17 Mbps bursts uncapped on a 1.5 Mbps link.
- **`FallbackPolicy.SHORT_ATTEMPT_MS` of 25 s**, between 6–22 s and 31–33 s.
- **`FAILING_LOOKBACK_MS` of 10 s.**
- **`POOR_UPLINK_MS` of 30 s:** a regulator cut in the last 30 s shows `poor-uplink`.
- **`LAG_GROWTH_LIMIT_MS` of 20 s in a 60 s window.**
- **`REQUEST_TIMEOUT_MS` of 10 s.**
- **`CONFIGURED_SEGMENT_MS` of 2 s:** P5 Run A saw 996 of 998 segments at ~2 s, but S1 does not configure it; Cloudflare does.
- **`BANDWIDTH_HINT_MBPS` of 0.1.**
- **The hold ends at the phone's own expiry**, counted from its drop detection. That is conservative per H-P5-1 (the hold was measured at 182.3–182.5 s).

**Unverified until a device or CI run:**

- The time from first publish to the first delivered segment was not measured in P5. If it exceeds 20 s, a brand-new session could be judged not-delivered at start. The watch only polls while LIVE, which starts the clock at the first encoded frame; plan C's staging run must measure it.
- Whether Cloudflare honours `clientBandwidthHint` on a live master, and whether S1's inputs serve LL-HLS at all.
- The action tags `setup-java@v6` and `gradle/actions/wrapper-validation@v6` stay unverified until the first CI run (Task 3, Step 4).
