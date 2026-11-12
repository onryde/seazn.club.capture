# S2-7 — Remote Scoring, tennis: design

Status: **approved by the owner, 2026-11-12** ("approve"). The owner chose tennis as the next sport ("tennis?", 2026-11-12), skipped the
brainstorm's questions and asked for it to be designed "like volleyball, badminton, crickets", taking the earlier
sports' "findings, pros, cons" (2026-11-12). Every ruling below is therefore _the controller's_, applying the
recommendation the controller would give as product owner (standing instruction of 2026-11-08,
`sdd-no-checkin-apply-recs`), and is open to the owner's correction while reading.

This design argues from the S2 design (`docs/specs/2026-11-01-s2-remote-scoring-design.md`), the table tennis design
(`docs/specs/2026-11-03-s2-2-table-tennis-design.md`) and the volleyball design
(`docs/specs/2026-11-11-s2-6-volleyball-design.md`), whose rulings hold for tennis unless a line here says otherwise.
The research behind it is in the SDD workspace (`s2-7-research.md`: the engine and the web pad, cited by file and
line; `s2-7-lessons.md`: findings, pros and cons of S2-1 to S2-6). Rulings here continue at 215.

## 1. Intent

A chair umpire, a club scorer or a player's parent at a tennis court scores one match on their own phone: scan the
match's scoring link, check it is the right match, start it, tap the side that won each point. The pad speaks the score
as an umpire does (15, 30, 40, deuce, AD; plain numbers in a tie-break), counts games and sets, shows who serves and
when the players change ends, and records the code violations and breaks the web pad records. The organiser's console,
the scorebug and the browser pad see the same match.

Singles and doubles, and every format the organiser can set (Tour, Grand slam, Fast4, Doubles no-ad, short sets),
because the engine's `tennis` module plays them all from the fixture's config; the pad reads the config, never a format
name (7.0.0's config has no variant field).

The web pad (`apps/web/src/components/v2/scorepad/v3/skins/tennis.tsx`) does all of this and more; §2 names what the
phone leaves out, and why.

Success: a real best-of-three singles match with a tie-break on staging, scored on the owner's OnePlus from the first
point to the organiser's final, with the console agreeing point for point; one doubles no-ad match with a match
tie-break the same way; one Fast4 set (§8).

## 2. Goals, non-goals, anti-goals

**Goals**

- Tennis scored point by point, singles and doubles, every format, with the serve side, the change of ends, code
  violations, the game award a game penalty needs, breaks, and the set score (ruling 215).
- A seventh sport behind the S2 runtime: a module set `tennis*` behind `ScoringSport`, a row in `sports.ts` and
  `scoringScreens.ts`, its own screen (S2 ruling 38), and the two lint lists (`SPORT_MODULES`, `SPORT_OWN_FILES`).
- A History row for every event type the pad sends (ruling 226).

**Non-goals**

- **No "Who serves first?" question.** The ledger has no toss event for tennis: the fold opens with home serving
  ("convention: the toss is not modelled", engine `nested/kernel.js:1885`), the point payload has no `serving` anchor,
  and the web pad never asks ("The serve indicator is a scoring aid, not a record", web help `tennis.md`). A phone-only
  pick would put a different server on the phone than on the console and the scorebug (ruling 216).
- **No point-kind step.** The web's dock offers Ace, Double fault, Winner and Unforced error after a tap, never forced.
  The phone keeps S2 ruling 5 (one tap, one point) and sends `by` alone, never `server`, `scorer` or `meta`
  (ruling 217).
- **No default, retirement or forfeit.** A `default` code violation must be followed by `core.forfeit{disqualified}`
  (TN-SE-1); a retirement is a forfeit (TN-RT-1). The phone never sends a forfeit (AGENTS §1): ending a match short is
  the organiser's. The violation ladder on the phone stops at game penalty (ruling 218).
- **No break durations or allowances.** A break records its kind and side; its length and the competition's
  allowance are the web's (ruling 220).
- **No engine change.** `@seazn/engine` 7.0.0 (pinned) ships `tennis` (fold epoch 2) and `tennisPadRules` in
  `@seazn/engine/pad`. A gap the build finds is a finding, raised before phone work depends on it (lesson 5).

**Anti-goals**

- A server shown that the engine did not name. The strip shows the engine's serve side or nothing, never a guess.
- A score call the engine did not make. The halves show the engine's game points (`tennisPadRules.pointCalls`, the
  `advantage` side as AD, a breaker's raw count), never a phone-side tennis count.
- Tennis conditions inside a shared component. A shared part takes props; the sport decides.
- A tool row that moves under the thumb (volleyball F3).

## 3. Rulings (S2-7)

All _the controller's_, 2026-11-12, open to the owner's correction.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 215 | The tennis pad records points (`tennis.point {by}`), the set score (`tennis.set_summary`), code violations (`tennis.sanction`), the game award (`tennis.game.award`) and breaks (`tennis.interruption`). _Why:_ the facts an organiser's scoresheet and the scorebug want, minus §2's. _Cost if wrong:_ cells removed, no data loss.                                                                                                                                                                                                                    |
| 216 | No first-server question: the pad shows the engine's serving side, which starts with home (as the web, the console and the scorebug do). A toss event for tennis is web and engine backlog (§7). _Cost if wrong:_ when the away side served first, every screen shows the wrong server for the match, and the phone no worse than the web.                                                                                                                                                                                                              |
| 217 | One tap, one point: `tennis.point {by}` only; no `server`, `scorer` or `meta.kind` (S2 ruling 5 kept). _Cost if wrong:_ no aces, double faults, winners or errors from phone-scored matches; the result is unaffected.                                                                                                                                                                                                                                                                                                                                  |
| 218 | Code violation: side, then level (warning, point penalty, game penalty, from `tennisPadRules.sanctionLevels` without `default`), then the player when the side has two (doubles). The sanction moves no score (TN-SE-2), so the done step says what to tap: point penalty "Tap the point to {other}"; game penalty "Tap Award game for {other}"; in a tie-break, "A game penalty in a tie-break: ask the organiser". Never a `default` (§2).                                                                                                            |
| 219 | Award game: side, then sent (`tennis.game.award {winner}`). Offered while a standard game is in play; in a tie-break or match tie-break its cell stays, disabled (the engine refuses it, GAME_AWARD_DURING_TIEBREAK).                                                                                                                                                                                                                                                                                                                                   |
| 220 | Break: kind (medical, toilet, heat, other: `tennisPadRules.interruptionKinds`), then the side or "Both / none"; sends `tennis.interruption {kind, by?}` with no `person`, `duration` or `at`.                                                                                                                                                                                                                                                                                                                                                           |
| 221 | Set score: as volleyball, offered before a set's first point, its cell LAST and kept when hidden. Games for each side, then the tie-break's points only when `tennisPadRules.setScoreTakesTiebreak` says so; a match tie-break decider is entered as its points. Bounds from `gamesFieldBound` and `tiebreakFieldBound`. An unreachable score is the engine's refusal (TN-SS-1), shown as one line.                                                                                                                                                     |
| 222 | The halves show the game's call large (0 / 15 / 30 / 40 / AD; a breaker's points as numbers), the serve ball by the engine's serving side, and the side's games in the set on the foot. The strip shows "Set {n} of {bestOf}", "Tie-break" or "Match tie-break" in a breaker, "Deuce" at 40–40 in an ad game, "Deciding point" at 40–40 no-ad, and "Change ends" when `tennisPadRules.endsChanged` is true.                                                                                                                                             |
| 223 | Doubles name both partners on each half (" / ", as the label kit); the serve ball marks the side only, never a person, since the phone sends no `server` (ruling 217) and the pair order is often undeclared.                                                                                                                                                                                                                                                                                                                                           |
| 224 | Tennis folds with its own `tennisFold.ts` over the nested kernel, reusing the generic set-based helpers (`setBasedRefusalOf`, `envelopeOf`, `queuedEnvelopeOf`, `seatsOf`, `namesOf`, `sideOfEntrant`, `payloadForFirstSend`, `standing`, `undoTarget`). `foldSetBased` is not generalised: it is typed to the set-based kernel, and three sports run on it. Declared in §6.                                                                                                                                                                            |
| 225 | The match ends when the engine says (`phase` done or final); the result line names the winner and the sets as the engine writes them ("7–6(5) 3–6 6–4", a match tie-break "[10–7]"). Retirement, default and abandon are the organiser's, and the pad names each one when the organiser records it: the strip, the result card and History say "Retired", "Defaulted", "Walkover" or "Abandoned" with the side, read from the forfeit's reason and the fold's outcome, never "Drawn" or nothing (chess's open item: a settle the pad had no words for). |
| 226 | History shows every event the pad sends: point (with the score after it), set score, violation, game award, break.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 227 | Engine 7.0.0, no bump. `engineEpochs.test.ts` gains the tennis literal (2) copied from the release.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 228 | Layout: volleyball's layout A (ruling 178, the owner's) carried over: halves, strip, last-tap line, four fixed tool slots. Tools: Violation · Break · Award game · Set score. No More: every tool fits the row. A mockup at 390 × 844 and 320 × 640 is shown to the owner with this design, before the screen batch.                                                                                                                                                                                                                                    |
| 229 | Undo takes back this phone's own last event, as every set-based pad: a point, a set score, a violation, an award, a break.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 230 | Start: match details with the format's facts read from the config (best of, games to, tie-break at, no-ad, final set: "match tie-break to 10" or "tie-break at 6–6 to 10"), and Start match. No serve question (ruling 216).                                                                                                                                                                                                                                                                                                                            |

## 4. How a scorer meets it

As the S2 design §4 and the volleyball design §4, with these differences.

1. **Start.** Match details and the format's facts (ruling 230), Start match. Home serves first (ruling 216).
2. **A point.** Tap the half of the side that won it. The engine runs the game (deuce, advantage, the no-ad deciding
   point), the set (tie-break at the config's games-all) and the match (a match tie-break as the deciding set where the
   config says so), and rotates the serve (every game; in a breaker after the first point and then every two).
3. **Change of ends.** When the engine says so, the strip reads "Change ends"; nothing to tap.
4. **Code violation.** Side, level, player (doubles), sent; the done step says what to tap next (ruling 218).
5. **Award game.** Side, sent (ruling 219).
6. **Break.** Kind, side, sent (ruling 220).
7. **Set score.** Offered before a set's first point (ruling 221).
8. **Undo, History, the queue, sync, Realtime, the finished and carried-forward cards:** unchanged.

## 5. The screen

**Layout A carried over (ruling 228).** The mockup is drawn in the phone app's own design (owner, 2026-11-10) at
390 × 844 and 320 × 640 and served locally (not committed). French and Dutch fit are checked by `padFit.test.ts` and exit
item 5, not by the mockup.

- **Top bar** (shared): Home, the sets tally ("1 – 1 · Sets"), Rules, History, the sync dot.
- **Halves** (`ScoreHalf`, shared): the side's bar (lime first, lilac second), its name (doubles: both partners), the
  game's call large; the serve ball beside the serving side's name; the card icon at top right for the heaviest
  violation this set (warning `cardCaution`, a penalty `cardDismissal`); "Tap" at bottom right; at bottom left the
  side's games in the set ("Games 4").
- **Strip:** "Set 2 of 3", then the breaker or the deuce note and "Change ends" (ruling 222).
- **Last-tap line:** the last record and Undo, as every set-based pad.
- **Tools row:** four fixed slots, Violation · Break · Award game · Set score. Set score is LAST and its slot stays when
  it goes; Award game stays disabled in a breaker. No cell moves or changes width under the scorer's thumb (volleyball
  F3; the bare slot of `ToolRow slots`).

## 6. The app's side

- **Domain** (`src/domain/scoring/`): `tennis{Engine, Events, Fold, History, LedgerHistory, Pad, Rules, Sanction,
Tools, Sport, Types}.ts`. `tennisFold.ts` is the nested twin of `setBasedFold.ts` (ruling 224); the rest reuse the
  set-based kit's generic parts. Files stay under 500 lines each (the S2-2 lesson).
- **Routing:** `sports.ts` row `tennis`; `scoringScreens.ts` row; `TennisPadScreen.tsx`, `TennisMatchScreen.tsx`;
  `useTennisMatch.ts`, `useTennisSheets.ts`.
- **Tests that used tennis as "a sport the phone cannot score"** (`sports.test.ts:35`, `scoringMatch.test.ts:205`,
  `scoringMatchView.test.ts:51-53`, `scoringFinish.test.ts:118`, `scoringMatch.base.test.ts:19`) move to a sport key
  the engine has and the phone does not score (hockey).
- **Lint:** `SPORT_MODULES` and `SPORT_OWN_FILES` gain tennis (both casings); `sportBoundary.test.ts` proves it.
- **i18n:** `scoring.tennis.*` in en, es, fr, nl; `padFit.test.ts` sweeps them at 320 and 360, tight as the device.
- **Fakes:** `fakeTennisPad.ts`; `fakeScoringPort.ts` gains the sport key; a ledger fixture `test/tennisLedger.ts`.
- **Generic changes, declared:** none planned. What the build finds the shared kit lacks (a halves foot for games, a
  sanction icon from a tennis level) is recorded as a finding and listed in the results doc, not a quiet edit.
- **Replay early** (lesson 6): Batch B ends with a real match replayed through the real hook against the fake server,
  which judges every append with the real engine: a published five-set Grand Slam final with at least one tie-break and
  one deuce game, and a doubles match with a match tie-break. Before the screen is built.

## 7. Web side

The web accepts `tennis` from the phone today: the device-link bootstrap passes any `sport_key`, and the epoch gate
resolves any sport. Owed by the web, raised at the start, none blocking S2-7:

- A toss event for tennis, engine and web together, so the first server is recorded, not assumed (ruling 216).
- From earlier sports, still open: the carried-forward Undo window and `pair_order` in the server's fold (S2-2 findings
  1 and 2), the production device-link 404.

## 8. Exit bar

Each item with build, commit and Pass / Partly / Fail, as S2-2 to S2-6. Staging fixtures are made before the bar
(lesson 10): a Tour singles, a Doubles no-ad match with a match tie-break and team sheets, a Fast4 match.

1. A Tour singles match on staging, scored on the owner's OnePlus to the organiser's final with a tie-break set; the
   console agrees point for point, including a violation with its point penalty, a game award and a break.
2. A doubles no-ad match to its match tie-break; the deciding point and the match tie-break read as the console's.
3. A Fast4 set: short-set tie-break at 3–3, no-ad.
4. A set score entered from the phone, once with a tie-break block, once refused as unreachable.
5. 320 × 640 and the owner's phone, after the last layout fix, in French and Dutch, with the pad in play, a doubles
   match with the longest staging names included.
6. A retirement recorded by the organiser on the web mid-match: the phone's strip, result card and History name it
   (ruling 225).
7. The real-match replay (§6) green through the real hook.
8. The fold on Hermes (R4 probe) for tennis.
9. Listed, not run unless the owner asks: TalkBack, iOS.

Each item gets its own recorded result, also when the owner runs it (chess closed on the owner's word with no
per-item record).

## 9. Lessons carried from every sport so far

From all six sports the app scores (owner, 2026-11-12: "not only lession from volleyball, all sports we built"):
badminton S2-1, table tennis S2-2, chess S2-3 and S2-3b, cricket S2-4, football S2-5, volleyball S2-6.
`s2-7-lessons.md` holds each sport's findings, pros and cons; §5 and §6 there list these, each with where it lands
here.

1. Fixed tool slots, Set score last (ruling 228, §5). 2. A mockup before the screen (ruling 228). 3. Fit in four
   languages at 320 and 360 and on the device after the last fix (exit item 5). 4. Every held pick tied to a `base` count:
   tennis holds no pick across taps (no toss, no serve question), so a sheet's answer goes with the tap that opened it, or is
   dropped when a co-scorer's event lands first. 5. The engine read against every event before phone work (Batch A).
2. A real-match replay at design time (§6). 7. Shared-kit changes declared (§6, none planned). 8. Confirm before an
   irreversible action: the violation and award sheets end on a confirm step. 9. Web asked first (§7). 10. Staging fixtures
   before the bar (§8). 11. The full suite on a pushed branch before the results doc. 12. Device briefs written; no
   fixed-coordinate taps after a density change; Hermes and TalkBack decided up front (§8 items 8–9). 13. Every organiser ending named (ruling 225, exit item 6;
   chess). 14. Doubles labels fitted with the longest names at 320 dp in Dutch (exit item 5; chess's three-line strip).
3. A per-item exit record (§8; chess's close-out).

Per sport, the lesson that shaped a ruling here: badminton's stale Set score sheet and silent drops (rulings 221, 229:
a sheet's answer goes with its tap, every drop gets a record line); table tennis's stale serving stamp and the tool
placement the owner moved (rulings 216, 228); chess's unnamed organiser endings (ruling 225); cricket's missing engine
step that refused every tap, and the 320 dp overlaps (Batch A's engine read, exit item 5); football's 3 s hold on
irreversible steps and the device-looser fit metric (lesson 8, `padFit` tight as the device); volleyball's moving tool
row and its fixtures that lacked a pair order (ruling 228, §8's fixtures).

## 10. Left to the builder

File splits, function names, the exact copy (en from this document, es/fr/nl the controller's, as before), and the
fake's shape.
