import {
  OUT_CHOICE,
  extraBase,
  extrasChoice,
  extrasSheet,
  type SheetExtra,
} from '@/domain/scoring/cricketExtras';
import {
  bowlerStep,
  changeStep,
  chooseBowler,
  chooseChange,
} from '@/domain/scoring/cricketBowling';
import {
  MORE_CHANGE,
  MORE_SWAP,
  cricketMoreItems,
  moreStep,
  type CricketMoreItem,
} from '@/domain/scoring/cricketMore';
import {
  moreFlowChoice,
  moreFlowStep,
  type CricketEntryFlow,
  type MoreFlow,
} from '@/domain/scoring/cricketMoreSteps';
import type { CricketPick } from '@/domain/scoring/cricketPicks';
import type { CricketDisplay, CricketStep, CricketTap } from '@/domain/scoring/cricketTypes';
import {
  chooseWicket,
  startWicket,
  wicketStep,
  type WicketFlow,
} from '@/domain/scoring/cricketWicket';

/**
 * The cricket sheets that go step by step (S2-4 spec §4.2 to §4.8; plan Tasks 11 to 15), as one pure machine the hook
 * holds (`useCricketSheets`): which step shows (`flowStep`), and what a choice on it does (`flowChoice`): the next step,
 * a tap to record, or a pending pick to keep. Each flow's steps are its own module's (`cricketExtras.ts`,
 * `cricketWicket.ts`, …); this file only joins them.
 */
export type CricketFlow =
  | { readonly kind: 'extras'; readonly extra: SheetExtra }
  | { readonly kind: 'wicket'; readonly wicket: WicketFlow }
  /** The over-end sheet: the next over's bowler (`cricketBowling.ts`). */
  | { readonly kind: 'bowler' }
  | { readonly kind: 'more' }
  /** More's mid-over change: who finishes the over (none yet), then why. */
  | { readonly kind: 'change'; readonly bowler: string | null }
  /** A step of one of More's other rows (`cricketMoreSteps.ts`). */
  | { readonly kind: 'moreRow'; readonly row: MoreFlow };

/**
 * What a choice comes to: the next step, a tap the sheet records as it closes, a pick it keeps as it closes, or the sheet of
 * typed numbers (`cricketEntry.ts`) in its place.
 */
export type FlowOutcome =
  | { readonly kind: 'next'; readonly flow: CricketFlow }
  | { readonly kind: 'tap'; readonly tap: CricketTap }
  | { readonly kind: 'pick'; readonly pick: CricketPick }
  | { readonly kind: 'entry'; readonly entry: CricketEntryFlow };

/** The step of `flow` on screen. */
export function flowStep(flow: CricketFlow, display: CricketDisplay): CricketStep {
  switch (flow.kind) {
    case 'extras':
      return extrasSheet(flow.extra);
    case 'wicket':
      return wicketStep(flow.wicket, display);
    case 'bowler':
      return bowlerStep(display);
    case 'more':
      return moreStep(display);
    case 'change':
      return changeStep(display, flow.bowler);
    case 'moreRow':
      return moreFlowStep(flow.row, display);
  }
}

/**
 * The step that stands over the pad by itself: the over-end sheet, while an innings under way has an over due with no
 * bowler (spec §4.4). It goes when its pick is kept, or when Undo takes the over's last ball back.
 */
export function standingFlow(display: CricketDisplay): CricketFlow | null {
  return display.stage === 'live' && display.needs === 'bowler' ? { kind: 'bowler' } : null;
}

/** More's first step. */
export const moreFlow = (): CricketFlow => ({ kind: 'more' });

/** What choosing `id` on the step of `flow` does; none for an id the step does not offer. */
export function flowChoice(
  flow: CricketFlow,
  display: CricketDisplay,
  id: string,
): FlowOutcome | null {
  switch (flow.kind) {
    case 'extras':
      return extrasOutcome(flow.extra, id);
    case 'wicket': {
      const chosen = chooseWicket(flow.wicket, display, id);
      if (chosen === null) return null;
      if ('next' in chosen) return { kind: 'next', flow: { kind: 'wicket', wicket: chosen.next } };
      return { kind: 'tap', tap: { kind: 'ball', ball: chosen.done } };
    }
    case 'bowler': {
      const pick = chooseBowler(display, id);
      return pick === null ? null : { kind: 'pick', pick };
    }
    case 'more':
      return moreOutcome(display, id);
    case 'change': {
      const chosen = chooseChange(display, flow.bowler, id);
      if (chosen === null) return null;
      if ('next' in chosen) return { kind: 'next', flow: { kind: 'change', bowler: chosen.next } };
      return { kind: 'tap', tap: chosen.done };
    }
    case 'moreRow': {
      const chosen = moreFlowChoice(flow.row, display, id);
      if (chosen === null) return null;
      if ('next' in chosen) return { kind: 'next', flow: { kind: 'moreRow', row: chosen.next } };
      return 'tap' in chosen
        ? { kind: 'tap', tap: chosen.tap }
        : { kind: 'entry', entry: chosen.entry };
    }
  }
}

/** A choice on More: only what it offers now. */
function moreOutcome(display: CricketDisplay, id: string): FlowOutcome | null {
  const item = cricketMoreItems(display).find((one) => one === id);
  if (item === undefined) return null;
  if (item === MORE_CHANGE) return { kind: 'next', flow: { kind: 'change', bowler: null } };
  if (item === MORE_SWAP) return { kind: 'pick', pick: { kind: 'swap' } };
  if (item === 'revise') return { kind: 'entry', entry: { kind: 'revise' } };
  return { kind: 'next', flow: { kind: 'moreRow', row: FIRST_STEP[item] } };
}

/** The first step of each of More's rows that asks something. */
const FIRST_STEP: Readonly<
  Record<Exclude<CricketMoreItem, 'changeBowler' | 'swapStrike' | 'revise'>, MoreFlow>
> = {
  otherRuns: { kind: 'otherRuns' },
  retire: { kind: 'retire', person: null, reason: null },
  review: { kind: 'review', by: null, review: null },
  newBall: { kind: 'confirm', item: 'newBall' },
  powerplay: { kind: 'powerplay' },
  interruption: { kind: 'interruption' },
  declare: { kind: 'confirm', item: 'declare' },
  close: { kind: 'close' },
  followOn: { kind: 'confirm', item: 'followOn' },
  matchClose: { kind: 'confirm', item: 'matchClose' },
};

/** The wicket steps for a fair ball, from the pad's Out. */
export function outFlow(): CricketFlow {
  return {
    kind: 'wicket',
    wicket: startWicket({ bat: 0, extra: null, boundary: null, wicket: null }),
  };
}

function extrasOutcome(extra: SheetExtra, id: string): FlowOutcome | null {
  if (id === OUT_CHOICE)
    return { kind: 'next', flow: { kind: 'wicket', wicket: startWicket(extraBase(extra)) } };
  const ball = extrasChoice(extra, id);
  return ball === null ? null : { kind: 'tap', tap: { kind: 'ball', ball } };
}
