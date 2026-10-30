# What viewers see, as a still of Output B

**Date:** 2026-10-30 · **Status:** approved by the owner ("looks fine, write the design doc"; "1 and 2 Ok") · **Replaces:** the video player of What viewers
see (AGENTS §6, D2 §4.3), which was built and hidden (`FEATURES.viewerCheck`, owner 2026-10-09). The switch goes:
the still is on for every composed session (owner, 2026-10-30, §6)

## 1. Intent

The owner, 2026-10-30, in this session's own words:

- "now is it possible to include output B in mobile app for preview?"
- "We want redesign/model of previwe so think and make sure that it doesn't interrupt or distrupt the live going while
  preview"
- On who and why: "organiser on tripod checking scorebug shows right score"
- "still picture is enough, check cloudflare thumbnail"
- On this design, as played back in chat: "looks fine, write the design doc"
- On the web and phone PRs and the switch: "1 and 2 Ok, no eed a fature check", read as: no feature switch, the
  still ships on (the controller's reading, stated to the owner in the session)

So the preview answers one question, at the tripod, mid-match: **does the score bug viewers see show the right
score?** It is not for framing or picture quality; the phone's own viewfinder answers those.

Output B is the composed programme: the camera's Input A, with the score bug drawn by the compositor, pushed to
Cloudflare Input B (`seazn.club.compositor` `docs/tasks/R2004-input-b-provisioning.md`). It exists only for a
**composed** session; a passthrough session has no Output B.

## 2. Goals, non-goals, anti-goals

**Goals**

1. On a composed session, on air, the organiser taps once and sees a recent picture of Output B, score bug included.
2. The broadcast is untouched by it: its uplink, its encoder, its audio, its thermal headroom and its controls.
3. The picture is never stale without saying so, and never a wrong picture presented as now.

**Non-goals**

- Moving video, sound, or anything a viewer would call "watching".
- A preview of a passthrough session (there is nothing composed to show).
- Before air. The cell is in the on-air row only (§5.1).
- iOS. Android first for feature work (AGENTS §9); iOS follows when its engine does.

**Anti-goals** (a failure even if it works)

- Any frame dropped, bitrate step lost or reconnect caused by the preview.
- A picture of the recording's first frame, or of the end card after the stream has stopped, shown as "now".
- A second render path for the score bug on the phone (AGENTS §7). The still is the compositor's own pixels.

## 3. Evidence: Cloudflare Stream thumbnails, measured 2026-10-30

Vendor behaviour this design rests on was tested, not read (AGENTS §0). Customer host `customer-vv7totdc7j19biah`.

**On finished recordings** (yesterday's six staging Output B recordings; user agent `okhttp/4.12.0`, a phone's):

| Request                                              | Answer                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/<video>/thumbnails/thumbnail.jpg`, no `time`       | 200, the **first frame** (the SEAZN CLUB slate)                                    |
| `…?time=300s&height=270`                             | 200, 480 × 270, ~16 KB; the score bug is legible                                   |
| `…?height=360`                                       | 200, 640 × 360, ~25 KB                                                             |
| okhttp, curl and browser user agents                 | all 200: unlike HLS (U1-S6), no user agent is refused                              |
| `time` past the end                                  | 400 "thumbnail timestamp exceeds duration of video"                                |
| `/<live input>/thumbnails/thumbnail.jpg`, input idle | 204, empty, `no-store`                                                             |
| any recording frame                                  | `Cache-Control: public, max-age=864000` (10 days); ~4 s on a miss, ~0.1 s on a hit |

**Live** (staging session `fed72cdb`, the owner's phone on SRT; programme input `279830e8…`; a poll every ~5 s;
times UTC from Cloudflare's own status):

| Time         | Event                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------- |
| 12:36:40     | Input A connects (SRT)                                                                       |
| 12:42:02–:17 | the live input's still: the camera's picture with the score bug, a different frame each poll |
| 12:42:27.6   | **the phone stops** (Input A disconnects)                                                    |
| ~12:42:31    | **the still already shows the compositor's STREAM ENDED card**                               |
| 12:42:37     | Output B disconnects                                                                         |
| to 12:45:32  | the still stays the end card; Cloudflare's `lifecycle` still says `live: true` (hold window) |
| 12:45:38     | the still turns to the **recording's first frame**, `max-age=864000`                         |

Findings:

- **T1. The live input's address gives the current frame.** `https://<host>/<programme input>/thumbnails/thumbnail.jpg`
  while live: `Cache-Control: public, max-age=10`, 4–24 KB at height 270, 0.1–4 s to fetch.
- **T2. It is at most ~4 s behind the programme.** The end card was in a still within ~4 s of the stop. YouTube's
  viewers are 15–30 s behind the programme, so the still runs ahead of them, never behind.
- **T3. It changes at most every 10 s** (the cache's `max-age`).
- **T4. A video's `time` does not work while live** (400: Cloudflare counts the live video's duration only at its
  end). The live input's address is the one to use.
- **T5. The trap.** After the stream ends the same address serves the end card for the hold window, then the first
  frame with a 10-day cache, and `lifecycle` reports `live: true` for ~3 min after the end. Neither the answer's
  arrival nor `lifecycle` proves a picture is live.
- **T6. A frozen programme still reads as live.** The end card frames from 12:42:37 to 12:45:32 came with
  `max-age=10`, byte-identical across 29 polls. So `max-age` alone cannot tell a programme that stopped moving (the
  compositor's Machine restarting or dying while the phone is still live) from a live one.
- Not measured: a score change itself (the owner stopped before one); T2's end card is the same evidence of delay.
  Whether thumbnails are billed is not documented for stills (animated GIFs are documented as not billed).

## 4. How it keeps out of the broadcast's way

Each rule is the answer to one way a preview could disturb a live phone.

| Risk                                       | Rule                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Competing with the 3000k uplink            | One picture per 10 s at most, ≤ ~25 KB: ~20 kbps, under 1% of the encode. One request in flight, a 6 s timeout, no retry before the next tick. Only while the cover is open.                                                                                                |
| A video decoder beside the encoder         | None: a JPEG in an `Image`. No player, no `MediaCodec`.                                                                                                                                                                                                                     |
| Echo of the programme's audio              | None: a still has no sound.                                                                                                                                                                                                                                                 |
| A crash in the preview killing the session | The fetch is TypeScript's, behind a port, outside native (AGENTS §2). Nothing of it reaches the engine, the snapshot, the heartbeat or the machine; what it throws ends in "No live picture". The same isolation as `takePhoto` and `scoringLink`.                          |
| Heat                                       | Ladder step 1 (`viewer-feed`) closes the cover and disables the cell, as today (AGENTS §8).                                                                                                                                                                                 |
| Bandwidth trouble                          | Degraded, Reconnecting or a silent engine closes the cover and disables the cell until the trouble clears: the uplink gets everything. (The Remote scoring panel only hides on trouble; this one also refuses to open, because it spends uplink.)                           |
| Covering a control                         | The cover is over the camera half only; Stop is never covered. One cover at a time with the Remote scoring panel (AGENTS §6).                                                                                                                                               |
| A stale or wrong picture (T5)              | Fetch only while this phone's own broadcast is live; show a picture only if its answer says `max-age` ≤ 10; otherwise "No live picture". Show its age (§5.3).                                                                                                               |
| A frozen programme (T6)                    | A picture whose bytes are identical to the one fetched ≥ 20 s before is not live: the cover says "No live picture". A camera's picture is never byte-identical 20 s apart; a frozen programme always is.                                                                    |
| The score bug's own delay                  | The bug is held back to match the camera (`overlayDelayMs`, 3.1 s by default; `RELAY_OVERLAY_DELAY_DEFAULT_MS`). With T2 and T3 a new point reaches the still within ~20 s at the default. The cover says so in one hint line; the phone does not read the session's delay. |

## 5. The design

### 5.1 What the organiser sees

- **The cell.** The on-air icon row's fourth cell, _What viewers see_, where the built-and-hidden one sits (AGENTS §6:
  it ends the row and takes its remaining width). It shows only on a composed session (the snapshot has a still URL);
  there is no feature switch (§6). Disabled, with a one-line reason, while shedding ("Phone hot") or in trouble.
- **A tap** opens the cover over the camera half and fetches at once. While the first picture loads, the cover says
  so (no spinner without words, AGENTS §6).
- **The picture**, letterboxed 16:9 in the camera half, with one line: "What viewers see · 6 s ago". The age counts up
  each second from the picture's own age (§5.3) and is replaced by the next picture's.
- **Refresh** every 10 s while open (T3). A failed or refused fetch keeps the last picture only while it is ≤ 30 s old,
  with its age counting; past that the picture goes and the cover says "No live picture".
- **Closing.** A tap on the cover, its _Hide_, or the cell again, closes it at once. It closes by itself after 30 s,
  and on: leaving live, trouble, shedding, the Remote scoring panel opening, the turn card, the app leaving the
  foreground. It never reopens by itself.

### 5.2 The wire: one new optional field (web first)

- **Web** (`apps/web/src/server/usecases/capture-phone.ts`, the descriptor): for a composed session whose programme
  input exists (`fixture_stream_inputs.role = 'programme'`, slot 0), add `programmeStillUrl:
https://<STREAM_PLAYBACK_HOST>/<programme input uid>/thumbnails/thumbnail.jpg`, no query. Absent otherwise.
  `playbackUrl` keeps its meaning (Input A); the web's comment there ("never a composed session's programme") stays
  true. The input uid is as public as the one `playbackUrl` already carries.
- **Contract:** the field goes into `capture-descriptor.v1.json` in the web's `docs/contracts/` with fixtures (with
  and without), and is vendored here by `pnpm contracts:vendor` and the pin test (AGENTS §4). It is additive and
  optional, so a phone that does not read it is unaffected.
- **Native** parses it with the rest of the session shape (one parser, in Kotlin, AGENTS §4) and puts it in the
  snapshot's `broadcast` beside `playbackUrl`. Native never fetches it.

### 5.3 The phone

- **A port**, `ViewerStillPort`, built in `createNativePorts()` (check it is wired there, not only in the fake:
  recurring failure 1), with a fake. One call: fetch a still for a URL, answering either a picture (its bytes in a
  form `Image` can show, its `max-age`, its `Age`, the time it arrived) or a refusal word. Plain `fetch`, no React
  Query (AGENTS §8). The `height` query is the phone's (`previewUrls.ts`), 360: the camera half on the owner's phone
  is ~1000 px wide, and 25 KB per 10 s is still under 1% of the uplink.
- **The rule**, pure, in `src/domain/session/` (replacing `viewerCheck.ts`'s player states): open, a picture
  arrived, a refusal, a tick, close; out comes what the cover shows. A picture is live only if `max-age` ≤ 10 (T5).
  Its age is the answer's `Age` header plus the seconds since it arrived.
- **The hook** (`useViewerCheck`, reworked) owns the 10 s refresh, the 30 s close and the 1 Hz age clock, and fetches
  only while the snapshot says on air and the URL is present.
- **The cover** (`ViewerCover`, reworked) draws the picture or the honest line, and the hint that a new point takes
  up to ~20 s to show.
- **The player goes.** `StageVideo`, `useViewerFeed`, the `Video` surface (`src/services/surfaces.ts`,
  `nativeSurfaces.tsx`), `test/fakeExpoVideo.ts`, `peekPlaybackUrl`'s bandwidth hint, and the `expo-video`
  dependency with its pin (`test/dependencies.test.ts`) and its line in Settings' licence list. Removing `expo-video`
  is native: it needs a fresh prebuild.
- **The record** keeps `viewer.check {state}`. Whatever else it writes (a picture's age and size, a refusal) must be
  listed in the web's record contract first, in the same web PR as the field. No URL is ever written.

### 5.4 What stays as it is

- Ladder step 1's wire word `viewer-feed` and its caption.
- One cover at a time; Stop never covered; Settings reachable.

## 6. Decided, and by whom

| Decision                                                                                                                                           | By                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Preview Output B, for the score bug, at the tripod                                                                                                 | owner, 2026-10-30                                         |
| A still is enough; use Cloudflare's thumbnail                                                                                                      | owner, 2026-10-30                                         |
| Nothing in the preview may disturb the live broadcast                                                                                              | owner, 2026-10-30                                         |
| §4's rules and §5's shape, as played back in chat                                                                                                  | owner: "looks fine, write the design doc"                 |
| No feature switch: `FEATURES.viewerCheck` is removed, the still ships on                                                                           | owner: "no eed a fature check" (the controller's reading) |
| The live input's address (T1, T4), and the `max-age` freshness rule (T5)                                                                           | the controller, from §3's evidence                        |
| Height 360; 10 s refresh; 30 s auto-close; 30 s keep-last; 6 s timeout                                                                             | the controller                                            |
| On-air only; the fourth cell; the field name `programmeStillUrl`                                                                                   | the controller                                            |
| Frozen = byte-identical ≥ 20 s apart (T6); a fixed ~20 s hint, no delay field                                                                      | the controller (builder check)                            |
| Ship without measuring thumbnail billing: at most four stills a tap (one, then every 10 s for 30 s); the Stream bill is read after the first weeks | the controller (builder check)                            |

## 7. Left to the builder

- How the bytes reach `Image` (a data URI from the response, or a cache-busting URI with the headers read from the
  same response), provided the headers judged are those of the bytes shown.
- The exact copy and its four languages (the dictionary; `stripTextFit`-style measuring where it is one line).
- The refusal words and the record keys, within §5.3.
- The test plan, under AGENTS §10's four questions; the device check under §13, on two geometries, with the owner's
  hands for the tripod steps.
