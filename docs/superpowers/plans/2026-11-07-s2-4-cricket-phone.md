# S2-4 Remote Scoring (cricket), the phone: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One scorer scans a cricket match's scoring link and scores it ball by ball on the phone, from the toss to the result, super over included: batting order, openers, the bowler of every over, every extra with its runs, every dismissal the engine allows, the fielder and the incoming batter. When the players are not entered, the scorer records over-by-over totals instead.

**Architecture:** A further sport behind the S2-1 runtime's `ScoringSport` (S2 ruling 38). A `cricket*` module set in `src/domain/scoring/` folds through `@seazn/engine/sports/cricket`, with a row in `sports.ts` and `scoringScreens.ts` and its own screen. The screen composes cricket parts through `PadContent`'s `body` slot (football's interface). The generic changes are listed in the spec (§6, the list amended by the controller on 2026-11-08, preflight F18) and made here, nowhere else: the team-sheet lineup in the bootstrap's order (`teamSheet.ts`, one builder with football's); the boot cache and the match state holding sport-neutral pending picks (`pendingPicks.ts`); one engine refusal reader (`engineRefusalOf`); the fake's `FakeSport` row; `PadContent.body`; the kit's sheet rows (rulings 82, 85); `TossPicker`'s generic options, `fill` and `disabled`; and Match details' sport block. Every cricket rule is the engine's.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / Hermes. `@seazn/engine` = `npm:@onryde/seazn-engine@0.0.0-pr28.44699f16400a367a87747b8390c40fe16e1ff8f2`, exact, on this branch only: engine PR #28's snapshot (the controller's ruling, 2026-11-08). Before the PR merges, Task 20 repins to the release, **the cricket engine major**. Its number is read from the release, never assumed: engine PR #27 (W4 knockout) is also a major. Tests run on vitest with react-native-web.

**Spec:** `docs/specs/2026-11-07-s2-4-cricket-design.md` (approved 2026-11-07, rulings 64–85), on top of `docs/specs/2026-11-01-s2-remote-scoring-design.md` and the S2-2 design. Read both, plus `AGENTS.md`. The web pad's fixes (§7.2) are a separate `seazn.club` worktree's plan; this plan never edits the web or the engine.

## Preconditions (not phone tasks)

- **P1 Engine (done).** All of P1 is committed on engine PR #28 (`feat/cricket-s2-4`, head f8ad9bc; worktree `seazn.club.engine-worktrees/cricket-s2-4`):
  - a895160 (engine ruling 276): `cricketPadRules.wideDismissalKinds`, `cricketPadRules.noBallDismissalKinds`, and `orderFromLineup` exported from `./sports/cricket`.
  - 33c51fd, CK-SS-1 (engine ruling 277): a ball naming exactly the fold's pair reversed is accepted (main innings; a super over already took any pair).
  - f94a767, CK-BC-1 (engine ruling 278): `cricket.bowler.change {bowler, reason?: 'incapacitated' | 'suspended' | 'other'}`, plus `eligibleChangeBowlers(order, fine, maxOversPerBowler, ballsPerOver)`, `oversUsed(fine, bowler, ballsPerOver)`, `OverSpell`, and the scorecard over's `bowlers?`.
  - 42093f2 and f8ad9bc. `FOLD_EPOCH.cricket` is 3 (`src/sport/fold-epoch.ts:52`).
  - The snapshot `0.0.0-pr28.44699f16400a367a87747b8390c40fe16e1ff8f2` (PR #28's merge commit) is on GitHub Packages (2026-11-07T23:42Z). The release, the cricket engine major, is the owner's; it gates Task 20's repin and so the PR's merge. Engine PR #27 (W4 knockout) touches no phone subpath (`phone-subpaths.json` is unchanged since 2.0.0).
- **P2 Web bootstrap lineup fields** (`slot`, `position_key`, `order_no`, `role`, `roles`, `squad_number`): web branch `feat/device-link-lineup-and-football-clock` (football's web PR, not merged at planning), merged and on staging before Batch 2's device check. It rebases on web PR #1135, whose loaders order `order_no nulls last, full_name, person_id`, and adds `l.person_id` as the final tie-break at `fixtures.ts:896`, so the bootstrap's row order is the server's (preflight F1, W17; the controller sends it to the football web session).
- **P3 Phone `BootstrapSlot` fields.** Football's phone plan Task 2 is committed as 93f4c35 on `feat/s2-5-football` (`wire.ts`, `wire.test.ts`, `wireBootstrap.test.ts`) and is not on main. **Task 2 cherry-picks 93f4c35 unchanged** (clean onto d62eb99, preflight §0), so the later rebase drops it as already applied. Never re-write the fields. If a football fix round amends 93f4c35 and a rebase then conflicts in `wire.ts`, take football's version.
- **The branch.** `feat/s2-4-cricket` is rebased on origin/main d62eb99 (2026-11-08), which carries chess (PR #42). Every chess step below is unconditional.
- **P4** The web takes the cricket engine (the snapshot by a `pnpm-workspace.yaml` override until the release; web plan Task 1, W1), and the web pad's §7.2 fixes are deployed to staging before Task 19 (rulings 71, 72). Staging is a merge to the web's main, which waits for the release, so Task 19 follows the release. Until the web takes it, the server refuses `cricket.bowler.change`.
- **P5** Staging (owner's go): a started division; a league fixture (2 overs, max 1 per bowler, 5 a side); a knockout fixture (super over on); team sheets with `order_no`, a bench row, a coach row and a `wicketkeeper` role; and one fixture whose away side has no lineup. Tokens are never printed.

## Global Constraints

- AGENTS.md in full:
  - §2: scoring is JavaScript's; no second state machine.
  - §3: layering by lint, no barrels.
  - §4: one parser per wire shape, `type` in domain, no `any`.
  - §5: tokens only, no red outside ON AIR.
  - §8: `React.memo` and no anonymous functions in render on the pad.
  - §10: the four questions, mutate every guard once and watch a test fail, no expected value derived from the code under test (copy from the dictionary, values from the spec and the Laws), no snapshot tests. Every task's Step 5 names its guards and one mutation per guard (preflight F16). Every sweep asserts its count, and zero checked is a failure (D5).
  - §10, jsdom is not the phone (preflight F15, D1): a fixed-height claim asserts each region's style height equals its token (`layout.scorePanel`, `creaseRow`, `overStrip`, `padTossHeight`) in both states, never "equal before and after", which `undefined === undefined` passes. "Nothing moves" and every colour claim are device claims, checked in Task 19 (exit items 11 and 13).
  - §12: functions 10–25 lines, JSX ≤ 3 deep.
- Engine `@onryde/seazn-engine` at the Tech Stack's snapshot, exact, until Task 20 repins to the release. Sport key `'cricket'`. The epoch is `foldEpochOf('cricket')`, never a literal. The rules version comes from the bootstrap and the rules read only.
- Every cricket rule is the engine's: `eligibleBowlers`, `eligibleChangeBowlers`, `eligibleIncomingBatters`, `suggestedIncomingBatter`, `chaseTarget`, `activeInnings`, `nextBattingSide`, `soBattingSideAt`, `soEligibleBatters`, `orderFromLineup`, `oversUsed`, `cricketPadRules`, `deriveCricketScorecard`, `CRICKET_MARGIN_KINDS`. Where none answers ("does this wicket end the innings?"), apply the candidate event strictly to the folded state (Task 12's `endsInnings`, preflight F7). No hand copy of a set or a number.
- Event types (only these): `cricket.toss {wonBy, elected}`, `core.start {}`, `cricket.ball` / `cricket.superover.ball {over, ballInOver, striker, nonStriker, bowler, runs: {bat, extras?}, boundary?, wicket?}`, `cricket.innings.summary {runs, wickets, legalBalls, partial: true}`, `cricket.retire`, `cricket.innings.declare`, `cricket.innings.close`, `cricket.interruption`, `cricket.revise`, `cricket.newball`, `cricket.powerplay`, `cricket.followon`, `cricket.match.close`, `cricket.review`, `cricket.bowler.change`, `core.void {event_id}`.
  - Never `freeHit`. Never `cricket.player.line`.
  - Never `core.forfeit`, `core.abandon`, `core.settle` or `core.finalize`.
  - `wicket.kind` is never `retired` or `timedout` on a ball.
  - `over` and `ballInOver` are always sent.
- Lint:
  - `SPORT_MODULES.group` gains `'**/*cricket*'`.
  - `SPORT_OWN_FILES` gains `'**/*cricket*'` and `'**/*Cricket*'`.
  - `test/sportBoundary.test.ts` proves a generic file naming `cricketPad` fails.
- Copy:
  - `scoring.cricket.*` in `src/i18n/{en,es,fr,nl}.json`, with identical keys and placeholders. es/fr/nl are the controller's drafts until a native reader checks them.
  - Glossary rows in `docs/i18n-glossary.md` dated 2026-11-07 onward.
  - Every new string has a fit case in `src/ui/theme/padFit.test.ts` at 320 and 360 dp in all four languages. A string that doesn't fit is shortened in the dictionary, never set in smaller type.
  - Names give way to an ellipsis; numbers never do.
- **Local verification (owner's policy):**
  - Type-check only the changed files, through a temp `tsconfig.changed.json` that extends `./tsconfig.json` with `include: []` and `files: [...]`. Never commit it.
  - Run only the changed or added test files, by path.
  - The full suite, lint and Prettier run on CI after a push.
  - Capture exit codes with a redirect, not a pipe.
  - When a count matters, use `pnpm vitest run --reporter=json`.
- Execution: Opus subagents (implementer, reviewer). Each batch ends with an Opus batch review and a device check by the owner on the OnePlus (adb serial `12be753e`). The device build is local and arm64 only: `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease`. The machine is heavily loaded: never build all four ABIs. No `eas build`, `eas submit` or `eas update`.
- Shared files with football (s2-5) and chess (s2-3, on main): `sports.ts`, `scoringScreens.ts`, `SPORT_MODULES` / `SPORT_OWN_FILES`, `fakeScoringPort.ts`, `PadStart.needsToss` (chess), `PadContent.body`, `StepSheet`, `teamSheet.ts` and `engineRefusalOf` (football), AGENTS.md §1/§3, the glossary and the dictionaries.
  - Rebase after football merges; whoever rebases second resolves the tables.
  - One team-sheet builder, one `engineRefusalOf`, one `PadContent.body`: whichever branch lands second adopts the other's (preflight F2, F9, D6).
  - `StepOption` row kinds (preflight F26): football's `heading` row has no border; its `toggle` row is lime, as any row that takes a tap. Agree it with s2-5 before the second branch lands.
  - Notify the s2-5 session before pushing any AGENTS.md or glossary change, and when `teamSheet.ts`, `engineRefusalOf` or `PadContent.body` lands.

**Verify template** (every task's verify step; `<files>` = its changed `.ts`/`.tsx` files, `<tests>` = its test files):

```bash
cd /Users/ashokhein/github/seazn.club.capture-worktrees/s2-4-build && echo '{"extends":"./tsconfig.json","compilerOptions":{"noEmit":true,"incremental":false},"include":[],"files":[<files>]}' > tsconfig.changed.json && npx tsc -p tsconfig.changed.json > <scratch>/tsc.txt 2>&1; echo "EXIT=$?"; rm tsconfig.changed.json
cd /Users/ashokhein/github/seazn.club.capture-worktrees/s2-4-build && pnpm vitest run <tests> --reporter=json --outputFile=<scratch>/r.json > <scratch>/v.txt 2>&1; echo "EXIT=$?"
```

Pass means both commands print `EXIT=0`, `numFailedTests` is 0, and `numTotalTests` equals the count the task expects.

## Review Focus

1. **A queued ball overtaken by another scorer's ball.** The phone is offline and queues the 3rd ball of an over. A browser co-scorer records that ball first. On send, the phone's ball must not be restamped onto the next ball (it is a different delivery). It is dropped and said, as any illegal tap ("Not recorded"). Test: Task 6 `payloadForSend never moves over or ballInOver`; Task 5 `legalQueued drops a ball whose ballInOver the ledger already holds`.
2. **Undo of an over's first ball.** The picked bowler must still be the pick, keyed to that over, and the over must not ask again or name the last over's bowler. Test: Task 3 `Undo never changes picks` (the generic half; preflight D4); Task 5 `undoing the over's first ball shows the picked bowler again` (the over's half).
3. **Process death between an over's end and its first ball.** The next-bowler pick, the reordered batting order and the openers are read back from the boot cache. Test: Task 3 `picks round-trip the boot file` and `a boot file without picks reads as none`; Task 10 `a reopened match keeps the batting order and the bowler pick`.
4. **A team sheet whose `order_no` is null for some rows, or a web older than P2.** The phone's batting order must equal the server's walk, or the suggested next batter differs from it and a ball is refused. The server orders `order_no nulls last, full_name, person_id` (web #1135); the bootstrap sends the same order (with P2's tie-break). So the phone keeps the bootstrap's row order, never re-sorts it, and numbers a null `orderNo` i + 1 in that order, per side (spec §6 as amended, preflight F1). Test: Task 2 `rows keep the bootstrap's order` and `rows with no slot fold as all starting`.
5. **The innings-ending wicket in a super over and in a chase.** No Next batter step on the super over's 2nd wicket, on the last legal ball, on all out, or on a run out whose completed runs win the chase. A wicket off a wide on the last legal ball still asks: a wide is not a legal ball. The `endsInnings` trial apply on the folded state, not a count of ours, decides (one rule with the web's `wicketEndsInnings`; a refusal reads false, so the step is asked). Test: Task 12 `no incoming on the super over's second wicket`, `no incoming on the last ball of the innings`, `no incoming at all out (players − 1)`, `a run out whose completed runs win the chase asks no next batter`, `a wicket off a wide on the last legal ball still asks who walks in`.

---

## Batch 1: the engine, for every sport (Task 1)

### Task 1: Take the cricket engine snapshot: badminton, table tennis and chess too

P1 is done. While the pin is a snapshot, Task 1 is a commit on `feat/s2-4-cricket`, not a PR to main (preflight §0): nothing in capture CI rejects a `0.0.0-pr` pin, and a `v*` tag on main would build a Play bundle on it. Task 20 repins to the release before the PR merges.

**Files:**

- Modify: `package.json` (`"@seazn/engine": "npm:@onryde/seazn-engine@0.0.0-pr28.44699f16400a367a87747b8390c40fe16e1ff8f2"`), `pnpm-lock.yaml`.
- Modify: `docs/specs/2026-11-01-s2-r4-engine-on-hermes.md` (append "the cricket snapshot: device").
- Modify if needed: `eslint.config.mjs:250` (`internalPath`), `test/domainBoundary.test.ts`, but only if the snapshot's `phone-subpaths.json` subpaths differ from `core, sport, sports, sports/*, pad` (the preflight found it unchanged since 2.0.0).
- Create: `src/domain/scoring/engineEpochs.test.ts`.
- Throwaway (never merged, no tests; ruling 70's precedent): branch `probe/s2-4-engine` off this task's commit, with a Fold probe chip in the dev twin.

**Interfaces:**

- Produces: the engine every later task imports.
  - `@seazn/engine/sports/cricket`: `orderFromLineup`, `eligibleChangeBowlers`, `oversUsed`, `CricketBowlerChange`, `CRICKET_MARGIN_KINDS`.
  - `@seazn/engine/pad`: `cricketPadRules.{wideDismissalKinds, noBallDismissalKinds}`.
  - Every name was checked against f8ad9bc (preflight §5): all present. `FineInnings` is not exported from `./sports/cricket`: use `InningsState['fine']` or `OverBowlerFacts`.

- [ ] **Step 1: Read the snapshot.** A snapshot has no CHANGELOG or release notes: read `.changeset/cricket-s2-4.md` and `src/sport/fold-epoch.ts` at the snapshot's sha (44699f16…, PR #28's merge commit), and confirm they name P1's items.
  - `FOLD_EPOCH` for every sport the phone scores: cricket 3; badminton 2, tabletennis 2, boardgame 5, football 4, unchanged since 2.0.0. Record the numbers.
  - The peer range is still `zod ^4.4.3`.
  - `phone-subpaths.json`: same subpaths; diff its `closure.modules` against 2.0.0's. Any added module is read for purity: no react, nothing effectful.
- [ ] **Step 2: Failing test** `engineEpochs.test.ts`: `the engine's epochs are the ones each sport sends`.
  - Literals from `fold-epoch.ts` at the snapshot's sha: `badmintonSport.epoch === 2`, `tableTennisSport.epoch === 2`, `chessSport.epoch === 5`.
  - Run on 2.0.0: it fails only if an epoch moved. For cricket, add `foldEpochOf('cricket') === 3`; it fails on 2.0.0. Task 20 re-reads every literal from the release.
- [ ] **Step 3: Install.** Registry auth is user-level, never the project `.npmrc` (R4 doc):
  - `pnpm config set '//npm.pkg.github.com/:_authToken' '${NODE_AUTH_TOKEN}'` (the literal; once per machine).
  - Then `NODE_AUTH_TOKEN=$(gh auth token) pnpm install` after editing the pin. The token is never printed.
  - `node_modules/@seazn/engine/package.json` reads `0.0.0-pr28.44699f16400a367a87747b8390c40fe16e1ff8f2`. Nothing autolinks (`expo-modules-autolinking resolve -p android` names no engine package).
- [ ] **Step 4: Verify.** Engine-facing tests by path: `src/domain/scoring` (the directory, chess's files included), `src/services/fakeScoringPort.test.ts`, `src/services/tapQueueStore.test.ts`, `test/domainBoundary.test.ts`, `test/sportBoundary.test.ts`.
  - `numFailedTests` 0, and `numTotalTests` equals the 2.0.0 count plus the new tests.
  - Type-check `src/domain/scoring/*.ts` (tsc of the touched files).
- [ ] **Step 5: Mutate.** Set the pin back to 2.0.0 in `node_modules` (a `cp` backup of the package dir): `engineEpochs` fails on cricket. Restore. Commit `chore(engine): take the cricket engine snapshot (0.0.0-pr28) for every sport`.
- [ ] **Step 6: CI auth.** `check.yml` runs on pull requests and on main only, so the install is proved when the branch's PR opens (Task 20, or a draft PR the controller opens earlier). It installs with `GITHUB_TOKEN` (`packages: read`), which already reads this package (preflight §0). A 401 is a finding for the owner (package access), not a code change.
- [ ] **Step 7: R4 on the probe branch.**
  - Fold probe: strict `foldMatch` × 50 of each synthetic match:
    - badminton bo3 (76 events);
    - table tennis bo5;
    - cricket T20, both innings (≈ 260 balls with wides, wickets and a super over, ≈ 280 events);
    - chess.
  - Show `events · min / median / max ms`.
  - Build arm64 from a clean detached worktree; `adb -s 12be753e install -r`. The owner taps it three times.
  - Record the numbers in the R4 doc. A crash is a blocker. Over 16.7 ms median for cricket is a finding for Task 19 item 10, not a blocker.
  - The runtime's own cost is timed after Task 12 (Task 12 Step 6, preflight F22): `foldCricket` with 12 queued taps, and one `endsInnings`.
- [ ] **Step 8: Batch 1 device check (owner).** The build of Task 1's commit:
  - Score a staging badminton match, a table tennis match and a chess match through a game, Undo, then the result.
  - Each behaves as on 2.0.0. Record in the R4 doc. Opus review of the commit; nothing merges here.

## Batch 2: lineup, picks, and cricket in the domain (Tasks 2–8)

On `feat/s2-4-cricket` (rebased on origin/main d62eb99, chess merged), in worktree `s2-4-build`. Task 2 starts by cherry-picking 93f4c35 (P3).

### Task 2: The lineup from the team sheet, in the bootstrap's order (generic)

**Files:**

- First: `git cherry-pick 93f4c35`, unchanged (P3).
- Create: `src/domain/scoring/teamSheet.ts` (+ test): the one generic team-sheet builder, for cricket and football (preflight F2).
- Not touched (preflight F3): `setBasedEngine.ts`'s `lineupOf` and its importers, `setBasedFold.ts:16`, `chessFold.ts:34`, `fakeScoringPort.ts:14`, and their tests (`setBasedEngine`, `setBasedBoard`, `chessEngine`). Aligning set-based lineups with the server is a separate item with its own tests, recorded in Task 20's results.

**Interfaces:**

- Consumes: P3's `BootstrapSlot {personId, pairOrder, slot?, positionKey?, orderNo?, role?, roles?, squadNumber?}`.
- Produces `teamSheetOf(side: BootstrapSide): {lineup: Lineup; sheet: boolean}` (the name is the builder's), the shape of football's `footballLineupOf` (f23f8ce, `footballEngine.ts:38`):
  - The rows keep the bootstrap's order. Nothing re-sorts them (spec §6 as amended, preflight F1).
  - Each row as web `buildLineup` (`lineups.ts:47`), field for field as football's `sheetSlot`:
    - `slot: row.slot ?? 'starting'`;
    - `orderNo: row.orderNo ?? i + 1`, `i` the row's place in the bootstrap's order, per side;
    - `positionKey`, `roles` and `squadNumber` when present;
    - `role` when present and not `'player'`.
  - A side whose rows carry no `slot` (a web older than P2): every row starting, `orderNo` i + 1, `sheet: false`.
  - No `pairOrder`: the set-based builder keeps it.
- Whichever of cricket and football lands second adopts the other's builder; football's `footballLineupOf` then calls this one.

- [ ] **Step 1: Failing tests:**
  - `rows keep the bootstrap's order`: person ids `p-d`, `p-a`, `p-c`, `p-b` with `orderNo` 1, 2, absent, absent → slots in that order with `orderNo` 1, 2, 3, 4 (literals; a sort by person id or by name fails it).
  - `a bench row stays bench and a coach row carries role coach`.
  - `a row with no slot on a sheet starts`.
  - `rows with no slot fold as all starting` (and `sheet` is false).
  - `orderFromLineup over teamSheetOf is the starting players in order_no order` (a 6-row side with a bench and a coach → the 4 starters, literals).
- [ ] **Step 2:** Run; the new tests fail.
- [ ] **Step 3:** Implement. Nothing else changes.
- [ ] **Step 4:** Verify: `teamSheet.test.ts`, `wire.test.ts`, `wireBootstrap.test.ts`, and, unchanged, `setBasedEngine.test.ts`, `setBasedBoard.test.ts`, `chessEngine.test.ts`, `chessFold.test.ts`, `src/services/fakeScoringPort.test.ts`. The unchanged files' counts equal their counts before the task.
- [ ] **Step 5:** Mutate each guard once, restoring from a `cp` backup each time:
  - a re-sort by `personId` → `rows keep the bootstrap's order` fails;
  - the `i + 1` fallback (→ `i`) → the same test fails;
  - the `slot ?? 'starting'` default → `a row with no slot on a sheet starts` fails;
  - the `sheet` test (always true) → `rows with no slot fold as all starting` fails on `sheet`.

  Commit `feat(scoring): the lineup from the team sheet, in the bootstrap's order`.

### Task 3: Pending picks, kept with the queue (generic)

**Files:**

- Create: `src/domain/scoring/pendingPicks.ts` (+ test).
- Modify:
  - `queue.ts:136` (`BootCache.picks`);
  - `src/services/tapQueueStore.ts:681-711` (`encodeBoot` / `decodeBoot`);
  - `scoringSport.ts` (`SportFoldInput.picks?`);
  - `scoringMatchState.ts` (`MatchState.picks`, `MatchHeld.picks`, event `setPicks`);
  - `scoringMatch.ts:72`;
  - `scoringMatchTaps.ts` (`onSetPicks`);
  - `scoringMatchSaves.ts:27-31`;
  - `scoringMatchFold.ts:27` (`sameInput`);
  - `scoringMatchView.ts`;
  - `src/hooks/scoringRunner.ts:407`;
  - `src/hooks/useScoringMatch.ts` (action `setPicks`).
- Test: `tapQueueStore.test.ts`, `scoringMatch.test.ts`, `scoringMatchSaves.test.ts`, `scoringRunner.test.ts`.

**Interfaces:**

- Produces:
  - `PendingPicks = Readonly<Record<string, readonly string[]>>` and `NO_PICKS`.
  - `readPicks(raw: unknown): PendingPicks | undefined`, the one reader. A key matches `/^[a-z][A-Za-z0-9.]{0,63}$/`, at most 32 keys, at most 64 ids each, each id 1–64 characters; anything else is garbled.
  - `samePicks(a, b): boolean`.
  - `BootCache = {bootstrap; toss; picks: PendingPicks}`. A boot file with no `picks` reads as `NO_PICKS` (files written before this change), and `FILE_VERSION` is unchanged.
  - `SportFoldInput.picks?: PendingPicks` (absent = none, so no other sport's fixtures change).
  - `MatchEvent {kind: 'setPicks'; picks: PendingPicks}` replaces the whole map. It is taken whenever the match folds, and saved with the boot cache (`bootMoved` compares `picks` by reference).
  - `useScoringMatch(...).actions.setPicks(picks)`.
  - Picks are never sent and never in the record. A pick is a person id, which the record rule forbids, so the store's `LINK_SECRET` check and the record scrub stay as they are.

- [ ] **Step 1: Failing tests:**
  - `picks round-trip the boot file`.
  - `a boot file without picks reads as none`.
  - `a garbled picks key makes the boot file unreadable` (key `"1x"`).
  - `setPicks saves the boot cache once` (a second identical `setPicks` saves nothing).
  - `the fold is asked again when picks change and not otherwise`.
  - `a reopened match folds with the picks it was killed with` (scoringRunner, fake store).
  - `Undo never changes picks` (preflight D4: this task has no over; the over's half of Review Focus 2 is Task 5's).
- [ ] **Step 2–4:** Fail; implement; verify with the five test files plus `badmintonSport.test.ts`, `tableTennisSport.test.ts`, `chessSport.test.ts` (unchanged).
- [ ] **Step 5:** Two guards dedupe a second identical `setPicks` (preflight F23): `samePicks` in the reducer (the state does not change, so nothing refolds) and the reference comparison in `bootMoved` (the boot cache is not saved). Mutate each once:
  - `samePicks` → always false: `the fold is asked again when picks change and not otherwise` fails;
  - the `bootMoved` picks comparison → always true: `setPicks saves the boot cache once` fails;
  - `readPicks`' key pattern (accept any key) → `a garbled picks key makes the boot file unreadable` fails.

  A mutant no test kills gets the smallest test that kills it. Commit `feat(scoring): pending picks kept with the queue`.

### Task 4: Cricket's engine input, and a ledger for tests

**Files:** Create `src/domain/scoring/cricketEngine.ts` (+ test), `src/domain/scoring/engineRefusal.ts` (+ test) and `test/cricketLedger.ts`.

**Interfaces:**

- Consumes: Task 2's `teamSheetOf`; `envelopeOf`, `queuedEnvelopeOf`, `queuedEventId` (`setBasedEngine.ts`).
- Produces:
  - `engineRefusalOf(module, match, events): {code: string; reason: string | null} | null`, generic (preflight D6): football's `footballRefusalOf` (f23f8ce) with the engine module as a parameter. Strict from the last event's seq; the `reason` its data names, else null; anything but an `EngineError` is rethrown. Whichever of cricket and football lands second adopts it. `setBasedRefusalOf` stays as it is (F3).
  - `CricketEngineMatch = {fixtureId; cfg: CricketCfg; lineups: LineupPair}`.
  - `cricketCfg(raw: unknown): CricketCfg | null` (`cricket.configSchema.parse`, null on a throw).
  - `cricketRefusalOf(match, events)`: `engineRefusalOf` over the cricket module.
  - `playersEntered(lineups): {first: boolean; second: boolean}`: at least two starting players by `orderFromLineup`.
- `test/cricketLedger.ts`:
  - Sides: `HOME`, `AWAY` (entrants `ent-home`, `ent-away`). Each has 11 starters `H-p1…H-p11` with `orderNo` 1–11, `H-p2` with `roles: ['wicketkeeper']`, a bench row `H-p12` and a coach row; names `Home Player n`.
  - Bootstraps: `NO_AWAY_PLAYERS` and `NO_SLOTS`.
  - Cfgs, every one with `minOversForResult` set (the preview's finding). The overs key is `ballsPerInnings` (`cricket.ts:66`), so "2 overs" of 6 balls is `ballsPerInnings: 12`: `KO_2` (2 overs, 6 balls, `maxOversPerBowler: 1`, `superOver: true`, `minOversForResult: 1`), `LEAGUE_2` (same, `superOver: false`), `T20`, `TWO_INNINGS` (`inningsPerSide: 2`, follow-on enabled).
  - Builders: `toss`, `start`, `ball({...})`, `superBall`, `summary`, `retire`, `bowlerChange`, `declare`, `voiding`; `ledgerOf`, `queuedOf`.
  - Fixtures: `OVER_ONE_DONE`, `ALL_OUT_FIRST`, `TIED_KO`, `T20_LONG` (≈ 280 events).

- [ ] **Step 1: Failing tests:**
  - `a 2-over cfg without minOversForResult is null`.
  - `the bench and the coach are not in the batting order`.
  - `a bench batter is refused` (`cricketRefusalOf` returns a code).
  - `a wide and two run is runs 3` (fold one `{wide, runs: 3}` ball: innings runs 3, legal balls 0).
  - `a reversed pair is taken and any other pair refused` (CK-SS-1).
  - `a bowler change mid-over is taken; neither bowler may bowl the next over` (CK-BC-1, f94a767).
  - `playersEntered is false for a side with one starter`.
  - `engineRefusalOf rethrows an error that is not the engine's` and `it reads the reason its data names`.
- [ ] **Step 2–5:** Fail; implement; verify; mutate the two-starter floor and `engineRefusalOf`'s rethrow (swallow it → the rethrow test fails). Commit `feat(cricket): the engine's input and a test ledger`.

### Task 5: The fold, the display and the picks

**Files:** Create `src/domain/scoring/cricketTypes.ts`, `cricketPicks.ts`, `cricketFold.ts` (+ tests).

**Interfaces:**

- Produces in `cricketTypes.ts`:
  - `CricketTap`, one of:
    - `{kind: 'toss'; wonBy: PadSide; elected: 'bat' | 'bowl'}`
    - `{kind: 'start'}`
    - `{kind: 'ball'; ball: CricketBallTap}`
    - `{kind: 'summary'; runs; wickets; legalBalls}`
    - `{kind: 'retire'; person; reason; incoming: string | null}`
    - `{kind: 'more'; type: CricketMoreType; payload: unknown}`
    - `{kind: 'bowlerChange'; bowler: string; reason: 'incapacitated' | 'suspended' | 'other' | null}`
  - `CricketBallTap = {bat: number; extra: {kind: 'wide' | 'noball' | 'bye' | 'legbye' | 'penalty'; runs: number} | null; boundary: 4 | 6 | null; wicket: CricketWicketTap | null}`.
  - `CricketWicketTap = {kind; out; fielder: string | null; fielderAssist: string | null; incoming: string | null}`.
  - `CricketDisplay`:
    - `sides` (names, entrant ids; `first` = home);
    - `stage: 'toss' | 'setup' | 'live' | 'break' | 'superOverSetup' | 'totals' | 'tiedNoPlayers' | 'decided'`;
    - `toss: {wonBy: PadSide; elected} | null`;
    - `innings: {ordinal; superOver: boolean; batting: PadSide; runs; wickets; legalBalls; ballsLimit: number | null; chase: {need; balls; target} | null} | null`;
    - `crease: {striker: BatterLine; nonStriker: BatterLine} | null`, with `BatterLine = {id; name; runs; balls}`. It carries every pick's effect (preflight F6): a standing `swap` pick (the pair reversed) and a super over's replacement at the empty end;
    - `bowler: {id; name; figures: string} | null`: the fold's, else the over's pick (F6);
    - `state`: the folded `CricketState`, which Task 12's `endsInnings` applies a candidate ball to (preflight F7);
    - `over: {number; chips: readonly OverChip[]}`, with `OverChip = {text; tone: 'dot' | 'run' | 'boundary' | 'extra' | 'wicket'}`;
    - `freeHit: boolean`;
    - `needs: 'openers' | 'bowler' | null`;
    - `battingOrder: readonly string[]` (the pick merged over `orderFromLineup`);
    - `players: {first; second}` (`{id; name; keeper: boolean}[]`);
    - `entered: {first; second}`;
    - `result: {margin: string; winner: PadSide | null} | null`;
    - `scorecard`;
    - `cfg`;
    - `lastTap`, `undoable`.
  - `CricketTypes`.
- Produces in `cricketPicks.ts`:
  - Keys: `order.first`, `order.second`; `openers.<ordinal>` = [striker, nonStriker]; `bowler.<ordinal>.<over>` = [id]; `incoming.<ordinal>` (a super over's replacement); `swap.<ordinal>.<legalBalls>` = [striker, nonStriker].
  - `<ordinal>` is `i1`…`i4` for the main innings and `s1`, `s2`, … for super-over innings.
  - `CricketPick` is a union of those five.
  - `withPick(picks, display, pick): PendingPicks` writes the key and drops keys of innings and overs already past.
  - `picksFor(picks, display): {order; openers; bowler; incoming; swap}`.
- Produces in `cricketFold.ts`: `foldCricket(input: SportFoldInput): SportFold<CricketTypes>`, `undoneTap`.
  - Figures come from `deriveCricketScorecard`.
  - Chase from `chaseTarget`. The super-over target is the first super-over innings' runs + 1: a Laws value, since the engine has no export for it (it decides the result at `cricket.ts:2067-2070`), pinned by a literal test (preflight F17).
  - `needs`: `openers` when the open innings has no ball and no `openers` pick; `bowler` when an over is due and there is no pick for it.
  - `legalQueued`: one strict fold per queued tap through `streamOf` (`setBasedFold.ts:153-173`), reused, never copied (preflight D6); an illegal tap is skipped and the rest are still judged.
  - A pick naming a person no longer in the lineup (the organiser edited the sheet) is ignored.
  - Stage `totals` when either side is not `entered` (§4.10). An innings with a summary stays `totals` until the next innings.

- [ ] **Step 1: Failing tests**, values from the spec and the Laws:
  - `before the toss the stage is toss; after it, setup`.
  - `the openers' pick is the crease before the first ball`.
  - `a no-ball makes the next ball a free hit`.
  - `the over strip reads ·, 1, 4, wd, nb, W` (chips for a scripted over).
  - `odd runs swap the strike; a wicket ball never does` (§4.2).
  - `an over's end needs a bowler unless one is picked for that over`.
  - `undoing the over's first ball shows the picked bowler again`.
  - `the chase reads need 9 off 12 balls before its first ball` (`KO_2`, 1st innings 8 off 2 overs), and `after a maiden it reads need 9 off 6 balls` (the ledger stated, preflight D7).
  - `a super over of 7 sets a target of 8` (the Laws' literal, F17).
  - `a reordered yet-to-bat order is the display's order`.
  - `a standing swap pick is the display's crease, reversed` (F6).
  - `legalQueued drops a ball whose ballInOver the ledger already holds`.
  - `a side with no players is totals`.
  - `a tie in totals mode is tiedNoPlayers` (ruling 74), under `KO_2`: under `LEAGUE_2` a tie is the result "tied" (preflight §2, T17).
  - `a stale bowler pick for a past over is ignored`.
  - `a pick naming a person no longer in the lineup is ignored` (the four questions: an empty input).
  - `a bootstrap with no order_no at all gives the batting order in its row order` (the setup screen's empty input).
- [ ] **Step 2–5:** Fail; implement; verify; mutate `needs`, the drop of past keys, the lineup check on a pick, and `legalQueued`'s skip of an illegal tap. Commit `feat(cricket): the fold, the display and the pending picks`.

### Task 6: Taps as events

**Files:** Create `src/domain/scoring/cricketEvents.ts` (+ test).

**Interfaces:**

- Consumes: Task 5's types and its display, which carries every pick's effect (preflight F6). `SportEventContext` stays `{bootstrap, display}`: nothing generic changes.
- Produces:
  - `cricketEventFor(tap: CricketTap, ctx: SportEventContext<CricketTypes>): SportEvent | null`, reading the display alone.
  - `cricketPayloadForSend(queued, ledger, copied): unknown`: the payload as queued, never restamped.

  Ball:
  - `over = floor(legalBalls / ballsPerOver)`, `ballInOver = legalBalls % ballsPerOver + 1`.
  - `striker` / `nonStriker` from the display's crease, which is already reversed when a `swap` pick stands for this ball.
  - `bowler` from the display's bowler (the fold's, else the over's pick).
  - In a super over the type is `cricket.superover.ball`, with the replacement the display already holds at the empty end.
  - `wicket.bowlerCredited` = `cricketPadRules.bowlerCreditedKinds.includes(kind)`.
  - `incoming` is on every main-innings wicket that does not end the innings, and never in a super over.
  - `boundary` from the 4 and 6 keys, and from a no-ball's bat 4 and 6 (preflight F13; the web sends the same, W7). Never on an all-run 4 or 6 (ruling 73).
  - Null when the crease or the bowler is unknown.

- [ ] **Step 1: Failing tests:**
  - Each tap's exact type and payload.
  - `a wide with two run sends extras {kind: wide, runs: 3}`.
  - `a no-ball 4 off the bat sends bat 4, extras {noball, runs: 1} and boundary 4`, and the same for a 6 (F13).
  - `an all-run 4 carries no boundary` (ruling 73).
  - `penalty rides a fair ball only` (§4.2).
  - `freeHit is never sent`.
  - `a swap pick reverses the pair on the next ball only`.
  - `a super over's second batter rides the next ball, not incoming`.
  - `bowlerCredited is false for a run out and true for bowled`.
  - `payloadForSend never moves over or ballInOver`.
  - `never core.forfeit` (no tap makes one): the sweep asserts the count of tap kinds it swept (7, one per `CricketTap` kind), and zero is a failure (preflight D5).
- [ ] **Step 2–5:** Fail; implement; verify; mutate the super-over `incoming` guard and the no-ball `boundary` clause. Commit `feat(cricket): taps as the events the server records`.

### Task 7: Rules rows, History words, results, the sport module

**Files:**

- Create: `cricketRules.ts`, `cricketHistory.ts`, `cricketResult.ts`, `cricketSport.ts`, and `cricketPad.ts` (moved here from Task 8, preflight F8: `ScoringSport.pad` is required, so `cricketSport` does not type-check without it) (+ tests).
- Modify: `sports.ts`, `eslint.config.mjs` (`SPORT_MODULES`, `SPORT_OWN_FILES`), `test/sportBoundary.test.ts`, `src/i18n/{en,es,fr,nl}.json`, `docs/i18n-glossary.md`.

**Interfaces:**

- `cricketRuleRows(cfg: CricketCfg): PadRuleRow<CricketPadKey>[]`: overs per innings (or "Unlimited"), balls per over, players a side, max overs per bowler, super over on/off, and follow-on and reviews only when the format has them (§4.1).
- `cricketLedgerHistory(...)`: words for every key of `cricket.eventSchemas` (the console records types the phone never sends, such as `cricket.player.line`), plus `core.void` and the `core.*` types a ledger can hold (`core.lineup.*` included) (preflight F21).
- `cricketPad(display, sync): PadView<CricketPadKey>`: halves carry the side names, `start: null`, `tools: []`, `card` as every sport, `lastTap`. Task 8 adds the board.
- `cricketResultWords(margin): PadText`: a key for every `CRICKET_MARGIN_KINDS` value (§4.7; the fold's `headline` is a score line, never used as words).
- `cricketSport: ScoringSport<CricketTypes>`:
  - `key 'cricket'`, `epoch foldEpochOf('cricket')`, `fold memoFold(foldCricket)`;
  - `tossOf: () => null` (the cricket toss is an event, not the generic serve pick);
  - `notStarted` = stage `toss` or `setup`; `decided` = stage `decided`;
  - `resultLine` = each innings' `runs/wickets`, joined `" · "`, e.g. `"25/3 · 25/4"` (five a side, all out at 4; spec §9): numbers only;
  - `awaitingEnding: () => false`.

- [ ] **Step 1: Failing tests:**
  - Rule rows for `KO_2`, `T20`, `TWO_INNINGS` (literals).
  - History rows in en and nl for a wide with runs, a caught with fielder, a retirement and a bowler change.
  - `every cricket event type has History words`: a sweep over `cricket.eventSchemas`' keys, asserting the count (the schema's key count; zero is a failure).
  - `every margin kind has words in four dictionaries`.
  - `notStarted at setup and at the toss; not after Start`.
  - `sportFor('cricket') is the module`.
  - `cricketSport.epoch is the engine's for 'cricket'` (`vi.mock` as `tableTennisSport.epoch.test.ts`, cricket → 9).
  - `cricketPad's halves carry the side names`.
  - Boundary: `a generic file importing cricketPad fails lint`.
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16), restoring from a `cp` backup:
  - the follow-on and reviews rows' format gate (always shown) → `KO_2`'s rule rows fail;
  - `notStarted` (drop `setup`) → `notStarted at setup` fails;
  - a type dropped from the History words → the sweep fails;
  - `decided` (any stage) → a test that a live match is not decided fails (add it if none does).

  Commit `feat(cricket): rules, History words, results, the sport`.

### Task 8: The fake, the match hook, a read-only board and the route

**Files:**

- Create: `src/services/fakeCricketPad.ts` (seeds), `src/hooks/useCricketMatch.ts` (+ test), `src/ui/screens/CricketMatchScreen.tsx`, `CricketPadScreen.tsx`, `CricketBoard.tsx` (+ tests).
- Modify:
  - `src/domain/scoring/cricketPad.ts` (Task 7's): adds `cricketBoard`.
  - `src/services/fakeScoringPort.ts:44-68` (preflight F10): keep main's `FakeSport {module; cfg(raw); refusalOf(match, events): string | null}`, which chess already generalised. `FakeSportKey` gains `'cricket'`; its row's `refusalOf` wraps `cricketRefusalOf` to return `code`. Add football's `lineupsOf(sides)`, built with Task 2's `teamSheetOf` (F2); whichever branch lands second keeps one.
  - `src/ui/screens/scoringScreens.ts` (a `cricket` row).
  - `src/ui/components/PadContent.tsx` (preflight F9): no branch has football's `body` hunk yet, so implement `body?: ReactNode` exactly to football's plan interface: drawn in the halves' place when there is no `instead` card and no Start screen. Tell s2-5; whoever lands second keeps one.
  - `src/ui/theme/tokens.ts`: `layout.scorePanel`, `layout.creaseRow`, `layout.overStrip` (fixed heights, gap 8).
- The generic changes here (`FakeSport`, `PadContent.body`) are on spec §6's amended list (preflight F18).

**Interfaces:**

- `cricketBoard(display): CricketBoardView = {score: {runs; wickets; overs; side; innings; chase: string | null}; crease: [BatterLine & {striker: boolean}, BatterLine] | null; bowler; over; status: PadText | null}`.
- `useCricketMatch(fixtureId): CricketPadModel = PadScreenModel & {board: CricketBoardView; display: CricketDisplay | null; actions}`, on `useScoringMatch(id, cricketSport, …)`. `actions` here: `record(tap: CricketTap)` (queues the tap through the runtime; a ball, a toss, Start), `setPicks(picks: PendingPicks)` and `undo()`. Tasks 10 to 17 add theirs over these.
- `CricketBoard({view, onOpenPlayers})`: score in lime, then crease, bowler O-M-R-W, and the over strip with fixed-width chips. Every region has a fixed height.

- [ ] **Step 1: Failing tests:**
  - `a cricket link opens on the cricket screen` (routed, fake port).
  - `the board shows 25/3 (2 ov) and the crease with the striker marked`.
  - `each board region's height is its token, with an empty over and with a six-ball over with two extras` (`layout.scorePanel`, `creaseRow`, `overStrip`; preflight D1). "Nothing moves" is Task 19's, on the phone.
  - `History lists a ball recorded on the console in words`.
  - `the four languages render the board`.
  - `PadContent draws body in the halves' place, and not over an instead card or the Start screen`.
  - padFit: the score line, the chase line and the crease at 320 and 360 dp, with the longest names.
- [ ] **Step 2–5:** Fail; implement; verify (plus the unchanged `PadContent.test.tsx`, `fakeScoringPort.test.ts` and `ChessPadScreen.test.tsx`); mutate `PadContent`'s `body` guard (draw it over an `instead` card) → the body test fails. Commit `feat(cricket): the screen, read only, and the fake`. Opus Batch 2 review.
- [ ] **Step 6: Batch 2 device check (owner).**
  - arm64 build, `adb -s 12be753e install -r`.
  - Scan a staging cricket link (P2 on staging). On the web pad, the controller records a toss, Start and an over.
  - The phone's board and History follow ball for ball (Realtime). Match details lists the format rows.

## Batch 3: Start (Tasks 9–10)

### Task 9: The kit's sheet rows, every sport (rulings 82, 85)

**Files:**

- Modify: `src/ui/components/StepSheet.tsx:16-20, 60-100` (`StepOption`, `StepRow`, styles), `src/ui/components/PadSheets.tsx:26-34` (`StepSheetFacts` carries the new fields).
- Every sheet with rows that take a tap, every sport (ruling 85; preflight F14; read on 2026-11-08, re-verify by grep):
  - `StepSheet`'s `StepRow`, which `TieBreakSheet.tsx:7` (chess) also draws, so the tie-break rows change with it;
  - `HowSheet.tsx:98` (chess): its own `Pressable` choice rows take the same border and states (a shared row style, not a copy).
  - No choice rows, so no prop: `AskSheet`, `DismissSheet` and `ScoreEntrySheet` (a lime `Button` and a `GhostButton`; `ScoreEntrySheet` adds text inputs), and `MatchDetailsSheet` (a `GhostButton`). The preflight listed `ScoreEntrySheet` and `DismissSheet` as drawing rows; their only other `Pressable` is the dim.
- Test: `StepSheet.test.tsx`, `TieBreakSheet.test.tsx`, `HowSheet.test.tsx`, plus every sport's screen tests unchanged: `BadmintonPadScreen.test.tsx` alone, `TableTennisPadScreen.test.tsx`, `ChessPadScreen.test.tsx`, `test/routedApp.chess.tiebreak.test.tsx`.

**Interfaces:**

- `StepOption` gains `disabled?: boolean`, `note?: string | null` and `chosen?: boolean`. Football's `kind: 'choice' | 'heading' | 'toggle'` and `checked` sit beside them once football lands (not merged): a `heading` row has no border; a `toggle` row is lime, as any row that takes a tap (preflight F26; agree with s2-5 before the second branch lands).
- A row that takes a tap has a lime border (`colour.lime`, `layout.iconBorder`).
- A chosen row has a heavier lime border (`layout.iconBorderOn`) on `colour.surface`.
- A disabled row is greyed (`colour.ink3` border and label), with its `note` (the reason) on a second line. It has no `onPress`, and `accessibilityState {disabled: true}`. A screen reader hears the label and the reason.
- Destructive rows (Undo, Remove, End) keep the caution border; every other row that takes a tap is lime (the controller's ruling F29, 2026-11-08: §5's caution means failure or danger, and an orange border warns before a destructive tap; spec ruling 82's note).
- No cricket condition in any of these files.

- [ ] **Step 1: Failing tests** (the jsdom tests read the style's token; what the eye sees is Task 19's, exit item 13, preflight F15):
  - `a row that takes a tap has a lime border`.
  - `a chosen row has the heavier lime border on surface`.
  - `a disabled row ignores a press and says its reason`.
  - `a destructive row stays caution`.
  - `a How row and a tie-break row have the lime border` (chess).
  - Badminton's, table tennis's and chess's sheets render as before. They now have lime borders; their tests assert behaviour, not colour.
- [ ] **Step 2–4:** Fail; implement (tokens only); verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - a disabled row given its `onPress` → `a disabled row ignores a press` fails;
  - the destructive tone branch (always lime) → `a destructive row stays caution` fails;
  - the `chosen` branch (always the plain border) → `a chosen row has the heavier lime border` fails;
  - `HowSheet`'s row style back to its old border → the How row test fails.

  Commit `feat(kit): sheet rows say which take a tap, and why not (rulings 82, 85)`.

### Task 10: The setup: the toss (ruling 83), batting order, openers, bowler, Start

**Files:**

- Create: `src/domain/scoring/cricketSetup.ts` (+ test), `src/ui/screens/CricketSetup.tsx`, `CricketToss.tsx`, `CricketOrderList.tsx` (+ tests).
- Modify: `src/ui/components/TossPicker.tsx:8-14, 24-45, 75-90` (props `fill`, `disabled`, generic options), `src/ui/components/PadContent.tsx:29` and its `TossPicker` call (maps `PadStartSide` to `TossOption`), `TossPicker.test.tsx`, `useCricketMatch.ts`, `CricketPadScreen.tsx`, the dictionaries, the glossary, `padFit.test.ts`.

**Interfaces:**

- Kit (generic; on spec §6's amended list, preflight F18): `TossOption<T extends string> = {id: T; label: string}`; `TossPicker<T>({ask, options, picked, onPick, fill?, disabled?})`.
  - `fill`: the pair grows to fill the parent's height (`flexGrow: 1`, never below `layout.padTossHeight`).
  - `disabled`: greyed (`colour.ink3` border and label), ignores presses, `aria-disabled`, same size as when enabled.
  - Without either prop it behaves exactly as today.
- `setupStep(display, picks): 'toss' | 'order' | 'openers' | 'bowler' | 'ready'`.
- `CricketToss({sides, onRecord})`: the whole screen below the top bar, in two halves of equal flex.
  - Top half: "Who won the toss?" over the two **team names**.
  - Bottom half: "{team} chose to…" over Bat and Bowl, drawn `disabled` (with "Team" in place of the name) until a team is picked.
  - Both are `TossPicker` with `fill`. The won-by choice is held in the hook until Bat or Bowl, which records `cricket.toss {wonBy, elected}`. A second tap on a team before that changes the pick.
  - The won-by choice is in memory only: a process death before Bat or Bowl loses it, and the reopened screen asks the toss again. That is accepted (the four questions: after an interruption).
  - A toss refused on a Draft division reads the generic refusal: the phone does not word `division_not_started` yet (web plan W18). It is a phone follow-up, recorded in Task 20's results.
- `setupView(display, picks): CricketSetupView`: the match card's format line; the batting order (the batting side's starters by `orderFromLineup`, the first two marked Opener, reordered with ▲▼); the openers; the first bowler.
- Actions: `pickTossWinner(side)` (held in memory only); `recordToss(elected)`; `setOrder(side, ids)`, `setOpeners(pair)` and `setBowler(id)` through `setPicks(withPick(...))`; `start()` records `core.start`.

- [ ] **Step 1: Failing tests:**
  - `the toss fills the screen in two halves`: both halves are present before any tap, and the bottom half is disabled.
  - `the second half is greyed and takes no tap until a team is picked`: pressing Bat records nothing.
  - `each half keeps its token size when the first half is answered`: each half's style (flex 1, never below `layout.padTossHeight`) equals its token before and after (preflight D1). "Nothing moves" itself is Task 19's, on the phone.
  - `the toss asks with team names` and `the second half names the picked team`.
  - `a second team tap changes the pick before Bat or Bowl`.
  - `Bat makes the toss winner the batting side`.
  - TossPicker: `fill grows the pair`, `disabled ignores a press and says so`, and `without the props it is unchanged` (the existing TossPicker tests, kept).
  - `the order lists starters only, Opener on the first two`.
  - `Up moves a batter and the openers follow the order`.
  - `Start match waits for openers and a bowler`.
  - `the first ball carries the openers and the bowler` (the queued payload of a ball through Task 8's `actions.record`).
  - `a second tap on Start records one start` (bounce).
  - `a reopened match keeps the batting order and the bowler pick`.
  - `Undo of the toss asks the toss again`.
  - Fit cases at 320 and 360 dp in en, es, fr and nl for both questions, Bat, Bowl and 30-character team names.
- [ ] **Step 2:** Run; the new tests fail.
- [ ] **Step 3:** Implement. Tokens only, JSX ≤ 3 deep, no cricket condition in `TossPicker` or `PadContent`.
- [ ] **Step 4:** Verify these test files: `TossPicker.test.tsx`, `CricketToss.test.tsx`, `CricketSetup.test.tsx`, `CricketOrderList.test.tsx`, `cricketSetup.test.ts`, `useCricketMatch.test.tsx`, `padFit.test.ts`. Also run the start screens that are unchanged: `BadmintonPadScreen.test.tsx` alone, then `TableTennisPadScreen.test.tsx`, then `ChessPadScreen.test.tsx` (`PadContent`'s `needsToss` path maps `PadStartSide` to `TossOption`) and `PadContent.test.tsx`.
- [ ] **Step 5:** Mutate the `disabled` guard (make it take presses) → `the second half is greyed and takes no tap` fails; mutate `fill` (no `flexGrow`) → `fill grows the pair` fails. Restore from a `cp` backup each time. Commit `feat(cricket): the toss on the whole screen, and the setup before the first ball`. Opus Batch 3 review.
- [ ] **Step 6: Batch 3 device check (owner):** on a staging fixture, answer the two-half toss and check nothing moves. Then reorder, pick the openers and the bowler, and Start. The console shows the toss and, after one dot ball, the openers and the bowler.

## Batch 4: the pad (Tasks 11–15)

### Task 11: Run keys, extras sheet, Out / Undo / More, the status line

**Files:**

- Create: `src/ui/screens/CricketKeys.tsx`, `CricketSheets.tsx` (+ tests), `src/hooks/useCricketSheets.ts` (+ test), `src/domain/scoring/cricketExtras.ts` (+ test).
- Modify: `CricketPadScreen.tsx`, dictionaries, glossary, `padFit.test.ts`.

**Interfaces:**

- `extrasSheet(kind, display): CricketStep` (preflight F12, §3 layering): the domain returns its own step type (title, options with id, label, `disabled`, `note`, `chosen`), never `StepSheetFacts` (`ui/components/PadSheets.tsx:26`). `useCricketSheets` maps it to `StepSheetFacts`.
  - Wide: "Runs run" 0–4 → `runs = cricketPadRules.wideDefaultRuns + run` (the engine counts the wide's own run; no hand copy, preflight F17).
  - No-ball: runs off the bat 0, 1, 2, 3, 4, 6 (bat 4 and 6 carry `boundary`, preflight F13) or "runs run" 1–4 (preflight F25: "runs run 0" is bat 0, so it is not offered), sent as one no-ball extra of `cricketPadRules.noBallDefaultRuns + run` (§4.2). The web offers the same ten.
  - Bye, Leg-bye: 1–4.
  - Each sheet has "+ Out". The sheet stays until a choice or Cancel; there is no timer.
- Keys: 0, 1, 2, 3, 4, 6 in two rows of three (4 and 6 are boundaries). Extras row: Wide, No-ball, Bye, Leg-bye. Bottom row: Out, Undo, More, three equal (ruling 79).
- Status line: the last ball, "Free hit", or a refusal in caution.
- `useCricketSheets` sheets: `extras`, `wicket`, `overEnd`, `players`, `more`, `otherRuns`, `overTotals`, `details`, `history`, `ask`, `discard`.

- [ ] **Step 1: Failing tests:**
  - `a 4 records a boundary 4`.
  - `Wide then 2 records runs 3`.
  - `No-ball then 4 off the bat records bat 4, a no-ball and boundary 4`.
  - `the no-ball sheet offers bat 0, 1, 2, 3, 4, 6 and runs run 1–4` (ten options, literals).
  - `the extras sheet has no timer` (fake timers advance 30 s; the sheet is still open, nothing queued).
  - `Cancel records nothing`.
  - `each key row's height is its token before and after a ball` (preflight D1; "the keys never move" is Task 19's, on the phone).
  - `a double tap on a run key records one ball`, and `a double tap on + Out opens one wicket flow` (the four questions: a second call).
  - `Undo takes back this phone's last ball only` (ruling 81).
  - `a free hit says Free hit on the status line`.
  - Fit cases.
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - the run key's bounce → the double-tap test fails;
  - Cancel queuing the shown option → `Cancel records nothing` fails;
  - the free-hit status gate (always shown) → the free-hit test fails, or a test that a fair ball's status names no free hit (add it);
  - Undo's own-tap check (void any last ball) → the Undo test fails;
  - `wideDefaultRuns` dropped from the wide's runs → `Wide then 2 records runs 3` fails.

  Commit `feat(cricket): the run keys and the extras sheets`.

### Task 12: The wicket steps

**Files:** Create `src/domain/scoring/cricketWicket.ts` (+ test). Modify `CricketSheets.tsx`, `useCricketSheets.ts`, dictionaries, `padFit.test.ts`.

**Interfaces:**

- `wicketKinds(display, extra): readonly WicketKind[]`: the engine's set for this delivery, in a scorer's order, without `retired` and `timedout`:
  - a free hit: `cricketPadRules.freeHitDismissalKinds`;
  - a wide: `wideDismissalKinds`;
  - a no-ball: `noBallDismissalKinds`;
  - else `wicketKinds`.
- `WicketFlow`; `startWicket(display, base: CricketBallTap): WicketFlow`; `chooseWicket(flow, choice): {next: WicketFlow} | {done: CricketBallTap}`. Each step is the domain's `CricketStep` (Task 11), which the hook maps to `StepSheetFacts` (preflight F12).
- Steps: how out; who's out (only `variableOutKinds`); fielder (`fielderCreditedKinds`, optional for `fielderOptionalKinds`); assist (run out, ≠ fielder); runs completed 0–3 (run out only); next batter.
- Where a run out's completed runs go (preflight F24; the web's rule): `runs.bat` on a fair ball; `defaultRuns + completed` in a wide's or no-ball's `extras.runs`; the bye's or leg-bye's own runs.
- `fieldersFor(kind, display)`: a stumping offers the keeper (roles `wicketkeeper`, else position `WK`), else the fielding side without the bowler. Any other kind offers the whole fielding side. The two keys are typed, and a test asserts each is in `cricket.positions` (module member, `cricket.ts:3916`; catalog `:2856-2867`) roles or groups, so an engine rename fails it (preflight F17, web W10; the web does the same).
- `endsInnings(display, ball): boolean` (preflight F7): applies the candidate ball, without `incoming`, strictly to `display.state` (Task 5's folded `CricketState`), as the web's `wicketEndsInnings` does. True when the innings is closed afterwards or the match is no longer live. A refusal reads false, so the step is asked. One rule in both plans.
- Next batter: `eligibleIncomingBatters`, the suggestion from the phone's order and the batters in (not the engine's index), marked chosen (ruling 82). Retired-not-out batters are offered with "Retired".

- [ ] **Step 1: Failing tests** (sets copied from spec §4.3):
  - `a free hit offers run out and obstructing only`.
  - `a wide offers hit wicket, obstructing, run out, stumped`.
  - `a no-ball offers exactly noBallDismissalKinds` (the engine's set, its count asserted).
  - `stumped offers the keeper only`.
  - `stumped without a keeper offers the side without the bowler`.
  - `the keeper keys are in the engine's position catalog` (F17, W10).
  - `run out asks who, fielder, assist, runs`.
  - `a run out's completed runs go to the bat on a fair ball, to the extra's runs off a wide or a no-ball, and to a bye's runs` (F24; each payload folds).
  - `assist cannot be the fielder` (disabled with its reason).
  - `no incoming on the super over's second wicket`.
  - `no incoming on the last ball of the innings`.
  - `no incoming at all out (players − 1)`.
  - `a run out whose completed runs win the chase asks no next batter` (the web's Review Focus 3): needing 2, completed 2 → no step; completed 0 → asked.
  - `a wicket off a wide on the last legal ball still asks who walks in` (the web's Review Focus 2).
  - `the suggested batter follows the reordered order`.
  - `Out from the wide sheet records one ball` (extra and wicket together).
- [ ] **Step 2–5:** Fail; implement; verify; mutate `endsInnings` (always false; and a refusal read as true), the keeper filter, and the completed runs' placement; commit `feat(cricket): the wicket steps`.
- [ ] **Step 6: R4 again (preflight F22).** On the probe branch, rebased onto this task's commit: time `foldCricket` with 12 queued taps (an offline two overs) on `T20_LONG`, and one `endsInnings`, on the phone as in Task 1 Step 7. Record them in the R4 doc; over 16.7 ms median is a finding for Task 19 item 10.

### Task 13: The over-end sheet; the mid-over change and the swap in More (ruling 84)

**Files:** Create `src/domain/scoring/cricketBowling.ts` (+ test). Modify `CricketSheets.tsx`, `useCricketSheets.ts`, dictionaries, `padFit.test.ts`.

**Interfaces:**

- `bowlerRows(display): {id; name; figures; oversLeft: number | null; can: boolean; reason: 'lastOver' | 'outOfOvers' | null}[]`, eligible first, from `eligibleBowlers` and `oversUsed`. Reasons: "Bowled the last over", "Out of overs ({max})".
  - `lastOver` reads `prevOverBowlers` (`cricket.ts:520`) as well as `prevOverBowler`, so after a split over both bowlers show the reason (preflight §2, T13). `FineInnings` is not exported: type it as `InningsState['fine']` or `OverBowlerFacts`.
  - With none eligible (spec §4.4 as amended, preflight F5): over totals are offered only while the open innings has no ball, since the engine refuses a summary for an innings recorded ball by ball (`cricket.ts:1842-1844`). Otherwise the sheet says no bowler can bowl and to ask the organiser, as the web's `noEligible`.
- `changeRows(display)`: from `eligibleChangeBowlers`.
- Entry points (ruling 84, the owner: "In More"): More gains "Change bowler (injury)", shown only mid-over with `changeRows` non-empty, which opens the bowler then the reason (`incapacitated` / `suspended` / `other`, from `CricketBowlerChange`'s enum); and "Swap strike", shown only between balls of a main innings, which sets the `swap` pick. The engine refuses a change in a super over and before an over's first ball (engine ruling 278): More hides it there. The engine accepts a reversed pair in a super over (`cricket.ts:1603-1622`), but ruling 84 scopes the swap to a main innings, so neither app offers it there (preflight F28, web W9).

- [ ] **Step 1: Failing tests:**
  - `the over-end sheet greys the last over's bowler with its reason`.
  - `a bowler out of overs reads Out of overs (1)`.
  - `a pick is held until the over's first ball and rides it`.
  - `no eligible bowler before the innings' first ball offers over totals` and `no eligible bowler after a ball says ask the organiser, with no over totals` (F5).
  - `Change bowler records cricket.bowler.change and greys both bowlers for the next over, each with its reason` (`prevOverBowlers`); `Swap strike sends the reversed pair on the next ball`.
  - `no Swap strike in a super over` (pinned, not read from the engine; F28).
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - the eligibility reasons: drop the `prevOverBowlers` clause → the split-over test fails; swap `lastOver` and `outOfOvers` → the reason tests fail;
  - the over-totals offer's "no ball yet" gate (always offered) → the F5 test fails;
  - the change's mid-over gate (shown at an over's end) → a test that More has no change at an over's end fails (add it);
  - the swap's super-over hide → `no Swap strike in a super over` fails.

  Commit `feat(cricket): the next bowler, a mid-over change, a strike swap`.

### Task 14: The Players sheet (rulings 77, 78)

**Files:** Create `src/ui/screens/CricketPlayersSheet.tsx` (+ test), `src/domain/scoring/cricketPlayers.ts` (+ test). Modify the dictionaries and `padFit.test.ts`.

**Interfaces:**

- `playersView(display, picks): {batting: rows (out: how and runs (balls) / in: runs (balls), ● striker / yet to bat / retired not out); bowling: rows (O-M-R-W, overs left, can't-bowl-next reason)}`. Figures come from `deriveCricketScorecard` only.
- Yet to bat reorders (▲▼) at any time through `setPicks`. Between overs, a tap on an eligible bowler sets the next-bowler pick. Mid-over the bowling tab is read-only.

- [ ] **Step 1: Failing tests:**
  - `a tap on the score panel opens Players on Batting`.
  - `a reorder changes only the next suggestion` (nothing queued).
  - `mid-over the bowling tab takes no tap`.
  - `between overs a tap sets the next bowler`.
  - `a scripted over shows its bowler's figures`: literal O-M-R-W from the scripted over (e.g. `1-0-9-1`), never values built with `deriveCricketScorecard`, which the view itself reads (preflight D3).
  - Fit cases.
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - the bowling tab's mid-over read-only gate (taps taken) → `mid-over the bowling tab takes no tap` fails;
  - the between-overs tap offered to an ineligible bowler → a test that a greyed bowler takes no tap fails (add it);
  - the reorder queuing an event → `a reorder changes only the next suggestion` fails.

  Commit `feat(cricket): the Players sheet`.

### Task 15: More, and Other runs and penalty

**Files:** Create `src/domain/scoring/cricketMore.ts` (+ test). Modify the sheets, the hook, the dictionaries and `padFit.test.ts`.

**Interfaces:**

- `cricketMoreItems(display): readonly CricketMoreItem[]`: the §4.8 table, each gate read from the fold and `cfg`; empty in a super over. Items: retire, declare, close, interruption, revise, newBall, powerplay, followOn, matchClose, review, changeBowler and swapStrike (per Task 13).
- Interruption and Revise are live only on the phone (spec §4.8 as amended, preflight F20): More opens only from the pad, and the setup screen has no More. The engine takes both before Start too; the organiser records them there on the web.
- The first row is always `otherRuns`: 5, 7, all-run 4, all-run 6 (no `boundary`), and +5 penalty on a fair ball. The penalty sends `extras {penalty, runs: cricketPadRules.penaltyRuns}`; the controller's reading is a following row of runs off the bat 0–6 (ruling 79 leaves it open).
- Each item's steps: Retire (who, reason from `retireReasons`, incoming); Revise (overs and/or target entered, never computed); Interruption (kind, overs lost); Review (by, kind, outcome).

- [ ] **Step 1: Failing tests:**
  - One per §4.8 row, shown and hidden (e.g. `Declare is hidden in a one-innings match`, `Revise is hidden in two innings`, `More is empty in a super over`).
  - `ran 4 carries no boundary`.
  - `+5 penalty records a legal ball`.
  - `Retire records cricket.retire with the incoming batter`.
  - `the setup screen has no More` (F20).
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each §4.8 gate once (preflight F16), restoring each time: every row's "shown when" in turn (always shown) → that row's hidden test fails; the super-over empty guard → `More is empty in a super over` fails; the penalty's fair-ball gate → `+5 penalty records a legal ball` or a test that the penalty is not offered with an extra fails (add it). A gate no test kills gets the smallest test that kills it.

  Commit `feat(cricket): More, from what the engine records now`. Opus Batch 4 review.

- [ ] **Step 6: Batch 4 device check (owner):** score both innings of a staging league fixture. Cover every ball kind, every wicket path, the over-end sheet with both greyed reasons, a reorder in Players, a retirement and a penalty. The console agrees.

## Batch 5: the match's ends, fit, exit bar (Tasks 16–20)

### Task 16: Innings break, super over, result, Undo across them

**Files:** Modify `cricketFold.ts`, `cricketPad.ts`, `CricketPadScreen.tsx`, `CricketSetup.tsx` (reused for the next innings), the dictionaries and `padFit.test.ts`.

- Break card: "{team} {runs}/{wkts} ({overs} ov) · {team} need {target} off {balls} balls", then openers and bowler, then Start innings. Start innings records nothing; the picks ride the first ball. Two innings: lead or deficit, and Follow-on in More when allowed.
- Super over: "Tied — super over". Setup from `soEligibleBatters` and `soBattingSideAt`. More is empty.
- Result: the margin's words and "Result recorded — the organiser finalizes it". Undo has a 45 s window on the deciding ball.

- [ ] **Step 1: Failing tests:**
  - `the break card shows the target before the chase's first ball`.
  - `Start innings queues nothing`.
  - `a knockout tie goes to the super over with the side batting second first`.
  - `a second super-over tie follows superOverStillTied`.
  - `won by 4 wickets reads in four languages`.
  - `Undo across the innings break returns to the last ball of innings 1`.
  - `Undo of the deciding ball inside 45 s reopens; after, it does not`.
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - Start innings queuing an event → `Start innings queues nothing` fails;
  - the super over's batting side (the side batting first) → `a knockout tie goes to the super over with the side batting second first` fails;
  - the 45 s window (no limit) → the Undo window test fails;
  - the break card's target (shown only after the first ball, as the web) → `the break card shows the target before the chase's first ball` fails.

  Commit `feat(cricket): innings break, super over, result`.

### Task 17: Players not entered: over totals

**Files:** Create `src/domain/scoring/cricketTotals.ts` (+ test), `src/ui/screens/CricketTotals.tsx`. Modify the dictionaries and `padFit.test.ts`.

- The card "Players not entered — ask the organiser".
- Per over: runs (stepper), wickets, legal balls (default `ballsPerOver`, fewer for a last part over). Sent as `cricket.innings.summary` with the innings' running totals, `partial: true`.
- Once an innings has a summary, the ball pad returns only from the next innings.
- The same entry serves Task 13's "no eligible bowler" case, offered only while the open innings has no ball (spec §4.4 as amended, preflight F5).
- A tie with `cfg.superOver` on says "Tied — the organiser decides the super over" and stops (ruling 74). With it off (`LEAGUE_2`) a tie is the result "tied", shown as any result (preflight §2, T17).

- [ ] **Step 1: Failing tests:**
  - `two overs send running totals 8/0 then 15/1`.
  - `a part last over sends its legal balls`.
  - `players entered mid-innings keep totals until the next innings`.
  - `a tie in totals mode under KO_2 stops with the organiser line`, and `under LEAGUE_2 it is the result Tied`.
- [ ] **Step 2–4:** Fail; implement; verify.
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - the next-innings return (the ball pad back on the next over) → `players entered mid-innings keep totals until the next innings` fails;
  - the super-over condition on the tie line (always the organiser line) → the `LEAGUE_2` tie test fails;
  - the legal balls' default (always `ballsPerOver`) → `a part last over sends its legal balls` fails.

  Commit `feat(cricket): over totals when players are not entered`.

### Task 18: Match details, History pass, fit at 320/360 in four languages

**Files:** Modify `src/ui/components/PadSheets.tsx` (Match details takes a sport's extra block as a prop; a generic change on spec §6's amended list, preflight F18), `CricketPadScreen.tsx`, `padFit.test.ts`, the dictionaries and the glossary.

- ⓘ shows the match block, the rule rows and each innings' scorecard (batting, bowling, extras, fall of wickets) from `deriveCricketScorecard`.
- Sweep every `scoring.cricket.*` key for a fit case.

- [ ] **Step 1: Failing tests:**
  - `every scoring.cricket key has a fit case`: a test over the dictionary's keys, asserting each appears in the fit table, and asserting the count of keys swept (zero is a failure; preflight D5).
  - Every sheet's longest row at 320 and 360 dp in es, fr and nl, with 30-character names.
  - `the scorecard shows fall of wickets`.
  - `Match details with no sport block is as before` (badminton, table tennis and chess).
- [ ] **Step 2–4:** Fail; shorten copy that does not fit; verify (plus `MatchDetailsSheet.test.tsx` and the other sports' screen tests, unchanged).
- [ ] **Step 5:** Mutate each guard once (preflight F16):
  - the sport block drawn when absent (an empty block) → `Match details with no sport block is as before` fails;
  - a key dropped from the fit table → the key sweep fails;
  - the sweep's own count floor (accept zero) → the sweep over an empty key list fails.

  Commit `feat(cricket): match details and the fit at 320`. Opus Batch 5 review.

### Task 19: The exit bar on staging (owner's hands; P4 done)

- [ ] **Step 1:** arm64 release from a clean detached worktree at the pushed commit; `adb -s 12be753e install -r`. Revert prebuild's `package.json`.
- [ ] **Step 2:** Spec §8 items 1–13, every one unconditional (preflight F19): item 12 (a strike swap and a mid-over bowler change from More, ruling 84; the next over greys both bowlers of the split over) and item 13 (the Players sheet's reorder changing the next batter suggested; the lime rows in every sport's sheets, badminton, table tennis and chess included; the two-half toss). Plus S2 §10 items 2–7 (offline, co-scorer, kill and reopen, finalize, Update needed). Record what the screen and the console showed.
- [ ] **Step 3:** The device-only claims jsdom cannot settle (preflight F15, D1): the board, the toss halves and the key rows do not move as balls are recorded and the toss is answered; the sheet rows' lime, heavier lime, greyed and caution borders read as such. Item 10 uses Task 1's and Task 12's R4 numbers (preflight F22).
- [ ] **Step 4:** 320 dp (`adb -s 12be753e shell wm density 540`, then `reset`) in the longest locale with the longest names: the pad, every sheet, Players and the break card. Crop screenshots, nothing personal, no scanned code's value.

### Task 20: Results, house rules, the engine release, PR

**Files:** Create `docs/specs/2026-11-xx-s2-4-results.md`. Modify `AGENTS.md` §1/§3 (cricket named; notify s2-5 first) and `docs/i18n-glossary.md`. Modify `package.json`, `pnpm-lock.yaml`, `engineEpochs.test.ts` and the R4 doc at the repin.

- [ ] **Step 1:** Results item by item, with Task 1's and Task 12's R4 numbers and the findings sent to the web and the engine. They also list:
  - the generic changes made, against spec §6's amended list (preflight F18);
  - the follow-ups: aligning set-based lineups with the server (F3); the phone's words for `division_not_started` on a toss refused in a Draft division (web W18);
  - the cross-repo items: the `l.person_id` tie-break at `fixtures.ts:896` (F1, W17), and the `StepOption` kinds agreed with s2-5 (F26).
- [ ] **Step 2:** Opus whole-branch review; a fix round; the same reviewer re-checks.
- [ ] **Step 3:** One PR to main after the owner's go. It may open on the snapshot; it is not merged until Step 4's gate passes. Merging and tags are the owner's call.
- [ ] **Step 4: Repin to the release before the merge** (the controller's ruling on the engine pin, 2026-11-08), once the owner has cut the cricket engine major:
  - `package.json` takes `npm:@onryde/seazn-engine@<the release's version>`, exact, then `NODE_AUTH_TOKEN=$(gh auth token) pnpm install`.
  - Re-read the release's notes and `fold-epoch.ts`: `engineEpochs.test.ts`'s literals still hold, or the change is a finding. Re-run Task 1 Step 4's tests; CI runs the full suite on the PR.
  - Gate: `git grep -n 0.0.0-pr -- package.json pnpm-lock.yaml` prints nothing. Until it does, the PR is not merged and no `v*` tag is cut.
  - Record the release's version in the R4 doc and the results.
