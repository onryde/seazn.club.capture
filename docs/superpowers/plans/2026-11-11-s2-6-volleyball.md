# S2-6 Volleyball Remote Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score indoor and beach volleyball on the phone, rally by rally, with serve side, deciding-set toss, timeouts, subs, sanctions and set score, behind the existing set-based kit.

**Architecture:** A `volleyball*` module set in `src/domain/scoring/` over the `setBased*` kit, mirroring table tennis file for file (S2-2 merge `2b85417`), with two declared shared changes: an optional lineup builder on `SetBasedKit`, and the paced bootstrap re-read wired on foreground and on every sport's people sheets. Screen is layout A (ruling 178) on `PadContent`/`PadSheets`.

**Tech Stack:** Expo / React Native, TypeScript strict, vitest, `@seazn/engine` 7.0.0 (`@seazn/engine/sports/setbased` `volleyball`, `@seazn/engine/pad` `volleyballPadRules`, `VOLLEYBALL_SANCTION_LEVELS`).

**Spec:** `docs/specs/2026-11-11-s2-6-volleyball-design.md` (approved 2026-11-11). Rulings 170–189 are cited by number; read the spec's §3 table before any task.

**Revision 2 (2026-11-11):** after a plan review (C1, I1–I11, M1–M7). Task order changed: the lineup comes first, the replay runs through the real hook after it exists, the screen row moves to the screen task.

## Global Constraints

- Engine pinned `npm:@onryde/seazn-engine@7.0.0`, no bump (ruling 184). Epoch read with `foldEpochOf('volleyball')`, never a number in source; `engineEpochs.test.ts` holds the literal `1`.
- The phone never sends `core.forfeit`, `core.settle`, `core.abandon`, `core.lineup.replacement`, `volleyball.expedite.start`, a timeout with `technical`, or a rally with `scorer` (AGENTS §1; rulings 171, 172, 174, 176). Task 5 sweeps every tap kind for this.
- Indoor never sends `server`; beach sends `server` only when the engine names the server from a declared pair order (rulings 173, 188), so a deciding-set rally answered by the toss carries none (spec, ruling 188 note).
- Indoor vs beach is read from `cfg.records.substitutions` alone (the engine's own test; 7.0.0 cfg has no variant field, `kernel.d.ts:20-27`).
- Counts never refuse: timeouts per set vs 2 (indoor) / 1 (beach), subs per set vs 6 (indoor); `caution` at the number (ruling 175). A timeout, sub or sanction after a set closes and before the next set's first rally counts to the next set. Counts and `heaviest` come from the stream (ledger plus legal queued taps, voids applied), never the ledger alone.
- Every held pick (`serving` at Start, the deciding-set toss) carries `servingAt` and is dropped at send when the score events moved (rulings 179, 180; `useHeldServing.ts:51`, `tableTennisPayloadForSend`). A held pick is memory only: after a process death the pad asks again.
- Volleyball folds with `teamSheetOf` plus `pairOrder` (ruling 186); badminton and table tennis keep `lineupOf` through the kit's default.
- People lists (sub off/on, sanction person) are built from sheet rows by `personId`, names from `members`, as `footballSheet.ts` does; never by name.
- Generic files never import a sport's; `SPORT_MODULES` / `SPORT_OWN_FILES` gain `volleyball*` / `*Volleyball*` (AGENTS §3).
- Tokens only; card icon `cardCaution` (warning) / `cardDismissal` (penalty and above); counts at the number in `caution`.
- Copy en from the spec; es/fr/nl the controller's, added in the same commit as en (`dictionaries.test.ts:26`); fr puts a no-break space before `?` and `:`.
- Files under ~1500 lines; `volleyballPad.ts` splits tools into `volleyballTools.ts` before 500 lines; the fit sweep lives in its own `volleyballFit.test.ts` (`padFit.test.ts` is past 1500).
- Portrait only (Remote Scoring), so the orientation question of AGENTS §10 does not apply; say so in each task report. Language: screen tests in en, fr and nl.
- Each new guard gets a named mutant and the test that kills it, listed in the task report (AGENTS §10).
- Local checks: scoped tsc + the changed test files; full `pnpm check` on CI. Prettier on any doc touched.

## Review Focus

1. **A co-scorer's rally lands while the deciding-set toss sheet is open** → the sheet closes when `anchorNeeded` turns false, the tapped rally carries no `serving`; Task 5 (domain) and Task 9 (hook).
2. **A lineup saved on the web after the pad opened** → the next people sheet lists the new players without a restart, in volleyball, football and cricket; a person who left the sheet but is named in the ledger still reads by name in History; Tasks 3 and 8.
3. **Beach fixture** (any `bestOf`) → no Sub tool, timeout cap 1, server named only with pair order; Tasks 2, 4, 6.
4. **A fixture with no players, or officials only** → Sub records the side alone; Sanction lists officials, or records the side alone; Task 7.
5. **Undo across a set boundary, and Undo of the rally that carried the toss** → counts, card and the toss question come back for the right set; Tasks 4 and 9.

---

## Batch A — groundwork

### Task 1: The volleyball lineup (ruling 186)

**Files:**

- Create: `src/domain/scoring/volleyballLineup.ts`, `.test.ts`

**Interfaces:**

- Consumes: `teamSheetOf` (`teamSheet.ts:27-48`), `BootstrapSide`.
- Produces: `volleyballLineupOf(side: BootstrapSide): LineupPair['home']` = `teamSheetOf(side).lineup` with each slot's `pairOrder` added when the bootstrap row has one, matching web `lineups.ts:46-67` `buildLineup` field for field.

- [ ] **Step 1:** Tests with literal expected objects: six starters plus bench (indoor); a beach pair with `pairOrder` 1 and 2; a beach pair with no sheet (`sheet: false` path) still carries its pair order; a coach row keeps `role: 'coach'`; a row with no `slot`; a row with no `order_no` takes index + 1; absent fields are absent keys.
- [ ] **Step 2:** FAIL → implement → PASS. Mutant: drop the `pairOrder` copy; the beach test kills it. Commit `feat(volleyball): lineup as the server builds it`.

### Task 2: The engine, the variant and the fake server

**Files:**

- Create: `src/domain/scoring/volleyballEngine.ts`, `.test.ts`; `test/volleyballLedger.ts` (seed and ledger builder)
- Modify: `src/services/fakeScoringPort.ts:49,78` (`volleyball` in `FakeSportKey` and the module table, judging with `volleyballLineupOf`), `src/domain/scoring/engineEpochs.test.ts` (`volleyball: 1`)

**Interfaces:**

- Produces: `volleyballCfg(raw: unknown): SetBasedCfg`; `volleyballRefusalOf` (as `tableTennisRefusalOf`); `isBeach(cfg: SetBasedCfg): boolean` = `!cfg.records.substitutions`; `test/volleyballLedger.ts` exports an indoor and a beach seed (bootstrap with players, pair order on beach, one coach row) and a ledger builder over the real engine, used by Tasks 4–10.

- [ ] **Step 1:** Tests: indoor defaults `bestOf 5, setTo 25, finalSetTo 15, winBy 2`; beach `bestOf 3, setTo 21, substitutions false`; a beach cfg with `bestOf: 1` is still beach (the I2 case); `foldEpochOf('volleyball') === 1`; a garbled cfg gives the refusal path, not a throw.
- [ ] **Step 2:** FAIL → implement → PASS. Mutant: `isBeach` reading `bestOf`; the best-of-1 test kills it. Commit `feat(volleyball): engine cfg, variant, fake server`.

### Task 3: The bootstrap re-read, on foreground and on people sheets (generic, ruling 181)

**Files:**

- Modify: `src/domain/scoring/scoringMatchReads.ts:56-69` (`wanting` on `foreground` calls the paced `asking`), `src/domain/scoring/scoringMatch.ts:206`, `src/hooks/usePadMatchParts.ts:49` (exposes `onPeopleSheet(): void` dispatching the same paced ask), `src/services/fakeScoringPort.ts` (a lineup setter that changes both the bootstrap answer and the judging lineups; today fixed at `:234`), football's card and sub sheets and cricket's batter and bowler picks (call `onPeopleSheet` on open)
- Test: `src/domain/scoring/scoringMatchReads.test.ts`, `src/hooks/scoringRunner.bootstrap.test.ts` (new), football and cricket sheet hook tests

**Interfaces:**

- Produces: on `foreground` (already sent, `scoringRunner.ts:275`) the match asks for the bootstrap through the existing pace (`bootstrapAskedAt`, `BOOTSTRAP_PACE_MS` 15 000); `onPeopleSheet()` from every match hook. No ask on `read` (Realtime nudges). The background sender (`judge !== 'fold'`) never asks.

- [ ] **Step 1:** Reducer tests: foreground 15 000 ms after the last ask asks, at 14 999 does not (mutant `>=` → `>` killed); two foregrounds in one window ask once; `read` never asks; the background sender never asks.
- [ ] **Step 2:** Runner tests on the fake: lineup changed, foreground after 15 s, the next fold sees the new player; a 429 and an offline re-read do not stop sending queued taps; a re-read that answers a lower `lastSeq` is ignored; a re-read during play with taps queued does not flip the pad to a card unless the bootstrap's status says so.
- [ ] **Step 3:** Football and cricket: opening a card/sub sheet (football) or a batter/bowler pick (cricket) asks; a ledger naming a person the new sheet dropped still folds and names them.
- [ ] **Step 4:** FAIL → implement → PASS; run every `ScoringMatchScreen.*.routed.test.tsx` → PASS. Report `memoFold` refolding on each new bootstrap (M7) as a declared cost.
- [ ] **Step 5:** Commit `feat(scoring): read the bootstrap again on foreground and on a people sheet`.

## Batch B — volleyball in the domain

### Task 4: The fold and the display

**Files:**

- Modify: `src/domain/scoring/setBasedFold.ts:57-71,142` (optional `lineupsOf` on `SetBasedKit`, default `lineupOf`; declared shared change)
- Create: `src/domain/scoring/volleyballFold.ts`, `volleyballTypes.ts`, `volleyballFold.test.ts`

**Interfaces:**

- Consumes: `foldSetBased` with `lineupsOf: volleyballLineupOf`, `volleyballCfg`, `isBeach`.
- Produces: `foldVolleyball(input: SportFoldInput): SportFold<VolleyballTypes>`; `VolleyballDisplay` = the set-based fields plus `beach: boolean`, `serving: PadSide | null`, `serverPerson: string | null`, `anchorNeeded: boolean` (engine `deciding-set-toss`, or a lost Start pick), `scoreEvents: number`, `counts: Record<PadSide, { timeouts: number; subs: number }>` (this set, from the stream), `caps: { timeouts: 2 | 1; subs: 6 | 0 }`, `heaviest: Record<PadSide, SanctionLevel | null>` (this set, a per-set walk: the engine's sanction record has no set index), `records`.

- [ ] **Step 1:** Kit test: badminton and table tennis fold fixtures unchanged with the default (pin a fold output each).
- [ ] **Step 2:** Volleyball tests over `test/volleyballLedger.ts`: side-out; set 2 opener alternates; set 5 at 0–0 gives `anchorNeeded` and `serving: null`, a rally with `serving` clears it; timeouts per set and the between-sets rule; an offline queued timeout counts; subs per set; beach caps; `heaviest` per set; Undo of a set-2 timeout taken at 0–0 restores set 2's count; Undo of the rally that carried the toss brings `anchorNeeded` back; a refused sub in the stream is skipped and not counted.
- [ ] **Step 3:** FAIL → implement → PASS. Commit `feat(volleyball): fold and display`.

### Task 5: Taps as events, and the send rule

**Files:**

- Create: `src/domain/scoring/volleyballEvents.ts`, `.test.ts`

**Interfaces:**

- Produces: `VolleyballTap`, the kind union of `TableTennisTap` (`tableTennisPad.ts:62`) minus expedite, plus `{kind:'sub', side, off?, on?}`: includes `start` (→ `core.start`; without it the engine refuses a timeout, sub or sanction before the first rally) and `rally` with `serving?` and `servingAt?`; `volleyballEventFor(tap, context)` → `core.start`, `volleyball.rally {wonBy, serving?, server?}`, `volleyball.timeout {by}`, `volleyball.sub {by, off?, on?}`, `volleyball.sanction {by, level, person?}`, `volleyball.set.summary {home, away}`; `volleyballPayloadForSend(queued, ledger, copied, send)` as `tableTennisPayloadForSend`.

- [ ] **Step 1:** Tests: each payload's exact fields (`kernel.d.ts:30-91`); indoor rally never has `server`; beach with pair order has the engine's server, a deciding-set toss rally has none; a sweep over every tap kind asserts no forbidden event type and no `technical` or `scorer`; `serving` dropped when a co-scorer's rally landed after `servingAt`, kept otherwise; two sends over one ledger give one payload.
- [ ] **Step 2:** FAIL → implement → PASS. Mutants: the `servingAt` drop; `server` on indoor. Commit `feat(volleyball): taps as events`.

### Task 6: The pad view, tools, rules rows and the copy in four languages

**Files:**

- Create: `src/domain/scoring/volleyballPad.ts`, `volleyballTools.ts`, `volleyballRules.ts`, tests; `src/ui/theme/volleyballFit.test.ts`
- Modify: `src/i18n/{en,es,fr,nl}.json` (`scoring.volleyball.*`)

**Interfaces:**

- Consumes: `VolleyballDisplay`, `volleyballPadRules` (`deuceNote`, `setTarget`, `sanctionLevels`).
- Produces: `volleyballPad(display, sync): PadView<VolleyballPadKey>`; `parseVolleyballTool(id)` → `{setScore} | {timeout} | {sub} | {more} | {serving} | null`; `volleyballMoreItems(display)` → `('sanction.first' | 'sanction.second')[]`; `volleyballRuleRows(cfg)`.
- Copy (en): `Set score`, `Timeout`, `Sub`, `More`; foot `T/O {used} of {cap}`, ` · Subs {used} of {cap}`; strip `Set {n} of {bestOf}`, `to {target}`; `Who serves first in set {n}?`; `Warning`, `Penalty`, `Expulsion`, `Disqualification`; `Penalty: tap the rally to {side}` (185); `If {team} can't field six, ask the organiser to end the match.` and beach `…can't field two…` (174, 189).

- [ ] **Step 1:** Tests: row at 0–0 Set score · Timeout · Sub · More, after the first rally Timeout · Sub · More; beach no Sub; foot text and `caution` at 2 of 2 and 6 of 6, none below (values from the copy above); half card level from `heaviest`; strip from `deuceNote`; rule rows indoor and beach. `volleyballFit.test.ts` passes every key in four languages at 320 dp.
- [ ] **Step 2:** FAIL → implement → PASS. Mutant: cap compare `>=` → `>`. Commit `feat(volleyball): pad view, tools, rules, copy`.

### Task 7: The Sub and Sanction steps

**Files:**

- Create: `src/domain/scoring/volleyballSub.ts`, `volleyballSanction.ts`, tests

**Interfaces:**

- Consumes: `teamSheetOf` rows (`personId`, `role`), `members` names, `StepOption`, `sheetRow`.
- Produces: `startSub(side)`, `chooseSub(step, choice, sheet) → SubMove` (side → off → on → done, ids; off and on list the side's players, anyone who has left included: 182); `startSanction(side)`, `chooseSanction(step, choice, sheet) → SanctionMove` (level → person: players then officials by `role`; one person skips; none records the side: 187) and the done line for penalty, expulsion and disqualification.

- [ ] **Step 1:** Tests: sub path gives `{kind:'sub', side, off, on}` by id; no players gives the side alone at once; sanction list players then coach; officials only lists officials; one person skips; penalty's line names the other side; disqualification's line indoor and beach; Back from each step; a double choice on a step moves once.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): sub and sanction steps`.

### Task 8: History and the sport module

**Files:**

- Create: `src/domain/scoring/volleyballHistory.ts`, `volleyballLedgerHistory.ts`, `volleyballSport.ts`, `volleyballSport.epoch.test.ts`, tests
- Modify: `src/domain/scoring/sports.ts:13-19`, `eslint.config.mjs:111,156`, `test/sportBoundary.test.ts`, `engineEpochs.test.ts` (assert `volleyballSport.epoch`)

**Interfaces:**

- Produces: `volleyballSport: ScoringSport<VolleyballTypes>` (`key: 'volleyball'`); History rows for start, rally, timeout, sub (`Sub · {side}: {off} → {on}` or `Sub · {side}`), sanction, set score and the toss (183); a person id no longer on the sheet reads the ledger's name, else `Player`, never blank.

- [ ] **Step 1:** Tests: a row per event; the dropped-person case; `sportFor('volleyball')`; the epoch mock as `tableTennisSport.epoch.test.ts`; `sportBoundary.test.ts` writes a generic file importing `volleyballFold` and watches lint fire.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): history and sport module`.

## Batch C — the hooks, the replay, the screen

### Task 9: The fake pad, the match hook and the sheets hook

**Files:**

- Create: `src/services/fakeVolleyballPad.ts`, `src/hooks/useVolleyballMatch.ts`, `src/hooks/useVolleyballSheets.ts`, tests

**Interfaces:**

- Consumes: `usePadMatchParts` (with Task 3's `onPeopleSheet`), `usePadSheetParts`, `useHeldServing`.
- Produces: the model `VolleyballPadScreen` draws: `PadContentModel` plus sheets for the side pick, sub steps, sanction steps, the deciding-set toss and More.

- [ ] **Step 1:** Tests: the toss sheet opens on the first tap at 0–0 of set 5 and that rally sends `serving`; a co-scorer's rally landing while it is open closes it and the tap sends no `serving`; process death with a pick held asks again; Timeout's side choice tapped twice records once; Sub and Sanction sheets call `onPeopleSheet`; background → foreground with a sheet open keeps it.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): match and sheets hooks`.

### Task 10: A real match, replayed through the hook (lesson L5)

**Files:**

- Create: `src/hooks/useVolleyballMatch.replay.test.tsx` (as `useFootballMatch.replay.test.tsx`)

- [ ] **Step 1:** One published indoor five-set final, set scores as played, a timeout each side in two sets, four subs with players, a warning and a penalty (with its rally), through `useVolleyballMatch` against `fakeScoringPort`; assert each set's score, the sets tally, decided, zero refusals. A beach two-set match with pair order the same way, asserting `server` on each non-toss rally. Source each match in the header comment.
- [ ] **Step 2:** Run → PASS. An engine refusal stops the plan before Task 11 and is reported as a finding. Commit `test(volleyball): a real match replayed through the hook`.

### Task 11: The screen and the route

**Files:**

- Create: `src/ui/screens/VolleyballPadScreen.tsx`, `VolleyballMatchScreen.tsx`, `VolleyballPadScreen.test.tsx`, `ScoringMatchScreen.volleyball.routed.test.tsx`
- Modify: `src/ui/screens/scoringScreens.ts:22`; `ScoreHalf` only by a new optional prop if the foot counts need a slot (declared shared change, badminton and table tennis tests unchanged)

- [ ] **Step 1:** Tests: layout A's row and foot counts as the operator sees them in en, fr and nl; beach no Sub; the card icon at a warning; routed: open a volleyball link, Start, a rally, History shows it.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): the pad screen`.

## Batch D — the exit bar

### Task 12: On the phone (owner's hands)

- [ ] Before the build: confirm staging web runs engine 7.0.0 and its rules endpoint answers for a volleyball fixture; record both.
- [ ] Local release build from a clean worktree at the pushed commit; build table in the results doc.
- [ ] Owner runs spec §8 items 1–3 and 6 on staging (throwaway org, indoor and beach fixtures with players); controller drives adb; `getevent` running from the start.
- [ ] Item 5: 320 × 640 (`wm size`) and the owner's phone, fr and nl, pad in play, after the last layout fix; reset overrides.
- [ ] Item 7: Hermes fold probe for volleyball on a throwaway branch.

### Task 13: Results, house rules, PR

- [ ] `docs/specs/2026-11-1x-s2-6-results.md`: exit bar, findings, rulings 170–189 and any from the build (owner vs controller), what changed for other sports (Tasks 3, 4, 11's shared changes; M7 refolds), backlog (libero S2-6b, beach side switch, badminton/TT lineup vs server, beach toss rally without `server`).
- [ ] `AGENTS.md` §1 names volleyball and its rulings; §3's sport list gains `volleyball*`.
- [ ] Prettier on docs; draft PR from `feat/s2-6-volleyball`; never merge.
