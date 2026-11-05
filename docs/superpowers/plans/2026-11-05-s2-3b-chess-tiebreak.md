# S2-3b Chess Tie-break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** the phone records the tie-break of a drawn chess knockout game (rapid, blitz, Armageddon), mirroring the web pad.

**Architecture:** extends the S2-3 chess module set (`chess*` files, `useChess*` hooks, `ChessPadScreen`) behind the existing `ScoringSport` port. The fold stays the engine's (`@seazn/engine/sports/boardgame`); the new event is built in `chessEvents`, pending is read from `deciderPending`, rungs from the bootstrap cfg. No native, contract or web change.

**Spec:** `docs/specs/2026-11-05-s2-3b-chess-tiebreak-design.md` (ruling 63, the controller's calls §3). Builds on `docs/specs/2026-11-04-s2-3-chess-design.md` and its as-built amendments.

## Global Constraints

Same as S2-3 (AGENTS.md; `any` banned; no console.log; tokens only; max 3 JSX levels; functions 10–25 lines; no snapshot tests; screens reach native only through ports; generic files name no sport; four questions per change; mutate every guard once; expected copy read from the dictionary). Wire (engine `boardgame.js:189-209`): `{rung: "rapid"|"blitz", winner: entrantId, score?: "<n>½?–<n>½?"}` (en dash) and `{rung: "armageddon", black: entrantId, result: "white"|"black"|"draw"}`; one tie-break event ends the match; refused outside phase `tiebreak`. Nothing is sent before Record. The tap names a seat, not an entrant (S2-3 ruling). A double tap on any control goes through the bounce memory; every sheet close arms the bounce window without clearing the status line (S2-3 fix rounds 2–3).

## Review Focus

- A stage that lists no rungs: no tile, the organiser line stays (S2-3 behaviour, wording changed).
- A stage that lists one rung: the rung step is skipped.
- A second tie-break while one stands, a tie-break after another scorer's result or settle: refused quietly, shown.
- Armageddon draw: Black advances; the scorer is never asked for a winner.
- Undo of an own tie-break, and Undo when the winner seat is filled (carried forward).

---

### Task 1: Domain — tie-break state, events and pad display

**Files:** Modify `src/domain/scoring/chessTypes.ts`, `chessEvents.ts`, `chessFold.ts`, `chessPad.ts`, `chessSport.ts` (as needed), their tests, the fake (`fakeChessPad.ts`) and `test/chessLedger.ts`.

**Interfaces:**
- Produces: `ChessRung = "rapid" | "blitz" | "armageddon"`; the display carries `tiebreak: { rungs: readonly ChessRung[]; pending: boolean }` (rungs from the cfg in the stage's order, all three when the cfg lists none and `tiebreak` is true, none when `tiebreak` is false); a tap kind `{ kind: "tiebreak"; ... }` built from a seat-based choice (rapid/blitz: winner seat, score option `none | "2–0" | "1½–½"`; armageddon: black seat, result) and `chessEventFor` building the two payloads with the seat's entrant; Undo of an own tie-break event; the Home card line and the strip text for a decided tie-break ("{name} advances · {rung}").
- Consumes: S2-3's seat-based tap and `deciderPending`.

- [ ] Step 1: failing domain tests from the real fold (the web's `chessKnockout` rig in S2-3's `chessFold.test.ts` is the template): a drawn knockout game is pending; a tie-break event decides it; a second is refused; a stage with no rungs is not pending (held draw); each payload exactly as the wire above; Armageddon never names a winner.
- [ ] Step 2: implement in the files above; `chessPad` shows a Tie-break tool in place of the result halves and Draw while pending; reword the waiting line to "Waiting for the organiser" for the no-rungs case (dictionary change belongs to Task 2).
- [ ] Step 3: run the related vitest (JSON counts), eslint and prettier on changed files, tsc. Mutate each new guard once. Commit `feat(chess): tie-break state, events and pad display`.

### Task 2: Hooks, screens and text

**Files:** Modify/create `src/hooks/useChessSheets.ts`, `useChessMatch.ts`, a `TieBreakSheet` component beside `HowSheet`, `src/ui/screens/ChessPadScreen.tsx`, the four dictionaries, `docs/i18n-glossary.md`, fit tests (`chessFit`), and their tests.

**Interfaces:**
- Consumes: Task 1's display and tap.
- Produces: `ChessSheetView` gains a tie-break sheet kind with its step state (rung, winner/score or black/result, confirm); actions `pickRung`, `pickTiebreakWinner`, `pickScore`, `pickBlack`, `pickArmageddonResult`, and `recordTiebreak`; the sheet closes on any ledger move that changes what it was for; keys `scoring.chess.tiebreak.*` in en, es, fr, nl with the web's English words (rung.title "Which tie-break decided it?", Rapid, Blitz, Armageddon, winner.title "Who won the tie-break?", score.title "Tie-break score (optional)", No score, 2–0, 1½–½, black.title "Who had Black?", result.title "Result?", White won, Black won, Drawn — Black advances, confirm.title "Confirm the result", a lots hint "Decided by lot? Ask the organiser to settle the match."), the Tie-break tile word, and "{name} advances · {rung}"; es, fr, nl marked unreviewed drafts in the glossary.

- [ ] Step 1: failing tests: the tile opens the sheet; one rung skips the rung step; Rapid/Blitz records winner with and without a score; Armageddon records Black and each result; Record sends exactly one event; a double tap on Record, a pick, Cancel or the tile queues once; background closes the sheet; Undo; every string from the dictionary in four languages; fit at 320 and 360 dp for the longest step in each language.
- [ ] Step 2: implement; reuse `HowSheet`'s overlay/option components where it avoids a second layout; log `scoring.chess.tiebreak {rung}` after the outcome is ok.
- [ ] Step 3: verify as Task 1; mutate each new guard once. Commit `feat(chess): the tie-break sheet in four languages`.

### Task 3: Routed flows

**Files:** Modify `test/routedApp.chess.test.tsx`.

- [ ] Step 1: flows through the routed app: a drawn knockout game with all rungs: Rapid winner with a score; Blitz winner no score; Armageddon each result (draw: Black advances); Undo then a different tie-break; one rung skips the rung step; no rungs shows the organiser line and no tile; a second scorer's settle lands first and the pad shows it; each of en, es, fr, nl once.
- [ ] Step 2: run; fix wiring in Tasks 1–2's files, not here. Mutate the guards once and name the killing tests. Commit `test(chess): routed tie-break flows`.
