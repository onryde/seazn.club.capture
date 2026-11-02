# S2-1 Remote Scoring (badminton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A volunteer scans a badminton match's scoring link with Seazn Capture and scores it to the
organiser's final through a dead signal, a killed app and a browser co-scorer, on staging.

**Architecture:** The signed-off kit on `feat/s2-pad-ui` stays the screen. A pure domain folds the
server's ledger plus this phone's queue through `@seazn/engine` into the same `BadmintonDisplay` the
kit already draws; a sync reducer decides what to send and what each answer means; ports carry the
HTTP calls, the durable queue file and the Realtime ping. One web endpoint, new, tells the phone what a
link is.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / Hermes; `@onryde/seazn-engine` 1.1.0 under the
alias `@seazn/engine`; `zod` (the engine's peer); `expo-file-system`; `@supabase/realtime-js`; vitest on
react-native-web; seazn.club (Next.js) for the endpoint.

**Spec:** `docs/specs/2026-11-01-s2-remote-scoring-design.md` (approved 2026-11-01; amended with the
match card and §7.3). Read it first; this plan argues from it.

## Global Constraints

- AGENTS.md applies in full: §3 layering (lint-enforced), §4 one parser per wire shape, `any` banned,
  §5 tokens only, §8 memo and no anonymous functions in render on the pad, Reanimated worklets only, §10
  the four questions and "mutate every guard once", §12 functions 10–25 lines, JSX ≤ 3 deep.
- `@seazn/engine` = `npm:@onryde/seazn-engine@1.1.0`, exact. `zod` declared at the version the engine's
  peer range names. No other engine version in this plan.
- `domain/` may import `@seazn/engine` (and its subpaths) and nothing else new: one lint allowance by
  source, as `qrcode-generator`'s.
- Every request: `Authorization: Bearer dl_…`, `redirect: 'error'`, a deadline (8 s, `withDeadline` from
  `httpAsk.ts`), body cap `MAX_BODY_BYTES`. Only to the build's Seazn host (`seaznOrigin(env)`).
- POST body: `{expected_seq, type, payload, idempotency_key, engine_epoch: foldEpochOf('badminton'),
rules_version}`. `idempotency_key` = a v4 UUID made at tap time and never changed for that tap.
- Bounce window 250 ms (`bounce.ts`). Polling 15 000 ms. Realtime channel `fixture:{id}`, broadcast
  event `state_changed`, private, token from `GET /api/v1/public/fixtures/{id}/realtime-token`.
- The scoring link's token lives only in the secure store (`KeyValueStore`), never in the queue file,
  a log line, the session record or a snapshot.
- No `eas build`, `eas submit`, `eas update`. Builds are local Gradle + adb, dev twin.
- Copy: every string in en/es/fr/nl and `docs/i18n-glossary.md`; no red outside ON AIR.
- Subagents: Sonnet implements and reviews each task; Opus reviews each batch and the whole branch
  (owner, 2026-11-01).

## Review Focus

1. **The app killed between a tap and its send** → on reopen the tap is still queued and is sent once.
   Test: Task 5 (store survives a reload) and Task 9 (hook resumes sending from a stored queue).
2. **The answer lost after the server accepted** → the resend with the same key is answered 201 with
   the original `event_id`; the tap counts once. Test: Task 6 (`onAnswer` for a replayed accept) and
   Task 4 (fake port replays by key).
3. **Another scorer finished the game while this phone was offline** → the phone's queued rally is
   illegal under the new ledger, leaves the queue, and the last-tap line says it did not count. Test:
   Task 6 (`revalidate` drops it) and Task 7 (strict fold refuses it).
4. **The link revoked with taps queued** → nothing is sent anywhere else; the taps become leftovers
   with Dismiss on Home. Test: Task 6 (`linkDead`), Task 10 (Continue card leftovers).
5. **The Realtime token expires after an hour** mid-match → the channel re-auths with a fresh token;
   while it is down polling covers. Test: Task 8 (re-subscribe on expiry; poll while down).

---

## Batch A — groundwork

### Task 1: The engine on the phone (R4) and its dependencies

**Files:**

- Create: `.npmrc` (committed, no secret): `@onryde:registry=https://npm.pkg.github.com` and
  `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`
- Modify: `package.json` (`@seazn/engine`, `zod`), `eslint.config.mjs` (domain allowance),
  `.github/workflows/*.yml` that run `pnpm install` (pass `NODE_AUTH_TOKEN` from a secret)
- Create: `src/domain/scoring/engineProbe.ts`, `src/domain/scoring/engineProbe.test.ts`
- Modify: the dev-twin `DevScenes` (`src/ui/components/DevScenes.tsx`, `src/hooks/useDevScenes.ts`) to
  run the probe and show its numbers
- Create: `docs/specs/2026-11-01-s2-r4-engine-on-hermes.md` (results)

**Interfaces:**

- Produces: `syntheticBadmintonMatch(): readonly EventEnvelope[]` (a decided best-of-3, home 21–15
  21–18: `core.start` + 75 rallies = 76 events) and `timeFold(events, times: number): {events: number;
ms: readonly number[]}` in `engineProbe.ts`; the lint allowance.

- [ ] **Step 1:** Registry access, no token in the repo or the chat:
  - local: the owner runs `gh auth refresh -s read:packages` once; installs run with
    `NODE_AUTH_TOKEN=$(gh auth token)`;
  - CI: the workflows' own `GITHUB_TOKEN` with `permissions: packages: read` (this repo already has
    Read on the package), passed as `NODE_AUTH_TOKEN` to `pnpm install`;
  - EAS (the next release only): an EAS secret `NODE_AUTH_TOKEN`, the owner's step in
    `docs/release.md`.
- [ ] **Step 2:** Add the dependencies; `pnpm install`; check what autolinks (`pnpm expo-doctor` or
      `npx expo install --check`) — expect nothing native from these two (AGENTS §13 class 4).
- [ ] **Step 3: Write the failing test** `engineProbe.test.ts`: `syntheticBadmintonMatch()` has 76
      events and folds strictly (`foldMatch(badminton, cfg, lineups, events, {strictFromSeq: 1})`) to a
      decided match, home winning 2–0, games 21–15 and 21–18; `timeFold(events, 10).ms` has 10 entries.
- [ ] **Step 4:** Implement the generator and `timeFold` (`performance.now()` around `foldMatch`).
- [ ] **Step 5:** Add the domain lint allowance `{ to: { module: { origin: 'external', source:
'@seazn/engine' } } }` (and subpaths); write a lint fixture proving `react` stays refused in domain.
- [ ] **Step 6:** Dev twin: a "Fold probe" scene runs `timeFold(syntheticBadmintonMatch(), 50)`, shows
      min/median/max ms, and logs `scoring.foldProbe {events, ms}`. (The decision record's R4 worry was a
      long cricket ledger; S2-2 and later sports repeat the probe with their own.)
- [ ] **Step 7: Device (R4):** release build on the OnePlus; run the probe; read the numbers. A crash
      or a `new Function` error from zod is a blocker: stop and report (ruling 26: S2 pauses for an engine
      fix release). If zod reaches `new Function`, add `z.config({ jitless: true })` at the engine import
      site and run again.
- [ ] **Step 8:** Write the results doc (device, build, numbers, verdict); `pnpm check`; commit.

### Task 2: The web bootstrap endpoint (seazn.club worktree)

**Repo:** `/Users/ashokhein/github/seazn.club`, worktree `../seazn.club-worktrees/s2-bootstrap`,
branch `feat/device-link-bootstrap` from fresh `origin/main`. Use the `seazn-local-env` skill for the
database and test runs.

**Files:**

- Create: `apps/web/src/app/api/v1/device-link/route.ts` (`GET`), its route test
- Create: `apps/web/src/server/usecases/device-link-bootstrap.ts` (+ test)
- Modify: `apps/web/src/app/api/v1/public/fixtures/[id]/realtime-token/route.ts` (also answer `url`
  and `apikey`: the public `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; owner,
  2026-11-01, option A: the server sends them, nothing is baked into the app)
- Modify: `apps/web/src/server/api-v1/auth.ts` (let a `dl_` bearer reach this one route),
  `apps/web/src/server/api-v1/schemas.ts` (the response schema)

**Interfaces:**

- Produces `GET /api/v1/device-link` → `{ok:true, data: DeviceLinkBootstrap}`:

```ts
type DeviceLinkBootstrap = {
  fixture_id: string;
  link_id: string;
  sport_key: string;
  module_version: string;
  cfg: unknown;
  rules_version: number;
  engine_epoch_required: number; // foldEpochOf(sport_key)
  screen: 'view_only' | 'division_not_started' | 'waiting' | 'confirm' | 'pad';
  view_only_reason: string | null;
  names: {
    competition: string;
    division: string | null;
    round_label: string | null;
    ref: string | null;
  };
  sides: Record<
    'home' | 'away',
    {
      entrant_id: string;
      name: string;
      kind: string;
      members: { person_id: string; full_name: string }[];
      lineup: { person_id: string; pair_order: number | null }[];
    }
  >;
  state: { status: string; last_seq: number };
};
```

- Errors: 401 `LINK_INVALID` / `LINK_REVOKED` / `LINK_EXPIRED`, as `resolveDeviceLinkToken` answers.

- [ ] **Step 1: Write the failing route tests:** a valid link answers every field above for a seeded
      badminton singles and doubles fixture (names from the seed, `screen` per `scanScreen`); revoked,
      expired and unknown answer 401 with their codes; a `dl_` bearer still gets 403 on any other v1 route; the realtime-token answer for a valid `dl_` carries `url` and `apikey` beside `token` and `channel`, and the web pad's use of it is unchanged.
- [ ] **Step 2:** Implement the use case by reusing what `app/score/[token]/page.tsx` already calls
      (`resolveDeviceLinkToken`, `scanScreen`, `scanMatchNames`, `loadFixturePadCfg`, `getFixtureState`,
      `getEntrant`, `getLineup`); no new SQL beyond what those do.
- [ ] **Step 3:** Run the web's checks for the touched packages; commit; open the PR against
      seazn.club main. Its merge and the staging deploy are the web's normal path: the owner merges.
- [ ] **Step 4:** Tell the engine/web sessions (SendMessage via ListAgents, if they are running) that
      the badminton pad should read `badminton.rally.serving` on the first rally (design §7.3). No change
      is made to the web pad here.

## Batch B — wire, ports, queue, sync rules

### Task 3: The wire parsers

**Files:** Create `src/domain/scoring/wire.ts`, `src/domain/scoring/wire.test.ts`.

**Interfaces:**

- Produces (one parser per shape, AGENTS §4):

```ts
type Bootstrap = { fixtureId; linkId; sportKey; moduleVersion; cfg: unknown; rulesVersion: number;
  epochRequired: number; screen: BootstrapScreen; viewOnlyReason: string | null;
  context: MatchContext; sides: Record<'home' | 'away', BootstrapSide>; lastSeq: number; status: string };
type LedgerEvent = { id: string; seq: number; type: string; payload: unknown; recordedAt: string;
  voids: string | null; deviceLinkId: string | null };
type BootstrapScreen = 'viewOnly' | 'divisionNotStarted' | 'waiting' | 'confirm' | 'pad';
type BootstrapSide = { entrantId: string; name: string; kind: string;
  members: readonly { personId: string; fullName: string }[];
  lineup: readonly { personId: string; pairOrder: number | null }[] };
type AppendBody = { expected_seq: number; type: string; payload: unknown; idempotency_key: string;
  engine_epoch: number; rules_version: number };
type AppendAnswer =
  | { kind: 'accepted'; seq: number; eventId: string; rulesVersion: number }
  | { kind: 'seqConflict'; currentSeq: number | null }
  | { kind: 'rulesChanged'; rulesVersion: number }
  | { kind: 'outdated'; required: number }
  | { kind: 'linkDead'; code: 'LINK_INVALID' | 'LINK_REVOKED' | 'LINK_EXPIRED' }
  | { kind: 'rateLimited'; retryAfterMs: number }
  | { kind: 'refused'; status: number; code: string }
  | { kind: 'offline' };
parseBootstrap(body: unknown): Bootstrap | null
parseEvents(body: unknown): readonly LedgerEvent[] | null
parseAppendAnswer(status: number, body: unknown): AppendAnswer
```

`MatchContext.match` is `ref` ("QF·1"), `round` is `round_label`, `division` and `competition` from
`names`; `sides` names are the entrants' `name`.

- [ ] **Step 1: Write the failing tests** with literal bodies copied from the scouted shapes (envelope
      `{ok, data|error, requestId}`): each `AppendAnswer` kind from its status and code (409
      `SEQ_CONFLICT {current_seq: 41}` → `{kind:'seqConflict', currentSeq: 41}`; 409
      `FIXTURE_RULES_CHANGED {rules_version: 3}`; 426 `ENGINE_OUTDATED {required: 3}`; 401 each link
      code; 429 with `Retry-After: 2` → 2000; 422 `WRONG_PHASE`; 201 replay identical to a first accept);
      a garbled body of each shape → null / `refused`; unknown `screen` → null.
- [ ] **Step 2:** Implement. **Step 3:** `pnpm vitest run src/domain/scoring/wire.test.ts`. **Step 4:** Commit.

### Task 4: The scoring port (fetch and fake)

**Files:** Create `src/services/scoringPort.ts`, `src/services/fetchScoringPort.ts` (+ test),
`src/services/fakeScoringPort.ts` (+ test). Modify `src/hooks/usePorts.tsx`,
`src/hooks/nativePorts.ts`, `test/fakePorts.ts` (add `scoring: ScoringPort`).

**Interfaces:**

- Consumes: Task 3's types.
- Produces:

```ts
type ScoringLink = { readonly origin: string; readonly token: string };
type RealtimeGrant = { token: string; channel: string; url: string; apikey: string };
interface ScoringPort {
  bootstrap(link: ScoringLink): Promise<{ kind: 'ok'; bootstrap: Bootstrap } | AppendAnswer>;
  events(link: ScoringLink, fixtureId: string, sinceSeq: number): Promise<readonly LedgerEvent[] | AppendAnswer>;
  rules(link: ScoringLink, fixtureId: string): Promise<{ cfg: unknown; rulesVersion: number } | AppendAnswer>;
  append(link: ScoringLink, fixtureId: string, body: AppendBody): Promise<AppendAnswer>;
  realtimeToken(link: ScoringLink, fixtureId: string): Promise<RealtimeGrant | null>;
}
createFetchScoringPort(deps: { fetch: FetchLike; logger: Logger; timeoutMs?: number }): ScoringPort
createFakeScoringPort(seed: FakeMatchSeed): ScoringPort & FakeServerControls
```

`FakeServerControls`: `addOtherScorerEvent(type, payload)`, `revoke()`, `setRulesVersion(n)`,
`setEpochRequired(n)`, `dropNextAnswer()` (accepts, then answers `offline`), `goOffline(on)`. The fake
folds with the real engine and enforces `expected_seq`, idempotency replay (201, same `event_id`) and
`ENDING_SANCTION_PENDING`. The preview samples (`fakeBadmintonPad.ts`'s singles and doubles) become
`FakeMatchSeed`s.

- [ ] **Step 1: Failing tests** (fetch, with a stubbed `fetch`): URL, bearer, `redirect:'error'`, the
      deadline → `offline`, a body over the cap → `offline`, a redirect → `offline`, a host other than the
      origin's never fetched; the token never in a `logger` call (assert the spy's arguments).
- [ ] **Step 2: Failing tests** (fake): a stale `expected_seq` → `seqConflict` with `currentSeq`; the
      same key twice → the same `eventId`; `dropNextAnswer` then resend → one event in the ledger.
- [ ] **Step 3:** Implement both; wire `scoring` into `createNativePorts` and `createFakePorts`.
- [ ] **Step 4:** `pnpm check`. **Step 5:** Commit.

### Task 5: The queue store

**Files:** Create `src/services/tapQueueStore.ts` (+ test). Modify `package.json` (`expo-file-system`
at Expo's range), ports as in Task 4 (`tapQueue: TapQueueStore`).

**Interfaces:**

```ts
type QueuedEvent = {
  key: string;
  type: string;
  payload: unknown;
  rulesVersion: number;
  createdAt: string;
  attempts: number;
};
type MatchQueue = {
  fixtureId: string;
  label: string;
  pending: readonly QueuedEvent[];
  ownEventIds: readonly string[];
  dead: null | 'LINK_INVALID' | 'LINK_REVOKED' | 'LINK_EXPIRED' | 'finalized';
};
interface TapQueueStore {
  list(): Promise<readonly MatchQueue[]>;
  load(fixtureId: string): Promise<MatchQueue | null>;
  save(queue: MatchQueue): Promise<void>; // atomic: temp file, then move
  remove(fixtureId: string): Promise<void>;
}
```

The link for a queue is in the secure store under `scoring.link.{fixtureId}` (`{origin, token}`),
written when the code is saved (Task 10) and deleted with the queue.

- [ ] **Step 1: Failing tests** against an in-memory file system double: save then load round-trips; a
      save interrupted after the temp write leaves the old file whole; `list` returns every match; a
      garbled file reads as null and is reported once (`logger.warn('scoring.queue.unreadable')`), never
      thrown; no token string in any file written.
- [ ] **Step 2:** Implement with `expo-file-system` (`documentDirectory/scoring/{fixtureId}.json`).
- [ ] **Step 3:** `pnpm check`; check autolinking. **Step 4:** Commit.

### Task 6: The sync rules (pure)

**Files:** Create `src/domain/scoring/sync.ts` (+ test).

**Interfaces:**

```ts
type SyncState = { tip: number; ledger: readonly LedgerEvent[]; queue: MatchQueue; rulesVersion: number;
  status: 'idle' | 'sending' | 'offline' | 'outdated' | 'dead'; conflictPasses: number };
type SyncEffect =
  | { kind: 'send'; body: AppendBody } | { kind: 'fetchSince'; seq: number } | { kind: 'reloadRules' }
  | { kind: 'retryIn'; ms: number } | { kind: 'persist' } | { kind: 'refused'; key: string; code: string };
nextSend(state: SyncState): AppendBody | null            // head of the queue, expected_seq = tip
onAnswer(state: SyncState, sent: QueuedEvent, answer: AppendAnswer): { state: SyncState; effects: readonly SyncEffect[] }
onLedger(state: SyncState, events: readonly LedgerEvent[]): SyncState
revalidate(state: SyncState, legal: (queued: readonly QueuedEvent[]) => readonly string[]): { state: SyncState; effects: readonly SyncEffect[] }
```

Answer table (design §6.3, §7.3), each a test:

| Answer       | State                                             | Effects                                                           |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| accepted     | head leaves queue, `ownEventIds` += id, tip = seq | persist, (next send)                                              |
| seqConflict  | conflictPasses+1                                  | fetchSince(tip); after 3 passes: retryIn(15 000) and passes reset |
| rulesChanged | rulesVersion = n; queue kept                      | reloadRules, then revalidate                                      |
| outdated     | status outdated; queue kept                       | persist                                                           |
| linkDead     | status dead; `queue.dead` = code                  | persist                                                           |
| rateLimited  | —                                                 | retryIn(ms)                                                       |
| offline      | status offline; attempts+1                        | retryIn(backoff: 1, 2, 5, 10, 15 s cap)                           |
| refused      | head leaves queue                                 | refused(key, code), fetchSince(tip), persist                      |

`revalidate` keeps the queued events `legal` returns (in order) and emits `refused` for the rest.

- [ ] **Step 1:** Failing tests, one per row and one per Review Focus 2–4. **Step 2:** Implement.
- [ ] **Step 3:** Mutate every guard once. **Step 4:** Commit.

## Batch C — the engine fold and the screen model

### Task 7: Badminton on the engine

**Files:** Create `src/domain/scoring/badmintonFold.ts`, `badmintonEvents.ts`, `undoTarget.ts`,
`badmintonLedgerHistory.ts` (+ tests). Modify `badmintonPad.ts` only where `BadmintonDisplay`
needs a field the fold supplies.

**Interfaces:**

```ts
foldBadminton(input: { bootstrap: Bootstrap; ledger: readonly LedgerEvent[]; queued: readonly QueuedEvent[];
  ownEventIds: readonly string[] }): { display: BadmintonDisplay; legalQueued: readonly string[];
  history: readonly PadHistoryGroup[] }
badmintonEventFor(tap: BadmintonTap, ctx: { bootstrap: Bootstrap; display: BadmintonDisplay;
  toss: PadSide | null }): { type: string; payload: unknown }
undoTarget(ledger: readonly LedgerEvent[], queued: readonly QueuedEvent[], ownEventIds: readonly string[]):
  | { kind: 'queued'; key: string } | { kind: 'ledger'; eventId: string }
  | { kind: 'blocked'; reason: 'otherScorer' | 'nothing' | 'startFollowed' }
```

- Sides: the top half is `home`, the bottom `away`. Events: rally → `badminton.rally {wonBy:
entrant_id}`, plus `serving: <toss side's entrant_id>` on the match's first rally only; start →
  `core.start {}`; sanction → `badminton.sanction {by, level, person}`; set score →
  `badminton.game.summary {home, away, partial: true}`; ending → `core.forfeit {by, reason:
'disqualified'}`; undo → `core.void {event_id}`.
- Server and court from `setBasedServeContext` and `badmintonPadRules.serviceCourt`; rules rows from
  `badmintonPadRules` and `cfg`; `foldMatch(..., { strictFromSeq })` over ledger + queued to learn
  which queued events are legal.
- History rows from ledger events (design §6.4): undone = another event voids it; voids are not rows;
  queued taps on top as sending; `by` from `ownEventIds`; the score after each rally from the fold's
  `onFolded`.
- Undo (ruling 28): the latest own event (queued first, then ledger) only if nothing from another
  device follows it; a start only if nothing follows it.

- [ ] **Step 1:** Failing tests with literal ledgers: a 21–15 game → the boxes and the "Game 2 of 3"
      strip; the first rally carries `serving`, the second does not; a disqualification → awaiting ending
      until `core.forfeit`; a queued rally after another scorer ended the game → not in `legalQueued`;
      undo blocked by another scorer's later rally; history marks a voided rally undone and shows no void
      row. The expected displays are written out, never computed by the fold.
- [ ] **Step 2:** Implement. **Step 3:** Port the kit's existing `badmintonPad.test.ts` cases that
      still apply onto the fold. **Step 4:** Mutate the guards. **Step 5:** Commit.

### Task 8: Realtime

**Files:** Create `src/services/realtimePort.ts` (+ test). Modify `package.json`
(`@supabase/realtime-js`), ports (`realtime: RealtimePort`), no app config: the address and the public key come with each `RealtimeGrant`
(owner, 2026-11-01, option A).

**Interfaces:**

```ts
interface RealtimePort {
  subscribe(
    grant: RealtimeGrant,
    handlers: { onPing: () => void; onDown: () => void; onUp: () => void },
  ): () => void;
}
```

- [ ] **Step 1:** Failing tests with a fake client: `setAuth(token)` before `channel(channel,
{config:{private:true}})`; `state_changed` → `onPing`; a closed/errored channel → `onDown`; the
      unsubscribe removes the channel.
- [ ] **Step 2:** Implement over `RealtimeClient(`${grant.url}/realtime/v1`, {params: {apikey:
grant.apikey}})`; a grant whose `url` is not https is refused (`onDown`, logged without the key).
- [ ] **Step 3:** Check it runs under Hermes in the release build (a dev-twin scene that subscribes to
      a staging fixture and counts pings); check autolinking. **Step 4:** Commit.

### Task 9: The match hook

**Files:** Create `src/hooks/useScoringMatch.ts` (+ test), `src/hooks/padScreenModel.ts`. Modify
`src/hooks/useBadmintonPadPreview.ts` to return the same `PadScreenModel`.

**Interfaces:**

```ts
type PadScreenModel = { view: PadView<BadmintonPadKey>; sheet: PadSheetView | null; line: PadLineWords;
  cardNote: MessageKey | null; flash: HalfFlash; toss: PadSide | null; actions: PadActions };
useScoringMatch(fixtureId: string): PadScreenModel | { kind: 'loading' } | { kind: 'linkGone' }
```

`PadActions` is the preview's `PadPreviewActions` without `pick`.

- Loads the link from the secure store and the queue from `tapQueue`; bootstraps (cached in the
  queue file's sibling `{fixtureId}.boot.json` for offline reopen); fetches events from 0; folds.
- At bootstrap, `epochRequired > foldEpochOf('badminton')` shows Update needed before any tap (ruling
  8's pre-check); a 401 link code shows the bad-link card and marks the queue dead.
- Screens from `screen`: `confirm` → Start screen; `divisionNotStarted` and `waiting` → Not started
  card; `viewOnly` → view only; `pad` → the pad (result recorded when the fold says decided).
- One sender at a time: `nextSend` → `scoring.append` → `onAnswer` → effects. Sends while the app is
  in the foreground; stops in the background.
- Subscribes Realtime with `realtimeToken`; `onPing` → `events(since tip)`; `onDown` → poll every
  15 s; re-requests the token when the channel drops after its hour (Review Focus 5).
- A tap: bounce guard, then `badmintonEventFor` → a `QueuedEvent` saved before the screen updates.
- `update` opens the store listing and `browser` opens the scoring link, through a `LinkPort`
  (`openUrl(url): Promise<void>`, new in `services/`, `Linking.openURL`).
- Undo per `undoTarget`; `blocked/otherScorer` shows "Another scorer has scored since" on the
  last-tap line with Undo disabled (new key).

- [ ] **Step 1:** Failing tests with `createFakeScoringPort` and fake timers: Review Focus 1–5; a tap
      offline then online drains in order; a ping fetches once; a 426 shows Update needed with the unsent
      count; the bad-link card on `linkDead`.
- [ ] **Step 2:** Implement in small hooks (load, send loop, live, taps), each ≤ 25 lines.
- [ ] **Step 3:** `pnpm check`. **Step 4:** Commit.

#### Task 9 additions (from the Batch B reviews, 2026-11-02)

The Sonnet per-task and Opus batch reviews of Tasks 3–6 found what the hook must own. Each is a test:

- Every change (tap enqueue, undo, answers, fetches, rules) goes through one pure reducer on the latest
  state; an abandoned send is fed back as `onAnswer(offline)` so `sending` never sticks; `sent` is the
  key in flight, never the current head.
- Retry waits and merge-before-send are enforced by sync itself (`nextSend(state, now)` and the hold):
  the hook passes a real clock, calls `revalidate` on a `revalidate` hold, and `onReadFailed` for every
  failed read; every bootstrap read goes through `onBootstrapStatus`, and the hook runs the
  `reloadBootstrap` effect. Before every `nextSend` the hook calls `retryRules(state, now)` (a failed rules read is
  re-asked every 15 s, even with nothing queued).
- Effects run in order; a send goes only after the `persist` before it has resolved (Review Focus 1
  holds only then).
- An unresolved head (sent, no definitive answer; also one reopened after a kill) is resent with its key;
  sync drops nothing while it is unresolved. Undo of an in-flight tap waits for its answer and voids the
  returned id.
- Read failures go through sync's exported reducer: a dead link or a queue-closing refusal makes the
  queue dead; `tooLarge` is a visible state, never endless retries.
- A refused save can come back (the next read promotes the temp file): re-save the queue; never say
  "not recorded" without having saved the queue without that tap.
- Realtime (Task 8 review): one owner of the subscription; every `onUp`, a rejoin included, owes a ledger
  read (pings in the gap are lost); while down, poll every 15 s and resubscribe with a fresh grant
  (the library retries an expired token forever), backing off so a grant refused every time cannot
  loop; unsubscribe on unmount and in the background.
- From Task 7: undo passes `undoTarget` only the queued taps in `legalQueued` (the list the display
  uses); an `unfoldable` fold never reaches `revalidate` (an empty `legalQueued` would drop the whole
  queue) and shows a visible state; the hook persists the toss beside the queue (a kill between Start and the first rally must not lose
  it; without it the start names no server); a
  discarded queued tap's "undone" line is the hook's; an abandoned match folds as decided, so the
  closed/finished state comes from the bootstrap status or `viewOnly`; Task 11's HistoryCover draws
  `sending`.
- From the Batch C review: a link for any sport but badminton shows a visible "not on the phone yet"
  state (nothing else checks `sportKey`; the fold would accept a table-tennis cfg); fold under the rules
  sync holds (`{...bootstrap, cfg: rules.cfg}`) and re-save the boot cache when they change;
  `tapQueueStore.ts` gains save/load/remove for `{fixtureId}.boot.json` (and the toss), removed on
  Dismiss; the fold's in-flight double count (the server's copy fetched before the answer) is hidden
  when the ledger holds an event at the sent `expected_seq + 1` with the same type and payload; the
  model has members for unfoldable, tooLarge, an unreadable queue and an unsupported sport; a null from
  `badmintonEventFor` gets a last-tap line; the fold is memoized; every send's payload goes through
  `payloadForSend(queued, ledger)` (the toss stamp is decided at the first send); the background sender
  never subscribes to Realtime (one subscription; a second closes the first).
- `ownEventIds` belong to one link.
- Task 7 pins that the badminton pad never emits `core.settle` or `core.abandon`, and emits
  `core.forfeit` only as a disqualification's ending (a device link gets 403 for the rest).
- The tip comes from the ledger, never from `bootstrap.lastSeq`.
- Sync marks the queue dead on a 401, a finalized and a cancelled match; the hook owns a carried-forward
  `viewOnly` reason and the cards for an empty queue.
- The tap is saved before the screen shows it.
- `logger.protectLink(token)` when the link is loaded from the secure store.
- Task 10 lists `unreadable` queue entries, with Dismiss.
- The background sender for other matches' queues (ruling 29) is built here.
- Dismiss stops that match's sender before `remove`, and deletes `{fixtureId}.boot.json` and the cached
  ledger too.
- A garbled queue file or a missing native module surfaces as a visible state, never as silence.
- Task 7: `legalQueued` skips an illegal tap and goes on judging the ones behind it; it keys own events on
  `ownEventIds` (the stand-in ledger event carries the phone's clock and a null `deviceLinkId`).
- Task 9/11: when the link dies while a sheet (Match details, Set score, History) is open, the sheet
  closes and the bad-link card shows (round 8 hardening, the controller's call).

## Batch D — into the app

### Task 10: Scan, save, reopen and Home

**Files:** Modify `src/domain/mode/scanOutcome.ts` (`BUILT_MODES` gains `'scoring'`),
`src/domain/mode/savedCode.ts` (a scoring variant), `src/domain/mode/reopen.ts` (`{go: 'scoring'}`),
`src/domain/mode/continueCard.ts` (`scoring {label, unsent}` and leftovers), `src/hooks/useHome.ts`,
`src/hooks/useReopenGate.ts`, `src/ui/components/ContinueCard.tsx`, `src/ui/screens/HomeScreen.tsx`,
`app/scoring/index.tsx` (+ tests).

- A scanned scoring link on the build's host is saved (`code.scoring`) with the link in
  `scoring.link.{fixtureId}` after a successful bootstrap; a foreign host is refused as today.
- Home's Remote Scoring tile scans in every build; the dev twin keeps the preview behind a dev scene,
  not the tile.
- Reopen goes to `/scoring` when a scoring code is saved and the app was last in that mode.
- Continue card: the current match's label and unsent count; other matches' queues as "N taps from
  {match} not sent yet"; dead queues as "N taps not sent — tell the organiser" with Dismiss, which
  removes the queue and its link.

- [ ] **Step 1:** Failing tests for each bullet, through `createFakePorts`, in four languages.
- [ ] **Step 2:** Implement. **Step 3:** `pnpm check`. **Step 4:** Commit.

### Task 11: The real pad screen

**Files:** Rename `src/ui/screens/BadmintonPadPreviewScreen.tsx` → `BadmintonPadScreen.tsx` taking a
`PadScreenModel`; keep the preview row only in a dev scene wrapper. Modify `app/scoring/index.tsx`
to render `useScoringMatch`. Delete the `previewScoring` gate and its Ports member.

- [ ] **Step 1:** Failing routed tests: scan → Start screen (`screen: 'confirm'`) → toss → Start →
      pad with SERVING · RIGHT on the picked side; `division_not_started` and `waiting` → Not started card;
      `view_only` → view only; outdated → Update needed banner.
- [ ] **Step 2:** Implement. **Step 3:** Fit tests unchanged and green. **Step 4:** Commit.

### Task 12: House rules

**Files:** Modify `AGENTS.md` §1, §2, §3, §11 (design §12), `docs/specs/2026-09-29-multi-mode-app-decisions.md`
(ruling 9 superseded for S2; the S2 row), `docs/i18n-glossary.md`.

- [ ] **Step 1:** Edit; `pnpm prettier --check` on each; commit.

## Batch E — the exit bar

### Task 13: Staging, on the phone (ruling 11)

Needs the owner's hands for scanning, flight mode and the browser; the controller drives adb.

- [ ] **Step 1:** Release build of the branch, dev twin, on the OnePlus. A staging badminton fixture
      with a scoring link (Event pass).
- [ ] **Step 2:** Design §10 items 1–7, each with what the screen showed and what the console showed.
- [ ] **Step 3:** A second geometry (`adb shell wm size 720x1600`, `wm density 320`), then reset.
- [ ] **Step 4:** Results doc `docs/specs/2026-11-xx-s2-1-results.md`; whole-branch review (Opus);
      PRs in order: `feat/dev-app-variant`, `feat/s2-pad-ui`, this branch.

---

## Execution notes

- Branch `feat/s2-1-remote-scoring` from `feat/s2-pad-ui` (after round 8's hardening), worktree
  `/Users/ashokhein/github/seazn.club.capture-worktrees/s2-1`. Task 2 is in the web worktree and can
  run beside Batch B (disjoint repos).
- Order: A → (B ∥ Task 2) → C → D → E. Task 9 needs Tasks 3–8; Task 11 needs Task 9.
