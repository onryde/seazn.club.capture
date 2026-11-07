# S2-3b — Remote Scoring, chess tie-break: design

Status: **approved in scope by the owner, 2026-11-05** ("yes" to building it; "Mirror the web (Recommended)" for how much). Written
the same day. Rulings continue the numbering after S2-3 (57–62). A ruling is the owner's unless marked _the controller's_.

This adds one thing to the S2-3 chess pad (`2026-11-04-s2-3-chess-design.md`): recording the tie-break of a drawn
knockout game. S2-3 left it out as a non-goal and its pad said "Waiting for the organiser's tie-break". The owner asked
on 2026-11-05 why a phone, which is Remote Scoring, could not do what the web's arbiter pad does.

## 1. What the scout found (2026-11-05, file:line cited in the session)

- The web allows it: `boardgame.tiebreak` is not organiser-only (`organiser-only-events.ts`), and the web's own code calls
  it "the scorer's job" (BG-KO-1). A device link may void its own tie-break before finalize.
- The stage's rungs already reach the phone: the bootstrap's `cfg` is the stage-scoped resolved cfg, with `tiebreak` and
  `tiebreakRungs`. No web change, no contract change. The engine is byte-identical at 2.0.0 (phone) and 3.0.2 (web).
- The event (engine `boardgame.js:189-209`): `{rung: "rapid" | "blitz", winner: entrantId, score?}` with `score` an optional
  `1½–½` shape, or `{rung: "armageddon", black: entrantId, result: "white" | "black" | "draw"}`. There is no board, no
  white and no method field. One tie-break event ends the match (phase `done`, outcome a win, method `tiebreak_<rung>`);
  a second is refused. The fold has no "next rung": the listed rungs are a menu, in the stage's order.
- Armageddon: the scorer never names a winner. White won means the other entrant advances; Black won or a draw means Black
  advances.
- Pending test: `deciderPending` from `@seazn/engine/core`, which the phone's `chessFold.ts` already uses.

## 2. The owner's rulings

| #   | Ruling                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 63  | The phone records the tie-break of a drawn knockout game, mirroring the web pad: a guided sheet with the rung, then who won and an optional score, or Armageddon's Black and result ("Mirror the web (Recommended)", 2026-11-05). |
| 63b | A drawn knockout game the organiser settles by lot (`core.settle`): the pad names who it sent through, "{name} advances · by lot", in the strip, last-tap line and History; Home's card stays "½–½" ("apply rec", 2026-11-07).    |

## 3. The controller's calls, for the owner to correct

- **Lots stay the organiser's.** A drawing of lots is `core.settle`, organiser-only. The sheet says so in one line, as
  the web's does, and the phone never sends a settle. Since ruling 63b (2026-11-07; an S2-3b amendment to ruling 63) the
  pad names who a lot sent through, as it does after a tie-break: "{name} advances · by lot"
  (`scoring.chess.tiebreak.rung.lots`, so `{how}` is "by lot" where a tie-break puts its rung). Before it the pad read
  "Drawn" there and never named the advancer. The seat is read off the engine's fold (`settlement`, kept beside the
  module's state), never the ledger around it; History and the last-tap line read the settle event's own words, as they
  read every event. Only a game drawn on the board names one: an abandoned game settled by lot keeps its "cancelled"
  card and an empty strip. A settle by seed or by the organiser's call still reads "Drawn" (the ruling is the lot's). A
  lot is never this phone's tap, so when the organiser voids it no "Undone" line names it: the last-tap line passes over
  the voided lot and says this phone's draw again, with its Undo, as before the lot; the tile is owed again and History
  strikes the lot.
- **The tile.** While a tie-break is pending the pad shows a **Tie-break** tile; the result halves and Draw stay on the pad but
  are aria-disabled (as built; the web hides them), and the waiting line is replaced by the tile. When the stage lists no rungs the game is held
  as a draw (`needs_decision`) and the S2-3 line stands, reworded to "Waiting for the organiser" (it was never the
  organiser's tie-break to wait for).
- **The sheet** follows the web's steps: pick the rung (skipped when the stage lists exactly one), then Rapid or Blitz:
  _Who won the tie-break?_ with both names, and _Tie-break score (optional)_: No score, 2–0, 1½–½. Armageddon: _Who had
  Black?_, then _Result?_ (White won, Black won, Drawn — Black advances), then _Confirm the result_ naming who advances.
  Nothing is sent before Record, as for a result.
- **Undo** voids the scorer's own tie-break inside S2's 45 s window; the fold returns to `tiebreak` and the sheet is owed
  again. After finalize, or once the winner seat is filled in the next round, the web refuses (carried forward) and the
  pad says so with the existing "Result carried forward" card.
- **Name of the result line.** After a tie-break the pad's header stays level (the web's summary does too) and the strip
  names the advancing player and the rung ("{name} advances · Rapid"). The Home card stays "½–½" (Task 1 review, 2026-11-05):
  its result line (`chessCardLine`) writes the game's own result, which a tie-break leaves a draw, and the advances words
  appear in the strip, the last-tap line and History.
- **Log.** The rung chosen is logged as one short word, `scoring.chess.tiebreak {word}`: the session record's scrub
  allow-list has no `rung` field and would drop it (Task 2), and never a name.
- **Text** under `scoring.chess.tiebreak.*` in en, es, fr, nl; the web's English words are reused (listed in §1's source).
  es, fr and nl are unreviewed drafts until the owner reads them, as for S2-3.

## 4. Left to the builder

File layout (the S2-3 module set is the template), the exact sheet layout inside the 320 dp budget, and the shared-kit
changes the sheet needs, if any (the How sheet is the nearest cousin).

## 5. Exit bar, on the phone

1. A drawn knockout game with a Rapid or Blitz rung: the tile shows; the sheet records a winner, with and without a
   score; the web ledger shows "Tie-break recorded" and the right player advances.
2. Armageddon: Black chosen, each of the three results, and the right entrant advances (draw: Black).
3. Undo of the tie-break, then a different one.
4. A stage listing exactly one rung skips the rung step; a stage listing none shows the organiser line and no tile.
5. 320 dp in the longest locale: the tile and each sheet step.

## 6. Open items

Left open by ruling 63b (the 2026-11-08 review), for a later ruling:

- An abandoned knockout game the organiser settles by lot: the strip names nobody under the "cancelled" card, while the
  last-tap line and History say the lot (the settle event's own words). Pinned as built.
- A settle by higher seed or by the organiser's call has no words of its own: the pad reads "Drawn".
- History's by-line for the organiser's lot is "Another scorer": the line has no word for the organiser.
