import { foldEpochOf } from '@seazn/engine/sport';
import { footballEventFor, footballPayloadForSend } from '@/domain/scoring/footballEvents';
import { foldFootball } from '@/domain/scoring/footballFold';
import { footballPad, footballResultLine } from '@/domain/scoring/footballPad';
import type { FootballTypes } from '@/domain/scoring/footballTypes';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';

/**
 * Football, as the match runtime scores it (`ScoringSport`; S2-5 plan P Task 9): the fold (`foldFootball`, remembered),
 * the event a tap is (`footballEventFor`), a send's payload (`footballPayloadForSend`: a stamp raised to the ledger's
 * newest, never moved on for the time it waited, and a clock tap another screen overtook withdrawn), and the pad
 * (`footballPad`) are football's own modules; the rest reads its display. A Start accepted late is followed by a resync
 * the pad's hook taps (`footballResync.ts`), never by its own payload changing. Football has no serve and declares no
 * ending to wait on: the final whistle and the shootout are events like any other, and the engine decides the match.
 */
export const footballSport: ScoringSport<FootballTypes> = {
  key: 'football',
  epoch: foldEpochOf('football'),
  fold: memoFold(foldFootball),
  eventFor: footballEventFor,
  payloadForSend: footballPayloadForSend,
  /** Football has no serve: Start match picks no side, so the match keeps no pick. */
  tossOf: () => null,
  refusalFor: () => 'notNow',
  notStarted: (display) => display.phase === 'notStarted',
  /** Over: decided, finalized or abandoned (the engine's `done`, `final`, `abandoned`). */
  decided: (display) => display.phase === 'decided',
  /** Home's Finished card: "2–1", "5–5 (4–1)" after a shootout, and nothing until the match is decided. */
  resultLine: footballResultLine,
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already. */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : did;
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: footballPad,
};
