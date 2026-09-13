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

### H-P5-1 (hypothesis, with its test) — on SRT the hold may start late, so dropout tolerance is not the configured number

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
| 5 | **Not reached** as designed — no minute-125 outage, so the split is untested. But the unplanned death answered something more useful: **no `EXT-X-ENDLIST` is ever served at `timeoutSeconds=180`.** My playlist sat frozen at head 997 for ~3.5 min, last 200 at 11:05:50.9Z still serving segments, then master 204 at 11:05:55.0Z — a 4.16 s gap, too small for an ENDLIST to appear and vanish inside. A controlled pair run elsewhere on this account settles that it is the *value* and not the manner of ending: a clean cut (SIGINT, trailer written) and an abrupt death (SIGKILL) both reached 204 with no ENDLIST, at +183.5 s and +182.8 s — 0.7 s apart — while 10 and 60 both emit one at ≈ timeout + 3 s. **Consequence for the whole programme: nothing may treat `EXT-X-ENDLIST` as the end-of-stream signal, because at the value we would configure it never arrives.** One difference stays open: my hold ran **225.2 s** from ingest end (212.3 s from the last head advance) against their 183 s, and my detection uncertainty is only 4.16 s, so it is not measurement lag. See **H-P5-1** for the proposed mechanism and the two cells that would settle it | `p5-run-a.hls2.csv` lines 673–759 |
| 6 | **Failed, and the cable is largely exonerated.** Delivery stopped 3 min 22 s into the 10-minute screen-off window. Three independent clocks separate the two candidate causes without needing the handset: ingest stopped at **11:02:09.8Z** (10:28:51.599Z plus the recording's own 1998.23 s); the device wrote its **last telemetry row at 11:02:20.7Z**, still claiming `streaming=true` at 4.4 Mbps; and **adb was still alive at 11:02:51–57Z**, when a background check successfully ran `adb shell` against that CSV. So the cable was still connected when delivery ended, and the 1 Hz sampler had stopped writing ~35 s before a read that still worked — with `SpikeLog` flushing on every write, that is not buffering. The app stopped while the device was reachable, which points at the process being killed or frozen during screen-off rather than at the unplug. **Mechanism from on-device CSV:** zero `dropped` / `error` / `service-stopped` rows — the process ceased without the transport observing a close (see F-P5-3) | `cf.ts videos`, `p5-run-a.hls2.csv`, `.p5/run-a-full.csv`, the 11:02:5x watcher output |
| 7 | **Not reached for the flip; partial on encoded orientation.** Minute-95 never happened, so the three P4 assertions (preview / encoded / rotation metadata across a 180° flip) cannot be scored. What the 33 min recording *does* show: encoded picture is **1280×720** landscape throughout (early / mid / late HLS samples), with **no rotation side_data** — pixels carry the orientation, not a display matrix. **Upright is confirmed by eye**, which geometry could not do: frames at t=300 s and t=1900 s both show floor signage whose lettering reads correctly, and a 180° rotation would invert it — a flipped picture is also 1280×720 landscape with no rotation matrix, so the columns above are consistent with an upside-down broadcast. Preview and flip still need a live handset | HLS samples from `94f526ff…` via ffprobe; download enabled at `…/downloads/default.mp4` |
| 8 | **Fail** on every 20 s sample pulled from the recording. mean_volume **−42.3 / −47.9 / −60.2 dB** (early ~2 min / mid ~16 min / late ~30 min), all below the −40 dB floor. max_volume −19.2 / −20.1 / −38.9 dB. The mid reading matches the MP4 download byte-for-byte on volume, so this is not an HLS packaging artefact. Quiet room + phone mic, not a dead encoder — but the criterion is a level floor, and the floor was missed. **Not a screen-off mute either.** The late −60.2 dB reading sits on the screen-off boundary (t≈1797 s), which could have meant Android handing a backgrounded app a silenced mic, so a per-10 s RMS timeline of the whole audio rendition was taken: the level had already fallen to −57…−61 dB about **45 s before** screen-off; **0 of 200 windows are digital silence** (floor −66 dB, a quiet room's noise floor rather than zeros); and **−41 / −40 dB of real sound was captured at t=1955–1965 s with the screen off**. The `microphone` foreground service kept capturing through screen-off until the process died | `.p5/run-a-sample-{early,mid,late}.ts` + volumedetect; MP4 download mid agrees; `.p5/run-a-audio-rms10s.txt` |
| 9 | **Not reached**; the floor over charging rows was 57% when the run died. The supply is a finding in itself: `Max charging current: 900000` µA at 5 V, i.e. **4.5 W** from the MacBook's port, against a 720p30 encode plus an LTE radio. Battery fell 68% → 57% by minute 39, between 14.7 and 28%/hour depending on the window. It is not marginal: after the relaunch, **idle and not publishing**, the handset still lost 61% → 54% in 53 min on the same supply. A power bank or powered hub is a prerequisite, not a convenience. **Retry 2026-09-12 afternoon:** handset is on the **Anker USB-C hub** (adb `12be753e` alive), still reporting the same **900 mA / 4.5 W** ceiling, and `batterystats` shows discharge steps into the mid-30%s while USB-powered — so this hub path is bus-powered (or under-powered) and does **not** yet clear the gate. Prefer a *wall-powered* hub so the existing adb driver survives; a power bank only if marks / screen / airplane / stop are redesigned without adb | `dumpsys battery`, `run-a-full.csv`; hub recheck via `adb` + `ioreg` |

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

### Run B — RTMPS, wifi, 1 h (T5, N5)

### Run C — forced fallback (bad SRT port)

Set `P5_SRT_URL_OVERRIDE` in `.env.local` before `cf.ts create`; only the SRT address is broken, so
the RTMPS credentials in the same payload are the real ones.

| Measure | Result |
|---|---|
| First connecting → RTMPS publishing (s) | |

### Output check (U1-S6, U1-S7)

| Peek | Status sequence | Plays? |
|---|---|---|
| Default UA | | |
| Browser UA | | |
| Airplane 20 s during peek — events fired | | |

Every peek writes a `peek-<default\|browser>-at-subscribe-<status>` mark the moment it subscribes, so
an otherwise empty peek row means the peek was never opened — not that `statusChange` stayed silent.

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
