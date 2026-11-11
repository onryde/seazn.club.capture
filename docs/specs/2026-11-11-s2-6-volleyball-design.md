# S2-6 — Remote Scoring, volleyball: design

Status: **approved by the owner, 2026-11-11** ("approve"). The owner chose volleyball as the next sport ("Volleyball",
2026-11-11) and skipped the brainstorm's questions ("yes", 2026-11-11). Every ruling below is therefore
_the controller's_, applying the recommendation the controller would give as product owner (the owner's
standing instruction of 2026-11-08, `sdd-no-checkin-apply-recs`), and is open to the owner's correction
while reading. The exceptions are the libero (ruling 171) and the layout (ruling 178), both the owner's; the layout was
picked from mockups before any screen is built, because every sport since S2-2 lost builds to a layout ruled
on the device.

This design argues from the S2 design (`docs/specs/2026-11-01-s2-remote-scoring-design.md`) and from the
table tennis design (`docs/specs/2026-11-03-s2-2-table-tennis-design.md`, "the S2-2 design"), whose rulings
1–56 hold for volleyball unless a line here says otherwise. It also takes the generic parts of the
cricket and football designs (the team sheet, `teamSheet.ts`; the sheet kit, `SheetFrame`, `sheetRow`,
`StepOption`; `engineRefusalOf`). Rulings here continue at 170.

## 1. Intent

A referee, scorer or volunteer at a volleyball court scores one match on their own phone: scan the match's
scoring link, check it is the right match, say who serves first, tap the side that won each rally. The
pad shows what a FIVB scoresheet tracks beyond the points: which side serves (side-out), the deciding
set's fresh toss, each side's timeouts and substitutions in the set, and the four-step sanction ladder.
The organiser's console, the scorebug and the browser pad see the same match.

Indoor (6 v 6, best of 5 to 25, deciding set to 15) and beach (pairs, best of 3 to 21, deciding set to 15,
no substitutions) both play, because the engine's `volleyball` module has both variants and the
organiser's fixture says which; the pad reads the fixture's config, never assumes indoor.

The web pad (`apps/web/src/components/v2/scorepad/v3/skins/volleyball.tsx`) does all of this and more;
§2 names what the phone leaves out, and why.

Success: a real indoor volleyball match on staging, five sets if it goes there, scored on the owner's
OnePlus from the first serve to the organiser's final, with the console agreeing rally for rally; and one
beach match the same way (§8).

## 2. Goals, non-goals, anti-goals

**Goals**

- Volleyball scored rally by rally, indoor and beach, with the serve side, the deciding-set toss, timeouts,
  substitutions (indoor) and sanctions the web pad records (ruling 170; S2 ruling 4, band 3 always).
- A sixth sport behind the S2 runtime on the set-based kit S2-2 built: a module set `volleyball*` behind
  `ScoringSport`, a row in `sports.ts` and `scoringScreens.ts`, its own screen (S2 ruling 38), and the two
  lint lists (`SPORT_MODULES`, `SPORT_OWN_FILES`).
- The lineup the organiser saves after the pad opens is seen without restarting the app (ruling 181). This
  is a generic change, owed since S2-4, and is declared in §6 with its effect on every sport.
- A History row for every event type the pad sends: rally, timeout, sub, sanction, set score (ruling 183).

**Non-goals**

- **No libero; it is S2-6b (the owner's, ruling 171).** The web records a libero replacement as
  `core.lineup.replacement` with the player's slot, order number and `exemption: "libero"`. The bootstrap
  already carries `slot`, `order_no` and `roles` (`wire.ts:26-38`, added for S2-5), so this is a scope
  choice, not a blocker.
- **No "who scored" step.** The web's dock asks for the scoring player on every rally; the phone keeps S2
  ruling 5 (no per-player point step) and sends `wonBy` alone, so `points` per player is the web's to
  collect (ruling 172).
- **No rotation number.** The engine reports FIVB 7.6.2 rotation only for a side whose six on court are
  declared, which an ordinary indoor sheet is not; the web reserves the slot and usually shows nothing.
  The phone shows the serving side, and for a beach pair with a declared order, the server's name (ruling 173).
- **No "Can {team} still field six?" step.** On the web, a "no" sends `core.forfeit{retired}` with the
  sanction. The phone never sends a forfeit (AGENTS §1): ending a match short is the organiser's. After an
  expulsion or a disqualification the sanction sheet's last step carries one line telling the scorer so
  (ruling 174).
- **No technical timeout, no expedite, no retirement tile.** Technical timeouts are a league option the web
  offers only in its More sheet; expedite is declared and never offered by the web; retirement ends the
  match, which is the organiser's (ruling 176).
- **No beach side switch prompt.** Neither the engine nor the web has one (every 7 points, 5 in the deciding
  set); it is a backlog item for both, not a phone invention (ruling 177).
- **No caps enforced.** The engine counts timeouts and substitutions and caps neither (a standing engine
  decision: a late correction must stay recordable). The pad shows the count beside the FIVB number
  ("Timeouts 1 of 2", "Subs 4 of 6") and never refuses the next one (ruling 175).
- **No engine change.** `@seazn/engine` 7.0.0 (pinned) ships `volleyball` (fold epoch 1, `foldEpochOf`) and
  `volleyballPadRules` in `@seazn/engine/pad`. If the build finds a gap, it is a finding, raised before any
  phone work depends on it (lesson L4, §9).

**Anti-goals**

- A server shown that the engine did not name. The strip shows the engine's serve side (and person, beach)
  or nothing, never a guess.
- A sanction or sub credited to a player the team sheet does not have. When the fixture has no players, the
  event carries the team alone (as football does), never a typed name.
- Volleyball conditions inside a shared component. A shared part takes props; the sport decides.
- A layout ruled after it is built. §5's mockups are picked before Batch C starts (ruling 178).

## 3. Rulings (S2-6)

All _the controller's_, 2026-11-11, open to the owner's correction, except where marked.

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 170 | The volleyball pad matches the web pad's record: rallies, the serve side, the deciding-set toss, timeouts, substitutions (indoor), the four-step sanction ladder and the set score. Not a points-only pad. _Why:_ an organiser's scoresheet and the scorebug want the same facts from either pad. _Cost if wrong:_ cells removed, no data loss.                                                                                                                                                                                   |
| 171 | **The owner's** ("Follow-up S2-6b (Recommended)", 2026-11-11): the libero is a follow-up, S2-6b. The reason given: a libero swap is not a substitution and does not touch the score or the sub count, so a match scored without it is still correct; it adds a `core.lineup.replacement` path, a step in the Sub sheet and a History row. _Cost if wrong:_ an indoor team with a libero records their swaps on the web only, until S2-6b.                                                                                         |
| 172 | No "who scored" step; `wonBy` only (S2 ruling 5 kept). _Cost if wrong:_ per-player points missing from phone-scored matches.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 173 | Indoor names the serving side only; beach names the server when the pair's order is declared; no rotation number.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 174 | No field-six step and never `core.forfeit`. After an expulsion or disqualification the sheet's done step says "If {team} can't field six, ask the organiser to end the match."                                                                                                                                                                                                                                                                                                                                                    |
| 175 | Timeouts and subs are counted per set against FIVB's 2 and 6 (indoor; beach: 1 timeout, no subs) and never refused at the cap. The count turns caution-coloured at the cap. The engine keeps subs per set (`subs.thisSet`) but timeouts only per match (`state.timeouts`, `kernel.js:545-551`), so the phone counts a set's timeouts from the ledger itself. A timeout, sub or sanction recorded after a set closes and before the next set's first rally belongs to the next set (FIVB: they are requested for the set to come). |
| 176 | No technical timeout, expedite or retirement on the phone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 177 | No beach side-switch prompt (backlog for engine and web).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 178 | **The owner's** ("A", 2026-11-11, after the controller's recommendation): layout A of three mockups at 390 × 844 and 320 × 640 (§5). Timeout and Sub on the tools row, counts on each half's foot, Sanction in More. B (all in More) and C (a Timeout button on each half) were rejected: B costs a tap on the two frequent tools; C puts a button inside the rally's tap area.                                                                                                                                                   |
| 179 | Start asks "Who serves first?", as badminton and table tennis. The pick rides the first rally as `serving`, tied to the ledger by a `base` count (the S2-2 stale-stamp lesson).                                                                                                                                                                                                                                                                                                                                                   |
| 180 | The deciding set (5th indoor, 3rd beach) is tossed afresh (`decidingSetTossed`): at its 0–0 the pad asks "Who serves first in set {n}?" once, as a sheet on the first tap, and the answer rides that rally as `serving`. Any other set's opener is the engine's alternation.                                                                                                                                                                                                                                                      |
| 181 | The match's bootstrap (teams, players, config) is read again when the app returns to the foreground and when a sheet that lists players opens, paced by the existing `BOOTSTRAP_PACE_MS` (15 s, `scoringMatchState.ts:42`). Generic, every sport; declared in §6. The web judges every append against the lineup as it is now (`append-event.ts:430`, `loadLineupPair`), so a phone folding a stale lineup is the one that disagrees: the re-read aligns the phone with the server, for football and cricket too.                 |
| 182 | A sub picks _off_ then _on_ from the team sheet (football's sheet kit) when the fixture has players, else records the team alone (`{by}`). Re-entry and position lock are the referee's: the pad lists every bench player and does not hide one who has left.                                                                                                                                                                                                                                                                     |
| 186 | Volleyball folds with the lineup the web server builds (`lineups.ts` `buildLineup`: every row's slot, order number, roles, role and pair order), not the set-based kit's all-starting `lineupOf` (`setBasedEngine.ts:76-87`). A volleyball lineup builder sits beside it; badminton and table tennis keep theirs (that they too differ from the server is recorded as a finding, not changed here).                                                                                                                               |
| 187 | A sanction's person list is the side's players, then its officials (coach, staff: `role` on the sheet), since FIVB sanctions team members, not players alone. One person on the list: no step. No one: the side alone.                                                                                                                                                                                                                                                                                                            |
| 188 | On beach with a declared pair order, the rally carries `server` (the person) as the web pad does, so the engine's `serves` stat fills; indoor never sends `server`.                                                                                                                                                                                                                                                                                                                                                               |
| 183 | History shows every event the pad sends, with the player's name where it has one: rally, timeout, sub, sanction, set score, and the deciding-set toss.                                                                                                                                                                                                                                                                                                                                                                            |
| 184 | Engine 7.0.0, no bump. `engineEpochs.test.ts` gains the volleyball literal (1) copied from the release.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 185 | A penalty sanction does not add the point: the engine keeps the sanction off the score, and the point is a rally the scorer taps. The done step reminds them which side. _Cost if wrong:_ a forgotten tap, visible on the score at once.                                                                                                                                                                                                                                                                                          |

## 4. How a scorer meets it

As the S2 design §4 and the S2-2 design §4, with these differences.

1. **Start.** Match details with volleyball's rules (variant, best of, set to, deciding set to, win by 2),
   "Who serves first?", Start match (ruling 179).
2. **A rally.** Tap the half of the side that won it. The engine applies side-out: the winner serves next.
   The strip shows the set score and the serving side; beach with a declared order shows the server's name.
3. **Set end and the deciding set.** The set ends when the engine says so; the next set's first server is
   the engine's alternation. At the deciding set's 0–0 the first tap opens "Who serves first in set {n}?",
   and its answer and the tapped rally go together (ruling 180). A co-scorer's rally landing first makes
   the pick moot: the `base` count drops it and the engine's side-out answers.
4. **Timeout.** One tap per side records `volleyball.timeout {by}`. The count in the set shows beside the
   FIVB number (ruling 175).
5. **Substitution (indoor).** Pick the side, then the player going off and the player coming on from the
   team sheet; no players on the sheet, the side alone (ruling 182). `volleyball.sub {by, off?, on?}`.
6. **Sanction.** Pick the side, the level (warning, penalty, expulsion, disqualification — the engine's
   `VOLLEYBALL_SANCTION_LEVELS`), then the person when the sheet has more than one. A sanction never
   touches the score (engine `setbased/kernel.js`, the W4 comment: the point arrives as a rally, as on the
   paper scoresheet), so after a penalty the done step says "Penalty: tap the rally to {other}" and the pad
   sends nothing more by itself (ruling 185). After expulsion or disqualification, the done step's line
   (ruling 174).
7. **Set score.** As table tennis: offered before a set's first rally, sends `volleyball.set.summary`.
8. **Undo, History, the queue, sync, Realtime, the finished and carried-forward cards:** unchanged.

## 5. The screen

**Layout A, the owner's (ruling 178).** Picked from three mockups in the phone app's own design (owner,
2026-11-10), drawn in English at 390 × 844 and 320 × 640 and served locally
(`.superpowers/brainstorm/…/content/volleyball-layout-v2.html`, not committed). French and Dutch fit are
checked by `padFit.test.ts` and exit item 5, not by the mockup.

- **Top bar** (shared): Home, the sets tally ("2 – 1 · Sets"), Rules, History, the sync dot.
- **Halves** (`ScoreHalf`, shared): the side's bar (lime first, lilac second), its name, the set's points;
  the serve ball beside the serving side's name (beach: the server's name when the pair order is set); the
  card icon at top right for the heaviest sanction this set (warning `cardCaution`, penalty and above
  `cardDismissal`); "Tap" at bottom right; at bottom left the side's counts, "T/O 1 of 2 · Subs 4 of 6"
  (beach: "T/O 0 of 1"), in `caution` once either is at the FIVB number (ruling 175).
- **Strip:** "Set 4 of 5", "to 25" (or the deciding set's 15), and the deuce note from
  `volleyballPadRules.deuceNote` when it applies.
- **Last-tap line:** the last record and Undo, as every set-based pad.
- **Tools row:** Set score (before a set's first rally only) · Timeout · Sub (indoor only) · More. Timeout and
  Sub open a two-choice side sheet (then, for Sub, off and on); More holds Sanction for each side.

## 6. The app's side

- **Domain** (`src/domain/scoring/`): `volleyball{Engine, Events, Fold, History, LedgerHistory, Pad, Rules,
Sanction, Sub, Sport}.ts`, each over the `setBased*` kit; the sub picker reuses `teamSheet.ts`.
  `volleyballPad.ts` splits its tools into `volleyballTools.ts` before it reaches 500 lines (the S2-2 lesson).
- **Routing:** `sports.ts` row `volleyball`; `scoringScreens.ts` row; `VolleyballPadScreen.tsx`,
  `VolleyballMatchScreen.tsx`; `useVolleyballMatch.ts`, `useVolleyballSheets.ts`.
- **Lint:** `SPORT_MODULES` and `SPORT_OWN_FILES` gain volleyball (both casings); `sportBoundary.test.ts` proves it.
- **i18n:** `scoring.volleyball.*` in en, es, fr, nl; `padFit.test.ts` sweeps them.
- **Fakes:** `fakeVolleyballPad.ts`; `fakeScoringPort.ts` gains the sport key; a ledger fixture
  `test/volleyballLedger.ts`.
- **Generic changes, declared** (each one changes every sport; the results doc lists them):
  1. Bootstrap re-read on foreground and on opening a player sheet (ruling 181). Touches the match runner
     and every sport's fold input; football and cricket fold with the lineup the server judges against.
     A finding to check in Batch A: what each sport's pad does with a pick (a batter, a player on the
     pitch) whose person leaves the re-read sheet.
  2. Whatever the build finds the shared kit lacks (a `SetBasedSide` of six named players, a sub row in
     `setBasedHistory`). Each is recorded as a finding, not a quiet edit.
- **Replay early** (lesson L5): Batch B ends with a real match (a published FIVB final, five sets, with its
  timeouts, subs and a sanction) replayed through the real hook against the fake server, which judges every
  append with the real engine. It runs before the screen is built, not after the exit bar.

## 7. Web side

The web accepts `volleyball` from the phone today: the device-link bootstrap passes any `sport_key`, and the
epoch gate resolves any sport. Owed by the web, raised at the start, none blocking S2-6:

- A beach side-switch prompt, engine and web together (ruling 177).

## 8. Exit bar

Each item with build, commit and Pass / Partly / Fail, as S2-2 to S2-5.

1. An indoor match on staging, scored on the owner's OnePlus to the organiser's final; console agrees rally
   for rally, including a timeout, a sub with players, a sanction, a deciding set.
2. A beach match the same way; no Sub offered; the server named where the pair order is declared.
3. A co-scorer's rally landing during the deciding-set toss: the pick is dropped, no wrong server.
4. The real-match replay (§6) green through the real hook.
5. 320 × 640 and the owner's phone, after the last layout fix, in French and Dutch, with the pad in play.
6. A lineup saved on the web after the pad opened appears on the next sheet (ruling 181).
7. The fold on Hermes (R4 probe) for volleyball.
8. Listed, not run unless the owner asks: TalkBack, iOS.

## 9. Lessons carried from S2-2 and S2-4 (and S2-5)

L1 mockups before the screen (ruling 178). L2 shared-kit changes declared (§6). L3 reuse the set-based and
sheet kits. L4 engine gaps found before phone work (Batch A reads the 7.0.0 volleyball module against every
event in §4). L5 the replay at design time (§6). L6 every held pick tied to a `base` count (rulings 179,
180). L7 the server's clock only (no timestamps from the phone). L8 device fit after the last fix, longest
locale (exit item 5). L9 the bootstrap re-read (ruling 181). L10 a History row for every event (ruling 183).

## 10. Left to the builder

File splits, function names, the order of the More sheet, the exact copy (en from this document, es/fr/nl the
controller's, as before), and the fake's shape.
