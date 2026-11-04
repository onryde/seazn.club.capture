import { foldEpochOf } from '@seazn/engine/sport';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';
import { resultLineOf } from '@/domain/scoring/setBasedBoard';
import { foldTableTennis, undoneTap } from '@/domain/scoring/tableTennisFold';
import { tableTennisEventFor, tableTennisPayloadForSend } from '@/domain/scoring/tableTennisEvents';
import { tableTennisPad, type TableTennisTypes } from '@/domain/scoring/tableTennisPad';

/**
 * Table tennis, as the match runtime scores it (`ScoringSport`; plan S2-2 Task 6): the fold (`foldTableTennis`,
 * remembered), the event a tap is (`tableTennisEventFor`), a send's payload (`tableTennisPayloadForSend`) and the pad
 * (`tableTennisPad`) are table tennis's own modules; the rest reads its display and its taps. Badminton's twin is
 * `badmintonSport`. It declares no ending, so nothing here ever waits on one.
 */
export const tableTennisSport: ScoringSport<TableTennisTypes> = {
  key: 'tabletennis',
  epoch: foldEpochOf('tabletennis'),
  fold: memoFold(foldTableTennis),
  eventFor: tableTennisEventFor,
  payloadForSend: tableTennisPayloadForSend,
  /** Start match carries the side picked to serve first (design §4.1, ruling 49). */
  tossOf: (tap) => (tap.kind === 'start' ? tap.server : null),
  /** A set score the match cannot reach is an invalid score; any other tap is not now. */
  refusalFor: (tap) => (tap.kind === 'setScore' ? 'invalidScore' : 'notNow'),
  notStarted: (display) => display.phase === 'notStarted',
  decided: (display) => display.phase === 'decided',
  /** Each game over as `first–second`, joined by a comma ("11–7, 11–9, 0–11"). */
  resultLine: (display) => resultLineOf(display.finished),
  /** Table tennis declares no sanction ending: a red card is the umpire's to tap as a point. */
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already; the start is never named (`undoneTap`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : undoneTap(did);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: tableTennisPad,
};
