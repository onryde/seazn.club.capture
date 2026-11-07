# S2-4 Cricket — the web pad's fixes and the engine major: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser's cricket pad records what the phone records. The toss is asked by team name. The pad asks for the openers and every bowler instead of picking them. It asks the runs on a wide and on a no-ball, has no timer on an extra, asks the runs completed on a run out, offers the keeper on a stumping, and skips "Who walks in?" after a wicket that ends the innings. The layout doesn't jump. All of this runs on the new engine major, with its mid-over bowler change and its hand strike swap.

**Architecture:** Every pad change lives in the cricket skin (`apps/web/src/components/v2/scorepad/v3/skins/cricket.tsx`). The shared chassis (`pad-host.tsx`, `types.ts`, `guided-sheet.tsx`) is not changed. Extras become the skin's own guided sheets, which have no timer, and the skin's dock returns null, so no cricket ball soft-commits. Rule facts come from the engine: `cricketPadRules`, `eligibleBowlers`, `eligibleChangeBowlers`, `eligibleIncomingBatters`, `suggestedIncomingBatter`, and a trial `cricket.apply` of the candidate ball. The web types in no cricket rule of its own. There is one server change: the division gate's WRONG_PHASE carries a reason, which the pad turns into its own sentence. The scorecard readers learn the split over.

**Tech Stack:** Next.js app `apps/web`; TypeScript 7 (`typescript-native`); vitest 4 (node environment, no DOM); Playwright. `@seazn/engine` = `npm:@onryde/seazn-engine@^4.0.0` (confirm against the engine release).

**Spec:** `/Users/ashokhein/github/seazn.club.capture-worktrees/s2-4/docs/specs/2026-11-07-s2-4-cricket-design.md`: §7 (the web side), §4 (the behaviour the web pad must match), rulings 67, 71, 72, 75, 76. Engine names come from branch `feat/cricket-s2-4` (worktree `/Users/ashokhein/github/seazn.club.engine-worktrees/cricket-s2-4`, commit a895160, plus uncommitted work as of 2026-11-07).

**Preconditions:**
1. The owner releases the engine major carrying ruling 71's three changes. It gates Task 1 and Tasks 6–9. Tasks 2–5 and 10 read no new engine name and may land first on the same branch.
2. Not this plan's: the device-link bootstrap's lineup fields (`slot`, `order_no`, `role`, `roles`), built by the football session on web branch `feat/device-link-lineup-and-football-clock` (worktree `/Users/ashokhein/github/seazn.club-worktrees/s2-5-web`). The phone needs it; this plan neither needs it nor touches its files.
3. The owner's staging fixture: org `my-organization-31`, competition "Cricket S2-4 Test" (Task 11).

**Engine names this plan uses** (confirm each against the engine release):

| Name | Import | State on 2026-11-07 |
| --- | --- | --- |
| `cricketPadRules.wideDismissalKinds`, `.noBallDismissalKinds` (`readonly string[]`, frozen) | `@seazn/engine/pad` | committed a895160 (CK-WD-1, CK-NB-1, ruling 276) |
| `orderFromLineup` | `@seazn/engine/sports/cricket` | committed; the web does not call it |
| A ball naming the fold's pair reversed is accepted (CK-SS-1, ruling 277) | fold behaviour, no new name | uncommitted; main innings only — confirm for the super over |
| `cricket.bowler.change {bowler: PersonId, reason?: "incapacitated" \| "suspended" \| "other"}`, `CricketBowlerChange`, `eligibleChangeBowlers(order, fine, maxOversPerBowler, ballsPerOver): string[]`, `oversUsed(fine, bowler, bpo): number`, `FineInnings.prevOverBowlers? / overSpells? / partOvers? / partOverBalls?`, `OverLog.bowlers?: PersonId[]`, padSpec action label key `pad.cricket.action.bowlerChange` (CK-BC-1, CK-BO-3, ruling 278) | `@seazn/engine/sports/cricket` | uncommitted |
| `FOLD_EPOCH.cricket` 2 → 3; package 3.0.2 → 4.0.0 | `@seazn/engine/sport` | not yet raised on the branch |

## Global Constraints

- **Worktree:** `git -C /Users/ashokhein/github/seazn.club fetch origin main && git -C /Users/ashokhein/github/seazn.club worktree add /Users/ashokhein/github/seazn.club-worktrees/s2-4-cricket-pad-fixes -b feat/s2-4-cricket-pad-fixes origin/main`. Below, `$WT` is that path. Then follow seazn-local-env §2: `pnpm install --frozen-lockfile`, both `.env.local` symlinks, and `.claude/agent-memory`. Never check out in the main repo dir. Every Bash call starts `cd $WT &&`. Never `git stash`.
- **Local verification policy:**
  - **Type-check only the changed files.** `$WT/apps/web/tsconfig.s2-4-check.json` = `{"extends": "./tsconfig.json", "include": [], "files": ["next-env.d.ts", …the changed and added .ts/.tsx files]}`. Run: `cd $WT/apps/web && node ../../node_modules/typescript-native/bin/tsc --noEmit -p tsconfig.s2-4-check.json`. Never commit it: add it to the worktree's `info/exclude` (resolve the path through `cat $WT/.git`).
  - **Run only the changed or added test files:** `cd $WT/apps/web && pnpm exec vitest run <file> [-t "<name>"] --reporter=json --outputFile=$SCRATCH/<n>.json`. Read `numTotalTests`, `numFailedTests` and `numPendingTests` (DB suites skip silently without `.env.local`). Confirm `.testResults[].name` resolves under `$WT`. DB-backed files need `seazn-env up --label s2-4 --no-placement` first.
  - **A local `next build`** runs only as `SKIP_TYPECHECK=1 NEXT_BUILD_FS_CACHE=1 npm run build` (or `seazn-env up --server` / `rebuild`). This is local only: never add `SKIP_TYPECHECK` to CI or deploy config.
  - **The full suite, lint and e2e run on CI after a push.** E2e: `gh workflow run e2e.yml -f pr=<PR number>`, whole files, never `-g`. A serial file's red count is a floor (AGENTS 21). Lint locally only on changed files (`rtk proxy`).
- AGENTS.md and `docs/superpowers/TEST-STRATEGY.md` bind every task:
  - every sweep reports its count, and zero checked is a failure;
  - expected values come from the engine's declarations or the Laws, never from the code under test;
  - mutate each new guard once and see the test go red;
  - a seam is proven by folding the skin's own payload through the real engine (`foldEmitted` in `pad-rules-cricket.test.ts`).
- **The pad offers only what the engine accepts** (spec §2 anti-goals). No cricket rule literal goes in the skin; `skins/__tests__/no-rule-literals.test.ts` stays green. The keeper role key and the `WK` group key are read from the engine's cricket position catalog (`cricket.ts:2856-2866`; confirm the module accessor), never typed.
- **Copy:** every new string goes in `apps/web/src/dictionaries/{en,es,fr,nl}/ui.json`; then `npm run i18n:gen-keys` (regenerates `src/lib/i18n-keys.ts`). Translations are the controller's until a native reader checks them.
- **Don't touch the football branch's files:** `v3/pad-host.tsx`, `v3/clock.ts`, `scorepad/transport.ts`, `server/usecases/device-link-bootstrap.ts`, `server/usecases/fixtures.ts`, `server/api-v1/schemas.ts`, `server/api-v1/openapi.ts`, `skins/football.tsx`. `openapi/v1.json` and `openapi/v1.public.json` are regenerated with `npm run openapi:gen`, never hand-merged. If Task 10's fix needs `pad-host.tsx`, it waits for that branch to merge and rebases first.
- UI is verified by screenshot at 1280, 768 and 320, with no horizontal page scroll.
- **Staging:** `stg.yml` deploys every push to `main`, so reaching staging means a merge, and a merge needs the owner's word. Staging comes before the phone's exit bar (ruling 72). The check is on the owner's fixture (org `my-organization-31`, "Cricket S2-4 Test").
- **No merge and no prod deploy without the owner's word.** Never run `prod.yml`. A manual `fly deploy -c fly.stg.toml` is not used unless the owner asks.
- **Subagents on Opus**, an implementer and a reviewer per task, and one whole-branch review before the PR (AGENTS 12).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. **A pending bowler pick after a take-back.** The over ends, the scorer picks the next bowler, then takes back the over's last ball. The over is open again, and the fold's `currentBowler` must win over the stale pick, or the next ball names a second bowler mid-over and is refused. Test: Task 3, `mid-over the fold's bowler wins over a stale pending pick`.
2. **A wicket off a wide on the innings' last legal ball.** A wide is not a legal ball, so the innings goes on and "Who walks in?" must still be asked. Test: Task 6, `a stumping off a wide on the last legal ball still asks who walks in`.
3. **A run out whose completed runs win the chase.** The chase ends on that ball, so no next batter is asked. Test: Task 5, `a run out whose completed runs win the chase asks no next batter`.
4. **The over after a split over.** Neither bowler of the split over may bowl it (Law 17.7, 17.8): both are greyed with the previous-over reason, and the part over counts toward the quota. Test: Task 8, `after a split over both bowlers are greyed for the next over`.
5. **A Hundred match (5-ball overs).** The over ends at 5, and the sixth tap is blocked until a bowler is picked. No `6` is hidden in any new step. Test: Task 3, `a hundred over ends at five balls`.

---

### Task 1: Take the engine major (waits on the owner's release)

**Files:**
- Modify: `package.json:73`, `apps/web/package.json:25` (`^3.0.2` → `^4.0.0`), `pnpm-lock.yaml`
- Modify: `apps/web/src/lib/scoring-vocab.ts`: `EVENT_KEY` (beside `"cricket.retire"` at :128) gains `"cricket.bowler.change": "event.cricket.bowler.change"`; `ENUM_VOCAB` gains any of `incapacitated`/`suspended` its `reason` maps lack
- Modify: `apps/web/src/dictionaries/{en,es,fr,nl}/ui.json`: `event.cricket.bowler.change` ("Bowler changed"), `pad.cricket.action.bowlerChange` ("Change bowler", the engine padSpec's own key), reason words; regenerate `src/lib/i18n-keys.ts`
- Modify: `skins/cricket.tsx` `refusedEventTypes` (:1617): `cricket.bowler.change` is always refused until Task 8 gives it a surface
- Test: `apps/web/src/lib/__tests__/scoring-vocab.test.ts`, `v3/__tests__/cricket-dispatch-totality.test.ts`, `skins/__tests__/pad-rules-cricket.test.ts`; `server/usecases/__tests__/scoring-engine-epoch.test.ts` must stay green unchanged (it reads `foldEpochOf`)

**Interfaces:**
- Produces: the engine names in the table above, importable in `apps/web`.

- [ ] **Step 1: Gate.** `gh release view v4.0.0 -R onryde/seazn.club.engine` exists. Its epoch report raises `cricket` only (2 → 3), and its notes name rulings 276–278. Anything else: stop and report.
  This raise is the migration the engine-release skill §2.3 stops on. It is safe here for three reasons:
  - the 426 gate (`server/usecases/scoring.ts:804`) refuses cricket writes only from clients that send `engine_epoch` < 3;
  - the browser pad sends no epoch (`git grep -n -a engine_epoch -- apps/web/src/components` is empty);
  - no phone scores cricket yet (spec §7.3), and stored ledgers fold unchanged by the engine's golden proof.
  Record these in the PR body.
- [ ] **Step 2:** Create the worktree (Global Constraints), set both ranges to `^4.0.0`, run `pnpm install`, and check `readlink -f node_modules/@seazn/engine` resolves inside `$WT`. The diff is the two lines plus `pnpm-lock.yaml`.
- [ ] **Step 3: Failing test** in `pad-rules-cricket.test.ts`:
```ts
it("S2-4 T1: More never lists cricket.bowler.change", () => {
  let checked = 0;
  for (const specs of [START, MID_OVER, OVER_END]) {
    const view = viewOf(T20, specs);
    const more = moreActions(cricket.padSpec!(T20), ctxOf(view), dedicatedEventTypes(buildTiles(view, t), buildSheets(view, t), [], buildScorebug(view, t)), new Set(refusedEventTypes(view)));
    expect(more.map((a) => a.type)).not.toContain("cricket.bowler.change");
    checked++;
  }
  expect(checked).toBe(3);
});
```
  `MID_OVER` and `OVER_END` are new fixtures built from `_cricket-fold.ts` `ballSeq`.
- [ ] **Step 4:** Run `pad-rules-cricket.test.ts`, `scoring-vocab.test.ts` and `cricket-dispatch-totality.test.ts`. Expected: the new test fails, and any vocab or dispatch totality test fails on the new event type.
- [ ] **Step 5:** Add the vocab, the copy and the `refusedEventTypes` line.
- [ ] **Step 6:** The same three files plus `scoring-engine-epoch.test.ts` pass. Type-check the changed files. Mutate: drop the refused line → the T1 test fails.
- [ ] **Step 7:** Commit: `chore(engine): take @onryde/seazn-engine 4.0.0 (cricket epoch 3)`.

### Task 2: The toss names the teams, and the division gate says why

**Files:**
- Modify: `skins/cricket.tsx` `tossSheet` (:2360-2387): options carry `labelText: view.entrantNames[side]`; the key stays as the fallback label when a name is absent
- Modify: `apps/web/src/lib/division-phase.ts`: `export const DIVISION_GATE_REASON = { notStarted: "division_not_started" } as const; export function isDivisionGateReason(x: unknown): x is "division_not_started"`
- Modify: `apps/web/src/server/usecases/scoring.ts:563-567`: the gate's EngineError data gains `reason: DIVISION_GATE_REASON.notStarted`
- Modify: `apps/web/src/server/api-v1/http.ts` (beside the LEVEL_RESULT/SETTLE branches, :300-313): forward `reason` for `WRONG_PHASE` when `isDivisionGateReason`
- Modify: `apps/web/src/lib/scoring-vocab.ts` `ENGINE_ERROR_REASON_KEY`: `WRONG_PHASE: { division_not_started: "engineErrorReason.WRONG_PHASE.division_not_started" }`; copy: "The competition hasn't started yet. The organiser starts it on the division page, then you can record the toss."
- Test: `skins/__tests__/pad-rules-cricket.test.ts`, `server/api-v1/__tests__/http.test.ts`, `components/v2/scorepad/__tests__/refusal-copy.test.ts`, and the usecase test that pins the gate (`git grep -n -a "scoring is closed" -- apps/web/src/server`; if none pins it, add `server/usecases/__tests__/scoring-division-gate.test.ts` on `_rig.ts`)

**Interfaces:**
- Produces: `DIVISION_GATE_REASON`, `isDivisionGateReason` (`lib/division-phase.ts`).

- [ ] **Step 1: Failing tests.**
  - `the toss names the teams, by entrant id, and folds`: `choiceIds(...toss, "wonBy")` equals `[squads.home.entrantId, squads.away.entrantId]`; each option's `labelText` equals `view.entrantNames.home` / `.away`; the walked payload folds through `foldEmitted`.
  - `a toss in a Draft division is refused with reason division_not_started` (usecase test): the error code is `WRONG_PHASE` and `data.reason` is `"division_not_started"`.
  - `http forwards WRONG_PHASE's division reason and no other` (http.test.ts).
  - `refusal copy reads the not-started sentence for that reason and the generic one without it` (refusal-copy.test.ts).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Four locales, then `i18n:gen-keys`.
- [ ] **Step 4:** PASS. Type-check. Mutate the http whitelist (`return true`) → the "no other" case fails.
- [ ] **Step 5:** Commit: `fix(cricket-pad): the toss names the teams; a Draft division's refusal says it hasn't started`.

### Task 3: No silent picks — openers, the opening bowler, every next bowler (gaps 1, 2)

**Files:**
- Modify: `skins/cricket.tsx`:
  - `resolvePeople` (:553-661). No `defStriker`/`defNonStriker` fallback, and no `eligibleBowlers(...)[0]` fallback: an unpicked end or bowler is `""`. In a super over, `nextEligible()` stays only for a single vacant end (the replacement after a wicket), never when both ends are vacant. Mid-over (`fine.currentBowler` set), the fold's bowler wins over `overrides.bowler`.
  - `BowlerBlockReason` (:663) gains `"unpicked"`. `bowlerBlockReason` (:715-735) returns `"unpicked"` when `people.bowler === ""` and `eligibleBowlers` is non-empty, and `"noEligible"` when it is empty.
  - `buildTiles` `ballTile` (:1449) is also disabled when `people.striker === "" || people.nonStriker === ""`.
  - `buildContext` (:2040-2160): the striker slot's message is `pad.cricket.context.openers.unpicked` ("Pick the two openers"); the bowler slot's message for `"unpicked"` is `pad.cricket.context.bowler.unpicked` ("Pick the bowler for over {over}", using `nextOverNumber`).
- Modify: dictionaries (4) and `i18n-keys.ts`
- Modify: `apps/web/e2e/helpers.ts`: `export async function pickCricketPeople(page: Page, picks: { striker?: string; nonStriker?: string; bowler?: string }): Promise<void>` (opens each chip's picker and taps the name). Also modify every e2e file that taps a cricket ball tile before or after an over end. The list is `git grep -n -a 'data-tile-id="\(run\|wide\|wicket\|extra-\)' -- apps/web/e2e`, filtered to cricket fixtures by reading each hit. At least: `scorepad-v3-cricket.spec.ts`, `scorepad-v3-cricket-lines.spec.ts`, `mobile.spec.ts`, `scorepad-skins.spec.ts`, `scorepad-v3-a11y-sweep.spec.ts`, `gallery.capture.ts`, `walkthrough/scorepad-v3-cricket-icc-picks.spec.ts`, `walkthrough/scorepad-v3-deciders-*.spec.ts`, `walkthrough/scorepad-v3-honest-recording.spec.ts`. These files gain picks; never weaken an assertion.
- Test: `skins/__tests__/cricket.test.ts` (rewrite the default tests at :218 and :223 to the new rule), `skins/__tests__/pad-rules-cricket.test.ts`

**Interfaces:**
- Produces: `resolvePeople(state, overrides, cfg): ResolvedPeople` (signature unchanged; `""` means unpicked); `BowlerBlockReason` adds `"unpicked"`; `pickCricketPeople` (e2e).

- [ ] **Step 1: Failing tests** (`pad-rules-cricket.test.ts`, `describe("S2-4 gaps 1-2: nothing is picked for the scorer")`):
  - `before the first ball the openers and the bowler are unpicked and every ball tile is disabled, with the reason on the strip`: the three people are `""`; every ball tile is `disabled` (count > 0); the striker slot message is `pad.cricket.context.openers.unpicked`; the bowler slot message is `pad.cricket.context.bowler.unpicked`.
  - `with the three picked, the first ball names them and folds`: overrides `{striker: "H-3", nonStriker: "H-1", bowler: "A-9"}` (not the order's first two); the run-1 payload names them; `foldEmitted` dismisses nobody and credits A-9.
  - `at an over's end the bowler is unpicked; the picker greys the last over's bowler (prevOver) and a bowler at quota (quota)`: `bowlerBlocked` keys are exactly `T20` ineligible ids per `eligibleBowlers`; reasons as named.
  - `a hundred over ends at five balls` (Review Focus 5): after 5 legal balls with `HUNDRED`, the bowler is `""` and ball tiles are disabled; after 4 they are not.
  - `mid-over the fold's bowler wins over a stale pending pick` (Review Focus 1): over end, then `core.void` of its last ball, with overrides `{bowler: "A-9"}` → `resolvePeople(...).bowler === OPENING_BOWLER`.
  - `a fresh super-over innings asks for both batters and the bowler; a single vacant end after a wicket still defaults to the one eligible batter` (built with `tiedWithSuperOver`).
- [ ] **Step 2:** Run. Expected: FAIL (today's defaults fill all three).
- [ ] **Step 3:** Implement the skin changes and copy. Then update the e2e files through `pickCricketPeople`.
- [ ] **Step 4:** `pad-rules-cricket.test.ts` and `cricket.test.ts` pass, with `numTotalTests` equal to before plus the new tests. Type-check. Mutate the striker-unpicked clause of `ballTile` → the first test fails. Mutate the mid-over precedence → Review Focus 1's test fails.
- [ ] **Step 5:** Screenshots at 320, 768 and 1280 of the unpicked strip. Commit: `fix(cricket-pad): ask the openers and every bowler, never pick them`.

### Task 4: Extras open sheets with no timer (gaps 3, 4)

**Files:**
- Modify: `skins/cricket.tsx`:
  - The `wide` tile (:1457) and the `noball`/`bye`/`legbye` minor tiles (:1466-1484) become `action: { sheet: "wide" | "noball" | "bye" | "legbye" }`. `penalty` stays an immediate event of `cricketPadRules.penaltyRuns`.
  - New `extraSheet(view: PadHostView, kind: "wide" | "noball" | "bye" | "legbye"): GuidedSheetSpec`, registered in `buildSheets` (:2638).
  - `buildDock` (:1713) returns `null` for every cricket payload. Delete `batRunChip`, `extraRunChip`, `BAT_RUN_VALUES` and `EXTRA_RUN_VALUES` (:1673-1711), and the `pad.cricket.dock.*` keys if nothing else reads them (`git grep -n -a`).
- Modify: dictionaries (4) and `i18n-keys.ts`: `pad.cricket.sheet.{wide,noball,bye,legbye}.title`, `pad.cricket.sheet.extra.ran.{0..4}`, `pad.cricket.sheet.extra.bat.{0,1,2,3,4,6}`
- Modify: `v3/__tests__/dock.test.ts` (the cricket chip cases go); `apps/web/e2e/scorepad-v3-soft-commit-inventory.spec.ts:169-190` (cricket: plain immediate, no-ball through its sheet then immediate, wide through its sheet then immediate); `walkthrough/scorepad-v3-soft-commit-visual.spec.ts` (its cricket no-ball hold)
- Test: `skins/__tests__/pad-rules-cricket.test.ts`

**Interfaces:**
- Produces: sheets `wide`, `noball`, `bye`, `legbye`. The first step's id is `runs`, with answers as option ids:
  - wide: `"0"`–`"4"` runs run;
  - no-ball: `"bat:0"`, `"bat:1"`, `"bat:2"`, `"bat:3"`, `"bat:4"`, `"bat:6"`, `"ran:1"`–`"ran:4"`;
  - bye and leg-bye: `"1"`–`"4"`.
  Task 6 appends an `"out"` option to the wide and no-ball sheets.
- Payloads (spec §4.2):
  - wide `n` → `runs: {bat: 0, extras: {kind: "wide", runs: wideDefaultRuns + n}}`;
  - no-ball `bat:n` → `runs: {bat: n, extras: {kind: "noball", runs: noBallDefaultRuns}}`, plus `boundary: n` when `cricketPadRules.boundaryValues` holds `n`;
  - no-ball `ran:n` → `runs: {bat: 0, extras: {kind: "noball", runs: noBallDefaultRuns + n}}`;
  - bye or leg-bye `n` → `runs: {bat: 0, extras: {kind, runs: n}}`.

- [ ] **Step 1: Failing tests.**
  - `a wide asks the runs run, 0-4, and the innings takes wideDefaultRuns + n`: for each n, `openInnings(foldEmitted(...)).runs === cricketPadRules.wideDefaultRuns + n` and `legalBalls` doesn't move; count 5.
  - `a no-ball asks runs off the bat or runs run; both fold and a free hit follows`: 10 options; each folds; `fine.freeHitPending === true` after each; boundaries only on bat 4 and 6.
  - `a bye and a leg-bye ask 1-4 into the extra's runs`: 8 folds.
  - `no cricket ball soft-commits`: for every payload a cricket tile or sheet emits (≥ 25, counted), `softCommitPlan(buildDock(type, t, payload), payload) === "send"` (`softCommitPlan` imported from `../../pad-host`, read-only).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS (plus `dock.test.ts`). Type-check. Mutate: give `buildDock` back the no-ball chips → the soft-commit test fails.
- [ ] **Step 5:** Commit: `fix(cricket-pad): extras ask their runs on a sheet; no cricket ball waits on a timer`.

### Task 5: The wicket sheet — keeper, runs completed, no needless "Who walks in?" (gaps 5, 6, 7)

**Files:**
- Modify: `skins/cricket.tsx`:
  - Extract `wicketSteps(view: PadHostView, delivery: "fair" | "wide" | "noball", gate: StepPredicate): GuidedSheetStep[]` and `wicketPayload(view, delivery, answers, base: Record<string, unknown>): Record<string, unknown>` from `wicketSheet` (:2249-2357). `wicketSheet` becomes `wicketSteps(view, "fair", always)`.
  - Stumping: a step `keeper` (`when: kind === "stumped"`) with `candidates = keeperCandidates(view, bowlingSide, bowler)`. The `fielder` step is `when: fielderRequired(kind) && kind !== "stumped"`.
  - Run out: a step `completed`, choice `"0"`–`"3"`, `when: kind === "runout"`. A fair ball puts it in `runs.bat`.
  - The `incoming` step (`incomingPersonStep`, :2191) gains `when: (answers) => !wicketEndsInnings(view, wicketPayload(view, delivery, answers, base))`.
  - `export function keeperCandidates(view: PadHostView, side: "home" | "away", bowler: string): string[]`: on-field members whose `roles` hold the catalog's keeper role key; else whose `positionKey` is the catalog's `WK` group key; else the on-field side without `bowler`.
  - `export function wicketEndsInnings(view: PadHostView, payload: Record<string, unknown>): boolean`: a trial `cricket.apply` (strict) of the candidate ball on `view.state`, with an envelope shaped as the pad's optimistic ones (the fields `_cricket-fold.ts` `cricketEnvelopes` builds). True when the scoring innings is closed afterwards, or the phase leaves `live`/`super_over`. A refusal reads false, so the step is asked.
- Modify: dictionaries (4) and `i18n-keys.ts`: `pad.cricket.sheet.wicket.keeper.title`, `pad.cricket.sheet.wicket.completed.title`, `pad.cricket.sheet.wicket.completed.{0..3}`
- Test: `skins/__tests__/pad-rules-cricket.test.ts`. Update `:121` (`asked.get(OBSTRUCTED)`) and `:175` (the free-hit walk), and the `same(asked.get("runout"), …)` step lists: run out now asks `completed`, and stumped asks `keeper`.

**Interfaces:**
- Produces: `wicketSteps`, `wicketPayload`, `keeperCandidates`, `wicketEndsInnings` (Task 6 consumes the first two and the last).

- [ ] **Step 1: Failing tests.**
  - `stumped offers the keeper: by role, else by WK position, else the side without the bowler`: three lineups (from `cricketLineups()` with `roles: [keeperKey]` on A-5; with `positionKey: wkKey` on A-6; with neither). The candidates are `["A-5"]`, `["A-6"]`, and the fielding order minus `OPENING_BOWLER`. Each payload folds.
  - `a run out asks runs completed 0-3 and the batting side gets them`: for each n, `runs.bat === n`, the fold's runs go up by n and the dismissed batter is the one named.
  - `the next batter is asked on an ordinary wicket and not on the innings' last legal ball, at all out, or on the super over's second wicket`: four states; `asked` includes `incoming` only for the first.
  - `a run out whose completed runs win the chase asks no next batter` (Review Focus 3): second innings needing 2; run out with `completed: "2"` → no `incoming`; with `"0"` → asked.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Type-check. Mutate: make `wicketEndsInnings` return `false` → the gap 7 test fails; drop the keeper `when` → the stumping test fails.
- [ ] **Step 5:** Commit: `fix(cricket-pad): keeper on a stumping, runs on a run out, no next batter when the innings ends`.

### Task 6: "+ Out" off a wide and a no-ball, with the engine's kinds (needs Task 1)

**Files:**
- Modify: `skins/cricket.tsx`:
  - `extraSheet` for `wide` and `noball` appends the option `"out"` (label `pad.cricket.sheet.extra.out`), followed by `wicketSteps(view, kind, (a) => a.runs === "out")`.
  - Kinds narrowing (beside :2268): `delivery === "wide"` → `cricketPadRules.wideDismissalKinds`; `"noball"` → `noBallDismissalKinds`; a pending free hit narrows further by `freeHitDismissalKinds`. Order is kept from `wicketKinds`.
  - `wicketPayload` for a wide or no-ball: `completed` goes into the delivery's own `extras.runs` (`defaultRuns + completed`; spec §4.3 item 4, §11).
- Test: `skins/__tests__/pad-rules-cricket.test.ts`

**Interfaces:**
- Consumes: `wicketSteps`, `wicketPayload`, `wicketEndsInnings` (Task 5); `cricketPadRules.wideDismissalKinds` and `.noBallDismissalKinds` (Task 1).

- [ ] **Step 1: Failing tests.**
  - `CK-WD-1 on the web: Out off a wide offers exactly wideDismissalKinds, and each folds`: offered kinds sorted equal the engine's set sorted; each walked payload folds with the batter dismissed; count = the set's length.
  - `CK-NB-1 on the web: Out off a no-ball offers exactly noBallDismissalKinds, and each folds`: the same.
  - `a run out off a wide or a no-ball puts the runs completed into that extra's runs`: wide with completed 2 → `extras.runs === wideDefaultRuns + 2`; no-ball → `noBallDefaultRuns + 2`; both fold.
  - `a stumping off a wide on the last legal ball still asks who walks in` (Review Focus 2).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Type-check. Mutate: use `wicketKinds` for the wide → CK-WD-1 on the web fails.
- [ ] **Step 5:** Commit: `fix(cricket-pad): a wicket off a wide or a no-ball offers only the engine's kinds`.

### Task 7: The hand strike swap — the pair reversed (needs Task 1; ruling 76)

**Files:**
- Modify: `skins/cricket.tsx`:
  - `creaseEndLocked` (:293-299) is replaced by `export function swapCandidates(scoring: CricketInningsShape | null, end: "striker" | "nonStriker", phase: CricketStateShape["phase"]): string[] | null`. It returns null when the end is editable as today (unfaced incoming); `[otherEnd]` for a faced end in an open main innings; `[]` (read-only) otherwise, including a super over unless the engine release says the swap holds there.
  - `buildContext` uses it, with copy `pad.cricket.context.batter.swap` as the candidate hint.
  - `resolvePeople`: an override naming the fold's other end puts the fold's striker or non-striker at the vacated end. That is the pair reversed and nothing else.
- Test: `skins/__tests__/pad-rules-cricket.test.ts`

**Interfaces:**
- Produces: `swapCandidates`.

- [ ] **Step 1: Failing tests.**
  - `the striker chip on a faced pair offers only the non-striker, and the next ball names the pair reversed and folds on the write path`: after one ball, the striker slot candidates are `[NON_STRIKER]`; with overrides `{striker: NON_STRIKER}`, the payload names `striker: NON_STRIKER, nonStriker: STRIKER`, and `foldEmitted` accepts it.
  - `no third batter is ever offered at a faced end`: across 6 states, every faced-end candidate list has length ≤ 1 and holds only the other end's batter.
  - `the super over offers no swap` (or the opposite, per the release; the test reads whichever the engine accepts by folding the reversed pair).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Type-check. Mutate: let a faced end offer the whole order → the "no third batter" test fails.
- [ ] **Step 5:** Commit: `feat(cricket-pad): swap the batters' ends by tapping the striker`.

### Task 8: A mid-over bowler change (needs Task 1; ruling 75)

**Files:**
- Modify: `skins/cricket.tsx`:
  - `CricketFineShape` (:147) gains `prevOverBowlers?: string[]`, `overSpells?: { bowler: string; legalBalls: number }[]`, `partOvers?: Record<string, number>`, `partOverBalls?: Record<string, number>`.
  - `export function bowlerChangeOpen(state: CricketStateShape, cfg: CricketCfgShape): boolean`: `phase === "live"`, a fine scoring innings, `fine.currentBowler != null`, and `eligibleChangeBowlers(...)` non-empty.
  - More lists it (the engine's padSpec Innings drawer, label `pad.cricket.action.bowlerChange`) only when it is open, and it opens `bowlerChangeSheet`; no tile (ruling 84: the change lives in More).
  - `refusedEventTypes` (Task 1's line) refuses `cricket.bowler.change` exactly when it is not open (one condition, two readers).
  - `bowlerChangeSheet(view): GuidedSheetSpec`. Steps: `bowler` (person, `candidates: eligibleChangeBowlers(order, fine, cfg.maxOversPerBowler, bpo)`) and `reason` (choice; values from `CricketBowlerChange`'s schema enum, never a typed list). Payload: `{bowler, reason}`.
  - `bowlerBlockReason` (:715) and `bowlerBlocked` (:1837): `prevOver` also when `fine.prevOverBowlers` holds the bowler. The quota reason is already right through the engine's `eligibleBowlers`/`oversUsed`.
  - `cricketBallDetail`'s activity hook words a `cricket.bowler.change` row: `pad.cricket.activity.bowlerChange` ("{name} completes the over").
  - `bowlerIsReadOnly` (:286) keeps its behaviour (the chip is not the change's door; More is); its doc is corrected.
- Modify: dictionaries (4) and `i18n-keys.ts`: `pad.cricket.sheet.bowlerChange.{bowler,reason}.title`, `pad.cricket.activity.bowlerChange`
- Test: `skins/__tests__/pad-rules-cricket.test.ts`, `skins/__tests__/cricket.test.ts` (activity)

**Interfaces:**
- Consumes: `eligibleChangeBowlers`, `CricketBowlerChange`, `FineInnings.prevOverBowlers` (Task 1).
- Produces: `bowlerChangeOpen`.

- [ ] **Step 1: Failing tests.**
  - `mid-over More lists Change bowler, which offers eligibleChangeBowlers, folds, and the over's next ball names the new bowler`: the candidates equal the engine's call on the folded state; the change folds; the next run tile's payload names the new bowler and folds.
  - `no Change bowler before the first ball, at an over's end, in a super over or in an over-totals innings; More agrees`: for 4 states, no tile, and `refusedEventTypes` holds the type.
  - `after a split over both bowlers are greyed for the next over` (Review Focus 4): `bowlerBlocked` reasons are `prevOver` for both; with `maxOversPerBowler: 1`, each is out of the quota after the part over (`oversUsed`).
  - `a bowler change row in History names who completes the over`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Type-check. Mutate: drop the `prevOverBowlers` clause → Review Focus 4's test fails; make `bowlerChangeOpen` always true → the "no Change bowler" test fails.
- [ ] **Step 5:** Commit: `feat(cricket-pad): change the bowler mid-over (Law 17.8)`.

### Task 9: The scorecard readers read a split over (needs Task 1)

**Files:**
- Modify: `apps/web/src/server/public-site/match-centre-schema.ts:96` (an over gains `bowlers: z.array(Person).optional()`, present only for a split over)
- Modify: `apps/web/src/server/public-site/match-centre.ts`: `buildOverLogView` (:495) fills `bowlers` from `over.bowlers`; `ballLines` (:429) names `over.bowlers` joined with " / " for a split over (the engine gives no per-ball split; spec gap)
- Modify: `apps/web/src/components/public-site/match-centre/scorecard-tab.tsx` (the over header lists every bowler); `openapi/v1.json`, `openapi/v1.public.json` via `npm run openapi:gen`
- Verify, and change only if red: `apps/web/src/lib/overlay-cricket.ts:96` (the live bowler's line after a change) and `apps/web/src/server/appearances.ts` (`figuresByPerson`)
- Test: the match-centre unit test beside `match-centre.ts` (`git grep -l -a buildOverLogView -- '*.test.ts'`), `lib/__tests__/overlay-cricket*.test.ts`, `server/__tests__/appearances*.test.ts`

**Interfaces:**
- Consumes: `OverLog.bowlers` (Task 1).

- [ ] **Step 1: Failing tests** (each built from a folded ledger with a change after ball 3, through `deriveCricketScorecard`):
  - `a split over names both bowlers in order and its ball lines never credit the first alone`;
  - `after a change the overlay's bowler is the new bowler with his own figures` (balls equal those bowled after the change);
  - `a bowler who only completed another's over is credited figures and an appearance`.
- [ ] **Step 2:** Run. Expected: the match-centre test fails; the other two may pass (they are then regression pins; record which).
- [ ] **Step 3:** Implement, then `npm run openapi:gen`.
- [ ] **Step 4:** PASS. Type-check. Mutate: drop `bowlers` from `buildOverLogView` → the test fails.
- [ ] **Step 5:** Commit: `feat(match-centre): a split over names every bowler`.

### Task 10: The pad holds still (gap 8)

**Files:**
- Create: `apps/web/e2e/scorepad-v3-cricket-steady-layout.spec.ts`
- Modify, after measuring and only where it moves: the regions the probe names. Likely candidates: the scorebug strip's free-hit item (`StripItem.reserved`/`reserve`, `buildScorebug`), the context strip's message line, and the target line. Prefer skin-side reservation (`buildScorebug`/`buildContext`). A chassis file (`scorebug.tsx`, `context-strip.tsx`) needs its other-sport e2e re-run; `pad-host.tsx` waits per Global Constraints.

- [ ] **Step 1: The probe.** `the tile grid and the context strip do not move across a dot, a 4, a wide with runs, a no-ball and its free hit, a wicket and an over end`. For each width project (320, 360, 768, 1280), read `[data-role="v3-tiles"]` and `[data-role="v3-context"]` `boundingBox().y` and heights after picks (`pickCricketPeople`), then after each of the 6 kinds. Assert `|Δ| ≤ 0.5` px, and that 6 × widths samples were read (zero is a failure).
- [ ] **Step 2:** Run it locally on a local prod server (`seazn-env up --label s2-4 --server`; whole file). Expected: FAIL, naming the moving region and the ball kind. Record them.
- [ ] **Step 3:** Fix each named region with reserved space. No hidden content, and no `overflow-hidden` that clips (AGENTS 23).
- [ ] **Step 4:** Re-run the file: PASS. Re-run `mobile.spec.ts` whole (its cricket first-tile floor at :2313). Screenshots at 1280, 768 and 320.
- [ ] **Step 5:** Commit: `fix(cricket-pad): fixed-height regions, no jump after a ball`.

### Task 11: Ship to staging and check on the owner's fixture (ruling 72)

**Files:** none. The PR body records the results.

- [ ] **Step 1:** Push the branch and open a PR. The body has the rulings, the Task 1 epoch note, the engine release link, and `Matrix rows: none — rows ride the engine release`. CI is green (smoke runs on PRs). Then run `gh workflow run e2e.yml -f pr=<N>`: all jobs; a red counts as known only if main's latest run has the same test red.
- [ ] **Step 2:** Whole-branch review (Opus). Fix, then re-review.
- [ ] **Step 3:** Ask the owner for the merge. Only on their word: `gh pr merge <N> --merge`. `stg.yml` deploys staging. Never `prod.yml`.
- [ ] **Step 4: Staging check** on org `my-organization-31`, "Cricket S2-4 Test" (a fresh fixture the owner names), in a browser at 1280 and 360:
  1. A Draft division's toss says it hasn't started; once the division is started, the toss shows team names.
  2. The pad asks the openers and the bowler; reorder by picking H-3 to open.
  3. A wide with 2 runs run gives 3 wides; a no-ball off the bat 4, then the free hit shows; a bye and a leg-bye. No dock and no timer.
  4. A run out with 1 completed; a stumping offers the keeper only; a stumping off a wide.
  5. The over end asks the next bowler, with greyed reasons. A mid-over change; the next over greys both bowlers.
  6. A swap of ends; the next ball folds.
  7. The innings' last-ball wicket asks no next batter.
  8. The layout doesn't move.
  9. The console and the public match centre agree ball for ball, and the split over names both bowlers.
  10. A browser tab opened before the deploy is reloaded before scoring (an old bundle can't fold `cricket.bowler.change`). Record what it shows.
  Paste what was seen, per item, in the PR.

---

## Self-review (2026-11-07)

- **Spec coverage:**
  - §7.2: gap 1 → Tasks 2, 3; 2 → Task 3; 3, 4 → Task 4; 5, 6, 7 → Task 5; 8 → Task 10.
  - §7.3: exports → Tasks 1, 6; mid-over change → Tasks 8, 9; strike swap → Task 7; the web takes the release → Task 1; `scoring.ts:804` → Task 1 Step 1.
  - Ruling 72 → Task 11. Rulings 75, 76 → Tasks 8, 7.
  - §7.1 is a precondition, not built here.
- **Deviations (for the owner):**
  - The timer fix is cricket-only (§7.2 gap 4 says every sport).
  - `bowlerIsReadOnly` keeps its behaviour; the change has its own sheet.
  - A split over's ball lines name both bowlers joined.
  - "+ Out" is on the wide and no-ball sheets only.
  - The web keeps Retired and Timed out on a ball (the phone drops them, §4.3).
- **Names are consistent across tasks:** `wicketSteps`/`wicketPayload`/`wicketEndsInnings`/`keeperCandidates` (Task 5 → 6), `bowlerChangeOpen` (Task 8), `pickCricketPeople` (Task 3 → 10).
