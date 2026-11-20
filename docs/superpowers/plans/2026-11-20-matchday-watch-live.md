# Match Day Watch live link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a match on Match Day's list is streaming live to Seazn, its row shows a "Watch live" link. The link
opens the public match page in the phone's browser.

**Architecture:** The day parser (`src/domain/matchday/dayWire.ts`) reads the row's new `live_seazn` into
`Row.liveSeazn`, and anything unreadable becomes `null`. A pure hook-side function, `watchTarget` (beside
`browserTarget.ts`), keeps only a URL on the build's own Seazn host. `useWatchLive` opens that URL through the
existing `LinkPort`. `CourtRow` draws a compact `GhostButton` under the row, outside the row's own button, so there is
no nested control.

**Tech Stack:** Expo Router, React Native, TypeScript strict, vitest (domain, and jsdom with react-native-web),
`@testing-library/react`.

**Spec:** `docs/specs/2026-11-20-matchday-watch-live-design.md` (owner ruling 2026-11-20, option A).

**Depends on:** web plan `docs/superpowers/plans/2026-11-20-seazn-hosted-video.md` Task 17 (on web branch
`docs/seazn-hosted-video`), which adds `live_seazn` to `CaptureMatchdayRow` and regenerates
`docs/contracts/capture-matchday-day.v1.json`. Only Task 4 waits for that merge to web `main`. Tasks 1–3 test against
hand-written bodies in the pinned shape, and the parser already ignores fields the vendored contract does not name, so
shipping them first is safe.

**Repo:** `/Users/ashokhein/github/seazn.club.capture`. Work in a worktree, never the main checkout.

## Global Constraints

- Wire shape, pinned by the web plan: every row has `live_seazn: { watch_url: string } | null`. `watch_url` is
  `https://<host>/live/<org>/<comp>/<div>/fixtures/<uuid>`, with no query and no fragment.
- Phone shape: `Row.liveSeazn: { readonly watchUrl: string } | null`, required on `Row` (no optional field). This
  repo keeps no backfill for older builds (owner, 2026-11-16).
- One parser, and it never refuses the day for this field. Absent, `null`, a non-object, a missing or non-string
  `watch_url`, a URL that does not start `https://`, or one containing `?` or `#` all read as `null`.
- Host rule: open only when the URL's origin passes `isBuildOrigin(origin, hosts[0] ?? '')`
  (`src/services/seaznHosts.ts`). Any other host, or a build with no host, shows no link.
- No new port. Use `ports.link.openUrl` (`src/services/linkPort.ts`; wired at `src/hooks/nativePorts.ts:145`; fake
  `test/fakeLinkPort.ts`, `ports.link.opened`).
- Copy keys, the same in all four of `src/i18n/{en,es,fr,nl}.json`:
  - `matchday.watch.live`: en "Watch live", es "Ver en directo", fr "Regarder en direct", nl "Live kijken"
  - `matchday.watch.liveNamed`: en "Watch {match} live", es "Ver {match} en directo", fr "Regarder {match} en
    direct", nl "{match} live kijken"
  - `matchday.watch.cantOpen`: en "Couldn't open the match page", es "No se pudo abrir la página del partido", fr
    "Impossible d'ouvrir la page du match", nl "Kan de wedstrijdpagina niet openen"
- Tests (owner's rule for this change): main paths only, fake ports, no timers, no rare corner cases. No snapshot
  tests. Expected copy comes from the dictionaries, never from the code under test.
- Local checks per the repo's rule: a scoped `tsc` and the touched test files. CI runs lint, Prettier and the full
  suite.

## Review Focus

1. **A garbled `live_seazn` must not blank the list.** The polled day must still read. Task 1 pins this with a
   number, `"http://…"` and a `?t=` URL.
2. **A foreign or look-alike host must show no link** (`https://stg.seazn.club.evil.example/...`). Task 2's
   `watchTarget` test covers this. The screen test covers a foreign host.
3. **The link must not sit inside the row's Pressable.** On native, a nested press target swallows one of the two
   presses. Task 3 asserts that the row's open and the link's open are separate presses with separate outcomes.
4. **A double tap on Watch live** opens the browser twice at most and corrupts no state. `openUrl` holds no state, so
   no guard is added (four questions, item 1: answered by "no state", not by a test).
5. **The stored day copy** (`readStoredDay`) must keep `liveSeazn` through a round trip. Otherwise an offline list
   would drop or garble it. Task 1 maps the two names in `WIRE_NAME`.

---

### Task 1: Parse `live_seazn` into `Row.liveSeazn`

**Files:**

- Modify: `src/domain/matchday/matchDay.ts:15-40` (the `Row` type: add the field)
- Modify: `src/domain/matchday/dayWire.ts` (`matchRow` at about line 79, and `WIRE_NAME` at about line 179)
- Modify: every `Row` literal that `tsc` flags (in `src/services/fakeMatchDayPort.ts` `FAKE_DAY`, and the test files
  that build rows). Add `liveSeazn: null`.
- Test: `src/domain/matchday/dayWire.test.ts`, `src/domain/matchday/dayWire.stored.test.ts`

**Interfaces — Produces:**

- `export type LiveSeazn = { readonly watchUrl: string };` in `matchDay.ts`
- `Row.liveSeazn: LiveSeazn | null`
- A private `liveSeazn: Reader<LiveSeazn | null>` in `dayWire.ts`. It reads `source.live_seazn` and never returns a
  failed `Read`.

- [ ] **Step 1: Write the failing tests** in `dayWire.test.ts`, in a new `describe('parseDay reads live_seazn')`.
      Build each body from `fixtureOf(DAY, 'valid-competition')` with the first court's `now` row given the field:
  - `it('reads a watch_url on the build’s form into liveSeazn')`. Use
    `live_seazn: { watch_url: 'https://stg.seazn.club/live/club/open/singles/fixtures/<that row’s fixture_id>' }`
    and expect `row.liveSeazn` to equal `{ watchUrl: <the same string> }`.
  - `it('reads null, and a missing field, as no link')`. Expect `liveSeazn` to be `null` both times.
  - `it('reads a garbled live_seazn as no link and still reads the day')`. Use three bodies: `live_seazn: 7`,
    `{ watch_url: 'http://stg.seazn.club/live/a/b/c/fixtures/x' }` and
    `{ watch_url: 'https://stg.seazn.club/live/a/b/c/fixtures/x?t=secret' }`. Each one gives `read.ok === true` and
    `liveSeazn === null`.

  In `dayWire.stored.test.ts`, add `it('keeps liveSeazn through the stored copy')`: `readStoredDay(parseDay(body).value)`
  returns the same `liveSeazn`.

- [ ] **Step 2: Run them and see them fail.**
      Run: `pnpm vitest run src/domain/matchday/dayWire.test.ts src/domain/matchday/dayWire.stored.test.ts`
      Expected: FAIL (`liveSeazn` is undefined).
- [ ] **Step 3: Implement.** Add `LiveSeazn` and the field. Write the `liveSeazn` reader with the rule from Global
      Constraints: a string starting `https://` and containing neither `?` nor `#`, otherwise `ok(null)`. Add it to
      `matchRow` as `liveSeazn: liveSeazn(source, 'live_seazn', at)`. Add `['liveSeazn', 'live_seazn']` and
      `['watchUrl', 'watch_url']` to `WIRE_NAME`. Add `liveSeazn: null` to every `Row` literal that `tsc` flags. The
      call contract's candidates reuse `matchRow` (`callWire.ts`), so they pick the field up with no extra code.
- [ ] **Step 4: Run them again,** together with a scoped typecheck.
      Run: `pnpm vitest run src/domain/matchday` and `pnpm tsc --noEmit`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(matchday): read live_seazn into the day's rows`.

### Task 2: `watchTarget` and `useWatchLive`

**Files:**

- Create: `src/hooks/watchTarget.ts`
- Create: `src/hooks/watchTarget.test.ts`
- Create: `src/hooks/useWatchLive.ts`
- Modify: `src/services/linkPort.ts` (doc comment: the port also opens Match Day's Watch live page, which holds no
  token)

**Interfaces — Consumes:** `Row.liveSeazn` (Task 1); `isBuildOrigin` (`src/services/seaznHosts.ts`);
`usePorts().link` and `usePorts().hosts`.

**Interfaces — Produces:**

- `export function watchTarget(host: string, row: Row): string | null`. It returns `row.liveSeazn.watchUrl` when
  `isBuildOrigin(<the URL up to the first '/' after "https://">, host)`, and `null` otherwise. It is pure, like
  `browserTarget`.
- `export function useWatchLive(say: (key: MessageKey | null) => void): { readonly canWatch: (row: Row) => boolean; readonly watch: (row: Row) => void }`.
  Both functions are stable (`useCallback` over `hosts[0]` and `link`). `watch` calls `link.openUrl(url)`. On reject
  it calls `say('matchday.watch.cantOpen')`. A row with no target does nothing.

- [ ] **Step 1: Write the failing tests** in `watchTarget.test.ts`:
  - `it('gives the watch_url on the build’s host')`: host `stg.seazn.club`, URL
    `https://stg.seazn.club/live/a/b/c/fixtures/<uuid>`. Expect that URL back.
  - `it('gives none for another host, a look-alike host, or a build with no host')`: `https://seazn.club/...` with
    host `stg.seazn.club`, `https://stg.seazn.club.evil.example/...`, and host `''`. All give `null`.
  - `it('gives none for a row that is not live on Seazn')`: `liveSeazn: null` gives `null`.
- [ ] **Step 2: Run and see them fail.** Run: `pnpm vitest run src/hooks/watchTarget.test.ts`. Expected: FAIL
      (module not found).
- [ ] **Step 3: Implement** `watchTarget.ts` and `useWatchLive.ts` with the signatures above. The copy key
      `matchday.watch.cantOpen` lands in Task 3. Add it in this task if `MessageKey` will not compile without it.
- [ ] **Step 4: Run again.** Expected: PASS. Then run `pnpm tsc --noEmit`, expecting 0 errors.
- [ ] **Step 5: Commit** `feat(matchday): watch target on the build's host`.

### Task 3: The Watch live link on the row

**Files:**

- Create: `src/ui/components/WatchLiveLink.tsx`. A `memo` component taking
  `{ row: Row; match: string; onWatch: (row: Row) => void }`. It renders
  `<GhostButton compact label={t('matchday.watch.live')} accessibilityLabel={t('matchday.watch.liveNamed', { match })} onPress={press} testID="watch-live" />`,
  where `press` is a `useCallback`. If `GhostButton` has no `testID` prop (it has none today), wrap it in a `View testID="watch-live"`.
- Modify: `src/ui/components/CourtCard.tsx`. `CourtCardProps` gains `canWatch?: (row: Row) => boolean` and
  `onWatch?: (row: Row) => void`, threaded through `QueueRows` and `FinishedRows` to `CourtRow`. `CourtRow` renders
  `<WatchLiveLink>` after `<MatchRow>`, inside its `View testID="court-row"` and outside `MatchRow`'s `Pressable`,
  when both props are given and `canWatch(row)` is true. `match` is the row's names, as `words(row).names` already
  gives them.
- Modify: `src/ui/screens/MatchDayScreen.tsx`. Call `useWatchLive(say)` beside `useOpenFromMatchDay({ say, … })`
  (about line 61) and pass `canWatch` and `onWatch` to `<CourtCard>` (about line 585).
- Modify: `src/ui/screens/CourtDayScreen.tsx` (its `CourtRow` at about line 117 and its `FinishedRows`). Pass the same
  two props, which it receives as props from `MatchDayScreen`, where it is rendered (about line 142).
- Modify: `src/i18n/{en,es,fr,nl}.json`. Add the three keys from Global Constraints, next to `matchday.cantOpen`.
- Modify: `AGENTS.md` §1, the Match Day paragraph. After "Match Day never finalizes a match, edits, or streams.", add:
  "A match live on Seazn shows Watch live, which opens its public page in the browser through the link port; Match
  Day has no player (owner, 2026-11-20, option A; `docs/specs/2026-11-20-matchday-watch-live-design.md`)."
- Create: `src/ui/screens/MatchDayScreen.watch.test.tsx`
- Modify: `src/ui/theme/matchDayFit.test.ts`

- [ ] **Step 1: Write the failing tests** in `MatchDayScreen.watch.test.tsx`. Set it up the way
      `MatchDayScreen.test.tsx` does (`renderWithPorts`, `FAKE_DAY` from `@/services/fakeMatchDayPort`, `SAVED_DAY`).
      Give the first court's `now` row a `liveSeazn`. The fake ports' host is `stg.seazn.club`
      (`test/fakePorts.ts:208`).
  - `it('shows Watch live under a match live on Seazn, named for a screen reader')`. With
    `watchUrl: 'https://stg.seazn.club/live/a/b/c/fixtures/<id>'`, expect exactly one `watch-live`, whose label is
    `en['matchday.watch.liveNamed']` with `{match}` filled.
  - `it('shows no Watch live when no match is live on Seazn')`. With `FAKE_DAY` as it is (every `liveSeazn: null`),
    expect `queryAllByTestId('watch-live')` to have length 0.
  - `it('shows no Watch live for a link on another host')`. With
    `watchUrl: 'https://seazn.club/live/a/b/c/fixtures/<id>'` (production host, staging build), expect length 0.
  - `it('a tap opens the match page through the link port, and does not open the match')`. Press `watch-live`.
    Expect `ports.link.opened` to equal `[watchUrl]` and the Match Day port's open calls to be empty.
  - `it('says the line when the phone cannot open it')`. Call `ports.link.refuse()`, press, and expect
    `en['matchday.watch.cantOpen']` to be on screen.

  In `matchDayFit.test.ts`, add `it('Watch live is one line in its compact ghost at 320, in every language')`. Measure
  `matchday.watch.live` in each language with the `GhostButton` compact label's face, in the way the file measures
  `matchday.call.short`, and pin that every language fits on one line.

- [ ] **Step 2: Run and see them fail.**
      Run: `pnpm vitest run src/ui/screens/MatchDayScreen.watch.test.tsx src/ui/theme/matchDayFit.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement** the files above. Use `StyleSheet.create` and tokens only. Put no anonymous function in
      render.
- [ ] **Step 4: Run again,** with the screen's existing suites so nothing else moved.
      Run: `pnpm vitest run src/ui/screens/MatchDayScreen src/ui/screens/CourtDay src/ui/theme/matchDayFit.test.ts src/i18n`
      and `pnpm tsc --noEmit`. Expected: PASS, 0 errors. Run `pnpm prettier --check AGENTS.md`.
- [ ] **Step 5: Commit** `feat(matchday): Watch live opens a Seazn live match's page`.
- [ ] **Step 6: Device check (as the customer).** Build a local arm64 build and use the staging web with a Seazn live
      match on a court. Tap Watch live and expect the browser to open on the public match page. Tap the row itself
      and expect the pad to open. Check 320 and 360 dp upright, en and nl. This needs a live Seazn match on staging,
      so list it for the owner if none can be started. Crop status bars.

### Task 4: Re-vendor the day contract (after web Task 17 merges)

**Files:**

- Modify: `contracts/` (via `pnpm contracts:vendor <web checkout on main>`), `contracts/VENDORED.json`
- Modify: `test/contractPins.test.ts` (copy the web's new sha256 pins for `capture-matchday-day.v1.json` and
  `capture-matchday-call.v1.json`, and the web commit, by hand, per `scripts/vendor-contracts.mjs`'s header)
- Test: `src/domain/matchday/dayWire.test.ts`

- [ ] **Step 1: Vendor.** Run `pnpm contracts:vendor /path/to/seazn.club` on web `main` at or after the Task 17 merge.
      Confirm the diff adds `live_seazn` to the row and the fixtures `valid-live-seazn.json` and
      `invalid-live-seazn-query.json`.
- [ ] **Step 2: Run** `pnpm vitest run test/contractPins.test.ts src/domain/matchday`. Expected: the pins FAIL, and
      `accounts for every answer fixture` (`dayWire.test.ts:71`) fails on the two new fixtures.
- [ ] **Step 3: Pin and account.** Move the pins by hand. In `dayWire.test.ts` add `valid-live-seazn` to the
      fixtures read as valid. Add `it('reads valid-live-seazn: the playing row’s watch_url, every other row null')`.
      Classify `invalid-live-seazn-query` as a body the phone reads with `liveSeazn: null` (the contract refuses it,
      but by design the phone's parser drops the field rather than the day).
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `chore(contracts): pin to web main <sha> (Match Day live_seazn)`.
