# S2-6 Volleyball Remote Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score indoor and beach volleyball on the phone, rally by rally, with serve side, deciding-set toss, timeouts, subs, sanctions and set score, behind the existing set-based kit.

**Architecture:** A `volleyball*` module set in `src/domain/scoring/` over the `setBased*` kit, mirroring table tennis file for file (S2-2 merge `2b85417`), plus one generic change (bootstrap re-read) and one volleyball-own lineup builder shaped like the web server's. Screen is layout A (ruling 178) on `PadContent`/`PadSheets`.

**Tech Stack:** Expo / React Native, TypeScript strict, vitest, `@seazn/engine` 7.0.0 (`@seazn/engine/sports/setbased` `volleyball`, `@seazn/engine/pad` `volleyballPadRules`, `VOLLEYBALL_SANCTION_LEVELS`).

**Spec:** `docs/specs/2026-11-11-s2-6-volleyball-design.md` (approved 2026-11-11). Rulings 170–188 are cited by number; read the spec's §3 table before any task.

## Global Constraints

- Engine pinned `npm:@onryde/seazn-engine@7.0.0`, no bump (ruling 184). Volleyball fold epoch read with `foldEpochOf('volleyball')`, never a number in source; `engineEpochs.test.ts` holds the literal `1`.
- The phone never sends `core.forfeit`, `core.settle`, `core.abandon`, `core.lineup.replacement`, `volleyball.expedite.start`, or a timeout with `technical` (AGENTS §1; rulings 171, 174, 176).
- Indoor never sends `server`; beach sends `server` only with a declared pair order (rulings 173, 188). No `scorer` field ever (ruling 172).
- Counts never refuse: timeouts per set vs 2 (indoor) / 1 (beach), subs per set vs 6 (indoor); `caution` at the number (ruling 175). A timeout, sub or sanction after a set closes and before the next set's first rally counts to the next set.
- Every held pick (`serving` at Start, the deciding-set toss) is tied to the ledger by a `base` event count and dropped at send if the score moved (rulings 179, 180; S2-2 `tableTennisPayloadForSend`).
- Volleyball folds with a lineup shaped like web `apps/web/src/server/engine-db/lineups.ts` `buildLineup` (ruling 186); badminton and table tennis keep `lineupOf`.
- Generic files never import a sport's; `SPORT_MODULES` / `SPORT_OWN_FILES` gain `volleyball*` / `*Volleyball*` (AGENTS §3).
- Tokens only; card icon colours `cardCaution` (warning) and `cardDismissal` (penalty and above); counts at the number in `caution`.
- Copy en from the spec; es/fr/nl the controller's. Every `scoring.volleyball.*` key in all four dictionaries and swept by `padFit.test.ts`.
- Files under ~1500 lines; `volleyballPad.ts` splits tools into `volleyballTools.ts` before 500 lines.
- Local checks: scoped tsc + the changed test files; full `pnpm check` on CI (memory: check-touched-files). Prettier on any doc touched.
- Every change answers AGENTS §10's four questions in its tests or says why one does not apply. Mutate each new guard once.

## Review Focus

1. **A co-scorer's rally lands while the deciding-set toss sheet is open** → the pick is dropped at send, the engine's side-out names the server; test in Task 5.
2. **A lineup saved on the web after the pad opened** → the next Sub or Sanction sheet lists the new players without a restart; and a person who left the sheet but is named in the ledger still shows by name in History; tests in Tasks 2 and 8.
3. **Beach fixture** → no Sub tool, timeout cap 1, server named only with pair order, `volleyball.sub` never offered (engine refuses it strictly); test in Tasks 4 and 6.
4. **A fixture with no players on the sheet** → Sub and Sanction record the side alone (`{by}`), no empty person step; test in Task 7.
5. **Undo of a sub, sanction or timeout across a set boundary** → the per-set counts and the half's card go back to the right set's values; test in Task 4.

---

## Batch A — groundwork

### Task 1: The engine, the fake server and the epoch

**Files:**

- Create: `src/domain/scoring/volleyballEngine.ts`, `src/domain/scoring/volleyballEngine.test.ts`
- Modify: `src/services/fakeScoringPort.ts:49,80` (add `volleyball` to `FakeSportKey` and the module table), `src/domain/scoring/engineEpochs.test.ts` (add `volleyball: 1`)

**Interfaces:**

- Produces: `volleyballCfg(raw: unknown): SetBasedCfg` (`volleyball.configSchema.parse`); `volleyballRefusalOf` (wraps `setBasedRefusalOf`, as `tableTennisRefusalOf`); `type VolleyballVariant = 'indoor' | 'beach'`; `volleyballVariantOf(cfg: SetBasedCfg): VolleyballVariant` (beach ⇔ `cfg.records.substitutions === false` and `bestOf === 3`; read the engine's variant field instead if 7.0.0 stores one: check `volleyball.configSchema` first and prefer it).

- [ ] **Step 1:** Tests: `volleyballCfg({})` gives `bestOf 5, setTo 25, finalSetTo 15, winBy 2, records.substitutions true`; the beach variant's cfg gives `bestOf 3, setTo 21, records.substitutions false`; `volleyballVariantOf` names each; `engineEpochs.test.ts` asserts `foldEpochOf('volleyball') === 1`.
- [ ] **Step 2:** Run `pnpm vitest run src/domain/scoring/volleyballEngine.test.ts src/domain/scoring/engineEpochs.test.ts` → FAIL.
- [ ] **Step 3:** Implement; add the fake port row (seeds come in Task 10).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(volleyball): engine cfg, refusals, fake server row`.

### Task 2: Bootstrap re-read on foreground and on a player sheet (generic, ruling 181)

**Files:**

- Modify: `src/hooks/scoringRunnerReads.ts:64-77` (the bootstrap read can be asked again), the match reducer that plans `LOAD_BOOTSTRAP` (`src/domain/scoring/scoringMatchState.ts:42,225` and its step file), the runner hook that subscribes to `ports.foreground`
- Test: `src/hooks/scoringRunner.bootstrap.test.ts` (new), the reducer's test file

**Interfaces:**

- Produces: `MatchEvent` `{ kind: 'bootstrapWanted', at: number }` → plans `LOAD_BOOTSTRAP` when `at - lastBootstrapAt >= BOOTSTRAP_PACE_MS` (15 000), else nothing; dispatched by the runner on foreground and by `usePadSheetParts` when a sheet that lists people opens. A `bootstrapRead` replaces the held bootstrap and refolds.

- [ ] **Step 1:** Reducer tests: `bootstrapWanted` at t=0 after a read at t=0 plans nothing; at t=15 000 plans `LOAD_BOOTSTRAP`; two `bootstrapWanted` in one window plan one read (second call); a failed re-read keeps the held bootstrap (interruption).
- [ ] **Step 2:** Runner test (fake ports): the fake server's lineup changes, foreground fires after 15 s on the fake clock, the next fold sees the new player; foreground before 15 s does not read.
- [ ] **Step 3:** Run both → FAIL. Implement. Run → PASS.
- [ ] **Step 4:** Run the existing football and cricket routed suites (`ScoringMatchScreen.*.routed.test.tsx`) → PASS unchanged; record in the task report any pick (batter, player on the pitch) that names a person the new sheet lacks, as a finding, not a fix.
- [ ] **Step 5:** Commit `feat(scoring): read the bootstrap again on foreground and on a player sheet`.

### Task 3: The volleyball lineup (ruling 186)

**Files:**

- Create: `src/domain/scoring/volleyballLineup.ts`, `.test.ts`

**Interfaces:**

- Consumes: `BootstrapSide`, `BootstrapSlot` (`wire.ts:26-38`).
- Produces: `volleyballLineupOf(side: BootstrapSide): LineupPair['home']`: every slot with `personId`, `slot`, `orderNo` (`orderNo ?? index + 1`), and `positionKey`, `roles`, `role` (omitted when `player`), `squadNumber`, `pairOrder` each omitted when absent, exactly as web `buildLineup`.

- [ ] **Step 1:** Tests with literal expected objects copied from `buildLineup`'s rules: a six-starter plus bench indoor side; a beach pair with `pairOrder` 1 and 2; a coach row (`role: 'coach'` kept); a slot with no `order_no` gets its index + 1; `null` fields are absent keys, not `undefined`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): lineup as the server builds it`.

## Batch B — volleyball in the domain

### Task 4: The fold and the display

**Files:**

- Create: `src/domain/scoring/volleyballFold.ts`, `.test.ts`; `src/domain/scoring/volleyballTypes.ts` (the sport's `SportTypes`)

**Interfaces:**

- Consumes: `foldSetBased` (`setBasedFold.ts:108`), `volleyballLineupOf`, `volleyballCfg`.
- Produces: `foldVolleyball(input: SportFoldInput): SportFold<VolleyballTypes>`; `VolleyballDisplay` with, beyond the set-based fields: `variant`, `serving: PadSide | null`, `serverPerson: string | null` (beach with pair order only), `decidingToss: boolean` (engine reports `deciding-set-toss` at 0–0 of the deciding set), `counts: Record<PadSide, { timeouts: number; subs: number }>` for the current set (timeouts counted from the ledger: the engine's `state.timeouts` is per match), `caps: { timeouts: 2 | 1; subs: 6 | 0 }`, `heaviest: Record<PadSide, SanctionLevel | null>` this set, `records`.

- [ ] **Step 1:** Tests (ledger fixtures built with the real engine, as `tableTennisFold.test.ts`): side-out after a receiver's rally; set 2 opener alternates; set 5 at 0–0 gives `decidingToss: true` and `serving: null`, the first rally with `serving` clears it; timeouts 1 in set 1 then 0 at set 2's start; a timeout after set 1 closes counts to set 2 (ruling 175); subs per set from the engine; beach `caps.timeouts 1`, `caps.subs 0`; `heaviest` is the max level this set and resets next set; an Undo (`core.void`) of a set-2 timeout taken at 0–0 restores set 2's count (Review Focus 5).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): fold and display`.

### Task 5: Taps as events, and the send rule

**Files:**

- Create: `src/domain/scoring/volleyballEvents.ts`, `.test.ts`

**Interfaces:**

- Produces: `type VolleyballTap = { rally: PadSide; serving?: PadSide } | { timeout: PadSide } | { sub: PadSide; off?: string; on?: string } | { sanction: PadSide; level: SanctionLevel; person?: string } | { setScore: {first:number; second:number} }`; `volleyballEventFor(tap, context): SportEvent | null` → `volleyball.rally {wonBy, serving?, server?}`, `volleyball.timeout {by}`, `volleyball.sub {by, off?, on?}`, `volleyball.sanction {by, level, person?}`, `volleyball.set.summary {home, away}`; `volleyballPayloadForSend(queued, ledger, copied, send)`: drops `serving` when the score events since its `base` moved (copy `tableTennisPayloadForSend`).

- [ ] **Step 1:** Tests: each tap's exact payload (field names from the engine `kernel.d.ts:30-91`); indoor rally never carries `server`; beach with pair order carries `server` = the engine's named server; no event ever carries `scorer` or `technical`; `serving` dropped when a co-scorer's rally landed after `base` (Review Focus 1), kept when nothing moved; a second identical send over the same ledger gives the same payload (second call).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): taps as events`.

### Task 6: The pad view, tools, rules rows and English copy

**Files:**

- Create: `src/domain/scoring/volleyballPad.ts`, `volleyballTools.ts`, `volleyballRules.ts`, each with a test
- Modify: `src/i18n/en.json` (`scoring.volleyball.*`)

**Interfaces:**

- Consumes: `VolleyballDisplay`, `volleyballPadRules` (`deuceNote`, `setTarget`, `sanctionLevels`).
- Produces: `volleyballPad(display, sync): PadView<VolleyballPadKey>`; tools row ids and `parseVolleyballTool(id)` → `{setScore} | {timeout} | {sub} | {more} | null`; `volleyballMoreItems(display): readonly ('sanction.first' | 'sanction.second')[]`; `volleyballRuleRows(cfg)`.
- Copy (en): tools `Set score`, `Timeout`, `Sub`, `More`; foot `T/O {used} of {cap}` and ` · Subs {used} of {cap}`; strip `Set {n} of {bestOf}`, `to {target}`; toss sheet `Who serves first in set {n}?`; sanction levels `Warning`, `Penalty`, `Expulsion`, `Disqualification`; done lines `Penalty: tap the rally to {side}` (ruling 185), `If {team} can't field six, ask the organiser to end the match.` (ruling 174; beach: `two`).

- [ ] **Step 1:** Tests: row is Set score · Timeout · Sub · More at a set's 0–0, Timeout · Sub · More after its first rally; beach row has no Sub; foot text and `caution` flag at 2 of 2 and 6 of 6 and none below (ruling 175, assertions from the copy above, not from the function); the card icon level per half from `heaviest`; strip from `deuceNote`; rule rows for indoor and beach cfgs.
- [ ] **Step 2:** FAIL → implement (split tools before `volleyballPad.ts` reaches 500 lines) → PASS. Commit `feat(volleyball): pad view, tools and rules`.

### Task 7: The Sub and Sanction steps

**Files:**

- Create: `src/domain/scoring/volleyballSub.ts`, `volleyballSanction.ts`, each with a test

**Interfaces:**

- Consumes: `volleyballLineupOf`, `levelSheet`/`personSheet` (`setBasedSanction.ts:38/47`), the sheet kit (`StepOption`, `sheetRow`).
- Produces: `startSub(side)`, `chooseSub(step, choice, lineup) → SubMove` (side → off → on → done; off lists the side's players, on lists the rest of its players, both include anyone who has left: ruling 182); `startSanction(side)`, `chooseSanction(step, choice, lineup) → SanctionMove` (level → person: players then officials by `role`, skipped with one person, side alone with none: ruling 187) and the done line for penalty / expulsion / disqualification.

- [ ] **Step 1:** Tests: full sub path gives the `sub` tap with `off` and `on`; no players gives `{sub: side}` at once (Review Focus 4); sanction person list order players-then-coach; one person skips the step; penalty's done line names the other side; disqualification's names the field-six line; Back from each step (second call).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): sub and sanction steps`.

### Task 8: History, the sport module, routing and lint

**Files:**

- Create: `src/domain/scoring/volleyballHistory.ts`, `volleyballLedgerHistory.ts`, `volleyballSport.ts`, `volleyballSport.epoch.test.ts`, tests for each
- Modify: `src/domain/scoring/sports.ts:13-19`, `src/ui/screens/scoringScreens.ts:22`, `eslint.config.mjs:111,156`, `test/sportBoundary.test.ts`

**Interfaces:**

- Produces: `volleyballSport: ScoringSport<VolleyballTypes>` (`key: 'volleyball'`, `epoch: foldEpochOf('volleyball')`); History rows for rally, timeout, sub (`Sub · {side}: {off} → {on}`, or `Sub · {side}`), sanction, set score and the toss (ruling 183), naming a person by the ledger's id even when the re-read sheet no longer lists them (`Player` fallback word, never blank).

- [ ] **Step 1:** Tests: a row per event type with its words; a sub naming a person absent from the current bootstrap still reads a name or the fallback (Review Focus 2); `sportFor('volleyball')` returns the module; the epoch test mocks `foldEpochOf` with a sport-unique number as `tableTennisSport.epoch.test.ts`; `sportBoundary.test.ts` proves a generic file importing `volleyballFold` fails lint (write the violation, watch it fire).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): history, sport module, routing`.

### Task 9: A real match, replayed (lesson L5)

**Files:**

- Create: `test/volleyballLedger.ts` (fixture builder), `src/hooks/scoringRunner.volleyballReplay.test.ts`

- [ ] **Step 1:** Encode one published indoor final, set by set (a five-set match with the real set scores, at least one timeout each side in two sets, four subs, one warning and one penalty), as taps; run it through the generic match runner with `volleyballSport` (as `scoringRunner.wire.test.ts` drives it) against `fakeScoringPort` (which judges every append with the engine); assert the final sets tally, each set's score, the engine's decided state, and zero refusals. Add a beach two-set match the same way. Source the match in the test's header comment.
- [ ] **Step 2:** Run → PASS. If it fails on an engine refusal, stop and report it as a finding before Batch C.
- [ ] **Step 3:** Commit `test(volleyball): a real match replayed through the hook`.

## Batch C — the screen

### Task 10: The fake pad, the match hook and the sheets hook

**Files:**

- Create: `src/services/fakeVolleyballPad.ts`, `src/hooks/useVolleyballMatch.ts`, `src/hooks/useVolleyballSheets.ts`, tests

**Interfaces:**

- Consumes: `usePadMatchParts`, `usePadSheetParts`, `useHeldServing` (shared, unchanged), Task 2's `bootstrapWanted` on a people sheet's open.
- Produces: the model `VolleyballPadScreen` draws: `PadContentModel` plus sheets for side pick, sub steps, sanction steps, the deciding-set toss and More.

- [ ] **Step 1:** Hook tests on the fake: the deciding-set toss opens on the first tap at 0–0 of set 5 and sends that rally with `serving`; Timeout opens the side sheet and records; Sub and Sanction sheets dispatch `bootstrapWanted`; a double tap on a tool opens one sheet (second call); background → foreground with a sheet open keeps it (interruption).
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(volleyball): match and sheets hooks`.

### Task 11: The screen, the route, the fit and the languages

**Files:**

- Create: `src/ui/screens/VolleyballPadScreen.tsx`, `VolleyballMatchScreen.tsx`, `VolleyballPadScreen.test.tsx`, `ScoringMatchScreen.volleyball.routed.test.tsx`
- Modify: `src/i18n/{es,fr,nl}.json`, `src/ui/theme/padFit.test.ts` (sweep `scoring.volleyball`), `ScoreHalf` only by props if the foot counts need a slot (declare in the task report: it is shared)

- [ ] **Step 1:** Screen tests (react-native-web): layout A's row and the foot counts as the operator sees them in en/fr; beach shows no Sub; the card icon present at a warning; routed test scans a volleyball link, starts, scores a rally, sees History.
- [ ] **Step 2:** `padFit.test.ts` passes every `scoring.volleyball.*` key in four languages at 320 dp.
- [ ] **Step 3:** FAIL → implement → PASS. Commit `feat(volleyball): the pad screen`.

## Batch D — the exit bar

### Task 12: On the phone (owner's hands)

- [ ] Local release build from a clean worktree at the pushed commit; build table in the results doc.
- [ ] Owner runs spec §8 items 1–3, 6 on staging (throwaway org, indoor and beach fixtures with players); controller drives adb; `getevent` running from the start for phantom taps.
- [ ] Item 5: 320 × 640 (`wm size`) and the owner's phone, fr and nl, pad in play, after the last layout fix; reset overrides.
- [ ] Item 7: Hermes fold probe for volleyball on a throwaway branch.

### Task 13: Results, house rules, PR

- [ ] `docs/specs/2026-11-1x-s2-6-results.md`: exit bar table, findings, rulings ledger (170–188 and any made in the build, owner vs controller), what changed for other sports (Task 2, any shared-kit prop), backlog (libero S2-6b, beach side switch, badminton/TT lineup vs server).
- [ ] `AGENTS.md` §1 names volleyball and its rulings range; §3's sport list gains `volleyball*`.
- [ ] Prettier on docs; draft PR from `feat/s2-6-volleyball`; never merge.
