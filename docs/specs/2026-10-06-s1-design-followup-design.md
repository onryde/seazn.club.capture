# S1 design follow-up — the owner's canvas, in the app

**Status:** draft for owner review, 2026-10-06.
**Design of record:** the owner's Design canvas "Seazn Capture — current screens", version 23
(https://claude.ai/artifact/EfaxpYmC7ReNAmUQZtkQ8F, private to the owner). The boards are the
picture; this spec is everything the picture cannot say. Where they disagree, ask — do not pick.
**Parent:** [S1 — Live Stream](2026-09-30-s1-live-stream-design.md) as amended by
[the stable stream code](2026-10-01-s1-amendment-stable-code-design.md). Nothing here reopens a
decision there unless the _What this changes_ table names it.
**Built on:** `main` at `e4584bd` (Plan C merged, PR #12).

## Delivery

Three pull requests, in order. Each is reviewed and merged on its own.

| PR | What | Risk |
|----|------|------|
| **A — design** | Everything in §1–§7 below. Almost all JS/UI; one native readiness change (§4). | Low |
| **B — device work** | Take photo (§8) and the _What viewers see_ fix (§9). Both need the phone. | Medium |
| **C — scorer code** | The Remote Scoring QR on the camera phone (§10). Needs a web change first. | Medium |

## What this changes in S1

| S1 today | After this |
|---|---|
| Viewfinder: full-bleed camera stage + a 150 dp right column | Camera is a 16:9 box on one half; status strip below it; controls on the other half (§1) |
| Match label: 12 px grey, one truncated line | Big two-sided label that wraps (§2) |
| Readiness chips are words; bottom strip buttons are words | Icons, the state in the border colour (§3) |
| Sound is ready only after sound is heard; not ready after 15 s of silence | Sound is ready whenever the mic is available. A silent room is ready (§4) |
| On air, a quiet room shows _Live with no sound_ | Removed. Only a mic taken by a call warns (§4) |
| Phone Stop leaves the viewfinder on an Ended block with SCAN ANOTHER | Phone Stop returns to Home with a _Stream ended_ card (§5) |
| Diagnostics is its own screen and button | It is a section inside Settings; the button goes (§6) |
| Home is locked portrait; Settings is locked landscape | Home turns with the phone; Settings turns with the phone when not on air (§7) |
| Home title is the word "Seazn" | The Seazn Club night logo (§7) |

## §1 Viewfinder layout (canvas option A, "split 50/50")

- The screen splits in two equal halves. The **camera half** holds the camera preview as a 16:9
  box at the top, edge to edge across the half, and the **status strip** below it (surface
  colour). The **controls half** holds, top to bottom: the tally plate with the timer (on air) or
  the sound meter (before air), the readiness chips and the start time (before air), the sound
  meter (on air), a flexible gap, the icon row, then the hold button (72 dp tall, GO LIVE / STOP).
- `controlsSide` keeps working: _Left_ mirrors the halves.
- The scorebug overlay (the transparent WebView) and the _What viewers see_ video sit over the
  **camera box**, not the whole half. The overlay keeps its design-of-record rule: never redrawn in
  React Native.
- The status strip carries, top to bottom: the match label (§2), the status line, and before air
  _You see the score slightly ahead of viewers_.
- **Must fit** a landscape phone from 640 × 360 dp up, with nothing clipped and no scrolling. The
  canvas boards are 844 × 390.
- Organiser-stopped stays on the viewfinder, as today, on this layout (board _After · organiser
  stopped_).

## §2 Match label

- The descriptor carries one joined string (`broadcast.label` or `pairing.label`, up to 200
  chars, `"{side A} v {side B}"` or `"Match {n}"`). There are no separate side or partner fields,
  and this PR does not ask the web for any.
- **Display rule:** split on the first `" v "`. Side A on its own line(s); side B on its own
  line(s) after a small grey `v`. Within a side, split partners on `" / "` — one partner per line,
  each one line with an ellipsis. A side with no `" / "` wraps to at most two lines. A label with no
  `" v "` (e.g. `Match 4`) is one block, up to two lines.
- Type: Barlow Condensed 600, 20 sp; 17 sp when the longest line is over 26 chars.
- **Tests owe:** short singles, long singles, doubles, long doubles, `Match {n}`, a label with two
  `" v "`, and the 200-char maximum — each at 640 × 360 without clipping.

## §3 Icons

- **Readiness chips** (before air): camera, mic, network, as 44 dp square icons. Lime border when
  ready, caution-orange when not; the camera icon gains a slash when not ready. Each chip keeps an
  accessible name with its state (`Camera: ready`). _Held_ still has no chip; its blocker text
  stays next to Go live.
- **Icon row** (48 dp square buttons, accessible names kept): before air — Settings, Home;
  on air — Settings, then the _What viewers see_ button (text, as today). Take photo joins in PR B.
  The Diagnostics button is removed (§6).

## §4 A silent room is ready

Owner ruling, 2026-10-06: "even though there is no sound … it is ok, nothing wrong and should
allow to go live".

- `Readiness.sound` becomes **mic available**: true unless the mic is silenced by the OS (a call)
  or audio capture is unavailable. The level floor no longer decides readiness.
- `SoundHold`'s silence window (15 s) is removed with it. This supersedes the owner's 2026-10-05
  hysteresis approval.
- The blocker copy changes from _No sound_ to **Mic not available** (4 locales).
- **On air:** the `audio-below-floor` degrade reason and the JS display rule that shows
  _Live with no sound. Check the mic now._ are both removed. The mic-silenced warning stays.
  _Recommendation for review — the owner ruled on going live, not on this warning._
- The sound meter still shows the level, lime whenever sound is ready.
- **Tests owe (JVM core):** silent from the start → ready; silent for 60 s → still ready; mic
  silenced by a call → not ready, then ready when the call ends; on air with silence → no degrade.
  Mutate the new predicate once.

## §5 Phone Stop returns to Home

- After the phone's own Stop ends a broadcast that went live (`ended`, operator-stopped), the app
  goes **Home**, which shows a _Stream ended_ card above the tiles: _Stream ended_, _On air
  {duration}_, _You stopped the broadcast._, _Scan the code again for the next broadcast_, and
  **OK**.
- A fatal end (`endedFatal`) does the same with a failure reason and no _Scan the code again_
  line. The board's wording, _Something failed. Your code is kept._, is used only if the engine
  really keeps the code on a fatal end; the plan checks that first and words the line to match.
- OK dismisses the card. The card is in memory only: a restart, a new scan, or OK clears it.
- SCAN ANOTHER and `EndedBlock` go. A Stop before the first frame (`neverLive`) stays on the
  viewfinder, as today.
- New copy: _Stream ended_, _You stopped the broadcast._, the fatal reason, _OK_ (4 locales). Existing: `stream.ended.duration`, `stream.ended.scanAgain`.
- **Tests owe:** Stop after live → Home with the card; OK clears it; a fatal end → its reason;
  Stop before the first frame → stays; a second broadcast after OK → a fresh card, not the old one.

## §6 Diagnostics inside Settings

- `/stream/diagnostics` and its button are removed. Settings gains a **Diagnostics** card: one
  aligned row list (section | item | value), sections Link, Delivery, Phone, Heartbeat from the
  existing `useDiagnostics` sections, plus **Share record**.
- The on-screen record tail (`session-record-lines`) is dropped; the record is still shared whole.
  Dev-only scenes stay, dev builds only.
- _Open-source licences_ moves under the power advice.
- Portrait: one column, settings then the Diagnostics card. Landscape: settings on one half,
  Diagnostics on the other. Both fit without the Diagnostics card scrolling at 640 × 360.

## §7 Home, logo and rotation

- Home's title is the Seazn Club night logo (`logo-wide-night.png`, copied from the web repo's
  `apps/web/public/`), 200 × 70 dp, accessible name "Seazn Club".
- **Rotation:** Home follows the phone (portrait or landscape). Landscape Home: one top row (logo,
  status, Language, version), then the three tiles side by side; the _Stream ended_ card, when
  present, sits between them as one row.
- Settings follows the phone **when not on air**. On air, the existing lock-keeping rule holds, so
  the camera never rotates under a live broadcast.
- The viewfinder stays landscape-only, as today.

## §8 Take photo (PR B)

- A shutter icon in the icon row, before air and on air. It saves a still of the camera picture
  (no scorebug) to the phone's gallery.
- Feasibility: StreamPack 3.2.1's video input implements `takeSnapshot` / `takeJpegSnapshot`
  (found in the cached jar; not yet called by the app). PR B starts with a device spike that
  confirms a snapshot on air does not disturb the stream.
- Gallery permission and the confirmation copy are settled in PR B's own spec section.

## §9 _What viewers see_ (PR B)

Owner symptom: "mostly nothing". PR B investigates on the phone with record lines (hypotheses: the
first Cloudflare window lands 18–23 s after going live; the player is slow to start LL-HLS within a
hold). The owner's parked question — "can't see the preview now" — is asked again before PR B
starts.

## §10 Scorer code (PR C)

Owner rulings, 2026-10-06:

- A button on the camera phone shows a QR for **this match's** Remote scoring link — the same link
  as the desktop fixture page's _Remote scoring_ hand-over QR. A scorer scans it with any phone
  camera and the scoring pad opens in the browser.
- The app draws the QR itself, with the Seazn logo in the centre (error correction H). It hides
  after 10 s, or on _Hide_. No screenshot block.
- **One QR format:** when the app's own Remote Scoring mode (S2) is built, its scanner accepts this
  same link, including the one on the desktop fixture page.
- Needs a web change first (the paired phone receives, or asks for, the link). That change is put to
  the owner by the web session; this spec does not carry an approval there.

## Out of scope

- Any change to the descriptor contract (PR A uses only today's label string).
- The release heat run and Plan D.

## Verification (PR A)

- Vitest `domain` and `ui` projects, scoped to changed files; the JVM core tests for §4;
  `pnpm i18n:release-check`; `pnpm check`.
- On the owner's phone (release build): every changed screen at the phone's size, portrait and
  landscape where it turns, screenshots of the app only. A Stop after live lands on Home with the
  card, observed on the device, not inferred.
