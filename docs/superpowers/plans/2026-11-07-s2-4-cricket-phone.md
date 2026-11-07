# S2-4 Remote Scoring (cricket), the phone: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One scorer scans a cricket match's scoring link and scores it ball by ball on the phone, from the toss to the result, super over included: batting order, openers, the bowler of every over, every extra with its runs, every dismissal the engine allows, the fielder and the incoming batter. When the players are not entered, the scorer records over-by-over totals instead.

**Architecture:** A further sport behind the S2-1 runtime's `ScoringSport` (S2 ruling 38). A `cricket*` module set in `src/domain/scoring/` folds through `@seazn/engine/sports/cricket`, with a row in `sports.ts` and `scoringScreens.ts` and its own screen. The screen composes cricket parts through `PadContent`'s `body` slot (football's). Three generic changes are recorded in the spec (§6) and made here, nowhere else: the lineup built in the server's order (`teamSheet.ts`); the boot cache and the match state holding sport-neutral pending picks (`pendingPicks.ts`); and the kit's sheet rows (ruling 82). Every cricket rule is the engine's.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / Hermes. `@seazn/engine` = `npm:@onryde/seazn-engine@<ENGINE>`, exact. `<ENGINE>` is the major the owner releases from engine branch `feat/cricket-s2-4`, expected 4.0.0 (confirm against the engine release). Tests run on vitest with react-native-web.

**Spec:** `docs/specs/2026-11-07-s2-4-cricket-design.md` (approved 2026-11-07, rulings 64–85), on top of `docs/specs/2026-11-01-s2-remote-scoring-design.md` and the S2-2 design. Read both, plus `AGENTS.md`. The web pad's fixes (§7.2) are a separate `seazn.club` worktree's plan; this plan never edits the web or the engine.

## Preconditions (not phone tasks)

- **P1 Engine release (gates Task 1, and so everything).** The owner releases `<ENGINE>` from `feat/cricket-s2-4` (worktree `seazn.club.engine-worktrees/cricket-s2-4`). Committed there (a895160, engine ruling 276): `cricketPadRules.wideDismissalKinds`, `cricketPadRules.noBallDismissalKinds`, and `orderFromLineup` exported from `./sports/cricket`. Uncommitted when this plan was written, so confirm against the engine release:
  - CK-SS-1 (engine ruling 277): a ball naming exactly the fold's pair reversed is accepted.
  - CK-BC-1 (engine ruling 278): `cricket.bowler.change {bowler, reason?: 'incapacitated' | 'suspended' | 'other'}`, plus `eligibleChangeBowlers(order, fine, maxOversPerBowler, ballsPerOver)`, `oversUsed(fine, bowler, ballsPerOver)`, `OverSpell`, and the scorecard over's `bowlers?`.
  - `FOLD_EPOCH.cricket` raised, expected 2 → 3. The uncommitted engine work does not raise it yet; tell the engine session.
- **P2 Web bootstrap lineup fields** (`slot`, `position_key`, `order_no`, `role`, `roles`, `squad_number`): web branch `feat/device-link-lineup-and-football-clock` (football's web PR, not merged at planning), merged and on staging before Batch 2's device check.
- **P3 Phone `BootstrapSlot` fields.** Football's phone plan Task 2 is already committed: 93f4c35 on `feat/s2-5-football` (`wire.ts`, `wire.test.ts`, `wireBootstrap.test.ts`). **Cricket rebases on it.** If football has not merged to main when Task 2 starts, cherry-pick 93f4c35 unchanged so the later rebase drops it as already applied. Never re-write the fields.
- **P4** The web takes `<ENGINE>`, and the web pad's §7.2 fixes are deployed to staging before Task 19 (rulings 71, 72). Until the web takes it, the server refuses `cricket.bowler.change`.
- **P5** Staging (owner's go): a started division; a league fixture (2 overs, max 1 per bowler, 5 a side); a knockout fixture (super over on); team sheets with `order_no`, a bench row, a coach row and a `wicketkeeper` role; and one fixture whose away side has no lineup. Tokens are never printed.

## Global Constraints

- AGENTS.md in full:
  - §2: scoring is JavaScript's; no second state machine.
  - §3: layering by lint, no barrels.
  - §4: one parser per wire shape, `type` in domain, no `any`.
  - §5: tokens only, no red outside ON AIR.
  - §8: `React.memo` and no anonymous functions in render on the pad.
  - §10: the four questions, mutate every guard once and watch a test fail, no expected value derived from the code under test (copy from the dictionary, values from the spec and the Laws), no snapshot tests.
  - §12: functions 10–25 lines, JSX ≤ 3 deep.
- Engine `@onryde/seazn-engine` `<ENGINE>` exact. Sport key `'cricket'`. The epoch is `foldEpochOf('cricket')`, never a literal. The rules version comes from the bootstrap and the rules read only.
- Every cricket rule is the engine's: `eligibleBowlers`, `eligibleChangeBowlers`, `eligibleIncomingBatters`, `suggestedIncomingBatter`, `chaseTarget`, `activeInnings`, `nextBattingSide`, `soBattingSideAt`, `soEligibleBatters`, `orderFromLineup`, `oversUsed`, `cricketPadRules`, `deriveCricketScorecard`, `CRICKET_MARGIN_KINDS`. Where none answers ("does this wicket end the innings?"), trial-fold the candidate event. No hand copy of a set or a number.
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
- Shared files with football (s2-5) and chess (s2-3): `sports.ts`, `scoringScreens.ts`, `SPORT_MODULES` / `SPORT_OWN_FILES`, `fakeScoringPort.ts`, `PadStart.needsToss` (chess), `PadContent.body` and `StepSheet` (football), AGENTS.md §1/§3, the glossary and the dictionaries.
  - Rebase after those merge; whoever rebases second resolves the tables.
  - Notify the s2-5 session before pushing any AGENTS.md or glossary change.

**Verify template** (every task's verify step; `<files>` = its changed `.ts`/`.tsx` files, `<tests>` = its test files):

```bash
cd /Users/ashokhein/github/seazn.club.capture-worktrees/s2-4 && echo '{"extends":"./tsconfig.json","compilerOptions":{"noEmit":true,"incremental":false},"include":[],"files":[<files>]}' > tsconfig.changed.json && npx tsc -p tsconfig.changed.json > <scratch>/tsc.txt 2>&1; echo "EXIT=$?"; rm tsconfig.changed.json
cd /Users/ashokhein/github/seazn.club.capture-worktrees/s2-4 && pnpm vitest run <tests> --reporter=json --outputFile=<scratch>/r.json > <scratch>/v.txt 2>&1; echo "EXIT=$?"
```

Pass means both commands print `EXIT=0`, `numFailedTests` is 0, and `numTotalTests` equals the count the task expects.

## Review Focus

1. **A queued ball overtaken by another scorer's ball.** The phone is offline and queues the 3rd ball of an over. A browser co-scorer records that ball first. On send, the phone's ball must not be restamped onto the next ball (it is a different delivery). It is dropped and said, as any illegal tap ("Not recorded"). Test: Task 6 `payloadForSend never moves over or ballInOver`; Task 5 `legalQueued drops a ball whose ballInOver the ledger already holds`.
2. **Undo of an over's first ball.** The picked bowler must still be the pick, keyed to that over, and the over must not ask again or name the last over's bowler. Test: Task 3 `a pick keyed to an over survives Undo of that over's first ball`; Task 5 `undoing the over's first ball shows the picked bowler again`.
3. **Process death between an over's end and its first ball.** The next-bowler pick, the reordered batting order and the openers are read back from the boot cache. Test: Task 3 `picks round-trip the boot file` and `a boot file without picks reads as none`; Task 10 `a reopened match keeps the batting order and the bowler pick`.
4. **A team sheet whose `order_no` is null for some rows, or a web older than P2.** The phone's batting order must equal the server's (`order_no nulls last, person_id`, fallback `i + 1`), or the suggested next batter differs from the server's walk. Test: Task 2 `rows sort as the server's loader sorts` and `rows with no slot fold as all starting`.
5. **The innings-ending wicket in a super over and in a chase.** No Next batter step on the super over's 2nd wicket, on the last legal ball, or on all out. The `endsInnings` trial fold, not a count of ours, decides. Test: Task 12 `no incoming on the super over's second wicket`, `no incoming on the last ball of the innings`, `no incoming at all out (players − 1)`.

---

## Batch 1: the engine, for every sport (Task 1)

### Task 1: Take `<ENGINE>`: badminton, table tennis and chess too

Gated on P1. It lands as its own PR to main (`chore/engine-<ENGINE>`, from main), so s2-3, s2-5 and this branch all rebase on it.

**Files:**

- Modify: `package.json` (`"@seazn/engine": "npm:@onryde/seazn-engine@<ENGINE>"`), `pnpm-lock.yaml`.
- Modify: `docs/specs/2026-11-01-s2-r4-engine-on-hermes.md` (append "`<ENGINE>`: device").
- Modify if needed: `eslint.config.mjs:250` (`internalPath`), `test/domainBoundary.test.ts`, but only if the release's `phone-subpaths.json` subpaths differ from `core, sport, sports, sports/*, pad`.
- Create: `src/domain/scoring/engineEpochs.test.ts`.
- Throwaway (never merged, no tests; ruling 70's precedent): branch `probe/s2-4-engine` off this task's commit, with a Fold probe chip in the dev twin.

**Interfaces:**

- Produces: the engine every later task imports.
  - `@seazn/engine/sports/cricket`: `orderFromLineup`, `eligibleChangeBowlers`, `oversUsed`, `CricketBowlerChange`, `CRICKET_MARGIN_KINDS`.
  - `@seazn/engine/pad`: `cricketPadRules.{wideDismissalKinds, noBallDismissalKinds}`.
  - Every name is confirmed against the engine release.

- [ ] **Step 1: Read the release.** Confirm its CHANGELOG names P1's items.
  - `FOLD_EPOCH` for every sport the phone scores: cricket raised (expected 3); badminton 2, tabletennis 2, boardgame 5, football 4, unchanged since 2.0.0. Record the numbers.
  - The peer range is still `zod ^4.4.3`.
  - `phone-subpaths.json`: same subpaths; diff its `closure.modules` against 2.0.0's. Any added module is read for purity: no react, nothing effectful.
- [ ] **Step 2: Failing test** `engineEpochs.test.ts`: `the release's epochs are the ones each sport sends`.
  - Literals from the release notes, e.g. `badmintonSport.epoch === 2`, `tableTennisSport.epoch === 2`, plus chess's when chess is on main.
  - Run on 2.0.0: it fails only if an epoch moved. For cricket, add `foldEpochOf('cricket') === 3` (the release's number); it fails on 2.0.0.
- [ ] **Step 3: Install.** Registry auth is user-level, never the project `.npmrc` (R4 doc):
  - `pnpm config set '//npm.pkg.github.com/:_authToken' '${NODE_AUTH_TOKEN}'` (the literal; once per machine).
  - Then `NODE_AUTH_TOKEN=$(gh auth token) pnpm install` after editing the pin. The token is never printed.
  - `node_modules/@seazn/engine/package.json` reads `<ENGINE>`. Nothing autolinks (`expo-modules-autolinking resolve -p android` names no engine package).
- [ ] **Step 4: Verify.** Engine-facing tests by path: `src/domain/scoring` (the directory), `src/services/fakeScoringPort.test.ts`, `src/services/tapQueueStore.test.ts`, `test/domainBoundary.test.ts`, `test/sportBoundary.test.ts`, and chess's `src/domain/scoring/chess*` if merged.
  - `numFailedTests` 0, and `numTotalTests` equals the 2.0.0 count plus the new tests.
  - Type-check `src/domain/scoring/*.ts` (tsc of the touched files).
- [ ] **Step 5: Mutate.** Set the pin back to 2.0.0 in `node_modules` (a `cp` backup of the package dir): `engineEpochs` fails on cricket. Restore. Commit `chore(engine): take @onryde/seazn-engine <ENGINE> for every sport`.
- [ ] **Step 6: CI auth.** Push the PR branch. `check.yml` installs with `GITHUB_TOKEN` (`packages: read`) and passes. A 401 is a finding for the owner (package access), not a code change.
- [ ] **Step 7: R4 on the probe branch.**
  - Fold probe: strict `foldMatch` × 50 of each synthetic match:
    - badminton bo3 (76 events);
    - table tennis bo5;
    - cricket T20, both innings (≈ 260 balls with wides, wickets and a super over, ≈ 280 events);
    - chess if merged.
  - Show `events · min / median / max ms`.
  - Build arm64 from a clean detached worktree; `adb -s 12be753e install -r`. The owner taps it three times.
  - Record the numbers in the R4 doc. A crash is a blocker. Over 16.7 ms median for cricket is a finding for Task 19 item 10, not a blocker.
- [ ] **Step 8: Batch 1 device check (owner).** The bump's own build (main + this PR):
  - Score a staging badminton match and a table tennis match through a game, Undo, then the result.
  - Chess too, if merged.
  - Each behaves as on 2.0.0. Record in the R4 doc. Opus review of the PR, then the owner merges.

## Batch 2: lineup, picks, and cricket in the domain (Tasks 2–8)

Branch `feat/s2-4-cricket` from main after Task 1 merges, in worktree `s2-4`. Rebase on P3 first (or cherry-pick 93f4c35).

### Task 2: The lineup in the server's order (generic)

**Files:**

- Create: `src/domain/scoring/teamSheet.ts` (+ test). `lineupOf` moves here from `setBasedEngine.ts:63-73`.
- Modify: `setBasedEngine.ts` (drop `lineupOf`) and every importer (`badmintonFold`, `tableTennisFold`, `fakeScoringPort`, …).

**Interfaces:**

- Consumes: P3's `BootstrapSlot {personId, pairOrder, slot?, positionKey?, orderNo?, role?, roles?, squadNumber?}`.
- Produces:
  - `serverOrder(rows: readonly BootstrapSlot[]): readonly BootstrapSlot[]`: sorted as web `engine-db/lineups.ts:77`, i.e. `orderNo` ascending with absent last, then `personId` by plain code-unit `<` (Postgres uuid order), never `localeCompare`. The bootstrap's own order (`order_no nulls last, full_name`) is ignored.
  - `lineupOf(side: BootstrapSide): LineupPair['home']`: over `serverOrder(side.lineup)`, each slot as `buildLineup` (`lineups.ts:47`):
    - `slot: row.slot ?? 'starting'`;
    - `orderNo: row.orderNo ?? i + 1`;
    - `positionKey`, and `roles` when non-empty;
    - `role` when present and not `'player'`;
    - `squadNumber` when present;
    - plus `pairOrder` when not null (the phone's addition for the doubles server, as today).
  - A side whose rows carry no `slot` (a web older than P2) folds with every row starting, as today.

- [ ] **Step 1: Failing tests:**
  - `rows sort as the server's loader sorts`: `orderNo` 3, absent, 1, absent with person ids `p-b`, `p-d`, `p-c`, `p-a` → `p-c`, `p-b`, `p-a`, `p-d`. The absent two take `orderNo` 3 and 4: i + 1 after the sort, as the server does.
  - `a bench row stays bench and a coach row carries role coach`.
  - `rows with no slot fold as all starting`.
  - `orderFromLineup over lineupOf is the starting players in order_no order` (a 6-row side with a bench and a coach → the 4 starters, literals).
  - `pairOrder is still carried for a doubles pair`.
- [ ] **Step 2:** Run; the new tests fail.
- [ ] **Step 3:** Implement. Move the function and update importers; no other behaviour change.
- [ ] **Step 4:** Verify: `teamSheet.test.ts`, `setBasedEngine.test.ts`, `badmintonFold.test.ts`, `tableTennisFold.test.ts`, `tableTennisSport.test.ts`, `src/services/fakeScoringPort.test.ts`. The set-based counts are unchanged except moved tests.
- [ ] **Step 5:** Mutate twice, restoring from a `cp` backup each time:
  - the nulls-last comparison → the sort test fails;
  - the `slot ?? 'starting'` default → the no-slot test fails.

  Commit `feat(scoring): lineups in the server's order, with the team sheet's slot and role`.

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
  - `a pick keyed to an over survives Undo of that over's first ball` (Undo never touches picks).
- [ ] **Step 2–4:** Fail; implement; verify with the five test files plus `badmintonSport.test.ts`, `tableTennisSport.test.ts` (unchanged).
- [ ] **Step 5:** Mutate the `bootMoved` picks comparison → `setPicks saves the boot cache once` fails. Commit `feat(scoring): pending picks kept with the queue`.

### Task 4: Cricket's engine input, and a ledger for tests

**Files:** Create `src/domain/scoring/cricketEngine.ts` (+ test) and `test/cricketLedger.ts`.

**Interfaces:**

- Consumes: Task 2's `lineupOf`; `envelopeOf`, `queuedEnvelopeOf`, `queuedEventId` (`setBasedEngine.ts`).
- Produces:
  - `CricketEngineMatch = {fixtureId; cfg: CricketCfg; lineups: LineupPair}`.
  - `cricketCfg(raw: unknown): CricketCfg | null` (`cricket.configSchema.parse`, null on a throw).
  - `cricketRefusalOf(match, events): {code: string; reason: string | null} | null` (strict from the last seq; non-engine errors rethrown).
  - `playersEntered(lineups): {first: boolean; second: boolean}`: at least two starting players by `orderFromLineup`.
- `test/cricketLedger.ts`:
  - Sides: `HOME`, `AWAY` (entrants `ent-home`, `ent-away`). Each has 11 starters `H-p1…H-p11` with `orderNo` 1–11, `H-p2` with `roles: ['wicketkeeper']`, a bench row `H-p12` and a coach row; names `Home Player n`.
  - Bootstraps: `NO_AWAY_PLAYERS` and `NO_SLOTS`.
  - Cfgs, every one with `minOversForResult` set (the preview's finding): `KO_2` (2 overs, 6 balls, `maxOversPerBowler: 1`, `superOver: true`, `minOversForResult: 1`), `LEAGUE_2` (same, `superOver: false`), `T20`, `TWO_INNINGS` (`inningsPerSide: 2`, follow-on enabled).
  - Builders: `toss`, `start`, `ball({...})`, `superBall`, `summary`, `retire`, `bowlerChange`, `declare`, `voiding`; `ledgerOf`, `queuedOf`.
  - Fixtures: `OVER_ONE_DONE`, `ALL_OUT_FIRST`, `TIED_KO`, `T20_LONG` (≈ 280 events).

- [ ] **Step 1: Failing tests:**
  - `a 2-over cfg without minOversForResult is null`.
  - `the bench and the coach are not in the batting order`.
  - `a bench batter is refused` (`cricketRefusalOf` returns a code).
  - `a wide and two run is runs 3` (fold one `{wide, runs: 3}` ball: innings runs 3, legal balls 0).
  - `a reversed pair is taken and any other pair refused` (CK-SS-1).
  - `a bowler change mid-over is taken; neither bowler may bowl the next over` (CK-BC-1; confirm against the engine release).
  - `playersEntered is false for a side with one starter`.
- [ ] **Step 2–5:** Fail; implement; verify; mutate the two-starter floor. Commit `feat(cricket): the engine's input and a test ledger`.

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
    - `crease: {striker: BatterLine; nonStriker: BatterLine} | null`, with `BatterLine = {id; name; runs; balls}`;
    - `bowler: {id; name; figures: string} | null`;
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
  - Chase from `chaseTarget`; the super-over target is the first super-over innings' runs + 1.
  - `needs`: `openers` when the open innings has no ball and no `openers` pick; `bowler` when an over is due and there is no pick for it.
  - `legalQueued`: one strict fold per queued tap; an illegal tap is skipped and the rest are still judged.
  - Stage `totals` when either side is not `entered` (§4.10). An innings with a summary stays `totals` until the next innings.

- [ ] **Step 1: Failing tests**, values from the spec and the Laws:
  - `before the toss the stage is toss; after it, setup`.
  - `the openers' pick is the crease before the first ball`.
  - `a no-ball makes the next ball a free hit`.
  - `the over strip reads ·, 1, 4, wd, nb, W` (chips for a scripted over).
  - `odd runs swap the strike; a wicket ball never does` (§4.2).
  - `an over's end needs a bowler unless one is picked for that over`.
  - `undoing the over's first ball shows the picked bowler again`.
  - `the chase reads need 9 off 6 balls` (1st innings 8 off 2 overs).
  - `a reordered yet-to-bat order is the display's order`.
  - `legalQueued drops a ball whose ballInOver the ledger already holds`.
  - `a side with no players is totals`.
  - `a tie in totals mode is tiedNoPlayers` (ruling 74).
  - `a stale bowler pick for a past over is ignored`.
- [ ] **Step 2–5:** Fail; implement; verify; mutate `needs` and the drop of past keys. Commit `feat(cricket): the fold, the display and the pending picks`.

### Task 6: Taps as events

**Files:** Create `src/domain/scoring/cricketEvents.ts` (+ test).

**Interfaces:**

- Consumes: Task 5's types and `picksFor`.
- Produces:
  - `cricketEventFor(tap: CricketTap, ctx: SportEventContext<CricketTypes>): SportEvent | null`.
  - `cricketPayloadForSend(queued, ledger, copied): unknown`: the payload as queued, never restamped.

  Ball:
  - `over = floor(legalBalls / ballsPerOver)`, `ballInOver = legalBalls % ballsPerOver + 1`.
  - `striker` / `nonStriker` from the crease, reversed when a `swap` pick stands for this ball.
  - `bowler` from the fold, else the over's pick.
  - In a super over the type is `cricket.superover.ball`, with the replacement filling the empty end.
  - `wicket.bowlerCredited` = `cricketPadRules.bowlerCreditedKinds.includes(kind)`.
  - `incoming` is on every main-innings wicket that does not end the innings, and never in a super over.
  - `boundary` only from the 4 and 6 keys.
  - Null when the crease or the bowler is unknown.

- [ ] **Step 1: Failing tests:**
  - Each tap's exact type and payload.
  - `a wide with two run sends extras {kind: wide, runs: 3}`.
  - `a no-ball 4 off the bat sends bat 4 and extras {noball, runs: 1}`.
  - `an all-run 4 carries no boundary` (ruling 73).
  - `penalty rides a fair ball only` (§4.2).
  - `freeHit is never sent`.
  - `a swap pick reverses the pair on the next ball only`.
  - `a super over's second batter rides the next ball, not incoming`.
  - `bowlerCredited is false for a run out and true for bowled`.
  - `payloadForSend never moves over or ballInOver`.
  - `never core.forfeit` (no tap makes one).
- [ ] **Step 2–5:** Fail; implement; verify; mutate the super-over `incoming` guard. Commit `feat(cricket): taps as the events the server records`.

### Task 7: Rules rows, History words, results, the sport module

**Files:**

- Create: `cricketRules.ts`, `cricketHistory.ts`, `cricketResult.ts`, `cricketSport.ts` (+ tests).
- Modify: `sports.ts`, `eslint.config.mjs` (`SPORT_MODULES`, `SPORT_OWN_FILES`), `test/sportBoundary.test.ts`, `src/i18n/{en,es,fr,nl}.json`, `docs/i18n-glossary.md`.

**Interfaces:**

- `cricketRuleRows(cfg: CricketCfg): PadRuleRow<CricketPadKey>[]`: overs per innings (or "Unlimited"), balls per over, players a side, max overs per bowler, super over on/off, and follow-on and reviews only when the format has them (§4.1).
- `cricketLedgerHistory(...)`: words for every event type in the Global Constraints list, `core.void` included.
- `cricketResultWords(margin): PadText`: a key for every `CRICKET_MARGIN_KINDS` value (§4.7; the fold's `headline` is a score line, never used as words).
- `cricketSport: ScoringSport<CricketTypes>`:
  - `key 'cricket'`, `epoch foldEpochOf('cricket')`, `fold memoFold(foldCricket)`;
  - `tossOf: () => null` (the cricket toss is an event, not the generic serve pick);
  - `notStarted` = stage `toss` or `setup`; `decided` = stage `decided`;
  - `resultLine` = each innings' `runs/wickets`, joined `" · "`, e.g. `"25/3 · 25/10"`: numbers only;
  - `awaitingEnding: () => false`.

- [ ] **Step 1: Failing tests:**
  - Rule rows for `KO_2`, `T20`, `TWO_INNINGS` (literals).
  - History rows in en and nl for a wide with runs, a caught with fielder, a retirement and a bowler change.
  - `every margin kind has words in four dictionaries`.
  - `sportFor('cricket') is the module`.
  - `cricketSport.epoch is the engine's for 'cricket'` (`vi.mock` as `tableTennisSport.epoch.test.ts`, cricket → 9).
  - Boundary: `a generic file importing cricketPad fails lint`.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): rules, History words, results, the sport`.

### Task 8: The fake, the match hook, a read-only board and the route

**Files:**

- Create: `src/services/fakeCricketPad.ts` (seeds), `src/hooks/useCricketMatch.ts` (+ test), `src/domain/scoring/cricketPad.ts` (+ test), `src/ui/screens/CricketMatchScreen.tsx`, `CricketPadScreen.tsx`, `CricketBoard.tsx` (+ tests).
- Modify:
  - `src/services/fakeScoringPort.ts:36-52`: generalise `FakeSport` to `{cfg(raw); judge(match, events): string | null}` so a non-set-based sport fits. If football's rebase already did, use theirs.
  - `src/ui/screens/scoringScreens.ts` (a `cricket` row).
  - `src/ui/components/PadContent.tsx`: football's `body` slot. Rebase on it, or port its hunk exactly if s2-5 has not merged.
  - `src/ui/theme/tokens.ts`: `layout.scorePanel`, `layout.creaseRow`, `layout.overStrip` (fixed heights, gap 8).

**Interfaces:**

- `cricketPad(display, sync): PadView<CricketPadKey>`: halves carry the side names, `start: null`, `tools: []`, `card` as every sport, `lastTap`.
- `cricketBoard(display): CricketBoardView = {score: {runs; wickets; overs; side; innings; chase: string | null}; crease: [BatterLine & {striker: boolean}, BatterLine] | null; bowler; over; status: PadText | null}`.
- `useCricketMatch(fixtureId): CricketPadModel = PadScreenModel & {board: CricketBoardView; display: CricketDisplay | null; actions: {...}}`, on `useScoringMatch(id, cricketSport, …)`.
- `CricketBoard({view, onOpenPlayers})`: score in lime, then crease, bowler O-M-R-W, and the over strip with fixed-width chips. Every region has a fixed height.

- [ ] **Step 1: Failing tests:**
  - `a cricket link opens on the cricket screen` (routed, fake port).
  - `the board shows 25/3 (2 ov) and the crease with the striker marked`.
  - `the board's height does not change from an empty over to a six-ball over with two extras` (layout values).
  - `History lists a ball recorded on the console in words`.
  - `the four languages render the board`.
  - padFit: the score line, the chase line and the crease at 320 and 360 dp, with the longest names.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): the screen, read only, and the fake`. Opus Batch 2 review.
- [ ] **Step 6: Batch 2 device check (owner).**
  - arm64 build, `adb -s 12be753e install -r`.
  - Scan a staging cricket link (P2 on staging). On the web pad, the controller records a toss, Start and an over.
  - The phone's board and History follow ball for ball (Realtime). Match details lists the format rows.

## Batch 3: Start (Tasks 9–10)

### Task 9: The kit's sheet rows (ruling 82)

**Files:**

- Modify: `src/ui/components/StepSheet.tsx:16-20, 60-100` (`StepOption`, `StepRow`, styles), `src/ui/components/PadSheets.tsx:26-34` (`StepSheetFacts` carries the new fields).
- Test: `StepSheet.test.tsx`, plus every sport's screen tests unchanged (`BadmintonPadScreen.test.tsx` alone, `TableTennisPadScreen.test.tsx`).

**Interfaces:**

- `StepOption` gains `disabled?: boolean`, `note?: string | null` and `chosen?: boolean`, alongside football's `kind` / `checked` if merged.
- A row that takes a tap has a lime border (`colour.lime`, `layout.iconBorder`).
- A chosen row has a heavier lime border (`layout.iconBorderOn`) on `colour.surface`.
- A disabled row is greyed (`colour.ink3` border and label), with its `note` (the reason) on a second line. It has no `onPress`, and `accessibilityState {disabled: true}`. A screen reader hears the label and the reason.
- Destructive rows keep the caution border (the controller's reading of ruling 82).
- `AskSheet` has no choice rows (a lime `Button` and a `GhostButton`), so it gets no prop.
- No cricket condition in either file.

- [ ] **Step 1: Failing tests:**
  - `a row that takes a tap has a lime border`.
  - `a chosen row has the heavier lime border on surface`.
  - `a disabled row ignores a press and says its reason`.
  - `a destructive row stays caution`.
  - Badminton's and table tennis's sheets render as before. They now have lime borders; their tests assert behaviour, not colour.
- [ ] **Step 2–5:** Fail; implement (tokens only); verify; commit `feat(kit): sheet rows say which take a tap, and why not (ruling 82)`.

### Task 10: The setup: the toss (ruling 83), batting order, openers, bowler, Start

**Files:**

- Create: `src/domain/scoring/cricketSetup.ts` (+ test), `src/ui/screens/CricketSetup.tsx`, `CricketToss.tsx`, `CricketOrderList.tsx` (+ tests).
- Modify: `src/ui/components/TossPicker.tsx:8-14, 24-45, 75-90` (props `fill`, `disabled`, generic options), `src/ui/components/PadContent.tsx:29` and its `TossPicker` call (maps `PadStartSide` to `TossOption`), `TossPicker.test.tsx`, `useCricketMatch.ts`, `CricketPadScreen.tsx`, the dictionaries, the glossary, `padFit.test.ts`.

**Interfaces:**

- Kit (generic): `TossOption<T extends string> = {id: T; label: string}`; `TossPicker<T>({ask, options, picked, onPick, fill?, disabled?})`.
  - `fill`: the pair grows to fill the parent's height (`flexGrow: 1`, never below `layout.padTossHeight`).
  - `disabled`: greyed (`colour.ink3` border and label), ignores presses, `aria-disabled`, same size as when enabled.
  - Without either prop it behaves exactly as today.
- `setupStep(display, picks): 'toss' | 'order' | 'openers' | 'bowler' | 'ready'`.
- `CricketToss({sides, onRecord})`: the whole screen below the top bar, in two halves of equal flex.
  - Top half: "Who won the toss?" over the two **team names**.
  - Bottom half: "{team} chose to…" over Bat and Bowl, drawn `disabled` (with "Team" in place of the name) until a team is picked.
  - Both are `TossPicker` with `fill`. The won-by choice is held in the hook until Bat or Bowl, which records `cricket.toss {wonBy, elected}`. A second tap on a team before that changes the pick.
- `setupView(display, picks): CricketSetupView`: the match card's format line; the batting order (the batting side's starters by `orderFromLineup`, the first two marked Opener, reordered with ▲▼); the openers; the first bowler.
- Actions: `pickTossWinner(side)` (held in memory only); `recordToss(elected)`; `setOrder(side, ids)`, `setOpeners(pair)` and `setBowler(id)` through `setPicks(withPick(...))`; `start()` records `core.start`.

- [ ] **Step 1: Failing tests:**
  - `the toss fills the screen in two halves`: both halves are present before any tap, and the bottom half is disabled.
  - `the second half is greyed and takes no tap until a team is picked`: pressing Bat records nothing.
  - `nothing moves when the first half is answered`: the halves' layout values are equal before and after.
  - `the toss asks with team names` and `the second half names the picked team`.
  - `a second team tap changes the pick before Bat or Bowl`.
  - `Bat makes the toss winner the batting side`.
  - TossPicker: `fill grows the pair`, `disabled ignores a press and says so`, and `without the props it is unchanged` (the existing TossPicker tests, kept).
  - `the order lists starters only, Opener on the first two`.
  - `Up moves a batter and the openers follow the order`.
  - `Start match waits for openers and a bowler`.
  - `the first ball carries the openers and the bowler` (the queued payload).
  - `a second tap on Start records one start` (bounce).
  - `a reopened match keeps the batting order and the bowler pick`.
  - `Undo of the toss asks the toss again`.
  - Fit cases at 320 and 360 dp in en, es, fr and nl for both questions, Bat, Bowl and 30-character team names.
- [ ] **Step 2:** Run; the new tests fail.
- [ ] **Step 3:** Implement. Tokens only, JSX ≤ 3 deep, no cricket condition in `TossPicker` or `PadContent`.
- [ ] **Step 4:** Verify these test files: `TossPicker.test.tsx`, `CricketToss.test.tsx`, `CricketSetup.test.tsx`, `CricketOrderList.test.tsx`, `cricketSetup.test.ts`, `useCricketMatch.test.tsx`, `padFit.test.ts`. Also run the start screens that are unchanged: `BadmintonPadScreen.test.tsx` alone, then `TableTennisPadScreen.test.tsx`, and chess's if merged.
- [ ] **Step 5:** Mutate the `disabled` guard (make it take presses) → `the second half is greyed and takes no tap` fails. Restore from a `cp` backup. Commit `feat(cricket): the toss on the whole screen, and the setup before the first ball`. Opus Batch 3 review.
- [ ] **Step 6: Batch 3 device check (owner):** on a staging fixture, answer the two-half toss and check nothing moves. Then reorder, pick the openers and the bowler, and Start. The console shows the toss and, after one dot ball, the openers and the bowler.

## Batch 4: the pad (Tasks 11–15)

### Task 11: Run keys, extras sheet, Out / Undo / More, the status line

**Files:**

- Create: `src/ui/screens/CricketKeys.tsx`, `CricketSheets.tsx` (+ tests), `src/hooks/useCricketSheets.ts` (+ test), `src/domain/scoring/cricketExtras.ts` (+ test).
- Modify: `CricketPadScreen.tsx`, dictionaries, glossary, `padFit.test.ts`.

**Interfaces:**

- `extrasSheet(kind, display): StepSheetFacts`:
  - Wide: "Runs run" 0–4 → `runs = 1 + run` (the engine counts the wide's own run).
  - No-ball: runs off the bat 0, 1, 2, 3, 4, 6 or "runs run" 0–4 (sent as one no-ball extra, §4.2).
  - Bye, Leg-bye: 1–4.
  - Each sheet has "+ Out". The sheet stays until a choice or Cancel; there is no timer.
- Keys: 0, 1, 2, 3, 4, 6 in two rows of three (4 and 6 are boundaries). Extras row: Wide, No-ball, Bye, Leg-bye. Bottom row: Out, Undo, More, three equal (ruling 79).
- Status line: the last ball, "Free hit", or a refusal in caution.
- `useCricketSheets` sheets: `extras`, `wicket`, `overEnd`, `players`, `more`, `otherRuns`, `overTotals`, `details`, `history`, `ask`, `discard`.

- [ ] **Step 1: Failing tests:**
  - `a 4 records a boundary 4`.
  - `Wide then 2 records runs 3`.
  - `No-ball then 4 off the bat records bat 4 and a no-ball`.
  - `the extras sheet has no timer` (fake timers advance 30 s; the sheet is still open, nothing queued).
  - `Cancel records nothing`.
  - `the keys' rows keep their height after every ball`.
  - `Undo takes back this phone's last ball only` (ruling 81).
  - `a free hit says Free hit on the status line`.
  - Fit cases.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): the run keys and the extras sheets`.

### Task 12: The wicket steps

**Files:** Create `src/domain/scoring/cricketWicket.ts` (+ test). Modify `CricketSheets.tsx`, `useCricketSheets.ts`, dictionaries, `padFit.test.ts`.

**Interfaces:**

- `wicketKinds(display, extra): readonly WicketKind[]`: the engine's set for this delivery, in a scorer's order, without `retired` and `timedout`:
  - a free hit: `cricketPadRules.freeHitDismissalKinds`;
  - a wide: `wideDismissalKinds`;
  - a no-ball: `noBallDismissalKinds`;
  - else `wicketKinds`.
- `WicketFlow`; `startWicket(display, base: CricketBallTap): WicketFlow`; `chooseWicket(flow, choice): {next: WicketFlow} | {done: CricketBallTap}`.
- Steps: how out; who's out (only `variableOutKinds`); fielder (`fielderCreditedKinds`, optional for `fielderOptionalKinds`); assist (run out, ≠ fielder); runs completed 0–3 (run out only); next batter.
- `fieldersFor(kind, display)`: a stumping offers the keeper (roles `wicketkeeper`, else position `WK`), else the fielding side without the bowler. Any other kind offers the whole fielding side.
- `endsInnings(display, ball, ctx): boolean`: a trial fold of the ball without `incoming`, with the innings closed or the match no longer live.
- Next batter: `eligibleIncomingBatters`, the suggestion from the phone's order and the batters in (not the engine's index), marked chosen (ruling 82). Retired-not-out batters are offered with "Retired".

- [ ] **Step 1: Failing tests** (sets copied from spec §4.3):
  - `a free hit offers run out and obstructing only`.
  - `a wide offers hit wicket, obstructing, run out, stumped`.
  - `stumped offers the keeper only`.
  - `stumped without a keeper offers the side without the bowler`.
  - `run out asks who, fielder, assist, runs`.
  - `assist cannot be the fielder` (disabled with its reason).
  - `no incoming on the super over's second wicket`.
  - `no incoming on the last ball of the innings`.
  - `no incoming at all out (players − 1)`.
  - `the suggested batter follows the reordered order`.
  - `Out from the wide sheet records one ball` (extra and wicket together).
- [ ] **Step 2–5:** Fail; implement; verify; mutate `endsInnings` and the keeper filter; commit `feat(cricket): the wicket steps`.

### Task 13: The over-end sheet; the mid-over change and the swap (owner's entry point first)

**Files:** Create `src/domain/scoring/cricketBowling.ts` (+ test). Modify `CricketSheets.tsx`, `useCricketSheets.ts`, dictionaries, `padFit.test.ts`.

**Interfaces:**

- `bowlerRows(display): {id; name; figures; oversLeft: number | null; can: boolean; reason: 'lastOver' | 'outOfOvers' | null}[]`, eligible first, from `eligibleBowlers` and `oversUsed`. Reasons: "Bowled the last over", "Out of overs ({max})". With none eligible, say so and offer over totals for the rest of the innings (§4.4, the controller's).
- `changeRows(display)`: from `eligibleChangeBowlers`.
- Entry points (ruling 84, the owner: "In More"): More gains "Change bowler (injury)", shown only mid-over with `changeRows` non-empty, which opens the bowler then the reason (`incapacitated` / `suspended` / `other`, from `CricketBowlerChange`'s enum); and "Swap strike", shown only between balls of a main innings, which sets the `swap` pick. The engine refuses a change in a super over and before an over's first ball (engine ruling 278): More hides it there.

- [ ] **Step 1: Failing tests:**
  - `the over-end sheet greys the last over's bowler with its reason`.
  - `a bowler out of overs reads Out of overs (1)`.
  - `a pick is held until the over's first ball and rides it`.
  - `no eligible bowler offers over totals`.
  - `Change bowler records cricket.bowler.change and greys both bowlers for the next over`; `Swap strike sends the reversed pair on the next ball`.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): the next bowler, a mid-over change, a strike swap`.

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
  - `figures match the scorecard after a scripted over`.
  - Fit cases.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): the Players sheet`.

### Task 15: More, and Other runs and penalty

**Files:** Create `src/domain/scoring/cricketMore.ts` (+ test). Modify the sheets, the hook, the dictionaries and `padFit.test.ts`.

**Interfaces:**

- `cricketMoreItems(display): readonly CricketMoreItem[]`: the §4.8 table, each gate read from the fold and `cfg`; empty in a super over. Items: retire, declare, close, interruption, revise, newBall, powerplay, followOn, matchClose, review, changeBowler and swapStrike (per Task 13).
- The first row is always `otherRuns`: 5, 7, all-run 4, all-run 6 (no `boundary`), and +5 penalty on a fair ball. The penalty sends `extras {penalty, runs: cricketPadRules.penaltyRuns}`; the controller's reading is a following row of runs off the bat 0–6 (ruling 79 leaves it open).
- Each item's steps: Retire (who, reason from `retireReasons`, incoming); Revise (overs and/or target entered, never computed); Interruption (kind, overs lost); Review (by, kind, outcome).

- [ ] **Step 1: Failing tests:**
  - One per §4.8 row, shown and hidden (e.g. `Declare is hidden in a one-innings match`, `Revise is hidden in two innings`, `More is empty in a super over`).
  - `ran 4 carries no boundary`.
  - `+5 penalty records a legal ball`.
  - `Retire records cricket.retire with the incoming batter`.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): More, from what the engine records now`. Opus Batch 4 review.
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
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): innings break, super over, result`.

### Task 17: Players not entered: over totals

**Files:** Create `src/domain/scoring/cricketTotals.ts` (+ test), `src/ui/screens/CricketTotals.tsx`. Modify the dictionaries and `padFit.test.ts`.

- The card "Players not entered — ask the organiser".
- Per over: runs (stepper), wickets, legal balls (default `ballsPerOver`, fewer for a last part over). Sent as `cricket.innings.summary` with the innings' running totals, `partial: true`.
- Once an innings has a summary, the ball pad returns only from the next innings.
- A tie says "Tied — the organiser decides the super over" and stops (ruling 74).

- [ ] **Step 1: Failing tests:**
  - `two overs send running totals 8/0 then 15/1`.
  - `a part last over sends its legal balls`.
  - `players entered mid-innings keep totals until the next innings`.
  - `a tie in totals mode stops with the organiser line`.
- [ ] **Step 2–5:** Fail; implement; verify; commit `feat(cricket): over totals when players are not entered`.

### Task 18: Match details, History pass, fit at 320/360 in four languages

**Files:** Modify `src/ui/components/PadSheets.tsx` (Match details takes a sport's extra block as a prop), `CricketPadScreen.tsx`, `padFit.test.ts`, the dictionaries and the glossary.

- ⓘ shows the match block, the rule rows and each innings' scorecard (batting, bowling, extras, fall of wickets) from `deriveCricketScorecard`.
- Sweep every `scoring.cricket.*` key for a fit case.

- [ ] **Step 1: Failing tests:**
  - `every scoring.cricket key has a fit case`: a test over the dictionary's keys, asserting each appears in the fit table.
  - Every sheet's longest row at 320 and 360 dp in es, fr and nl, with 30-character names.
  - `the scorecard shows fall of wickets`.
- [ ] **Step 2–5:** Fail; shorten copy that does not fit; verify; commit `feat(cricket): match details and the fit at 320`. Opus Batch 5 review.

### Task 19: The exit bar on staging (owner's hands; P4 done)

- [ ] **Step 1:** arm64 release from a clean detached worktree at the pushed commit; `adb -s 12be753e install -r`. Revert prebuild's `package.json`.
- [ ] **Step 2:** Spec §8 items 1–11, plus S2 §10 items 2–7 (offline, co-scorer, kill and reopen, finalize, Update needed), plus the mid-over change and the swap if Task 13's ruling made them, plus ruling 82's rows. Record what the screen and the console showed.
- [ ] **Step 3:** 320 dp (`adb -s 12be753e shell wm density 540`, then `reset`) in the longest locale with the longest names: the pad, every sheet, Players and the break card. Crop screenshots, nothing personal, no scanned code's value.

### Task 20: Results, house rules, PR

**Files:** Create `docs/specs/2026-11-xx-s2-4-results.md`. Modify `AGENTS.md` §1/§3 (cricket named; notify s2-5 first) and `docs/i18n-glossary.md`.

- [ ] **Step 1:** Results item by item, with Task 1's R4 numbers and the findings sent to the web and the engine.
- [ ] **Step 2:** Opus whole-branch review; a fix round; the same reviewer re-checks.
- [ ] **Step 3:** One PR to main after the owner's go. Merging and tags are the owner's call.

