# P5 device scripts

These scripts drive the Android P5 spike on a real handset. They produce the evidence for
`docs/specs/2026-09-11-p5-android-results.md`. Each script's header says what it checks and
what counts as a pass. This file covers what they share.

| Script                                               | Checks                                                                                    | Transport                  | Cloudflare                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| `verify-safeguards.sh`                               | Delivery safeguards: regulator, stall hook, 20 s data cut (F-P5-6, the retuned regulator) | SRT over cellular          | Fresh input, deleted at the end |
| `verify-raisegate.sh`                                | F-P5-7 raise gate: uncovered, lens covered, uncovered                                     | SRT over cellular          | Fresh input, deleted at the end |
| `LAN=1 verify-raisegate.sh`                          | The same on a thin link, `LAN_KBPS` (default 1500): the overrun, F-P5-11                  | SRT over Wi-Fi, throttled  | None                            |
| `run-rtmps.sh`                                       | Run B: RTMPS for 60 min, network off 20 s at min 20 and 200 s at min 40 (criteria 4, 5)   | RTMPS over Wi-Fi           | Fresh input, deleted at the end |
| `capture-background.sh [awaySeconds]`                | HOME and return; `STALL=1` exercises stall recovery (F-P5-6)                              | RTMPS to a laptop listener | None                            |
| `interrupt.sh browser\|call\|whatsapp [awaySeconds]` | Interruptions while live (F-P5-8, F-P5-9)                                                 | RTMPS to a laptop listener | None                            |

Helpers:

- `tap-visible.mjs` taps a control only when a finger could reach it (H-P5-1).
- `tap.mjs` is the plain tap.
- `cf-status-watch.mjs` samples the live input's status.
- `soak-alarm.mjs` wakes a person when a cable-free soak needs one.
- `udp-throttle.mjs` is a thin uplink for one UDP flow (rate cap and short drop-tail queue), in user
  space. A pf dummynet cap broke the SRT handshake on this Mac.

## Before you run

- **The phone is serial `12be753e`**, a OnePlus NE2211. The serial is hard-coded in each
  script, so change it there for another handset.
- **Install the soak APK first**, built locally with `EXPO_PUBLIC_SEAZN_SOAK=1`. Never use EAS.
- **The phone must be unlocked, with the spike app in front.** The two Cloudflare scripts
  refuse to run on a locked phone, because the app would launch behind the keyguard and never arm.
- **The Cloudflare scripts read `.env.local` at the repo root.** They use `CF_ACCOUNT_ID`,
  `CF_API_TOKEN` and `CF_STREAM_CUSTOMER_SUBDOMAIN`. Nothing prints them.
- **They clean up only the input they created.** Cleanup runs `cf.ts cleanup <uid>`, never
  account-wide, on a shared prepaid account.
- **The listener scripts need `ffmpeg` on the laptop.** ffmpeg 9.0.1 cannot write the phone's
  RTMP stream to a file, so the listener decodes it instead. In `interrupt.sh` it keeps one
  JPEG a second per connection, as `frames-s<N>-<nnnn>.jpg`, because the picture is the
  evidence (F-P5-10). A loop restarts it so it accepts reconnects. The run's closing
  "no capture written" warning is expected.

## Output

Every run writes to `.p5/` at the repo root as `p5-<kind>-<UTC stamp>.*`. That folder is
gitignored. Continuous logcat goes to `.p5/` as well. It is mandatory: OPLUS flow control
drops app log lines, and a sampled logcat misses the one that matters.

A run that dies part-way can leave the app publishing. Stop it by hand with Hold to stop,
then pull the CSV from the phone.
