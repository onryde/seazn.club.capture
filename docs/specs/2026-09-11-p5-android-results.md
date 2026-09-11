# P5 Device Spike — Android Results

**Status:** protocol ready, runs pending
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

Results:

| Criterion | Result | Evidence |
|---|---|---|
| 1 | | `.p5/device/*.csv` |
| 2 | | peak status, minute first reached 3 |
| 3 | | 60 s rolling mean of `videoBitrate`: min / median / p5 |
| 4 | | recordings count after mark-5 |
| 5 | | ENDLIST time, reconnect seconds |
| 6 | | watcher lines mark-2..3 |
| 7 | | screenshot · ffprobe |
| 8 | | ffmpeg volumedetect |
| 9 | | |

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
