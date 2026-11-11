import { foldEpochOf } from '@seazn/engine/sport';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import { resultLineOf } from '@/domain/scoring/setBasedBoard';
import { foldVolleyball, undoneTap } from '@/domain/scoring/volleyballFold';
import { volleyballEventFor, volleyballPayloadForSend } from '@/domain/scoring/volleyballEvents';
import { volleyballPad } from '@/domain/scoring/volleyballPad';
import type { VolleyballTypes } from '@/domain/scoring/volleyballTypes';

/**
 * Volleyball, as the match runtime scores it (`ScoringSport`; S2-6 Task 8): the fold (`foldVolleyball`, remembered), the
 * event a tap is (`volleyballEventFor`), a send's payload (`volleyballPayloadForSend`) and the pad (`volleyballPad`) are
 * volleyball's own modules; the rest reads its display and its taps. Table tennis's twin is `tableTennisSport`. It declares
 * no ending, so nothing here ever waits on one.
 */
export const volleyballSport: ScoringSport<VolleyballTypes> = {
  key: 'volleyball',
  epoch: foldEpochOf('volleyball'),
  fold: memoFold(foldVolleyball),
  eventFor: volleyballEventFor,
  payloadForSend: volleyballPayloadForSend,
  /** Start match carries the side picked to serve first (ruling 179). */
  tossOf: (tap) => (tap.kind === 'start' ? tap.server : null),
  /** A set score the match cannot reach is an invalid score; any other tap is not now. */
  refusalFor: (tap) => (tap.kind === 'setScore' ? 'invalidScore' : 'notNow'),
  notStarted: (display) => display.phase === 'notStarted',
  decided: (display) => display.phase === 'decided',
  /** Each set over as `first–second`, joined by a comma ("25–20, 20–25, 15–13"). */
  resultLine: (display) => resultLineOf(display.finished),
  /** Volleyball declares no ending: an expulsion's or a disqualification's end of the match is the organiser's. */
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already; the start is never named (`undoneTap`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : undoneTap(did);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: volleyballPad,
};
