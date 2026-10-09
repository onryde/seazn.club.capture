# S1 Plan D: staging integration and design follow-up 2

Date: 2026-10-09. Status: approved by the owner, 2026-10-09.
Basis: capture main 9f20b7c; web main and staging e201fab8f (contracts
byte-identical to 8afdd8b42).
Handoff: `.superpowers/handoff-plan-d.md`.

Plan D is S1's phase 5 (live-stream spec §7): the real web side wired in,
the contracts vendored, and a real match on staging. The owner put the second
design follow-up into it as well. This spec decides how both are built and
proven. It does not re-open anything merged.

## 0. What this plan is, in one paragraph

Most of Part 1 is already built. The beat interval follows the server's
`pollSeconds`, every endpoint URL comes from the descriptor, and the start
refusals, an automatic go-live and the server's auto-stop are all parsed. What
Part 1 owes is evidence on staging, a vendored contract set with pins, one
missing refusal word, and a set of spec texts that the web's rulings have made
stale. Part 2 is real code. It removes the phone's score preview, which leaves
the degradation ladder with no actor, so "What viewers see" becomes the first
rung. "What viewers see" becomes a tap with a bounded view. The match info is
redrawn to C2. The screen dims while waiting. The plan ships as three slices,
code first, and the staging run happens last on the build that ships.

## 1. Decisions

| #   | Decision                                                                                                                                             | Source                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1  | Remove the phone score preview                                                                                                                       | Owner, 2026-10-08 ("Ok remove")                |
| R2  | "What viewers see" is a tap: 5 s countdown while loading, 20 s view, closes by itself, no warm                                                       | Owner, 2026-10-08                              |
| R3  | Match info design C2                                                                                                                                 | Owner, 2026-10-08                              |
| R4  | Locked phone: option C. Keep-awake by default while paired and waiting; the Android locked-phone path stays as the fallback and is proven on staging | Owner, 2026-10-09 ("Ok C")                     |
| R5  | Orientation A is parked                                                                                                                              | Owner, 2026-10-09                              |
| R6  | Three slices, code first: D1 contracts and reconciliation, D2 Part 2, D3 staging run on a build holding D1 and D2                                    | Owner, 2026-10-09, this brainstorm             |
| R7  | Drift check is **pin only**: vendored byte copies with pinned sha256s, verified offline. No fetch of the web repo in CI, blocking or scheduled       | Owner, 2026-10-09, this brainstorm             |
| R8  | Dimming: while paired and waiting, dim the app's window after 30 s with no touch; any touch restores it. Never dim when armed or live                | Owner, 2026-10-09, this brainstorm             |
| R9  | Ladder: "What viewers see" is the first rung. It is closed and disabled from thermal level 2. Steps 2 and 3 stay report-only                         | Owner, 2026-10-09, this brainstorm             |
| R10 | "What viewers see" with no picture at the end of the countdown: one honest line for 3 s, then close                                                  | Owner, 2026-10-09, this brainstorm             |
| R11 | Every other open point in this spec takes the recommendation made in the brainstorm. Each is marked _(rec)_ so it can be overruled in review         | Owner, 2026-10-09 ("apply rec and write spec") |

R7 overrides two texts that this plan amends (§3.6): AGENTS §4 ("requires the
CI drift check against the main repo's copy") and the live-stream spec's
byte-for-byte job with a read-only token (S:264). The web repo
`onryde/seazn.club` is public, so the token was never needed. The owner
preferred the quieter mechanism anyway. The web learns of drift from its own
pin in `capture-contract.test.ts:48-52`. The phone learns of it when the web
session tells it, as it has so far.

## 2. The web side we build against

The source is a peer report from session `mobile-s1-web` on 2026-10-09,
re-confirmed the same day. It is not an owner ruling. Staging runs web
e201fab8f. The only change since 8afdd8b42 is web #930, which touches only the
console: Go live now refuses a paired phone that has stopped beating with
`409 phone_not_responding`, and `phone_not_paired` means only that no phone
holds the pairing. `docs/contracts` is byte-identical.

| Area                   | What staging does                                                                                                                                                                                                                                                                 | What it means for the phone                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Automatic start        | Nothing fires at match start. The first beat from the current phone that sees `in_play`, with the org switch on and the phone in automatic, gets `go-live` (startedBy automatic)                                                                                                  | Latency is one poll (10 s in play). A16 and A12 ride the same path. Already parsed: `Pairings.kt:239`.      |
| Automatic stop         | Runs on beats, on the organiser's poll, and on a 5-minute cron. A15: a hand restart made DURING the match is auto-stopped when the result lands (`session.created_at < finished_at`). A hand start AFTER the result, inside the 120-min grace, is admitted and never auto-stopped | Arrives as `over` with endReason `auto_stopped` → `stoppedMatch`. Already parsed.                           |
| Console Go live / Stop | Beat answer only, no push. Go live is refused `409 phone_not_responding` unless the phone beat within max(60 s, poll + 30 s); `409 phone_not_paired` when no phone holds the pairing                                                                                              | The phone must keep beating while it waits. That is R4.                                                     |
| POST start gates       | holder → already_live → destination → entitlement (403) → credit (402). Credit is spent on the first ingest only                                                                                                                                                                  | `match_finished` is in the schema's enum but only the scoring-link route sends it; start never does (§3.4). |
| Beats                  | pollSeconds 5 / 10 / 60. Answers waiting, go-live, live, over, replaced, taken. **No 410 is ever sent** (web X8): 401 code_ended, 200 over, 503 unavailable                                                                                                                       | The defensive 410 reading in `ServerWord.kt:42-63` stays. No Plan D test expects a 410.                     |
| A9, A14, A17, A10      | As the amendment says. A10's hold window is 183 s (computed, not measured)                                                                                                                                                                                                        | Staging rows in §5.                                                                                         |
| Ingest host            | The custom ingest host is **ruled out** (web W26, 2026-10-05). SRT is never rewritten. `cred.srt` null is a safety switch only                                                                                                                                                    | The amendment's A18 `live.*` text is stale (§3.6). Native pins `live.cloudflare.com` (`Hosts.kt:46-56`).    |
| Playback URL           | Only the descriptor carries it: `session.playbackUrl`, a plain unsigned HLS URL. No web page plays it. 503 `playback_unconfigured` if the host is unset (set on stg, still owed in prd)                                                                                           | "What viewers see" is the only player of it (§4.3).                                                         |
| Paths                  | `GET {origin}/api/v1/capture/codes/{code}`, `…/beats`, `…/start`                                                                                                                                                                                                                  | Matches `fetchCodePort.ts:59` and the fakes. Two Kotlin test configs disagree (§3.5).                       |

Plan D needs no new web work. What the web is owed from the phone, from the
web spec §12: S3 (the SRT hold measurement), S10 (the exit bar: a real phone
end to end, including the A14 takeover), S11 (phone_lost at 15 min), and
optionally S2b (moot under W26). Separately, and not a §12 step, the web
asked for a **forced-RTMPS session id**, run by the owner, so it can check
the session server-side. All are in D3.

## 3. Slice D1: contracts and reconciliation

No device is needed for D1. It is one PR.

### 3.1 Vendoring layout

`contracts/` becomes a byte copy of the web's `docs/contracts/` at one commit:

```
contracts/
  README.md                         rewritten (§3.6)
  VENDORED.json                     { "web": "<full sha>", "files": { "<path>": "<sha256>", … } }
  capture-beat.v1.json
  capture-descriptor.v1.json
  capture-qr.v2.json
  capture-scoring-link.v1.json
  capture-start.v1.json
  fixtures/<name>/…                 every fixture, same tree as the web
```

- The first vendoring is at web 8afdd8b42. Against today's copies only one
  file differs: `capture-descriptor.v1.json`, 45fc9ad7 → 84e936b7. The diff is
  description text only (the round line reshaped on 2026-10-08), with no
  change of shape, so no parser changes. `capture-qr.v2.json` (3292e33f) is
  vendored for the first time.
- `test/fixtures/contracts/` is deleted. `serverBodies.test.ts` reads from
  `contracts/` instead, and its `PINNED` block is replaced by `VENDORED.json`.
- **The pin test** (vitest, so it runs in `pnpm check`) does two things. It
  hashes every file under `contracts/` (README.md and VENDORED.json excepted)
  and fails on any file that is missing, extra, or different from its pin. It
  also asserts that the five schema pins equal the web's own pins, written
  into the test as literals copied from the web's
  `capture-contract.test.ts:48-52` at 8afdd8b42. That is the two-sided pin:
  each repo states the same five values independently.
- **`pnpm contracts:vendor <path-to-web-checkout>`**, a local script, never
  run in CI (_rec_). It refuses unless the checkout is clean, copies
  `docs/contracts/**`, records `git rev-parse HEAD` and every sha256 in
  `VENDORED.json`, and prints the files that changed. Reading the web checkout
  is allowed; the web repo is read-only from here, and the script never writes
  to it. After running it, the literals in the pin test are updated by hand
  from the web's test, so a re-vendor cannot quietly update both sides of the
  pin.

### 3.2 What the vendored files are checked against

- **The QR, for the first time.** A new test validates
  `src/domain/credentials`' QR vectors (valid and invalid) against
  `capture-qr.v2.json` with ajv. A vector the schema rejects must also be one
  the parser rejects.
- **The descriptor's round line.** The web's fixtures `valid-waiting-stage`
  ("Open · Group A · Round 1"), `valid-live-stage` ("Open · QF") and the
  40/41-character boundary fixtures go through the TS waiting-fields parser
  and the Kotlin `Bodies` reader. The test asserts the label comes through
  verbatim at 40 characters and is absent at 41.
- `modules/capture-engine/src/wire/waiting-vectors.json` is checked for "QF"
  and brought to the reshaped form where an old-shape example (`"Group A ·
R1"`) stands as if current.

### 3.3 D2 provisional paths: closed

D2 is the plan C marker at C:11161, "Provisional (D2): the web side owns the
path". It is already reconciled in code: `fetchCodePort.ts` uses
`/api/v1/capture/codes/{code}`, which is what the web serves, and beats and
start come from the descriptor. D1 closes it on paper with an inline revision
note at C:11161, and no code changes.

### 3.4 Every beat send in the record

The web cannot show a 10 s cadence. It keeps no per-beat log, and its beat
history keeps at most one row per 60 s, purged after 24 h. The phone's record
writes a waiting beat only when its answer changes. So D3's row 8 has no
evidence source today. D1 makes the record write one line per beat **sent**,
in every build (_rec_): the send time, the interval since the last send, and
the answer word. A three-hour match at 10 s is about 1,100 lines, and the
record that Share sends is a 1,000-line ring. So D1 writes one line per change
of interval plus a `beats` line per minute (sent, failed, last answer word).
**N25** (owner, 2026-10-09: "count beats, don't list them"): a beat held on
air no longer gets a line of its own either. The per-minute line carries it,
and a change of answer still gets its own line. A three-hour match then
writes about 200 beat lines, and Share's ring holds the whole match.

`match_finished` needs no phone word. It is in `capture-start.v1.json`'s
enum, but the web sends it only from the scoring-link route
(`capture-phone.ts:794` at e201fab8f), and the phone already handles it there
(`ScoringLinkPanel.tsx:16`). A start after the result is admitted inside the
120-min grace and answers `401 code_ended` after it, and both already have
readings. The rewritten `contracts/README.md` notes it beside the 410: words a schema allows that the server never sends on that route.

### 3.5 Test paths that disagree with the web

The test `Configs.kt` uses `/beat` (:66) and `/api/capture/heartbeat` (:35).
The web serves `…/codes/{code}/beats`. D1 aligns both to the web's paths. This
is cosmetic, because the paths are read from the descriptor, but a test fake
that names a path the server does not serve misleads the next reader.

### 3.6 Text reconciliation

Each stale text gets an inline revision note dated 2026-10-09 that cites this
spec. It is not deleted: the reasoning stays readable (AGENTS §0).

| Where                                                      | Stale text                                                                  | Becomes                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amendment A:34, A:560, A:565, A:594, A:660                 | The custom ingest host / `live.stg.seazn.club` / A18's live.* target        | Ruled out by web W26. Native pins `live.cloudflare.com`                                                                                                                                                                                                                            |
| Plan C C:196, C:19898, C:19901, and its live.* hits        | The same                                                                    | A note at C:196 and at the top of the carries table pointing here; the many C hits are not edited one by one                                                                                                                                                                       |
| Amendment A:45, A:68, A:158, A:232 and the other 410 lines | "410 stays on GET code and the descriptor"                                  | The web never sends 410 (X8). The phone's defensive reading stays                                                                                                                                                                                                                  |
| Amendment A:101, A:123, A:321, A:630; S:197                | The locked phone is the primary path; keep-awake only "while armed or live" | R4: keep-awake and dimming while paired is the default, and the locked path is the fallback                                                                                                                                                                                        |
| Amendment A:21 (A5), A:661                                 | Server push as the fallback for a locked phone                              | Keep-awake is the default and the Android locked path the fallback. Push stays out (AGENTS §1, ruling 11)                                                                                                                                                                          |
| Live-stream spec S:264                                     | Drift job with a read-only token, byte for byte                             | R7: pin only                                                                                                                                                                                                                                                                       |
| Live-stream spec S:269-283 (exit bar)                      | "on a real stg fixture with the overlay"                                    | Without the overlay (R1). The exit bar runs in D3                                                                                                                                                                                                                                  |
| Plan C C:19910                                             | "vendor `contracts/capture-qr.v1.json`"                                     | v2 and the four v1 bodies (§3.1)                                                                                                                                                                                                                                                   |
| `contracts/README.md`                                      | qr.v1; "currently blocked" on C1, C2, M3, N2                                | What is vendored, from which commit, how to re-vendor, and that a contract changes only through `contracts:vendor` plus the pin test. Before the README drops "blocked", D1 confirms against `_FINDINGS.md` that C1, C2, M3 and N2 have each landed on the web, and says so per ID |
| AGENTS §3 tree                                             | `contracts/ # capture-qr.v2.json, once vendored`                            | `contracts/ # the web's capture contracts, vendored and pinned`                                                                                                                                                                                                                    |
| AGENTS §4 last bullet                                      | "requires the CI drift check"                                               | "changes only through `pnpm contracts:vendor` and the pin test (R7)"                                                                                                                                                                                                               |

### 3.7 The missing plan C results

Plan C's C8 (C:111, C:354, C:19826) names
`docs/specs/2026-10-0x-s1-plan-c-results.md`. It does not exist on main, on
any branch or in any worktree. D1 records this as a finding in `_FINDINGS.md`
under the next free N-ID. The finding says the C device gate's evidence was
never filed. D3 does not cite plan C results. Each staging row that depends on
a plan C device fact re-establishes it on the D3 build (§5.3). If the owner
knows where the results are, the finding is closed with the path instead.

## 4. Slice D2: design follow-up 2

D2 is one PR, possibly two if review prefers 4.1 + 4.2 apart from
4.3 + 4.4 + 4.5. The file sets overlap in `StreamStage.tsx`,
`StreamScreen.tsx` and the i18n files, so it is sequential either way.

### 4.1 Remove the score preview (R1)

Remove, with their tests:

- `src/ui/components/OverlayPreview.tsx`, plus its use of `ErrorBoundary`.
  The class stays: `RootBoundary` and others still need it.
- `src/hooks/useStageOverlay.ts`, `src/hooks/useOverlayAttempt.ts`,
  `src/services/overlayGuard.ts`, and `ConfinedWebView` / `OverlayStage` in
  `src/services/native/nativeSurfaces.tsx`.
- `overlayPreviewUrl` in `src/domain/session/previewUrls.ts`.
- `selectOverlayUrl` and `selectOverlayKnown` in `engineSelectors.ts`.
- The Settings "Score preview" switch and `settings.overlay.{label,hint}`.
- The `overlay` field in `streamSettingsStore`. The stored shape moves from
  wire v2 `{overlay, side, automatic}` to v3 `{side, automatic}`. A v2 record
  on disk is read and its `overlay` dropped: a saved setting must survive the
  upgrade (four questions, 3).
- The `scoreAhead` and `overlayFailed` advisories and their keys in all four
  locales.
- The overlay URL in the snapshot (`broadcast.overlayUrl`, `pairing.overlayUrl`)
  and the native code that projects it, if nothing else reads it. The
  descriptor still carries the field. The phone stops reading it, and the
  Kotlin reader ignores it the way it ignores any field it does not use.
- **`react-native-webview`**, if nothing else imports it once these are gone.
  It is a native dependency, so removing it needs a fresh prebuild and native
  build (AGENTS §13, class 5). The plan checks with a grep before removing it.

A test asserts that the Settings screen has no score preview control and that
the stream stage renders no WebView, in each of the four locales.

### 4.2 The degradation ladder (R9)

| Step | Wire word                             | Thermal status | What happens                                                              |
| ---- | ------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| 1    | `viewer-feed` (was `overlay-preview`) | 2              | "What viewers see" closes if open and is disabled, with a one-line reason |
| 2    | `preview-framerate`                   | 3              | Reported only. No native code lowers the framerate yet                    |
| 3    | `encode`                              | 4, 5, 6        | Reported only. The encode is last, and ideally never                      |

- Kotlin: `ShedStep.OVERLAY_PREVIEW` → `VIEWER_FEED("viewer-feed")` in
  `Vocabulary.kt:47`, and `DeviceReadings.kt:84-88` keeps its levels with the
  new member. TS: `ShedStep` and `SHED_ORDER` in `SessionState.ts:96-98`,
  `engineSelectors.test-d.ts:57`, and the snapshot vectors.
- The word is internal to the phone (snapshot only): the beat sends the
  thermal number, not the shed word. No web contract changes.
- The rung acts on any step, not only step 1. A shed of step 2 or 3 also means
  step 1 is shed, because the ladder only goes down. The selector is
  `shed !== null`, as today.
- **Copy.** `stream.advisory.shed` ("Preview paused — still live") becomes
  along the lines of "Phone hot — viewer check off, still live" (_rec_). The
  peek cell's disabled reason is along the lines of "Phone hot" (_rec_). Both
  go in four locales, measured by `stripTextFit` and the peek-cell fit tests.
- Steps 2 and 3 are labels with nothing behind them. That was already true,
  and it was hidden while step 1 was the only one exercised. The spec records
  it in `_FINDINGS.md` as a known gap rather than leaving it implied. Building
  a real preview-framerate shed is not in Plan D.
- AGENTS §8's ladder is rewritten to this table, keeping "the encode is last,
  and ideally never" and the thermal paragraph. Its first rung ("Overlay
  preview sheds first") is replaced.

### 4.3 "What viewers see" (R2, R10)

> **Owner's ruling, 2026-10-09: built, and hidden.** "can we hide the what's viewer see? and keep all code and just
> hide button then when later stage like when org reqeust we can implemnt". Everything in this section is built and
> tested, and hidden behind one compile-time switch, `FEATURES.viewerCheck` in `src/ui/features.ts`, which is `false`.
> Off, the on-air icon row is Settings, Take photo and Remote scoring, with no cell flexing; nothing of the view mounts
> (no cell, cover, player or timers, and the record has no `viewer.*` or `peek.*` lines); and the heat caption names no view: "Phone hot · still live" beside the LIVE plate,
> "Phone hot" before air (`stream.advisory.hotLive`, `stream.advisory.hot`; the controller's ruling, 2026-10-09). The
> ladder is unchanged (§4.2): step 1 still sheds `viewer-feed`, with nothing to close. One compile-time switch, with
> no env var, remote config, setting or runtime toggle, is the controller's ruling implementing the owner's; how it is
> turned on for an organiser who asks is the owner's call then. Turned on, this section applies as written, with its D3 checks (row 12's viewer steps, row 13's cell), which wait until then.

**Behaviour.**

```
idle --tap--> loading (5 s countdown shown)
loading --first frame--> showing (20 s countdown shown)
loading --countdown reaches 0, no frame--> notReady (one line, 3 s)
showing --20 s--> idle
notReady --3 s--> idle
loading | showing | notReady --tap on the box or Hide--> idle
any --shed, leaves live, scoring panel opens, playbackUrl gone--> idle
```

- The 20 s starts at the first frame, not at the tap. The worst case for a
  tap is 25 s of player time with a picture, or 8 s without one.
- Every way out reaches `idle`, and `idle` unmounts the player, so the
  download stops. There is no warm: `PEEK_WARM_MS` is deleted.
- Another tap on the peek cell while it is open closes it (_rec_). A second
  tap never restarts the 20 s. An open view cannot be extended by tapping, so
  a phone cannot be left playing.
- **One cover at a time** (_rec_). Opening the Remote scoring panel closes
  the viewers' video, and opening the video closes the panel. Both cover the
  camera half, and two layered covers would hide each other's Hide.
- The video sits over the camera box only, as today. The status strip stays
  visible, so it needs no trouble hide. Stop is never covered.
- **Honest label.** While loading and showing, the box carries one line:
  "What viewers see · no scoreboard yet" (_rec_). There is no compositor yet,
  so the viewers' picture has no score on it, and the operator should not
  think the scorebug failed. When the compositor arrives, this line is
  removed.
- The not-ready line is along the lines of "Viewers don't have a picture yet —
  try again shortly" (_rec_).
- Which states may open it is unchanged (`useViewfinder.ts:155`, live with a
  `playbackUrl`).
- The URL is the snapshot's `broadcast.playbackUrl` at
  `clientBandwidthHint=1.0`, as today (`previewUrls.ts:35-38`). Native's
  delivery poll at 0.1 is a separate reader and is not touched.

**Where it lives.** The transition rule above is a pure reducer,
`src/domain/session/viewerCheck.ts`: event in, state and deadline out, with
no timers. It is tested as a table. `src/hooks/useViewerCheck.ts` owns the
timers and the player events, and replaces `usePeek.ts`. `ViewerPeek.tsx`
becomes a plain tap through `Button`, with no `useHeldPress`. `useHeldPress`
had no other user, so it is deleted (erratum, 2026-10-09: this line first said
it stays for Go live and Stop, which use `useHold`). The retry schedule in `viewerFeed.ts`
(`PLAYER_RETRY_MS`, the 60 s first-window patience) no longer fits inside a
5 s window. Inside `loading` there is one quiet retry at 2 s (_rec_), and
`FIRST_WINDOW_PATIENCE_MS` is deleted.

**Rules text.** AGENTS §6, "Press-and-hold is not always a confirmation …",
is replaced by: "What viewers see is a tap. Its protection against a billed
preview left running is that it closes by itself 20 s after its first frame,
or 3 s after telling the operator there is no picture; a tap never extends
it." AGENTS §6's viewfinder paragraph mentions "the _What viewers see_
video" and the scoreAhead caption. The first stays, and the caption list
drops "Score ahead".

### 4.4 Match info C2 (R3)

**Drawing, top to bottom in the status strip:**

1. The round line, in lime and caps, at its existing type role (`metricUnit`)
   and in its existing slot. It is restyled, not resized, so the strip's fixed
   66 dp is unchanged (_rec_).
2. One row per side. Each row has a 3 dp bar at its left edge, lime for the
   first side and lilac (`ink3`) for the second, then the side's names. The
   names are Barlow Condensed 600, mixed case, as typed (AGENTS §5). Doubles
   names are in full, with partners joined by " / ".
3. A small "v" in `ink2` (_rec_; "grey" in the ruling), in a fixed left margin
   that sits outside both rows, centred vertically between them. It is
   decorative, so screen readers read the label as "A v B" once.
4. The one message line, unchanged (merged in #20).

**One size.** C2 wraps long names at one size, so the two-size rule goes:
`labelSize`, `LONG_LINE_OVER`, the `labelLong` type role if nothing else uses
it, and `labelLinesRegular`. Each side wraps to **at most 2 lines** and ends
in an ellipsis beyond that (_rec_). So the label's worst case is 4 lines at
`label` (22 dp) = 88 dp.

**Reserve maths** (`cameraBox.ts`). The mechanism is unchanged. The reserve is
the fixed 66 dp plus the label's measured height, and the worst case is used
until the first measurement. Only the worst case changes:

|                                                | Today                    | C2                                                                               |
| ---------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Worst label                                    | max(2 × 22, 4 × 19) = 76 | 4 × 22 = 88                                                                      |
| `STRIP_RESERVE`                                | 142                      | 154                                                                              |
| Owner's phone 804 × 332, worst case            | 337.8 × 190              | 316.4 × 178                                                                      |
| Owner's phone, singles on one line a side (44) | 394.7 × 222              | 394.7 × 222, unchanged                                                           |
| A doubles label today drawn long (4 × 19 = 76) | 337.8 × 190              | 394.7 × 222 when each side fits one line at 22, otherwise smaller to 316.4 × 178 |

A side's row is narrower than today's label line by the margin, the bar and
its gap, about 22 dp (_rec_: margin 14, bar 3, gap 5, all as tokens). The
plan measures at 494 dp (the owner's camera half) and at 640 × 360 how many
characters of Barlow Condensed 600 fit on one line. It also records which of
the staging fixtures' doubles names (§5.2) wrap. The picture stays fixed for
the whole match. It is re-sized only when the label's text, its wrapped
height or the half's size changes, which is the existing rule.

**Data.** No new data. The label is still one string, split on " v " and
" / " by `splitMatchLabel`. A label that does not split into two sides draws
as one row with no bar and no "v" (four questions, 2).

**Tests.** The `cameraBox.test.ts` constants (142 → 154, the worst-case
picture) are rewritten from the arithmetic in the table above, never from the
function under test. The same goes for the `MatchLabel.test.tsx` rows (two
sides, one side, doubles, an empty label, a 2-line cap with ellipsis) and the
`StreamScreen.layout.test.tsx` picture sizes at 804 × 332 and 640 × 360.

### 4.5 Idle dim while waiting (R4, R8)

- **When.** Only while the engine is paired and waiting for Go live. After
  30 s with no touch anywhere in the Live Stream route, the app's own window
  brightness drops to 0.1 (_rec_). Any touch restores it and restarts the
  30 s. Arming, going live, leaving the mode, the app going to the background
  and unpairing each restore it at once.
- **Never** when armed, live, pairing, ended, or outside Live Stream. The
  operator must read the tally on air (AGENTS §6, "Red means ON AIR").
- **How.** A new `ScreenPort { dim(): void; restore(): void }` in `Ports`,
  built by `createNativePorts()` over `expo-brightness`'s window brightness,
  never the system setting. The fake records the calls. `expo-brightness` is
  added at the version Expo's SDK pins, and its native peers are checked for
  what autolinks (AGENTS §13, class 4). It needs a fresh prebuild and native
  build. The rule (state × idle time → dim or not) is a pure function in
  `src/domain/session/idleDim.ts`. `src/hooks/useIdleDim.ts` owns the timer,
  and a touch-capture handler on the stream layout's root view resets it.
- **Keep-awake is unchanged** (`useKeepAwake.ts:27-29`: on for every state
  but idle and ended). It gets the test it never had: on for paired, armed and
  live; off for idle and ended.
- **The fallback.** If the operator presses power or leaves the app, the
  Android path takes over as built: the foreground service and partial wake
  lock from pairing (`PairingKeeper.kt:38-40`) keep the beats going, so a
  console Go live still reaches the phone. D3 proves this path (§5.1, row 2).
  iOS has no such path (P1). Keep-awake and dimming are the whole iOS answer,
  and the iOS screen-lock warning stays a first-class state.
- **AGENTS §9** gains: "While paired and waiting, the screen is kept on and
  dimmed after 30 s idle; this is the default path for a remote Go live. The
  foreground service and wake lock are the Android fallback when the phone is
  locked anyway."

## 5. Slice D3: the staging run

D3 runs on a release build of main holding D1 and D2, installed with adb
(local build, never EAS). Results go in
`docs/specs/2026-10-xx-s1-plan-d-results.md`, one section per row, each
section quoting the session record lines and screenshots (cropped, nothing
personal; AGENTS §13). Every run deletes its Cloudflare recording afterwards.

### 5.1 Rows

| #   | Row                                                    | Expected                                                                                                                                                                                                                                                              | Hands                                          |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **Automatic start and stop** at a real scheduled match | The phone is paired, automatic, with the org switch on. When the match goes `in_play`, it goes live within one poll with no touch. When the result is in, it stops by itself (`stoppedMatch`)                                                                         | Owner starts and ends the match in the web app |
| 1a  | A12: organiser Stop, then the match continues          | No auto-restart. The strip says "Organiser stopped it — waiting for Go live" (A:633)                                                                                                                                                                                  | Owner                                          |
| 1b  | A16: late pairing into a running match                 | Starts automatically once                                                                                                                                                                                                                                             | Owner scans mid-match                          |
| 1c  | A15: hand restart during the match, then the result    | Auto-stopped when the result lands (`session_predates_result`); a hand start after the result is not stopped                                                                                                                                                          | Owner                                          |
| 2   | **Console Go live and Stop**                           | (a) Default, R4: the phone is paired and dimmed, the console's Go live → live within one poll; Stop → over on the next beat. (b) Fallback: the same with the phone **locked** by its power button for 5+ minutes. Camera and mic open, readiness passes, it publishes | Owner on the console; owner locks the phone    |
| 3   | Start gates                                            | Each of no_destination, not_entitled, no_credit shows its own line; a start after the match's result, inside the grace, is admitted                                                                                                                                   | Owner arranges each state in stg               |
| 4   | A9: two phones, one code and slot                      | A non-live slot is taken over and the old phone hears replaced. A live slot answers taken                                                                                                                                                                             | Owner, two phones                              |
| 5   | A14: dead live phone taken over after 60 s             | Takeover keeps the same sid                                                                                                                                                                                                                                           | Owner kills the live phone's network           |
| 6   | A17: a late stop after the row 5 takeover              | Phone 1's late beat hears `replaced`; the server records `stop_ignored`; phone 2's broadcast is uninterrupted. First deterministic proof of the live·dead T4 case (web)                                                                                               | Scripted with row 5                            |
| 7   | A10: hold window                                       | Uplink pulled under 183 s: rejoin answers `live`. Over 183 s: over. S3 measures the SRT hold                                                                                                                                                                          | Owner pulls the uplink                         |
| 8   | Beat cadence                                           | The record's beat-send lines (§3.4) show 10 s in play or within 30 min of start, 5 s while starting, 60 s otherwise; the web's 60 s history corroborates                                                                                                              | Read from the record                           |
| 9   | Forced RTMPS                                           | UDP blocked → RTMPS; the session id is sent to `mobile-s1-web` for the server-side check                                                                                                                                                                              | Owner                                          |
| 10  | Round line on real data                                | Each string in §5.2 reads as listed                                                                                                                                                                                                                                   | Owner pairs each fixture                       |
| 11  | Exit bar, web S10 (S:269-283, without the overlay)     | Pull the uplink, block UDP, lock 5+ min, open another camera app, take a call, Stop from the console. The Phone node shows beats throughout; read the record back                                                                                                     | Owner                                          |
| 12  | Part 2 on the device                                   | Viewers' video: tap → countdown → picture → closes at 20 s; the not-ready path; it closes on the scoring panel. C2 at 804 × 332 and at 640 × 360 (`wm size`), en and the longest locale. The dim fires at 30 s and a touch wakes it                                   | Owner taps; the agent reads screenshots        |
| 13  | Thermal rung                                           | With a `thermal` status forced to 2 on a debug build, "What viewers see" closes and is disabled with its reason                                                                                                                                                       | Debug build, scripted                          |

Carries folded in:

- Carry 20 part: hint 0.1 returns one variant, and Cloudflare's listed window,
  both read on the row 1 fixture.
- Carry 26: the 20 s-per-60 s lag rule, from row 1's delivery lines.
- S11 and the optional S2b, as the web spec §12 defines them, in the same
  session.

### 5.2 Round-line fixtures (from the web peer; the expected strings come from the rule, not a device)

| Org               | Division                                       | Match                                      | Expected                                       |
| ----------------- | ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| TestDevicePad     | —                                              | —                                          | "TestDevicePad · SF" (already seen 2026-10-09) |
| my-organization-4 | Tile Open Renamed                              | pool A, round 1                            | "Tile Open Renamed · Group A · Round 1"        |
| s-a-f-e           | Girls Under-14 Championship (27)               | knockout R1 / R2 final / league RN         | "… · SF" / "… · Final" / "… · Round N"         |
| s-a-f-e           | Mixed Doubles Under-17 Intermediate Level (41) | knockout R1 / R2 / R3 final / swiss R2, R3 | "QF" / "SF" / "Final" / "Round 2", "Round 3"   |

**Caution:** one swiss R2 match in s-a-f-e is already `in_play`. A phone
paired to it in automatic mode, with the switch on, auto-starts and spends a
credit on the first ingest. Pair only scheduled matches for rows 10 and 12,
or set the phone to operator mode first. Any label that differs from the
table is sent to `mobile-s1-web`.

### 5.3 Device facts that D3 re-establishes rather than cites

Plan C's results file is missing (§3.7). The rows above therefore record
directly, on the D3 build: camera and mic open on a locked phone (row 2b),
readiness on a locked phone, and the foreground notification text
(AGENTS §9: "Paired · waiting for Go live", then "LIVE · …").

## 6. Testing

Every slice answers the four questions (AGENTS §10):

|                                       | D1                                                                               | D2                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A second call                         | Running `contracts:vendor` twice gives an identical tree                         | A second tap closes the view and never restarts it; dim/restore twice is idempotent                                                         |
| An empty input                        | A missing or extra vendored file fails the pin test; a schema-invalid QR vector  | A label with no " v "; no `playbackUrl`; a missing `expo-brightness` module (the fake in tests, and a guarded port in production)           |
| After an interruption                 | The engine fails mid-minute: the open minute's `beats` line is written once (E3) | The app backgrounds mid-view: idle and player unmounted. Backgrounds while dimmed: restored. A v2 settings record on disk after the upgrade |
| Another mode, orientation or language | —                                                                                | C2 and the viewer copy in en/es/fr/nl at 804 × 332 and 640 × 360; dim only in Live Stream                                                   |

Mutations, each watched failing once:

- the pin test with one byte changed;
- `idleDim` returning dim while armed;
- the viewer reducer letting a tap extend `showing`;
- the shed rung check removed;
- the C2 per-side 2-line cap removed (the 4 × 22 worst case must fail at the
  owner geometry).

No expected value is computed by the code under test.

jsdom cannot see brightness, the video, colour, or the bars' hues. Those
claims are device-only and settled in D3, row 12.

## 7. Out of scope

- Orientation A (R5).
- N23 copy shortening; Diagnostics additions.
- A real preview-framerate shed.
- Server push.
- iOS lifecycle work.
- The prd `STREAM_PLAYBACK_HOST` (web-owned).

## 8. Risks

- **HLS start inside 5 s.** Cloudflare may not have a segment within 5 s of
  a tap early in a broadcast. R10 makes that an honest line rather than a
  hang. If it happens on most taps at staging, the countdown length comes
  back to the owner with the measured numbers.
- **`expo-brightness` on the owner's handset.** Window brightness overrides
  can be ignored under some OEM power modes. Row 12 checks it. If it fails,
  dimming falls back to a dark scrim over the app (_rec_ as the fallback),
  which saves less power but still keeps beats going.
- **Credit spend at staging.** See the §5.2 caution. Rows 1, 2, 7 and 11
  spend credit by design on a shared prepaid account. The owner tops up
  before D3.
