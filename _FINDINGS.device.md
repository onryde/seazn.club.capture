# Findings — Seazn Capture, device and staging runs

This is the findings file's second half: N27 onward, what the staging and device runs of the built app found. The first
half, [`_FINDINGS.md`](_FINDINGS.md), holds N1–N26 (scoping, design and Plan D), the P5 spike index and the inherited
register items, and filed all of these under Product. A new N-ID is added at the end of this file. Each is a
recommendation, not a ruling.

---

## Product (continued from `_FINDINGS.md`)

### N27 — A locked phone stops beating unless its battery is Unrestricted

**Status:** mitigation landed — feat/s1-d3-fixes, Batch 5 (c5a2401; Stream Settings from Home: 73dc5ae, fdc8b41, a
gear since Batch 10, f034948; fix round 1: f0e4659): the battery row in Stream Settings, R5 of the D3 findings design (owner, 2026-10-11;
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
(`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`); Step A, the hypothesis and Step B's pass mark below: 2cd26dc
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

**Hypothesis (code reading, 2026-10-12; unproven):** The two vendor lines are the signature of every streamer build, not
the cause. `cameraSingleStreamer` sets the camera source before our `setVideoConfig` (`StreamerAdapter.kt:229`, `:251`),
so StreamPack's `VideoInput.setSource` finds no source config, logs `Video source configuration is not set`, and its own
`addOutputSurfacesUnsafe` logs `…can't add output surface` 1–7 ms later. `setVideoConfig` then builds a new surface
processor and adds the outputs. b8 has the pair at all eleven builds, the attached ones (22:01:06Z, 22:19:11Z) included.
For paths 1 and 2 the encoder's surface does attach. At the locked Go live, `capture-clock` (the first encoded video
frame) came 382 ms after `connected`, and `live` (gated on encoded frames) 628 ms later; no `video-stalled` for 4 min;
the camera had produced 4,419 frames by about 22:28:35Z; and the server's beats read `delivery ok`, lag 0.1 s and
0.5 s, at 22:27 and 22:28 with the phone still locked. The off-view start at 22:02:30Z (bb409e95) matches. What read as
"no video" was three other things: YouTube holding "Preparing" (web brief §4); the trouble that began at the unlock,
about 22:28:32Z, when the view attached on air, StreamPack reconfigured the camera session for the preview target, the
bitrate fell 2.6 → 1.07 Mbps and lag grew 1.0 → 7.7 → 17.7 s (thermal 3 a confound) until the lag rule reconnected
(N27, N32); and a `delivered` line that a healthy start never writes, since it is written only when a `not-delivered`
clears (`SessionMachine.kt:626-628`).
Path 3 (a20dcecf, A3) is a different defect. After the camera was taken and reopened, the capture was released and
built again with the view attached (13:23:33Z), so the 13:23:40Z start was an ordinary attached one, and it delivered
(`capture-clock` 195 ms, `live`). Video then stopped twice with no vendor line (`video-stalled no-video` at 13:23:52Z
and 13:24:12Z), the video encoder entered ERROR at 13:24:15.9Z (`codec is not running: ERROR`, `onStreamError: index 0
is not owned by client`), and every later attempt was `no-first-frame`: 28 stalls until the hold window expired at
13:27:15Z. Recovery (`Rebuild` / `StartNewSession` → `CaptureRun.reconnect`, `:246-247` → `:444-447`) only stops and
starts the same streamer (`parts.stop` `:437`, `parts.start` `:321`); nothing builds a new one after its encoder fails.
Ranked:

1. Path 3, a failed encoder never rebuilt. High confidence for the 3-minute outage; the first silent stall is
   unexplained. Step B confirms it with a codec ERROR followed by repeating `no-first-frame` and no `capture-rebuilt`.
   A stop and start alone that restores frames after an ERROR refutes it.
2. Paths 1 and 2 deliver; the failure is downstream or after the unlock. High confidence that H0 (the surface never
   attaches) is refuted for path 2, medium on what the owner saw. Step B confirms it with a master playlist carrying
   `avc1` and `RESOLUTION=1280x720`, a segment from the locked minutes that ffprobe and blackdetect show as real video,
   and beats' lag under 2 s until the unlock. Any of these refutes it: a locked-minute segment with no video or only
   black, `no-first-frame` 5 s after `connected` on an off-view start, a third `…can't add output surface` line apart
   from a build's pair, or `addOutputSurface: Can't add output surface: SurfaceProcessor is released`. The last two are
   H0's only two mechanisms in the vendor code, and no record so far has either.

**Pass mark for Step B (the controller's ruling, 2026-10-12):** a `delivered` line cannot pass on a healthy start (it is
written only when a `not-delivered` clears, `SessionMachine.kt:626-628`). Step B passes a path when `capture-clock` and
`live` follow `connected` within 30 s, the beats read `delivery ok` with lag under 2 s, the master playlist carries
`avc1` and `RESOLUTION=1280x720`, and a segment from the locked minutes is real, non-black video (ffprobe and
blackdetect).

---

### N29 — A rejoin after the hold runs out retries forever, with no reason shown

**Status:** superseded by N37 (the owner's ruling, 2026-10-13: the phone ends the session at hold expiry and never rejoins it; the Lapsed/Rejoin path below was removed in Batch 16). Was fixed — feat/s1-d3-fixes, Batch 2 (588ca11, 3eb3c1a, 4e27a9b; fix round 1: 279413f, 641103a, a4756e1)
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
window, not the measure. The display is 804 dp sideways, but ShellFrame's insets (a 32 dp cutout and a 44 dp bar) lay
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
9802354); Send record to Seazn is built (8b99943, 4920ea3, 9802354; fix round 1: d89f5da, 8ddb33f; fix round 2:
023ab03), and posts to the web's record contract, vendored at web f0feab16c (Batch 11, at 53f28ebfc: 7ccfbd8,
866f3f8; Batch 12, at 55ac34d5d: ea636f2; Batch 15, at a6cc1f038: 64a1ac2; PR #24, at f0feab16c;
`docs/specs/2026-10-11-s1-d3-web-brief.md` §1), behind
`FEATURES.recordSend`, which Batch 11 switched on (the owner chose "On now (Recommended)" in the session,
2026-10-12); the device proof is Batch 9's
(`docs/superpowers/plans/2026-10-11-s1-d3-fixes.md`)
**Where:** capture app · `DiagnosticsCard` (Share record) · `RecordRow` · Home

Share record lived only in Live Stream's Settings, and a phone sent to Home by `Replaced` has no pairing to open it
from. The record row (Share record, and Send record to Seazn when its switch is on) is now in Stream Settings in both
variants, after the battery row (Batch 6), and Stream Settings opens from Home's Live Stream tile (Batch 5): a replaced
phone closes the panel, taps the tile's Stream settings gear (Batch 10, f034948) and shares
(`HomeScreen.unpaired.test.tsx`). The Diagnostics card's
header kept its 48 dp without the button, so the card stayed 272 dp: it fits its half at 640 × 360 but not on the
owner's phone (N35). The header has since dropped the 48 (4421fb2), and the card is 244 dp.

---

### N34 — The round line is the server's text

**Status:** resolved by the web, in the web's register (its W-number unverified here); no app change
**Where:** web · the waiting fields' stage label

In French the phone showed "ROUND 2". The web already localises the round line by the organisation's
`default_locale`, and recommends keeping it that way: the answer from `mobile-s1-web` on 2026-10-11, in the web's
register (its W-number unverified here). The phone keeps drawing the server's text as sent.

---

### N35 — The owner's phone lays out at 728 × 328, not 804 × 332

**Status:** fixed in docs/tests — feat/s1-d3-fixes, Batch 7 (d081acc; N35 and AGENTS §6: a92a6bf); the Diagnostics
card, from the final review: 4421fb2
**Where:** capture app · `ShellFrame.tsx` (all four edges, around every route in `app/_layout.tsx`) · the viewfinder
fits (`viewfinderFit`, `cameraBox`, `stripTextFit`, `matchLabelFit`, `viewerCoverFit`, `StreamScreen.layout`) ·
`homeFit` · `settingsFit` · `DiagnosticsCard` · AGENTS §6

The viewfinder's rulings of 2026-10-08 and their fits name the owner's phone as 804 × 332: its display sideways, less
the status bar. The phone does not give the app that window. With 3-button navigation ShellFrame's insets are a
32.0 dp cutout, a 44.0 dp navigation bar and a 32 dp status bar, and nothing is immersive, so every route, Home and
Live Stream alike, is laid out 728 × 328. Every D3 stream shot shows the same split (`r1-live.png`, `r2a-live.png`,
`m2-stopped.png`, `r12-c2-804-fr.png`): a 418 dp camera half, the 310 dp controls half, and the controls' plate and the
bottom button 8 dp from the top and bottom of a 328 dp window; `r12-home-fr-landscape.png` shows Home at the same 728 (N31).
Gesture navigation was not in the evidence.

What changes at 728 × 328, by each fit's own model:

- The controls column's worst before-air stack, 324, leaves 4 dp to spare, not 8. Every control is still on screen.
- The camera box is 387.6 × 218 for a two-line label, limited by the window's height (D3 read 387.3 × 218), not
  394.7 × 222; 418 × 235.1 (the whole half) for a one-line label; and 309.3 × 174 before the label is measured.
- The strip's text is 386 dp wide, not 462: no realistic line in any language is cut there.
- A label side's row is 364 dp, not 440: the fixtures' sides stay one line, so the long doubles label is still 44.
- Home with one card scrolls (141 or 149 dp for tiles that need 166).
- Settings' halves have 248 dp, and the Diagnostics card was 272: 24 over, so its half scrolled and its ninth row
  (Heartbeat, _Last sent_) was under the fold (`r12-dim-settings.png`). The final review found it (Important 2), since
  `settingsFit` proved the card only at 360, 390 and 412. Its header dropped the 48 dp it had kept from Share record's
  button, which nothing in it needs: nothing in it takes a tap (the controller's ruling, 2026-10-12). The card is now
  244 and fits with 4 dp to spare; `settingsFit` carries 328 and 332 (4421fb2). On the phone it is Batch 9's.

Nothing clips. The fits now carry 728 × 328 as the owner's phone, with hand-derived rows; 804 × 332 stays as a
geometry, as the one the rulings were made on (the controller's ruling, 2026-10-12, from D3's evidence).

---

### N36 — A phone paired and waiting on Home has no keep-awake

**Status:** open — not fixed in feat/s1-d3-fixes; the owner decides at the D3 results (`docs/specs/2026-10-13-s1-plan-d-results.md`)
**Where:** capture app · `useKeepAwake` is mounted only in `app/stream/_layout.tsx` · AGENTS §9

AGENTS §9 says the screen is kept on while paired and waiting. That holds inside Live Stream only. On Home, with a
pairing, the screen times out 15 s after the operator leaves Live Stream. On a phone whose battery setting is
Optimized, the OS then froze the app (PID frozen 10:26:57 to 10:29:30 BST on 2026-10-12, tick late by 152 s, no beats,
no `armed`), and a remote Go live from the console failed (Batch 8, path 1). The earlier call that Batch 3 had
regressed the camera was wrong; the app was frozen, and Home opens no camera by design
(`.superpowers/sdd/2026-10-11-s1-d3-fixes/regression-camera-config.md`).

Device evidence on e144a38: a locked phone on Unrestricted battery kept beating and armed, and a start reached air
(sid 2e0255cd, camera ready 0.5 s after the start reached the phone; sid e6aeaee3 after about 7 minutes locked and
Dozing, 24 s to air). So the cure that matters is the battery setting (Settings has the battery row, Batch 6). A
keep-awake on Home would also close the gap AGENTS §9 describes.

---

### N37 — A rejoin after the hold ran out resurrected a session the strip had called over

**Status:** fixed — feat/s1-d3-fixes, Batch 16 (de2a5ce, 8335583, 3bff4aa; fix round 1: a5be0b0); device-verified on
e144a38, 2026-10-13 (sid 12c5da78)
**Where:** capture app · `SessionMachine.kt` (`holdRanOut`, `expired`) · `Pairings.kt` (server `Open`) · `Heartbeats.atOnce`

Found on the cut of 2026-10-12 (sid d060573f): the 183 s hold ran out, the strip said "Connection lost too long —
stream stopped", the server kept the session `live` (its own lost-phone end is 15 minutes), and on restore the phone
rejoined the same sid and Cloudflare started a second recording (N29's rejoin). The strip had said it was over.

**Owner ruling (2026-10-13, option a):** when the hold runs out the phone ends the session itself, and when the
network returns it stays Paired and waits for a new Go live. It reuses the never-live path: the sid goes into
`refused`, a `stopped: <sid>` beat is carried until a 2xx and is due at once (`Heartbeats.atOnce`, so the first
network moment sends it), and a late server `Open(sid)` is ignored. A hold that returns inside 183 s still reconnects
on the same sid. The Kotlin Lapsed/Rejoin path is removed (N29 is superseded).

**Device proof (e144a38, fixture #4, sid 12c5da78; the phone's record R-1WRJ and the web's rows; evidence:
`$HOME/seazn-d3-evidence/2026-10-13/n37-cut-web-report.md`):** the phone cut off at 20:29:38; `hold-expired` at
20:32:46, 183.4 s after `dropped`; the server kept the session `live` throughout; the network came back at 20:33:34.6;
the first beat at 20:33:35.4 carried the phone already off the sid; the server ended the session 0.5 s later and the
phone logged `stopped-delivered 200`. One `broadcast-start`, no rejoin, one Cloudflare recording, no credit consumed.

**Remaining edges (parked):**

- The server records the end as `operator_stopped`, as for a hand Stop. The only trace is in its events: a hand Stop
  writes `phone_stop` first and the `stopped:` path does not (web's `capture-phone.ts:584`). Web brief item.
- A hold running out while a 401 is pending sends no `stopped` beat.
- A cold start after process death mid-outage rejoins through A10.
- Forget or Unpair before the beat lands leaves the server session to its 15-minute end.
- The strip shows "waiting" after process death.
- Dead TypeScript: the `rejoinRetrying` copy, the `hold-expired` cause, the FakeCaptureEngine `rejoining` scenario and
  the writerless allow-list keys.
- Offline, the connect retry loop wrote 73 `capture-start-failed` lines in 183 s, and the first beat after restore
  said `notReady: "camera"` (see N39).

---

### N38 — Send record could keep none of a long session's lines

**Status:** fixed — feat/s1-d3-fixes, Batch 18 (0d3fefd, e144a38); device-checked on R-N4F3, R-DJSE and R-1WRJ. The
reload and process-death gap below: fixed on feat/court-stream (court stream P1, 2026-11-16, 40ecdaa4); a process death
restores closed since its fix round 1 (cff0754d); device check open
**Where:** capture app · `src/services/recordPins.ts` · `ring.linesToSend` · `recordUploadPort.ts` · `RecordPins.kt` ·
`BridgeCore.tail` · `RecordPinStore.kt` · `nativeCaptureEngine.ts` (`seedRecord`)

R-MA1P (2026-10-12, 10 s after a session ended) arrived with 1000 lines received, 0 kept, 1000 dropped. The JS ring
holds 1000 lines and drops the oldest; ten minutes of a live session fill it, and the `pair` line (which carries the
tokenTag) and the sid-bearing lines roll out, so the remaining lines sat in no pairing window and the web kept none.

**Fix:** the latest `pair` line and the latest sid-bearing `broadcast-start` are pinned outside the ring's capacity
and sent first, then the newest lines, 1000 in total. The pins release only when the window's closing line
(`unpaired`, `ended`, `pair-refused`, `reset`) has itself left the ring, or when a newer `pair` replaces them. The
controller's first rule, release when the closing line arrives, was wrong (review: Critical, since Send is off-air
only and every send follows a close); the amendment is cited in code as "the controller's amendment to the N38 ruling
(2026-10-13)".

**Device proof:** R-N4F3 received 178, kept 76, dropped 102 (the lines before the #4 pair), invalid 0, pair line
leading; R-DJSE received 328, kept 197, dropped 131, invalid 0, covering two sessions; R-1WRJ received 623, kept 621,
dropped 2, invalid 0 (evidence: `$HOME/seazn-d3-evidence/2026-10-13/n37-cut-web-report.md`). The 1000-line overflow case
is covered by unit and end-to-end tests but not yet seen on a device.

**Reload and process death (court stream device check, 2026-11-16; the controller's ruling):** a court code paired for
hours sent 34 lines and the web kept none ("sessions: none named"). After a JS reload or a process death the ring is
seeded from native's tail alone (`BridgeCore.tail`, at most `SessionRecord.LAST_LINES`, 20 lines, and empty in a new
process), and the pins lived only in the old ring. Now native pins the same two lines by the same rule (`RecordPins.kt`,
`recordPins.ts`'s rule for rule), and its tail carries those it has let go of beside its lines (`{pins, lines}`). An open
window's start is kept in the private store (`record-pins`, `RecordPinStore.kt`): written when it changes, deleted when
the window closes or a re-pair replaces it. The seed hands the pins to the ring before the tail's first line, once
(`RingRecord.adoptPins`, `pinsAdopted`), and the ring sends them first. In one process they stand, as the ring's do,
until the closing line has left native's tail; a closed window is never restored.

**Process death, closed restore (fix round 1 of P1, I1 of its review; the controller's ruling):** a restored window
first came back open, so a cold start that did not re-pair (an expired code, a tap to pair never made, a Forget whose
marker was written before its `unpaired` line) filed every new line under the dead code. Restored pins now come back
CLOSED: the new process carries the kept `broadcast-start` alone, first, so the old session is still named (A1 judges
it by its sid), and no `pair` line. The web opens an A2 window at any `pair` line in the body and runs it to a closing
line or the next `pair`, neither of which such a cold start writes, so a restored pair would file the new process's
lines under the old code; that is why the pair is neither kept nor restored. The restored start opens no window, no
line moves it, and a new `pair` replaces it, opening a fresh window as before. The store then holds the start alone,
so every later start restores it closed again, for at most 24 h after it was written: an older start is not restored
(`RecordPins.RESTORE_WITHIN_MS`; fix rounds 2 and 3). That is a hygiene bound counted from the line's write, so a stale
start does not lead every Send until a re-pair; it is R4's length but not its upload credential's life, which runs from
the code's drop (a saved code keeps a live credential for days). A start dated ahead of the clock is restored (the
controller's ruling: no clamp; it only names a dead session). A pairing that never started a broadcast restores nothing: its own lines died with the process. No new
line kind: the Send upload contract and the web's allow-list are unchanged.

**Parked:** Send still never reads the native 5 MB disk record (the owner decides whether it should), so after a reload
a Send carries the pinned pair and start and the lines since the seed, and after a process death the restored start
and the new process's lines, never the match's lines in between. The new process's `previous-session-lost` line carries
no sid (`PreviousExit.kt`), so the web files it under no code (parked by the controller; not a regression: before this
fix it was never filed either).

---

### N39 — The beat's `not_ready` hides which check failed

**Status:** two parts. The stuck camera state after a session ended is fixed — feat/s1-d3-fixes, Batch 19 (dcc5bb0; the
owner's ruling, 2026-10-13, "fix it now"). The beat naming the failed check is open for the web brief, a contract change
**Where:** capture app · `Readiness.notReady()` · web `capture-beat.v1.json`

On sid e6aeaee3 (locked, Dozing) the web showed `not_ready` for 100 s of live video and the first reading was that
the camera had failed. The phone's record (R-DJSE) shows `camera:true` and `sound:true` throughout, with no
camera-lost, camera-taken or mic-silenced lines; the false check was `held` (the phone lay at an angle on the desk,
A11's held-sideways gate, by design for every start). `notReady()` sends one word, and the beat carries only
`not_ready`, so the operator, the console and the controller could not tell which check it was. The 14 s start delay
was the Armed gate waiting for the held pose. The camera fix planned in Batch 8 Step C is dropped.

Path 2 of 2026-10-12 (a locked phone held until unlock, strip "Phone not ready: camera") did not reproduce on
e144a38 and its cause is unexplained. On 2026-10-13 the first beat after a hold-expiry restore carried
`notReady: "camera"` as well, after 73 failed capture starts in the offline retry loop; whether those two are linked
was read in code, not run (scout, 2026-10-13). The 73
`capture-start-failed` lines are CaptureRun's label for any throw from the streamer's start, so an offline endpoint-open
failure gets that name (`CaptureRun.kt:326`); each retry reuses the held streamer and camera, and a transport failure
never touches `CameraAvailability`, so they cannot by themselves make the camera look lost. One path does: when the
hold expires the machine goes to Paired and copies `phase.camera` into `pairing.camera` (`Verdicts.over`, `Pairings.kt:302` before Batch 19), and a
RESUMING or SWITCHING value carried there is reset to OWN only by `SessionMachine.kt:369` (OnAir frames) and `:523`.
A Kotlin probe confirmed it (the reviewer's scratch copy, not committed; 2026-10-13): Live → SwitchCamera → Dropped →
hold expiry leaves Paired with `pairing.camera` SWITCHING, so the camera check is false, the operator's Start answers
`intent-ignored`, and a console Go live sits in Armed for more than 30 s with no connect; the same run without the
switch connects. No start is possible on that pairing until a rescan, or until another app takes the camera and gives
it back. The same holds for RESUMING, and for any `Verdicts.over` (an organiser's end, say) while the camera is
SWITCHING or RESUMING. It was already there at the branch's base, 0a2c565.
R-1WRJ's kept lines show no camera-lost line (the web's summary), so whether this path made the first beat after
N37's restore say `camera` is not shown. The owner's first answer on 2026-10-13, given while the carry-over was
unproven, was "leave all three out and ship"; once the probe confirmed it the controller asked again and the owner
said to fix it now.

**Fix (Batch 19, dcc5bb0):** `CameraState.afterSession` (`Phase.kt`) is an exhaustive `when`: TAKEN and REOPENING carry
into the pairing as before, SWITCHING and RESUMING become OWN. `Verdicts.over` applies it, and it is the only place a
session's camera is copied into the pairing, so hold expiry, an organiser's end on a beat or on the code, Go live for a
new sid while a broadcast is held, and a Stop before going live all hand back OWN. A cold start reads OWN, since
`PairingStore` never saves a camera state. Kotlin core 1406/0. Device-only and not checked: whether "Phone not ready:
camera" clears on a phone after a switch and a hold expiry.

**Parked from Batch 19's review:** the `?: CameraState.OWN` fallback in `Pairings.kt:303` is unreachable (every caller of
`over` holds a sid); no test pins the heartbeat's `notReady` after these ends; the cold-start test's name overclaims
(`CameraAfterEndTest.kt:261-277`). Probe G1, which existed before this batch: re-pairing with another code while the
camera is TAKEN resets it to OWN, and the later release sends no `ReopenCamera`.

**Brief for the web:** let the beat carry the failed check's word. A contract change, so not in this branch.

---

### N40 — Pressed buttons showed no change

**Status:** fixed — feat/s1-d3-fixes, Batch 17 (702b08d, acd92f0, 71931d8; the review's test minors: 7a63b2c); device-checked on e144a38, phone A
**Where:** capture app · `colour.pressFill` and `pressedOpacity` (`tokens.ts`) · IconButton · GhostButton · Tile · Button · TextLink

The owner's finger test (2026-10-13): holding the Home tile's gear changed nothing on screen, and it opened on lift.

**Fix:** the token `colour.pressFill`, `#f5f0e833` (the cream at 20%), is the pressed fill on IconButton, on both
GhostButton forms and on the Home tile's gear (a rounded square, `radius.card`); the edge of the outlined buttons
still goes cream (`ink`) while held. Button and Tile dim to 0.7 and TextLink to 0.6 (`pressedOpacity`). The code cites
it as "the controller's press-fill ruling (2026-10-13)".

**Device proof (e144a38, phone A):** the controller's adb hold of 4 s on the Home tile's gear showed the fill, and the
owner then saw it with a finger ("see it"). A device-only claim: jsdom sees no colour and no press feedback.

**Parked:** Pressables with no pressed state: Settings' side segments (`SettingsScreen.tsx:162`), ChoiceRow, the Hide
of ScoringLinkPanel and of ViewerCover, HoldAction, and CodePanel's close. Show preview's ghost (PreviewBoundary), held
on the stage black, is 1.59:1, and under outdoor flare the fill is 1.20–1.24:1: both are device checks.

---

### N41 — A quiet picture held the floor for 18 minutes, and the record could not say why

**Status:** changed — fix/r990p-bitrate-climb (6d103e1, c60cf32); the owner asked for a faster tested climb and a
record that explains the regulator ("yes", 2026-10-26), and the numbers (a 20% step, one held line a minute) are the
controller's calls. Not yet run on a device. The web's record contract lists the new keys since web f0feab16c
(below); open: constant bitrate is a later device experiment, not built
**Where:** engine core · `BitrateRegulator` · `SessionMachine.link` · `allow-list.json` · web `capture-record.v1.json`

R-990P (stg, 2026-10-26, Android on Wi-Fi, SRT) was a rejoin of sid 4516d82a after the operator force-quit the app
(N42). It went live at 16:26:12.9; at 16:26:24.9 the regulator cut 1500k to 998603 and at 16:26:26.9 to the 500k
floor. It held the floor for 18 minutes. From 16:44:30 it climbed 100k a raise to 1800k at 16:47:15: 13 raises in
165 s. The owner confirmed the cause of the hold: the camera faced a still laptop scene, so VBR's egress stayed under
F-P5-7's raise gate, which at the floor is 70% of (500k + 128k) × 1.15, 505_540 b/s. At about 16:44 the owner
turned the camera to a busy garden scene, and tested raises resumed. F-P5-7 is a device-proven rule
(`docs/specs/2026-09-11-p5-android-results.md`, F-P5-7): a quiet picture must keep holding, and nothing here weakens
the gate.

The record could not say why the first cut happened. The `bitrate` line was `from` and `to` only, and 998603 is not
a half or a quarter of 1500k, so it was sized by SRT's bandwidth estimate (1_408_254 b/s would give it) or by the
mean egress of the last clean readings (1_619_492 or 1_619_493 b/s would): the line names neither, nor whether
sender drops or the send buffer triggered it. r2's answers (2026-10-26): the relay's "camera frames replaced" means
the phone was at or above 30 fps on the wire, and nothing on the relay side survives for 16:26:20–16:27.

**What changed (this branch):**

- A tested raise is 20% of the target, never under 100k (`RAISE_STEP_PERCENT`, `raiseStepBps`); the 20% is the
  controller's call. A busy clean link climbs from the floor to the ceiling in 10 raises, 100 s (500k, 600k, 720k,
  864k, 1_036_800, 1_244_160, 1_492_992, 1_791_590, 2_149_908, 2_579_889, 3000k), where 100k a raise took 25
  raises, 250 s; 1800k is passed in 8 raises, 80 s. The 10 s clean interval, 10 s between raises, 30 s after a cut,
  the 70% gate, the 80% cap on a rate that failed in the last 5 min, the cut rules and the floor, start and ceiling
  are unchanged. The cost: a step now reaches further past the rate the interval tested (2_579_889 to 3000k is
  +420k on one test). The cut rules and the 80% cap catch an overrun; a busy picture on a thin link with 20% steps
  has not been run.
- Each `bitrate` line says why (`reason`: `drops`, `backlog`, `raise` or `clamp`, from the regulator's own verdict,
  `BitrateMove`) and on what reading: `egressBps`, `dropped`, `lost`, `sendBufferMs` (as reported, a negative
  reading included) and `bandwidthBps`, each a number or null.
- `bitrate-held` (new kind): when F-P5-7's gate held at least one due raise, at most one line a minute while on air,
  with the `target`, the held interval's mean egress (`egressBps`, null when no reading measured any), the gate
  (`gateBps`), how many due raises it held since the last line (`count`) and the encoded frame rate (`videoFps`, the
  stall watchdog's 3 s rate). The first goes at once; one a minute is the controller's call. R-990P's hold, about
  1040 s from the first due raise (30 s after the cut) to the last before 16:44:30, would read as about 18 lines, not
  one for each of some 100 held raises. None when the target is at the ceiling or the 80% cap (nothing to raise to),
  and none off air. A drop and a new attempt keep the minute and the count, so a reconnect neither writes early nor
  loses what was held; a new session starts afresh.
- r2's fps ask, in part. StreamPack 3.2.1 has no encoder output rate (`IEncoder` has the bitrate only; read with
  javap), and its configured rate is our own `VideoCodecConfig(fps = 30)` (`StreamerAdapter.kt:404`), which the core
  does not hold. The rate measured from the frames the sink writes was already in the core (`FrameTally` →
  `Input.Frames` → `StallWatchdog.videoFps`), so the held line carries it under the existing `videoFps` key. No
  configured `fps` was added: it would need the glue to hand a constant to the core.

**Brief for the web (done):** the record contract (`capture-record.v1.json`, then vendored at a6cc1f038,
`additionalProperties: false`) listed none of the seven new scalars: `bandwidthBps`, `dropped`, `egressBps`, `gateBps`,
`lost`, `sendBufferMs` and `target`. Until it did, Send record dropped them from their lines (Q4, `fitLine`), and the
contract admitted the rest (`from`, `to`, `reason`; `count`, `videoFps`); Share record kept them. The new kind passes
the contract's pattern. Done 2026-10-26: web #1037 (f0feab16c) lists the seven, vendored in capture PR #24, so Send
record carries the whole line.

**Review of #23, closed 2026-10-27:** a raise's `bitrate` line now carries the interval's mean egress that passed the
gate (it carried the one reading the raise fell due on) and `count`, the due raises held since the last
`bitrate-held` line, which only a later held line said, folded into its count, and none if no hold came; `gateBps` rounds up, so it is the least egress that raises (it
named one 1 b/s under the gate that held). No new key: `count` was already the contract's.

**Constant bitrate (CBR), not built:** a later device experiment. VBR on a quiet picture is what leaves the gate
untested, and CBR would test every interval. Its costs: about 4 GB of mobile data per 3 h at 3 Mb/s
(3_000_000 × 10_800 s / 8), possible heat, encoders that ignore the CBR mode, and `SrtBandwidth`'s overshoot
factor (`OVERSHOOT_FACTOR`, F-P5-11), which is sized for VBR.

**Cloudflare's input recommendations** (r2, 2026-10-27; each point labelled as r2 labelled it). Source:
[Stream Live, Requirements and Recommendations](https://developers.cloudflare.com/stream/stream-live/start-stream-live/),
fetched 2026-10-27.

- DOC: input bitrate "should be between 2 Mbps and 14 Mbps" ("should", not "must"; "typically under 10 Mbps"), and
  CBR is preferred over VBR "When possible". The phone sends 500k–3000k, so it is under that whenever the target is
  under 2000k; the 500k floor is 4× under it.
- DOC: the keyframe interval "must be between 2 and 10 seconds", with closed GOPs; 4–8 s is the recommendation for
  standard HLS/DASH (a shorter GOP lowers latency and costs encoding efficiency). The phone's 2 s GOP
  (`gopDurationInS = 2f`, `StreamerAdapter.kt`) is valid, at the bottom of the range.
- UNKNOWN: what Cloudflare does with an input under 2 Mbps. The doc and its
  [troubleshooting page](https://developers.cloudflare.com/stream/stream-live/troubleshooting/) name no effect on
  renditions or packaging. The owner saw R-990P's recording look fine on YouTube (observed, not measured). No link to
  F-P5-13's falling behind is measured: none is recorded.
- INFERRED from the compositor's code: in composed mode the relay re-encodes at a fixed rate (720p 4000 kb/s, 1080p
  6000 kb/s, 2 s GOP), so its output to Cloudflare stays inside the recommended range whatever the phone sends, and the
  relay has no input-rate check. But the camera's detail is capped by the phone's rate: a 500k picture re-encoded at
  4 Mb/s is still a 500k picture (the overlay stays sharp). The phone's GOP matters to the relay only at a start or a
  reconnect, where 2 s is the shortest wait for a keyframe. No run at 500k measured the relay.

So the floor is a choice outside Cloudflare's "should", with its effect unmeasured, and it is one more reason the climb
off it matters (this finding's fix). A higher floor is not proposed (the capture session's call, not the owner's): on a
thin link 500k is what gets through.

---

### N42 — After a fall the preview went black while capture and publish carried on

**Status:** reproduced and explained 2026-10-26; mended (PR #26), and the mend seen to fire on a device 2026-10-27 against
the stuck state forced by a debug-only trigger; the race itself not reproduced on demand
**Where:** capture app · the viewfinder's native preview (`CapturePreviewView`, StreamPack `PreviewView`) · the record

In the first run of the session N41 rejoined (2026-10-26, stg, sid 4516d82a), the phone fell, and after the fall
the preview on the phone went black. The owner: the preview was black only in that run, after the fall, and good
after the relaunch. Capture and publish carried on: r2 read stg's programme_phase events, and the relay went waiting
→ live at 16:24:41.8 and kept camera frames on air at 30 fps, output 2.6–5.5 Mb/s, with no loss until frozen →
reconnecting at 16:26:16.8, 9.6 s after the app process exited (16:26:07.17, the force-quit). The owner watched the
YouTube recording of that run: "I don't see any blank or black screen, a few seconds of logo then streaming". So
viewers had a real picture throughout; the black was the on-phone preview only, and the camera → encoder path kept
working. Cloudflare has no recording of it (stg: `recording_seconds` 0), so the evidence is the owner's look at
YouTube. How the preview went black is unknown; one candidate is the preview surface lost and not re-attached.

The harm was indirect. The black preview led the operator to force-quit, a reasonable reaction, and the force-quit
caused the real outage: the replay shows the compositor's "Camera reconnecting, back shortly" scene (score bug and
match card still showing) from 16:26:16.8 to 16:26:51.8 UTC, about 35 s with no camera. The phone was publishing
again from 16:26:12.9 (its `live` line); the rest of the gap is the relay's, under compositor Owed 108 (r2's
hypothesis is the input rebuild backoff; not ours to fix). So the app's `live` is not when viewers get the camera
back: here they got it 39 s later.

Candidate record lines, not built: frames encoded while the preview is not running (r2's suggestion), and its
mirror, the preview's state (attached, surface valid, frames shown), which would have caught this one.

**Repro (2026-10-26, 23:25, stg, NE2211 on USB, release build of main `03c6af5`).** The box went black at once on
going live, with no fall and no touch. Logcat: at 23:25:44.73, after the turn to landscape (surface changes at 43.57
and 44.24), the androidx CameraViewfinder (1.4.0-alpha13, inside StreamPack 3.2.1's PreviewView) closed its surface
request, destroyed its SurfaceView, attached a new one and logged "Wait for new Surface creation." No surface came.
The hierarchy dump: PreviewView and CameraViewfinder at 1280 x 720, **the new SurfaceView at 0 x 0**. A SurfaceView
with no size gets no surface. One forced layout from outside (`wm size 1080x2300`, then `reset`) made it 1280 x 720
and the picture came back at once (screenshot at 23:30, LIVE 0:04:35), with nothing restarted: the camera and the
encode had run all along. So the black is a lost layout. React Native lays out its native views itself, with no
ViewRootImpl pass to catch a layout asked for during a layout, and ExpoView's posted `measureAndLayout` re-measures
only what still reads as asked (inferred; the stack of the swap was not captured). R-990P's fall fits: the phone
turned, and the viewfinder swapped its surface.

**Mend.** `CapturePreviewView` checks its preview's tree once a second while attached; `PreviewRelayout` (pure,
tested in core, every guard mutated once) asks for a layout when a shown view waits for one or has no size at two
checks in a row, and the view lays the preview out at the encode's size with every view under it marked. One
`preview-relaid {reason: requested | empty}` line an episode.

**Device evidence (2026-10-27, run R-C5WC, NE2211 on USB, debug build of `fa65034` with Metro, stg).** The race could not be forced:
in a release-build run that morning the viewfinder swapped its surface four times and each new one came within about
15 ms, so the mend had nothing to do. So a debug-only trigger (`PreviewSeam`, filled by `LoseSurfaceInstaller` as
`HttpSeam` is; `adb shell am broadcast -a com.seazn.capture.debug.LOSE_SURFACE -p com.seazn.capture`) lays the
SurfaceView out at 0 x 0 and asks nothing of its parents, the stuck state of 2026-10-26. It tests the mend, not the
race.

- Paired, waiting: forced at 12:50:08.491 (box black in the shot straight after); `preview-relaid {reason: empty}` at
  12:50:09.989; the surface 1280 x 720 again at 12:50:09.999 and the picture back in the shot at 1 s, nothing restarted.
- Live, on SRT: forced at 12:52:25.020; `preview-relaid {reason: empty}` at 12:52:26.135; picture back in the shot at
  1 s, the broadcast live throughout. (The strip's TROUBLE in those shots was the uplink, from 12:52:06, before the
  trigger: backlog, then drops and loss, and the regulator's cut and climb.)

---

### N43 — The web's record allow-list does not carry three keys the scoring runner writes

**Status:** open — deferred to the next record contract change (web); owner ruling 43, 2026-11-02, is what added two of them
**Where:** capture app · `src/hooks/scoringRunner.ts` (`stallFields`, `sayAsk`) · `src/services/recordContract.ts` (`fitLine`) · web record contract (vendored at `f0feab16c`)

`fitLine` keeps only the keys in `RECORD_LINE_KEYS` (104, the web's own list) when Send record goes to Seazn, and drops
the rest of that line's fields; Share record writes the record as it is. Three keys the scoring runner puts on a line are
not in the list, so a record sent to Seazn has the line without them and a record shared by hand has them:

- `said` on `scoring.stalled`: the rules version the server last named (the stall's reason is `rules`, `held` is the
  one the phone sends under). Without it a sent record shows the stall and the version held but not what the server
  wanted.
- `foreign` and `queued` on `scoring.ask` (ruling 43): how many events another scorer made while the phone held `queued`
  taps. `scoring.asked {answer}` is whole, since `answer` is on the list.

Nothing is lost on the phone, and the line is still there in a sent record with its event name, its level and its other
fields, so a reader sees that a question was asked and how it was answered. The counts are what a web-side reader of the
sent record cannot see.

A fourth line, `scoring.dropped {reason, count}` (review of the whole branch, 2026-11-03), needs nothing from the web's
list: both keys are on it, so a sent record carries the line whole. It says that `count` taps left the queue without
counting (the pad's "Not recorded" line, once however many), and why: `reason` is the server's own upper-snake word, or
`NO_LONGER_LEGAL` when the phone's check dropped them against the ledger, or `OTHER`. The key is `reason` and not `code`
because the scrub masks any field named `code` (`NEVER_KEYS`). Web follow-up, with the keys above: the record reader
should know the event exists, since a record without it hid every such drop.

**Deferred, not mended:** a key goes in the web's list only through a web change and `pnpm contracts:vendor`, and the
test that holds the two lists equal (`recordContract.test.ts`) then moves with it. Asked for with the next change to the
record contract, `said`, `foreign` and `queued` together. Until then the counts are read from a shared record.

---

### N44 — After a lost beat the phone was deaf to a Go live for a minute, and a held Go live looked like nothing happened

**Status:** fixed on `feat/court-stream` (court stream Task 13: P1, P2 and review fix rounds 1 and 2); the device re-check
on the NE2211 against staging is open
**Where:** native core · `Heartbeat.kt`, `BeatCadence.kt` (`retryMs`) · `Projection.kt`, `SnapshotWire.kt`
(`pairing.starting`) · capture app · `src/hooks/useUnpair.ts` (`START_ANSWER_WAIT_MS`) · `StreamColumn.tsx` ·
`ContinueCard.tsx`, `CodePanel.tsx` (Home while starting)

Two things seen in Task 13's device check of the court stream, both native-owned.

**The deaf minute.** A beat timed out at the server's 60 s cadence. `HeartbeatState.failed()` kept the last send's time,
so the next beat waited the whole 60 s, and a Go live the desk gave in that minute reached the phone up to a minute late.
The rule now (the controller's ruling, fix round 1):

- A _passing_ failure brings the next beat forward: no answer (a transport failure), a beat given up at 10 s, a 408 or a
  5xx. The next goes 5 s after the failure, then 10 s and 20 s for the second and third in a row; from the fourth the
  cadence decides. Never later than the cadence (a retry only brings a beat forward), never sooner than 5 s (the poll
  floor, `BeatCadence.MIN_POLL_S`). A 2xx resets the count.
- Any other 4xx (400, 404, 422, …) keeps the cadence: the server answered, and a retry would get the same answer.
- A 429 with no Retry-After keeps the cadence; with one, the beat goes when it ends, even past the cadence.
- Every failure in a row takes a step, a 4xx included, though a 4xx brings no beat forward itself; only a 2xx resets the
  count. Kept so on review (fix round 2, the controller's ruling): the steps stay bounded at the cadence whatever the mix,
  one counter is simpler than one per class of failure, and a test pins it (a 404 then a 503: the retry comes 10 s after
  the 503, `HeartbeatTest`).

Rejected: retrying at the cadence (the old behaviour): it is the deaf minute. Rejected: a flat 5 s retry (P1 as first
built): when the server is in trouble every phone at the venue would beat every 5 s, twelve times the 60 s load at the
moment it can least take it, and it retried answers that cannot change. The held cadence (10 s) is untouched: its first
retry is the 5 s, and the 10 s and 20 s steps are never sooner than the cadence, which then decides. Two pins moved with
it: a heartbeat that fails forever while live beats at 10, 15, 25, 35, 45 … 595 s (60 failures in 600 s), and N37's
offline stopped beat at 8, 13, 23 and 33 s (4).

**The silent hold.** After the 3 s hold, native posts start and waits for the answer for up to its HTTP bound (8 s,
`Http.TIMEOUT_MS`). All that time the screen still read Ready and "Waiting for Go live" over an enabled Go live, so the
operator could not tell the hold took. Native's snapshot now says so: `pairing.starting`, true in Paired from the post
until its answer, and only in Paired (`Phase.ended()` keeps the pairing, so an end with the start unanswered would
otherwise carry it into Ended). It is a non-telemetry field, so it is published at once. JS words it: Go live becomes a
disabled "Starting…" plate with no hold on it, the tally reads Connecting, and the line is the operator's own "Opening
the link.", the line its Arming says, so nothing moves when the server answers Started. A failed answer clears it with
the start-failed line, and Go live comes back.

Native ignores an unpair while a start is in flight (`Pairings.unpair`), so a Forget, a court Leave or A7's Confirm sent
then was dropped at the 5 s give-up, with the code kept. `useUnpair` now waits for native's answer to the start, bounded
at 17 s (`START_ANSWER_WAIT_MS`), then unpairs after a failed start or answers `held` for one that armed; the unpair then
has its own 5 s. The bound was 10 s (the 8 s HTTP bound with room); fix round 2 (the controller's ruling) raised it to
outlast the bridge's backstop (`BridgeCore.ANSWER_BACKSTOP_MS`, 16 s), the latest native answers a start, so a slow
answer is never given up as no answer. An unpair sent just before the start showed reaches native while it is in flight
and is ignored, so the wait asks again once the start is answered (fix round 2). Chosen over hiding Leave and Forget while
starting (the other way the fix round 1 ruling allowed): one place covers all three callers and the reopen gate's own
clearing, no control appears or disappears under the operator's finger, and the tap is honoured rather than dropped. Fix
round 2 (the controller's ruling) adds, on Home only: while the start is in flight, Forget on the Live Stream card and
A7's Unpair & open are disabled, not hidden, and the card and the sheet say "Opening the link." in place of "Waiting for
Go live"; the wait still covers a tap that lands just before, a court Leave and the reopen gate.

**Open:** "Opening the link." is a routine line, so on an uncharged or warm phone an advisory caption wins the strip
(AGENTS §6's two tiers); the Starting… plate and the Connecting tally still say it. An urgent line for it would be the
owner's call.

### N45 — Another app that took our camera on air made the phone reconnect, not put the slate up

**Status:** found in the court stream's device check (NE2211, dev build, SRT, staging, 2026-11-17); fixed on
`fix/camera-taken-on-air` (core and glue, Kotlin tests through the real machine), fix round 1 after review; the device
re-check is open
**Where:** native glue · `CaptureRun` (`lostByDevice`, `busyByDevice`, the probe) · `CameraAvailability` (`taken`,
`probed`, `busyOpen`) · `VendorLines` · `EngineHost` · `CameraWatch` · `CameraProbe` · `StreamerAdapter` (`busyOpens`,
`probeCamera`, `slate`) · relates to N21, F-P5-10, F-S4-1, the S1 design's decision 7

**Evidence** (the session record, secrets stripped):

- 15:19:34.0Z `adb shell am start -a android.media.action.STILL_IMAGE_CAMERA`, while live: the system camera app opened
  the back camera, ours.
- 15:19:35.525 StreamPack's `CameraUtils`: "Camera 0 has been disconnected"; 35.533
  `camera-lost {from: device, attempt: 5}`; 35.868 `readiness {camera: false}`. No `camera-taken` line followed, and
  no slate.
- 39.775 `video-stalled {cause: no-video, msSinceAdvance: 3061}`, then `connecting {srt, attempt: 6}`. Its start met
  "Camera 0 is in error 2" (40.127) and `CameraController` "Error to add target stream", and carried on: connected
  at 41.123 with no picture.
- 46.128 `video-stalled {no-first-frame}`, attempt 7 (error 2 again at 46.221); 51.676, attempt 8.
- 15:19:50 the app was brought to the front, and the camera app let the camera go; 53.406
  `resumed {cause: video-stalled, outageMs: 13631}`.

The server composited its own "Camera reconnecting" slate, so viewers were covered. The phone never said
`stream.status.cameraTaken` ("Camera taken by another app — slate on air"), and it reconnected the uplink three
times in 13 s, which no reconnect could cure.

**Cause.** The slate path exists and was never told. `Input.CameraContended` makes the camera `taken`: the slate on
air with silent audio (decision 7), the stall watchdog held, the snapshot degraded `camera-taken`, and
`CameraReleased` reopens the camera (F-P5-10). That input came only from Camera2's availability callback, which was
built for another app opening _another_ camera (P5's WhatsApp call, F-P5-9), and which skips every event for our own
camera's id, since our own opens make it unavailable. An app that opens _our_ camera evicts us, and Camera2 says so
only as our device's disconnect, which only StreamPack's log carries. F-S4-1 heard that log as a loss and, with an
attempt held, only marked it ("the attempt's own paths decide"). So the machine kept the camera `own`, the watchdog
read the missing video as a stall and rebuilt the transport, and each rebuild's start opened the camera into the
other app's hold, which StreamPack logged as error 2 (`ERROR_MAX_CAMERAS_IN_USE`) and swallowed.

**The fix** (PR #62; items 4 to 7 are fix round 1, after review I1, I2 and M1 to M3, on the controller's rulings):

1. With an attempt held, a loss of our camera is another app's take. The capture tells `CameraContended` once
   (`CameraAvailability.taken`, the busy open's rule), so the machine's own path runs: the slate up, the watchdog
   held, `camera-taken` in the record and the snapshot, and the strip's `stream.status.cameraTaken` (JS unchanged).
   The endpoint stays open on the same attempt. With nothing on air a loss is still built afresh (F-S4-1).
2. StreamPack's busy errors (1 and 2) are a word of their own (`VendorLines` to `busyOpens`), read only with an
   attempt held: a take, `camera-lost {from: busy}` then `camera-taken`. A reopen that lands on a camera another app
   still holds, whose open StreamPack fails and swallows, is so taken again, where the watchdog would otherwise
   reconnect 3 s later and churn. With nothing on air the open's own paths read it, as before (I4, I-2).
3. The slate's end gives the mic back. `slate(false)` returned before unmuting when the source was already a camera,
   which on air it always is (the reopen swaps the camera in before the machine takes the slate down). StreamPack keeps
   the mute on the audio input's processor (`AudioFrameProcessor.isMuted`, javap), so after any reopen on air the
   broadcast stayed silent, and so did the next one on the same streamer, until a rebuild. Found by reading the path;
   never seen on a device. Review M2: the mic now comes back after the swap to our camera, never over the slate.
4. **A take always ends without an "available" (review I1).** The first cut's only release was Camera2's available
   for the camera the other app held, and it may never come: the device check's error 2 (`ERROR_MAX_CAMERAS_IN_USE`)
   means the holder sat on another id, hidden from our watch, and our own id went available once, at our eviction.
   The slate would have stayed up until Stop. Now, while the slate is up, the capture asks Camera2 itself whether our
   camera opens (`CameraProbe`: open, close at once, answered once closed, bounded at 2 s, never beside a camera
   source of StreamPack's): every 5 s, and at once on a word that it may be free (Camera2's available for any camera,
   `onCameraAccessPrioritiesChanged`, the app's return to the foreground). An open tells the take over and the
   machine reopens the camera under the slate: `camera-probe {ok: true}`, `camera-released`, `camera-reopened`, and
   `camera-resumed` at its first frame, within 5 s of the holder letting go. A refused probe keeps the slate and
   writes `camera-probe {ok: false, error, failures}` at the first and then once each 30 s; its error word is Camera2's
   reason (`in-use` for a holder on our id, `max-in-use` for one elsewhere, review M3). The probe never touches the
   transport: no rebuild, reconnect or stop comes from it. Re-review R1-C1: it probes only a take of OUR camera, and
   frees only ours. Another app's take of another camera (F-P5-9, a call on camera 1) is never probed: a probe would
   open ours beside the call, and the reopen it brought mid-call was never measured, where F-P5-10 measured that only
   a reopen after the release healed the noise. So the call's release reopens ours, as before. With both taken (the
   call's open also cost us our device), the probe frees ours and the call's release, the last, tells the take over.
   Re-review R1-M2: Camera2 cannot cancel an open asked, so a probe that times out waits up to 1 s more for that
   open's close before the capture's queue moves on, where a reopen would open our camera a second time beside it.
   Re-review 2, R2-I1: a take found at the start (C7: a Go live into another app's hold, such as a remote start while
   the camera app is open, which N28 lets go ahead) is our camera's too, and is probed. It read as ours in name only,
   so with the holder on a hidden id the slate stayed up until Stop. R2-M2 (the controller's ruling): Stop and unpair
   never wait behind a probe. They abandon it, so the endpoint closes and the camera is released at once, and the
   probe's own callbacks close what the open asked brings. Anything else waits for its answer, a reconnect's Connect
   included: that is a known cost of up to 3 s when Camera2 answers no open within 2 s, past `START_BOUND_MS`'s
   one-second margin, so the machine's connect timeout speaks first and C6's late-open path closes the attempt.
5. Our own camera's available is no release of the capture's own take of it: our eviction says it too, before or after
   the take, while the other app still holds the camera. Its probe decides. Off air (a new open of ours asked) it is
   the release again, as I3 has it.
6. **A busy word makes our open reports no open (review I2).** StreamPack 3.2.1 can report a source open after its
   open failed busy. Javap: `CameraSource.startPreview` and `startStream` both report it once
   `CameraController.addTarget` returns, and `addTarget` opens the device outside its catch, which covers only the
   session's start. So a failure of the session is swallowed and reported as an open, for the preview and the stream
   alike, and a failure of the device's own open throws for both; which stage a busy failure comes at is device-only.
   Read after the busy word's take, such a report told the take over, and the machine reopened a held camera and
   reconnected twice in 10 s (the review's probe A, now a machine test that failed before the fix). The word is marked
   as it is heard, before its take is queued, and only a new open asked clears it: the preview's busy failure tells a
   take from outside the queue (C7 I-2), and a report read before a queued mark told that take over. Re-review R1-I2:
   the mark is set only while a broadcast is held, and ends with it. Marked off air, it blocked the preview's own
   reopen (`PreviewView` restarts the preview each time its window shows, with no open of ours asked) from telling an
   error-2 take over once the holder let go, and Go live stayed disabled until a camera switch or an unpair (the
   re-review's probe G, now a test). Re-review 2, R2-M3: round 2 justified the scope by a failed preview open that
   throws and reports nothing, which javap contradicts. The reason is that off air nothing reconnects: a false open
   costs at most a start that meets busy, which is probed (item 4).
7. **Review M1.** A camera lost at every open (a device error, no other app's) was reopened at every release with no
   cap. A take that comes back within 10 s of a probe telling the last one over is a retake; after three in a row
   the probe waits 30 s, not 5. Re-review R1-I1: that wait is a floor no word shortens. Camera2 announces our camera
   available at every close of it, each loss's and each probe's, and CameraWatch hands each on as a word that it may
   be free, so with words honoured a camera that fails at every open came back about once a second (about 17,000
   record lines an hour, the slate flipping each time). A new slate's probing also drains any word from before it.
   With words at every reopen and every second besides, the machine test reads reopens at 1.1, 2 and 3 s, then 33,
   63 and 93 s: 6 in 120 s, against a bound of 7, and one `camera-probe` line for each. Re-review 2, R2-M1 (the
   controller's ruling): the app's return to the foreground goes through the floor, since the operator is there. One
   probe per return, at once, never a loop: with the camera still failing, the next waits the floor out again. One
   probe answers every word heard before it, so a return and Camera2's available that come together are one probe.

**Keyframes and frames while the camera is gone** (the brief's question 4): nothing new. The slate keeps both tracks
flowing. StreamPack 3.2.1's `BitmapSource.startStream` draws the bitmap with `scheduleWithFixedDelay`, every
1/`VideoSourceConfig.fps` (javap), so the encoder gets the slate at the encode's 30 fps and its own 2 s GOP
(`gopDurationInS = 2f`) makes the keyframes; `MuteEffect` writes zeroed buffers, so silent audio frames flow too. The
SRT or RTMPS session never sees a gap. The JVM tests prove the machine asks for the slate and never reconnects; that
Cloudflare packages the slate is a device claim.

**Rejected:** reading Camera2's availability events for our own id as another app's. Our own opens, rebuilds and
reopens make it unavailable too, and StreamPack opens lazily, so the self window cannot tell them apart. And:
honouring a release only after the holder's own "unavailable" has been seen since the take. If that event lands
before the take is processed, the release never counts and the slate stays up until Stop. And (round 1): probing with
the machine's own reopen, which takes the slate down to try, so viewers would see the slate drop every 5 s while the
holder keeps the camera, and a reopen over a held camera has no first frame for the watchdog.

**Residual (re-review R1-M1, by read):** a take of another camera told while our reopen is in flight (between the
1.5 s self window and `camera-reopened`) leaves the machine taken with StreamPack holding the reopen's camera source.
The probe stands aside beside that source, our own available is no release of the capture's take, and the reopen's
busy word, if any, makes its later opens no open. The one exit is the other camera's release, which reopens over the
camera source; a reopen that fails there rebuilds. Or Stop.

**Open, for the device:** whether Camera2 refuses our probe while the camera app is on top and lets it open within
5 s of the app closing, both from Recents and with Seazn brought to the front (the pass criterion: `camera-released`
within 5 s, Seazn not in front); which order the NE2211 delivers the disconnect and the availability events in (the
tests cover both); the slate on the programme; the mic audible after the reopen; how often
`onCameraAccessPrioritiesChanged` fires on the NE2211. A disconnect that is no other app's (a camera service restart,
a device policy) now reads "Camera taken by another app — slate on air" until a probe opens the camera (the copy is
the owner's call, review M1); a camera disabled by policy keeps the slate up and is probed every 5 s, with a line
each 30 s, until Stop. Re-review 2: which stage the NE2211's busy failures come at, so whether they report an open
(R2-M3); a Go live with the camera app open, then closed, ending the slate within 5 s (R2-I1); and an abandoned
probe's open landing beside Stop's swap back to our camera (R2-M2), which Camera2 settles by its own eviction rules.

### N46 — An outdated build's court claim read as a missing destination, and a stopped match could not be restarted or explained

**Status:** found in the court device check (NE2211, dev build, staging, 2026-11-19); the server's half fixed on web #1265
(merged at web main `1cec787a09`), the phone's on `fix/court-device-findings`; the device re-check is open
**Where:** contracts at web `1cec787a09` (`capture-beat.v1.json`'s `$defs.refusal`, `autoRefusal`) · native core ·
`ServerWord.kt` (`AppOutdated`) · `Pairings.kt` (`Verdicts.paired`, `held`) · `Pairing.kt` (`UnpairReason.APP_OUTDATED`,
`AutoRefusal.MATCH_STOPPED`) · `Bodies.kt` (`ENDING`) · capture app · `statusKey.ts` (`pairedKey`, `AUTO_REFUSED`,
`LINE_TIER`) · `engineSelectors.ts` (`selectHeard`) · `CodePanel.tsx`

Three things seen with a court code on staging.

**An outdated build looked like a lost destination.** A build older than the court stream claimed a court code and every
beat was answered 404. Native counts a beat's 404 while paired and stays paired, so the phone held the pairing, its
foreground service and its wake lock, and never heard a 2xx. With no answer, the waiting fields kept their defaults (no
destination), and the strip said "Waiting for the organiser to pick a destination": an urgent line, about a destination
nobody had read, asking the organiser for something that would not help. Web #1265 answers a court claim from a build
below `COURT_MIN_APP_VERSION` with 426 `app_outdated` (503 `unavailable` while no minimum is set). The phone now reads it
as its own word: a beat's 426 naming `app_outdated` (the X1 rule, `Bodies.ENDING`) is `ServerWord.AppOutdated`, and
while paired or Arming it unpairs with `unpaired.reason: app-outdated`. JS forgets the code, goes Home and names it in
the panel a scan of a code that needs a newer app already shows: "Update the app" / "This code needs a newer version of
the app." A 426 is the answer to a claim. From Armed on a broadcast is held, and a claim whose 2xx was lost still rides
every beat there (only a 2xx clears it, `SessionMachine.answered`), so a 426 there is counted and the broadcast runs on
(review M1; `AnswerTableTest` carries such a claim on air through three 426s). On the code check a 426 is no evidence (`NoEvidence`), and on the start it is the start's unknown refusal, as any
unnamed 4xx there is.

Chosen over staying paired with a strip line: a build below the minimum can never be answered otherwise, so a pairing
kept for it would hold the service, the wake lock and a beat every minute for nothing, and a line on a screen the
operator has walked away from says less than Home's panel, which stays until it is closed. The unpair forgets the code,
so the next scan claims again and, if the build is still outdated, is told again.

Separately, the strip no longer says the destination line before the server has answered at all. Native holds the
waiting label "" until the first 2xx beat or code answer, and the contract's label is 1 to 200 characters, so an empty
label is a pairing nobody has answered, whatever its beats fail on. Until one lands the line is "Pairing this phone…"
(routine), on a court code and a fixture's alike; a refusal or a start in flight still says its own line first. There
was no "not found" line to show instead: a 404 that names `not_a_stream_code` is the server's refusal of the code, and
any other 404 is a page, not the server, so neither is something the operator can act on from the strip.

**A stopped match could not be restarted.** The court's only match in play was stopped by hand (the desk, this court
phone's Stop hold or a handover), and the server latched it: no automatic start, and the court phone's Go live hold did
not start it either. Fixed on web #1265: the desk's Go live or the court phone's hold starts a latched match. Nothing on
the phone changed for it.

**A latched match gave no reason.** Nothing on the court phone said why the match did not start. Web #1265 adds `autoRefusal: "match_stopped"` to the court's waiting answer. Native reads it into `pairing.autoRefusal` (an
unknown word is still no refusal), and the strip says "Stream stopped — hold Go live to restart", urgent, as the other
refusals of a court's automatic start that need a person are. It is one line at 640 × 360 in all four languages (en
283.9, es 284.7, fr 290.4, nl 294.1 dp of 298; `stripTextFit.test.ts`). It names the phone's own hold and not the desk,
since the operator reading it holds the phone.

**Open, for the device:** the 426 panel. To see it on this build, staging's `COURT_MIN_APP_VERSION` must be above this
build's commit count (its build number, `appVersion` `1.0.0-<count>`; AGENTS §11), and a court code claimed again; the
stopped line after the court phone's own Stop and after the desk's, and the hold starting the latched match.
