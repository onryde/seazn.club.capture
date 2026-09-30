# S1 plan C research: Android platform layer and Expo bridge

**Date:** 2026-09-30. **For:** plan C of [the S1 design](../../specs/2026-09-30-s1-live-stream-design.md) (§3 `platform/`, and the Bridge line). **Status:** research notes, not a plan. Nothing here is a ruling.

**How to read this.** Every claim is tagged:

- **VERIFIED** means read in a published artifact, in source at a named tag, in bytecode, or measured in P5. The source is cited.
- **INFERRED** means reasoned from verified facts. It is a hypothesis until a device run or a build settles it (AGENTS §0).

Local sources were read in the main checkout's `node_modules` and `~/.gradle` cache, and in the spike branch `origin/spike/p5-android`. Upstream sources were read at the tags named, on 2026-09-30.

## Summary

| #   | Question                         | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                          |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | Newest StreamPack                | **3.2.0** (2026-07-21) is still the latest release. `main` is 35 commits ahead, unreleased, and builds with **Kotlin 2.4.10 / AGP 9.2.1**. A 3.2.1 bug-fix release is planned, with no date.                                                                                                                                                                                                                                                                       | VERIFIED                                        |
| 1   | Pin                              | **StreamPack 3.2.0**: `core`, `ui`, `srt`, `rtmp`. Not `services`.                                                                                                                                                                                                                                                                                                                                                                                                 | recommendation                                  |
| 1   | F-P5-6 (pending rotation)        | **Not fixed**, in 3.2.0 or on `main`. The same-value pending rotation still skips `videoEncoder.reset()`.                                                                                                                                                                                                                                                                                                                                                          | VERIFIED (source)                               |
| 1   | R3 (`throwableFlow` race)        | **Not fixed.** `CompositeEndpoint.throwableFlow` is a constant `null` in 3.2.0 and on `main`.                                                                                                                                                                                                                                                                                                                                                                      | VERIFIED (source)                               |
| 1   | B-frames                         | There is no API for them. The `customize` hook runs **last** on the `MediaFormat`, so `KEY_MAX_B_FRAMES = 0` (API 29) can be set there.                                                                                                                                                                                                                                                                                                                            | VERIFIED (source)                               |
| 1   | **SRT pacing (F-P5-11) — new**   | StreamPack's `SrtSink.startStream` sets `MAXBW = 0` and `INPUTBW = Σ startBitrate`. The sum is in **bits/s**, but libsrt reads `INPUTBW` as **bytes/s**. The cap is therefore 8 × 1.25 = **10× the intended rate** (31.3 Mbit/s for the spike's 3128k). It also **overwrites any `MAXBW` passed in the `SrtUrl`**. F-P5-11's "the spike sets no `SRTO_MAXBW`… defaults to −1" is wrong about the mechanism. Its conclusion, an effectively unpaced sender, stands. | VERIFIED (bytecode, source, libsrt docs)        |
| 1   | Encoder stall under backpressure | StreamPack #302: in 3.2.0, `SrtSink.write` blocks on `send`, and that stalls the encoder's output. It is fixed on `main` only.                                                                                                                                                                                                                                                                                                                                     | VERIFIED (issue, commit)                        |
| 2   | KTOR-3565                        | Closed **"As Designed"** on 2021-12-14, and the reporter withdrew it. It is **not** a record of our crash. Ktor **3.6.0** (latest, 2026-09-16) and `main` (2026-09-29) still launch `cio-tls-closer` with no catch. **No Ktor release fixes it.**                                                                                                                                                                                                                  | VERIFIED                                        |
| 2   | Ktor in use                      | 3.3.3, via `komuxer rtmp 0.4.0`, which is StreamPack-rtmp 3.2.0's dependency.                                                                                                                                                                                                                                                                                                                                                                                      | VERIFIED (POMs)                                 |
| 2   | Force a newer Ktor?              | **No.** It fixes nothing, and Ktor 3.5+ pulls `kotlin-stdlib 2.3.21`, two metadata versions past the app's Kotlin 2.1.20 compiler.                                                                                                                                                                                                                                                                                                                                 | VERIFIED (source, POMs); build failure INFERRED |
| 2   | Guard                            | Keep a scoped guard. A narrower variant is possible: give RTMP its own IO dispatcher whose threads carry the uncaught handler.                                                                                                                                                                                                                                                                                                                                     | INFERRED                                        |
| 3   | srtdroid                         | StreamPack 3.2.0 uses **1.9.5**, which bundles **libsrt 1.5.4**. The latest is **1.10.1** (2026-09-26), which bundles **libsrt 1.5.7**. 1.5.6 fixed CVE-2026-55868/55869. All 57 references from streampack-srt 3.2.0 resolve against 1.10.1.                                                                                                                                                                                                                      | VERIFIED                                        |
| 4   | Platform APIs                    | Minimum API levels: `isClientSilenced` 29, `getThermalHeadroom` 30, `KEY_MAX_B_FRAMES` 29, charge counter 21. `onCameraOpened(pkg)` is `@SystemApi`, so it is unavailable to us.                                                                                                                                                                                                                                                                                   | VERIFIED (SDK 36 `api-versions.xml`, AOSP)      |
| 5   | Expo bridge                      | `ExpoView` needs `shouldUseAndroidLayout = true` for a SurfaceView. Emit events with `sendEvent` behind `OnStartObserving`/`OnStopObserving`. The service is declared in the module's own manifest.                                                                                                                                                                                                                                                                | VERIFIED (expo-modules-core 57.0.17, spike)     |
| 6   | Issues since 3.2.0               | These matter to us: #302 (backpressure stall), #306 (~16 MB encoder surface leak per session), #288 (preview FIT crops relative to the stream). Nothing was found for reconnect, the RTMPS TLS crash, B-frames or MAXBW.                                                                                                                                                                                                                                           | VERIFIED                                        |

## Toolchain the plan builds against

| Fact                                                                                                                          | Source                                                                                                                                           | Status   |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Expo 57.0.21 installed (`package.json` says `~57.0.26`), RN 0.86.3, expo-modules-core 57.0.17                                 | `node_modules/.pnpm` in the main checkout                                                                                                        | VERIFIED |
| minSdk 24, targetSdk 36, compileSdk 36, buildTools 36.0.0, NDK 27.1.12297006, AGP 8.12.0, **Kotlin 2.1.20**                   | `react-native/gradle/libs.versions.toml:3-9,32` (0.86.3). Only `kotlin-gradle-plugin 2.1.20` is in `~/.gradle`                                   | VERIFIED |
| Expo's defaults apply only when the catalog is silent                                                                         | `expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/ExpoRootProjectPlugin.kt:52-59` | VERIFIED |
| Gradle wrapper 9.3.1                                                                                                          | `android/gradle/wrapper/gradle-wrapper.properties:3` (prebuild output, main checkout)                                                            | VERIFIED |
| expo-modules-core exports `kotlinx-coroutines-core/android 1.10.2`                                                            | `expo-modules-core/android/build.gradle:213-214`                                                                                                 | VERIFIED |
| The local module pattern: `com.android.library` + `expo-module-gradle-plugin`, and a module list in `expo-module.config.json` | `modules/code-scanner/android/build.gradle`, `modules/code-scanner/expo-module.config.json`                                                      | VERIFIED |

**Kotlin metadata window.** "The binary format is mostly forwards compatible with the next language release, but not later ones" ([kotlinlang.org, evolution principles](https://kotlinlang.org/docs/kotlin-evolution-principles.html), read 2026-09-30). The app's compiler is 2.1.20, so it can read 2.2.x binaries but not 2.3 or 2.4. This decides every version choice below.

StreamPack 3.2.0, srtdroid 1.9.5 and komuxer 0.4.0 are all built with `kotlin-stdlib 2.2.21` (VERIFIED, POMs). The spike built and ran with them on this SDK (P5). Rows marked "Kotlin 2.3+/2.4" are **INFERRED** to fail compilation. Nobody has built them here.

## 1. StreamPack

### Releases

- Maven Central `io.github.thibaultbee.streampack:streampack-core` lists `3.2.0` as `<release>`. Its directory is dated 2026-07-21 20:29, and there is nothing newer ([maven-metadata.xml](https://repo1.maven.org/maven2/io/github/thibaultbee/streampack/streampack-core/maven-metadata.xml), read 2026-09-30). **VERIFIED.**
- GitHub releases list 3.2.0 (2026-07-21) as the latest ([releases](https://github.com/ThibaultBee/StreamPack/releases)). **VERIFIED.**
- `main` is 35 commits ahead of 3.2.0 (`gh api compare/3.2.0...main`, 2026-09-30). Its catalog is `kotlin = 2.4.10`, `agp = 9.2.1`, `komuxer = 0.4.4`, `srtdroid = 1.10.1`, `kotlinxCoroutines = 1.11.0` ([libs.versions.toml@main](https://github.com/ThibaultBee/StreamPack/blob/main/gradle/libs.versions.toml)). **VERIFIED.** **INFERRED:** the next release will not compile into this app without a Kotlin upgrade.
- The maintainer on 2026-09-17: "I am planning a 3.2.1 for bugfixes", with the surface-leak fix postponed to 3.3.0 ([#306](https://github.com/ThibaultBee/StreamPack/issues/306)). **VERIFIED.** No date was given.

### 3.2.0 build facts

- minSdk 21, compileSdk/targetSdk 36, Java/JVM target 18, AGP 8.13.1, Kotlin 2.2.21 ([buildSrc/…/utils/Configuration.kt@3.2.0](https://github.com/ThibaultBee/StreamPack/blob/3.2.0/buildSrc/src/main/kotlin/utils/Configuration.kt) L7-9, [libs.versions.toml@3.2.0](https://github.com/ThibaultBee/StreamPack/blob/3.2.0/gradle/libs.versions.toml)). The AAR manifests read `minSdkVersion="21"`. **VERIFIED.**
- Transitive dependencies:
  - `core` depends on `androidx.core 1.17.0`, `activity 1.10.1`, `window 1.4.0` and `coroutines 1.10.2`;
  - `srt` depends on `srtdroid-ktx 1.9.5`;
  - `rtmp` depends on `komuxer rtmp 0.4.0`, which depends on Ktor 3.3.3 (`ktor-network`, `-network-tls`, `-client-cio`, `-http`).

  Source: the POMs in `~/.gradle/caches/modules-2`. **VERIFIED.**

### API changes in 3.2.0 (from the [3.2.0 release notes](https://github.com/ThibaultBee/StreamPack/releases/tag/3.2.0))

**API changes:**

- `toggleBackToFront` becomes `switchBackToFront`.
- DualStreamer interface split.
- `StreamerLifeCycleObserver` merge, and `autostartAudioCapture` becomes `startAudioCaptureOnResume`.

**Useful to us:**

- video `isMuted`;
- camera capture-result access;
- "emit closed state for camera disconnection in CameraUtils";
- RTMP metrics;
- a generic Metrics API;
- "SRT: handle exceptions when checking packet timestamp".

The spike was already on 3.2.0, so nothing breaks for plan C.

**Breaking changes on unreleased `main`:**

- AGP 9;
- `@SubclassOptInRequired(InternalStreamPackApi::class)` on internals (65e8502), which affects subclassing internal interfaces, as a custom endpoint does;
- an Android 37 local-network permission (9618475).

**VERIFIED** (commit log).

### Behaviour that matters to plan C

**Rotation, F-P5-6.** **VERIFIED, not fixed.**

- 3.2.0 `EncodingPipelineOutput.setTargetRotation` stores `pendingTargetRotation` while streaming ([L195-206](https://github.com/ThibaultBee/StreamPack/blob/3.2.0/core/src/main/java/io/github/thibaultbee/streampack/core/pipelines/outputs/encoding/EncodingPipelineOutput.kt#L195-L206)).
- `resetVideoEncoder()` applies a pending rotation or calls `reset()`, never both (L734-740).
- The applied rotation is a no-op when the value is unchanged (`shouldUpdateRotation`).
- `main` has the same code; `git diff 3.2.0 main` shows no change to this logic.
- Rotation enters **only** through callers. `SingleStreamer` never subscribes to a rotation provider itself. The spike called `setTargetRotation` from `DisplayRotationProvider` (`SpikeSession.kt:780-784`, spike branch).
- `StreamerService` does subscribe (`services/…/StreamerService.kt:201@3.2.0`).
- The encoded orientation is fixed at construction through `cameraSingleStreamer(…, defaultRotation = …)` (`SingleStreamer.kt:70@3.2.0`).

Plan C's rule holds: pass `defaultRotation` at arm and never call `setTargetRotation` while streaming.

**Drop signal, R3.** **VERIFIED.**

- `CompositeEndpoint.throwableFlow = MutableStateFlow(null)`, a constant, in 3.2.0 L70 and on `main` L72.
- `SrtSink` records the socket's completion cause in a private `completionException` (L46, L87-89), which reaches the caller only as a `ClosedException` on the next `write`.
- `RtmpEndpoint` does emit on its own `throwableFlow` (L134-195).
- **INFERRED:** a sink of our own (see SRT pacing) can expose its completion cause at once, and that closes R3 for SRT without the 250 ms wait.

**B-frames and profile.** **VERIFIED.**

- `VideoCodecConfig` sets `KEY_PROFILE`/`KEY_LEVEL` only when `!requestFallback`, then `KEY_PRIORITY = 0`. It then calls `format.customize(requestFallback)` **last** ([VideoCodecConfig.kt L230-259@3.2.0](https://github.com/ThibaultBee/StreamPack/blob/3.2.0/core/src/main/java/io/github/thibaultbee/streampack/core/elements/encoders/VideoCodecConfig.kt#L230-L259)).
- `VideoConfig` is a `typealias` of `VideoCodecConfig` (`ISingleStreamer.kt:38`).
- `MediaFormat.KEY_MAX_B_FRAMES` is API 29 (SDK 36 `api-versions.xml`).
- **INFERRED:** set it in `customize` under both fallback branches. It has no effect below API 29 (the app's minSdk is 24), and an encoder may ignore it. The P5 ffprobe check (0 B, `has_b_frames=0`) is the proof and has to be rerun per handset class.

**SRT options.** **VERIFIED, bytecode and source.**

- srtdroid `SrtUrl` exposes `maxBandwidth`, `inputBandwidth`, `overheadBandwidth`, `latencyInMs`, `peerLatency`, `passphrase`, `streamId` and more, and applies them before connecting.
- StreamPack's `SrtSink.startStream()` then runs `socket.setSockFlag(SockOpt.MAXBW, 0L); socket.setSockFlag(SockOpt.INPUTBW, bitrate)` ([SrtSink.kt L166-167@3.2.0](https://github.com/ThibaultBee/StreamPack/blob/3.2.0/extensions/srt/src/main/java/io/github/thibaultbee/streampack/ext/srt/elements/endpoints/composites/sinks/SrtSink.kt#L166-L167)), with `bitrate = Σ startBitrate` (L63), in bits per second.
- libsrt documents `SRTO_INPUTBW` and `SRTO_MAXBW` in **B/s**, both "post" (settable after connect). With `MAXBW=0`, `MAXBW = INPUTBW × (100 + OHEADBW)/100`, where OHEADBW defaults to 25 ([API-socket-options.md@v1.5.4](https://github.com/Haivision/srt/blob/v1.5.4/docs/API/API-socket-options.md)).
- The spike's 3,000,000 + 128,000 therefore gave a ceiling of 3,910,000 B/s ≈ **31.3 Mbit/s**. That is consistent with F-P5-11's 13.9–17 Mbit/s bursts ([P5 L556-579](../../specs/2026-09-11-p5-android-results.md)).
- The `SrtSink` socket is private, so no public API can set `MAXBW` after `startStream`.
- **INFERRED:** `SrtEndpointFactory` is only `CompositeEndpointWithMetricsFactory(TsMuxer(), SrtSink(dispatcher))` (`SrtEndpointFactory.kt@3.2.0`), all public. Plan C can compose `TsMuxer` with **its own sink**, adapted from `SrtSink` under Apache-2.0 with attribution. That sink would:
  - set `MAXBW` in B/s from `SrtBandwidth`;
  - update `MAXBW` on each regulator step;
  - expose its completion cause.
- srtdroid has no `SRTO_MAXREXMITBW` (libsrt 1.5.3+) in 1.9.5 or 1.10.1; `SockOpt` has 56 constants and none is `REXMIT`. **VERIFIED.**

**Backpressure, [#302](https://github.com/ThibaultBee/StreamPack/issues/302).** **VERIFIED** (issue, commit ffefcbb).

- In 3.2.0 the encoder output channels are `Channel.UNLIMITED` (`EncodingPipelineOutput.kt` L265, L276).
- `SrtSink.write` calls the blocking `socket.send` (L148), inside `runBlocking` in `CompositeEndpoint` (L58-62).
- The reporter measured multi-second encoder-output stalls under congestion.
- The fix on `main` (ffefcbb, 2026-09-14) makes both channels capacity 4 and switches the sink to srtdroid 1.10.1's `trySend`. The maintainer wrote "Fixes have been pushed to `main`" on 2026-09-26. None of it is released.
- **INFERRED:** this interacts with F-P5-2/F-P5-11 on thin links, and a correctly set `MAXBW` makes `send` block sooner. The sink design has to decide how it blocks or drops. See "Open".

**Bitrate regulator.** `streamer.bitrateRegulatorControllerFactory` and `SrtBitrateRegulator.Factory` exist in 3.2.0 (streampack-srt classes; used at `SpikeSession.kt:364`). The spec's `BitrateRegulator` lives in `core/`, so plan C only needs `videoEncoder.bitrate = …`, which the spike used at `SpikeSession.kt:382`. **VERIFIED.**

**Camera reopen and availability.** **VERIFIED.**

- 3.2.0 has no in-place reopen. `VideoInput.setSource` skips a factory for the same camera id, which is why the spike used an id round trip (`CameraReopen.kt`, spike branch).
- `BitmapSourceFactory` exists in 3.2.0 (`BitmapSource.kt:171`), so `SlateSource` can be a `setVideoSource(BitmapSourceFactory(bmp))`.
- `main` adds a `setBitmap`-style convenience (2ac4e53), unreleased.
- No camera-availability callback is exposed. Use `CameraManager` directly (§4).

**Audio silencing.** `AudioInput.isMuted` and `VideoInput.isMuted` exist in 3.2.0 (`AudioInput.kt:72`, `VideoInput.kt:72`). The audio for the slate can therefore be muted without touching the recorder. StreamPack has no silencing detector; that is `MicSilence` (§4). **VERIFIED.**

**Preview view.** **VERIFIED** (source), except where marked.

- `streampack-ui` `PreviewView` is a `FrameLayout` around androidx `CameraViewfinder` (`PreviewView.kt:34,77@3.2.0`).
- Pinch-zoom and tap-to-focus are **on by default** (L140-141).
- [#288](https://github.com/ThibaultBee/StreamPack/issues/288) (open): in FIT mode the preview shows a different crop from the encoded stream. The maintainer's fix branch `bugfix/fit_preview_to_config` is unreleased. The spike's `SpikePreviewView` embedded it with `shouldUseAndroidLayout = true` and ran on Fabric through P5.
- **INFERRED:** the spec's "letterboxed at 16:9, never cropped" is at risk of not being what viewers get.

**Foreground service helper.** **VERIFIED.**

- `streampack-services` `StreamerService` hard-codes `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` (L153-161) and owns the streamer as a bound `LifecycleService`.
- It also forwards a `SensorRotationProvider` into `setTargetRotation` (L201), which is F-P5-6's trigger.

**Do not use it.** Write `CaptureForegroundService` as the spec says.

**16 KB pages.** srtdroid 1.9.5 and 1.10.1 `arm64-v8a/libsrtdroid.so` `LOAD` segments are aligned at `0x4000` (`llvm-readelf -l`, NDK 27.1). **VERIFIED.**

### Version recommendation

Pin **StreamPack 3.2.0** exactly, with Gradle `strictly`, for `core`, `ui`, `srt` and `rtmp`. The reasons:

- it is the newest release;
- the spike proved it on this SDK and this Kotlin;
- `main`'s fixes (#302, the TS PCR overflow after about 94 h in #301, the surface release in 9036a3f) are unreleased and would come with Kotlin 2.4 / AGP 9.

Revisit when 3.2.1 is published, and read its POMs for its Kotlin stdlib before adopting it.

## 2. Ktor and F-P5-12

- **KTOR-3565** has State **"As Designed"**, is resolved 2021-12-14, affects 1.6.7, and has no fix version (YouTrack REST `api/issues/KTOR-3565`, read 2026-09-30). The reporter closed it themselves: "Ok, my fault sorry for the trouble… outgoing channel… can throw exception if you try `send` when user just lost internet connection" (comment, 2021-12-13). **VERIFIED.** It is not a tracking issue for the TLS closer; the P5 doc cites it as "a known class", which overstates it. Related: [KTOR-2821](https://youtrack.jetbrains.com/issue/KTOR-2821) is **Open** (Android `Software caused connection abort` on later calls). A search for `cio-tls-closer` found nothing.
- **The crash site is in every Ktor release.** In `TLSClientHandshake`, `output.invokeOnClose { launch(CoroutineName("cio-tls-closer")) { try { … rawOutput.writeRecord(record) … } finally { closeTask.complete() } } }` has no `catch`. The code is identical at [3.3.3 L121-137](https://github.com/ktorio/ktor/blob/3.3.3/ktor-network/ktor-network-tls/jvm/src/io/ktor/network/tls/TLSClientHandshake.kt#L121-L137), at 3.6.0 L128-144, and on `main` @1d177d32 (2026-09-29). **VERIFIED.** No Ktor version fixes it.
- **Where it gets its context.** komuxer calls `tcpSocket.tls(selectorManager.coroutineContext)` (`RtmpConnectionBuilder.kt:81`, in both [`rtmp-0.4.0-sources.jar`](https://repo1.maven.org/maven2/io/github/komedia/komuxer/rtmp/0.4.0/) and 0.4.4). Ktor's `ActorSelectorManager.coroutineContext = context + CoroutineName("selector")`, which has no Job and no handler (3.3.3 `ActorSelectorManager.kt:36`). StreamPack builds it as `SelectorManager(ioDispatcher)` from `IDispatcherProvider.io` (`RtmpEndpoint.kt:101@3.2.0`), and `RtmpEndpointFactory.create(context, dispatcherProvider)` is public (L315-318). **VERIFIED.** komuxer's GitHub repo (`komedia/komuxer`) returns 404, so it was read from the Maven sources jars.
- **Versions.** StreamPack-rtmp 3.2.0 uses komuxer 0.4.0, which uses Ktor 3.3.3. komuxer 0.4.1–0.4.4 (2026-09-22 to 29) use Ktor 3.5.1 and `kotlin-stdlib 2.4.0`. Ktor 3.5.1 and 3.6.0 use `kotlin-stdlib 2.3.21` and `coroutines 1.11.0`. **VERIFIED** (POMs).
- **Forcing a newer Ktor or komuxer is not compatible,** and it would buy nothing:
  - the closer is unchanged (VERIFIED);
  - 2.3/2.4 stdlib metadata is outside Kotlin 2.1.20's read window (INFERRED; not built);
  - it would also move coroutines past expo-modules-core's 1.10.2 (VERIFIED dependency; the effect INFERRED).
- **Alternatives.**
  1. **The spike's scoped default handler** (`KtorAbortGuard.kt`). It swallows only an `IOException` with an `io.ktor.network.` frame, off the main thread, never an `Error` or our own frames. Measured on the device: 10 swallowed across 18 RTMPS drops, 0 crashes ([P5 L593-646](../../specs/2026-09-11-p5-android-results.md)). **VERIFIED.**
  2. **Narrower: an RTMP-only IO dispatcher.** Wrap `RtmpEndpointFactory` and pass an `IDispatcherProvider` whose `io` is `Executors.newFixedThreadPool(n, factory).asCoroutineDispatcher()`, with the factory setting a per-thread `uncaughtExceptionHandler` that applies the same predicate. The closer runs as a root coroutine on that dispatcher, and kotlinx 1.10.2 `propagateExceptionFinalResort` calls `Thread.currentThread().uncaughtExceptionHandler`, as the spike's comment traced. **INFERRED**; this needs a device cut to prove the throw lands on our thread.
  3. **Another TLS path.** StreamPack 3.2.0 has only the komuxer/Ktor RTMP endpoint; there is no alternative in the library. Writing an RTMPS transport is out of proportion.
- **Recommendation.** Keep Ktor 3.3.3. Ship (2) with (1)'s predicate if the device proves it; otherwise ship (1) as it stands. Either way, the spec's proof applies: **cut the network while publishing RTMPS to a Cloudflare live input** (not a local listener), at least 10 cuts across Wi-Fi-off and airplane mode. Pass means:
  - the process survives;
  - every swallow is logged within about 50 ms of a `dropped`;
  - the session reconnects.

  Also, mutate the guard once (disable it) and watch the crash return (AGENTS §10).

## 3. srtdroid

- The latest is **1.10.1** (2026-09-26, "srt 1.5.7, openssl 3.5.1"). It changes `send` so that it consumes the `ByteBuffer`, and it adds a coroutine `trySend`. 1.10.0 (2026-08-26) was also srt 1.5.7. 1.9.5 (2025-12-02) was **srt 1.5.4**, openssl 3.5.1 ([releases](https://github.com/ThibaultBee/srtdroid/releases)). **VERIFIED**, and `strings` on the `.so` agree (1.5.4 and 1.5.7).
- libsrt **1.5.6** (2026-07-20) fixed CVE-2026-55869 (a KMREQ heap overflow) and CVE-2026-55868 (an encryption downgrade). **1.5.7** (2026-08-28) adds further handshake, ACK and DROPREQ hardening ([Haivision/srt releases](https://github.com/Haivision/srt/releases)). **VERIFIED.** **INFERRED:** we are a caller that only reaches Cloudflare, so the exposure is a hostile or MITM peer, which is low but not nil.
- **Compatibility.** All 57 srtdroid members referenced by streampack-srt 3.2.0 bytecode resolve, by descriptor, in 1.10.1 (`javap -s` over the `classes.jar`). The TS muxer rewinds each packet buffer before it hands it on (`TSOutputCallback.kt:22-24@3.2.0`), so 1.10.1's "consume the buffer" should be harmless. 1.10.1 is built with `kotlin-stdlib 2.2.10`, which is inside the window. **VERIFIED** (link-level); runtime **INFERRED**.
- **F-P5-1 (host resolution).** No release note in 1.9.5–1.10.1 mentions host resolution or a null `sockaddr`. **INFERRED** that it is unfixed. Keep the spec's "resolve the host first; report `UnknownHostException`".
- **F-P5-11 (MAXBW).** srtdroid exposes `SockOpt.MAXBW/INPUTBW/OHEADBW` and `SrtUrl.maxBandwidth`, but StreamPack overwrites them (§1).
- **Recommendation:** pin **srtdroid-ktx 1.10.1** with `strictly`, which forces libsrt 1.5.7. That depends on a device publish to Cloudflare SRT, with P5's frame counters, before it is relied on. If it fails, fall back to 1.9.5, pinned, and record the CVE exposure as a known risk. The custom sink (§1) should use this version directly.

## 4. Android platform facts, for targetSdk 36

**Foreground service (FGS).** **VERIFIED** (developer.android.com, pages updated 2026-09-16/21), except where marked.

- For the `camera` and `microphone` types, apps targeting API 34+ need `FOREGROUND_SERVICE_CAMERA` / `FOREGROUND_SERVICE_MICROPHONE` plus the granted runtime `CAMERA` / `RECORD_AUDIO` ([service types](https://developer.android.com/develop/background-work/services/fgs/service-types)).
- A service of either type "cannot [be created] while your app is in the background". Both are while-in-use restricted: "you must call `startForegroundService()` or `bindService()` while your app has a visible activity". Otherwise the call throws a `SecurityException` ([restrictions-bg-start](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)).
- Apps targeting API 31+ get `ForegroundServiceStartNotAllowedException` for any background start outside the exemptions.
- Neither may start from `BOOT_COMPLETED`.
- `PermissionChecker.checkSelfPermission()` does not predict the failure.
- The `ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA/MICROPHONE` constants are API 30 (`api-versions.xml`).
- Android 16's targeting changes list no new FGS rule for these types ([behavior-changes-16](https://developer.android.com/about/versions/16/behavior-changes-16)). The same page says orientation locks are ignored on displays with smallest width ≥ 600 dp. That matters for the orientation gate on tablets, not for plan C.
- **Implication (INFERRED):** start the service on the Go-live hold, or at arm while visible, and never from a reconnect or reopen path after backgrounding. Return `START_NOT_STICKY` (as the spike does), because a sticky restart would come from the background.

**The notification.** **VERIFIED.**

- Android 14 made `setOngoing(true)` notifications dismissible except on the lock screen ([behavior-changes-all 14](https://developer.android.com/about/versions/14/behavior-changes-all)). The `LIVE · 3000k · 47 min` notification can therefore be swiped away while the service keeps running.
- With `POST_NOTIFICATIONS` denied (API 33+), the FGS notice appears only in the Task Manager, not the drawer ([notification-permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)).
- Task Manager **Stop** kills the whole app with **no callback**. On the next start, `ApplicationExitInfo.REASON_USER_REQUESTED` identifies it ([handle-user-stopping](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping)).
- **INFERRED:** the reopen gate should read that exit reason and say so.

**Microphone silencing.** **VERIFIED** (API levels and AOSP javadoc; the behaviour measured in P5).

- `AudioManager.registerAudioRecordingCallback` and `getActiveRecordingConfigurations` are API 24, as is `getClientAudioSessionId`. `isClientSilenced()` is **API 29**.
- The javadoc says it is true when "being silenced by the audio framework due to concurrent capture policy" (AOSP `AudioRecordingConfiguration.java`, android16-release).
- P5 measured phone and WhatsApp calls firing it, matched by session id ([P5 L732-754](../../specs/2026-09-11-p5-android-results.md)).
- Below 29 the app sees nothing (the spike's `mic-silence-unwatched`). **INFERRED:** on API 24–28 handsets, only an audio level floor can detect it.

**Camera availability.** **VERIFIED** (AOSP `CameraManager.java`, android16-release; `api-versions.xml`).

- `AvailabilityCallback` is API 21. On registration it "is immediately called with the availability status of all currently known camera devices".
- `onCameraUnavailable` "will be called whenever a camera device is opened by any camera API client". That **includes our own open**, so contention means another id going unavailable, or our device's `onDisconnected`/`onError(ERROR_CAMERA_IN_USE)` (API 21).
- `onCameraAccessPrioritiesChanged` is API 29: "the camera may now be openable".
- `onCameraOpened(cameraId, packageId)` is `@SystemApi` and needs `CAMERA_OPEN_CLOSE_LISTENER`, so **the other app's identity is not available**.
- P5 F-P5-10: WhatsApp opened camera 1 while we held camera 0, with no eviction, and the result was macroblock noise until a reopen ([P5 L787-867](../../specs/2026-09-11-p5-android-results.md)).

**Thermal.** **VERIFIED** (AOSP `PowerManager.java`, api-versions).

- `getCurrentThermalStatus` and `addThermalStatusListener` are API 29. `getThermalHeadroom(int)` is **API 30**. `getThermalHeadroomThresholds` is API 35.
- `getThermalHeadroom` returns **`NaN`** "if the device does not support this functionality or if this function is called significantly faster than once per second". It is rate-limited internally at 500 ms (`MINIMUM_HEADROOM_TIME_MILLIS`). 1.0 means SEVERE.
- The spec's "reads −1 below API 30" is **our own sentinel**, not a platform value. The adapter must map NaN separately (P5 L1705-1710 already does).

**Battery.** **VERIFIED** (AOSP `BatteryManager.java`; P5), except where marked.

- `BATTERY_PROPERTY_CHARGE_COUNTER` is API 21, "Battery capacity in microampere-hours".
- `getIntProperty` returns `Integer.MIN_VALUE` when unsupported (targetSdk ≥ 28), and `getLongProperty` returns `Long.MIN_VALUE`.
- On the OnePlus 10 Pro the counter measured 16.8 mAh/min under encode, **while the percentage read 100% and the charging flag read true** ([P5 L1101](../../specs/2026-09-11-p5-android-results.md)). That flag is `isCharging()` / the sticky broadcast.
- **INFERRED:** "charging" cannot be trusted as proof of a supply, and counter granularity and units vary by OEM. It is verified on one handset only.

## 5. Expo Modules API (expo-modules-core 57.0.17)

Paths are under `node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/`. **VERIFIED.**

- **Native view.** Subclass `ExpoView(context, appContext)` and register it with `View(PreviewView::class) { … }` in the module definition, as the spike did (`P5SpikeModule.kt:35`). For a SurfaceView child, override `shouldUseAndroidLayout = true` (`views/ExpoView.kt:34`). That makes `requestLayout()` post `measureAndLayout()` (L41-53). The spike comment: "RN does not lay out plain Android children; a SurfaceView left unmeasured stays black". Lifecycle hooks are `OnViewDestroys { view -> }` (`views/ViewDefinitionBuilder.kt:88`) and `OnViewDidUpdateProps` (L106); view events are `Events(...)` (L193).
- **Events at 1 Hz.** Declare them with `Events("onSnapshot", …)` (`objects/ObjectDefinitionBuilder.kt:438`) and send with `sendEvent(name, Map/Bundle)` (`modules/Module.kt:46,50`). Start and stop the ticker in `OnStartObserving` / `OnStopObserving` (L463-516), so that nothing ticks with no JS listener.
- **Module lifecycle.** `OnCreate`, `OnDestroy`, `OnActivityEntersForeground/Background`, `OnActivityDestroys` (`modules/ModuleDefinitionBuilder.kt:108-150`).
- **A module that owns a foreground service.** Declare the `<service android:foregroundServiceType="camera|microphone">` and the permissions in the module's own `android/src/main/AndroidManifest.xml`; the manifest merger puts them in the app. The spike did exactly this, and P5 ran on it (spike `AndroidManifest.xml`). Start it with `ContextCompat.startForegroundService` from a `Function` called while the activity is visible (`SpikeForegroundService.kt:74`). **INFERRED:** an `app.json` config plugin is not needed unless a permission must be removed or an `<application>` attribute changed.
- **Fabric pitfalls:**
  - SurfaceView ignores RN transforms, `opacity` and `borderRadius` clipping (INFERRED, standard SurfaceView behaviour).
  - A transparent WebView drawn over it composes correctly; P5 ran the overlay over the preview ([P5 L438](../../specs/2026-09-11-p5-android-results.md)). **VERIFIED.**
  - Size the ExpoView to 16:9 in JS; the preview adapts to its parent's size (maintainer in #288). **VERIFIED.**
  - Disable `enableZoomOnPinch` and `enableTapToFocus` unless the product wants them. A tap or a hand steadying the phone would refocus (INFERRED; the defaults are VERIFIED).

## 6. StreamPack issues since 3.2.0

The search was `gh issue list -R ThibaultBee/StreamPack --search …` on 2026-09-30, for: SRT reconnect, RTMPS crash, `ClosedWriteChannelException`, "Software caused connection abort", rotation, camera in use or disconnected, audio silence, B-frames, `MAXBW`/`INPUTBW`, `isStreamingFlow`/`throwableFlow`, ktor.

| Issue                                                        | State                                        | Relevance                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#302](https://github.com/ThibaultBee/StreamPack/issues/302) | open; fixed on `main` 2026-09-26, unreleased | A blocking SRT `send` stalls the encoder output under backpressure (3.2.0). Bears on F-P5-2 and F-P5-11, and on the watchdog's reading of a stall.                      |
| [#306](https://github.com/ThibaultBee/StreamPack/issues/306) | open; fix deferred to 3.3.0                  | About 16 MB of encoder surface leaked per session (3.2.0). Every reconnect or rebuild is a session, so memory over 3 h of reconnects **must be watched on the device**. |
| [#301](https://github.com/ThibaultBee/StreamPack/issues/301) | open; fixed on `main` (47c76ea)              | The TS PCR overflows after about 94–95 h of **device uptime**, not stream time. SRT output is corrupted on a phone up for 4 days. Low odds, and silent when it happens. |
| [#288](https://github.com/ThibaultBee/StreamPack/issues/288) | open                                         | Preview FIT crop ≠ stream. Framing parity must be proven.                                                                                                               |
| [#274](https://github.com/ThibaultBee/StreamPack/issues/274) | closed 2026-02-02 (komuxer fix)              | An RTMPS crash on Facebook, a connect-time `JobCancellationException`, in 3.1.0. Not our TLS closer.                                                                    |
| [#290](https://github.com/ThibaultBee/StreamPack/issues/290) | closed                                       | Rotation while streaming is unsupported by design. Consistent with never rotating while live.                                                                           |

Nothing matching R3, F-P5-6, F-P5-8, F-P5-10, F-P5-12, B-frames or SRT pacing is reported upstream. **INFERRED:** these are ours to carry, and worth reporting upstream (F-P5-6, R3, the INPUTBW units) once plan C has its repros.

## Recommendations for plan C

1. **Pins,** with Gradle `strictly` in `modules/capture-engine/android/build.gradle`, and a comment citing this file:
   - `io.github.thibaultbee.streampack:streampack-{core,ui,srt,rtmp}:3.2.0`;
   - `io.github.thibaultbee.srtdroid:srtdroid-ktx:1.10.1` (libsrt 1.5.7), conditional on the device proof in "Open"; the fallback is 1.9.5;
   - Ktor stays at **3.3.3**, transitively through `io.github.komedia.komuxer:rtmp:0.4.0`. Pin both so that no transitive bump lands komuxer 0.4.1+ (Kotlin 2.4 stdlib).
   - Do **not** add `streampack-services`.
2. **Your own SRT sink** (Apache-2.0, adapted from `SrtSink`, with attribution), composed with StreamPack's `TsMuxer` through `CompositeEndpointWithMetricsFactory`. It:
   - sets `MAXBW` in **bytes/s** from `SrtBandwidth` after connect, and on every regulator step;
   - exposes the socket's completion cause as a flow (R3);
   - resolves the host before `connect` (F-P5-1).

   Its first named failing test: "`MAXBW` is set in bytes per second, and a target change reaches the socket".

3. **Video config.** Pass `defaultRotation` at arm, from the landscape side held, and never call `setTargetRotation` while streaming (F-P5-6). Add `customize = { setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0) }` (API 29+) and record the resulting profile.
4. **F-P5-12.** Keep Ktor 3.3.3 plus a scoped guard. Try the RTMP-only IO dispatcher first; fall back to the spike's global predicate. Prove it by cuts against Cloudflare RTMPS, with a mutation run.
5. **The service** is started only from a visible activity, is `START_NOT_STICKY`, and has types `camera|microphone`. It holds a partial wake lock and carries its notification copy in the four locales. On launch, read `ApplicationExitInfo` for `REASON_USER_REQUESTED` and for a crash.
6. **Adapters** follow §4: session-id-matched `isClientSilenced` (API 29+, and say so below it); camera contention from other ids plus our `onDisconnected`/`ERROR_CAMERA_IN_USE`; headroom with NaN kept distinct from "unsupported"; drain from the charge counter only.
7. **Bridge.** One `ExpoView` with `shouldUseAndroidLayout`, sized 16:9 from JS, with pinch and tap disabled; a 1 Hz `sendEvent` gated by `OnStartObserving`; void `Function` intents.
8. **Upgrade trigger.** Watch for StreamPack 3.2.1. Adopt it only if its POM stays on Kotlin stdlib ≤ 2.2.x, or when the app moves to Kotlin ≥ 2.3 (an SDK decision, not plan C's).

## Open — must be proven on device

1. **SRT pacing.** With the sink's `MAXBW` in B/s, rerun F-P5-11's thin-link cell (1.5 Mbit/s throttle). The burst above link rate should disappear. Then measure what `send` does when paced: whether it blocks and stalls the encoder (#302), or drops.
2. **srtdroid 1.10.1 under StreamPack 3.2.0.** Publish to a Cloudflare SRT input for ≥ 10 min with a reconnect, the frame counters on and ffprobe on the delivered stream.
3. **The RTMPS guard.** The RTMP-only dispatcher must catch the closer's throw on our thread: ≥ 10 cuts against Cloudflare, plus a mutation run.
4. **B-frames.** `KEY_MAX_B_FRAMES = 0` must give `has_b_frames=0` on at least two SoCs, including an API 29 mid-range such as the Redmi Note 7 Pro. An API 24–28 handset cannot be controlled this way.
5. **Framing parity (#288).** Compare the preview at 16:9 with a decoded frame of the encoded stream, in both landscape sides.
6. **Memory (#306).** RSS after 20 forced reconnects, and again after 3 h.
7. **Camera contention.** The `onCameraUnavailable` pattern for another app opening a different id, compared with eviction, on a second OEM. Only one handset and one calling app are measured so far.
8. **Battery.** Charge-counter units and granularity on a second OEM. The charging flag has already been shown to lie on the OnePlus.
9. **The FGS start points.** Arm, then background, then a reconnect or camera reopen must never start a service from the background (no `SecurityException` in logcat). Test on Android 14 and on 16.
10. **The Kotlin window.** If anyone proposes StreamPack `main`, komuxer 0.4.1+ or Ktor 3.5+, run a real `assembleDebug` first. The failure predicted here is not built.

## StreamPack-boilerplate (reference only)

**Read:** [ThibaultBee/StreamPack-boilerplate](https://github.com/ThibaultBee/StreamPack-boilerplate) at `34f9bf8` (2026-08-23), shared by the owner "for idea and reference only". Nothing is copied. Boilerplate paths below are relative to `app/src/main/java/io/github/thibaultbee/streampack/app/` unless they start with `app/` or `gradle/`. StreamPack paths are cited at tag `3.2.0` (`a5d112d`), read locally, because the boilerplate's behaviour lives in what it calls. All of it is **VERIFIED (source)** unless tagged **INFERRED**.

### 1. Versions

- It targets **StreamPack 3.2.0**: `core`, `ui`, `rtmp`, `srt`, and not `services` (`gradle/libs.versions.toml:12,23-26`; `app/build.gradle.kts:48-54`). That is our pin exactly.
- The toolchain is **not ours**: Kotlin **2.4.10** and AGP **9.2.1** (`libs.versions.toml:2,9`), compileSdk/targetSdk **37**, minSdk 24, JVM 18 (`app/build.gradle.kts:10-17,33-40`), Gradle 9.4.1, and the AGP 9 opt-outs `android.builtInKotlin=false` / `android.newDsl=false` (`gradle.properties:33-34`).
- **Compatibility.** The library pin is compatible, because what matters is the AARs' stdlib (2.2.21, §1), not the boilerplate's compiler. Its build files are not reusable at Kotlin 2.1.20 / AGP 8.12, and its code uses `Build.VERSION_CODES.CINNAMON_BUN` (API 37) with `ACCESS_LOCAL_NETWORK` (`MainActivity.kt:89-91`), which does not compile at our compileSdk 36. **INFERRED:** Cloudflare ingest is a public host, so the local-network permission does not apply to us even at 37.

### 2. Building the streamer

- **Single endpoint.** `SingleStreamer(application)` with every default (`MainViewModelFactory.kt:39-50`). `DualStreamer` appears only in a comment. The defaults are `endpointFactory = DynamicEndpointFactory()` and `defaultRotation = context.displayRotation` (`SingleStreamer.kt:207-214`). For an application context, that rotation is the default display's at construction time (`ContextExtensions.kt:48-52`).
- **Sources.** `setAudioSource(MicrophoneSourceFactory())` and `setCameraId(defaultCameraId)`, set only after the permission grant (`MainViewModel.kt:161-177`; `MainActivity.kt:170-180`).
- **Config.** `AudioConfig(AAC, 44100, stereo)` (`MainViewModel.kt:124-128`) and `VideoConfig(AVC, 1280×720, fps = 25)` (`MainViewModel.kt:149-151`). **No bitrate, profile, GOP or B-frame setting.** The defaults then apply:
  - 2 Mbit/s and a 1 s GOP (`VideoCodecConfig.kt:65,82`);
  - the **best** AVC profile, with **High first** (`VideoCodecConfig.kt:340-348`), which is the profile that allows B-frames.

  This is consistent with P5 needing `KEY_MAX_B_FRAMES = 0` (§1 "B-frames").

- **SRT vs RTMP.** It uses the URL scheme only: `startStream(url)` → `open(uri)` → `DynamicEndpoint.getEndpoint(type)` (`MainViewModel.kt:92`; `IStreamer.kt:164-172`; `DynamicEndpoint.kt:196-214`). There is **no fallback**.
  - `DynamicEndpoint` creates **one** SRT and **one** RTMP endpoint, lazily, and caches them for its lifetime (`DynamicEndpoint.kt:257-269`).
  - Both come from `internal` helpers, and RTMP is built by reflection with the streamer's shared `ioDispatcher` (`Endpoints.kt:15-23,93`).

### 3. Preview and orientation

- **The preview** is the `streampack-ui` `PreviewView`, `match_parent`, with no attributes (`app/src/main/res/layout/activity_main.xml:9-16`). It is bound with `setVideoSourceProvider(streamer)` (`MainActivity.kt:182-186`). Its defaults are pinch-zoom **on**, tap-to-focus **on**, and scale **FILL**, which crops (`PreviewView.kt:140-145`).
- **The view owns the camera preview.** It stops the preview whenever the window stops being visible. On **every size change** it runs `stopPreview` → `resetPreview` → `requestSurface` → `startPreview` on the camera source (`PreviewView.kt:289-313,434-450`). Binding a different streamer calls `requestRelease()` on the old source (`PreviewView.kt:242-265`).
- **Rotation: the F-P5-6 trigger, verbatim.**
  - `SensorRotationProvider` is collected for the ViewModel's lifetime and fed to `streamer.setTargetRotation(it)`, **including while streaming** (`MainViewModel.kt:73-77`; `RotationRepository.kt:21`).
  - While streaming, the activity locks to `SCREEN_ORIENTATION_LOCKED` (`MainActivity.kt:124-129,150-158`). The sensor still fires, however.
  - The repository's own comment says to use `DisplayRotationProvider` when orientation is locked (`RotationRepository.kt:14-19`).
- Nothing addresses #288.

### 4. Service and permissions

- **No foreground service** of any kind: no `<service>`, no `FOREGROUND_SERVICE_*` and no `POST_NOTIFICATIONS` (`AndroidManifest.xml:13-19`).
- **Instead**, `StreamerLifeCycleObserver(streamer)` is attached to the activity (`MainActivity.kt:64,103`). On **`onPause`** it runs `stopStream()`, `close()` and `audioInput.stopCapture()` (`StreamerLifeCycleObserver.kt:70-94@3.2.0`). Backgrounding therefore ends the broadcast by design.
- **The streamer's lifetime is the ViewModel's** (`onCleared` → `releaseBlocking`, `MainViewModel.kt:186-188`).
- **Permissions.** `CAMERA` and `RECORD_AUDIO` are requested on every `onStart`, with a rationale dialog (`MainActivity.kt:28-59,164-167`; `utils/PermissionsManager.kt:26-66`).

### 5. Errors and reconnect

- **Observation** (`MainViewModel.kt:43-67`):
  - `isStreamingFlow` becomes the button state;
  - `throwableFlow` is split into `isClosedException` (a disconnect) and everything else;
  - a connect failure is caught around `startStream(url)`.

  Each ends in a **toast** (`MainActivity.kt:109-122`). **There is no reconnect loop.**

- **What a drop does inside 3.2.0.**
  - The output stops itself. A write failure or an `isOpen → false` calls `stopStream()` and emits the throwable (`EncodingPipelineOutput.kt:246-256,295-331`).
  - When the last output stops, the pipeline stops the inputs' streaming (`StreamerPipeline.kt:842-866`).
  - **INFERRED:** every reconnect is therefore a fresh `open` + `startStream`, with an encoder reset and an input restart. Each one is a #306 "session".
- **`throwableFlow` is a `StateFlow`,** both in `EncodingPipelineOutput` (`:213-214`) and after `stateIn` (`SingleStreamerImpl.kt:99-103`). A slow collector sees only the latest of two quick errors, and a new collector replays the last one. That is why the boilerplate's `asLiveData` re-toasts an old disconnect after a configuration change. This adds to R3: counting drops from `throwableFlow` both under-counts and double-counts.
- **Camera taken (3.2.0 source).**
  - `onDisconnected` / `onError(ERROR_CAMERA_IN_USE)` sets `isClosedFlow` (`CameraUtils.kt:58-85`), and `CameraSource` drops `isStreaming` (`CameraSource.kt:108-115`).
  - The pipeline then stops only **video-only** outputs while audio still streams (`StreamerPipeline.kt:175-196`), so an A/V output **stays open** with a starved encoder.
  - **INFERRED (device-unverified):** StreamPack does not end the session on eviction. `StallWatchdog`'s "hold, don't rebuild" is what stops a rebuild.

### 6–7. Regulator, SRT and RTMPS options

- There is **no bitrate regulator**; `bitrateRegulatorControllerFactory` is never set.
- **SRT** appears only as a comment: `srt://host:9998?streamid=…&passphrase=…` (`MainViewModel.kt:89-91`). It sets no latency, MAXBW or connect timeout.
- **3.2.0 also offers a typed descriptor,** `SrtMediaDescriptor(host, port, streamId, passPhrase, latency, connectionTimeout)` (`SrtMediaDescriptor.kt:80-122`), so no secret has to live in a URI string.
- **RTMPS** is never mentioned. The default URL is `rtmp://` (`data/storage/StorageRepository.kt:8`). `RtmpMediaDescriptor` accepts `rtmps` and defaults to port 443 (`RtmpMediaDescriptor.kt:65,153`). Nothing touches TLS or F-P5-12.

### 8. Adopt / avoid for plan C

| Pattern                                                                                                                           | Verdict                                               | Our rule                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The UI state is re-derived from native flows. Taps are filtered by `isPressed` and never set the state (`MainActivity.kt:85-147`) | **Adopt**, the shape                                  | Intents, not RPC: `start`/`stop` return void, and the snapshot is the truth                                                                                                                                                                                                            |
| Sources are set only after the grant (`@RequiresPermission`)                                                                      | **Adopt**                                             | The arm pre-flight includes the permission                                                                                                                                                                                                                                             |
| `ClosedException` is split from other throwables                                                                                  | **Adopt** as a classifier, **not** as the drop signal | `FallbackPolicy` counts drops from our sink's completion flow (R3), not from a conflated `StateFlow`                                                                                                                                                                                   |
| `open` and `startStream` fused in `startStream(url)`                                                                              | **Avoid**                                             | Call them separately, so that connect failures (which count toward fallback) are told apart from start failures                                                                                                                                                                        |
| Typed `SrtMediaDescriptor(host, port, streamId, passPhrase, latency)`                                                             | **Adopt** over a URL string                           | The allow-list scrub; no passphrase inside a `Uri` that could be logged                                                                                                                                                                                                                |
| `DynamicEndpointFactory` (the default)                                                                                            | **Avoid**                                             | It cannot take our SRT sink (rec. 2), and it shares one `ioDispatcher` with RTMP (rec. 4). **INFERRED:** plan C needs its own `IEndpointInternal.Factory` that routes SRT to `TsMuxer` + our sink and RTMP to `RtmpEndpointFactory` with the RTMP-only dispatcher, on **one** streamer |
| `defaultRotation` defaulted from the app context at construction                                                                  | **Avoid**                                             | Pass it explicitly at arm, from the landscape side held (P4)                                                                                                                                                                                                                           |
| `SensorRotationProvider` → `setTargetRotation`, also while live                                                                   | **Avoid**                                             | F-P5-6: never call it while streaming. The JS orientation gate owns the activity lock                                                                                                                                                                                                  |
| `StreamerLifeCycleObserver` (stops and closes on `onPause`)                                                                       | **Avoid**                                             | Native owns the session through `CaptureForegroundService`; the activity lifecycle never stops it                                                                                                                                                                                      |
| The streamer's lifetime is the ViewModel's                                                                                        | **Avoid**                                             | The engine and service scope survive activity recreation                                                                                                                                                                                                                               |
| `isStreamingFlow` as "live"                                                                                                       | **Avoid**                                             | LIVE only while encoded frames advance. `isStreamingFlow` is the pipeline's **input** flag (`SingleStreamerImpl.kt:108`)                                                                                                                                                               |
| `PreviewView` defaults (FILL, zoom and tap on)                                                                                    | **Avoid**                                             | Set FIT (16:9, letterboxed) and disable zoom and tap (§5). #288 is still open                                                                                                                                                                                                          |

### What this changes in the recommendations

Nothing here reverses the recommendations above. It adds four:

1. **Recs 2 and 4 need a custom endpoint factory.** `DynamicEndpointFactory` can host neither our SRT sink nor an RTMP-only dispatcher, so plan C passes its own `endpointFactory` to one `SingleStreamer`. It does not rebuild the streamer per transport, which would be a rebuild, and a #306 leak per switch. **INFERRED.**
2. **Never attach `StreamerLifeCycleObserver`.** Add this to rec. 5.
3. **Pass `defaultRotation` explicitly.** Add this to rec. 3.
4. **New device check (Open 11):** `PreviewView` restarts the camera preview on every size change. With Fabric laying the view out, prove that resizing it while live (overlay toggle, Settings round trip, a layout pass) causes no encoded-frame gap that the watchdog would read as a stall. **INFERRED** risk; unmeasured.
