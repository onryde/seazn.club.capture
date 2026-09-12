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
| 1 | 3 h completes, publishing in ≥ 99% of samples outside deliberate outages | P5 |
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
the run acted on **the app** while leaving the OS fully responsive. That rules
out the cable — still connected, since adb worked 46 s after delivery ended — and
rules out the radio, since the OS answered over it. The mechanism (killed,
frozen, or the coroutine scope cancelled) needs the on-device CSV and is open.

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
| 1 | **Partial.** 596 of 596 publishing samples (100%) over the first ~14 min, from the only CSV pulled before adb was lost. The full-run figure needs the device CSV | `run-a-partial.csv` via `telemetry-report.ts` |
| 2 | **Pass so far.** Peak status 2, never reached 3, through 11:02Z. Battery 32.7 → 39.4 °C, headroom 0.53 → 0.77 | sample rows to `atMs` 1789210940300 |
| 3 | **Pass so far.** 60 s rolling means, min **4027.0** / median **4181.2** / p5 **4094.7** kbps, all above the 3000 floor. Reads high because it counts audio, container and SRT overhead, as the note above says | `telemetry-report.ts` on the partial CSV |
| 4 | **Not reached.** The minute-65 outage never happened — the driver issued it after adb was gone | — |
| 5 | **Not reached** as designed — no minute-125 outage, so the split is untested. But the unplanned death produced a partial answer worth keeping: **no `EXT-X-ENDLIST` was ever served.** The playlist sat frozen at head 997 for ~3.5 min, the last 200 at 11:05:50.9Z still serving segments, then the master went 204 at 11:05:55.0Z — a 4.16 s gap, so an ENDLIST would have had to appear and vanish inside it. That extends the ENDLIST curve measured elsewhere on this account (cut +12.2 s at `timeoutSeconds=10`, +63.1 s at 60): at 180 it appears to 204 instead. **Caveat:** this was an abrupt app death, not a clean cut, so it may not be the same scenario. The hold also ran ~213 s from the last packaged segment, over the configured 180 | `p5-run-a.hls2.csv` lines 673–759 |
| 6 | **Failed, and the cable is largely exonerated.** Delivery stopped 3 min 22 s into the 10-minute screen-off window. Three independent clocks separate the two candidate causes without needing the handset: ingest stopped at **11:02:09.8Z** (10:28:51.599Z plus the recording's own 1998.23 s); the device wrote its **last telemetry row at 11:02:20.7Z**, still claiming `streaming=true` at 4.4 Mbps; and **adb was still alive at 11:02:51–57Z**, when a background check successfully ran `adb shell` against that CSV. So the cable was still connected when delivery ended, and the 1 Hz sampler had stopped writing ~35 s before a read that still worked — with `SpikeLog` flushing on every write, that is not buffering. The app stopped while the device was reachable, which points at the process being killed or frozen during screen-off rather than at the unplug. Still missing for the mechanism: whether a `dropped` event was written, which needs the on-device CSV | `cf.ts videos`, `p5-run-a.hls2.csv`, the 11:02:5x watcher output |
| 7 | **Not reached.** No minute-95 rotation | — |
| 8 | **Not reached** | — |
| 9 | **Not reached**, but the supply is a finding in itself: `Max charging current: 900000` µA at 5 V, i.e. **4.5 W** from the MacBook's port, against a 720p30 encode plus an LTE radio. Battery fell 68% → 57% by minute 39, between 14.7 and 28%/hour depending on the window. A power bank or powered hub is a prerequisite, not a convenience | `dumpsys battery` |

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
