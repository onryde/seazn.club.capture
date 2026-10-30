# What viewers see as a still: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a composed session, on air, one tap shows a recent Cloudflare still of Output B (the score bug as viewers
see it), and nothing about it can disturb the broadcast.

**Architecture:** The web adds one optional descriptor field, `programmeStillUrl`, the programme input's thumbnail
address. Native parses it with the session shape and carries it in the snapshot's `broadcast`; native never fetches it.
TypeScript fetches it behind a new port, judges it with a pure rule (live only if `max-age` ≤ 10, never byte-identical
for 20 s), and draws it over the camera half. The video player, `expo-video` and `FEATURES.viewerCheck` go.

**Tech Stack:** web: TypeScript, zod 4, vitest, Postgres (seazn-env). Capture: Expo/RN, TypeScript, Kotlin core,
vitest, Gradle unit tests.

**Spec:** `docs/specs/2026-10-30-viewer-still-design.md` (T1–T6 are its findings).

## Global Constraints

- Web first: the capture tasks start only after the web PR has merged and staging deploys it.
- `programmeStillUrl` = `https://<STREAM_PLAYBACK_HOST>/<programme input uid>/thumbnails/thumbnail.jpg`, no query;
  present only when the session has a `fixture_stream_inputs` row with `role = 'programme'`, slot 0; absent otherwise
  (never `null`). `playbackUrl` does not change.
- The phone adds `height=360`. A picture is live only if `Cache-Control` `max-age` ≤ 10. Frozen = bytes identical to a
  picture that arrived ≥ 20 s before. Refresh 10 s; auto-close 30 s after the tap; keep the last picture ≤ 30 s old
  after a failed fetch; fetch timeout 6 s; one request in flight.
- Fetch only while the snapshot says live and the URL is present. On-air row only. No feature switch.
- Native never fetches the still, and nothing of it reaches the machine, the snapshot (beyond the URL), the heartbeat or
  the engine. A malformed `programmeStillUrl` never refuses a pairing: it reads as absent.
- No URL in a record line. Record lines: `viewer.check {state}` and `viewer.still {ms}` only (the record contract's
  `kind` is an open pattern and `state`/`ms` are plain, so the web's record contract does not change).
- Copy in en/es/fr/nl; colour from tokens only; `StyleSheet.create`; no anonymous functions in render for HUD parts.
- Contracts change only through the web and `pnpm contracts:vendor` (AGENTS §4).

## Review Focus

1. The phone leaves live with the cover open: the cover closes and no fetch starts after it (Task C4).
2. Output B freezes while the phone is still live (compositor restart): after 20 s of identical bytes the cover says
   "No live picture", not "6 s ago" (Task C2).
3. Cloudflare serves the recording's first frame (`max-age=864000`): "No live picture", never the slate as now
   (Task C2).
4. A second tap while a fetch is in flight closes the cover, and the late answer is dropped, not drawn (Task C4).
5. Trouble starts while open: the cover closes and the cell is disabled; when trouble clears the cell is enabled and
   the cover does not reopen by itself (Task C4).

---

## Part W: the web (repo `onryde/seazn.club`)

Worktree, never the main checkout:
`git -C /Users/ashokhein/github/seazn.club worktree add ../seazn.club-worktrees/capture-programme-still -b feat/capture-programme-still origin/main`.
The DB suites need a fresh database: the `seazn-local-env` skill (`seazn-env up --label programme-still`, then
`eval "$(seazn-env env --label programme-still)"`). Without one `capture-get.test.ts` skips silently: check the count.

### Task W1: `programmeStillUrl` on the descriptor

**Files:**

- Modify: `apps/web/src/server/usecases/capture-phone.ts` (`sessionDescriptor` :244-283; new helper beside
  `inputUidOf` :286-290)
- Modify: `apps/web/src/server/api-v1/capture-schemas.ts:85-95` (`SessionFields`)
- Regenerate: `docs/contracts/capture-descriptor.v1.json` (`node --experimental-strip-types scripts/gen-capture-contracts.ts`;
  field prose at the generator's :114)
- Create fixtures: `docs/contracts/fixtures/capture-descriptor.v1/valid-live-composed.json`,
  `invalid-programmeStillUrl-not-url.json`
- Modify: `apps/web/src/server/api-v1/__tests__/capture-contract.test.ts` (SHA pin :53, `DESCRIPTOR_MATRIX` :96,
  fixture `count` :270 → 54)
- Test: `apps/web/src/server/usecases/__tests__/capture-get.test.ts`

**Interfaces:**

- Produces: descriptor session field `programmeStillUrl?: string` (z `Url.optional()`), in warming, live, ending,
  completed and failed, as `playbackUrl` is.

- [ ] **Step 1: Write the failing tests** in `capture-get.test.ts`, beside the R2004 test at :342 and using its setup
      (`captureRig`, `createSession(… {mode: "composed"} …)`, the programme row is `rows[1]`):
  - `"programmeStillUrl: a composed session names its PROGRAMME input's thumbnail, with no query"`: expect
    `programmeStillUrl` `=== \`https://${FAKE_PLAYBACK_HOST}/${programmeUid}/thumbnails/thumbnail.jpg\``and`playbackUrl` still the camera's.
  - `"programmeStillUrl: a passthrough session has none"`: expect `not.toHaveProperty("programmeStillUrl")`.
  - In `capture-contract.test.ts`, the new `DESCRIPTOR_MATRIX` cell: `programmeStillUrl` allowed in the five session
    states, refused in `waiting`.
- [ ] **Step 2: Run, expect FAIL** — `cd apps/web && npx vitest run src/server/usecases/__tests__/capture-get.test.ts src/server/api-v1/__tests__/capture-contract.test.ts`
      (with the DB env; the count of capture-get tests must be non-zero).
- [ ] **Step 3: Implement.** `programmeUidOf(sessionId: string): Promise<string | null>` (`role = 'programme' and
slot = 0`); in `sessionDescriptor` spread `{ programmeStillUrl }` into `session` only when it is non-null. Add
      `programmeStillUrl: Url.optional()` to `SessionFields`. Regenerate the contract, add the two fixtures, move the SHA.
- [ ] **Step 4: Run, expect PASS**, then the web's full `npm run test --workspace apps/web` with the DB env.
- [ ] **Step 5: Commit, open the PR** (body names the capture plan; "the phone's parser ignores unknown fields, so this
      is safe before capture re-vendors"). Merge only on the owner's word.

---

## Part C: capture (this repo)

Branch `feat/viewer-still` from main after Task W1 has merged.

### Task C1: The field through native to the snapshot

**Files:**

- Vendor: `pnpm contracts:vendor` at W1's merge commit (`contracts/`, `contracts/VENDORED.json`, `contracts/README.md`'s
  history line)
- Modify (Kotlin, `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/`):
  `adapter/Bodies.kt:221-234` (`broadcast()`), `core/Answers.kt:26,55` (`BroadcastDescriptor`),
  `core/SessionConfig.kt:35`, `core/Projection.kt:43-53`, `core/Snapshot.kt:150-153` (`BroadcastView`),
  `adapter/SnapshotWire.kt:61-65`
- Modify vectors: `modules/capture-engine/src/wire/server-bodies.json`, `session-vectors.json`, `snapshot-vectors.json`
- Modify (TS): `modules/capture-engine/src/CaptureEnginePort.ts:94`, `snapshotWire.ts:281-292` (`toBroadcast`),
  `FakeCaptureEngine.ts:230-233` (`broadcastFor`), `src/domain/session/Pairing.ts:46-49`,
  `src/hooks/engineSelectors.ts:68-69`
- Test: `KT/adapter/BodiesTest.kt`, `KT/adapter/SnapshotWireTest.kt`, `modules/capture-engine/src/snapshotWire.test.ts`,
  `src/hooks/engineSelectors.test.ts`

**Interfaces:**

- Produces: `BroadcastView.programmeStillUrl: String?`; snapshot JSON `broadcast.programmeStillUrl: string | null`;
  TS `EngineSnapshot['broadcast']['programmeStillUrl']: string | null`;
  `selectProgrammeStillUrl(snapshot: EngineSnapshot): string | null` in `engineSelectors.ts`.

- [ ] **Step 1: Write the failing tests.** Session vectors: a composed body with the field parses to it; a body
      without it parses to null; a body with `"http://…"` or `""` parses to null **and still pairs** (no `Unreadable`).
      Snapshot vectors: the key is written as given and as `null`. `selectProgrammeStillUrl` returns it, and null with no
      broadcast.
- [ ] **Step 2: Run, expect FAIL** — `cd modules/capture-engine/android && ./gradlew :core:test` and
      `pnpm vitest run modules/capture-engine/src/snapshotWire.test.ts src/hooks/engineSelectors.test.ts`.
- [ ] **Step 3: Implement.** In `broadcast()`: `programmeStillUrl = filled(fields["programmeStillUrl"])?.takeIf {
it.startsWith("https://") }`. Carry it to `BroadcastView` beside `playbackUrl`. The fake engine gives a still URL on
      its composed fixture only.
- [ ] **Step 4: Run, expect PASS**, then `pnpm check` and `./gradlew :core:test`.
- [ ] **Step 5: Commit** `feat(engine): the descriptor's programmeStillUrl reaches the snapshot`.

### Task C2: The rule

**Files:**

- Create: `src/domain/session/viewerStill.ts`, `src/domain/session/viewerStill.test.ts`
- Delete: `src/domain/session/viewerCheck.ts`, `viewerFeed.ts`, their tests (in Task C5, when nothing imports them)

**Interfaces:**

- Produces, in `viewerStill.ts`:
  - `REFRESH_MS = 10_000`, `OPEN_MS = 30_000`, `KEEP_MS = 30_000`, `FROZEN_MS = 20_000`, `FETCH_TIMEOUT_MS = 6_000`,
    `LIVE_MAX_AGE_S = 10`, `STILL_HEIGHT = 360`
  - `type Picture = { readonly uri: string; readonly digest: string; readonly maxAgeS: number | null; readonly ageS: number }`
  - `type ViewerStill = { readonly kind: 'idle' } | { readonly kind: 'open'; readonly until: number; readonly shown: Shown | null; readonly line: 'loading' | 'picture' | 'noPicture' }`
    where `Shown = { readonly uri: string; readonly digest: string; readonly takenAt: number; readonly sameSince: number }`
    (`takenAt` = arrival − `ageS`; `sameSince` = arrival of the first copy of this digest)
  - `type ViewerStillEvent = { kind: 'tap'; at } | { kind: 'picture'; at; picture: Picture } | { kind: 'refused'; at } | { kind: 'tick'; at } | { kind: 'close' }`
  - `viewerStill(state: ViewerStill, event: ViewerStillEvent): ViewerStill`
  - `ageSeconds(state: ViewerStill, now: number): number | null` (whole seconds since `takenAt`, null without a picture)

- [ ] **Step 1: Write the failing tests** (values from the spec, never computed by the rule):
  - tap from idle → open, `line: 'loading'`, `until = at + 30_000`; tap while open → idle.
  - picture `maxAgeS: 10, ageS: 2` → `line: 'picture'`, `ageSeconds(…, at) === 2`.
  - picture `maxAgeS: 864000` → `line: 'noPicture'`, `shown: null` (T5, the recording's first frame).
  - picture `maxAgeS: null` (no header) → `noPicture`.
  - same digest at `t`, `t + 10_000`, `t + 20_000` → still `picture` at `t + 10_000`, `noPicture` at `t + 20_000` (T6).
  - a new digest after a frozen one → `picture` again.
  - refused at 25 s after `takenAt` → keeps the picture; tick at 31 s after `takenAt` → `noPicture`.
  - tick at `until` → idle; close → idle from any state; a picture while idle → stays idle (a late answer).
- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run src/domain/session/viewerStill.test.ts`.
- [ ] **Step 3: Implement** the reducer, pure (no timers, no `Date.now()`; AGENTS §3 boundaries).
- [ ] **Step 4: Run, expect PASS.** Mutate each guard once (the `≤ 10`, the `≥ 20_000`, the `KEEP_MS` drop, the idle
      drop of a late picture) and watch a test fail.
- [ ] **Step 5: Commit** `feat(viewer): the still's rule: live by max-age, frozen by digest`.

### Task C3: The port

**Files:**

- Create: `src/services/viewerStillPort.ts` (interface + fetch implementation, as `recordUploadPort.ts` keeps both),
  `src/services/viewerStillPort.test.ts`
- Modify: `src/hooks/usePorts.tsx:40` (`Ports.viewerStill`), `src/services/native/nativePorts.ts:80-89`
  (`createNativePorts`), `test/fakePorts.ts:90-120` (`createFakeViewerStill`)

**Interfaces:**

- Produces: `interface ViewerStillPort { fetchStill(url: string): Promise<StillAnswer> }`;
  `type StillAnswer = { readonly kind: 'picture'; readonly picture: Picture } | { readonly kind: 'refused'; readonly word: 'timeout' | 'status' | 'network' | 'notImage' }`;
  `createFetchViewerStill(fetchFn: typeof fetch): ViewerStillPort`; fake: `createFakeViewerStill()` with
  `answer(next: StillAnswer)` and `calls: readonly string[]`.

- [ ] **Step 1: Write the failing tests** with an injected `fetch`: the request URL is the given URL with `height=360`
      (via `withQueryParam` from `previewUrls.ts`); `Cache-Control: public, max-age=10` and `Age: 3` → `maxAgeS 10,
ageS 3`; no `Cache-Control` → `maxAgeS null`; 204 → `refused 'status'`; `content-type: text/plain` → `notImage`;
      no answer in 6 s → `timeout` (fake timers); a thrown fetch → `network`; identical bytes → identical `digest`,
      different bytes → different.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Deadline with `withDeadline` (`src/services/httpAsk.ts:69`). Bytes → `data:image/jpeg;base64,…`
      `uri`; `digest` from the bytes (a non-cryptographic hash is enough: equality is all it is used for). Check that
      `btoa` exists under Hermes on the device in Task C7; no new dependency. Wire `createNativePorts` with the global
      `fetch` (check the wiring, recurring failure 1).
- [ ] **Step 4: Run, expect PASS**, `pnpm check`.
- [ ] **Step 5: Commit** `feat(viewer): ViewerStillPort fetches a still and its freshness`.

### Task C4: The hook

**Files:**

- Create: `src/hooks/useViewerStill.ts`, `src/hooks/useViewerStill.test.tsx`
- Delete in Task C5: `src/hooks/useViewerCheck.ts`, `useViewerFeed.ts` and their tests

**Interfaces:**

- Consumes: `viewerStill`, `ageSeconds`, the constants (C2); `Ports.viewerStill` (C3); `selectProgrammeStillUrl` (C1).
- Produces: `useViewerStill(input: { url: string | null; live: boolean; trouble: boolean; shed: boolean; scoringOpen: boolean; hideScoring: () => void }): { view: ViewerStill; ageS: number | null; disabled: 'hot' | 'trouble' | null; toggle: () => void; close: () => void }`
  (the cell shows when `url !== null && live`).

- [ ] **Step 1: Write the failing tests** with fake timers and the fake port:
  - toggle → one fetch at once, then one every 10 s; never two in flight (a slow answer delays the next tick).
  - Review Focus 1: `live` → false while open → closed, and no fetch after.
  - Review Focus 4: toggle, toggle again before the answer → closed; the answer arrives → still closed, nothing drawn.
  - Review Focus 5: `trouble` → true while open → closed and `disabled: 'trouble'`; → false → `disabled: null`, still
    closed. `shed` → closed and `disabled: 'hot'`.
  - Opening calls `hideScoring`; `scoringOpen` → true closes this cover.
  - The app to background closes it (the existing background close in `useViewerCheck.ts:46-47`), and so does the
    turn card covering the stage (as the old view did, plan A rulings 7 N4).
  - Closes at 30 s; writes `viewer.check {state: 'open' | 'picture' | 'noPicture' | 'closed'}` on each change and
    `viewer.still {ms}` per answered fetch; no URL in any line.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (timers and a 1 Hz age clock here; the rule decides).
- [ ] **Step 4: Run, expect PASS**; mutate the in-flight guard and the `live` close, watch a test fail.
- [ ] **Step 5: Commit** `feat(viewer): useViewerStill owns the refresh, the clock and the closes`.

### Task C5: The cell and the cover, the switch gone

**Files:**

- Modify: `src/ui/components/ViewerCover.tsx`, `ViewerPeek.tsx:24`, `StreamColumn.tsx:66-69,191-194`,
  `StreamStage.tsx:67,76,150-156`, `src/ui/screens/StreamScreen.tsx:35-77`, `src/hooks/advisory.ts:48-57`
- Modify: `src/ui/features.ts` (remove `viewerCheck`, keep `recordSend`), every test that passes the switch
  (`StreamScreen.{viewer,viewerHidden,onAir,layout,locales}.test.tsx`, `test/renderViewfinder.tsx:33`)
- Modify: `src/i18n/{en,es,fr,nl}.json` (`stream.peek.*`)
- Delete: `viewerCheck.ts`, `viewerFeed.ts`, `useViewerCheck.ts`, `useViewerFeed.ts` and their tests;
  `StreamScreen.viewerHidden.test.tsx` (nothing is hidden now)
- Test: `ViewerCover.test.tsx`, `ViewerPeek.test.tsx`, `StreamScreen.viewer.test.tsx`, `stripTextFit.test.ts`

**Interfaces:**

- Consumes: `useViewerStill` (C4).
- Produces copy keys (en values fixed here; es/fr/nl translated with `_review` set, as the dictionaries do):
  `stream.peek.label` "What viewers see" (kept), `stream.peek.age` "What viewers see · {seconds} s ago",
  `stream.peek.noPicture` "No live picture", `stream.peek.loading` "Getting the picture…",
  `stream.peek.delay` "A new point takes up to 20 s to show here", `stream.peek.trouble` "Stream unsteady";
  `stream.peek.hot` kept. Remove keys nothing reads (`closesIn`, `notReady`, `honest`, `unavailable`) after a grep.

- [ ] **Step 1: Write the failing tests** (AGENTS §10: render each state through the fakes, assert what the operator
      sees): composed + live → the fourth cell; passthrough (no URL) → no cell; open → cover over the camera half with
      "Getting the picture…", then the picture and "What viewers see · 2 s ago"; `noPicture` → "No live picture" and no
      image; the delay hint always while open; Stop still pressable while open; the cell disabled with "Phone hot" and
      with "Stream unsteady"; each in en/es/fr/nl, the cover's line measured in `stripTextFit` at 640 × 360.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement**; remove the switch and the dead files.
- [ ] **Step 4: Run, expect PASS**, `pnpm check` (lint catches stale imports).
- [ ] **Step 5: Commit** `feat(viewer): What viewers see shows Output B's still, on every composed session`.

### Task C6: The player goes

**Files:**

- Delete: `src/ui/components/StageVideo.tsx`, `test/fakeExpoVideo.ts`, `peekPlaybackUrl` in `previewUrls.ts` (keep
  `withQueryParam`) and its test cases, `src/domain/session/previewUrls.test.ts`, the `Video` surface in `src/services/surfaces.ts:6,24`, `src/services/native/nativeSurfaces.tsx:36,92,125`,
  `test/fakeSurfaces.ts:24`
- Modify: `package.json:50` (remove `expo-video`), `pnpm-lock.yaml`, `test/dependencies.test.ts:15`,
  `src/ui/screens/SettingsScreen.tsx:23` (licence list) and its test :190

- [ ] **Step 1:** Change the tests first: `dependencies.test.ts` asserts `expo-video` is absent; the Settings licence
      test no longer lists it; `nativeSurfaces.test.tsx` drops the Video case. Run, expect FAIL.
- [ ] **Step 2:** Remove; `pnpm install`; `pnpm check`. Expect PASS. `grep -rn "expo-video\|StageVideo\|MutedVideo" src app modules test`
      → nothing.
- [ ] **Step 3:** Fresh prebuild (`pnpm expo prebuild -p android --no-install`, revert `package.json`'s script rewrite)
      and `./gradlew assembleRelease` succeed: removing a native module is native.
- [ ] **Step 4: Commit** `chore(viewer): remove the video player and expo-video`.

### Task C7: The rules, and the phone

**Files:**

- Modify: `AGENTS.md` §6 (the What viewers see bullet: a still of Output B, the rules of spec §4–§5, on every
  composed session, no switch; owner 2026-10-30 quotes), §8 (ladder step 1 closes the cover and disables the cell;
  drop "with What viewers see hidden"), §3 tree only if a file named there moved
- Modify: `_FINDINGS.md`: one finding for T1–T6 with the spike's evidence (an ID after the last N)

- [ ] **Step 1:** Edit the docs; `pnpm prettier --check AGENTS.md _FINDINGS.md`.
- [ ] **Step 2: Device, local release build on the owner's phone** (AGENTS §13, verify as the customer): a composed
      staging match; tap the cell → picture within ~5 s and the age counting; score a point → the still shows it within
      ~20 s; Stop pressable over the cover; airplane mode on the uplink while open → closes on trouble; leave live → closes;
      a passthrough code → no cell; two geometries (`wm size`), es and nl. Screenshots cropped, app only. Steps that need
      the owner's hands are listed for the owner.
- [ ] **Step 3: Commit** `docs(viewer): AGENTS and findings for the still`, open the PR with the device evidence.
