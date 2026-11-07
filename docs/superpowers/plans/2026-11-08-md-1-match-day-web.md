# MD-1 Match Day — web side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `seazn.club` a Match Day code that an organiser mints on the Match Day desk. A phone holding the code
can read the day's matches in its scope, open a match's own scoring link, and (when ticked) approve a Swiss next
round or a knockout draw.

**Architecture:** A new credential table, `match_day_codes`, with an `md_` bearer, modelled on
`capture_stream_codes` (V430): hashed token, sealed copy for re-showing, RLS forced with no policy, read through the
non-tenant client. Four `md_` routes resolve the token themselves, as `app/api/v1/device-link/route.ts` does. Behind
each one the existing usecases run with a synthetic `AuthCtx` (`via: "match_day_code"`, the code's org, the minting
user). Session-editor routes mint, list and revoke. Every `md_` answer is a vendored `capture-matchday-*` contract.

**Tech Stack:** Next.js route handlers, Postgres (Flyway), vitest (DB-backed), `@seazn/engine/scheduling`.

**Spec:** `docs/specs/2026-11-07-s4-match-day-design.md` (capture repo, branch `docs/match-day-design`). Read §3,
§5–§7 and §9.

**Repo:** all work is in a new `seazn.club` worktree, branch `feat/match-day-code`, from `origin/main`. Paths below
are under `apps/web/src/` unless they start with `db/` or `docs/`. The recon these paths come from is
`seazn.club` main @ `97d22c8acd`. Re-verify each line number before editing (AGENTS.md §13, failure class 2).

## Global Constraints

- **Token:** `md_` + 32 random bytes, base64url. Store `tok_hash` (sha256 hex, the same as
  `hashDeviceLinkToken`) and `tok_enc` (sealed, `sealWith("DEVICE_LINK_KEK")`).
  - Never log it, never put it in a query string, never return it from any `md_` route.
  - The token is the URL's last path segment: `${origin}/day/${token}`.
- **Day bounds:** the organiser picks a date (default today in the competition's zone, i.e. the org's day as
  `match-day.ts` labels it). `opens_at` = 00:00 of that date and `expires_at` = 24:00, both in the zone from
  `resolveVenueTz(null, org tz)` _(plan decision: one zone per code; the spec says "the division's zone", and a
  competition whose divisions sit in different zones is not handled in v1)_.
- **Scope:** `scope_kind` is `'competition' | 'venue' | 'courts'`. A `venue` code covers that venue's courts; a
  `courts` code covers exactly `court_ids`. Matches with no court are visible only to a `competition` code (owner,
  2026-11-07).
- **Refusal words** on every `md_` route, as `{error: {code}}`:
  - `MD_UNKNOWN` 401: no such code.
  - `MD_WITHDRAWN` 410: the code was withdrawn.
  - `MD_ENDED` 410: the code's day is over.
  - `MD_NOT_OPEN` 403: the code's day has not started. The body also carries `opens_at`.
  - `MD_OUT_OF_SCOPE` 403
  - `MD_NO_APPROVE` 403
  - `MD_STALE` 409
  - `MD_ALREADY` 409
  - `MD_TIES` 409
- **Rate limits:** `publicPollRateLimit(req)` before the lookup, then `rateLimit(\`mdv1:${code.id}\`, {max:10,
windowSeconds:1})`. Opening a match also spends `rateLimit(\`dlmint:${ip}\`, DEVICE_LINK_MINT_LIMIT)`.
- **Every route** is in `openapi.ts` ROUTES and classified in `key-scopes.ts`:
  - the `md_` routes in `NEVER_KEY_ROUTES`;
  - the desk routes as competition `write`.
- **`md_` is refused everywhere else.** `rejectDeviceLink` also refuses `md_`, with a 403.
- **Copy** in en/es/fr/nl under the `matchDay.code.*` prefix, which `match-day/page.tsx` passes to the client.
  Afterwards run `npm run i18n:gen-keys`.
- **Verification:** run only `npx tsc --noEmit` locally (the controller's directive, relayed 2026-11-08). Tests,
  lint and e2e run on CI: push the branch, or open a draft PR, and read the CI counts. Wherever a "Run" step below
  is not tsc, it means push and read CI.
- **DB tests:** `describe.skipIf(!HAS_DB)`. Read CI's **skipped** count: a skipped DB suite is not a pass. If web CI
  skips the DB suites, stop and ask the owner before relying on them.

## Review Focus

1. **A code minted for tomorrow, read tonight** → `MD_NOT_OPEN` with `opens_at`. Never `MD_ENDED`, and never an empty
   day. Test in Task 1.
2. **A match that moves from Court 2 to Court 3 after a `courts:[2]` code listed it** → opening it is
   `MD_OUT_OF_SCOPE`. The scope is checked at open time, not trusted from the list. Test in Task 4.
3. **Opening a finalized or cancelled match** → `{kind:"finished"}`, never a fresh mint. Opening never revokes the
   printed QR's link. Test in Task 4.
4. **A Swiss preview whose draw uses lots** → the approve must not refuse every time as stale. The stale hash is over
   the inputs (results and entrants), not over the drawn pairings. Test in Task 5.
5. **An `md_` bearer on an organiser route** (e.g. `POST /stages/{id}/generate`) → 403, not a 401 fall-through to
   the session. Test in Task 1.

---

### Task 1: The code — table, mint, revoke, resolve

**Files:**
- Create: `db/migration/deltas/V492__match_day_codes.sql`
- Create: `server/usecases/match-day-codes.ts`
- Modify: `server/api-v1/auth.ts` (`AuthCtx.via` :19-34; `rejectDeviceLink` :201)
- Test: `server/usecases/__tests__/match-day-codes.test.ts`, and add to the existing auth tests

**Interfaces:**
- Produces:
  - `type MatchDayScope = {kind:"competition"} | {kind:"venue"; venueId: string} | {kind:"courts"; courtIds: string[]}`
  - `type MatchDayCodeRow = {id, orgId, competitionId, scope: MatchDayScope, canApprove: boolean, day: string /*YYYY-MM-DD*/, tz, opensAt: Date, expiresAt: Date, issuedBy: string, revokedAt: Date|null}`
  - `mintMatchDayCode(auth: AuthCtx, competitionId: string, input: {scope: MatchDayScope; day?: string; canApprove: boolean}): Promise<{row: MatchDayCodeRow; url: string}>`. It requires `requireSessionEditor`.
  - `listMatchDayCodes(auth, competitionId): Promise<Array<MatchDayCodeRow & {url: string}>>`. It covers live and not-yet-open codes, from `tok_enc`.
  - `revokeMatchDayCode(auth, codeId): Promise<void>`. It is idempotent.
  - `resolveMatchDayCode(token: string, now: Date): Promise<{ok:true; code: MatchDayCodeRow} | {ok:false; refusal:"MD_UNKNOWN"|"MD_WITHDRAWN"|"MD_ENDED"|"MD_NOT_OPEN"; opensAt?: Date}>`
  - `matchDayActor(code: MatchDayCodeRow): AuthCtx` with `via: "match_day_code"`, `orgId`, `userId: issuedBy`.
  - `logMatchDayUse(codeId, use: {kind:"open"; fixtureId} | {kind:"approve"; stageId; approval:"swiss"|"draw"}): Promise<void>`

- [ ] **Step 1: Write V492.**
  - Table `match_day_codes`:
    - `id uuid pk default gen_random_uuid()`
    - `org_id`, `competition_id` (FKs)
    - `scope_kind text check in (...)`
    - `venue_id uuid null`, `court_ids uuid[] null`
    - `can_approve boolean not null`
    - `day date`, `tz text`, `opens_at timestamptz`, `expires_at timestamptz`
    - `tok_hash text unique not null`, `tok_enc bytea not null`
    - `issued_by uuid not null references users`
    - `revoked_at timestamptz null`, `created_at timestamptz default now()`
    - a check that `venue_id` is set iff `scope_kind='venue'` and `court_ids` is non-empty iff `scope_kind='courts'`
  - Table `match_day_code_uses (id, code_id fk, kind text check in ('open','approve'), fixture_id null, stage_id null, approval text null, at timestamptz default now())`.
  - RLS on both: ENABLE + FORCE, no policy, no grant, exactly as V430:43-63.
- [ ] **Step 2: Write the failing tests.** Run them with
  `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/seazn_smoke DATABASE_SSL=disable DB_SCHEMA=<schema> npx vitest run src/server/usecases/__tests__/match-day-codes.test.ts`
  from `apps/web`, after `npm run db:apply` and `npm run sync:sports`. Seed with `_match-day-seed.ts`. Tests:
  - `mint returns a /day/md_ URL and stores only the hash`: the url matches `^https://[^/]+/day/md_[A-Za-z0-9_-]{43}$`, and `tok_hash` = sha256(token).
  - `mint defaults day to the competition's today and bounds it in that zone`: for tz `Europe/London` at T0, `opensAt`/`expiresAt` are 00:00/24:00 London.
  - `resolve before opens_at is MD_NOT_OPEN with opensAt` (Review Focus 1)
  - `resolve after expires_at is MD_ENDED`, `resolve after revoke is MD_WITHDRAWN`, `resolve of a random md_ is MD_UNKNOWN`
  - `mint refuses a non-editor (403) and an api key`
  - `revoke twice is fine`
  - `list re-shows the same URL`
  - `an md_ bearer on POST /stages/{id}/generate is 403` (Review Focus 5)
- [ ] **Step 3: Run them.** Expected: they FAIL on the missing table or usecase.
- [ ] **Step 4: Implement** the usecases above. Copy the token helpers' style from `device-links.ts:16-25`, and seal
  and open with `sealSecret`/`openSecret` (:146,:154). The reads use the non-tenant client, as for
  `capture_stream_codes`.
- [ ] **Step 5: Run them.** Expected: PASS, with 0 skipped.
- [ ] **Step 6: Commit** `feat(match-day): Match Day code — table, mint, revoke, resolve`.

### Task 2: Desk — mint, list, withdraw; `/day/{token}` landing page

**Files:**
- Create: `app/api/v1/competitions/[id]/match-day-codes/route.ts` (GET list, POST mint)
- Create: `app/api/v1/match-day-codes/[id]/revoke/route.ts` (POST)
- Create: `components/v2/match-day/match-day-code-sheet.tsx`, opened from a header button in `match-day-shell.tsx`
  (:245-325), editors only
- Create: `app/day/[token]/page.tsx`: a static page that says to scan this code with the Seazn Club app. It never
  resolves the token.
- Modify: `server/api-v1/openapi.ts`, `server/api-v1/key-scopes.ts`, `server/api-v1/schemas.ts`,
  `dictionaries/{en,es,fr,nl}/ui.json`
- Test: a route test beside the existing ones, plus `openapi-coverage.test.ts` and `key-scopes.test.ts` must pass

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `POST /api/v1/competitions/{id}/match-day-codes` with body `{scope, day?, can_approve}` returns 201 `{id, url, scope, day, opens_at, expires_at, can_approve}`.
  - `GET` on the same path returns the list.
  - `POST /api/v1/match-day-codes/{id}/revoke` returns 204.

- [ ] **Step 1: Write the failing tests.**
  - `POST mint 201 for an editor, 403 for a viewer`
  - `GET list shows the minted code with its url`
  - `revoke 204, then resolve is MD_WITHDRAWN`
  - `/day/md_x renders the app prompt and never the token`: the HTML does not contain `md_x`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the routes**, then the sheet:
  - **Scope picker:** whole competition; one venue (from `venues_today`); some courts (checkboxes).
  - **Fields:** a date (default today), and "Can approve draws" (off by default).
  - **After minting:** `SeaznQrImage sensitive` of the url, then the list of live codes with **Withdraw**.
  - **Copy keys:** `matchDay.code.title` "Match Day code", `.scope.competition`, `.scope.venue`, `.scope.courts`,
    `.approve` "Can approve draws", `.withdraw` "Withdraw", `.opens` "Opens {date}".
- [ ] **Step 4: Run** the tests plus `openapi-coverage.test.ts` and `key-scopes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(match-day): mint and withdraw Match Day codes on the desk`.

### Task 3: The day read for a code

**Files:**
- Create: `server/usecases/match-day-code-view.ts`
- Create: `app/api/v1/match-day-code/route.ts` (GET, `Authorization: Bearer md_…`)
- Create: `docs/contracts/capture-matchday-day.v1.json` and `docs/contracts/fixtures/capture-matchday-day/`
  (`competition.json`, `courts.json`, `approvals.json`)
- Modify: `openapi.ts`, `key-scopes.ts` (`NEVER_KEY_ROUTES`), `capture-schemas.ts`, `capture-contract.test.ts`
- Test: `server/usecases/__tests__/match-day-code-view.test.ts`

**Interfaces:**
- Consumes: `resolveMatchDayCode`, `matchDayActor`, and the internals of `getMatchDay` (match-day.ts:720) and
  `readBoard` (:368). Export what is needed. Do not copy SQL.
- Produces: `getMatchDayForCode(code: MatchDayCodeRow, now: Date): Promise<MatchDayCodeView>`, answered as JSON:

```ts
type MatchDayCodeView = {
  competition: { id: string; name: string };
  scope: { kind: "competition" | "venue" | "courts"; label: string }; // venue name, or "Court 2, Court 3"
  day: string; tz: string; opens_at: string; expires_at: string;
  can_approve: boolean;
  courts: Array<{
    court_id: string; court_name: string; venue_name: string;
    state: "playing" | "called" | "free" | "in_use_elsewhere";
    now: Row | null; next: Row[]; finished: Row[];      // next: queue order; finished: today's, newest first
  }>;
  no_court: Row[];                                      // [] unless scope.kind === "competition"
  online: Row[];                                        // [] until the web's all-in-one read model lands
  approvals: Approval[];                                // listed even when can_approve is false (banner without a button)
};
type Row = { fixture_id: string; sport_key: string; division_name: string; round_label: string | null;
  home: string; away: string; status: "upcoming" | "in_play" | "finished";
  scheduled_at: string | null; summary: string | null };          // summary = the desk's short score, or the result
type Approval = { kind: "swiss" | "draw"; stage_id: string; division_name: string; label: string };
```

- [ ] **Step 1: Write the failing tests.** Build a competition with two venues, three courts, a no-court upcoming
  match, finished matches and a group stage whose draw is pending. Tests:
  - `competition scope lists every court, today's finished matches per court and no_court`
  - `venue scope lists only that venue's courts and an empty no_court`
  - `courts scope lists exactly its courts`
  - `approvals lists needs_draw stages and Swiss stages with an unseated next round`. The Swiss check mirrors
    `swissHasUnseated` (components/v2/desk/stage-rail.tsx:221) server-side.
  - `approvals is listed with can_approve false too`
  - `GET with a withdrawn code is 410 MD_WITHDRAWN; with no bearer 401`
  - `the answer never contains the token or any /score/ link`
  - `the answer validates against capture-matchday-day.v1.json`, in `capture-contract.test.ts`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `now`/`next` come from `MatchDayCourt.current`/`queue`.
  - `finished` and the upcoming no-court matches are not in `MatchDayView`, so add a read of today's fixtures per
    court in `readBoard`'s style (`Board.noCourt` has the no-court ones).
- [ ] **Step 4: Run them.** Expected: PASS, with 0 skipped.
- [ ] **Step 5: Commit** `feat(match-day): the day read for a Match Day code`.

### Task 4: Open a match through the code

**Files:**
- Modify: `server/usecases/device-links.ts`. Extract the core of `provideDeviceLinkForPhone` (:326) into
  `provideSealedLink(tx, fixtureId, issuer: string)`. Both callers use it. It never revokes.
- Create: `app/api/v1/match-day-code/fixtures/[id]/scoring-link/route.ts` (POST)
- Create: `docs/contracts/capture-matchday-open.v1.json` plus fixtures
- Modify: `openapi.ts`, `key-scopes.ts`, `capture-schemas.ts`
- Test: `server/usecases/__tests__/match-day-code-open.test.ts`; `capture-scoring-link.test.ts` must still pass

**Interfaces:**
- Consumes: Tasks 1 and 3 (`inScope(code, fixture)`, exported from `match-day-code-view.ts`).
- Produces: `openMatchForCode(code, fixtureId, now): Promise<{kind:"link"; url: string; sport_key: string} | {kind:"finished"} | {kind:"refused"; code:"MD_OUT_OF_SCOPE"}>`. The route answers 200 with the same union.

- [ ] **Step 1: Write the failing tests.**
  - `opens an in-scope match and returns its sealed /score/dl_ link`
  - `a second open returns the same link and revokes nothing`: the printed QR's link is still live.
  - `a match moved off a courts code's courts is MD_OUT_OF_SCOPE` (Review Focus 2)
  - `a no-court match is MD_OUT_OF_SCOPE for a venue code`
  - `a finalized match is {kind:"finished"}` (Review Focus 3)
  - `another day's match is MD_OUT_OF_SCOPE`
  - `each open writes one match_day_code_uses row`
  - `the answer validates against capture-matchday-open.v1.json`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with the code's `issued_by` as the issuer, under the same fixture lock as
  `provideDeviceLinkForPhone`.
- [ ] **Step 4: Run** these tests plus `capture-scoring-link.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(match-day): open a match's scoring link with a Match Day code`.

### Task 5: Swiss next-round preview and stale-checked pairing

**Files:**
- Modify: `server/usecases/stages.ts`. Add the two functions below next to `generateStageFixtures`
  (`generateStageFixturesTx` :3481, `swissGen` :1831).
- Test: `server/usecases/__tests__/swiss-preview.test.ts`

**Interfaces:**
- Produces:
  - `previewSwissNextRound(auth: AuthCtx, stageId: string): Promise<{round: number; pairings: Array<{home: string; away: string | null /*bye*/; board: number}>; inputHash: string}>`.
    It runs `generateStageFixturesTx` inside a transaction, reads the round it created, then **rolls back**. The
    code already treats the whole press as one transaction (:2055-2059).
  - `pairSwissNextRound(auth: AuthCtx, stageId: string, inputHash: string): Promise<{round: number}>`. It recomputes
    `inputHash` under the division lock and refuses `MD_STALE` (409) if it differs, else runs the existing
    generate.
  - `swissInputHash(tx, stageId): Promise<string>`: sha256 over the stage's fixtures in id order
    (`id, status, result version`) and its active entrants. **It never hashes the drawn pairings** (Review Focus 4).

- [ ] **Step 1: Write the failing tests.**
  - `preview returns round 2 pairings and leaves no fixtures behind`: the fixture count is unchanged after the
    preview.
  - `pair with the preview's hash creates exactly the previewed round`: the same pairings when no lots are drawn.
  - `pair after a result changed is MD_STALE`
  - `pair twice: the second is MD_ALREADY`: the round is already seated.
  - `a preview that draws lots still pairs with its own hash`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS. Also run the existing Swiss suites (`grep -l swissGen src/server/**/__tests__`):
  every test in them must still pass.
- [ ] **Step 5: Commit** `feat(stages): preview the next Swiss round and pair it against a stale check`.

### Task 6: Approvals through the code

**Files:**
- Create: `app/api/v1/match-day-code/approvals/[kind]/[stageId]/route.ts` (GET review, POST approve)
- Create: `docs/contracts/capture-matchday-approval.v1.json` plus fixtures
- Modify: `openapi.ts`, `key-scopes.ts`, `capture-schemas.ts`
- Test: `server/usecases/__tests__/match-day-code-approvals.test.ts`

**Interfaces:**
- Consumes:
  - Task 5;
  - `getSeedProposal(auth, stageId)` (stages.ts:6528), `computeSeedProposal` (:6330),
    `confirmSeedProposal(auth, stageId, {proposalId})` (:6558);
  - `matchDayActor`, `logMatchDayUse`, `inScope`.
- Produces:
  - GET returns `{kind; stage_id; division_name; rows: Array<{label: string; home: string; away: string | null}>; hash: string; ties: boolean}`.
    - For `draw`: `hash` is the proposal id, and the rows come from `destinationSlot`.
    - For `swiss`: `hash` is `inputHash`.
  - POST takes `{hash}` and answers 200 `{ok: true}`, or a refusal (`MD_NO_APPROVE` / `MD_STALE` / `MD_ALREADY` /
    `MD_TIES` / `MD_OUT_OF_SCOPE`).

- [ ] **Step 1: Write the failing tests.**
  - `GET draw uses the live draft, computing one only when none is draft`
  - `GET is allowed without can_approve; POST without it is MD_NO_APPROVE`
  - `POST draw confirms and fills the knockout's TBD slots`
  - `POST draw with ties is MD_TIES`: the phone cannot pick ties.
  - `POST draw with a stale proposal is MD_STALE`, and `a second POST is MD_ALREADY`: these map
    SEEDING_PROPOSAL_STALE and SEEDING_ALREADY_CONFIRMED.
  - `POST swiss pairs the round`
  - `a stage outside a venue code's courts is MD_OUT_OF_SCOPE`: a stage is in scope when any of its fixtures today
    is.
  - `each approve writes one use row`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(match-day): review and approve draws with a Match Day code`.

### Task 7: Ship to staging and record the reversal

- [ ] **Step 1:** Append to `docs/superpowers/specs/2026-10-31-match-day-design.md` §2: "Reversed for the Match Day
  code (capture S4 design, 2026-11-07): one code per day lists the day's matches and opens each match's own link;
  the link stays the printed QR's."
- [ ] **Step 2: Run the full touched set** (the six new test files, `capture-scoring-link`, `openapi-coverage`,
  `key-scopes`, `capture-contract`) plus `npm run typecheck` and `npm run lint`. Read the skipped count.
- [ ] **Step 3:** Open the PR. A merge to main deploys to staging (`.github/workflows/stg.yml`). Merging is the
  owner's call.
- [ ] **Step 4: Tell the division-builder session** what landed: the table, the routes and the Swiss preview.
