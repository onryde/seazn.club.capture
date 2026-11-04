import { foldEpochOf } from '@seazn/engine/sport';
import { badmintonEventFor, payloadForSend } from '@/domain/scoring/badmintonEvents';
import { foldBadminton, undoneTap } from '@/domain/scoring/badmintonFold';
import {
  badmintonPad,
  type BadmintonDisplay,
  type BadmintonPadKey,
  type BadmintonTap,
  type BadmintonUndoneTap,
} from '@/domain/scoring/badmintonPad';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import { resultLineOf } from '@/domain/scoring/setBasedBoard';

/** Badminton's pad types: what the match runtime is generic over (`SportTypes`). */
export type BadmintonTypes = {
  readonly tap: BadmintonTap;
  readonly display: BadmintonDisplay;
  readonly padKey: BadmintonPadKey;
  readonly undone: BadmintonUndoneTap;
};

/**
 * Badminton, as the match runtime scores it (`ScoringSport`): the fold (`foldBadminton`, remembered), the event a tap
 * is (`badmintonEventFor`), a send's payload (`payloadForSend`) and the pad (`badmintonPad`) are badminton's own
 * modules; the rest reads its display and its taps.
 */
export const badmintonSport: ScoringSport<BadmintonTypes> = {
  key: 'badminton',
  epoch: foldEpochOf('badminton'),
  fold: memoFold(foldBadminton),
  eventFor: badmintonEventFor,
  payloadForSend,
  /** Start match carries the side picked to serve first (owner, 2026-11-01). */
  tossOf: (tap) => (tap.kind === 'start' ? tap.server : null),
  /** A set score the match cannot reach is an invalid score; any other tap is not now. */
  refusalFor: (tap) => (tap.kind === 'setScore' ? 'invalidScore' : 'notNow'),
  notStarted: (display) => display.phase === 'notStarted',
  decided: (display) => display.phase === 'decided',
  /** Each game over as `first–second`, joined by a comma: a game a disqualification ended is there at its points. */
  resultLine: (display) => resultLineOf(display.finished),
  awaitingEnding: (display) => display.awaitingEnding,
  /** The last tap, unless it is an Undo already; the start is never named (`undoneTap`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : undoneTap(did);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: badmintonPad,
};
