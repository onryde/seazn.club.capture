# Court stream — design

Status: draft for owner review, 2026-11-14. Brainstormed with the owner in the capture
controller session. Owner's words are quoted; everything marked **(my call)** is the
controller's and the owner can overturn it.

## 1. Intent

At a club day an organiser wants a phone per court, set up once in the morning, that streams
every match they want streamed on that court with nobody touching it. Owner, 2026-11-14:
"take a phone, scan the QR, then fit [it], then it automatically stream/stop each match."

Today a stream code is per fixture (`fixture_stream_codes`, V430): a volunteer re-scans for every
match, or a match goes unstreamed. Match Day already knows which match is on which court
(`fixtures.court_id`, V367; calls in `fixture_calls`, V484), so the court is the natural thing to
pair a phone to.

Success: on a club day an organiser links Court 2 once, a volunteer scans once, and every match
the organiser ticked "Stream" for appears on YouTube as its own video, started by the scorer's
Start and stopped after its result, with the phone untouched all day.

## 2. Owner decisions (2026-11-14)

| # | Decision | Owner's words |
|---|---|---|
| O1 | One scan pairs a phone to a court; it then streams and stops each match by itself | "scan the QR then fit then it automatically stream/stop each match" |
| O2 | Each match is its own broadcast: own session, own YouTube video, own recording | "each match own video" |
| O3 | A per-match **Stream** switch on the Match Day desk, **off by default**; only matches with it on go live | "default off" |
| O4 | A court code lasts the venue's day only | "just last day" |
| O5 | Stop and leaving behave like Match Day: the 3 s Stop hold ends this match's video only; **Exit** (behind ⋯, asks first) unlinks the phone from the court | "like matchday" |
| O6 | No waiting on the old video: once a match is decided, the next streamed match on the court may go live, and starting it ends the old video | "we don't need to wait? if match is decided then we can allow to stream new one" |
| O7 | The court phone offers the next called match's scoring QR so its scorer scans it from the stream phone | "if call C v D then we should show that in screen so that scorer can scan the Remote score from the Streaming Option" |
| O8 | That QR shows only on a tap, never by itself | "someone tap" |
| O9 | A court link's destination must be a connected YouTube account (a broadcast per session); a plain stream key is not offered for courts, since YouTube may join back-to-back matches into one video | "all 3 Ok" (to the controller's rec) |
| O10 | A tap always shows the court's **next** called match's scoring QR, streamed or not | "all 3 Ok" |
| O12 | The notification's one-tap Forget is hidden on court pairings; Exit (which asks first) is the only way off a court | "yes" (2026-11-15, to the controller's rec) |
| O13 | The server refuses a court code from an app build without court support, with a refusal old builds already show ("Not valid for streaming"). Revised 2026-11-19 (N46, web #1265): a claim beat from a build below `COURT_MIN_APP_VERSION` is answered 426 `app_outdated`; the phone unpairs with `app-outdated` and Home says "Update the app" (§6.2) | "yes" (2026-11-15, to the controller's rec) |
| O11 | O2 supersedes the web Match Day design §8's court-idle card; that web spec is amended to match | "all 3 Ok" |

## 3. Goals, non-goals, anti-goals

**Goals**
- Organiser links a court to streaming once per day, on the Match Day desk, with one destination.
- One court QR; a phone scanned to it follows every streamed match on that court.
- Each streamed match starts on its scorer's Start (`core.start` → `in_play`), never on a clock.
- Each streamed match is billed, recorded and published exactly like a per-fixture stream today.
- Existing per-fixture streaming keeps working unchanged for organisers who don't use courts.

**Non-goals**
- One continuous all-day court stream, a court-idle card between matches, or a compositor
  handover (see §9 Q1).
- Push alerts, kiosk/boot auto-start (decision record R2), iOS (decision record R3: court-bound is
  Android only).
- Hardware encoders on a court (AGENTS.md §1: served by the session page, not this app).
- The phone choosing, reordering or calling matches. The server decides what the court's current
  and next streamed match are; the phone follows.

**Anti-goals (a failure even if it "works")**
- A match streamed that the organiser didn't switch on (O3), or credit spent on one.
- A scoring QR for the wrong match on the court phone (§6.4).
- A Stop on the court phone that silently unlinks the court for the rest of the day (O5).
- Anything that puts a scoring QR, or any score, into the encoded picture (AGENTS.md §7).

## 4. The day, end to end

1. **Morning, desk.** Organiser opens Match Day, picks Court 2 → *Stream this court* → chooses a
   destination, a connected YouTube account only (O9) → the desk shows Court 2's QR.
2. **Morning, court.** Volunteer: Home → Live Stream → scan → phone paired to *Court 2*, mounted
   sideways on the tripod. Nothing else to do.
3. **Desk, through the day.** Each match row on a linked court gets a **Stream** switch (off).
   Organiser switches on the ones to stream.
4. **Court, waiting.** Phone shows Court 2's next streamed match ("Next: A v B · 14:00") and
   *Tap to score*. Not-streamed matches on the court are ignored.
5. **Scorer.** Taps the phone → the next called match's scoring QR (O10), here A v B's, for 10 s → scans it with their own phone →
   Remote Scoring → taps Start. The court phone goes live (pre-flight A11 still applies).
6. **Result.** Scorer finishes. Video runs on for the handshake tail, then stops (§6.3). Phone back
   to waiting for the next streamed match.
7. **Back-to-back.** If C v D is called and started during A v B's tail, A v B's video ends and
   C v D's starts at once (O6).
8. **Evening.** Code expires at the end of the venue's day; phone shows the expiry notice. Or the
   volunteer taps ⋯ → Exit earlier.

## 5. Web side

The web repo is `seazn.club`; this session builds it, as for Match Day.

### 5.1 Court link
- New: a court stream link per (court, venue-local date): destination, the court code, created
  by, withdrawn at. One live link per court per day.
- The court code is a **stream code of today's QR v2 shape** (`{v:2, code, slot, tok, exp}`,
  `contracts/capture-qr.v2.json`): `exp` = end of the venue's day (O4). The phone's recogniser
  (`src/domain/mode/recognise.ts:34`) needs no change. The contract's description of `code` ("The
  fixture's stable stream code") widens to "a fixture's or a court's".
- Minted only on the Match Day desk **(my call)**; a match page never mints a court code.
- Withdrawing the link (desk) answers the phone as today's 401: forget the code.

### 5.2 Stream switch per match
- A per-fixture flag "streamed by its court", default off (O3), set from the desk's match row.
  Shown only on a linked court's rows.
- A match moved to another court follows the court **(my call)**: it streams if its new court is
  linked and its switch is on; a court with no link shows the switch disabled with "Court not
  streaming".
- Switching on spends nothing. Credit is consumed at go-live (`consumeForSession`), as today.
- **(my call)** While a match's switch is on and its court is linked, its match page's stream
  panel says "Streamed by Court 2's phone" and does not mint a per-fixture code for it. A match
  with an existing per-fixture code keeps it; turning its switch on is refused with "This match
  has its own stream code" (avoids two phones for one sid; decision record open question, S3
  notes).

### 5.3 The court's current match
The server resolves, for a court code, at each beat:
- **current** = the court's streamed match that is `in_play`, else the one in its handshake tail,
  else none;
- **next** = the court's first streamed match not yet started, in the court's queue order (the
  Match Day queue, called first).

Beat answers (`contracts/capture-beat.v1.json`):
- waiting fields (label, scheduledStart, destinationName) describe **next** while nothing is live,
  and **current** while live, as today;
- `go-live` with a new sid when **next** goes `in_play` with auto start's conjuncts
  (`relay/domain/auto-stream.ts:47-56`) — one session per match (O2), each created through
  `createSession` so admission, credits, recording and YouTube broadcast are per match;
- a new optional `next` object `{label, scheduledStart}` on court codes, so the phone can show
  "Next: C v D" during a live tail (additive; per-fixture codes never send it).

Auto start on a court code ignores the per-fixture `auto_stream` flag: the Stream switch is the
organiser's decision **(my call)**. The phone's own automatic switch (phone Settings, default on)
still applies (A4); off, the waiting screen says "Automatic off" and the volunteer's hold starts
it.

### 5.4 Ending a match's video
- **Nothing follows:** stop **30 s** after `finished_at` on a court code
  (`COURT_AUTO_STOP_AFTER_RESULT_SECONDS`, O15); a per-fixture code keeps 180 s
  (`AUTO_STOP_AFTER_RESULT_SECONDS`, `relay/config.ts:518`). Decision record ruling 6's "~2 min"
  is superseded by this. While the tail runs, the desk's Court card counts it down (O16).
- **Next starts first (O6):** the beat answers `go-live` with the new sid; native's
  `Open(other sid)` already ends the held broadcast and arms the new one in one step
  (`Pairings.kt:278-283`). The web ends the old session with its normal end reason.
- **Handover is start-then-end (my call, revised at planning).** The new match's session is
  created first, then the old one ends. The one-holder-per-destination guard (`holders.ts`) does
  not bind YouTube-connection destinations, the only kind a court may use (O9), and starting first
  means a refused start (no credit, revoked channel) never cuts the previous match's tail. The phone
  side already moves from the held sid to the new one in one step (`Pairings.kt:278-283`).
- **Two streamed matches `in_play` at once (my call):** the newest started is current; the older
  one's video ends as in O6. A match whose switch goes on mid-match, or that started before the
  phone paired, goes live late, once (A16's late-pairing rule, per match).
- **Organiser Stop on the desk:** ends the current video only; the link stays (A12 per match).
- **Phone Stop hold (my call):** latches that match as stopped, like A12: it is never current
  again for the court and its sid is never re-offered, so the resolver cannot loop on a sid the
  phone refuses. The desk can restart it by hand. The phone's own Go live hold (Automatic off)
  starts the court's current `in_play` streamed match, never a not-started one.
- **Phone lost mid-match:** today's A14 / `phone_lost` rules, per session.

### 5.5 Desk status
Each linked court row shows its phone: *Waiting*, *Live*, *Offline* (no beat for ~3 beats), from
the beats it already receives **(my call)**. A linked court nobody has scanned shows *No phone yet*. Refusals of
an automatic go-live (`no_credit`, `not_entitled`, `no_destination`) show on that court row. A
court phone shows them too: the waiting answer, beat and descriptor, carries the word as
`autoRefusal` (one of six, web #1247), and the waiting line says it (§6.2; revised 2026-11-17,
E2). A seventh, `match_stopped`, came with web #1265 (revised 2026-11-19, N46). A per-fixture code's phone still does not (as for per-fixture auto start today; revised at
planning).

### 5.6 Scoring link (O7, O10)
`POST {codeUrl}/scoring-link` (`contracts/capture-scoring-link.v1.json`) on a court code answers
the link of the court's **next called match, streamed or not** (O10): the first match in the
court's queue not yet started, so during A v B's video the tap shows C v D's QR. Its answer
carries that match's label (additive field). No match queued on the court → a new refusal word
`no_match`. (The streaming resolver's **next** in §5.3 still counts streamed matches only.)

## 6. Phone side

### 6.1 Knowing it is a court code
The descriptor (`contracts/capture-descriptor.v1.json`) gains an optional `court` `{name}` on
court codes. Native passes it through the snapshot; JS uses it for copy only. TS also reads
`court` when the code is checked at scan and saves it with the code, so a re-pair after process
death still knows it is a court code (revised at planning).

### 6.2 Waiting screen
Live Stream's paired·waiting viewfinder, on a court code:
- title line: "Court 2";
- match line: "Next: A v B · 14:00", or "No streamed match yet" when `next` is absent. The label is
  cut by how wide it draws, never by a count of characters, so the time always shows (revised
  2026-11-16, RP8);
- while the server's automatic start of the court's match stands refused, the match line says why
  instead (the waiting answer's `autoRefusal`, web #1247, owner "Ok" 2026-11-17): after the last
  end, a missing destination and Automatic off, which say their own lines over every word, since
  the web retries a court only while the phone is automatic (fix round 1, I1, the controller's
  ruling, 2026-11-17). "Destination not ready — ask the organiser", "Destination busy
  with another match", "Streaming paused for this competition" (shortened from the proposal's
  57 characters to the status line's 48), "Can't start yet — retrying" (routine: the server
  retries every 60 s), and the existing no-credit and not-included lines. Revised 2026-11-19 (N46,
  web #1265): `match_stopped`, the court's only match stopped by hand (the desk, this phone's Stop
  hold or a handover) and held until a person starts it, says "Stream stopped — hold Go live to
  restart", urgent, since only the hold or the desk's Go live starts it. An unknown word is none;
- *Tap to score* on the existing *Remote scoring* button (O8); the panel shows for 10 s as today.
The camera half stays as today while waiting. While live on a court code, the strip's
routine line shows "Next: C v D · 14:30" from the beat's `next`. Copy in en/es/fr/nl.

Revised 2026-11-19 (N46, web #1265; O13): a build below the server's court minimum never reaches
the waiting fields. Its claim beat is answered 426 `app_outdated`; native unpairs with
`app-outdated` (while Paired or Arming; from Armed on it is counted and the broadcast runs on), and
Home names it with the panel a code needing a newer app shows, "Update the app". Until the server
has answered a pairing at all (native's label is still ""), the line is "Pairing this phone…",
never the destination line.

### 6.3 Stop and Exit (O5)
- **Stop hold, after going live, on a court code:** takes the `stoppedHere` path
  (`SessionMachine.kt:127-145`) instead of `end()`: this sid is refused, the pairing stays, the
  phone goes back to waiting. The JS forget rule (`useEngineFollow.ts:26-30`) does not fire. The
  hold's label reads "Hold to stop this match", not the unpair copy (`stream.action.stopUnpairLabel`).
- **Exit:** ⋯ on the waiting screen → "Leave Court 2? Streamed matches on this court won't go
  live." [Leave] / [Stay] → `unpair`. Not offered while armed or live (Stop first).
- Home's Continue card: "Court 2 · Live Stream".

### 6.4 Scoring QR, stale guard
Scout finding: the scoring-link stale guard compares the pairing request, not the match
(`BridgeCore.kt:199`), and the panel hides on a code/slot/token change but not a sid or label
change (`useScoringLink.ts:126-132`). On a court code the match behind the link moves, so:
- the answer's label is shown on the panel ("Score A v B"), so the scorer sees which match;
- the panel hides when the held label or sid changes while it shows;
- on a court code, an answer that arrives after the held sid, label or `next` changed since the
  request was sent is dropped (revised at planning: the QR's match may be unstreamed, O10, so it
  cannot be compared with the streamed next).

### 6.5 Native
- Accept the descriptor's `court` and the beat's `next` (both optional).
- Refresh the round line (stage) on a sid change, not only at Arming (`Pairings.kt:144`).
- Court-code Stop → `stoppedHere`. Everything else (paired → live → paired, new sid per go-live,
  held-to-new sid handover) exists today (`Pairings.kt:253-306`).

### 6.6 Beat retry and the start in flight (Task 13, `_FINDINGS.device.md` N44)

A court phone waits at the server's 60 s cadence between matches, so two gaps found on the NE2211
against staging matter more here than on a fixture's code:

- **A lost beat no longer costs a minute.** After a passing failure (no answer, a beat given up,
  a 408 or a 5xx) the next beat goes 5 s after it, then 10 s and 20 s for the second and third in a
  row, then at the cadence; never later than the cadence, never sooner than 5 s, and a 2xx resets
  it. Any other 4xx and a 429 with no Retry-After keep the cadence; a Retry-After decides when it
  is given. A Go live given on the desk while a beat was lost now reaches the phone within seconds,
  and a server in trouble is not met with a beat every 5 s from every court (the controller's
  ruling, review fix round 1). Every failure in a row takes a step, a 4xx included, and only a 2xx
  resets the count: bounded, one counter, and pinned by a test (the controller's ruling, fix
  round 2).
- **The hold says it took.** Native's snapshot carries `pairing.starting` while the hold's
  `POST start` waits for its answer (up to native's 8 s HTTP bound), in Paired only. Go live shows
  a disabled "Starting…" and the line "Opening the link." until native answers; a failure brings Go
  live back with the start-failed line. The court card on Match Day has no Go live, so nothing
  changes there.
- **Exit waits for the answer.** Native ignores an unpair while a start is in flight, so Leave
  (and Home's Forget, and A7's Confirm) waits for the answer, at most 17 s (past the bridge's 16 s
  backstop, the latest native answers), then unpairs after a failed start or keeps the court when
  it armed, rather than giving up at 5 s with the code kept. An unpair native ignored is sent again
  after the answer. On Home, Forget and A7's Unpair & open are disabled while the start is in
  flight, and say "Opening the link." (fix round 2).

## 7. Testing (the four questions)

1. **Second call:** two streamed matches started within a second on one court; a second scan of
   the same court code; a second phone scanning the court code (A9 newest takes over); two taps
   on *Tap to score* across a re-point.
2. **Empty input:** linked court with no streamed match; switch on for a match with no players
   entered; destination deleted after linking (`no_destination`); org at zero credit.
3. **Interruption:** phone offline across a handover (rejoins the new sid, never the old);
   process death while waiting and while live; code expiry while live (the live match finishes,
   then expiry, decision record R6 backstop); link withdrawn while live.
4. **Other mode / orientation / language:** court phone flat or upright at the next start (A11
   refuses, desk shows not ready); Match Day on another phone calling to the linked court; all
   four languages at 728 × 328 for "Next: …" and the court line.

Web: money and retention across a handover (one credit per streamed match, none for unstreamed),
existing per-fixture streams unchanged.

## 8. Left to the builder

- Table and column names, migration shape, how the court link and per-fixture rows relate.
- The beat-time resolver's query and its index.
- Desk UI layout of the switch and the court QR (Match Day desk's existing patterns).
- Whether the court code reuses `fixture_stream_codes` with a court column or is a sibling table.

## 9. Open for the owner

Resolved 2026-11-14: Q1 → O11. Remaining:

- ~~**Q1. Web Match Day design §8 conflicts with O2.**~~ `seazn.club`
  `docs/superpowers/specs/2026-10-31-match-day-design.md` §8 (owner "yes", 2026-10-31) says "Between
  matches the stream shows a court-idle card", which reads as one continuous court stream. O2
  ("each match own video") is taken as superseding that sentence; §8's other constraints (connect
  once, no per-match re-pointing, per-fixture streaming unchanged, money correct across handovers)
  stand. Resolved by O11.
- **Q2.** The handshake tail when nothing follows: resolved by O15 (30 s on a court code).

**O14 (owner, 2026-11-16: "yes add it", on the controller's recommendation):** the Stream switch also shows on the desk's waiting-to-be-called rows of a linked court, so the day's first match can be switched on before it is called. A switched-on match called to an unlinked court shows "Court not streaming".

**O15 (owner, 2026-11-16: "yes 30s court tail"):** a court-bound match's video stops 30 s after its result; per-fixture codes keep 180 s. The match page's "stops about …" line reads the session's own delay.

**O16 (owner, 2026-11-16: "have countdown in court match day, like streaming will be free in 30s"):** the desk's Court card of a linked court shows "Video ends in N s" while its last streamed match's video is live inside the tail, from the server's `tail_ends_at`; the line goes at 0, on handover, or when the video stops.

**Controller's ruling (2026-11-16, applying O14's intent):** a linked court that is free lists its whole queue on the desk, each row with its Stream switch (the "Due here next" match once), so the day's matches can be switched on in the morning. An unlinked free court is unchanged (Match Day §7).

**Staging infrastructure (device check, 2026-11-16):** the composed path needs Cloudflare Access bypasses for `/api/internal/relay/*` (the runner's calls back), `/overlay/*` and `/_next/static/*` (the compositor's overlay page). Production needs the same check before its first composed stream.
