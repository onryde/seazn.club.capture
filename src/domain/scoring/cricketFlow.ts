import {
  OUT_CHOICE,
  extraBase,
  extrasChoice,
  extrasSheet,
  type SheetExtra,
} from '@/domain/scoring/cricketExtras';
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
  | { readonly kind: 'wicket'; readonly wicket: WicketFlow };

/** What a choice comes to: the next step, a tap the sheet records as it closes, or a pick it keeps as it closes. */
export type FlowOutcome =
  | { readonly kind: 'next'; readonly flow: CricketFlow }
  | { readonly kind: 'tap'; readonly tap: CricketTap }
  | { readonly kind: 'pick'; readonly pick: CricketPick };

/** The step of `flow` on screen. */
export function flowStep(flow: CricketFlow, display: CricketDisplay): CricketStep {
  switch (flow.kind) {
    case 'extras':
      return extrasSheet(flow.extra);
    case 'wicket':
      return wicketStep(flow.wicket, display);
  }
}

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
  }
}

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
