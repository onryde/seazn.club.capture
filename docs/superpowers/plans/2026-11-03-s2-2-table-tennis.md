# S2-2 Remote Scoring (table tennis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A volunteer scans a table tennis match's scoring link and scores it, singles or doubles,
with the serve, Expedite, 13 returns, timeouts and the two cards, to the organiser's final on staging.

**Architecture:** A second sport behind the S2-1 runtime's `ScoringSport` port: a table tennis module
set in `src/domain/scoring/` folding through `@seazn/engine`'s `tabletennis` kernel, a row in
`sports.ts` and `scoringScreens.ts`, and its own screen over the shared kit. Code that badminton and
table tennis would share word for word is lifted once into set-based shared modules; nothing generic
learns a sport's name.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / Hermes; `@seazn/engine` = `@onryde/seazn-engine`
2.0.0 (`tabletennis`, `tabletennisPadRules`, `setBasedServeContext`); vitest on react-native-web.

**Spec:** `docs/specs/2026-11-03-s2-2-table-tennis-design.md` (approved 2026-11-03, rulings 48–52),
on top of `docs/specs/2026-11-01-s2-remote-scoring-design.md`. Read both; this plan argues from them.

## Global Constraints

- AGENTS.md in full: §3 layering (lint), §4 one parser per wire shape, no `any`, §5 tokens only, §8 memo
  and no anonymous functions in render on the pad, §10 the four questions, mutate every guard once, no
  expected value derived from the code under test, §12 functions 10–25 lines, JSX ≤ 3 deep.
- Engine is `@onryde/seazn-engine` 2.0.0 (ruling 53). The phone's subpaths are unchanged from 1.1.0, and no 2.0
  API (Swiss, scheduling) is used.
- Sport key `'tabletennis'`; epoch `foldEpochOf('tabletennis')` (2 at 2.0.0), never a literal. Rules
  version from the bootstrap and the rules read only (S2 §6.3, default 0).
- Rule facts from `tabletennisPadRules` and the folded `cfg` (bestOf, setTo, scoreBound, deuceNote,
  expediteScoreFloor 9, expediteReturns 13, expediteReturnsCreditable, sanctionLevels
  `['warning','penalty']`). No rule number typed in our code.
- The serve, its number and the doubles server come from `setBasedServeContext(tabletennis, …)` only.
- Event types: `core.start`, `tabletennis.rally {wonBy, serving?, server?, scorer?, returns?}`,
  `tabletennis.timeout {by}`, `tabletennis.expedite.start {}`, `tabletennis.sanction {by, level,
person?}`, `tabletennis.game.summary {home, away, partial: true}`, `core.void {event_id}`. Never
  `core.forfeit`, `core.settle` or `core.abandon` from this pad.
- Lint: generic files never import a table tennis file. Add `**/*tableTennis*`, `**/*TableTennis*` and
  the table tennis sheets hook to `SPORT_MODULES` and `SPORT_OWN_FILES` (`eslint.config.mjs:107-111,
145-150`); `test/sportBoundary.test.ts` proves it.
- Copy: keys under `scoring.tabletennis.*` in en/es/fr/nl and `docs/i18n-glossary.md`. No red outside
  ON AIR. Translations are the controller's until a native reader checks them.
- Checks (owner, 2026-11-02): vitest on the touched files with `--reporter=json --outputFile=<scratch>`,
  read `numTotalTests`; eslint and prettier on changed files; `pnpm tsc --noEmit`. The full
  `pnpm check` runs in the draft PR's CI.
- Subagents: Sonnet implementer and Sonnet reviewer per task; a fix round is re-checked by resuming the
  same reviewer; Opus reviews each batch, the whole branch, and Task 2 (engine-facing).
- No `eas build`, `eas submit`, `eas update`. Local Gradle + adb, dev twin, from a clean worktree.

## Review Focus

1. **The anchor stamped twice.** The Start pick's first rally is queued offline; a browser co-scorer
   meanwhile taps the web's anchor tile. On send, the phone's `serving` must be dropped (an anchor
   already stands), or the engine reads `recorded-disagrees` and blanks the serve. Test: Task 4
   `payloadForSend drops serving when a standing rally already carries it`.
2. **Undo of the anchoring point.** Undoing the one rally that carries `serving` loses the anchor:
   the plate goes blank and Who is serving? comes back, never a stale server. Test: Task 3
   `undoing the anchor rally needs the anchor again`.
3. **13 returns offered on a stale serve.** Expedite on, the phone offline, a co-scorer's point lands
   and the server changes: the tool's receiver must follow the folded server, and a tap queued under
   the old receiver that the engine now refuses is dropped and said, as any illegal tap. Test: Task 3
   `legalQueued drops a returns rally that credits the server`.
4. **Doubles without pair order.** A doubles side whose `lineup[].pairOrder` is null: the plate names
   the side, never a guessed player, and no `server` is sent. Test: Task 3 and Task 4 doubles cases.
5. **A hardbat match (games to 21).** Deuce at 20–20, Set score's bound `scoreBound(cfg)`, "11" never
   shown. Test: Task 5 `hardbat cfg reads 21 everywhere`.

---

## Batch A — groundwork

### Task 1: Staging takes table tennis (controller, with the owner)

Not code. Needs a staging table tennis fixture with a scoring link, singles and doubles (the doubles
one with `pair_order` on its team sheet). The owner or the w3 session provides them; the token is never
printed (read it into a shell variable from the clipboard; mask it in any log).

- [ ] **Step 1:** `GET /api/v1/score/{token}` for each: answers 200, `sport_key` `tabletennis`, a `cfg`,
      doubles `lineup[].pair_order` set.
- [ ] **Step 2:** With the owner's go in the session, on a throwaway fixture only (never one the owner will use for the exit bar), POST
      `core.start`, a `tabletennis.rally` with `serving`, `tabletennis.expedite.start`, a rally with
      `returns: 13` crediting the receiver, a `tabletennis.timeout`, a `tabletennis.sanction` with no
      `person`, then void each. Each answers 201.
- [ ] **Step 3:** Record the answers in the results doc (Task 10). A 500 or a refusal is a web finding
      sent to w3, and the batch waits. Also send w3 the server-fold gap found in planning: the server's
      `loadLineupPair` (`apps/web/src/server/engine-db/lineups.ts:44-77`) never sets `pairOrder`, so
      the server's fold names no doubles server while the browser pad's does (`registry.tsx:93`).

### Task 2: Set-based shared modules, and the pair order fix

**Files:**

- Create: `src/domain/scoring/setBasedEngine.ts` (+ test): `lineupOf`, `envelopeOf`,
  `queuedEnvelopeOf`, `queuedEventId` moved from `badmintonEngine.ts`
- Create: `src/domain/scoring/setBasedSides.ts` (+ test): `seatsOf`, `soleOf`, `sideNames`, `scoreText`
  moved from `badmintonEvents.ts` / `badmintonPad.ts`
- Modify: `badmintonEngine.ts` (keeps `badmintonCfg`, `refusalOf`, `BadmintonEngineMatch`),
  `badmintonEvents.ts`, `badmintonPad.ts`, `badmintonFold.ts` and every importer to use the moved names

**Interfaces:**

- Produces: `lineupOf(side: BootstrapSide): LineupPair['home']`, now
  `slots[i] = {personId, slot: 'starting', orderNo: pairOrder ?? i + 1, ...(pairOrder === null ? {} :
{pairOrder})}`, the browser pad's `toLineupSlot` (web `registry.tsx:50-58, 93`); `seatsOf(bootstrap):
Seats | null`; `soleOf(seat): string | null`; `sideNames(side): string`; `scoreText({first, second}):
string`. Signatures unchanged from today's.

- [ ] **Step 1: Failing tests.** `lineupOf sets pairOrder from the lineup` (a doubles side with
      pair orders 2, 1 → slots carry `pairOrder: 2` and `1`); `lineupOf leaves pairOrder out when null`;
      `the engine names the doubles server from pair order` (fold `tabletennis` with a doubles cfg, start,
      one rally with `serving: home`; `setBasedServeContext(...).serverPersonId` is the home player with
      pair order 1).
- [ ] **Step 2:** Run; the pair order tests fail.
- [ ] **Step 3:** Move the functions; add `pairOrder`. No behaviour change for badminton.
- [ ] **Step 4:** Badminton's suites green unchanged: `badmintonEngine`, `badmintonFold`,
      `badmintonEvents`, `badmintonPad`, `badmintonSport`, `BadmintonPadScreen` (run that one alone:
      it times out under load). Read `numTotalTests` before and after: equal plus the new tests.
- [ ] **Step 5:** Mutate: drop the `pairOrder` spread → the engine test fails. Commit.

## Batch B — table tennis in the domain

### Task 3: The fold and the display

**Files:**

- Create: `src/domain/scoring/tableTennisEngine.ts` (`tableTennisCfg(raw)`, `tableTennisRefusalOf`),
  `tableTennisPad.ts` (types only in this task), `tableTennisFold.ts` (+ tests)
- Create: `test/tableTennisLedger.ts`: HOME/AWAY, SINGLES and DOUBLES bootstraps (`sportKey:
'tabletennis'`, doubles with pair orders), builders `start`, `rally({wonBy, serving?, returns?})`,
  `timeout`, `expedite`, `sanction`, `summary`, `voiding`, `ledgerOf`, `queuedOf`, `GAME_ONE_11_7`,
  `DEUCE_10_10`, `DECIDED_3_0`

**Interfaces:**

- Produces in `tableTennisPad.ts`:
  - `TableTennisTap = {kind:'start'; server: PadSide} | {kind:'rally'; side: PadSide; serving: PadSide |
null} | {kind:'returns'; side: PadSide} | {kind:'timeout'; side: PadSide} | {kind:'expedite'} |
{kind:'sanction'; side: PadSide; level: 'warning'|'penalty'; person: string | null} |
{kind:'setScore'; first: number; second: number}`. `rally.serving` is the held Who is serving?
    answer, else null.
  - `TableTennisDisplay = {sides, context, points: {first, second}, finished: readonly {points,
winner: PadSide}[], game: number, rules: TableTennisRules, phase: TableTennisPhase ('notStarted'|'pre'|'live'|
'betweenGames'|'decided', badminton's values in a type of its own), server: PadSide | null, serverPerson: string |
null, serveNumber: 1 | 2 | null, serverPicked: boolean, anchorNeeded: boolean, expedite:
'off'|'offered'|'inForce', deuce: boolean, records: {timeouts, sanctions, expedite: boolean},
lastTap, undoable}`; `TableTennisRules = {bestOf, setTo, finalSetTo, winBy, scoreBound}`.
- Produces in `tableTennisFold.ts`: `foldTableTennis(input: SportFoldInput):
SportFold<TableTennisTypes>` (`folded {display, legalQueued, history}` | `unfoldable`), `undoneTap`.
- Rules: `server`/`serveNumber`/`serverPerson` from `setBasedServeContext`; before the first point the
  Start pick shows (`serverPicked`, badminton's `pickedServer` rule: live, engine `undeclared`, every
  game 0–0). `anchorNeeded` = live, `side === null`, a rally stands, and `unknownBecause` is neither
  `recorded-disagrees` nor `ledger-mismatch`. `expedite` `offered` = live, `cfg.records.expedite`, not in
  force, not both ≥ `expediteScoreFloor` in the open game. `deuce` = `deuceNote(state, cfg) !== null`.
  `legalQueued` as badminton's (one strict fold per queued tap, an illegal one skipped and the rest
  still judged).

- [ ] **Step 1: Failing tests**, values from the ITTF rules and the design, never from the fold:
      `serve alternates every two points` (start pick home; after 0–0, 1–0: home 1st, 2nd; at 1–1 away 1st);
      `deuce: one serve each from 10–10` (serveNumber 1 and the server alternating at 10–10, 11–10 and
      11–11; `deuce` true at 10–10); `the next game opens with the other side serving`;
      `expedite in force: serve changes every point, for the rest of the match`; `expedite not offered at
9–9` and `offered at 9–8`; `expedite not offered when cfg.records.expedite is false`;
      `doubles names the server by pair order`; `doubles without pair order names the side only`
      (`serverPerson` null); `a co-scorer's first rally without serving leaves anchorNeeded`;
      `undoing the anchor rally needs the anchor again`; `legalQueued drops a returns rally that credits
the server`; `a sanction with no person folds`; `hardbat cfg: deuce at 20–20`.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass; mutate the 9-floor guard and the
      drift-value guard once each. **Step 5:** Commit.

### Task 4: Taps as events

**Files:** Create `src/domain/scoring/tableTennisEvents.ts` (+ test).

**Interfaces:**

- Consumes: Task 2's `seatsOf`, `soleOf`; Task 3's types.
- Produces: `tableTennisEventFor(tap: TableTennisTap, ctx: {bootstrap, display}): SportEvent | null`;
  `tableTennisPayloadForSend(queued: QueuedEvent, ledger: readonly LedgerEvent[]): unknown`.
- Rally: `serving` = `tap.serving ?? (display.serverPicked ? display.server : null)` as an entrant id;
  `server` = the engine's `serverPerson` (singles: the sole player; doubles: only when named) and never
  while `serverPicked`; `scorer` only for a singles winner. Returns: `{wonBy: receiver, returns:
tabletennisPadRules.expediteReturns}`, no `serving`, null unless `expedite === 'inForce'`, the server
  known and `expediteReturnsCreditable(server, side)`. Sanction: `person` omitted when null.
- `payloadForSend`: a tap with attempts keeps its payload; otherwise `serving` is dropped only when the
  ledger already holds a standing (unvoided) `tabletennis.rally` carrying `serving`. Unlike badminton,
  a later rally's `serving` is kept: it is table tennis's only anchor (design §4.2).

- [ ] **Step 1: Failing tests:** each tap's exact type and payload; `returns is null for the server`;
      `returns is null while expedite is off`; `doubles rally without pair order sends no server`;
      `a held serving rides the rally`; `payloadForSend keeps serving when no anchor stands`;
      `payloadForSend drops serving when a standing rally already carries it`; `a voided anchor does not
count`; `a retried tap keeps its payload`; `null when a seat is empty`; `never core.forfeit`.
- [ ] **Step 2–5:** Fail, implement, pass, mutate the "standing" check, commit.

### Task 5: The pad view, the rules rows and the copy

**Files:** Modify `tableTennisPad.ts` (the view); create `tableTennisRules.ts` (+ tests); modify
`src/i18n/{en,es,fr,nl}.json`, `docs/i18n-glossary.md`.

**Interfaces:**

- Produces: `tableTennisPad(display, sync = SYNCED): PadView<TableTennisPadKey>`;
  `parseTableTennisTool(id): {card: PadSide} | {returns: true} | {serving: true} | {more: true} | null`;
  `tableTennisMoreItems(display): readonly ('timeout.first'|'timeout.second'|'expedite'|'setScore')[]`;
  `withHeldServing(view, held: PadSide | null, display): PadView` (the last-tap line "Next point:
  {side} serving" while held); `tableTennisRuleRows(rules, cfg): PadRuleRow[]` (Format, Points,
  Expedite, Timeouts; design §5.4).
- Halves: `serving.shown` "Serving · 1st" / "Serving · 2nd", "Serving" with no number; in doubles the
  named player in the half's `sub`. Strip slots `game` ("Game N of M") and `note` ("Expedite" > "Deuce" >
  null). Tools in order: `card.first`, `card.second`, then `returns` or `serving` (never both), then
  `more` (absent when `tableTennisMoreItems` is empty). Ruling 52's table is the acceptance table.

- [ ] **Step 1: Failing tests:** one per row of design §5.3's table (shown and hidden); the plate's three
      wordings; the strip's precedence; `hardbat cfg reads 21 everywhere`; rule rows for bo5, bo7, hardbat;
      `withHeldServing` says the held side and leaves the rest of the view equal.
- [ ] **Step 2:** Copy: every new key in four languages, glossary rows dated 2026-11-03.
- [ ] **Step 3–5:** Implement, pass (plus `src/i18n` key-parity tests), commit.

### Task 6: Cards, History and the sport module

**Files:** Create `tableTennisSanction.ts`, `tableTennisHistory.ts` (+ tests), `tableTennisSport.ts`
(+ test); modify `sports.ts`, `eslint.config.mjs`, `test/sportBoundary.test.ts`.

**Interfaces:**

- Produces: `startCard(side)`, `chooseCard(step, choice, sides): CardMove`, `cardSheet(step, sides)`:
  level (warning, penalty from `sanctionLevels`), then person only if the side has more than one
  player; no confirm step. `tableTennisLedgerHistory(...)` with words for each event type, 13 returns
  said on its rally. `tableTennisSport: ScoringSport<TableTennisTypes>`: `key 'tabletennis'`, `fold
memoFold(foldTableTennis)`, `tossOf` (start only), `awaitingEnding` always false, `resultLine` "11–7,
  11–9, 11–5" style.

- [ ] **Step 1: Failing tests:** `a side with one player skips the person step`; `a side with no
players records by side`; `two levels only`; History rows for each type in en and nl;
      `sportFor('tabletennis')` is the module; boundary test: a generic file importing
      `tableTennisPad` fails lint.
- [ ] **Step 2–5:** Fail, implement, pass, commit. **Batch B Opus review** after this task.

## Batch C — the screen

### Task 7: The fake, the match hook and the sheets

**Files:**

- Create: `src/services/fakeTableTennisPad.ts` (+ test), `src/hooks/useTableTennisMatch.ts`,
  `src/hooks/useTableTennisSheets.ts` (+ tests)
- Modify: `src/services/fakeScoringPort.ts` (a `sport` seed field, default badminton: it folds with the
  sport's module and answers its `sportKey`), `test/fakePorts.ts`

**Interfaces:**

- Produces: `useTableTennisMatch(fixtureId): TableTennisPadModel` = `PadScreenModel & {toss, actions:
{choose, saveScore, pickServer, start, pickServing, sendTaps, askDiscard, confirmDiscard}}`, built on
  `useScoringMatch(id, tableTennisSport, …)` as `useBadmintonMatch` is. It holds `held: PadSide | null`
  in memory: set by Who is serving?, cleared once a rally is queued, on Undo, and when `anchorNeeded`
  turns false; applied with `withHeldServing`. `useTableTennisSheets`: sheets `card`, `more`, `serving`,
  `setScore`, `details`, `history`, `ask`, `discard`; More's items record at once (timeout, expedite)
  or open Set score.

- [ ] **Step 1: Failing tests** through the fake port: `More records a timeout`; `More hides Expedite
once in force`; `Who is serving? holds the side and the next rally carries it` (the queued
      payload has `serving`); `held is cleared by Undo`; `a second tap on Who is serving? changes the held
side`; `the bounce guard holds a 13 returns tap`; `badminton's fake port answers unchanged`.
- [ ] **Step 2–5:** Fail, implement, pass, commit.

### Task 8: The screen, the route and the fit

**Files:** Create `src/ui/screens/TableTennisPadScreen.tsx`, `TableTennisMatchScreen.tsx` (+ tests);
modify `src/ui/screens/scoringScreens.ts` (a `tabletennis` row), `src/ui/theme/padFit.test.ts`.

- Lays out the kit as `BadmintonPadScreen` does; its own sheet switch (`StepSheet` for card, More and
  Who is serving?; `ScoreEntrySheet` bounded by `scoreBound`). No `EndingPrompt`.
- `padFit.test.ts`: `toolText` takes the cell count (`toolTextOf(cells)`; badminton's stays 3, table
  tennis 4); cases for every `scoring.tabletennis.*` tool, plate, strip and More string at 320 and 360
  dp, en/es/fr/nl, singles and doubles names.

- [ ] **Step 1: Failing routed tests:** scan a table tennis link → Start screen → pick → Start → pad with
      "Serving · 1st" on the picked side; More → Timeout records; Expedite → strip says Expedite and the
      13 returns cell shows; a decided match shows the Finished card; the four languages render the pad.
- [ ] **Step 2:** Implement. **Step 3:** Fit tests green; a string that does not fit is shortened in the
      dictionary, never a smaller type. **Step 4:** Commit. **Batch C Opus review.**

## Batch D — the exit bar

### Task 9: On the phone (owner's hands)

- [ ] **Step 1:** Release build from the clean worktree (`…-worktrees/app-settings`, detached at the
      pushed commit), `assembleRelease`, `adb install -r`.
- [ ] **Step 2:** Design §8 items 1–7 on staging fixtures from Task 1, each with what the screen and the
      console showed. Screenshots cropped, nothing personal, no scanned code's value.
- [ ] **Step 3:** 320 dp (`wm density 540`, then `reset`) for the pad with four tools, More, the Start
      screen, History, in the longest locale.

### Task 10: Results, house rules, PR

**Files:** Create `docs/specs/2026-11-xx-s2-2-results.md` (the S2-1 results format); modify `AGENTS.md`
§1 if the sport list is named there, `docs/i18n-glossary.md`.

- [ ] **Step 1:** Results item by item, with Task 1's answers and the web findings.
- [ ] **Step 2:** Opus whole-branch review; fix round; same reviewer re-checks.
- [ ] **Step 3:** One PR to main, after the owner's go. Tags remain the owner's call.

---

## Execution notes

- Branch `feat/s2-2-table-tennis` from `docs/s2-2-table-tennis-design`, worktree
  `/Users/ashokhein/github/seazn.club.capture-worktrees/s2-2`. Install with
  `NODE_AUTH_TOKEN=$(gh auth token) pnpm install`; the token is never printed.
- Order: Task 1 ∥ Task 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Tasks 3–6 touch disjoint new files but share
  `tableTennisPad.ts`: run them in order, one implementer at a time.
- Nothing edits JS in the worktree a build runs from.
