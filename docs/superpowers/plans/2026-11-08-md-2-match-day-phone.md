# MD-2 Match Day — phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app's third mode, Match Day. The operator scans a day code once. The tile reopens the day, which
is listed by court. A tap opens a match in Remote Scoring as it stands, and Back returns to the day. The operator
approves Swiss rounds and knockout draws with a 3 s hold, and Exit never loses a tap.

**Architecture:**
- **Data:** a pure `src/domain/matchday/` holds the wire parsers, the list model and the rules. A `MatchDayPort`
  behind `Ports` uses plain `fetch` with a fake. The code is saved as `code.matchday` in the mode store, and the
  last good day in the key-value store.
- **Opening a match:** it reuses S2's open path (`keepScoringLink`, `saveScoringLink`, the hub) without making
  Remote Scoring the active mode. The scoring route learns where its fixture comes from and where Back goes. The
  hub learns which fixtures Match Day holds, so it does not sweep their links.

**Tech Stack:** Expo Router, React Native, TypeScript strict, vitest (domain and jsdom projects).

**Spec:** `docs/specs/2026-11-07-s4-match-day-design.md`. Read the whole of it.

**Depends on:** MD-1 merged to staging. Its contracts are `capture-matchday-day.v1`, `capture-matchday-open.v1` and
`capture-matchday-approval.v1`, vendored in Task 2.

**Repo:** worktree `/Users/ashokhein/github/seazn.club.capture-worktrees/match-day`, branch `feat/s4-match-day`
from `docs/match-day-design`. The recon was taken at `bfc52fd`. Re-verify every line number before editing.

## Global Constraints

- **Verification:** the controller's directive, relayed 2026-11-08.
  - Locally: the scoped type-check: a temporary `tsconfig.changed.json` that extends `./tsconfig.json` with
    `{"compilerOptions":{"noEmit":true,"incremental":false},"include":[],"files":[<changed .ts/.tsx>]}`, then
    `npx tsc -p tsconfig.changed.json` and `rm tsconfig.changed.json`. Never bare `tsc a.ts` (it ignores tsconfig),
    never the whole project, and never commit that file,
    plus **only the test files this task changed or added**, by path
    (`pnpm vitest run <paths>`).
  - Never run the full suite or `pnpm check`. Lint, Prettier and the full suite run on CI: push the branch, or open
    a draft PR, and read the CI counts.
  - Where a step below says "push and read CI", also run that task's own test files locally first.
- **AGENTS.md applies in full**, notably:
  - §3: `domain/` stays pure, no barrels, and screens reach native code only through `Ports`;
  - §4: `type` in the domain and `interface` only for ports; one parser per wire shape;
  - §5: tokens only, never a colour literal; red never means an error;
  - §10: no snapshot tests; the four questions; no expectation derived from the code under test.
- **The token is a credential:**
  - it lives in the secure store under `code.matchday` (the mode store);
  - it is never in a record line, a log line, an error or a query string;
  - call `logger.protectLink(token)` before every request (pattern: `fetchScoringPort.ts:140`).
- **`Mode`** becomes `'stream' | 'scoring' | 'matchday'`. The word `dashboard` leaves the code, dictionaries and
  tests.
- **Copy:** in en/es/fr/nl. The quoted strings below are the English copy:
  - `matchday.ended` "Match Day ended"
  - `matchday.withdrawn` "Match Day code withdrawn"
  - `matchday.opens` "Match Day opens {date}"
  - `matchday.offline` "Offline · updated {time}"
  - `matchday.noCourt` "Not on a court yet"
  - `matchday.online` "Online"
  - `matchday.sending` "Sending {count}"
  - `matchday.exit.title` "Exit Match Day?"
  - `matchday.exit.body` "You'll need to scan again."
  - `matchday.exit.bodySending` "{count} taps still sending — they'll keep sending."
  - `matchday.exit.confirm` "Exit"
  - `matchday.exit.stay` "Stay"
  - `matchday.approve.hold` "Hold 3 s to approve"
  - `matchday.approve.webOnly` "{label} · pair on the web desk"
  - `matchday.approve.ties` "Ties need a decision on the web desk"
  - `matchday.approve.already` "Already approved"
  - `matchday.approve.stale` "Draw changed — review again"
  - `matchday.approve.editOnWeb` "To change a slot, use the web desk"
  - `matchday.outOfScope` "This match isn't on your courts"
  - `matchday.continue` "Match Day · {competition} · {scope}"
  - `matchday.sendingCard` "Sending {count} taps · {court}"
- **Timing:** `MATCHDAY_POLL_MS = 15_000` (spec §5). The hold is the shared `HOLD_MS = 3000` (`useHold.ts:6`).

## Review Focus

1. **A match opened from Match Day empties its queue while the operator is on the list.** Its link must NOT be
   swept: the hub sweeps any link that is not the saved scoring match (`scoringHub.ts:143`), and spec §5 needs it
   for offline reopening. The test is in Task 5.
2. **A cold start while a Match Day match was open.** It must reopen into that match, with Back going to the list,
   not into Remote Scoring with Back going to Home: `reopensScoring` keys on `active==='scoring'`
   (`reopen.ts:99`). The test is in Task 4.
3. **Exit with taps queued for a match, then the hub's next sweep.** The taps must keep sending, and the link goes
   only once the queue is empty. The test is in Task 7.
4. **Scanning a single match's scoring code while Match Day is saved.** Remote Scoring opens that match, and the
   Match Day code stays saved, so the tile still opens it. The test is in Task 3.
5. **A poll answer that arrives after Exit.** It must not resurrect the list or rewrite the cache. The test is in
   Task 4.

---

### Task 1: Rename the third mode and recognise the day link

**Files:**
- Modify (from the recon):
  - `src/domain/mode/Mode.ts:7,17-19,25-30`, `savedCode.ts:56`, `scanOutcome.ts:6,8`, `otherMode.ts:5`, `reopen.ts:166`
  - `src/services/modeStore.ts:11`
  - `src/ui/modeCopy.ts:5,10,13,17`, `src/i18n/modeNames.ts:7`, `src/ui/components/ModeIcon.tsx:27,51`, `HomeScreen.tsx:235`
  - `src/i18n/{en,es,fr,nl}.json`: `mode.dashboard` becomes `mode.matchday` "Match Day"; `home.tile.dashboard.purpose` becomes `home.tile.matchday.purpose`
  - the tests listed by the recon: `Tile.test.tsx`, `homeFit.test.ts`, `HomeScreen*.test.tsx`, `otherMode.test.ts`, `scanOutcome.test.ts`
- Modify: `src/domain/mode/recognise.ts:19,39-40`
- Test: `src/domain/mode/recognise.test.ts`, `scanOutcome.test.ts`

**Interfaces:**
- Produces:
  - `ModeCode` gains `{mode: 'matchday'; raw: string; token: string}`.
  - `BUILT_MODES` gains `'matchday'`.
  - `DAY_PATH = /^\/day\/(md_[A-Za-z0-9_-]{43})\/?$/`.

- [ ] **Step 1: Write the failing tests.**
  - `recognises https://<build host>/day/md_… as a matchday code`
  - `a /day/ link on a foreign host is foreign`
  - `/day/ with no md_ token is seaznPage`
  - `a matchday code scanned from the matchday tile opens`
  - `a scoring code scanned from the matchday tile offers to switch` (decision record ruling 2)
  - in `homeFit.test.ts`, the three tiles in order `stream, scoring, matchday`, with the label "Match Day" in all
    four languages
- [ ] **Step 2: Run the scoped type-check.** Expected: it fails on the missing union member.
- [ ] **Step 3: Implement** the rename and the recogniser branch.
- [ ] **Step 4: Run the scoped type-check**, then push and read CI. Expected: tsc clean, and CI green on the touched suites.
- [ ] **Step 5: Commit** `feat(matchday): rename Dashboard to Match Day and recognise day links`.

### Task 2: Vendor the contracts; the domain parsers and model

**Files:**
- Run: `pnpm contracts:vendor <seazn.club checkout at MD-1's merge>`. Then update `test/contractPins.test.ts:21-22,45`
  (`WEB_COMMIT`, `WEB_PINS`, the count).
- Create: `src/domain/matchday/dayWire.ts`, `openWire.ts`, `approvalWire.ts` (one parser each)
- Create: `src/domain/matchday/matchDay.ts` (the types and the list model)
- Test: `dayWire.test.ts`, `openWire.test.ts`, `approvalWire.test.ts` (each runs its contract's fixtures),
  `matchDay.test.ts`

**Interfaces:**
- Produces:
  - `parseDay(raw: unknown): Result<MatchDay>`. `MatchDay` mirrors `MatchDayCodeView` (MD-1 Task 3) in camelCase,
    with readonly fields and `Date`s.
  - `parseOpen(raw: unknown): Result<OpenAnswer>`, where
    `OpenAnswer = {kind:'link'; url: string; sportKey: string} | {kind:'finished'} | {kind:'refused'; code:'MD_OUT_OF_SCOPE'}`.
  - `parseApproval(raw: unknown): Result<ApprovalReview>`
  - `type MatchDayRefusal = 'MD_UNKNOWN'|'MD_WITHDRAWN'|'MD_ENDED'|'MD_NOT_OPEN'|'MD_OUT_OF_SCOPE'|'MD_NO_APPROVE'|'MD_STALE'|'MD_ALREADY'|'MD_TIES'`
  - `parseRefusal(status: number, raw: unknown): MatchDayRefusal | null`
  - `courtCards(day: MatchDay): CourtCard[]`, where
    `CourtCard = {courtId; name; state; now: Row|null; next: Row|null; then: Row|null; finished: Row[]}`.
    Only the first two of `next` are shown.
  - `bannerFor(day: MatchDay): Banner | null`, where
    `Banner = {approval: Approval; canApprove: boolean}`, taking the first approval. With `canApprove` false, the
    banner shows `matchday.approve.webOnly`.

- [ ] **Step 1: Write the failing tests.**
  - Each parser accepts every vendored fixture, refuses a missing field, and ignores an unknown field.
  - `courtCards keeps the server's court order`
  - `next and then come from the queue's first two`
  - `a court with no now and no next is Free`
  - `bannerFor is null without approvals`
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.** No `react` and no `services`: domain purity is lint-enforced.
- [ ] **Step 4: Run the scoped type-check**, then push and read CI.
- [ ] **Step 5: Commit** `feat(matchday): vendor the Match Day contracts and parse them`.

### Task 3: The port, the store and the tile

**Files:**
- Create: `src/services/matchDayPort.ts` (`interface MatchDayPort`), `fetchMatchDayPort.ts`, `fakeMatchDayPort.ts`,
  `src/services/matchDayStore.ts`
- Modify: `src/hooks/usePorts.tsx:44` (add `matchDay`), `src/hooks/nativePorts.ts:53` (wire it with
  `hosts=seaznHosts(env)`), `test/fakePorts.ts:60,129`, `test/fakePorts.test.ts`
- Modify: `src/hooks/useHome.ts:385` (`useTapTile`): on `matchday`, a saved, unexpired code opens the day with no
  scan.
- Modify: `src/domain/mode/continueCard.ts` and `HomeScreen.tsx:186-213`: the Match Day Continue card
  (`matchday.continue`).
- Test: `src/services/fetchMatchDayPort.test.ts`, `src/hooks/matchDayPortWiring.test.ts`,
  `src/ui/screens/HomeScreen.matchday.test.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `interface MatchDayPort { day(code: SavedDayCode): Promise<PortAnswer<MatchDay>>; open(code: SavedDayCode, fixtureId: string): Promise<PortAnswer<OpenAnswer>>; review(code: SavedDayCode, kind: 'swiss'|'draw', stageId: string): Promise<PortAnswer<ApprovalReview>>; approve(code: SavedDayCode, kind: 'swiss'|'draw', stageId: string, hash: string): Promise<PortAnswer<{ok:true}>> }`
  - `PortAnswer<T> = {ok:true; value:T} | {ok:false; refusal: MatchDayRefusal; opensAt?: Date} | {ok:false; offline:true}`
  - The paths are `GET /api/v1/match-day-code`, `POST /api/v1/match-day-code/fixtures/{id}/scoring-link` and
    `GET|POST /api/v1/match-day-code/approvals/{kind}/{stageId}`.
  - The request carries `Authorization: Bearer <token>`, with a timeout of 8 s, on a build origin only
    (`isBuildOrigin`).
  - `SavedDayCode = {origin: string; token: string}`, read from `code.matchday`.
  - `matchDayStore`:
    - `readCache(): Promise<{day: MatchDay; at: Date} | null>`, `writeCache(day, at)`
    - `opened(): Promise<string[]>`, `addOpened(id)`, `removeOpened(id)`, `clear()`
    - keys: `matchday.cache`, `matchday.opened`

- [ ] **Step 1: Write the failing tests.**
  - `the request has the bearer and no token in the URL or the log`: the fake logger receives no `md_`.
  - `401/410/403 map to MD_UNKNOWN/MD_WITHDRAWN/MD_ENDED/MD_NOT_OPEN`
  - `a network failure is offline`
  - `the matchday tile with a saved code opens the day without calling the scanner`
  - `the tile with an ended code shows the scanner with "Match Day ended" and forgets the code`; the same for
    withdrawn
  - `the tile before opens_at shows "Match Day opens Sat 8 Nov" and keeps the code`
  - `the Home Continue card reads "Match Day · SAFE Open · Hall A"`
  - `a scoring code scanned while Match Day is saved opens Remote Scoring and leaves code.matchday in place`
    (Review Focus 4)
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the scoped type-check**, then push and read CI.
- [ ] **Step 5: Commit** `feat(matchday): Match Day port, store, tile and Continue card`.

### Task 4: The list screen

**Files:**
- Create: `app/matchday/index.tsx` (thin), `src/ui/screens/MatchDayScreen.tsx`, `src/ui/components/CourtCard.tsx`,
  `src/ui/components/ApprovalBanner.tsx`, `src/hooks/useMatchDay.ts`
- Modify: `src/services/devicePorts.ts:43` (Route gains `'matchday' | 'matchdayApproval'`),
  `src/services/native/expoRouterNavigation.ts:3,13-17`, `src/domain/mode/reopen.ts:19,45,99` (`ReopenTarget` gains
  `{go:'matchday'}`)
- Test: `src/hooks/useMatchDay.test.ts`, `src/ui/screens/MatchDayScreen.test.tsx`, `src/domain/mode/reopen.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `useMatchDay(): {state: 'loading'|'ready'|'offline'|'refused'; day: MatchDay|null; updatedAt: Date|null; refusal: MatchDayRefusal|null; refresh(): void}`.
  - It polls every `MATCHDAY_POLL_MS` while focused and in the foreground.
  - It writes the cache on each good answer.
  - It drops any answer that arrives after Exit or unmount (Review Focus 5).
- Layout follows spec §5:
  - the header: the competition, the scope and the day;
  - the banner;
  - court cards with Now / Next / Then and dimmed Finished;
  - then `matchday.noCourt`, then `matchday.online` (read-only rows with no `onPress`);
  - "Sending N" on a card whose court has unsent taps, counted with `atStake(ports, fixtureId)` (`useScoringHome.ts:191`) for each fixture in `matchDayStore.opened()`;
  - ⋯ in the top bar holds Exit (Task 7).
  - It is portrait and memoised, with no anonymous functions in render.

- [ ] **Step 1: Write the failing tests.**
  - Each state through the fake, asserting what the operator sees:
    - `ready` shows `Court 1`, `Ng v Brown`, `14-9` and `Patel v Okafor`;
    - `offline` shows "Offline · updated 10:42" over the cached list;
    - `refused MD_WITHDRAWN` returns Home with "Match Day code withdrawn".
  - `polls at 15 s, not before`, with fake timers
  - `an answer after unmount is dropped`
  - `online rows are not pressable`
  - `the venue chips show only on a competition code with two venues`
  - `cold start with active matchday reopens into matchday` (Review Focus 2, first half)
  - in all four languages: the header and a court card render without overflow at 320 dp (the `homeFit` pattern)
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the scoped type-check**, then push and read CI.
- [ ] **Step 5: Commit** `feat(matchday): the day's list by court`.

### Task 5: Open a match and come back

**Files:**
- Create: `src/hooks/useOpenFromMatchDay.ts`, `src/domain/mode/scoringOrigin.ts`
- Modify:
  - `src/hooks/useScoringFixture.ts:17`: with `active==='matchday'`, the fixture is Match Day's open fixture
    (`matchday.open` in the key-value store), not `codes.scoring`.
  - `src/hooks/useStreamLinks.ts:48` (`useBackToHome`): its target comes from `scoringOrigin`. From Match Day, Back
    goes to `matchday`, its label is `‹ {court}`, and the list scrolls to that court. Every caller the recon lists
    keeps working unchanged.
  - `src/hooks/scoringOpen.ts:50,97`: `keepScoringLink` is reused. `letGoOfScoring` must not run for a Match Day
    open.
  - `src/hooks/scoringHub.ts:143` (`unwanted`): spare every fixture in `matchDayStore.opened()`.
  - `src/domain/mode/reopen.ts`: if `matchday.open` is set at a cold start, reopen into `scoring` with the Match Day
    origin.
- Test: `src/hooks/useOpenFromMatchDay.test.ts`, `src/hooks/scoringHub.matchday.test.ts`,
  `src/domain/mode/scoringOrigin.test.ts`, `src/domain/mode/reopen.test.ts`

**Interfaces:**
- Consumes: `MatchDayPort.open`, `keepScoringLink(ports, token, scan)`, `saveScoringLink(kv, fixtureId, link, host, sportKey)`, `ScoringHub`.
- Produces:
  - `scoringOrigin(active: Mode, open: {fixtureId; courtName} | null): {back: 'home'} | {back: 'matchday'; label: string}`
  - `useOpenFromMatchDay(): (row: Row, courtName: string) => Promise<void>`. It calls `open`, then:
    - for a `link`: it saves the link, `addOpened`, sets `matchday.open`, then `go('scoring')`. The active mode
      stays `matchday`.
    - for `finished`: it opens view-only through the same path.
    - for `refused`: it shows the one line `matchday.outOfScope` on the list.
    - for `offline`: it uses an already stored link, if there is one.
    - A second tap while one open is in flight is ignored.

- [ ] **Step 1: Write the failing tests.**
  - `tapping Now opens the pad with Back labelled "‹ Court 1"`
  - `Back returns to the list scrolled to Court 1`
  - `tapping Next opens the Start screen`
  - `the active mode is still matchday after opening` (`modeStore.active()`)
  - `a match whose queue empties is not swept while Match Day holds it` (Review Focus 1)
  - `cold start with matchday.open reopens the pad with Back to Match Day` (Review Focus 2)
  - `a double tap opens once`
  - `offline with a stored link opens it; offline without one shows "Offline"`
  - `MD_OUT_OF_SCOPE shows "This match isn't on your courts" and does not navigate`
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.** Nothing in `src/domain/scoring/` may import from `matchday`.
- [ ] **Step 4: Run the scoped type-check**, then push and read CI. Lint's `SPORT_MODULES` and boundaries must pass.
- [ ] **Step 5: Commit** `feat(matchday): open a match in Remote Scoring and come back to the day`.

### Task 6: Approvals

**Files:**
- Create: `app/matchday/approval.tsx`, `src/ui/screens/ApprovalScreen.tsx`, `src/hooks/useApproval.ts`
- Test: `src/hooks/useApproval.test.ts`, `src/ui/screens/ApprovalScreen.test.tsx`

**Interfaces:**
- Consumes: `MatchDayPort.review/approve`, `HoldAction{label, tone:'go', disabled, reason, onHeld}`.
- Produces: `useApproval(kind, stageId): {review: ApprovalReview|null; state: 'loading'|'ready'|'approving'|'done'|'refused'; refusal; approve(): void}`.
  - When `approve` succeeds, it refreshes the list (`useMatchDay().refresh`) and goes back.

- [ ] **Step 1: Write the failing tests.**
  - `the review lists the rows and "To change a slot, use the web desk"`
  - `a hold of 3 s approves once; a release at 2.9 s does not` (fake timers)
  - `ties: no hold, "Ties need a decision on the web desk"`
  - `MD_ALREADY shows "Already approved" and refreshes`
  - `MD_STALE shows "Draw changed — review again" and reloads the review`
  - `a code without can_approve: the banner has no button and reads "{label} · pair on the web desk"`
  - `a second hold while approving does nothing`
  - `the record gets matchday.approve {kind, outcome}` with no token
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the scoped type-check**, then push and read CI.
- [ ] **Step 5: Commit** `feat(matchday): review and approve a draw with a 3 s hold`.

### Task 7: Exit, the Sending card, record lines and the docs

**Files:**
- Create: `src/hooks/useMatchDayExit.ts`, `src/ui/components/ExitMatchDaySheet.tsx`, `src/domain/matchday/exit.ts`
- Modify:
  - `HomeScreen.tsx`: the `matchday.sendingCard`.
  - `src/hooks/scoringHub.ts`: on Exit, `matchDayStore.clear()` leaves a fixture with unsent taps sweepable only
    once its queue is empty, by the existing `tidy` rule.
  - `AGENTS.md` §1, §3 (the `app/matchday/` and `domain/matchday/` lines); and
    `docs/specs/2026-09-29-multi-mode-app-decisions.md`: the Dashboard row reads Match Day, and S4 points to the spec.
- Test: `src/domain/matchday/exit.test.ts`, `src/hooks/useMatchDayExit.test.ts`,
  `src/ui/screens/HomeScreen.matchday.test.tsx`

**Interfaces:**
- Consumes: `atStake(ports, fixtureId)` (`useScoringHome.ts:191`) for the unsent counts, and `matchDayStore`.
- Produces:
  - `exitCopy(unsent: number): {body: 'matchday.exit.body'} | {body: 'matchday.exit.bodySending'; count: number}`
  - `useMatchDayExit(): {unsent: number; exit(): Promise<void>}`. In order, it:
    1. nudges the hub to send now;
    2. forgets `code.matchday`, the cache and `matchday.open`;
    3. clears `opened`;
    4. goes Home.

- [ ] **Step 1: Write the failing tests.**
  - `exitCopy(0)` is the plain body, and `exitCopy(3)` is "3 taps still sending — they'll keep sending."
  - `Exit with 3 unsent: the taps are still sent after Exit` (Review Focus 3): the fake port receives them after the
    navigation to Home.
  - `the link goes once its queue is empty, not before`
  - `Home shows "Sending 3 taps · Court 2" until they land, then not`
  - `Stay changes nothing`
  - `after Exit the tile scans again`
  - `the record gets matchday.exit {unsent} and matchday.open {sport}` with no token or fixture link
- [ ] **Step 2: Run the scoped type-check.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the scoped type-check**, then push and read CI. Run `pnpm prettier --check` on the two docs on CI, or with the
  owner's leave.
- [ ] **Step 5: Commit** `feat(matchday): exit without losing a tap; AGENTS.md and the decision record`.

### Task 8: Exit bar on the owner's phone (staging)

Build a local release twin (AGENTS.md §11), install it with `adb`, and run spec §10, items 1–9. Items 1, 2, 4 and 6
need the owner's hands: list them for the owner, never simulate them. Write the results to
`docs/specs/2026-11-xx-s4-match-day-results.md`, with screenshots cropped to the app only.
