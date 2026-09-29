# Seazn Capture — Design

**Date:** 2026-09-10
**Status:** Pre-implementation. The P5 spike has not run.
**Register:** IDs below (P1–P5, C1–C2, T1–T5, M1–M4, Q3, U1) refer to the
streaming programme's relay signal path register.

---

## 1. Where this app sits

The programme has three tiers sharing one render path. This app serves Tier B:
the phone publishes a **clean** feed — no graphics — to a Cloudflare Stream
live input, and the score overlay is composited downstream by Chromium inside a
Fly Machine.

The consequence that shapes everything here: **the app is never in the graphics
path.** It does not burn a scorebug, it does not hold the score, it does not
know the match state. It is a camera with a network stack and a reconnect loop.

The compositor's "encoder never restarts" property also does not depend on this
app. The slate lives in the compositor's page, so a phone drop is absorbed by
Cloudflare's hold window and the browser's stalled-video handling. This app's
job is to come back inside that window, not to keep the broadcast alive.

## 2. Scope

**Scan** (QR → credentials) → **Arm** (preview, pre-flight) → **Live** (HUD) →
**Settings** → **Diagnostics**.

Explicitly excluded: accounts, login, fixture browsing, scoring, chat, replays,
gallery, upload, in-app payments, remote push.

**There is no auth, and there should never be.** The QR code *is* the
credential. An operator is a volunteer handed a phone at a wet ground; a login
screen there is a product failure. There is no user object and no profile —
there is a session and a slot. This creates a requirement that flows back to
C1: because the QR is the credential, it must be short-lived and scoped to one
session, not a long-lived stream key.

## 3. Architecture

### 3.1 The native/JS line

P2 rules that the publish loop lives in native code. Made structural:

- Native owns capture, encode, connect, publish, reconnect, SRT→RTMPS
  fallback, orientation and capture timestamps.
- JS receives a ~1 Hz state snapshot and sends intents. Commands return void
  and are reconciled against native state — a promise that must resolve
  mid-reconnect deadlocks on a bad cell.
- The video never approaches the bridge. Preview is a native view.

This is also why React Native's performance profile is not a risk to the video
path: nothing on the video path is in JavaScript.

### 3.2 DDD, honestly applied

Two bounded contexts — **Capture** (this app) and **Broadcast** (compositor,
session API, Cloudflare) — with the QR contract as the published language
between them. C1 and C2 are contract negotiations across that boundary, which
is why they freeze before code.

The nuance most RN/DDD work gets wrong: **the aggregate lives in native code.**
The TypeScript `domain/` layer is a *read model* — a projection of native
events — plus the two things it genuinely owns: credential parsing and the
fallback policy it hands down at start. Building a second state machine in TS
produces two authorities that disagree mid-match.

**Ubiquitous language:**

- Aggregate: `CaptureSession` — identity, slot, credentials, hold window,
  encode profile.
- Value objects: `StreamCredentials` (`Srt | Rtmps` sum type),
  `EncodeProfile`, `HoldWindow`, `CaptureTimestamp`, `SlotId`.
- Events: `SessionArmed`, `PublishStarted`, `TransportDegraded`,
  `FellBackToRtmps`, `UplinkLost`, `PublishResumed`, `ThermalCeilingHit`,
  `SessionEnded`.
- **Missing, and needed for M1 (P5, F-P5-13):** a session can be publishing and
  not delivered. The model needs a way to say so: a `DeliveryStalled` event, a
  `not-delivered` degrade reason (or a delivery state beside the transport
  state), and the delivered lag in the snapshot. See §4.1.

### 3.3 Patterns

Four, and no more:

- **Ports and adapters** — `CaptureEnginePort` with three implementations:
  HaishinKit.swift, StreamPack, and a **fake**. The fake is the point: every
  screen, state and failure mode developable on a laptop with no device.
- **Explicit FSM** — illegal transitions unrepresentable in the type, not
  booleans like `isLive && !isReconnecting && hasFallenBack`.
- **Strategy for transport** — SRT primary / RTMPS fallback as a swappable
  policy, so the fallback is configuration rather than a branch buried in a
  reconnect handler.
- **Anti-corruption layer** at the QR parser. The wire shape never reaches the
  domain; a v2 contract touches one file.

Not doing: DI containers, repositories for unpersisted things, CQRS, Redux.

### 3.4 Layering

Enforced by `eslint-plugin-boundaries`, not by convention. `domain/` may not
import `react`, `react-native`, `ui/` or `modules/`. That single rule is the
difference between a clean architecture and a diagram of one — and it is what
makes domain tests run in milliseconds with no RN preset.

Full tree in [AGENTS.md](../../AGENTS.md) §3.

## 4. Transport

SRT primary with a generous buffer (2000 ms — the budget has headroom, since
YouTube's own 15–40 s dominates), RTMPS automatic fallback. SRT buys loss
recovery on a cellular uplink at a wet ground, which is where drops actually
come from. RTMPS exists because some venue wifi and corporate networks drop
UDP, making SRT-only fragile in exactly the places clubs stream from.

Both engines ship SRT (`streampack-srt`, `SRTHaishinKit`), so this is
configuration rather than architecture.

**C1 is load-bearing:** the phone cannot re-scan a QR code when UDP turns out
to be blocked at the ground, so both credential sets must be in hand at scan
time, with a stated preference.

**C2 matters to this app specifically:** the hold window is a behavioural
clause of the front-door contract, and the app needs `holdWindowSeconds` in the
payload to know whether a resume is still the same broadcast or a new one.

**Measured on Android (P5, 2026-09-29, [results](2026-09-11-p5-android-results.md)):**

- The transport choice holds. Reconnects are unaided, 1.4–2.7 s after the
  network returns, on both SRT and RTMPS.
- The fallback is configuration, as designed: a broken SRT address reaches
  RTMPS publishing in 18.8 s. That is mostly three SRT timeouts, so the status
  line must say what "connecting" is doing for those ~19 s.
- The engine must carry four things StreamPack does not do for us:
  - **F-P5-12:** a guard for Ktor's TLS closer, which otherwise crashes the
    process on an RTMPS network cut;
  - **F-P5-11:** `SRTO_MAXBW`;
  - **`max-bframes = 0`**, set explicitly;
  - **a bitrate regulator that resumes at its last target** when the far end
    drops a healthy link.

### 4.1 Delivery is not publishing

The P5 spike's most expensive finding (F-P5-13) is not about the phone.
Cloudflare can do all of the following while the phone's transport and
Cloudflare's own status API both say live:

- accept an ingest session and acknowledge every packet;
- report the input `connected`;
- still not deliver it:
  - after a reconnect;
  - as a lag that grows with no outage, whose backlog is never packaged;
  - or as a receiver that stops acknowledging.

In the 90-minute soak, only 83% of published time reached a recording.

So the engine watches what viewers get. It polls its own delivered playlist
through `playbackUrl`, a few KB of text every couple of seconds and no video.
When delivered media time falls behind wall time, or the head stops for about
20 s, it forces a new session and reports the fact. This is the only on-device
signal for the failure, and it is why `playbackUrl` is required in the QR
payload rather than optional.

## 5. Overlay preview

The operator sees the overlay before and during the stream, rendered from
`/overlay/fixtures/[id]` — the **Tier A browser-source route**, already
transparent because OBS consumes it — in a transparent WebView over the native
preview. The phone becomes a third consumer of the same route the compositor
and OBS use. One render path, still true.

The prohibition matters more than the feature: **never reimplement the scorebug
in React Native.** That creates a second render path, it drifts, and it
destroys the invariant that a club moving between tiers sees identical output.

Two honest limits to surface in the UI rather than let someone file as a bug:

- The phone runs `delayMs = 0` because its picture is local and instant, so the
  operator sees the score slightly *ahead* of where viewers see it. Same
  situation as Tier A, harmless.
- Per Q3, a club on `streaming.overlay` without `realtime` polls at fifteen
  seconds. On the phone that reads as a frozen overlay, with no compositor in
  between to mask it.

**This changes the P5 spike:** thermals must be measured with the overlay
WebView active, not with the encoder alone. Measuring the encoder alone gives a
number the shipping app never experiences.

## 6. Degradation ladder

Fixed order, never reordered:

1. Overlay preview sheds first — visible "preview paused — still live" state
2. Then preview framerate
3. The encode is last, and ideally never

The operator's convenience is the cheapest thing on the device. The broadcast
is the only thing that matters.

## 7. Lifecycle

**Android** keeps publishing behind a foreground service with `camera` and
`microphone` foregroundServiceType. The persistent notification is free real
estate for live status.

**iOS** stops the camera in the background — no background mode grants it. Over
three hours the phone will lock, take a call, or get switched away from. So P1
means the slate-and-resume choreography is a **normal operating mode on iOS**,
not an edge case. The app disables the idle timer, warns the operator at start,
surfaces every interruption as a visible state, and treats fast silent resume
as a headline feature.

**Development order:** Android first for feature work — it is the platform
where the happy path completes end to end. iOS first for lifecycle work, or you
will ship a reconnect path never exercised on the platform that exercises it
constantly.

## 8. Theme and UX

Dark-only, no light mode. It is a viewfinder used outdoors; a light UI on a
tripod in daylight is a mirror. Palette and type in [AGENTS.md](../../AGENTS.md)
§5, ported from the programme's existing tokens with `signal` carrying LIVE —
the same rust that marks the unbroken RTMPS lane in the programme's own
diagrams.

Three calls worth restating:

- **Go Live and Stop are both 3-second holds** — decided 2026-09-11 by the
  product owner at 5 s and shortened to 3 s on 2026-09-12, superseding this document's original "Go Live is a tap; Stop is
  hold-to-confirm". That split guarded only the expensive mistake, on the
  assumption that the cheap one was a deliberate decision. At a ground it is
  not: it is a mis-tap from a pocket, a tripod pan bar or a hand steadying the
  phone, and starting a broadcast by accident is not cheap either — it is a
  Machine minute and a stream the club did not mean to publish. A three-second
  hold under a progress fill cannot be produced by accident in either direction,
  and it costs the operator three seconds once a match. Both controls use the
  same duration so the gesture is never relearned mid-match. The preview control
  is held too but is *not* a confirmation — it answers instantly and the hold
  exists only to stop a billed preview running unattended.
- **Go Live enables only when armed** — credentials parsed, camera running,
  audio above a level floor, network reachable. The pre-flight is the safety,
  not a gesture.
- **Settings and Diagnostics are reachable while live** — decided 2026-09-11,
  replacing the original "configuration is unavailable on air". Diagnostics is
  written for a broadcast in progress, so the state that hid it was the state it
  was for. Both screens show a LIVE plate beside the way back, and the guard
  moves down to the control that needs it: a setting that would disturb a live
  broadcast is disabled while live with a one-line reason, the encode profile
  being the first such setting.

## 9. Testing

Domain tests are the backbone — pure, sub-second, every push. The fake engine
gets built first so every state renders on a laptop. No snapshot tests; instead
render each state through the fake and assert what the operator can see.

Assert an audio **level floor**, not stream presence — T1's mistake is just as
easy to make here, and there are two lossy generations downstream with no
normalisation anywhere.

Orientation gets three independent assertions (preview, encoded, metadata) —
P4 says they fail separately.

Detox covers scan→arm→live. Three-hour thermals, backgrounding and uplink loss
are the device matrix, not Detox.

## 10. Findings

Findings raised while scoping this app — N1 to N8, plus the inherited register
items that bind here — live in [`_FINDINGS.md`](../../_FINDINGS.md).

Four of them constrain artefacts open right now and should not wait: **N1**
(the front door accepts an encode profile the compositor is not sized for),
**N2** (C1 fixes credential shape but not lifetime), **N4** (the P5 spike as
specified measures a load the shipping app never runs), and **N8** (phone and
hardware contributors want opposite credential lifetimes).

The P5 Android spike added F-P5-1 to F-P5-13 and H-P5-1, indexed in the same
file and argued in [the results](2026-09-11-p5-android-results.md). Its Verdict
section lists the ten things the Android engine must inherit.

## 11. Build order

1. **EAS Build and a signed build on a real handset.** Not a step-nine nicety —
   a prerequisite for the spike that gates everything below.
2. **The P5 spike.** StreamPack on a real Android handset, HaishinKit.swift on
   a real iPhone, landscape, three hours into a real Cloudflare input, screen
   locking part-way, overlay WebView active, thermals logged. Settles P1, P3
   and P4 together. Throwaway code, deleted after.
3. **Freeze C1, C2 and M3** in the main repo. The app's dependency is not "an
   API that needs building" but "a contract mid-revision".
4. **The fake engine**, then the domain, then the UI against the fake.
5. **The real engine** — Android first.
6. **iOS lifecycle**, which is where the hard work is.

**Status, 2026-09-29:**

| Step | Status |
|---|---|
| 1 | Done, built locally with Gradle and adb rather than EAS. `eas.json`'s `soak` profile still extends `development`, which needs Metro; fix it before any EAS soak build. |
| 2 | **Android done**: the architecture holds, and F-P5-13 is the open risk. The iOS half (HaishinKit.swift on an iPhone) is deferred until the Apple Developer decision (N14). A full 3 h soak and the 180° flip test are deferred until near app completion, on the real engine. |
| 3 | **Not done.** `contracts/` has no `capture-qr.v1.json`. This is R1's work, and it gates step 5. |
| 4 | Done: `FakeCaptureEngine`, the domain, and the screens. Scan, Viewfinder (Arm + Live), Settings and Diagnostics run against the fake. |
| 5 | Next (M1). Extend the fake with the not-delivered state first (§3.2, §4.1). |
| 6 | Later (M3). |

## 12. Open

- ~~**Does the app show the operator the broadcast is alive?**~~ **Settled by
  P5.** There are two tiers:
  - a **persistent playlist watch**, text only and cheap, that owns reconnect
    (§4.1);
  - the **manual video peek**, kept as an operator convenience.

  The earlier lean (manual button only) assumed a pull-back costs video
  bandwidth. It does not, and the spike showed delivery can fail while
  everything else says live.
- ~~**Who decides the fallback happened?**~~ **Settled by P5.** Native decides
  and switches silently, and the report is loud. Run C measured 18.8 s from
  SRT failure to RTMPS publishing.
- **i18n.** String extraction is cheap on five screens now and painful to
  retrofit across a shipped fleet — same argument as M2's timestamp field. Only
  worth it if Seazn might see a non-English club.
- **Theme provenance.** The palette here is taken from the relay signal path
  document's token block. If that was styling for one document rather than the
  house style, §8 changes.
- ~~**Repo remote.**~~ `onryde/seazn.club.capture` on GitHub.
- **Questions for Cloudflare** (from P5):
  - Does a `connected` live input guarantee packaging?
  - Is a growing packager lag with acknowledged ingest a known failure?
  - Is there a signal for it that we can read?
