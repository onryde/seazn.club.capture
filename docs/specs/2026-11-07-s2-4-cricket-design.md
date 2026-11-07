# S2-4 — Remote Scoring, cricket: design

Status: **draft, awaiting the owner's read**. Brainstormed in the session of 2026-11-07 ("s2-4"). The owner signs off on
this document and on a throwaway preview on the phone (ruling 70).

This design adds cricket to Remote Scoring. It argues from the S2 design
(`docs/specs/2026-11-01-s2-remote-scoring-design.md`, "the S2 design" below), whose rulings 1–47 and whose sections §4 to
§9 hold for cricket unless a line here says otherwise, and from the table tennis and chess designs where they generalised
it (rulings 48–63). Cricket's rulings are numbered 64–99 (a block agreed with the football session, which takes
100–129; clerical, the owner may renumber). A ruling is the owner's unless marked _the controller's_; everything marked
_the controller's_ is open to the owner's correction while reading.

## 1. Intent

One scorer at a cricket ground scores a whole match, ball by ball, on their own phone (ruling 65). They scan the match's
scoring link, check it is the right match, record the toss, set the batting order and the openers, pick the bowler, and
then tap each ball: runs, extras, wickets. The phone asks for the next bowler at the end of every over and for the next
batter after every wicket. It records who did what, not just the team score (ruling 64). The organiser's console, the
scorebug and the browser pad see the same match.

The phone is not a copy of the web pad. The owner played a full match on the web pad on staging on 2026-11-07 (§9) and
found eight gaps; the phone fixes all eight, and the web pad is fixed to match (ruling 67, §7). It is not a copy of
CricHeroes either (the owner, 2026-11-07: "don't copy the same"). What we took from studying it, and what we left out, is
in §10.

Success: a real cricket match on staging, scored on the owner's OnePlus from the toss to the result, super over included,
with the console agreeing ball for ball (§8).

## 2. Goals, non-goals, anti-goals

**Goals**

- Ball-by-ball cricket with player detail: batting order, openers, striker and non-striker, the bowler of every over,
  every kind of extra with its runs, every mode of dismissal the engine knows, the fielder, the incoming batter (ruling
  64).
- Every action the engine records during a live match and the format allows, behind a More button (ruling 69, §4.8).
- A team-only path when the players are not entered: over-by-over totals (ruling 66, §4.10).
- A third sport behind the S2-1 runtime: a module set behind `ScoringSport`, a row in `sports.ts`, its own screen (S2
  ruling 38). Three generic changes are needed and recorded in §6 (the lineup's slot shape, `lineupOf`, the boot cache
  for pending picks); any other is a finding to record, not a quiet edit.
- Every S2-1 behaviour holds: the durable queue, sync, Realtime, History, Undo and its 45 s window on the result, the send
  badge, the Continue and Finished cards, the Update needed path.

**Non-goals**

- No second scorer as a design case (ruling 65). Several scorers still work, as for every sport (S2 ruling 3,
  `expected_seq`), but no hand-off at the innings break is designed, and Undo stays this phone's last tap (S2 ruling 28).
- No adding players on the phone. A device link can't write a lineup or create a person, and `core.lineup.entry` adds a
  person only as a concussion replacement. A missing side is the organiser's to fix; the phone falls back to over totals
  (ruling 66).
- No post-match scorecard entry (`cricket.player.line`): it types a player's whole innings after the match, not ball by
  ball (_the controller's_, §4.8).
- No DLS calculation on the phone. A revised target is entered as the umpire gives it. The organiser's console works it
  out with the `cricket.dls` feature (_the controller's_).
- No forfeit, abandon, settle or finalize: the server refuses them on a device link (organiser only), as for every
  sport.
- No wagon wheel, no shot type, no ball speed, no fielding positions (§10).

**Anti-goals**

- A cricket rule of our own. Who may bowl, who may come in, whether the innings is over, whether a free hit stands, which
  dismissals stand off a wide or a no-ball, the target: all of it is the engine's (`eligibleBowlers`,
  `eligibleIncomingBatters`, `suggestedIncomingBatter`, `chaseTarget`, `activeInnings`, `cricketPadRules`). The pad
  offers only what the engine will accept.
- A ball recorded half-way. The web pad stores a no-ball, bye or leg-bye as PARTIAL if its runs strip times out (~7 s).
  The phone records a ball only once its last step is chosen, and no step has a timer (ruling 67).
- A pad that moves under the thumb. The web pad's layout jumps after every ball; the phone's regions have fixed heights
  (ruling 67).
- Cricket conditions inside a shared component. A shared part takes props; the sport decides.

## 3. The owner's rulings (S2-4)

| #   | Ruling |
| --- | ------ |
| 64  | Player-level detail as well as the team score: "both. it should popup the players and choose the order and pick the player if out and pick the blower etc.," (2026-11-07). |
| 65  | One scorer per match is the design case: "Assume that one person" (2026-11-07). |
| 66  | Players not entered → a card "Players not entered — ask the organiser" and over-by-over totals (`cricket.innings.summary`, `partial: true`): "Over totals (Recommended)", then "allow option to over by over if no player like that" (2026-11-07). |
| 67  | The eight web-pad gaps (§9) are fixed on the phone, and on the web: "Yes and need to fix if anything in web" (2026-11-07). |
| 68  | The flow of §4, played back in plain words, is agreed: "ok" (2026-11-07). |
| 69  | More holds Retire, Penalty runs, Declare / close innings and Rain: revised target, and "try to match and see possible action from engine" (2026-11-07): every live action the engine records and the format allows (§4.8). |
| 70  | Sign-off is a throwaway preview on the phone plus this document ("1 and 3", 2026-11-07). The preview has no tests and no mutation testing ("don't do any mutation/test in preview"). It is never merged. |
| 71  | Engine changes before cricket ships on the phone (2026-11-07): export the wide and no-ball dismissal sets and `orderFromLineup`; a mid-over bowler change; a hand strike swap. A fielding-side penalty was not chosen. (§7.3) |
| 72  | The web pad's gaps (§7.2) are fixed by this session in a `seazn.club` worktree, on staging before the phone's exit bar ("This session (Recommended)", 2026-11-07). |
| 73  | A 4 or 6 that was run, not a boundary, goes under the 5+ key ("ran 4", "ran 6"); the 4 and 6 keys are boundaries ("Under 5+ (Recommended)", 2026-11-07). |
| 74  | A tie with no players entered: "Tied — the organiser decides the super over" ("Say so, organiser decides (Recommended)", 2026-11-07). |
| 75  | A mid-over bowler change follows the Laws ("Follow the Laws (Recommended)", 2026-11-07): neither bowler may bowl the next over (Law 17.7); the part over counts as a full over toward each bowler's max-overs limit (ICC limited-overs conditions); neither is credited a maiden for it; each bowler's figures get the balls they bowled. For the engine to record as its own ruling. |
| 77  | A Players sheet during the match, opened by a tap on the score panel (the owner, on the preview, 2026-11-07: "how do I see list of player batter/bowler after match started and choose the order between overs?"; then "Tap the score panel (Recommended)"). Batting tab: out (how, runs (balls)), at the crease, yet to bat. Bowling tab: figures, overs left, who can't bowl next and why; a tap sets the next bowler between overs. |
| 78  | The yet-to-bat order can be changed at any time; it is the phone's own and only changes the suggested next batter ("Any time (Recommended)", 2026-11-07). |
| 79  | No 5+ key on the pad: "canwe remove 5+ add it in more ? like penalty or something use that space for 3 equal button" (the owner, on the preview, 2026-11-07). The bottom row is Out, Undo, More, three equal buttons. More's first row is "Other runs and penalty": 5, 7, all-run 4 or 6, and +5 penalty on a fair ball. Supersedes ruling 73's 5+ key and §4.2's "+ Penalty" on a legal ball's sheet. |
| 76  | The strike swap reverses the pair only: the same two batters, swapped ends; no separate swap event ("Reverse the pair only (Recommended)", 2026-11-07). Additive; for the engine to record as its own ruling. |

## 4. How a scorer meets it

As the S2 design §4 (scan, Not started card, pad, History, result), with these differences.

### 4.1 Start

1. **Match card**: teams, competition, division, round, and the format line from the fixture's `cfg`: overs per
   innings (or "unlimited"), balls per over, players a side, max overs per bowler, super over on or off, follow-on and
   reviews when the format has them.
2. **Toss**: "Who won the toss?", two buttons with the **team names** (the web asks Home/Away; gap 1). Then
   "{team} chose to…", Bat or Bowl. Records `cricket.toss {wonBy, elected}`. The engine accepts a toss only before
   `core.start`, so the toss is asked before Start, as table tennis's serve pick is.
3. **Batting order**: the batting side's starting players, in the team sheet's order (`order_no`), the first two marked
   Opener. The scorer reorders by drag or by Up/Down. No event records the order: the openers are the first ball's
   `striker` and `nonStriker`, and the rest is the phone's own default for "Next batter", sent as `incoming` on every
   wicket (§4.3). The order is a pending pick (§6), never a rule (Law 25.1).
4. **First bowler**: the fielding side's starting players; pick one.
5. **Start match**: a tap (as every sport's Start). Records `core.start`.

The web pad has no setup step. It auto-picks orders 1 and 2 and the first eligible bowler, and the scorer corrects them
on chips (gap 1). The phone asks.

### 4.2 Each ball

- **Runs**: one tap on 0, 1, 2, 3, 4 or 6, two rows of three. 5, 7 and an all-run 4 or 6 are in More, "Other runs and
  penalty" (ruling 79). The 4 and 6 keys are boundaries (`boundary`); an all-run 4 or 6 carries none (ruling 73). `boundary` is never checked against the runs; it feeds the fours,
  sixes and boundary-count tie-break only (212, 1653, 1751).
- **Extras**: Wide, No-ball, Bye, Leg-bye each open a sheet that stays until a choice is made or it is cancelled (gap 4):
  - Wide → "Runs run" 0–4. The engine's `extras.runs` counts the wide's own run, so a wide and two run is
    `{wide, runs: 3}` (`cricket.ts` ~1655). The web records a wide as one run, always (gap 3).
  - No-ball → runs off the bat (0, 1, 2, 3, 4, 6) or no-ball byes and leg-byes. A ball carries one extra, so no-ball
    byes and leg-byes go as one no-ball extra with the runs, charged to the bowler (1621-1622), and the ledger can't tell
    a no-ball's byes from its leg-byes afterwards (the preview's finding). The pad asks only "runs off the bat" or "runs
    run" for a no-ball. A free hit follows; the pad shows it.
  - Bye, Leg-bye → 1–4.
  - Each sheet also has "+ Out", which opens the wicket steps for this delivery with only the dismissals the engine
    allows off it (`WIDE_DISMISSAL_KINDS`, `NO_BALL_DISMISSAL_KINDS`).
- **Strike** is the engine's alone (odd runs, the end of an over). There is **no hand swap**: in the main innings a ball's
  `striker` and `nonStriker` must match the fold's pair or the ball is refused (`cricket.ts:1524-1542`). A wicket ball
  never moves the strike, so a run out's completed runs don't move it either (1649-1660, 1681-1682): the engine's
  simplification, which the owner should know (§11).
- **Penalty runs** (Law 41) are an extra of kind `penalty` on a ball, the batting side's only. The engine counts that
  ball as legal (over, striker's and bowler's balls all go up; 1578, 1614-1629, 1725), and a ball carries one extra only
  (209), so a penalty can't ride with a wide, no-ball or bye. The pad offers it in More's "Other runs and penalty", on a fair ball
  with the runs off the bat (ruling 79). There is no fielding-side penalty and none between balls (§11).
- **Never sent**: `freeHit` (the server refuses it unless a free hit is pending, 1574-1576; the web stopped sending it).
  **Always sent**: `over` and `ballInOver`, checked strictly against the fold (201-203, 1482-1487).
- **Over strip**: this over's balls as chips (`·`, runs, `wd`, `nb`, `b`, `lb`, `W`), extras in the caution colour,
  fixed width, so nothing moves as it fills.

The extras flow is open: the owner did not follow the A/B mockup ("I don't get it"). The preview shows the sheet (A); the
owner judges it there (§11).

### 4.3 Wicket

**Out** (caution outline) opens one sheet, step by step, each step only when it has a choice:

1. **How out**: only the kinds the engine allows on this delivery. A free hit allows run out and obstructing only
   (`FREE_HIT_DISMISSAL_KINDS`, 1263-1265). A wide allows hit wicket, obstructing, run out, stumped; a no-ball its own set
   (1254, 1259, 1591-1596). Those two sets are **private** in 2.0.0 (§6). **Retired** and **timed out** are not offered on a
   ball: recorded on a ball, each adds a legal ball none bowled. Retirement goes through More's Retire (`cricket.retire`,
   no ball); timed out is open (§11).
2. **Who's out**: only when it could be either batter (run out, obstructing; 1287). Otherwise the striker.
3. **Fielder**: caught, run out, stumped; optional for obstructing (1280). A stumping offers the **wicketkeeper** (the team
   sheet's `wicketkeeper` role, else its `WK` position; 2713, 2717), or the fielding side without the bowler when none is
   named (gap 6). Keeper-only is our rule: the engine accepts any fielder (1326-1330). A run out may name a second fielder
   (`fielderAssist`, which must differ from `fielder`).
4. **Runs completed** (run out only): 0–3 before the wicket (gap 5). Whether they are off the bat, or byes/a wide's runs
   when the run out came off one, follows the delivery's extra (§11).
5. **Next batter**: `eligibleIncomingBatters`, the batting order's next chosen, sent as `incoming` on **every** wicket. The
   phone's reordered order is recorded by nothing else: without `incoming` the server walks the team-sheet order
   (1387-1390), and `suggestedIncomingBatter` indexes the engine's own order (479, 2363-2375). Naming `incoming` doesn't
   move that index on (the preview's finding), so the phone works out the suggestion from its own order and the batters
   already in. **Skipped** when the wicket ends the innings (all out, the innings' last legal ball, the
   super over's second wicket; gap 7).

`bowlerCredited` is required and must match the kind (191, 1600-1603). The pad sends it from
`cricketPadRules.bowlerCreditedKinds`, never asks.

### 4.4 End of over

A sheet: "Over {n} — next bowler". The fielding side, eligible first; the rest greyed with the reason: "Bowled the last
over", or "Out of overs ({max})" (`eligibleBowlers` and `maxOversPerBowler`). The web picks the next bowler silently
(gap 2). The bowler is named on every ball (`bowler`); there is no bowler-change event, so the pick is held on the phone
until the over's first ball carries it.

A bowler who can't finish an over (injury) can't be recorded: the engine refuses a second bowler in an over in progress
(1512-1517) and has no event for the change. It needs an engine change (§11). The pad never offers it.

No fielder eligible to bowl (a short side under a strict quota): the web shows "noEligible" (`cricket.tsx:705-713`); the
phone's sheet says the same and offers over totals for the rest of the innings (_the controller's_, §11).

### 4.5 Innings break

The engine closes the innings (all out, overs done, target reached). A card: "{team} {runs}/{wkts} ({overs} ov) ·
{team} need {target} off {balls} balls" (`chaseTarget`), then the openers and the bowler for the next innings, then Start
innings. The web shows the target only after the chase's first ball. Start innings records nothing: the innings opens on
its first ball (3934-3938), which carries the openers and the bowler.

Two-innings formats: the same card, with the lead or deficit, and the follow-on in More when the format allows it.

### 4.6 Super over

A tie in a format with `superOver` on (a knockout default) goes straight to a card: "Tied — super over". Then the same
setup: two batters (`soEligibleBatters`) and a bowler, the side batting second batting first (`soBattingSideAt`). Balls
go as `cricket.superover.ball`. After the first wicket the Next batter step still asks, but its answer rides the next
ball as its `striker` or `nonStriker`: in a super over `wicket.incoming` is ignored (1662-1683) and the next ball names the
replacement (1551-1569). Two wickets end it (1982), with no Next batter (gap 7). The super over takes nothing but its own
balls: More is empty (3144-3150). The format's `superOverStillTied` decides a second tie (1999-2012).

### 4.7 Result and Undo

The result card says the engine's margin ("won by 12 runs", "won by 4 wickets", "won on the super over", "won on
boundaries", "won by an innings and N runs", "drawn", "no result", "tied"; every `CRICKET_MARGIN_KINDS` value has words,
559-564; the fold's `result.headline` is a score line, not a sentence, so the words are the phone's dictionary's) and
"Result recorded — the organiser finalizes it", as every sport. Undo is the S2 rule: this phone's own last tap, voided
(`core.void`); the 45 s window on a deciding ball (S2 ruling 47). The engine refolds from the start after a void, so
Undo across an innings break or into a super over is the engine's to get right; the plan proves it on staging.

### 4.8 More

Every live action the engine records, shown only when the engine would accept it now (ruling 69). Data-driven from
`cfg` and the fold, never a list per screen. "Innings open" means live with an innings in progress, so not at the
innings break (2177-2179, 1050). In a super over More is empty (3144-3150).

| More item | Event | Shown when |
| --- | --- | --- |
| Retire (hurt / out / other) | `cricket.retire {person, reason, incoming}` | innings open |
| Declare | `cricket.innings.declare` | two innings a side, innings open (3965) |
| Close innings (time / weather / other) | `cricket.innings.close {reason}` | innings open |
| Rain or bad light | `cricket.interruption {kind, oversLostEstimate}` | before Start or live (3994) |
| Revised overs / target | `cricket.revise {oversPerSide?, target?}` | one innings a side, limited overs, before Start or live (1115-1119); the target is entered, never computed |
| New ball | `cricket.newball` | innings open |
| Powerplay start / end | `cricket.powerplay {kind, phase}` | limited overs, innings open |
| Follow-on | `cricket.followon` | `cfg.followOn.enabled`, between innings 2 and 3, with the lead (4010-4017) |
| Match close (draw) | `cricket.match.close` | two innings a side |
| Review | `cricket.review {by, kind, outcome, …}` | innings open. Recordable without `cfg.reviews` (91-95, 2279), which only caps them |

More's first row is always "Other runs and penalty" (ruling 79): 5, 7, all-run 4 or 6, +5 penalty on a fair ball. Left out, _the controller's_: `cricket.player.line`
(post-match, §2). The toss, the balls, the super-over balls and the over totals are in the main flow. The plan reads each
gate from the engine at its line, and a gate the engine moves is a finding.

### 4.8a Players (rulings 77, 78)

A tap on the score panel (the score, the crease, the bowler line) opens **Players**, a sheet with two tabs:

- **Batting**, in batting order: out (how out, runs (balls)), at the crease (runs (balls), ● the striker), yet to bat.
  Yet to bat reorders by drag or ▲▼, at any time. The order is the phone's own pending pick (§6): nothing is recorded,
  and it only changes the batter suggested after the next wicket (§4.3). Retired-not-out batters show as such and may be
  chosen to resume.
- **Bowling**: every fielder with O-M-R-W and overs left of `maxOversPerBowler`; who can't bowl the next over and why
  (`eligibleBowlers`). Between overs a tap sets the next bowler (the §4.4 sheet's pick); mid-over the list is read-only
  (a mid-over change is ruling 75's, through the engine change).

Figures come from `deriveCricketScorecard`, never the phone's own sums. Read-only for anything already bowled.

### 4.9 Match details

The ⓘ sheet as every sport: the match block, then the rules (the format line of §4.1, one row each), then for cricket the
scorecard of each innings so far (batting, bowling, extras, fall of wickets) from `deriveCricketScorecard`, which the
phone's engine exports. Read-only.

### 4.10 Players not entered

When a side has fewer than two starting players, or the fielding side has none (the web disables every ball tile then),
the pad shows "Players not entered — ask the organiser", and below it **over totals**: per over, runs and wickets, sent
as `cricket.innings.summary {runs, wickets, legalBalls, partial: true}` with the innings' running totals (ruling 66). The
engine needs no ids for it. **Once an innings has a summary, it takes no balls** (3931-3933, 1468-1470): if the
organiser enters the players mid-match, the ball pad returns from the **next innings**, not the next over. The last over
may be partial (a chase that passes the target mid-over, `CHASE_OVERSHOOT`, 1817), so the totals take legal balls, not
whole overs.

**A tie in over-totals mode is a dead end**: a summary needs the match live (1765), and a super-over ball needs batters
in the lineup (1554-1559). The pad says "Tied — the organiser decides the super over" and stops (ruling 74).

## 5. The screen

`CricketPadScreen`, its own screen over the shared kit (S2 ruling 38). Portrait. Top to bottom, every region a fixed
height:

1. Top bar: back, send badge, ⓘ, History (as every sport).
2. Score: runs/wickets large in lime, overs, the side batting and the innings; when chasing, "Need {n} off {m} balls".
3. Crease: striker (● lime) and non-striker, each "runs (balls)"; the bowler with O-M-R-W.
4. This over: the strip of §4.2.
5. Run keys: 0 1 2 3 4 6 large, two rows of three.
6. Extras row: Wide, No-ball, Bye, Leg-bye.
7. Out, Undo, More: three equal buttons (ruling 79).
8. One status line (S2's): the last ball, Free hit, or an engine refusal in the caution colour.

Fit is the plan's (`padFit.test.ts` at 320 and 360 dp, en/es/fr/nl). Cricket names are long; a name gives way to an
ellipsis, the numbers never do.

## 6. The app's side

- **Module set**, mirroring table tennis's: `cricketPad.ts` (display and pad view), `cricketFold.ts` (the engine's fold,
  memoised), `cricketEvents.ts` (taps → events, payload for send), `cricketRules.ts` (match card rows), `cricketWicket.ts`
  (the wicket steps), `cricketHistory.ts` (words for its event types), `cricketSport.ts` (the `ScoringSport`), a row in
  `sports.ts`, `CricketPadScreen.tsx` and its sheets. Names are the builder's; the split is the rule (lint
  `SPORT_MODULES`).
- **Lineup.** The engine's `orderFromLineup` keeps rows with `slot === "starting"` and role player, sorted by `orderNo`
  (dist `cricket.js:2210-2215`). The phone's lineup builder today marks every row starting (`setBasedEngine.ts:58-68`),
  because the bootstrap drops `slot`, `order_no` and `role`. For cricket the bench and coaches become local batters and
  bowlers the server refuses (1502-1504, 1372-1374), and the all-out count differs when the starters are fewer than
  `playersPerSide` (651). **It needs the web change of §7.1 first.** The model the phone builds to is the server's
  `engine-db/lineups.ts`: rows ordered `order_no nulls last, person_id`, with `i+1` as the fallback `orderNo` (47, 77). The
  bootstrap sends rows ordered `order_no nulls last, full_name` (`fixtures.ts:896`), so the phone re-sorts; a mismatch
  there changes who bats next.
- **Generic changes** (contrary to "nothing generic", §2; recorded here, not made quietly): the bootstrap's lineup slot
  shape (`wire.ts:15, 210-212, 343`); `lineupOf` in a generic file; and the boot cache, which keeps only `toss` today
  (`tapQueueStore.ts:706-710`, `queue.ts:136`), grows to hold cricket's **pending picks** (the batting order, openers,
  the next bowler, the next batter). They're kept with the queue so a process death between an over's end and its first
  ball doesn't lose the pick (_the controller's_).
- **The fake's cfg** must be a full `CricketCfg`: a short format is refused without `minOversForResult` (the
  preview's finding). The real cfg comes from the bootstrap and is already whole.
- **Rules version and epoch**: from the bootstrap and the rules read; `foldEpochOf('cricket')` (2: dist
  `fold-epoch.js:51`). Never a constant.
- **Engine**: 2.0.0's phone subpaths export `eligibleBowlers`, `eligibleIncomingBatters`, `suggestedIncomingBatter`,
  `chaseTarget`, `soBattingSideAt`, `soEligibleBatters`, `activeInnings`, `cricketPadRules` and
  `deriveCricketScorecard`. They do **not** export `WIDE_DISMISSAL_KINDS`, `NO_BALL_DISMISSAL_KINDS` or `orderFromLineup`
  (private; dist `pad/index.js:17-37`). Each needs an engine export and a release the phone takes, or a trial fold of
  the candidate event. Never a hand copy (§11). The plan checks that cricket's fold on Hermes is fast enough on a long
  ledger (a 50-over innings is 300+ events; S2's R4 check was badminton's).
- **History words** for every cricket event type, in the four dictionaries and the glossary.
- **Fake**: a cricket fake so every state renders on a laptop (AGENTS §10).

## 7. Web side

### 7.1 The bootstrap's lineup rows (shared with football)

The device-link bootstrap returns lineup rows without `slot`, `position_key`, `order_no`, `role`, `roles` and
`squad_number` (`device-link-bootstrap.ts`). The football session is adding them, with the names `readLineup` uses, in
one PR for both sports (football's ruling 103). Cricket needs `slot`, `order_no`, `role` and `roles` (the keeper). The
bootstrap's `cfg` is already the effective one: it comes from `resolveFixtureCfg` with the stage merged
(`fixtures.ts:123-186`), so knockout super-over defaults arrive and no cricket key is missing.

### 7.2 The web pad's gaps (ruling 67)

Fixed in the web pad (`apps/web/src/components/v2/scorepad/v3/skins/cricket.tsx`), so the browser and the phone record
the same things:

| # | Gap (seen on staging, 2026-11-07) | Fix |
| --- | --- | --- |
| 1 | No setup step; toss asks Home/Away; a toss before the tournament starts is refused with "That action doesn't apply at this point in the match" | Team names on the toss; openers and bowler asked before the first ball; a toss refusal that says the tournament isn't started |
| 2 | Next bowler picked silently at the end of an over | Ask, with the ineligible greyed and the reason |
| 3 | A wide is always one run | Runs run off a wide |
| 4 | The no-ball / bye / leg-bye runs strip vanishes in ~7 s, and the ball is stored PARTIAL | No timer. The timer is the shared chassis's (`pad-host.tsx:1458`), so the fix touches every sport's strip on the web |
| 5 | No runs completed on a run out | Ask, run out only |
| 6 | Stumped offers the whole side, the bowler included | The keeper, else the side without the bowler |
| 7 | "Who walks in?" after an innings-ending wicket (seen on the super over's second) | Not asked |
| 8 | The layout jumps after every ball | Fixed-height regions |

This session builds it in a `seazn.club` worktree, deployed to staging before the phone's exit bar (ruling 72).

### 7.3 Engine changes (ruling 71)

In `seazn.club.engine`, released as a version both the web and the phone take:

1. **Exports**: the wide and no-ball dismissal sets (into `cricketPadRules`, beside `freeHitDismissalKinds`) and
   `orderFromLineup`, so the phone offers exactly the engine's kinds and orders a lineup exactly as the server does.
2. **A mid-over bowler change**: today a second bowler in an over in progress is refused (1512-1517) and no event names
   the change. The engine designs the event (Law 17.8: the over is completed by another bowler, who may not have bowled
   the previous over or bowl the next).
3. **A hand strike swap**: today a ball whose `striker`/`nonStriker` differ from the fold's pair is refused (1524-1542).
   The engine designs how a swap is recorded, so the phone can offer "tap a batter to swap".

What each costs (engine recon, 2026-11-07; engine `AGENTS.md` "Releasing", `src/sport/fold-epoch.ts:5-25`,
`rules/README.md`, `src/testkit/GOLDEN-POLICY.md`):

| Change | Kind | Why |
| --- | --- | --- |
| 1. Exports | additive, minor release | two fields on `CricketPadRules` (`pad/types.ts:62-67`), `orderFromLineup` into `sports/cricket/index.ts`; already inside the phone subpaths, so no closure re-pin; proved like CK-FH-1 (`pad/cricket.test.ts:242, 289`) under rows CK-NB-1 and CK-WD-1 |
| 2. Mid-over change | **fold epoch bump** (major) | the fold holds one `currentBowler` and one `prevOverBowler` (`cricket.ts:481-482, 1742`), and the scorecard gives an over one bowler (`scorecard-types.ts:47-50`). It needs an explicit event or flag, never "credit whoever is named", which would re-credit stored ledgers. A cricket epoch bump makes the web refuse cricket writes from older clients (`scoring.ts:804`, 426); no phone scores cricket yet, so this costs the phone nothing |
| 3. Strike swap | additive if it accepts exactly the reversed pair | on replay the ledger's pair is already adopted (`cricket.ts:1546-1547`), so old engines fold it the same; the strict check (1524-1548) is a rule, pinned by `cricket.test.ts:194` and DOMAIN.md:79, so it needs an engine ruling and a rules row. A separate swap event would be a bump |

The web pad changes with them: `cricket.tsx` `bowlerIsReadOnly` (287-292), `bowlerBlockReason` (728-734),
`creaseEndLocked` (293-299), and a wide/no-ball narrowing beside 2268. The scorecard's readers (`overlay-cricket.ts:96`,
`match-centre.ts`, `appearances.ts`) change only for 2.

The phone takes the release (the S2-2 path: ruling 53). The web takes it too, and the web pad's fixes use the same
changes. The engine's own rules and owner rulings govern the change. Until it ships, the phone falls back to a trial
fold for the dismissal kinds, and offers neither the mid-over change nor the swap.

## 8. Exit bar

As S2 §10, on a real cricket match on staging, plus:

1. Setup: toss with team names, a reordered batting order, openers and first bowler; the console agrees.
2. Every ball kind: dot, 1–6, a 4 and a 6 as boundaries, a wide with runs, a no-ball with runs off the bat and the free
   hit after it, a bye, a leg-bye.
3. Every wicket path: bowled, caught (fielder), LBW, stumped (keeper only), run out (who, fielder, runs completed), a
   wicket off a wide and off a free hit (run out only).
4. Over end: the next-bowler sheet with a greyed "Bowled the last over" and an "Out of overs".
5. Innings break card with the target; the chase; the result.
6. A tie in a knockout → super over → result, with no Next batter on its second wicket.
7. Undo across a wicket, an over end and an innings break.
8. More: a retirement, penalty runs, an interruption and a revised target, as the console shows them.
9. Players not entered: the card and over totals; the console shows the totals.
10. A full 20-over innings: the pad stays responsive (the fold on Hermes).
11. 320 dp in the longest locale with the longest names.

## 9. Evidence: the web pad on staging

The owner's Pro trial org, competition "Cricket S2-4 Test", division t20-test, played by the controller on 2026-11-07.
f/1 (league, 2 overs, max 1 per bowler, 5 a side) ended tied 25/3 v 25 all out with no super over (a league's default is
off). f/2 (knockout final, 1 over, super over on) was 0/0 v 0/0, super over 7–6. The owner finalized f/2 afterwards.
What works: runs in one tap, the free hit after a no-ball, the last-over bowler greyed, the innings and match ending by
themselves, all out at players − 1, Take back reopening a decided match, the super over on a knockout tie. The gaps are
§7.2's.

## 10. CricHeroes, as a reference

From its own videos and blog (not from use). Taken: an extra is its kind then its runs in one step; a guided run out (who,
fielder, runs, next batter); a next-bowler prompt at over end with strike swapped automatically; undo of the last ball.
Left out: a wagon wheel on every run; logins per player; ads near the pad; online-first scoring with no visible queue
(its top complaint; ours has the durable queue and the send badge); adding players mid-match (needs a web change; ruling
66 instead). Editing an older ball, not just the last, is open (§11).

## 11. Open for the owner

1. **Extras**: the sheet of §4.2 (A), or the extra lit then a run key (B). The preview shows A; the owner judges it there.
2. **Editing an older ball** (CricHeroes has it; ours is Undo of the last only).
3. **Timed out** without a phantom ball, and a **fielding-side penalty**: not chosen for the engine change (ruling 71);
   the phone offers neither.
4. **No eligible bowler** (§4.4): say so and offer over totals for the rest of the innings (_the controller's_).

Settled 2026-11-07: who builds the web fixes (ruling 72), the engine changes (71), a run 4 or 6 (73), a tie with no
players (74).

## 12. Left to the builder

File and function names beyond §6; the fake's shape; test layout. Anything that changes what the scorer sees comes back
to the owner.
