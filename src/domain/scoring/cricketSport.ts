import { foldEpochOf } from '@seazn/engine/sport';
import { undoneTap } from '@/domain/scoring/cricketDone';
import { cricketEventFor, cricketPayloadForSend } from '@/domain/scoring/cricketEvents';
import { foldCricket } from '@/domain/scoring/cricketFold';
import {
  cricketDecided,
  cricketNotStarted,
  cricketPad,
  cricketResultLine,
} from '@/domain/scoring/cricketPad';
import type { CricketTypes } from '@/domain/scoring/cricketTypes';
import { memoFold } from '@/domain/scoring/scoringMatchFold';
import type { ScoringSport } from '@/domain/scoring/scoringSport';

/**
 * Cricket, as the match runtime scores it (`ScoringSport`; S2-4 plan Task 7): the fold (`foldCricket`, remembered), the
 * event a tap is (`cricketEventFor`), a send's payload (`cricketPayloadForSend`) and the pad (`cricketPad`) are cricket's
 * own modules; the rest reads its display and its taps. The toss is an event of its own (`cricket.toss`), never the
 * generic serve pick, so Start carries no side. Cricket declares no ending, so nothing here waits on one.
 */
export const cricketSport: ScoringSport<CricketTypes> = {
  key: 'cricket',
  epoch: foldEpochOf('cricket'),
  fold: memoFold(foldCricket),
  eventFor: cricketEventFor,
  payloadForSend: cricketPayloadForSend,
  /** The cricket toss is an event the ledger keeps, not a pick the match holds. */
  tossOf: () => null,
  refusalFor: () => 'notNow',
  notStarted: cricketNotStarted,
  decided: cricketDecided,
  /** Each innings' runs/wickets, joined ("25/3 · 25/4"): numbers only. */
  resultLine: cricketResultLine,
  awaitingEnding: () => false,
  /** The last tap, unless it is an Undo already; the toss and the start are never named (`undoneTap`). */
  undoneOf: (display) => {
    const did = display.lastTap;
    return did === null || did.kind === 'undone' ? null : undoneTap(did);
  },
  showUndone: (display, tap) => ({ ...display, lastTap: { kind: 'undone', tap } }),
  pad: cricketPad,
};
