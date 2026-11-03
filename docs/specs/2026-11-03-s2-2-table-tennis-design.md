# S2-2 — Remote Scoring, table tennis: design

Status: **approved by the owner, 2026-11-03** ("approve"). Brainstormed in the session of 2026-11-03.

This design adds table tennis to Remote Scoring. It argues from the S2 design
(`docs/specs/2026-11-01-s2-remote-scoring-design.md`, "the S2 design" below), whose rulings 1–47 and
whose sections §4 to §9 hold for table tennis unless a line here says otherwise. Rulings here continue
the S2 numbering at 48. A ruling is the owner's unless marked _the controller's_; everything marked
_the controller's_ is open to the owner's correction while reading.

## 1. Intent

An umpire or volunteer at a table tennis table scores one match on their own phone, exactly as a
badminton scorer does today: scan the match's scoring link, check it is the right match, say who
serves first, tap the side that won each point. The pad shows what an ITTF umpire tracks that badminton
does not: whose serve it is and whether it is the first or second of the pair, deuce, the expedite
system, one timeout per side, and the two cards. The organiser's console, the scorebug and the
browser pad see the same match.

The web pad (`apps/web/src/components/v2/scorepad/v3/skins/tabletennis.tsx`, web `9fbfd4c7a8`) does
all of this; the phone matches it (ruling 48), with the differences §4 names: the Start pick and a
"Who is serving?" tool only when needed, in place of the web's anchor tile (rulings 49, 51); 13
returns chosen before the point, not after (ruling 50); and the tools row with a More sheet (ruling
52).

Success: a real table tennis match on staging, scored on the owner's OnePlus from the first serve to the
organiser's final, with the console agreeing point for point (§8).

## 2. Goals, non-goals, anti-goals

**Goals**

- Table tennis scored point by point, singles and doubles, with the serve, the expedite system, the
  timeouts and the cards the web pad records (ruling 48; S2 ruling 4, band 3 always).
- A second sport behind the S2-1 runtime with nothing generic changed for it: a module behind
  `ScoringSport`, a row in `sports.ts`, its own screen (S2 ruling 38). If something generic must change,
  that is a finding to record, not a quiet edit.
- Every S2-1 behaviour that is not badminton's holds for table tennis unchanged: the durable queue,
  sync, the reconnect question, Realtime, History, Undo and its 45 s window on the result, the send
  badge, the Continue and Finished cards, the Update needed path.

**Non-goals**

- No doubles "which player won it" step (S2 ruling 5). The web's scorer chips are not ported.
- No serve-anchor tile (ruling 49 replaces it with the Start screen's pick).
- No enforcement of expedite's 10-minute trigger: the umpire decides when to start it, as on the web.
- No engine change and no engine bump: `@seazn/engine` 1.1.0 already has the `tabletennis` kernel and
  `tabletennisPadRules` inside the phone's subpaths (`phone-subpaths.json`). Engine 2.0 (the Swiss
  work, unreleased) does not touch table tennis and is not taken.
- No change to badminton's screen or behaviour.

**Anti-goals**

- A serve shown that the engine did not name. The plate shows the engine's server or none, never a
  guess (the badminton rule, `badmintonEvents.ts` `rallyEvent`).
- A 13-returns point that credits the server. The engine refuses it (`EXPEDITE_WRONG_WINNER`); the pad
  never offers it.
- Table tennis conditions inside a shared component. A shared part takes props; the sport decides.

## 3. The owner's rulings (S2-2)

| #   | Ruling                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 48  | The table tennis pad matches the web pad: points, the serve, Expedite, yellow and red cards ("C", 2026-11-03), not a points-only pad.                                                               |
| 49  | Start match asks who serves first, as badminton does; there is no separate serve-anchor tile ("yes", 2026-11-03).                                                                                   |
| 50  | While Expedite is on, one tool, "13 returns · {receiver}", gives the receiver the point and records the 13 returns ("Yes Ok", 2026-11-03).                                                          |
| 51  | If the engine cannot name the server (the Start pick was lost), a "Who is serving?" tool appears once; the next point carries the answer, and the tool goes for the match ("Ask once", 2026-11-03). |
| 52  | The tools row: Card for each side, one tap each, as badminton; Timeout, Expedite and Set score in a More sheet; 13 returns joins the row while Expedite is on ("Cards + More", 2026-11-03).         |

## 4. How a scorer meets it

As the S2 design §4, with these differences.

1. **Start.** Match details with table tennis's rules (§5.4), "Who serves first?", Start match. The
   pick goes out as `serving` on the match's first rally, as badminton's does (`rallyEvent`,
   `payloadForSend`: the first send drops it if a rally already stands). One pick carries the whole
   match: the engine alternates the first server game by game (ITTF 2.13.6,
   `serve.setStart: "alternate"`). **Unlike badminton, a lost pick does not mend itself**: table
   tennis's rotation never recovers from later rallies, so without an anchor the engine names no
   server for the rest of the match (web `tabletennis.tsx:36-52`, `believedServer`). The pick is lost
   when a co-scorer's rally lands first, or when the first game was entered with Set score.
2. **Who is serving? (ruling 51).** Only while the engine says the server is unknown for want of an
   anchor (`setBasedServeContext` `side === null`, and `unknownBecause` is not a drift value), the
   tools row shows "Who is serving?". It opens a two-button sheet (the sides, as the Start screen's
   `TossPicker`); the answer is held for the next point tapped, which carries it as `serving`, as the
   web's anchor tile records it. Once the engine names a server the tool is gone; it does not come back
   unless the anchor is lost again (an Undo of the anchoring point). The held answer is in memory only,
   and the pad says "Next point: {side} serving" on the last-tap line until it is used (_the
   controller's_ wording). Before the match's first point the Start pick does this job, so the tool
   never shows on a match this phone started.
3. **Score.** Tap the half of the side that won the point. The serving plate and the lime bar follow
   the engine: two serves each, one each from 10–10 (from one short of the game's target), one each
   for the rest of the match once Expedite is on.
4. **Expedite** (in More). Records `tabletennis.expedite.start {}`. Offered while the match is live,
   the match's own `cfg.records.expedite` is on, Expedite is not already in force, and not both sides
   have `expediteScoreFloor` (9) or more in the open game: the web's rule (`tabletennis.tsx:298-303,
801-806`). From then on the strip says "Expedite" for the rest of the match, the serve changes
   every point, and the 13 returns tool shows (ruling 50).
5. **13 returns.** One tap gives the point to the side receiving now and records `returns: 13`. It
   shows only while Expedite is on and the engine names the server, and it credits the receiver only
   (`expediteReturnsCreditable(serving, receiver)` true), so it can never credit the server. It does
   **not** carry `serving`, as the web's dock does not (`tabletennis.tsx:523-535, 1020-1024`): a stamp
   of the engine's own belief would make the engine's drift check check itself, and a stale one (a
   co-scorer's point landing first) would be refused as `EXPEDITE_WRONG_WINNER`. The engine counts
   such a rally as unchecked; the pad's own gate is the check (_the controller's_, following the
   web). It is a rally like any other for Undo, History, the queue and the bounce guard. **Difference
   from the web:** the web adds the returns after the point, in its rally dock; the phone sends each
   tap at once, so the reason is chosen before the tap, by tapping this tool instead of the half.
6. **Timeout** (in More, one per side). Records `tabletennis.timeout {by}`. Always offered while live
   and `cfg.records.timeouts` is on: the engine accepts any number and the web never disables it
   (`kernel.js:545-551`; `tabletennis.tsx:752-764`). ITTF's one per match is the umpire's to keep
   (_the controller's_, following the web).
7. **Cards.** Yellow (`warning`) and red (`penalty`), from `tabletennisPadRules.sanctionLevels`, never
   a list of our own. The level, then the player only if the side has more than one; a side with one
   player is stamped automatically; a side with no named player sends `{by, level}` by the side
   (S2-1 learning: a team named only). There is no ending step: table tennis declares no sanction
   ending, so the ending prompt never shows. A red card's point is not added by the engine; the
   umpire taps it as a point, as on the paper sheet (`kernel.ts`, "NONE of these touches the score").
   Offered only while `cfg.records.sanctions` is on.
8. **Set score** (in More). As badminton's: before a game's first point, `tabletennis.game.summary {home, away}`
   with steppers from 0 to `scoreBound(cfg)`.

## 5. The screen

`TableTennisPadScreen`, its own screen over the shared kit (S2 ruling 38), laid out as badminton's:
top bar, strip, two halves, last-tap line, tools. What differs:

### 5.1 Halves

- **Serving plate**: "SERVING · 1st" or "SERVING · 2nd", the engine's `serveNumber` as the engine
  sets it, where badminton says the service court. At deuce and under Expedite the engine sets 1, so
  the plate says "1st", as the web's does (`kernel.js:640-643, 989-995`); the pad does no serve
  arithmetic of its own. No `serveNumber` → "SERVING" alone.
- **Doubles**: the plate names the serving player when the engine names one (`serverPersonId`, from the
  team sheet's `pairOrder`, which the bootstrap carries as `lineup[].pairOrder`). With no pair order it
  names the side only, as the web does. **This needs a fix first**: the phone's `lineupOf`
  (`badmintonEngine.ts:24-33`) puts `pairOrder` into `orderNo` and never sets the lineup's own
  `pairOrder`, so the engine's pair order comes back empty (`squad-state.js:75-77`) and no doubles
  server is ever named. The plan builds the lineup exactly as the web's server-side fold does (read it,
  don't infer it), so the phone and the console name the same server, and proves badminton's fold is
  unchanged by it.
- A doubles rally carries `server` (the person) when the engine names one, as the web's does
  (`tabletennis.tsx:510, 536`); badminton keeps sending it for singles only.
- The lime bar is on the serving side (`PadHalf.bar`), none before the match or once it is decided.

### 5.2 Strip

"Game N of M" at the left (M = `tabletennisPadRules.bestOf(cfg)`), and at the right one note, in this
order of precedence: "Expedite" (in force, match-wide), else "Deuce" (`deuceNote`), else nothing.
This takes badminton's interval slot; table tennis's breaks are not shown (_the controller's_: the web
does not show them either).

### 5.3 Tools

Ruling 52. One row, `ToolRow` as it is, at most four cells:

| Cell                    | When                                             | Opens / does          |
| ----------------------- | ------------------------------------------------ | --------------------- |
| Card · {top}            | live, `records.sanctions`                        | the card steps (§4.7) |
| Card · {bottom}         | live, `records.sanctions`                        | the card steps        |
| 13 returns · {receiver} | Expedite in force, server known (ruling 50)      | the point, at once    |
| Who is serving?         | server unknown for want of an anchor (ruling 51) | the two-side sheet    |
| More                    | live, and the sheet has at least one item        | the More sheet        |

13 returns and Who is serving? never show together (one needs the server known, the other unknown).
The **More sheet** (a `StepSheet`, one cover at a time, Back closes it): Timeout · {top}, Timeout ·
{bottom}, Expedite, Set score, each listed only when §4 offers it. A More with nothing in it is not
drawn (_the controller's_). Choosing an item records it (Timeout, Expedite) or opens its own sheet
(Set score) in place of More's.

### 5.4 Match details

The match card's rules rows for table tennis, from the fixture's `cfg` and `tabletennisPadRules`:
Format ("Best of 5"), Points ("11, win by 2"), Expedite ("After 10 minutes"), Timeouts ("One each").
_The controller's_ wording; the plan's fit and copy tasks settle it. The hardbat variant (games to 21)
reads from `cfg`, never a constant.

## 6. The app's side

- **Module set**, mirroring badminton's: `tableTennisPad.ts` (the display and the pad view),
  `tableTennisFold.ts` (the engine's fold, `memoFold`), `tableTennisEvents.ts` (tap → event, payload for
  send), `tableTennisRules.ts` (match card rows), `tableTennisSanction.ts` (the two-step card),
  `tableTennisHistory.ts` (the words for its event types), `tableTennisSport.ts` (the `ScoringSport`),
  a row in `sports.ts`, and `TableTennisPadScreen.tsx`. Names are the builder's; the split is the
  rule: generic files never import a sport's (lint `SPORT_MODULES`).
- **What is copied, what is shared.** Where a badminton module and its table tennis twin would be the
  same code (the toss on the first rally, the sole player of a side, the set score steppers), the
  builder lifts it into a set-based shared module once, with badminton moved onto it and its tests
  still green, rather than copying it. Lifting is allowed; changing badminton's behaviour is not.
- **The serve** comes from the engine's `setBasedServeContext(tabletennis, …)` (the web's
  `serveContextOf`), never from our arithmetic. Its `unknownBecause` values that mean drift
  (`recorded-disagrees`, `ledger-mismatch`) show no server, as the web does.
- **Rules version and epoch**: the version from the bootstrap and the rules read (S2 §6.3, "the default
  is 0"); the epoch `foldEpochOf('tabletennis')`. Never a constant (S2-1 learning: build 778).
- **History words** for `tabletennis.rally` (with 13 returns said), `.timeout`, `.sanction`,
  `.expedite.start`, `.game.summary`, plus the core events, in the four dictionaries and the glossary.
- **Fit**: `padFit.test.ts` gains table tennis cases for every new string at 320 and 360 dp, en/es/fr/nl,
  singles and doubles.
- **Fake**: a `fakeTableTennisPad` (or a sport parameter on the existing fake) so every state renders
  on a laptop (AGENTS §10).

## 7. Web side

Nothing new is expected: the bootstrap endpoint, events and rules calls are sport-agnostic. The plan's
first task checks on staging that a table tennis fixture's bootstrap folds (S2-1 learning: old
badminton divisions crashed the server's fold until web #1116) and that a `tabletennis.rally` with
`serving` and with `returns: 13` is accepted. A refusal there is a web finding for the w3 session, not a
phone workaround.

## 8. Exit bar

As S2 §10, on a table tennis match, plus:

1. Singles: toss → serve alternates every two points → deuce at 10–10 → one serve each → game won;
   the next game opens with the other side serving.
2. Doubles with a team sheet pair order: the plate names the right server through a game; without
   one, the plate names the side.
3. Expedite started mid-game: the strip says so, the serve changes each point, a 13 returns point is
   recorded, the console shows it.
4. A timeout each side; a yellow and a red card; Set score before a first point.
5. Undo across each of the above, including a 13 returns point and the expedite start.
6. 320 dp in the longest locale for the pad with the most tools showing.

7. A lost anchor: a browser co-scorer taps the match's first point before the phone's lands; the
   phone shows Who is serving?, the answer rides the next point, and the plate is right from then on.

## 9. Open for the owner

Nothing open. Rulings 51 and 52 answered the builder check's two questions (2026-11-03).

## 10. Left to the builder

File and function names beyond §6; whether the shared set-based code is one module or several; the
fake's shape; test layout. Anything that changes what the scorer sees comes back to the owner.
