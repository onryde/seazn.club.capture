import type { CricketEntryFlow } from '@/domain/scoring/cricketMoreSteps';
import { turnOf } from '@/domain/scoring/cricketTurn';
import type { CricketDisplay, CricketPadKey, CricketTap } from '@/domain/scoring/cricketTypes';
import type { PadText } from '@/domain/scoring/padView';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';

/**
 * The numbers More asks typed (S2-4 spec §4.8; plan Task 15): a revision's overs and target, and the overs a rain break
 * cost. They are entered, never computed (the umpires' and the organiser's, not the phone's: no DLS here), and each is
 * a whole number the engine's schema takes (`CricketRevise`, `CricketInterruption`). A value that does not fit leaves
 * the sheet's Record greyed (`entryTap` is null), so the server never sees a refusal the phone could have known.
 */

export type CricketEntryField = {
  readonly id: string;
  readonly label: PadText<CricketPadKey>;
  /** What the field holds when the sheet opens. */
  readonly initial: string;
};

export type CricketEntryStep = {
  readonly name: string;
  readonly title: PadText<CricketPadKey>;
  readonly fields: readonly CricketEntryField[];
};

export function entryStep(entry: CricketEntryFlow, display: CricketDisplay): CricketEntryStep {
  if (entry.kind === 'oversLost') {
    return {
      name: 'entry.oversLost',
      title: { key: 'scoring.cricket.interruption.lostTitle' },
      fields: [{ id: 'lost', label: { key: 'scoring.cricket.interruption.lost' }, initial: '' }],
    };
  }
  return {
    name: 'entry.revise',
    title: { key: 'scoring.cricket.revise.title' },
    fields: [
      { id: 'overs', label: { key: 'scoring.cricket.revise.overs' }, initial: oversNow(display) },
      { id: 'target', label: { key: 'scoring.cricket.revise.target' }, initial: '' },
    ],
  };
}

/** The event the entered values record, or none while they do not make one the engine takes. */
export function entryTap(
  entry: CricketEntryFlow,
  display: CricketDisplay,
  values: readonly string[],
): CricketTap | null {
  return entry.kind === 'oversLost'
    ? lostTap(entry.interruption, values[0] ?? '')
    : reviseTap(display, values);
}

/** A whole number typed (`parseWholeNumber`: three digits at most), none for an empty field, NaN for anything else. */
function wholeOf(text: string): number | null {
  if (text.trim() === '') return null;
  return parseWholeNumber(text) ?? Number.NaN;
}

function lostTap(
  kind: Extract<CricketEntryFlow, { kind: 'oversLost' }>['interruption'],
  text: string,
) {
  const lost = wholeOf(text);
  if (Number.isNaN(lost)) return null;
  const payload = lost === null ? { kind } : { kind, oversLostEstimate: lost };
  return { kind: 'more', type: 'cricket.interruption', payload } as const;
}

/** The overs a side now, in whole overs; empty when the quota is not a whole number of overs. */
function oversNow(display: CricketDisplay): string {
  const { quota, cfg } = display.state;
  if (quota === null) return '';
  const overs = quota / cfg.ballsPerOver;
  return Number.isInteger(overs) ? String(overs) : '';
}

/**
 * Overs sent only when changed, a target only when given, at least one of them; both positive. New overs below the balls
 * the innings under way has bowled are refused by the server (strict), so they are refused here first.
 */
function reviseTap(display: CricketDisplay, values: readonly string[]): CricketTap | null {
  const [oversText = '', targetText = ''] = values;
  const overs = oversText.trim() === oversNow(display) ? null : wholeOf(oversText);
  const target = wholeOf(targetText);
  if (Number.isNaN(overs) || Number.isNaN(target) || (overs === null && target === null))
    return null;
  if (overs === 0 || target === 0) return null;
  if (overs !== null && overs * display.state.cfg.ballsPerOver < ballsBowledNow(display))
    return null;
  const payload = {
    ...(overs === null ? {} : { oversPerSide: overs }),
    ...(target === null ? {} : { target }),
  };
  return { kind: 'more', type: 'cricket.revise', payload };
}

/**
 * The legal balls of the innings now: none in one due and not opened. While More shows, the innings now is never a closed
 * one (`turnOf` names a closed innings only once nothing is due, when the match is decided and More is empty).
 */
const ballsBowledNow = (display: CricketDisplay): number =>
  turnOf(display.state)?.innings?.legalBalls ?? 0;
