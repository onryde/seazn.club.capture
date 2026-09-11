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

Two calls worth restating:

- **Go Live is a tap; Stop is hold-to-confirm.** An accidental start costs a
  Machine; an accidental stop costs the match.
- **Go Live enables only when armed** — credentials parsed, camera running,
  audio above a level floor, network reachable. The pre-flight is the safety,
  not a gesture.

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

## 12. Open

- **Does the app show the operator the broadcast is alive?** Pulling a WHEP or
  LL-HLS preview back is the only way they learn the compositor died, but it
  costs battery, bandwidth and thermal headroom on the device least able to
  spare them. Lean: a manual "check output" button, not a persistent monitor.
- **Who decides the fallback happened?** Lean: switch SRT→RTMPS silently,
  report loudly.
- **i18n.** String extraction is cheap on five screens now and painful to
  retrofit across a shipped fleet — same argument as M2's timestamp field. Only
  worth it if Seazn might see a non-English club.
- **Theme provenance.** The palette here is taken from the relay signal path
  document's token block. If that was styling for one document rather than the
  house style, §8 changes.
- **Repo remote.** Local only so far. No GitHub remote created.
