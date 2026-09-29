# P5 Device Spike — Android Results

**Status:** Run A aborted at about protocol minute 97 — see Run A below. Runs B and C pending
**Handset:** OnePlus 10 Pro (NE2211), Snapdragon 8 Gen 1 (SM8450), Android 16, build NE2211_16.0.3.530(EX01), adb serial `12be753e`
**Engine:** StreamPack 3.2.0 (Apache-2.0) with libsrt (MPL-2.0, unmodified)
**Encode:** 1280×720, 30 fps, 3000 kbps, GOP 2 s, AAC 128 kbps 48 kHz
**Target:** Cloudflare live input, `recording.timeoutSeconds=180`, overlay from stg.seazn.club (football, in play)
**Power:** charging from a power bank throughout, except the screen-locked step — see the note under Run A
**Code:** branch `spike/p5-android` — throwaway, never merged, deleted after this document is complete

## Baseline

Idle, screen on, charging, before any run (2026-09-11): thermal status **2 (moderate)**, battery 37.7 °C.
Every run starts with a 5-minute baseline, recorded below.

## Pass criteria (proposed — confirm before Run A)

| # | Criterion | Why |
|---|---|---|
| 1 | 3 h completes, publishing in ≥ 99% of samples outside deliberate outages, **and the playlist head advancing across the same window** | P5 |
| 2 | Thermal status never reaches 4 (critical) | P3; the ladder's thresholds come from the curve |
| 3 | While streaming, the 60 s rolling mean of `videoBitrate` stays ≥ 3000 kbps; report min, median and p5 per run | §8: the encode is last |
| 4 | Drop inside 180 s resumes into ONE recording | C2, U1-S7 |
| 5 | Drop beyond 180 s: ENDLIST, second recording, app reconnects unaided | U1-S7 |
| 6 | Screen locked 10 min: playlist keeps advancing | Android lifecycle, §9 |
| 7 | 180° flip: preview, encoded picture and rotation metadata all correct | P4, three assertions |
| 8 | Audio mean volume above −40 dB in a 20 s sample | T1: a level floor, not stream presence |
| 9 | Battery never below 20% while charging | Power-bank setup is viable |

**Read criterion 3 carefully.** The `videoBitrate` column is *measured egress*, not the encoder's
configured target: the per-tick delta of the StreamPack endpoint's cumulative `bytesWritten`, scaled
by the real interval between samples. It therefore counts everything the endpoint sends — the 3000
kbps video, the 128 kbps audio, container overhead, and for SRT the packet headers and any
retransmissions — and it reads 0 when not streaming, on the first sample, and for one sample after a
reconnect resets the counter. So a run that holds the encode sits *above* 3000 kbps — video plus 128
kbps audio plus container is already about 3.2 Mbps before a single SRT retransmission — and the
failure signal is a sustained sag toward and below 3000, not a departure from it. An earlier draft of
this criterion said "stays at 3000 kbps"; that described a config echo which no longer exists, and an
analyst reading it as the encoder target would mark a healthy run as failed.

"p5" in criterion 3 is the 5th percentile of the rolling means — not the P5 register ID that names
this spike. The rolling window and the percentile are both there because a single bad second is
noise: a 1 Hz counter dropping one sample after a reconnect is expected, a minute of sag is a shed.

## Rehearsal — 5 minutes, 2026-09-12 (protocol shake-out, not a measurement)

Run before Run A to prove the protocol rather than the handset: publish over
SRT with the staging overlay on, flip 180°, drop the network for 20 s, then 60 s
with the screen off. Wifi, charging, indoors, a dark static scene.

| Question | Result |
|---|---|
| Does the whole path work? | Yes. Camera → encoder → SRT → Cloudflare, playlist advancing (head 54 → 728, HTTP 200 throughout) |
| Does the overlay composite? | Yes. The Tier A route renders over the live camera, top-left, as OBS gets it |
| Does the screen-off case publish? | Yes. 58/58 screen-off samples still streaming; Cloudflare kept advancing through the lock |
| Telemetry | 2156 samples at 1 Hz, publishing in 92% (the rest is arm/stop/outage) |
| Throughput | mean 4110 kbps, max 14553 kbps — total endpoint throughput, see criterion 3 |
| Thermals | battery 27.7 → 38.7 °C, peak thermal status 2 (moderate), headroom ≥ 0.45 |

**Three defects the rehearsal exposed. All three fixed 2026-09-12, before Run A.**

1. **Marks never reached the CSV.** The rehearsal drove `Mark` by tapping the UI;
   it sits in the scrolling actions list, and once the phone locked the taps hit
   the lock screen instead. The run timeline therefore lives only in the
   laptop's log, and correlating a thermal number with "the moment the screen
   went off" is manual. A run that cannot be correlated is a run that has to be
   done twice.
   **Fixed:** `SpikeSession` polls the app's external files dir once a second for
   a file named `p5-mark`, writes its first line — trimmed, capped at 64
   characters — as a `mark` row, and deletes the file. `adb push` of a one-line
   file is now the whole protocol: no UI, no unlocked screen, nothing to mis-tap.
   The `mark` intent and the Mark button stay for hand-driven runs.
2. **SRT's first connection is rejected nine times.** `Operation not supported:
   Bad parameters`, retried every 2 s for ~18 s, then connects normally
   (`connectMs=598`). The failures are correctly `counted=false`, so C1's
   fallback rule is not tripped by them, but an 18-second lag between "go live"
   and "on air" is not acceptable at a ground.
   **Diagnosed: the cause is not ours, and the error text is a lie.** See F-P5-1
   below. The parse path and the descriptor are correct; what the message
   actually reports is a name that would not resolve. **Fixed** as far as this
   layer can: the SRT attempt now resolves the host first, so the CSV names
   `UnknownHostException` instead of inventing a parameter fault, and
   `connect-failed` carries `validated` plus the descriptor's shape (host, port,
   `streamIdLen`, `passphraseLen`, `latencyMs`) so one more run settles it
   outright. Secrets stay on the device — lengths, never values.
3. **An unexplained mid-run drop.** `dropped reason=pipeline-stopped` with no
   operator action, recovered automatically in 442 ms. Harmless here; unexplained
   is not acceptable over three hours.
   **Fixed: the cause was being thrown away by our own code.** StreamPack offers
   two signals and they race. `isStreamingFlow` is the *pipeline's* — the camera
   and microphone inputs — and it goes false for a dead SRT socket exactly as it
   does for a dead camera, because the sink's `isOpenFlow` stops the output and
   the output stops the inputs. The endpoint's own `throwableFlow` is a constant
   null in `CompositeEndpoint`, so a dead socket only becomes a `ClosedException`
   on the next frame write — a frame later, losing the race every time.
   `awaitDrop` now takes the first signal, waits up to 250 ms for a throwable to
   catch up, and reports `reason=endpoint-closed | inputs-stopped | requested`
   alongside `endpointOpen`, `audioStreaming`, `videoStreaming` and the
   throwable's class and message. `pipeline-stopped` is gone as a label: it named
   our ignorance, not a cause.

Cloudflare note: a recording stays `live-inprogress` for some minutes after the
stream ends and **refuses deletion** (`409`, code 10046) until it finalises, so
cleanup must poll rather than delete once.

## Second handset — Redmi Note 7 Pro, 2026-09-12

**Redmi Note 7 Pro** (`violet`, serial `9735b6fb`), Android 10 / API 29,
Snapdragon 675, 1080×2340 at density 440. The mid-range class a volunteer
actually brings to a ground, against the OnePlus 10 Pro's flagship silicon.

Two platform facts to read the columns by: `thermalStatus` works (API 29), but
`thermalHeadroom` **does not exist before API 30** and logs −1.0. And MIUI
refuses `adb install` (`INSTALL_FAILED_USER_RESTRICTED`) until *Install via USB*
is enabled in developer options.

All three rehearsal fixes verified here:

| Fix | Evidence on this handset |
|---|---|
| R1 marks | `adb push` of a one-line `p5-mark` produced `mark,label=redmi-verify-r1`; file consumed. No UI, no unlocked screen |
| R2 SRT connect | Connected first attempt, `connectMs=1344`, zero "Bad parameters" rejections — consistent with F-P5-1 being resolution, not parameters |
| R3 drop causes | Every drop now names one: `reason=endpoint-closed message=ClosedException: Connection was broken endpointOpen=false` |

### F-P5-2 — on a weak link the SRT session collapses every 6–22 s, and the watcher calls it healthy

Publishing for ~5 minutes on wifi at **rssi −74/−75 dBm** (5 GHz, f=5320, link
65 Mbps), the session dropped and rebuilt **18 times**, every 6–22 s, always
`endpoint-closed · Connection was broken`. Reconnects were fast (337–1344 ms),
so the app behaved correctly — but the run published in only **64% of samples**
(266/415), at a mean **1482 kbps** against a 3000 kbps target, with **103 of 266
publishing samples below 1 Mbps**. The OnePlus did not do this on the same
network, so this is uplink quality rather than the encoder — which is precisely
the wet-ground case the product exists to survive.

Three consequences, each worth more than the run that produced them:

1. **Our own watcher lied about it — now fixed.** `hls-watch` reported
   `advancing` on every poll, while the playlist head actually failed to move on
   67 of ~76 polls. The cause was not leniency about status codes but the
   watcher's own reconnect handling: heads are not comparable across a variant
   change, so on every new variant it passed `previous = null`, and `judge` read
   a null baseline as progress. With a reconnect every 6–22 s, almost every poll
   was a new variant, so the run could never be anything but green.

   Fixed by making progression the only evidence of health: `advancing` requires
   the head to have moved within one variant, a variant change is `waiting`
   rather than progress, and the stall clock now crosses variant changes
   untouched — only real movement resets it. The poll step is a pure function
   (`step`) so the 18-reconnect storm is driven through it in a test; reverting
   the carry turns that test red. Verdicts are now `advancing` / `holding` /
   `waiting` / `stalled` / `ended`, so a CSV distinguishes "no evidence yet"
   from "moving", which the old two-way split could not express.
2. **C1's fallback never fires for this.** The SRT→RTMPS rule counts *connect*
   failures; these are mid-session drops that reconnect successfully. A link this
   bad would ride SRT all afternoon rather than falling back, and the phone would
   never try the transport that might survive it.
3. **A soak on this link would measure the wifi, not the handset.** Run A needs
   either a strong link or cellular, and the link quality must be recorded
   alongside the thermal numbers or the run is uninterpretable.

### F-P5-3 — the app can die while the device stays perfectly reachable

Run A stopped delivering at **11:02:09.8Z**. Three clocks, none of which needs the
handset, say what happened: Cloudflare's recording ran **1998.23 s** from
10:28:51.599Z; the device's last telemetry row is **11:02:20.7Z**, still claiming
`streaming=true` at 4.4 Mbps; and `adb shell` was still reading that same file
successfully at **11:02:51–57Z**.

So the 1 Hz sampler stopped writing about 35 s before a read that worked, and
`SpikeLog` flushes on every write, so the gap is not buffering. Whatever ended
the run acted on **the app** while leaving the OS fully responsive.

The pulled CSV settles the mechanism as far as the device can. The file is 2488
lines and **stops dead** at 11:02:20.7Z — no rows after, no resume — with its
final three samples all reading `streaming=true`, `transport=srt`, 4.10 / 4.29 /
4.43 Mbps. And the event rows contain **no `dropped`, no `connect-failed`, no
`error`, no `service-stopped`**; the last event of any kind is the screen-off
`rotation value=0` at 10:58:51.6Z, 3.5 minutes earlier. So SRT did not drop
(`awaitDrop` would have emitted `dropped`), the service was not stopped, and
nothing threw. The process ceased to exist mid-publish, having observed nothing.

**The cable is exonerated for 27 minutes, not 46 seconds.** The driver pushed
`mark-5` at 11:29:07Z; that push succeeded and the file sat unconsumed in the
dead app's directory until relaunch at 11:56:03Z, when `watchMarkFile` picked it
up as the first row of the next CSV. Each push overwrites the last, which is why
only `mark-5` survived and not `mark-3` or `mark-4`. So adb was working at least
27 minutes after the app died, and the radio was answering over it throughout.

**The confound is ours, and it gates the conclusion.** The kill fell inside a
window where `dumpsys battery unplug` had told the framework the device was
discharging — `charging=false` in those very rows — and ColorOS power management
keys off battery state, so the simulation is a candidate *cause* and not merely
the condition. A real unplug at a ground produces the same framework state, so
the field case may hold either way, but the clean test is a screen-off window
with the framework seeing charging throughout. Until that runs, the class
statement above stands and "Android power management kills a publishing
foreground service after 3.5 minutes of screen-off" does **not**.

**On-device CSV closed the remaining gap (pulled 2026-09-12 evening as
`p5-1789208313554.csv` → `.p5/run-a-full.csv`).** Across 2488 rows there is
**no `dropped`, no `error`, no `fell-back`, no `service-stopped`** — only
`armed` / `connecting` / `publishing` / `service-started` / three marks /
four rotations, then samples. The file ends on a `streaming=true` SRT sample
at 11:02:20.300Z. So the process was killed (or frozen past flush) without the
transport layer observing a close. The kill record in `logcat -b events` is
still gone — that buffer only reaches back to 12:47:56Z, about 1 h 45 m after
the death — and what it does show is this handset's OEM killer working hard
(`am_kill … o-kill(4010)` taking `com.oplus.camera`, Spotify, Instagram and
others), which remains circumstantial support and no more.

The generalisable part is not criterion 6 failing. It is this: **device
reachability is not publisher liveness.** A health check that pinged the handset,
or read any OS-level signal, would have reported green through the entire window
in which publishing had already stopped — the same shape this document keeps
finding on the manifest side, now on the device side. Liveness has to come from
something that advances only when frames are actually delivered: the playlist
head, or a publisher heartbeat emitted from the same code path that writes to the
socket. A 1 Hz sampler that reports `streaming` from a cached flag is not that,
and this run is the proof: it reported `streaming=true` for the last 11 seconds
of its life while nothing was arriving.

The delivery stop, to the second, from the watcher CSV and the recording:

| Time | What |
|---|---|
| 11:02:09.8Z | Ingest content ends — 10:28:51.599Z plus the recording's 1998.23 s |
| 11:02:20.7Z | Device writes its last telemetry row, `streaming=true`, 4.4 Mbps |
| 11:02:22.7Z | Playlist head last advances, to 997 — **13 s after ingest ended** |
| 11:02:39.9Z | Watcher calls `stalled`, 17.2 s after the last movement |
| 11:05:50.9Z | Last 200: playlist still served, still frozen at head 997 |
| 11:05:55.0Z | Master returns 204; the variant is gone |

Two method notes from that. The head kept advancing for 13 s after ingest ended,
which is Cloudflare's packaging tail — so the playlist is a *lagging* clock for
when a phone stopped sending, and the recording's duration is the exact one.
And the watcher took 17.2 s to call the stall where a `targetDuration` of 2
implies 6 s; that remains unexplained, because the watcher did not record the
target duration it actually saw. It does now.

### F-P5-4 — the broadcast fell to a few frames a second for half an hour, and no signal we collect noticed

Found in the recording of the invalid H-P5-1 cell 1 retry (2026-09-13, input
`faa37499…`, video `3eaa12e0…`, 2342.22 s), which ran unattended for about 50
minutes after its driver failed: screen on, overlay on, cellular with wifi off, on
the supply that fails under load.

What the recording holds, by ffprobe packet cadence on its renditions:

| Media time | Video, 720p rendition | Audio rendition | Segments |
|---|---|---|---|
| 100–1200 s | **30.02 fps**, largest gap 34 ms, in every 10 s window sampled (100, 700, 900, 1100, 1200 s) | **46.88 packets/s** at 300 s, the full AAC rate | ~2 s |
| ~1227 s to the end | **3.2–9.1 fps** in every window sampled (1240, 1300, 1500, 1800, 2000, 2300 s) | **6.36 packets/s** at 2140 s, about one AAC frame in seven | 126 segments of 4.5–15.1 s |

What every other witness said over the same wall-clock window:

- **The app:** `streaming=true` in every 1 Hz sample to its last at 10:44:25Z,
  measured egress 3–4 Mbps median per minute, no `dropped` event after 09:58:16Z.
- **Cloudflare's live input status:** SRT `connected` from 09:58:16.792Z, unbroken,
  until `disconnected` with reason `client_disconnect` at 10:44:56.762Z.
- **Thermal:** status 3 (severe) from 10:01Z and **4 (critical) from 10:23Z**,
  battery 47.8 °C. That is criterion 2's failure line, reached about 29 minutes
  into a publish; Run A stayed at 2 over its 33 minutes, with brightness lowered
  and the screen off for part of them.

So the connection was up, the app was sending, the platform was recording — and
what it recorded is a slideshow with one-seventh of its sound. Criteria 1 and 3
would both have passed this window. A playlist-head check was not running after
10:05:54Z, but segments kept arriving, only longer and emptier, so head movement
would most likely have passed too. **Delivery has to be measured in frames and
audio packets, not in connection state, egress or playlist movement.**

The watcher that did run had already been blunted. Its stall threshold is three
target durations, and the playlist's target duration only grew: 3 at the start,
4 at the first reconnect (09:57:24Z), 7 and then 8 by 09:58:46Z as the reconnect
storm left two ~7 s segments, and 8 for every remaining poll. So after the first
90 seconds the watcher needed **24 s** of a frozen head to say `stalled` instead
of 9, and its 286 polls at target duration 8 never said it once. A threshold
derived from the playlist loosens precisely when the stream starts going wrong;
it has to come from the segment length we configure, not from what the platform
declares.

**Fixed 2026-09-14.** The threshold is now three of the segments we configure
(`stallThresholdMs(2)` = 6 s), passed into `judge`, and written on every CSV row
as `stallAfterMs`. The margin is measured: on the two healthy SRT cells the head
never went more than 4.63 s between advances. Replayed through the new rule, those
two cells call no stall before their cuts and call each stall 3.3 s and 4.4 s
sooner after them; this retry's watcher file gains 20 stalled polls. Tests drive a
target duration that grows to 8 and require a 10 s frozen head to be a stall;
putting the old derivation back turns them red.

**It also breaks a clock this document relies on.** "Last media received =
recording created + duration" puts the end of this recording at 10:33:37Z, and the
retry was first written up as having stopped then. It had not. The recording's
final seconds show the handset being picked up and moved, which the device logged
at 10:43:46Z (charging false) and 10:43:51Z (rotation), and Cloudflare saw the
client leave at 10:44:56Z. Roughly 650 s of wall clock is absent from the media
timeline, audio and video alike. The arithmetic holds only for a recording whose
segments are regular: Run A's 998 segments were 996 at ~2 s, so its figures stand,
but every recording has to pass that check before created + duration is used.

**Mechanism: open.** Onset at media ≈1227 s is about 10:15Z, inside thermal severe
but eight minutes before critical, so the thermal transitions do not line up with
it. Two candidates the data cannot separate: media lost in transport (SRT dropping
packets that arrive later than its 2000 ms latency, and Cloudflare discarding what
it cannot decode), or capture and encode starving on a hot handset while the
endpoint kept writing — egress counts retransmissions, so 3–4 Mbps does not
exclude either. The telemetry cannot tell them apart because it records neither
the encoder's output frames nor SRT's own counters. **Retry requirement: add
encoded video frames, encoded audio frames, and SRT sent / retransmitted /
dropped packets and RTT to the 1 Hz sample.**

Evidence: `.p5/p5-h1-cell1-retry.device.csv`; `cf.ts videos
faa37499c97f16d4ed392f95b4f80f60`; the live input's `status` from the Stream API;
ffprobe packet cadence on the recording's 720p and audio renditions; frames
extracted at 60, 1200, 2280, 2320, 2335 and 2341 s.

### F-P5-5 — nothing adapts the bitrate, so a burst the uplink cannot carry is delivered as nothing

> **Correction, same day — the first freeze was not an uplink overrun.** The per-second device data
> contradicts the story below, and the story stays only so the correction can be read against it. The
> phone was already sending 4.3–4.9 Mbps at 19:12:50Z. From then until 19:14:08Z, SRT reported clean
> delivery: zero retransmits, drops or losses, RTT 31–39 ms, send buffer ≤ 346 ms, 30 fps. Yet Cloudflare's
> playlist head stopped at 3998 at 19:12:56Z, advanced briefly to 4002 at 19:13:30–38Z, and stopped again.
> **Cloudflare's SRT receiver was acknowledging a clean 4.5 Mbps while it stopped packaging.** The SRT
> distress in the table below (19:14 onwards) came after the freeze. It may be the cellular link, or
> Cloudflare no longer reading, which would back up the sender the same way; the data cannot separate the
> two. The same doubt covers the congestion after the 19:27Z reconnect. What stands: no bitrate regulation
> exists, SRT's latency makes an overloaded link deliver nothing decodable, and broadcast 2 was recorded
> with no video while SRT dropped packets at the sender. What does not stand: that a burst overran the
> uplink and caused the first freeze. **Open:** why Cloudflare stopped packaging at 19:12:56Z while
> receiving a clean stream whose bitrate had just jumped. Replaying Soak A through the regulator built
> afterwards (`7f714e7`) confirms it would not have acted before 19:15:14Z, too late for broadcast 1's
> picture. The telemetry also recorded negative `srtSndBufMs` values (e.g. −336) — a reading artefact to
> keep out of any threshold.

Soak A, 2026-09-14. The engine encodes VBR at a 3 Mbps target, and nothing regulates it against
the link. StreamPack 3.2.0 ships a bitrate regulator (`IntervalBitrateRegulatorController`), but the spike
configures none. For the hour before 19:13Z the phone sent a full 30 fps at only 0.5–0.7 Mbps: VBR on a
still scene. At 19:13 its output jumped to about 4.5 Mbps. The phone had not been moved; what changed in
the picture is not established. The roaming cellular uplink could not carry that rate:

| Minute (Z) | Egress | SRT retransmits | Send buffer | RTT |
|---|---|---|---|---|
| 19:12 | ~0.7 Mbps | 0 | 346 ms | 41 ms |
| 19:14 | ~4.5 Mbps | 46 | 198 ms | 58 ms |
| 19:15 | ~4.5 Mbps | 783 | 1300 ms | 42 ms |
| 19:16 | ~3.2 Mbps | — | 2049 ms | 1658 ms |

Cloudflare packaged its last segment at 19:13:38Z, and the SRT session broke at 19:16:41Z. After a later
reconnect the link was worse. SRT estimated the uplink at **1.2 Mbps** against 3.3–3.9 Mbps offered, the
send buffer sat at the 2049 ms latency limit, and by 19:30:49Z SRT had discarded **77,888 packets** at the
sender against 49,160 sent. The broadcast Cloudflare recorded from that session has **no video at all**:
input 0×0, size 0, and one variant labelled `undefinedxundefined`, carrying 181 s of audio. Over the run
SRT dropped 184,022 packets at the sender.

SRT's latency makes this all or nothing. Data later than the 2000 ms window is dropped, so an overloaded
link does not degrade to lower quality; it delivers nothing decodable. The degradation ladder (§8) puts
the encode last, but last still has to exist: **the engine needs a bitrate regulator driven by SRT's own
bandwidth estimate, send buffer and drop counters, with a floor**, before a 3000k ceiling means anything
on cellular.

### F-P5-6 — a reconnect can leave the encoder with no picture while everything else says LIVE

Soak A, 2026-09-14. After the reconnect at 19:16:44Z the phone's video frame counter stayed flat for 11
minutes while every other witness said the broadcast was healthy:

- **Audio** kept flowing at 46.9 frames/s; egress ~180 kbps.
- **The camera kept delivering.** `dumpsys media.camera` shows device 0 feeding both StreamPack's
  `SurfaceTexture` (the GL surface processor's input) and the preview `SurfaceView` at 30.0 fps: 182 frames
  in 6.06 s on each.
- **The encoder had no input.** Its log: `c2.qti.avc.encoder … 1280x720 inputFps=0 outputFps=0`.
- **The process was healthy.** Foreground service running, process not frozen, wake lock held, no app
  warning or error in logcat.
- **The HUD read `LIVE srt · 184 kbps · last: publishing`** over a moving preview with the scorebug on.
  Cloudflare reported the session connected.

So the break sits between StreamPack's surface processor output and the video encoder's input surface. A
further reconnect (a 20 s data cut at 19:27Z) restored 30 fps, and the reconnect cells earlier the same day
resumed video too, so it is conditional. This session followed 2 h 17 min of publishing at thermal status 3.

Three consequences:

1. **LIVE must be gated on encoded video frames advancing**, not on the transport or the streaming flag.
   The counter this run added is the signal.
2. **Video frames stalling while publishing is a native state**: the engine should detect it and rebuild
   the video pipeline (a reconnect did it here), never leave it silent.
3. **It needs a repro**: reconnect cells under the soak's conditions, with the frame counters on.

**Candidate mechanism (read from StreamPack 3.2.0's source and matched to Soak A's events; not
reproduced).** In `EncodingPipelineOutput`:

- `setTargetRotation` while streaming only stores `pendingTargetRotation`.
- Every `stopStream` runs `resetVideoEncoder()`. That emits a null input surface, then applies the pending
  rotation or, when there is none, calls `videoEncoder.reset()`.
- A pending rotation *equal to the current one* changes nothing, so the encoder is neither rebuilt nor
  reset, and its input surface is never offered again.

Soak A was armed at rotation 1 and logged `rotation value=0` then `value=1` while streaming
(16:59:19–26Z), leaving a pending rotation of 1. The first stop after that was the 19:16:41Z drop, and it
gave zero video. The next stop (19:27:28Z) had no pending rotation, so `reset()` ran and 30 fps returned.
The same day's reconnect cells had no rotation while streaming, which would explain why this is
conditional.

The repro: publish, rotate the handset while live so a same-value rotation is left pending, force a
reconnect, and expect flat video frames with audio flowing. AGENTS.md §6 locks the app to landscape, so
the product engine must never call `setTargetRotation` while streaming, or must prove it safe (P4).

Without the delivery columns added for this run (`890da01`), this soak would have read as F-P5-4 again:
connected, streaming, and nothing to say why.

### F-P5-7 — the regulator raises on a quiet picture, so the next busy picture overruns the link anyway

2026-09-28, the retuned regulator (`256088c`, `4b32cbc`, `0658a45`) on the OnePlus over roaming cellular. Its
raise gate asks only whether the link *stayed clean*: send buffer under latency/10, no new sender drops or
write-losses. A clean interval says nothing about capacity when the encoder is not using the target. VBR on
a still or dark picture sends far below it, so every interval is clean and the target climbs anyway:

| Time (Z) | Target | Egress | SRT bandwidth estimate | Send buffer | Sender drops (cumulative) |
|---|---|---|---|---|---|
| 14:52:30 | 1830k | 2149 kbps | 1.6 Mbps | 98 ms | 249 |
| 14:53:11 | 1930k | 371 kbps | 0.96 Mbps | 102 ms | 249 |
| 14:55:22 | 3000k | 630 kbps | 0.95 Mbps | 43 ms | 249 |
| 14:58:24 | 3000k | 704 kbps | 1.37 Mbps | 43 ms | 249 |
| 14:58:35 | 500k | 3379 kbps | 0.94 Mbps | 1929 ms | 528 |

Video ran at 30 fps throughout; only the picture's complexity changed. From 14:53 the scene went quiet and
egress fell to 0.4–0.9 Mbps, and in the next two minutes the regulator raised 1830k → 3000k in twelve clean
steps. At 14:58:35 the phone was picked up (a `rotation` event at 14:58:39). VBR jumped to 3.4 Mbps on a
link SRT estimated at about 1 Mbps, the send buffer hit 1.9 s, 279 packets were dropped at the sender, and
the target fell to the floor.

This is F-P5-5's failure — a VBR jump on a thin link — reached again, this time *through* the regulator. The
link's capacity moved during the session: it carried 3.5–3.8 Mbps without a drop before 14:40, then forced
cuts at 14:40 and 14:45, the second down to the floor. From then on it carried at most 2.3 Mbps, yet the target sat at the
ceiling for three minutes.

**What the raise needs:** evidence the link carried something close to the target, not only that it stayed
clean. Two candidate rules, to be judged by replay against this CSV and Soak A:

- **Raise only when tested:** raise only if the clean interval's measured egress reached a set share of
  the expected egress at the current target (video + 128k audio + overhead). A quiet picture then holds the
  target where it is.
- **Cap by proven capacity:** never let the target exceed a set multiple of the highest egress carried
  without drops in the last few minutes.

Either rule leaves a quiet picture on a fat link below the ceiling until the picture gets busy. That costs
quality at the first busy moment, which is the right trade: a picture that is briefly soft, not one that
freezes.

Evidence: `.p5/p5-safeguards-20260928T142729Z.*`.

**Fix, on the device the same day (`31dc781`).** A due raise now also needs the interval's mean egress at 70%
or more of `(target + 128k) × 1.15`. One SRT run on cellular, with the owner covering the lens:

- **Busy picture (15:56:43–15:58:50Z):** 1500k → 2700k at +100k per ~10 s, egress 0.6–1.2 of expected,
  send buffer ≤ 500 ms, no drops. The gate does not slow a tested climb.
- **Quiet picture (15:58:54Z to the stop at 16:00:14Z):** egress ~0.5 Mbps, 0.15–0.17 of expected at 2700k.
  **No raise in 80 s**, where the old rule would have reached 3000k within 30 s.

Not exercised: the busy picture returning on a thin link, which is the overrun itself. This link was fat
(SRT estimated 10–320 Mbps), and the picture stayed quiet to the end. Evidence:
`.p5/p5-raisegate-20260928T155604Z.*`.

**On a thin link, 2026-09-28 20:52Z.** The setup, `verify-raisegate.sh` with `LAN=1`:
- The phone published SRT over home Wi-Fi through `udp-throttle.mjs` on the laptop, then to
  `srt-live-transmit`.
- The throttle is a 1.5 Mbps link with a 300 ms drop-tail queue. It is exact: it forwarded 1.50 Mbps in
  every saturated second.
- The picture was a video on the laptop screen, then the lens covered, then the video again.

Two other ways of making a thin link failed first and are recorded in the script header: a USB reverse
tether, and a pf dummynet cap.

| Phase | Target | Egress (median) | Max send buffer | Sender drops | Link: forwarded / dropped |
|---|---|---|---|---|---|
| P1 busy, 90 s | 1500k → **500k** at +32 s | 685 kbps | 1975 ms | 1252 | 763 kbps / 4692 packets |
| P2 covered, 60 s | 500k, **no raise** | 546 kbps | 214 ms | 0 | 605 kbps / 0 |
| P3 busy again, 60 s | 500k, **no raise** | 985 kbps | 1998 ms | 2215 | 1035 kbps / 8344 packets |

- **The gate held on the thin link.** After the cut, nothing was raised for the remaining 150 s, quiet or
  busy. So the F-P5-7 sequence did not happen: no raise on the quiet picture, and no overrun when the busy
  one returned. On the busy picture the clean wait never reached 10 s. Keyframe bursts put the send buffer
  at 350–430 ms every 5 s or so, and each one restarts the wait.
- **The busy picture still overran the link at the floor, for about 18 s** (P3 +163 to +181 s). The
  encoder's egress at a 500k target was 0.95–1.0 Mbps on the busy picture. That is the known overshoot, and
  it fits under 1.5 Mbps. The overrun came from how SRT sends, not from the regulator: see F-P5-11.
- **Caveat:** this is a shallow queue. A real cellular uplink buffers more, which turns some of the loss
  into latency instead.

Evidence: `.p5/p5-raisegate-20260928T205201Z.*` (`device.csv`, `throttle.csv`, `logcat.txt`).

### F-P5-11 — on a thin link, SRT dumps its backlog at many times the link rate

In the thin-link run above the phone's SRT sender twice sent a burst far above anything the encoder
produces:

| When | Phone egress that second | Arriving at the 1.5 Mbps link | Dropped by the link |
|---|---|---|---|
| P1 +32 s | 13.9 Mbps | 19.8 Mbps | 1994 packets |
| P3 +169 s | 17.0 Mbps | 18.0 Mbps | 1788 packets |

- Both bursts came as the send buffer reached 1.1–1.9 s, and both were mostly retransmissions. The
  retransmit counter rose by 7,581 across the P3 overrun.
- The two counters agree: the phone's own egress and what arrived at the relay.
- So a link already short of capacity is hit with 10× its rate. Most of that is lost, which causes more
  retransmits, and the sender drops what passes the latency (2215 packets in P3).
- The spike sets no `SRTO_MAXBW`, `SRTO_INPUTBW` or `SRTO_OHEADBW`. In live mode libsrt then paces
  nothing: `SRTO_MAXBW` defaults to −1, meaning unlimited.

**For the product engine:** bound the sender. For example, set `SRTO_MAXBW` from the regulator's current
target, with room for audio and retransmits, or set `SRTO_INPUTBW` and `SRTO_OHEADBW`. Test it the same way,
on the same throttle.

**Open:** whether these bursts are part of F-P5-2's collapses every 6–22 s on a weak cellular link. That is
a hypothesis; nothing here tests it.

### Observation — an overlay that fails to load hides the shot

In the same run the session had no overlay URL (`about:blank`), and the operator reported that the camera
had not opened. It had: the HUD read `LIVE srt 1136 kbps` at 30 fps. `PeekNotice`
(`src/ui/components/OverlayPreview.tsx`, `PeekNotice.tsx`) painted `The score overlay did not load.` on an
opaque `colour.ground` plate over the whole preview. The spike build keeps the overlay always on, so this
blanked the viewfinder for the whole run.

In the product, a failure during a peek would hide the shot for that peek. AGENTS.md §7 says an overlay
failure must never take anything live with it, and here the operator lost the ability to frame. The fix is
a small caption over the camera, not a plate.

### F-P5-12 — losing the network on RTMPS crashes the app

Run B, 2026-09-28 21:33:50Z: the first network cut over RTMPS killed the process. From the continuous
logcat (`.p5/p5-runb-20260928T211315Z.logcat.txt`):

```
E AndroidRuntime: FATAL EXCEPTION: DefaultDispatcher-worker-3
E AndroidRuntime: io.ktor.utils.io.ClosedWriteChannelException: Software caused connection abort
E AndroidRuntime:   at io.ktor.network.tls.RenderKt.writeRecord(Render.kt:18)
E AndroidRuntime:   at io.ktor.network.tls.TLSClientHandshake$output$2$1$1.invokeSuspend(TLSClientHandshake.kt:132)
E AndroidRuntime:   Suppressed: ...[CoroutineName(cio-tls-closer), StandaloneCoroutine{Cancelling}, Dispatchers.IO]
E AndroidRuntime: Caused by: java.io.IOException: Software caused connection abort
```

- **The exception is thrown inside Ktor.** StreamPack's RTMPS uses Ktor 3.3.3's TLS client, and the
  exception comes from Ktor's own `cio-tls-closer` coroutine. The spike's session scope has a
  `CoroutineExceptionHandler` (`SpikeSession.kt:57`), but this coroutine does not run in that scope, so the
  handler never sees it. The exception reaches the thread's uncaught handler, which on Android kills the
  process.
- **Our code saw the drop first.** StreamPack reported `endpoint-closed` 63 ms before the crash. The
  reconnect logic had its event and never got to use it.
- **It is a known class upstream.** An exception from a Ktor socket or TLS client, when the network is
  switched off on Android, cannot be caught by the caller:
  [KTOR-3565](https://youtrack.jetbrains.com/issue/KTOR-3565/Uncatchable-Software-caused-connection-abort-on-WSS)
  and [ktor#1734](https://github.com/ktorio/ktor/issues/1734).
- **Every earlier RTMP drop in this spike went to a laptop listener on plain `rtmp://`,** which has no TLS
  (`capture-background.sh`, `interrupt.sh`). That is why this was not seen before. The earlier drops on
  Cloudflare RTMPS (H-P5-1, 2026-09-14) were a clean stop and a `SIGKILL`: the app ended each one itself, so
  none of them took the network away from a live app.

**Why it matters:**

- **Hardware and RTMP-only clubs:** RTMPS is the only path for RTMP-only hardware (N5), but those
  encoders do not run this code. The app is what crashes.
- **Fallback:** under C1, RTMPS is where the app falls back when SRT will not connect. Any network blip
  after that fallback, such as a tunnel, a lift or a Wi-Fi handover, ends the broadcast and kills the app.
  It does not come back without a person.
- **Hold window:** the 180 s hold window gives nothing here, because no process is left to resume.

**For the product engine**, one of these:

- guard the process against this exception class, turning it into a session drop;
- move to a Ktor release that fixes it, after testing that it does;
- give RTMPS a TLS transport that raises errors to the caller.

Whichever is chosen, test it by cutting the network on RTMPS against Cloudflare, not a local listener.

**Guard measured on the device, 2026-09-28.** The spike's guard (`KtorAbortGuard.kt`, `a15c8d8` and
`4b00812`) swallows only an I/O failure raised from `io.ktor.network.` off the main thread. It never
swallows an `Error`, and never swallows a top-level exception from our own code. Across the three RTMPS
runs that followed, it swallowed **10** `ClosedWriteChannelException`s (`Broken pipe` or
`Software caused connection abort`), each within 50 ms of a `dropped`. There were 18 drops: 10 network cuts
and 8 far-end closes (F-P5-13). The process lived through every one and reconnected. So Ktor's closer
throws on more than half of all RTMPS drops; without the guard, each of those would have been Run B's crash.

### F-P5-13 — a reconnect can go dark while the phone and Cloudflare both say live

Short Run B, 20 s cut at 22:47:00Z (`p5-runb-20260928T224127Z`). The phone reconnected 1.4 s after the
network returned. For the next 4.5 minutes it sent 30 fps video and 47 audio frames a second at 2.7–3.4 Mbps.
Cloudflare's live-input status read `connected` from 22:47:39Z. Yet the playlist gained one segment (150 →
151) and then **stalled until the next cut**. The recording ended at the cut (303.8 s), and none of those
4.5 minutes is in any recording. Nothing on the phone could tell: every signal it has said LIVE.

It is not every reconnect. Nine RTMPS cuts of 60 s or less in three runs, all APK `af55dc7c…` or `6c81494f…`:

| Run | Cuts | Went dark | Resumed | First new segment after the network returned |
|---|---|---|---|---|
| `…T224127Z` | 20 s | **1** | 0 | never, for 4.5 min |
| `…T231316Z` | 20 s, 60 s | 0 | 2 | ≈ 5 s |
| `…T232909Z` | 6 × 20 s | 0 | 6 | 0.3–2.4 s |

In every resumed case the same pattern followed:

1. The far end closed the reconnected session about 31 s after it connected (`dropped … audioStreaming=true`).
   That happened after the 60 s cut too, when Cloudflare had already dropped the old session.
2. The phone reconnected within 3 s.
3. Viewers saw a 10–16 s freeze.
4. The broadcast stayed in one recording, which is criterion 4's shape.

The one dark case is also the one reconnect that the far end did *not* close 31 s later.

**The same shape on SRT, 2026-09-29 00:02Z** (final-soak smoke run `p5-soakf-20260928T235519Z`, one 20 s
cut). The phone was publishing again 1.5 s after the network returned. The playlist gained one segment,
then froze for about 36 s. The far end closed the reconnected SRT session 33 s after it connected
(`dropped … Connection was broken`). The phone reconnected in 2.7 s, and the playlist advanced from then on.
There was one recording. So the ~31 s second close is not RTMPS-only, and neither is a reconnected session
that Cloudflare accepts but does not package. On SRT that close healed it after about half a minute. On
2026-09-14 the SRT cuts showed only a ~25 s freeze and no second close was recorded on the phone.

**What this settles:**

- Criterion 4, one recording across a short outage, held in every cut on both transports.
- What a viewer gets after a reconnect inside Cloudflare's ~30 s notice window is not deterministic:
  - an immediate resume, with a 10–16 s freeze at the far end's close about 31 s later (RTMPS, 8 of 9);
  - a freeze of about 36 s until that close (SRT, 1 of 1 tonight);
  - a 4.5 min blackout, when the close never came (RTMPS, 1 of 9).
- It is silent at the phone and at Cloudflare's status API. Only a watcher on the delivered playlist saw it
  (`hls-watch`: `stalled`).

**What it does not settle:** the mechanism. The close about 31 s after a reconnect looks like Cloudflare
expiring the dead session and taking the stream key's live connection with it. That fits its ~30 s notice
time (H-P5-1). When the close does not come, nothing ever resets the unpackaged session. An RTMP-only
cause, such as a decoder config sent once per publish, is ruled out by the SRT case. None of this is tested.

**For the product engine:**

- The phone already holds the session's `playbackUrl` (the peek uses it). While publishing, it can watch
  its own delivered playlist. If the head has not advanced for about 20 s, it forces a reconnect.
- That turns a silent 4.5 min outage into roughly one more reconnect. It is also the only on-device signal
  for F-P5-3's "the app says LIVE, nothing is delivered", and for the 2026-09-14 packager stalls.
- The session record should carry the playlist's own verdict next to the transport's.

### F-P5-8 — a phone call silences the broadcast's microphone, and nothing says so

2026-09-28, an answered phone call while live. Android's audio server silenced the app's record track for
the whole call: `AF::RecordTrack: setSilenced … (silenced)` at 15:43:06.8Z, `(unsilenced)` at 15:43:19.5Z,
against a call that went active at 15:43:06.0Z and ended at 15:43:19.5Z. Audio frames kept counting at
~47/s, video kept 30 fps apart from a 2 s dip at answer, and the stream never dropped. The broadcast carried
13 s of silence, and neither the status line nor the CSV recorded it.

AGENTS.md §9 requires every audio-session interruption to be a visible state, never a silent one, and §6
makes the audio meter permanent because a quiet mic reaches YouTube quiet. A frame counter cannot see this:
the frames arrive, they are silent. The engine needs either the platform's silencing signal
(`AudioManager.AudioRecordingCallback` delivers `AudioRecordingConfiguration.isClientSilenced()` on
Android 10+; untested here) or a level floor on the encoded audio, and it must surface the result as a state.

**Detection on the device, 2026-09-28 evening** (`4fef392`, `0772888`). The callback works as described.
Our own recording is matched by its audio session ID (`tie=session` on every run):
- **Phone call:** `mic-silenced` fired 3 s before the driver saw the answer, and `mic-restored` 1 s after
  hang-up, with `msSilenced=11899`.
- **Status line during the call:** it read `LIVE rtmps — MIC SILENCED BY SYSTEM` in caution orange (HUD
  screenshots), and plain `LIVE rtmps` after.
- **WhatsApp:** its video calls silence the microphone too, for 33 s, 66 s and 36 s. So this is every call,
  not only a cellular one.
- **Unexplained:** one run logged an extra 1.2 s silence about 45 s after its call ended.

### F-P5-9 — another app taking a camera can starve the broadcast without stopping it

2026-09-28, WhatsApp video calls answered while live. The OnePlus gives WhatsApp the front camera (ID 1)
while the app holds the rear one (ID 0), and the broadcast suffers two different ways:

- **Call B (15:45:33.9–15:45:39.9Z):** video fell to 0 fps. The watchdog fired (`video-stalled`,
  `msSinceAdvance=3351`), the recovery reconnected, and video returned at 15:45:42Z, 3 s after WhatsApp
  released its camera (15:45:39.1Z).
- **Call C (15:47:17.7–15:47:48.4Z):** video fell to 1–20 fps **and audio to 1–9 frames/s** for about 20 s,
  with egress at 0–200 kbps. **No `video-stalled`**, because some frames still arrived and the watchdog
  fires only after 3 s with none. The session looked healthy while the broadcast carried a slideshow with
  broken audio.

Why one call stopped video and the other starved both tracks is not established. What stands:

1. **The watchdog needs a rate floor, not a zero test.** For example, fewer than 10 video frames/s or 20
   audio frames/s over 3 s while publishing.
2. **Camera contention is a normal operating event**, like a call. The operator needs the status line to
   name it. The product has to decide whether the engine should recover, or wait for the other app to
   release the camera and say so.

A call that only rings is harmless to the stream, but its full-screen ringing UI covered the app while it
was arming (call A, 15:45:04–15:45:21Z): `Target preview removed` and four `Capture failed`. The app still
armed.

**Detection on the device, 2026-09-28 evening** (`1d88c2c`, `518be6b`, `0772888`). Across three answered
WhatsApp video calls, `camera-contended cameraId=1 ownCameraId=0` fired as each call came up, before the
driver's own audio-mode poll saw it, and `camera-released` fired as each call ended. See "Interruption detection on the
device — 2026-09-28 evening" under Runs. All three calls also stalled video to zero, so the rate floor was
not exercised on the device (call C's shape did not recur). What those recoveries left behind is F-P5-10.

### F-P5-10 — after another app takes a camera, the broadcast can carry noise at full frame rate while every signal says LIVE

2026-09-28 evening, three WhatsApp video calls answered while live over RTMPS to the laptop listener. Each
time, WhatsApp opened camera 1 while the app held camera 0 (`camera-contended` at 16:59:17.1Z, 17:10:52.0Z
and 17:19:39.9Z). About 4 s later video stalled to zero, and the watchdog's recovery reconnected
(`video-recovered` at 16:59:24.1Z, 17:10:59.7Z and 17:19:46.9Z). **From then on, the encoded stream carried
green and purple macroblock noise at 30 fps.** It kept doing so after WhatsApp released its camera and until
the run stopped the app.

The listener decoded the stream and kept one frame a second (`e4028a6`), so this is the picture viewers
would get, not only the preview:

| Run | Last frame before the stall | After the recovery, camera still held | After `camera-released` |
|---|---|---|---|
| `…T170717Z` | `s2-0186` healthy | `s3-0005`, `s3-0040` noise | `s3-0070` (10 s after), `s3-0102` (end of run) noise |
| `…T171822Z` (heal test) | `s1-0056` healthy | `s2-0004` noise | `s2-0035`, `s2-0051` noise; after a forced rebuild, `s3-0005` to `s3-0089` still noise |

Nothing in the app noticed:
- The frame counter advanced at 30 fps, so the watchdog was satisfied.
- The status line read `LIVE rtmps`.
- The only outward sign was egress. The HUD showed 3.2–3.6 Mbps against 0.1–0.4 Mbps on the same dark
  scene before, because noise is expensive to encode.
- On Cloudflare, at a match, this is a broadcast of noise with a green Live badge.

**A stream-level rebuild does not heal it.** In the heal run, the stall hook forced one more recovery 22 s
after `camera-released` (`stopStream`/`startStream` and a reconnect, on the same camera session). The
picture stayed noise for the remaining 90 s. Every run so far that force-stopped and relaunched the app came
back with a healthy picture, including a browser run between the first and second WhatsApp runs.

The evening's runs left open whether the noise came from WhatsApp's concurrent open alone, or from our
recovery rebuilding the stream while the camera was held. The preview was healthy at 16:59:22Z, after the
stall, and noise at 16:59:26Z, after the reconnect. That fitted the rebuild, but a stalled preview may only
show its last good frame. The experiments below settle it.

**Measured on the device — the trigger and the remedy, 2026-09-28 20:00Z.** The APK was `9f34ef68…`, with
two experiments behind a runtime switch (`47b7c69` to `c7a4434`):
- `hold`: no rebuild while a camera is contended.
- `reopen`: on `camera-released`, reopen our camera through a camera-ID round trip, 0 → 1 → 0. The broadcast
  is muted to black for the round trip. The endpoint and encoders are untouched, so the stream is not
  stopped.
- `both`: the two together.

Each run was one WhatsApp video call over RTMPS to the laptop listener, with one decoded frame a second:

| Run | During the call | Picture | After `camera-released` |
|---|---|---|---|
| `hold` (`…T195840Z`) | Stall held (`held=camera-contended`); video came back **by itself** after 6.1 s, with no rebuild and no reconnect | Noise from the frame video came back (`s2-0298`) | Noise to the end of the run, about 100 s later. No heal |
| `reopen` (`…T200834Z`) | Stall, then the usual recovery rebuild | Noise after the rebuild (`s2-0001` to `s2-0022`) | Round trip took 1263 ms. One black frame, then a **clean, sharp picture** (`s2-0024` to `s2-0033`) until the owner moved the phone |
| `both` (`…T201338Z`) | Stall held; video came back by itself after 5.5 s | Clean before the call (`s1-0001` to `s1-0039`), noise from video's return (`s1-0040` to `s1-0059`) | Round trip took 1174 ms. One black frame (`s1-0060`), then **clean and live** to the end of the run, about 100 s (`s1-0061` to `s1-0158`) |

1. **The trigger is the concurrent open, not our rebuild.** In `hold` and `both` the stream was never torn
   down, and the picture was still noise from the moment video resumed. The first run's healthy preview at
   16:59:22Z was a stalled preview holding its last frame.
2. **A stream rebuild does not heal it; reopening the camera does.** Reopening healed the noise both after
   a rebuild (`reopen`) and without one (`both`). It took about 1.2 s, and the one black frame is the cost.
3. **The noise lasts for the whole call.** It stops only when the other app releases the camera and ours is
   reopened. For all of that time the status line reads `LIVE rtmps`, at 3.6 Mbps.
4. **The status line depends on the path.** Under hold, the stall read `NO VIDEO — camera in use by another
   app`. Without hold, the recovery read `NO VIDEO — recovering`, which says nothing about the other app.

These are single runs on one handset and one calling app.

Consequences:
1. **Frame arrival is not picture health.** The zero test (F-P5-6) and the rate floor (F-P5-9) both pass on
   noise. A cheap detector is an egress jump with no scene change, but that is a heuristic. Content checks
   cost CPU the encode may need.
2. **Rules for the product engine:**
   - hold, don't rebuild, while a camera is contended: the rebuild buys nothing;
   - reopen our camera on `camera-released`;
   - a reopen must complete, or be joined, before the next session starts. That race was parked in the
     spike (ledger ruling, 2026-09-28).
3. **Open, and a product decision:** what goes to air between the other app's open and its release. Today
   it is noise under a LIVE badge. Muting to black or a slate while contended is the obvious candidate. It
   is untested, and it would depend on `camera-contended` staying reliable.
4. **Prevention works** (N21). With Do Not Disturb on total silence, neither a phone call nor a WhatsApp
   video call reached the operator, and the broadcast was untouched.

Evidence:
- Evening runs: `.p5/p5-interrupt-whatsapp-20260928T165758Z.*`, `…T170717Z.*` and `…T171822Z.*`. These
  are the cited frames and HUDs, plus device events in the run logs; the rest is in the evidence tar.
- Experiment runs: `…T195840Z.*`, `…T200834Z.*` and `…T201338Z.*`, as frames, run logs and session JSON.

### H-P5-1 (hypothesis, with its test; measured 2026-09-14 — it holds) — on SRT the hold may start late, so dropout tolerance is not the configured number

Run A's hold ran **225.2 s** from ingest end against **183 s** measured over RTMPS
at the same `timeoutSeconds=180`, with only 4.16 s of detection uncertainty. The
proposed mechanism is close semantics rather than the hold itself:

- **RTMPS is TCP.** Even a `SIGKILL`ed publisher has its socket closed by the
  kernel, so Cloudflare learns the publisher is gone at once. That is why a clean
  cut and an abrupt kill landed 0.7 s apart over RTMPS — the close was identical
  in both, because the OS did it, not the process.
- **SRT is UDP.** A killed process closes nothing, so Cloudflare must expire its
  own SRT session before the hold can begin.

If that holds, **the hold is timed from when the platform notices the publisher is
gone, not from the last media it received**, and dropout tolerance on SRT is the
SRT session timeout *plus* `timeoutSeconds`. Anyone sizing tolerance from the
configured number is short by the difference — short in the direction that loses a
broadcast. It cuts the other way too: a stream that is already dead keeps serving
200s for longer, so the false-green window on SRT is wider than the 181.5 s
measured over RTMPS.

This is reasoning, not measurement, which is why it is labelled a hypothesis. Two
cells settle it and one does not — a single SRT clean stop confounds transport
with close semantics:

| Cell | Compared against | Isolates |
|---|---|---|
| SRT + clean stop | RTMPS clean cut (183 s) | transport |
| SRT + kill | SRT clean stop | close semantics within SRT |

If SRT-clean lands near 183 s, transport is innocent and close semantics own the
gap. If SRT-clean also lands near 213–225 s, the transport carries the extra ~30 s
however the publisher ends — the version that matters most for a phone, because a
real handset drop is never a clean close. Both cells are ours to run: SRT ingest
never started a broadcast on the bench account at all, so that arm was never
available there.

**Status 2026-09-12 evening — cells not scored.** The afternoon handset session
(`p5-1789214162964.csv`, CF video `79c59856…`, 400.65 s) is **not** those two
cells. Timeline:

| Time (Z) | What |
|---|---|
| 15:20:27.982 | SRT `publishing` (`connectMs=796`) |
| 15:20:40.249 | RTMPS `publishing` (`connectMs=533`) — **11.7 s of SRT, then RTMPS** |
| 15:20:44–15:21:35 | Peek marks; both browser and default UAs get **404** |
| 15:21:30–15:21:35 | mark-1…mark-8 fired in a 5 s burst (not protocol spacing) |
| 15:27:08.885 | Ingest ends (created + 400.65 s) |
| 15:27:16.692 | Last device sample, still `streaming=true` / `rtmps` / screen off |

No `dropped`, no `fell-back` event — the transport flip is a second
`connecting`/`publishing` pair, not C1's fallback signal. One recording, almost
entirely RTMPS after the first 12 s. No `hls-watch` CSV for this window landed
in `.p5/`, so hold-to-204 cannot be reconstructed. **H-P5-1 remains open;**
re-run the two SRT cells with the watcher teed.

A first attempt on 2026-09-13 is not scored either: its driver failed at the cut
and the handset published unattended for 50 minutes, which is where F-P5-4 came
from.

**Measured 2026-09-14 — H-P5-1 holds.** Both cells on the OnePlus, wifi off,
cellular, a fresh input each, 120 s of SRT publish, the watcher polling every
~1.3–1.7 s (so each 204 is bounded to that by the last 200 before it).

| | SRT clean stop | SRT kill (`am force-stop`) |
|---|---|---|
| Publisher ends | hold released 15:43:01.34Z; `service-stopped` 15:43:01.30 on the device clock (at most 0.14 s ahead) | force-stop 15:53:01.69–02.16Z; last device sample 15:53:01.63 on the device clock |
| Recording end, created + duration | 15:42:59.25Z | 15:53:02.41Z |
| Last playlist head advance | 15:43:01.094Z | 15:53:05.095Z |
| Cloudflare `client_disconnect` | 15:43:01.408Z | **15:53:32.176Z** |
| Last 200 / first 204 | 15:46:02.517Z / 15:46:03.860Z | 15:56:33.097Z / 15:56:34.708Z |
| Polls carrying `EXT-X-ENDLIST` | 0 | 0 |
| **204 − Cloudflare's disconnect** | **182.45 s** | **182.53 s** |
| **204 − recording end** | 184.61 s | **212.30 s** |

Against RTMPS on the bench account, 183.5 s clean and 182.8 s killed, measured
from the end of media.

What it settles:

- **The hold is timed from when Cloudflare notices the publisher is gone, not from
  the last media it received.** Measured from the disconnect, the two cells land
  0.08 s apart; measured from the end of media, they land 27.7 s apart.
- **Transport is innocent; close semantics own the gap.** SRT with a clean close
  matches RTMPS. A clean close is noticed within about a quarter of a second of
  the app stopping. A killed publisher is noticed **about 30 s** later: 29.8 s
  after the recording's end and 30.0–30.5 s after the force-stop. The unattended
  retry in F-P5-4 agrees independently, at about 31 s between the process's last
  sample and Cloudflare's disconnect.
- **A phone that vanishes without closing therefore gets about 212 s, not 180.**
  Killed, crashed, or cut off from its uplink, which is how a handset at a ground
  actually drops, it leaves no close behind it. The configured number understates
  how long the platform waits, and that is the safe direction for sizing
  tolerance. It is the unsafe direction for everything reading "ended": a dead
  SRT stream keeps serving 200s for about 212 s after its last frame, and anything
  downstream that treats 180 s from the last media as the end is about 30 s early.

Still open:

- **A reconnect inside the ~30 s notice window — answered the same day: it is
  accepted.** See *Reconnect inside Cloudflare's notice window* below. The note
  first written here, that F-P5-2's sessions were closed by Cloudflare, read too
  much into `endpoint-closed`: the 20 s cut produced the same reason with no
  network at all, so it says the phone's endpoint closed, not who closed it.
- **Run A's residual.** Its 225.2 s is 12.7 s more than the kill cell's 212.3 s.
  Run A's process died during screen-off rather than by force-stop (F-P5-3), and
  its input's status history has since been overwritten by a later session, so its
  notice time cannot be recovered.

Method, for whoever repeats this: Cloudflare's own live input status is the direct
clock for "noticed". `GET /stream/live_inputs/<uid>` returns
`status.current.statusEnteredAt` with reason `client_disconnect`, but it keeps only
the latest session per input, so read it straight after each cell. Created +
duration was usable here because both recordings pass F-P5-4's regularity check:
67 and 69 segments of ~2 s, 30.02 fps, largest frame gap 39 and 36 ms. Evidence:
`.p5/p5-h1-clean-20260914T154012Z.*` and `.p5/p5-h1-kill-20260914T155017Z.*`
(driver log, watcher CSV, power samples, device CSV); inputs `fab08b34…` and
`766971f7…`; videos `e2f192ec…` and `ad27e224…`.

### Reconnect inside Cloudflare's notice window — measured 2026-09-14

H-P5-1 left one question: a phone that loses its uplink leaves no close behind,
Cloudflare takes ~30 s to notice, and a reconnect inside that window might be
refused while the platform still holds the dead session. Two cells on the OnePlus,
cellular with wifi off, a fresh input each, mobile data switched off with
`svc data disable` (measured first: data returns in ~0.9 s, airplane mode in
~3.0 s), and Cloudflare's live input status sampled every second.

| | 10 s cut | 20 s cut |
|---|---|---|
| Data off → on | 16:11:59.35 → 16:12:09.83Z (10.5 s) | 16:20:18.14 → 16:20:38.39Z (20.2 s) |
| The app | no `dropped`; `streaming=true` throughout | `dropped` (`endpoint-closed`) 6.0 s after the cut; retries every 2 s failed on DNS with `validated=false`, so none counted toward fallback; `publishing` 2.3 s after restore |
| Egress column during the cut | 3.5–4.5 Mbps with `network=none` | 3.1–5.7 Mbps with `network=none` until the drop |
| Cloudflare status | `connected` unbroken from 16:10:46Z to the clean stop | new session `connected` 16:20:41.150Z; old session `client_disconnect` 16:20:48.867Z |
| Playlist head | frozen ~8.8 s; `stalled` after 6 s; same variant | frozen ~25.4 s; `stalled` after 6.2 s; moving again 16:20:47.1Z in the same variant |
| Recordings | **1** (165.68 s) | **1** (161.99 s) |
| The seam | one 0.121 s video PTS gap at media 75.3 s; one 1.75 s segment | one 0.158 s video and 0.224 s audio PTS gap at media 74.0 s; all 81 segments regular; no discontinuity tag |
| Wall time absent from the recording | ~11 s | ~25 s |
| Hold after the clean stop, from Cloudflare's disconnect | 182.38 s | 182.43 s |

What it settles:

- **Cloudflare accepts a reconnect while it still holds the dead session.** The new
  SRT session connected 7.7 s before Cloudflare declared the old one gone, on the
  same stream ID, and the broadcast carried on in the same playlist variant and
  the same recording. No refusal, so no fallback provoked by one.
- **A dead network does not trigger fallback.** Retries during the cut failed on
  name resolution with `validated=false`, which the engine does not count toward
  C1's three failures, so the phone came back on SRT as designed.
- **Lost seconds are spliced out of the recording.** Both recordings are single,
  regular and continuous, with a seam of a few hundred milliseconds where 11 s and
  25 s of wall time went, and nothing in the playlist marks the place. It is
  F-P5-4's missing 650 s reproduced on demand: a recording's duration is media
  received, never time on air.
- **A ~10 s cut never reaches the session layer.** No drop on the phone, no
  disconnect at Cloudflare. Only the playlist showed it, as a stall the new 6 s
  threshold caught and the old 9 s one would not have.
- **Criterion 4's shape on SRT:** a drop well inside the hold resumes into one
  recording, at 10 s and at 20 s. Run A never reached its minute-65 outage, so this
  is the first evidence for it on this transport.
- **The hold is four for four:** 182.45, 182.53, 182.38 and 182.43 s from
  Cloudflare's disconnect.

Still open:

- **Why the 10 s cut left the session alive.** The 20 s cut dropped 5 s after the
  phone reported no network, yet the 10 s cut had 8 s with no network and no drop.
  So survival is not a fixed timeout, and this is not understood.
- **What a viewer's player does at the seam** — rebuffer, skip, or stall out — is
  unmeasured.

Evidence: `.p5/p5-reconnect-10s-20260914T161013Z.*` and
`.p5/p5-reconnect-20s-20260914T161826Z.*` (driver log, watcher CSV, Cloudflare
status CSV, power samples, device CSV); inputs `919db59b…` and `a7db40f5…`; videos
`d4036285…` and `69e03e52…`.

## Runs

### Run A — SRT, cellular, 3 h

| Minute | Action | Mark |
|---|---|---|
| 0–5 | Baseline, not publishing | — |
| 5 | Start SRT | mark-1 |
| 35 | Lock screen 10 min | mark-2 / mark-3 |
| 65 | Airplane mode 20 s | mark-4 / mark-5 |
| 95 | Rotate phone 180°, 2 min, rotate back | mark-6 / mark-7 |
| 125 | Airplane mode 200 s | mark-8 / mark-9 |
| 185 | Stop | mark-10 |

Two protocol notes for the screen-locked step (minute 35):

- **Unplug the power bank for it.** Stay-awake-on-USB is set on this handset (`svc power stayon
  usb`) and charging suppresses Doze, so a plugged screen-off test measures nothing. Check the CSV
  shows `charging` false for those rows, then plug back in at mark-3. Criterion 9 is read over the
  charging rows only.
- The foreground service takes a wake lock by default. To measure a lock cycle *without* it, put an
  empty file at `/sdcard/Android/data/com.seazn.capture/files/p5-no-wakelock` before arming (`adb
  push` it, `adb shell rm` it to undo); the `service-started` event carries `wakeLock` true or false
  either way, so the CSV always says which cycle was measured.
- **The unplug is simulated, and the CSV says so.** adb runs over the USB cable and Run A uses
  cellular with wifi off, so a physical unplug would kill the driver mid-run. The driver calls
  `dumpsys battery unplug` at minute 35 and `dumpsys battery reset` at minute 45, giving the framework
  the discharging state Doze actually reads while USB keeps the phone powered. Verified before the
  run: `AC powered: false, USB powered: false` immediately after the call, so it is not an OEM no-op.
  The window is therefore evidence about criterion 6 and **none at all** about drain — the handset
  really is still charging — and the mark is labelled `mark-2-unplug-simulated` so the CSV cannot be
  read otherwise. Criterion 9 is read over the charging rows, which excludes this window by
  construction.

**Cellular cost is a product fact, not a test cost.** 3000 kbps video plus 128 kbps AAC is about
1.41 GB/h, so a 3 h match is roughly **4.2 GB** on the organiser's own data allowance, every match.
That constrains who can realistically use the phone path at all, and is an argument for a lower
default bitrate on cellular than on wifi. The compositor side of the programme never sees this cost,
so if it is not recorded here nothing records it.

Results — **ABORTED at about minute 97, 2026-09-12.** Ingest ran 10:28:51Z to
about 11:02:09Z (33 min 18 s of the intended 180) and then stopped. adb was lost
in the same window. Nothing below is a three-hour result, and the criteria the
protocol never reached are marked *not reached* rather than left blank, so an
empty cell cannot be mistaken for a pass.

| Criterion | Result | Evidence |
|---|---|---|
| 1 | **100%, and that is the problem.** 1985 of 1985 samples publishing across the whole 33 min window. But Cloudflare stopped receiving at 11:02:09.8Z while the app went on reporting `streaming=true` until 11:02:20.7Z, so about 11 of those samples are false. **Criterion 1 therefore scored a perfect pass on a run that died** — it counts the app's own flag, and the flag was lying. **The certificate was issued by the thing being certified.** Numerically the error is 0.55%; in principle the criterion cannot detect this failure mode at all, and needs cross-checking against playlist advancement to mean anything | `run-a-full.csv` via `telemetry-report.ts` |
| 2 | **Pass.** Peak status 2, never reached 3, across the full window. Battery 32.7 → 39.4 °C, headroom 0.53 → 0.77 | 2476 samples in `run-a-full.csv` |
| 3 | **Pass.** 60 s rolling means over the full window: min **3949.2** / median **4181.0** / p5 **4158.1** kbps, all above the 3000 floor. Reads high because it counts audio, container and SRT overhead, as the note above says | `telemetry-report.ts` on `run-a-full.csv` |
| 4 | **Not reached.** The minute-65 outage never happened — the driver issued it after adb was gone | — |
| 5 | **Not reached** as designed — no minute-125 outage, so the split is untested. But the unplanned death answered something more useful: **no `EXT-X-ENDLIST` is ever served at `timeoutSeconds=180`.** My playlist sat frozen at head 997 for ~3.5 min, last 200 at 11:05:50.9Z still serving segments, then master 204 at 11:05:55.0Z — a 4.16 s gap, too small for an ENDLIST to appear and vanish inside. A controlled pair run elsewhere on this account settles that it is the *value* and not the manner of ending: a clean cut (SIGINT, trailer written) and an abrupt death (SIGKILL) both reached 204 with no ENDLIST, at +183.5 s and +182.8 s — 0.7 s apart — while 10 and 60 both emit one at ≈ timeout + 3 s. **Consequence for the whole programme: nothing may treat `EXT-X-ENDLIST` as the end-of-stream signal, because at the value we would configure it never arrives.** One difference stays open: my hold ran **225.2 s** from ingest end (212.3 s from the last head advance) against their 183 s, and my detection uncertainty is only 4.16 s, so it is not measurement lag. See **H-P5-1** for the proposed mechanism and the two cells that would settle it — settled 2026-09-14: the hold runs 182.5 s from when Cloudflare notices the publisher is gone, and for a killed SRT publisher that is about 30 s after its last media | `p5-run-a.hls2.csv` lines 673–759 |
| 6 | **Failed, and the cable is largely exonerated.** Delivery stopped 3 min 22 s into the 10-minute screen-off window. Three independent clocks separate the two candidate causes without needing the handset: ingest stopped at **11:02:09.8Z** (10:28:51.599Z plus the recording's own 1998.23 s); the device wrote its **last telemetry row at 11:02:20.7Z**, still claiming `streaming=true` at 4.4 Mbps; and **adb was still alive at 11:02:51–57Z**, when a background check successfully ran `adb shell` against that CSV. So the cable was still connected when delivery ended, and the 1 Hz sampler had stopped writing ~35 s before a read that still worked — with `SpikeLog` flushing on every write, that is not buffering. The app stopped while the device was reachable, which points at the process being killed or frozen during screen-off rather than at the unplug. **Mechanism from on-device CSV:** zero `dropped` / `error` / `service-stopped` rows — the process ceased without the transport observing a close (see F-P5-3) | `cf.ts videos`, `p5-run-a.hls2.csv`, `.p5/run-a-full.csv`, the 11:02:5x watcher output |
| 7 | **Not reached for the flip; partial on encoded orientation.** Minute-95 never happened, so the three P4 assertions (preview / encoded / rotation metadata across a 180° flip) cannot be scored. What the 33 min recording *does* show: encoded picture is **1280×720** landscape throughout (early / mid / late HLS samples), with **no rotation side_data** — pixels carry the orientation, not a display matrix. **Upright is confirmed by eye**, which geometry could not do: frames at t=300 s and t=1900 s both show floor signage whose lettering reads correctly, and a 180° rotation would invert it — a flipped picture is also 1280×720 landscape with no rotation matrix, so the columns above are consistent with an upside-down broadcast. Preview and flip still need a live handset | HLS samples from `94f526ff…` via ffprobe; download enabled at `…/downloads/default.mp4` |
| 8 | **Fail** on every 20 s sample pulled from the recording. mean_volume **−42.3 / −47.9 / −60.2 dB** (early ~2 min / mid ~16 min / late ~30 min), all below the −40 dB floor. max_volume −19.2 / −20.1 / −38.9 dB. The mid reading matches the MP4 download byte-for-byte on volume, so this is not an HLS packaging artefact. Quiet room + phone mic, not a dead encoder — but the criterion is a level floor, and the floor was missed. **Not a screen-off mute either.** The late −60.2 dB reading sits on the screen-off boundary (t≈1797 s), which could have meant Android handing a backgrounded app a silenced mic, so a per-10 s RMS timeline of the whole audio rendition was taken: the level had already fallen to −57…−61 dB about **45 s before** screen-off; **0 of 200 windows are digital silence** (floor −66 dB, a quiet room's noise floor rather than zeros); and **−41 / −40 dB of real sound was captured at t=1955–1965 s with the screen off**. The `microphone` foreground service kept capturing through screen-off until the process died | `.p5/run-a-sample-{early,mid,late}.ts` + volumedetect; MP4 download mid agrees; `.p5/run-a-audio-rms10s.txt` |
| 9 | **Not reached**; the floor over charging rows was 57% when the run died. The supply is a finding in itself, though not for the reason first written here: this row originally cited `Max charging current: 900000` µA at 5 V as a **4.5 W** ceiling, but on this build that field carries a broadcast timestamp of +1d19h, i.e. it is never refreshed, so it says nothing about any supply and **the 4.5 W figure is withdrawn**. The drain is what is measured. Battery fell 68% → 57% by minute 39, between 14.7 and 28%/hour depending on the window. It is not marginal: after the relaunch, **idle and not publishing**, the handset still lost 61% → 54% in 53 min on the same supply. A power bank or powered hub is a prerequisite, not a convenience. **Retry 2026-09-12 afternoon:** handset is on the **Anker USB-C hub** (adb `12be753e` alive), still reporting the same stale `Max charging current` (so no evidence either way), and `batterystats` shows discharge steps into the mid-30%s while USB-powered — so this hub path is bus-powered (or under-powered) and does **not** yet clear the gate. Prefer a *wall-powered* hub so the existing adb driver survives; a power bank only if marks / screen / airplane / stop are redesigned without adb. **Supply under load, 2026-09-13: FAIL.** With the battery full, only a charge counter held under encode load can prove a supply, so it was sampled every 15 s through 11.4 min of continuous SRT publish: **3,722,000 → 3,530,000 µAh, 192 mAh in 684.7 s = 16.8 mAh/min**, against a pre-registered pass of about 2 mAh/min and 10–18 on the old supply. Battery 33.8 → 43.4 °C. The display read **100%** and the HUD **charging** throughout while 192 mAh drained, so criterion 9 is read from the charge counter, never the percentage or the charging flag. `Battery current` on this OPLUS build is negative when charging and positive when discharging, so the positive values seen during Run A were net discharge. From full at that rate a 3 h soak ends near 19%, under the floor: the soak still needs a wall-powered supply; the few-minute H-P5-1 cells do not | `dumpsys battery`, `run-a-full.csv`; hub recheck via `adb` + `ioreg`; `.p5/p5-h1-clean-20260913T095410Z.power.csv` |

**Two things the frames settle that no column could.**

The encoded stream carries **no overlay**. Frames 26 minutes apart are clean
camera, while the device's own UI had the Tier A scorebug on screen throughout
(`Live · H2 · seazn · ENG4 · CRO2` in the uiautomator dump). That is the
architecture working as intended and not a defect: the phone is a camera with a
network stack, and the scorebug is composited downstream by the browser source —
which is precisely why §7 says the operator sees the score slightly *ahead* of
what viewers see. It is recorded because the opposite is a natural assumption:
anyone concluding from the on-screen preview that the phone burns the overlay
into the broadcast would be wrong, and would then mis-size both the encode and
the compositor's job.

And the t=1900 s frame sits **inside the screen-off window**, showing correct,
upright, properly framed picture. So criterion 6's failure was delivery stopping,
not the camera path degrading first — the encoder was still doing its job when
the process died.

The final 72 seconds confirm it at frame level: **2160 frames at 30.02 fps, the
largest interval 34 ms (one frame), none over 50 ms, the last frame at
t=1998.49 s** — the recording's own end. Delivery ran at an unbroken cadence and
then stopped. One caveat travels with that: Cloudflare re-encodes at a constant
30 fps, and a constant-rate transcoder can paper over an ingest gap by repeating
frames, which on a static scene would be invisible. So the cadence is consistent
with an abrupt kill rather than proof of one; the case rests on it together with
the audio timeline and the handset's own 4.1–4.4 Mbps to its last sample.

Two mid-run interventions, both recorded so the curves stay readable:

- **Brightness lowered** at ~10:39Z (3622 and adaptive → 80 and manual), marked
  `brightness-lowered-for-battery`. It did **not** slow the drain measurably.
- **The unplug at minute 35 was simulated** with `dumpsys battery unplug`, marked
  `mark-2-unplug-simulated`. See the protocol note above.

And one measurement trap, paid for here: the handset's last sample claimed
`streaming=true` at 4.4 Mbps about **11 seconds after Cloudflare had stopped
receiving**, because `videoBitrate` is the delta of the SRT endpoint's
cumulative `bytesWritten` and retransmissions into a broken link still count.
**Measured egress is not delivery.** Criterion 3 says what the endpoint sent;
only the playlist head says what arrived. Read them together or not at all.

Thermal curve (minute → status, headroom, battery °C):

### Soak A — SRT, cellular, hands-off and cable-free — 2026-09-14

**Setup.**

- **Handset and build:** the OnePlus with the delivery-telemetry build (`890da01`). The telemetry was checked
  on the live session before the unplug: 30.02 fps video, 46.88 audio frames/s, SRT RTT 31 ms, and an
  `exit-history` row present.
- **Uplink:** a fresh input (`b99563f0…`), wifi off, roaming cellular.
- **Screen:** on, with manual brightness 80 (of 8191); the app in the foreground.
- **Start:** warm, by the owner's decision (thermal 1, battery 38.6 °C). SRT publishing from 16:59:14Z.
- **Power:** the cable came out at 17:02:33Z onto the phone's own wall charger.
- **Watching:** from the laptop only, polling the playlist every 2 s and Cloudflare's status every 5 s.
- **Plan:** 3 h.

| Time (Z) | What |
|---|---|
| 17:12:14 | Thermal status 3 (severe); it stays there, never reaching 4 |
| 17:00–17:40 | Egress median 3.7–4.0 Mbps at 30 fps |
| 18:20–19:12 | Egress median 0.52–0.70 Mbps, still 30 fps, RTT ~31–35 ms, no SRT drops |
| 19:12:50 | Egress already ~4.3–4.9 Mbps; SRT clean (no loss, RTT ~35 ms) through 19:14:08 |
| 19:12:56 | Playlist head stops at 3998 while SRT reports clean delivery; see the correction under F-P5-5 |
| 19:14–19:16 | SRT distress begins: retransmits, send buffer to 2 s, RTT to 1.66 s |
| 19:13:38 | Last segment packaged in broadcast 1 |
| 19:16:41 | App `dropped` (`endpoint-closed`); Cloudflare `client_disconnect` the same second |
| 19:16:44 | Reconnected; **video frames 0/s from here**, audio normal, HUD `LIVE` (F-P5-6) |
| 19:22:5x | Owner replugs the cable so the phone can be read live; no longer cable-free |
| 19:27:22–43 | Controller forces a reconnect with a 20 s mobile-data cut |
| 19:27:45 | Publishing again; 30 fps back on the phone |
| 19:27:48 | Cloudflare opens broadcast 2 |
| 19:27:45–19:36:54 | 3.3–3.9 Mbps offered into a link estimated at 1.2 Mbps; send buffer pinned at 2.05 s |
| 19:36:54.7 | Owner stops with Hold to stop; Cloudflare `client_disconnect` 19:36:56.297 |
| 19:39:58.577 | First 204: hold **182.28 s** from the disconnect, the fifth measurement at ~182.3–182.5 s |

**Recordings.**

- **Broadcast 1** (`f49c893b…`): 8031.32 s (2 h 13 min 51 s). 4009 segments, 4003 of them ~2 s. No
  discontinuity. 30.02 fps with a largest gap of 34 ms in every window sampled from media 60 s to 7950 s.
- **Broadcast 2** (`9a5eb609…`): 181.01 s of audio with no video; see F-P5-5.
- **What viewers got:** nothing from 19:13:38Z to 19:27:48Z, then an audio-only broadcast until the stop.
  That is about 23 of the run's 158 minutes without a picture.

| Criterion | Result |
|---|---|
| 1 | **Fail.** From publish to stop the streaming flag said publishing in 99.79% of samples, while no picture reached viewers for the last ~23 minutes. The flag half of the criterion passes a run whose playlist half fails, as Run A warned. |
| 2 | **Pass.** Peak thermal status 3 from 17:12:14Z to the end; never 4. Battery peak 46.8 °C. |
| 3 | **Fail as written — read it with care.** Egress median 1.89 Mbps over the run. For the hour before 19:13 it was 0.5–0.7 Mbps at a full 30 fps: VBR on a still scene, below the floor without anything shedding. After 19:16:44 it was ~180 kbps of audio only. Egress still cannot show delivery (F-P5-5). |
| 4–7 | Not in this run's hands-off shape. |
| 8 | Not measured. |
| 9 | **Pass.** Battery floor while charging 55%; it ran 56% → 68% on the wall charger. |

**Telemetry totals** (`telemetry-report.ts`):

| Measure | Value |
|---|---|
| Video fps | median 30.01, minimum 0 |
| Audio frames/s | median 46.87 |
| SRT send drops | 184,022 |
| SRT retransmits | 8,840 |
| SRT write-lost | 11,282 |
| RTT | p50 33 ms, max 2234 ms |

**Method notes paid for here.**

- **The cable-free alarm had a blind spot.** Relaunched after a stall, it could not fire again until it
  had seen a fresh advance, so it stayed silent through the second freeze. It was fixed during the run.
- **A probe of a frozen live playlist re-reads old segments.** `ffmpeg -live_start_index` on a playlist
  that is not advancing measures pre-freeze media, and it briefly reported the stream as recovered when it
  was not.

Evidence:

- `.p5/p5-soak-a-20260914T165838Z.*`: log, env, watcher CSV, Cloudflare status CSV, device CSV, and
  `report.json`.
- The live diagnosis capture `p5-soak-a-20260914T165838Z.diag-20260914T192258Z/`: screenshots, logcat,
  camera, services, thermal, power and process dumps.

### Delivery safeguards on the device — 2026-09-14 evening

**Setup.**

- **Build:** the safeguards build (`7f714e7`, `41261b3`, `b6dd050`) on the OnePlus.
- **Uplink:** roaming cellular with wifi off, the same link Soak A ended on.
- **Run:** one SRT publish on a fresh input, deleted afterwards.
- **Note:** a first attempt died at setup because the phone was at its lock screen; the app launches behind
  the keyguard and never arms. The driver now dismisses the keyguard and fails loudly if it stays up.

**A — healthy, 150 s: watchdog and status line pass.**

- 0 `video-*` events.
- Video 30.01 fps.
- A `regulator` event (SRT, floor 500k, ceiling 3000k, start 3000k).
- Column 25 filled in 149 of 149 publishing samples.
- Status line `LIVE srt`.

**B — stall hook pushed while video flowed: pass end to end.**

| Time (Z) | Event |
|---|---|
| 21:22:36.9 | Hook pushed |
| 21:22:37.2 | `video-stall-simulation present=true` |
| 21:22:40.4 | `video-stalled msSinceAdvance=3007 audioAdvancing=true`, 3.7 s after the push |
| 21:22:40.4 | `dropped reason=video-stalled` → `video-recovery attempt=1 simulated=true` → hook file deleted |
| 21:22:43.3 | Publishing again (510 ms), regulator starting at 1000k |
| 21:22:43.9 | `video-recovered msStalled=6529` |

The status line read `NO VIDEO — recovering` in caution orange during the stall and `LIVE srt` after. The
Tier A scorebug kept its own red `Live` badge throughout. That badge comes from the fixture, not delivery,
and §7 forbids re-rendering it, so the product has to decide whether the overlay preview sheds or dims while
no video is delivering.

**C — 20 s mobile-data cut: transport handling passes, regulation needs tuning.**

- **Transport:** SRT dropped 6 s into the cut. Retries failed on the dead network without counting toward
  fallback, and publishing resumed 2.3 s after data returned. The new attempt's regulator started at the last
  target (500k), not the ceiling.
- **The encoder follows the target mid-stream:** egress ~0.75 Mbps at the 500k floor and 1.6–2.1 Mbps at
  1.5–1.75M targets. That settles the report's open question about `c2.qti.avc.encoder`.

**The regulator's direction is right and its raise is wrong for a weak link.** This link carried about
0.8–1.0 Mbps in total. Across phases A and C:

- At connect, 3000k went straight in: send buffer 1.3–1.9 s, 1,512 sender drops, floor reached in 7 s.
- It then saw-toothed about ten times in four minutes. Each time the send buffer drained to ~50 ms, it
  raised (in one case 750k → 1750k in 8 s, a raise every 2 s), and within 2–4 s the buffer was back at
  ~1.9 s and it cut to the floor.
- **Every probe dropped picture:** 360–470 packets per probe, and about 1,350 after one post-reconnect raise.
  Egress stayed at 1.25–1.46 Mbps against a 500k target while the backlog drained.

Needed before any soak:

- Raise far more slowly.
- Remember a target that failed and hold below it for minutes.
- Judge capacity from measured egress, not the target: audio, TS overhead and retransmits added
  0.25–0.6 Mbps here.
- Start below the ceiling.
- Write the `regulator` event only when a connect succeeds (a cut wrote eight).
- Ignore the negative send-buffer readings.

Evidence: `.p5/p5-safeguards-20260914T211920Z.*` (log, device CSV, watcher and status CSVs, HUD screenshots
A, B-stall and B-after).

### F-P5-6 repro attempts — 2026-09-14 late evening

**Attempt 1 — rotate while live, then a 20 s data cut.** Not exercised. The owner turned the phone while it
published (`rotation 0 → 1`, 0.75 s apart). The data cut was real — `network=none` for 18 s, send buffer
pinned at 2 s, sender drops 2,749 → 6,054 — but the SRT session survived it with no `dropped` event. There was
no stop, so any pending rotation was never consumed, and video stayed at 30 fps. Whether a cut drops SRT is
not consistent: the 10 s cell rode through, one 20 s cell dropped at 6 s, and this 20 s cut rode through.

**Attempt 2 — rotate while live, then stop and restart in the same process.** Aborted before the stop, and
it turned up something else. At 21:56:03.9Z the system log records the app **going to the background**:
`switch to background`, focus to the launcher, the task moved `TO_BACK`, `setAppVisibility visible=false`,
the window at `viewVisibility=8`, and `CLOSE_SYSTEM_DIALOGS reason:recentapps`. The app's `rotation 0 → 1`
events (0.32 s apart) are the portrait launcher and the app's return, not a turn inside the app. Within a
second of that:

- **Video died with no stop or reconnect:** egress 6.2 Mbps → 176 kbps of audio.
- **The watchdog caught it:** `video-stalled` at 21:56:10Z, `msSinceAdvance=3006`, audio advancing, then
  `dropped reason=video-stalled` and `video-recovery attempt=1`.
- **The recovery never reconnected:** `streaming=false` from 21:56:12Z, with **no `connecting` event in the
  14 s** before the driver force-stopped the app (a normal retry emits one within 2 s).
- **The driver's Stop press did not register.** Whether the app's intent queue was blocked or the press
  landed on the launcher is **not established**.
- **The evidence is gone.** The app's own log lines for the recovery had rolled out of the device's log ring
  buffer by the time they were read, about 8 minutes later. Device repros now stream logcat to a file.

**Driven by adb, backgrounding does not reproduce it.**

- **Home while live, 10 s away:** video dipped to 16–19 fps for ~2 s, then ran 30 fps in the background and
  after the return. No stall, no drop.
- **Recents while live, back in ~1 s:** video and audio hitched for ~2 s (12–20 fps, audio 7/s), then 30
  fps. The same `rotation 0 → 1` pair, 0.39 s apart. No stall, no drop.

So the dead video at 21:56Z needed more than a trip to the background. The owner was handling the phone
physically at the same moment, and it may simply be intermittent. Two things stand:

1. **Going to the background while live can kill video** on this build. The watchdog detects it within ~5 s.
2. **Stall recovery can fail to reconnect at all.** That is the more serious half: an unrecoverable session
   the operator may not be able to stop. It is open until a repro captures it with continuous logcat and a
   thread dump.

For the product (AGENTS.md §9): an operator pressing Home or taking a call while live is a normal event, not
an edge case. Its test is a lifecycle cell with the frame counters on, not a soak.

Evidence: `.p5/p5-rotation-repro-20260914T212628Z.*`, `.p5/p5-rotation-restart-20260914T215359Z.*`,
`.p5/p5-background-20260914T215942Z.*`, `.p5/p5-lifecycle-recents-1s-20260914T220309Z.*`.

### F-P5-6 caught with continuous logcat — 2026-09-14, 22:26Z

A later run reproduced both halves over RTMPS, publishing to an ffmpeg listener on the laptop through
`adb reverse` (no Cloudflare), with logcat streamed to a file. HOME at +25 s, app back at +31 s. The app's
own log gives the sequence:

1. **HOME removes the preview surface.** `PreviewView onWindowVisibilityChanged 8` → `Stopping preview` →
   `surfaceDestroyed`; the camera logs `Error queueing buffer to native window: No such device (-19)`.
2. **That stops the encoder's frames too.** `CameraController: Target preview removed`, then
   `CameraSessionController: Capture failed with code 0` twice, and `c2.qti.avc.encoder` input fell
   27 → 5 → 0 fps within two seconds. The foreground service kept publishing audio.
3. **A rotation was left pending,** but the video died before any stop:
   `EncodingPipelineOutput: Can't change rotation to 0 while streaming. Waiting for stopStream`.
4. **The watchdog fired** 3.0 s after the last frame (`video-stalled`, audio advancing) and started a recovery.
   StreamPack stopped the audio input, then the video input and all outputs.
5. **The recovery never reconnected.** From then on the audio encoder logged
   `Failed to get input buffer: IllegalStateException: Audio source is not recording` several times a
   millisecond, and no `connecting` followed for the 90 s before the app was force-stopped.

Two caveats. OPLUS log flow control (`LOGS OVER PROC QUOTA`) dropped the app's logs within a second of
step 5, so the silence after it is not evidence of a hang; only the missing `connecting` in the device CSV
is. And these files lived in a scratch directory that has since been cleared; the sequence above survives
in the working ledger only.

### F-P5-6 follow-up and the retuned regulator — 2026-09-28

**Background, again, does not kill video on its own.** Same driver, same pre-tuning build (the
`capture-background` runs):

- **HOME for 5 s over RTMPS:** the same steps 1 and 3 as above — preview stopped, surface destroyed,
  `Target preview removed`, a pending rotation — but **no `Capture failed`**. The encoder kept 30 fps
  through the transition (13–34 frames/s in the transition seconds, then 30), and the listener received
  30 fps with no gap.
- **Simulated stall over RTMPS** (the stall hook, a listener that accepts reconnects): `video-stalled` 5.0 s
  after publishing (the first-frame grace), reconnect 2.1 s after the recovery began, `video-recovered`
  `msStalled=8024`, then 30 fps for 1 min 51 s. **Recovery over RTMPS works.**

So losing the preview surface alone does not stop encoder capture, and RTMPS recovery does not hang as such.
Both failures on 14 Sep came with the camera session itself failing (`Capture failed`). That run started
straight after a driver was killed with SIGKILL mid-publish, and minutes before it, the armed app's encoder
`SurfaceTexture` read `Frames produced 0`. **Hypothesis, not proven:** both defects need a camera session
already in a bad state. Its test: kill the app mid-publish, relaunch, then HOME while live.

**That test, run 2026-09-28 21:03Z: not reproduced.** The setup was RTMPS to the laptop listener:
1. A `capture-background.sh` run published for 10 s.
2. Its driver and listener were then killed with SIGKILL.
3. The app was left retrying every 2 s (`EOFException`) for 20 s.
4. A fresh run force-stopped and relaunched it, published, and pressed HOME for 5 s at +25 s.

What happened:
- `CameraSessionController: Capture failed with code 0` was logged at the HOME press (21:04:38Z).
- Video kept going regardless: 30 fps before HOME, 22–28 fps in the transition seconds, then 30 fps.
- The listener counted 30 fps throughout. No `video-stalled`, and no `Frames produced 0`.

So `Capture failed` at HOME is not the defect on its own: here it came and went harmlessly. One run
cannot rule out the hypothesis, but the precondition it names is not enough to reproduce either 14 Sep
failure. Those also had SRT over cellular and rotation in play.

Evidence: `.p5/p5-capbg-20260928T210350Z.*`. The priming run's own output was lost to the SIGKILL, as
intended.

A driver fix came out of the first attempt. The fresh run opened its single-shot listener before
force-stopping the app. The app left retrying reached the listener first, died mid-handshake, and ffmpeg
exited (`Input/output error`), so the relaunched app had no one to publish to.
`capture-background.sh` now force-stops the app before the listener opens.

A setup note for the driver: ffmpeg 9.0.1 as the listener never saw the phone's video configuration record
(`extract_extradata: No start code is found`, `Could not write header`) and dropped the connection 0.8 s in,
even with larger probe settings. A null sink (`-f null -`) holds the connection and reports per-second
packet counts. It gives up the file capture.

**The retuned regulator on the device.** The safeguards check, again on roaming cellular with wifi off, on
the build with `256088c`, `4b32cbc`, `0658a45`:

| Rule | On the device |
|---|---|
| Start at 1500k | One `regulator` event, `startBps=1500000`; 30.01 fps; column 25 filled 149/149 |
| Raise +100k per 10 s, only after a clean interval | 1.5M → 3.0M in 150 s on a clean link; first raise after the data cut 31 s after it |
| Remember a failed rate for 5 min | Caps at 1200000, 1401600 and 630720 (80% of 1500k, 1752k, 788.4k); the first and last lifted after 5 min, the middle one replaced by a newer cut |
| Size a cut from measured egress | 3000k → 1552000 on a 1.1 s send buffer with no drops |
| Reconnect at the last target | 3000k after the stall recovery, 750k after the data cut |
| Log `regulator` only on a successful connect | 7 failed connects during the 20 s cut wrote none (the old build wrote eight) |

The stall check passed as before: detected 3.7 s after the hook, publishing again 2.7 s later,
`video-recovered msStalled=6531`. The status line read `NO VIDEO — recovering` in orange during the stall and
`LIVE srt` after.

The owner then unplugged the phone, so the driver lost adb and could not stop the app. It published
unattended for another 27 minutes and reached 47 °C at thermal status 3. That stretch produced F-P5-7. The
whole session, with three reconnects, became one recording of 1825.7 s. Recording and input were deleted
afterwards.

Evidence: `.p5/p5-capbg-20260928T134309Z.*` (listener rejected), `.p5/p5-capbg-20260928T134656Z.*` (HOME),
`.p5/p5-capbg-20260928T135043Z.*` (simulated stall), `.p5/p5-safeguards-20260928T142729Z.*`.

### Interruptions while live — 2026-09-28

The retuned build published RTMPS to a reconnect-accepting listener on the laptop through `adb reverse`, with
continuous logcat. Each run published for 20 s, then took the interruption.

| Interruption | Stream | Finding |
|---|---|---|
| Browser (Chrome in front 13 s, then back) | 30 fps apart from one second at 12 fps and one at 21 fps; audio ~47/s; no drop | none |
| Phone call rung and declined (19 s) | No effect | none |
| Phone call answered (13.5 s) | Video 13–16 fps for 2 s at answer, 15 fps for 1 s at hang-up; no drop; **microphone silenced for the whole call** | F-P5-8 |
| WhatsApp call rung, not answered, during launch | Ringing UI covered the arming app; preview removed, `Capture failed` ×4; still armed | F-P5-9 |
| WhatsApp video call answered (6 s) | Video to 0; watchdog recovered in 6.9 s | F-P5-9 |
| WhatsApp video call answered (30 s) | Video 1–20 fps and audio 1–9/s for ~20 s; **not detected** | F-P5-9 |

Both kinds of call were placed by the owner from a second phone. The WhatsApp calls began before the driver
prompted for them, so its own call timing is not used; the times above come from logcat (`AudioManager
setMode` from WhatsApp, `CameraService` connect and disconnect) and the device CSV.

Evidence: `.p5/p5-interrupt-browser-20260928T*`, `.p5/p5-interrupt-call-20260928T*`,
`.p5/p5-interrupt-whatsapp-20260928T*`.

### Interruption detection on the device — 2026-09-28 evening

The APK was `ef8441b1…`, carrying the F-P5-8/F-P5-9 detection after two review rounds (`1d88c2c` to
`0772888`). The setup was the same: RTMPS to a laptop listener. The driver `scripts/p5/device/interrupt.sh`
now:
- screenshots the HUD every 2 s once a call is up;
- records Do Not Disturb (`zen_mode`);
- keeps one decoded frame a second (`e4028a6`, `a4171d3`).

The owner placed every call from a second phone.

| Run | DND | What happened | Detection |
|---|---|---|---|
| No call (`…call-…T164838Z`) | off | Publishing about 4 min, no interruption | No `starved`, `mic-*` or `camera-*` rows: no false alarm |
| Phone call answered (`…call-…T165404Z`) | off | Video 17 then 12 fps and audio 23 then 25/s for 2 s at answer; mic silenced for the call | `mic-silenced`/`mic-restored` (11.9 s); HUD `MIC SILENCED BY SYSTEM`. Also `delivery-starved videoFps=9.7 audioFps=15.2` for 3.7 s at answer |
| WhatsApp video ×3 (`…whatsapp-…T165758Z`, `T170717Z`, `T171822Z`) | off | Camera 1 taken, video stalled, recovered; mic silenced for the call | `camera-contended`/`released`, `video-stalled`/`recovered`, `mic-*`; **the stream carried noise after the recovery (F-P5-10)** |
| Phone call from a starred contact | priority | **Rang aloud**, answered; mic silenced 14.9 s | As above |
| WhatsApp video call | total silence | **Nothing on the phone**; the audio mode stayed normal | No rows; broadcast untouched |
| Phone call from a starred contact | total silence | Reached the phone silently (call state ringing); the owner saw and heard nothing; ended unanswered | No rows; 0 bad seconds in 115 s |

Three things this changes:

1. **The answer dip can cross the starvation floor.** The brief assumed from the morning's call that it would
   not. Here the window judged 9.7 fps and 15.2 audio frames/s. By the precedence rules the line would have read
   `LOW VIDEO 9.7 fps` for 3.7 s before the silenced-mic line, but this was not captured on screen.
   - It is a true statement, briefly.
   - The per-second rows (17 and 12 fps) do not reconcile exactly with the window's 9.7. That is not
     explained.
2. **Priority Do Not Disturb does not protect a broadcast.** It lets starred contacts through, and those are
   exactly who rings a volunteer mid-match. Total silence stopped both kinds of call (N21).
3. **Detection is not enough on its own** where a recovery can leave the stream broken: F-P5-10.

A starved episode's HUD line was not captured on screen. The screenshots began after the 3.7 s episode had
ended.

The F-P5-10 experiments followed at 20:00Z on APK `9f34ef68…`: `hold`, `reopen` and `both`, one WhatsApp
video call each, DND off. Results are under F-P5-10.

### Run B — RTMPS, wifi, 1 h (T5, N5)

**2026-09-28 21:13:48Z, `scripts/p5/device/run-rtmps.sh`. Stopped at minute 20: the app crashed at the
first outage (F-P5-12).** Planned: 60 min publishing, with Wi-Fi and data off for 20 s at minute 20
(criterion 4) and for 200 s at minute 40 (criterion 5), on a fresh input deleted at the end.

The 20 minutes before the outage were clean:

| Measure | Result |
|---|---|
| Connect → publishing | 3.5 s |
| Publishing share | 100% of 1186 samples |
| Regulator | 1500k start, 3000k ceiling reached at +151 s, no cut |
| Egress p5 / median / p95 | 2254k / 3086k / 3603k |
| 60 s rolling mean after the ramp (criterion 3) | never below 3000k (minimum 3048k) |
| Playlist | 471 advancing, 12 isolated one-poll holds, no stall |
| Thermal | status 2 for 84% of samples; battery 42% → 36% while charging |

At 21:33:49.9Z the script turned off Wi-Fi and data. StreamPack reported the drop
(`dropped transport=rtmps reason=endpoint-closed`, 21:33:49.979Z), and 63 ms later the process died.
The network was back at 21:34:10Z and nothing reconnected, because nothing was running. Cloudflare
marked the input `disconnected` (`client_disconnect`) at 21:34:20Z. The driver was stopped by hand before
its second outage: with the app gone, its closing hold-to-stop would have landed on the launcher.

Criteria 4 and 5 are therefore untested on RTMPS, and cannot be tested until F-P5-12 is fixed.

**Rerun with the F-P5-12 guard, 2026-09-28 22:41:58Z (`p5-runb-20260928T224127Z`), 20 min.** APK `6c81494f…`
(guard round 0; round 1 only narrows what it swallows). The cuts were a 20 s outage at +5 min and a 200 s
outage at +10 min.

| | 20 s cut (22:47:00Z) | 200 s cut (22:52:00Z) |
|---|---|---|
| The app | `dropped` (`endpoint-closed`, streams still flagged on); **no guard swallow**, because Ktor's closer did not throw this time | `dropped`, then `uncaught-swallowed … ClosedWriteChannelException message=Broken pipe` 48 ms later; **the process lived** |
| Retries | 10 × `connect-failed UnresolvedAddressException validated=false`, not counted | ~100, the same, not counted; no fallback, as designed |
| Publishing again | 1.4 s after the network returned (`connectMs=808`) | 1.7 s after (`connectMs=392`) |
| Cloudflare | old session `disconnected` 22:47:31Z, `connected` 22:47:39Z | `disconnected` 22:52:31Z, `connected` 22:55:27Z |
| Playlist | head 150 → 151 at 22:47:34Z, then **stalled 4.5 min**, until the next cut | new variant from 22:55:30Z, advancing to the stop |
| Recordings | first recording **ends at the cut (303.8 s)**, and the 4.5 min after it are in no recording | a second recording (397.8 s), as criterion 5 expects |

- **Criterion 5 on RTMPS: pass.** The app reconnected unaided and a second recording started. It served no
  `EXT-X-ENDLIST`, the same as SRT (Run A's note).
- **Criterion 4 on RTMPS: fail, and it is not the phone's fault.** The phone sent 30 fps video and 47 audio
  frames a second at 2.7–3.4 Mbps for the whole 4.5 minutes, and Cloudflare said `connected`. Nothing was
  packaged and nothing recorded. See F-P5-13.
- **F-P5-12's guard held on the device.** The swallow is timing-dependent. It fired on one cut of two, and
  Run B's crash also came from one cut. The process and its PID survived, and the reconnect worked.
- Stop by hold, both recordings and the input deleted.

### Run C — forced fallback (bad SRT port)

Set `P5_SRT_URL_OVERRIDE` before `cf.ts create`. Only the SRT address is broken, so the RTMPS credentials in
the same payload are the real ones.

**Measured 2026-09-28 23:07:36Z (`p5-runb-20260928T230714Z`).** Driven by
`START=srt P5_SRT_URL_OVERRIDE=srt://live.cloudflare.com:779 CUT1_S=0 CUT2_S=0 END_S=90 run-rtmps.sh`. The real
port is 778. APK `af55dc7c…`.

| Measure | Result |
|---|---|
| First connecting → RTMPS publishing (s) | **18.8** |
| SRT attempts | 3 × `connect-failed … SocketException: Connection was broken`, `counted=true validated=true`, about 5 s each with 2 s between |
| Fallback | `fell-back` at the third failure, then `connecting transport=rtmps` 2 s later, `publishing` in 574 ms |
| Delivery | playlist advancing within seconds; one recording (89.95 s for 90 s published) |

C1's fallback works as designed on a broken SRT address. Its 18.8 s is mostly three SRT timeouts. An
operator sees about 19 s of "connecting" before going live, and the product should say what is happening
in that time.

### Output check (U1-S6, U1-S7)

| Peek | Status sequence | Plays? |
|---|---|---|
| Default UA | | |
| Browser UA | | |
| Airplane 20 s during peek — events fired | | |

Every peek writes a `peek-<default\|browser>-at-subscribe-<status>` mark the moment it subscribes, so
an otherwise empty peek row means the peek was never opened — not that `statusChange` stayed silent.

### B-frames at the source (retry requirement 8)

Low-latency HLS on this account needs a broadcast with no B-frames, and a
downstream pull cannot say whether the phone sends any: Cloudflare's standard
pipeline adds them when it re-encodes (`has_b_frames=2` delivered from a publish
verified to have none). So the question is read from the encoder's own output.

**Library level.** StreamPack 3.2.0 never sets `max-bframes`: the key is absent
from the whole of core's `classes.jar`, while `profile`, `level` and
`i-frame-interval` are present. The spike's `VideoConfig` passes only mime,
3 Mbps, 1280×720, 30 fps and a 2 s GOP, so the profile comes from StreamPack's
`avcProfilePriority` — High, Main, Extended, Baseline, ConstrainedHigh,
ConstrainedBaseline — where the first profile the device's encoder advertises
wins. A Snapdragon 8 Gen 1 advertises High, which permits B-frames. Whether they
appear is the encoder's default, not our configuration.

**On device, 2026-09-14: none.** The phone published RTMP to an ffmpeg listener
on the laptop through `adb reverse tcp:1935`, written `-c copy` to FLV so nothing
re-encodes. RTMP only because adb reverse carries TCP; B-frames are an encoder
property, the same whichever transport carries them. A 25 s capture read
`profile=High`, 1280×720, `has_b_frames=0`, and frames **13 I + 737 P + 0 B**:
750 frames at 30 fps, an IDR about every 2 s. The detector was proven both ways
first, on known libx264 encodes: `-bf 0` read zero B-frames, and the default read
`has_b_frames=2` with 88 B.

**What it does not settle.** This is one SoC's default. Nothing in our
configuration keeps B-frames out, so a volunteer's handset whose encoder does
emit them would silently lose low latency. The capture engine should decide it
explicitly — `max-bframes = 0` through `VideoCodecConfig`'s `customize` hook, or a
forced ConstrainedHigh profile, which carries no B-slices by definition — rather
than inherit a library default. SRT into a low-latency input (retry requirement
9) is still unmeasured: every low-latency measurement so far was RTMPS.

Evidence: `.p5/bframe-20260914T153644Z.log`.

## The telemetry CSV

One file per app launch, `p5-<epochMs>.csv`, in the app's external files dir, flushed on every write.
Columns: `epochMs`, `kind`, then `thermalStatus`, `thermalHeadroom`, `batteryPercent`, `batteryTempC`,
`charging`, `currentMicroAmps`, `network`, `screenOn`, `streaming`, `transport`, `videoBitrate`, then
`detail`. Sample rows have `kind=sample` and an empty `detail`; event rows (`armed`, `connecting`,
`publishing`, `fell-back`, `service-started`, `mark`, `error`, …) carry `detail` and leave the sample
columns empty. **An empty cell is a missing reading, never a zero** — except `thermalStatus` and
`thermalHeadroom`, which use `-1` on platforms too old to report them, and `thermalHeadroom`, which
is `NaN` when the platform is polled faster than it allows. Secrets are redacted and commas are
replaced with semicolons before anything reaches `detail`.

**A `network` of `none` is not proof of a lost uplink.** Both the sampler's `network` column and
`connect-failed`'s `validated` read `ConnectivityManager.activeNetwork`, and both report
`none`/`false` whenever it — or its capabilities — momentarily returns null. Seen in Run A's own
baseline at 10:22:51Z: roughly three minutes of `none` rows, coinciding with a `dumpsys battery
unplug`/`reset` call, while `dumpsys connectivity` showed the LTE network `VALIDATED` and `ping` ran
at 0% loss and 42 ms. It recovered unprompted. So read `none` as "the framework did not answer", and
cross-check any suspected outage against the `dropped` and `connect-failed` rows, which come from the
transport itself rather than from a capabilities lookup. This matters most for criterion 1, which
counts publishing samples: a `none` row with `streaming=true` is still a publishing sample, and
treating the column as an outage log would fail a healthy run.

Two event rows carry more than their name since the rehearsal:

- `connect-failed` — `transport`, `counted` (did it count toward C1's fallback), `validated` (was
  the active network `NET_CAPABILITY_VALIDATED` at the time), `message` (the exception **class** and
  message, not just the message), and for SRT the descriptor's shape: `host`, `port`, `streamIdLen`,
  `passphraseLen`, `latencyMs`. Lengths only — the streamId and passphrase never leave the device.
  `validated=false` on a run of failures means the network, not the descriptor (F-P5-1).
- `dropped` — `transport`, `reason` ∈ `endpoint-closed` (the SRT/RTMP sink closed under us),
  `inputs-stopped` (the camera or microphone stopped while the endpoint was still open — a device
  interruption, not a transport fault) or `requested` (our own stop, which normally cancels the wait
  before it can report); plus `message` (`none` when no throwable arrived within 250 ms),
  `endpointOpen`, `audioStreaming` and `videoStreaming`. The old `reason=pipeline-stopped` no longer
  appears.

`mark` rows come from either the pushed `p5-mark` file or the Mark button; they are indistinguishable
on purpose, so the protocol can use whichever the moment allows.

### What the delivery safeguards added (`7f714e7`, `41261b3`, `b6dd050`)

- **Column 25 `videoTargetBitrate`:** the regulator's current video target in bps. It is blank before the
  first tick of each attempt and whenever no regulator runs. The target is not a rate cap: StreamPack sets
  no bitrate mode, and Soak A's egress overshot its 3000k target.
- **New events:**
  - `regulator` (`transport`, `floorBps`, `ceilingBps`, `startBps`)
  - `video-stalled` (`msSinceAdvance`, `videoFrames`, `audioAdvancing`, `transport`)
  - `video-recovery` (`attempt`, `simulated`)
  - `video-recovered` (`msStalled`)
  - `video-recovery-failed`
  - `video-stall-simulation` (`present`)
- **New fields and drop reason:** `dropped` gains `reason=video-stalled`, and `service-started` gains
  `simulateVideoStall`.
- **`videoState` rides the 1 Hz snapshot, not the CSV:** `ok`, `stalled`, `recovering`, `failed` or `idle`.
  The HUD says `LIVE <transport>` only for `ok`. Otherwise it shows `NO VIDEO — recovering`,
  `NO VIDEO — stopped recovering`, `waiting for video` or `not publishing`.
- **Test hook:** an empty file `p5-simulate-video-stall` in the app's files dir makes the endpoint discard
  video frames until a recovery deletes it.

## Before the runs

In this order. Steps 1 and 4 touch the handset; the rest is laptop-side.

1. **Install the soak APK.** It is built locally — no EAS — with the spike flag embedded in the
   bundle, so it opens straight to the spike screen with Metro stopped:
   ```bash
   cd android && JAVA_HOME=/Users/ashokhein/.jdks/jdk-17.0.20.1+1/Contents/Home \
     ANDROID_HOME=/Users/ashokhein/Library/Android/sdk \
     EXPO_PUBLIC_SEAZN_SOAK=1 ./gradlew assembleRelease --console=plain
   adb -s 12be753e install -r android/app/build/outputs/apk/release/app-release.apk
   ```
   Confirm untethered operation by killing Metro (or leaving the laptop's network) before the run:
   an APK that needs a bundler is the one failure mode this build exists to rule out. `EXPO_PUBLIC_*`
   is inlined by Metro at bundle time, so the flag has to be set on the build, not on the launch —
   **and it is cached with the transform** (see Follow-ups), so a rebuild wants a cold Metro cache.
2. **Check the credentials reach Cloudflare** — this is a 2-second test that saves a 3-hour one:
   ```bash
   node --env-file=.env.local scripts/p5/cf.ts verify
   ```
   `.env.local` in the spike worktree already has `CF_ACCOUNT_ID` and `CF_API_TOKEN`, verified
   active. **`P5_OVERLAY_URL` is still required and still missing:** a staging fixture that is
   public, in play, and carries the `streaming.overlay` override. Nothing else blocks the runs.
3. **Create the live input** and write the phone's session payload:
   ```bash
   node --env-file=.env.local scripts/p5/cf.ts create run-a
   ```
   It prints the uid, the HLS playback URL and the exact `adb push` line. The customer subdomain is
   read from the create response, not configured.
4. **Push the payload, then open the app once.** The push target
   (`/sdcard/Android/data/com.seazn.capture/files/`) is `getExternalFilesDir`, which the system
   creates when the app first runs — pushing to a package that has never launched fails.
5. **Start the watcher**, then the run.

## Commands

```bash
node --env-file=.env.local scripts/p5/cf.ts verify
node --env-file=.env.local scripts/p5/cf.ts create <run>
adb -s 12be753e push .p5/<run>.session.json /sdcard/Android/data/com.seazn.capture/files/p5-session.json
node scripts/p5/hls-watch.ts <playbackUrl> | tee .p5/<run>.hls.csv
# mark the CSV from the laptop — works with the screen off and the phone locked:
printf 'mark-1' > /tmp/p5-mark && adb -s <serial> push /tmp/p5-mark /sdcard/Android/data/com.seazn.capture/files/p5-mark
# P4 + T1 sample, mid-run:
ffmpeg -user_agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" -i <playbackUrl> -t 20 -c copy .p5/<run>-sample.ts
ffprobe -v error -show_streams -show_entries stream_side_data .p5/<run>-sample.ts
ffmpeg -i .p5/<run>-sample.ts -af volumedetect -f null - 2>&1 | grep mean_volume
# after the run:
adb -s 12be753e pull /sdcard/Android/data/com.seazn.capture/files/ .p5/device/
node --env-file=.env.local scripts/p5/cf.ts cleanup <uid>
```

`.env.local` needs `CF_ACCOUNT_ID`, `CF_API_TOKEN` and `P5_OVERLAY_URL`. Optional:
`P5_SRT_URL_OVERRIDE` for Run C, and `CF_STREAM_CUSTOMER_SUBDOMAIN` — an override only, since the
subdomain is read from the create response's WebRTC playback URL. The account has no live inputs, so
there is no other way to learn it.

`hls-watch.ts` and the `ffmpeg` sample both send a desktop browser User-Agent: U1-S6 says the
manifest answers `403 error code: 1010` to anything else, and a 403 misread as a stall would fail
criterion 1 on the watcher's own request.

## Findings raised

**F-P5-1 — libsrt's "Bad parameters" is how srtdroid reports a host that did not resolve.**
Traced through the vendor source rather than inferred, because the message names our parameters and
the fix is not in them:

1. libsrt's `strerror_defs.cpp` builds the string `Operation not supported: Bad parameters` from
   `MJ_NOTSUP` + `MN_INVAL` — its generic invalid-parameter error, and the exact CSV text.
2. srtdroid's `glue.cpp` `nativeConnect` converts the Java `InetSocketAddress` with
   `InetSocketAddress::getNative(...)` and **never null-checks the result** before
   `srt_connect(u, reinterpret_cast<const sockaddr *>(ss), size)`.
3. srtdroid's `connect(hostname, port)` is `connect(InetSocketAddress(address, port))`, and
   `InetSocketAddress(String, int)` does **not** throw when DNS fails — it yields an *unresolved*
   address whose `getAddress()` is null.

So a name that will not resolve reaches libsrt as a null sockaddr and comes back as a parameter
fault. Our own evidence agrees: every one of the nine rejections carried `counted=false`, which is
`NET_CAPABILITY_VALIDATED` being false — the handset had no validated network for exactly the
failing window, then SRT connected first try.

Ruled out against the same sources, so they are not re-litigated: an empty-string passphrase
(`SessionFile` maps `optString("passphrase").ifEmpty { null }`, and `cf.ts` requires the field
non-empty at create, so `""` cannot reach libsrt); a latency in the wrong unit or at the wrong layer
(`latencyMs` → `SrtUrl.latencyInMs` → `SockOpt.LATENCY`, milliseconds throughout, and our 2000 is
`SRT_LATENCY_MS` from `liveInput.ts`); a streamId needing percent-decoding (it is read from a JSON
field, never a URI query, and `SrtUrl` applies it verbatim as `SockOpt.STREAMID`); a passphrase
outside libsrt's 10–79 characters (ours is 65); and the first `open` racing the camera or encoder
start (`startStream(descriptor)` is `open()` then `startStream()`, and `open()` — which is the
connect — never touches the camera, so a camera race cannot produce a connect error).
`SrtUrl.init` validates only host and port, and `preApplyTo` applies latency, passphrase and
streamId as plain unvalidated sockopts, so there is no vendor-side rejection of our values to find.

The honest conclusion is that the 18 seconds was the network coming up, and the defect in *our* code
was reporting it as something else. The diagnostics added for item 2 confirm or refute this in one
run: a repeat with `validated=true` and a well-formed shape would move the finding to the vendor.

## Follow-ups

- **The recordings cited as evidence above no longer exist.** On 2026-09-14, with the owner's
  approval, every test input from Run A, the H-P5-1 cells and the reconnect cells was deleted with its
  recordings (`cf.ts cleanup`, one input at a time): Run A's `94f526ff…` and `79c59856…`, F-P5-4's
  `3eaa12e0…`, and `e2f192ec…`, `ad27e224…`, `d4036285…`, `69e03e52…`. The figures here, the watcher
  and status CSVs, and the extracted frames under `.p5/` and the session scratchpad are what remain;
  nothing more can be read from those recordings.
- `main`'s `eas.json` `soak` profile extends `development` (a dev client that needs Metro); fix
  before any soak build from `main`. The spike branch's copy is fixed — it extends `base`, builds an
  internal-distribution APK, and sets `EXPO_PUBLIC_SEAZN_SOAK=1` — but the branch is never merged,
  so the fix has to be made again on `main`.
- The soak APK for these runs was built **locally**, not by EAS, and `release` on a bare prebuild
  signs with the checked-in debug keystore. Fine for a spike on a known handset; a real soak build
  needs its own keystore (and EAS is the obvious place for it) before it goes to anyone else.
- `EXPO_PUBLIC_*` is inlined by Metro at bundle time, so the spike flag is a property of the
  artefact, not of the launch. There is no way to tell a soak APK from a normal one at a glance —
  check the screen it opens to.
- **The inlined value is cached with the Babel transform, and the env var is not part of the cache
  key.** Measured on 2026-09-11 with `expo export:embed`: two bundles from the same tree, one with
  `EXPO_PUBLIC_SEAZN_SOAK=1` and one without, were **byte-identical** with a warm Metro cache, and
  differed with `--reset-cache` — `const SPIKE = true;` against `const SPIKE = false;`. So flipping
  the flag without clearing the cache silently produces an APK for the other mode. The APK for these
  runs is safe (its bundle task reported "Bundler cache is empty, rebuilding"), but any rebuild needs
  a cold cache. This is a general trap for `EXPO_PUBLIC_*`-gated behaviour, not a spike-only one.
  **Scope, found 2026-09-14:** the trap cannot bite a Gradle release build. React Native's
  Gradle plugin passes `--reset-cache` to every bundle command it runs
  (`BundleHermesCTask.kt:155` in `@react-native/gradle-plugin` 0.86.3), which is why every
  `assembleRelease` log says the bundler cache is empty. It bites a hand-run Metro or
  `expo export:embed` without `--reset-cache`.
