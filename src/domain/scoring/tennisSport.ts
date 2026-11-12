import { foldEpochOf } from '@seazn/engine/sport';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import { tennisEventFor, tennisPayloadForSend } from '@/domain/scoring/tennisEvents';
import { foldTennis, undoneTap } from '@/domain/scoring/tennisFold';
import { tennisPad } from '@/domain/scoring/tennisPad';
import { pointDetailsNote } from '@/domain/scoring/tennisPointDetails';
import type { TennisTypes } from '@/domain/scoring/tennisTypes';

/**
 * Tennis, as the match runtime scores it (`ScoringSport`; S2-7 Task 8): the fold (`foldTennis`, remembered), the event a
 * tap is (`tennisEventFor`), a send's payload (`tennisPayloadForSend`) and the pad (`tennisPad`) are tennis's own modules;
 * the rest reads its display and its taps. Volleyball's twin is `volleyballSport`. It declares no ending: the organiser's
 * forfeit, default and abandon are the web's, so nothing here ever waits on one.
 */
export const tennisSport: ScoringSport<TennisTypes> = {
  key: 'tennis',
  epoch: foldEpochOf('tennis'),
  fold: memoFold(foldTennis),
  eventFor: tennisEventFor,
  payloadForSend: tennisPayloadForSend,
  /** A detailed point sent without its server and kind (the serve moved while it was held) says so in the record. */
  sendNote: pointDetailsNote,
  /** The side the toss tap names (ruling 233): the Start screen's pick, which the match keeps until the start. */
  tossOf: (tap) => (tap.kind === 'toss' ? tap.side : null),
  /** A set score the match cannot reach is an invalid score; any other tap is not now. */
  refusalFor: (tap) => (tap.kind === 'setScore' ? 'invalidScore' : 'notNow'),
  notStarted: (display) => display.phase === 'notStarted',
  /** Won on court or ended by the organiser: either way the match is over. */
  decided: (display) => display.phase === 'decided' || display.phase === 'ended',
  /** Each set as it is written, joined by a space ("7–6(5) 3–6 6–4"; a match tie-break "[10–7]"). */
  resultLine: (display) => display.finished.map((one) => one.text).join(' '),
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already; the start is never named (`undoneTap`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : undoneTap(did);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: tennisPad,
};
