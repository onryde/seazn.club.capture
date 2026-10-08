# S1 design follow-up — the owner's canvas, in the app

**Status:** owner-approved, 2026-10-06 ("yes to all" on the review points below).
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

- The screen splits in two halves. The **camera half** holds the camera preview as a 16:9
  box at the top, edge to edge across the half, and the **status strip** below it (surface
  colour). The **controls half** holds, top to bottom: the tally plate with the timer (on air) or
  the sound meter (before air), the readiness chips and the start time (before air), the sound
  meter (on air), a flexible gap, the icon row, then the hold button (72 dp tall, GO LIVE / STOP).
- **Amended (owner, 2026-10-08): the controls half takes the width its content needs; the camera half the rest.**
  The controls half is `layout.controlsHalf` wide whatever the screen: its widest row in any state plus its padding.
  That is 310 dp (the plate row: the tally plate and the clock in a 135 dp cell each; the rows are derived and
  measured in `controlsFit.test.ts`), so the camera half is 330 at 640 × 360, 494 at the owner's 804 × 360 and 605 at
  915 × 412. The box stays 16:9 and the strip stays below it, and `cameraBoxSize` is unchanged.
- **Amended again (owner, 2026-10-08, option A): the picture is sized from this match's label, not from the strip's worst
  case.** The strip's reserve is the padding, the match label as measured in the half's width, the status line's two
  lines, the caption's two lines and the gaps: 104 dp and the label (`stripReserve`). The advisory captions stay in the
  strip. The picture is one size for the whole match: it is sized again only when the label's text or the half's width
  changes, never for a status line, a caption or the round line coming and going. Before the label is measured it is
  the worst case, 180 dp. On 804 × 360 a two-line label gives about 375 × 211 (320 × 180 at the worst case); on
  915 × 412, 467 × 263; at 640 × 360 the half limits the picture for a label of up to two lines (330 × 185.6).
  **Superseded in its numbers by the next line (one message line).**
- **Amended a third time (owner, 2026-10-08, "one single line all the time"): ONE message line.** Under the label the
  strip has exactly one line (`numberOfLines` 1, `layout.messageLines`): the advisory caption when one is up (it
  outranks the status line), otherwise the status line, and a string wider than the strip's text is cut with an
  ellipsis. The strip's reserve is the padding, the label as measured, a gap and one body line: 44 dp and the label
  (`stripReserve`), 120 dp at the worst case. The owner's phone is 804 × 332 (360 less the Android status bar): a
  one-line label gives 472.9 × 266, a two-line label 433.8 × 244 (432 × 243 as laid out, the label measuring 45), four
  long lines 376.9 × 212. On 804 × 360 they are 494 × 277.9 (the half limits it), 483.6 × 272 and 426.7 × 240; on
  915 × 412, 605 × 340.3, 576 × 324 and 519.1 × 292; at 640 × 360 the half limits the picture for every label
  (330 × 185.6). The controls half's column has its own vertical padding and gap, 8 and 8 (`controlsPadV`,
  `controlsColumnGap`; the horizontal padding stays 16, so the half stays 310 wide): the board's 16 and 12 made the
  worst before-air state (the AUTO start line and a reason under the hold button) 356 dp tall, 24 more than 332.
  `stripTextFit.test.ts` measures every status and caption string in the four languages at the strip's text width
  (298 dp at 640 × 360, 462 dp at 804) and pins the 57 that may be cut at 640 × 360.- `controlsSide` keeps working: _Left_ mirrors the halves.
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
- **Round line (not PR A; owner-approved 2026-10-06/07):** a small grey line above the label showing
  the scheduler board's round code, e.g. _QF_, _WB2_, _Grupo A · R2_. The server renders the whole line
  and the descriptor carries it from pairing on (every descriptor shape, the waiting one included):
  `stage: { label (1..40, org default locale, shown verbatim), code (board chip, ≤ 8), role { kind
  (open string), n?, entrants? }, pool? (^[A-Z]$) }`. A missing, empty or over-40 `label` → no line.
  The phone never builds or translates it. Ships with PR C, after the web contract lands
  (web branches `fix/pool-label-i18n`, then `feat/capture-scoring-link-stage`).
- **The line yields to the label (R-F5).** It shows only when the status strip has room for it beside the
  label; no strip reserve is added and the picture never gives way. Since the owner's rules of 2026-10-08 (option A,
  then one message line) the strip is its reserve, 44 dp and the label, wherever the picture is limited by it. The
  round line needs 22 dp more than that (the padding, itself, the label, the one message line and a gap each side of
  the line: 66 dp and the label), whether or not a caption is up (the caption takes the message line, it is not a
  term). So it shows only where the camera half, not the strip, limits the picture: 640 × 360 for every label (a
  174 dp strip against at most 142), and 844 × 390 for a one-line label; it is hidden on 804 × 332, 804 × 360 and
  915 × 412. Until the strip and the label are both measured, the line is hidden.
- **An unknown `role.kind` shows no line (R-F20).** A kind outside the contract's list shows nothing, even with a
  good label; a kind the web adds later shows nothing until the app learns it.

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
  Owner-approved 2026-10-06.
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

## §8 and §9 as settled in PR B (UNVERIFIED-ON-DEVICE)

- **Take photo is one tap, one still, one line** (owner, 2026-10-08: _"a simply feature, where user can click to
  photo, nothing make complex"_). A shutter in the icon row whenever the camera picture is showing, Paired and on air
  (Settings, Home, Take photo before air; Settings, Take photo, _What viewers see_ on air). Native saves a JPEG of the
  camera picture, no scorebug, and answers `saved` or `failed`; the app says so for 3 s. A tap while a photo is saving
  does nothing. It is one of the two requests-with-an-answer among the commands (the other is the scoring link, §10;
  AGENTS §2, recorded).
- **Gallery permission: none.** The still is written with `MediaStore.Images` to `Pictures/Seazn Capture`. minSdk is 31,
  so the app writes its own image with no storage permission, no prompt, no library and no config plugin.
- **Confirmation copy:** _Photo saved_ (lime) or _Couldn't save the photo_ (caution), one line for 3 s in the controls
  half's gap, just above the icon row, never over the camera box.
- **File name:** `Seazn_yyyyMMdd_HHmmss.jpg`, the phone's wall clock; never a match, a side or a name.
- **What gates it:** native refuses at once, `failed`, with no snapshot asked for, unless the camera is ours and not
  failed or lost (the readiness the viewfinder reads). The reason is StreamPack's `takeSnapshot`: it blocks a thread on
  a future while it holds the video input's source lock, and cancellation cannot interrupt it. Stop, Go live, a camera
  reopen and the slate swap take the same lock, so a snapshot of a camera that delivers nothing would hold them all.
  With the slate up (a hold, or the camera taken by another app) the camera is not ours, so the answer is `failed`.
- **What bounds it:** a scope of its own with no path to the session's failure path; native answers within 2 s when the
  call honours cancellation, and the app gives up at 4 s (`failed`). There is no single-flight lock, no refusal beside a
  capture command and no pre-emption in native.
- **What it does not cover, stated plainly:** the gate reads the capture's state, never frames. A stall that starts
  mid-snapshot, or a camera that is ours and not yet delivering (a tap before the first frame waits for that frame),
  holds StreamPack's source lock until the next frame, and a Stop or a Go live tapped in that window waits behind it. A
  blocked call cannot be cut off at 2 s; the app's 4 s answers the shutter, but the lock stays held. The device
  checklist times Stop with a stalled camera (PR B plan, Task 7, item 1); if it is slow, the cut pre-emption comes back.
- **Follow-up, not in PR B (owner, 2026-10-08): a photo with the scorebug.** The candidate is an on-screen copy of the
  camera box (Android `PixelCopy`, cropped to the box), spiked on the device first. Its known costs: screen resolution,
  not camera resolution; it captures whatever sits over the box; rotation and the mirror; and the on-screen score runs
  ahead of viewers. The score is never redrawn in the app.
- **What viewers see (§9), as built.** The player is a display rule over native's word, not a second state machine.
  - **It mounts only for a window.** The player is created once native reports `delivery: ok` (the first Cloudflare
    window), latched for the stretch so one failed poll does not take it down. Until then, and until the player has
    shown a picture, the layer says _Waiting for the first picture_. It says _No viewer picture_ after 60 s without a
    window, on a stalled word, and during a hold; a hold ends the stretch, and the next one starts with a fresh player.
  - **A failing player is replaced** up to three times (after 2, 4 and 8 s), then given up on. **A `readyToPlay`
    resets that ladder**, so three failures spread over an hour do not give up.
  - **A press after a give-up retries.** The finger landing on _What viewers see_ once the layer has given up starts a
    fresh player with the whole ladder. A press with a player on screen changes nothing.
  - **After the first picture, a rebuffer keeps the picture and draws no line.** A real stall still reaches _No viewer
    picture_ by the delivery word.
  - **A re-peek parks and starts fresh.** When the peek holds no player (it let go, or cooled) or the feed leaves
    `playing`, a retry waiting for a player is dropped and whatever the last player said, its picture included, is
    forgotten; the next peek says _Waiting for the first picture_ again.
  - **`peek.firstWindow`** is one record line, `ms` from the broadcast reading Publishing to the first window, so the
    18–23 s hypothesis is a number. It is timed only from a start the screen saw: opened mid-broadcast, none is
    written. `peek.state` and `peek.retry` carry a state or a number, never a link or a host.
- **Premises not confirmed:** the peek plays standard HLS, not LL-HLS (S1 spec, _Low-latency HLS is off_); the 18–23 s
  figure has no evidence in the repo.

## §10 Scorer code (PR C)

Owner rulings, 2026-10-06:

- A button on the camera phone shows a QR for **this match's** Remote scoring link — the same link
  as the desktop fixture page's _Remote scoring_ hand-over QR. A scorer scans it with any phone
  camera and the scoring pad opens in the browser.
- The app draws the QR itself, with the Seazn logo in the centre (error correction H). It hides
  after 10 s, or on _Hide_. No screenshot block.
- **One QR format:** when the app's own Remote Scoring mode (S2) is built, its scanner accepts this
  same link, including the one on the desktop fixture page.
- **Contract (proposed by the web lane 2026-10-06; this owner agreed the shape the same day; the web
  lane fixes it in the contract with its own owner's sign-off):**
  `POST /api/v1/capture/codes/{code}/scoring-link`, the same auth and body as `…/start`
  (`Bearer <tok>`, `{ "phone": … }`), current holder of the code only — before, during and after
  live. 200 `{ "url": "https://<host>/score/<secret>" }` — the fixture's existing link, or a new
  one if none; **never revokes or replaces a link** (organisers may have printed it). Host
  `seazn.club` / `stg.seazn.club`; secret `^dl_[A-Za-z0-9_-]{43}$`. Refusals use `/start`'s body
  `{ code, message }`: 409 `replaced`, `code_ended` (as `/start`), 409 `match_finished` (new),
  402 `not_entitled` (shown as _Not on your plan_, 4 locales), 429 `rate_limited` with
  `Retry-After`, 503 `unavailable`. `Cache-Control: private, no-store`. Called only on a tap.
- The URL is a scoring credential for that one fixture: never logged, never in the session record,
  never in a beat. Links do not expire; an organiser's _Revoke & reissue_ changes it, and the next
  tap fetches the new one.

## §10 as settled in PR C (UNVERIFIED-ON-DEVICE)

The owner answered where the code shows by linking the canvas board _Idea · show the Remote Scoring code (hides after
10 s)_ (2026-10-08): the panel covers the camera half, the controls half stays as it is, and the code hides after
10 s or on _Hide_. The controller's rulings below were approved by the owner the same day ("ok, go with your calls").

- **B1 Two keys.** `stream.scoring.title` is _Score this match_ (the board's); the icon button's own name is
  `stream.scoring.open`, _Remote scoring_.
- **B2 The hint stays _Scan with any phone camera_,** not the board's "Scan with Seazn Capture → Remote Scoring": the
  app's own Remote Scoring mode (S2) does not exist yet, and the board's line would send a scorer to a feature they
  cannot find.
- **B3 A countdown.** A bar and _Hides in {seconds} s_ beside _Hide_, counting 10 to 1 on a 1 s tick; the 10 s timer
  stays the authority.
- **B4 Colours.** A cream ground and ink text; the QR keeps its white quiet zone.
- **B5 Pressed.** While the panel shows, the Remote scoring button has a 2 dp lime outline and is selected.
- **B6 No reassurance line.** The board's "The code shows on this phone only, never on the stream." is not taken: the
  status line is engine-driven and carries the Reconnecting and Degraded warnings, and overriding it would hide them.
- **B7 Icon order.** The board puts the QR first; the app does not, so Settings and Take photo stay where the operator
  has them (on air, see R8c).
- **R8a The panel yields to trouble.** It is opaque and covers the status strip, so it hides when the session
  enters Reconnecting, Degraded or a silent engine, and a warning is never covered. A tap made while the trouble
  already stands is honoured (the operator saw the warning and chose), and the panel then covers the strip for up to
  10 s. Advisory captions (keep-open, heat, overlay failed, not charging, camera switching, paired refusals) may be
  covered for up to 10 s. _Cost:_ a scorer mid-scan loses the code in a network drop and taps again.
- **R8b The title is the board's:** Barlow Condensed 700, 22/24, uppercase, left.
- **R8c On air the icon row is Settings, Take photo, Remote scoring, _What viewers see_:** the QR is third of four
  because the flexible viewers cell has to end the row.
- **D11 A bucket for link secrets.** In the session record and in the JS logger alike, a scoring link's secret goes
  in a bucket of its own: at most 16, deduplicated by value, the newest kept (a repeat, which the server's same
  link is, moves to the newest place on both sides). A general cap would evict the pairing token. Eviction is safe
  because an evicted secret only comes back inside a new answer, and that answer protects it again before it is
  handed on.

## Out of scope

- Any change to the descriptor contract in PR A (PR A uses only today's label string).
- The release heat run and Plan D.

## Verification (PR A)

- Vitest `domain` and `ui` projects, scoped to changed files; the JVM core tests for §4;
  `pnpm i18n:release-check`; `pnpm check`.
- On the owner's phone (release build): every changed screen at the phone's size, portrait and
  landscape where it turns, screenshots of the app only. A Stop after live lands on Home with the
  card, observed on the device, not inferred.
