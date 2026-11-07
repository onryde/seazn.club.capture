# S2-3 — Remote Scoring, chess: design

Status: **approved by the owner, 2026-11-04** ("approve"). Brainstormed in the session of 2026-11-04. Amended after
building (2026-11-05; the amendments are marked _as built_ and the rulings behind them are in
`2026-11-05-s2-3-results.md`): the pad's layout, the result line, the seat-based tap and Undo's window.

This design adds chess to Remote Scoring. It argues from the S2 design
(`docs/specs/2026-11-01-s2-remote-scoring-design.md`, "the S2 design" below) and from S2-2
(`docs/specs/2026-11-03-s2-2-table-tennis-design.md`), whose rulings 1–56 and whose sections hold for
chess unless a line here says otherwise. Rulings here continue the numbering at 57. A ruling is the
owner's unless marked _the controller's_; everything marked _the controller's_ is open to the owner's
correction while reading.

## 1. Intent

An arbiter or volunteer at a chess board records one game's result on their own phone: scan the
match's scoring link, check it is the right match, and when the game ends tap who won (or a draw) and,
if they wish, how. Chess has no rallies and no serve. The pad is a result entry, and its whole job is
to make that one tap hard to get wrong and easy to undo.

## 2. Goals, non-goals, anti-goals

Goals:

- A chess match is scored from the same scan-and-confirm entry as the other sports, with a pad of its
  own (S2 ruling 38: one screen per sport over the shared kit, never one pad with sport conditions).
- White won, Draw, Black won, each named with the player; an optional _How_ from the methods the engine
  accepts today; Undo of the scorer's own result.
- Colours are shown, home is White by default, and the scorer can swap them before the result.
- Everything the pad sends is accepted by the web as it is: no web change, no new contract.

Non-goals:

- A clock, moves, a board, notation or a PGN. Result only (ruling 57).
- Team matches and boards that add up (ruling 58): one game, two players.
- A forfeit, a no-show, a walkover, an abandon, or drawing lots from the phone. The web refuses them
  from a device link (`core.forfeit`, `core.abandon`, `core.settle` are organiser-only), and the owner
  asked for no web change (§7). The pad says so in one line.
- The rapid or blitz tie-break rungs (`boardgame.tiebreak`) and the mini-match score (the web's D6). **Superseded by
  ruling 63:** built in S2-3b, see `docs/specs/2026-11-05-s2-3b-chess-tiebreak-design.md`.
- A second state machine in TypeScript: the match state is a fold of the web's ledger by
  `@onryde/seazn-engine` (S2 design §6.1), as for the other sports.

Anti-goals (a failure even if it works):

- A result that lands on the wrong side. A mis-tap at the board is the likely mistake (AGENTS.md §6),
  so nothing records until Record is tapped.
- A "forfeit" built by sending a method the web refuses on write (`boardgame.result` with `forfeit`).
- A pad that needs the scorer to read a sentence to find the three buttons.

## 3. The owner's rulings (S2-3)

| #   | Ruling                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57  | Chess records a result only, no clock and no moves ("just a result for now", 2026-11-04).                                                                                                                                                                                                           |
| 58  | One match is one game between two players, not a team match with boards ("A: one game", 2026-11-04).                                                                                                                                                                                                |
| 59  | The pad asks _How_ with the methods the engine supports today ("we can ask How as it supports today", 2026-11-04). It is optional (the controller's reading, §10).                                                                                                                                  |
| 60  | The pad is option A of the mockup: three big result buttons, a sheet that asks How and holds Record, Swap colours as a small row under the names ("Ok" to the controller's recommendation, 2026-11-04).                                                                                             |
| 61  | The `boardgame` key is shared, and the phone cannot tell the game (§9). The owner chose "Treat boardgame as chess" (2026-11-04): the pad offers the chess How words; no web change. (As built no pad carries a sport title, so no string says Chess.) A draughts or go fixture would show them too. |
| 62  | Draw and Swap colours stay cells in the pad's bottom row, not three big result buttons and a Swap row under the names; the double-tap guard covers the mis-tap (owner, 2026-11-05, "Keep, amend spec"). _As built_ supersedes the layout of 60.                                                     |

Asked and answered by the web, not ruled: a forfeit from the phone needs a web change (§7); the
owner asked for none.

## 4. How a scorer meets it

1. Scan the match's scoring code from Home's Remote Scoring tile (S2 flow, unchanged). The match check
   shows the two names, each with a WHITE or BLACK chip.
2. If nobody has started the match, Start match (`core.start {}`); the engine accepts a result only
   while the match is live. A match another scorer started opens on the pad (as in S2-2).
3. The pad: the two names with their colour plates and two halves, _White won · {name}_ and _Black won · {name}_;
   _Draw_ and _Swap colours_ are 48 dp cells in the bottom row (ruling 62, _as built_; Swap is offered once the
   game is live).
4. Tapping a result opens the sheet, "How did {name} win?" or "How was it drawn?". The scorer taps one
   method or none, then Record. Nothing is sent before Record. Cancel closes the sheet.
5. Recorded: the pad's header reads White-first, 1–0 or 0–1, and a bare ½ for a draw (the full ½–½ does not fit
   72 dp at 320 dp); the strip names the winner and the method ("{name} won · {how}"); Undo stays for the
   scorer's own result inside S2's 45 s window, unlimited while a tie-break waits, gone at finalize. Home's
   card reads first-side-first (0–1 when the second name won; ½–½). _As built._

Methods (the engine's own lists; the pad's words are in the dictionaries):

- Decisive: checkmate, resign, time, adjudication, illegal move.
- Drawn: agreement, stalemate, insufficient material, repetition, fifty-move, dead position, adjudication.

## 5. What goes on the wire

All events ride the generic append the other sports use (`POST /fixtures/{id}/events`, sport-agnostic;
device-link bootstrap likewise). The sport key is `boardgame`, not `chess` (engine `sports/boardgame`).

| Scorer does        | Event                                                         | Note                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start match        | `core.start {}`                                               | Required before a result.                                                                                                                                                           |
| Record a white win | `boardgame.result {winner: <entrant holding White>, method?}` | White is home unless a pairing flipped it. The tap names a seat; the seat's entrant is read when the event is written, and a pairing landing closes an open How sheet (_as built_). |
| Record a black win | `boardgame.result {winner: <entrant holding Black>, method?}` |                                                                                                                                                                                     |
| Record a draw      | `boardgame.result {winner: null, method?}`                    | A method must agree with the outcome (engine `RESULT_METHOD_CONTRADICTS_WINNER`).                                                                                                   |
| Swap colours       | `boardgame.pairing {white: <entrant>}`                        | The arbiter's pairing card; offered once the game is live (_as built_; the engine would take it earlier).                                                                           |
| Undo               | `core.void {event_id}`                                        | The link's own events only, before finalize (web `scoring.ts`).                                                                                                                     |

A `{}` result is refused by the engine; a `forfeit` or `double_forfeit` method is refused on write by
the web. A correction after a wrong result is Undo and a new result: no event changes a method later.

## 6. The app's side

Follows table tennis's module set, one new sport behind the `ScoringSport` port (S2-2 plan is the
template). The builder owns the file layout; the constraints are these.

- `sportFor` and the screens table each get a row; the lint prefixes (`SPORT_MODULES`, `OWN_FILES`) get
  the new sport's, in both casings. Generic files never import the sport's modules.
- The port's serve- and games-shaped members answer null or empty for chess (`tossOf`, a games-over
  result line); the pad writes its own result line.
- The engine's `summary()` gives table points, not 1–0 or ½–½: the result line is ours to write
  (the controller's call, §10).
- Text under `scoring.chess.*` in en, es, fr and nl, with the longest words checked at 320 dp as S2-2
  item 6 did. WHITE and BLACK are words on the chips, never colour alone.
- Fakes first: a fake chess pad and a ledger helper, so every state renders on a laptop (AGENTS.md §10).

## 7. Web side

None asked. The recon (scout, 2026-11-04, file:line cited in the session) found: the capture API and
the device-link bootstrap are sport-agnostic; the web's own engine (3.0.2) has the same boardgame code
as 2.0.0; `core.forfeit`, `core.settle` and `core.abandon` are organiser-only, so a device link gets 403. Two things are unverified on a real server and gate the plan (§9): that `boardgame.pairing` is
accepted from a device link, and what a draw does in a bracket stage.

## 8. Tests and exit bar

The four questions (AGENTS.md §10) in tests: a second tap on Record (one event); no fixture colours or
a missing config; the sheet open when the app goes to the background and when the ledger moves under
it (another scorer recorded first: the web's seq conflict, reconciled as S2 does); a result in each
language. Mutate every guard once.

Exit bar, on the phone, by the owner's hands where marked:

1. A white win, a black win and a draw each reach the web's ledger with the right winner (the web page
   shows the result).
2. A result with a method, and one without.
3. Swap colours, then a result: the winner is the player named, not the home side.
4. Undo of a result, then a different result.
5. A second scorer in a browser records first: the phone reconciles and says so.
6. 320 dp in the longest locale: the pad and the sheet.
7. A draw in a bracket stage, or the reason it cannot be tested (§9).

## 9. Open

- `boardgame.pairing` from a device link: send one to a throwaway staging fixture before the plan.
- A draw in a bracket stage leaves the match in the engine's `tiebreak` phase. The controller proposes a
  line on the pad, "Waiting for the tie-break; the organiser records it", and no tie-break control.
- A staging fixture with a chess (`boardgame`) division is needed for the device checks. The owner
  creates it. For exit item 7 its bracket stage must set `cfg.tiebreak: true` with rungs, or the engine never
  enters `tiebreak` (engine `boardgame.js:288`).
- The pairing probe moved to the device check (results doc), not before the plan. Web main shows the pairing
  is not organiser-only (`organiser-only-events.ts`) and the fidelity gate is gone (`scoring.ts:522-526`), but
  that is the web's code read, not a server answered. Read the phone right after the first Swap: a bare 403
  makes `sync.ts:532-534` mark the whole queue forbidden.
- **Settled by ruling 61:** the `boardgame` key is shared (the engine's module says chess, draughts, go, carrom
  and every generic 1-v-1 sport). Is the pad titled Chess and the How words chess-only, or is it a board-game
  result pad that shows How only for chess? The lookup found nowhere: the bootstrap descriptor carries only `sport_key`, and the engine's cfg has a
  clock `variant` (classical, rapid, blitz) and no game field. Knowing the game needs a web change.
- Whether `boardgame` is shared with other board games. The pad is named Chess; if the fixture's
  config says otherwise (no colours), the builder reads `cfg.colors` and drops the chips and Swap.
- Production's `/api/v1/device-link` still answers 404 (web deploy owed), so Remote Scoring does not
  work on production builds yet; staging only until then.
- The main checkout's `node_modules` holds engine 1.1.0 though `package.json` pins 2.0.0: reinstall
  (`NODE_AUTH_TOKEN=$(gh auth token) pnpm install`) before any build.

## 10. The controller's calls, for the owner to correct

- _How_ is optional: Record works with no method chosen.
- Result line 1–0, ½–½, 0–1, written by the pad (_as built_: White-first in the header, a bare ½ for a draw; the winner's
  name on the strip; Home's card first-side-first).
- The match check and Start screen show the colour chips as the pad does.
- The tie-break waiting line (§9).
- An abandoned game or a double walkover shows a no-result "cancelled" card (wording is the owner's to give);
  the method chosen is logged as a short word when the result is queued, "none" when none was chosen.
- Swap colours sends a pairing event only when the scorer swaps; nothing is sent when home keeps White.

- Swap colours moves the WHITE and BLACK chips only; the names keep their places. It may be repeated
  before the result. If the staging probe (§9) shows the web refuses `boardgame.pairing` from a device
  link, Swap is hidden and the chips stay read-only (they read the engine's colour of home).
- Undo voids the scorer's own result and nothing else; a swap is not undone by it (swap again). When
  another scorer recorded the result, Undo is hidden.
- After Record the engine is in phase `done`; the web's finalize later makes it `final`, and Undo goes
  with it (web `scoring.ts`). The pad's post-result state is the result line and Undo.
- A draw in a bracket stage is planned with the waiting line (§9); exit item 7 may end as "cannot be
  tested".
- A team or pair entrant shows its entrant name; no new refusal word.
- The session record logs the method chosen (a short word), never a name.

## 11. Left to the builder

File names and the module split, the fake, the exact sheet layout inside the 320 dp budget, the wording
of each method in four languages (reviewed by the owner for fr, es and nl), and the shared-kit changes
the sheet needs, if any.
