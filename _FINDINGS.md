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

_Status, 2026-10-09: landed on the web. The QR carries no publish credential
at all (`capture-qr.v2.json`: "The QR never carries credentials: the phone
fetches them with the tok"), and the descriptor issues them per session, to
the current phone, behind the code's Bearer. See `contracts/README.md`, "No
longer blocked", and plan D spec §3.6. The text below is as first written._

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
**Where:** capture app · audio path · relates to D1, D2, T1, N3, F-P5-8

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

**Measured on the device, 2026-09-28 (F-P5-8).** The system can ship silence
too. An answered phone call made Android silence the app's record track for the
whole call (`AF::RecordTrack: setSilenced`), and audio frames kept counting at
about 47/s. Like a deliberate mute, it looks correct to every check that counts
frames. The meter's **MUTED** state here and the spike's
`MIC SILENCED BY SYSTEM` status line are the same design problem: the meter
must say _why_ it is silent, not only that it is.

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

### N20 — The overlay's Live badge stays lit while the phone sends no picture

**Status:** recommendation · agreed with the owner 2026-09-28 · leave as is
**Where:** overlay route (main repo) · compositor slate · relates to F-P5-6, N19, AGENTS.md §7

During a NO VIDEO episode (F-P5-6), the Cloudflare input stays connected and
the overlay's Live badge stays lit over a frozen or black picture. The phone
knows, and its status line says so; viewers see only the badge.

Leave it. The badge belongs to the Tier A browser-source route, and driving it
from the phone would mean either a second render path, which §7 forbids, or an
outbound channel the phone does not have (N19). The spike's watchdog has
recovered every episode within seconds, and viewers see the frozen picture
either way.

If this is ever fixed, fix it where the signal is. The compositor's slate
should cover the picture when Cloudflare stops packaging, and the badge should
follow it. That belongs in the main register. Revisit it when N19's channel
exists, since the phone could then report the state as well.

### N21 — When the system or another app takes the camera or mic, say so, don't fight it, and prevent it at arm

**Status:** recommendation · agreed with the owner 2026-09-28 · detection verified on the device; prevention measured: total silence works, priority does not
**Where:** capture engine · Arm pre-flight · status line · relates to F-P5-8, F-P5-9, F-P5-10, N18, AGENTS.md §6, §9

A phone call silences our microphone (F-P5-8), and a WhatsApp video call can
starve our camera (F-P5-9). Both happened while the broadcast kept running and
looked healthy. The spike now detects both. What the app should *do* about them
is a product call.

1. **Surface it; keep publishing.** Use a caution status line naming the cause,
   such as `LOW VIDEO … — camera in use by another app` or
   `MIC SILENCED BY SYSTEM`, as §9 asks. Never stop automatically: an
   accidental stop costs the match, and a starved picture still beats the hold
   window running out.
2. **Never try to take the camera or mic back.** A reconnect cannot win the
   camera from a call. Retrying would only add a reconnect storm on top of the
   starvation. F-P5-10 makes this sharper. WhatsApp's concurrent camera open
   turns our picture to noise on its own, and a rebuild buys nothing. So hold
   while a camera is contended, and reopen our camera once it is released. On
   the device, the reopen healed the picture in about 1.2 s (2026-09-28, one
   run each of `reopen` and `both`).
3. **Prevent it at Arm.** Add a pre-flight warning unless Do Not Disturb is on
   **total silence**: `NotificationManager.getCurrentInterruptionFilter()` ==
   `INTERRUPTION_FILTER_NONE`, which an app can read without a special
   permission. Changing it needs notification-policy access, so the app warns
   and does not toggle it. A phone that does not ring is a phone the volunteer
   does not answer mid-over. Priority mode is not enough; see below.

**Measured on the device, 2026-09-28 evening** (results doc, "Interruption
detection on the device"):
- **Priority mode** (calls from starred contacts only) let a starred caller
  ring aloud, and the call silenced the broadcast's mic for 15 s. Starred
  contacts are exactly who rings a volunteer mid-match.
- **Total silence** stopped a WhatsApp video call outright: nothing on screen,
  and the audio mode never changed. A cellular call reached the phone
  silently, the operator saw nothing, and the broadcast was untouched.

**Still open:**
- Whether priority mode with calls set to *none* is equivalent, and whether an
  app can read that policy without access.
- Whether other handsets' Do Not Disturb behaves the same (§0: a vendor
  behaviour that carries weight is tested, not read).

### N22 — Larix's SRT surface, read again: one benchmark worth taking, one design to avoid

**Status:** reference · read 2026-10-04 from Softvelum's public pages · nothing here changes plan C
**Where:** `softvelum.com/srt`, `softvelum.com/larix/grove`, `softvelum.com/larix/faq` · the encode step of the degradation ladder (AGENTS.md §8) · C8 · relates to N12, C1

N12 rejected Larix as a product. This note reads it again as a reference: the
SRT settings it exposes, how it adapts bitrate, and how it hands settings to a
phone. All of it is the vendor's documentation, not measured here, so each
number below is a hypothesis until C8 tests it (§0).

**What Larix exposes.** SRT caller, listener and rendezvous. Per connection:
`latency`, `maxbw`, `passphrase`, key length (16, 24 or 32 bytes) and
`streamid`. Up to five outputs at once, H.264 or H.265, local recording, image
and web-widget overlays drawn into the encode, and configurable reconnect and
idle timeouts. Android keeps streaming in the background; iOS keeps audio only,
which is P1 again.

**Adaptive bitrate, as the FAQ describes it:**

| Mode | Steps down when | Recovers |
|---|---|---|
| Logarithmic descend | 4 lost packets in 10 s | One step every minute |
| Ladder ascend | `bitrate / 300000` lost packets in 10 s; drops to 2/3 | After 15 s, 1.5 min, then 5 min |
| Hybrid | Bitrate set in proportion to the share of packets delivered; floor 25% | +500 kbps every 30 s |

On SRT the hybrid mode reads only the delivery ratio; on TCP protocols it also
weighs latency. An optional variable frame rate sheds fps as well as bitrate.

**The benchmark worth taking.** The hybrid mode's floor (25% of the ceiling)
and its recovery (+500 kbps every 30 s) are the first published numbers we have
for the bottom rung of our ladder. Against our 3000k ceiling that is a 750k
floor and about two minutes from the floor back to full rate. C8 should measure
our own encode step against a degraded link with these as the starting
comparison, not adopt them. The order of the ladder is unchanged: the overlay
preview sheds first, preview framerate second, the encode last.

**The design to avoid.** Larix Grove puts the whole setup in a `larix://set/v1/`
link or QR code, credentials included: `conn[][srtpass]`, `conn[][pass]`,
`conn[][zixiEncKey]` travel in plain text. A photo of the code is a working
stream key for as long as the key lives. Our v2 code carries only `code`,
`slot` and `tok`. The phone fetches the credentials natively, and they never
reach JS, the record or the code (amendment, _Who reads what_). That keeps a
leaked photo revocable at the server and keeps C1's two shapes out of anything
a bystander can read.

**Deliberately not taken.** Caller only is all Cloudflare's ingest needs.
Multiple outputs cost battery and heat for something Cloudflare already fans
out. Overlays drawn into the encode would be a second render path (AGENTS.md
§7). Local recording is outside the scope lock. Exposing SRT settings to a
volunteer is the professional-tool shape N12 already turned down.

**Not found:** Softvelum's public pages say nothing about a branded or
white-label build. The SDK page returned 404 on 2026-10-04.

**Second reference: Google Cloud Live Stream best practices**
(`docs.cloud.google.com/livestream/docs/best-practices`, read 2026-10-04):

- **SRT is preferred over RTMP** for packet-drop recovery, forward error
  correction, multiple audio streams and higher bandwidth. That agrees with SRT
  first and RTMPS as the fallback.
- **Its input bitrates are for a studio contribution feed, not a phone.** Its
  720p25–30 input is 8 Mbps (H.264) or 7.2 Mbps (H.265); 720p50–60 is 15 Mbps.
  Those assume a wired uplink feeding a cloud transcoder. Our 720p30 at 3000k
  is a phone ceiling set by heat and a ground's cellular uplink (N1), so it is a
  quality trade-off, not a recommended figure. Do not "correct" it towards
  8 Mbps.
- **Audio:** it gives stereo AAC at 64 or 160 kbps. Our bitrate regulator
  budgets audio at 128k (`BitrateRegulator`: target + 128k), above the 64k
  floor. C8 should confirm the encoder actually sends 128k, which is a device
  claim.
- **Silent on** keyframe interval, B-frames, CBR versus VBR, SRT latency and
  passphrase, reconnects, timestamps and phones.

### N23 — Strip lines are cut by an ellipsis at 640 × 360, and some lose the part that matters

**Status:** open · owner-actionable copy decision
**Where:** capture app · the status strip's one message line · `stream.status.*` and `stream.leaveOnAir` ·
relates to the two-tier message line (2026-10-08) and `src/ui/theme/stripTextFit.test.ts`

The strip has one message line, one line of body text, and a string wider than the strip's text is cut with an
ellipsis (owner, 2026-10-08, "one single line all the time"). The strip's text is 298 dp wide at 640 × 360 and 462 dp
at 804 wide and up, where nothing is cut. At 640 × 360, `stripTextFit.test.ts` measures every status string and caption
in the four languages with the shipped Geist font files' advance widths (no kerning; a three-digit window, a
destination cut to 24 characters) and pins **57 strings that may be cut: 6 captions, 5 routine lines (the French
"going live, started by the organiser" and "Waiting for Go live" in all four languages) and 46 urgent status
lines.** The urgent tier always wins the line (refusals, trouble, a stopped stream, Back's "hold Stop"), so it is
exactly the tier that most needs to be read whole. The 46 by language: en 7, es 14, fr 13, nl 12. The widths are the
font file's arithmetic, which over-states Chromium by 1 to 11 dp, so the 57 is a superset: a Chromium measurement on
2026-10-08 found 48 of the 57 cut at 298 dp. Which cuts read badly is a call for the owner's eye on a 640 × 360 phone.

The cuts that lose the point of the line:

- **`stream.leaveOnAir`** (Back's "hold Stop"), in es, fr and nl: the instruction itself is the cut part. Spanish loses
  "Detener.", French "…ter.", Dutch "…drukt." (what to press).
- **`holdingNotDelivered`** (en, es, fr, nl): the window. "38 s of 183" loses "of 183", and French reads "38 s sur 1…".
- **`waitingDestination`** (en, es, nl): the last word of "pick a destination".
- **`engineSilent`** (fr, nl): the last word of "engine not responding".
- **`fellBack`** (nl): "(RTMPS)", which link it fell back to.
- **`waitingGoLive`** (all four, a routine line) with a long destination: the destination's tail, on the line that says
  where Go live will stream.

The other cut urgent strings are the `stopped*`, `notReady*`, `camera*`, `holding*`, `startRetrying` and `refused*`
families. The full list is the `OVER_NARROW` ratchet in `stripTextFit.test.ts`, which also holds the six captions that
are cut and the five routine strings.

**Open (the owner's call):**

1. Shorten the cut copy. This repo does not change copy on its own; the copy is the i18n dictionaries'. The longest
   (`leaveOnAir` in es and nl, `waitingGoLive` with a long destination, nl `waitingDestination`) matter most.
   **Any copy fix has to edit the ratchet in the same change:** `stripTextFit.test.ts` pins the cut list by key and
   language, and fails both when a pinned string stops being cut and when an unpinned one starts.
2. Accept it: a 640 × 360 landscape phone is the spec's floor and rare, and nothing is cut from 804 wide up.
3. Let the strip wrap at the smallest screens. That reverses the one-line ruling and puts the picture's reserve back
   to two message lines (22 dp more), so it is the most expensive of the three.

### N24 — Plan C's device-gate results were never filed

**Status:** open · evidence gap · closes with a path if the owner knows where the results are
**Where:** plan C's C8 (`docs/superpowers/plans/2026-10-01-s1-plan-c-platform-and-bridge.md`, C:111, C:356,
C:19828) · `docs/specs/2026-10-0x-s1-plan-c-results.md` · plan D spec §3.7 and §5.3

Plan C's C8 names a results document, `docs/specs/2026-10-0x-s1-plan-c-results.md`, for the C device gate's
evidence: the scripted-server rows, the release rows (beats for 30 minutes in Doze, battery while paired for 60
minutes, an OEM background kill, a fresh install on Android 14+) and the staging rows listed for plan D. On
2026-10-09 it exists nowhere: not on main, on no branch (`git log --all -- 'docs/specs/*plan-c-results*'` is empty)
and in no worktree. So the gate's evidence was never filed, and nothing in this repo shows which of its rows ran.

What follows: plan D's staging run (slice D3) cites no plan C result. Each D3 row that depends on a plan C device
fact re-establishes it on the D3 build (plan D spec §5.3): the camera and mic opening on a locked phone (row 2b),
readiness on a locked phone, and the foreground notification's text (AGENTS §9).

**Open (the owner's call):**

1. If the results exist somewhere, name the path and this closes with it.
2. Otherwise the D3 rows stand in for the facts plan D needs, and the release rows plan D does not cover (the Doze
   cadence, battery while paired, the OEM kill) are run again or dropped by name.

---

### N25 — The shared record could not hold a three-hour broadcast

**Status:** decided · fixed by plan D1 Task 4 · owner, 2026-10-09: "Count beats, don't list them"
**Where:** `src/services/sessionRecord.ts:26` (`RECORD_CAPACITY = 1000`) · `src/hooks/useDiagnostics.ts:47-60` (Share
record sends the ring) · `SessionMachine.kt`, `Heartbeats.answered` (the held-beat line) · plan D spec §3.4

Share record (D21) sends the JS ring, which keeps the last 1,000 lines of either side. Before D1 a beat held on air
was written on every answer, as plan B wrote them, and the held cadence is at most 10 s, so a three-hour broadcast
wrote about 1,080 `heartbeat` lines on its own. The ring would then lose the start of a long match before it ended:
the go-live, the first `beat-interval` lines (5 s while starting, D3 row 8), the first connect. The native file
(`RecordFile.kt`, 5 MiB and one rotation) keeps all of it, but nothing shares it.

**Ruling and fix:** a held beat is counted, not listed. Its `heartbeat` line is written only when the answer
changes, as a paired one is, and the minute's `beats` line counts every beat (plan D1 Task 4). Three hours of held
beats write at most 200 beat lines (`BeatLogTest`, `three hours of held beats at 10 s write at most 200 beat lines
(N25)`), so Share's ring holds the whole match.

---

### N26 — The degradation ladder's steps 2 and 3 have nothing behind them

**Status:** open · known gap, recorded on purpose (D2 §4.2; owner, 2026-10-09, R9: "Steps 2 and 3 stay report-only")
**Where:** capture app · `ShedStep` (`Vocabulary.kt:51`, `SessionState.ts:98`) · `DeviceReadings.shed`
(`DeviceReadings.kt:84-90`) · `selectShedding` (`src/hooks/advisory.ts:57`) · AGENTS §8

Native reads the thermal status and names a ladder step: 2 is `viewer-feed`, 3 `preview-framerate`, 4 to 6 `encode`
(CD20). Only step 1 has an actor, and only when What viewers see is built in: the app closes and disables it on any
shed. As shipped the view is hidden (the owner's ruling, 2026-10-09; `FEATURES.viewerCheck`, AGENTS §6), so step 1 too
has nothing to close, and the heat caption ("Phone hot · still live" on air, "Phone hot" before air) is all a shed
does. Nothing lowers the preview's
frame rate at step 3, and nothing touches the encode at step 4 and above; both are reported in the snapshot and the
session record, and that is all. This was true before Plan D, hidden while step 1 (then the score preview) was the only
step ever exercised. Building a real preview-framerate shed is out of Plan D's scope (spec §7). Until it exists, a phone
at thermal status 3 or higher is protected only by what step 1 saved (nothing, while the view is hidden) and by the
OS's own throttling. D3 row 13 proves step 1's caption and record on a debug build, and its closing of the view once the
switch is on; nothing can prove steps 2 and 3, because there is nothing to observe.

---

### N27 — A locked phone stops beating unless its battery is Unrestricted

**Status:** mitigation landed — feat/s1-d3-fixes, Batch 5 (c5a2401; the link from Home: 73dc5ae, fdc8b41; fix
round 1: f0e4659): the battery row in Stream Settings, R5 of the D3 findings design (owner, 2026-10-11;
`docs/specs/2026-10-11-s1-d3-findings-design.md`), reading Unrestricted, Optimized or Restricted and opening App
info (R12, R13 of the same design, the controller's, 2026-10-12), and a `power {mode}` record line at every
pairing's hold and at a change read on a return; AGENTS §9 amended. The cause stays open (OxygenOS battery management); the device proof is Batch 9's
(`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `PairingKeeper` (foreground service, partial wake lock) · OxygenOS battery management

On the NE2211 (Android 16, OxygenOS), with the foreground service (camera + microphone) and the partial wake lock
both held, beats stopped within one to a few minutes of locking (D3 Task 2b, and 2026-10-11 22:06–22:09Z); not a clean
threshold. It happened on charge too, so it is not plain Doze. With the app's battery set to **Unrestricted**, beats ran
unbroken through a 9-minute lock (22:19:51–22:28:32Z), and a console Go live was heard while locked. Evidence:
`~/seazn-d3-evidence/2026-10-10/d3-beats-2026-10-11.ndjson`, `b8-record.ndjson`.

---

### N28 — A start while the Live Stream view is not showing has no video

**Status:** open · investigation first: section 3 of the D3 findings design
(`docs/specs/2026-10-11-s1-d3-findings-design.md`); feat/s1-d3-fixes, Batch 8
(`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `CaptureRun.reopen` (`CaptureRun.kt:281-289`), `rebuild` (`:202-209`) · `StreamerAdapter.reopenCamera`
(`:338-346`) · StreamPack 3.2.1 `VideoInput` (`addOutputSurface$streampack_core`)

At the locked Go live of 2026-10-11 22:26:04Z, StreamPack logged `VideoInput: Video source configuration is not set`
and `…can't add output surface`. No `delivered` line followed, through the unlock at about 22:28:32Z (N27), until the
lag rule reconnected the stream at 22:30:15Z (N32). It was one broadcast throughout: `resumed` at 22:30:17Z and
`delivered` at 22:30:23Z. The console showed Trouble and YouTube stayed on "Preparing stream". The same vendor lines
precede D3's "no video after a camera taken → reopen" (sid a20dcecf). The first line also appears at a normal pairing
(22:19:11Z) where video then worked, so it is not the cause alone; what differs is whether a preview surface is attached
when the stream starts. A YouTube event that starts with no video may stay on "Preparing" after the picture arrives
(observed, not proven; `docs/specs/2026-10-11-s1-d3-web-brief.md` section 4). Evidence: `b8-record.ndjson`,
`b8-media-camera.txt` (one 1280 × 720 stream to the encoder's SurfaceTexture, no preview, while locked).

---

### N29 — A rejoin after the hold runs out retries forever, with no reason shown

**Status:** fixed — feat/s1-d3-fixes, Batch 2 (588ca11, 3eb3c1a, 4e27a9b; fix round 1: 279413f, 641103a, a4756e1)
**Where:** capture app · `Verdicts.over` (`Pairings.kt:274-281`) · `Transports.outageFor` (`SessionMachine.kt:327-331`) ·
`Transports.failed` (`:262-276`) · `Projection.state` (`Projection.kt:72`)

`Verdicts.over` returns the phone to Paired without marking the sid. The next beat saying `live` re-arms it as a new
Session with `liveSinceEpochMs` null, so `outageFor` returns no outage, there is no hold, `Transports.failed` retries
every 2 s with no limit, and the snapshot shows CONNECTING with no reason.

**Ruling and fix:** R10 of the D3 findings design (the controller's, 2026-10-11;
`docs/specs/2026-10-11-s1-d3-findings-design.md`). The cause word `hold-expired` is the D3 fixes plan's ruling P2 and
Stop's path its ruling P3, both the controller's, and the fix round's rulings are the controller's of 2026-10-12. The
hold's end is as it was, and the pairing now remembers the lapsed sid and its first live time (`PairingState.lapsed`).
Any arm of that sid rejoins it: a `live` or `go-live` beat, or the operator's start answered `already_live`. The rejoin
projects as Reconnecting with cause `hold-expired`, no hold (0 of 0) and the first live time, so the HUD's clock carries
on, and the app says "Uplink lost — live on the server, retrying" (`stream.status.rejoinRetrying`, urgent). Its failed
connects, drops and no-first-frame rebuilds back off 2, 4, 8, 16, then 30 s (record line `rejoin-retry`), and no retry
ends it. The server's end, Stop or a 401 before its first frame ends it: Stop ends the pairing as Stop from live does,
with A8's final beat and its time on air, and a 401 unpairs at once. Its first frame ends the rejoin, and a later drop
holds as usual.

**Remaining gap (not fixed in Batch 2):** the lapse is kept in memory only, so after a process death the server's
`live` connects as a bare CONNECTING again, with 2 s retries and a clock that starts at its first frame.

**Known mismatch (the controller's ruling, 2026-10-12):** in Arming and Armed of a lapsed sid, the screen reader still
says "Hold to stop", while Stop there unpairs. The snapshot cannot tell that arm from a fresh one, and a wire field
for one label is not worth it.

---

### N30 — A square preview on the CPH2569

**Status:** fixed — feat/s1-d3-fixes, Batch 3 (7dfced7, 8d3a7b5, 0e8bb97; fix round 1: b383525); the device proof is
Batch 9's (`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `CapturePreviewView` · `PreviewSizes` (`preview/PreviewSizes.kt`) · `SixteenNineCamera`
(`SixteenNinePreview.kt`) · StreamPack 3.2.1 `CameraSizes.getPreviewOutputSize`

The camera served the preview 960 × 960 and the encoder 1280 × 720 (`dumpsys media.camera`, 2026-10-11 21:10Z,
`r4-b-media-camera.txt`), so the 16:9 box showed the picture pillarboxed (`r4-b-live.png`). StreamPack 3.2.1 picks the
preview size by **area only** (sort by area, reverse, `closestTo`), and 960 × 960 has exactly the area of 1280 × 720
(921,600). `PreviewSizeReport.sameArea` (`PreviewSizes.report`) counts such ties.

**Fix:** the spike (`docs/specs/2026-10-12-s1-a1-preview-spike.md`, verdict `DECORATOR`) found the size comes from one
call, the camera source's `getPreviewSize`, with no fork needed. The `PreviewView` now sees the camera through
`SixteenNineCamera`, which answers that call with the listed 16:9 size nearest 1280 × 720 in area
(`PreviewSizes.answer`) and StreamPack's own answer when none is listed; every other member is the real camera's. The
`preview-size` line says which rule picked (`pickSource`) and whether the pick is 16:9 (`pickAspect16x9`). Still to
show on the CPH2569 (Batch 9): a 1280 × 720 preview stream in `dumpsys media.camera` and no pillarbox.

---

### N31 — French Home tile titles run past their tile

**Status:** fixed — feat/s1-d3-fixes, Batch 7 (50ac1d4; fix round 1: 37ef42e); the device proof is Batch 9's
(`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `Tile.tsx` (the title) · `tileTitleRole` (`src/ui/theme/tileTitle.ts`) ·
`layout.tileTitleLines`, `layout.tileTitleRoom` · `homeFit.test.ts`

On the owner's phone sideways with 3-button navigation, "SCORE À DISTANCE" and "TABLEAU DE BORD" ran past their tiles
(D3, `r12-home-fr-landscape.png`): TABLEAU DE BORD's ink by about 2 dp, SCORE À DISTANCE's by 8 dp or more, cut off
under the next tile. The title had no `numberOfLines` and no `flexShrink`, so it kept its full width. The cause is the
window, not the measure. The display is 804 dp sideways, but ShellFrame's insets (a 31 dp cutout and a 45 dp bar) lay
Home out 728 dp wide: tiles of 226.7 dp, measured in the shot, so a title's room of 162.7, not the 188 the fit assumed
at 804. The two titles measure 186.7 and 179.7 dp, 24 and 17 dp over that room, more than the tile's 12 dp padding.
The font measure matched the phone to within 1 dp (TABLEAU DE BORD's ink: 176.0 measured, 177.3 by the font; the
Batch 7 review). The fit tests' widths are Home's own, as laid out behind the insets (the controller's ruling,
2026-10-12).

The title now gives way beside the icon (`flexShrink: 1`) and wraps to at most two lines, then an ellipsis
(`layout.tileTitleLines`). It never breaks inside a word: where its room is narrower than the widest word of any title
(nl LIVESTREAM, 123.3 dp; `layout.tileTitleRoom`), it steps down one size, from `title` to `action` (`tileTitleRole`,
read from the title row's laid-out width). `homeFit.test.ts` measures every title in four languages at Home widths of
592 (a 640 dp phone behind its bar, where the title steps down), 640, 728, 804 and 915 sideways and 360 and 412
upright: no word is wider than the title's room, and none takes three lines. The step holds Home down to 581 dp. With
every title at two lines, the tiles still fit every window they fitted, except 915 × 412 with both cards, which then
scrolls. Still to show on the phone (Batch 9): on the owner's phone sideways with 3-button navigation (Home ≈ 728 dp),
both French titles on two lines inside their tiles, with `font_scale` recorded with the shot.

---

### N32 — The 20 s lag rule fired close to its limit on a real stall

**Status:** recorded; no change: R8 of the D3 findings design (the controller's, 2026-10-11;
`docs/specs/2026-10-11-s1-d3-findings-design.md`)
**Where:** capture app · `DeliveryWatch` (`LAG_GROWTH_LIMIT_MS`, `DeliveryWatch.kt:270`; the stall rule
`NOT_DELIVERED_MS` did not fire)

The rule fired at `lagGrowthMs` 20,456 with `stalledMs` 18,151 (2026-10-11 22:30:15Z): a real stall, close to the
limit. D3 row 1 saw growth of 16–20 s near the limit too. The lag rule (`LAG_GROWTH_LIMIT_MS`) is not changed.

---

### N33 — A replaced phone cannot hand over its record

**Status:** fixed — feat/s1-d3-fixes, Batches 5 and 6 (Stream Settings from Home: 73dc5ae, fdc8b41; the record row:
9802354); Send record to Seazn is built (8b99943, 4920ea3, 9802354; fix round 1: d89f5da, 8ddb33f) and hidden behind
`FEATURES.recordSend = false` until the web's record endpoint exists (`docs/specs/2026-10-11-s1-d3-web-brief.md` §1);
the device proof is Batch 9's (`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `DiagnosticsCard` (Share record) · `RecordRow` · Home

Share record lived only in Live Stream's Settings, and a phone sent to Home by `Replaced` has no pairing to open it
from. The record row (Share record, and Send record to Seazn when its switch is on) is now in Stream Settings in both
variants, after the battery row (Batch 6), and Stream Settings opens from Home's Live Stream tile (Batch 5): a replaced
phone closes the panel, taps _Stream settings_ and shares (`HomeScreen.unpaired.test.tsx`). The Diagnostics card's
header keeps its 48 dp without the button, so the card is still 272 dp and fits its half at 640 × 360.

---

### N34 — The round line is the server's text

**Status:** resolved by the web, in the web's register (its W-number unverified here); no app change
**Where:** web · the waiting fields' stage label

In French the phone showed "ROUND 2". The web already localises the round line by the organisation's
`default_locale`, and recommends keeping it that way: the answer from `mobile-s1-web` on 2026-10-11, in the web's
register (its W-number unverified here). The phone keeps drawing the server's text as sent.

---

## P5 device spike (Android)

The P5 findings, as an index. The full text, evidence and corrections for each
live in [`docs/specs/2026-09-11-p5-android-results.md`](docs/specs/2026-09-11-p5-android-results.md),
under a heading of the same ID; F-P5-1 is under "Findings raised". The status
is as of 28 September 2026. What the product engine must inherit waits on the P5
verdict.

| ID          | Finding                                                                                                         | Status                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **F-P5-1**  | libsrt's "Bad parameters" is how srtdroid reports a host that did not resolve                                   | Explained from the vendor source; the cause is DNS, not our parameters                                                 |
| **F-P5-2**  | On a weak link the SRT session collapses every 6–22 s, and the watcher calls it healthy                         | Watcher fixed; open: C1's fallback counts only _connect_ failures, so mid-session drops never try RTMPS                |
| **F-P5-3**  | The app can die while the device stays perfectly reachable                                                      | Open for the product engine: liveness needs a heartbeat from the socket write path, not a cached flag                  |
| **F-P5-4**  | The broadcast fell to a few frames a second for half an hour, and nothing we collect noticed                    | Watcher threshold fixed 2026-09-14; on-device detection is F-P5-9                                                      |
| **F-P5-5**  | Nothing adapts the bitrate, so a burst the uplink cannot carry arrives as nothing                               | Regulator built in the spike and retuned; all six rules held on the device 2026-09-28                                  |
| **F-P5-6**  | A reconnect can leave the encoder with no picture while everything else says LIVE                               | Spike watchdog detects and recovers. Root cause not reproduced (nor by kill-then-HOME, 2026-09-28); candidate is a pending same-value rotation |
| **F-P5-7**  | The regulator raises on a quiet picture, so the next busy picture overruns the link                             | Fixed (`31dc781`); held on the device, including on a 1.5 Mbps link: no raise after the cut. Overrun there came from F-P5-11 |
| **F-P5-8**  | A phone call silences the broadcast's microphone, and nothing says so                                           | Detection verified on the device 2026-09-28 (phone and WhatsApp calls; HUD shows it). See N18, N21                     |
| **F-P5-9**  | Another app taking a camera can starve the broadcast without stopping it                                        | Camera contention verified on the device; rate floor not exercised (all three calls stalled to zero). See F-P5-10, N21 |
| **F-P5-10** | After another app takes a camera, the broadcast can carry noise at full frame rate while every signal says LIVE | Trigger found: the concurrent open, not our rebuild. Reopening the camera on release heals it. Open: noise for the whole call. See N21 |
| **F-P5-11** | On a thin link, SRT dumps its backlog at many times the link rate                                               | Measured 2026-09-28: 13.9 and 17.0 Mbps bursts into a 1.5 Mbps link. Open for the product engine: bound the sender (`SRTO_MAXBW`) |
| **F-P5-12** | Losing the network on RTMPS crashes the app                                                                     | Found in Run B 2026-09-28: an uncatchable Ktor TLS exception. The spike guard (`4b00812`) held on the device: 10 swallows in 18 RTMPS drops, the process lived. Open for the product engine |
| **F-P5-13** | A session can go dark while the phone and Cloudflare both say live                                               | Both transports. After a reconnect inside Cloudflare's ~30 s notice: unpackaged until the far end's close ~31 s later, and once (RTMPS, 1 of 9) dark 4.5 min. **Without any outage** (90-min soak 2026-09-29): Cloudflare fell ~500 s behind and never packaged the backlog (~13 min unrecorded), and twice stopped acknowledging (~30 s freeze each). 83% of published time was recorded. Open: the engine should watch delivered media time against wall time and force a new session |
| **H-P5-1**  | On SRT the hold may start late, so dropout tolerance is not the configured number                               | Holds (measured 2026-09-14): 225.2 s over SRT against 183 s over RTMPS at `timeoutSeconds=180`                         |

Device scripts that produced the evidence: `scripts/p5/device/`.

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
| **T5** | Sharpened by N5. Run B (2026-09-28) found that the app itself dies on RTMPS when the network goes (F-P5-12), so the fallback is not yet a fallback. With the spike guard, RTMPS reconnects unaided (criterion 5), resumes one recording in 8 of 9 short cuts, and goes silently dark in the ninth (F-P5-13). Run C: the fallback takes 18.8 s. |
| **U1** | What the playback side sees during the hold is undocumented. Does not block this app, but the app should not assume it can resume indefinitely. |

---

Compiled 10 September 2026 from the relay signal path register and the capture
app scoping conversation. Not checked against `R2-compositor.md`,
`_OPEN-QUESTIONS.md`, `_RULES.md`, the R0 memo, or §3.3 / §6.4 / §7 of the
streaming programme design — none of which were read.
