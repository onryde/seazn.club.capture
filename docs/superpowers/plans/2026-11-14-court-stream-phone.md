# Court stream — phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Live Stream phone paired once to a court code follows every streamed match on that court. Its Stop
ends only the current match. Exit (⋯, asks first) leaves the court. The waiting screen names the court and the next
streamed match, and the Remote scoring panel names the match its QR is for.

**Architecture:**

- **Native (Kotlin core):** reads two optional additive fields, the descriptor's `court {name}` and the beat's
  `next {label, scheduledStart}`, into `WaitingFields`, and crosses both to JS in the snapshot's `pairing`.
- **Court Stop:** a court pairing's Stop always takes the existing `stoppedHere` path, never `end()`. A court
  pairing's round line is cleared at every Arming, so the new sid's descriptor sets it.
- **The court name at the scan:** JS learns it from the scan's GET, as it learns the stage today. It saves it with
  the code and seeds native through the pair intent, so a cold-start re-pair is a court pairing before any GET.
- **JS:** stays a projection. It adds copy, the ⋯ Exit sheet, the Continue card's title, the scoring answer's
  `label`, the `no_match` word, and a court-only stale guard on the scoring panel.

**Tech Stack:** Expo Router, React Native, TypeScript strict, vitest (domain + jsdom), Kotlin core with JUnit
(`./gradlew test`), shared JSON vectors in `modules/capture-engine/src/wire/`.

**Spec:** `docs/specs/2026-11-14-court-stream-design.md` (owner rulings O1–O11; its "(my call)" items approved
with it). Read §6 and §5.3–§5.6 in full.

**Depends on:** the parallel web plan's PR (court link, Stream switch, beat resolver, contract additions). Task 1 is
gated on that PR being merged to web `main`. Tasks 2–12 do not wait for it: each tests against fixtures this plan
writes to the assumed shapes below.

**Repo:** `/Users/ashokhein/github/seazn.club.capture`. Branch `feat/court-stream` from `main` (recon at
`7033b2ee`). Re-verify every line number before editing. Android only (decision record R3).

## Global Constraints

- **Contract shapes (as the web plan `seazn.club/docs/superpowers/plans/2026-11-14-court-stream-web.md` Task 1
  defines them; Task 1 here checks them against the vendored schemas):**
  - descriptor (`capture-descriptor.v1`), court codes only: optional `court: { name: string }`, `name` 1–80 code
    points (`CAPTURE_COURT_NAME_MAX = 80`). On a fixture code it is omitted, never null;
  - beat answer (`capture-beat.v1#/$defs/answer`), on every answer branch, court codes only: optional
    `next: { label: string, scheduledStart: integer|null }`. `label` is 1–200 code points, and `scheduledStart`
    is epoch seconds or null (the vendored schema: an integer of at least 1, both keys required, no other key).
    Checked against web `c0577abb78` in Task 1: every other shape in this list matches the vendored schemas. `next` is omitted, never null, when the court has no next streamed match;
  - scoring-link `ok` (`capture-scoring-link.v1#/$defs/ok`): `{url, label?}`, with `label` 1–200 code points.
    The schema makes it optional; this server always sends it;
  - `no_match` is a new shared refusal word, used on court codes only. Scoring-link answers it with a 409 when
    no match is queued on the court. `POST start` answers it with a 409 when the court has no streamed match in
    play. The phone keys on the `code` for any 4xx: on scoring-link it is checked before the 401/404 branch, and
    on start `Refusal.of` reads it;
  - QR v2 court codes carry `exp` = the end of the competition-local day. It is the existing optional `exp`, so
    `streamCode.ts` and `recognise.ts` need no change;
  - per-fixture codes never send `court` or `next`.
- **Court-ness:** a pairing is a court pairing exactly when `WaitingFields.courtName != null` (Kotlin), and
  `snapshot.pairing.court !== null` (TS). Before a pairing, a saved code is a court code when
  `saved.stream.waiting.court !== null`. Nothing else decides it.
- **A malformed `court` is never read as "no court", in any of the three places it is read.** A fixture-style
  Stop on a court phone would unlink the court (spec §3, anti-goal). So `court` absent or null means no court,
  and anything else that is not `{name}` of 1–80 code points is refused in each place:
  - the descriptor (TS at the scan, Kotlin at Arming): the waiting fields are unreadable;
  - the pair intent (`PairMapping`): `PairRequest.problems()` names it and the pair is refused;
  - the snapshot (TS `snapshotWire.ts`): the snapshot is read as malformed, by that parser's existing rule for a
    bad pairing field.

  A malformed `next`, or a malformed scoring `label`, is display-only and reads as absent.

- **Shared vectors move with both readers in one task.** `wire/waiting-vectors.json`,
  `wire/pair-intent-vectors.json`, `wire/snapshot-vectors.json` and `wire/scoring-link-vectors.json` are read by
  Kotlin and TS. Whichever task edits one changes both readers in the same commit.
- **Rows that need the new schemas.** Tasks 2–12 run before Task 1 vendors the schemas. Some tests hold vector
  rows to the vendored schema with strict ajv: `scoringLinkBodies.test.ts:8-27`, and `serverBodies.test.ts`
  through `server-bodies.json`. Every new row those tests sweep that the old schema refuses gets
  `"contractValid": false` and `"until": "Task 1"`. Task 1 flips each one to `true`, or deletes the flag, once the
  vendored schema admits it. Rows the new schema also refuses keep `false` and drop `until`. Each task states the
  file counts its tests pin, before and after.
- **Contracts are vendored only by `pnpm contracts:vendor <web checkout>`** followed by the hand-edited pin in
  `test/contractPins.test.ts` (AGENTS §4, R7). Never edit `contracts/*` by hand.
- **AGENTS.md applies in full**, notably:
  - §2: no second state machine in TS. Every court rule that decides a transition is Kotlin's. JS selects and
    words;
  - §3: `domain/` stays pure, and screens reach native only through `Ports`;
  - §5: tokens only, never a colour literal;
  - §6: one message line, cut with an ellipsis, with every status key given a tier;
  - §10: no snapshot tests, the four questions, and no expectation computed by the code under test.
- **Copy (en / es / fr / nl, exactly):**
  - `stream.status.courtNextAt`: "Next: {label} · {time}" / "Siguiente: {label} · {time}" / "Suivant : {label} · {time}" / "Volgende: {label} · {time}"
  - `stream.status.courtNext`: "Next: {label}" / "Siguiente: {label}" / "Suivant : {label}" / "Volgende: {label}"
  - `stream.status.courtNone`: "No streamed match yet" / "Aún no hay partido para emitir" / "Aucun match diffusé pour l'instant" / "Nog geen wedstrijd om uit te zenden"
  - `stream.status.courtAutomaticOff`: "Automatic off" / "Automático desactivado" / "Automatique désactivé" / "Automatisch uit"
  - `stream.action.stopMatchLabel`: "Hold to stop this match" / "Mantén pulsado para detener este partido" / "Maintenez appuyé pour arrêter ce match" / "Houd ingedrukt om deze wedstrijd te stoppen"
  - `stream.court.more`: "More" / "Más" / "Plus" / "Meer"
  - `stream.court.leaveTitle`: "Leave {court}?" / "¿Salir de {court}?" / "Quitter {court} ?" / "{court} verlaten?"
  - `stream.court.leaveBody`: "Streamed matches on this court won't go live." / "Los partidos de esta pista no se emitirán." / "Les matchs de ce terrain ne passeront pas en direct." / "Wedstrijden op deze baan gaan niet live."
  - `stream.court.leave`: "Leave" / "Salir" / "Quitter" / "Verlaten"
  - `stream.court.stay`: "Stay" / "Quedarme" / "Rester" / "Blijven"
  - `home.continue.court`: "{court} · {mode}" (all four languages)
  - `stream.scoring.titleMatch`: "Score {label}" / "Anota {label}" / "Score : {label}" / "Scoor {label}"
  - `stream.scoring.refused.noMatch`: "No match called to this court yet" / "Aún no hay partido llamado a esta pista" / "Aucun match appelé sur ce terrain" / "Nog geen wedstrijd naar deze baan geroepen"
  - `stream.status.refusedNoMatch` (the start's refusal): "No streamed match in play on this court" / "Ningún partido emitido en juego en esta pista" / "Aucun match diffusé en cours sur ce terrain" / "Geen uitgezonden wedstrijd bezig op deze baan"
  - es/fr/nl ship in the house voice; never flag them as unreviewed.
- **Verification:**
  - TS, locally: a scoped type-check through a temporary `tsconfig.changed.json` that extends `./tsconfig.json` with
    `{"compilerOptions":{"noEmit":true,"incremental":false},"include":[],"files":[<changed .ts/.tsx>]}`. Run
    `npx tsc -p tsconfig.changed.json`, then `rm tsconfig.changed.json`; never commit it.
  - TS tests: only this task's test files, by path. When a count matters, use
    `pnpm vitest run <paths> --reporter=json --outputFile=$TMPDIR/r.json > $TMPDIR/v.txt 2>&1; echo "EXIT=$?"`
    and read `numTotalTests` / `numFailedTests`.
  - Kotlin: `cd /Users/ashokhein/github/seazn.club.capture/modules/capture-engine/android/core && ./gradlew test --tests '<fqcn>' --console=plain > $TMPDIR/core.txt 2>&1; echo "EXIT=$?"`.
  - Lint, Prettier and the full suites run on CI: push the branch and read CI's counts at the end of each task.
- **No builds or prebuilds** except in Task 13, where the controller runs them.

## Review Focus

1. **Organiser withdraws the court link mid-match, then the volunteer holds Stop** (a 401 heard while held,
   `codeEndedPending`). The pairing must end as today, not go back to waiting on a dead code. Pinned in Task 5,
   `CourtTest.stop on a court code after a held 401 ends the pairing`.
2. **Process death on a court phone, then the cold-start re-pair**, before any descriptor GET. Stop must still be
   the court Stop. This needs the saved court to reach native in the `resume` pair. Pinned in Task 3,
   `pairIntentFor carries the saved court on a resume`, and Task 5, `a pair seeded with a court is a court pairing
before any GET`.
3. **The scorer taps, and the match behind the court moves before the answer lands** (handover, or the next called
   match changes). The panel must never show the old match's QR. Pinned in Task 11,
   `drops an answer that lands after the court's match moved`.
4. **A remote Go live arrives while the Leave sheet is open.** The sheet closes and nothing unpairs a phone that is
   arming. Pinned in Task 8, `closes the Leave sheet when the engine arms, and never unpairs`.
5. **A court phone between matches, after a match ended normally.** It shows the Next line, not
   "Match finished — stream stopped" all afternoon. A failure ending (no signal, refused, phone lost) still wins.
   Pinned in Task 7, `a calm last end gives way to the Next line on a court code; a failure end does not`.

---

### Task 1: Vendor the web's court contracts (GATED on the web PR merged to web `main`)

Do not start until the web plan's PR is merged. Until then, skip it and run Tasks 2–12. Run it before Task 13.

**Files:**

- Modify (by the script only): `contracts/capture-descriptor.v1.json`, `contracts/capture-beat.v1.json`,
  `contracts/capture-scoring-link.v1.json`, `contracts/capture-qr.v2.json`, `contracts/fixtures/**`,
  `contracts/VENDORED.json`
- Modify: `test/contractPins.test.ts` (by hand: the web commit, the schema sha256s, the file count)
- Modify: `modules/capture-engine/src/wire/server-bodies.json` (new ajv-checked bodies)
- Test: `test/contractPins.test.ts`, `modules/capture-engine/src/serverBodies.test.ts`

**Interfaces:**

- Produces: confirmed values for the Global Constraints' assumed shapes. If any differs, edit that Global
  Constraints line and the constant named in Tasks 2, 4 or 10 in this task's commit.

- [ ] **Step 1: Vendor.** Run `pnpm contracts:vendor <path to an up-to-date web checkout on main>`. Then
      `git diff --stat contracts/` should list only `capture-*` files and fixtures.
- [ ] **Step 2: Read the three schemas' new fields** (`court`, `next`, the scoring `ok.label`, the `no_match` code)
      and compare them with the Global Constraints: the bounds, `scheduledStart`'s type, and `no_match`'s status. Write
      any difference into the Global Constraints of this plan file.
- [ ] **Step 3: Add server bodies** to `server-bodies.json`, one per shape:
  - `court/code-waiting`: a descriptor with `court: {name: "Court 2"}`;
  - `court/beat-waiting-next`: a beat `waiting` with `next: {label: "Example Town v Sample CC", scheduledStart: 1793534400}`;
  - `court/beat-live-next`: a beat `live` with `next`;
  - `court/scoring-ok-label`: a scoring `ok` with `label`;
  - `court/scoring-no-match`: a scoring refusal `{code: "no_match", message: "…"}`;
  - `court/start-no-match`: a start refusal `{code: "no_match", message: "…"}` (`capture-start.v1`).

  Also flip every `"until": "Task 1"` row (Global Constraints, rows that need the new schemas). In
  `scoring-link-vectors.json` that is the 200-with-label row and the two `no_match` rows; the 201-character and
  `label: 3` rows stay `contractValid: false`. Grep `"until"` afterwards: zero hits. `serverBodies.test.ts`'s
  sweep goes from 8 bodies to 14.

  Also confirm in the vendored `capture-qr.v2.json` that a court code's `exp` is the existing optional key. The
  phone's `streamCode.test.ts` row for a QR with `exp` covers it, and nothing changes.

- [ ] **Step 4: Update the pin by hand** in `test/contractPins.test.ts` (commit, shas, count). Then run
      `pnpm vitest run test/contractPins.test.ts test/vendorContracts.test.ts modules/capture-engine/src/serverBodies.test.ts`.
      Expected: PASS, with the new bodies counted.
- [ ] **Step 5: Run Kotlin's `ServerBodiesTest`** (`com.seazn.capture.engine.adapter.ServerBodiesTest`). Expected: PASS.
- [ ] **Step 6: Commit** `chore(contracts): pin to web main <sha> (court stream)`.

### Task 2: Read `court` and `next` in the waiting fields (both readers)

**Files:**

- Modify: `src/domain/credentials/waitingFields.ts` (type `WaitingFields`, `parseWaitingFields`, `waitingToWire`)
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Pairing.kt` (`WaitingFields`, new `NextMatch`)
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/adapter/Bodies.kt:145-160` (`read`)
- Modify: `modules/capture-engine/src/wire/waiting-vectors.json`
- Test: `src/domain/credentials/waitingFields.test.ts`, `modules/capture-engine/src/waitingVectors.test.ts`,
  `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/adapter/BodiesTest.kt`

**Interfaces:**

- Produces (TS): `WaitingFields.court: string | null`. `waitingToWire` writes `court: {name}` when non-null, so a
  saved code reads back through the one parser. TS does not read `next`: the scan's GET never carries it.
- Produces (Kotlin):
  - `data class NextMatch(val label: String, val scheduledStartEpochS: Long?)`;
  - `WaitingFields.courtName: String? = null` and `WaitingFields.next: NextMatch? = null`, both last in the
    constructor, after `stageFor`;
  - `Bodies.read` fills both: `court` is strict and `next` is display-only.

- [ ] **Step 1: Write the failing tests.** Add rows to `waiting-vectors.json` that both readers judge:
  - `court` `{name: "Court 2"}` → court "Court 2";
  - no `court` → null;
  - `court: null` → null;
  - `court: {name: ""}` → unreadable;
  - `court: {name: 81 × "x"}` → unreadable;
  - `court: "Court 2"` (not an object) → unreadable;
  - `court: {name: "🏸".repeat(80)}` → read: 80 code points.

  In `BodiesTest.kt`, for a beat body:
  - `next {label, scheduledStart: 1793534400}` → `NextMatch("…", 1793534400)`;
  - `next {label, scheduledStart: null}` → start null;
  - `next {label: ""}` → `next` null and the beat still readable;
  - `next: 5` → `next` null and the beat still readable;
  - no `next` → null.

  In `waitingFields.test.ts`: `waitingToWire(parseWaitingFields(body))` reads back with `court` equal to
  "Court 2".

  `waitingVectors.test.ts` pins the file's counts. Change them from 43 rows, 41 swept and 18 unreadable to
  50 rows, 48 swept and 21 unreadable: seven new shared rows, three of them unreadable. The waiting vectors are not
  ajv-checked, so no row needs `contractValid`.

  **Four questions:**
  1. A second call: parsing the same body twice gives equal results, and a save then a re-read round-trips.
  2. An empty input: `court` absent, null, an empty name or the wrong type; `next` absent or garbage.
  3. After an interruption: a saved code from before this build, with no `court`, reads as a fixture code.
  4. Another mode or language: none; these are wire shapes.

- [ ] **Step 2: Run them.** `pnpm vitest run src/domain/credentials/waitingFields.test.ts modules/capture-engine/src/waitingVectors.test.ts`
      and Kotlin `com.seazn.capture.engine.adapter.BodiesTest`. Expected: FAIL (unknown property `court` / `next`).
- [ ] **Step 3: Implement.**
  - TS: `readCourt(value: unknown): string | null | typeof BAD`. Absent or null → null. An object whose `name` is
    1–80 code points → the name. Anything else → `BAD`, which makes the whole answer null.
  - Kotlin `read`: `court` with the same rule, through `optional`, refused as `unreadable("court")`.
    `next` through a private `nextMatch(value: Any?): NextMatch?` that returns null on any defect.
- [ ] **Step 4: Run Step 2's commands.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): read court and next in the waiting fields`.

### Task 3: The pair intent carries the court

**Files:**

- Modify: `modules/capture-engine/src/CaptureEnginePort.ts` (`PairIntent`), `modules/capture-engine/src/intentWire.ts`
- Modify: `src/hooks/usePairing.ts:27-43` (`pairIntentFor`)
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Pairing.kt` (`PairRequest`)
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/adapter/PairMapping.kt`
- Modify: `modules/capture-engine/android/core/src/main/kotlin/com/seazn/capture/engine/core/Pairings.kt:35` (the seed)
- Modify: `modules/capture-engine/src/wire/pair-intent-vectors.json`
- Test: `modules/capture-engine/src/intentWire.test.ts`, `src/hooks/usePairing.test.tsx`,
  `.../adapter/PairIntentVectorsTest.kt`, `.../adapter/PairMappingTest.kt`

**Interfaces:**

- Consumes: `WaitingFields.court` (Task 2, TS) and `WaitingFields.courtName` (Task 2, Kotlin).
- Produces:
  - `PairIntent.court?: string`;
  - `PairRequest.court: String? = null`. `PairMapping` reads it as given: absent or null is null, and any other
    value is kept as text, with a non-string as `""`. `PairRequest.problems()` adds
    `"court is not 1 to 80 characters"` when it is non-null and outside 1–80, so a malformed court refuses the
    pair (Global Constraints, I8);
  - the pairing's first `WaitingFields` is seeded with `courtName = request.court`.

- [ ] **Step 1: Write the failing tests.**
  - `pairIntentFor carries the saved court on a resume`: a saved code whose waiting has `court: "Court 2"`, claim
    `resume` → `intent.court === "Court 2"`.
  - A code with no court → `'court' in intent` is false.
  - `intentWire` copies `court` only when defined.
  - `pair-intent-vectors.json` rows: with `court` → `PairRequest.court == "Court 2"` and no problems; an
    81-character court → refused with the court problem; `court: 7` → refused with the court problem. The file's
    `intents` go from 2 to 5, and `PairIntentVectorsTest` pins 5.

  **Four questions:**
  1. A second call: a second scan of the same court code pairs nothing new (`scanStep`, unchanged), proved
     by `usePairing.test.tsx`'s existing same-code row with a court added.
  2. An empty input: no court, a malformed court, and a saved code from before this build.
  3. After an interruption: the `resume` pair after process death carries the court. That is Review Focus 2.
  4. Another mode or language: the pair's `language` is unchanged by a court.
  - In `PairMappingTest`: a pair with `court` seeds the first snapshot's `pairing.court`.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the four additions above, mirroring `venueTimezone`'s seed at `Pairings.kt:35`.
- [ ] **Step 4: Run them.** Expected: PASS. Also run `src/domain/mode/savedCode.test.ts`: a saved code with a court
      survives the store's round trip.
- [ ] **Step 5: Commit** `feat(engine): pair intent seeds the court`.

### Task 4: `court` and `next` in the snapshot (both readers) and the merge rules

**Files:**

- Modify: `.../core/Pairing.kt` (`WaitingFields.over`, `WaitingFields.overBeat`)
- Modify: `.../adapter/SnapshotWire.kt:43-57` (`pairing`)
- Modify: `src/domain/session/Pairing.ts` (`PairingInfo`, new `NextMatch`)
- Modify: `modules/capture-engine/src/snapshotWire.ts`, `modules/capture-engine/src/FakeCaptureEngine.ts` (`FAKE_PAIRING`),
  `modules/capture-engine/src/absentCaptureEngine.ts`
- Modify: `modules/capture-engine/src/wire/snapshot-vectors.json`
- Test: `.../core/PairingValuesTest.kt`, `.../adapter/SnapshotWireTest.kt`, `modules/capture-engine/src/snapshotWire.test.ts`

**Interfaces:**

- Consumes: Task 2's `WaitingFields.courtName`, `WaitingFields.next` and `NextMatch`.
- Produces:
  - snapshot `pairing.court: string|null` and `pairing.next: {label: string, scheduledStart: number|null}|null`
    (epoch seconds), on the wire;
  - TS `type NextMatch = { readonly label: string; readonly scheduledStart: Date | null }`;
  - `PairingInfo.court: string | null` and `PairingInfo.next: NextMatch | null`.
- Merge rules (Kotlin):
  - `over(held)`, the descriptor merge: `courtName = courtName ?: held.courtName`, and `next = held.next`, since a
    descriptor never carries `next`;
  - `overBeat(held)`: `over(held)`, then `next = this.next`. A beat with no `next` clears it. `courtName` stays
    the held one, because beats carry no `court`.

- [ ] **Step 1: Write the failing tests.**
  - `PairingValuesTest`: a beat without `court` keeps the held court.
  - A beat with `next` sets it; the next beat without `next` clears it.
  - A descriptor with court "Court 3" over a held "Court 2" → "Court 3".
  - A descriptor with no court over a held "Court 2" → "Court 2".
  - A descriptor keeps the held `next`.
  - Snapshot vectors: a paired court snapshot with `next`, one with `next: null`, and a per-fixture one with
    `court: null, next: null`, parsed by both `SnapshotWireTest` and `snapshotWire.test.ts`.
- [ ] **Step 2: Run them.** Expected: FAIL.
  - The snapshot vectors go from 17 cases to 19 (the two court cases; the per-fixture shape is `pairingBase` with
    `court: null, next: null`). Update both the count at `snapshotWire.test.ts:256` and the `keys` count at
    `:272`, which moves by the two new pairing keys. Add a case where the pairing's `court` is `""`: the TS
    parser reads it as malformed.

  **Four questions:**
  1. A second call: two beats with the same `next` leave it unchanged, and a third without `next` clears it.
  2. An empty input: `next` absent, `court` absent, and a malformed court in the snapshot.
  3. After an interruption: a descriptor at a reconnect keeps the held `next` and court.
  4. Another mode or language: none; these are wire shapes.

- [ ] **Step 3: Implement.** The TS parser holds `court` to 1–80, as native wrote it. A `court` outside that, or
      not a string or null, makes the snapshot malformed, by the parser's existing rule (I8). `next.label` is held
      to 1–200, and a bad `next` is null. `FAKE_PAIRING` gets `court: null, next: null`; so does the absent engine's pairing.
- [ ] **Step 4: Run them**, plus `modules/capture-engine/src/FakeCaptureEngine.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): court and next cross the snapshot`.

### Task 5: Native court Stop and the round line at each Arming

**Files:**

- Modify: `.../core/SessionMachine.kt:116-122` (`stop`)
- Modify: `.../core/Phase.kt` (`PairingState`: `val isCourt: Boolean get() = waiting.courtName != null`)
- Modify: `.../core/Pairings.kt:129-136` (`Starts.arm`)
- Create: `modules/capture-engine/android/core/src/test/kotlin/com/seazn/capture/engine/core/CourtTest.kt`
- Test: `CourtTest.kt`, plus the existing `StopTest.kt` and `EndPathsTest.kt` unchanged and green

**Interfaces:**

- Consumes: `WaitingFields.courtName` (Task 2) and the seed (Task 3).
- Produces:
  - `PairingState.isCourt`;
  - `stop` on a court pairing: `pairing.codeEndedPending` → `end(...)` (unchanged), else
    `stoppedHere(phase, pairing, sid, LastEnd.STOPPED, now)`, whether or not the broadcast went live;
  - `Starts.arm` on a court pairing clears `stageLabel` and `stageFor`. The Arming descriptor sets them for the new
    sid. Per-fixture pairings are untouched.

- [ ] **Step 1: Write the failing tests** in `CourtTest.kt`, on `MachineRig`:
  - `a court Stop after the first frame goes back to Paired`: `lastEnd` is `stopped`, the pairing is the same, the
    sid is in `refused`, `Command.WriteStopped` and an at-once beat carrying `stopped: <sid>` are sent, and no
    `Command.End` or final beat;
  - `a court Stop before the first frame` behaves the same (owner decision 1, unchanged);
  - `stop on a court code after a held 401 ends the pairing`: after `codeEndedPending`, Stop → `end`, Ended;
  - `a per-fixture Stop after the first frame still ends the pairing`: the guard is mutated by removing `isCourt`,
    and this test or the first one reds;
  - `a refused sid offered again is ignored on a court`: `open-ignored`;
  - `a court handover arms the new sid with no round line until its descriptor`: held A on air, with stage
    "Quarter-final". The beat `Open(B)` carries **A's label**, so `overBeat` keeps A's stage and only the new clear
    can remove it; without the clear this test reds. → Arming(B) with `stageLabel == null`; then the descriptor for B with stage "Semi-final" →
    `stageLabel == "Semi-final"`; a B descriptor with no stage → null;
  - `a per-fixture Arming keeps the held round line until its descriptor` (unchanged behaviour, pinned);
  - `a pair seeded with a court is a court pairing before any GET`: `isCourt` is true straight after Paired, from
    the request alone.
    **Four questions:**
  1. A second call: Stop twice, where the second is `intent-ignored`; and a refused sid offered again.
  2. An empty input: a court pairing with no stage, and a descriptor with none.
  3. After an interruption: a held 401 (Review Focus 1), a handover, and a cold-start seed.
  4. Another mode or language: per-fixture codes are unchanged (the twin tests).

- [ ] **Step 2: Run them.** Kotlin `com.seazn.capture.engine.core.CourtTest`. Expected: FAIL.
- [ ] **Step 3: Implement** the three changes above. Update `stop`'s KDoc: court codes take `stoppedHere` (spec
      §6.3, O5).
- [ ] **Step 4: Run** `CourtTest`, `StopTest`, `EndPathsTest`, `ForgetTest`, `PairingTest`. Expected: PASS.
- [ ] **Step 5: Mutate each guard once:** drop `isCourt` from `stop`, drop the `codeEndedPending` check, drop the
      stage clear. Confirm a named test reds each time, then restore from a `cp` backup.
- [ ] **Step 6: Commit** `feat(engine): a court Stop ends the match, not the pairing`.

### Task 5b: The notification's Forget is hidden on a court pairing (O12)

The owner's ruling O12 (2026-11-15: "yes") hides Forget on court pairings. Exit, behind ⋯, is the only way off a
court, because the notification's Forget has no question (R7).

**Files:**

- Modify: `.../adapter/NotificationText.kt:133` (`forgetShown(kind: String?, court: Boolean): Boolean`, which is
  `tallyKey(kind) == "paired" && !court`) and its caller, which passes `snapshot.pairing?.court != null`
- Modify: `.../core/Pairings.kt` (`forget`): on `pairing.isCourt` it writes
  `intent-ignored {intent: forget, phase: paired, court: true}` and changes nothing
- Test: `.../adapter/NotificationTextTest.kt`, `.../core/ForgetTest.kt`

- [ ] **Step 1: Write the failing tests:**
  - `forgetShown("paired", court = true)` is false, and with `court = false` it is true;
  - a late Forget tap on a court pairing is ignored and recorded, and the pairing stays Paired.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): no Forget on a court's notification (O12)`.

### Task 6: Fake engine court support, the forget rule and the Stop label

**Files:**

- Modify: `modules/capture-engine/src/FakeCaptureEngine.ts`: `pair` takes `intent.court`; `stop` on a court
  pairing → `paired` with `lastEnd: 'stopped'` (unless `codeEndedPending`); a new scene `court-waiting`
  (`FakeScene`)
- Modify: `src/hooks/engineSelectors.ts` (`selectCourt`, `selectNextLabel`, `selectNextStartMs`)
- Modify: `src/hooks/useViewfinder.ts` (`Viewfinder.court`, `stopUnpairs`)
- Modify: `src/ui/components/StreamColumn.tsx:221-243` (`ColumnAction` a11y label)
- Modify: `src/i18n/{en,es,fr,nl}.json` (`stream.action.stopMatchLabel`)
- Test: `modules/capture-engine/src/FakeCaptureEngine.test.ts`, `src/hooks/useEngineFollow.test.tsx` (or the
  file that tests it), `src/ui/screens/StreamScreen.onAir.test.tsx`

**Interfaces:**

- Consumes: `PairingInfo.court` and `PairingInfo.next` (Task 4), and `PairIntent.court` (Task 3).
- Produces:
  - `selectCourt(s): string | null`, `selectNextLabel(s): string | null` and `selectNextStartMs(s): number | null`;
  - `Viewfinder.court: string | null`;
  - `Viewfinder.stopUnpairs = LIVE.has(kind) && court === null`;
  - the scene `court-waiting`: paired, with `court: "Court 2"` and
    `next: {label: "Example Town v Sample CC", scheduledStart: <fixed Date>}`.

- [ ] **Step 1: Write the failing tests.**
  - Fake: a court pair then a live Stop → `state.kind === 'paired'` and `lastEnd === 'stopped'`. The same on a
    fixture pair → `ended`.
  - Follow: on the fake, a court pair → live → Stop leaves `modeStore`'s stream code in place (the forget rule
    does not fire). The fixture twin forgets it.
  - Screen: on air on a court code, the Stop hold's accessible name is "Hold to stop this match"; on a fixture
    code it stays "Hold to stop and unpair". Both strings come from `en.json`.
- [ ] **Step 2: Run them.** Expected: FAIL.
      **Four questions:**
  1. A second call: Stop twice on the fake; the follow running twice forgets nothing.
  2. An empty input: a court pairing with no `next`.
  3. After an interruption: Stop while `codeEndedPending` on the fake → Ended, and the follow forgets.
  4. Another mode or language: the label in es, fr and nl through `dictionaries.test.ts`.

- [ ] **Step 3: Implement** the fake, the selectors, `court` on the viewfinder, and the label switch:
      `stopMatchLabel` when `court !== null`, otherwise today's rule.
- [ ] **Step 4: Run them**, plus `src/i18n/dictionaries.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(stream): court Stop keeps the code; fake engine court codes`.

### Task 7: The waiting screen on a court code

**Files:**

- Modify: `src/domain/session/stageLine.ts` (add `roundLine`)
- Modify: `src/hooks/engineSelectors.ts` (`selectRoundLine` replaces `selectStageLine`'s use in the strip)
- Modify: `src/ui/components/StatusStrip.tsx` (reads `selectRoundLine`; hides `MatchLabel` on a court code while
  paired)
- Create: `src/domain/session/nextLine.ts` (`NEXT_LABEL_ROOM`, `cutNextLabel`)
- Modify: `src/i18n/budgets.test.ts` (fills `{label}` and `{time}`)
- Modify: `src/hooks/statusKey.ts` (`pairedKey`, `LINE_TIER`)
- Modify: `src/hooks/useViewfinder.ts` (`nextLabel`, `nextAt`), `src/ui/screens/StreamScreen.tsx:113-123` (`useColumnLine` vars `label`, `time`)
- Modify: `src/i18n/{en,es,fr,nl}.json`: the four `stream.status.court*` keys
- Test: `src/domain/session/stageLine.test.ts`, `src/domain/session/nextLine.test.ts`, `src/i18n/budgets.test.ts`,
  `src/hooks/statusKey.test.ts` (or the file testing `selectStatusKey`),
  `src/hooks/statusTier.test.ts`, `src/ui/theme/stripTextFit.test.ts`, `src/ui/components/StatusStrip.stage.test.tsx`,
  `src/ui/screens/StreamScreen.paired.test.tsx`

**Interfaces:**

- Consumes: Task 6's selectors and `Viewfinder.court`.
- Produces:
  - `roundLine(court: string | null, stage: string | null): string | null`. It returns `court` alone,
    `` `${court} · ${stage}` `` when both are present, or `stageLine(stage)` when there is no court. One line, cut
    by `StageLine`'s ellipsis;
  - `Viewfinder.nextLabel: string | null`;
  - `Viewfinder.nextAt: string | null`, formatted by `useFormatTime` in the venue's zone;
  - `NEXT_LABEL_ROOM` and `cutNextLabel(label: string): string` in `src/domain/session/nextLine.ts`: a label
    wider than the room, as it draws in the status font, is cut to what fits beside "…". `useColumnLine` passes
    `label: cutNextLabel(nextLabel)`. The whole line is then one line at the owner's phone's 386 dp in every
    language, so the time is never the part an ellipsis eats (I4). The panel title (Task 10) uses the same cut.
    Revised 2026-11-16 (P3 review m2, RP8): the cut is by measured width, not by 24 characters, since 24 capitals
    draw half as wide again as 24 lower-case letters;
  - **The match label is not shown twice (I4).** On a court code while `kind === 'paired'`, `StatusStrip` does not
    render `MatchLabel`, and calls `onLabelHeight(0)`; the Next line names the match. On air the label row is back,
    as today. Consequence, accepted: the picture is sized again once at each go-live, when the label row appears,
    since the label's height is the picture's one input (AGENTS §6). It never moves within a match.
- `pairedKey` on a court code, in order:
  1. refusal;
  2. a failure `lastEnd`: anything but `stopped-automatically`, `stopped-by-organiser` and `stopped`;
  3. a null destination → `waitingDestination`;
  4. `pairing.automatic === false` → `courtAutomaticOff`;
  5. `next` with a start → `courtNextAt`;
  6. `next` without a start → `courtNext`;
  7. no `next` → `courtNone`.
     Per-fixture codes keep today's order exactly. All four new keys are `routine` in `LINE_TIER`, like
     `waitingGoLive`.
- **On air on a court code** (web plan, owner shown in brainstorming): `stateKey`'s `publishing` row picks
  `courtNextAt` when beat `next` has a start, `courtNext` when it has none, and `stream.status.live` when there is
  no `next`. Degraded, reconnecting and every other state keep their own lines, so an urgent line always wins. The
  key stays `routine`, so an advisory caption beats it as it beats `live`. `CALM_ON_AIR` gains the two keys, so
  Back's "hold Stop" still stands in for them (ruling I2). Per-fixture codes never send `next`, so their line is
  unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `roundLine`: `("Court 2", null)` → "Court 2"; `("Court 2", "Semi-final")` → "Court 2 · Semi-final";
    `(null, "Final")` → "Final"; `(null, null)` → null.
  - `selectStatusKey`: one test per row of the court order, with the expectations written from the list above.
  - `a calm last end gives way to the Next line on a court code; a failure end does not`: `stopped-automatically`
    → `courtNextAt`, and `no-signal` → `stoppedNoSignal`.
  - A fixture code with `lastEnd: 'stopped-automatically'` still says `stoppedMatch`.
  - `the live court line names the next match`: `publishing` on a court code with
    `next {label: "C v D", scheduledStart}` → `courtNextAt`. With `next` absent → `stream.status.live`. While
    `degraded` with `next` → the degraded key. With the `notCharging` advisory up, the strip shows the caption
    and not "Next: …".
  - `statusTier.test.ts` lists the four keys by hand as `routine`.
  - Screen on the `court-waiting` scene: the round line reads "COURT 2" (caps by style; assert the text "Court 2"),
    and the message line reads "Next: Example Town v Sample CC · <time from formatTime's own test vector>".
  - `nextLine.test.ts`: a 60-character label is cut to what fits beside "…", and the en line built from it ends in
    "· 14:32"; a label that fits the room stays whole (RP8: measured by width, not counted).
  - Screen on the `court-waiting` scene: there is no `match-label` node while paired; the label row is there
    after the fake goes live.
  - `budgets.test.ts`: fill `{label}` with `${'W'.repeat(23)}…`, 24 of the widest capital (a count budget only;
    the cut is by width, RP8), and `{time}` with "14:32 CEST". Every new `stream.status.court*` key is within the `stream.status.` row's 48 in all four
    languages.

  **Four questions:**
  1. A second call: the same snapshot twice gives the same key, and a 1 Hz tick changes nothing (memo).
  2. An empty input: no `next`, no stage, no destination, and automatic off.
  3. After an interruption: after a match ends normally, the Next line comes back (Review Focus 5); after a
     failure end, that end's line stays.
  4. Another mode or language: four languages at 728 × 328 in `stripTextFit`. Per-fixture codes are unchanged.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The algorithm parts, which the signatures leave open:

```ts
// src/domain/session/stageLine.ts
export function roundLine(court: string | null, stage: string | null | undefined): string | null {
  const round = stageLine(stage); // the 1–40 check stays the stage's own
  if (court === null) return round;
  return round === null ? court : `${court} · ${round}`;
}

// src/hooks/engineSelectors.ts
export const selectRoundLine = (s: EngineSnapshot) =>
  roundLine(selectCourt(s), selectLabel(s) === null ? null : s.pairing?.stageLabel);

// src/hooks/statusKey.ts
const CALM_ENDS: ReadonlySet<LastEnd> = new Set([
  'stopped-automatically',
  'stopped-by-organiser',
  'stopped',
]);

function pairedKey(snapshot: EngineSnapshot): StatusKey {
  if (snapshot.refusal !== null) return REFUSED[snapshot.refusal];
  const court = selectCourt(snapshot) !== null;
  const { lastEnd } = snapshot;
  if (lastEnd !== null && !(court && CALM_ENDS.has(lastEnd))) return LAST_END[lastEnd];
  if (selectDestination(snapshot) === null) return 'stream.status.waitingDestination';
  if (!court) return 'stream.status.waitingGoLive';
  if (snapshot.pairing?.automatic === false) return 'stream.status.courtAutomaticOff';
  return nextKey(snapshot) ?? 'stream.status.courtNone';
}

/** The Next line's key on a court code, or null with no next streamed match. Paired and on air share it. */
function nextKey(snapshot: EngineSnapshot): StatusKey | null {
  const next = snapshot.pairing?.next ?? null;
  if (selectCourt(snapshot) === null || next === null) return null;
  return next.scheduledStart === null ? 'stream.status.courtNext' : 'stream.status.courtNextAt';
}
// stateKey: case 'publishing': return nextKey(snapshot) ?? 'stream.status.live';
```

- [ ] **Step 4: stripTextFit** (`stripTextFit.test.ts:60-80` builds the rows; `:180-200` pins the counts). Add
      two fills beside `{remaining}`, `{window}` and `{destination}`: `{label}` → the realistic match label cut as
      the line cuts it, `cutNextLabel('Example Town v Sample Cricket Club')` = "Example Town v Sample C…"; and
      `{time}` → "14:32 CEST". After this task the status strings are 47 per language (43 + the four court keys):
      update `toHaveLength(43)` to 47, `REALISTIC` to `4 * 52`, and `ROWS` to `4 * 52 + 4 * 2`. Task 10 adds
      `refusedNoMatch`, giving 48, `4 * 53` and `4 * 53 + 4 * 2`. At `PHONE` (728 × 328), assert explicitly that
      `courtNextAt` (time visible), `courtNone` and `courtAutomaticOff` fit one line in all four languages. Add
      any row cut at `NARROW` to the ratchet lists.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(stream): court waiting line and round line`.

### Task 8: Exit via ⋯ on the waiting screen

**Files:**

- Create: `src/hooks/useCourtExit.ts`
- Create: `src/ui/components/LeaveCourtSheet.tsx`
- Modify: `src/ui/components/StreamColumn.tsx` (`IconRow`: a `more` IconButton, last, when `onMore !== null`)
- Modify: `src/ui/screens/StreamScreen.tsx`: mounts the sheet over `viewfinder` and calls
  `useBackCloses(open, stay)`. While the sheet is open, the halves' wrapper gets `aria-hidden` and
  `importantForAccessibility="no-hide-descendants"`, as `MatchDayScreen.tsx:120` does
- Create: `src/ui/theme/leaveCourtFit.test.ts` (on `exitFit.test.ts`'s model)
- Modify: `src/ui/theme/tokens.ts:615-640` (`controlsHalfWidth` rows: add `5 * cells.iconButton + 4 * space.sm`)
- Modify: `src/i18n/{en,es,fr,nl}.json` (`stream.court.*`)
- Test: `src/hooks/useCourtExit.test.tsx`, `src/ui/components/LeaveCourtSheet.test.tsx`,
  `src/ui/screens/StreamScreen.paired.test.tsx`, `src/ui/theme/controlsFit.test.ts`, `src/ui/theme/leaveCourtFit.test.ts`,
  `src/i18n/budgets.test.ts`

**Interfaces:**

- Consumes: `Viewfinder.court` and `Viewfinder.kind` (Task 6); `useUnpair` (`src/hooks/useUnpair.ts`); and
  `modeStore.forget`, `navigation.go` (Ports).
- Produces:
  - `useCourtExit(court: string | null, kind: Kind): { offered: boolean; open: boolean; ask(): void; stay(): void; leave(): void }`;
  - `offered` is `court !== null && kind === 'paired'`;
  - `open` is forced false whenever `offered` is false, so an arming engine closes the sheet;
  - `leave()` follows Home's Forget (`useHome.ts:688-707`), including its reject handler (I5). A second
    `leave()` while one is under way does nothing, because `useUnpair` drops it.
  - `LeaveCourtSheet({ court, onStay, onLeave })`: the title is `t('stream.court.leaveTitle', {court})`, then the
    body. Stay is the lime `Button` and comes first; Leave is the `GhostButton`; the dim means Stay. Shape:
    `ExitMatchDaySheet`.

- [ ] **Step 1: Write the failing tests.**
  - The column on the `court-waiting` scene shows a `more` button named "More". It is absent on a fixture code,
    absent on air on a court code, and absent while arming.
  - Tapping it opens the sheet with "Leave Court 2?". Stay closes it, and nothing is sent to the engine.
  - Leave sends `unpair`, then forgets the saved code, then goes Home.
  - `closes the Leave sheet when the engine arms, and never unpairs`: open the sheet, the fake hears a go-live,
    and the sheet is gone with no `unpair` intent in the fake's log.
  - Leave twice → one `unpair`.
  - Back while open → Stay.
  - `a refused forget stays on Live Stream and says so in the record`: `modeStore.forget` rejects → one
    `store.write-refused {action: 'court-leave'}` warning, no navigation and no unhandled rejection.
  - While the sheet is open, the halves' wrapper has `importantForAccessibility="no-hide-descendants"`, and it is
    `auto` once the sheet closes. jsdom sees the prop only; that a screen reader skips the halves is
    **device-only**, and Task 13 checks it with TalkBack.
  - `controlsFit`: the five-cell row (272) fits in 278. The derivation now counts five rows, and `controlsHalf`
    is still 310.
  - `leaveCourtFit`: at 728 × 328, with an 80-character court name of the widest capital, in all four languages,
    the title (wrapping), the body, Stay and Leave fit the sheet's height. Stay and Leave are one word each.
  - `budgets.test.ts` rows: `stream.court.more` 14; `stream.court.(leave|stay)` 16. The title and body are measured
    by `leaveCourtFit`, not by a character budget.

  **Four questions:**
  1. A second call: Leave twice, and ⋯ twice.
  2. An empty input: no saved code when Leave lands, which does nothing; and a fixture code, where there is no ⋯.
  3. After an interruption: a remote Go live while the sheet is open (Review Focus 4); a refused forget; and the
     app backgrounded with the sheet open, which closes it on return because the route remounts.
  4. Another mode or language: the sheet in four languages at 728 × 328. Live Stream is landscape only.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `savedStream` is `useHome.ts:186`'s; move it, verbatim, to
      `src/hooks/savedStream.ts` and import it in both places.

```ts
export function useCourtExit(court: string | null, kind: Kind): CourtExit {
  const { modeStore, navigation, logger } = usePorts();
  const unpair = useUnpair();
  const [asked, setAsked] = useState(false);
  const offered = court !== null && kind === 'paired';
  const ask = useCallback(() => setAsked(true), []);
  const stay = useCallback(() => setAsked(false), []);
  const leave = useCallback(() => {
    setAsked(false);
    const code = savedStream(modeStore); // the code on screen when Leave was pressed (C4b-I2)
    if (code === null) return;
    unpair('forget', (outcome) => {
      if (outcome === 'held') return; // a remote Go live won the race: the broadcast stands
      void modeStore.forget(code).then(
        (forgot) => (forgot ? navigation.go('home') : undefined),
        () => logger.warn('store.write-refused', { action: 'court-leave' }),
      );
    });
  }, [modeStore, navigation, logger, unpair]);
  return { offered, open: offered && asked, ask, stay, leave };
}
```

- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Mutate** the `kind === 'paired'` guard to `true`. The arming test must red. Restore.
- [ ] **Step 6: Commit** `feat(stream): Exit leaves the court, behind ⋯`.

### Task 9: Home's Continue card names the court

**Files:**

- Modify: `src/domain/mode/continueCard.ts` (`ContinueCopy` variants gain `court: string | null`)
- Modify: `src/hooks/useHome.ts:520-531` (`useContinueCopy` passes `selectCourt` and the saved court)
- Modify: `src/ui/components/ContinueCard.tsx` (`cardText`)
- Modify: `src/i18n/{en,es,fr,nl}.json` (`home.continue.court`)
- Test: `src/domain/mode/continueCard.test.ts`, `src/ui/components/ContinueCard.test.tsx`

**Interfaces:**

- Consumes: `selectCourt` (Task 6) and `WaitingFields.court` (Task 2).
- Produces:
  - `continueCard({... heldCourt: string | null })`;
  - each copy carries a `court`. The held court counts only when the engine holds this saved code, by the
    same `sameCode(held, savedCodeName(saved))` test as `continueCard.ts:27`:
    `court = (engine === 'paired' && sameCode(held, savedCodeName(saved)) ? heldCourt : null) ?? saved.stream?.waiting.court ?? null`;
  - `cardText`: when `court !== null` the title is `t('home.continue.court', {court, mode: t(MODE_NAME.stream)})`,
    and the detail is the kind's own detail. A paired card's detail is `home.continue.waiting`.

- [ ] **Step 1: Write the failing tests.**
  - A saved court code, not paired → title "Court 2 · Live Stream", detail the slot line.
  - Paired → the same title, detail "Waiting for Go live".
  - A fixture code → today's titles, unchanged.
  - A court code after a cold start, with the engine Idle → the title still names the court, from the saved
    waiting fields.
  - `another code's court never titles this card`: the engine is paired to court code B ("Court 5") and the saved
    code is fixture code A → today's title, with no court.

  **Four questions:**
  1. A second call: the same copy for repeated renders (memo).
  2. An empty input: no saved code, which gives no card, and a saved code with no waiting fields.
  3. After an interruption: a cold start with the engine Idle.
  4. Another mode or language: the mode name in four languages; Remote Scoring's card is untouched.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(home): Continue card names the court`.

### Task 10: Scoring answer `label` and the `no_match` word on scoring and start (both readers)

**Files:**

- Modify: `.../adapter/ScoringLinks.kt` (`ScoringLinkAnswer.Link(url, label: String?)`, `wire` adds `label` when non-null)
- Modify: `.../adapter/Bodies.kt:301-317` (`scoringLink`)
- Modify: `src/services/scoringLinkPort.ts` (`SCORING_WORDS` + `'no_match'`; the `ok` outcome gets `label: string | null`; `readAnswer`)
- Modify: `src/hooks/useScoringLink.ts` (`ScoringLinkView` shown gets `label`)
- Modify: `src/ui/components/ScoringLinkPanel.tsx` (the title, and `no_match`'s copy key)
- Modify: `modules/capture-engine/src/wire/scoring-link-vectors.json`
- Modify: `src/i18n/{en,es,fr,nl}.json` (`stream.scoring.titleMatch`, `stream.scoring.refused.noMatch`, `stream.status.refusedNoMatch`)
- Modify: `.../core/Pairing.kt` (`Refusal`: `NO_MATCH("no_match")`), `src/domain/session/Pairing.ts` (`Refusal` + `'no_match'`),
  `modules/capture-engine/src/snapshotWire.ts`, `src/hooks/statusKey.ts` (`REFUSED`, `LINE_TIER`),
  `modules/capture-engine/src/wire/snapshot-vectors.json` (vocabulary `refusal`)
- Test: `.../adapter/ScoringLinkTest.kt`, `modules/capture-engine/src/scoringLinkBodies.test.ts`,
  `src/services/scoringLinkPort.test.ts`, `src/ui/components/ScoringLinkPanel.test.tsx`, `src/ui/theme/scoringFit.test.ts`,
  `src/i18n/budgets.test.ts`, `src/hooks/statusTier.test.ts`, `src/ui/theme/stripTextFit.test.ts`,
  `.../adapter/SnapshotWireTest.kt`, `modules/capture-engine/src/snapshotWire.test.ts`

**Interfaces:**

- Produces:
  - `ScoringLinkOutcome` = `{kind:'ok'; url; label: string | null}` or `{kind:'refused'; word; retryAfterS}`;
  - `ScoringWord` gains `'no_match'`;
  - the panel title is `stream.scoring.titleMatch` with `{label: cutNextLabel(label)}` (Task 7) when
    `label !== null`, otherwise `stream.scoring.title`. One line;
  - `budgets.test.ts` gets the row `[/^stream\.scoring\.titleMatch$/, 32]`, beside `(title|hidesIn)` at
    `:40`, with `{label}` filled as the `stream.status.` rows fill it. The new `stream.status.refusedNoMatch` falls under
    the `stream.status.` row's 48: es "Ningún partido emitido en juego en esta pista" is 45;
  - `Bodies.scoringLink` adds `status in 400..499 && code == "no_match"` → `Refused("no_match", null)`, ordered
    before the 401/404 line. `label` is 1–200 code points, else null, and never refuses a link;
  - start: `Refusal.of("no_match")` → `Refusal.NO_MATCH`. `Bodies.start` already routes a 4xx with a `code` to
    `Refusal.of`, so a 409 `no_match` gives `StartAnswer.Refused(NO_MATCH, …)`. The pairing stays Paired, and the
    snapshot's `refusal` is `"no_match"` until the next start, as for every refusal;
  - TS: `REFUSED.no_match = 'stream.status.refusedNoMatch'`, tier `urgent` like the other refusals, and listed by
    hand in `statusTier.test.ts`;
  - descriptor: no new handling. A non-2xx GET is `CodeAnswer.Status` as today; one test row pins that a 409
    `no_match` GET at Arming is not read as code-ended.

- [ ] **Step 1: Write the failing tests.** Vector rows. `scoring-link-vectors.json` goes from 19 cases (18 with a
      body) to 24 (23); update `scoringLinkBodies.test.ts:20-22`. Before Task 1, every new row except
      "200 without label" carries `"contractValid": false, "until": "Task 1"`. The old schema refuses the `label`
      key and the `no_match` word, and Task 1 flips them (Global Constraints):
  - 200 with `label` → ok, label;
  - 200 without `label` → ok, null;
  - a 201-character label → ok, null;
  - `label: 3` → ok, null;
  - 409 `no_match` → `no_match`;
  - 404 `no_match` → `no_match`;
  - 404 with no code → `unavailable` (X1, unchanged).

  Also:
  - the Kotlin `wire` map holds `label` only when non-null;
  - `readAnswer` re-reads `label` with the same bounds;
  - the panel titled "Score Example Town v Sample CC";
  - the `no_match` refusal shows "No match called to this court yet";
  - `scoringFit`: the `noMatch` line fits the panel's lines in all four languages at the geometries the file
    already sweeps;
  - start: a 409 `{code:"no_match"}` → `Refused(NO_MATCH)`, the machine stays Paired with refusal `no_match`, and
    a new snapshot case carries `"refusal":"no_match"` for both readers. The snapshot vectors go from 19 cases to
    20, and the `vocabulary.refusal` list gains the word;
  - Kotlin: the descriptor's 409 `no_match` at Arming → `Starts.failed`'s path or a retry, never `UnpairReason.CODE_ENDED`;
  - the paired line on a court code with refusal `no_match` reads "No streamed match in play on this court", and
    `stripTextFit` measures `stream.status.refusedNoMatch` in four languages at `PHONE`, ratcheting any cut row.

  **Four questions:**
  1. A second call: two taps, which still give one ask (unchanged); and a refused start, then a retry that
     clears the refusal.
  2. An empty input: an `ok` with no label, a malformed label, and a 404 with no code.
  3. After an interruption: a `no_match` at the start, while the machine stays Paired; and a descriptor 409 at
     Arming.
  4. Another mode or language: the copy in four languages (`scoringFit`, `stripTextFit`, `budgets`).

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The record line keeps writing the word only: never the label, never the URL.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(stream): the scoring panel names its match; no_match on scoring and start`.

### Task 11: The scoring panel's court stale guard

**Files:**

- Modify: `src/hooks/engineSelectors.ts` (`selectCourtMatchKey`)
- Modify: `src/hooks/useScoringLink.ts:126-132` (a second effect)
- Test: `src/hooks/useScoringLink.test.tsx` (or `src/ui/screens/StreamScreen.scoring.test.tsx`)

**Interfaces:**

- Consumes: `selectCourt` and `selectNextLabel` (Task 6), and `selectLabel` (existing).
- Produces: `selectCourtMatchKey(s): string`. It is `""` on a fixture code. On a court code it is
  `` `${s.broadcast?.sid ?? ''}|${selectLabel(s) ?? ''}|${selectNextLabel(s) ?? ''}` ``.
  When it changes, `useScoringLink` calls `hide()`. That moves the ask token, so an answer in flight is dropped,
  and a shown panel goes. `blockedUntil` is not reset: it is the same code.

- [ ] **Step 1: Write the failing tests.**
  - `hides the panel when the court's sid changes while it shows`.
  - `hides the panel when the next label changes while it shows`.
  - `drops an answer that lands after the court's match moved`: tap, change the key, resolve the deferred
    answer → the panel stays hidden and no QR is drawn.
  - `a fixture code going live keeps the panel` (today's behaviour, pinned).
  - Two taps across a re-point → one ask in flight at a time, and the second tap after the hide asks again.
    **Four questions:**
  1. A second call: two taps across a re-point.
  2. An empty input: a court code with no `next` and no sid, which gives a stable key.
  3. After an interruption: a handover while the answer is in flight; a background, whose hide is unchanged.
  4. Another mode or language: fixture codes are unchanged.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**

```ts
// src/hooks/engineSelectors.ts
export const selectCourtMatchKey = (s: EngineSnapshot): string =>
  selectCourt(s) === null
    ? ''
    : `${s.broadcast?.sid ?? ''}|${selectLabel(s) ?? ''}|${selectNextLabel(s) ?? ''}`;

// src/hooks/useScoringLink.ts, beside the code/slot/tokenTag effect. A string, so a 1 Hz snapshot that moves
// nothing never fires it. Not blockedUntil: the court's code is the same code, and so is its rate limit.
const matchKey = useEngineSelector(selectCourtMatchKey);
useEffect(() => {
  hide();
}, [matchKey, hide]);
```

- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Mutate** the selector to return `""` always. The three court tests red. Restore.
- [ ] **Step 6: Commit** `fix(stream): the court's scoring panel never outlives its match`.

### Task 12: Record the rules in AGENTS.md

**Files:**

- Modify: `AGENTS.md`:
  - §1, Live Stream paragraph: court codes. One scan per court per day; each streamed match is its own
    broadcast; Stop ends the match; Exit (⋯) leaves the court. Cite this spec, O1–O11;
  - §2, `scoringLink`: "one of seven refusal words", and an answer that may carry the match's label;
  - §6, Go live / Stop: the court Stop's label;
  - §6, the icon row: before air on a court code the row is five cells (Settings, Home, Take photo, Remote
    scoring, ⋯). The four-cell sentence ("the three buttons pack from the start, as the four do before air")
    gains the five, which still fit the 310 dp half (272 of 278);
  - §6, the strip: on a court code while paired the match label row is hidden, and the Next line names the match;
  - `src/ui/theme/tokens.ts`: `controlsHalfWidth`'s doc comment names the five-cell court row among the rows it
    takes the max of.

- [ ] **Step 1: Edit**, as short sentences in the file's own register. Name `PairingState.isCourt` and
      `selectCourtMatchKey`.
- [ ] **Step 2: Run** `pnpm prettier --check AGENTS.md docs/superpowers/plans/2026-11-14-court-stream-phone.md src/ui/theme/tokens.ts`.
      Expected: clean.
- [ ] **Step 3: Commit** `docs(agents): court codes`.

### Task 13: Device check (Android; the controller, and the owner's hands where listed)

Run after Task 1 and after the web PR is on staging. Local build only (AGENTS §11): `pnpm expo prebuild -p android
--no-install`, then revert `package.json`, then `./gradlew assembleDebug`, then `adb install`. Crop the status bar
from every screenshot and open each one before citing it. Never screenshot a scanned code's raw value.

- [ ] **Step 1 (controller):** with `adb shell wm size 728x328`-equivalent geometry (and the phone's own), on
      staging, set up a court link on the Match Day desk with two matches switched on, and one not.
- [ ] **Step 2 (owner's hands):** Home → Live Stream → scan Court 2's QR. Then mount the phone sideways.
- [ ] **Step 3 (controller, screenshots):** the waiting screen shows "Court 2" and
      "Next: <first streamed match> · <time>", in en, then es, fr and nl (Settings → language).
- [ ] **Step 4 (owner's hands):** tap Remote scoring on the court phone, then scan its QR with a second phone and
      tap Start. **Controller:** the panel title names the next called match. The court phone goes live by itself,
      and its round line reads "Court 2 · <stage>" when the match has one.
- [ ] **Step 5 (owner's hands):** hold Stop for 3 s. **Controller:** the phone returns to waiting with the court
      kept. Home's Continue card is absent because the phone stays in Live Stream. The desk shows that match stopped,
      and the next streamed match still goes live on its scorer's Start.
- [ ] **Step 6 (owner's hands):** start the second streamed match while the first is in its tail.
      **Controller:** the first video ends, the second starts with a new sid, and the scoring panel, if open, hides.
- [ ] **Step 7 (owner's hands):** ⋯ → Leave. **Controller:** the phone unpairs and Home shows no Continue card.
      The desk shows the court phone Offline.
- [ ] **Step 8 (owner's hands):** kill the app while waiting on a court code, then reopen it. **Controller:** it
      re-pairs to the court, and a Stop on the next live match still keeps the court (Review Focus 2).
- [ ] **Step 8b (controller):** with TalkBack on, open the Leave sheet. Swiping does not reach the column's
      controls behind it (Task 8's device-only claim). On the waiting screen, the strip has no match-label row and
      the Next line shows the time (I4).
- [ ] **Step 8c (owner's hands; controller screenshots), O13:** on a second phone with the current Play internal
      build (before this plan), Home → Live Stream → scan Court 2's QR. **Controller:** the server refuses it, and
      the phone shows "Not valid for streaming". Record the build number.
- [ ] **Step 9:** reset the size and density overrides. Record the results, with the claims that are device-only,
      in `docs/specs/2026-11-14-court-stream-results.md`, and commit.
- [ ] **Step 10: The spec §7 cases this check defers**, listed in the results doc as open, each with what would
      prove it:
  - process death while **live** on a court code: the cold start rejoins that sid, never a refused one;
  - the phone **offline across a handover**: on return it rejoins the new sid, never the old;
  - a **second phone** scanning the same court code (A9: the newest takes over): the first goes Home with
    Replaced, and its Continue card is gone;
  - the court code **expiring while live** (R6 backstop): the live match finishes, then the phone shows the
    expiry notice;
  - the link **withdrawn while live**: Review Focus 1 on a device.

---

## Self-review notes

- **Spec coverage:**
  - §6.1 → Tasks 2–4;
  - §6.2 → Task 7;
  - §6.3 → Tasks 5, 6 (Stop), 8 (Exit) and 9 (Continue);
  - §6.4 → Tasks 10 and 11;
  - §6.5 → Tasks 2–5;
  - §7's phone rows → Review Focus and Task 13;
  - Web §5 is the web plan's.
- **Deviations from the spec, decided here (the controller's to overturn):**
  1. §6.1 says "No parser in TS changes". TS must read `court` at the scan, because native gets no descriptor
     before the first Arming, and a cold-start re-pair would otherwise Stop a court phone like a fixture
     (Task 2, Task 3).
  2. §6.4's "a late answer whose label differs from the current/next label is dropped" would drop valid answers.
     By O10, the QR is the next _called_ match, streamed or not, while the snapshot's `next` is streamed-only. So
     the guard drops any answer whose court's sid, label or next moved since the ask (Task 11).
  3. §6.5's "refresh the round line on a sid change" already happens at Arming, which re-GETs the descriptor. The
     added rule clears a court pairing's stage at Arming, so the old match's line never shows under the new sid
     (Task 5).
  4. The spec does not say where the court and Next lines go. "Court 2" takes the round-line slot, joined with the
     stage, and the Next line is the strip's one message line. On court codes the calm last ends give way to it
     (Task 7).
  5. The scoring panel names its match whenever the answer carries a `label`, fixture codes included (Task 10).
- **Amended 2026-11-14 to match the web plan's Task 1 contract:**
  - `court.name` is 1–80;
  - `next` is confirmed as epoch seconds or null, and is omitted when there is none;
  - the scoring `label` is always sent;
  - `no_match` is also a start refusal (Task 10);
  - court QRs carry `exp` (Task 1);
  - the live court strip shows the Next line at routine tier (Task 7). That line is the owner's, shown in
    brainstorming. The controller accepted deviations 1–5.
- **Amended 2026-11-15 for the plan review (I1–I9 and the minor findings):**
  - es copy within budget, and a `titleMatch` budget row;
  - rows that need the new schemas, with every count stated;
  - `stripTextFit` fills and counts (47, then 48);
  - the match label hidden on a court while paired, with the cut label keeping the time visible;
  - Leave's reject handler and its accessibility hiding;
  - Task 5b, unparked by O12 (owner, 2026-11-15);
  - a malformed court refused by all three readers;
  - code for the open algorithms;
  - the minor findings, and a four-questions block per task.
