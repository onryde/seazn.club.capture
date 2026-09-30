# S1 — Live Stream, handheld — design

**Status:** owner-approved design, 2026-09-30, brainstormed section by section. Awaiting owner review of this written spec, then the implementation plan.
**Parent:** [the three-mode decision record](2026-09-29-multi-mode-app-decisions.md) (binding; not reopened here), inside [the S0 shell](2026-09-29-s0-app-shell-design.md).
**Reference, not code to lift:** [the pre-P5 design](2026-09-10-capture-app-design.md), [the P5 Android results](2026-09-11-p5-android-results.md) (F-P5-1 … F-P5-13, H-P5-1), the spike on `origin/spike/p5-android`, and the spike screens removed in `5921ce1`.
**Web side:** the _Ask_ section below is the source of the shapes for the seazn.club branch that follows `feat/fixture-page-stream` (lane D, agreed 2026-09-30).
**Next:** S2, Remote Scoring.

## What S1 is for

S1 makes the Live Stream mode real. When S1 is done:

- a volunteer taps Live Stream on Home, scans the organiser's code, and the app checks it with the server;
- the phone turns sideways and shows the camera with the scorebug over it, plus a short pre-flight;
- they hold Go live for three seconds, and the match reaches the club's broadcast;
- through a dropped uplink, blocked UDP, a locked screen, another app taking the camera, or a phone call, the screen always says one true thing about what viewers are getting;
- the organiser sees the phone's health on the console while it streams;
- they hold Stop, or the organiser stops it from the console, and the phone says which.

**Exit bar (owner, 2026-09-30):** a real match on staging. That means a real Android phone, a real stg fixture with the overlay, the failure drills in §6, and the session record read back afterwards. The 3-hour soak and the 180° flip stay deferred to app completion. iOS is M3.

## Decisions

Each item was put to the owner as options with a recommendation. The rejected options are kept so the reasoning survives.

| #   | Topic                       | Ruling                                                                                                                                                                                                                                                                                                           | Rejected, and why                                                                                                                                                                                                                                                                                       |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The missing descriptor      | S1 builds against a **`DescriptorPort` with a fake**. It writes the endpoint's shape as an _Ask_; the real fetch is wired when the web side ships it.                                                                                                                                                            | Building the web endpoint inside S1 (a cross-repo cycle, and the web owner places it after `feat/fixture-page-stream`); deriving `playbackUrl`/`overlayUrl` on the phone (contradicts the adopted contract fact, and v1 has no fixture id); putting the URLs back in the QR (reverses lane D's ruling). |
| 2   | Exit bar                    | **A real match on staging** (above).                                                                                                                                                                                                                                                                             | Engine plus fake-driven UI only (proves too little about the match); pulling the 3 h soak and the flip into S1 (owner deferred them on 2026-09-29).                                                                                                                                                     |
| 3   | Encode control              | **A fixed ceiling, no operator choice:** 720p30, with the regulator between 500k and 3000k. Data used is shown in Diagnostics.                                                                                                                                                                                   | Standard and Data saver profiles (a choice volunteers won't know how to make; can come later if a club asks); automatic by network type (native network detection for a small gain).                                                                                                                    |
| 4   | Descriptor auth             | **capture-qr.v2 with a per-session token** (`tok`). The server stores only its hash. It is the Bearer for the descriptor and for every phone→server call, so ingest secrets never reach our API. Approved on the web side too (2026-09-30).                                                                      | sid plus the preferred ingest credential (sends a Cloudflare publish key to our API; S3's court pairing needs a lasting API credential and a new credential kind anyway); leaving it to the web side.                                                                                                   |
| 5   | Console telemetry           | **An S1 heartbeat** to the console while armed or live.                                                                                                                                                                                                                                                          | Waiting for S3's court board; a post-match record only.                                                                                                                                                                                                                                                 |
| 6   | Heartbeat sender            | **Native, from the foreground service.**                                                                                                                                                                                                                                                                         | JS through a port (Android throttles JS timers behind a locked screen, so it would go quiet when the console needs it most).                                                                                                                                                                            |
| 7   | Camera taken by another app | **A phone-made slate** goes to air, and the session stays up.                                                                                                                                                                                                                                                    | Holding the last frame (reads as a freeze); dropping the publish (starts the ~183 s hold clock, and a longer outage becomes a new recording).                                                                                                                                                           |
| 8   | What the operator sees      | **The overlay always over the camera** (Settings toggle; the first thing shed), **plus a hold-to-peek** "What viewers see" that plays delivered video while held.                                                                                                                                                | Overlay only, no peek; overlay only while held (the operator frames without the scorebug).                                                                                                                                                                                                              |
| 9   | Supabase                    | **Neither Edge Functions nor Realtime in S1.** The console shows the latest heartbeat and its age; whether it polls or is pushed is the web side's choice. The phone learns of an organiser stop from the heartbeat response or from refused ingest. Realtime comes back in S3 only if desk→phone push needs it. | Edge Functions for the descriptor and heartbeat (a second backend runtime, with the relay's auth and crypto rebuilt there); a phone Realtime subscription (a native socket to save seconds); Realtime for the console (a plan entitlement on the web side, and it saves at most ~10 s over polling).    |
| 10  | Engine approach             | **Written fresh**, with the spike and the P5 doc as references. Two layers: **`core/`** is pure Kotlin, and **`platform/`** is thin Android adapters. Every P5 finding enters as a named failing test first.                                                                                                     | Porting the spike as-is and hardening in place (inherits a throwaway structure where the state machine can only be tested on a device); a rewrite without the P5 tests (pays for each finding again on a device).                                                                                       |
| 11  | CI                          | **Kotlin core tests, the contract drift check, and an Android compile.** Detox waits.                                                                                                                                                                                                                            | Detox on an emulator now (no real camera, no Play services scanner; it would re-test what the UI tests already cover, slowly); no Android compile in CI.                                                                                                                                                |

## 1. Flow and routes

### Getting in

1. Home's Live Stream tile opens the system scanner (S0).
2. `recognise` accepts **capture-qr.v2 only**. The web stops minting v1 the day v2 ships, and nothing has shipped to a customer, so there is no v1 path.
3. The phone fetches the descriptor with `tok`. The code panel on Home says "Checking code…" while it waits, never a bare spinner.

| Outcome              | Home shows                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 200                  | The code and its descriptor are saved; route to `/stream`                                                                    |
| 401 / 404            | "This code isn't valid for streaming."                                                                                       |
| 410                  | "This stream was ended by the organiser." or "This code timed out — ask the organiser for a new one.", chosen by `endReason` |
| No network / timeout | "Can't check this code — no connection. Try again."                                                                          |
| 429                  | "Busy — trying again in {n}s", using Retry-After                                                                             |

### `/stream`: Arm, Live and Ended on one screen

Going live never navigates, so the camera view is never remounted (a spike decision, kept).

- **Arm.** The app sends `arm({session, heartbeat})`. The native preview comes up with the overlay over it, and four pre-flight chips: camera, sound (audio above the floor), network, code. Under them, **"Go live by 14:32"**: the descriptor's `warmingDeadline`, which is the web's 10-minute no-signal timeout. Go live (a 3 s hold) enables only when every chip is green. Otherwise the reason is shown at the control.
- **Live.** The same screen becomes the HUD (§4). Stop is a 3 s hold.
- **Ended.** Shown in place: the duration, the reason (you stopped it / the organiser stopped it / the connection was lost too long / a failure), then **Scan another** and **Home**.

`/stream/settings` and `/stream/diagnostics` can be reached in every state. Both carry a LIVE plate beside Back.

### Reopen and leaving

- With the engine **armed or live**, the app reopens into `/stream` with no prompt. The engine is the authority, and an armed engine only shows a preview. This settles S0's I3.
- With the engine idle and a valid saved code, Home shows the Continue card, as in S0.
- **T14 M2:** after a leave's write settles, `leaveRule` is read again before navigating, so a leave can never land Home while on air.

### During the session

Native fetches the descriptor again on every reconnect. A 410, or a heartbeat response saying the session is over, or ingest being refused, ends the session as `stopped-by-organiser`. The web side removes the Cloudflare output within about 1 s of an organiser Stop.

## 2. Contract, descriptor and domain

### The anti-corruption layer (`src/domain/credentials/`)

- **`parseCaptureQr`**: the v2 wire shape → a domain value. It is v1's shape plus `tok`. The SRT fields `url`, `streamId` and `passphrase` stay separate, and are canonical (lane D). Native composes the SRT query string. Both the bare url and the fixture's embedded query string must parse.
- **`parseDescriptor`**: the descriptor response → `SessionDescriptor`.
- Together they build **`StreamSession`** = `{sid, slot, token, primary, fallback, descriptor}`, with primary and fallback ordered by `preferred`. It replaces today's `SessionCredentials`, and the parser keeps returning `Result` rather than throwing.

The wire shape never reaches the rest of the domain (AGENTS §4).

### Ports

- **New: `DescriptorPort.fetch(sid, token) → Promise<Result<SessionDescriptor, DescriptorError>>`.** Plain `fetch` with a timeout; `DescriptorError` is `invalid | not-found | ended{endReason} | offline | rate-limited{retryAfterS}`. Built in `createNativePorts()` and faked for tests. Check the composition root, not the fake (failure class 1).
- **Engine port:**
  - `arm` takes `{session: StreamSession, heartbeat: {url, token}}`.
  - The snapshot gains:
    - `delivery: ok | stalled | unknown` and `deliveredLagMs`;
    - encoded video frames per second and audio packets per second (F-P5-4);
    - SRT sent / retransmitted / dropped / RTT;
    - `dataUsedBytes` and `charging`;
    - the heartbeat's last result.
  - New `DegradeReason` members: `not-delivered`, `camera-taken`, `mic-silenced`.
  - New `EndReason` member: `stopped-by-organiser`.
  - Thermal stays `shed`, and `DegradeReason` still has no thermal member (AGENTS §8).

### One authority

`projectEvent` (a TypeScript reducer over session events) leaves `domain/`. It is a second state machine, which AGENTS §2 forbids, and its only caller is the fake. The Kotlin `SessionMachine` is the authority, and the snapshot carries `state` directly. The fake plays scripted snapshots instead. `transportPolicy` leaves for the same reason: native decides the fallback. `audioFloor` stays, as a display selector.

### Storage and time

The saved stream code also stores the descriptor ("cached with the session", from the contract fact), in SecureStore behind the key-value port, as in S0. Every time the operator reads is shown in the descriptor's `venueTimezone`. That closes S0's phone-timezone gap for stream codes.

## 3. The native engine (`modules/capture-engine/android/`)

Written fresh. The spike and the P5 results are the reference, and nothing is copied from the spike verbatim. Every row in the first table below enters as a **named failing JVM test first**, for example `F-P5-2: mid-session drops count toward fallback`.

### `core/`: pure Kotlin

`core/` has no Android imports, with `Clock` and `Scheduler` injected. It is a plain **Kotlin/JVM Gradle module**, so its tests need JDK 17 and nothing else.

| Unit               | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P5 source                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `SessionMachine`   | The aggregate: idle → armed → connecting → publishing ⇄ degraded / reconnecting → ended. **LIVE only while encoded frames advance**, never from the streaming flag or egress.                                                                                                                                                                                                                                                                                                                       | F-P5-6, F-P5-3, F-P5-4            |
| `FallbackPolicy`   | SRT → RTMPS. Connect failures **and** repeated mid-session drops count. DNS failures (`validated=false`) don't count. The host is resolved first, and `UnknownHostException` is reported.                                                                                                                                                                                                                                                                                                           | F-P5-2, F-P5-1                    |
| `BitrateRegulator` | Starts at 1500k, raises +100k per 10 s, stays within 500k–3000k. It raises only when mean egress is ≥70% of (target + 128k) × 1.15, and remembers a failed rate for 5 min at 80%. **After a clean far-end drop it restarts at the last target**, and it halves only when the link was failing.                                                                                                                                                                                                      | F-P5-5, F-P5-7, regulator restart |
| `SrtBandwidth`     | `SRTO_MAXBW` taken from the target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | F-P5-11                           |
| `StallWatchdog`    | A rate floor, not a zero test: fewer than 10 video or 20 audio frames per second over 3 s triggers a rebuild. **While the camera is taken it holds, and does not rebuild.**                                                                                                                                                                                                                                                                                                                         | F-P5-4, F-P5-9, F-P5-10           |
| `DeliveryWatch`    | Polls the variant playlist from `playbackUrl` every ~2 s and re-resolves the master each poll. It compares delivered media time with time spent publishing (not wall time, so an outage already reported as reconnecting is not counted again as a delivery stall). A stall of about 20 s, or a growing lag, means `not-delivered`, and it forces a new session. The stall threshold comes from the configured segment, not the playlist's `targetDuration`. **`EXT-X-ENDLIST` never means ended.** | F-P5-13, F-P5-4, H-P5-1           |
| `HoldClock`        | The hold window per transport, from the descriptor.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | C2, H-P5-1                        |
| `Heartbeat`        | Builds the payload (see _Ask_), and reads the response's `{state, endReason}`; a session that is over means `stopped-by-organiser`. It never blocks or degrades the stream: failures are counted and dropped.                                                                                                                                                                                                                                                                                       | ruling 5                          |
| `SessionRecord`    | Timestamped transitions, fallbacks, reconnects, thermal readings and heartbeat results, as NDJSON. Secrets are scrubbed by **allow-list**: public URLs pass, and `tok`, passphrases and stream keys never do.                                                                                                                                                                                                                                                                                       | AGENTS §11, P5 scrub rule         |

### `platform/`: Android adapters

Each adapter turns an Android fact into a `core` input and holds no rule of its own.

- **StreamPack:**
  - `max-bframes = 0` set explicitly;
  - **`setTargetRotation` never called while streaming** (F-P5-6);
  - encoded orientation fixed at arm from the landscape side held (P4);
  - the version pinned after checking what is newer than 3.2.0.
- **Ktor TLS guard (F-P5-12):** use a fixed Ktor release if one exists. Otherwise, a guard scoped to `io.ktor.network` IOExceptions off the main thread. Either way it is proven by a cut against Cloudflare, not a local listener.
- **`CaptureForegroundService`:** `camera|microphone` types with the matching permissions, started from the foreground, holding a wake lock. The notification reads `LIVE · 3000k · 47 min`. It also posts the heartbeat.
- **Microphone:** `MicSilence` uses `AudioRecordingCallback` / `isClientSilenced`, matched by audio session id, to report `mic-silenced` (F-P5-8).
- **Camera:** camera contention detection, and a reopen on `camera-released` (F-P5-10).
- **`SlateSource`:** while the camera is taken, it encodes a still card with a camera glyph and the Seazn mark, **with no words**, so nothing on air needs a language. The audio is silent while the slate shows.
- **HTTP:** the playlist and heartbeat clients.
- **Battery:** the charge counter plus the charging flag. P5 found the battery percentage unreliable for drain.
- **Thermal:** the thermal status, plus `thermalHeadroom` where the API is 30 or higher (it reads −1 below).
- **Bridge:** an Expo Module that takes intents (`arm`, `start`, `stop`, `reset`, `switchCamera`), returns void, and emits a snapshot at 1 Hz or faster. It also provides the native preview view. Frames never cross the bridge.

## 4. Screens (`app/stream/`, landscape)

### The viewfinder (`index.tsx`)

- **The stage.** A full-bleed native preview, letterboxed at 16:9 and never cropped. Over it, the **overlay WebView** of the Tier A route `/overlay/fixtures/[id]` (the `overlayUrl`), with `delayMs = 0`, inside its own error boundary. A crash shows a caption, never an opaque plate. When the overlay is shed, the caption reads "Preview paused — still live". The operator is told once that they see the score slightly ahead of viewers.
- **The tally column,** in the side gutter and never over the middle third, top to bottom:
  1. **The state plate**, 56 dp and solid: READY (lime), CONNECTING, **LIVE (red)**, TROUBLE (orange), ENDED. It is judged by what reads at 2 m, not by type.
  2. **Elapsed** as H:MM:SS in `tabular-nums`, on air only.
  3. **Health.** An audio meter of 6 segments, tinted orange below the floor. Then the **status line**: one true sentence, drawn from an i18n key. Examples:
     - "Uplink lost — holding, 38 s of 183"
     - "Switched to backup link (RTMPS)"
     - "Viewers not receiving — restarting"
     - "Camera taken by another app — slate on air"
     - "Mic silenced by a call"
  4. **"What viewers see"**: a hold-to-peek that plays the delivered video on air, muted. It shows the moment the finger lands, with no confirmation delay, and stays warm for 30 s after release (AGENTS §6).
  5. **The action**: Go live or Stop, each a 3 s hold with a Reanimated fill.
- **Edge strips.** The top strip carries advisories: heat, and a charging warning. The bottom strip carries the Settings and Diagnostics links. Both are solid, on the stage edge, and are the only things ever drawn over the preview.

### Settings

- Score preview on or off.
- Controls on the left or the right.
- Power advice: "Plug in; about 0.3%/min on a 4.5 W supply".
- Open-source licences. libsrt is MPL-2.0, so this entry is required.

There is no encode row (ruling 3). The LIVE plate sits beside Back.

### Diagnostics

Values are set in Geist Mono.

- **Link:** transport, bitrate, RTT, SRT retransmits and drops, encoded frames per second.
- **Delivery:** delivered lag, and the last playlist check.
- **Device:** data used, battery drain per hour, thermal status.
- **Heartbeat:** when it was last sent, and the result.
- **Session record:** the last 20 lines, and **Share record**, which sends it through the Android share sheet. Only the operator does that; nothing is uploaded on its own.

### Wiring and house rules

- Telemetry goes through `useSyncExternalStore` selectors over the engine port, never Context. HUD components use `React.memo`, with no anonymous render functions.
- All copy is in the 4 locales. `selectStatusLine` is rewritten to return dictionary keys; today it returns hard-coded English.
- New components live in `ui/components`: `TallyPlate`, `HoldAction`, `AudioMeter`, `Elapsed`, `PreflightChips`, `OverlayPreview`, `ViewerPeek`, `LivePlate`, `EdgeStrip`. The spike's components are reference only.
- New dependencies are `react-native-webview` and `expo-video`. For each one, check what autolinks and pin it (failure class 4).

### S0 gaps closed here

- **Keep-awake** while armed or live, proven in a release build.
- **TalkBack** announcing the turn card, checked before Go live sits behind it. If the check fails, fall back to `AccessibilityInfo.announceForAccessibility`.
- **R37:** the lock after a remount mid-broadcast, under a real camera session.
- **Orientation lock:** a refused lock is retried once the logger exists.
- **The engine wins at reopen**, proven against the real foreground service.

## 5. Logging and failure handling

### The logger

`services/logger` is a port with a fake, levelled debug, info, warn and error. There is no `console.log` anywhere (AGENTS §11). While a session exists, JS entries go into the native session record. Otherwise they go to a ring buffer. The same allow-list scrub applies.

### Nothing silent (failure class 3)

Each of these was handled in S0 but recorded nowhere. S1 logs them:

- a refused orientation lock;
- a refused leave or save write;
- a descriptor error;
- a heartbeat failure.

**The key-value port gets a 5 s timeout.** That closes S0's gap where one store write that never settles blocks every later write and the scan flight.

### What the operator sees

Trouble shows in orange, never red: red means only ON AIR.

| Failure                                    | Engine                           | Screen                                                                         |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| Descriptor unreachable at scan             | —                                | Home: "Can't check this code — no connection. Try again."                      |
| 410 at scan                                | —                                | Home: the ended or timed-out message (§1)                                      |
| The organiser stops it while live          | ends `stopped-by-organiser`      | ENDED: "Stopped by the organiser"                                              |
| The warming deadline passes before Go live | —                                | Arm: Go live disabled, "This code timed out — ask the organiser for a new one" |
| The heartbeat keeps failing                | keeps streaming, counts failures | Diagnostics only; the console marks the phone stale                            |
| Delivery stalls                            | forces a new session             | TROUBLE: "Viewers not receiving — restarting"                                  |
| Engine crash, or the native module missing | `ended{fatal-error}`             | ENDED with the reason; the code is kept, for a retry without rescanning        |
| The overlay crashes                        | none                             | A caption on the stage; the HUD is untouched                                   |

## 6. Testing, CI and device checks

AGENTS §10 applies throughout: no snapshot tests, and the four questions answered in every change. No expected value is derived from the code under test; copy comes from the dictionary, and states from this spec's tables.

### Tests

- **Kotlin `core/`.** JVM tests, one per P5 finding, named by ID and written before the code, with a fake clock and scheduler.
- **Domain (TS):**
  - the v2 parser and the descriptor parser: garbled, foreign, expired, a missing `tok`, and both SRT url forms;
  - the choice of status-line key;
  - the warming deadline.
- **UI (react-native-web and the fake).** Each state is rendered, and each test asserts what the operator can see:
  - armed-not-ready, armed-ready, connecting, live;
  - fell-back, holding, not-delivered, camera-taken, mic-silenced;
  - stopped-by-organiser, fatal, shed.
- **The four questions:**
  - a double hold, a second scan and a re-entry;
  - an empty descriptor, a missing native module;
  - a kill while live, then a reopen;
  - all 4 locales, including the longest one on the HUD column.
- **Mutation.** Each guard is mutated once and a test must fail. That covers the LIVE gate, fallback counting, the regulator restart, the warming gate, the leave rule, and the heartbeat never blocking.
- **Orientation.** The three P4 assertions (preview, encoded, metadata) are checked on the device. The 180° flip is deferred.

### CI

| Job                     | Runs                                                                | What it catches                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check` (existing) | every push                                                          | typecheck, lint, Prettier, vitest, the i18n key check                                                                                                                                                  |
| **Kotlin core**         | every push                                                          | every `core/` test; JDK 17 and Gradle, no Android SDK                                                                                                                                                  |
| **Contract drift**      | every push                                                          | `contracts/capture-qr.v2.json`, plus the descriptor and heartbeat schemas the web side publishes beside it, each compared byte for byte with seazn.club main's copy. It uses a read-only token secret. |
| **Android compile**     | PRs touching `modules/`, `app.json`, config plugins or the lockfile | `expo prebuild`, then `./gradlew assembleDebug`, on the runner. This is Gradle, not EAS, so the ruling holds. It catches the platform code, the bridge, the config plugin, and native peer drift.      |

**Detox waits.** On an emulator there is no real camera and no Play services scanner. A Detox run would re-test what the UI tests already cover on the fake, slowly, while the staging device run is the real scan → live proof. The first store-build task revisits this, alongside the release i18n check (S0 R11).

### Device checks: the exit bar

- **Phones:** the OnePlus NE2211 and the Redmi Note 7 Pro. Keep-awake is judged on release builds.
- **The code:** the web's **v2 QR, logo-centred at error correction H (~version 22, ~105 modules)**, scanned from a laptop screen.
- **The run:** arm, then go live on a real stg fixture with the overlay. During the match:
  - pull the uplink → it holds, then resumes;
  - block UDP → it falls back to RTMPS;
  - lock the screen for 5 min or more;
  - open another camera app → the slate goes to air, and the camera reopens on release;
  - take a call → the screen shows the mic silenced;
  - Stop from the organiser's console → the phone ends "Stopped by the organiser".
- **Throughout:** the console's Phone node shows heartbeats.
- **Afterwards:** read the session record back, check the recording, and delete the Cloudflare recording (recordings outlive their inputs).
- **Owner's hands:** turning the phone, holding, scanning and taking the call are listed for the owner, not simulated.
- **Evidence:** screenshots show only the app, with the status bar cropped. No code's raw value is ever photographed.

## 7. Phases

One spec, one implementation plan.

| #   | Phase                                                                                                                                                                                                                               | Needs the web side?                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Domain and ports: the v2 parser, the descriptor parser and `DescriptorPort`, the snapshot shape, the logger, and the fake engine extended to every new state, plus a fake descriptor. `projectEvent` and `transportPolicy` removed. | no                                                       |
| 2   | Screens against the fake: the viewfinder, Settings, Diagnostics, and the Home checking and error states.                                                                                                                            | no                                                       |
| 3   | Native `core/`, test first from P5. The Kotlin core CI job.                                                                                                                                                                         | no                                                       |
| 4   | Native `platform/` and the Expo bridge. It publishes to a raw stg live input, from a hand-made v2 code and a descriptor served locally. The Android compile CI job.                                                                 | partly                                                   |
| 5   | The real descriptor and heartbeat wired in, the contract vendored with its drift job, and the staging real-match run.                                                                                                               | **yes**: the web branch after `feat/fixture-page-stream` |

Phases 1–4 can finish before the web side lands, so phase 5 is the long pole.

## Ask: for the web side (seazn.club)

The web branch cites this section as the source of the shapes. The route paths, auth plumbing and console layout are the web side's to decide. Field names can be negotiated until the schemas are published in `docs/contracts/`, and then they are vendored here.

### capture-qr.v2

```
{ v: 2, sid, slot, cred: { srt: { url, streamId, passphrase, latencyMs }, rtmps: { url, streamKey } },
  preferred: "srt" | "rtmps", exp, tok }
```

- `tok` is a per-session random token. The server stores only its hash.
- Everything else is v1 unchanged, and the SRT fields stay separate.
- Every QR carries the Seazn logo at error correction H.
- The web stops minting v1 the day v2 ships.

### Descriptor

`GET`, with `Authorization: Bearer <tok>`, `Cache-Control: no-store`.

```
{ sid, state: "warming" | "live" | "ending" | "completed" | "failed", endReason?,
  playbackUrl,            // required: the delivery watch depends on it (F-P5-13)
  overlayUrl,             // the Tier A /overlay/fixtures/[id] route, not /relay
  holdWindowSeconds: { srt, rtmps },
  venueTimezone,          // IANA name, through the venue lane
  label,                  // fixture or match label for the HUD
  scoreUpdates: "realtime" | "polled",
  maxDurationMinutes, warmingDeadline, exp,
  heartbeatUrl }
```

`playbackUrl` is the bare Cloudflare HLS manifest of the live input, `https://customer-<code>.cloudflarestream.com/<LIVE_INPUT_UID>/manifest/video.m3u8`, with no query parameters (lane D, 2026-09-30). The phone adds its own parameters:

- `clientBandwidthHint` (in Mbps) on the peek, so it uses little cellular data, and on the delivery watch, so it follows one rendition.
- `protocol=llhls` only if low latency is ever enabled.

Cloudflare's rule is that manifests are dynamic: "Do not cache, proxy, or store manifests". The phone fetches a fresh copy on every poll and every peek.

| Status | Meaning                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| 401    | Bad or missing token                                                                                        |
| 404    | Unknown sid                                                                                                 |
| 410    | The session is over, with `endReason`: `stopped`, `no_inbound_timeout`, `target_rejected` or `max_duration` |
| 429    | Rate-limited, with Retry-After                                                                              |

The phone keeps the descriptor for the session's life and fetches it again on every reconnect.

### Heartbeat

`POST heartbeatUrl`, with `Authorization: Bearer <tok>`, every ~10 s while armed or live, sent from the phone's foreground service.

```
{ sid, at, state, transport: "srt" | "rtmps" | null, bitrateKbps,
  delivery: "ok" | "stalled" | "unknown", deliveredLagS,
  audioOk, battery: { percent, charging, drainPctPerHour },
  thermal, dataUsedMB, appVersion }
```

- The response is `{ state, endReason? }`. A session that is over ends the phone's session as "Stopped by the organiser".
- The console shows the latest heartbeat and its age on the Phone node of the stream panel. It marks the phone stale after about 3 missed beats. Polling or push is the web side's choice.
- **No secrets are sent or logged in either direction.** `tok` is compared in constant time and never echoed.

### Also for the web side

- Publish JSON schemas for all three beside `capture-qr.v1.json`, so the capture CI drift job can compare them.
- The fixture at `fixtures/capture-qr.v1/valid.json` embeds an SRT query string that production never emits (lane D noted this as drift).

## Known gaps and deferred

- **The 3-hour soak and the 180° flip.** Deferred to app completion (owner, 2026-09-29), on this engine.
- **iOS** is M3: HaishinKit, the lock-screen state (P1) and VoiceOver.
- **Detox:** see §6.
- **The translation release check** still runs in no build (S0 R11). The first store build wires it in.
- **Realtime on the phone** is an S3 question.
- **Open P5 mechanisms** the engine works around without explaining:
  - why F-P5-13 happens (questions to Cloudflare are listed in the results);
  - F-P5-6's recovery that never reconnects;
  - whether F-P5-11 causes F-P5-2.

  The session record is how S1's staging run adds evidence to these.

- **Heartbeat cost on cellular** is small (~1 KB per 10 s), but it is not yet measured next to the ~1.41 GB/h of video.
- **Low-latency HLS is off.** The web creates live inputs without it (`createLiveInput`, as of 2026-09-30), so the peek plays standard HLS and runs further behind than the spike's LL-HLS peek. The delivery watch still parses both forms, and detects which one it has from the playlist. Turning LL on is a web-side upgrade: a beta option that would also need its setting read back, and it needs P5's open question "SRT into a low-latency input" measured on staging first. When that happens, the phone adds `protocol=llhls`.
