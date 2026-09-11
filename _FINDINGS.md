# Findings — Seazn Capture

Findings raised while scoping the capture app, plus the inherited register
items that bind this repo. Each is a recommendation, not a ruling.

New items use an `N` prefix to avoid colliding with the main register's
D/T/U/C/P/M series. Where an item belongs in the main register, its suggested
home is named.

---

## Contract

### N1 — The front door accepts an encode profile the compositor is not sized for

**Status:** decide before a hardware contributor reaches production
**Where:** session contract · Machine sizing · suggested home: next to M1

720p30 at 3000k is a *phone* ceiling, chosen for thermals. Cloudflare's live
input accepts SRT or RTMPS from anything, so a club with an HDMI camcorder and
a hardware encoder — ATEM Mini Pro, Teradek, Kiloview, LiveU Solo — will
happily send 1080p50 at 6000k. For cricket, 50 fps on a ball in flight is a
genuine quality argument, so they will want to.

But M1 notes R0 sized the Machine for one software-decoded 720p WebRTC stream
under SwiftShader. A better contributor can starve the compositor that is
supposed to be improving its picture, and the failure mode is degraded output
for the club that spent the most on kit.

Either constrain the contributor profile in the session contract and document
it, or make Machine sizing profile-aware. Silently accepting whatever arrives
is not an option.

### N2 — C1 fixes the credential *shape* but not its *lifetime*

**Status:** fold into C1 while the contract is open
**Where:** `capture-qr.v1.json` · §7.6 · suggested home: alongside C1

The capture app has no auth by design — the QR code *is* the credential. That
is the right product call: an operator is a volunteer handed a phone at a wet
ground, and a login screen there is a product failure.

It also means the QR carries everything needed to publish to a live input. C1
is currently a conversation about carrying two credential *shapes*; it says
nothing about scope or expiry. A long-lived stream key in a QR code
photographed by anyone standing near the scorer's table is a different risk
from a session-scoped credential that expires.

Add lifetime and scope to the contract while it is already being reopened.

---

## Test gaps

### N3 — Nothing asserts an audio level floor for hardware contributors

**Status:** open · no owner
**Where:** session page · suggested home: alongside T1

The capture app gates Go Live on audio above a level floor, which catches a
dead or muted mic before a match rather than after it. A hardware contributor
bypasses the app entirely, so that gate does not exist for them.

D1, D2 and T1 are already a cluster about shipping silence from downstream
causes. This is the same outcome from an upstream cause and it is currently
uncaught on the path most likely to have good audio hardware and a
mis-set gain.

### N4 — P5 as specified measures a load the shipping app never runs

**Status:** amend before the spike runs
**Where:** P5 spike scope

The spike measures three hours of encode plus radio. The shipping app also
renders the overlay in a transparent WebView repainting over a live camera
preview for the same three hours.

A thermal number taken without the WebView is a number no operator will ever
experience. Run the spike with the overlay active, or the degradation ladder is
tuned against fiction.

---

## Unverified

### N5 — Reconnect behaviour on hardware contributors is the vendor's, not ours

**Status:** unverified · document per device
**Where:** contributor matrix · sharpens T5

The app's reconnect loop is code we control and can prove. A Teradek's is not,
and quality varies widely across the class. C2's hold window still absorbs a
drop, but resume-in-window cannot be promised the way it can for our own
binding.

Two consequences. Per-device reconnect behaviour needs recording rather than
assuming. And because plenty of cheap encoders are RTMP-only, the RTMPS leg
that T5 flags as unproven in the soak is not a fallback for that class of club —
it is the only path they ever use. T5 moves from "add a fallback run" to
"untested primary behaviour for real customers."

---

## Operational

### N6 — An OTA update can take a match off air

**Status:** mitigated by design · do not relax the rule
**Where:** Expo Updates config · AGENTS.md §11

Expo Updates is worth having, and its blast radius is genuinely small because
OTA cannot touch the native engine. But a phone applying an update at 2pm on a
Saturday is a self-inflicted outage, and the default configurations invite it.

Check on launch only, and refuse to apply while a session is armed or live.
Recorded here so the rule is not quietly relaxed later for a faster hotfix
cycle — the hotfix is never worth the match.

---

## Product

### N7 — The tier model has no name for camcorder plus hardware encoder

**Status:** product call
**Where:** tier definitions · session page

A club with an HDMI camcorder and a hardware encoder publishing straight to the
live input gets **Tier B composited with a proper camera**: optical zoom, a real
lens, a tripod head, XLR audio — *and* the score overlay, without anyone
learning OBS.

The tier model frames Tier A as the better production for a club with kit, but
that assumes OBS competence. A club with a camcorder and nobody who can run a
scene collection is a common case, and Tier B serves them better than Tier A
does. Today this works by accident rather than by design, so nobody sells it.

It needs the session page to render credentials for a device that cannot scan a
QR code — and "show a copyable string" is not sufficient:

- **Encoders decompose the credential differently.** RTMP boxes want two fields
  (Server URL, Stream Key). SRT boxes usually want five or six — host, port,
  mode, stream ID, passphrase, latency. Some accept a whole `srt://` URL, many
  do not. Show the assembled URL *and* each field individually copyable.
- **The networks do not overlap.** Many encoders serve their config UI from
  their own wifi AP, so the browser showing the Seazn page and the browser
  talking to the encoder cannot be the same session. Copy-paste between tabs
  is not available on the flow most likely to be used at a ground.
- **Transcription is the realistic failure.** An SRT URL with a passphrase and
  a query string, read off a phone screen onto a laptop, in the rain, once per
  fixture.

Cheap mitigations regardless of how N8 is decided: let clubs fetch credentials
days in advance rather than only at the ground; a "send these to me" action so
the values reach a second device before the first joins the encoder's AP; and a
printable card, because someone will tape it inside the flight case.

Device note reinforcing N5: the ATEM Mini Pro is RTMP-only. For that class the
RTMPS leg is not a fallback at all.

### N8 — Phone and hardware contributors want opposite credential lifetimes

**Status:** decide deliberately · conflicts with N2
**Where:** session model · `capture-qr.v1.json` · Cloudflare live input lifecycle

Cloudflare live inputs are persistent objects — the key does not rotate per
broadcast. That makes a second credential model available and, for hardware,
much better:

- **Phone:** a per-session, scoped, short-lived credential delivered by QR. The
  phone is handed to a different volunteer every week, so scope and expiry are
  the right defaults, and the QR flow already makes them free.
- **Hardware:** a **permanent live input configured into the encoder once**, at
  home, on the club's own wifi. Seazn spins up a Machine per fixture against
  the same input. The club never touches credentials at a ground again, which
  removes every failure in N7 at once.

This directly conflicts with N2, which wants credentials short-lived precisely
because the QR *is* the credential. The resolution is that the two contributor
classes have genuinely different threat models: a QR photographed at the
scorer's table is a different exposure from a key inside a device in a locked
kit cupboard.

Both models are defensible. Holding one model for both contributor classes is
not — it either makes the hardware flow miserable or the phone flow unsafe.

### N9 — Live webhooks can cut the slate to sub-second, but must never become the authority

**Status:** available now · adopt as a layer
**Where:** `stream-live/webhooks` · §7.4 slate choreography · relates to U1 and N1

Cloudflare Stream Live sends `live_input.connected`, `live_input.disconnected`
and `live_input.errored`, carrying `input_id`, `event_type`, `updated_at`, `ts`,
and on errors `error.code`, `error.message`, `video_codec` and `audio_codec`.
(Note the page usually found first — `manage-video-library/using-webhooks` — is
VOD-only and explicitly says live differs.)

Three consequences:

- **The slate can fire immediately.** Today it waits for the video element to
  go `stalled` at eight seconds. A disconnect webhook reaching the relay page
  over the Supabase realtime channel that already carries scores would mask a
  drop almost instantly, on a transport that already exists.
- **U1 is de-risked but not closed.** Webhooks describe the *input*, not the
  playback pull, so they still do not say whether WHEP starves or closes. The
  ten-minute experiment stands. What changes is that the slate no longer has to
  *infer* a disconnect, which was the risky part of U1's fallout.
- **N1 gains partial coverage.** `live_input.errored` names hard ingest
  failures with the offending codecs. It does not touch N1's actual concern —
  1080p50 at 6000k is valid to Cloudflare and errors nothing while still
  starving the Machine. `ERR_GOP_OUT_OF_RANGE` does establish that contributor
  GOP is constrained, which both the phone encode settings and the hardware
  contributor profile must respect.

**The rule:** the docs state no delivery or timing guarantees, so webhooks are
an optimisation layer only. Frame starvation remains the backstop. Replacing
the robust mechanism with the fast one turns a visible failure into a silent
one.

### N10 — Creator ID is the missing management story for per-club live inputs; the Workers binding is not

**Status:** adopt creator ID · rule out bindings
**Where:** live input provisioning · supports N8 and M3

`DefaultCreator` can be set per live input, and recordings inherit it. Treating
each club as a creator makes a fleet of persistent per-club inputs filterable
and attributable rather than a soup of UUIDs, and yields per-club analytics
without extra work. That is precisely the management layer N8's
"configure the encoder once, forever" model needs, and M3's slot concept can
hang off the same field. Filtering by creator is API-only.

The Workers Stream binding is a dead end here: it explicitly does not support
live input operations and cannot manage webhooks. Creating inputs, reading
them, setting `DefaultCreator` and subscribing webhooks are all REST-with-a-token.
Recorded so nobody plans a Worker-with-binding provisioning path for credential
hygiene and discovers this late.

### N11 — WHIP publishing is architecturally incompatible; two side effects matter more

**Status:** WHIP ruled out · two items need action
**Where:** `stream/webrtc-beta` · §7.2 input path · tier cost model

WHIP publishing from the phone was worth checking and is a dead end. WebRTC
inputs **cannot simulcast to RTMP/SRT, cannot be recorded, and cannot play back
over HLS/DASH**. That removes the passthrough tier — which *is* an RTMPS
simulcast with no Machine — leaves no path to YouTube except through the
compositor, and gives clubs no recording.

Contribution quality is also worse, not better: WHIP broadcast requires VP8,
VP9, or H.264 **Constrained Baseline Level 3.1** — no B-frames, no CABAC, and a
practical ceiling near 720p30. And WebRTC congestion control sheds quality to
protect latency, which is the wrong trade when YouTube's 15–40 s already
dominates the budget and the camera is on a tripod. SRT spending that budget on
retransmission is strictly better. This is the protocol section's own reasoning
at its strongest.

Two side effects worth more than the original question:

- **Billing — resolved, and there is no lever here.** The pricing page bills
  delivery at $1 per 1,000 minutes uniformly, states on-demand and live are
  billed the same way, and explicitly lists "WebRTC (WHEP) playback" alongside
  HLS and DASH manifests as counting toward delivery. Ingress and encoding are
  always free. So 15 October introduces no new rate — it ends the beta
  exemption on WebRTC delivery. After that date the WHEP pull costs exactly
  what an LL-HLS pull costs: about $0.18 per three-hour match. Switching
  protocol saves nothing. Note passthrough pays $0 delivery, because Cloudflare
  simulcasts server-side with no pull at all, so the composited/passthrough gap
  widens by that $0.18 plus the Machine.
- **§7.2's WHEP-from-an-SRT-input assumption is RESOLVED — and it is wrong.**
  Confirmed 2026-09-11: Cloudflare Stream does not support WHEP playback from an
  SRT (or RTMPS) input. **WHEP requires a matching WHIP ingest.** The composited
  tier must therefore pull **LL-HLS**, not WHEP, and §7.2's signal path is wrong
  as written.

  Cost: roughly six seconds of picture latency instead of sub-second — invisible
  to viewers, since YouTube adds 15–40 anyway, and `delayMs` already holds the
  score against whatever the number is.

  Benefit: **D3 becomes unreachable.** D3 is a defect entirely about the
  WHEP→LL-HLS transition — a 0.5 s→6 s step the ramp cannot cross, giving five
  and a half minutes of score running ahead of play at exactly the moment the
  transport degrades. With no WHEP there is no transition, so the discontinuity
  cannot occur and D3's "snap, then resume EWMA" fix becomes unnecessary code.
  `delayMs` now holds against a roughly constant latency; the EWMA still earns
  its place for drift.

  Also settled: the 15 October WebRTC delivery billing date is irrelevant to the
  compositor, because the pull is no longer WebRTC. Standard delivery is billed
  at the same $1 per 1,000 minutes either way, so cost is unchanged.

  See **N15** for the consequence this creates.

### N12 — Larix Broadcaster is most of this app, already built and free

**Status:** REJECTED 2026-09-10 — recorded for the reasoning, not the outcome
**Where:** `softvelum.com/larix` · R3 scope · affects P1–P5

Larix Broadcaster is a free iOS and Android app publishing SRT (push, listen,
rendezvous) and RTMPS. It handles landscape with live rotation, AAC with input
gain control, and pause/standby without disconnecting. **Larix Grove
distributes connection and encoder settings via deep links and QR codes** —
the credential handoff this repo was scoped to design from scratch.

It supplies the expensive, risky half: the native transport binding. P5 exists
to de-risk HaishinKit and StreamPack; not binding them removes most of P5's
reason to exist, and P3's unmeasured thermal curve becomes a solved problem
belonging to someone with a device matrix far larger than ours. P4's
orientation trap likewise.

It does not supply the product layer: the overlay preview over the viewfinder,
the armed/pre-flight gate that catches a dead mic before a match rather than
after, a guided five-screen flow instead of a professional tool's settings
tree, telemetry back to Seazn, M2's capture timestamps, and the iOS
backgrounding experience P1 makes routine.

### Decision — rejected, 2026-09-10

No third-party app in the product. Open-source libraries integrated into our
own React Native shell are acceptable; a proprietary app is not, and Larix
Broadcaster is proprietary (its SDK is commercially licensed).

This does not change the plan — HaishinKit.swift and StreamPack *are* the
open-source-integrated route, and AGENTS.md and the design spec already
specify it. What the rejection does is put **P3, P4 and P5 back on the books as
live risks** that are now ours to measure. P5 moves from "useful" to
load-bearing, and its position first in the build order matters more than when
it was written.

**Consequence — licence obligations.** HaishinKit.swift is BSD-3-Clause and
StreamPack is Apache-2.0 (confirm both at integration), and both pull libsrt
under MPL-2.0. That obliges an attribution screen — a licences entry under
Settings, which already exists in scope. One standing rule: **use libsrt as a
dependency, never fork it.** MPL-2.0 is file-level copyleft, so modifying its
files obliges publishing those changes.

**Still open, and separable from the decision:** running Larix on a test
handset during the P5 soak is a measurement baseline, not a product
dependency — it gives the binding's thermal curve and reconnect behaviour a
mature reference to be compared against, and ships nothing. Costs one app
install on a test device.

### N13 — TypeScript 7 is ahead of the lint ecosystem; the repo is pinned to 6.0.x

**Status:** decided 2026-09-10 · revisit when typescript-eslint ships TS 7 support
**Where:** `package.json` · `tsconfig.json` · `eslint.config.mjs`

TypeScript 7.0.2 is GA and compiles this project cleanly. It is nonetheless
**not** what the repo uses, because `@typescript-eslint/parser` contains an
explicit runtime block:

```
Error: typescript-eslint does not support TS 7.0.
```

That is a hard check, not a conservative peer range. `typescript-eslint@latest`
is 8.70.0 with peer `typescript >=4.8.4 <6.1.0`, there is no `next` tag, and
tracking for TS ≥7.1 is open upstream (typescript-eslint issue #10940).
`eslint-config-expo` depends on the same packages, so the whole ESLint path is
blocked. An npm `overrides` workaround to give the parser a nested TS 6 does
not resolve — npm does not honour the `npm:` alias protocol there.

Two escape routes exist and both were rejected:

- **Biome or oxlint** carry their own TypeScript parser and never touch the
  `typescript` package, so TS 7 is a non-issue for them. Cost:
  `eslint-plugin-boundaries`, which is the right tool for the domain purity
  rule and has no equivalent.
- **Side-by-side TS 6 for the linter only** leaves two TypeScripts in the tree
  and a package.json nobody can read.

**Decision: pin `typescript@~6.0.3` and keep ESLint plus
`eslint-plugin-boundaries`.** The layering rule is worth more than the compiler
version, and Expo itself already peers `typescript@^7.0.0`, so nothing else in
the stack is holding us back.

Two notes for whoever revisits this:

- TypeScript 7 **removed `baseUrl`** and requires `paths` entries to be
  relative (`"./src/domain/*"`). `tsconfig.json` is already written that way, so
  it is forward-compatible — the upgrade is a one-line dependency bump plus a
  lint-stack decision, nothing more.
- `eslint-plugin-import` does not support ESLint 10 (peer tops out at `^9`) and
  is not installed. `eslint-import-resolver-typescript` is, and is required —
  without it `@/domain/...` reads as an external package and every cross-layer
  import is denied.

### N14 — iOS device testing costs $99/year before P5 can run there

**Status:** open · gates the iOS half of P5
**Where:** EAS Build · Apple Developer Program · sequencing

Once `capture-engine` contains real Swift and Kotlin, Expo Go can no longer run
the app — it only loads the native modules Expo ships. Every device test needs
a **development build**, which means EAS Build (this machine has no Xcode and no
Android SDK) or a local toolchain.

The asymmetry matters for sequencing:

- **Android is free and immediate.** EAS builds an APK, sideload it, done. No
  account, no fee, no gate.
- **iOS requires Apple signing.** The free path — a personal Apple ID with
  7-day provisioning — needs Xcode installed locally. Without it, putting an
  app on a physical iPhone effectively requires an **Apple Developer Program
  membership at $99/year**. There is no way around this for a three-hour soak
  on a real handset.

This sharpens AGENTS.md §9's "Android first for feature work" from a preference
into a cost fact, and it means the P5 spike naturally splits: the Android half
can run this week for nothing, the iOS half waits on a purchase decision.

Do not let that split become permanent. P1 — iOS dropping the camera when
backgrounded — is the single largest unknown in the app, and it is measurable
only on real iOS hardware.

### N15 — Losing WHEP deletes multi-camera's only stated sync mechanism

**Status:** open · invalidates the M2 mechanism · consequence of N11
**Where:** multi-camera wave · M1 · M2 · suggested home: rewrite M2

The multi-camera design names a specific knob for aligning sources:
`RTCRtpReceiver.jitterBufferTarget` (Chrome's `playoutDelayHint`), used to raise
each receiver's target playout delay so every camera presents at one common
wall-clock time.

**That is a WebRTC-only API.** With the compositor pulling LL-HLS (N11) there is
no `RTCRtpReceiver`, no per-receiver playout delay, and no HLS equivalent. The
mechanism M2 depends on does not exist on the path we are actually on.

What remains, none of it as clean:

- Buffer each source in the page against its NTP capture timestamp and present
  on a common clock. Doable but this is writing a small sync engine, not setting
  a property.
- Offset HLS playback positions per source. Coarse, and seeking live HLS is
  awkward.
- Accept unaligned sources and never cut mid-delivery — the fallback M2 already
  names, now the default rather than the degraded case.

This does not change M2's *requirement* (each phone reports an NTP-synced
capture timestamp, cheap now and a fleet migration later) but it substantially
raises the cost of consuming it. M2 should be rewritten before the multi-cam
wave is estimated, and M4's question — whether multi-camera belongs to Tier A
with OBS at all — gets materially stronger as a result.

One likely improvement in the same change: **M1's bench premise is now wrong in
our favour.** R0 sized the Machine for "one software-decoded 720p WebRTC stream
under SwiftShader". LL-HLS playback has no WebRTC stack, no jitter buffer and
no ICE negotiation, so the guest may be cheaper than sized. Re-bench before
assuming either way, but expect headroom rather than a shortfall.

### N16 — The QR contract cannot describe the fixture, only the transport

**Status:** open · blocks §7 · fold into C1/C2 while the contract is open
**Where:** `capture-qr.v1.json` · `SessionCredentials` · §7 overlay preview

Designing the overlay preview surfaced three gaps. `SessionCredentials` carries
`slotId`, both transports and `holdWindowSeconds` — everything needed to
*publish*, and nothing needed to *show the operator what they are publishing*.

1. **No fixture identity or overlay URL.** The preview renders the Tier A route
   `/overlay/fixtures/[id]`, and the payload has no id and no base URL. The
   feature is unbuildable until the QR carries one. An explicit `overlayUrl` is
   preferable to an id plus a client-side base: the front-door port already
   keeps endpoints opaque (C2), and the same reasoning applies here — a route
   change should not require redeploying phones.

2. **No score-update entitlement.** Q3 notes that a club holding
   `streaming.overlay` without `realtime` polls at fifteen seconds. On the
   compositor that is masked; on the phone it reads as a frozen overlay, and
   the app cannot warn the operator because it cannot know. Needs something
   like `scoreUpdates: 'realtime' | 'polled'`.

3. **No playback URL.** Holding the peek while live should show the *composited
   output* — the only signal that tells an operator the Fly Machine is alive
   and the score is flowing, which a local overlay cannot. That needs the live
   input's LL-HLS playback URL (WHEP is unavailable per N11). Peeking costs
   delivery billing, so it must stay press-and-hold: a ten-second look is
   negligible, a persistent monitor would roughly double the compositor's own
   per-session delivery cost.

4. **Consequence for the contract's shape.** These additions mean the QR is a
   *session descriptor*, not a credential bundle. That bears directly on N8: if
   hardware contributors get a permanent live input configured once, they get
   no session descriptor at all — so whatever the phone learns from the QR, the
   session page must render for hardware some other way, or hardware clubs
   simply have no overlay-framing story.

The domain model has been written to the shape these imply — `overlayUrl` and
`scoreUpdates` are required fields on `SessionCredentials` — so that when the
contract lands, the compiler finds every consumer. If the contract lands
without them, the preview is cut, not patched.

### N17 — Commentary must originate at the ground, and it points at Tier A again

**Status:** open · product decision
**Where:** audio path · capture app scope · relates to M4

The tempting place for commentary is the compositor: the Fly Machine already
decodes audio to PCM into a PulseAudio null sink and re-encodes it, so that
sink *is* a mixer. A remote commentator's voice dropped in would be blended
before the single encode, on the one system clock.

**It does not work, because of latency direction.** Pitch audio reaches the
Machine roughly six seconds after capture (LL-HLS, N11). A remote commentator
watching the stream is further behind still, so their voice arrives *after* the
frame it describes has been encoded and sent. Fixing it means buffering the
programme video to wait for them — adding latency to every viewer to serve one
commentator. Technically possible (YouTube's own 15–40 s would mask it) but a
real change to the compositor and a new sync mechanism to get wrong.

Commentary at the camera has no sync problem: the voice is captured in the same
instant as the picture. That is why broadcast does commentary at the venue, or
with a return feed and timing discipline.

**What it costs this app:**

- **An audio input picker in Settings.** Small, in scope, does not exist.
- **Bluetooth must be warned against.** 100–300 ms of latency and a lossy codec
  ahead of the two lossy generations already downstream. Wired USB-C, or a
  2.4 GHz receiver into USB-C. A club that buys a Bluetooth lav mic gets audio
  that never lines up and no way to diagnose it.
- **The phone cannot realistically mix.** HaishinKit and StreamPack both let you
  *select* an audio source; neither offers a two-source balance, and iOS
  multi-route input is fragile. So it is commentary OR ambience. Asking a
  volunteer to balance a mix on a phone at a wet ground is a product failure,
  and the app must not grow a mixer.

**The uncomfortable part.** OBS has a real audio mixer: a Tier A club plugs in a
mic, balances it against the camera, and it works today for nothing. That is
M4's argument — multi-camera may belong to Tier A — extended to audio, and it is
now **two** features pointing the same way. Worth deciding deliberately that the
phone tier is *single operator, single source, no production* by design, rather
than discovering it one feature at a time.

Also sharpens **N3**: nothing checks audio level before a match, which is worse
when the audio is a commentator who may simply be muted.

### N18 — Muting the phone's audio is a fourth way to ship silence

**Status:** open · design constraints settled, control placement is not
**Where:** capture app · audio path · relates to D1, D2, T1, N3

There are legitimate reasons to mute: copyright music over the PA, crowd audio
that cannot be broadcast, a dead mic, or commentary being added elsewhere. It is
technically easy — both engines can publish with the audio source muted.

The risk is that D1, D2 and T1 already track three ways this programme ships a
silent broadcast by accident. A deliberate mute adds a fourth, and unlike the
others it will look correct to every check.

Three constraints, all settled:

1. **Publish a silent track; never omit the track.** A video-only SRT input is
   an untested path into Cloudflare and the compositor, and `live_input.errored`
   has codec-shaped failure modes. Mute the source, not the stream.
2. **It must be impossible to forget.** An operator mutes for one over and
   broadcasts three silent hours. The audio meter must read **MUTED**
   explicitly rather than merely showing no level — otherwise it is
   indistinguishable from the dead-mic case the meter exists to catch — and the
   status line must say it while live.
3. **It must not persist.** Mute is a per-match decision, so a new `arm` resets
   it. That also means it does **not** belong in Settings, where everything else
   is deliberately remembered. A sticky mute is how a club loses a match.

It also forces the armed gate to grow a second reason: mute must deliberately
bypass the audio floor, or the app could never go live muted at all.

**Open:** where the control lives. Suggested — long-press the audio meter, so
the control is the indicator, with the meter and status line both shouting while
it is on. That is poor discoverability for a volunteer, which is arguably
correct for something this dangerous, but it is a product call.

### N19 — Pause is free in the compositor and needs a channel the phone does not have

**Status:** open · mechanism settled, ownership is a product call
**Where:** compositor slate · session API · capture app scope · relates to D1, N18

Stopping publication and letting Cloudflare hold the input is not a pause: it
consumes the hold window (~60 s), so anything longer ends the broadcast. A tea
interval is twenty minutes.

The version that works costs nothing new. **The phone keeps publishing; the
overlay page covers the video element and mutes it.** The live input never times
out, the encoder never restarts, YouTube sees unbroken video and audio, and the
pause lasts as long as wanted. It rides the Supabase realtime channel the score
already uses — sub-second, no new transport, the same argument the design makes
for camera cuts.

Both halves of the mechanism already exist, built for the drop case: the slate,
and the null sink that keeps emitting silence so the muxer never starves. Note
the irony — **D1 (the `muted` attribute silencing the broadcast) is a defect
when accidental and exactly the mechanism wanted deliberately.**

Two things are not free:

1. **The capture app has no outbound channel.** It publishes media and reads a
   QR; it can tell the server nothing. A pause control needs a session-API
   call, and `services/` does not exist yet. This is the first concrete reason
   to build it.
2. **Who owns the control.** The scorer's console is already on realtime with a
   human watching a screen, and it covers the planned case (intervals). The
   camera operator's hands are on a tripod. But the cases where the *operator*
   needs it are exactly those where they cannot reach a laptop — an injury, a
   crowd incident, something that should not be broadcast. So the phone
   probably needs it as an **emergency stop-picture, not a production tool.**

If the phone gets it, three constraints carry over from N18: unmistakable while
active, hard to leave on, and impossible to confuse with Stop, which *ends* the
broadcast. Suggested control shape, inverting the Go-live/Stop asymmetry:
**hold to enter, tap to resume** — hard to trigger, trivial to undo.

---

## Inherited

Register items that bind this repo. Full text lives in the main register.

| ID | Binds here as |
|---|---|
| **P1** | iOS drops the camera when backgrounded. Slate-and-resume is a normal operating mode, not an edge case — it shapes the whole lifecycle design. |
| **P2** | Native owns the publish loop. The architectural rule the rest of the app hangs off. |
| **P3** | Thermal and battery behaviour unmeasured. Drives the degradation ladder, which is currently tuned against a guess. |
| **P4** | Landscape is the only orientation that matters, and preview / encoded / metadata orientation fail independently. Three assertions, not one. |
| **P5** | The device spike gates the architecture. Amended by N4. |
| **C1** | Both credential sets in hand at scan time. Extended by N2. |
| **C2** | `holdWindowSeconds` must reach the app — it decides whether a resume is the same broadcast or a new one. |
| **M2** | Report an NTP-synced capture timestamp from day one, even single-camera. A field and a clock read now; a fleet migration later. |
| **M3** | Add the slot concept while the contract is open. |
| **Q3** | A club without `realtime` polls at fifteen seconds, which on the phone reads as a frozen overlay with no compositor to mask it. Needs a UI line. |
| **T1** | Assert a level floor, not stream presence. The same mistake is just as easy to make here. |
| **T5** | Sharpened by N5. |
| **U1** | What the playback side sees during the hold is undocumented. Does not block this app, but the app should not assume it can resume indefinitely. |

---

Compiled 10 September 2026 from the relay signal path register and the capture
app scoping conversation. Not checked against `R2-compositor.md`,
`_OPEN-QUESTIONS.md`, `_RULES.md`, the R0 memo, or §3.3 / §6.4 / §7 of the
streaming programme design — none of which were read.
