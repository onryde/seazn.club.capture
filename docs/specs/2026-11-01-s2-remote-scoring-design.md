# S2 — Remote Scoring: design

Status: **draft for the owner's sign-off.** The pad's look was signed off on the phone on
2026-11-01 (build 711, `feat/s2-pad-ui` at `eb186c5`: "design looks good"). This document turns that
preview and the brainstorm's rulings into what S2 builds.

Rulings are the owner's unless marked _the controller's_. A ruling of the owner's is quoted where the
words matter. Everything marked _the controller's_ is open to the owner's correction while reading.

## 1. Intent

A volunteer at the side of a court scores one match on their own phone. They scan the match's scoring
link, check it is the right match, say who serves first, and tap the side that won each rally. The
score reaches Seazn as they tap, or as soon as the phone has a signal again. The organiser's console,
the scorebug and the browser pad see the same match.

The web already has this: the device-link pad at `/score/dl_…`. S2 is the native version of it
(decision record ruling 5, "native UI with shared rules"), because a phone app keeps the screen on,
keeps taps through a dead signal and a killed app, and is one scan away for a volunteer who already
holds Seazn Capture for streaming.

Success: a real badminton match on staging, scored on the owner's OnePlus from the first serve to the
organiser's final, through flight mode, a browser co-scorer and the app being killed, with the console
agreeing point for point (§10).

## 2. Goals, non-goals, anti-goals

**Goals**

- Badminton first, scored rally by rally, with every detail the web pad's top band records (owner
  ruling 4, "band 3", all sports, no recording-level menu).
- Table tennis next on the same screen (ruling 1); then the other sports, each a sport screen built
  from the shared kit (§5), as the owner asked: "we should build the screen for specfic sport mostly
  and reuse if we can like clock, undo".
- Any match with a scoring link, streamed or not (ruling 2).
- The web pad's weak-network behaviour: optimistic taps, a durable queue, idempotency keys,
  `expected_seq`, a visible unsent count (decision record ruling 5).

**Non-goals**

- No claim on first scan (ruling 3, which reverses decision record ruling 9 for S2). Several scorers
  may score one match, as on the web; the server's `SEQ_CONFLICT` keeps them honest. S3's court QR
  decides claiming again.
- No "which player won it" step in doubles (ruling 5): a rally records the side only.
- No void of an older entry, no edit from History (ruling 21). Corrections are the one Undo.
- No scoring rules written in this app (decision record ruling 5): the fold, the server, the
  interval, the end of a game are `@seazn/engine`'s.
- No over-the-air update to cure an outdated engine (ruling 8; the owner's 28 Oct no-`eas update`
  rule stands).
- No new login, account or fixture browsing (AGENTS §1).

**Anti-goals** (it works, and is still a failure)

- A tap that is lost. A tap is durable the moment it is made, and it is sent whenever the app is
  open, until the server has it or refuses it.
- A tap counted twice: by a double tap, a retry, or a second tap that lands on what appears under
  the finger (the bounce guard, §6.4).
- A score on the phone that disagrees with the server's and does not say so.
- A second render path for the scorebug (AGENTS §7). The pad is an operator surface, not a scorebug:
  it shows the scorer what they need to score, never what viewers see.

## 3. The owner's rulings

From the brainstorm of 2026-10-31 and the preview rounds of 2026-10-31 and 2026-11-01. Numbering
follows the session's record.

| #   | Ruling                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Badminton first, then table tennis on the same screen.                                                                                                                                      |
| 2   | Remote Scoring works for any match with a scoring link (`https://<host>/score/dl_…`), streamed or not.                                                                                      |
| 3   | No claim on first scan. Multi-scorer as on the web.                                                                                                                                         |
| 4   | Band 3 ("Every detail") always, every sport.                                                                                                                                                |
| 5   | No doubles "which player" step.                                                                                                                                                             |
| 6   | One Undo: steps back through this phone's own taps until the organiser finalizes.                                                                                                           |
| 7   | Layout A: portrait, the two sides' halves stacked top and bottom.                                                                                                                           |
| 8   | Rules version behind the server (426 `ENGINE_OUTDATED`, or a pre-check at scan): the pad goes view-only with "Update Seazn" and "Score in the browser", and counts the unsent taps. No OTA. |
| 9   | The screen is kept on while the pad shows; brightness is left to the phone ("not a full bright right. default one?").                                                                       |
| 10  | Back goes Home freely. Taps are durable on tap; the queue sends whenever the app is open; the Continue card shows unsent taps.                                                              |
| 11  | Exit bar as §10.                                                                                                                                                                            |
| 12  | The web has no token→fixture endpoint; build the bootstrap endpoint in a seazn.club worktree (option A).                                                                                    |
| 13  | See the real design on the phone before signing off; build a reusable kit plus per-sport screens.                                                                                           |
| 14  | Tap halves: the score centred and larger, a one-line hint, a brief lime flash on the half whose tap counted.                                                                                |
| 15  | A Rules button in the top bar (became the ⓘ icon, 20, and Match details, 23).                                                                                                               |
| 16  | Finished games as boxes in each half, the winner's lime; the big number is the current game; the strip reads "Game N of M".                                                                 |
| 17  | The service court on the serving plate ("right/left service court in box who is serving"): SERVING · RIGHT.                                                                                 |
| 18  | Process: quick rounds while the design was shaped, then one hardening pass (done: §11).                                                                                                     |
| 19  | A game a disqualification ends gets a box with the points at the time and a DQ mark ("box with DQ"); the strip on one line (+8 dp a half).                                                  |
| 20  | The top bar's Match details and History are round icon buttons, named for screen readers.                                                                                                   |
| 21  | History: a view-only screen, newest first, by game, the score after each entry, who recorded it, undone entries struck through.                                                             |
| 22  | The interval at the strip's far right; the games won as "1:0" in the LED lime where the Preview tag was.                                                                                    |
| 23  | Competition, division, round, match and sides on the Not started card and in the ⓘ sheet, "Match details", above the rules.                                                                 |
| 24  | A Start screen before the match: Match details, the rules, "Who serves first?", Start match.                                                                                                |
| 25  | The pad's design signed off on build 711.                                                                                                                                                   |
| 26  | Plan S2-1: the R4 check, the web bootstrap endpoint on staging, the badminton pad to the exit bar. Table tennis is plan S2-2. An R4 crash pauses S2 for an engine fix release.              |
| 27  | Sync in real time, as the web: "history and tapping must be synced all time".                                                                                                               |
| 28  | Undo only while this phone's tap is the latest in the match; otherwise it is disabled with "Another scorer has scored since". Narrows ruling 6.                                             |
| 29  | A queue per match. A new scan opens the new match; the old queue keeps sending; the Continue card counts it; taps that can never go are shown with Dismiss.                                 |

## 4. How a scorer meets it

1. **Scan.** The phone's own scanner reads a scoring link. S0 already recognises it
   (`SCORE_PATH` in `src/domain/mode/recognise.ts`) and today answers "coming soon". S2 sends it to
   Remote Scoring. A scoring link for another Seazn host is refused as S0 refuses a foreign stream
   code. The link is saved like a stream code (secure store), so the app reopens into the match
   (S0's reopen gate) and the Continue card can name it.
2. **Bootstrap.** The app asks the web what the link is (§7.1): the match, its rules, the sides, the
   state of the division, and whether the link still works. While it asks, the screen says so in one
   line. No signal: the last bootstrap saved for this link is used, and the send badge says offline.
3. **The card or the screen it leads to:**
   - link not valid → the bad-link card (the existing `PadStateCard` `linkInvalid`); the saved link
     is forgotten, and its unsent taps, if any, are handled as §6.3's leftovers;
   - division not open → the Not started card: Match details, the rules, "This screen updates on its
     own";
   - match not started → the Start screen (ruling 24);
   - in play → the pad;
   - result recorded, or finalized → the pad view only with its card (the existing `resultRecorded`
     and `viewOnly` cards);
   - rules version newer than this app's engine → the Update needed banner (ruling 8).
4. **Start.** Match details, the rules, "Who serves first?" (two side buttons, a radio group), Start
   match (a tap; disabled until a side is picked). Undo right after Start returns here.
5. **Score.** Tap a half to give that side the rally. The half flashes; the last-tap line says what
   was recorded, with Undo. Undo works while this phone's tap is the latest in the match; once
   another scorer has scored since, it is disabled with "Another scorer has scored since" (ruling 28). Sanction per side; Set score before a game's first rally; the ⓘ and ↺
   icons; the send badge.
6. **The end.** The engine ends the game and the match. The pad shows the result card; the organiser
   finalizes on the web; the pad turns view only. A disqualification asks to record the ending or
   void the sanction (the existing `EndingPrompt`). Undo on the result closes 45 s after this
   phone's own tap decided the match (owner, 2026-11-03; first 30 s, then 45 s after testing build 823), the seconds counted on the card; the end
   of a game has no limit. The window starts at the dispatched tap that takes the match from not
   decided to decided (the reducer, `scoringMatchWindow.ts`), never at a frame the pad happened to
   show, and the hub holds it in memory for the launch: Home and back keeps it. A restart, a leave
   (scanning another match) and then a rescan, and a Dismiss, Forget or Close, all show a decided
   match with no Undo, whatever order the ledger and the bootstrap arrive in, and nothing reopens or
   restarts it. Undo is refused by the reducer once the window has closed, so a press cannot land
   after the 45 s. A result the other scorer made offers none; a tap queued while offline follows
   the same rule, and the reconnect question can still discard it.
7. **Leaving.** Back goes Home at any time (ruling 10). Unsent taps keep sending while the app is
   open; the Continue card says how many are left.

## 5. The screens, as signed off

The kit and the badminton screen exist on `feat/s2-pad-ui` and are the design of record. A builder
reads the components rather than this section for pixel detail; this section names what S2 keeps.

**Top bar** (every state but the bad-link card): Back; the games won, "1:0" top:bottom, LED lime 46 dp
(`tally` role, the header's own 48 dp line; a disqualified game counts for nobody); then at the right end
the send badge, then ⓘ Match details and ↺ History, 48 dp round icon buttons, History last (owner,
2026-11-03: "have sync icon first then info, history"). The send badge (owner, 2026-11-02: "remove sending word and have a
symbol/icon like green uparrow for sending", "1 yes" on the proposal, and "can we incrase the size of 0:0
fit in that space"): no words, an up arrow and the count in a 48 dp outlined badge, lime arrow in a quiet
outline while taps are on their way, and when they cannot go (offline, a dead link, a server that keeps
refusing: `stallOf`) the same badge in caution orange with a heavier outline and the arrow stopped under a
bar, so it does not rest on telling lime from orange. Nothing waiting is no badge, though its 56 dp slot
stays so the tally's room stays the same. "99+" is the widest it draws. A tap opens History; a screen reader hears
the words ("8 taps can't be sent") and the History hint.

**Strip**, one line: "Game N of M" at the left, the interval ("Interval at 11", "Interval") at the far
right.

**Halves** (`ScoreHalf`), the whole half is the button: the side's names as typed; the SERVING plate
with the court (SERVING · RIGHT); the bar at the half's left edge, lit lime on the serving side and lilac
on the other, moving at once when the serve changes (owner, 2026-11-02: "lime color changes who is
serving"; the sport decides it, `PadHalf.bar`, so none is lit while no server is known, before the match
starts or once it is over; decorative, the plate says who serves); the score centred, `scoreLarge` 128, else `score` 96, else
`scoreCompact` 64, by the half's measured height (`scoreRole`); the bottom row with the finished games'
boxes (the winner's lime digits and hairline, a DQ box in caution) and the hint "Tap: rally to
{side}" (since S2-2's ruling 56, 2026-11-04, the hint is the one word "Tap", and a sanction is a card icon at
the head's top right, not a word in this row: S2-2 design §5.1); the lime flash (`TapFlash`, ~300 ms, none under reduce motion).

**Under the halves:** the last-tap line with Undo (`LastTapLine`), then the tools (`ToolRow`):
Sanction for each side, and Set score only before a game's first rally.

**Covers:** the sanction steps (`StepSheet`), Set score (`ScoreEntrySheet`, titled "Set score · Game
N", in-progress scores only), the ending prompt (`EndingPrompt`), Match details (`MatchDetailsSheet`:
`MatchCard`), History (`HistoryCover`). One cover at a time; the pad is hidden from
a screen reader under it; Back closes it.

**Cards:** Not started (Match details and the rules), Start screen (`TossPicker` and Start match),
result recorded, view only, bad link, and the Update needed banner in place of the last-tap line and
tools.

**The match card** (`MatchCard`; owner, 2026-11-01, option A, after the approval: the Start screen
and the Division-not-open card "looks like paste some text, we need a proper format also it can
change per sport"). One shared card on the Start screen, the Division-not-open card and the Match
details sheet:

- a header: the competition in display caps, division · round, and the match as a plate;
- a versus block: one row per side, with the Live Stream match label's side bars (lime, then lilac);
- a rules table of label → value rows.

Each sport supplies its own rows (badminton: Format, Points, Cap, Interval, Ends change); the card
knows no sport. Badminton's Ends change reads "after each game, and at 6 in game 3": ends change after
every game and once more within the deciding game (BWF Law 8); a best of 1 reads "at 6" (owner,
2026-11-03, "apply rec": "at 6 in game 3" alone read as a change in game 3 only).

**Shared kit vs sport screen** (ruling 13). Sport-agnostic, reused by every sport: `PadView` and its
cards and `cardPlacement`, the bounce guard, `TapFlash`, `LastTapLine`, `ToolRow`, `StepSheet`,
`ScoreEntrySheet`, `EndingPrompt`, `SyncBadge`, `AskSheet`, `UpdateBanner`, `RefusalBanner`, `PadStrip`,
`MatchCard`, `MatchDetailsSheet`, `HistoryCover`, `TossPicker`, `PadStateCard`, the
tally. Sport-specific: the domain view (`badmintonPad.ts`, `badmintonSanction.ts`, `badmintonRules.ts`,
`badmintonHistory.ts`) and the screen that lays the kit out. Table tennis is expected to reuse
badminton's screen with its own domain view (one engine kernel, `setbased`). A sport with a clock
(football, hockey) adds a clock part to the kit when its turn comes, following the web's `PadClockBar`.

**Fit**, held by the fit tests: 320 and 360 dp wide, four languages, singles and doubles. The send badge has
no words (owner, 2026-11-02, the top bar above), so the sync state takes one fixed slot, `layout.padSyncBox`,
in every language; `padFit.test.ts` holds the widest thing it draws, "99+", inside the slot and the tally in
the room that is left at 320 dp.

## 6. The app's side

### 6.1 Layers (AGENTS §3)

```
app/scoring/index.tsx          route: thin, the screen-on hold, the screen
src/ui/screens/<Sport>PadScreen.tsx   one per sport; lays out the kit
src/ui/components/…            the kit (§5)
src/hooks/useScoringMatch.ts   bootstrap, the fold, the queue, sync; the screen's one hook
src/domain/scoring/…           pure: pad views per sport, history, rules lines, bounce, tap flash,
                               the queue's rules (what to send, what a refusal means)
src/services/scoringPort.ts    the port: bootstrap, events since, append; fake + fetch implementation
src/services/tapQueueStore.ts  the queue's durable store
```

Scoring is JavaScript's: it is not part of the capture session and has no native code. AGENTS §2's
"no second state machine in TypeScript" is about the capture session; here the authority is the
server's ledger, and the phone's state is a fold of it (decision record ruling 5). §2 and §1 of
AGENTS.md change when S2 lands (§12).

The preview route and its fake become the real route. The preview row (`PadPreviewRow`) and the
`previewScoring` gate are deleted when the real pad ships; the fake stays as the tests' and Home's
design surface.

### 6.2 The engine

- `@seazn/engine` from the registry under the alias, as the O9 check did (`@onryde/seazn-engine`, an
  exact version, `.npmrc` scoped to GitHub Packages). Declare `zod` ourselves (its peer).
- What the app takes from it: the sport's `init`/`apply` fold, `padSpec(cfg)`, and the `pad` subpath's
  rule facts (`badmintonPadRules` and the like). The domain views in `src/domain/scoring/` read the
  fold's state, never the wire.
- **R4 first** (decision record R4, still open): fold a long ledger on the OnePlus under Hermes in a
  release build and time it; check zod under Hermes (`z.config({ jitless: true })` if `new Function`
  is reached). The O9 check proved the bundle compiles, not that it runs. A fold slower than one
  frame for a badminton match is a finding, not a blocker; a crash is a blocker.
- Undo is a `core.void` of this phone's last own event (the engine has no undo API), offered only while
  that event is the latest in the ledger, queued events included (ruling 28). A start can be voided
  only while nothing follows it (the web's rule). The kit's fake lets Undo reach under another
  scorer's taps (`voidable` in `fakeBadmintonPad.ts`); the plan narrows it to ruling 28.
- "Own" is known from the event ids the server returned for this phone's accepted taps, kept with the
  match's queue file: the web's ledger carries only the device link, which the phone and a browser on
  the same link share. If the app's data is cleared, older taps read "Another scorer" in History and
  cannot be undone (_the controller's_).
- **Leaving a match keeps its own ids for a day** (owner ruling 46, 2026-11-03). A match is left when
  nothing of it is left to send: another match's scan replaces it, or its background sender has sent
  the last tap of a match nobody holds. Its queue, ledger and boot cache go as before, but the ids of
  this phone's own taps are first written, stamped with the time, to a small file of their own
  (`{id}.own.json`), and kept for 24 h. Scanning the same match again within the day reads them back as
  own: a volunteer who scans another court's code by mistake and then their own finds History saying
  "This phone" and Undo reaching their latest tap. The file is not a queue. Home never lists it, so it
  is no Continue or Dismiss card, no unsent tap and no work for a sender, and the queue writer's
  refusal of a link secret covers it. What is older than 24 h goes at the next launch or return to the
  foreground (the hub's resume, which already sweeps what nothing wants), and a read past the day
  ignores it whatever has swept. A match with taps still unsent is not left: it stays Home's leftover
  as before, and its ids are kept when its sender has drained it. Dismiss (a bad-link panel, a
  leftover, Close on a Finished match) and Forget on a dead link keep nothing: they say the match is
  done or that its link is gone, and a fresh link is another device link whose events these ids would
  not undo.

### 6.3 The queue

- A tap becomes a queued event at once: `{type, payload, idempotency_key, created_at}`, stored durably
  before the screen shows it (anti-goal 1). The phone's view is the server's ledger folded with the
  queue on top (optimistic).
- One sender per match, while the app is in the foreground: in order, one in flight at a time,
  with `expected_seq` from the ledger the phone holds. Answers:
  - accepted → the event joins the ledger, leaves the queue;
  - 409 `SEQ_CONFLICT` (another scorer wrote since this phone's `expected_seq`; the body may carry
    `current_seq`) → fetch `GET …/events?since_seq=`, fold, and send the queue again on the new
    `expected_seq`; a queued event the new ledger makes illegal is dropped, said on the pad's
    line and in the record as `scoring.dropped {reason, count}` (as the web pipeline does);
  - 426 `ENGINE_OUTDATED` (the app's engine epoch is behind the server's) → the Update needed state;
    the queue is kept and counted;
  - 409 `FIXTURE_RULES_CHANGED` (the `rules_version` the phone sent is not the match's: the web refuses
    any version but its own, `!==`, before it looks at the seq) → reload the rules
    (`GET /api/v1/fixtures/{id}/rules`), fold again, and send the queue again with the version the read
    gives. The queue is kept: a correction never drops a tap. An event the new rules make illegal is
    refused as below. Two rules, both from the 2026-11-02 device stall (a staging match the phone
    guessed at version 1 for, which the web held at its default 0, so every send was refused for good):
    - **The default is 0.** A match nobody has corrected is at `rules_version` 0 (the web's column
      default, `min(0)`), so the phone holds 0 until a rules read tells it otherwise, and never guesses
      a version it has not read. The fake server starts at 0 as the web does.
    - **A lower version is taken when the refusal named it.** A read normally only ever raises the
      phone's version, since a lower one is a lagging read. But a refusal that names a version _below_
      the one held says the phone is ahead of the server, which only a guess can be, so the rules read
      of that same named version is taken though it is lower (`rulesSaid` in `sync.ts`). Any other lower
      read is still no news. _Caveat, replica lag:_ the rule trusts a read that agrees with the
      refusal, never a read alone; a rules read served from a lagging replica names an older version
      than the one the refusal named, so it is not adopted, and the phone keeps sending under what it
      holds and is refused again. If no read ever agrees with the server, that is a **stall**, not a
      loop to wait out: the sixth refusal in a row, of either kind (a conflict or new rules), puts one
      `scoring.stalled` line in the record and the send badge in its can't-send colour, and the pause
      between tries grows from 15 s to 60 s until a tap is taken or the queue empties. An
      ALREADY_DECIDED whose status read never lands counts into the same run (`decided`: the server
      answered, the phone never learned why, and the tap goes again), so that loop is said too.
      _Residual case (the round 2 review, 2026-11-02):_ a refusal that is itself stale (it named version
      v before the organiser's second correction) and a lagging replica's rules read naming the same v
      agree with each other, so the phone adopts v for one pass although the match is already at v + 1.
      The next send is refused naming v + 1 and a read that agrees raises it again, but a revalidation
      that runs in the one pass, under rules that are one correction behind, could drop a queued tap
      those rules call illegal and the real ones allow (said as "did not count"). It needs two
      corrections inside a replica's lag; it is accepted and not mended, and a tap dropped so is a
      `scoring.dropped` line in the record, never silent;
  - any other refusal (4xx) is read by what it says (`closes` and `refused` in `sync.ts`). A 401 (a link
    the door does not take), a 402 (an account that must pay), a 404 (the match is gone) and a 403 (the
    result is carried forward, the match is finalized, or this link may not make the write) close the
    whole queue (`QueueDead`): every tap is kept, nothing more is sent, and the pad says so. The one 403
    that is about a single tap is a bare one answering a void or a forfeit (the link may not make that
    one write): that tap alone is refused, as below. A 422 `ALREADY_DECIDED` holds its tap while the
    bootstrap's status is read: a finalized or cancelled match closes the queue, any other status refuses
    that tap alone. Every other 4xx (a 400, another 422, a 409 that is neither of the two above) → that
    event leaves the queue, the last-tap line says the tap did not count (once, however many went), the
    ledger is fetched again, and the record gets `scoring.dropped {reason, count}`;
  - no network, timeout, 5xx → stay queued, retry with backoff, with the same `idempotency_key`, so a
    tap the server accepted before the answer was lost is not counted twice; the send badge says offline and counts.
- **The reconnect question** (ruling 43, owner, 2026-11-02). Taps queued only by this phone, offline,
  go by themselves when the signal is back. But a ledger fetch that brings events _another scorer_
  made, while this phone has taps queued, stops the sender: nothing is sent until the scorer answers.
  Only events recorded from the oldest queued tap's time (less a clock-skew margin) count, so a ledger
  read again from the start does not count the whole match; one answer covers the queue until it empties,
  and a tap already in flight is not counted as discarded (the controller's, 2026-11-03).
  Which events are foreign: the ledger's new events whose ids are not in the queue's `ownEventIds`
  and are not the copy of a tap the phone sent (its link, type and payload) whose answer was lost; a
  rally and its Undo that come together cancel, and another scorer's Undo of this phone's own event is
  nothing scored. The marker (`askedAbout`, the foreign ids) is in the queue file, so a kill and a
  reopen find the question standing, and it ends with the queue (nothing left to send or discard). The
  pad shows a sheet over it (over any card but a dead link's, where the question is moot), in the
  screen's language: "{n} scored elsewhere before your taps were sent" (plural-aware, no sport named;
  it asks online too, since a concurrent scorer double-counts the same: the controller's, 2026-11-03), the score as the server has it without the phone's taps, how many
  taps wait, and two buttons. **Send my taps** lifts the question and runs the normal revalidate and
  send, on the ledger as it stands. **Discard them** opens a confirm with Keep as the default (the
  dim and Back both mean Keep); the confirm's Discard deletes the queue, sends nothing and keeps the
  event whose answer was lost, which is the phone's own now. More foreign events while the sheet is
  open raise the count and the score, and a revalidation that drops every tap the question was about
  ends it. The badge shows the can't-send state ("{n} taps waiting for your answer"), and no stall is
  said for it. A background sender (no screen) holds without asking and never sends; the next pad to
  open on that match asks. The record gets `scoring.ask {foreign, queued}` when it begins and
  `scoring.asked {answer}` (`send`, `discard`, or `moot` when the taps went another way). The web's
  record allow-list does not carry `foreign` or `queued`, so Send record drops them and Share record
  keeps them (`_FINDINGS.md` N43). Back on the sheet leaves the pad for Home, as the ending prompt does.
- Undo of a tap still in the queue removes it from the queue; nothing is sent (_the controller's_).
- Other scorers' events arrive in real time, as on the web (ruling 27): the web's Supabase Realtime
  channel carries a "something changed" ping with no payload (`use-fixture-stream.ts`), its token from
  `api/v1/public/fixtures/[id]/realtime-token`, and every ping is answered by one
  `GET …/events?since_seq=`. Polling every 15 s is the fallback while the channel is down, and a
  fetch runs at once on returning to the foreground. The Realtime client is a new dependency: the
  plan checks it runs under Hermes and autolinks inside Expo's range (AGENTS §13 failure class 4).
- **A queue per match** (ruling 29). Scanning another match's link opens it; the old match's queue
  keeps sending in the background while the app is open, on its own saved token (the saved-code
  store keeps one code per mode today, so the queue file keeps the token reference it needs). Home's
  Continue card names the current match and counts the other's unsent taps ("4 taps from Match 4 not
  sent yet"). Taps that can never be sent (the link revoked, the match finalized) are shown as "4
  taps not sent — tell the organiser" with Dismiss; Dismiss deletes that queue. Nothing else
  discards a tap.
- Store: the queue holds no secret, and secure store is the wrong place for a growing list.
  _The controller's_ pick is a small JSON file per match through `expo-file-system`, written to a
  `.tmp` and moved over the file. The move is not atomic on Android (it deletes the target, then
  renames: `expoQueueFiles.ts`, AGENTS §11), so a kill between the two leaves only the `.tmp`, and a
  read promotes it if it decodes (`tapQueueStore`); the builder checks it autolinks inside Expo's range (AGENTS §13
  failure class 4). The scoring link's token stays in secure store with the saved codes.

### 6.4 History comes from the ledger

History is the match's activity as the server holds it, the same source as the web pad's activity
panel (`activity.tsx`), never a log the phone keeps for itself (owner, 2026-11-01: "make sure that
history are coming from activities intead of creating own"):

- Its rows are the ledger's events from `GET …/events?since_seq=`, kept in sync by the Realtime ping
  (ruling 27): each event's `id`, `seq`, `type`, `payload`, the event it voids, and when it was
  recorded. Every scorer's events are there, the browser's and the organiser's included.
- "Undone" is derived as the web derives it: an event is undone when another event voids it. A void is
  never shown as a row of its own and is never undoable.
- This phone's queued taps, not yet accepted, show on top marked as sending; they become ledger rows
  when the server accepts them, and a refused one leaves.
- "This phone" or "Another scorer" comes from the ids the server returned for this phone's taps
  (§6.2).
- The words for a row come from one vocabulary keyed by the event's type, shared with the last-tap
  line (as the web's `buildRibbon` serves both its ribbon and its activity panel). Nothing in History
  is computed that the ledger does not hold, except the score after each rally, which is the engine's
  fold of the ledger up to that event.
- The kit's `badmintonHistory.ts` builds rows from the fake's own ledger; the plan moves it onto the
  real ledger's events.

### 6.5 The bounce guard

Any tap within 250 ms of a counted tap is held to be the same press (`bounce.ts`): a half, Undo,
Start, a tool, and the ending prompt's buttons after the DQ confirm. It counts once and the last-tap
line says "Counted once". Hardened on `feat/s2-pad-ui` (§11).

### 6.6 Screen and lifecycle

- The screen is kept on while the pad shows; brightness untouched (ruling 9; `holdScreenOn`). The exception, the
  controller's ruling of 2026-11-02: the pad's view-only, bad-link and update-needed cards, and the full-screen states that
  need a person to act, let it sleep (`holdsScreen`; the wait before the pad and the not-started and recorded-result
  cards keep it).
- Portrait only (decision record ruling 4); the turn card asks for upright (`/scoring` routeTarget).
- Leaving the mode while a broadcast is held is S1's rule and unchanged; Remote Scoring holds no
  broadcast.
- Home's Continue card names the match and its unsent count (ruling 10).

## 7. The web's side

### 7.1 The bootstrap endpoint (new; built in a seazn.club worktree, ruling 12)

`GET /api/v1/score/{token}` (path the web's to choose), the scoring link's token as the bearer, as
the pad's other calls are. It answers what `page.tsx` resolves by SQL today, as JSON:

- the fixture id, sport, rules version (epoch) and the match's `cfg`;
- the sides and their players' names as typed (singles and doubles);
- **the context: competition, division, round, the match's label/number** (ruling 23);
- the division's state (not open / open), the match's (not started / in play / result recorded /
  finalized);
- whether the link is valid (and why not: revoked, expired with the match, unknown);
- the engine epoch the server expects and the match's current `rules_version`, kept apart: the first
  decides Update needed (426), the second is sent with every event (409 on a format correction);
- the current `seq`, so the first `GET …/events` can start from 0 or from a cached point.

It is read-only, needs the same Event pass/Pro entitlement as the link itself, and is covered by the
web's own route tests. Production must serve it before the app's production build scores (today
production has no capture API at all: a deploy step for the release notes).

### 7.2 Existing calls

- `POST /api/v1/fixtures/{id}/events` `{expected_seq, type, payload, idempotency_key, rules_version}`,
  bearer `dl_…`; answers include `SEQ_CONFLICT` and 426 `ENGINE_OUTDATED` / `engine_epoch_missing`.
- `GET /api/v1/fixtures/{id}/events?since_seq=` for the ledger and conflict recovery.

### 7.3 Settled with the engine and the web (scouted 2026-11-01: web `edc1076dba`, engine `081f7de`, `@onryde/seazn-engine` 1.1.0)

- **The toss** needs no engine change: `core.start` is `{}`, and the first rally of the match carries
  `serving: <EntrantId>`, which anchors the first server (`kernel.ts:1269-1300`); the rally winner
  serves after that. The web pad leaves `serving` out today; reading it there is the web's to add.
- **The engine epoch** travels as the POST body's `engine_epoch` (`foldEpochOf('badminton')`, 2 at
  1.1.0); 426 `ENGINE_OUTDATED` only when it is sent and lower than the server's.
- **A disqualification's ending** is `core.forfeit {by, reason: "disqualified"}` posted right after
  the sanction; any other event before it gets 422 `ENDING_SANCTION_PENDING`. Voiding it is a
  `core.void {event_id}` of the sanction.
- **A retry with the same `idempotency_key`** is answered with the original outcome (201, same
  `event_id`), from the server's cache or its ledger, even after a `SEQ_CONFLICT`. So resending a
  queued tap after a lost answer is always safe.
- **The web pad drops** an event refused with `FIXTURE_RULES_CHANGED`; this design keeps it, folds it
  under the reloaded rules and resends it if it is still legal (§6.3). A deliberate difference.
- **The epoch moving mid-match** is answered by ruling 8 on the phone; the server's own answer is the
  web's.

## 8. Copy and languages

Every string is in the four dictionaries and the glossary. The translations added on
`feat/s2-pad-ui` are the controller's and need a native reader before release: the new `scoring.*`
keys in `es`, `fr` and `nl` (the glossary rows dated 2026-10-31 and 2026-11-01). Known choices to
check: "DQ" kept in all four; fr "Match lancé", nl "Gestart" (shorter wordings for History at 320 dp).

## 9. Risks

- **R4, the engine on Hermes** (above): first task of the plan.
- **Several scorers.** No claim means two phones can fight; `SEQ_CONFLICT` and the refold keep the
  ledger right, History shows "Another scorer", and Undo stops at another scorer's tap (ruling 28).
  Watched at the exit bar.
- **A device link has no time expiry** on the web; a link revoked mid-match turns the pad to the bad
  link card, and its unsent taps become leftovers (§6.3), never sent elsewhere.
- **Offline, the phone cannot know** another scorer has scored: Undo may be offered and then be
  refused at send. The refusal line says so.
- **Production's API gap** (§7.1).

## 10. Exit bar (ruling 11)

On staging, a real badminton match on the OnePlus, release build:

1. Scan → Start screen → toss → score to the end, with Set score, a sanction, Undo across a game.
2. Flight mode for at least a game's worth of rallies; back on; the queue drains; the console agrees.
3. A browser co-scorer on the same link while the phone scores; both agree after conflicts.
4. The app killed mid-game, reopened into the match, unsent taps kept and sent.
5. The organiser finalizes; the pad turns view only.
6. A second geometry (`wm size`/`density` override, 320 dp) for the pad, Start screen and History.
7. The Update needed path forced on staging (a rules version ahead of the app).

## 11. What already exists (`feat/s2-pad-ui`, not pushed)

On `feat/dev-app-variant` (dev twin, `dcf5acd`). Nineteen commits from the kit (`66db95a`) through the
design rounds to the hardening pass (`547ebc9`, `7dea831`, `4ca3fd9`): 5590 tests green, `pnpm check` exit 0, 101 of 102 mutations killed (one equivalent). Reviewed through `0e393fb`;
rounds 2–7 and the hardening get one full review before the branch's PR.

## 12. Changes to the house rules when S2 lands

- AGENTS §1: Remote Scoring is a working mode; its writes to the match's ledger are its purpose and
  not an "upload" in §1's sense.
- AGENTS §2: scoring is JavaScript's and not the capture session's; the state-machine rule is about
  the capture session.
- AGENTS §3: `app/scoring/`, the scoring port and the queue store in the tree.
- Decision record: ruling 9 superseded for S2 by ruling 3 (no claim); the S2 row's "first-scan
  claim" struck.

## 13. Plan S2-1 (ruling 26)

In order: (1) R4, the engine folded on the OnePlus under Hermes in a release build, timed; (2) the web
bootstrap endpoint in a seazn.club worktree, on staging; (3) the app's port, queue, sync and Realtime;
(4) the real badminton pad on the kit, the scan and the Continue card; (5) the exit bar on staging.
Table tennis is plan S2-2, designed in `docs/specs/2026-11-03-s2-2-table-tennis-design.md` (rulings
48–52). The endpoint's production deploy goes with the 1.0.x release notes.

## 14. Left to the builder

Names of files and functions beyond those §6.1 lists; the backoff curve; the exact JSON shape of the
queue file; the Continue card's wording within the existing card; how the sport screen is registered
(a map from sport to screen); test layout. Anything here that changes what the scorer sees comes back
to the owner.
