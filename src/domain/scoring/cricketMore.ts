import { changeRows } from '@/domain/scoring/cricketBowling';
import type { CricketDisplay, CricketStep, CricketStepOption } from '@/domain/scoring/cricketTypes';

/**
 * More (S2-4 spec §4.8; ruling 84, the owner: "In More"; plan Tasks 13 and 15): what the pad records less often than a
 * ball, each shown only when the engine would take it now. Task 13 gives it the mid-over change and the strike swap.
 */

export const MORE_CHANGE = 'change';
export const MORE_SWAP = 'swap';

/**
 * "Change bowler (injury)": never in a super over (the engine refuses it there), and only with someone to finish the
 * over. The engine's `eligibleChangeBowlers` names nobody before an over's first ball, where it refuses a change too
 * (engine ruling 278), so its answer is the mid-over gate: no second gate of ours over it.
 */
const changeOffered = (display: CricketDisplay): boolean =>
  display.innings?.superOver === false && changeRows(display).length > 0;

/**
 * "Swap strike": in a main innings with both batters in. Ruling 84 scopes it to a main innings, though the engine would
 * take a reversed pair in a super over (preflight F28, the web's W9): pinned, not read. More is drawn only under the
 * keys, so only between balls.
 */
const swapOffered = (display: CricketDisplay): boolean =>
  display.innings?.superOver === false && display.crease !== null;

export function moreStep(display: CricketDisplay): CricketStep {
  const options: CricketStepOption[] = [];
  if (changeOffered(display))
    options.push({
      id: MORE_CHANGE,
      label: { key: 'scoring.cricket.more.change' },
      tone: 'standard',
    });
  if (swapOffered(display))
    options.push({ id: MORE_SWAP, label: { key: 'scoring.cricket.more.swap' }, tone: 'standard' });
  return { name: 'more', title: { key: 'scoring.cricket.key.more' }, body: null, options };
}

/** Whether More has anything to offer now: the key is greyed when it has not. */
export const moreOffered = (display: CricketDisplay): boolean =>
  moreStep(display).options.length > 0;
